/**
 * =============================================================================
 * OrderItemService
 * =============================================================================
 * Purpose
 *  - Encapsulates business logic for order items:
 *      • Create single & bulk (merge on composite key {orderId, stockId})
 *      • Update & Delete
 *      • List & Filter with pagination passthrough
 *
 * Design
 *  - **No request-shape or string format validation here** (handled by express-validator).
 *  - **Domain-state validation is enforced here**:
 *      • Stock lot must exist
 *      • Stock lot must have sufficient on-hand for the requested quantity
 *  - **All stock deductions are persisted**:
 *      • Locks the stock row (SELECT ... FOR UPDATE)
 *      • Decreases on-hand
 *      • Writes a StockMovement row (OUT) with a snapshot of key stock fields
 *  - UnitPrice:
 *      • Defaults to current stock.unitPrice unless frontend overrides
 *      • LineTotal is recomputed as quantity × unitPrice (rounded to 2dp)
 *
 * Concurrency
 *  - All create flows run inside a single transaction.
 *  - Per-line, the relevant stock row is locked with `FOR UPDATE` to prevent race conditions.
 *
 * Notes
 *  - Update/Remove do NOT reconcile stock automatically; if you need returns/adjustments,
 *    implement a dedicated flow that creates an IN movement and adjusts on-hand.
 * =============================================================================
 */

import { sequelize } from '../db/sequelize.js';
import { OrderItemModel } from '../models/order-item.model.js';
import { StockModel } from '../models/stock.model.js';
import { StockMovementModel } from '../models/stock-movement.model.js';

import {
  OrderItemAttributes,
  CreateOrderItemDTO,
  UpdateOrderItemDTO,
  ListOrderItemsQuery,
  ListOrderItemsResult,
} from '../types/order-item.js';

import { NotFoundError, BadRequestError } from '../errors/index.js';
import { filterOrderItems } from '../queries/order-item.queries.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Best-effort numeric parse with a friendly error message if NaN. */
function mustParseNumber(val: unknown, errMsg: string): number {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  if (Number.isNaN(n)) throw new BadRequestError(errMsg);
  return n;
}

/** Compute lineTotal = quantity × unitPrice (rounded to 2dp). */
function computeLineTotal(quantity: string, unitPrice: string): string {
  const q = mustParseNumber(quantity, 'Invalid quantity');
  const p = mustParseNumber(unitPrice, 'Invalid unitPrice');
  return (q * p).toFixed(2);
}

