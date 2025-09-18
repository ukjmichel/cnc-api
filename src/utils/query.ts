// src/utils/query.ts
export type OrderDir = 'ASC' | 'DESC';

export type StringMatch = 'exact' | 'like' | 'startsWith' | 'endsWith';

export function parseStringMatch(v: unknown): StringMatch {
  const s = String(v ?? '').toLowerCase();
  if (s === 'exact' || s === 'like') return s as StringMatch;
  if (s === 'startswith') return 'startsWith';
  if (s === 'endswith') return 'endsWith';
  return 'like';
}

export function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

export function qsArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

export function qsNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function qsBool(v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return undefined;
}

/**
 * Normalize orderBy/orderDir with a whitelist of allowed fields.
 */
export function normalizeSort<T extends string>(
  orderBy: unknown,
  orderDir: unknown,
  allowed: readonly T[], // <-- pass an `as const` array here
  fallbackField: T
): { orderBy: T; orderDir: OrderDir } {
  const allowedSet = new Set<string>(allowed as readonly string[]);
  const ob = allowedSet.has(String(orderBy))
    ? (String(orderBy) as T)
    : fallbackField;

  const dir = String(orderDir || '').toUpperCase();
  const od: OrderDir = (
    dir === 'ASC' || dir === 'DESC' ? dir : 'DESC'
  ) as OrderDir;

  return { orderBy: ob, orderDir: od };
}