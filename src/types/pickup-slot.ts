// src/types/pickup-slot.ts
/**
 * =============================================================================
 * Pickup Slot — shared types (DTOs, filters, generators)
 * =============================================================================
 * Kept in sync with:
 *  - models/pickup-slot.model.ts
 *  - services/pickup-slot.service.ts
 * =============================================================================
 */

/* ---------- Core domain ---------- */

export type SlotStatus = 'open' | 'closed';

/** Persisted shape (what the model exposes) */
export interface PickupSlotAttributes {
  slotId: string; // UUID PK
  location: string; // store / warehouse code
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm:ss   (model stores TIME)
  endTime: string; // HH:mm:ss
  capacity: number; // >= 0
  reservedCount: number; // >= 0  (matches model column)
  status: SlotStatus; // 'open' | 'closed'
  createdAt: Date;
  updatedAt: Date;
}

/* ---------- DTOs (controller/service inputs) ---------- */

export interface CreatePickupSlotDTO {
  location: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm or HH:mm:ss (service normalizes)
  endTime: string; // HH:mm or HH:mm:ss
  capacity: number; // >= 1
  status?: SlotStatus; // default: 'open'
  reservedCount?: number; // default: 0
}

export interface UpdatePickupSlotDTO {
  capacity?: number;
  status?: SlotStatus;
  reservedCount?: number; // optional admin override
}

/* ---------- Listing / filtering ---------- */

export interface PickupSlotFilters {
  /** one or many locations */
  location?: string[]; // e.g. ['STORE-1', 'STORE-2']
  /** inclusive date range (YYYY-MM-DD) */
  dateFrom?: string;
  dateTo?: string;
  /** explicit list of dates */
  dates?: string[];
  /** start-time window (HH:mm or HH:mm:ss) */
  startFrom?: string;
  startTo?: string;
  /** capacity range */
  capacityMin?: number;
  capacityMax?: number;
  /** status filter (single or many) */
  status?: SlotStatus | SlotStatus[];
}

export type SlotOrderBy =
  | 'date'
  | 'startTime'
  | 'endTime'
  | 'capacity'
  | 'createdAt'
  | 'updatedAt';

export type OrderDir = 'ASC' | 'DESC';

export interface ListPickupSlotsQuery {
  filters?: PickupSlotFilters;
  page?: number; // default 20 in service
  pageSize?: number; // default 20 in service
  orderBy?: SlotOrderBy; // default 'date' (service normalizes)
  orderDir?: OrderDir; // default 'ASC' (service normalizes)
}

/* ---------- Generators ---------- */

export interface DayWindow {
  start: string; // 'HH:mm' or 'HH:mm:ss'
  end: string; // 'HH:mm' or 'HH:mm:ss'
}

/** Weekday keys used by the service schedule: Sun..Sat */
export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export type WeekSchedule = Partial<Record<Weekday, DayWindow[]>>;

export interface GenerateSlotsFromWeekScheduleParams {
  location: string;
  /** Month in 'YYYY-MM' (e.g., '2025-10') */
  month: string;
  /** Slot length, in minutes (>0) */
  intervalMinutes: number;
  /** Capacity per slot (>=1) */
  capacity: number;
  /** Weekly schedule (e.g., { mon: [{start:'09:00', end:'12:00'}], ... }) */
  schedule: WeekSchedule;
}

export interface GenerateSlotsForDayParams {
  location: string;
  date: string; // YYYY-MM-DD
  intervalMinutes: number; // > 0
  capacity: number; // >= 1
  windows: DayWindow[]; // one or more windows for that day
}

/* ---------- Service results ---------- */

export interface ListPickupSlotsResult {
  slots: PickupSlotAttributes[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface DeleteByDayResult {
  deleted: number;
}

export interface DeleteOneResult {
  deleted: true;
}

export interface GenerateSummary {
  created: PickupSlotAttributes[];
  skipped: Array<{
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
  }>;
}
