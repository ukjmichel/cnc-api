/**
 * =============================================================================
 * ProductImageUploadService — Bridge between Multer uploads and DB writes
 * =============================================================================
 * What this service does
 *  - Converts a Multer file (already stored on disk by config/multer.config.ts)
 *    into a public URL based on your static /uploads mount.
 *  - Calls the domain service (ProductImageService) to create / upsert rows.
 *
 * What it DOESN'T do
 *  - It does NOT configure Multer (that lives in config/multer.config.ts).
 *  - It does NOT mount static or Express routes (keep that in app/router).
 *
 * Env knobs
 *  - UPLOADS_MOUNT (default: "/uploads")  -> the public mount path you expose in app.ts
 *  - UPLOAD_DIR     (default: "uploads")   -> the root folder you serve statically
 *    (these should align with your config/multer.config.ts + app.ts static mount)
 * =============================================================================
 */

import path from 'path';
import type { Express } from 'express';
import { BadRequestError } from '../errors/BadRequestError.js';
import { ProductImageService } from './product-image.service.js';
import type { CreateProductImageDTO } from '../types/product-image.js';

const UPLOADS_MOUNT =
  (process.env.UPLOADS_MOUNT || '/uploads').replace(/\/+$/, '') || '/uploads';
const UPLOADS_DIR_ABS = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || 'uploads'
);

function assertFile(
  file?: Express.Multer.File
): asserts file is Express.Multer.File {
  if (!file) throw new BadRequestError('No file uploaded');
  if (!file.filename)
    throw new BadRequestError('Uploaded file is missing a target filename');
}

/**
 * Build a public URL for a Multer-stored file.
 * Assumes your app exposes:  app.use('/uploads', express.static(path.resolve('uploads')))
 */
export function fileToPublicUrl(file: Express.Multer.File): string {
  // Multer with diskStorage gives us destination + filename
  const dest =
    (file as any).destination || path.dirname((file as any).path || '');
  const absPath = path.resolve(dest, file.filename);

  // Compute relative path under the UPLOADS_DIR
  let rel = path.relative(UPLOADS_DIR_ABS, absPath).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) {
    // Fallback: just expose the filename at the root if relative calc failed
    rel = file.filename;
  }
  return `${UPLOADS_MOUNT}/${rel}`;
}

/**
 * Create a ProductImage row from an uploaded file.
 * Expects the DB constraints (FK + unique (productId, variant)) to be enforced downstream.
 */
export class ProductImageUploadService {
  /**
   * Create from upload.
   * @param input  Minimal DTO (productId, variant, optional alt)
   * @param file   Multer file (already saved by diskStorage)
   */
  static async createFromUpload(
    input: Pick<CreateProductImageDTO, 'productId' | 'variant'> & {
      alt?: string | null;
    },
    file?: Express.Multer.File
  ) {
    assertFile(file);
    const url = fileToPublicUrl(file);
    const alt =
      input.alt ??
      (file.originalname ? path.parse(file.originalname).name : null);

    return ProductImageService.create({
      productId: input.productId,
      variant: input.variant,
      url,
      alt: alt ?? null,
    });
  }

  /**
   * Upsert (create or update) by natural key {productId, variant}.
   * Useful for “cover image” updates, etc.
   */
  static async upsertFromUpload(
    input: Pick<CreateProductImageDTO, 'productId' | 'variant'> & {
      alt?: string | null;
    },
    file?: Express.Multer.File
  ) {
    assertFile(file);
    const url = fileToPublicUrl(file);
    const alt =
      input.alt ??
      (file.originalname ? path.parse(file.originalname).name : null);

    return ProductImageService.upsertVariant({
      productId: input.productId,
      variant: input.variant,
      url,
      alt: alt ?? null,
    });
  }
}
