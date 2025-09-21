// src/routes/order.route.ts
import { Router } from 'express';
import { OrderController } from '../controllers/order.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireEmployeeOrAdmin } from '../middlewares/requireRole.js';
import { requireOrderOwnerOrStaff } from '../middlewares/requireOrderOwnerOrStaff.js';


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

// Orders
orderRouter.post('/',requireAuth,requireEmployeeOrAdmin, OrderController.create);
orderRouter.get('/', requireAuth, OrderController.list);
orderRouter.get(
  '/filter',
  requireAuth,
  requireEmployeeOrAdmin,
  OrderController.filter
);

// Self-scoped (must be before "/:orderId")
orderRouter.get('/self', requireAuth, OrderController.listSelf);
orderRouter.get(
  '/self/:orderId',
  requireAuth,
  requireOrderOwnerOrStaff,
  OrderController.getSelfById
);

// Single order by id
orderRouter.get(
  '/:orderId',
  requireAuth,
  requireOrderOwnerOrStaff,
  OrderController.getById
);

// Field updates
orderRouter.patch(
  '/:orderId/totals',
  requireAuth,
  requireOrderOwnerOrStaff,
  OrderController.updateTotals
);
orderRouter.patch(
  '/:orderId/contact',
  requireAuth,
  requireOrderOwnerOrStaff,
  OrderController.updateContact
);
orderRouter.patch(
  '/:orderId/status',
  requireAuth,
  requireOrderOwnerOrStaff,
  OrderController.changeStatus
);
orderRouter.patch(
  '/:orderId/pickup-slot',
  requireAuth,
  requireOrderOwnerOrStaff,
  OrderController.setPickupSlot
);

// Delete
orderRouter.delete(
  '/:orderId',
  requireAuth,
  requireOrderOwnerOrStaff,
  OrderController.remove
);

export default orderRouter;
