// src/services/openfoodfacts.service.ts

/**
 * =============================================================================
 * OpenFoodFactsService – External API Integration Layer
 * =============================================================================
 * Responsibilities
 *  - Fetch product data from OpenFoodFacts API by barcode
 *  - Support selective field extraction
 *  - Handle API errors and map to custom error types
 *  - Cache responses (optional, can be added later)
 *
 * Conventions
 *  - Return clean, typed product objects
 *  - Throw NotFoundError if product doesn't exist
 *  - Throw standard Error for API failures
 * =============================================================================
 */

import type {
  OpenFoodFactsResponse,
  OpenFoodFactsProduct,
  ProductQueryOptions,
  ApiProduct,
} from '../types/openfoodfacts.types.js';

import { NotFoundError } from '../errors/index.js';

export class OpenFoodFactsService {
  private static readonly BASE_URL = 'https://world.openfoodfacts.org/api/v0';

  /**
   * Fetch a product by barcode with optional field selection.
   *
   * @param {string} barcode - The product barcode (EAN/UPC)
   * @param {ProductQueryOptions} [options] - Query options including field selection
   * @returns {Promise<ApiProduct>} The product data with selected fields
   * @throws {NotFoundError} If the product is not found
   * @throws {Error} If the API request fails
   */
  static async getProductByBarcode(
    barcode: string,
    options?: ProductQueryOptions
  ): Promise<ApiProduct> {
    try {
      const url = `${this.BASE_URL}/product/${barcode}.json`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data: OpenFoodFactsResponse = await response.json();

      if (data.status === 0 || !data.product) {
        throw new NotFoundError(`Product with barcode ${barcode} not found`);
      }

      return this.extractFields(barcode, data.product, options);
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw err;
      }
      if (err instanceof Error) {
        throw new Error(`Failed to fetch product: ${err.message}`);
      }
      throw new Error('Failed to fetch product: Unknown error');
    }
  }

  /**
   * Fetch multiple products by barcodes.
   *
   * @param {string[]} barcodes - Array of product barcodes
   * @param {ProductQueryOptions} [options] - Query options
   * @returns {Promise<ApiProduct[]>} Array of found products (skips not found)
   */
  static async getProductsByBarcodes(
    barcodes: string[],
    options?: ProductQueryOptions
  ): Promise<ApiProduct[]> {
    const promises = barcodes.map((barcode) =>
      this.getProductByBarcode(barcode, options).catch(() => null)
    );

    const results = await Promise.all(promises);
    return results.filter((product): product is ApiProduct => product !== null);
  }

  /**
   * Search products by name or category (uses OpenFoodFacts search API).
   *
   * @param {string} query - Search query string
   * @param {ProductQueryOptions & { page?: number; pageSize?: number }} [options]
   * @returns {Promise<{ products: ApiProduct[]; count: number; page: number }>}
   */
  static async searchProducts(
    query: string,
    options?: ProductQueryOptions & { page?: number; pageSize?: number }
  ): Promise<{ products: ApiProduct[]; count: number; page: number }> {
    try {
      const page = options?.page ?? 1;
      const pageSize = options?.pageSize ?? 20;

      const url = new URL(`${this.BASE_URL}/cgi/search.pl`);
      url.searchParams.append('search_terms', query);
      url.searchParams.append('page', page.toString());
      url.searchParams.append('page_size', pageSize.toString());
      url.searchParams.append('json', '1');

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Search request failed with status ${response.status}`);
      }

      const data = await response.json();

      const products = (data.products || []).map(
        (product: OpenFoodFactsProduct) =>
          this.extractFields(product.code || '', product, options)
      );

      return {
        products,
        count: data.count || 0,
        page,
      };
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(`Failed to search products: ${err.message}`);
      }
      throw new Error('Failed to search products: Unknown error');
    }
  }

  /**
   * Extract selected fields from a product.
   *
   * @param {string} barcode - The product barcode
   * @param {OpenFoodFactsProduct} product - Full product data
   * @param {ProductQueryOptions} [options] - Field selection options
   * @returns {ApiProduct} Product with selected fields
   */
  private static extractFields(
    barcode: string,
    product: OpenFoodFactsProduct,
    options?: ProductQueryOptions
  ): ApiProduct {
    const result: ApiProduct = { barcode };

    // If no fields specified, return all product data
    if (!options?.fields || options.fields.length === 0) {
      return { barcode, ...product };
    }

    // Extract only requested fields
    for (const field of options.fields) {
      if (field in product) {
        const value = product[field as keyof OpenFoodFactsProduct];

        // Special handling for nutriments
        if (field === 'nutriments' && !options.includeAllNutriments) {
          // Only include basic nutriments unless specified otherwise
          const nutriments = value as OpenFoodFactsProduct['nutriments'];
          result[field] = {
            energy_100g: nutriments?.energy_100g,
            fat_100g: nutriments?.fat_100g,
            carbohydrates_100g: nutriments?.carbohydrates_100g,
            proteins_100g: nutriments?.proteins_100g,
            salt_100g: nutriments?.salt_100g,
          };
        } else {
          result[field] = value;
        }
      }
    }

    return result;
  }

  /**
   * Helper to get common product fields (convenience method).
   *
   * @param {string} barcode - The product barcode
   * @returns {Promise<ApiProduct>} Product with common fields
   */
  static async getProductBasicInfo(barcode: string): Promise<ApiProduct> {
    return this.getProductByBarcode(barcode, {
      fields: [
        'product_name',
        'brands',
        'quantity',
        'image_url',
        'nutriscore_grade',
        'categories',
      ],
    });
  }

  /**
   * Helper to get product with nutritional information.
   *
   * @param {string} barcode - The product barcode
   * @returns {Promise<ApiProduct>} Product with nutrition data
   */
  static async getProductNutrition(barcode: string): Promise<ApiProduct> {
    return this.getProductByBarcode(barcode, {
      fields: [
        'product_name',
        'brands',
        'quantity',
        'nutriments',
        'nutriscore_grade',
        'nova_group',
      ],
      includeAllNutriments: true,
    });
  }
}

export const openFoodFactsService = OpenFoodFactsService;
