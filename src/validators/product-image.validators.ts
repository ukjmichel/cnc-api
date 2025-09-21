// src/validators/product-image.validator.ts
import { body, param, query } from 'express-validator';

/**
 * =============================================================================
 * Product Image Validators (express-validator)
 * =============================================================================
 * These validators cover all routes in `src/routes/product-image.route.ts`.
 *
 * How to use
 *  - Attach the appropriate `v*` array(s) before your controller handler.
 *  - After the validators, run your validation error middleware
 *    (e.g., `handleValidationErrors`) so any collected errors produce a 400.
 *
 * Conventions
 * - Keep requirements minimal to avoid over-constraining unknown schema fields.
 * - Require `productId` and `variant` where they act as a natural key.
 * - Accept optional presentation fields: url/imageUrl, alt, isPrimary, position.
 * - Provide conservative sort/pagination validation for list/filter endpoints.
 * - Do not perform DB lookups here; keep validators synchronous and cheap.
 * =============================================================================
 */

/* --------------------------------- Commons --------------------------------- */

/** Whitelist of sortable fields accepted by list/filter endpoints. */
const ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'productId',
  'variant',
  'position',
] as const;

/** Allowed order directions. */
const ORDER_DIRS = ['ASC', 'DESC'] as const;

/**
 * Factory for a required string `:param` path validator.
 * @param name - Path parameter name (default "id")
 */
const idParam = (name = 'id') =>
  param(name)
    .isString()
    .withMessage(`${name} must be a string`)
    .trim()
    .notEmpty()
    .withMessage(`${name} is required`);

/** Required productId in JSON body. */
const productIdBody = body('productId')
  .isString()
  .withMessage('productId must be a string')
  .trim()
  .notEmpty()
  .withMessage('productId is required');

/** Required productId in query string. */
const productIdQuery = query('productId')
  .isString()
  .withMessage('productId must be a string')
  .trim()
  .notEmpty()
  .withMessage('productId is required');

/**
 * Factory for a required `:productId` path parameter validator.
 * @param name - Param name (default "productId")
 */
const productIdParam = (name = 'productId') =>
  param(name)
    .isString()
    .withMessage(`${name} must be a string`)
    .trim()
    .notEmpty()
    .withMessage(`${name} is required`);

/** Required variant in JSON body (natural key with productId). */
const variantBodyRequired = body('variant')
  .isString()
  .withMessage('variant must be a string')
  .trim()
  .notEmpty()
  .withMessage('variant is required')
  .isLength({ max: 128 })
  .withMessage('variant must be at most 128 chars');

/** Optional variant in JSON body (for partial updates). */
const variantBodyOptional = body('variant')
  .optional()
  .isString()
  .withMessage('variant must be a string')
  .trim()
  .isLength({ max: 128 })
  .withMessage('variant must be at most 128 chars');

/** Required variant in query string. */
const variantQueryRequired = query('variant')
  .isString()
  .withMessage('variant must be a string')
  .trim()
  .notEmpty()
  .withMessage('variant is required')
  .isLength({ max: 128 })
  .withMessage('variant must be at most 128 chars');

/**
 * Optional common fields for create/update JSON bodies.
 * These are presentation-only; keep validation soft.
 */
const presentationFieldsBody = [
  body('url').optional().isString().withMessage('url must be a string').trim(),
  body('imageUrl')
    .optional()
    .isString()
    .withMessage('imageUrl must be a string')
    .trim(),
  body('alt').optional().isString().withMessage('alt must be a string').trim(),
  body('isPrimary')
    .optional()
    .isBoolean()
    .withMessage('isPrimary must be a boolean')
    .toBoolean(),
  body('position')
    .optional()
    .isInt({ min: 0 })
    .withMessage('position must be an integer >= 0')
    .toInt(),
];

/**
 * Optional body fields you may allow for JSON create/update (soft validation).
 * Includes optional productId to support reassignment if your domain allows it.
 */
const softUpdatableBodyFields = [
  ...presentationFieldsBody,
  body('productId')
    .optional()
    .isString()
    .withMessage('productId must be a string')
    .trim(),
];

