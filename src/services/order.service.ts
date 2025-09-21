// src/services/order.service.ts
/**
 * =============================================================================
 * OrderService — business logic for Orders (+ pickup-slot capacity sync)
 * =============================================================================
 * Capabilities
 *  - create:                create an order (draft/pending by default)
 *  - getById:               fetch one
 *  - list / filter:         paging + sort + common filters
 *  - updateTotals:          set subtotal/tax/grand (decimal strings)
 *  - updateContact:         set contactName/Phone/notes
 *  - changeStatus:          transition with reservation sync when relevant
 *  - setPickupSlot:         assign/switch/unassign pickup slots safely
 *  - remove:                delete an order (releases reservation if needed)
 *
 * Slot reservation rules (configurable here in code):
 *  - Statuses that CONSUME capacity: 'pending' | 'paid' | 'fulfilled'
 *  - Statuses that DO NOT consume:   'draft' | 'cancelled' | 'refunded'
 *
 * When an order that “consumes capacity” is assigned a slot:
 *  - We increment that slot’s reservedCount (enforcing capacity >= reservedCount+1)
 * If it leaves such a slot (status change, slot change, delete):
 *  - We decrement the old slot’s reservedCount (floor at 0)
 *
 * All mutating operations that affect slot counters run in a single transaction.
 * =============================================================================
 */

import { FindOptions, Op, Transaction, WhereOptions } from 'sequelize';
import { OrderModel, OrderStatus } from '../models/order.model.js';
import { PickupSlotModel } from '../models/pickup-slot.model.js';
import { withTransaction } from '../utils/tx.js';
import { normalizeSort, toInt } from '../utils/query.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../errors/index.js';
import {
  CreateOrderDTO,
  ListOrdersQuery,
  OrderOrderBy,
  UpdateContactDTO,
  UpdateTotalsDTO,
} from '../types/order.js';
import { filterOrders } from '../queries/order.queries.js';

/* ------------------------------ Sort whitelist ----------------------------- */

/**
 * Allowed fields for `orderBy` (used by {@link normalizeSort}).
 */
const ORDER_ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'grandTotal',
  'status',
] as const;

/* ------------------------- Helpers: reservation policy --------------------- */

/**
 * Statuses that consume pickup-slot capacity.
 * @private
 */
const STATUS_CONSUMES: ReadonlySet<OrderStatus> = new Set([
  'pending',
  'paid',
  'fulfilled',
]);

/**
 * Returns whether a given status should consume pickup-slot capacity.
 * @param status - Order status.
 */
function consumesCapacity(status: OrderStatus) {
  return STATUS_CONSUMES.has(status);
}

/**
 * Adjust the `reservedCount` of a pickup slot atomically.
 *
 * Loads the slot row with `SELECT ... FOR UPDATE`, applies `delta`,
 * and enforces capacity on increments.
 *
 * @param slotId - Target pickup slot id.
 * @param delta - Positive to reserve (+1), negative to release (-1).
 * @param t - Active Sequelize transaction.
 * @throws {NotFoundError} If the slot does not exist.
 * @throws {ConflictError} If increment would exceed capacity.
 */
async function bumpSlotReserved(slotId: string, delta: number, t: Transaction) {
  const slot = await PickupSlotModel.findByPk(slotId, {
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!slot) throw new NotFoundError('Pickup slot not found');

  const current = Number(slot.get('reservedCount')) || 0;
  const capacity = Number(slot.get('capacity')) || 0;
  const next = current + delta;

  if (delta > 0 && next > capacity) {
    throw new ConflictError(`Pickup slot is full (${current}/${capacity}).`);
  }

  slot.set('reservedCount', Math.max(0, next));
  await slot.save({ transaction: t });
}

/* ------------------------------- Filters build ----------------------------- */

/**
 * Build a Sequelize `WHERE` clause for listing/filtering orders.
 * @param filters - Optional filters (userId, status, pickupSlotId, date range).
 * @returns A `WhereOptions` object; empty object when no filters.
 */
function buildWhere(filters?: ListOrdersQuery['filters']): WhereOptions {
  if (!filters) return {};

  const and: WhereOptions[] = [];

  if (filters.userId) and.push({ userId: filters.userId });

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      and.push({ status: { [Op.in]: filters.status } });
    } else {
      and.push({ status: filters.status });
    }
  }

  if (filters.pickupSlotId !== undefined) {
    if (filters.pickupSlotId === null) {
      and.push({ pickupSlotId: null });
    } else {
      and.push({ pickupSlotId: filters.pickupSlotId });
    }
  }

  if (filters.dateFrom || filters.dateTo) {
    and.push({
      createdAt: {
        ...(filters.dateFrom ? { [Op.gte]: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { [Op.lte]: new Date(filters.dateTo) } : {}),
      },
    });
  }

  return and.length ? { [Op.and]: and } : {};
}

