// src/routes/order.route.ts
import { Router } from 'express';
import { OrderController } from '../controllers/order.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireEmployeeOrAdmin } from '../middlewares/requireRole.js';
import { requireOrderOwnerOrStaff } from '../middlewares/requireOrderOwnerOrStaff.js';
import {
  vCreateOrder,
  vListOrders,
  vFilterOrders,
  vListSelfOrders,
  vGetSelfOrderById,
  vGetOrderById,
  vUpdateOrderTotals,
  vUpdateOrderContact,
  vChangeOrderStatus,
  vSetOrderPickupSlot,
  vDeleteOrder,
} from '../validators/order.validator.js';

const orderRouter = Router();

/**
 * Base path (mounted in app.ts): /api/orders
 *
 * Orders
 *  - POST   /                           → create
 *  - GET    /                           → list (paging/sort/filter via query)
 *  - GET    /filter                     → filter (alias of list; same query params)
 *  - GET    /self                       → listSelf (only current user's orders)    [auth]
 *  - GET    /self/:orderId              → getSelfById (one of current user)        [auth]
 *  - GET    /:orderId                   → getById
 *  - PATCH  /:orderId/totals            → updateTotals
 *  - PATCH  /:orderId/contact           → updateContact
 *  - PATCH  /:orderId/status            → changeStatus
 *  - PATCH  /:orderId/pickup-slot       → setPickupSlot
 *  - DELETE /:orderId                   → remove
 *
 * Nested Order Items (under a given order)
 *  - POST   /:orderId/items             → create item
 *  - GET    /:orderId/items             → list items for order
 *  - GET    /:orderId/items/:itemId     → get item by id
 *  - PATCH  /:orderId/items/:itemId     → update item
 *  - DELETE /:orderId/items/:itemId     → remove item
 *
 * NOTE: Route ordering matters. Keep static paths (e.g., /self, /filter) above /:orderId.
 */

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: Create and manage orders (with pickup-slot capacity sync)
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Order:
 *       type: object
 *       properties:
 *         orderId:       { type: string }
 *         userId:        { type: string, nullable: true }
 *         status:
 *           type: string
 *           enum: [draft, pending, paid, cancelled, fulfilled, refunded]
 *         subtotal:      { type: string, example: "12.34" }
 *         taxTotal:      { type: string, example: "1.23" }
 *         grandTotal:    { type: string, example: "13.57" }
 *         currency:      { type: string, example: "USD" }
 *         contactName:   { type: string, nullable: true }
 *         contactPhone:  { type: string, nullable: true }
 *         notes:         { type: string, nullable: true }
 *         pickupSlotId:  { type: string, nullable: true }
 *         createdAt:     { type: string, format: date-time }
 *         updatedAt:     { type: string, format: date-time }
 *     OrderCreateInput:
 *       type: object
 *       properties:
 *         userId:       { type: string, nullable: true }
 *         status:
 *           type: string
 *           description: Defaults to "pending" if omitted
 *           enum: [draft, pending, paid, cancelled, fulfilled, refunded]
 *         subtotal:     { type: string, example: "0" }
 *         taxTotal:     { type: string, example: "0" }
 *         grandTotal:   { type: string, example: "0" }
 *         currency:     { type: string, example: "USD" }
 *         contactName:  { type: string, nullable: true }
 *         contactPhone: { type: string, nullable: true }
 *         notes:        { type: string, nullable: true }
 *         pickupSlotId: { type: string, nullable: true }
 *     UpdateTotalsInput:
 *       type: object
 *       required: [subtotal, taxTotal, grandTotal]
 *       properties:
 *         subtotal:   { type: string, example: "10.00" }
 *         taxTotal:   { type: string, example: "0.70" }
 *         grandTotal: { type: string, example: "10.70" }
 *         currency:   { type: string, example: "USD" }
 *     UpdateContactInput:
 *       type: object
 *       properties:
 *         contactName:  { type: string }
 *         contactPhone: { type: string }
 *         notes:        { type: string }
 *     ChangeStatusInput:
 *       type: object
 *       required: [status]
 *       properties:
 *         status:
 *           type: string
 *           enum: [draft, pending, paid, cancelled, fulfilled, refunded]
 *     SetPickupSlotInput:
 *       type: object
 *       required: [pickupSlotId]
 *       properties:
 *         pickupSlotId:
 *           type: string
 *           nullable: true
 *           description: Provide a UUID to assign/change; null to unassign
 *     DataOrder:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             order:
 *               $ref: '#/components/schemas/Order'
 *     DataOrdersWithMeta:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             orders:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Order'
 *         meta:
 *           type: object
 *           properties:
 *             total:    { type: integer, example: 42 }
 *             page:     { type: integer, example: 1 }
 *             pageSize: { type: integer, example: 20 }
 *             pages:    { type: integer, example: 3 }
 *     DeleteResult:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             deleted: { type: boolean, example: true }
 */

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Create an order
 *     description: Creates a new order. Capacity is reserved on the assigned pickup slot if the status consumes capacity (pending/paid/fulfilled). Requires employee/admin.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderCreateInput'
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataOrder'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Slot capacity conflict
 *       500:
 *         description: Internal error
 */
