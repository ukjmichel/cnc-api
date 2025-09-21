import path from 'path';
import fs from 'fs/promises';

/** Public mount where uploads are served (e.g., `/uploads`) */
export const UPLOADS_MOUNT =
  (process.env.UPLOADS_MOUNT || '/uploads').replace(/\/+$/, '') || '/uploads';

/** Absolute directory on disk where uploads are stored (e.g., `<project>/uploads`) */
export const UPLOADS_DIR_ABS = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || 'uploads'
);

/**
 * If the URL is served by our API (begins with UPLOADS_MOUNT), convert it
 * to an absolute file path inside UPLOADS_DIR_ABS. Returns null otherwise.
 */
export function publicUrlToAbsPathIfLocal(url: string): string | null {
  try {
    // ignore external URLs
    if (/^https?:\/\//i.test(url)) return null;

    // must begin with our mount
    if (!url.startsWith(UPLOADS_MOUNT)) return null;

    // derive relative path under uploads
    const rel = url.slice(UPLOADS_MOUNT.length).replace(/^\/+/, '');
    // build absolute and ensure it remains within uploads dir
    const abs = path.resolve(UPLOADS_DIR_ABS, rel);
    if (!abs.startsWith(UPLOADS_DIR_ABS)) return null; // guard traversal
    return abs;
  } catch {
    return null;
  }
}

/**
 * Best-effort unlink (no-throw).
 * Logs a warning for errors other than ENOENT.
 */
export async function tryUnlink(absPath: string | null, label = 'uploads') {
  if (!absPath) return;
  try {
    await fs.unlink(absPath);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(`[${label}] unlink failed:`, absPath, err);
    }
  }
}
