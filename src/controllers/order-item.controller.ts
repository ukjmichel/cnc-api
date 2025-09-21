/**
 * =============================================================================
 * OrderItemsController
 * =============================================================================
 * Responsibility
 *  - Thin HTTP layer ONLY. It parses inputs, checks parent resource existence,
 *    and delegates ALL business logic to the service layer.
 *
 * ⚠️ IMPORTANT INVARIANT
 *  - The controller MUST NOT:
 *      • Adjust stock on-hand
 *      • Create StockMovement entries
 *      • Compute line totals or unit prices
 *    These operations belong strictly to OrderItemService.
 *    If a caller attempts to trigger “direct” adjustments (e.g. via a header),
 *    this controller throws a BadRequestError.
 *
 * Endpoints
 *  - POST    /api/orders/:orderId/items          → create single item
 *  - POST    /api/orders/:orderId/items/bulk     → bulk create (atomic)
 *  - GET     /api/orders/:orderId/items          → list items (paginated)
 *  - GET     /api/orders/:orderId/items/:stockId → get one (composite key)
 *  - PATCH   /api/orders/:orderId/items/:stockId → update
 *  - DELETE  /api/orders/:orderId/items/:stockId → remove
 *  - GET     /api/order-items                    → global filter/search
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import {
  CreateOrderItemDTO,
  UpdateOrderItemDTO,
  ListOrderItemsQuery,
} from '../types/order-item.js';
import { orderItemService } from '../services/order-item.service.js';
import { BadRequestError, NotFoundError } from '../errors/index.js';
import { OrderModel } from '../models/order.model.js';
import { toInt } from '../utils/query.js';

/**
 * Build a pagination/sort query object from Express req.query.
 * Controller-only normalization; validation occurs elsewhere.
 *
 * @param {Record<string, unknown>} qs Express `req.query`
 * @returns {ListOrderItemsQuery} normalized query object
 */
function buildListQuery(qs: Record<string, unknown>): ListOrderItemsQuery {
  return {
    page: toInt(qs.page, 1),
    pageSize: toInt(qs.pageSize, 20),
    orderBy: typeof qs.orderBy === 'string' ? (qs.orderBy as any) : undefined,
    orderDir:
      typeof qs.orderDir === 'string' ? (qs.orderDir as any) : undefined,
  };
}

/**
 * Guard against attempting to do stock/movement work inside the controller.
 * If a client sets a sentinel header to try to force controller-side logic,
 * we reject it to preserve our layering rules.
 *
 * @throws {BadRequestError} when a direct stock adjust sentinel is detected
 */
function assertNoDirectDomainWork(req: Request) {
  const hdr = req.headers['x-direct-stock-adjust'];
  if (hdr === '1' || hdr === 'true' || (req as any).__directAdjust === true) {
    throw new BadRequestError(
      'Stock adjustments and movements must be performed by the service layer.'
    );
  }
}

export class OrderItemsController {
  /**
   * Create a single order item for a given order.
   *
   * Route: `POST /api/orders/:orderId/items`
   *
   * Behavior:
   * - Ensures parent order exists.
   * - Delegates all business logic (stock sufficiency, deduction, movement,
   *   unitPrice defaulting/override, lineTotal computation) to the service.
   *
   * @param {Request} req Express request (body: CreateOrderItemDTO; params.orderId)
   * @param {Response} res Express response
   * @param {NextFunction} next Error pipeline
   * @returns {Promise<void>} 201 with `{ data: { item } }` on success
   * @throws {BadRequestError} when orderId param missing
   * @throws {NotFoundError} when order not found
   * @throws {Error} bubbled service errors (validation, stock, etc.)
   */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      assertNoDirectDomainWork(req);

      const { orderId } = req.params;
      if (!orderId?.trim()) throw new BadRequestError('orderId param required');

      const exists = await OrderModel.findByPk(orderId);
      if (!exists) throw new NotFoundError('Order not found');

