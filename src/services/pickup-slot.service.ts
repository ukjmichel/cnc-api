// src/services/pickup-slot.service.ts

/**
 * =============================================================================
 * PickupSlotService — business logic for click-&-collect pickup slots
 * =============================================================================
 * Purpose
 *  - Encapsulates DB operations around PickupSlotModel (create/list/filter/generate).
 *  - Returns **plain objects**; controllers handle response envelopes.
 *
 * Capabilities
 *  - create: create a single slot (guards against duplicates/overlaps)
 *  - list:   simple listing with sort & pagination
 *  - filter: advanced filters + sort & pagination
 *  - getById: fetch one
 *  - remove: delete one slot by id
 *  - deleteByDay: bulk delete by (location, date)
 *  - generateForDay: create slots for a single day from windows + interval
 *  - generateFromWeekScheduleForMonth: bulk-create slots for a whole month
 *
 * Notes
 *  - Uses a readonly array for ORDER FIELDS to work with normalizeSort().
 *  - Works with date/time strings (no timezone calculus inside the service).
 *  - Type contracts come from src/types/pickup-slot.ts to keep things DRY.
 * =============================================================================
 */

import {
  Op,
  UniqueConstraintError,
  WhereOptions,
  FindOptions,
} from 'sequelize';
import { PickupSlotModel } from '../models/pickup-slot.model.js';

import {
  BadRequestError,
  DuplicateError,
  NotFoundError,
} from '../errors/index.js';
import { withTransaction } from '../utils/tx.js';
import { normalizeSort } from '../utils/query.js';

import type {
  CreatePickupSlotDTO,
  PickupSlotFilters,
  SlotOrderBy,
  ListPickupSlotsQuery,
  Weekday,
  GenerateSlotsFromWeekScheduleParams,
  GenerateSlotsForDayParams as GenerateForDayParams, // alias to preserve existing name usage
} from '../types/pickup-slot.js';

/* -------------------------------------------------------------------------- */
/* Allowed sort fields — must be a readonly array (NOT Set)                   */
/* -------------------------------------------------------------------------- */
const SLOT_ORDER_FIELDS = [
  'date',
  'startTime',
  'endTime',
  'capacity',
  'createdAt',
  'updatedAt',
] as const;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Compare two HH:mm strings.
 * @param a - Time string in `HH:mm` (or `HH:mm:ss`) format.
 * @param b - Time string in `HH:mm` (or `HH:mm:ss`) format.
 * @returns `true` if `a <= b` lexicographically (works for zero-padded times).
 */
function timeLessEq(a: string, b: string) {
  return a <= b; // strings in 'HH:mm' compare lexicographically fine
}

/**
 * Add minutes to an `HH:mm` string (24h wrap-around).
 * @param hhmm - Base time string in `HH:mm` format.
 * @param minutes - Minutes to add (may exceed 60).
 * @returns New time in `HH:mm` format (00:00–23:59), wrapped by 24h.
 */
