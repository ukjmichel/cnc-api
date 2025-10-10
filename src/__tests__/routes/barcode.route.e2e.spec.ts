// src/__tests__/routes/barcode.route.e2e.spec.ts

/**
 * Barcode routes – E2E (real DB, real validators, supertest)
 * - Real DB + auth, no mocks. We log in as admin/employee and use real tokens.
 * - Mocks external API services (OpenFoodFacts, UPCItemDB)
 * - Focuses on /api/barcode endpoints
 */

import request from 'supertest';
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
import { UserModel } from '../../models/user.model.js';
import { AuthorizationModel } from '../../models/authorization.model.js';
import { app } from '../../app.js';
import { OpenFoodFactsService } from '../../services/openfoodfacts.service.js';
import { UPCItemDBService } from '../../services/upcitemdb.service.js';
import { NotFoundError } from '../../errors/index.js';

// Mock external services
jest.mock('../../services/openfoodfacts.service.js');
jest.mock('../../services/upcitemdb.service.js');

/* ------------------------ token / username helpers ------------------------ */

function pickToken(res: request.Response) {
  const body = res.body ?? {};
  const d = body.data ?? {};
  const tokens = (d.tokens ?? d) as any;

  let accessToken: string | undefined =
    tokens?.accessToken ?? tokens?.access_token ?? tokens?.at;
  let refreshToken: string | undefined =
    tokens?.refreshToken ?? tokens?.refresh_token ?? tokens?.rt;

  if (!accessToken || !refreshToken) {
    const v = (res.headers as unknown as Record<string, string | string[]>)[
      'set-cookie'
    ];
    const cookies = Array.isArray(v)
      ? v
      : typeof v === 'string'
      ? [v]
      : undefined;
    if (cookies) {
      const out: Record<string, string> = {};
      for (const c of cookies) {
        const [kv] = c.split(';');
        const [k, v2] = kv.split('=');
        out[k.trim()] = (v2 ?? '').trim();
      }
      accessToken ||= out['accessToken'];
      refreshToken ||= out['refreshToken'];
    }
  }
  return { accessToken, refreshToken };
}

// Make a model-valid username (lowercase a-z0-9, max 20)
const mkUsername = (prefix: string) =>
  (prefix.toLowerCase().replace(/[^a-z0-9]/g, '') || 'u').slice(0, 10) +
  (Date.now() % 1_000_000).toString().padStart(6, '0');

/* ---------------------- auth/session bootstrapping ----------------------- */

let employeeBearer = '' as string;
let customerBearer = '' as string;
let employeeAgent = request.agent(app);
let customerAgent = request.agent(app);
let consoleLogSpy: jest.SpyInstance;

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  await cleanAllTables();

  // Suppress console.log for expected test logs
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  // Create an employee user
  const employee = await UserModel.create({
    username: mkUsername('employee'),
    firstName: 'Test',
    lastName: 'Employee',
    email: `employee${Date.now()}@e2e.test`,
    password: 'pw',
  });

  await AuthorizationModel.create({
    userId: employee.userId,
    role: 'employee',
  });

  const empLogin = await employeeAgent
    .post('/api/auth/login')
    .send({ identifier: employee.username, password: 'pw' })
    .expect(200);

  const { accessToken: empToken } = pickToken(empLogin);
  employeeBearer = empToken ? `Bearer ${empToken}` : '';

  // Create a regular customer user (no authorization record = regular user)
  const customer = await UserModel.create({
    username: mkUsername('customer'),
    firstName: 'Regular',
    lastName: 'Customer',
    email: `customer${Date.now()}@e2e.test`,
    password: 'pw',
  });

  // No AuthorizationModel.create for customer - they're just a regular user

  const custLogin = await customerAgent
    .post('/api/auth/login')
    .send({ identifier: customer.username, password: 'pw' })
    .expect(200);

  const { accessToken: custToken } = pickToken(custLogin);
  customerBearer = custToken ? `Bearer ${custToken}` : '';
});

afterAll(async () => {
  consoleLogSpy.mockRestore();
  await sequelize.close();
});

afterEach(() => {
  jest.clearAllMocks();
});

/* ------------------------------ mock data ----------------------------- */

