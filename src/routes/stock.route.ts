// src/routes/stock.route.ts

/**
 * =============================================================================
 * Stock Router — REST endpoints for inventory lots & movements
 * =============================================================================
 * Mount at: /api/stocks
 *
 * Auth
 *  - POST endpoints: requireAuth + requireEmployeeOrAdmin
 *  - GET  endpoints: requireAuth (no role required)
 *
 * Validation
 *  - Uses express-validator rule sets from: src/validators/stock.validators.ts
 *
 * Endpoints
 *  - POST /adjust            → Adjust a lot (+/-) & write a movement
 *  - POST /transfer          → Transfer quantity between two lots
 *  - GET  /on-hand           → Get on-hand quantity for a specific lot
 *  - GET  /filter            → Advanced filter + q + sort + pagination
 *  - GET  /lots-of-product   → List all lots for a product (no pagination)
 *  - GET  /                  → List lots (q + sort + pagination)
 *  - POST /rebuild           → Rebuild a lot's quantity from movements
 *
 * Notes
 *  - Swagger docs live inline below each route for discoverability.
 *  - Keep route order stable; no paramized paths here that could shadow others.
 * =============================================================================
 */

import { Router } from 'express';
import { StockController } from '../controllers/stock.controller.js';
import {
  vAdjustStock,
  vTransferStock,
  vGetOnHand,
  vFilterStocks,
  vListStocks,
  vLotsOfProduct,
  vRebuildLot,
} from '../validators/stock.validators.js';

import { requireAuth } from '../middlewares/requireAuth.js';
import { requireEmployeeOrAdmin } from '../middlewares/requireRole.js';

const stockRouter = Router();

/**
 * @swagger
 * /api/stocks/adjust:
 *   post:
 *     tags: [Stocks]
 *     security: [{ bearerAuth: [] }]
 *     summary: Adjust a lot quantity (+/-) and write a movement
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdjustInput'
 *     responses:
 *       200:
 *         description: Adjustment applied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataAdjustResult'
 *       400:
 *         description: Validation error (e.g., negative not allowed)
 *       404:
 *         description: Product not found (when creating lot)
 *       500:
 *         description: Internal error
 */
stockRouter.post(
  '/adjust',
  requireAuth,
  requireEmployeeOrAdmin,
  vAdjustStock,
  StockController.adjust
);

/**
 * @swagger
 * /api/stocks/transfer:
 *   post:
 *     tags: [Stocks]
 *     security: [{ bearerAuth: [] }]
 *     summary: Transfer quantity between two lots (OUT from source, IN to destination)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransferInput'
 *     responses:
 *       200:
 *         description: Transfer completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataTransferResult'
 *       400:
 *         description: Validation error or insufficient stock
 *       404:
 *         description: Product not found (when creating lot)
 *       500:
 *         description: Internal error
 */
stockRouter.post(
  '/transfer',
  requireAuth,
  requireEmployeeOrAdmin,
  vTransferStock,
  StockController.transfer
);

/**
 * @swagger
 * /api/stocks/on-hand:
 *   get:
 *     tags: [Stocks]
 *     security: [{ bearerAuth: [] }]
 *     summary: Get on-hand quantity for a specific lot
 *     parameters:
 *       - in: query
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: location
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: zone
 *         required: false
 *         schema: { type: string, nullable: true }
 *       - in: query
 *         name: expirationDate
 *         required: false
 *         schema: { type: string, nullable: true, description: "YYYY-MM-DD or empty for null" }
 *     responses:
 *       200:
 *         description: On-hand quantity
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataOnHand'
 *       400:
 *         description: Missing required parameters
 *       500:
 *         description: Internal error
 */
stockRouter.get('/on-hand', requireAuth, vGetOnHand, StockController.getOnHand);

/**
 * @swagger
 * /api/stocks/filter:
 *   get:
 *     tags: [Stocks]
 *     security: [{ bearerAuth: [] }]
 *     summary: Advanced filter + q + sort + pagination
 *     parameters: *omitted-here-identical-to-your-previous-block*
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: Invalid filters
 *       500:
 *         description: Internal error
 */
stockRouter.get('/filter', requireAuth, vFilterStocks, StockController.filter);

/**
 * @swagger
 * /api/stocks/lots-of-product:
 *   get:
 *     tags: [Stocks]
 *     security: [{ bearerAuth: [] }]
 *     summary: Return all existing lots for a given product (no pagination)
 *     parameters:
 *       - in: query
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: Missing productId
 *       500:
 *         description: Internal error
 */
stockRouter.get(
  '/lots-of-product',
  requireAuth,
  vLotsOfProduct,
  StockController.lotsOfProduct
);

/**
 * @swagger
 * /api/stocks:
 *   get:
 *     tags: [Stocks]
 *     security: [{ bearerAuth: [] }]
 *     summary: List lots with q + sort + pagination
 *     parameters: *omitted-here-identical-to-your-previous-block*
 *     responses:
 *       200:
 *         description: OK
 *       500:
 *         description: Internal error
 */
stockRouter.get('/', requireAuth, vListStocks, StockController.list);

/**
 * @swagger
 * /api/stocks/rebuild:
 *   post:
 *     tags: [Stocks]
 *     security: [{ bearerAuth: [] }]
 *     summary: Rebuild a lot's quantity from movements
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LotKey'
 *     responses:
 *       200:
 *         description: Rebuild completed
 *       400:
 *         description: Validation error
 *       500:
 *         description: Internal error
 */
stockRouter.post(
  '/rebuild',
  requireAuth,
  requireEmployeeOrAdmin,
  vRebuildLot,
  StockController.rebuild
);

export default stockRouter;
