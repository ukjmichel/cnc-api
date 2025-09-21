// src/routes/stock.route.ts

/**
 * =============================================================================
 * Stock Router — REST endpoints for inventory lots & movements
 * =============================================================================
 * Base path (mounted in app.ts): /api/stocks
 *
 * Endpoints
 *  - POST   /adjust             → adjust
 *  - POST   /transfer           → transfer
 *  - GET    /on-hand            → getOnHand
 *  - GET    /                    → list (q + sort + pagination)
 *  - GET    /filter             → filter (advanced)
 *  - GET    /lots-of-product    → all lots for a product (no pagination)
 *  - POST   /rebuild            → rebuild a lot from movements
 * =============================================================================
 */

import { Router } from 'express';
import { StockController } from '../controllers/stock.controller.js';

const stockRouter = Router();

/**
 * @swagger
 * tags:
 *   - name: Stocks
 *     description: Inventory lots and stock movements
 *
 * components:
 *   schemas:
 *     LotKey:
 *       type: object
 *       required: [productId, location]
 *       properties:
 *         productId: { type: string }
 *         location: { type: string }
 *         zone:
 *           type: string
 *           nullable: true
 *         expirationDate:
 *           type: string
 *           nullable: true
 *           description: ISO date (YYYY-MM-DD) or null
 *     AdjustInput:
 *       allOf:
 *         - $ref: '#/components/schemas/LotKey'
 *         - type: object
 *           required: [quantityDelta]
 *           properties:
 *             quantityDelta:
 *               type: number
 *               description: Positive = IN, Negative = OUT (non-zero)
 *             unitPrice:
 *               type: number
 *               nullable: true
 *             reason:
 *               type: string
 *               enum: [in, out, adjustment, transfer_in, transfer_out]
 *             reference:
 *               type: string
 *               nullable: true
 *             allowNegative:
 *               type: boolean
 *               default: false
 *             updateAveragePriceOnInbound:
 *               type: boolean
 *               default: true
 *             performedAt:
 *               type: string
 *               format: date-time
 *     TransferInput:
 *       type: object
 *       required: [from, to, quantity]
 *       properties:
 *         from:
 *           $ref: '#/components/schemas/LotKey'
 *         to:
 *           $ref: '#/components/schemas/LotKey'
 *         quantity:
 *           type: number
 *           description: Must be > 0
 *         unitPrice:
 *           type: number
 *           nullable: true
 *         reference:
 *           type: string
 *           nullable: true
 *         allowNegative:
 *           type: boolean
 *           default: false
 *         updateAveragePriceOnInbound:
 *           type: boolean
 *           default: true
 *         performedAt:
 *           type: string
 *           format: date-time
 *     StockLot:
 *       type: object
 *       properties:
 *         stockId: { type: string }
 *         productId: { type: string }
 *         location: { type: string }
 *         zone: { type: string, nullable: true }
 *         expirationDate: { type: string, nullable: true }
 *         quantity: { type: number }
 *         unitPrice: { type: number, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     DataOnHand:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             onHand: { type: number }
 *     DataAdjustResult:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             lot:
 *               $ref: '#/components/schemas/StockLot'
 *             finalQty:
 *               type: number
 *     DataTransferResult:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             from:
 *               type: object
 *               properties:
 *                 finalQty: { type: number }
 *                 lot: { $ref: '#/components/schemas/StockLot' }
 *             to:
 *               type: object
 *               properties:
 *                 finalQty: { type: number }
 *                 lot: { $ref: '#/components/schemas/StockLot' }
 *     DataLotsWithMeta:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             lots:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/StockLot'
 *         meta:
 *           type: object
 *           properties:
 *             total: { type: integer, example: 120 }
 *             page: { type: integer, example: 1 }
 *             pageSize: { type: integer, example: 20 }
 *             pages: { type: integer, example: 6 }
 */

/**
 * @swagger
 * /api/stocks/adjust:
 *   post:
 *     tags: [Stocks]
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
// Actions
stockRouter.post('/adjust', StockController.adjust);

/**
 * @swagger
 * /api/stocks/transfer:
 *   post:
 *     tags: [Stocks]
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
stockRouter.post('/transfer', StockController.transfer);

/**
 * @swagger
 * /api/stocks/on-hand:
 *   get:
 *     tags: [Stocks]
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
// Reads
stockRouter.get('/on-hand', StockController.getOnHand);

/**
 * @swagger
 * /api/stocks/filter:
 *   get:
 *     tags: [Stocks]
 *     summary: Advanced filter + q + sort + pagination
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Free-text search across productId/location/zone
 *       - in: query
 *         name: filters
 *         schema: { type: string }
 *         description: JSON string of filters (alternative to individual params)
 *       - in: query
 *         name: productId
 *         schema: { oneOf: [ {type: string}, {type: array, items: {type: string}} ] }
 *       - in: query
 *         name: location
 *         schema: { oneOf: [ {type: string}, {type: array, items: {type: string}} ] }
 *       - in: query
 *         name: zone
 *         schema: { oneOf: [ {type: string}, {type: array, items: {type: string}}, {type: 'null'} ] }
 *       - in: query
 *         name: expirationDate
 *         schema: { oneOf: [ {type: string}, {type: array, items: {type: string}}, {type: 'null'} ] }
 *       - in: query
 *         name: quantityFrom
 *         schema: { type: number }
 *       - in: query
 *         name: quantityTo
 *         schema: { type: number }
 *       - in: query
 *         name: unitPriceFrom
 *         schema: { type: number }
 *       - in: query
 *         name: unitPriceTo
 *         schema: { type: number }
 *       - in: query
 *         name: createdAtFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: createdAtTo
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: updatedAtFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: updatedAtTo
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, default: 20 }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "createdAt:desc" }
 *         description: Sorting (field:dir)
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataLotsWithMeta'
 *       400:
 *         description: Invalid filters
 *       500:
 *         description: Internal error
 */
stockRouter.get('/filter', StockController.filter);

/**
 * @swagger
 * /api/stocks/lots-of-product:
 *   get:
 *     tags: [Stocks]
 *     summary: Return all existing lots for a given product (no pagination)
 *     parameters:
 *       - in: query
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataLotsWithMeta'
 *       400:
 *         description: Missing productId
 *       500:
 *         description: Internal error
 */
stockRouter.get('/lots-of-product', StockController.lotsOfProduct);

/**
 * @swagger
 * /api/stocks:
 *   get:
 *     tags: [Stocks]
 *     summary: List lots with q + sort + pagination
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Free-text search across productId/location/zone
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, default: 20 }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "createdAt:desc" }
 *         description: Sorting (field:dir)
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataLotsWithMeta'
 *       500:
 *         description: Internal error
 */
stockRouter.get('/', StockController.list);

/**
 * @swagger
 * /api/stocks/rebuild:
 *   post:
 *     tags: [Stocks]
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     lot:
 *                       $ref: '#/components/schemas/StockLot'
 *                     movements:
 *                       type: integer
 *       400:
 *         description: Validation error
 *       500:
 *         description: Internal error
 */
// Maintenance
stockRouter.post('/rebuild', StockController.rebuild);

export default stockRouter;
