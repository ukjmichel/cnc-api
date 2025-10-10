// src/types/upcitemdb.types.ts

/**
 * =============================================================================
 * UPCItemDB API Types
 * =============================================================================
 */

export interface UPCItemDBItem {
  /** EAN-13, 13-digit European Article Number (aka. GTIN-13) */
  ean: string;

  /** Product title */
  title: string;

  /** Product description */
  description?: string;

  /** UPC code (12 digits) */
  upc?: string;

  /** Brand name */
  brand?: string;

  /** Model number */
  model?: string;

  /** Color */
  color?: string;

  /** Size information */
  size?: string;

  /** Dimension information */
  dimension?: string;

  /** Weight */
  weight?: string;

  /** Product category */
  category?: string;

  /** Currency code (USD, CAD, EUR, GBP, SEK) */
  currency?: string;

  /** Lowest recorded price */
  lowest_recorded_price?: number;

  /** Highest recorded price */
  highest_recorded_price?: number;

  /** Array of product image URLs */
  images?: string[];

  /** Array of merchant offers */
  offers?: UPCItemDBOffer[];

  /** eBay listing ID (if available) */
  elid?: string;

  /** ASIN (Amazon Standard Identification Number) */
  asin?: string;

  /** Additional fields */
  [key: string]: any;
}

export interface UPCItemDBOffer {
  /** Online store name */
  merchant: string;

  /** Online store domain */
  domain: string;

  /** Item name marketed by the merchant */
  title: string;

  /** Currency code */
  currency?: string;

  /** Original price from the store */
  list_price?: number | string;

  /** Sale price */
  price: number;

  /** Shipping information */
  shipping?: string;

  /** Condition: "New" or "Used" */
  condition?: string;

  /** Availability status */
  availability?: string;

  /** Shop link of the item */
  link: string;

  /** Unix timestamp of when the offer was last updated */
  updated_t?: number;
}

export interface UPCItemDBResponse {
  /** The queried code (UPC/EAN) */
  code: string;

  /** Total number of items found */
  total: number;

  /** Offset for pagination */
  offset: number;

  /** Array of found items */
  items: UPCItemDBItem[];
}

export interface UPCItemDBErrorResponse {
  /** Error code */
  code: string;

  /** Error message */
  message: string;
}

export interface UPCItemDBConfig {
  /** API key for paid plans (user_key) */
  apiKey?: string;

  /** Key type for paid plans (default: '3scale') */
  keyType?: string;

  /** Use free trial endpoint (default: true) */
  useTrial?: boolean;
}

export interface LookupOptions {
  /** Specific fields to extract from the item */
  fields?: (keyof UPCItemDBItem | string)[];

  /** Whether to include offers */
  includeOffers?: boolean;
}

export interface SearchOptions extends LookupOptions {
  /** Brand filter */
  brand?: string;

  /** Category filter */
  category?: string;

  /** Offset for pagination */
  offset?: number;

  /** Match type for search */
  match?: 'exact' | 'like';
}

export interface ApiUPCItem {
  /** The barcode (UPC/EAN) */
  barcode: string;

  /** Selected fields from the item */
  [key: string]: any;
}

export interface RateLimitInfo {
  /** Daily request limit */
  limit: number;

  /** Remaining requests */
  remaining: number;

  /** Unix timestamp when the limit resets */
  reset: number;
}
