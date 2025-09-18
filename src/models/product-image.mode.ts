// src/models/product-image.model.ts
/**
 * Sequelize Model for Product Images (ProductImageModel).
 * - Minimal fields:
 *    • productId (FK → ProductModel.productId, string PK on Product)
 *    • url
 *    • variant (see PRODUCT_IMAGE_VARIANTS)
 *    • alt (optional, accessibility alt text)
 * - Unique (productId, variant) so you can store one image per variant per product.
 * - CASCADE on product delete/update.
 * - Normalizes url (trim), variant (lowercase), alt (trim).
 *
 * ⚠️ MySQL note: adding/removing ENUM values requires a migration (ALTER TABLE ... MODIFY COLUMN ... ENUM(...)).
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
  BeforeValidate,
} from 'sequelize-typescript';
import { ProductModel } from './product.model.js';
import {
  ProductImageAttributes,
  ProductImageCreationAttributes,
  ProductImageVariant,
} from '../types/product-image.js';

/** Central list of allowed variants (extend here when you need more). */
export const PRODUCT_IMAGE_VARIANTS = [
  // Primary / marketing
  'cover',
  'hero',
  'lifestyle',
  // Thumbnails
  'thumb_front',
  'thumb_back',
  'thumb_left',
  'thumb_right',
  // Angles & sides
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
  'angle',
  // Details
  'detail',
  'texture',
  'swatch',
  // Packaging/labels
  'packaging_front',
  'packaging_back',
  'ingredient_list',
  'nutrition_facts',
  'barcode',
  'certification',
  'allergen_label',
  // Usage / how-to
  'how_to_use',
  'preparation',
  'in_use',
  // Sizing
  'size_chart',
] as const;

@Table({
  tableName: 'product_images',
  timestamps: true,
  indexes: [
    { name: 'idx_product_images_productId', fields: ['productId'] },
    {
      name: 'uk_product_images_productId_variant',
      unique: true,
      fields: ['productId', 'variant'],
    },
  ],
})
export class ProductImageModel
  extends Model<ProductImageAttributes, ProductImageCreationAttributes>
  implements ProductImageAttributes
{
  /** Primary key (UUID v4) */
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false, unique: true })
  declare imageId: string;

  /** FK → ProductModel.productId (STRING PK) */
  @ForeignKey(() => ProductModel)
  @Column({ type: DataType.STRING(191), allowNull: false })
  declare productId: string;

  /** Image URL or storage path */
  @Column({
    type: DataType.STRING(1024),
    allowNull: false,
    validate: {
      len: {
        args: [1, 1024],
        msg: 'url must be between 1 and 1024 characters',
      },
    },
  })
  declare url: string;

  /** Image variant */
  @Column({
    type: DataType.ENUM(...(PRODUCT_IMAGE_VARIANTS as unknown as string[])),
    allowNull: false,
  })
  declare variant: ProductImageVariant;

  /** Accessibility alt text (optional) */
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare alt: string | null;

  /** Association */
  @BelongsTo(() => ProductModel, {
    foreignKey: 'productId',
    targetKey: 'productId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  declare product: ProductModel;

  /** Timestamps */
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // ----- Hooks (use @BeforeValidate; don't shadow Model.beforeValidate static) -----
  @BeforeValidate
  static normalizeFields(instance: ProductImageModel) {
    if (typeof instance.url === 'string') instance.url = instance.url.trim();
    if (typeof instance.variant === 'string') {
      instance.variant = instance.variant.toLowerCase() as ProductImageVariant;
    }
    if (typeof instance.alt === 'string') instance.alt = instance.alt.trim();
  }

  // Minimal JSON surface
  toJSON() {
    const { imageId, productId, url, variant, alt } = this.get();
    return { imageId, productId, url, variant, alt };
  }
}
