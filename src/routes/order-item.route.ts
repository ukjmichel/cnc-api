// src/routes/order-item.route.ts
/**
 * =============================================================================
 * OrderItem Routes
 * =============================================================================
 * Nested under `/api/orders/:orderId/items` for order-specific operations.
 * Also includes `/api/order-items` for global filtering/search.
 *
 * Swagger:
 *  - All endpoints are secured with Bearer auth (see global security).
 *  - Schemas for request/response bodies are defined in this file under
 *    `components.schemas.*` so the docs are self-contained.
 * =============================================================================
 */

import { Router } from 'express';
import { OrderItemsController } from '../controllers/order-item.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireOrderOwnerOrStaff } from '../middlewares/requireOrderOwnerOrStaff.js'; // <- fixed stray space

import {
  vCreateOrderItem,
  vCreateManyOrderItems,
  vListForOrder,
  vGetOne,
  vUpdateOrderItem,
  vRemoveOrderItem,
  vGlobalFilter,
} from '../validators/order-item.validators.js';

const orderItemsNestedRouter = Router({ mergeParams: true });

/**
 * @swagger
 * /api/orders/{orderId}/items:
 *   post:
 *     summary: Create a single order item
 *     description: >
 *       Create (or merge) an item in an order. If the same `(orderId, stockId)` exists,
 *       the quantity will be merged. If `unitPrice` is omitted, it defaults to the stock’s current price.
 *     tags: [Order Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: The order ID to attach the item to.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOrderItemDTO'
 *     responses:
 *       201:
 *         description: Created (or merged) order item
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     item:
 *                       $ref: '#/components/schemas/OrderItem'
 *       400:
 *         description: Validation error or insufficient stock
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not owner or staff)
 *       404:
 *         description: Order or Stock not found
 */
/** Create single item (frontend may override unitPrice) */
orderItemsNestedRouter.post(
  '/',
  requireAuth,
  requireOrderOwnerOrStaff,
  vCreateOrderItem,
  OrderItemsController.create
);

/**
 * @swagger
 * /api/orders/{orderId}/items/bulk:
 *   post:
 *     summary: Bulk create/merge order items atomically
 *     description: >
 *       Accepts an array of items, all processed in a single transaction (all-or-nothing).
 *       Existing `(orderId, stockId)` lines are merged. `unitPrice` default comes from stock if omitted.
 *     tags: [Order Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: The order ID to attach items to.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/CreateOrderItemDTO'
 *     responses:
 *       201:
 *         description: Items created/merged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     created:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/OrderItem'
 *       400:
 *         description: Validation error or insufficient stock (rolled back)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not owner or staff)
 *       404:
 *         description: Order or Stock not found
 */
/** Bulk create items */
orderItemsNestedRouter.post(
  '/bulk',
  requireAuth,
  requireOrderOwnerOrStaff,
  vCreateManyOrderItems,
  OrderItemsController.createMany
);

/**
 * @swagger
 * /api/orders/{orderId}/items:
 *   get:
 *     summary: List items for an order
 *     description: Returns paginated order items belonging to the given order.
 *     tags: [Order Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 20
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, quantity, unitPrice, lineTotal]
 *       - in: query
 *         name: orderDir
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *     responses:
 *       200:
 *         description: Paginated items
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedOrderItems'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not owner or staff)
 *       404:
 *         description: Order not found
 */
/** List items for a given order (with pagination) */
orderItemsNestedRouter.get(
  '/',
  requireAuth,
  requireOrderOwnerOrStaff,
  vListForOrder,
  OrderItemsController.listForOrder
);

/**
 * @swagger
 * /api/orders/{orderId}/items/{stockId}:
 *   get:
 *     summary: Get one order item (by orderId + stockId)
 *     tags: [Order Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: stockId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The order item
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     item:
 *                       $ref: '#/components/schemas/OrderItem'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not owner or staff)
 *       404:
 *         description: Order or Item not found
 */
/** Get one item by orderId + stockId */
orderItemsNestedRouter.get(
  '/:stockId',
  requireAuth,
  requireOrderOwnerOrStaff,
  vGetOne,
  OrderItemsController.getOne
);

/**
 * @swagger
 * /api/orders/{orderId}/items/{stockId}:
 *   patch:
 *     summary: Update an order item
 *     description: Update quantity and/or unitPrice; lineTotal is recomputed automatically.
 *     tags: [Order Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: stockId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateOrderItemDTO'
 *     responses:
 *       200:
 *         description: Updated order item
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     item:
 *                       $ref: '#/components/schemas/OrderItem'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not owner or staff)
 *       404:
 *         description: Order or Item not found
 */
