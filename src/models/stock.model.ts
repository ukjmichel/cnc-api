/**
 * StockModel — Lot/location-level inventory for a product.
 * Unique per (productId, location, zone, expirationDate).
 */

import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  Default,
  Index,
  Unique,
  ForeignKey,
  BelongsTo,
  HasMany,
  BeforeValidate,
} from 'sequelize-typescript';

import type {
  StockAttributes,
  StockCreationAttributes,
} from '../types/stock.js';
import { ProductModel } from './product.model.js';
import { StockMovementModel } from './stock-movement.model.js';

@Table({
  tableName: 'stocks',
  timestamps: true,
  indexes: [
    { name: 'idx_stocks_productId', fields: ['productId'] },
    { name: 'idx_stocks_expirationDate', fields: ['expirationDate'] },
  ],
})
export class StockModel
  extends Model<StockAttributes, StockCreationAttributes>
  implements StockAttributes
{
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID })
  declare stockId: string;

  @ForeignKey(() => ProductModel)
  @Index('idx_stocks_productId')
  @Column({ type: DataType.STRING(191), allowNull: false })
  declare productId: string;

  @Column({
    type: DataType.DECIMAL(12, 3), // supports fractional units (kg, L)
    allowNull: false,
    defaultValue: 0,
  })
  declare quantity: number;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  declare unitPrice: number | null;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare location: string;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare zone: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare expirationDate: string | null;

  // Natural-unique lot key
  @Unique('uk_stock_natural')
  @Column({ type: DataType.STRING(191), allowNull: false })
  private declare _uk_productId: string; // virtual column to bind composite unique

  @Unique('uk_stock_natural')
  @Column({ type: DataType.STRING(100), allowNull: false })
  private declare _uk_location: string;

  @Unique('uk_stock_natural')
  @Column({ type: DataType.STRING(100), allowNull: true })
  private declare _uk_zone: string | null;

  @Unique('uk_stock_natural')
  @Column({ type: DataType.DATEONLY, allowNull: true })
  private declare _uk_expirationDate: string | null;

  /** Associations */
  @BelongsTo(() => ProductModel, {
    foreignKey: 'productId',
    targetKey: 'productId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  declare product: ProductModel;

  @HasMany(() => StockMovementModel, {
    foreignKey: 'stockId',
    sourceKey: 'stockId',
  })
  declare movements: StockMovementModel[];

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  @BeforeValidate
  static normalize(instance: StockModel) {
    instance.location = (instance.location || '').trim();
    instance.zone = instance.zone ? instance.zone.trim() : null;

    // Keep composite-unique shadow columns in sync
    instance._uk_productId = instance.productId;
    instance._uk_location = instance.location;
    instance._uk_zone = instance.zone;
    instance._uk_expirationDate = instance.expirationDate;
  }

  toJSON() {
    const {
      stockId,
      productId,
      quantity,
      unitPrice,
      location,
      zone,
      expirationDate,
      createdAt,
      updatedAt,
    } = this.get();
    return {
      stockId,
      productId,
      quantity,
      unitPrice,
      location,
      zone,
      expirationDate,
      createdAt,
      updatedAt,
    };
  }
}
