// src/config/multer.config.ts
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import type { Request, Express } from 'express';

/** Ensure we can safely access req.body in filename builder */
type ReqWithBody = Request & { body: Record<string, unknown> };

/** Direction type for consumers; tweak as you like */
export interface MulterConfigOptions {
  /** Disk destination (relative to project root or absolute). */
  dest?: string;
  /** Max file size in MB. */
  maxFileSizeMB?: number;
  /** Allowed mime types. */
  allowedMimeTypes?: readonly string[];
  /** Use sanitized original base name (true) or generated id (false). */
  useOriginalName?: boolean;
  /**
   * Optional custom filename builder. If provided, it fully controls the stored filename.
   * Must return a base filename (with extension).
   */
  buildFilename?: (req: ReqWithBody, file: Express.Multer.File) => string;
}

const DEFAULTS = {
  dest: 'uploads/images',
  maxFileSizeMB: 10,
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
  ] as const,
  useOriginalName: false,
} as const;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Safe-ish filename base (no path traversal, no fancy chars). */
export function sanitizeBaseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-') // keep letters, numbers, _ and -
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}

/** Factory that returns a ready-to-use multer instance + bits if you need them. */
export function createMulterConfig(options: MulterConfigOptions = {}) {
  const cfg = {
    ...DEFAULTS,
    ...options,
    // env overrides without forcing them:
    dest: options.dest ?? process.env.UPLOAD_DIR ?? DEFAULTS.dest,
    maxFileSizeMB:
      options.maxFileSizeMB ??
      Number(process.env.UPLOAD_MAX_MB || DEFAULTS.maxFileSizeMB),
    allowedMimeTypes:
      options.allowedMimeTypes ??
      (process.env.UPLOAD_MIME?.split(',').map((s) => s.trim()) as
        | string[]
        | undefined) ??
      DEFAULTS.allowedMimeTypes,
  };

  const destAbs = path.isAbsolute(cfg.dest)
    ? cfg.dest
    : path.resolve(process.cwd(), cfg.dest);
  ensureDir(destAbs);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destAbs),
    filename: (req: ReqWithBody, file, cb) => {
      try {
        if (cfg.buildFilename) {
          return cb(null, cfg.buildFilename(req, file));
        }
        const ext = (
          path.extname(file.originalname || '') || '.bin'
        ).toLowerCase();
        const base = cfg.useOriginalName
          ? sanitizeBaseName(path.basename(file.originalname || 'file', ext))
          : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        return cb(null, `${base}${ext}`);
      } catch (e) {
        return cb(e as Error, '');
      }
    },
  });

  const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
    if ((cfg.allowedMimeTypes as readonly string[]).includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error(`Invalid mime type: ${file.mimetype}`));
  };

  const limits: multer.Options['limits'] = {
    fileSize: cfg.maxFileSizeMB * 1024 * 1024,
  };

  const instance = multer({ storage, fileFilter, limits });
  return { instance, storage, fileFilter, limits, cfg, destAbs };
}

/* -------------------------------------------------------------------------- */
/* Constants used by services/utils (public URL mount + absolute dirs)        */
/* -------------------------------------------------------------------------- */

/** Public mount served by Express static (used to build public URLs) */
export const UPLOADS_MOUNT =
  (process.env.UPLOADS_MOUNT || '/uploads').replace(/\/+$/, '') || '/uploads';

/** Base uploads dir on disk (can be absolute) */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

/** Absolute dir for product images on disk (./uploads/products by default) */
export const PRODUCTS_DIR_ABS = path.resolve(
  process.cwd(),
  UPLOAD_DIR,
  'products'
);

/* -------------------------------------------------------------------------- */
/* Ready-made multer instances                                                */
/* -------------------------------------------------------------------------- */

/** Generic images uploader (./uploads/images by default) */
export const imageMulter = createMulterConfig().instance;

/** Product images uploader (saves to ./uploads/products, custom filename) */
const _productCfg = createMulterConfig({
  dest: path.join(UPLOAD_DIR, 'products'),
  allowedMimeTypes: DEFAULTS.allowedMimeTypes as readonly string[],
  maxFileSizeMB: Number(process.env.UPLOAD_MAX_MB || DEFAULTS.maxFileSizeMB),
  useOriginalName: false,
  buildFilename: (req: ReqWithBody, file: Express.Multer.File) => {
    const ext = (path.extname(file.originalname || '') || '.bin').toLowerCase();
    const productId = sanitizeBaseName(
      String(req.body?.productId ?? 'product')
    );
    const variant = sanitizeBaseName(String(req.body?.variant ?? 'image'));
    const ts = Date.now();
    const rnd = Math.round(Math.random() * 1e6);
    return `${productId}-${variant}-${ts}-${rnd}${ext}`;
  },
});
export const productImageUpload = _productCfg.instance;
/** Re-export absolute dir for deletion helpers */
export const productUploadAbsDir = _productCfg.destAbs;

/* Convenience wrappers */
export const singleImage = (field = 'image') => imageMulter.single(field);
export const multipleImages = (field = 'images', max = 6) =>
  imageMulter.array(field, max);
export const fieldsImages = (fields: multer.Field[]) =>
  imageMulter.fields(fields);

/** Product-specific convenience */
export const singleProductImage = (field = 'image') =>
  productImageUpload.single(field);
