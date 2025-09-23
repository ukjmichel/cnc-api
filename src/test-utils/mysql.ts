// test-utils/mysql.ts
/**
 * Utilities for MySQL-backed integration tests.
 * - cleanAllTables(): removes rows from child → parent to satisfy FKs.
 *
 * IMPORTANT: we import using ".js" suffix so NodeNext resolution works
 * after TypeScript compilation (dist/test-utils/mysql.js → dist/src/...).
 */

import type { Transaction } from 'sequelize';

import { AuthorizationModel } from '../models/authorization.model.js';
import { UserModel } from '../models/user.model.js';

import { ProductModel } from '../models/product.model.js';
import { ProductImageModel } from '../models/product-image.model.js';

import { StockModel } from '../models/stock.model.js';
import { StockMovementModel } from '../models/stock-movement.model.js';

import { OrderModel } from '../models/order.model.js';
import { OrderItemModel } from '../models/order-item.model.js';
import { PickupSlotModel } from '../models/pickup-slot.model.js';

/**
 * Delete everything in a safe FK order.
 * Pass a Sequelize transaction when you want this to be part of a broader setup/teardown tx.
 */
export async function cleanAllTables(tx?: Transaction): Promise<void> {
  const opt = (transaction?: Transaction) =>
    transaction ? { transaction } : {};

  // --- Children first (deepest) ------------------------------------------------

  // Order items depend on orders and stocks
  await OrderItemModel.destroy({ where: {}, ...opt(tx) }).catch(() => {
    /* table may not exist in some suites */
  });

  // Stock movements depend on stocks/products
  await StockMovementModel.destroy({ where: {}, ...opt(tx) }).catch(() => {
    /* table may not exist in some suites */
  });

  // Orders may depend on users and pickup slots
  await OrderModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});

  // Stocks & product images depend on products
  await StockModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});
  await ProductImageModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});

  // Authorization depends on users
  await AuthorizationModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});

  // Pickup slots can be referenced by orders (parent relative to orders)
  await PickupSlotModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});

  // --- Parents last ------------------------------------------------------------

  await ProductModel.destroy({ where: {}, ...opt(tx) }).catch(() => {});

  // Users (use individualHooks in case there are model hooks)
  await UserModel.destroy({
    where: {},
    individualHooks: true,
    ...opt(tx),
  }).catch(() => {});
}