/** Update item (quantity/unitPrice) */
orderItemsNestedRouter.patch(
  '/:stockId',
  requireAuth,
  requireOrderOwnerOrStaff,
  vUpdateOrderItem,
  OrderItemsController.update
);

/**
 * @swagger
 * /api/orders/{orderId}/items/{stockId}:
 *   delete:
 *     summary: Delete an order item
 *     tags: [Order Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: stockId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted flag
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     deleted:
 *                       type: boolean
 *                       example: true
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not owner or staff)
 *       404:
 *         description: Order or Item not found
 */
/** Delete item */
orderItemsNestedRouter.delete(
  '/:stockId',
  requireAuth,
  requireOrderOwnerOrStaff,
  vRemoveOrderItem,
  OrderItemsController.remove
);

/**
 * @swagger
 * /api/order-items:
 *   get:
 *     summary: Global filter/search order items
 *     description: >
 *       Filter order items across all orders with optional ranges and sort/pagination.
 *     tags: [Order Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: orderId
 *         schema: { type: string }
 *       - in: query
 *         name: stockId
 *         schema: { type: string }
 *       - in: query
 *         name: productId
 *         schema: { type: string }
 *       - in: query
 *         name: createdFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: createdTo
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: quantityMin
 *         schema: { type: number }
 *       - in: query
 *         name: quantityMax
 *         schema: { type: number }
 *       - in: query
 *         name: unitPriceMin
 *         schema: { type: number }
 *       - in: query
 *         name: unitPriceMax
 *         schema: { type: number }
 *       - in: query
 *         name: lineTotalMin
 *         schema: { type: number }
 *       - in: query
 *         name: lineTotalMax
 *         schema: { type: number }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, quantity, unitPrice, lineTotal]
 *       - in: query
 *         name: orderDir
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *     responses:
 *       200:
 *         description: Paginated results
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedOrderItems'
 *       401:
 *         description: Unauthorized
 */
/**
 * Global filter/search
 * NOTE: This path looks odd when mounted as a nested router.
 * Prefer wiring this on your top-level api router:
 *   app.get('/api/order-items', requireAuth, vGlobalFilter, OrderItemsController.filter)
 * If you keep it here, make sure the mount path results in /api/order-items.
 */
orderItemsNestedRouter.get(
  '/../../order-items',
  requireAuth,
  vGlobalFilter,
  OrderItemsController.filter
);

export default orderItemsNestedRouter;

/**
 * @swagger
 * components:
 *   schemas:
 *     OrderItem:
 *       type: object
 *       properties:
 *         orderId:
 *           type: string
 *           format: uuid
 *         stockId:
 *           type: string
 *           format: uuid
 *         quantity:
 *           type: string
 *           description: DECIMAL(12,3) serialized as string
 *           example: "2.500"
 *         unitPrice:
 *           type: string
 *           description: DECIMAL(12,2) serialized as string
 *           example: "3.20"
 *         lineTotal:
 *           type: string
 *           description: DECIMAL(12,2) serialized as string
 *           example: "8.00"
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     CreateOrderItemDTO:
 *       type: object
 *       required: [stockId, quantity]
 *       properties:
 *         stockId:
 *           type: string
 *           description: Stock lot ID
 *         quantity:
 *           type: string
 *           description: Quantity (3dp) as string, e.g. "1.000"
 *         unitPrice:
 *           type: string
 *           description: Optional override; defaults to stock.unitPrice
 *         lineTotal:
 *           type: string
 *           description: Optional override; if omitted, computed as quantity × unitPrice
 *
 *     UpdateOrderItemDTO:
 *       type: object
 *       properties:
 *         quantity:
 *           type: string
 *           description: New quantity (3dp) as string
 *         unitPrice:
 *           type: string
 *           description: Override line price (2dp) as string
 *
 *     PaginatedOrderItems:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             items:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/OrderItem'
 *         meta:
 *           type: object
 *           properties:
 *             total:
 *               type: integer
 *               example: 42
 *             page:
 *               type: integer
 *               example: 1
 *             pageSize:
 *               type: integer
 *               example: 20
 *             pages:
 *               type: integer
 *               example: 3
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: integer
 *           example: 400
 *         error:
 *           type: string
 *           example: VALIDATION_ERROR
 *         message:
 *           type: string
 *         details:
 *           type: array
 *           items:
 *             type: object
 */
