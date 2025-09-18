// src/routes/product.routes.ts

/**
 * =============================================================================
 * Product Routes — Express Router
 * =============================================================================
 * Mount point
 *  - Mount at `/api/products` in your app, e.g.:
 *      import productRoutes from './routes/product.routes.js';
 *      app.use('/api/products', productRoutes);
 *
 * Endpoints (relative to /api/products)
 *  - POST   /                 → ProductController.create
 *  - GET    /                 → ProductController.list
 *  - GET    /filter           → ProductController.filter
 *  - GET    /by-code          → ProductController.getByCode (?productCode=)
 *  - GET    /:id              → ProductController.getById
 *  - PATCH  /:id              → ProductController.update
 *  - DELETE /:id              → ProductController.remove
 * =============================================================================
 */

import { Router } from 'express';
import { ProductController } from '../controllers/product.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';

const productRouter = Router();

// Create
productRouter.post('/', requireAuth, ProductController.create);

// Reads
productRouter.get('/', ProductController.list);
productRouter.get('/filter', ProductController.filter);
productRouter.get('/by-code', ProductController.getByCode);
productRouter.get('/:id', ProductController.getById);

// Mutations
productRouter.patch('/:id', requireAuth, ProductController.update);
productRouter.delete('/:id', requireAuth, ProductController.remove);

export default productRouter;