/* ---------------------------------- Service -------------------------------- */

/**
 * Business-logic layer for Orders, including safe synchronization of pickup-slot
 * reservations whenever order status or assigned slot changes.
 */
export class OrderService {
  /* ------------------------------ Basic CRUD ------------------------------ */

  /**
   * Create a new order.
   *
   * If `pickupSlotId` is provided and the initial status consumes capacity,
   * the method will reserve capacity on that slot atomically.
   *
   * @param input - Order creation payload.
   * @returns The created order as a plain JSON object.
   * @throws {BadRequestError} When `status` is invalid.
   * @throws {ConflictError} When capacity reservation would exceed slot capacity.
   * @throws {NotFoundError} When provided `pickupSlotId` does not exist.
   */
  static async create(input: CreateOrderDTO) {
    const status = input.status ?? 'pending';
    if (
      ![
        'draft',
        'pending',
        'paid',
        'cancelled',
        'fulfilled',
        'refunded',
      ].includes(status)
    ) {
      throw new BadRequestError('Invalid status');
    }

    return withTransaction(async (t) => {
      // Create base order
      const order = await OrderModel.create(
        {
          userId: input.userId ?? null,
          status,
          subtotal: input.subtotal ?? '0',
          taxTotal: input.taxTotal ?? '0',
          grandTotal: input.grandTotal ?? '0',
          currency: input.currency ?? 'USD',
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          notes: input.notes ?? null,
          pickupSlotId: null, // set below if needed
        },
        { transaction: t }
      );

      // Optional: reserve a slot at creation
      if (input.pickupSlotId) {
        await this._assignSlot(
          order,
          input.pickupSlotId,
          /*enforceCapacity*/ consumesCapacity(status),
          t
        );
      }

      await order.save({ transaction: t });
      return order.toJSON();
    });
  }

  /**
   * Fetch a single order by id.
   * @param orderId - Order primary key.
   * @returns The order as a plain JSON object.
   * @throws {NotFoundError} If the order does not exist.
   */
  static async getById(orderId: string) {
    const row = await OrderModel.findByPk(orderId);
    if (!row) throw new NotFoundError('Order not found');
    return row.toJSON();
  }

