/**
 * E2E — Stock routes with the REAL app + REAL MySQL (no mocks)
 *
 * - Spins up the actual Express app (imported from ../../app.js)
 * - Creates an admin directly in DB, logs in via /api/auth/login
 * - Uses Bearer auth for protected endpoints (all stock routes require auth; POSTs require employee/admin)
 * - Seeds a product via /api/products to satisfy FK
 * - Exercises:
 *    • GET  /api/stocks/on-hand (requires auth)
 *    • POST /api/stocks/adjust (protected)
 *    • POST /api/stocks/transfer (protected)
 *    • GET  /api/stocks (list)
 *    • GET  /api/stocks/filter (filter)
 *    • GET  /api/stocks/lots-of-product
 *    • POST /api/stocks/rebuild (protected)
 */

import 'reflect-metadata';
import { describe, test, beforeAll, afterAll, expect } from '@jest/globals';
import request from 'supertest';
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../../test-utils/mysql.js';
import { UserModel } from '../../models/user.model.js';
import { AuthorizationModel } from '../../models/authorization.model.js';
import { app } from '../../app.js';

/* ----------------------------- helpers ----------------------------- */

// Parse Set-Cookie header into a map
function parseSetCookie(setCookie: string[] | undefined) {
  const out: Record<string, string> = {};
  if (!setCookie) return out;
  for (const c of setCookie) {
    const [kv] = c.split(';');
    const [k, v] = kv.split('=');
    out[k.trim()] = (v ?? '').trim();
  }
  return out;
}

// Pull access/refresh tokens from cookies/body (controllers set cookies)
function pickToken(res: request.Response) {
  const body = res.body ?? {};
  const d = body.data ?? {};
  const tokens = d.tokens ?? d;

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
    const parsed = parseSetCookie(cookies);
    accessToken ||= parsed.accessToken ?? parsed.access_token ?? parsed.at;
    refreshToken ||= parsed.refreshToken ?? parsed.refresh_token ?? parsed.rt;
  }
  return { accessToken, refreshToken };
}

// Make a model-valid username (lowercase a-z0-9, max 20)
const mkUsername = (prefix: string) =>
  (prefix.toLowerCase().replace(/[^a-z0-9]/g, '') || 'u').slice(0, 10) +
  (Date.now() % 1_000_000).toString().padStart(6, '0');

// Simple product id safe for model validation
const mkProductId = (p = 'SKU') =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/* ---------------- Authorization header for admin ------------------ */
let adminBearer = '';

/* ---------------- Product / lot data used in tests ---------------- */
const product = {
  productId: mkProductId(),
  productName: 'E2E Beverage',
  brands: 'Acme',
};
const lotA = {
  location: 'WH1',
  zone: null as string | null,
  expirationDate: null as string | string | null,
} as const;
const lotB = {
  location: 'WH2',
  zone: null as string | null,
  expirationDate: null as string | string | null,
} as const;

/* ------------------------------- setup ------------------------------- */

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  // Fresh DB
  await sequelize.transaction(async (t) => {
    await cleanAllTables(t);
  });

  // Create an admin directly in DB
  const admin = await UserModel.create({
    username: mkUsername('admin'),
    firstName: 'Admin',
    lastName: 'User', // >= 2 chars to satisfy validation
    email: `admin${Date.now()}@e2e.test`,
    password: 'pw', // hashed by model hook
  });

  await AuthorizationModel.create({
    userId: admin.userId,
    role: 'administrator',
  });

  // Login via real auth route to obtain Bearer token from cookies
  const login = await request(app)
    .post('/api/auth/login')
    .send({ identifier: admin.username, password: 'pw' })
    .expect(200);

  const { accessToken } = pickToken(login);
  adminBearer = accessToken ? `Bearer ${accessToken}` : '';

  // Seed product via real products endpoint (protected)
  await request(app)
    .post('/api/products')
    .set('Authorization', adminBearer)
    .send(product)
    .expect(201);
});

afterAll(async () => {
  await sequelize.close();
});

/* -------------------------------- tests ------------------------------- */

