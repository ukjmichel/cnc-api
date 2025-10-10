/**
 * =============================================================================
 * App – Express application bootstrap (no network listener here)
 * =============================================================================
 * Responsibilities
 *  - Create and configure the Express app instance.
 *  - Register global middleware (JSON body, cookies, etc.).
 *  - Mount routers (e.g., /api/auth).
 *
 * Notes
 *  - The server (port/listen) lives in src/server.ts.
 *  - This file is imported by tests as a pure app (supertest-friendly).
 * =============================================================================
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';

import { authRouter } from './routes/auth.route.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { userRouter } from './routes/user.route.js';
import productRouter from './routes/product.route.js';
import productImageRouter from './routes/product-image.route.js';
import stockRouter from './routes/stock.route.js';
import pickupSlotRouter from './routes/pickup-slot.route.js';
import orderRouter from './routes/order.route.js';
import orderItemsNestedRouter from './routes/order-item.route.js';
import { OrderItemsController } from './controllers/order-item.controller.js';
import { requireAuth } from './middlewares/requireAuth.js';
import { vGlobalFilter } from './validators/order-item.validators.js';

import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './docs/swagger.js';
import barcodeRouter from './routes/barcode.route.js';

export const app = express();

/* -------------------------------------------------------------------------- */
/* Static uploads                                                             */
/* -------------------------------------------------------------------------- */

const UPLOADS_MOUNT =
  (process.env.UPLOADS_MOUNT || '/uploads').replace(/\/+$/, '') || '/uploads';
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const uploadsAbs = path.isAbsolute(UPLOAD_DIR)
  ? UPLOAD_DIR
  : path.resolve(process.cwd(), UPLOAD_DIR);

console.log(`[static] mount ${UPLOADS_MOUNT} -> ${uploadsAbs}`);
app.use(UPLOADS_MOUNT, express.static(uploadsAbs));

/* -------------------------------------------------------------------------- */
/* Core middleware                                                            */
/* -------------------------------------------------------------------------- */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* -------------------------------------------------------------------------- */
/* Swagger / OpenAPI                                                          */
/* -------------------------------------------------------------------------- */

// Raw JSON spec (useful for codegen tools)
app.get('/api/docs.json', (_req, res) => {
  res.type('application/json').send(swaggerSpec);
});

// Interactive Swagger UI
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/* -------------------------------------------------------------------------- */
/* API routes                                                                 */
/* -------------------------------------------------------------------------- */

app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/products', productRouter);
app.use('/api/product-images', productImageRouter);
app.use('/api/stocks', stockRouter);
app.use('/api/pickup-slots', pickupSlotRouter);
app.use('/api/orders', orderRouter);
app.use('/api/barcode', barcodeRouter);

// Global order-items filter/search (mounted separately, not nested)
app.get(
  '/api/order-items',
  requireAuth,
  vGlobalFilter,
  OrderItemsController.filter
);

// Nested order-items endpoints (e.g., /api/orders/:orderId/items/…)
app.use('/api/orders/:orderId/items', orderItemsNestedRouter);

/* -------------------------------------------------------------------------- */
/* Multer error normalization (optional)                                      */
/* -------------------------------------------------------------------------- */

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (err?.name === 'MulterError') {
      return res.status(400).json({ message: err.message });
    }
    if (err && /Invalid mime type/i.test(err.message || '')) {
      return res.status(400).json({ message: err.message });
    }
    return next(err);
  }
);

/* -------------------------------------------------------------------------- */
/* Global error handler                                                       */
/* -------------------------------------------------------------------------- */

app.use(errorHandler);
