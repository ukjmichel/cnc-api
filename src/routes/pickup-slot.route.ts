// src/routes/pickup-slot.route.ts
import { Router } from 'express';
import { PickupSlotController } from '../controllers/pickup-slot.controller.js';

const pickupSlotRouter = Router();

/**
 * Base path (mounted in app.ts): /api/pickup-slots
 *
 * Endpoints
 *  - POST    /                   → create (single slot)
 *  - GET     /                   → list (paging + sort)
 *  - GET     /filter             → filter (advanced filters + paging + sort)
 *  - DELETE  /by-day             → deleteByDay (?date=YYYY-MM-DD&location=STORE-1)
 *  - POST    /generate/day       → generateForDay (one date, windows + interval)
 *  - POST    /generate/month     → generateForMonth (weekly schedule for a month)
 *  - GET     /:slotId            → getById
 *  - DELETE  /:slotId            → remove (delete one slot)
 */

// Create a single slot
pickupSlotRouter.post('/', PickupSlotController.create);

// Listing
pickupSlotRouter.get('/', PickupSlotController.list);
pickupSlotRouter.get('/filter', PickupSlotController.filter);

// Static utility routes FIRST
pickupSlotRouter.delete('/by-day', PickupSlotController.deleteByDay);
pickupSlotRouter.post('/generate/day', PickupSlotController.generateForDay);
pickupSlotRouter.post('/generate/month', PickupSlotController.generateForMonth);

// Param routes LAST (optional: UUID-ish guard)
pickupSlotRouter.get('/:slotId', PickupSlotController.getById);
pickupSlotRouter.delete('/:slotId', PickupSlotController.remove);

export default pickupSlotRouter;
