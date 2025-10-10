// src/controllers/barcode.controller.ts

/**
 * =============================================================================
 * BarcodeController – Unified Barcode Lookup Controller
 * =============================================================================
 * Responsibilities
 *  - Fetch combined product information from multiple sources
 *  - Aggregate data from OpenFoodFacts and UPCItemDB
 *  - Return unified response with selected fields
 *  - Handle errors from multiple services gracefully
 *
 * Conventions
 *  - Return combined data structure
 *  - Include source indicators for debugging
 *  - Handle partial failures (one service succeeds, another fails)
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { OpenFoodFactsService } from '../services/openfoodfacts.service.js';
import { UPCItemDBService } from '../services/upcitemdb.service.js';
import { BadRequestError, NotFoundError } from '../errors/index.js';

interface CombinedItemResponse {
  barcode: string;
  foodData?: {
    keywords?: string;
    product_name?: string;
    product_quantity?: string;
    product_quantity_unit?: string;
    quantity?: string;
    serving_quantity?: string;
    serving_quantity_unit?: string;
  };
  retailData?: {
    description?: string;
    brand?: string;
    images?: string[];
  };
  sources: {
    openFoodFacts: boolean;
    upcItemDB: boolean;
  };
}

export class BarcodeController {
  /**
   * Get combined item information by barcode from both sources.
   *
   * GET /api/barcode/:code
   */
  static async getItemByCode(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { code } = req.params;

      if (!code) {
        return next(new BadRequestError('Barcode code is required'));
      }

      const response: CombinedItemResponse = {
        barcode: code,
        sources: {
          openFoodFacts: false,
          upcItemDB: false,
        },
      };

      // Fetch from OpenFoodFacts
      try {
        const foodData = await OpenFoodFactsService.getProductByBarcode(code, {
          fields: [
            '_keywords',
            'product_name_fr',
            'product_quantity',
            'product_quantity_unit',
            'quantity',
            'serving_quantity',
            'serving_quantity_unit',
          ],
        });

        response.foodData = {
          keywords: foodData._keywords as string | undefined,
          product_name: foodData.product_name as string | undefined,
          product_quantity: foodData.product_quantity as string | undefined,
          product_quantity_unit: foodData.product_quantity_unit as
            | string
            | undefined,
          quantity: foodData.quantity as string | undefined,
          serving_quantity: foodData.serving_quantity as string | undefined,
          serving_quantity_unit: foodData.serving_quantity_unit as
            | string
            | undefined,
        };
        response.sources.openFoodFacts = true;
      } catch (error) {
        // OpenFoodFacts failed, continue without it
        console.log(
          `OpenFoodFacts data not available for ${code}:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }

      // Fetch from UPCItemDB
      try {
        const retailData = await UPCItemDBService.lookup(code, {
          fields: ['description', 'brand', 'images'],
        });

        response.retailData = {
          description: retailData.description as string | undefined,
          brand: retailData.brand as string | undefined,
          images: retailData.images as string[] | undefined,
        };
        response.sources.upcItemDB = true;
      } catch (error) {
        // UPCItemDB failed, continue without it
        console.log(
          `UPCItemDB data not available for ${code}:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }

      // If neither source returned data, throw not found
      if (!response.sources.openFoodFacts && !response.sources.upcItemDB) {
        return next(
          new NotFoundError(`Item with barcode ${code} not found in any source`)
        );
      }

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get multiple items by barcodes.
   *
   * POST /api/barcode/batch
   * Body: { codes: string[] }
   */
  static async getBatchItems(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { codes } = req.body;

      if (!Array.isArray(codes) || codes.length === 0) {
        return next(
          new BadRequestError('codes array is required and must not be empty')
        );
      }

      const results = await Promise.all(
        codes.map(async (code) => {
          const response: CombinedItemResponse = {
            barcode: code,
            sources: {
              openFoodFacts: false,
              upcItemDB: false,
            },
          };

          // Fetch from OpenFoodFacts
          try {
            const foodData = await OpenFoodFactsService.getProductByBarcode(
              code,
              {
                fields: [
                  '_keywords',
                  'product_name_fr',
                  'product_quantity',
                  'product_quantity_unit',
                  'quantity',
                  'serving_quantity',
                  'serving_quantity_unit',
                ],
              }
            );

            response.foodData = {
              keywords: foodData._keywords as string | undefined,
              product_name: foodData.product_name as string | undefined,
              product_quantity: foodData.product_quantity as string | undefined,
              product_quantity_unit: foodData.product_quantity_unit as
                | string
                | undefined,
              quantity: foodData.quantity as string | undefined,
              serving_quantity: foodData.serving_quantity as string | undefined,
              serving_quantity_unit: foodData.serving_quantity_unit as
                | string
                | undefined,
            };
            response.sources.openFoodFacts = true;
          } catch (error) {
            // Continue without OpenFoodFacts data
          }

          // Fetch from UPCItemDB
          try {
            const retailData = await UPCItemDBService.lookup(code, {
              fields: ['description', 'brand', 'images'],
            });

            response.retailData = {
              description: retailData.description as string | undefined,
              brand: retailData.brand as string | undefined,
              images: retailData.images as string[] | undefined,
            };
            response.sources.upcItemDB = true;
          } catch (error) {
            // Continue without UPCItemDB data
          }

          // Only return items that have data from at least one source
          if (response.sources.openFoodFacts || response.sources.upcItemDB) {
            return response;
          }
          return null;
        })
      );

      const validResults = results.filter(
        (item): item is CombinedItemResponse => item !== null
      );

      res.status(200).json({
        items: validResults,
        total: validResults.length,
        requested: codes.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get only OpenFoodFacts data by barcode.
   *
   * GET /api/barcode/:code/food?fields=field1,field2,field3
   */
  static async getFoodData(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { code } = req.params;
      const { fields } = req.query;

      if (!code) {
        return next(new BadRequestError('Barcode code is required'));
      }

      // Parse fields from query parameter
      let fieldArray: string[] | undefined;
      if (fields) {
        if (typeof fields === 'string') {
          fieldArray = fields.split(',').map((f) => f.trim());
        } else if (Array.isArray(fields)) {
          fieldArray = fields.map((f) => String(f).trim());
        }
      }

      const foodData = await OpenFoodFactsService.getProductByBarcode(code, {
        fields: fieldArray,
      });

      const { barcode: _, ...dataWithoutBarcode } = foodData;

      res.status(200).json({
        barcode: code,
        ...dataWithoutBarcode,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get only UPCItemDB data by barcode.
   *
   * GET /api/barcode/:code/retail?fields=field1,field2,field3
   */
  static async getRetailData(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { code } = req.params;
      const { fields } = req.query;

      if (!code) {
        return next(new BadRequestError('Barcode code is required'));
      }

      // Parse fields from query parameter
      let fieldArray: string[] | undefined;
      if (fields) {
        if (typeof fields === 'string') {
          fieldArray = fields.split(',').map((f) => f.trim());
        } else if (Array.isArray(fields)) {
          fieldArray = fields.map((f) => String(f).trim());
        }
      }

      const retailData = await UPCItemDBService.lookup(code, {
        fields: fieldArray,
      });

      const { barcode: _, ...dataWithoutBarcode } = retailData;

      res.status(200).json({
        barcode: code,
        ...dataWithoutBarcode,
      });
    } catch (error) {
      next(error);
    }
  }
}
