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

// Actions
stockRouter.post('/adjust', StockController.adjust);
stockRouter.post('/transfer', StockController.transfer);

// Reads
stockRouter.get('/on-hand', StockController.getOnHand);
stockRouter.get('/filter', StockController.filter);
stockRouter.get('/lots-of-product', StockController.lotsOfProduct);

// Listing (q + sort + pagination via query builders)
stockRouter.get('/', StockController.list);

// Optional: legacy/simple list with manual filters & pagination (kept if needed)
// stockRouter.get('/simple', StockController.listSimple);

// Maintenance
stockRouter.post('/rebuild', StockController.rebuild);

export default stockRouter;
