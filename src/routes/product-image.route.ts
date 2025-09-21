// src/routes/product-image.route.ts

/**
 * =============================================================================
 * ProductImage Router — REST endpoints for product images
 * =============================================================================
 * Base path (mounted in app.ts): /api/product-images
 *
 * Endpoints
 *  - POST   /                    → create
 *  - POST   /upsert              → upsertVariant (create-or-update by { productId, variant })
 *  - POST   /upload              → upload (multipart: fields + file "image"; creates DB row)
 *  - GET    /                    → list (q + sort + pagination)
 *  - GET    /filter              → filter (advanced filters + q)
 *  - GET    /by-product          → getByProductAndVariant (?productId= & variant=)
 *  - DELETE /by-product          → deleteByProductAndVariant (?productId= & variant=)
 *  - GET    /:id                 → getById
 *  - PATCH  /:id                 → update
 *  - DELETE /:id                 → remove
 *
 * Notes
 *  - Controller: src/controllers/product-image.controller.ts
 *  - Service:    src/services/product-image.service.ts
 * =============================================================================
 */

import { Router } from 'express';
import { ProductImageController } from '../controllers/product-image.controller.js';
import { singleProductImage } from '../config/multer.config.js';

const productImageRouter = Router();

// Create
productImageRouter.post('/', ProductImageController.create);

// Upsert by (productId, variant)
productImageRouter.post('/upsert', ProductImageController.upsertVariant);

// Upload (multipart/form-data; file field "image")
productImageRouter.post(
  '/upload',
  singleProductImage('image'),
  ProductImageController.createWithUpload
);

// Reads
productImageRouter.get('/', ProductImageController.list);
productImageRouter.get('/filter', ProductImageController.filter);
productImageRouter.get(
  '/by-product',
  ProductImageController.getByProductAndVariant
);
productImageRouter.get('/:id', ProductImageController.getById);

// Mutations
productImageRouter.patch('/:id', ProductImageController.update);
productImageRouter.delete(
  '/by-product',
  ProductImageController.deleteByProductAndVariant
);
productImageRouter.delete('/:id', ProductImageController.remove);
productImageRouter.delete(
  '/by-product/:productId',
  ProductImageController.deleteAllByProduct
);

export default productImageRouter;
