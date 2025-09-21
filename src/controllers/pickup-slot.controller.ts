// src/controllers/pickup-slot.controller.ts

/**
 * =============================================================================
 * PickupSlotController — HTTP layer for pickup/collect time slots
 * =============================================================================
 * Response shape (normalized)
 *  - Single:        { data: { slot } }
 *  - Collections:   { data: { slots }, meta: { total, page, pageSize, pages } }
 *  - Utility:       { data: { created, skipped } } (for generators)
 *  - Deletes:       { data: { deleted: true } } or { data: { deleted: number } }
 *
 * Endpoints
 *  - POST   /api/pickup-slots                  → create (single)
 *  - GET    /api/pickup-slots                  → list (filters + pagination)
 *  - GET    /api/pickup-slots/filter           → filter (same as list; alias)
 *  - GET    /api/pickup-slots/:slotId          → getById
 *  - DELETE /api/pickup-slots/:slotId          → remove
 *  - DELETE /api/pickup-slots/by-day           → deleteByDay (?location=&date=)
 *  - POST   /api/pickup-slots/generate/day     → generateForDay
 *  - POST   /api/pickup-slots/generate/month   → generateFromWeekScheduleForMonth
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import {
  CreatePickupSlotDTO,
  ListPickupSlotsQuery,
  SlotStatus,
} from '../types/pickup-slot.js';
import { PickupSlotService } from '../services/pickup-slot.service.js';
import { BadRequestError } from '../errors/index.js';
import { toInt } from '../utils/query.js';

/** Build ListPickupSlotsQuery from req.query (matches service filters). */
function buildListQuery(qs: Record<string, unknown>): ListPickupSlotsQuery {
  const {
    page,
    pageSize,
    orderBy,
    orderDir,
    // filters
    location,
    dateFrom,
    dateTo,
    dates,
    startFrom,
    startTo,
    capacityMin,
    capacityMax,
    status,
  } = qs;

  const filters: NonNullable<ListPickupSlotsQuery['filters']> = {};

  // arrays
  if (typeof location === 'string' && location.trim()) {
    filters.location = location
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof dates === 'string' && dates.trim()) {
    filters.dates = dates
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // ranges / scalars
  if (typeof dateFrom === 'string' && dateFrom.trim())
    filters.dateFrom = dateFrom.trim();
  if (typeof dateTo === 'string' && dateTo.trim())
    filters.dateTo = dateTo.trim();
  if (typeof startFrom === 'string' && startFrom.trim())
    filters.startFrom = startFrom.trim();
  if (typeof startTo === 'string' && startTo.trim())
    filters.startTo = startTo.trim();

  const cmin = Number(capacityMin);
  if (Number.isFinite(cmin)) filters.capacityMin = cmin;

  const cmax = Number(capacityMax);
  if (Number.isFinite(cmax)) filters.capacityMax = cmax;

  // Optional: status (service will ignore if not supported by its buildWhere version)
  if (typeof status === 'string' && status.trim()) {
    const parts = status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as SlotStatus[];
    (filters as any).status = parts.length > 1 ? parts : parts[0];
  }

  return {
    filters,
    page: toInt(page, 1),
    pageSize: toInt(pageSize, 20),
    orderBy: typeof orderBy === 'string' ? (orderBy as any) : undefined,
    orderDir: typeof orderDir === 'string' ? (orderDir as any) : undefined,
  };
}

export class PickupSlotController {
  /** POST /api/pickup-slots */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body as CreatePickupSlotDTO; // { location, date, startTime, endTime, capacity }
      const slot = await PickupSlotService.create(payload);
      return res.status(201).json({ data: { slot } });
    } catch (err) {
      return next(err);
    }
  }

  /** GET /api/pickup-slots */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildListQuery(req.query as Record<string, unknown>);
      const result = await PickupSlotService.list(query);
      return res.json({
        data: { slots: result.slots },
        meta: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          pages: result.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /** GET /api/pickup-slots/filter (alias of list with filters) */
  static async filter(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildListQuery(req.query as Record<string, unknown>);
      const result = await PickupSlotService.filter(query);
      return res.json({
        data: { slots: result.slots },
        meta: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          pages: result.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /** GET /api/pickup-slots/:slotId */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { slotId } = req.params;
      const slot = await PickupSlotService.getById(slotId);
      return res.json({ data: { slot } });
    } catch (err) {
      return next(err);
    }
  }

  /** DELETE /api/pickup-slots/:slotId */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { slotId } = req.params;
      const out = await PickupSlotService.remove(slotId);
      return res.json({ data: out }); // { deleted: true }
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/pickup-slots/by-day?location=STORE-1&date=2025-10-12
   */
  static async deleteByDay(req: Request, res: Response, next: NextFunction) {
    try {
      const location = String(req.query.location ?? '').trim();
      const date = String(req.query.date ?? '').trim();
      if (!location) throw new BadRequestError('location is required');
      if (!date) throw new BadRequestError('date is required (YYYY-MM-DD)');
      const out = await PickupSlotService.deleteByDay(location, date);
      return res.json({ data: out }); // { deleted: number }
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/pickup-slots/generate/day
   * Body: {
   *   location: string,
   *   date: 'YYYY-MM-DD',
   *   intervalMinutes: number,
   *   capacity: number,
   *   windows: Array<{ start: 'HH:mm', end: 'HH:mm' }>
   * }
   */
  static async generateForDay(req: Request, res: Response, next: NextFunction) {
    try {
      const { location, date, intervalMinutes, capacity, windows } =
        req.body as {
          location: string;
          date: string;
          intervalMinutes: number;
          capacity: number;
          windows: Array<{ start: string; end: string }>;
        };

      const summary = await PickupSlotService.generateForDay({
        location,
        date,
        intervalMinutes,
        capacity,
        windows,
      });

      return res.status(201).json({ data: summary }); // { created, skipped }
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/pickup-slots/generate/month
   * Body: { location, month:'YYYY-MM', intervalMinutes, capacity, schedule: Record<weekday,{start,end}[]> }
   */
  static async generateForMonth(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { location, month, intervalMinutes, capacity, schedule } =
        req.body as {
          location: string;
          month: string;
          intervalMinutes: number;
          capacity: number;
          schedule: Record<string, Array<{ start: string; end: string }>>;
        };

      const summary = await PickupSlotService.generateFromWeekScheduleForMonth({
        location,
        month,
        intervalMinutes,
        capacity,
        schedule: schedule as any,
      });

      return res.status(201).json({ data: summary }); // { created, skipped }
    } catch (err) {
      return next(err);
    }
  }
}
