// src/services/upcitemdb.service.ts

/**
 * =============================================================================
 * UPCItemDBService – External API Integration Layer
 * =============================================================================
 * Responsibilities
 *  - Fetch product data from UPCItemDB API by UPC/EAN/GTIN/ISBN
 *  - Support search functionality with brand/category filters
 *  - Support selective field extraction
 *  - Handle API errors and rate limits
 *  - Support both free trial and paid API plans
 *
 * Conventions
 *  - Return clean, typed product objects
 *  - Throw NotFoundError if product doesn't exist
 *  - Throw standard Error for API failures
 *  - Track rate limit information from response headers
 * =============================================================================
 */

import type {
  UPCItemDBResponse,
  UPCItemDBItem,
  UPCItemDBConfig,
  UPCItemDBErrorResponse,
  LookupOptions,
  SearchOptions,
  ApiUPCItem,
  RateLimitInfo,
} from '../types/upcitemdb.types.js';

import { NotFoundError } from '../errors/index.js';

export class UPCItemDBService {
  private static config: UPCItemDBConfig = {
    useTrial: true,
    keyType: '3scale',
  };

  private static rateLimitInfo: RateLimitInfo | null = null;

  /**
   * Configure the service with API credentials.
   *
   * @param {UPCItemDBConfig} config - Configuration options
   */
  static configure(config: UPCItemDBConfig): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current rate limit information.
   *
   * @returns {RateLimitInfo | null} Rate limit info or null if not available
   */
  static getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Get the base URL based on configuration.
   */
  private static getBaseUrl(): string {
    return this.config.useTrial
      ? 'https://api.upcitemdb.com/prod/trial'
      : 'https://api.upcitemdb.com/prod/v1';
  }