describe('Stock routes — real DB + real app', () => {
  test('GET /api/stocks/on-hand → 401 without auth', async () => {
    await request(app)
      .get(
        `/api/stocks/on-hand?productId=${encodeURIComponent(
          product.productId
        )}&location=${encodeURIComponent(lotA.location)}`
      )
      .expect(401);
  });

  test('GET /api/stocks/on-hand → initial 0 (auth required)', async () => {
    const res = await request(app)
      .get(
        `/api/stocks/on-hand?productId=${encodeURIComponent(
          product.productId
        )}&location=${encodeURIComponent(lotA.location)}`
      )
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body?.data?.onHand).toBe(0);
  });

  test('POST /api/stocks/adjust (+10 @ WH1, price 5.00) → 200', async () => {
    const res = await request(app)
      .post('/api/stocks/adjust')
      .set('Authorization', adminBearer)
      .send({
        productId: product.productId,
        location: lotA.location,
        zone: lotA.zone,
        expirationDate: lotA.expirationDate,
        quantityDelta: +10,
        unitPrice: 5.0,
      })
      .expect(200);

    expect(res.body?.data?.finalQty).toBe(10);

    const onHand = await request(app)
      .get(
        `/api/stocks/on-hand?productId=${encodeURIComponent(
          product.productId
        )}&location=${encodeURIComponent(lotA.location)}`
      )
      .set('Authorization', adminBearer)
      .expect(200);

    expect(onHand.body?.data?.onHand).toBe(10);
  });

  test('POST /api/stocks/transfer (3 from WH1 → WH2) → 200', async () => {
    const res = await request(app)
      .post('/api/stocks/transfer')
      .set('Authorization', adminBearer)
      .send({
        from: {
          productId: product.productId,
          location: lotA.location,
          zone: lotA.zone,
          expirationDate: lotA.expirationDate,
        },
        to: {
          productId: product.productId,
          location: lotB.location,
          zone: lotB.zone,
          expirationDate: lotB.expirationDate,
        },
        quantity: 3,
        unitPrice: 5.25,
        reference: 'E2E-XFER-1',
      })
      .expect(200);

    expect(res.body?.data?.from?.finalQty).toBe(7);
    expect(res.body?.data?.to?.finalQty).toBe(3);

    const a = await request(app)
      .get(
        `/api/stocks/on-hand?productId=${encodeURIComponent(
          product.productId
        )}&location=${encodeURIComponent(lotA.location)}`
      )
      .set('Authorization', adminBearer)
      .expect(200);
    const b = await request(app)
      .get(
        `/api/stocks/on-hand?productId=${encodeURIComponent(
          product.productId
        )}&location=${encodeURIComponent(lotB.location)}`
      )
      .set('Authorization', adminBearer)
      .expect(200);

    expect(a.body?.data?.onHand).toBe(7);
    expect(b.body?.data?.onHand).toBe(3);
  });

  test('GET /api/stocks → list (auth) (200)', async () => {
    const res = await request(app)
      .get(
        '/api/stocks?page=1&pageSize=10&orderBy=createdAt&orderDir=DESC&q=WH'
      )
      .set('Authorization', adminBearer)
      .expect(200);

    expect(Array.isArray(res.body?.data?.lots)).toBe(true);
    expect(res.body?.meta).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 10,
        total: expect.any(Number),
        pages: expect.any(Number),
      })
    );
  });

  test('GET /api/stocks/filter → filter by productId + locations (200)', async () => {
    const filters = encodeURIComponent(
      JSON.stringify({
        productId: [product.productId],
        location: [lotA.location, lotB.location],
        zone: [null], // include null zones
        match: 'exact',
      })
    );

    const res = await request(app)
      .get(`/api/stocks/filter?filters=${filters}&page=1&pageSize=20`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(Array.isArray(res.body?.data?.lots)).toBe(true);
    const locs = (res.body.data.lots as any[]).map((l) => l.location);
    expect(locs).toEqual(
      expect.arrayContaining([lotA.location, lotB.location])
    );
  });

  test('GET /api/stocks/lots-of-product → returns all lots for product (200)', async () => {
    const res = await request(app)
      .get(
        `/api/stocks/lots-of-product?productId=${encodeURIComponent(
          product.productId
        )}`
      )
      .set('Authorization', adminBearer)
      .expect(200);

    expect(Array.isArray(res.body?.data?.lots)).toBe(true);
    // We should have at least the two lots we touched (WH1 & WH2)
    const locs = (res.body.data.lots as any[]).map((l) => l.location);
    expect(locs).toEqual(
      expect.arrayContaining([lotA.location, lotB.location])
    );
    expect(res.body?.meta?.total).toBe(res.body?.data?.lots.length);
  });

  test('POST /api/stocks/rebuild (WH1) → recomputes from movements (200)', async () => {
    const res = await request(app)
      .post('/api/stocks/rebuild')
      .set('Authorization', adminBearer)
      .send({
        productId: product.productId,
        location: lotA.location,
        zone: lotA.zone,
        expirationDate: lotA.expirationDate,
      })
      .expect(200);

    expect(res.body?.data?.lot?.productId).toBe(product.productId);
    // After +10 then transfer_out 3 → 7
    expect(Number(res.body?.data?.lot?.quantity)).toBe(7);
    expect(res.body?.data?.movements).toBeGreaterThanOrEqual(2);
  });

  test('GET /api/stocks/on-hand → missing required query triggers validation/controller error', async () => {
    const res = await request(app)
      .get('/api/stocks/on-hand?productId=&location=')
      .set('Authorization', adminBearer);

    // Some setups return 400 (validator/controller), others bubble as 500 via global handler.
    expect([400, 500]).toContain(res.status);

    const msg: string =
      res.body?.error?.message || res.body?.message || JSON.stringify(res.body);
    expect(msg.toLowerCase()).toContain('productid is required');
  });
});
