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

/**
 * Parse a `variant` value from a querystring and validate it against
 * the allowed {@link PRODUCT_IMAGE_VARIANTS}.
 *
 * @param {unknown} v - Raw query value (e.g. req.query.variant).
 * @returns {ProductImageVariant | undefined} A valid variant or `undefined` if invalid/missing.
 */
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

/**
 * Rename a file on disk, avoiding collisions by appending a timestamp when needed.
 *
 * @param {string} srcAbs - Absolute source path.
 * @param {string} dstAbs - Absolute destination path.
 * @returns {Promise<string>} Final absolute path (destination or timestamp-suffixed).
 */
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

/**
 * Controller for product image endpoints.
 * Each method handles HTTP concerns and delegates business logic to the service layer.
 */
export class ProductImageController {
  /* ======================================================================== */
  /* CREATE (JSON)                                                            */
  /* ======================================================================== */

  /**
   * Create an image row directly from JSON (no file upload).
   *
   * @route POST /api/product-images
   * @auth Employee/Admin (typical)
   * @param {Request} req - Express request (body: {@link CreateProductImageDTO}).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 201 Created — `{ data: { image } }`
   * @errors 400|404|409|500
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
   * Create an image by uploading a file (multipart/form-data).
   *
   * Use with Multer middleware (e.g., `singleProductImage('image')`) on the route.
   * Expects multipart/form-data with fields:
   *  - productId (string, required)
   *  - variant (string, required — must be in PRODUCT_IMAGE_VARIANTS)
   *  - alt (string, optional)
   *  - file field name e.g. "image" (required)
   *
   * Behavior:
   *  - Renames the stored file to: `productId_variant.<ext>`
   *  - Builds a public URL relative to `UPLOADS_MOUNT`
   *  - Creates the DB row via ProductImageService
   *  - If DB write fails, deletes the just-saved file
   *
   * @route POST /api/product-images/upload
   * @auth Employee/Admin (typical)
   * @param {Request} req - Express request with `file` from Multer.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 201 Created — `{ data: { image } }`
   * @errors 400|404|409|500
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
   * Create or update by natural key `{ productId, variant }` using JSON body.
   *
   * @route PUT /api/product-images/upsert
   * @auth Employee/Admin (typical)
   * @param {Request} req - Express request (body: {@link CreateProductImageDTO}).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 200 OK — `{ data: { image } }`
   * @errors 400|404|409|500
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

  /**
   * Fetch a single image by its ID.
   *
   * @route GET /api/product-images/:id
   * @param {Request} req - Express request (path: `id`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 200 OK — `{ data: { image } }`
   * @errors 404|500
   */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const image = await ProductImageService.getById(req.params.id);
      return res.json({ data: { image: serializeProductImage(image) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Fetch an image by (productId, variant).
   *
   * @route GET /api/product-images/by-product?productId=...&variant=...
   * @param {Request} req - Express request (query: `productId`, `variant`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 200 OK — `{ data: { image } }`
   * @errors 400|404|500
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
   * Paginated list with optional free-text `q`.
   *
   * @route GET /api/product-images
   * @param {Request} req - Express request (query built by `buildProductImageListQuery`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 200 OK — `{ data: { images }, meta }`
   * @errors 400|500
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
   * Advanced filters + optional free-text `q`.
   *
   * @route GET /api/product-images/filter
   * @param {Request} req - Express request (query built by `buildProductImageFilterQuery`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 200 OK — `{ data: { images }, meta }`
   * @errors 400|500
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
   * Update fields on a product image (e.g., alt, url, variant).
   * Note: Changing variant could hit unique (productId, variant) constraint.
   *
   * @route PATCH /api/product-images/:id
   * @auth Employee/Admin (typical)
   * @param {Request} req - Express request (path: `id`, body: {@link UpdateProductImageDTO}).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 200 OK — `{ data: { image } }`
   * @errors 400|404|409|500
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
   * Delete an image by ID. If the image URL points to a local file served
   * by this API, the file is also removed (best effort).
   *
   * @route DELETE /api/product-images/:id
   * @auth Employee/Admin (typical)
   * @param {Request} req - Express request (path: `id`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 200 OK — `{ data: { success: true } }`
   * @errors 404|500
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
   * Delete a single image by `(productId, variant)`. If the URL is local,
   * the corresponding file is also deleted (best effort).
   *
   * @route DELETE /api/product-images/by-product?productId=...&variant=...
   * @auth Employee/Admin (typical)
   * @param {Request} req - Express request (query: `productId`, `variant`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 200 OK — `{ data: { success: true } }`
   * @errors 400|404|500
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
   * Delete **all** images for a product. If any URLs are local, attempt
   * to delete the files as well (best effort).
   *
   * @route DELETE /api/product-images/by-product/:productId
   * @auth Employee/Admin (typical)
   * @param {Request} req - Express request (path: `productId`).
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Express error handler.
   * @returns {Promise<void>} 200 OK — `{ data: { success: true, deleted: number } }`
   * @errors 400|404|500
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