function addMinutes(hhmm: string, minutes: number): string {
  const [hh, mm] = hhmm.split(':').map((n) => parseInt(n, 10));
  const total = hh * 60 + mm + minutes;
  const h2 = Math.floor(total / 60) % 24;
  const m2 = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(h2)}:${pad(m2)}`;
}

/**
 * Build a Sequelize `WHERE` clause from pickup-slot filters.
 * @param filters - Optional filters (location IN, date ranges, specific dates, starts, capacity ranges).
 * @returns A `WhereOptions` object suitable for `findAll`/`findAndCountAll`.
 */
function buildWhere(filters?: PickupSlotFilters): WhereOptions {
  const andParts: WhereOptions[] = [];

  if (!filters) return {};

  if (filters.location && filters.location.length) {
    andParts.push({ location: { [Op.in]: filters.location } });
  }
  if (filters.dateFrom || filters.dateTo) {
    andParts.push({
      date: {
        ...(filters.dateFrom ? { [Op.gte]: filters.dateFrom } : {}),
        ...(filters.dateTo ? { [Op.lte]: filters.dateTo } : {}),
      },
    });
  }
  if (filters.dates && filters.dates.length) {
    andParts.push({ date: { [Op.in]: filters.dates } });
  }
  if (filters.startFrom || filters.startTo) {
    andParts.push({
      startTime: {
        ...(filters.startFrom ? { [Op.gte]: filters.startFrom } : {}),
        ...(filters.startTo ? { [Op.lte]: filters.startTo } : {}),
      },
    });
  }
  if (
    typeof filters.capacityMin === 'number' ||
    typeof filters.capacityMax === 'number'
  ) {
    andParts.push({
      capacity: {
        ...(typeof filters.capacityMin === 'number'
          ? { [Op.gte]: filters.capacityMin }
          : {}),
        ...(typeof filters.capacityMax === 'number'
          ? { [Op.lte]: filters.capacityMax }
          : {}),
      },
    });
  }

  return andParts.length ? { [Op.and]: andParts } : {};
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

export class PickupSlotService {
  /**
   * Create a single slot.
   *
   * Guards:
   *  - Required fields
   *  - `startTime < endTime` (strict)
   *  - Duplicate (location+date+startTime+endTime) prevented by unique constraint
   *
   * @param input - Slot payload (location, date `YYYY-MM-DD`, start/end time `HH:mm`, capacity).
   * @returns The created slot as a plain JSON object.
   * @throws {BadRequestError} When required fields are missing or invalid.
   * @throws {DuplicateError} When a slot with same natural key already exists.
   */
  static async create(input: CreatePickupSlotDTO) {
    const { location, date, startTime, endTime, capacity } = input;

    if (!location?.trim()) throw new BadRequestError('location is required');
    if (!date?.trim())
      throw new BadRequestError('date (YYYY-MM-DD) is required');
    if (!startTime?.trim())
      throw new BadRequestError('startTime (HH:mm) is required');
    if (!endTime?.trim())
      throw new BadRequestError('endTime (HH:mm) is required');
    if (!timeLessEq(startTime, endTime) || startTime === endTime) {
      throw new BadRequestError('startTime must be strictly before endTime');
    }
    if (!Number.isFinite(capacity) || capacity! < 1) {
      throw new BadRequestError('capacity must be a positive integer');
    }

    try {
      const slot = await PickupSlotModel.create({
        location: location.trim(),
        date,
        startTime,
        endTime,
        capacity: Math.floor(capacity!),
        reserved: 0,
      });
      return slot.toJSON();
    } catch (err: any) {
      if (err instanceof UniqueConstraintError) {
        throw new DuplicateError(
          'A slot with the same (location, date, start, end) already exists'
        );
      }
      throw err;
    }
  }

  /**
   * Fetch one slot by id.
   * @param slotId - Primary key of the slot.
   * @returns The slot as a plain JSON object.
   * @throws {NotFoundError} If the slot does not exist.
   */
  static async getById(slotId: string) {
    const row = await PickupSlotModel.findByPk(slotId);
    if (!row) throw new NotFoundError('Pickup slot not found');
    return row.toJSON();
  }

  /**
   * Delete a single slot by id.
   * @param slotId - Primary key of the slot.
   * @returns `{ deleted: true }` when a row was removed.
   * @throws {NotFoundError} If the slot does not exist.
   */
  static async remove(slotId: string) {
    const count = await PickupSlotModel.destroy({ where: { slotId } });
    if (!count) throw new NotFoundError('Pickup slot not found');
    return { deleted: true };
  }

  /**
   * Delete all slots for the given `location` and `date`.
   * @param location - Location code/name.
   * @param date - Date in `YYYY-MM-DD` format.
   * @returns `{ deleted: number }` count of removed rows.
   * @throws {BadRequestError} If params are missing/invalid.
   */
  static async deleteByDay(location: string, date: string) {
    if (!location?.trim()) throw new BadRequestError('location is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestError('date must be YYYY-MM-DD');
    }
    const deleted = await PickupSlotModel.destroy({
      where: { location: location.trim(), date },
    });
    return { deleted };
  }

  /**
   * Generate slots for **one day** from time windows and a fixed interval.
   *
   * Each window `[start, end]` is split into adjacent slots of length `intervalMinutes`.
   * Duplicates are skipped (reported in `skipped`).
   *
   * @param params - Generation input (location, date, interval, capacity, windows).
   * @returns `{ created: Slot[], skipped: {startTime,endTime,reason}[] }`.
   * @throws {BadRequestError} For invalid inputs.
   */
  static async generateForDay(params: GenerateForDayParams) {
    const { location, date, intervalMinutes, capacity, windows } = params;

    if (!location?.trim()) throw new BadRequestError('location is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestError('date must be in YYYY-MM-DD format');
    }
    if (!Array.isArray(windows) || windows.length === 0) {
      throw new BadRequestError('windows must be a non-empty array');
    }
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      throw new BadRequestError('intervalMinutes must be a positive number');
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new BadRequestError('capacity must be a positive integer');
    }

    const created: any[] = [];
    const skipped: Array<{
      startTime: string;
      endTime: string;
      reason: string;
    }> = [];

    await withTransaction(async (t) => {
      for (const w of windows) {
        if (
          !w?.start ||
          !w?.end ||
          !timeLessEq(w.start, w.end) ||
          w.start === w.end
        ) {
          skipped.push({
            startTime: w?.start ?? '',
            endTime: w?.end ?? '',
            reason: 'bad window',
          });
          continue;
        }

        // Step by interval
        let slotStart = w.start;
        while (timeLessEq(addMinutes(slotStart, intervalMinutes), w.end)) {
          const slotEnd = addMinutes(slotStart, intervalMinutes);

          try {
            const row = await PickupSlotModel.create(
              {
                location: location.trim(),
                date,
                startTime: slotStart,
                endTime: slotEnd,
                capacity: Math.floor(capacity),
                reserved: 0,
              },
              { transaction: t }
            );
            created.push(row.toJSON());
          } catch (err: any) {
            if (err instanceof UniqueConstraintError) {
              skipped.push({
                startTime: slotStart,
                endTime: slotEnd,
                reason: 'duplicate',
              });
            } else {
              throw err;
            }
          }

          slotStart = slotEnd;
        }
      }
    });

    return { created, skipped };
  }

  /**
   * List slots with paging & sorting.
   * @param query - Pagination and sort options.
   * @returns `{ slots, total, page, pageSize, pages }`.
   */
  static async list(query: ListPickupSlotsQuery = {}) {
    const { page = 1, pageSize = 20, orderBy, orderDir } = query;

    const sort = normalizeSort<SlotOrderBy>(
      orderBy,
      orderDir,
      SLOT_ORDER_FIELDS,
      'date'
    );

    const options: FindOptions = {
      order: [[sort.orderBy, sort.orderDir]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    };

    const { rows, count } = await PickupSlotModel.findAndCountAll(options);
    return {
      slots: rows.map((r) => r.toJSON()),
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /**
   * Filter slots with paging & sorting.
   * @param query - Filters plus pagination/sort options.
   * @returns `{ slots, total, page, pageSize, pages }`.
   */
  static async filter(query: ListPickupSlotsQuery = {}) {
    const { page = 1, pageSize = 20, orderBy, orderDir, filters } = query;

    const sort = normalizeSort<SlotOrderBy>(
      orderBy,
      orderDir,
      SLOT_ORDER_FIELDS,
      'date'
    );
    const where = buildWhere(filters);

    const options: FindOptions = {
      where,
      order: [[sort.orderBy, sort.orderDir]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    };

    const { rows, count } = await PickupSlotModel.findAndCountAll(options);
    return {
      slots: rows.map((r) => r.toJSON()),
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /**
   * Generate slots for an entire **month** from a weekly schedule + interval.
   *
   * The weekly schedule is a map of weekday → [{ start, end }] windows.
   * For each day in the target month, matching windows are expanded into fixed-length slots.
   * Duplicate slots (by natural key) are skipped and reported.
   *
   * @param params - Location, month (`YYYY-MM`), interval, capacity, and weekly schedule.
   * @returns `{ created: Slot[], skipped: {date,startTime,endTime,reason}[] }`.
   * @throws {BadRequestError} For invalid inputs.
   */
  static async generateFromWeekScheduleForMonth(
    params: GenerateSlotsFromWeekScheduleParams
  ) {
    const {
      location,
      month, // 'YYYY-MM'
      intervalMinutes,
      capacity,
      schedule,
    } = params;

    if (!location?.trim()) throw new BadRequestError('location is required');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestError('month must be in YYYY-MM format');
    }
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      throw new BadRequestError('intervalMinutes must be a positive number');
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new BadRequestError('capacity must be a positive integer');
    }
    if (!schedule || typeof schedule !== 'object') {
      throw new BadRequestError('schedule is required');
    }

    // Build all target dates in the month
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const mon = parseInt(monthStr, 10); // 1..12

    // days in month
    const daysInMonth = new Date(year, mon, 0).getDate();

    // helper: map JS getDay() -> our Weekday
    const jsDayToWeekday = (d: number): Weekday =>
      (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[d];

    const created: any[] = [];
    const skipped: Array<{
      date: string;
      startTime: string;
      endTime: string;
      reason: string;
    }> = [];

    await withTransaction(async (t) => {
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(Date.UTC(year, mon - 1, day)); // use UTC to avoid TZ drift
        const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
        const weekday = jsDayToWeekday(date.getUTCDay());
        const windows = schedule[weekday];

        if (!windows || !windows.length) continue;

        for (const w of windows) {
          if (
            !w?.start ||
            !w?.end ||
            !timeLessEq(w.start, w.end) ||
            w.start === w.end
          ) {
            skipped.push({
              date: dateStr,
              startTime: w?.start ?? '',
              endTime: w?.end ?? '',
              reason: 'bad window',
            });
            continue;
          }

          // Generate slots inside the window by interval
          let slotStart = w.start;
          while (timeLessEq(addMinutes(slotStart, intervalMinutes), w.end)) {
            const slotEnd = addMinutes(slotStart, intervalMinutes);

            // Try to insert; skip duplicates
            try {
              const row = await PickupSlotModel.create(
                {
                  location: location.trim(),
                  date: dateStr,
                  startTime: slotStart,
                  endTime: slotEnd,
                  capacity: Math.floor(capacity),
                  reserved: 0,
                },
                { transaction: t }
              );
              created.push(row.toJSON());
            } catch (err: any) {
              if (err instanceof UniqueConstraintError) {
                skipped.push({
                  date: dateStr,
                  startTime: slotStart,
                  endTime: slotEnd,
                  reason: 'duplicate',
                });
              } else {
                throw err;
              }
            }

            slotStart = slotEnd;
          }
        }
      }
    });

    return { created, skipped };
  }
}

export const pickupSlotService = PickupSlotService;
