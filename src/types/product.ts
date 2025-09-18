// src/types/product.ts
import type { Optional } from 'sequelize';

/**
 * Core Product types used across services/controllers.
 */

export interface ProductAttributes {
  productId: string; // STRING PK (provided by caller)
  productCode: string | null; // OPTIONAL
  productName: string;
  brands: string | null;
  quantity: number | null; // DECIMAL in DB; surfaced as number
  quantityUnit: string | null; // e.g. "g", "kg", "ml", "l", "pcs"
  description: string | null;
}

export interface ProductCreationAttributes
  extends Optional<
    ProductAttributes,
    'productCode' | 'brands' | 'quantity' | 'quantityUnit' | 'description'
  > {}

export type StringMatch = 'exact' | 'like' | 'startsWith' | 'endsWith';

export interface ProductFilters {
  /** Match single value or any-of list for string fields */
  productId?: string | string[];
  productCode?: string | string[];
  productName?: string | string[];
  brands?: string | string[];
  quantityUnit?: string | string[];

  /** Numeric range for quantity (inclusive). Null quantities are excluded. */
  quantityFrom?: number;
  quantityTo?: number;

  /** Date ranges (inclusive) */
  createdAtFrom?: string | Date;
  createdAtTo?: string | Date;
  updatedAtFrom?: string | Date;
  updatedAtTo?: string | Date;

  /** How to match string fields (default: 'like') */
  match?: StringMatch;
}

export interface CreateProductDTO {
  productId: string; // required
  productName: string; // required
  productCode?: string | null; // optional (can be omitted or null)
  brands?: string | null;
  quantity?: number | null;
  quantityUnit?: string | null;
  description?: string | null;
}

export interface UpdateProductDTO {
  productCode?: string | null; // allow clearing to null
  productName?: string;
  brands?: string | null;
  quantity?: number | null;
  quantityUnit?: string | null;
  description?: string | null;
}

export interface ListProductsQuery {
  page?: number;
  pageSize?: number;

  /** Free-text search across productCode, productName, brands, productId */
  q?: string;

  /** Field-by-field filters */
  filters?: ProductFilters;

  /** Sorting */
  orderBy?:
    | 'createdAt'
    | 'updatedAt'
    | 'productCode'
    | 'productName'
    | 'brands'
    | 'quantity'
    | 'quantityUnit';
  orderDir?: 'ASC' | 'DESC';
}
