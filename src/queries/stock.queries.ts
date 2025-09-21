/**
 * =============================================================================
 * Stock Query Builders
 * =============================================================================
 * - Parse and normalize query string params into typed ListStocksQuery.
 * - Centralizes sorting whitelist, pagination defaults, and match handling.
 * =============================================================================
 */

import type {
  ListStocksQuery,
  StockFilters,
  StringMatch,
} from '../types/stock.js';
import { toInt, qsArray, qsNum, normalizeSort } from '../utils/query.js';

/** Allowed ordering fields for /api/stocks and /api/stocks/filter (readonly tuple) */
const STOCK_ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'productId',
  'location',
  'zone',
  'expirationDate',
  'quantity',
  'unitPrice',
] as const;

type Qs = Record<string, unknown>;

/** Normalize string match safely (accepts several casings) */
export function parseStringMatch(v: unknown): StringMatch {
  const s = String(v || '').toLowerCase();
  if (s === 'exact' || s === 'like') return s as StringMatch;
  if (s === 'startswith' || s === 'startsWith') return 'startsWith';
  if (s === 'endswith' || s === 'endsWith') return 'endsWith';
  return 'like';
}

/** /api/stocks — simple list with optional free-text q */
export function buildStockListQuery(qs: Qs): ListStocksQuery {
  const { page, pageSize, q, orderBy, orderDir } = qs;
  const sort = normalizeSort(
    orderBy,
    orderDir,
    STOCK_ORDER_FIELDS,
    'createdAt'
  );

  return {
    page: toInt(page, 1),
    pageSize: toInt(pageSize, 20),
    q: typeof q === 'string' ? q : undefined,
    orderBy: sort.orderBy as ListStocksQuery['orderBy'],
    orderDir: sort.orderDir,
  };
}

/** /api/stocks/filter — advanced filters + q */
export function buildStockFilterQuery(qs: Qs): ListStocksQuery {
  const { page, pageSize, q, orderBy, orderDir, match } = qs;
  const sort = normalizeSort(
    orderBy,
    orderDir,
    STOCK_ORDER_FIELDS,
    'createdAt'
  );

  let filters: StockFilters | undefined;

  // Allow ?filters=<json>
  if (typeof qs.filters === 'string' && qs.filters.trim()) {
    try {
      filters = JSON.parse(qs.filters) as StockFilters;
    } catch {
      // ignore bad JSON; fallback to individual params
    }
  }

  if (!filters) {
    const parsedMatch = parseStringMatch(match);
    filters = {
      productId: qsArray(qs.productId),
      location: qsArray(qs.location),

      // Accept "", "null" to target NULL values for zone/expirationDate
      zone: (qsArray(qs.zone) ?? [])?.map((z) =>
        z === '' || z?.toLowerCase() === 'null' ? null : z
      ),
      expirationDate: (qsArray(qs.expirationDate) ?? [])?.map((d) =>
        d === '' || d?.toLowerCase() === 'null' ? null : d
      ),

      // numeric ranges
      quantityFrom: qsNum(qs.quantityFrom),
      quantityTo: qsNum(qs.quantityTo),
      unitPriceFrom: qsNum(qs.unitPriceFrom),
      unitPriceTo: qsNum(qs.unitPriceTo),

      // date ranges
      createdAtFrom:
        typeof qs.createdAtFrom === 'string' ? qs.createdAtFrom : undefined,
      createdAtTo:
        typeof qs.createdAtTo === 'string' ? qs.createdAtTo : undefined,
      updatedAtFrom:
        typeof qs.updatedAtFrom === 'string' ? qs.updatedAtFrom : undefined,
      updatedAtTo:
        typeof qs.updatedAtTo === 'string' ? qs.updatedAtTo : undefined,

      match: parsedMatch,
    };
  } else if (!filters.match) {
    filters.match = parseStringMatch(match);
  }

  return {
    page: toInt(page, 1),
    pageSize: toInt(pageSize, 20),
    q: typeof q === 'string' ? q : undefined,
    filters,
    orderBy: sort.orderBy as ListStocksQuery['orderBy'],
    orderDir: sort.orderDir,
  };
}
