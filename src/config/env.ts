/**
 * Centralized application configuration (TypeScript + ESM).
 *
 * MODE-AWARE ENV VAR RESOLUTION (handled by `requireEnv`):
 *  - production → `NAME`
 *  - development → `DEV__NAME`, then fallback to `NAME`
 *  - test       → `TEST__NAME`, then fallback to `NAME`
 *
 * Read from this config instead of accessing `process.env` directly.
 * This keeps environment handling consistent and typed across the app.
 */
import { envToInt, requireEnv } from '../utils/envUtils.js';

/** Current runtime environment (defaults to "development" when unset). */
const NODE_ENV = process.env.NODE_ENV ?? 'development';
/** Convenience flag for test mode (used for sensible defaults like ports). */
const isTest = NODE_ENV === 'test';

/**
 * Immutable configuration object used throughout the application.
 * Prefer importing `{ config }` over reading environment variables inline.
 */
export const config = {
  // ─── Application ─────────────────────────────

  /** Effective Node environment: "production" | "development" | "test". */
  nodeEnv: NODE_ENV,

  /** Server listen port. Defaults: 3001 in test (avoid clashes), else 3000. */
  port: envToInt(process.env.PORT, isTest ? 3001 : 3000),

  /**
   * Host app port (e.g., for local reverse proxy / frontend dev server).
   * Not required for runtime, but useful when composing URLs.
   */
  hostAppPort: envToInt(process.env.HOST_APP_PORT, 3000),

  /** Base URL of this API, used in links/CORS/origin checks where needed. */
  baseUrl:
    process.env.BASE_URL ??
    `http://localhost:${envToInt(process.env.HOST_APP_PORT, 3000)}`,

  // ─── MySQL Database Configuration ────────────

  /**
   * Database host.
   * Mode-aware via `requireEnv`:
   *  - production: MYSQL_HOST
   *  - development: DEV__MYSQL_HOST (fallback MYSQL_HOST)
   *  - test: TEST__MYSQL_HOST (fallback MYSQL_HOST)
   */
  mysqlHost: requireEnv('MYSQL_HOST'),

  /** Database port (defaults to 3306). */
  mysqlPort: envToInt(process.env.MYSQL_PORT, 3306),

  /**
   * Host-exposed MySQL port (useful when running via Docker Compose).
   * Not used for app connections; mostly for tooling and local access.
   */
  hostMysqlPort: envToInt(process.env.HOST_MYSQL_PORT, 3312),

  /** Database name (mode-aware). */
  mysqlDatabase: requireEnv('MYSQL_DATABASE'),

  /** Database user (mode-aware). */
  mysqlUser: requireEnv('MYSQL_USER'),

  /** Database password (mode-aware). */
  mysqlPassword: requireEnv('MYSQL_PASSWORD'),

  /**
   * Optional root password (typically for container init scripts).
   * Not mode-aware by design; set the appropriate value per environment if needed.
   */
  mysqlRootPassword: process.env.MYSQL_ROOT_PASSWORD,

  /**
   * MySQL connection pool configuration (used by mysql2 / Sequelize).
   * You can pass these directly to your pool/ORM.
   *
   * Env vars:
   *  - MYSQL_POOL_LIMIT    (default: 10)
   *  - MYSQL_POOL_MIN      (default: 0)
   *  - MYSQL_POOL_ACQUIRE  (default: 30000 ms)
   *  - MYSQL_POOL_IDLE     (default: 10000 ms)
   */
  mysqlPool: {
    /** Maximum number of connections in the pool. */
    max: envToInt(process.env.MYSQL_POOL_LIMIT, 10),
    /** Minimum number of idle connections to keep. */
    min: envToInt(process.env.MYSQL_POOL_MIN, 0),
    /** Milliseconds to try getting a connection before timing out. */
    acquire: envToInt(process.env.MYSQL_POOL_ACQUIRE, 30_000),
    /** Milliseconds a connection can be idle before being released. */
    idle: envToInt(process.env.MYSQL_POOL_IDLE, 10_000),
  },

  // ─── JWT Auth Configuration ──────────────────

  /** Access token secret (mode-aware). */
  jwtSecret: requireEnv('JWT_SECRET'),

  /** Refresh token secret (mode-aware). */
  jwtRefreshSecret: requireEnv('JWT_REFRESH_SECRET'),

  /** Access token lifetime (e.g., "15m", "1h"). Defaults to "1h". */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',

  /** Refresh token lifetime (e.g., "7d"). Defaults to "7d". */
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
} as const;

// Export the inferred type for stronger typing elsewhere.
export type AppConfig = typeof config;
