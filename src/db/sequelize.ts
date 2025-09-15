// src/db/sequelize.ts
/**
 * Sequelize bootstrap & DB utilities.
 * - Uses centralized config + sequelizeOptions
 * - Provides init (connect), ping (health), close (shutdown), and signal hooks
 */
import { Sequelize } from 'sequelize';
import { sequelizeOptions } from '../config/sequelize.config.js';

export const sequelize = new Sequelize(sequelizeOptions);

/** Connect and verify the DB (fails fast on startup if unreachable). */
export async function initDb(): Promise<void> {
  await sequelize.authenticate();
  // Optionally: await sequelize.sync(); // if you use sync in dev
  console.log('✅ Sequelize connected');
}

/** Health check (throws on failure). */
export async function pingDb(): Promise<void> {
  await sequelize.authenticate();
  // Or: await sequelize.query('SELECT 1');
}

/** Gracefully close the Sequelize connection pool. */
export async function closeDb(): Promise<void> {
  await sequelize.close();
}

/** Register SIGINT/SIGTERM hooks for graceful shutdown. */
export function registerDbShutdown(): void {
  const handler = async () => {
    try {
      await closeDb();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
}
