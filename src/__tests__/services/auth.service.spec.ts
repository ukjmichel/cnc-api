// src/__tests__/routes/auth.route.e2e.spec.ts
/**
 * =============================================================================
 * Auth routes — real controllers + real MySQL via Sequelize (E2E)
 * =============================================================================
 * - Uses real AuthService + controllers + models (no mocks)
 * - Connects to the real MySQL defined in src/config/env.ts
 * - Cleans all tables between tests
 * - Generates VALID usernames (^[a-z0-9]{2,20}$) to satisfy UserModel
 * - Accepts tokens from response body OR auth cookies
 * =============================================================================
 */

import 'reflect-metadata';
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from '@jest/globals';

import express from 'express';
import request from 'supertest';

import { Sequelize } from 'sequelize-typescript';
import { config } from '../../config/env.js';
import { cleanAllTables } from '../../../test-utils/mysql.js';

import { UserModel } from '../../models/user.model.js';
import { AuthorizationModel } from '../../models/authorization.model.js';
// If you re-export, you can import from '../../routes/index.js' instead.
import { authRouter } from '../../routes/auth.route.js';
import { app } from '../../app.js';

/* ============================ DB setup (real) ============================= */

let sequelize: Sequelize;

function makeSequelize(): Sequelize {
  return new Sequelize({
    dialect: 'mysql',
    host: config.mysqlHost,
    port: config.mysqlPort,
    database: config.mysqlDatabase,
    username: config.mysqlUser,
    password: config.mysqlPassword,
    logging: config.dbLogSql ? console.log : false,
    pool: {
      max: config.mysqlPool.max,
      min: config.mysqlPool.min,
      acquire: config.mysqlPool.acquire,
      idle: config.mysqlPool.idle,
    },
    models: [UserModel, AuthorizationModel],
  });
}

/* =============================== Utilities ================================ */

// Generate a VALID username per model validator: ^[a-z0-9]{2,20}$
function genUsername(base: string): string {
  // base should be alphanumeric, we enforce and trim to make space for suffix
  const sanitizedBase = base.toLowerCase().replace(/[^a-z0-9]/g, '') || 'u';
  // 6-digit time suffix ensures uniqueness, digits are allowed
  const suffix = (Date.now() % 1_000_000).toString().padStart(6, '0');
  // ensure length <= 20
  const take = Math.max(2, 20 - suffix.length);
  let candidate = (sanitizedBase.slice(0, take) + suffix).slice(0, 20);
  // Ensure min length 2
  if (candidate.length < 2) candidate = candidate.padEnd(2, '0');
  return candidate;
}

function genEmail(local: string) {
  const safeLocal = local.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  const stamp = (Date.now() % 1_000_000).toString().padStart(6, '0');
  return `${safeLocal}${stamp}@e2e.test`;
}

function pickToken(res: request.Response) {
  const accessToken =
    res.body?.data?.accessToken ?? res.body?.data?.tokens?.accessToken ?? null;
  const refreshToken =
    res.body?.data?.refreshToken ??
    res.body?.data?.tokens?.refreshToken ??
    null;
  return { accessToken, refreshToken };
}

/* ================================= Hooks ================================== */

beforeAll(async () => {
  sequelize = makeSequelize();
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  await sequelize.transaction(async (t) => {
    await cleanAllTables(t);
  });
});

afterEach(async () => {
  await sequelize.transaction(async (t) => {
    await cleanAllTables(t);
  });
});

afterAll(async () => {
  await sequelize.close();
});

/* ================================= Tests ================================== */

describe('Auth routes — real controllers + real MySQL via Sequelize', () => {
  test('register → creates user (201) (tokens may be omitted)', async () => {
    const username = genUsername('alice');
    const email = genEmail('alice');

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

    // user persisted
    expect(res.body?.data?.user?.username).toBe(username);
    const row = await UserModel.findOne({ where: { username } });
    expect(row).not.toBeNull();
  });

  test('login → returns tokens (200)', async () => {
    const username = genUsername('bob');
    const email = genEmail('bob');

    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Bob',
        lastName: 'Smith',
        email,
        password: 'pw',
      })
      .expect(201);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: username, password: 'pw' })
      .expect(200);

    const { accessToken, refreshToken } = pickToken(res);
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  test('refresh → returns new tokens (200)', async () => {
    const username = genUsername('cara');
    const email = genEmail('cara');

    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Cara',
        lastName: 'Lee',
        email,
        password: 'pw',
      })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: username, password: 'pw' })
      .expect(200);

    const { refreshToken } = pickToken(login);
    expect(refreshToken).toBeTruthy();

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    const tokens2 = pickToken(refreshed);
    expect(tokens2.accessToken).toBeTruthy();
    expect(tokens2.refreshToken).toBeTruthy();
  });

  test('me → accepts Bearer (or auth cookie) and returns current user (200)', async () => {
    const username = genUsername('dana');
    const email = genEmail('dana');

    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Dana',
        lastName: 'Ray',
        email,
        password: 'pw',
      })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: username, password: 'pw' })
      .expect(200);

    const { accessToken } = pickToken(login);
    const cookies = login.headers['set-cookie'];

    // Prefer Bearer; fallback to cookies if your middleware supports it
    const res = await request(app)
      .get('/api/auth/me')
      .set(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      .set(!accessToken && cookies ? { Cookie: cookies } : {})
      .expect(200);

    expect(res.body?.data?.user?.username).toBe(username);
  });

  test('logout → returns 204 or 200', async () => {
    const username = genUsername('ella');
    const email = genEmail('ella');

    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Ella',
        lastName: 'Ng',
        email,
        password: 'pw',
      })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: username, password: 'pw' })
      .expect(200);

    const { refreshToken } = pickToken(login);
    const cookies = login.headers['set-cookie'];

    const res = await request(app)
      .post('/api/auth/logout')
      .set(cookies ? { Cookie: cookies } : {})
      // Some implementations want refreshToken in the body; include if present
      .send(refreshToken ? { refreshToken } : {})
      // allow either 204 No Content or 200 OK
      .expect((r) => {
        if (![200, 204].includes(r.status)) {
          throw new Error(`Unexpected status ${r.status}`);
        }
      });

    if (res.status === 200) {
      expect(res.body?.data?.success).toBe(true);
    }
  });
});
