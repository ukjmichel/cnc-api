// src/models/product.model.ts
/**
 * Sequelize Model for Products (ProductModel).
 * - STRING primary key (provided by caller; not UUID)
 * - productCode is OPTIONAL (kept UNIQUE when present)
 * - Normalization (trim/case for code/name/brands/unit)
 * - Numeric `quantity` stored as DECIMAL, surfaced as number
 */

import {
  Column,
  Model,
  Table,
  DataType,
  BeforeCreate,
  BeforeUpdate,
  Unique,
  Index,
} from 'sequelize-typescript';
import { ProductAttributes, ProductCreationAttributes } from '../types/product';

@Table({
  tableName: 'products',
  timestamps: true,
})
export class ProductModel
  extends Model<ProductAttributes, ProductCreationAttributes>
  implements ProductAttributes
{
  /** Primary key (STRING). Must be provided by the caller. */
  @Column({
    type: DataType.STRING(191),
    allowNull: false,
    primaryKey: true,
    unique: true,
    validate: {
      len: {
        args: [1, 191],
        msg: 'productId must be between 1 and 191 characters',
      },
      is: {
        args: /^[A-Za-z0-9._/\-]+$/u,
        msg: 'productId contains invalid characters',
      },
    },
  })
  declare productId: string;

  /** Optional unique product code (alphanumeric + separators) */
  @Unique('uk_products_code')
  @Index('idx_products_code')
  @Column({
    type: DataType.STRING(191),
    allowNull: true, // <- optional now
    validate: {
      len: {
        args: [2, 64],
        msg: 'Product code must be between 2 and 64 characters',
      },
      is: {
        args: /^[A-Za-z0-9._/\- ]+$/u,
        msg: 'Product code contains invalid characters',
      },
    },
  })
  declare productCode: string | null;

  /** Product name/title (required) */
  @Index('idx_products_name')
  @Column({
    type: DataType.STRING(255),
    allowNull: false,
    validate: {
      len: {
        args: [2, 200],
        msg: 'Product name must be between 2 and 200 characters',
      },
    },
  })
  declare productName: string;

  /** Brand(s), comma-separated if multiple */
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
    validate: {
      len: { args: [0, 255], msg: 'Brands must be at most 255 characters' },
    },
  })
  declare brands: string | null;

  /** Numeric quantity (returned as number), stored with precision */
  @Column({
    type: DataType.DECIMAL(10, 3),
    allowNull: true,
    validate: { min: { args: [0], msg: 'Quantity cannot be negative' } },
    get(this: ProductModel) {
      const raw = this.getDataValue('quantity') as unknown as string | null;
      return raw === null ? null : Number(raw);
    },
  })
  declare quantity: number | null;

  /** Unit for the quantity (e.g., g, kg, ml, l, pcs) */
  @Column({
    type: DataType.STRING(32),
    allowNull: true,
    validate: {
      len: {
        args: [1, 32],
        msg: 'Quantity unit must be between 1 and 32 characters',
      },
    },
  })
  declare quantityUnit: string | null;

  /** Long-form description */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  /** Timestamps */
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // ----- Hooks -----
  @BeforeCreate
  @BeforeUpdate
  static normalizeFields(instance: ProductModel) {
    if (
      instance.changed('productId') &&
      typeof instance.productId === 'string'
    ) {
      instance.productId = instance.productId.trim();
    }
    if (instance.changed('productCode')) {
      if (typeof instance.productCode === 'string') {
        instance.productCode = instance.productCode.trim().toUpperCase();
      }
      // leave null as-is
    }
    if (
      instance.changed('productName') &&
      typeof instance.productName === 'string'
    ) {
      instance.productName = instance.productName.trim();
    }
    if (instance.changed('brands') && typeof instance.brands === 'string') {
      instance.brands = instance.brands.trim();
    }
    if (
      instance.changed('quantityUnit') &&
      typeof instance.quantityUnit === 'string'
    ) {
      instance.quantityUnit = instance.quantityUnit.trim().toLowerCase();
    }
    if (
      instance.changed('description') &&
      typeof instance.description === 'string'
    ) {
      instance.description = instance.description.trim();
    }
  }
}
