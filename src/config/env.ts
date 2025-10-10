// src/config/env.ts

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
import type { StringValue as MsStringValue } from 'ms';

type DbSyncMode = 'none' | 'sync' | 'alter' | 'force';

/** Current runtime environment (defaults to "development" when unset). */
const NODE_ENV = process.env.NODE_ENV ?? 'development';
/** Convenience flag for test mode (used for sensible defaults like ports). */
const isTest = NODE_ENV === 'test';

/** Default DB sync per environment (safe: no sync in prod). */
const defaultDbSync: DbSyncMode = NODE_ENV !== 'production' ? 'alter' : 'none';
const DB_SYNC_ENV = (process.env.DB_SYNC ?? '').toLowerCase();
const dbSync: DbSyncMode = (
  ['none', 'sync', 'alter', 'force'] as const
).includes(DB_SYNC_ENV as any)
  ? (DB_SYNC_ENV as DbSyncMode)
  : defaultDbSync;

/**
 * Immutable configuration object used throughout the application.
 * Prefer importing `{ config }` over reading environment variables inline.
 */
export const config = {
  // ─── Application ─────────────────────────────
  nodeEnv: NODE_ENV,
  port: envToInt(process.env.PORT, isTest ? 3001 : 3000),
  hostAppPort: envToInt(process.env.HOST_APP_PORT, 3000),
  baseUrl:
    process.env.BASE_URL ??
    `http://localhost:${envToInt(process.env.HOST_APP_PORT, 3000)}`,

  // ─── MySQL Database Configuration ────────────
  mysqlHost: requireEnv('MYSQL_HOST'),
  mysqlPort: envToInt(process.env.MYSQL_PORT, 3306),
  hostMysqlPort: envToInt(process.env.HOST_MYSQL_PORT, 3312),
  mysqlDatabase: requireEnv('MYSQL_DATABASE'),
  mysqlUser: requireEnv('MYSQL_USER'),
  mysqlPassword: requireEnv('MYSQL_PASSWORD'),
  mysqlRootPassword: process.env.MYSQL_ROOT_PASSWORD,
  mysqlPool: {
    max: envToInt(process.env.MYSQL_POOL_LIMIT, 10),
    min: envToInt(process.env.MYSQL_POOL_MIN, 0),
    acquire: envToInt(process.env.MYSQL_POOL_ACQUIRE, 30_000),
    idle: envToInt(process.env.MYSQL_POOL_IDLE, 10_000),
  },

  // ─── MongoDB Configuration ───────────────────
  mongoHost: requireEnv('MONGO_HOST'),
  mongoPort: envToInt(process.env.MONGO_PORT, 27017),
  hostMongoPort: envToInt(process.env.HOST_MONGO_PORT, 27017),
  mongoDatabase: requireEnv('MONGO_DATABASE'),
  mongoUsername: requireEnv('MONGO_USERNAME'),
  mongoPassword: requireEnv('MONGO_PASSWORD'),
  mongoRootUsername: process.env.MONGO_ROOT_USERNAME,
  mongoRootPassword: process.env.MONGO_ROOT_PASSWORD,
  mongoAuthSource: process.env.MONGO_AUTH_SOURCE ?? 'admin',
  /** Optional: Full MongoDB connection URI (overrides individual params if provided). */
  mongoUri: process.env.MONGO_URI,

  // ─── JWT Auth Configuration ──────────────────
  jwtSecret: requireEnv('JWT_SECRET'),
  jwtRefreshSecret: requireEnv('JWT_REFRESH_SECRET'),
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN ?? '1h') as MsStringValue,
  jwtRefreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ??
    '7d') as MsStringValue,

  // ─── Auth Cookie Names (env-overridable) ─────
  accessCookieName: process.env.ACCESS_COOKIE ?? 'access_token',
  refreshCookieName: process.env.REFRESH_COOKIE ?? 'refresh_token',

  // ─── DB Boot Behavior ────────────────────────
  /** Control schema sync on boot: none|sync|alter|force (default: alter in dev/test, none in prod). */
  dbSync: dbSync,
  /** Log raw SQL when true. */
  dbLogSql: process.env.DB_LOG_SQL === 'true',
} as const;

// Export the inferred type for stronger typing elsewhere.
export type AppConfig = typeof config;
