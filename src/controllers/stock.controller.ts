// src/controllers/stock.controller.ts

/**
 * =============================================================================
 * StockController — HTTP layer for inventory lots & movements
 * =============================================================================
 * Response shape (normalized)
 *  - Single entity:        { data: { lot | result } }
 *  - Collections (list):   { data: { lots }, meta: { total, page, pageSize, pages } }
 *  - Utility/success-only: { data: { success: true } }
 *
 * Endpoints
 *  - POST   /api/stocks/adjust            → adjust lot quantity (+/-) & write movement
 *  - POST   /api/stocks/transfer          → transfer qty between two lots (OUT+IN)
 *  - GET    /api/stocks/on-hand           → getOnHand (?productId=&location=&zone=&expirationDate=)
 *  - GET    /api/stocks                   → list (q + sort + pagination)
 *  - GET    /api/stocks/filter            → filter (advanced filters + q + sort + pagination)
 *  - GET    /api/stocks/lots-of-product   → all lots of a product (?productId=) — no pagination
 *  - POST   /api/stocks/rebuild           → rebuild a lot from movements (body: lot key)
 *
 * Notes
 *  - Business logic lives in StockService; this controller stays thin.
 *  - Query builders live in src/queries/stock.queries.ts
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { StockService } from '../services/stock.service.js';
import { BadRequestError } from '../errors/index.js';
import { toInt } from '../utils/query.js';
import {
  buildStockFilterQuery,
  buildStockListQuery,
} from '../queries/stock.queries.js';
import { sequelize } from '../db/sequelize.js';

// Types mirrored from StockService (kept inline for convenience)
type ISODate = string;

interface LotKey {
  productId: string;
  location: string;
  zone?: string | null;
  expirationDate?: ISODate | null;
}

interface AdjustInput extends LotKey {
  quantityDelta: number;
  unitPrice?: number | null;
  reason?: 'in' | 'out' | 'adjustment' | 'transfer_in' | 'transfer_out';
  reference?: string | null;
  allowNegative?: boolean;
  updateAveragePriceOnInbound?: boolean;
  performedAt?: Date;
}

interface TransferInput {
  from: LotKey;
  to: LotKey;
  quantity: number;
  unitPrice?: number | null;
  reference?: string | null;
  allowNegative?: boolean;
  updateAveragePriceOnInbound?: boolean;
  performedAt?: Date;
}

/** Normalize & coerce query string into LotKey (for GET on-hand). */
function readLotKeyFromQuery(q: Request['query']): LotKey {
  const productId = String(q.productId ?? '').trim();
  const location = String(q.location ?? '').trim();
  const zone =
    q.zone === undefined || q.zone === null || q.zone === ''
      ? null
      : String(q.zone);
  const expirationDate =
    q.expirationDate === undefined ||
    q.expirationDate === null ||
    q.expirationDate === ''
      ? null
      : String(q.expirationDate);

  return { productId, location, zone, expirationDate };
}

/** Basic validation for required LotKey fields. */
function assertLotKey(k: LotKey) {
  if (!k.productId) throw new BadRequestError('productId is required');
  if (!k.location) throw new BadRequestError('location is required');
}

export class StockController {
  /* ======================================================================== */
  /* ACTIONS                                                                  */
  /* ======================================================================== */

