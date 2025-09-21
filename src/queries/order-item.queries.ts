/**
 * =============================================================================
 * OrderItem Queries
 * =============================================================================
 * Helpers for filtering, sorting, and paginating order items with Sequelize.
 * Supports filters for:
 * - quantity range
 * - unitPrice range
 * - lineTotal range
 * - createdAt range
 * =============================================================================
 */

import { Op, WhereOptions, FindOptions } from 'sequelize';
import { OrderItemModel } from '../models/order-item.model.js';
import {
  ListOrderItemsQuery,
  OrderItemFilters,
  OrderItemOrderBy,
  ListOrderItemsResult,
} from '../types/order-item.js';
import { normalizeSort, toInt } from '../utils/query.js';

export const ORDER_ITEM_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'quantity',
  'unitPrice',
  'lineTotal',
] as const;

/** Build Sequelize WHERE clause from filters */
function buildWhere(filters?: OrderItemFilters): WhereOptions {
  if (!filters) return {};
  const and: WhereOptions[] = [];

  if (filters.orderId) and.push({ orderId: filters.orderId });
  if (filters.stockId) and.push({ stockId: filters.stockId });

  if (filters.createdFrom || filters.createdTo) {
    and.push({
      createdAt: {
        ...(filters.createdFrom
          ? { [Op.gte]: new Date(filters.createdFrom) }
          : {}),
        ...(filters.createdTo ? { [Op.lte]: new Date(filters.createdTo) } : {}),
      },
    });
  }

  const toDec = (n?: number) => (typeof n === 'number' ? String(n) : undefined);

  if (filters.quantityMin !== undefined || filters.quantityMax !== undefined) {
    and.push({
      quantity: {
        ...(toDec(filters.quantityMin)
          ? { [Op.gte]: toDec(filters.quantityMin) }
          : {}),
        ...(toDec(filters.quantityMax)
          ? { [Op.lte]: toDec(filters.quantityMax) }
          : {}),
      },
    });
  }

  if (
    filters.unitPriceMin !== undefined ||
    filters.unitPriceMax !== undefined
  ) {
    and.push({
      unitPrice: {
        ...(toDec(filters.unitPriceMin)
          ? { [Op.gte]: toDec(filters.unitPriceMin) }
          : {}),
        ...(toDec(filters.unitPriceMax)
          ? { [Op.lte]: toDec(filters.unitPriceMax) }
          : {}),
      },
    });
  }

  if (
    filters.lineTotalMin !== undefined ||
    filters.lineTotalMax !== undefined
  ) {
    and.push({
      lineTotal: {
        ...(toDec(filters.lineTotalMin)
          ? { [Op.gte]: toDec(filters.lineTotalMin) }
          : {}),
        ...(toDec(filters.lineTotalMax)
          ? { [Op.lte]: toDec(filters.lineTotalMax) }
          : {}),
      },
    });
  }

  return and.length ? { [Op.and]: and } : {};
}

/** Main query with pagination and sorting */
export async function filterOrderItems(
  query: ListOrderItemsQuery = {}
): Promise<ListOrderItemsResult> {
  const page = toInt(query.page, 1);
  const pageSize = toInt(query.pageSize, 20);

  const sort = normalizeSort<OrderItemOrderBy>(
    query.orderBy,
    query.orderDir,
    ORDER_ITEM_SORT_FIELDS,
    'createdAt'
  );

  const where = buildWhere(query.filters);

  const options: FindOptions = {
    where,
    order: [[sort.orderBy, sort.orderDir]],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const { rows, count } = await OrderItemModel.findAndCountAll(options);

  return {
    items: rows.map((r) => r.toJSON()),
    total: count,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(count / pageSize)),
  };
}
