// src/controllers/order.controller.ts

/**
 * =============================================================================
 * OrderController — HTTP layer for Orders
 * =============================================================================
 * Response shape (normalized)
 *  - Single:        { data: { order } }
 *  - Collections:   { data: { orders }, meta: { total, page, pageSize, pages } }
 *  - Deletes:       { data: { deleted: true } }
 *
 * Endpoints
 *  - POST   /api/orders                       → create
 *  - GET    /api/orders                       → list (filters + pagination)
 *  - GET    /api/orders/filter                → filter (alias of list)
 *  - GET    /api/orders/:orderId              → getById (with items + stock details)
 *  - PATCH  /api/orders/:orderId/totals       → updateTotals
 *  - PATCH  /api/orders/:orderId/contact      → updateContact
 *  - PATCH  /api/orders/:orderId/status       → changeStatus
 *  - PATCH  /api/orders/:orderId/pickup-slot  → setPickupSlot (assign/unassign)
 *  - DELETE /api/orders/:orderId              → remove
 *
 * Self-scoped (requireAuth):
 *  - GET    /api/orders/self                  → listSelf (current user's orders)
 *  - GET    /api/orders/self/:orderId         → getSelfById (one order of current user, enriched)
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../middlewares/requireAuth.js';
import { Op } from 'sequelize';

import {
  CreateOrderDTO,
  ListOrdersQuery,
  OrderDir,
  OrderOrderBy,
  OrderStatus,
  UpdateContactDTO,
  UpdateTotalsDTO,
} from '../types/order.js';

import { OrderService } from '../services/order.service.js';
import { OrderItemModel } from '../models/order-item.model.js';
import { StockModel } from '../models/stock.model.js';
import { BadRequestError, NotFoundError } from '../errors/index.js';
import { toInt } from '../utils/query.js';

/* ============================================================================
 * Query builders
 * ==========================================================================*/

/**
 * Build ListOrdersQuery from generic req.query (admin/general endpoints).
 * Supports: userId, status (csv), pickupSlotId (string or 'null'), dateFrom, dateTo.
 */
function buildListQuery(qs: Record<string, unknown>): ListOrdersQuery {
  const {
    page,
    pageSize,
    orderBy,
    orderDir,
    userId,
    status,
    pickupSlotId,
    dateFrom,
    dateTo,
  } = qs;

  const filters: ListOrdersQuery['filters'] = {};

  if (typeof userId === 'string' && userId.trim()) {
    filters.userId = userId.trim();
  }

  if (typeof status === 'string' && status.trim()) {
    const parts = status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as OrderStatus[];
    filters.status = parts.length > 1 ? parts : parts[0];
  }

  // allow "null" (string) to mean unassigned
  if (typeof pickupSlotId === 'string' && pickupSlotId.trim()) {
    filters.pickupSlotId =
      pickupSlotId.trim().toLowerCase() === 'null' ? null : pickupSlotId.trim();
  }

  if (typeof dateFrom === 'string' && dateFrom.trim())
    filters.dateFrom = dateFrom.trim();
  if (typeof dateTo === 'string' && dateTo.trim())
    filters.dateTo = dateTo.trim();

  return {
    filters,
    page: toInt(page, 1),
    pageSize: toInt(pageSize, 20),
    orderBy:
      typeof orderBy === 'string' ? (orderBy as OrderOrderBy) : undefined,
    orderDir: typeof orderDir === 'string' ? (orderDir as OrderDir) : undefined,
  };
}

/**
 * Build ListOrdersQuery without userId (we will inject req.user.userId for “self”).
 * Supports: status (csv), pickupSlotId ('null' allowed), dateFrom, dateTo.
 */
function buildSelfListQuery(qs: Record<string, unknown>): Omit<
  ListOrdersQuery,
  'filters'
