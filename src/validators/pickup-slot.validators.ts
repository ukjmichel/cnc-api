// src/validators/pickup-slot.validator.ts
import type { Request, Response, NextFunction } from 'express';
import { body, query, param, validationResult } from 'express-validator';

/**
 * =============================================================================
 * Pickup Slot Validators — express-validator chains
 * =============================================================================
 * What this file provides
 *  - Reusable validation chains for each pickup-slot endpoint (create, list,
 *    filter, delete-by-day, generate/day, generate/month, param :slotId).
 *  - A tiny helper `assertValid` that converts express-validator errors into
 *    a normalized `ValidationError` forwarded to your global error handler.
 *
 * How to use
 *  - In your router, place the corresponding `v*` array(s) before the controller
 *    method. Example:
 *
 *      pickupSlotRouter.post(
 *        '/',
 *        requireAuth,
 *        requireEmployeeOrAdmin,
 *        vCreatePickupSlot,
 *        PickupSlotController.create
 *      );
 *
 *  - Ensure you have an error-handling middleware at the end of your app
 *    that formats `ValidationError` into a JSON response.
 *
 * Conventions
 *  - All date/time fields are validated as **strings** (no timezone math here).
 *  - Pagination/sort values are coerced to numbers with `.toInt()` where useful.
 *  - Keep ORDER_FIELDS/WEEKDAYS in sync with service/model logic.
 * =============================================================================
 */

/** Matches dates in YYYY-MM-DD (e.g., 2025-07-01). */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD

/** Matches months in YYYY-MM (e.g., 2025-07). */
export const MONTH_RE = /^\d{4}-\d{2}$/; // YYYY-MM

/**
 * Matches times in 24h "HH:mm" or "HH:mm:ss".
 * - Hours:   00..23
 * - Minutes: 00..59
 * - Seconds: 00..59 (optional)
 */
export const TIME_FLEX_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/; // HH:mm or HH:mm:ss

/**
 * Whitelisted sort fields accepted by list/filter endpoints.
 * Keep in sync with `SLOT_ORDER_FIELDS` in the service.
 */
export const ORDER_FIELDS = [
  'date',
  'startTime',
  'endTime',
  'capacity',
  'createdAt',
  'updatedAt',
] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];

/** Weekday keys used by the monthly generator (sun..sat). */
export const WEEKDAYS = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const;

/* -------------------------------------------------------------------------- */
/* Helper: assertValid → throws ValidationError (handled by global handler)    */
/* -------------------------------------------------------------------------- */

/**
 * Collects validation errors and forwards a normalized ValidationError to `next()`.
 * Does not send a response — your global error handler should format the output.
 *
 * Shape forwarded to `next(err)`:
 *  {
 *    name: 'ValidationError',
 *    status: 400,
 *    message: 'Validation failed',
 *    details: [
 *      { type, message, path, location, value, nestedErrors? },
 *      ...
 *    ]
 *  }
 */
export function assertValid(req: Request, _res: Response, next: NextFunction) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const err: any = new Error('Validation failed');
  err.name = 'ValidationError';
  err.status = 400;
  err.details = result.array().map((e) => ({
    type: (e as any).type,
    message: (e as any).msg,
    path: (e as any).path,
    location: (e as any).location,
    value: (e as any).value,
    ...((e as any).nestedErrors
      ? { nestedErrors: (e as any).nestedErrors }
      : {}),
  }));
  return next(err);
}

/* -------------------------------------------------------------------------- */
/* Validators                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/pickup-slots — create single slot
 * Body:
 *  - location:    string (required, non-empty)
 *  - date:        YYYY-MM-DD
 *  - startTime:   HH:mm or HH:mm:ss
 *  - endTime:     HH:mm or HH:mm:ss
 *  - capacity:    integer >= 1
 */
export const vCreatePickupSlot = [
  body('location')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('location is required'),
  body('date')
    .isString()
    .matches(DATE_RE)
    .withMessage('date must be YYYY-MM-DD'),
  body('startTime')
    .isString()
    .matches(TIME_FLEX_RE)
    .withMessage('startTime must be HH:mm or HH:mm:ss'),
  body('endTime')
    .isString()
    .matches(TIME_FLEX_RE)
    .withMessage('endTime must be HH:mm or HH:mm:ss'),
  body('capacity')
    .isInt({ min: 1 })
    .withMessage('capacity must be >= 1')
    .toInt(),
  assertValid,
];

/**
 * GET /api/pickup-slots — list with paging/sort
 * Query:
 *  - page?:      int >= 1
 *  - pageSize?:  int >= 1
 *  - orderBy?:   one of ORDER_FIELDS
 *  - orderDir?:  'ASC' | 'DESC'
 */
export const vListPickupSlots = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1 }).toInt(),
  query('orderBy')
    .optional()
    .isIn(ORDER_FIELDS as unknown as string[])
    .withMessage(`orderBy must be one of: ${ORDER_FIELDS.join(', ')}`),
  query('orderDir')
    .optional()
    .isIn(['ASC', 'DESC'])
    .withMessage('orderDir must be ASC or DESC'),
  assertValid,
];

