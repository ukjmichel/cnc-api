/**
 * StockMovementModel — Immutable audit trail of stock changes.
 * Stores snapshot info (location/zone/expiry/price) at movement time.
 */

import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  Default,
  ForeignKey,
  BelongsTo,
  Index,
  BeforeValidate,
} from 'sequelize-typescript';

import {
  STOCK_MOVEMENT_REASONS,
  type StockMovementAttributes,
  type StockMovementCreationAttributes,
  type StockMovementReason,
} from '../types/stock.js';
import { StockModel } from './stock.model.js';
import { ProductModel } from './product.model.js';

@Table({
  tableName: 'stock_movements',
  timestamps: true,
  indexes: [
    { name: 'idx_movements_productId', fields: ['productId'] },
    { name: 'idx_movements_stockId', fields: ['stockId'] },
    { name: 'idx_movements_performedAt', fields: ['performedAt'] },
  ],
})
export class StockMovementModel
  extends Model<StockMovementAttributes, StockMovementCreationAttributes>
  implements StockMovementAttributes
{
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID })
  declare movementId: string;

  @ForeignKey(() => StockModel)
  @Index('idx_movements_stockId')
  @Column({ type: DataType.UUID, allowNull: true })
  declare stockId: string | null;

  @ForeignKey(() => ProductModel)
  @Index('idx_movements_productId')
  @Column({ type: DataType.STRING(191), allowNull: false })
  declare productId: string;

  @Column({ type: DataType.DECIMAL(12, 3), allowNull: false })
  declare quantityDelta: number; // positive=in, negative=out

  @Column({
    type: DataType.ENUM(...(STOCK_MOVEMENT_REASONS as unknown as string[])),
    allowNull: false,
  })
  declare reason: StockMovementReason;

  @Column({ type: DataType.STRING(191), allowNull: true })
  declare reference: string | null;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare location: string;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare zone: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare expirationDate: string | null;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  declare unitPrice: number | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  declare performedAt: Date;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  /** Associations */
  @BelongsTo(() => StockModel, {
    foreignKey: 'stockId',
    targetKey: 'stockId',
    onDelete: 'SET NULL',
  })
  declare stock: StockModel | null;

  @BelongsTo(() => ProductModel, {
    foreignKey: 'productId',
    targetKey: 'productId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  declare product: ProductModel;

  @BeforeValidate
  static normalize(instance: StockMovementModel) {
    instance.location = (instance.location || '').trim();
    instance.zone = instance.zone ? instance.zone.trim() : null;
    instance.reference = instance.reference ? instance.reference.trim() : null;
  }

  toJSON() {
    const {
      movementId,
      stockId,
      productId,
      quantityDelta,
      reason,
      reference,
      location,
      zone,
      expirationDate,
      unitPrice,
      performedAt,
      createdAt,
      updatedAt,
    } = this.get();
    return {
      movementId,
      stockId,
      productId,
      quantityDelta,
      reason,
      reference,
      location,
      zone,
      expirationDate,
      unitPrice,
      performedAt,
      createdAt,
      updatedAt,
    };
  }
}
