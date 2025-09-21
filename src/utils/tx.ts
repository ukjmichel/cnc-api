// src/utils/tx.ts
import type { Transaction, TransactionOptions } from 'sequelize';
import { sequelize } from '../db/sequelize.js';

/**
 * Run a function inside a transaction and auto-commit/rollback.
 * Usage: withTransaction(async (t) => { ... })
 */
export async function withTransaction<T>(
  work: (t: Transaction) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  if (options) return sequelize.transaction(options, (t) => work(t));
  return sequelize.transaction((t) => work(t));
}