> & {
  filters: NonNullable<ListOrdersQuery['filters']>;
} {
  const {
    page,
    pageSize,
    orderBy,
    orderDir,
    status,
    pickupSlotId,
    dateFrom,
    dateTo,
  } = qs;

  const filters: NonNullable<ListOrdersQuery['filters']> = {};

  if (typeof status === 'string' && status.trim()) {
    const parts = status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as OrderStatus[];
    filters.status = parts.length > 1 ? parts : parts[0];
  }

  if (typeof pickupSlotId === 'string' && pickupSlotId.trim()) {
    filters.pickupSlotId =
      pickupSlotId.trim().toLowerCase() === 'null' ? null : pickupSlotId.trim();
  }

  if (typeof dateFrom === 'string' && dateFrom.trim())
    filters.dateFrom = dateFrom.trim();
  if (typeof dateTo === 'string' && dateTo.trim())
    filters.dateTo = dateTo.trim();

  return {
    filters,
    page: toInt(page, 1),
    pageSize: toInt(pageSize, 20),
    orderBy:
      typeof orderBy === 'string' ? (orderBy as OrderOrderBy) : undefined,
    orderDir: typeof orderDir === 'string' ? (orderDir as OrderDir) : undefined,
  };
}

/* ============================================================================
 * Controller
 * ==========================================================================*/
export class OrderController {
  /* ------------------------------ Create & Read ------------------------------ */