const mockBarcode = '3017620422003';
const mockFoodData = {
  barcode: mockBarcode,
  _keywords: 'chocolate, hazelnut',
  product_name_fr: 'Nutella',
  product_name: 'Nutella', // Added for combined endpoint
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

/* --------------------------------- tests --------------------------------- */

describe('GET /api/barcode/:code (combined lookup)', () => {
  test('200 → returns combined data from both sources', async () => {
    (
      OpenFoodFactsService.getProductByBarcode as jest.Mock
    ).mockResolvedValueOnce(mockFoodData);
    (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce(
      mockRetailData
    );

    const res = await employeeAgent
      .get(`/api/barcode/${mockBarcode}`)
      .set('Authorization', employeeBearer)
      .expect(200);

    expect(res.body).toMatchObject({
      barcode: mockBarcode,
      foodData: expect.objectContaining({
        keywords: 'chocolate, hazelnut',
        product_name: 'Nutella',
      }),
      retailData: expect.objectContaining({
        brand: 'Ferrero',
        description: 'Chocolate hazelnut spread',
      }),
      sources: {
        openFoodFacts: true,
        upcItemDB: true,
      },
    });
  });

  test('200 → returns data when only OpenFoodFacts succeeds', async () => {
    (
      OpenFoodFactsService.getProductByBarcode as jest.Mock
    ).mockResolvedValueOnce(mockFoodData);
    (UPCItemDBService.lookup as jest.Mock).mockRejectedValueOnce(
      new NotFoundError('Not found')
    );

    const res = await employeeAgent
      .get(`/api/barcode/${mockBarcode}`)
      .set('Authorization', employeeBearer)
      .expect(200);

    expect(res.body.sources).toMatchObject({
      openFoodFacts: true,
      upcItemDB: false,
    });
    expect(res.body.foodData).toBeDefined();
    expect(res.body.retailData).toBeUndefined();
  });

  test('200 → returns data when only UPCItemDB succeeds', async () => {
    (
      OpenFoodFactsService.getProductByBarcode as jest.Mock
    ).mockRejectedValueOnce(new NotFoundError('Not found'));
    (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce(
      mockRetailData
    );

    const res = await employeeAgent
      .get(`/api/barcode/${mockBarcode}`)
      .set('Authorization', employeeBearer)
      .expect(200);

    expect(res.body.sources).toMatchObject({
      openFoodFacts: false,
      upcItemDB: true,
    });
    expect(res.body.retailData).toBeDefined();
    expect(res.body.foodData).toBeUndefined();
  });

  test('404 → both sources fail', async () => {
    (
      OpenFoodFactsService.getProductByBarcode as jest.Mock
    ).mockRejectedValueOnce(new NotFoundError('Product not found'));
    (UPCItemDBService.lookup as jest.Mock).mockRejectedValueOnce(
      new NotFoundError('Product not found')
    );

    const res = await employeeAgent
      .get('/api/barcode/9999999999999')
      .set('Authorization', employeeBearer)
      .expect(404);

    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });

  test('401 → requires authentication', async () => {
    await request(app).get(`/api/barcode/${mockBarcode}`).expect(401);
  });

  test('403 → customer role forbidden', async () => {
    await customerAgent
      .get(`/api/barcode/${mockBarcode}`)
      .set('Authorization', customerBearer)
      .expect(403);
  });
});

describe('POST /api/barcode/batch (batch lookup)', () => {
  const mockCodes = ['3017620422003', '5449000000996'];

  test('200 → returns multiple products', async () => {
    (OpenFoodFactsService.getProductByBarcode as jest.Mock)
      .mockResolvedValueOnce({
        barcode: mockCodes[0],
        product_name_fr: 'Nutella',
      })
      .mockResolvedValueOnce({
        barcode: mockCodes[1],
        product_name_fr: 'Coca-Cola',
      });
    (UPCItemDBService.lookup as jest.Mock).mockRejectedValue(
      new NotFoundError('Not found')
    );

    const res = await employeeAgent
      .post('/api/barcode/batch')
      .set('Authorization', employeeBearer)
      .send({ codes: mockCodes })
      .expect(200);

    expect(res.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ barcode: mockCodes[0] }),
        expect.objectContaining({ barcode: mockCodes[1] }),
      ]),
      total: 2,
      requested: 2,
    });
  });

  test('200 → handles partial failures', async () => {
    (OpenFoodFactsService.getProductByBarcode as jest.Mock)
      .mockResolvedValueOnce({
        barcode: mockCodes[0],
        product_name_fr: 'Nutella',
      })
      .mockRejectedValueOnce(new NotFoundError('Not found'));
    (UPCItemDBService.lookup as jest.Mock).mockRejectedValue(
      new NotFoundError('Not found')
    );

    const res = await employeeAgent
      .post('/api/barcode/batch')
      .set('Authorization', employeeBearer)
      .send({ codes: mockCodes })
      .expect(200);

    expect(res.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ barcode: mockCodes[0] }),
      ]),
      total: 1,
      requested: 2,
    });
  });

  test('200 → returns empty array when all fail', async () => {
    (OpenFoodFactsService.getProductByBarcode as jest.Mock).mockRejectedValue(
      new NotFoundError('Not found')
    );
    (UPCItemDBService.lookup as jest.Mock).mockRejectedValue(
      new NotFoundError('Not found')
    );

    const res = await employeeAgent
      .post('/api/barcode/batch')
      .set('Authorization', employeeBearer)
      .send({ codes: mockCodes })
      .expect(200);

    expect(res.body).toMatchObject({
      items: [],
      total: 0,
      requested: 2,
    });
  });

  test('401 → requires authentication', async () => {
    await request(app)
      .post('/api/barcode/batch')
      .send({ codes: mockCodes })
      .expect(401);
  });

  test('403 → customer role forbidden', async () => {
    await customerAgent
      .post('/api/barcode/batch')
      .set('Authorization', customerBearer)
      .send({ codes: mockCodes })
      .expect(403);
  });
});

