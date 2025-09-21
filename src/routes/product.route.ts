import { Router } from 'express';
import { ProductController } from '../controllers/product.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireEmployeeOrAdmin } from '../middlewares/requireRole.js';
import { validate } from '../middlewares/validate.js';
import {
  vCreateProduct,
  vUpdateProduct,
  vListProducts,
  vFilterProducts,
  vGetByCode,
  vParamId,
} from '../validators/product.validators.js';

const productRouter = Router();

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
 *
 * Auth model
 *  - Public: list, filter, by-code, getById
 *  - Protected (employee/admin): create, update, delete
 * =============================================================================
 */

/**
 * @swagger
 * tags:
 *   - name: Products
 *     description: Product catalog management and queries
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Product:
 *       type: object
 *       description: Normalized product shape returned by the API.
 *       properties:
 *         productId:     { type: string, example: "EAN:123" }
 *         productCode:   { type: string, nullable: true, example: "ABC-123" }
 *         productName:   { type: string, example: "Sparkling Water" }
 *         brands:        { type: string, nullable: true, example: "Acme" }
 *         description:   { type: string, nullable: true, example: "6x500ml pack" }
 *         quantity:      { type: number, nullable: true, example: 6 }
 *         quantityUnit:  { type: string, nullable: true, example: "bottles" }
 *     ProductCreateInput:
 *       type: object
 *       required: [productId, productName]
 *       properties:
 *         productId:    { type: string }
 *         productCode:  { type: string, nullable: true }
 *         productName:  { type: string }
 *         brands:       { type: string, nullable: true }
 *         quantity:     { type: number, nullable: true }
 *         quantityUnit: { type: string, nullable: true }
 *         description:  { type: string, nullable: true }
 *     ProductUpdateInput:
 *       type: object
 *       properties:
 *         productCode:  { type: string, nullable: true }
 *         productName:  { type: string }
 *         brands:       { type: string, nullable: true }
 *         quantity:     { type: number, nullable: true }
 *         quantityUnit: { type: string, nullable: true }
 *         description:  { type: string, nullable: true }
 *     DataProduct:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             product:
 *               $ref: '#/components/schemas/Product'
 *     DataProductsWithMeta:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             products:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 *         meta:
 *           type: object
 *           properties:
 *             total:    { type: integer, example: 120 }
 *             page:     { type: integer, example: 1 }
 *             pageSize: { type: integer, example: 20 }
 *             pages:    { type: integer, example: 6 }
 *     DataSuccess:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             success:
 *               type: boolean
 *               example: true
 */

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create a product
 *     description: Creates a new product record and returns the normalized product.
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProductCreateInput'
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataProduct'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Conflict (duplicate id/code)
 *       500:
 *         description: Internal error
 */
productRouter.post(
  '/',
  requireAuth,
  requireEmployeeOrAdmin,
  vCreateProduct,
  validate,
  ProductController.create
);

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: List products
 *     description: Paginated list with optional free-text search and sorting.
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Free-text search across id/code/name/brands
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
 *           enum: [createdAt, updatedAt, productName, productCode, brands]
 *         description: Sort field (default createdAt)
 *       - in: query
 *         name: orderDir
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *         description: Sort direction (default DESC)
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataProductsWithMeta'
 *       400:
 *         description: Invalid query
 *       500:
 *         description: Internal error
 */
productRouter.get('/', vListProducts, validate, ProductController.list);

/**
 * @swagger
 * /api/products/filter:
 *   get:
 *     summary: Filter products
 *     description: Advanced filter with structured fields plus free-text `q`.
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Free-text search across id/code/name/brands
 *       - in: query
 *         name: filters
 *         schema: { type: string }
 *         description: JSON-encoded filters object (see docs)
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
 *           enum: [createdAt, updatedAt, productName, productCode, brands]
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
 *               $ref: '#/components/schemas/DataProductsWithMeta'
 *       400:
 *         description: Invalid filters
 *       500:
 *         description: Internal error
 */
productRouter.get(
  '/filter',
  vFilterProducts,
  validate,
  ProductController.filter
);

/**
 * @swagger
 * /api/products/by-code:
 *   get:
 *     summary: Get product by code
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: productCode
 *         required: true
 *         schema: { type: string }
 *         description: Product code to look up (case-insensitive; normalized server-side)
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataProduct'
 *       400:
 *         description: Missing/invalid productCode
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
productRouter.get(
  '/by-code',
  vGetByCode,
  validate,
  ProductController.getByCode
);

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataProduct'
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
productRouter.get('/:id', vParamId, validate, ProductController.getById);

/**
 * @swagger
 * /api/products/{id}:
 *   patch:
 *     summary: Update a product
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProductUpdateInput'
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataProduct'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       409:
 *         description: Conflict (unique code)
 *       500:
 *         description: Internal error
 */
productRouter.patch(
  '/:id',
  requireAuth,
  requireEmployeeOrAdmin,
  vParamId,
  vUpdateProduct,
  validate,
  ProductController.update
);

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete a product
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataSuccess'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
productRouter.delete(
  '/:id',
  requireAuth,
  requireEmployeeOrAdmin,
  vParamId,
  validate,
  ProductController.remove
);

export default productRouter;
