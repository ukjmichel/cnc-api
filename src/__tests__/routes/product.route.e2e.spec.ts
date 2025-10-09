/**
 * E2E — Product routes with the REAL app + REAL MySQL (no mocks)
 *
 * - Spins up the actual Express app (imported from ../../app.js)
 * - Creates an admin directly in DB, logs in via /api/auth/login
 * - Uses Bearer auth for protected product endpoints
 * - Exercises: create, list, filter, by-code, getById, update, delete
 */


import request from 'supertest';
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
import { UserModel } from '../../models/user.model.js';
import { AuthorizationModel } from '../../models/authorization.model.js';
import { ProductModel } from '../../models/product.model.js';
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

const mkProductId = (prefix = 'EAN') =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const mkProductCode = () => `code-${Math.floor(Math.random() * 1e9)}`;

/* ---------------- Authorization header for admin ------------------ */
let adminBearer = '';

/* ------------------------------- setup ------------------------------- */

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  // Fresh DB
  await cleanAllTables();

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
});

afterAll(async () => {
  await sequelize.close();
});

/* -------------------------------- tests ------------------------------- */

describe('Product routes — real DB + real app', () => {
  test('POST /api/products → create (201)', async () => {
    const productId = mkProductId();
    const productCode = mkProductCode();

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', adminBearer)
      .send({
        productId,
        productCode,
        productName: 'Sparkling Water',
        brands: 'Acme',
        quantity: 6,
        quantityUnit: 'bottles',
        description: '6x500ml pack',
      })
      .expect(201);

    expect(res.body?.data?.product?.productId).toBe(productId);
    expect(res.body?.data?.product?.productCode).toBe(
      productCode.toUpperCase?.() ?? productCode
    );

    const row = await ProductModel.findByPk(productId);
    expect(row).not.toBeNull();
  });

  test('GET /api/products → list (200, public)', async () => {
    const res = await request(app)
      .get(
        '/api/products?page=1&pageSize=5&orderBy=createdAt&orderDir=DESC&q=water'
      )
      .expect(200);

    expect(Array.isArray(res.body?.data?.products)).toBe(true);
    expect(res.body?.meta).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 5,
        total: expect.any(Number),
        pages: expect.any(Number),
      })
    );
  });

  test('GET /api/products/filter → filter (200, public)', async () => {
    // Seed a specific product to hit with startsWith
    const productId = mkProductId();
    await request(app)
      .post('/api/products')
      .set('Authorization', adminBearer)
      .send({
        productId,
        productName: 'SodaMax Orange',
        brands: 'FizzCo',
      })
      .expect(201);

    const filters = encodeURIComponent(
      JSON.stringify({ productName: ['Soda'], match: 'startsWith' })
    );

    const res = await request(app)
      .get(`/api/products/filter?filters=${filters}&page=1&pageSize=10`)
      .expect(200);

    expect(Array.isArray(res.body?.data?.products)).toBe(true);
    const ids = res.body.data.products.map((p: any) => p.productId);
    expect(ids).toContain(productId);
  });

  test('GET /api/products/by-code → find by code (200, public)', async () => {
    const productId = mkProductId();
    const productCode = mkProductCode(); // will be normalized upper-case in service/model

    await request(app)
      .post('/api/products')
      .set('Authorization', adminBearer)
      .send({
        productId,
        productCode,
        productName: 'Cola Classic',
        brands: 'FizzCo',
      })
      .expect(201);

    const res = await request(app)
      .get(
        `/api/products/by-code?productCode=${encodeURIComponent(
          productCode.toLowerCase()
        )}`
      )
      .expect(200);

    expect(res.body?.data?.product?.productId).toBe(productId);
    expect(res.body?.data?.product?.productCode).toBe(
      productCode.toUpperCase?.() ?? productCode
    );
  });

  test('GET /api/products/:id → getById (200, public)', async () => {
    const productId = mkProductId();

    await request(app)
      .post('/api/products')
      .set('Authorization', adminBearer)
      .send({
        productId,
        productName: 'Iced Tea',
        brands: 'Leafy',
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/products/${productId}`)
      .expect(200);
    expect(res.body?.data?.product?.productId).toBe(productId);
  });

  test('PATCH /api/products/:id → update (200, protected)', async () => {
    const productId = mkProductId();

    await request(app)
      .post('/api/products')
      .set('Authorization', adminBearer)
      .send({
        productId,
        productName: 'Energy Drink',
        brands: 'Volt',
      })
      .expect(201);

    const res = await request(app)
      .patch(`/api/products/${productId}`)
      .set('Authorization', adminBearer)
      .send({ productName: 'Energy Drink Zero' })
      .expect(200);

    expect(res.body?.data?.product?.productName).toBe('Energy Drink Zero');
  });

  test('DELETE /api/products/:id → remove (200, protected)', async () => {
    const productId = mkProductId();

    await request(app)
      .post('/api/products')
      .set('Authorization', adminBearer)
      .send({
        productId,
        productName: 'Mineral Water',
        brands: 'AquaPure',
      })
      .expect(201);

    const res = await request(app)
      .delete(`/api/products/${productId}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body?.data?.success).toBe(true);

    const gone = await ProductModel.findByPk(productId);
    expect(gone).toBeNull();
  });
});
