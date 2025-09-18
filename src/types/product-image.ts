// src/types/product-image.ts
import type { Optional } from 'sequelize';

/**
 * Central list of allowed variants (extend here when you need more).
 * ⚠️ If you use ENUM in MySQL, adding/removing values requires a migration.
 */
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

export type ProductImageVariant = (typeof PRODUCT_IMAGE_VARIANTS)[number];

/** String matching modes for text filters. */
export type StringMatch = 'exact' | 'like' | 'startsWith' | 'endsWith';

/** Core attributes persisted in DB. */
export interface ProductImageAttributes {
  imageId: string; // UUID v4 (PK)
  productId: string; // FK to products.productId (STRING PK on Product)
  url: string; // absolute or relative path
  variant: ProductImageVariant; // one of PRODUCT_IMAGE_VARIANTS
  alt: string | null; // optional accessibility text
}

/** Creation payload accepted by Sequelize. */
export interface ProductImageCreationAttributes
  extends Optional<ProductImageAttributes, 'imageId' | 'alt'> {}

/** DTOs used by controllers/services */
export interface CreateProductImageDTO {
  productId: string;
  url: string;
  variant: ProductImageVariant;
  alt?: string | null;
}

export interface UpdateProductImageDTO {
  url?: string;
  variant?: ProductImageVariant;
  alt?: string | null;
}

/** Filters for /filter endpoint (and service filter()). */
export interface ProductImageFilters {
  productId?: string | string[];
  url?: string | string[];
  alt?: string | string[];
  variant?: ProductImageVariant | ProductImageVariant[];

  // date ranges (inclusive)
  createdAtFrom?: string | Date;
  createdAtTo?: string | Date;
  updatedAtFrom?: string | Date;
  updatedAtTo?: string | Date;

  // how to match string fields (default: 'like')
  match?: StringMatch;
}

/** Query shape for list/filter endpoints. */
export interface ListProductImagesQuery {
  page?: number;
  pageSize?: number;

  /** Free-text search across url, alt, productId */
  q?: string;

  /** Field-by-field filters */
  filters?: ProductImageFilters;

  /** Sorting */
  orderBy?: 'createdAt' | 'updatedAt' | 'productId' | 'variant' | 'url' | 'alt';
  orderDir?: 'ASC' | 'DESC';
}
