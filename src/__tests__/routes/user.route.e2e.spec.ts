/**
 * E2E — User routes with the REAL app + REAL MySQL (no route/controller mocks)
 * - Spins up the actual Express app (imported from ../../app.js)
 * - Uses /api/auth to log in as an admin user
 * - Sends Bearer auth on every request to /api/users/*
 * - Creates unique, model-valid usernames inline (^[a-z0-9]{2,20}$)
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

// Pull access/refresh tokens from body or cookies (our controllers set cookies)
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

// Authorization header store for admin
let adminBearer = '';
let adminCookies: string[] | undefined;

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
    lastName: 'User',
    email: `admin${Date.now()}@e2e.test`,
    password: 'pw', // hashed by model hook
  });

  await AuthorizationModel.create({
    userId: admin.userId,
    role: 'administrator',
  });

  // Login via real auth route to obtain cookies / bearer
  const login = await request(app)
    .post('/api/auth/login')
    .send({ identifier: admin.username, password: 'pw' })
    .expect(200);

  const { accessToken } = pickToken(login);
  adminBearer = accessToken ? `Bearer ${accessToken}` : '';

  // normalize 'set-cookie' header -> string[]
  const setCookieRaw = (
    login.headers as unknown as Record<string, string | string[]>
  )['set-cookie'];
  adminCookies = Array.isArray(setCookieRaw)
    ? setCookieRaw
    : typeof setCookieRaw === 'string'
    ? [setCookieRaw]
    : undefined;
});

afterAll(async () => {
  await sequelize.close();
});

/* -------------------------------- tests ------------------------------- */

describe('User routes — real DB + real app', () => {
  test('POST /api/users → create (201)', async () => {
    const username = mkUsername('alice');
    const email = `${username}@e2e.test`;

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Alice',
        lastName: 'Smith',
        email,
        password: 'x',
      })
      .expect(201);

    expect(res.body?.data?.user?.username).toBe(username);

    const row = await UserModel.findOne({ where: { username } });
    expect(row).not.toBeNull();
  });

  test('POST /api/users/employee → creates employee (201)', async () => {
    const username = mkUsername('bob');
    const email = `${username}@e2e.test`;

    const res = await request(app)
      .post('/api/users/employee')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Bob',
        lastName: 'Brown',
        email,
        password: 'y',
      })
      .expect(201);

    const userId = res.body?.data?.user?.userId;
    expect(userId).toBeTruthy();

    const auth = await AuthorizationModel.findOne({ where: { userId } });
    expect(auth?.role).toBe('employee');
  });

  test('GET /api/users → list (200)', async () => {
    const res = await request(app)
      .get('/api/users?page=1&pageSize=5')
      .set('Authorization', adminBearer)
      .expect(200);

    expect(Array.isArray(res.body?.data?.users)).toBe(true);
    expect(res.body?.meta).toBeTruthy();
  });

  test('GET /api/users/by-email → find by email (200)', async () => {
    const username = mkUsername('cara');
    const email = `${username}@e2e.test`;
    await request(app)
      .post('/api/users')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Cara',
        lastName: 'Lee',
        email,
        password: 'pw',
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/users/by-email?email=${encodeURIComponent(email)}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body?.data?.user?.email).toBe(email);
  });

  test('GET /api/users/by-username → find by username (200)', async () => {
    const username = mkUsername('dana');
    const email = `${username}@e2e.test`;
    await request(app)
      .post('/api/users')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Dana',
        lastName: 'Ray',
        email,
        password: 'pw',
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/users/by-username?username=${encodeURIComponent(username)}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body?.data?.user?.username).toBe(username);
  });

  test('GET /api/users/:id → getById (200)', async () => {
    const username = mkUsername('ella');
    const email = `${username}@e2e.test`;
    const created = await request(app)
      .post('/api/users')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Ella',
        lastName: 'Ng',
        email,
        password: 'pw',
      })
      .expect(201);

    const id = created.body?.data?.user?.userId;
    const res = await request(app)
      .get(`/api/users/${id}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body?.data?.user?.userId).toBe(id);
  });

  test('PATCH /api/users/:id → update (200)', async () => {
    const username = mkUsername('fred');
    const email = `${username}@e2e.test`;
    const created = await request(app)
      .post('/api/users')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Fred',
        lastName: 'Zimmer', // >= 2 chars
        email,
        password: 'pw',
      })
      .expect(201);

    const id = created.body?.data?.user?.userId;

    const res = await request(app)
      .patch(`/api/users/${id}`)
      .set('Authorization', adminBearer)
      .send({ firstName: 'Freddie' })
      .expect(200);

    expect(res.body?.data?.user?.firstName).toBe('Freddie');
  });

  test('PATCH /api/users/:id/password → changePassword (200)', async () => {
    const username = mkUsername('gary');
    const email = `${username}@e2e.test`;
    const created = await request(app)
      .post('/api/users')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Gary',
        lastName: 'Hughes', // >= 2 chars
        email,
        password: 'current',
      })
      .expect(201);

    const id = created.body?.data?.user?.userId;

    const res = await request(app)
      .patch(`/api/users/${id}/password`)
      .set('Authorization', adminBearer)
      .send({ currentPassword: 'current', newPassword: 'newpw' })
      .expect(200);

    expect(res.body?.data?.success).toBe(true);
  });

  test('PATCH /api/users/:id/verified → setVerified (200)', async () => {
    const username = mkUsername('ivy');
    const email = `${username}@e2e.test`;
    const created = await request(app)
      .post('/api/users')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Ivy',
        lastName: 'Quinn', // >= 2 chars
        email,
        password: 'pw',
      })
      .expect(201);

    const id = created.body?.data?.user?.userId;

    const res = await request(app)
      .patch(`/api/users/${id}/verified`)
      .set('Authorization', adminBearer)
      .send({ verified: true })
      .expect(200);

    expect(res.body?.data?.user?.verified).toBe(true);
  });

  test('PATCH /api/users/:id/role → setRole (200)', async () => {
    const username = mkUsername('jade');
    const email = `${username}@e2e.test`;
    const created = await request(app)
      .post('/api/users')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Jade',
        lastName: 'Kane', // >= 2 chars
        email,
        password: 'pw',
      })
      .expect(201);

    const id = created.body?.data?.user?.userId;

    const res = await request(app)
      .patch(`/api/users/${id}/role`)
      .set('Authorization', adminBearer)
      .send({ role: 'employee' })
      .expect(200);

    expect(res.body?.data?.user?.authorization?.role).toBe('employee');
  });

  test('DELETE /api/users/:id → remove (200)', async () => {
    const username = mkUsername('kate');
    const email = `${username}@e2e.test`;
    const created = await request(app)
      .post('/api/users')
      .set('Authorization', adminBearer)
      .send({
        username,
        firstName: 'Kate',
        lastName: 'Reed', // >= 2 chars
        email,
        password: 'pw',
      })
      .expect(201);

    const id = created.body?.data?.user?.userId;

    const res = await request(app)
      .delete(`/api/users/${id}`)
      .set('Authorization', adminBearer)
      .expect(200);

    expect(res.body?.data?.success).toBe(true);

    const gone = await UserModel.findByPk(id);
    expect(gone).toBeNull();
  });
});
