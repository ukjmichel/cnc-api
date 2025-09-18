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
   * POST /api/products
   * Create a product.
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
   * GET /api/products/:id
   * Fetch a single product by ID.
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
   * GET /api/products/by-code?productCode=...
   * Fetch a single product by its code.
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
   * GET /api/products
   * Paginated list with optional free-text `q`.
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
   * GET /api/products/filter
   * Advanced filter + free-text `q`.
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
   * PATCH /api/products/:id
   * Update product fields, returns normalized product.
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
   * DELETE /api/products/:id
   * Remove a product.
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
