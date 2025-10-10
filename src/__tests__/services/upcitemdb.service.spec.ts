// src/__tests__/services/upcitemdb.service.spec.ts

import { UPCItemDBService } from '../../services/upcitemdb.service.js';
import { NotFoundError } from '../../errors/index.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('UPCItemDBService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default configuration
    UPCItemDBService.configure({ useTrial: true, keyType: '3scale' });
  });

  describe('configure', () => {
    it('should update service configuration', () => {
      UPCItemDBService.configure({
        useTrial: false,
        apiKey: 'test-api-key',
        keyType: '3scale',
      });

      // Configuration is private, but we can test its effect
      expect(UPCItemDBService.getRateLimitInfo()).toBeNull();
    });
  });

  describe('lookup', () => {
    const mockCode = '012345678905';
    const mockItem = {
      ean: mockCode,
      title: 'Test Product',
      brand: 'Test Brand',
      description: 'A test product description',
      images: ['https://example.com/image1.jpg'],
      category: 'Electronics',
      currency: 'USD',
      lowest_recorded_price: 19.99,
      highest_recorded_price: 29.99,
      offers: [
        {
          merchant: 'Amazon',
          price: 19.99,
          link: 'https://amazon.com/product',
        },
      ],
    };

    const mockHeaders = new Headers({
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '99',
      'X-RateLimit-Reset': '1640000000',
    });

    it('should lookup product successfully with all fields', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [mockItem],
        }),
      });

      const result = await UPCItemDBService.lookup(mockCode);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/lookup?upc=${mockCode}`),
        expect.objectContaining({
          method: 'GET',
          headers: expect.any(Object),
        })
      );
      expect(result.barcode).toBe(mockCode);
      expect(result.title).toBe('Test Product');
      expect(result.brand).toBe('Test Brand');
    });

    it('should lookup product with selected fields only', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [mockItem],
        }),
      });

      const result = await UPCItemDBService.lookup(mockCode, {
        fields: ['title', 'brand', 'description'],
      });

      expect(result.barcode).toBe(mockCode);
      expect(result.title).toBe('Test Product');
      expect(result.brand).toBe('Test Brand');
      expect(result.description).toBe('A test product description');
      expect(result.images).toBeUndefined();
      expect(result.category).toBeUndefined();
    });

    it('should exclude offers by default when field is requested', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [mockItem],
        }),
      });

      const result = await UPCItemDBService.lookup(mockCode, {
        fields: ['offers'],
      });

      expect(result.offers).toEqual([]);
    });

    it('should include offers when includeOffers is true', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [mockItem],
        }),
      });

      const result = await UPCItemDBService.lookup(mockCode, {
        fields: ['offers'],
        includeOffers: true,
      });

      expect(result.offers).toHaveLength(1);
      expect(result.offers[0].merchant).toBe('Amazon');
    });

    it('should update rate limit info from headers', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [mockItem],
        }),
      });

      await UPCItemDBService.lookup(mockCode);

      const rateLimitInfo = UPCItemDBService.getRateLimitInfo();
      expect(rateLimitInfo).toEqual({
        limit: 100,
        remaining: 99,
        reset: 1640000000,
      });
    });

    it('should throw NotFoundError when product does not exist (404 status)', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        headers: mockHeaders,
      });

      await expect(UPCItemDBService.lookup('9999999999999')).rejects.toThrow(
        NotFoundError
      );
      await expect(UPCItemDBService.lookup('9999999999999')).rejects.toThrow(
        'Product with code 9999999999999 not found'
      );
    });

    it('should throw NotFoundError when response has NOT_FOUND code', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'NOT_FOUND',
          message: 'Product not found',
        }),
      });

      await expect(UPCItemDBService.lookup(mockCode)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw NotFoundError when total is 0', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 0,
          offset: 0,
          items: [],
        }),
      });

      await expect(UPCItemDBService.lookup(mockCode)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw error for rate limit (429)', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: mockHeaders,
      });

      await expect(UPCItemDBService.lookup(mockCode)).rejects.toThrow(
        'Rate limit exceeded'
      );
    });

    it('should throw error for authentication failure (401)', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: mockHeaders,
      });

      await expect(UPCItemDBService.lookup(mockCode)).rejects.toThrow(
        'Authentication failed'
      );
    });

    it('should throw error for other API failures', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: mockHeaders,
      });

      await expect(UPCItemDBService.lookup(mockCode)).rejects.toThrow(
        'Failed to lookup product'
      );
    });

    it('should throw error when network fails', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(UPCItemDBService.lookup(mockCode)).rejects.toThrow(
        'Failed to lookup product: Network error'
      );
    });
  });

  describe('lookupBatch', () => {
    const mockCodes = ['012345678905', '012345678906', '9999999999999'];
    const mockItems = [
      {
        ean: '012345678905',
        title: 'Product 1',
        brand: 'Brand A',
      },
      {
        ean: '012345678906',
        title: 'Product 2',
        brand: 'Brand B',
      },
    ];

    const mockHeaders = new Headers({
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '99',
      'X-RateLimit-Reset': '1640000000',
    });

    it('should lookup multiple products successfully', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders,
          json: async () => ({
            code: 'OK',
            total: 1,
            offset: 0,
            items: [mockItems[0]],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders,
          json: async () => ({
            code: 'OK',
            total: 1,
            offset: 0,
            items: [mockItems[1]],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders,
          json: async () => ({
            code: 'OK',
            total: 0,
            offset: 0,
            items: [],
          }),
        });

      const results = await UPCItemDBService.lookupBatch(mockCodes);

      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('Product 1');
      expect(results[1].title).toBe('Product 2');
    });

    it('should return empty array when all products fail', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        headers: mockHeaders,
      });

      const results = await UPCItemDBService.lookupBatch(mockCodes);

      expect(results).toHaveLength(0);
    });

    it('should pass options to individual lookups', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [mockItems[0]],
        }),
      });

      const results = await UPCItemDBService.lookupBatch(['012345678905'], {
        fields: ['title', 'brand'],
      });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBeDefined();
      expect(results[0].brand).toBeDefined();
    });
  });

  describe('search', () => {
    const mockSearchResults = {
      code: 'OK',
      total: 50,
      offset: 0,
      items: [
        {
          ean: '012345678905',
          title: 'Chocolate Bar',
          brand: 'Nestlé',
        },
        {
          ean: '012345678906',
          title: 'Chocolate Chips',
          brand: 'Hersheys',
        },
      ],
    };

    const mockHeaders = new Headers({
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '98',
      'X-RateLimit-Reset': '1640000000',
    });

    it('should search products successfully', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => mockSearchResults,
      });

      const result = await UPCItemDBService.search('chocolate');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('s=chocolate'),
        expect.any(Object)
      );
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('should support brand filter', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => mockSearchResults,
      });

      await UPCItemDBService.search('snacks', { brand: 'Nestlé' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('brand=Nestl%C3%A9'),
        expect.any(Object)
      );
    });

    it('should support category filter', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => mockSearchResults,
      });

      await UPCItemDBService.search('food', { category: 'Snacks' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('category=Snacks'),
        expect.any(Object)
      );
    });

    it('should support offset for pagination', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({ ...mockSearchResults, offset: 20 }),
      });

      const result = await UPCItemDBService.search('candy', { offset: 20 });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=20'),
        expect.any(Object)
      );
      expect(result.offset).toBe(20);
    });

    it('should support match mode', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => mockSearchResults,
      });

      await UPCItemDBService.search('beverage', { match: 'like' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('match_mode=like'),
        expect.any(Object)
      );
    });

    it('should return empty results when no products found', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 0,
          offset: 0,
          items: [],
        }),
      });

      const result = await UPCItemDBService.search('nonexistent-xyz');

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should throw error when search fails', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: mockHeaders,
      });

      await expect(UPCItemDBService.search('test')).rejects.toThrow(
        'Failed to search products'
      );
    });

    it('should throw error when response has error message', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'ERROR',
          message: 'Invalid search parameters',
        }),
      });

      await expect(UPCItemDBService.search('test')).rejects.toThrow(
        'Invalid search parameters'
      );
    });
  });

  describe('searchByBrand', () => {
    const mockHeaders = new Headers();

    it('should search products by brand', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 10,
          offset: 0,
          items: [],
        }),
      });

      await UPCItemDBService.searchByBrand('Nike');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('brand=Nike'),
        expect.any(Object)
      );
    });

    it('should pass additional options', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 10,
          offset: 0,
          items: [],
        }),
      });

      await UPCItemDBService.searchByBrand('Adidas', {
        category: 'Shoes',
        offset: 10,
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('brand=Adidas'),
        expect.any(Object)
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('category=Shoes'),
        expect.any(Object)
      );
    });
  });

  describe('searchByCategory', () => {
    const mockHeaders = new Headers();

    it('should search products by category', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 25,
          offset: 0,
          items: [],
        }),
      });

      await UPCItemDBService.searchByCategory('Electronics');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('category=Electronics'),
        expect.any(Object)
      );
    });

    it('should pass additional options', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 25,
          offset: 0,
          items: [],
        }),
      });

      await UPCItemDBService.searchByCategory('Books', {
        brand: 'Penguin',
        offset: 5,
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('category=Books'),
        expect.any(Object)
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('brand=Penguin'),
        expect.any(Object)
      );
    });
  });

  describe('getBasicInfo', () => {
    const mockHeaders = new Headers();

    it('should fetch product with basic fields', async () => {
      const mockItem = {
        ean: '012345678905',
        title: 'Basic Product',
        brand: 'Test Brand',
        description: 'Test Description',
        images: ['https://example.com/img.jpg'],
        category: 'Test Category',
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [mockItem],
        }),
      });

      const result = await UPCItemDBService.getBasicInfo('012345678905');

      expect(result.title).toBe('Basic Product');
      expect(result.brand).toBe('Test Brand');
      expect(result.description).toBe('Test Description');
      expect(result.category).toBe('Test Category');
    });
  });

  describe('getPricing', () => {
    const mockHeaders = new Headers();

    it('should fetch product with pricing data', async () => {
      const mockItem = {
        ean: '012345678905',
        title: 'Priced Product',
        brand: 'Price Brand',
        currency: 'USD',
        lowest_recorded_price: 9.99,
        highest_recorded_price: 19.99,
        offers: [
          {
            merchant: 'Store A',
            price: 14.99,
            link: 'https://store-a.com',
          },
        ],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [mockItem],
        }),
      });

      const result = await UPCItemDBService.getPricing('012345678905');

      expect(result.title).toBe('Priced Product');
      expect(result.currency).toBe('USD');
      expect(result.lowest_recorded_price).toBe(9.99);
      expect(result.highest_recorded_price).toBe(19.99);
      expect(result.offers).toHaveLength(1);
    });
  });

  describe('getFullDetails', () => {
    const mockHeaders = new Headers();

    it('should fetch product with all available data', async () => {
      const mockItem = {
        ean: '012345678905',
        title: 'Complete Product',
        brand: 'Full Brand',
        description: 'Full Description',
        images: ['https://example.com/full.jpg'],
        category: 'Full Category',
        currency: 'EUR',
        lowest_recorded_price: 19.99,
        highest_recorded_price: 39.99,
        offers: [
          {
            merchant: 'Shop B',
            price: 29.99,
            link: 'https://shop-b.com',
          },
        ],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        headers: mockHeaders,
        json: async () => ({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [mockItem],
        }),
      });

      const result = await UPCItemDBService.getFullDetails('012345678905');

      expect(result.title).toBe('Complete Product');
      expect(result.description).toBe('Full Description');
      expect(result.offers).toHaveLength(1);
      expect(result.offers[0].merchant).toBe('Shop B');
    });
  });
});
