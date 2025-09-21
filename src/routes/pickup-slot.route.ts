// src/routes/pickup-slot.route.ts
import { Router } from 'express';
import { PickupSlotController } from '../controllers/pickup-slot.controller.js';

const pickupSlotRouter = Router();

/**
 * =============================================================================
 * Pickup Slot Routes — Express Router
 * =============================================================================
 * Mount point
 *  - Mount at `/api/pickup-slots` in your app, e.g.:
 *      import pickupSlotRouter from './routes/pickup-slot.route.js';
 *      app.use('/api/pickup-slots', pickupSlotRouter);
 *
 * Endpoints (relative to /api/pickup-slots)
 *  - POST    /                    → create (single slot)
 *  - GET     /                    → list (paging + sort)
 *  - GET     /filter              → filter (advanced filters + paging + sort)
 *  - DELETE  /by-day              → deleteByDay (?date=YYYY-MM-DD&location=STORE-1)
 *  - POST    /generate/day        → generateForDay (one date, windows + interval)
 *  - POST    /generate/month      → generateForMonth (weekly schedule for a month)
 *  - GET     /:slotId             → getById
 *  - DELETE  /:slotId             → remove (delete one slot)
 *
 * Notes
 *  - Controllers return normalized envelopes:
 *      { data: { ... }, meta?: { total, page, pageSize, pages } }
 *  - See src/controllers/pickup-slot.controller.ts for details and validation.
 * =============================================================================
 */

/**
 * @swagger
 * tags:
 *   - name: PickupSlots
 *     description: Click & collect pickup-slot management
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     DayWindow:
 *       type: object
 *       required: [start, end]
 *       properties:
 *         start: { type: string, example: "09:00" }
 *         end:   { type: string, example: "12:00" }
 *     PickupSlot:
 *       type: object
 *       properties:
 *         slotId:        { type: string, example: "4b9a3b0a-2f81-4c9a-9301-1a5f0f6f9f56" }
 *         location:      { type: string, example: "STORE-1" }
 *         date:          { type: string, format: date, example: "2025-07-01" }
 *         startTime:     { type: string, example: "09:00:00" }
 *         endTime:       { type: string, example: "09:30:00" }
 *         capacity:      { type: integer, minimum: 0, example: 8 }
 *         reservedCount: { type: integer, minimum: 0, example: 0 }
 *         status:        { type: string, enum: [open, closed], example: "open" }
 *         createdAt:     { type: string, format: date-time }
 *         updatedAt:     { type: string, format: date-time }
 *     CreatePickupSlotInput:
 *       type: object
 *       required: [location, date, startTime, endTime, capacity]
 *       properties:
 *         location:  { type: string, example: "STORE-1" }
 *         date:      { type: string, example: "2025-07-01" }
 *         startTime: { type: string, example: "09:00" }
 *         endTime:   { type: string, example: "09:30" }
 *         capacity:  { type: integer, minimum: 1, example: 8 }
 *     GenerateDayInput:
 *       type: object
 *       required: [location, date, intervalMinutes, capacity, windows]
 *       properties:
 *         location:        { type: string, example: "STORE-1" }
 *         date:            { type: string, example: "2025-07-01" }
 *         intervalMinutes: { type: integer, minimum: 1, example: 30 }
 *         capacity:        { type: integer, minimum: 1, example: 8 }
 *         windows:
 *           type: array
 *           items: { $ref: '#/components/schemas/DayWindow' }
 *     GenerateMonthInput:
 *       type: object
 *       required: [location, month, intervalMinutes, capacity, schedule]
 *       properties:
 *         location:        { type: string, example: "STORE-1" }
 *         month:           { type: string, example: "2025-07" }
 *         intervalMinutes: { type: integer, minimum: 1, example: 30 }
 *         capacity:        { type: integer, minimum: 1, example: 8 }
 *         schedule:
 *           description: Weekly schedule object keyed by weekday (sun..sat)
 *           type: object
 *           additionalProperties:
 *             type: array
 *             items: { $ref: '#/components/schemas/DayWindow' }
 *           example:
 *             mon: [ { start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" } ]
 *             tue: [ { start: "10:00", end: "16:00" } ]
 *     DataSlot:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             slot:
 *               $ref: '#/components/schemas/PickupSlot'
 *     DataSlotsWithMeta:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             slots:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/PickupSlot'
 *         meta:
 *           type: object
 *           properties:
 *             total:    { type: integer, example: 120 }
 *             page:     { type: integer, example: 1 }
 *             pageSize: { type: integer, example: 20 }
 *             pages:    { type: integer, example: 6 }
 *     DeleteOneResult:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             deleted:
 *               type: boolean
 *               example: true
 *     DeleteByDayResult:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             deleted:
 *               type: integer
 *               example: 24
 *     GenerateDayResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             created:
 *               type: array
 *               items: { $ref: '#/components/schemas/PickupSlot' }
 *             skipped:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   startTime: { type: string, example: "11:30" }
 *                   endTime:   { type: string, example: "12:00" }
 *                   reason:    { type: string, example: "duplicate" }
 *     GenerateMonthResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             created:
 *               type: array
 *               items: { $ref: '#/components/schemas/PickupSlot' }
 *             skipped:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   date:      { type: string, example: "2025-07-15" }
 *                   startTime: { type: string, example: "11:30" }
 *                   endTime:   { type: string, example: "12:00" }
 *                   reason:    { type: string, example: "duplicate" }
 */

