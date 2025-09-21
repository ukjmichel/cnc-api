/**
 * =============================================================================
 * Product Validators — express-validator (checkSchema)
 * =============================================================================
 * Purpose
 *  - Centralized validation for Product routes.
 *  - Keeps controller logic clean and predictable.
 *
 * How to use
 *  - Attach the appropriate validator before your controller handler, e.g.:
 *      router.post('/', requireAuth, requireEmployeeOrAdmin, vCreateProduct, handleValidationErrors, ProductController.create)
 *  - Always run your validation error middleware (e.g., `handleValidationErrors`)
 *    right after the validator to return a 400 with details when invalid.
 *
 * Notes
 *  - Uses `checkSchema` for concise, declarative rules.
 *  - Trim strings and keep numeric conversions (`toInt`) where helpful.
 *  - Keep this in sync with Product service/model constraints.
 * =============================================================================
 */

import { checkSchema } from 'express-validator';

/* -----------------------------------------------------------------------------
 * Shared enums / helpers
 * -------------------------------------------------------------------------- */

/** Whitelist of sortable fields for /api/products queries. */
const PRODUCT_ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'productName',
  'productCode',
  'brands',
] as const;

type OrderBy = (typeof PRODUCT_ORDER_FIELDS)[number];

/* -----------------------------------------------------------------------------
 * Validators
 * -------------------------------------------------------------------------- */

/**
 * POST /api/products — body validator
 * Validates minimal product creation fields plus optional metadata.
 * Required: productId, productName
 */
export const vCreateProduct = checkSchema({
  productId: {
    in: ['body'],
    exists: { errorMessage: 'productId is required' },
    isString: { errorMessage: 'productId must be a string' },
    trim: true,
    notEmpty: { errorMessage: 'productId cannot be empty' },
  },
  productName: {
    in: ['body'],
    exists: { errorMessage: 'productName is required' },
    isString: { errorMessage: 'productName must be a string' },
    trim: true,
    notEmpty: { errorMessage: 'productName cannot be empty' },
  },
  productCode: {
    in: ['body'],
    optional: true,
    isString: { errorMessage: 'productCode must be a string' },
    trim: true,
  },
  brands: {
    in: ['body'],
    optional: true,
    isString: { errorMessage: 'brands must be a string' },
    trim: true,
  },
  quantity: {
    in: ['body'],
    optional: true,
    isInt: {
      options: { min: 0 },
      errorMessage: 'quantity must be an integer ≥ 0',
    },
    toInt: true,
  },
  quantityUnit: {
    in: ['body'],
    optional: true,
    isString: { errorMessage: 'quantityUnit must be a string' },
    trim: true,
  },
  description: {
    in: ['body'],
    optional: true,
    isString: { errorMessage: 'description must be a string' },
    trim: true,
  },
});

/**
 * PATCH /api/products/:id — body validator (all optional but typed)
 * Allows partial updates; strings are trimmed; quantity coerced to int.
 */
export const vUpdateProduct = checkSchema({
  productName: {
    in: ['body'],
    optional: true,
    isString: { errorMessage: 'productName must be a string' },
    trim: true,
    notEmpty: { errorMessage: 'productName cannot be empty', negated: true },
  },
  productCode: {
    in: ['body'],
    optional: true,
    isString: { errorMessage: 'productCode must be a string' },
    trim: true,
  },
  brands: {
    in: ['body'],
    optional: true,
    isString: { errorMessage: 'brands must be a string' },
    trim: true,
  },
  quantity: {
    in: ['body'],
    optional: true,
    isInt: {
      options: { min: 0 },
      errorMessage: 'quantity must be an integer ≥ 0',
    },
    toInt: true,
  },
  quantityUnit: {
    in: ['body'],
    optional: true,
    isString: { errorMessage: 'quantityUnit must be a string' },
    trim: true,
  },
  description: {
    in: ['body'],
    optional: true,
    isString: { errorMessage: 'description must be a string' },
    trim: true,
  },
});

/**
 * GET /api/products — query validator
 * Supports free-text search, pagination, and whitelist sorting.
 */
export const vListProducts = checkSchema({
  q: {
    in: ['query'],
    optional: true,
    isString: { errorMessage: 'q must be a string' },
    trim: true,
  },
  page: {
    in: ['query'],
    optional: true,
    isInt: { options: { min: 1 }, errorMessage: 'page must be ≥ 1' },
    toInt: true,
  },
  pageSize: {
    in: ['query'],
    optional: true,
    isInt: {
      options: { min: 1, max: 500 },
      errorMessage: 'pageSize must be between 1 and 500',
    },
    toInt: true,
  },
  orderBy: {
    in: ['query'],
    optional: true,
    custom: {
      options: (v) =>
        typeof v === 'string'
          ? PRODUCT_ORDER_FIELDS.includes(v as OrderBy)
          : false,
      errorMessage: `orderBy must be one of: ${PRODUCT_ORDER_FIELDS.join(
        ', '
      )}`,
    },
  },
  orderDir: {
    in: ['query'],
    optional: true,
    isIn: {
      options: [['ASC', 'DESC']],
      errorMessage: 'orderDir must be ASC or DESC',
    },
  },
});

/**
 * GET /api/products/filter — query validator
 * Adds structured `filters` (JSON string) to the standard list validators.
 */
export const vFilterProducts = checkSchema({
  q: {
    in: ['query'],
    optional: true,
    isString: { errorMessage: 'q must be a string' },
    trim: true,
  },
  filters: {
    in: ['query'],
    optional: true,
    custom: {
      options: (v) => {
        if (typeof v !== 'string') return false;
        try {
          const parsed = JSON.parse(v);
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed);
        } catch {
          return false;
        }
      },
      errorMessage: 'filters must be a JSON object (stringified)',
    },
  },
  page: {
    in: ['query'],
    optional: true,
    isInt: { options: { min: 1 }, errorMessage: 'page must be ≥ 1' },
    toInt: true,
  },
  pageSize: {
    in: ['query'],
    optional: true,
    isInt: {
      options: { min: 1, max: 500 },
      errorMessage: 'pageSize must be between 1 and 500',
    },
    toInt: true,
  },
  orderBy: {
    in: ['query'],
    optional: true,
    custom: {
      options: (v) =>
        typeof v === 'string'
          ? PRODUCT_ORDER_FIELDS.includes(v as OrderBy)
          : false,
      errorMessage: `orderBy must be one of: ${PRODUCT_ORDER_FIELDS.join(
        ', '
      )}`,
    },
  },
  orderDir: {
    in: ['query'],
    optional: true,
    isIn: {
      options: [['ASC', 'DESC']],
      errorMessage: 'orderDir must be ASC or DESC',
    },
  },
});

/**
 * GET /api/products/by-code — query validator
 * Requires a non-empty `productCode` string.
 */
export const vGetByCode = checkSchema({
  productCode: {
    in: ['query'],
    exists: { errorMessage: 'productCode is required' },
    isString: { errorMessage: 'productCode must be a string' },
    trim: true,
    notEmpty: { errorMessage: 'productCode cannot be empty' },
  },
});

/**
 * :id param validator — used by GET/PATCH/DELETE /api/products/:id
 * Treats `id` as an opaque string (not necessarily a UUID).
 */
export const vParamId = checkSchema({
  id: {
    in: ['params'],
    exists: { errorMessage: 'id is required' },
    isString: { errorMessage: 'id must be a string' },
    trim: true,
    notEmpty: { errorMessage: 'id cannot be empty' },
  },
});
