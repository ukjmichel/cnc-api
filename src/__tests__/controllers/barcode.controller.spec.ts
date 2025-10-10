// src/__tests__/controllers/barcode.controller.spec.ts

import { Request, Response, NextFunction } from 'express';
import { BarcodeController } from '../../controllers/barcode.controller.js';
import { OpenFoodFactsService } from '../../services/openfoodfacts.service.js';
import { UPCItemDBService } from '../../services/upcitemdb.service.js';
import { BadRequestError, NotFoundError } from '../../errors/index.js';

// Mock both services
jest.mock('../../services/openfoodfacts.service.js');
jest.mock('../../services/upcitemdb.service.js');

describe('BarcodeController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      params: {},
      query: {},
      body: {},
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();

    // Silence console.log in tests
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getItemByCode', () => {
    const mockBarcode = '3017620422003';
    const mockFoodData = {
      barcode: mockBarcode,
      _keywords: 'chocolate, hazelnut',
      product_name: 'Nutella',
      product_quantity: '400',
      product_quantity_unit: 'g',
      quantity: '400g',
      serving_quantity: '15',
      serving_quantity_unit: 'g',
    };

    const mockRetailData = {
      barcode: mockBarcode,
      description: 'Chocolate hazelnut spread',
      brand: 'Ferrero',
      images: ['https://example.com/image.jpg'],
    };

    it('should return combined data from both sources', async () => {
      mockRequest.params = { code: mockBarcode };

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockResolvedValueOnce(mockFoodData);
      (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce(
        mockRetailData
      );

      await BarcodeController.getItemByCode(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        barcode: mockBarcode,
        foodData: {
          keywords: 'chocolate, hazelnut',
          product_name: 'Nutella',
          product_quantity: '400',
          product_quantity_unit: 'g',
          quantity: '400g',
          serving_quantity: '15',
          serving_quantity_unit: 'g',
        },
        retailData: {
          description: 'Chocolate hazelnut spread',
          brand: 'Ferrero',
          images: ['https://example.com/image.jpg'],
        },
        sources: {
          openFoodFacts: true,
          upcItemDB: true,
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return data when only OpenFoodFacts succeeds', async () => {
      mockRequest.params = { code: mockBarcode };

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockResolvedValueOnce(mockFoodData);
      (UPCItemDBService.lookup as jest.Mock).mockRejectedValueOnce(
        new NotFoundError('Product not found')
      );

      await BarcodeController.getItemByCode(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          barcode: mockBarcode,
          foodData: expect.any(Object),
          sources: {
            openFoodFacts: true,
            upcItemDB: false,
          },
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return data when only UPCItemDB succeeds', async () => {
      mockRequest.params = { code: mockBarcode };

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockRejectedValueOnce(new NotFoundError('Product not found'));
      (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce(
        mockRetailData
      );

      await BarcodeController.getItemByCode(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          barcode: mockBarcode,
          retailData: expect.any(Object),
          sources: {
            openFoodFacts: false,
            upcItemDB: true,
          },
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next with NotFoundError when both sources fail', async () => {
      mockRequest.params = { code: mockBarcode };

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockRejectedValueOnce(new NotFoundError('Product not found'));
      (UPCItemDBService.lookup as jest.Mock).mockRejectedValueOnce(
        new NotFoundError('Product not found')
      );

      await BarcodeController.getItemByCode(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Item with barcode ${mockBarcode} not found in any source`,
        })
      );
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it('should call next with BadRequestError when code is missing', async () => {
      mockRequest.params = {};

      await BarcodeController.getItemByCode(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(BadRequestError));
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should call services with correct fields', async () => {
      mockRequest.params = { code: mockBarcode };

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockResolvedValueOnce(mockFoodData);
      (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce(
        mockRetailData
      );

      await BarcodeController.getItemByCode(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(OpenFoodFactsService.getProductByBarcode).toHaveBeenCalledWith(
        mockBarcode,
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

      expect(UPCItemDBService.lookup).toHaveBeenCalledWith(mockBarcode, {
        fields: ['description', 'brand', 'images'],
      });
    });

    it('should call next with error when unexpected error occurs', async () => {
      mockRequest.params = { code: mockBarcode };
      const error = new Error('Unexpected error');

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockRejectedValueOnce(error);
      (UPCItemDBService.lookup as jest.Mock).mockRejectedValueOnce(error);

      await BarcodeController.getItemByCode(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Item with barcode ${mockBarcode} not found in any source`,
        })
      );
    });
  });

  describe('getBatchItems', () => {
    const mockCodes = ['3017620422003', '5449000000996'];
    const mockFoodData1 = {
      barcode: '3017620422003',
      product_name: 'Nutella',
    };
    const mockFoodData2 = {
      barcode: '5449000000996',
      product_name: 'Coca-Cola',
    };

    it('should fetch multiple items successfully', async () => {
      mockRequest.body = { codes: mockCodes };

      (OpenFoodFactsService.getProductByBarcode as jest.Mock)
        .mockResolvedValueOnce(mockFoodData1)
        .mockResolvedValueOnce(mockFoodData2);
      (UPCItemDBService.lookup as jest.Mock).mockRejectedValue(
        new NotFoundError('Not found')
      );

      await BarcodeController.getBatchItems(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ barcode: '3017620422003' }),
            expect.objectContaining({ barcode: '5449000000996' }),
          ]),
          total: 2,
          requested: 2,
        })
      );
    });

    it('should call next with BadRequestError when codes is missing', async () => {
      mockRequest.body = {};

      await BarcodeController.getBatchItems(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(BadRequestError));
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should call next with BadRequestError when codes is empty', async () => {
      mockRequest.body = { codes: [] };

      await BarcodeController.getBatchItems(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(BadRequestError));
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should handle partial failures gracefully', async () => {
      mockRequest.body = { codes: mockCodes };

      (OpenFoodFactsService.getProductByBarcode as jest.Mock)
        .mockResolvedValueOnce(mockFoodData1)
        .mockRejectedValueOnce(new NotFoundError('Not found'));
      (UPCItemDBService.lookup as jest.Mock).mockRejectedValue(
        new NotFoundError('Not found')
      );

      await BarcodeController.getBatchItems(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ barcode: '3017620422003' }),
          ]),
          total: 1,
          requested: 2,
        })
      );
    });

    it('should return empty array when all items fail', async () => {
      mockRequest.body = { codes: mockCodes };

      (OpenFoodFactsService.getProductByBarcode as jest.Mock).mockRejectedValue(
        new NotFoundError('Not found')
      );
      (UPCItemDBService.lookup as jest.Mock).mockRejectedValue(
        new NotFoundError('Not found')
      );

      await BarcodeController.getBatchItems(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        items: [],
        total: 0,
        requested: 2,
      });
    });
  });

  describe('getFoodData', () => {
    const mockBarcode = '3017620422003';
    const mockFoodData = {
      barcode: mockBarcode,
      product_name: 'Nutella',
      brands: 'Ferrero',
      quantity: '400g',
    };

    it('should fetch OpenFoodFacts data with all fields', async () => {
      mockRequest.params = { code: mockBarcode };
      mockRequest.query = {};

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockResolvedValueOnce(mockFoodData);

      await BarcodeController.getFoodData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        barcode: mockBarcode,
        product_name: 'Nutella',
        brands: 'Ferrero',
        quantity: '400g',
      });
      expect(OpenFoodFactsService.getProductByBarcode).toHaveBeenCalledWith(
        mockBarcode,
        { fields: undefined }
      );
    });

    it('should fetch OpenFoodFacts data with selected fields from string', async () => {
      mockRequest.params = { code: mockBarcode };
      mockRequest.query = { fields: 'product_name,brands' };

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockResolvedValueOnce({
        barcode: mockBarcode,
        product_name: 'Nutella',
        brands: 'Ferrero',
      });

      await BarcodeController.getFoodData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(OpenFoodFactsService.getProductByBarcode).toHaveBeenCalledWith(
        mockBarcode,
        { fields: ['product_name', 'brands'] }
      );
    });

    it('should fetch OpenFoodFacts data with selected fields from array', async () => {
      mockRequest.params = { code: mockBarcode };
      mockRequest.query = { fields: ['product_name', 'brands'] };

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockResolvedValueOnce({
        barcode: mockBarcode,
        product_name: 'Nutella',
        brands: 'Ferrero',
      });

      await BarcodeController.getFoodData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(OpenFoodFactsService.getProductByBarcode).toHaveBeenCalledWith(
        mockBarcode,
        { fields: ['product_name', 'brands'] }
      );
    });

    it('should call next with BadRequestError when code is missing', async () => {
      mockRequest.params = {};

      await BarcodeController.getFoodData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(BadRequestError));
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should call next with error when service fails', async () => {
      mockRequest.params = { code: mockBarcode };
      const error = new NotFoundError('Product not found');

      (
        OpenFoodFactsService.getProductByBarcode as jest.Mock
      ).mockRejectedValueOnce(error);

      await BarcodeController.getFoodData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(mockResponse.status).not.toHaveBeenCalled();
    });
  });

  describe('getRetailData', () => {
    const mockBarcode = '012345678905';
    const mockRetailData = {
      barcode: mockBarcode,
      title: 'Test Product',
      brand: 'Test Brand',
      description: 'Test description',
      images: ['https://example.com/image.jpg'],
    };

    it('should fetch UPCItemDB data with all fields', async () => {
      mockRequest.params = { code: mockBarcode };
      mockRequest.query = {};

      (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce(
        mockRetailData
      );

      await BarcodeController.getRetailData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        barcode: mockBarcode,
        title: 'Test Product',
        brand: 'Test Brand',
        description: 'Test description',
        images: ['https://example.com/image.jpg'],
      });
      expect(UPCItemDBService.lookup).toHaveBeenCalledWith(mockBarcode, {
        fields: undefined,
      });
    });

    it('should fetch UPCItemDB data with selected fields from string', async () => {
      mockRequest.params = { code: mockBarcode };
      mockRequest.query = { fields: 'brand,description' };

      (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce({
        barcode: mockBarcode,
        brand: 'Test Brand',
        description: 'Test description',
      });

      await BarcodeController.getRetailData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(UPCItemDBService.lookup).toHaveBeenCalledWith(mockBarcode, {
        fields: ['brand', 'description'],
      });
    });

    it('should fetch UPCItemDB data with selected fields from array', async () => {
      mockRequest.params = { code: mockBarcode };
      mockRequest.query = { fields: ['brand', 'images'] };

      (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce({
        barcode: mockBarcode,
        brand: 'Test Brand',
        images: ['https://example.com/image.jpg'],
      });

      await BarcodeController.getRetailData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(UPCItemDBService.lookup).toHaveBeenCalledWith(mockBarcode, {
        fields: ['brand', 'images'],
      });
    });

    it('should call next with BadRequestError when code is missing', async () => {
      mockRequest.params = {};

      await BarcodeController.getRetailData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(BadRequestError));
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should call next with error when service fails', async () => {
      mockRequest.params = { code: mockBarcode };
      const error = new NotFoundError('Product not found');

      (UPCItemDBService.lookup as jest.Mock).mockRejectedValueOnce(error);

      await BarcodeController.getRetailData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should trim whitespace from field names', async () => {
      mockRequest.params = { code: mockBarcode };
      mockRequest.query = { fields: ' brand , description , images ' };

      (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce(
        mockRetailData
      );

      await BarcodeController.getRetailData(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(UPCItemDBService.lookup).toHaveBeenCalledWith(mockBarcode, {
        fields: ['brand', 'description', 'images'],
      });
    });
  });
});