orderRouter.post(
  '/',
  requireAuth,
  requireEmployeeOrAdmin,
  vCreateOrder,
  OrderController.create
);

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: List orders
 *     description: Lists orders with pagination/sort and optional filters. Staff see all; regular users may be restricted via middleware.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *         description: Filter by userId
 *       - in: query
 *         name: status
 *         schema: { type: string, example: "pending,paid" }
 *         description: CSV of statuses
 *       - in: query
 *         name: pickupSlotId
 *         schema: { type: string }
 *         description: Use "null" to filter unassigned
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, example: "2025-01-01" }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, example: "2025-12-31" }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, default: 20 }
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, grandTotal, status]
 *       - in: query
 *         name: orderDir
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataOrdersWithMeta'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal error
 */
orderRouter.get('/', requireAuth, vListOrders, OrderController.list);

/**
 * @swagger
 * /api/orders/filter:
 *   get:
 *     summary: Filter orders (alias of list)
 *     description: Same parameters as **GET /api/orders**. Requires employee/admin.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, example: "pending,paid" }
 *       - in: query
 *         name: pickupSlotId
 *         schema: { type: string }
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, grandTotal, status]
 *       - in: query
 *         name: orderDir
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *     responses:
 *       200:
 *         description: OK
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal error
 */
orderRouter.get(
  '/filter',
  requireAuth,
  requireEmployeeOrAdmin,
  vFilterOrders,
  OrderController.filter
);

/**
 * @swagger
 * /api/orders/self:
 *   get:
 *     summary: List current user's orders
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, example: "pending,paid" }
 *       - in: query
 *         name: pickupSlotId
 *         schema: { type: string }
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, grandTotal, status]
 *       - in: query
 *         name: orderDir
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *     responses:
 *       200:
 *         description: OK
 *       401:
 *         description: Unauthorized
 */
orderRouter.get(
  '/self',
  requireAuth,
  vListSelfOrders,
  OrderController.listSelf
);

/**
 * @swagger
 * /api/orders/self/{orderId}:
 *   get:
 *     summary: Get one of the current user's orders by ID
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataOrder'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 */
orderRouter.get(
  '/self/:orderId',
  requireAuth,
  requireOrderOwnerOrStaff,
  vGetSelfOrderById,
  OrderController.getSelfById
);

/**
 * @swagger
 * /api/orders/{orderId}:
 *   get:
 *     summary: Get an order by ID
 *     description: Owner or staff required (enforced by middleware).
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataOrder'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 */
orderRouter.get(
  '/:orderId',
  requireAuth,
  requireOrderOwnerOrStaff,
  vGetOrderById,
  OrderController.getById
);

/**
 * @swagger
 * /api/orders/{orderId}/totals:
 *   patch:
 *     summary: Update order totals
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTotalsInput'
 *     responses:
 *       200:
 *         description: Updated
 *       400:
 *         description: Invalid body
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
orderRouter.patch(
  '/:orderId/totals',
  requireAuth,
  requireOrderOwnerOrStaff,
  vUpdateOrderTotals,
  OrderController.updateTotals
);

/**
 * @swagger
 * /api/orders/{orderId}/contact:
 *   patch:
 *     summary: Update order contact fields
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateContactInput'
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 */
orderRouter.patch(
  '/:orderId/contact',
  requireAuth,
  requireOrderOwnerOrStaff,
  vUpdateOrderContact,
  OrderController.updateContact
);

/**
 * @swagger
 * /api/orders/{orderId}/status:
 *   patch:
 *     summary: Change order status
 *     description: Adjusts pickup-slot reservation if the new status changes capacity consumption.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangeStatusInput'
 *     responses:
 *       200:
 *         description: Updated
 *       400:
 *         description: Invalid status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       409:
 *         description: Slot capacity conflict
 */
orderRouter.patch(
  '/:orderId/status',
  requireAuth,
  requireOrderOwnerOrStaff,
  vChangeOrderStatus,
  OrderController.changeStatus
);

/**
 * @swagger
 * /api/orders/{orderId}/pickup-slot:
 *   patch:
 *     summary: Assign/switch/unassign a pickup slot for an order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SetPickupSlotInput'
 *     responses:
 *       200:
 *         description: Updated
 *       400:
 *         description: Invalid body
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       409:
 *         description: Slot capacity conflict
 */
orderRouter.patch(
  '/:orderId/pickup-slot',
  requireAuth,
  requireOrderOwnerOrStaff,
  vSetOrderPickupSlot,
  OrderController.setPickupSlot
);

/**
 * @swagger
 * /api/orders/{orderId}:
 *   delete:
 *     summary: Delete an order
 *     description: Releases pickup-slot reservation if the order was consuming capacity.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeleteResult'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 */
orderRouter.delete(
  '/:orderId',
  requireAuth,
  requireOrderOwnerOrStaff,
  vDeleteOrder,
  OrderController.remove
);

export default orderRouter;
