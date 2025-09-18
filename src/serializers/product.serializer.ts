// src/serializers/product.serializer.ts
import type { ProductAttributes } from '../types/product.js';

/** Exact response shape we want to expose */
export type SerializedProduct = Pick<
  ProductAttributes,
  | 'productId'
  | 'productCode'
  | 'productName'
  | 'brands'
  | 'description'
  | 'quantity'
  | 'quantityUnit'
>;

export function serializeProduct(input: unknown): SerializedProduct {
  const p = (input ?? {}) as Partial<ProductAttributes> &
    Record<string, unknown>;

  const productId = typeof p.productId === 'string' ? p.productId : '';
  const productName = typeof p.productName === 'string' ? p.productName : '';

  // keep nullables as null (not undefined), coerce quantity to number when possible
  const productCode = (p.productCode ?? null) as string | null;
  const brands = (p.brands ?? null) as string | null;
  const description = (p.description ?? null) as string | null;

  let quantity: number | null = null;
  if (typeof p.quantity === 'number') quantity = p.quantity;
  else if (p.quantity != null && p.quantity !== '') {
    const n = Number(p.quantity);
    quantity = Number.isFinite(n) ? n : null;
  }

  const quantityUnit = (p.quantityUnit ?? null) as string | null;

  // Order matters in object literal insertion order
  return {
    productId,
    productCode,
    productName,
    brands,
    description,
    quantity, 
    quantityUnit, 
  };
}

export function serializeProducts(arr: unknown[]): SerializedProduct[] {
  return (arr ?? []).map(serializeProduct);
}