/**
 * GET /api/pickup-slots/filter — advanced filters + paging/sort
 * Query:
 *  - location?:        string | string[]
 *  - dateFrom/dateTo?: YYYY-MM-DD
 *  - dates?:           string | string[] (each YYYY-MM-DD)
 *  - startFrom/To?:    HH:mm or HH:mm:ss
 *  - capacityMin/Max?: int >= 0
 *  - page/pageSize/orderBy/orderDir: like list
 */
export const vFilterPickupSlots = [
  query('location')
    .optional()
    .custom((v) => {
      if (Array.isArray(v))
        return v.every((s) => typeof s === 'string' && s.trim());
      return typeof v === 'string' || v === undefined;
    })
    .withMessage('location must be a string or array of strings'),
  query('dateFrom')
    .optional()
    .matches(DATE_RE)
    .withMessage('dateFrom must be YYYY-MM-DD'),
  query('dateTo')
    .optional()
    .matches(DATE_RE)
    .withMessage('dateTo must be YYYY-MM-DD'),
  query('dates')
    .optional()
    .custom((v) => {
      const arr = Array.isArray(v) ? v : [v];
      return arr.every((s) => typeof s === 'string' && DATE_RE.test(s));
    })
    .withMessage('dates must be a string or array of YYYY-MM-DD'),
  query('startFrom')
    .optional()
    .matches(TIME_FLEX_RE)
    .withMessage('startFrom must be HH:mm or HH:mm:ss'),
  query('startTo')
    .optional()
    .matches(TIME_FLEX_RE)
    .withMessage('startTo must be HH:mm or HH:mm:ss'),
  query('capacityMin').optional().isInt({ min: 0 }).toInt(),
  query('capacityMax').optional().isInt({ min: 0 }).toInt(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1 }).toInt(),
  query('orderBy')
    .optional()
    .isIn(ORDER_FIELDS as unknown as string[])
    .withMessage(`orderBy must be one of: ${ORDER_FIELDS.join(', ')}`),
  query('orderDir')
    .optional()
    .isIn(['ASC', 'DESC'])
    .withMessage('orderDir must be ASC or DESC'),
  assertValid,
];

/**
 * DELETE /api/pickup-slots/by-day — delete by (location, date)
 * Query:
 *  - location: string (required)
 *  - date:     YYYY-MM-DD (required)
 */
export const vDeleteByDay = [
  query('location')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('location is required'),
  query('date')
    .isString()
    .matches(DATE_RE)
    .withMessage('date must be YYYY-MM-DD'),
  assertValid,
];

/**
 * POST /api/pickup-slots/generate/day — generate for one day
 * Body:
 *  - location:        string
 *  - date:            YYYY-MM-DD
 *  - intervalMinutes: int >= 1
 *  - capacity:        int >= 1
 *  - windows:         [{ start, end }] with HH:mm or HH:mm:ss
 */
export const vGeneratePickupSlotsForDay = [
  body('location').isString().trim().notEmpty(),
  body('date').isString().matches(DATE_RE),
  body('intervalMinutes').isInt({ min: 1 }).toInt(),
  body('capacity').isInt({ min: 1 }).toInt(),
  body('windows').isArray({ min: 1 }),
  body('windows.*.start')
    .exists()
    .bail()
    .isString()
    .matches(TIME_FLEX_RE)
    .withMessage('windows[*].start must be HH:mm or HH:mm:ss'),
  body('windows.*.end')
    .exists()
    .bail()
    .isString()
    .matches(TIME_FLEX_RE)
    .withMessage('windows[*].end must be HH:mm or HH:mm:ss'),
  assertValid,
];

/**
 * POST /api/pickup-slots/generate/month — generate from weekly schedule
 * Body:
 *  - location:        string
 *  - month:           YYYY-MM
 *  - intervalMinutes: int >= 1
 *  - capacity:        int >= 1
 *  - schedule:        { sun|mon|...: [{start,end}, ...], ... }
 */
export const vGeneratePickupSlotsForMonth = [
  body('location').isString().trim().notEmpty(),
  body('month')
    .isString()
    .matches(MONTH_RE)
    .withMessage('month must be YYYY-MM'),
  body('intervalMinutes').isInt({ min: 1 }).toInt(),
  body('capacity').isInt({ min: 1 }).toInt(),
  body('schedule')
    .custom((val) => {
      if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
      return Object.entries(val).every(([k, v]) => {
        if (!(WEEKDAYS as readonly string[]).includes(k)) return false;
        if (!Array.isArray(v)) return false;
        return v.every(
          (w: any) =>
            w &&
            typeof w === 'object' &&
            TIME_FLEX_RE.test(String(w.start || '')) &&
            TIME_FLEX_RE.test(String(w.end || ''))
        );
      });
    })
    .withMessage(
      'schedule must be an object keyed by weekday (sun..sat) with arrays of {start,end} as HH:mm or HH:mm:ss'
    ),
  assertValid,
];

/**
 * Common :slotId path param (UUID).
 * Use on GET/DELETE /api/pickup-slots/:slotId
 */
export const vParamSlotId = [
  param('slotId').isUUID().withMessage('slotId must be a UUID'),
  assertValid,
];