describe('GET /api/barcode/:code/food (OpenFoodFacts only)', () => {
  test('200 → returns OpenFoodFacts data with all fields', async () => {
    (
      OpenFoodFactsService.getProductByBarcode as jest.Mock
    ).mockResolvedValueOnce(mockFoodData);

    const res = await employeeAgent
      .get(`/api/barcode/${mockBarcode}/food`)
      .set('Authorization', employeeBearer)
      .expect(200);

    expect(res.body).toMatchObject({
      barcode: mockBarcode,
      product_name_fr: 'Nutella',
      quantity: '400g',
    });

    expect(OpenFoodFactsService.getProductByBarcode).toHaveBeenCalledWith(
      mockBarcode,
      { fields: undefined }
    );
  });

  test('200 → returns OpenFoodFacts data with selected fields', async () => {
    (
      OpenFoodFactsService.getProductByBarcode as jest.Mock
    ).mockResolvedValueOnce({
      barcode: mockBarcode,
      product_name_fr: 'Nutella',
      quantity: '400g',
    });

    const res = await employeeAgent
      .get(`/api/barcode/${mockBarcode}/food`)
      .query({ fields: 'product_name_fr,quantity' })
      .set('Authorization', employeeBearer)
      .expect(200);

    expect(res.body).toMatchObject({
      barcode: mockBarcode,
      product_name_fr: 'Nutella',
      quantity: '400g',
    });

    expect(OpenFoodFactsService.getProductByBarcode).toHaveBeenCalledWith(
      mockBarcode,
      { fields: ['product_name_fr', 'quantity'] }
    );
  });

  test('404 → product not found', async () => {
    (
      OpenFoodFactsService.getProductByBarcode as jest.Mock
    ).mockRejectedValueOnce(new NotFoundError('Product not found'));

    const res = await employeeAgent
      .get('/api/barcode/9999999999999/food')
      .set('Authorization', employeeBearer)
      .expect(404);

    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });

  test('401 → requires authentication', async () => {
    await request(app).get(`/api/barcode/${mockBarcode}/food`).expect(401);
  });

  test('403 → customer role forbidden', async () => {
    await customerAgent
      .get(`/api/barcode/${mockBarcode}/food`)
      .set('Authorization', customerBearer)
      .expect(403);
  });
});

describe('GET /api/barcode/:code/retail (UPCItemDB only)', () => {
  test('200 → returns UPCItemDB data with all fields', async () => {
    (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce(
      mockRetailData
    );

    const res = await employeeAgent
      .get(`/api/barcode/${mockBarcode}/retail`)
      .set('Authorization', employeeBearer)
      .expect(200);

    expect(res.body).toMatchObject({
      barcode: mockBarcode,
      brand: 'Ferrero',
      description: 'Chocolate hazelnut spread',
    });

    expect(UPCItemDBService.lookup).toHaveBeenCalledWith(mockBarcode, {
      fields: undefined,
    });
  });

  test('200 → returns UPCItemDB data with selected fields', async () => {
    (UPCItemDBService.lookup as jest.Mock).mockResolvedValueOnce({
      barcode: mockBarcode,
      brand: 'Ferrero',
      description: 'Chocolate hazelnut spread',
    });

    const res = await employeeAgent
      .get(`/api/barcode/${mockBarcode}/retail`)
      .query({ fields: 'brand,description' })
      .set('Authorization', employeeBearer)
      .expect(200);

    expect(res.body).toMatchObject({
      barcode: mockBarcode,
      brand: 'Ferrero',
      description: 'Chocolate hazelnut spread',
    });

    expect(UPCItemDBService.lookup).toHaveBeenCalledWith(mockBarcode, {
      fields: ['brand', 'description'],
    });
  });

  test('404 → product not found', async () => {
    (UPCItemDBService.lookup as jest.Mock).mockRejectedValueOnce(
      new NotFoundError('Product not found')
    );

    const res = await employeeAgent
      .get('/api/barcode/9999999999999/retail')
      .set('Authorization', employeeBearer)
      .expect(404);

    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });

  test('401 → requires authentication', async () => {
    await request(app).get(`/api/barcode/${mockBarcode}/retail`).expect(401);
  });

  test('403 → customer role forbidden', async () => {
    await customerAgent
      .get(`/api/barcode/${mockBarcode}/retail`)
      .set('Authorization', customerBearer)
      .expect(403);
  });
});
