// src/queries/product.queries.ts
import type {
  ListProductsQuery,
  ProductFilters,
  StringMatch,
} from '../types/product.js';
import {
  toInt,
  qsArray,
  qsNum,
  normalizeSort,
  parseStringMatch,
} from '../utils/query.js';

type Qs = Record<string, unknown>;

/** Allowed ordering fields (as const to preserve literal union) */
const ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'productCode',
  'productName',
  'brands',
  'quantity',
  'quantityUnit',
] as const;

type OrderByField = (typeof ORDER_FIELDS)[number];

/** Build ListProductsQuery for /api/products (free-text only). */
export function buildProductListQuery(qs: Qs): ListProductsQuery {
  const { orderBy, orderDir } = normalizeSort<OrderByField>(
    qs.orderBy,
    qs.orderDir,
    ORDER_FIELDS,
    'createdAt'
  );

  return {
    page: toInt(qs.page, 1),
    pageSize: toInt(qs.pageSize, 20),
    q: typeof qs.q === 'string' ? qs.q : undefined,
    orderBy,
    orderDir,
  };
}

/** Build ListProductsQuery for /api/products/filter (advanced). */
export function buildProductFilterQuery(qs: Qs): ListProductsQuery {
  const { orderBy, orderDir } = normalizeSort<OrderByField>(
    qs.orderBy,
    qs.orderDir,
    ORDER_FIELDS,
    'createdAt'
  );

  let filters: ProductFilters | undefined;

  // Allow ?filters=<json>
  if (typeof qs.filters === 'string' && qs.filters.trim()) {
    try {
      filters = JSON.parse(qs.filters) as ProductFilters;
    } catch {
      // ignore bad JSON; fallback to individual params
    }
  }

  if (!filters) {
    filters = {
      productId: qsArray(qs.productId),
      productCode: qsArray(qs.productCode),
      productName: qsArray(qs.productName),
      brands: qsArray(qs.brands),
      quantityUnit: qsArray(qs.quantityUnit),

      quantityFrom: qsNum(qs.quantityFrom),
      quantityTo: qsNum(qs.quantityTo),

      createdAtFrom:
        typeof qs.createdAtFrom === 'string' ? qs.createdAtFrom : undefined,
      createdAtTo:
        typeof qs.createdAtTo === 'string' ? qs.createdAtTo : undefined,
      updatedAtFrom:
        typeof qs.updatedAtFrom === 'string' ? qs.updatedAtFrom : undefined,
      updatedAtTo:
        typeof qs.updatedAtTo === 'string' ? qs.updatedAtTo : undefined,

      // centralized, canonical match parser
      match: parseStringMatch(qs.match) as StringMatch,
    };
  } else {
    // ensure canonical value if not set
    filters.match = (filters.match ??
      parseStringMatch(qs.match)) as StringMatch;
  }

  return {
    page: toInt(qs.page, 1),
    pageSize: toInt(qs.pageSize, 20),
    q: typeof qs.q === 'string' ? qs.q : undefined,
    filters,
    orderBy,
    orderDir,
  };
}
