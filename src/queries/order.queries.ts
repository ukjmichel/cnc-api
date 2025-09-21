// src/queries/order.queries.ts
/**
 * =============================================================================
 * Order queries — filter/sort/paginate helpers (Sequelize)
 * =============================================================================
 */

import { Op, WhereOptions, FindOptions, Includeable } from 'sequelize';
import { OrderModel } from '../models/order.model.js';
import { OrderItemModel } from '../models/order-item.model.js';
import {
  ListOrdersQuery,
  OrderFilters,
  OrderOrderBy,
  ListOrdersResult,
} from '../types/order.js';
import { normalizeSort } from '../utils/query.js';

/* -------------------------------------------------------------------------- */
/* Allowed sort fields — readonly array to satisfy normalizeSort()             */
/* -------------------------------------------------------------------------- */
export const ORDER_ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'grandTotal',
  'status',
] as const;

/* -------------------------------------------------------------------------- */
/* WHERE builder                                                              */
/* -------------------------------------------------------------------------- */
function buildWhere(filters?: OrderFilters): WhereOptions {
  if (!filters) return {};

  const and: WhereOptions[] = [];

  // Filter by user
  if (typeof filters.userId === 'string' && filters.userId.trim()) {
    and.push({ userId: filters.userId.trim() });
  }

  // pickupSlotId: allow null (unassigned) or a specific UUID
  if (filters.pickupSlotId !== undefined) {
    and.push({ pickupSlotId: filters.pickupSlotId });
  }

  // status: single or array
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      if (filters.status.length) {
        and.push({ status: { [Op.in]: filters.status } });
      }
    } else {
      and.push({ status: filters.status });
    }
  }

  // createdAt range from dateFrom/dateTo (inclusive)
  if (filters.dateFrom || filters.dateTo) {
    and.push({
      createdAt: {
        ...(filters.dateFrom ? { [Op.gte]: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { [Op.lte]: new Date(filters.dateTo) } : {}),
      },
    });
  }

  // grandTotal numeric-ish bounds (DECIMAL field in DB; compare as strings is fine for positive values)
  if (
    typeof filters.grandTotalMin === 'number' ||
    typeof filters.grandTotalMax === 'number'
  ) {
    and.push({
      grandTotal: {
        ...(typeof filters.grandTotalMin === 'number'
          ? { [Op.gte]: String(filters.grandTotalMin) }
          : {}),
        ...(typeof filters.grandTotalMax === 'number'
          ? { [Op.lte]: String(filters.grandTotalMax) }
          : {}),
      },
    });
  }

  return and.length ? { [Op.and]: and } : {};
}

/* -------------------------------------------------------------------------- */
/* Public query                                                               */
/* -------------------------------------------------------------------------- */
export type FilterOrdersQuery = ListOrdersQuery;

export async function filterOrders(
  query: FilterOrdersQuery = {}
): Promise<ListOrdersResult> {
  const page =
    Number.isFinite(query.page) && (query.page as number) > 0
      ? (query.page as number)
      : 1;
  const pageSize =
    Number.isFinite(query.pageSize) && (query.pageSize as number) > 0
      ? (query.pageSize as number)
      : 20;

  const sort = normalizeSort<OrderOrderBy>(
    query.orderBy,
    query.orderDir,
    ORDER_ORDER_FIELDS,
    'createdAt'
  );

  const where = buildWhere(query.filters);
  const include: Includeable[] = [];

  if (query.includeItems) {
    include.push({
      model: OrderItemModel,
      as: 'items',
      required: false,
    });
  }

  const options: FindOptions = {
    where,
    order: [[sort.orderBy, sort.orderDir]],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    include,
  };

  const { rows, count } = await OrderModel.findAndCountAll(options);

  const orders = rows.map((row) => {
    const base = row.toJSON() as any;
    // Inject items when included (OrderModel.toJSON() doesn't expose them)
    const items = (row as any).items as OrderItemModel[] | undefined;
    if (items) base.items = items.map((it) => it.toJSON());
    return base;
  });

  return {
    orders,
    total: count,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(count / pageSize)),
  };
}
