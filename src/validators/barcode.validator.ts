// src/validators/barcode.validator.ts

import { body, param, query } from 'express-validator';

/**
 * =============================================================================
 * Barcode Validators – express-validator chains for Barcode routes
 * =============================================================================
 * What this file provides
 *  - Reusable validation chains for barcode lookup routes
 *  - Validates barcodes (UPC/EAN/GTIN codes)
 *  - Validates field selection for API responses
 *
 * How to use
 *  - Attach one (or more) of these arrays before your controller handler
 *  - Use with middleware that collects and formats validation errors
 *
 * Notes
 *  - Barcodes are typically 8-14 digits (EAN-8, UPC-A, EAN-13, etc.)
 *  - Fields can be comma-separated strings or arrays
 * =============================================================================
 */

/**
 * Validate barcode format.
 * Most common formats: EAN-8 (8), UPC-A (12), EAN-13 (13), ITF-14 (14)
 * Also accepts alphanumeric for special cases (ISBN, etc.)
 */
const isBarcodeFormat = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  // Allow 6-14 characters, alphanumeric (covers most barcode formats)
  return /^[A-Z0-9]{6,14}$/i.test(trimmed);
};

/* ============================================================================
 * GET /api/barcode/:code – Get combined data from both sources
 * ==========================================================================*/
/**
 * Validate single barcode lookup by code.
 * - code: required path param, must be valid barcode format
 */
export const vGetItemByCode = [
  param('code')
    .isString()
    .withMessage('code must be a string')
    .bail()
    .notEmpty()
    .withMessage('code is required')
    .bail()
    .custom(isBarcodeFormat)
    .withMessage('code must be a valid barcode (6-14 alphanumeric characters)'),
];

/* ============================================================================
 * POST /api/barcode/batch – Get multiple products by barcodes
 * ==========================================================================*/
/**
 * Validate batch barcode lookup.
 * - codes: required array in body, must contain valid barcodes
 */
export const vGetBatchItems = [
  body('codes')
    .exists({ checkNull: false })
    .withMessage('codes is required')
    .bail()
    .isArray({ min: 1 })
    .withMessage('codes must be a non-empty array')
    .bail()
    .custom((arr: unknown[]) => {
      return arr.every(
        (item) => typeof item === 'string' && item.trim().length > 0
      );
    })
    .withMessage('all codes must be non-empty strings')
    .bail()
    .custom((arr: string[]) => {
      return arr.every((item) => isBarcodeFormat(item));
    })
    .withMessage(
      'all codes must be valid barcodes (6-14 alphanumeric characters)'
    ),
];

/* ============================================================================
 * GET /api/barcode/:code/food – Get OpenFoodFacts data only
 * ==========================================================================*/
/**
 * Validate OpenFoodFacts barcode lookup.
 * - code: required path param, must be valid barcode format
 * - fields: optional query param, comma-separated field names
 */
export const vGetFoodData = [
  param('code')
    .isString()
    .withMessage('code must be a string')
    .bail()
    .notEmpty()
    .withMessage('code is required')
    .bail()
    .custom(isBarcodeFormat)
    .withMessage('code must be a valid barcode (6-14 alphanumeric characters)'),

  query('fields')
    .optional({ values: 'falsy' })
    .custom((value) => {
      if (typeof value === 'string') {
        // Check comma-separated string
        const fields = value.split(',').map((f) => f.trim());
        return fields.every((f) => f.length > 0);
      }
      if (Array.isArray(value)) {
        // Check array format
        return value.every((f) => typeof f === 'string' && f.trim().length > 0);
      }
      return false;
    })
    .withMessage(
      'fields must be a comma-separated string or array of field names'
    ),
];

/* ============================================================================
 * GET /api/barcode/:code/retail – Get UPCItemDB data only
 * ==========================================================================*/
/**
 * Validate UPCItemDB barcode lookup.
 * - code: required path param, must be valid barcode format
 * - fields: optional query param, comma-separated field names
 */
export const vGetRetailData = [
  param('code')
    .isString()
    .withMessage('code must be a string')
    .bail()
    .notEmpty()
    .withMessage('code is required')
    .bail()
    .custom(isBarcodeFormat)
    .withMessage('code must be a valid barcode (6-14 alphanumeric characters)'),

  query('fields')
    .optional({ values: 'falsy' })
    .custom((value) => {
      if (typeof value === 'string') {
        // Check comma-separated string
        const fields = value.split(',').map((f) => f.trim());
        return fields.every((f) => f.length > 0);
      }
      if (Array.isArray(value)) {
        // Check array format
        return value.every((f) => typeof f === 'string' && f.trim().length > 0);
      }
      return false;
    })
    .withMessage(
      'fields must be a comma-separated string or array of field names'
    ),
];