  /**
   * Create a new order.
   * @route POST /api/orders
   * @body CreateOrderDTO
   * @returns 201 { data: { order } }
   */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body as CreateOrderDTO;
      const order = await OrderService.create(payload);
      return res.status(201).json({ data: { order } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * List orders with filters + pagination.
   * @route GET /api/orders
   * @query see buildListQuery
   * @returns 200 { data: { orders }, meta }
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildListQuery(req.query as Record<string, unknown>);
      const out = await OrderService.list(query);
      return res.json({
        data: { orders: out.orders },
        meta: {
          total: out.total,
          page: out.page,
          pageSize: out.pageSize,
          pages: out.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Alias of list().
   * @route GET /api/orders/filter
   * @returns 200 { data: { orders }, meta }
   */
  static async filter(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildListQuery(req.query as Record<string, unknown>);
      const out = await OrderService.list(query);
      return res.json({
        data: { orders: out.orders },
        meta: {
          total: out.total,
          page: out.page,
          pageSize: out.pageSize,
          pages: out.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Fetch one order by id and enrich with items + stock details.
   * - Removes redundant `orderId` from each item in the response.
   * - Embeds `stock` for each item but omits `stock.stockId` (already present on item).
   * @route GET /api/orders/:orderId
   * @returns 200 { data: { order } }
   */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      const order = await OrderService.getById(orderId);
      if (!order) throw new NotFoundError('Order not found');

      // Fetch items for this order
      const itemRows = await OrderItemModel.findAll({
        where: { orderId },
        order: [['createdAt', 'ASC']],
      });

      // Minimal stock lookup to enrich each item with productId and expirationDate only
      const stockIds = itemRows
        .map((r: any) => r.stockId)
        .filter((v: any) => !!v);

      let stockMap = new Map<
        string,
        { productId: string; expirationDate: string | null }
      >();
      if (stockIds.length) {
        const stocks = await StockModel.findAll({
          where: { stockId: { [Op.in]: stockIds } },
          attributes: ['stockId', 'productId', 'expirationDate'],
        } as any);
        stockMap = new Map(
          stocks.map((s: any) => {
            const j = s.toJSON?.() ?? s.get?.() ?? s;
            return [
              j.stockId,
              {
                productId: j.productId,
                expirationDate: j.expirationDate ?? null,
              },
            ];
          })
        );
      }

      const items = itemRows.map((row: any) => {
        const json = row.toJSON?.() ?? row.get?.() ?? row;
        const {
          orderId: _omitOrderId,
          stockId,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...rest
        } = json;

        const minimalStock = stockMap.get(stockId) || {
          productId: null,
          expirationDate: null,
        };

        return {
          ...('quantity' in rest ? { quantity: rest.quantity } : {}),
          ...('unitPrice' in rest ? { unitPrice: rest.unitPrice } : {}),
          ...('lineTotal' in rest ? { lineTotal: rest.lineTotal } : {}),
          productId: minimalStock.productId,
          expirationDate: minimalStock.expirationDate,
        };
      });

      return res.json({ data: { order: { ...order, items } } });
    } catch (err) {
      return next(err);
    }
  }

  /* ------------------------------ Field updates ----------------------------- */

  /**
   * Update totals (decimal strings).
   * @route PATCH /api/orders/:orderId/totals
   * @body { subtotal: string, taxTotal: string, grandTotal: string }
   * @returns 200 { data: { order } }
   */
  static async updateTotals(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      const body = req.body as UpdateTotalsDTO;

      if (
        typeof body?.subtotal !== 'string' ||
        typeof body?.taxTotal !== 'string' ||
        typeof body?.grandTotal !== 'string'
      ) {
        throw new BadRequestError(
          'subtotal, taxTotal and grandTotal (decimal strings) are required'
        );
      }

      const order = await OrderService.updateTotals(orderId, body);
      return res.json({ data: { order } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Update contact fields (contactName/Phone/notes).
   * @route PATCH /api/orders/:orderId/contact
   * @returns 200 { data: { order } }
   */
  static async updateContact(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      const body = req.body as UpdateContactDTO;
      const order = await OrderService.updateContact(orderId, body);
      return res.json({ data: { order } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Change order status with slot-capacity sync.
   * @route PATCH /api/orders/:orderId/status
   * @body { status: OrderStatus }
   * @returns 200 { data: { order } }
   */
  static async changeStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      const { status } = req.body as { status: OrderStatus };
      if (typeof status !== 'string') {
        throw new BadRequestError('status is required');
      }
      const order = await OrderService.changeStatus(orderId, status);
      return res.json({ data: { order } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Assign/switch/unassign pickup slot.
   * - Provide a UUID to assign/change
   * - Provide null to unassign (and release reservation if needed)
   * @route PATCH /api/orders/:orderId/pickup-slot
   * @body { pickupSlotId: string | null }
   * @returns 200 { data: { order } }
   */
  static async setPickupSlot(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      const { pickupSlotId } = req.body as { pickupSlotId: string | null };
      const order = await OrderService.setPickupSlot(
        orderId,
        pickupSlotId ?? null
      );
      return res.json({ data: { order } });
    } catch (err) {
      return next(err);
    }
  }

  /* --------------------------------- Delete -------------------------------- */

  /**
   * Remove an order (releases reservation if needed).
   * @route DELETE /api/orders/:orderId
   * @returns 200 { data: { deleted: true } }
   */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      const out = await OrderService.remove(orderId);
      return res.json({ data: out }); // { deleted: true }
    } catch (err) {
      return next(err);
    }
  }

  /* ---------------------------- Self-scoped (auth) --------------------------- */

  /**
   * List only the authenticated user's orders.
   * @route GET /api/orders/self
   * @auth required
   * @returns 200 { data: { orders }, meta }
   */
  static async listSelf(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = req.user!.userId;
      const query = buildSelfListQuery(req.query as Record<string, unknown>);
      const out = await OrderService.list({
        ...query,
        filters: { ...query.filters, userId },
      });
      return res.json({
        data: { orders: out.orders },
        meta: {
          total: out.total,
          page: out.page,
          pageSize: out.pageSize,
          pages: out.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Get one self-scoped order by id, enriched with items + stock details.
   * - Ensures the order belongs to the authenticated user.
   * - Removes redundant `orderId` per item and `stockId` inside embedded `stock`.
   * @route GET /api/orders/self/:orderId
   * @auth required
   * @returns 200 { data: { order } }
   */
  static async getSelfById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { orderId } = req.params;
      const userId = req.user!.userId;

      const order = await OrderService.getById(orderId);
      if (!order || order.userId !== userId) {
        throw new NotFoundError('Order not found');
      }

      const rows = await OrderItemModel.findAll({
        where: { orderId },
        order: [['createdAt', 'ASC']],
      });

      const stockIds = rows.map((r) => (r as any).stockId).filter(Boolean);
      const stocks = stockIds.length
        ? await StockModel.findAll({
            where: { stockId: { [Op.in]: stockIds } },
          })
        : [];
      const stockById = new Map(stocks.map((s) => [s.stockId, s.toJSON()]));

      const items = rows.map((r) => {
        const { orderId: _omit, ...item } = r.toJSON() as any;
        const stockRaw = item.stockId
          ? stockById.get(item.stockId) ?? null
          : null;

        const stock =
          stockRaw && typeof stockRaw === 'object'
            ? (({ stockId: _sid, ...rest }) => rest)(stockRaw)
            : null;

        return { ...item, stock };
      });

      return res.json({ data: { order: { ...order, items } } });
    } catch (err) {
      return next(err);
    }
  }
}
