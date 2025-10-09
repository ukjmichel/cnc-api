/**
 * OrderItem routes — E2E (real DB, real validators, supertest)
 * - Real DB, no mocks. We log in once and reuse cookies via supertest.agent.
 */

import request from 'supertest';
import { randomUUID as uuid } from 'crypto';

// Real DB + models + app
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
import { OrderModel } from '../../models/order.model.js';
import { StockModel } from '../../models/stock.model.js';
import { ProductModel } from '../../models/product.model.js';
import { UserModel } from '../../models/user.model.js';
import { AuthorizationModel } from '../../models/authorization.model.js';
import { app } from '../../app.js';

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

let adminBearer = '' as string;
let agent = request.agent(app); // persists cookies between calls
let currentUserId = `U${Date.now()}`; // used for seeded orders
let consoleErrorSpy: jest.SpyInstance;

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  await cleanAllTables();

  // Suppress console.error for expected test errors (404s, 400s, etc.)
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  // Create an admin and login to get cookies + optional Bearer
  const admin = await UserModel.create({
    username: mkUsername('admin'),
    firstName: 'Admin',
    lastName: 'User',
    email: `admin${Date.now()}@e2e.test`,
    password: 'pw',
  });

  await AuthorizationModel.create({
    userId: admin.userId,
    role: 'administrator',
  });

  const login = await agent
    .post('/api/auth/login')
    .send({ identifier: admin.username, password: 'pw' })
    .expect(200);

  const { accessToken } = pickToken(login);
  adminBearer = accessToken ? `Bearer ${accessToken}` : '';

  // orders seeded by helpers will belong to this user
  currentUserId = admin.userId;
});

afterAll(async () => {
  consoleErrorSpy.mockRestore();
  await sequelize.close();
});

afterEach(() => {
  jest.clearAllMocks();
});

/* ------------------------------ seed helpers ----------------------------- */

async function seedOrder(partial: Partial<Record<string, any>> = {}) {
  const orderId = partial.orderId ?? uuid();
  const row = await OrderModel.create({
    orderId,
    userId: partial.userId ?? currentUserId,
    status: partial.status ?? 'pending',
    currency: partial.currency ?? 'USD',
    subtotal: partial.subtotal ?? '0.00',
    taxTotal: partial.taxTotal ?? '0.00',
    grandTotal: partial.grandTotal ?? '0.00',
    pickupSlotId: partial.pickupSlotId ?? null,
  } as any);
  return row.get();
}

async function seedProduct(partial: Partial<Record<string, any>> = {}) {
  const productId = partial.productId ?? uuid();
  const row = await ProductModel.create({
    productId,
    productCode: partial.productCode ?? `code-${productId.slice(0, 8)}`,
    sku: partial.sku ?? `code-${productId.slice(0, 8)}`,
    productName: partial.productName ?? 'Test Product',
    name: partial.name ?? 'Test Product',
    description: partial.description ?? null,
    unit: partial.unit ?? 'ea',
    price: partial.price ?? '0.00',
  } as any);
  return row.get();
}

async function seedStock(partial: Partial<Record<string, any>> = {}) {
  // Ensure we have a product first
  let productId = partial.productId;
  if (!productId) {
    const product = await seedProduct();
    productId = product.productId;
  }

  const stockId = partial.stockId ?? uuid();
  const row = await StockModel.create({
    stockId,
    productId,
    quantity: partial.quantity ?? '10.000',
    unitPrice: partial.unitPrice ?? '2.00',
    location: partial.location ?? 'WH1',
    zone: partial.zone ?? null,
    expirationDate: partial.expirationDate ?? '2026-01-01',
  } as any);
  return row.get();
}

/* --------------------------------- tests --------------------------------- */

describe('POST /api/orders/:orderId/items (create)', () => {
  test('400 → validator catches missing body fields', async () => {
    const o = await seedOrder();

    const res = await agent
      .post(`/api/orders/${o.orderId}/items`)
      .set('Authorization', adminBearer)
      .send({}); // missing stockId & quantity

    // Should be 400, but if 500, log the error for debugging
    if (res.status === 500) {
      console.log('Unexpected 500 error:', res.body);
    }

    expect(res.status).toBe(400);
    expect(res.body.error || res.body.code).toMatch(/BAD_REQUEST/i);
  });

  test('404 → order exists, stock missing → NotFound', async () => {
    const o = await seedOrder();
    const fakeStockId = uuid();

    const res = await agent
      .post(`/api/orders/${o.orderId}/items`)
      .set('Authorization', adminBearer)
      .send({ stockId: fakeStockId, quantity: '1.000' });

    // Should be 404, but if 500, log the error for debugging
    if (res.status === 500) {
      console.log('Unexpected 500 error:', res.body);
    }

    expect(res.status).toBe(404);
    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
    expect(res.body.message).toMatch(/stock/i);
  });

  test('201 → creates item, computes totals, deducts stock', async () => {
    const o = await seedOrder();
    const s = await seedStock({ unitPrice: '3.50', quantity: '5.000' });

    const res = await agent
      .post(`/api/orders/${o.orderId}/items`)
      .set('Authorization', adminBearer)
      .send({ stockId: s.stockId, quantity: '1.250' })
      .expect(201);

    const item = res.body?.data?.item;
    expect(item).toMatchObject({
      orderId: o.orderId,
      stockId: s.stockId,
      quantity: '1.250',
      unitPrice: '3.50',
      lineTotal: '4.38',
    });

    // Verify stock was deducted
    const updated = await StockModel.findByPk(s.stockId);
    expect(Number(updated?.get('quantity'))).toBeCloseTo(3.75, 3);
  });
});

