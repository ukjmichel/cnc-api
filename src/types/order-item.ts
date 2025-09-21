/**
 * =============================================================================
 * OrderItem Types
 * =============================================================================
 * Shared TypeScript interfaces for order-item operations.
 * - Attributes reflect DB columns.
 * - DTOs are used for API requests/responses.
 * =============================================================================
 */

export interface OrderItemAttributes {
  orderId: string;
  stockId: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Create DTO — frontend may omit unitPrice (defaults to stock price) */
export interface CreateOrderItemDTO {
  orderId: string;
  stockId: string;
  quantity: string;
  unitPrice?: string;
  lineTotal?: string;
}

/** Update DTO — allow changing quantity or unitPrice */
export interface UpdateOrderItemDTO {
  quantity?: string;
  unitPrice?: string;
  lineTotal?: string;
}

/** Filtering options for queries */
export interface OrderItemFilters {
  orderId?: string;
  stockId?: string;
  productId?: string;
  createdFrom?: string;
  createdTo?: string;
  quantityMin?: number;
  quantityMax?: number;
  unitPriceMin?: number;
  unitPriceMax?: number;
  lineTotalMin?: number;
  lineTotalMax?: number;
}

export type OrderItemOrderBy =
  | 'createdAt'
  | 'updatedAt'
  | 'quantity'
  | 'unitPrice'
  | 'lineTotal';

export interface ListOrderItemsQuery {
  page?: number;
  pageSize?: number;
  orderBy?: OrderItemOrderBy;
  orderDir?: 'asc' | 'desc';
  filters?: OrderItemFilters;
}

export interface ListOrderItemsResult {
  items: OrderItemAttributes[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
