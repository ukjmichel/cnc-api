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
 *  - POST   /api/product-images                      → create (JSON body)
 *  - POST   /api/product-images/upload               → createWithUpload (multipart/form-data + file)
 *  - PUT    /api/product-images/upsert               → upsertVariant (create-or-update by {productId, variant})
 *  - GET    /api/product-images                      → list (q + sort + pagination)
 *  - GET    /api/product-images/filter               → filter (advanced filters + q)
 *  - GET    /api/product-images/:id                  → getById
 *  - GET    /api/product-images/by-product           → getByProductAndVariant (?productId=&variant=)
 *  - PATCH  /api/product-images/:id                  → update
 *  - DELETE /api/product-images/:id                  → remove (deletes local file if hosted here)
 *  - DELETE /api/product-images/by-product           → deleteByProductAndVariant (?productId=&variant=)
 *
 * Notes
 *  - Business logic lives in ProductImageService; this controller only wraps/normalizes responses.
 *  - Serialization is centralized in src/serializers/product-image.serializer.ts
 *    and exposes only: imageId, productId, url, variant, alt
 *  - Query builders live in src/queries/product-image.queries.ts
 *  - File/URL handling knobs come from src/config/multer.config.ts and utils/upload.ts
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs/promises';

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

import { publicUrlToAbsPathIfLocal, tryUnlink } from '../utils/upload.js';

// Filename sanitization + mount/dir knobs used to rename & expose uploads
import {
  sanitizeBaseName,
  UPLOAD_DIR,
  UPLOADS_MOUNT,
} from '../config/multer.config.js';

/* -------------------------------------------------------------------------- */
/* Helper: parse & validate ?variant=                                         */
/* -------------------------------------------------------------------------- */
function qsVariant(v: unknown): ProductImageVariant | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.toLowerCase() as ProductImageVariant;
  return (PRODUCT_IMAGE_VARIANTS as readonly string[]).includes(s)
    ? s
    : undefined;
}

/* -------------------------------------------------------------------------- */
/* Helper: safely rename file on disk; if target exists append timestamp      */
/* -------------------------------------------------------------------------- */
async function safeRename(srcAbs: string, dstAbs: string): Promise<string> {
  if (srcAbs === dstAbs) return dstAbs;
  try {
    await fs.rename(srcAbs, dstAbs);
    return dstAbs;
  } catch (err: any) {
    if (err?.code === 'EEXIST') {
      const { dir, name, ext } = path.parse(dstAbs);
      const alt = path.join(dir, `${name}-${Date.now()}${ext}`);
      await fs.rename(srcAbs, alt);
      return alt;
    }
    throw err;
  }
}

export class ProductImageController {
  /* ======================================================================== */
  /* CREATE (JSON)                                                            */
  /* ======================================================================== */

  /**
   * POST /api/product-images
   * Create an image row directly from JSON body (no file upload here).
   * Body: CreateProductImageDTO { productId, variant, url, alt? }
   */
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

  /* ======================================================================== */
  /* CREATE WITH UPLOAD (MULTIPART)                                           */
  /* ======================================================================== */

