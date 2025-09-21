/**
 * =============================================================================
 * Stock Types — attributes, DTOs, and query types
 * =============================================================================
 * - Pure TypeScript types used across models, services, controllers, queries.
 * - Keeps the "shape" of entities and query contracts in one place.
 * =============================================================================
 */

import { Optional } from 'sequelize';

/* -------------------------------------------------------------------------- */
/* Movement reasons                                                           */
/* -------------------------------------------------------------------------- */

export const STOCK_MOVEMENT_REASONS = [
  'in', // purchase, production, return in
  'out', // sale, consumption, return out
  'adjustment', // manual correction (cycle count)
  'transfer_in', // moved from another location/zone
  'transfer_out', // moved to another location/zone
] as const;

export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/* -------------------------------------------------------------------------- */
/* Query helpers                                                              */
/* -------------------------------------------------------------------------- */

/** String matching modes for text filters. */
export type StringMatch = 'exact' | 'like' | 'startsWith' | 'endsWith';

/** Filters accepted by /api/stocks/filter */
export interface StockFilters {
  productId?: string[]; // one or many values
  location?: string[];
  zone?: (string | null)[]; // allow null by sending "" or "null"
  expirationDate?: (string | null)[];

  // numeric ranges
  quantityFrom?: number;
  quantityTo?: number;
  unitPriceFrom?: number;
  unitPriceTo?: number;

  // date ranges (ISO strings)
  createdAtFrom?: string;
  createdAtTo?: string;
  updatedAtFrom?: string;
  updatedAtTo?: string;

  match?: StringMatch; // default 'like'
}

/** List + Filter query envelope (used by service/controller) */
export interface ListStocksQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  filters?: StockFilters;
  orderBy?:
    | 'createdAt'
    | 'updatedAt'
    | 'productId'
    | 'location'
    | 'zone'
    | 'expirationDate'
    | 'quantity'
    | 'unitPrice';
  orderDir?: 'ASC' | 'DESC';
}

/* -------------------------------------------------------------------------- */
/* Entities (as returned by models/services)                                  */
/* -------------------------------------------------------------------------- */

export interface StockAttributes {
  stockId: string; // UUID PK
  productId: string; // FK -> products.productId
  quantity: number; // numeric (supports decimals)
  unitPrice: number | null; // optional: average or last price
  location: string; // warehouse/store code
  zone: string | null; // aisle/rack/bin
  expirationDate: string | null; // YYYY-MM-DD (DATEONLY)
  createdAt: Date;
  updatedAt: Date;
}

export interface StockCreationAttributes
  extends Optional<
    StockAttributes,
    | 'stockId'
    | 'unitPrice'
    | 'zone'
    | 'expirationDate'
    | 'createdAt'
    | 'updatedAt'
  > {}

export interface StockMovementAttributes {
  movementId: string; // UUID PK
  stockId: string | null; // FK -> stocks.stockId (nullable for history)
  productId: string; // denormalized for lookups
  quantityDelta: number; // positive=in, negative=out
  reason: StockMovementReason;
  reference: string | null; // PO/SO/batch note
  location: string; // snapshot at time of movement
  zone: string | null; // snapshot
  expirationDate: string | null; // snapshot YYYY-MM-DD
  unitPrice: number | null; // snapshot unit price
  performedAt: Date; // when it happened
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovementCreationAttributes
  extends Optional<
    StockMovementAttributes,
    | 'movementId'
    | 'stockId'
    | 'reference'
    | 'zone'
    | 'expirationDate'
    | 'unitPrice'
    | 'performedAt'
    | 'createdAt'
    | 'updatedAt'
  > {}
