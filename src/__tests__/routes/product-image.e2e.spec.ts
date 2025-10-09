/**
 * E2E – Product Image routes with the REAL app + REAL MySQL (no mocks)
 *
 * - Spins up the actual Express app (imported from ../../app.js)
 * - Creates an admin directly in DB, logs in via /api/auth/login
 * - Uses Bearer auth for protected endpoints
 * - Exercises:
 *    • create (JSON)
 *    • getByProduct (PUBLIC)
 *    • getById
 *    • update
 *    • upsert (create + update)
 *    • upload (multipart)
 *    • list
 *    • filter
 *    • delete by (productId, variant)
 *    • delete by id
 *    • delete all by product
 */

import request from 'supertest';
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
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

// ProductModel validation dislikes ":", so keep to safe chars
const mkProductId = (prefix = 'SKU') =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const mkProductCode = () => `code-${Math.floor(Math.random() * 1e9)}`;
const mkUrl = (tag = '') =>
  `https://cdn.example.com/e2e${tag ? '-' + tag : ''}.jpg`;

/* ---------------- Authorization header for admin ------------------ */
let adminBearer = '';
let consoleErrorSpy: jest.SpyInstance;

/* ------------------------------- setup ------------------------------- */

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  // Fresh DB
  await cleanAllTables();

  // Suppress console.error for expected test errors
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  // Create an admin directly in DB
  const admin = await UserModel.create({
    username: mkUsername('admin'),
    firstName: 'Admin',
    lastName: 'User',
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
  consoleErrorSpy.mockRestore();
  await sequelize.close();
});

/* -------------------------------- tests ------------------------------- */