  /**
   * POST /api/product-images/upload
   *
   * Use with Multer middleware (e.g., singleProductImage('image')) on the route.
   * Expects multipart/form-data with fields:
   *  - productId (string, required)
   *  - variant (string, required — must be in PRODUCT_IMAGE_VARIANTS)
   *  - alt (string, optional)
   *  - file field name e.g. "image" (required)
   *
   * Behavior:
   *  - Renames the stored file to: productId_variant.<ext>
   *  - Builds a public URL relative to UPLOADS_MOUNT
   *  - Creates the DB row via ProductImageService
   *  - If DB write fails, deletes the just-saved file
   */
  static async createWithUpload(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      // Multer attaches the file at req.file
      const file = (req as any).file as Express.Multer.File | undefined;

      // Basic field validation
      const productId = String(req.body?.productId ?? '').trim();
      const variantRaw = req.body?.variant;
      const variant = qsVariant(variantRaw);
      const alt =
        typeof req.body?.alt === 'string' && req.body.alt.trim()
          ? req.body.alt.trim()
          : undefined;

      if (!file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      if (!productId) {
        // clean up the just-saved file if any
        await tryUnlink(
          (file as any).path || (file as any).destination,
          'product-image.controller'
        );
        return res.status(400).json({ message: 'productId is required' });
      }
      if (!variant) {
        await tryUnlink(
          (file as any).path || (file as any).destination,
          'product-image.controller'
        );
        return res.status(400).json({
          message: `variant is required and must be one of: ${PRODUCT_IMAGE_VARIANTS.join(
            ', '
          )}`,
        });
      }

      // Prepare destination & filenames:
      // Multer's disk storage gives destination + filename (random or original)
      const destAbs =
        (file as any).destination || path.dirname((file as any).path || '');
      const currentAbs = path.resolve(destAbs, file.filename);

      // Desired canonical name: productId_variant.ext (sanitized)
      const ext = (
        path.extname(file.originalname || '') || '.bin'
      ).toLowerCase();
      const base = `${sanitizeBaseName(productId)}_${sanitizeBaseName(
        variant
      )}`;
      const desiredFilename = `${base}${ext}`;
      const desiredAbs = path.resolve(destAbs, desiredFilename);

      // Rename on disk (avoids overwriting existing; appends timestamp if needed)
      const finalAbs = await safeRename(currentAbs, desiredAbs);

      // Build public URL relative to UPLOAD_DIR → exposed at UPLOADS_MOUNT
      const uploadsAbs = path.resolve(process.cwd(), UPLOAD_DIR);
      let rel = path.relative(uploadsAbs, finalAbs).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) {
        // fallback to name-only if we somehow can't compute a safe relative path
        rel = desiredFilename;
      }
      const publicUrl = `${UPLOADS_MOUNT}/${rel}`.replace(/\/{2,}/g, '/');

      // Persist DB row (if this fails, unlink the file)
      try {
        const image = await ProductImageService.create({
          productId,
          variant,
          url: publicUrl,
          alt: alt ?? null,
        });
        return res
          .status(201)
          .json({ data: { image: serializeProductImage(image) } });
      } catch (err) {
        await tryUnlink(finalAbs, 'product-image.controller');
        throw err;
      }
    } catch (err) {
      return next(err);
    }
  }

  /* ======================================================================== */
  /* UPSERT                                                                   */
  /* ======================================================================== */

  /**
   * PUT /api/product-images/upsert
   * Create or update by natural key { productId, variant } using JSON body.
   */
  static async upsertVariant(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body as CreateProductImageDTO;
      const image = await ProductImageService.upsertVariant(payload);
      return res.json({ data: { image: serializeProductImage(image) } });
    } catch (err) {
      return next(err);
    }
  }

  /* ======================================================================== */
  /* READS                                                                    */
  /* ======================================================================== */

  /** GET /api/product-images/:id — fetch by imageId */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const image = await ProductImageService.getById(req.params.id);
      return res.json({ data: { image: serializeProductImage(image) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/product-images/by-product?productId=...&variant=...
   * Fetch an image by (productId, variant).
   */
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

  /**
   * GET /api/product-images
   * Paginated list with optional free-text `q`.
   */
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

  /**
   * GET /api/product-images/filter
   * Advanced filters + optional free-text `q`.
   */
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

  /* ======================================================================== */
  /* MUTATIONS                                                                */
  /* ======================================================================== */

  /**
   * PATCH /api/product-images/:id
   * Update fields on a product image (e.g., alt, url, variant).
   * Note: Changing variant could hit unique (productId, variant) constraint.
   */
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

  /**
   * DELETE /api/product-images/:id
   * Deletes the DB row and, if the URL is served by *this* API (under UPLOADS_MOUNT),
   * also deletes the file on disk (best-effort, no throw).
   */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      // fetch existing to resolve local file path before deleting DB row
      const existing = await ProductImageService.getById(req.params.id);
      const absPath = publicUrlToAbsPathIfLocal(existing.url);

      const out = await ProductImageService.delete(req.params.id);

      // best-effort unlink (swallow ENOENT, warn otherwise)
      await tryUnlink(absPath, 'product-image.controller');

      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/product-images/by-product?productId=...&variant=...
   * Deletes by (productId, variant) and also cleans local file if hosted here.
   */
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

      // resolve the file BEFORE deleting the row
      const existing = await ProductImageService.getByProductAndVariant(
        productId,
        variant
      );
      const absPath = publicUrlToAbsPathIfLocal(existing.url);

      const out = await ProductImageService.deleteByProductAndVariant(
        productId,
        variant
      );

      // best-effort unlink
      await tryUnlink(absPath, 'product-image.controller');

      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/product-images/by-product/:productId
   * Deletes all images for a product and also removes local files (best-effort).
   */
  static async deleteAllByProduct(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const productId = String(req.params.productId ?? '').trim();
      if (!productId) {
        return res.status(400).json({ message: 'productId param is required' });
      }

      const { success, deleted, urls } =
        await ProductImageService.deleteAllByProduct(productId);

      // best-effort unlink of any locally hosted files
      await Promise.all(
        (urls || []).map((u) =>
          tryUnlink(publicUrlToAbsPathIfLocal(u), 'product-image.controller')
        )
      );

      return res.json({ data: { success, deleted } });
    } catch (err) {
      return next(err);
    }
  }
}
