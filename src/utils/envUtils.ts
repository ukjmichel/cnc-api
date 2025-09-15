/**
 * Env utilities for Node.js (TypeScript + ESM).
 *
 * Resolution rules for required variables:
 *  - production → look for `NAME`
 *  - development → look for `DEV__NAME`, then fallback to `NAME`
 *  - test → look for `TEST__NAME`, then fallback to `NAME`
 *
 * This lets you keep separate values per environment without multiple .env files.
 *
 * @example
 * // NODE_ENV=development
 * process.env.DEV__DB_HOST = "127.0.0.1";
 * requireEnv("DB_HOST"); // → "127.0.0.1"
 *
 * @example
 * // NODE_ENV=test
 * process.env.TEST__JWT_SECRET = "test-secret";
 * requireEnv("JWT_SECRET"); // → "test-secret"
 *
 * @example
 * // NODE_ENV=production
 * process.env.JWT_SECRET = "prod-secret";
 * requireEnv("JWT_SECRET"); // → "prod-secret"
 */

/**
 * Allowed application environments.
 */
export type AppEnv = 'production' | 'development' | 'test';

/**
 * Current application environment (defaults to `"development"`).
 */
export const NODE_ENV = (process.env.NODE_ENV ?? 'development') as AppEnv;

/**
 * Returns the env-var prefix for the given mode, or `null` if none.
 * - development → "DEV__"
 * - test → "TEST__"
 * - production → null (no prefix)
 * @internal
 */
const prefixFor = (mode: AppEnv): string | null =>
  mode === 'development' ? 'DEV__' : mode === 'test' ? 'TEST__' : null;

/**
 * Require an environment variable with mode-aware prefixes.
 *
 * Lookup order by mode:
 *  - production: `NAME`
 *  - development: `DEV__NAME`, then `NAME`
 *  - test: `TEST__NAME`, then `NAME`
 *
 * @param name - The base name of the variable (e.g., `"DB_HOST"`).
 * @returns The resolved non-empty value.
 * @throws If no value is found for the active mode.
 *
 * @example
 * requireEnv("DB_HOST");
 */
export function requireEnv(name: string): string {
  const mode = NODE_ENV;
  const candidates: string[] = [];

  const p = prefixFor(mode);
  if (p) candidates.push(p + name);
  candidates.push(name); // always allow base as fallback

  for (const key of candidates) {
    const val = process.env[key];
    if (val !== undefined && val !== '') return val;
  }

  throw new Error(
    `Missing required environment variable "${name}" for ${mode}. Tried: ${candidates.join(
      ', '
    )}`
  );
}

/**
 * Get an environment variable using the same mode-aware lookup
 * as {@link requireEnv}, but return a fallback instead of throwing.
 *
 * @param name - The base name of the variable.
 * @param fallback - Value to return when not found.
 * @returns The resolved value or the provided fallback.
 *
 * @example
 * const host = getEnv("DB_HOST", "localhost");
 */
export function getEnv(name: string, fallback?: string): string | undefined {
  try {
    return requireEnv(name);
  } catch {
    return fallback;
  }
}

/**
 * Convert a string environment value to an integer, with a default.
 *
 * @param value - The raw env value (e.g., `process.env.PORT`).
 * @param defaultValue - The number to return when `value` is empty or invalid.
 * @returns A parsed integer or `defaultValue` when parsing fails.
 *
 * @example
 * envToInt(process.env.PORT, 3000); // → 3000 if PORT is unset or not a number
 */
export function envToInt(
  value: string | undefined | null,
  defaultValue: number
): number {
  if (typeof value === 'undefined' || value === null || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return parsed;
}