/** Format to 3 decimals for storage consistency. */
function toQty3(n: number): string {
  return Number(n).toFixed(3);
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

export const orderItemService = {
  /**
   * Validate that a stock lot exists and has sufficient on-hand under the given TX.
   * Locks the row if a transaction is provided (FOR UPDATE).
   *
   * @param stockId - Stock lot identifier
   * @param requestedQtyStr - Requested quantity as string (already validated upstream for shape)
   * @param tx - Optional Sequelize transaction (locks when provided)
   * @returns the locked StockModel instance
   * @throws NotFoundError if stock doesn't exist
   * @throws BadRequestError if not enough on hand
   */
  async validateStockAvailable(
    stockId: string,
    requestedQtyStr: string,
    tx?: any
  ) {
    const stock = await StockModel.findByPk(stockId, {
      transaction: tx,
      lock: tx ? tx.LOCK.UPDATE : undefined,
    });
    if (!stock) throw new NotFoundError('Stock lot not found');

    const need = mustParseNumber(requestedQtyStr, 'Invalid quantity');
    const have = mustParseNumber(stock.quantity, 'Invalid stock quantity');

    const need3 = Number(need.toFixed(3));
    const have3 = Number(have.toFixed(3));

    if (have3 < need3) {
      throw new BadRequestError(
        `Insufficient stock (have ${have3.toFixed(3)}, need ${need3.toFixed(
          3
        )})`
      );
    }

    return stock;
  },

  /**
   * Deduct on-hand from a stock lot and record a StockMovement OUT.
   * Assumes you already validated sufficiency using validateStockAvailable().
   *
   * @param stock - Locked StockModel row
   * @param orderId - Owning order for reference
   * @param qtyStr - Quantity to deduct (string)
   * @param tx - Transaction to use
   */
  async deductAndMove(
    stock: StockModel,
    orderId: string,
    qtyStr: string,
    tx: any
  ) {
    const q = mustParseNumber(qtyStr, 'Invalid quantity');
    const q3 = Number(q.toFixed(3));

    // 1) Decrease on-hand
    const have = mustParseNumber(stock.quantity, 'Invalid stock quantity');
    stock.quantity = Number((have - q3).toFixed(3));
    await stock.save({ transaction: tx });

    // 2) Write OUT movement (snapshot key fields)
    await StockMovementModel.create(
      {
        stockId: stock.stockId,
        productId: stock.productId,
        quantityDelta: -q3, // negative for OUT
        reason: 'out',
        reference: `order:${orderId}`,
        location: stock.location,
        zone: stock.zone,
        expirationDate: stock.expirationDate,
        unitPrice: stock.unitPrice, // snapshot at movement time
        performedAt: new Date(),
      },
      { transaction: tx }
    );
  },

  /**
   * Create a single order item (or merge with existing line on the same (orderId, stockId)).
   * - Respects optional unitPrice override from frontend; falls back to stock.unitPrice otherwise.
   * - Deducts stock and writes StockMovement OUT **in the same transaction**.
   *
   * @param dto - CreateOrderItemDTO
   * @returns Created or merged order item attributes
   */
  async create(dto: CreateOrderItemDTO): Promise<OrderItemAttributes> {
    if (!dto.orderId?.trim()) throw new BadRequestError('orderId is required');
    if (!dto.stockId?.trim()) throw new BadRequestError('stockId is required');

    return await sequelize.transaction(async (t) => {
      // 1) Validate & lock stock
      const stock = await this.validateStockAvailable(
        dto.stockId,
        dto.quantity,
        t
      );

      // 2) Deduct and write movement
      await this.deductAndMove(stock, dto.orderId, dto.quantity, t);

      // 3) Merge or create order-item
      const existing = await OrderItemModel.findOne({
        where: { orderId: dto.orderId, stockId: dto.stockId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (existing) {
        const newQty =
          mustParseNumber(existing.quantity, 'Invalid stored quantity') +
          mustParseNumber(dto.quantity, 'Invalid quantity');
        // effective unit price: override > existing > stock
        const effectiveUnitPrice =
          dto.unitPrice ?? existing.unitPrice ?? String(stock.unitPrice);

        existing.quantity = toQty3(newQty);
        existing.unitPrice = effectiveUnitPrice;
        existing.lineTotal = computeLineTotal(
          existing.quantity,
          effectiveUnitPrice
        );

        const saved = await existing.save({ transaction: t });
        return saved.toJSON() as OrderItemAttributes;
      }

      const unitPrice = dto.unitPrice ?? String(stock.unitPrice);
      const qty3 = toQty3(mustParseNumber(dto.quantity, 'Invalid quantity'));
      const lineTotal = dto.lineTotal ?? computeLineTotal(qty3, unitPrice);

      const created = await OrderItemModel.create(
        {
          orderId: dto.orderId,
          stockId: dto.stockId,
          quantity: qty3,
          unitPrice,
          lineTotal,
        },
        { transaction: t }
      );

      return created.toJSON() as OrderItemAttributes;
    });
  },

  /**
   * Bulk create/merge order items **atomically**.
   * - Pre-validates all lines for existence & sufficiency (under same TX/locks).
   * - Deducts stock + writes movements line-by-line.
   * - Merges lines on (orderId, stockId).
   *
   * @param dtos - Array of CreateOrderItemDTO
   * @returns Array of created/merged items
   */
  async createMany(dtos: CreateOrderItemDTO[]): Promise<OrderItemAttributes[]> {
    if (!Array.isArray(dtos) || dtos.length === 0) {
      throw new BadRequestError('Body must be a non-empty array of items');
    }

    return await sequelize.transaction(async (t) => {
      // 1) Pre-validate & lock each stock (ensures all-or-nothing capacity)
      const lockedStocks = new Map<string, StockModel>();
      for (const raw of dtos) {
        if (!raw.orderId?.trim())
          throw new BadRequestError('orderId is required');
        if (!raw.stockId?.trim())
          throw new BadRequestError('stockId is required');

        const stock = await this.validateStockAvailable(
          raw.stockId,
          raw.quantity,
          t
        );
        lockedStocks.set(raw.stockId, stock);
      }

      const results: OrderItemAttributes[] = [];

      // 2) Process lines deterministically
      for (const raw of dtos) {
        const stock = lockedStocks.get(raw.stockId)!;

        // Deduct + movement
        await this.deductAndMove(stock, raw.orderId, raw.quantity, t);

        // Merge/create order-item
        const existing = await OrderItemModel.findOne({
          where: { orderId: raw.orderId, stockId: raw.stockId },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (existing) {
          const newQty =
            mustParseNumber(existing.quantity, 'Invalid stored quantity') +
            mustParseNumber(raw.quantity, 'Invalid quantity');

          const effectiveUnitPrice =
            raw.unitPrice ?? existing.unitPrice ?? String(stock.unitPrice);

          existing.quantity = toQty3(newQty);
          existing.unitPrice = effectiveUnitPrice;
          existing.lineTotal = computeLineTotal(
            existing.quantity,
            effectiveUnitPrice
          );

          const saved = await existing.save({ transaction: t });
          results.push(saved.toJSON() as OrderItemAttributes);
        } else {
          const qty3 = toQty3(
            mustParseNumber(raw.quantity, 'Invalid quantity')
          );
          const unitPrice = raw.unitPrice ?? String(stock.unitPrice);
          const lineTotal = raw.lineTotal ?? computeLineTotal(qty3, unitPrice);

          const created = await OrderItemModel.create(
            {
              orderId: raw.orderId,
              stockId: raw.stockId,
              quantity: qty3,
              unitPrice,
              lineTotal,
            },
            { transaction: t }
          );
          results.push(created.toJSON() as OrderItemAttributes);
        }
      }

      return results;
    });
  },

  /**
   * Get one item by composite key.
   *
   * @param orderId - Order ID
   * @param stockId - Stock ID (lot)
   * @returns The order item
   * @throws NotFoundError if not found
   */
  async getOne(orderId: string, stockId: string): Promise<OrderItemAttributes> {
    const row = await OrderItemModel.findOne({ where: { orderId, stockId } });
    if (!row) throw new NotFoundError('Order item not found');
    return row.toJSON() as OrderItemAttributes;
  },

  /**
   * Update a line and recompute lineTotal.
   * NOTE: This does NOT adjust stock/movements. Use a dedicated adjustment flow for that.
   *
   * @param orderId - Order ID
   * @param stockId - Stock ID (lot)
   * @param patch - Fields to patch (quantity, unitPrice)
   * @returns Updated item
   * @throws NotFoundError if the item doesn't exist
   */
  async update(
    orderId: string,
    stockId: string,
    patch: UpdateOrderItemDTO
  ): Promise<OrderItemAttributes> {
    const row = await OrderItemModel.findOne({ where: { orderId, stockId } });
    if (!row) throw new NotFoundError('Order item not found');

    if (patch.quantity !== undefined) {
      const q = mustParseNumber(patch.quantity, 'Invalid quantity');
      row.quantity = toQty3(q);
    }
    if (patch.unitPrice !== undefined) {
      mustParseNumber(patch.unitPrice, 'Invalid unitPrice');
      row.unitPrice = patch.unitPrice;
    }

    const effectiveUnitPrice = String(row.unitPrice ?? '0.00');
    row.lineTotal = computeLineTotal(row.quantity, effectiveUnitPrice);

    const saved = await row.save();
    return saved.toJSON() as OrderItemAttributes;
  },

  /**
   * Delete a single line (no stock return here).
   *
   * @param orderId - Order ID
   * @param stockId - Stock ID (lot)
   * @returns { deleted: true } if removed
   * @throws NotFoundError if the item doesn't exist
   */
  async remove(orderId: string, stockId: string) {
    const deleted = await OrderItemModel.destroy({
      where: { orderId, stockId },
    });
    if (!deleted) throw new NotFoundError('Order item not found');
    return { deleted: true };
  },

  /**
   * Global filter passthrough to query layer.
   *
   * @param query - ListOrderItemsQuery
   * @returns Paginated results
   */
  async filter(query: ListOrderItemsQuery): Promise<ListOrderItemsResult> {
    return filterOrderItems(query);
  },

  /**
   * List all items for a given order (with pagination passthrough).
   *
   * @param orderId - Order ID
   * @param query - Pagination & sort
   * @returns Paginated results
   */
  async listByOrder(
    orderId: string,
    query: ListOrderItemsQuery
  ): Promise<ListOrderItemsResult> {
    return filterOrderItems({
      ...query,
      filters: { ...query.filters, orderId },
    });
  },
};
