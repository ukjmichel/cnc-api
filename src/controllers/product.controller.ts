// src/controllers/product.controller.ts

/**
 * =============================================================================
 * ProductController — HTTP layer for products
 * =============================================================================
 * Response shape (normalized)
 *  - Single entity:        { data: { product } }
 *  - Collections (list):   { data: { products }, meta: { total, page, pageSize, pages } }
 *  - Utility/success-only: { data: { success: true } }
 *
 * Endpoints
 *  - POST   /api/products              → create
 *  - GET    /api/products              → list (q + sort + pagination)
 *  - GET    /api/products/filter       → filter (advanced filters + q)
 *  - GET    /api/products/by-code      → getByCode (?productCode=)
 *  - GET    /api/products/:id          → getById
 *  - PATCH  /api/products/:id          → update
 *  - DELETE /api/products/:id          → delete
 *
 * Notes
 *  - Business logic lives in ProductService; this controller only wraps/normalizes responses.
 *  - `productId` is a string PK provided by the caller (not UUID, not auto-generated).
 *  - `productCode` is optional and unique when present.
 *  - Serialization is centralized in src/serializers/product.serializer.ts
 *    and guarantees only these fields are exposed (in this order):
 *      productId, productCode, productName, brands, description, quantity, quantityUnit
 *    with `quantity` immediately before `quantityUnit`.
 *  - Query builders are centralized in src/queries/product.queries.ts
 *    to keep the controller thin and testable.
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { ProductService } from '../services/product.service.js';
import {
  serializeProduct,
  serializeProducts,
} from '../serializers/product.serializer.js';
import {
  buildProductListQuery,
  buildProductFilterQuery,
} from '../queries/product.queries.js';
import type { CreateProductDTO, UpdateProductDTO } from '../types/product.js';

export class ProductController {
  // ========= CREATE =========

  /**
   * Create a product.
   *
   * @route POST /api/products
   * @param {Request} req - Express request with body {@link CreateProductDTO}.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @returns {Promise<void>} 201 Created with `{ data: { product } }`.
   *
   * @example
   * // Body
   * {
   *   "productId": "EAN:123",
   *   "productCode": "ABC-123",
   *   "productName": "Sparkling Water",
   *   "brands": "Acme",
   *   "quantity": 6,
   *   "quantityUnit": "bottles",
   *   "description": "6x500ml pack"
   * }
   *
   * @errors
   * - 400 Validation error
   * - 409 Conflict (duplicate id/code)
   * - 500 Internal error
   */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body as CreateProductDTO;
      const product = await ProductService.create(payload);
      return res
        .status(201)
        .json({ data: { product: serializeProduct(product) } });
    } catch (err) {
      return next(err);
    }
  }

  // ========= READS =========

  /**
   * Fetch a single product by ID.
   *
   * @route GET /api/products/:id
   * @param {Request} req - Express request (path param: `id`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @returns {Promise<void>} 200 OK with `{ data: { product } }`.
   *
   * @errors
   * - 404 Not Found
   * - 500 Internal error
   */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const product = await ProductService.getById(req.params.id);
      return res.json({ data: { product: serializeProduct(product) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Fetch a single product by its code.
   *
   * @route GET /api/products/by-code?productCode={code}
   * @param {Request} req - Express request (query: `productCode`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @returns {Promise<void>} 200 OK with `{ data: { product } }`.
   *
   * @errors
   * - 400 Missing/invalid `productCode`
   * - 404 Not Found
   * - 500 Internal error
   */
  static async getByCode(req: Request, res: Response, next: NextFunction) {
    try {
      const productCode = String(req.query.productCode ?? '');
      if (!productCode.trim()) {
        return res
          .status(400)
          .json({ message: 'productCode query param is required' });
      }
      const product = await ProductService.getByCode(productCode);
      return res.json({ data: { product: serializeProduct(product) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Paginated list with optional free-text `q`.
   *
   * @route GET /api/products
   * @param {Request} req - Express request (query: `q`, `page`, `pageSize`, `orderBy`, `orderDir`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @returns {Promise<void>} 200 OK with
   * `{ data: { products }, meta: { total, page, pageSize, pages } }`.
   *
   * @example
   * GET /api/products?q=water&page=1&pageSize=20&orderBy=createdAt&orderDir=DESC
   *
   * @errors
   * - 400 Invalid query
   * - 500 Internal error
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildProductListQuery(req.query as Record<string, unknown>);
      const result = await ProductService.list(query);

      return res.json({
        data: { products: serializeProducts(result.products as unknown[]) },
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
   * Advanced filter + free-text `q`.
   *
   * @route GET /api/products/filter
   * @param {Request} req - Express request (query: `filters` JSON or individual filter fields, plus `q`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @returns {Promise<void>} 200 OK with
   * `{ data: { products }, meta: { total, page, pageSize, pages } }`.
   *
   * @example
   * GET /api/products/filter?filters={"productName":["water"],"match":"startsWith"}&page=1
   *
   * @errors
   * - 400 Invalid filters
   * - 500 Internal error
   */
  static async filter(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildProductFilterQuery(
        req.query as Record<string, unknown>
      );
      const result = await ProductService.filter(query);

      return res.json({
        data: { products: serializeProducts(result.products as unknown[]) },
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

  // ========= MUTATIONS =========

  /**
   * Update product fields, returns normalized product.
   *
   * @route PATCH /api/products/:id
   * @param {Request} req - Express request (path: `id`, body: {@link UpdateProductDTO}).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @returns {Promise<void>} 200 OK with `{ data: { product } }`.
   *
   * @errors
   * - 400 Validation error
   * - 404 Not Found
   * - 409 Conflict (unique code)
   * - 500 Internal error
   */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const product = await ProductService.update(
        req.params.id,
        req.body as UpdateProductDTO
      );
      return res.json({ data: { product: serializeProduct(product) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Remove a product.
   *
   * @route DELETE /api/products/:id
   * @param {Request} req - Express request (path: `id`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @returns {Promise<void>} 200 OK with `{ data: { success: true } }`.
   *
   * @errors
   * - 404 Not Found
   * - 500 Internal error
   */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const out = await ProductService.delete(req.params.id);
      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }
}
