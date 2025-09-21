// src/services/stock.service.ts
/**
 * =============================================================================
 * StockService — Business logic for inventory lots & movements
 * =============================================================================
 * Notes
 *  - ⛔ Does NOT create/commit transactions; pass a Sequelize Transaction in.
 *  - ⚖️ Never deletes a lot when it reaches 0; it is kept with quantity = 0.
 *  - For inbound adjustments with unitPrice, updates lot.unitPrice via simple MA.
 * =============================================================================
 */

import {
  Op,
  UniqueConstraintError,
  type Transaction,
  type FindOptions,
  type WhereOptions,
} from 'sequelize';

import { StockModel } from '../models/stock.model.js';
import { StockMovementModel } from '../models/stock-movement.model.js';
import { ProductModel } from '../models/product.model.js';
import { BadRequestError, NotFoundError } from '../errors/index.js';

import type {
  ListStocksQuery,
  StockFilters,
  StringMatch,
} from '../types/stock.js';

type ISODate = string; // YYYY-MM-DD

export interface LotKey {
  productId: string;
  location: string;
  zone?: string | null;
  expirationDate?: ISODate | null;
}

export interface AdjustInput extends LotKey {
  /** positive => IN, negative => OUT */
  quantityDelta: number;
  /** optional unit price snapshot; used for inbound MA update & movement snapshot */
  unitPrice?: number | null;
  /** movement reason (defaults to 'in'|'out' if not provided) */
  reason?: 'in' | 'out' | 'adjustment' | 'transfer_in' | 'transfer_out';
  /** external reference (PO/SO/doc no, etc.) */
  reference?: string | null;
  /** allow lot to go negative (default false) */
  allowNegative?: boolean;
  /** update lot.unitPrice with moving-average on inbound (default true) */
  updateAveragePriceOnInbound?: boolean;
  /** performedAt override */
  performedAt?: Date;
}

export interface TransferInput {
  /** source lot */
  from: LotKey;
  /** destination lot */
  to: LotKey;
  /** qty to transfer (must be > 0) */
  quantity: number;
  /** optional unitPrice to snapshot onto both movements and set on destination */
  unitPrice?: number | null;
  /** reference string for both movements */
  reference?: string | null;
  /** allow source to go negative (default false) */
  allowNegative?: boolean;
  /** update destination average price from inbound (default true) */
  updateAveragePriceOnInbound?: boolean;
  /** performedAt override */
  performedAt?: Date;
}

export class StockService {
  /* ------------------------------------------------------------------------ */
  /* Lot helpers                                                              */
  /* ------------------------------------------------------------------------ */

  /** Find a lot by natural key (no create). */
  static async findLot(key: LotKey, t?: Transaction) {
    const lot = await StockModel.findOne({
      where: {
        productId: key.productId,
        location: key.location,
        zone: key.zone ?? null,
        expirationDate: key.expirationDate ?? null,
      },
      transaction: t,
    });
    return lot;
  }