  /**
   * POST /api/stocks/adjust
   * Body: AdjustInput
   * Returns: { data: { lot, finalQty, movement } }
   *  - lot: latest lot snapshot (never deleted even if quantity hits 0)
   */
  static async adjust(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as AdjustInput;
      assertLotKey(body);
      if (!Number.isFinite(body.quantityDelta) || body.quantityDelta === 0) {
        throw new BadRequestError('quantityDelta must be a non-zero number');
      }

      const result = await sequelize.transaction((t) =>
        StockService.adjust(body, t)
      );

      return res.status(200).json({ data: result });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/stocks/transfer
   * Body: TransferInput
   * Returns: {
   *   data: {
   *     from: { finalQty, lot, movement },
   *     to:   { finalQty, lot, movement }
   *   }
   * }
   */
  static async transfer(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as TransferInput;

      if (!body?.from || !body?.to) {
        throw new BadRequestError('Both "from" and "to" lot keys are required');
      }
      assertLotKey(body.from);
      assertLotKey(body.to);

      if (!Number.isFinite(body.quantity) || body.quantity <= 0) {
        throw new BadRequestError('quantity must be a positive number');
      }

      const result = await sequelize.transaction((t) =>
        StockService.transfer(body, t)
      );

      return res.status(200).json({ data: result });
    } catch (err) {
      return next(err);
    }
  }

  /* ======================================================================== */
  /* READS                                                                    */
  /* ======================================================================== */

  /**
   * GET /api/stocks/on-hand?productId=&location=&zone=&expirationDate=
   * Returns: { data: { onHand } }
   */
  static async getOnHand(req: Request, res: Response, next: NextFunction) {
    try {
      const key = readLotKeyFromQuery(req.query);
      assertLotKey(key);

      const onHand = await StockService.getOnHand(key);
      return res.status(200).json({ data: { onHand } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/stocks
   * q + sort + pagination
   * Returns: { data: { lots }, meta }
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildStockListQuery(req.query as Record<string, unknown>);
      const result = await StockService.list(query);

      return res.status(200).json({
        data: { lots: result.lots },
        meta: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          pages: result.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/stocks/filter
   * Advanced filters + q + sort + pagination
   * Returns: { data: { lots }, meta }
   */
  static async filter(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildStockFilterQuery(req.query as Record<string, unknown>);
      const result = await StockService.filter(query);

      return res.status(200).json({
        data: { lots: result.lots },
        meta: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          pages: result.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/stocks/lots-of-product?productId=...
   * Returns all existing lots for a given product (no pagination).
   */
  static async lotsOfProduct(req: Request, res: Response, next: NextFunction) {
    try {
      const productId = String(req.query.productId ?? '').trim();
      if (!productId) {
        throw new BadRequestError('productId query param is required');
      }

      const lots = await StockService.listLots({ productId });
      return res.status(200).json({
        data: { lots },
        meta: { total: lots.length, page: 1, pageSize: lots.length, pages: 1 },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/stocks (legacy-style simple list with manual pagination)
   * NOTE: You can keep this for simple list-by-filters use-cases, but prefer /filter.
   */
  static async listSimple(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        productId,
        productIds,
        location,
        zone,
        expirationDate,
        page,
        pageSize,
      } = req.query as Record<string, string | undefined>;

      const filters: any = {};
      if (productId) filters.productId = productId;
      if (productIds) {
        const arr = productIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (arr.length) filters.productIds = arr;
      }
      if (location) filters.location = location;
      if (zone !== undefined) filters.zone = zone === '' ? null : zone;
      if (expirationDate !== undefined)
        filters.expirationDate = expirationDate === '' ? null : expirationDate;

      const all = await StockService.listLots(filters);

      const p = toInt(page, 1);
      const ps = toInt(pageSize, 20);
      const total = all.length;
      const pages = Math.max(1, Math.ceil(total / ps));
      const start = (p - 1) * ps;
      const lots = all.slice(start, start + ps);

      return res.status(200).json({
        data: { lots },
        meta: { total, page: p, pageSize: ps, pages },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/stocks/rebuild
   * Body: { productId, location, zone?, expirationDate? }
   * Recomputes lot quantity from movements (scoped).
   */
  static async rebuild(req: Request, res: Response, next: NextFunction) {
    try {
      const key = req.body as LotKey;
      assertLotKey(key);

      const result = await sequelize.transaction((t) =>
        StockService.rebuildLotFromMovements(key, t)
      );

      return res.status(200).json({ data: result });
    } catch (err) {
      return next(err);
    }
  }
}