describe('GET /api/orders/:orderId/items (listForOrder)', () => {
  test('200 → returns paginated items (empty first, then one after create)', async () => {
    const o = await seedOrder();

    // Initially empty
    const res1 = await agent
      .get(`/api/orders/${o.orderId}/items?page=1&pageSize=5`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res1.body.data.items).toEqual([]);
    expect(res1.body.meta).toMatchObject({
      total: 0,
      page: 1,
      pageSize: 5,
    });

    // Seed an item via API
    const s = await seedStock({ unitPrice: '2.00', quantity: '2.000' });
    await agent
      .post(`/api/orders/${o.orderId}/items`)
      .set('Authorization', adminBearer)
      .send({ stockId: s.stockId, quantity: '1.000' })
      .expect(201);

    // Now should have one item
    const res2 = await agent
      .get(
        `/api/orders/${o.orderId}/items?page=1&pageSize=5&orderBy=createdAt&orderDir=DESC`
      )
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res2.body.data.items).toHaveLength(1);
    expect(res2.body.meta.total).toBe(1);
  });

  test('404 → order not found', async () => {
    const res = await agent
      .get(`/api/orders/${uuid()}/items`)
      .set('Authorization', adminBearer);

    if (res.status === 500) {
      console.log('Unexpected 500 error:', res.body);
    }

    expect(res.status).toBe(404);
    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });
});

describe('GET /api/orders/:orderId/items/:stockId (getOne)', () => {
  test('200 → returns one item', async () => {
    const o = await seedOrder();
    const s = await seedStock({ unitPrice: '2.50', quantity: '3.000' });

    await agent
      .post(`/api/orders/${o.orderId}/items`)
      .set('Authorization', adminBearer)
      .send({ stockId: s.stockId, quantity: '1.000' })
      .expect(201);

    const res = await agent
      .get(`/api/orders/${o.orderId}/items/${s.stockId}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body.data.item).toMatchObject({
      orderId: o.orderId,
      stockId: s.stockId,
    });
  });

  test('404 → order not found', async () => {
    const res = await agent
      .get(`/api/orders/${uuid()}/items/${uuid()}`)
      .set('Authorization', adminBearer);

    if (res.status === 500) {
      console.log('Unexpected 500 error:', res.body);
    }

    expect(res.status).toBe(404);
    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });
});

describe('PATCH /api/orders/:orderId/items/:stockId (update)', () => {
  test('200 → updates qty/price and recomputes lineTotal (no stock change here)', async () => {
    const o = await seedOrder();
    const s = await seedStock({ unitPrice: '2.00', quantity: '10.000' });

    await agent
      .post(`/api/orders/${o.orderId}/items`)
      .set('Authorization', adminBearer)
      .send({ stockId: s.stockId, quantity: '1.000' })
      .expect(201);

    const res = await agent
      .patch(`/api/orders/${o.orderId}/items/${s.stockId}`)
      .set('Authorization', adminBearer)
      .send({ quantity: '2.500', unitPrice: '3.00' })
      .expect(200);

    expect(res.body.data.item).toMatchObject({
      quantity: '2.500',
      unitPrice: '3.00',
      lineTotal: '7.50',
    });
  });

  test('404 → order not found', async () => {
    const res = await agent
      .patch(`/api/orders/${uuid()}/items/${uuid()}`)
      .send({ quantity: '1.000' })
      .set('Authorization', adminBearer);

    if (res.status === 500) {
      console.log('Unexpected 500 error:', res.body);
    }

    expect(res.status).toBe(404);
    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });
});

describe('DELETE /api/orders/:orderId/items/:stockId (remove)', () => {
  test('200 → deletes item', async () => {
    const o = await seedOrder();
    const s = await seedStock({ unitPrice: '1.00', quantity: '2.000' });

    await agent
      .post(`/api/orders/${o.orderId}/items`)
      .set('Authorization', adminBearer)
      .send({ stockId: s.stockId, quantity: '1.000' })
      .expect(201);

    const delRes = await agent
      .delete(`/api/orders/${o.orderId}/items/${s.stockId}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(delRes.body.data).toEqual({ deleted: true });

    // Verify item is gone
    const listRes = await agent
      .get(`/api/orders/${o.orderId}/items`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(listRes.body.meta.total).toBe(0);
    expect(listRes.body.data.items).toEqual([]);
  });

  test('404 → order not found', async () => {
    const res = await agent
      .delete(`/api/orders/${uuid()}/items/${uuid()}`)
      .set('Authorization', adminBearer);

    if (res.status === 500) {
      console.log('Unexpected 500 error:', res.body);
    }

    expect(res.status).toBe(404);
    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });
});

describe('GET /api/order-items (global filter via real router)', () => {
  test('200 → reachable & returns paginated payload', async () => {
    const res = await agent
      .get('/api/order-items?page=1&pageSize=5&orderBy=createdAt&orderDir=DESC')
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body.data.items).toBeDefined();
    expect(res.body.meta).toMatchObject({
      page: 1,
      pageSize: 5,
    });
  });
});
