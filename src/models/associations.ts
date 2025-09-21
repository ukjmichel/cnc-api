// src/models/associations.ts
import { Sequelize } from 'sequelize-typescript';

// Core domain models
import { UserModel } from './user.model.js';
import { AuthorizationModel } from './authorization.model.js';

import { ProductModel } from './product.model.js';
import { ProductImageModel } from './product-image.model.js';

import { StockModel } from './stock.model.js';
import { StockMovementModel } from './stock-movement.model.js';

import { PickupSlotModel } from './pickup-slot.model.js';

import { OrderModel } from './order.model.js';
import { OrderItemModel } from './order-item.model.js';

/**
 * Register models + define associations exactly once.
 * IMPORTANT:
 *  - Do not also pass `models: []` to new Sequelize if you call this.
 *  - Remove any @HasMany/@BelongsTo decorators from model classes that
 *    duplicate what we define here (to avoid alias collisions).
 */
export function registerAssociations(sequelize: Sequelize) {
  // 1) Register all models used by the app
  sequelize.addModels([
    UserModel,
    AuthorizationModel,
    ProductModel,
    ProductImageModel,
    StockModel,
    StockMovementModel,
    PickupSlotModel,
    OrderModel,
    OrderItemModel,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Orders ↔ OrderItems                                                    */
  /* ---------------------------------------------------------------------- */
  OrderModel.hasMany(OrderItemModel, {
    foreignKey: 'orderId',
    sourceKey: 'orderId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'items',
  });

  OrderItemModel.belongsTo(OrderModel, {
    foreignKey: 'orderId',
    targetKey: 'orderId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'order',
  });

  /* ---------------------------------------------------------------------- */
  /* OrderItems ↔ Product                                                   */
  /* ---------------------------------------------------------------------- */
  ProductModel.hasMany(OrderItemModel, {
    foreignKey: 'productId',
    sourceKey: 'productId',
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'orderItems',
  });

  OrderItemModel.belongsTo(ProductModel, {
    foreignKey: 'productId',
    targetKey: 'productId',
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'product',
  });

  /* ---------------------------------------------------------------------- */
  /* PickupSlot ↔ Orders                                                    */
  /* ---------------------------------------------------------------------- */
  PickupSlotModel.hasMany(OrderModel, {
    foreignKey: 'pickupSlotId',
    sourceKey: 'slotId',
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'slotOrders', // unique alias
  });

  OrderModel.belongsTo(PickupSlotModel, {
    foreignKey: 'pickupSlotId',
    targetKey: 'slotId',
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'pickupSlot',
  });

  /* ---------------------------------------------------------------------- */
  /* Users ↔ Orders (FK on orders.userId)                                   */
  /* ---------------------------------------------------------------------- */
  // Use distinct aliases to avoid collision with *any* other 'user' alias.
  UserModel.hasMany(OrderModel, {
    foreignKey: 'userId',
    sourceKey: 'userId',
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'userOrders', // <— unique
  });

  OrderModel.belongsTo(UserModel, {
    foreignKey: 'userId',
    targetKey: 'userId',
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'orderUser', // <— unique (NOT 'user')
  });

  /* ---------------------------------------------------------------------- */
  /* OrderItems ↔ Stock                                                     */
  /* ---------------------------------------------------------------------- */
  StockModel.hasMany(OrderItemModel, {
    foreignKey: 'stockId',
    sourceKey: 'stockId',
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'orderItems', // alias for stock.orderItems
  });

  OrderItemModel.belongsTo(StockModel, {
    foreignKey: 'stockId',
    targetKey: 'stockId',
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'stock', // alias for orderItem.stock
  });
}
