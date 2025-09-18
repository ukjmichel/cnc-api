// src/queries/product-image.queries.ts
import type {
  ListProductImagesQuery,
  ProductImageFilters,
  ProductImageVariant,
  StringMatch,
} from '../types/product-image.js';
import { PRODUCT_IMAGE_VARIANTS } from '../types/product-image.js';
import {
  toInt,
  qsArray,
  normalizeSort,
  parseStringMatch,
  type OrderDir,
} from '../utils/query.js';

const ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'productId',
  'variant',
  'url',
] as const;
type OrderByField = (typeof ORDER_FIELDS)[number];

function sanitizeVariantInFilters(filters: ProductImageFilters): void {
  const parsed = parseVariantParam((filters as any).variant);
  if (parsed === undefined) delete (filters as any).variant;
  else (filters as any).variant = parsed;
}

const ALLOWED_VARIANTS = new Set<string>(
  PRODUCT_IMAGE_VARIANTS as unknown as string[]
);
function parseVariantParam(
  v: unknown
): ProductImageVariant | ProductImageVariant[] | undefined {
  if (v == null) return undefined;
  const toV = (s: string) => s.trim().toLowerCase();

  if (Array.isArray(v)) {
    const arr = v
      .map((x) => toV(String(x)))
      .filter((x) => ALLOWED_VARIANTS.has(x));
    return arr.length ? (arr as ProductImageVariant[]) : undefined;
  }
  const one = toV(String(v));
  return ALLOWED_VARIANTS.has(one) ? (one as ProductImageVariant) : undefined;
}

export function buildProductImageListQuery(
  qs: Record<string, unknown>
): ListProductImagesQuery {
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

export function buildProductImageFilterQuery(
  qs: Record<string, unknown>
): ListProductImagesQuery {
  const { orderBy, orderDir } = normalizeSort<OrderByField>(
    qs.orderBy,
    qs.orderDir,
    ORDER_FIELDS,
    'createdAt'
  );

  let filters: ProductImageFilters | undefined;

  if (typeof qs.filters === 'string' && qs.filters.trim()) {
    try {
      filters = JSON.parse(qs.filters) as ProductImageFilters;
    } catch {
      // fall back
    }
  }

  if (!filters) {
    filters = {
      productId: qsArray(qs.productId),
      url: qsArray(qs.url),
      alt: qsArray(qs.alt),
      variant: parseVariantParam(qs.variant),
      createdAtFrom:
        typeof qs.createdAtFrom === 'string' ? qs.createdAtFrom : undefined,
      createdAtTo:
        typeof qs.createdAtTo === 'string' ? qs.createdAtTo : undefined,
      updatedAtFrom:
        typeof qs.updatedAtFrom === 'string' ? qs.updatedAtFrom : undefined,
      updatedAtTo:
        typeof qs.updatedAtTo === 'string' ? qs.updatedAtTo : undefined,
      match: parseStringMatch(qs.match) as StringMatch,
    };
  } else {
    filters.match = (filters.match ??
      parseStringMatch(qs.match)) as StringMatch;
    sanitizeVariantInFilters(filters);
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
