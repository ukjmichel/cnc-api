// test-utils/mysql.ts
/**
 * Utilities for MySQL-backed integration tests.
 * - cleanAllTables(): removes rows from child → parent to satisfy FKs.
 *
 * IMPORTANT: we import using ".js" suffix so NodeNext resolution works
 * after TypeScript compilation (dist/test-utils/mysql.js → dist/src/...).
 */

import type { Transaction } from 'sequelize';

import { AuthorizationModel } from '../src/models/authorization.model.js';
import { UserModel } from '../src/models/user.model.js';

import { ProductModel } from '../src/models/product.model.js';
import { ProductImageModel } from '../src/models/product-image.model.js';

import { StockModel } from '../src/models/stock.model.js';
import { StockMovementModel } from '../src/models/stock-movement.model.js';

/**
 * Delete everything in a safe FK order.
 * Pass a Sequelize transaction when you want this to be part of a broader setup/teardown tx.
 */
export async function cleanAllTables(tx?: Transaction): Promise<void> {
  const opt = (transaction?: Transaction) =>
    transaction ? { transaction } : {};

  // Children first → parents last to honor FK constraints
  // Stock movements depend on stocks
  await StockMovementModel.destroy({ where: {}, ...opt(tx) }).catch(() => {
    /* table may not exist in some suites */
  });

  // Stocks & product images depend on products
  await StockModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});
  await ProductImageModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});

  // Authorization depends on users
  await AuthorizationModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});

  // Parents
  await ProductModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});
  await UserModel.destroy({
    where: {},
    individualHooks: true,
    ...opt(tx),
  }).catch(() => {});
}
