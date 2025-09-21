// src/routes/product-image.route.ts

/**
 * =============================================================================
 * ProductImage Router — REST endpoints for product images
 * =============================================================================
 * Base path (mounted in app.ts): /api/product-images
 *
 * Auth
 *  - All routes require JWT + employee/admin **except**:
 *    • GET /by-product  (public)
 *
 * Endpoints
 *  - POST   /                    → create
 *  - POST   /upsert              → upsertVariant (create-or-update by { productId, variant })
 *  - POST   /upload              → upload (multipart: fields + file "image"; creates DB row)
 *  - GET    /                    → list (q + sort + pagination)
 *  - GET    /filter              → filter (advanced filters + q)
 *  - GET    /by-product          → getByProductAndVariant (?productId= & variant=)  [PUBLIC]
 *  - DELETE /by-product          → deleteByProductAndVariant (?productId= & variant=)
 *  - GET    /:id                 → getById
 *  - PATCH  /:id                 → update
 *  - DELETE /:id                 → remove
 *  - DELETE /by-product/:productId → deleteAllByProduct
 * =============================================================================
 */

import { Router } from 'express';
import { ProductImageController } from '../controllers/product-image.controller.js';
import { singleProductImage } from '../config/multer.config.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireEmployeeOrAdmin } from '../middlewares/requireRole.js';

const productImageRouter = Router();

/**
 * @swagger
 * tags:
 *   - name: Product Images
 *     description: Manage product images and uploads
 */

/**
 * @swagger
 * /api/product-images:
 *   post:
 *     summary: Create a product image (JSON)
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.post(
  '/',
  requireAuth,
  requireEmployeeOrAdmin,
  ProductImageController.create
);

/**
 * @swagger
 * /api/product-images/upsert:
 *   post:
 *     summary: Upsert a product image by (productId, variant)
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.post(
  '/upsert',
  requireAuth,
  requireEmployeeOrAdmin,
  ProductImageController.upsertVariant
);

/**
 * @swagger
 * /api/product-images/upload:
 *   post:
 *     summary: Upload a product image (multipart/form-data)
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.post(
  '/upload',
  requireAuth,
  requireEmployeeOrAdmin,
  singleProductImage('image'),
  ProductImageController.createWithUpload
);

/**
 * @swagger
 * /api/product-images:
 *   get:
 *     summary: List product images
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.get(
  '/',
  requireAuth,
  requireEmployeeOrAdmin,
  ProductImageController.list
);

/**
 * @swagger
 * /api/product-images/filter:
 *   get:
 *     summary: Filter product images
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.get(
  '/filter',
  requireAuth,
  requireEmployeeOrAdmin,
  ProductImageController.filter
);

/**
 * @swagger
 * /api/product-images/by-product:
 *   get:
 *     summary: Get image by (productId, variant) — PUBLIC
 *     description: This endpoint does **not** require authentication.
 *     tags: [Product Images]
 */
productImageRouter.get(
  '/by-product',
  ProductImageController.getByProductAndVariant
);

/**
 * @swagger
 * /api/product-images/{id}:
 *   get:
 *     summary: Get a product image by ID
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.get(
  '/:id',
  requireAuth,
  requireEmployeeOrAdmin,
  ProductImageController.getById
);

/**
 * @swagger
 * /api/product-images/{id}:
 *   patch:
 *     summary: Update a product image
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.patch(
  '/:id',
  requireAuth,
  requireEmployeeOrAdmin,
  ProductImageController.update
);

/**
 * @swagger
 * /api/product-images/by-product:
 *   delete:
 *     summary: Delete by (productId, variant)
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.delete(
  '/by-product',
  requireAuth,
  requireEmployeeOrAdmin,
  ProductImageController.deleteByProductAndVariant
);

/**
 * @swagger
 * /api/product-images/{id}:
 *   delete:
 *     summary: Delete a product image by ID
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.delete(
  '/:id',
  requireAuth,
  requireEmployeeOrAdmin,
  ProductImageController.remove
);

/**
 * @swagger
 * /api/product-images/by-product/{productId}:
 *   delete:
 *     summary: Delete all images for a product
 *     tags: [Product Images]
 *     security: [{ bearerAuth: [] }]
 */
productImageRouter.delete(
  '/by-product/:productId',
  requireAuth,
  requireEmployeeOrAdmin,
  ProductImageController.deleteAllByProduct
);

export default productImageRouter;