  /**
   * List orders with pagination and sorting.
   * @param query - Paging/sort options and simple filters.
   * @returns `{ orders, total, page, pageSize, pages }`.
   */
  static async list(query: ListOrdersQuery = {}) {
    const page = toInt(query.page, 1);
    const pageSize = toInt(query.pageSize, 20);

    const sort = normalizeSort<OrderOrderBy>(
      query.orderBy,
      query.orderDir,
      ORDER_ORDER_FIELDS,
      'createdAt'
    );

    const where = buildWhere(query.filters);

    const options: FindOptions = {
      where,
      order: [[sort.orderBy, sort.orderDir]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    };

    const { rows, count } = await OrderModel.findAndCountAll(options);
    return {
      orders: rows.map((r) => r.toJSON()),
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /**
   * Advanced filter endpoint that can optionally include line items (delegated).
   * @param query - Filter query; accepts `includeItems` passthrough flag.
   * @returns The filtered collection with pagination meta.
   */
  static async filter(
    query: ListOrdersQuery & { includeItems?: boolean } = {}
  ) {
    return filterOrders(query as any);
  }

  /**
   * Delete an order.
   *
   * If the order both has a slot assigned and its status consumes capacity,
   * this will release one reservation from that slot.
   *
   * @param orderId - Order primary key.
   * @returns `{ deleted: true }` upon success.
   * @throws {NotFoundError} If the order does not exist.
   */
  static async remove(orderId: string) {
    return withTransaction(async (t) => {
      const order = await OrderModel.findByPk(orderId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!order) throw new NotFoundError('Order not found');

      // If this order was consuming capacity and had a slot, release it
      if (order.pickupSlotId && consumesCapacity(order.status)) {
        await bumpSlotReserved(order.pickupSlotId, -1, t);
      }

      await order.destroy({ transaction: t });
      return { deleted: true };
    });
  }

  /* ---------------------------- Field updaters ---------------------------- */

  /**
   * Update monetary totals on an order.
   * @param orderId - Order id.
   * @param totals - Decimal-string totals and optional currency.
   * @returns The updated order as a plain JSON object.
   * @throws {NotFoundError} If the order does not exist.
   */
  static async updateTotals(orderId: string, totals: UpdateTotalsDTO) {
    const order = await OrderModel.findByPk(orderId);
    if (!order) throw new NotFoundError('Order not found');

    order.subtotal = totals.subtotal;
    order.taxTotal = totals.taxTotal;
    order.grandTotal = totals.grandTotal;
    if (totals.currency) order.currency = totals.currency;

    await order.save();
    return order.toJSON();
  }

  /**
   * Update contact info fields.
   * @param orderId - Order id.
   * @param contact - Contact patch (name/phone/notes).
   * @returns The updated order as a plain JSON object.
   * @throws {NotFoundError} If the order does not exist.
   */
  static async updateContact(orderId: string, contact: UpdateContactDTO) {
    const order = await OrderModel.findByPk(orderId);
    if (!order) throw new NotFoundError('Order not found');

    if (contact.contactName !== undefined)
      order.contactName = contact.contactName;
    if (contact.contactPhone !== undefined)
      order.contactPhone = contact.contactPhone;
    if (contact.notes !== undefined) order.notes = contact.notes;

    await order.save();
    return order.toJSON();
  }

  /* ------------------------ Status & slot management ---------------------- */

  /**
   * Change the status of an order, adjusting slot reservation counters
   * when crossing the “consumes capacity” boundary.
   *
   * - Non-consuming → Consuming: reserves +1 on current slot (if any).
   * - Consuming → Non-consuming: releases -1 from current slot (if any).
   *
   * @param orderId - Order id.
   * @param newStatus - Target status.
   * @returns The updated order as a plain JSON object.
   * @throws {BadRequestError} When status is invalid.
   * @throws {NotFoundError} If the order does not exist.
   * @throws {ConflictError} If attempting to reserve and the slot is full.
   */
  static async changeStatus(orderId: string, newStatus: OrderStatus) {
    if (
      ![
        'draft',
        'pending',
        'paid',
        'cancelled',
        'fulfilled',
        'refunded',
      ].includes(newStatus)
    ) {
      throw new BadRequestError('Invalid status');
    }

    return withTransaction(async (t) => {
      const order = await OrderModel.findByPk(orderId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!order) throw new NotFoundError('Order not found');

      const wasConsuming = consumesCapacity(order.status);
      const willConsume = consumesCapacity(newStatus);

      // If moving from non-consuming -> consuming, try to reserve 1 on current slot
      if (!wasConsuming && willConsume && order.pickupSlotId) {
        await bumpSlotReserved(order.pickupSlotId, +1, t);
      }
      // If moving from consuming -> non-consuming, release 1 on current slot
      if (wasConsuming && !willConsume && order.pickupSlotId) {
        await bumpSlotReserved(order.pickupSlotId, -1, t);
      }

      order.status = newStatus;
      await order.save({ transaction: t });
      return order.toJSON();
    });
  }

  /**
   * Assign, switch, or unassign a pickup slot for an order.
   *
   * - When assigning and the order status consumes capacity, enforces capacity.
   * - When switching, releases the old slot (if consuming) before reserving new.
   * - When unassigning, releases the old slot if consuming.
   *
   * @param orderId - Order id.
   * @param slotId - Target pickup slot id, or `null` to unassign.
   * @returns The updated order as a plain JSON object.
   * @throws {NotFoundError} If the order or slot does not exist.
   * @throws {ConflictError} If reservation would exceed capacity.
   */
  static async setPickupSlot(orderId: string, slotId: string | null) {
    return withTransaction(async (t) => {
      const order = await OrderModel.findByPk(orderId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!order) throw new NotFoundError('Order not found');

      const consuming = consumesCapacity(order.status);
      const oldSlotId = order.pickupSlotId ?? null;

      // If no change
      if (oldSlotId === slotId) {
        return order.toJSON();
      }

      // Release old if needed
      if (oldSlotId && consuming) {
        await bumpSlotReserved(oldSlotId, -1, t);
      }

      // Assign new if provided
      if (slotId) {
        await this._assignSlot(order, slotId, /*enforceCapacity*/ consuming, t);
      } else {
        order.pickupSlotId = null;
        await order.save({ transaction: t });
      }

      return order.toJSON();
    });
  }

  /* ------------------------------ Internals ------------------------------- */

  /**
   * Internal helper that assigns a slot to an order inside a transaction.
   * Optionally enforces capacity (reserving +1).
   *
   * @param order - Loaded order instance (locked for update).
   * @param slotId - Slot to assign.
   * @param enforceCapacity - Whether to bump reservedCount (+1).
   * @param t - Active transaction.
   * @throws {NotFoundError} If the slot does not exist.
   * @throws {ConflictError} If capacity would be exceeded.
   * @internal
   */
  private static async _assignSlot(
    order: OrderModel,
    slotId: string,
    enforceCapacity: boolean,
    t: Transaction
  ) {
    // Check slot exists and is open
    const slot = await PickupSlotModel.findByPk(slotId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!slot) throw new NotFoundError('Pickup slot not found');

    if (enforceCapacity) {
      await bumpSlotReserved(slot.slotId, +1, t);
    }

    order.pickupSlotId = slot.slotId;
    await order.save({ transaction: t });
  }
}

export const orderService = OrderService;