describe('Product Image routes – real DB + real app', () => {
  // Create a product once to attach images to
  const product = {
    productId: mkProductId(),
    productCode: mkProductCode(),
    productName: 'Mineral Water',
    brands: 'Acme',
    quantity: 6,
    quantityUnit: 'bottles',
    description: '6x500ml pack',
  };

  // keep image ids for later cleanup checks
  const variants = {
    front: 'front',
    back: 'back',
    cover: 'cover',
    left: 'left',
    right: 'right',
  } as const;

  let frontId: string | undefined;
  let backId: string | undefined;

  test('seed product (protected)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', adminBearer)
      .send(product)
      .expect(201);

    expect(res.body.data.product.productId).toBe(product.productId);
  });

  test('POST /api/product-images → create (201)', async () => {
    const body = {
      productId: product.productId,
      url: mkUrl('front'),
      variant: variants.front,
      alt: 'Front image',
    };

    const res = await request(app)
      .post('/api/product-images')
      .set('Authorization', adminBearer)
      .send(body)
      .expect(201);

    const img = res.body.data.image;
    expect(img).toMatchObject({
      productId: product.productId,
      variant: variants.front,
      url: body.url,
    });
    frontId = img.imageId;
  });

  test('GET /api/product-images/by-product (PUBLIC) → returns image (200)', async () => {
    const res = await request(app)
      .get(
        `/api/product-images/by-product?productId=${encodeURIComponent(
          product.productId
        )}&variant=${encodeURIComponent(variants.front)}`
      )
      .expect(200);

    const img = res.body.data.image;
    expect(img).toMatchObject({
      productId: product.productId,
      variant: variants.front,
    });
  });

  test('GET /api/product-images/:id (200, protected)', async () => {
    const res = await request(app)
      .get(`/api/product-images/${frontId}`)
      .set('Authorization', adminBearer)
      .expect(200);

    const img = res.body.data.image;
    expect(img.imageId).toBe(frontId);
  });

  test('PATCH /api/product-images/:id → update (200)', async () => {
    const patch = { alt: 'Front hero', url: mkUrl('front-updated') };

    const res = await request(app)
      .patch(`/api/product-images/${frontId}`)
      .set('Authorization', adminBearer)
      .send(patch)
      .expect(200);

    const img = res.body.data.image;
    expect(img).toMatchObject({
      alt: patch.alt,
      url: patch.url,
    });
  });

  test('POST /api/product-images/upsert → creates new variant (200)', async () => {
    const payload = {
      productId: product.productId,
      variant: variants.back,
      url: mkUrl('back'),
      alt: 'Back shot',
    };

    const res = await request(app)
      .post('/api/product-images/upsert')
      .set('Authorization', adminBearer)
      .send(payload)
      .expect(200);

    const img = res.body.data.image;
    backId = img.imageId;
    expect(img).toMatchObject({
      variant: variants.back,
      url: payload.url,
    });
  });

  test('POST /api/product-images/upsert → updates existing variant (200)', async () => {
    const payload = {
      productId: product.productId,
      variant: variants.back,
      url: mkUrl('back-updated'),
      alt: 'Back updated',
    };

    const res = await request(app)
      .post('/api/product-images/upsert')
      .set('Authorization', adminBearer)
      .send(payload)
      .expect(200);

    const img = res.body.data.image;
    expect(img).toMatchObject({
      variant: variants.back,
      url: payload.url,
      alt: payload.alt,
    });
  });

  test('POST /api/product-images/upload (multipart) → creates row (201)', async () => {
    const fileBuf = Buffer.from('fake-jpeg-content');

    const res = await request(app)
      .post('/api/product-images/upload')
      .set('Authorization', adminBearer)
      .field('productId', product.productId)
      .field('variant', variants.cover)
      .field('alt', 'Cover img')
      .attach('image', fileBuf, 'cover.jpg')
      .expect(201);

    const img = res.body.data.image;
    expect(img).toMatchObject({
      productId: product.productId,
      variant: variants.cover,
    });
    expect(img.url).toBeTruthy();
    expect(typeof img.url).toBe('string');
  });

  test('GET /api/product-images → list (200)', async () => {
    const res = await request(app)
      .get(
        '/api/product-images?page=1&pageSize=5&orderBy=createdAt&orderDir=DESC&q=e2e'
      )
      .set('Authorization', adminBearer)
      .expect(200);

    expect(Array.isArray(res.body.data.images)).toBe(true);
    expect(res.body.meta).toMatchObject({
      page: 1,
      pageSize: 5,
      total: expect.any(Number),
      pages: expect.any(Number),
    });
  });

  test('GET /api/product-images/filter → filter (200)', async () => {
    const filters = encodeURIComponent(
      JSON.stringify({
        productId: [product.productId],
        variant: [variants.front, variants.back, variants.cover],
        match: 'like',
      })
    );

    const res = await request(app)
      .get(`/api/product-images/filter?filters=${filters}&page=1&pageSize=10`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(Array.isArray(res.body.data.images)).toBe(true);
    const ids = res.body.data.images.map((i: any) => i.productId);
    expect(ids).toContain(product.productId);
  });

  test('DELETE /api/product-images/by-product?productId=&variant= (200)', async () => {
    const res = await request(app)
      .delete(
        `/api/product-images/by-product?productId=${encodeURIComponent(
          product.productId
        )}&variant=${encodeURIComponent(variants.front)}`
      )
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body.data.success).toBe(true);
  });

  test('DELETE /api/product-images/:id → remove by id (200)', async () => {
    const res = await request(app)
      .delete(`/api/product-images/${backId}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body.data.success).toBe(true);
  });

  test('DELETE /api/product-images/by-product/:productId → remove all (200)', async () => {
    // Add two more via upsert
    await request(app)
      .post('/api/product-images/upsert')
      .set('Authorization', adminBearer)
      .send({
        productId: product.productId,
        variant: variants.left,
        url: mkUrl('left'),
        alt: 'left',
      })
      .expect(200);

    await request(app)
      .post('/api/product-images/upsert')
      .set('Authorization', adminBearer)
      .send({
        productId: product.productId,
        variant: variants.right,
        url: mkUrl('right'),
        alt: 'right',
      })
      .expect(200);

    const res = await request(app)
      .delete(`/api/product-images/by-product/${product.productId}`)
      .set('Authorization', adminBearer)
      .expect(200);

    const out = res.body.data;
    expect(out.success).toBe(true);
    expect(typeof out.deleted).toBe('number');
    expect(out.deleted).toBeGreaterThanOrEqual(2);
  });
});
