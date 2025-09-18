// src/controllers/product-image.controller.ts

/**
 * =============================================================================
 * ProductImageController — HTTP layer for product images
 * =============================================================================
 * Response shape (normalized)
 *  - Single entity:        { data: { image } }
 *  - Collections (list):   { data: { images }, meta: { total, page, pageSize, pages } }
 *  - Utility/success-only: { data: { success: true } }
 *
 * Endpoints
 *  - POST   /api/product-images                      → create
 *  - PUT    /api/product-images/upsert               → upsertVariant (create-or-update by {productId, variant})
 *  - GET    /api/product-images                      → list (q + sort + pagination)
 *  - GET    /api/product-images/filter               → filter (advanced filters + q)
 *  - GET    /api/product-images/:id                  → getById
 *  - GET    /api/product-images/by-product           → getByProductAndVariant (?productId=&variant=)
 *  - PATCH  /api/product-images/:id                  → update
 *  - DELETE /api/product-images/:id                  → remove
 *  - DELETE /api/product-images/by-product           → deleteByProductAndVariant (?productId=&variant=)
 *
 * Notes
 *  - Business logic lives in ProductImageService; this controller only wraps/normalizes responses.
 *  - Serialization is centralized in src/serializers/product-image.serializer.ts
 *    and exposes only: imageId, productId, url, variant, alt
 *  - Query builders live in src/queries/product-image.queries.ts
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { ProductImageService } from '../services/product-image.service.js';

import {
  buildProductImageFilterQuery,
  buildProductImageListQuery,
} from '../queries/product-image.queries.js';

import type {
  CreateProductImageDTO,
  UpdateProductImageDTO,
  ProductImageVariant,
} from '../types/product-image.js';
import { PRODUCT_IMAGE_VARIANTS } from '../types/product-image.js';
import {
  serializeProductImage,
  serializeProductImages,
} from '../serializers/product-image.serializer.js';

// ---- helpers ----
function qsVariant(v: unknown): ProductImageVariant | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.toLowerCase() as ProductImageVariant;
  return (PRODUCT_IMAGE_VARIANTS as readonly string[]).includes(s)
    ? s
    : undefined;
}

export class ProductImageController {
  // ========= CREATE / UPSERT =========

  /** POST /api/product-images */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body as CreateProductImageDTO;
      const image = await ProductImageService.create(payload);
      return res
        .status(201)
        .json({ data: { image: serializeProductImage(image) } });
    } catch (err) {
      return next(err);
    }
  }

  /** PUT /api/product-images/upsert */
  static async upsertVariant(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body as CreateProductImageDTO;
      const image = await ProductImageService.upsertVariant(payload);
      return res.json({ data: { image: serializeProductImage(image) } });
    } catch (err) {
      return next(err);
    }
  }

  // ========= READS =========

  /** GET /api/product-images/:id */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const image = await ProductImageService.getById(req.params.id);
      return res.json({ data: { image: serializeProductImage(image) } });
    } catch (err) {
      return next(err);
    }
  }

  /** GET /api/product-images/by-product?productId=...&variant=... */
  static async getByProductAndVariant(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const productId = String(req.query.productId ?? '').trim();
      const variant = qsVariant(req.query.variant);

      if (!productId) {
        return res
          .status(400)
          .json({ message: 'productId query param is required' });
      }
      if (!variant) {
        return res.status(400).json({
          message: `variant query param is required and must be one of: ${PRODUCT_IMAGE_VARIANTS.join(
            ', '
          )}`,
        });
      }

      const image = await ProductImageService.getByProductAndVariant(
        productId,
        variant
      );
      return res.json({ data: { image: serializeProductImage(image) } });
    } catch (err) {
      return next(err);
    }
  }

  /** GET /api/product-images */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildProductImageListQuery(
        req.query as Record<string, unknown>
      );
      const result = await ProductImageService.list(query);

      return res.json({
        data: { images: serializeProductImages(result.images as unknown[]) },
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

  /** GET /api/product-images/filter */
  static async filter(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildProductImageFilterQuery(
        req.query as Record<string, unknown>
      );
      const result = await ProductImageService.filter(query);

      return res.json({
        data: { images: serializeProductImages(result.images as unknown[]) },
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

  /** PATCH /api/product-images/:id */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const image = await ProductImageService.update(
        req.params.id,
        req.body as UpdateProductImageDTO
      );
      return res.json({ data: { image: serializeProductImage(image) } });
    } catch (err) {
      return next(err);
    }
  }

  /** DELETE /api/product-images/:id */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const out = await ProductImageService.delete(req.params.id);
      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }

  /** DELETE /api/product-images/by-product?productId=...&variant=... */
  static async deleteByProductAndVariant(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const productId = String(req.query.productId ?? '').trim();
      const variant = qsVariant(req.query.variant);

      if (!productId) {
        return res
          .status(400)
          .json({ message: 'productId query param is required' });
      }
      if (!variant) {
        return res.status(400).json({
          message: `variant query param is required and must be one of: ${PRODUCT_IMAGE_VARIANTS.join(
            ', '
          )}`,
        });
      }

      const out = await ProductImageService.deleteByProductAndVariant(
        productId,
        variant
      );
      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }
}
