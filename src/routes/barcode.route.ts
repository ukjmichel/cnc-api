// src/routes/barcode.routes.ts

/**
 * =============================================================================
 * Barcode Routes
 * =============================================================================
 * Endpoints for barcode lookup and product information retrieval
 * from multiple sources (OpenFoodFacts and UPCItemDB)
 * =============================================================================
 */

import { Router } from 'express';
import { BarcodeController } from '../controllers/barcode.controller.js';
import { requireEmployeeOrAdmin } from '../middlewares/requireRole.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import {
  vGetItemByCode,
  vGetBatchItems,
  vGetFoodData,
  vGetRetailData,
} from '../validators/barcode.validator.js';

const router = Router();

/**
 * @route   GET /api/barcode/:code
 * @desc    Get combined product information from both OpenFoodFacts and UPCItemDB
 * @access  Private (Employee/Admin)
 * @param   {string} code - Barcode (UPC/EAN/GTIN)
 * @returns {CombinedItemResponse} Combined product data from both sources
 */
router.get(
  '/:code',
  requireAuth,
  requireEmployeeOrAdmin,
  vGetItemByCode,
  BarcodeController.getItemByCode
);

/**
 * @route   POST /api/barcode/batch
 * @desc    Get multiple products by barcodes from both sources
 * @access  Private (Employee/Admin)
 * @body    {string[]} codes - Array of barcodes
 * @returns {items: CombinedItemResponse[], total: number, requested: number}
 */
router.post(
  '/batch',
  requireAuth,
  requireEmployeeOrAdmin,
  vGetBatchItems,
  BarcodeController.getBatchItems
);

/**
 * @route   GET /api/barcode/:code/food
 * @desc    Get product information from OpenFoodFacts only
 * @access  Private (Employee/Admin)
 * @param   {string} code - Barcode
 * @query   {string} [fields] - Comma-separated list of fields to return (optional, returns all if not specified)
 * @returns Product data with food-specific fields
 * @example /api/barcode/3017620422003/food?fields=product_name_fr,quantity,nutriments
 */
router.get(
  '/:code/food',
  requireAuth,
  requireEmployeeOrAdmin,
  vGetFoodData,
  BarcodeController.getFoodData
);

/**
 * @route   GET /api/barcode/:code/retail
 * @desc    Get product information from UPCItemDB only
 * @access  Private (Employee/Admin)
 * @param   {string} code - Barcode
 * @query   {string} [fields] - Comma-separated list of fields to return (optional, returns all if not specified)
 * @returns Product data with retail-specific fields
 * @example /api/barcode/012345678905/retail?fields=brand,description,images
 */
router.get(
  '/:code/retail',
  requireAuth,
  requireEmployeeOrAdmin,
  vGetRetailData,
  BarcodeController.getRetailData
);

export default router;
