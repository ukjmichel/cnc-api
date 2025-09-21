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

const ORDER_ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'grandTotal',
  'status',
] as const;

/* ------------------------- Helpers: reservation policy --------------------- */

const STATUS_CONSUMES: ReadonlySet<OrderStatus> = new Set([
  'pending',
  'paid',
  'fulfilled',
]);

function consumesCapacity(status: OrderStatus) {
  return STATUS_CONSUMES.has(status);
}

/**
 * Adjusts reservedCount on a slot (by delta), enforcing capacity for increments.
 * Uses SELECT ... FOR UPDATE by reloading the row with a lock.
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

export class OrderService {
  /* ------------------------------ Basic CRUD ------------------------------ */

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

  static async getById(orderId: string) {
    const row = await OrderModel.findByPk(orderId);
    if (!row) throw new NotFoundError('Order not found');
    return row.toJSON();
  }

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
   * Advanced filter with optional inclusion of line items.
   * (Delegates to src/queries/order.queries.ts for consistency.)
   */
  static async filter(
    query: ListOrdersQuery & { includeItems?: boolean } = {}
  ) {
    return filterOrders(query as any);
  }

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
   * Change status and adjust slot reservation if the consumption flag changes.
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
   * Assign or change the pickup slot for an order.
   * - When order status consumes capacity, enforce capacity on the new slot.
   * - If switching slots, release the old one.
   * - If slotId is null, unassign (and release if consuming).
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
