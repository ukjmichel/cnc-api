// src/types/order.ts
/**
 * =============================================================================
 * Order — shared types (DTOs, filters, list/query contracts)
 * =============================================================================
 * Keep in sync with:
 *  - models/order.model.ts
 *  - queries/order.queries.ts
 *  - services/order.service.ts
 * =============================================================================
 */

/* ---------- Core domain ---------- */

export type OrderStatus =
  | 'draft'
  | 'pending'
  | 'paid'
  | 'cancelled'
  | 'fulfilled'
  | 'refunded';

/* ---------- DTOs ---------- */

export interface CreateOrderDTO {
  userId?: string | null;
  status?: OrderStatus; // default 'pending'
  subtotal?: string; // DECIMAL as string
  taxTotal?: string; // DECIMAL as string
  grandTotal?: string; // DECIMAL as string
  currency?: string; // default 'USD'
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  pickupSlotId?: string | null; // optional initial slot assignment
}

export interface UpdateTotalsDTO {
  subtotal: string; // DECIMAL as string
  taxTotal: string; // DECIMAL as string
  grandTotal: string; // DECIMAL as string
  currency?: string;
}

export interface UpdateContactDTO {
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
}

/* ---------- Sorting & paging ---------- */

export type OrderOrderBy = 'createdAt' | 'updatedAt' | 'grandTotal' | 'status';
export type OrderDir = 'ASC' | 'DESC';

/* ---------- Filters & queries ---------- */

export interface OrderFilters {
  userId?: string;
  status?: OrderStatus | OrderStatus[];
  /** null => unassigned, uuid => that slot */
  pickupSlotId?: string | null;
  /** Inclusive lower bound on createdAt (ISO date/time) */
  dateFrom?: string;
  /** Inclusive upper bound on createdAt (ISO date/time) */
  dateTo?: string;
  /** Optional: numeric range on grandTotal (useful for admin/reporting) */
  grandTotalMin?: number;
  grandTotalMax?: number;
}

export interface ListOrdersQuery {
  page?: number; // default 1
  pageSize?: number; // default 20
  orderBy?: OrderOrderBy; // default 'createdAt'
  orderDir?: OrderDir; // default 'DESC'
  filters?: OrderFilters;
  /** Optional: include line items in results (alias: 'items') */
  includeItems?: boolean;
}

/** Standard list result with pagination meta. */
export interface ListOrdersResult {
  orders: any[]; // plain JSON rows (optionally with items[])
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
