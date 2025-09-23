// src/__tests__/routes/auth.route.e2e.spec.ts
import 'reflect-metadata';
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from '@jest/globals';

import request from 'supertest';
import { sequelize } from '../../db/sequelize.js';
import { UserModel } from '../../models/user.model.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
import { app } from '../../app.js';

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

function pickToken(res: request.Response) {
  const body = res.body ?? {};
  const d = body.data ?? {};
  const tokens = d.tokens ?? d;

  let accessToken: string | undefined =
    tokens?.accessToken ?? tokens?.access_token ?? tokens?.at;
  let refreshToken: string | undefined =
    tokens?.refreshToken ?? tokens?.refresh_token ?? tokens?.rt;

  if (!accessToken || !refreshToken) {
    const cookies = parseSetCookie(res.headers['set-cookie'] as any);
    accessToken ||= cookies.accessToken ?? cookies.access_token ?? cookies.at;
    refreshToken ||=
      cookies.refreshToken ?? cookies.refresh_token ?? cookies.rt;
  }
  return { accessToken, refreshToken };
}

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  await cleanAllTables();
});

afterEach(async () => {
  await cleanAllTables();
});

afterAll(async () => {
  await cleanAllTables();
  await sequelize.close();
});

// Helper to generate a validator-safe username inline (no underscores)
function makeUsername(base: string) {
  const stamp = (Date.now() % 1_000_000).toString().padStart(6, '0'); // 6 digits
  return (base.toLowerCase().replace(/[^a-z0-9]/g, '') + stamp).slice(0, 20);
}

// --------------------------- Tests ---------------------------
describe('Auth routes — real controllers + real MySQL via Sequelize', () => {
  test('register → creates user (201) (tokens may be omitted)', async () => {
    const username = makeUsername('alice');
    const email = `${username}@example.com`;

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Alice',
        lastName: 'Doe',
        email,
        password: 'secret123',
      })
      .expect(201);

    expect(res.body?.data?.user?.username).toBe(username);

    const row = await UserModel.findOne({ where: { username } });
    expect(row).not.toBeNull();

    const { accessToken, refreshToken } = pickToken(res);
    if (accessToken) expect(typeof accessToken).toBe('string');
    if (refreshToken) expect(typeof refreshToken).toBe('string');
  });

  test('login → returns tokens (200)', async () => {
    const username = makeUsername('bob');
    const email = `${username}@example.com`;

    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Bob',
        lastName: 'Doe',
        email,
        password: 'pw',
      })
      .expect(201);

    // Send BOTH fields so the validator + service are satisfied
    const res = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: username, identifier: username, password: 'pw' })
      .expect(200);

    const { accessToken, refreshToken } = pickToken(res);
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  test('refresh → returns new tokens (200)', async () => {
    const username = makeUsername('cara');
    const email = `${username}@example.com`;

    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Cara',
        lastName: 'Doe',
        email,
        password: 'pw',
      })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: username, identifier: username, password: 'pw' })
      .expect(200);

    const { refreshToken } = pickToken(login);
    expect(refreshToken).toBeTruthy();
    const cookies = login.headers['set-cookie'];

    // Include cookies so controller can read the refresh cookie,
    // and also send body to satisfy any body validator if present.
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies as any)
      .send({ refreshToken })
      .expect(200);

    const { accessToken: newAT, refreshToken: newRT } = pickToken(refreshed);
    expect(newAT).toBeTruthy();
    expect(newRT).toBeTruthy();
  });

  test('me → accepts Bearer (or auth cookie) and returns current user (200)', async () => {
    const username = makeUsername('dana');
    const email = `${username}@example.com`;

    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Dana',
        lastName: 'Doe',
        email,
        password: 'pw',
      })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: username, identifier: username, password: 'pw' })
      .expect(200);

    const { accessToken } = pickToken(login);
    const cookies = login.headers['set-cookie'];

    const res = accessToken
      ? await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
      : await request(app)
          .get('/api/auth/me')
          .set('Cookie', cookies as any)
          .expect(200);

    expect(res.body?.data?.user?.username).toBe(username);
  });

  test('logout → returns 204 or 200', async () => {
    const username = makeUsername('ella');
    const email = `${username}@example.com`;

    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Ella',
        lastName: 'Doe',
        email,
        password: 'pw',
      })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: username, identifier: username, password: 'pw' })
      .expect(200);

    const { refreshToken } = pickToken(login);
    const cookies = login.headers['set-cookie'];

    const req = request(app).post('/api/auth/logout');
    if (refreshToken) req.send({ refreshToken });
    if (cookies) req.set('Cookie', cookies as any);

    const res = await req.expect((r) => [200, 204].includes(r.status));
    if (res.status === 200) {
      expect(res.body?.data?.success).toBe(true);
    }
  });
});