/**
 * @swagger
 * /api/pickup-slots:
 *   post:
 *     summary: Create a pickup slot
 *     tags: [PickupSlots]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreatePickupSlotInput' }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DataSlot' }
 *       400:
 *         description: Validation error
 *       409:
 *         description: Duplicate slot
 */
pickupSlotRouter.post('/', PickupSlotController.create);

/**
 * @swagger
 * /api/pickup-slots:
 *   get:
 *     summary: List pickup slots (pagination + sort)
 *     tags: [PickupSlots]
 *     parameters:
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
 *           enum: [date, startTime, endTime, capacity, createdAt, updatedAt]
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
 *             schema: { $ref: '#/components/schemas/DataSlotsWithMeta' }
 */
pickupSlotRouter.get('/', PickupSlotController.list);

/**
 * @swagger
 * /api/pickup-slots/filter:
 *   get:
 *     summary: Filter pickup slots (advanced)
 *     tags: [PickupSlots]
 *     parameters:
 *       - in: query
 *         name: location
 *         schema:
 *           oneOf:
 *             - type: string
 *             - type: array
 *               items: { type: string }
 *         description: One or more location codes
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, example: "2025-07-01" }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, example: "2025-07-31" }
 *       - in: query
 *         name: dates
 *         schema:
 *           oneOf:
 *             - type: string
 *             - type: array
 *               items: { type: string }
 *       - in: query
 *         name: startFrom
 *         schema: { type: string, example: "09:00" }
 *       - in: query
 *         name: startTo
 *         schema: { type: string, example: "18:00" }
 *       - in: query
 *         name: capacityMin
 *         schema: { type: integer, example: 1 }
 *       - in: query
 *         name: capacityMax
 *         schema: { type: integer, example: 16 }
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
 *           enum: [date, startTime, endTime, capacity, createdAt, updatedAt]
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
 *             schema: { $ref: '#/components/schemas/DataSlotsWithMeta' }
 */
pickupSlotRouter.get('/filter', PickupSlotController.filter);

/**
 * @swagger
 * /api/pickup-slots/by-day:
 *   delete:
 *     summary: Delete all slots for a (location, date)
 *     tags: [PickupSlots]
 *     parameters:
 *       - in: query
 *         name: location
 *         required: true
 *         schema: { type: string, example: "STORE-1" }
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, example: "2025-07-01" }
 *     responses:
 *       200:
 *         description: Deleted count
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DeleteByDayResult' }
 *       400:
 *         description: Invalid query
 */
pickupSlotRouter.delete('/by-day', PickupSlotController.deleteByDay);

/**
 * @swagger
 * /api/pickup-slots/generate/day:
 *   post:
 *     summary: Generate slots for one day from windows + interval
 *     tags: [PickupSlots]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/GenerateDayInput' }
 *     responses:
 *       200:
 *         description: Generation summary
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/GenerateDayResponse' }
 *       400:
 *         description: Invalid body
 */
pickupSlotRouter.post('/generate/day', PickupSlotController.generateForDay);

/**
 * @swagger
 * /api/pickup-slots/generate/month:
 *   post:
 *     summary: Generate slots for an entire month from a weekly schedule
 *     tags: [PickupSlots]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/GenerateMonthInput' }
 *     responses:
 *       200:
 *         description: Generation summary
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/GenerateMonthResponse' }
 *       400:
 *         description: Invalid body
 */
pickupSlotRouter.post('/generate/month', PickupSlotController.generateForMonth);

/**
 * @swagger
 * /api/pickup-slots/{slotId}:
 *   get:
 *     summary: Get a pickup slot by ID
 *     tags: [PickupSlots]
 *     parameters:
 *       - in: path
 *         name: slotId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DataSlot' }
 *       404:
 *         description: Not found
 */
pickupSlotRouter.get('/:slotId', PickupSlotController.getById);

/**
 * @swagger
 * /api/pickup-slots/{slotId}:
 *   delete:
 *     summary: Delete a pickup slot by ID
 *     tags: [PickupSlots]
 *     parameters:
 *       - in: path
 *         name: slotId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DeleteOneResult' }
 *       404:
 *         description: Not found
 */
pickupSlotRouter.delete('/:slotId', PickupSlotController.remove);

export default pickupSlotRouter;