  /** Create a new lot. Throws if product doesn't exist. */
  static async createLot(key: LotKey, t?: Transaction) {
    const product = await ProductModel.findByPk(key.productId, {
      transaction: t,
    });
    if (!product) throw new NotFoundError('Product not found');

    try {
      const lot = await StockModel.create(
        {
          productId: key.productId,
          location: key.location.trim(),
          zone: key.zone ?? null,
          expirationDate: key.expirationDate ?? null,
          quantity: 0,
          unitPrice: null,
        },
        { transaction: t }
      );
      return lot;
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        // rare race: someone created it concurrently; fetch it
        const existing = await this.findLot(key, t);
        if (existing) return existing;
      }
      throw err;
    }
  }

  /** Find or create a lot (locked FOR UPDATE when inside a transaction). */
  static async getOrCreateLot(key: LotKey, t: Transaction) {
    let lot = await this.findLot(key, t);
    if (!lot) {
      lot = await this.createLot(key, t);
    }
    await lot.reload({ transaction: t, lock: t.LOCK.UPDATE });
    return lot;
  }

  /* ------------------------------------------------------------------------ */
  /* Business actions (require a Transaction)                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * Adjust quantity on a lot and write a movement.
   * Positive delta => IN; Negative => OUT.
   * Keeps the lot even when quantity reaches 0.
   */
  static async adjust(input: AdjustInput, t: Transaction) {
    const {
      productId,
      location,
      zone = null,
      expirationDate = null,
      quantityDelta,
      unitPrice = null,
      reason,
      reference = null,
      allowNegative = false,
      updateAveragePriceOnInbound = true,
      performedAt,
    } = input;

    if (!productId?.trim()) throw new BadRequestError('productId is required');
    if (!location?.trim()) throw new BadRequestError('location is required');
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
      throw new BadRequestError('quantityDelta must be a non-zero number');
    }

    const lot = await this.getOrCreateLot(
      { productId, location, zone, expirationDate },
      t
    );

    const currentQty = Number(lot.quantity) || 0;
    const newQty = currentQty + Number(quantityDelta);

    // Prevent negative if not allowed
    if (!allowNegative && newQty < 0) {
      throw new BadRequestError(
        `Insufficient stock at ${location}${
          zone ? `/${zone}` : ''
        } (have ${currentQty}, need ${-quantityDelta})`
      );
    }

    // Moving average only applies when IN and price provided
    if (
      quantityDelta > 0 &&
      updateAveragePriceOnInbound &&
      unitPrice !== null &&
      Number(unitPrice) >= 0
    ) {
      const prevQty = currentQty;
      const prevVal = (Number(lot.unitPrice) || 0) * prevQty;
      const newVal = prevVal + Number(unitPrice) * Number(quantityDelta);
      const denom = prevQty + Number(quantityDelta);
      lot.unitPrice =
        denom > 0 ? Number((newVal / denom).toFixed(4)) : Number(unitPrice);
    }

    const isIn = quantityDelta > 0;
    const finalReason = reason ?? (isIn ? 'in' : 'out');

    // Movement snapshot
    await StockMovementModel.create(
      {
        stockId: lot.stockId,
        productId,
        quantityDelta,
        reason: finalReason,
        reference,
        location,
        zone,
        expirationDate,
        unitPrice: unitPrice ?? lot.unitPrice ?? null,
        performedAt: performedAt ?? new Date(),
      },
      { transaction: t }
    );

    // Keep lot even at 0
    lot.quantity = newQty <= 0 ? 0 : newQty;
    await lot.save({ transaction: t });

    return {
      lot: lot.toJSON(),
      finalQty: Number(lot.quantity),
    };
  }

  /**
   * Transfer quantity between two lots (atomic in caller TX).
   * Creates 'transfer_out' from source and 'transfer_in' to destination.
   * Keeps source lot even if it reaches 0.
   */
  static async transfer(input: TransferInput, t: Transaction) {
    const {
      from,
      to,
      quantity,
      unitPrice = null,
      reference = null,
      allowNegative = false,
      updateAveragePriceOnInbound = true,
      performedAt,
    } = input;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestError('quantity must be a positive number');
    }

    // ----- OUT from source -----
    const source = await this.getOrCreateLot(
      {
        productId: from.productId,
        location: from.location,
        zone: from.zone ?? null,
        expirationDate: from.expirationDate ?? null,
      },
      t
    );
    const srcQty = Number(source.quantity) || 0;
    if (!allowNegative && srcQty < quantity) {
      throw new BadRequestError(
        `Insufficient stock at ${from.location}${
          from.zone ? `/${from.zone}` : ''
        } (have ${srcQty}, need ${quantity})`
      );
    }

    await StockMovementModel.create(
      {
        stockId: source.stockId,
        productId: from.productId,
        quantityDelta: -Math.abs(quantity),
        reason: 'transfer_out',
        reference,
        location: from.location,
        zone: from.zone ?? null,
        expirationDate: from.expirationDate ?? null,
        unitPrice: unitPrice ?? source.unitPrice ?? null,
        performedAt: performedAt ?? new Date(),
      },
      { transaction: t }
    );

    const srcNew = srcQty - Math.abs(quantity);
    source.quantity = srcNew <= 0 ? 0 : srcNew;
    await source.save({ transaction: t });

    // ----- IN to destination -----
    const dest = await this.getOrCreateLot(
      {
        productId: to.productId,
        location: to.location,
        zone: to.zone ?? null,
        expirationDate: to.expirationDate ?? null,
      },
      t
    );

    if (
      updateAveragePriceOnInbound &&
      unitPrice !== null &&
      Number(unitPrice) >= 0
    ) {
      const prevQty = Number(dest.quantity) || 0;
      const prevVal = (Number(dest.unitPrice) || 0) * prevQty;
      const newVal = prevVal + Number(unitPrice) * Math.abs(quantity);
      const denom = prevQty + Math.abs(quantity);
      dest.unitPrice =
        denom > 0 ? Number((newVal / denom).toFixed(4)) : Number(unitPrice);
    }

    dest.quantity = (Number(dest.quantity) || 0) + Math.abs(quantity);
    await dest.save({ transaction: t });

    await StockMovementModel.create(
      {
        stockId: dest.stockId,
        productId: to.productId,
        quantityDelta: Math.abs(quantity),
        reason: 'transfer_in',
        reference,
        location: to.location,
        zone: to.zone ?? null,
        expirationDate: to.expirationDate ?? null,
        unitPrice: unitPrice ?? dest.unitPrice ?? null,
        performedAt: performedAt ?? new Date(),
      },
      { transaction: t }
    );

    return {
      from: { finalQty: Number(source.quantity), lot: source.toJSON() },
      to: { finalQty: Number(dest.quantity), lot: dest.toJSON() },
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Queries                                                                  */
  /* ------------------------------------------------------------------------ */

  /** Get on-hand for a lot. */
  static async getOnHand(key: LotKey) {
    const lot = await this.findLot(key);
    return lot ? Number(lot.quantity) : 0;
  }

  /** Simple listing of lots by filters. */
  static async listLots(
    filters: Partial<LotKey & { productIds: string[] }> = {}
  ) {
    const where: WhereOptions = {};
    if (filters.productId) (where as any).productId = filters.productId;
    if (filters.productIds?.length)
      (where as any).productId = { [Op.in]: filters.productIds };
    if (filters.location) (where as any).location = filters.location;
    if (filters.zone !== undefined) (where as any).zone = filters.zone ?? null;
    if (filters.expirationDate !== undefined)
      (where as any).expirationDate = filters.expirationDate ?? null;

    const lots = await StockModel.findAll({
      where,
      order: [
        ['productId', 'ASC'],
        ['location', 'ASC'],
        ['zone', 'ASC'],
        ['expirationDate', 'ASC'],
      ],
    });
    return lots.map((l) => l.toJSON());
  }

  /* ------------------------------------------------------------------------ */
  /* List & Filter (q + sort + pagination)                                    */
  /* ------------------------------------------------------------------------ */

  /** List with q + sort + pagination. */
  static async list(query: ListStocksQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query;

    const where = this.buildWhere(q, undefined);

    const options: FindOptions = {
      where,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [[orderBy, orderDir]],
    };

    const { rows, count } = await StockModel.findAndCountAll(options);
    return {
      lots: rows.map((r) => r.toJSON()),
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /** Filter with structured filters + q + sort + pagination. */
  static async filter(query: ListStocksQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      filters,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query;

    const where = this.buildWhere(q, filters);

    const options: FindOptions = {
      where,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [[orderBy, orderDir]],
    };

    const { rows, count } = await StockModel.findAndCountAll(options);
    return {
      lots: rows.map((r) => r.toJSON()),
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Rebuild (scoped; requires a TX)                                          */
  /* ------------------------------------------------------------------------ */

  /** Recompute a single lot's quantity from movements (keeps lot even at 0). */
  static async rebuildLotFromMovements(key: LotKey, t: Transaction) {
    const lot = await this.getOrCreateLot(
      {
        productId: key.productId,
        location: key.location,
        zone: key.zone ?? null,
        expirationDate: key.expirationDate ?? null,
      },
      t
    );

    const moves = await StockMovementModel.findAll({
      where: {
        productId: key.productId,
        location: key.location,
        zone: key.zone ?? null,
        expirationDate: key.expirationDate ?? null,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const sum = moves.reduce((acc, m) => acc + Number(m.quantityDelta), 0);
    lot.quantity = Number(sum) <= 0 ? 0 : Number(sum);
    await lot.save({ transaction: t });

    return { lot: lot.toJSON(), movements: moves.length };
  }

  /* ------------------------------------------------------------------------ */
  /* Private where helpers                                                    */
  /* ------------------------------------------------------------------------ */

  private static patternFor(value: string, mode: StringMatch) {
    switch (mode) {
      case 'exact':
        return value;
      case 'startsWith':
        return `${value}%`;
      case 'endsWith':
        return `%${value}`;
      case 'like':
      default:
        return `%${value}%`;
    }
  }

  private static stringFieldCondition(
    field: string,
    value: string | (string | null)[],
    mode: StringMatch
  ): WhereOptions {
    const values = Array.isArray(value) ? value : [value];
    const hasNull = values.some((v) => v === null);
    const nonNull = values.filter((v): v is string => typeof v === 'string');

    const pieces: WhereOptions[] = [];
    if (nonNull.length) {
      if (mode === 'exact') {
        pieces.push({ [field]: { [Op.in]: nonNull } });
      } else {
        pieces.push({
          [Op.or]: nonNull.map((v) => ({
            [field]: { [Op.like]: this.patternFor(v, mode) },
          })),
        });
      }
    }
    if (hasNull) pieces.push({ [field]: { [Op.is]: null } });

    if (!pieces.length) return {};
    return pieces.length === 1 ? pieces[0] : { [Op.or]: pieces };
  }

  private static numericRangeCondition(
    field: string,
    from?: number,
    to?: number
  ): WhereOptions | undefined {
    const cond: any = {};
    if (typeof from === 'number') cond[Op.gte] = from;
    if (typeof to === 'number') cond[Op.lte] = to;
    return Object.keys(cond).length ? { [field]: cond } : undefined;
  }

  private static buildWhere(q?: string, filters?: StockFilters): WhereOptions {
    const andParts: WhereOptions[] = [];

    // Free-text across productId, location, zone
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      andParts.push({
        [Op.or]: [
          { productId: { [Op.like]: like } },
          { location: { [Op.like]: like } },
          { zone: { [Op.like]: like } },
        ],
      });
    }

    if (filters) {
      const match: StringMatch = filters.match ?? 'like';

      if (filters.productId) {
        andParts.push(
          this.stringFieldCondition('productId', filters.productId, match)
        );
      }
      if (filters.location) {
        andParts.push(
          this.stringFieldCondition('location', filters.location, match)
        );
      }
      if (filters.zone !== undefined) {
        andParts.push(this.stringFieldCondition('zone', filters.zone, match));
      }

      // expirationDate exact (string or null), supports array
      if (filters.expirationDate !== undefined) {
        const values = Array.isArray(filters.expirationDate)
          ? filters.expirationDate
          : [filters.expirationDate];
        const parts: WhereOptions[] = [];
        const nonNull = values.filter(
          (v): v is string => typeof v === 'string'
        );
        const hasNull = values.some((v) => v === null);
        if (nonNull.length)
          parts.push({ expirationDate: { [Op.in]: nonNull } });
        if (hasNull) parts.push({ expirationDate: { [Op.is]: null } });
        if (parts.length === 1) andParts.push(parts[0]);
        else if (parts.length > 1) andParts.push({ [Op.or]: parts });
      }

      // numeric ranges
      const qtyRange = this.numericRangeCondition(
        'quantity',
        filters.quantityFrom,
        filters.quantityTo
      );
      if (qtyRange) andParts.push(qtyRange);

      const priceRange = this.numericRangeCondition(
        'unitPrice',
        filters.unitPriceFrom,
        filters.unitPriceTo
      );
      if (priceRange) andParts.push(priceRange);

      // createdAt / updatedAt ranges
      if (filters.createdAtFrom || filters.createdAtTo) {
        const createdCond: any = {};
        if (filters.createdAtFrom)
          createdCond[Op.gte] = new Date(filters.createdAtFrom);
        if (filters.createdAtTo)
          createdCond[Op.lte] = new Date(filters.createdAtTo);
        andParts.push({ createdAt: createdCond });
      }
      if (filters.updatedAtFrom || filters.updatedAtTo) {
        const updatedCond: any = {};
        if (filters.updatedAtFrom)
          updatedCond[Op.gte] = new Date(filters.updatedAtFrom);
        if (filters.updatedAtTo)
          updatedCond[Op.lte] = new Date(filters.updatedAtTo);
        andParts.push({ updatedAt: updatedCond });
      }
    }

    return andParts.length ? ({ [Op.and]: andParts } as WhereOptions) : {};
  }
}

export const stockService = StockService;
