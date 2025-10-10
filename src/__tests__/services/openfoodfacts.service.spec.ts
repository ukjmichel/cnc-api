// src/__tests__/services/openfoodfacts.service.spec.ts

import { OpenFoodFactsService } from '../../services/openfoodfacts.service.js';
import { NotFoundError } from '../../errors/index.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('OpenFoodFactsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProductByBarcode', () => {
    const mockBarcode = '3017620422003';
    const mockProduct = {
      code: mockBarcode,
      product_name: 'Nutella',
      product_name_fr: 'Nutella',
      brands: 'Ferrero',
      quantity: '400g',
      _keywords: 'chocolate, spread, hazelnut',
      product_quantity: '400',
      product_quantity_unit: 'g',
      serving_quantity: '15',
      serving_quantity_unit: 'g',
      nutriments: {
        energy_100g: 2255,
        fat_100g: 30.9,
        carbohydrates_100g: 57.5,
        proteins_100g: 6.3,
        salt_100g: 0.107,
        sugars_100g: 56.3,
      },
      nutriscore_grade: 'e',
      categories: 'Spreads, Sweet spreads',
    };

    it('should fetch product successfully with all fields', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: mockProduct,
        }),
      });

      const result = await OpenFoodFactsService.getProductByBarcode(
        mockBarcode
      );

      expect(fetch).toHaveBeenCalledWith(
        `https://world.openfoodfacts.org/api/v0/product/${mockBarcode}.json`
      );
      expect(result.barcode).toBe(mockBarcode);
      expect(result.product_name).toBe('Nutella');
      expect(result.brands).toBe('Ferrero');
    });

    it('should fetch product with selected fields only', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: mockProduct,
        }),
      });

      const result = await OpenFoodFactsService.getProductByBarcode(
        mockBarcode,
        {
          fields: ['product_name_fr', 'brands', 'quantity'],
        }
      );

      expect(result.barcode).toBe(mockBarcode);
      expect(result.product_name_fr).toBe('Nutella');
      expect(result.brands).toBe('Ferrero');
      expect(result.quantity).toBe('400g');
      expect(result.product_name).toBeUndefined();
      expect(result.categories).toBeUndefined();
    });

    it('should return basic nutriments by default', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: mockProduct,
        }),
      });

      const result = await OpenFoodFactsService.getProductByBarcode(
        mockBarcode,
        {
          fields: ['nutriments'],
        }
      );

      expect(result.nutriments).toBeDefined();
      expect(result.nutriments.energy_100g).toBe(2255);
      expect(result.nutriments.fat_100g).toBe(30.9);
      expect(result.nutriments.sugars_100g).toBeUndefined(); // Not in basic list
    });

    it('should return all nutriments when includeAllNutriments is true', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: mockProduct,
        }),
      });

      const result = await OpenFoodFactsService.getProductByBarcode(
        mockBarcode,
        {
          fields: ['nutriments'],
          includeAllNutriments: true,
        }
      );

      expect(result.nutriments).toBeDefined();
      expect(result.nutriments.energy_100g).toBe(2255);
      expect(result.nutriments.sugars_100g).toBe(56.3);
    });

    it('should throw NotFoundError when product does not exist', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 0,
          product: null,
        }),
      });

      await expect(
        OpenFoodFactsService.getProductByBarcode('9999999999999')
      ).rejects.toThrow(NotFoundError);

      await expect(
        OpenFoodFactsService.getProductByBarcode('9999999999999')
      ).rejects.toThrow('Product with barcode 9999999999999 not found');
    });

    it('should throw error when API request fails', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        OpenFoodFactsService.getProductByBarcode(mockBarcode)
      ).rejects.toThrow('Failed to fetch product');
    });

    it('should throw error when network fails', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(
        OpenFoodFactsService.getProductByBarcode(mockBarcode)
      ).rejects.toThrow('Failed to fetch product: Network error');
    });
  });

  describe('getProductsByBarcodes', () => {
    const mockBarcodes = ['3017620422003', '5449000000996', '9999999999999'];
    const mockProducts = [
      {
        code: '3017620422003',
        product_name: 'Nutella',
        brands: 'Ferrero',
      },
      {
        code: '5449000000996',
        product_name: 'Coca-Cola',
        brands: 'Coca-Cola',
      },
    ];

    it('should fetch multiple products successfully', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 1,
            product: mockProducts[0],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 1,
            product: mockProducts[1],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 0,
            product: null,
          }),
        });

      const results = await OpenFoodFactsService.getProductsByBarcodes(
        mockBarcodes
      );

      expect(results).toHaveLength(2);
      expect(results[0].product_name).toBe('Nutella');
      expect(results[1].product_name).toBe('Coca-Cola');
    });

    it('should return empty array when all products fail', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 0,
          product: null,
        }),
      });

      const results = await OpenFoodFactsService.getProductsByBarcodes(
        mockBarcodes
      );

      expect(results).toHaveLength(0);
    });

    it('should pass options to individual fetches', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 1,
          product: mockProducts[0],
        }),
      });

      const results = await OpenFoodFactsService.getProductsByBarcodes(
        ['3017620422003'],
        {
          fields: ['product_name', 'brands'],
        }
      );

      expect(results).toHaveLength(1);
      expect(results[0].product_name).toBeDefined();
      expect(results[0].brands).toBeDefined();
    });
  });

  describe('searchProducts', () => {
    const mockSearchResults = {
      count: 50,
      page: 1,
      page_size: 20,
      products: [
        {
          code: '3017620422003',
          product_name: 'Nutella',
          brands: 'Ferrero',
        },
        {
          code: '5449000000996',
          product_name: 'Coca-Cola',
          brands: 'Coca-Cola',
        },
      ],
    };

    it('should search products successfully', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSearchResults,
      });

      const result = await OpenFoodFactsService.searchProducts('nutella');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('search_terms=nutella')
      );
      expect(result.products).toHaveLength(2);
      expect(result.count).toBe(50);
      expect(result.page).toBe(1);
    });

    it('should support pagination', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockSearchResults, page: 2 }),
      });

      const result = await OpenFoodFactsService.searchProducts('chocolate', {
        page: 2,
        pageSize: 10,
      });

      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('page=2'));
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('page_size=10')
      );
      expect(result.page).toBe(2);
    });

    it('should use default pagination values', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSearchResults,
      });

      await OpenFoodFactsService.searchProducts('coffee');

      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('page=1'));
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('page_size=20')
      );
    });

    it('should return empty results when no products found', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          count: 0,
          page: 1,
          products: [],
        }),
      });

      const result = await OpenFoodFactsService.searchProducts(
        'nonexistent-product-xyz'
      );

      expect(result.products).toHaveLength(0);
      expect(result.count).toBe(0);
    });

    it('should throw error when search fails', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        OpenFoodFactsService.searchProducts('nutella')
      ).rejects.toThrow('Failed to search products');
    });
  });

  describe('getProductBasicInfo', () => {
    it('should fetch product with basic fields', async () => {
      const mockProduct = {
        code: '3017620422003',
        product_name: 'Nutella',
        brands: 'Ferrero',
        quantity: '400g',
        image_url: 'https://example.com/image.jpg',
        nutriscore_grade: 'e',
        categories: 'Spreads',
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: mockProduct,
        }),
      });

      const result = await OpenFoodFactsService.getProductBasicInfo(
        '3017620422003'
      );

      expect(result.product_name).toBe('Nutella');
      expect(result.brands).toBe('Ferrero');
      expect(result.quantity).toBe('400g');
      expect(result.nutriscore_grade).toBe('e');
    });
  });

  describe('getProductNutrition', () => {
    it('should fetch product with nutrition data', async () => {
      const mockProduct = {
        code: '3017620422003',
        product_name: 'Nutella',
        brands: 'Ferrero',
        quantity: '400g',
        nutriments: {
          energy_100g: 2255,
          fat_100g: 30.9,
          carbohydrates_100g: 57.5,
          proteins_100g: 6.3,
          salt_100g: 0.107,
          sugars_100g: 56.3,
        },
        nutriscore_grade: 'e',
        nova_group: 4,
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: mockProduct,
        }),
      });

      const result = await OpenFoodFactsService.getProductNutrition(
        '3017620422003'
      );

      expect(result.product_name).toBe('Nutella');
      expect(result.nutriments).toBeDefined();
      expect(result.nutriments.sugars_100g).toBe(56.3); // Should include all nutriments
      expect(result.nova_group).toBe(4);
    });
  });
});
