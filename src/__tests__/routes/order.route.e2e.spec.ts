/**
 * Order routes — E2E (real DB, real validators, supertest)
 * - Real DB, no mocks. We log in once and reuse cookies via supertest.agent.
 * - Focuses on /api/orders (create, list, get, patches, self, delete).
 */

import request from 'supertest';
import { randomUUID as uuid } from 'crypto';

// Real DB + models + app
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
import { OrderModel } from '../../models/order.model.js';
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
    // current model uses single contactName + phone (email optional/ignored)
    contactName: partial.contactName ?? 'Ada Lovelace',
    contactPhone: partial.contactPhone ?? '+15550001111',
    notes: partial.notes ?? null,
  } as any);
  return row.get();
}

/* --------------------------------- tests --------------------------------- */

describe('POST /api/orders (create)', () => {
  test('201 → accepts minimal {} payload (all fields optional per validator)', async () => {
    const res = await agent
      .post('/api/orders')
      .set('Authorization', adminBearer)
      .send({})
      .expect(201);

    // Shape check
    expect(res.body.data.order).toMatchObject({
      orderId: expect.any(String),
      status: expect.any(String),
      currency: expect.any(String),
      grandTotal: expect.any(String),
    });
  });

  test('201 → creates an order with minimal payload', async () => {
    const payload = {
      userId: currentUserId,
      currency: 'USD',
      status: 'pending',
      subtotal: '0.00',
      taxTotal: '0.00',
      grandTotal: '0.00',
      // contact fields tolerated by validator/service
      contactName: 'Ada Lovelace',
      contactPhone: '+15550002222',
      pickupSlotId: null,
    };

    const res = await agent
      .post('/api/orders')
      .set('Authorization', adminBearer)
      .send(payload)
      .expect(201);

    const order = res.body.data.order;
    expect(order).toMatchObject({
      userId: currentUserId,
      currency: 'USD',
      status: expect.any(String),
    });
  });
});

describe('GET /api/orders (list) & /api/orders/:id (getById)', () => {
  test('200 → lists orders w/ pagination meta', async () => {
    await seedOrder();

    const res = await agent
      .get('/api/orders?page=1&pageSize=5&orderBy=createdAt&orderDir=DESC')
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body.data.orders).toBeDefined();
    expect(res.body.meta).toMatchObject({
      page: 1,
      pageSize: 5,
    });
  });

  test('200 → getById returns one order (w/ items array if present)', async () => {
    const o = await seedOrder();

    const res = await agent
      .get(`/api/orders/${o.orderId}`)
      .set('Authorization', adminBearer)
      .expect(200);

    const order = res.body.data.order;
    expect(order).toBeDefined();
    expect(order).toMatchObject({ orderId: o.orderId });
  });

  test('404 → getById missing returns NotFound', async () => {
    const res = await agent
      .get(`/api/orders/${uuid()}`)
      .set('Authorization', adminBearer)
      .expect(404);

    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });
});

describe('PATCH orders (totals/contact/status/pickup-slot)', () => {
  test('200 → updateTotals recomputes/sets totals', async () => {
    const o = await seedOrder();

    const res = await agent
      .patch(`/api/orders/${o.orderId}/totals`)
      .set('Authorization', adminBearer)
      .send({ subtotal: '5.00', taxTotal: '1.00', grandTotal: '6.00' })
      .expect(200);

    expect(res.body.data.order).toMatchObject({
      subtotal: '5.00',
      taxTotal: '1.00',
      grandTotal: '6.00',
    });
  });

  test('200 → updateContact sets contact fields', async () => {
    const o = await seedOrder();

    const res = await agent
      .patch(`/api/orders/${o.orderId}/contact`)
      .set('Authorization', adminBearer)
      .send({
        contactName: 'Grace Hopper',
        contactPhone: '+15550003333',
        notes: 'Leave at front desk',
      })
      .expect(200);

    expect(res.body.data.order).toMatchObject({
      contactName: 'Grace Hopper',
      contactPhone: '+15550003333',
      notes: 'Leave at front desk',
    });
  });

  test('400 → changeStatus rejects invalid status', async () => {
    const o = await seedOrder({ status: 'pending' });

    const res = await agent
      .patch(`/api/orders/${o.orderId}/status`)
      .set('Authorization', adminBearer)
      .send({ status: 'invalid_status' })
      .expect(400);

    expect(res.body.code || res.body.error).toMatch(/BAD_REQUEST|VALIDATION/i);
  });

  test('404 → setPickupSlot with non-existent slot', async () => {
    const o = await seedOrder();

    const res = await agent
      .patch(`/api/orders/${o.orderId}/pickup-slot`)
      .set('Authorization', adminBearer)
      .send({ pickupSlotId: uuid() })
      .expect(404);

    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });

  test('200 → setPickupSlot unassigns with null', async () => {
    const o = await seedOrder();

    const res = await agent
      .patch(`/api/orders/${o.orderId}/pickup-slot`)
      .set('Authorization', adminBearer)
      .send({ pickupSlotId: null })
      .expect(200);

    expect(res.body.data.order.pickupSlotId).toBeNull();
  });
});

describe('Self-scoped endpoints', () => {
  test('200 → /api/orders/self returns only current user orders', async () => {
    // Create other user order to ensure filtering
    const otherUser = await UserModel.create({
      username: mkUsername('someone'),
      firstName: 'Other',
      lastName: 'User',
      email: `other${Date.now()}@e2e.test`,
      password: 'pw',
    });
    await seedOrder({ userId: otherUser.userId });
    await seedOrder({ userId: currentUserId });

    const res = await agent
      .get('/api/orders/self?page=1&pageSize=5')
      .set('Authorization', adminBearer)
      .expect(200);

    const orders = res.body.data.orders ?? [];
    expect(Array.isArray(orders)).toBe(true);

    // All returned orders should belong to current user
    for (const o of orders) {
      expect(o.userId).toBe(currentUserId);
    }
  });

  test('200 → /api/orders/self/:id returns own order', async () => {
    const mine = await seedOrder({ userId: currentUserId });

    const res = await agent
      .get(`/api/orders/self/${mine.orderId}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body.data.order.orderId).toBe(mine.orderId);
  });

  test("404 → /api/orders/self/:id for another user's order", async () => {
    const otherUser = await UserModel.create({
      username: mkUsername('alt'),
      firstName: 'Alt',
      lastName: 'User',
      email: `alt${Date.now()}@e2e.test`,
      password: 'pw',
    });
    const notMine = await seedOrder({ userId: otherUser.userId });

    const res = await agent
      .get(`/api/orders/self/${notMine.orderId}`)
      .set('Authorization', adminBearer)
      .expect(404);

    expect(res.body.code || res.body.error).toMatch(/NOT_FOUND/i);
  });
});

describe('DELETE /api/orders/:orderId (remove)', () => {
  test('200 → deletes order', async () => {
    const o = await seedOrder();

    const delRes = await agent
      .delete(`/api/orders/${o.orderId}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(delRes.body.data).toEqual({ deleted: true });

    // Subsequent get should now be 404
    const getRes = await agent
      .get(`/api/orders/${o.orderId}`)
      .set('Authorization', adminBearer)
      .expect(404);

    expect(getRes.body.code || getRes.body.error).toMatch(/NOT_FOUND/i);
  });
});
