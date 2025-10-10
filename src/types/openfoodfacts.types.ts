// src/types/openfoodfacts.types.ts

/**
 * =============================================================================
 * OpenFoodFacts API Types
 * =============================================================================
 */

export interface OpenFoodFactsProduct {
  // Basic info
  product_name?: string;
  generic_name?: string;
  brands?: string;
  categories?: string;
  labels?: string;
  quantity?: string;

  // Identification
  code?: string; // barcode
  _id?: string;

  // Nutrition
  nutriments?: {
    energy_100g?: number;
    energy_unit?: string;
    fat_100g?: number;
    saturated_fat_100g?: number;
    carbohydrates_100g?: number;
    sugars_100g?: number;
    fiber_100g?: number;
    proteins_100g?: number;
    salt_100g?: number;
    sodium_100g?: number;
    [key: string]: any;
  };

  // Scores
  nutriscore_grade?: string;
  nova_group?: number;
  ecoscore_grade?: string;

  // Ingredients
  ingredients_text?: string;
  allergens?: string;
  traces?: string;

  // Images
  image_url?: string;
  image_front_url?: string;
  image_nutrition_url?: string;
  image_ingredients_url?: string;

  // Origin and manufacturing
  countries?: string;
  manufacturing_places?: string;
  origins?: string;

  // Packaging
  packaging?: string;

  // Additional info
  stores?: string;
  created_t?: number;
  last_modified_t?: number;

  [key: string]: any; // Allow for additional fields
}

export interface OpenFoodFactsResponse {
  code: string;
  product?: OpenFoodFactsProduct;
  status: number;
  status_verbose: string;
}

export interface ProductQueryOptions {
  /** Specific fields to extract from the product */
  fields?: (keyof OpenFoodFactsProduct | string)[];

  /** Whether to include all nested nutriments */
  includeAllNutriments?: boolean;
}

export interface ApiProduct {
  barcode: string;
  [key: string]: any;
}