  /**
   * Get request headers based on configuration.
   */
  private static getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };

    if (!this.config.useTrial && this.config.apiKey) {
      headers['user_key'] = this.config.apiKey;
      headers['key_type'] = this.config.keyType || '3scale';
    }

    return headers;
  }

  /**
   * Update rate limit info from response headers.
   */
  private static updateRateLimitInfo(headers: Headers): void {
    const limit = headers.get('X-RateLimit-Limit');
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');

    if (limit && remaining && reset) {
      this.rateLimitInfo = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset: parseInt(reset, 10),
      };
    }
  }

  /**
   * Lookup a product by UPC/EAN/GTIN/ISBN code.
   *
   * @param {string} code - The barcode (UPC, EAN, GTIN, or ISBN)
   * @param {LookupOptions} [options] - Query options including field selection
   * @returns {Promise<ApiUPCItem>} The product data with selected fields
   * @throws {NotFoundError} If the product is not found
   * @throws {Error} If the API request fails
   */
  static async lookup(
    code: string,
    options?: LookupOptions
  ): Promise<ApiUPCItem> {
    try {
      const url = `${this.getBaseUrl()}/lookup?upc=${encodeURIComponent(code)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      this.updateRateLimitInfo(response.headers);

      if (!response.ok) {
        if (response.status === 404) {
          throw new NotFoundError(`Product with code ${code} not found`);
        }
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        if (response.status === 401) {
          throw new Error('Authentication failed. Check your API key.');
        }
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data: UPCItemDBResponse | UPCItemDBErrorResponse =
        await response.json();

      if ('message' in data) {
        if (data.code === 'NOT_FOUND') {
          throw new NotFoundError(`Product with code ${code} not found`);
        }
        throw new Error(data.message);
      }

      if (data.total === 0 || !data.items || data.items.length === 0) {
        throw new NotFoundError(`Product with code ${code} not found`);
      }

      const item = data.items[0];
      return this.extractFields(code, item, options);
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw err;
      }
      if (err instanceof Error) {
        throw new Error(`Failed to lookup product: ${err.message}`);
      }
      throw new Error('Failed to lookup product: Unknown error');
    }
  }

  /**
   * Lookup multiple products by codes.
   *
   * @param {string[]} codes - Array of barcodes
   * @param {LookupOptions} [options] - Query options
   * @returns {Promise<ApiUPCItem[]>} Array of found products
   */
  static async lookupBatch(
    codes: string[],
    options?: LookupOptions
  ): Promise<ApiUPCItem[]> {
    const promises = codes.map((code) =>
      this.lookup(code, options).catch(() => null)
    );

    const results = await Promise.all(promises);
    return results.filter((item): item is ApiUPCItem => item !== null);
  }

  /**
   * Search products by query string with optional filters.
   *
   * @param {string} query - Search query string
   * @param {SearchOptions} [options] - Search options including filters
   * @returns {Promise<{ items: ApiUPCItem[]; total: number; offset: number }>}
   */
  static async search(
    query: string,
    options?: SearchOptions
  ): Promise<{ items: ApiUPCItem[]; total: number; offset: number }> {
    try {
      const params = new URLSearchParams();
      params.append('s', query);

      if (options?.brand) {
        params.append('brand', options.brand);
      }
      if (options?.category) {
        params.append('category', options.category);
      }
      if (options?.offset !== undefined) {
        params.append('offset', options.offset.toString());
      }
      if (options?.match) {
        params.append('match_mode', options.match);
      }

      const url = `${this.getBaseUrl()}/search?${params.toString()}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      this.updateRateLimitInfo(response.headers);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        if (response.status === 401) {
          throw new Error('Authentication failed. Check your API key.');
        }
        throw new Error(`Search request failed with status ${response.status}`);
      }

      const data: UPCItemDBResponse | UPCItemDBErrorResponse =
        await response.json();

      if ('message' in data) {
        throw new Error(data.message);
      }

      const items = data.items.map((item) =>
        this.extractFields(item.ean, item, options)
      );

      return {
        items,
        total: data.total,
        offset: data.offset,
      };
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(`Failed to search products: ${err.message}`);
      }
      throw new Error('Failed to search products: Unknown error');
    }
  }

  /**
   * Search products by brand.
   *
   * @param {string} brand - Brand name
   * @param {SearchOptions} [options] - Search options
   * @returns {Promise<{ items: ApiUPCItem[]; total: number; offset: number }>}
   */
  static async searchByBrand(
    brand: string,
    options?: Omit<SearchOptions, 'brand'>
  ): Promise<{ items: ApiUPCItem[]; total: number; offset: number }> {
    return this.search('', { ...options, brand });
  }

  /**
   * Search products by category.
   *
   * @param {string} category - Category name
   * @param {SearchOptions} [options] - Search options
   * @returns {Promise<{ items: ApiUPCItem[]; total: number; offset: number }>}
   */
  static async searchByCategory(
    category: string,
    options?: Omit<SearchOptions, 'category'>
  ): Promise<{ items: ApiUPCItem[]; total: number; offset: number }> {
    return this.search('', { ...options, category });
  }

  /**
   * Extract selected fields from an item.
   *
   * @param {string} barcode - The product barcode
   * @param {UPCItemDBItem} item - Full item data
   * @param {LookupOptions} [options] - Field selection options
   * @returns {ApiUPCItem} Item with selected fields
   */
  private static extractFields(
    barcode: string,
    item: UPCItemDBItem,
    options?: LookupOptions
  ): ApiUPCItem {
    const result: ApiUPCItem = { barcode };

    // If no fields specified, return all item data
    if (!options?.fields || options.fields.length === 0) {
      return { barcode, ...item };
    }

    // Extract only requested fields
    for (const field of options.fields) {
      if (field in item) {
        const value = item[field as keyof UPCItemDBItem];

        // Handle offers special case
        if (field === 'offers' && !options.includeOffers) {
          result[field] = [];
        } else {
          result[field] = value;
        }
      }
    }

    return result;
  }

  /**
   * Helper to get basic product information (convenience method).
   *
   * @param {string} code - The barcode
   * @returns {Promise<ApiUPCItem>} Product with basic fields
   */
  static async getBasicInfo(code: string): Promise<ApiUPCItem> {
    return this.lookup(code, {
      fields: ['title', 'brand', 'description', 'images', 'category'],
    });
  }

  /**
   * Helper to get product with pricing information.
   *
   * @param {string} code - The barcode
   * @returns {Promise<ApiUPCItem>} Product with pricing data
   */
  static async getPricing(code: string): Promise<ApiUPCItem> {
    return this.lookup(code, {
      fields: [
        'title',
        'brand',
        'currency',
        'lowest_recorded_price',
        'highest_recorded_price',
        'offers',
      ],
      includeOffers: true,
    });
  }

  /**
   * Helper to get product with full details including offers.
   *
   * @param {string} code - The barcode
   * @returns {Promise<ApiUPCItem>} Product with all available data
   */
  static async getFullDetails(code: string): Promise<ApiUPCItem> {
    return this.lookup(code, {
      includeOffers: true,
    });
  }
}

export const upcItemDBService = UPCItemDBService;