/** Pagination & sorting (shared across list/filter). */
const paginationAndSortQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be >= 1')
    .toInt(),
  query('pageSize')
    .optional()
    .isInt({ min: 1 })
    .withMessage('pageSize must be >= 1')
    .toInt(),
  query('orderBy')
    .optional()
    .isIn(ORDER_FIELDS as unknown as string[])
    .withMessage(`orderBy must be one of: ${ORDER_FIELDS.join(', ')}`),
  query('orderDir')
    .optional()
    .isIn(ORDER_DIRS as unknown as string[])
    .withMessage(`orderDir must be one of: ${ORDER_DIRS.join(', ')}`),
];

/** Free-text search query param `q` (optional). */
const qQuery = [
  query('q').optional().isString().withMessage('q must be a string').trim(),
];

/* --------------------------------- Create ---------------------------------- */

/**
 * JSON create — minimally require productId (variant optional here).
 * If your domain requires variant at creation, switch to `variantBodyRequired`.
 */
export const vCreateProductImage = [
  productIdBody,
  variantBodyOptional,
  ...presentationFieldsBody,
];

/* -------------------------------- Upsert ----------------------------------- */

/**
 * Upsert by (productId, variant) — requires both keys to uniquely identify
 * the image record to insert or update.
 */
export const vUpsertProductImage = [
  productIdBody,
  variantBodyRequired,
  ...softUpdatableBodyFields,
];

/* -------------------------------- Upload ----------------------------------- */

/**
 * Upload (multipart/form-data).
 * - `singleProductImage('image')` must run before these validators to parse the file.
 * - We assert required fields and also check that `req.file` exists.
 */
export const vUploadProductImage = [
  productIdBody,
  variantBodyRequired,
  body('alt').optional().isString().withMessage('alt must be a string').trim(),
  body('position')
    .optional()
    .isInt({ min: 0 })
    .withMessage('position must be >= 0')
    .toInt(),
  body().custom((_, { req }) => {
    if (!req.file) {
      throw new Error('image file is required (field name: "image")');
    }
    return true;
  }),
];

/* --------------------------------- List ------------------------------------ */

/**
 * GET / (list) — supports:
 *  - q (free-text), pagination, sort
 *  - optional productId / variant filters
 */
export const vListProductImages = [
  ...qQuery,
  ...paginationAndSortQuery,
  query('productId')
    .optional()
    .isString()
    .withMessage('productId must be a string')
    .trim(),
  query('variant')
    .optional()
    .isString()
    .withMessage('variant must be a string')
    .trim(),
];

/* -------------------------------- Filter ----------------------------------- */

/**
 * GET /filter — same as list, plus date range filters on createdAt/updatedAt.
 */
export const vFilterProductImages = [
  ...vListProductImages,
  query('createdAtFrom')
    .optional()
    .isISO8601()
    .withMessage('createdAtFrom must be an ISO date'),
  query('createdAtTo')
    .optional()
    .isISO8601()
    .withMessage('createdAtTo must be an ISO date'),
  query('updatedAtFrom')
    .optional()
    .isISO8601()
    .withMessage('updatedAtFrom must be an ISO date'),
  query('updatedAtTo')
    .optional()
    .isISO8601()
    .withMessage('updatedAtTo must be an ISO date'),
];

/* ----------------------- By-product (public GET) --------------------------- */

/**
 * GET /by-product — public.
 * Requires both `productId` and `variant` query params.
 */
export const vGetByProductAndVariant = [productIdQuery, variantQueryRequired];

/* ----------------------- By-product (DELETE query) ------------------------- */

/**
 * DELETE /by-product — staff.
 * Requires `productId` and `variant` query params to target a single image.
 */
export const vDeleteByProductAndVariant = [
  productIdQuery,
  variantQueryRequired,
];

/* ------------------------------- Params ------------------------------------ */

/** `:id` path param validator for single-image operations. */
export const vParamImageId = [idParam('id')];

/** `:productId` path param validator for bulk delete by product. */
export const vParamProductId = [productIdParam('productId')];

/* -------------------------------- Update ----------------------------------- */

/**
 * PATCH /:id — allow soft updates of presentation fields.
 * We do not require productId/variant changes; they are optional if provided.
 */
export const vUpdateProductImage = [
  ...vParamImageId,
  variantBodyOptional,
  ...softUpdatableBodyFields,
];