      const body = { ...req.body, orderId } as CreateOrderItemDTO;
      const item = await orderItemService.create(body);
      return res.status(201).json({ data: { item } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Bulk create/merge order items for a given order (atomic).
   *
   * Route: `POST /api/orders/:orderId/items/bulk`
   *
   * Behavior:
   * - Ensures parent order exists.
   * - Validates body is a non-empty array.
   * - Normalizes each item to CreateOrderItemDTO and delegates a single
   *   transactional operation to the service (merge lines, deduct stock,
   *   write movements, compute prices/totals).
   *
   * @param {Request} req Express request (body: CreateOrderItemDTO[]; params.orderId)
   * @param {Response} res Express response
   * @param {NextFunction} next Error pipeline
   * @returns {Promise<void>} 201 with `{ data: { created } }` on success
   * @throws {BadRequestError} when orderId missing or body invalid
   * @throws {NotFoundError} when order not found
   * @throws {Error} bubbled service errors
   */
  static async createMany(req: Request, res: Response, next: NextFunction) {
    try {
      assertNoDirectDomainWork(req);

      const { orderId } = req.params;
      if (!orderId?.trim()) throw new BadRequestError('orderId param required');

      const exists = await OrderModel.findByPk(orderId);
      if (!exists) throw new NotFoundError('Order not found');

      if (!Array.isArray(req.body) || req.body.length === 0) {
        throw new BadRequestError('Body must be a non-empty array of items');
      }

      const dtos = (req.body as Partial<CreateOrderItemDTO>[]).map((it) => ({
        orderId,
        stockId: String(it.stockId ?? ''),
        quantity: String(it.quantity ?? ''),
        unitPrice:
          it.unitPrice !== undefined ? String(it.unitPrice) : undefined,
        lineTotal:
          it.lineTotal !== undefined ? String(it.lineTotal) : undefined,
      })) as CreateOrderItemDTO[];

      const created = await orderItemService.createMany(dtos);
      return res.status(201).json({ data: { created } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * List items for a given order with pagination and sorting.
   *
   * Route: `GET /api/orders/:orderId/items`
   *
   * @param {Request} req Express request (params.orderId; query: pagination/sort)
   * @param {Response} res Express response
   * @param {NextFunction} next Error pipeline
   * @returns {Promise<void>} 200 with `{ data: { items }, meta }`
   * @throws {BadRequestError} when orderId param missing
   * @throws {NotFoundError} when order not found
   */
  static async listForOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      if (!orderId?.trim()) throw new BadRequestError('orderId param required');

      const exists = await OrderModel.findByPk(orderId);
      if (!exists) throw new NotFoundError('Order not found');

      const query = buildListQuery(req.query as Record<string, unknown>);
      const result = await orderItemService.listByOrder(orderId, query);

      return res.json({
        data: { items: result.items },
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
   * Get a single order item by composite key (orderId + stockId).
   *
   * Route: `GET /api/orders/:orderId/items/:stockId`
   *
   * @param {Request} req Express request (params.orderId, params.stockId)
   * @param {Response} res Express response
   * @param {NextFunction} next Error pipeline
   * @returns {Promise<void>} 200 with `{ data: { item } }`
   * @throws {NotFoundError} when order or item not found
   */
  static async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId, stockId } = req.params;
      const exists = await OrderModel.findByPk(orderId);
      if (!exists) throw new NotFoundError('Order not found');

      const item = await orderItemService.getOne(orderId, stockId);
      return res.json({ data: { item } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Patch an order item (quantity and/or unitPrice).
   * Service will recompute lineTotal and persist.
   *
   * Route: `PATCH /api/orders/:orderId/items/:stockId`
   *
   * @param {Request} req Express request (params.orderId, params.stockId, body: UpdateOrderItemDTO)
   * @param {Response} res Express response
   * @param {NextFunction} next Error pipeline
   * @returns {Promise<void>} 200 with `{ data: { item } }`
   * @throws {NotFoundError} when order or item not found
   */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId, stockId } = req.params;
      const exists = await OrderModel.findByPk(orderId);
      if (!exists) throw new NotFoundError('Order not found');

      const patch = req.body as UpdateOrderItemDTO;
      const item = await orderItemService.update(orderId, stockId, patch);
      return res.json({ data: { item } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Delete an order item by composite key.
   * (No automatic stock return; handle returns in a dedicated flow.)
   *
   * Route: `DELETE /api/orders/:orderId/items/:stockId`
   *
   * @param {Request} req Express request (params.orderId, params.stockId)
   * @param {Response} res Express response
   * @param {NextFunction} next Error pipeline
   * @returns {Promise<void>} 200 with `{ data: { deleted: true } }`
   * @throws {NotFoundError} when order or item not found
   */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId, stockId } = req.params;
      const exists = await OrderModel.findByPk(orderId);
      if (!exists) throw new NotFoundError('Order not found');

      const out = await orderItemService.remove(orderId, stockId);
      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Global filter/search endpoint with pagination & sorting passthrough.
   *
   * Route: `GET /api/order-items`
   *
   * @param {Request} req Express request (query contains filters/sort/pagination)
   * @param {Response} res Express response
   * @param {NextFunction} next Error pipeline
   * @returns {Promise<void>} 200 with `{ data: { items }, meta }`
   */
  static async filter(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, string | undefined>;
      const filters = {
        orderId: q.orderId,
        stockId: q.stockId,
        productId: q.productId,
        createdFrom: q.createdFrom,
        createdTo: q.createdTo,
        quantityMin: q.quantityMin ? Number(q.quantityMin) : undefined,
        quantityMax: q.quantityMax ? Number(q.quantityMax) : undefined,
        unitPriceMin: q.unitPriceMin ? Number(q.unitPriceMin) : undefined,
        unitPriceMax: q.unitPriceMax ? Number(q.unitPriceMax) : undefined,
        lineTotalMin: q.lineTotalMin ? Number(q.lineTotalMin) : undefined,
        lineTotalMax: q.lineTotalMax ? Number(q.lineTotalMax) : undefined,
      };

      const result = await orderItemService.filter({
        page: q.page ? Number(q.page) : undefined,
        pageSize: q.pageSize ? Number(q.pageSize) : undefined,
        orderBy: q.orderBy as any,
        orderDir: q.orderDir as any,
        filters,
      });

      return res.json({
        data: { items: result.items },
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
}
