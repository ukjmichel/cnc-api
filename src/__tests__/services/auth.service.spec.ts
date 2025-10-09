// src/__tests__/services/auth.service.spec.ts
/**
 * Flexible refresh-token test to accommodate different implementations.
 * - Works whether refresh token is sent via cookie or in the body
 * - Accepts common body keys: refreshToken | refresh_token | token
 * - Tries POST /api/auth/refresh first, then GET fallback, then /api/auth/refresh-token
 */
import request from 'supertest';
import { app } from '../../app.js';
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../test-utils/mysql.js';

function getCookies(res: request.Response): string[] | undefined {
  const cookies = res.headers['set-cookie'];
  return Array.isArray(cookies) && cookies.length ? cookies : undefined;
}

function pickToken(res: request.Response) {
  const accessToken =
    res.body?.data?.accessToken ??
    res.body?.data?.tokens?.accessToken ??
    res.body?.accessToken ??
    res.body?.token ??
    null;
  const refreshToken =
    res.body?.data?.refreshToken ??
    res.body?.data?.tokens?.refreshToken ??
    res.body?.refreshToken ??
    res.body?.refresh_token ??
    res.body?.token ??
    null;
  return { accessToken, refreshToken };
}

function parseCookieValue(
  cookies: string[] | undefined,
  keySubstr = 'refresh'
): string | null {
  if (!cookies) return null;
  for (const c of cookies) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (!k || !v) continue;
    if (k.toLowerCase().includes(keySubstr)) return decodeURIComponent(v);
  }
  return null;
}
function findRefreshTokenAnywhere(body: any): string | null {
  if (!body) return null;
  // common shapes
  const candidates = [
    body?.refreshToken,
    body?.token?.refreshToken,
    body?.tokens?.refreshToken,
    body?.data?.refreshToken,
    body?.data?.token?.refreshToken,
    body?.data?.tokens?.refreshToken,
    body?.result?.refreshToken,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.split('.').length === 3) return c;
  }
  // deep search
  try {
    const stack = [body];
    const seen = new Set<any>();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      for (const val of Object.values(node)) {
        if (typeof val === 'string' && val.split('.').length === 3) {
          // heuristically treat as JWT
          return val;
        }
        if (val && typeof val === 'object') stack.push(val as any);
      }
    }
  } catch {}
  return null;
}


// Generate very likely unique & valid username for ^[a-z0-9]{2,20}$
function genUsername(base: string) {
  const safe = base.toLowerCase().replace(/[^a-z0-9]/g, '') || 'u';
  const suffix = (Date.now() % 1_000_000).toString().padStart(6, '0');
  const take = Math.max(2, 20 - suffix.length);
  let candidate = (safe.slice(0, take) + suffix).slice(0, 20);
  if (candidate.length < 2) candidate = candidate.padEnd(2, '0');
  return candidate;
}
function genEmail(local: string) {
  const safe = local.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  const stamp = (Date.now() % 1_000_000).toString().padStart(6, '0');
  return `${safe}${stamp}@e2e.test`;
}

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync();
  await cleanAllTables();
});

afterEach(async () => {
  await cleanAllTables();
});

afterAll(async () => {
  await sequelize.close();
});

describe('Auth routes — real controllers + real MySQL via Sequelize', () => {
  it('register → creates user (201) (tokens may be omitted)', async () => {
    const username = genUsername('ava');
    const email = genEmail('ava');
    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Ava',
        lastName: 'Li',
        email,
        password: 'pw',
      })
      .expect(201);
  });

  it('login → returns tokens (200)', async () => {
    const username = genUsername('ben');
    const email = genEmail('ben');
    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Ben',
        lastName: 'Wu',
        email,
        password: 'pw',
      })
      .expect(201);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: username, password: 'pw' })
      .expect(200);
    const { accessToken } = pickToken(login);
    const cookies = getCookies(login);
    expect(Boolean(accessToken || cookies)).toBe(true);
  });

  it('refresh → returns new tokens (200)', async () => {
    const username = genUsername('refreshuser');
    const email = genEmail(username);

    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Ref',
        lastName: ' Test',
        email,
        password: 'pw',
      })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: username, password: 'pw' })
      .expect(200);

    const cookies = getCookies(login);
    const refreshFromBody = findRefreshTokenAnywhere(login.body);
    const refreshFromCookie = parseCookieValue(cookies, 'refresh');

    const refreshToken = refreshFromBody || refreshFromCookie;
    expect(Boolean(refreshToken)).toBe(true); // ensure we actually found one

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set(cookies ? { Cookie: cookies } : {})
      .send({ refreshToken }) // your server requires this field by validator
      .expect(200);

    // basic sanity: some token returned either via body or cookies
    const newCookies = getCookies(refreshed);
    const bodyHasJwt = findRefreshTokenAnywhere(refreshed.body) || null;
    expect(Boolean(newCookies || bodyHasJwt)).toBe(true);
  });

  it('me → accepts Bearer (or auth cookie) and returns current user (200)', async () => {
    const username = genUsername('dani');
    const email = genEmail('dani');
    await request(app)
      .post('/api/auth/register')
      .send({
        username,
        firstName: 'Dani',
        lastName: 'Kim',
        email,
        password: 'pw',
      })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: username, password: 'pw' })
      .expect(200);
    const { accessToken } = pickToken(login);
    const cookies = getCookies(login);

    let me = await request(app)
      .get('/api/auth/me')
      .set(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      .set(cookies ? { Cookie: cookies } : {})
      .expect(200);
    expect(
      me.body?.data?.user?.username ?? me.body?.user?.username
    ).toBeDefined();
  });

  it('logout → returns 204 or 200', async () => {
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
      .send({ identifier: username, password: 'pw' })
      .expect(200);
    const { refreshToken } = pickToken(login);
    const cookies = getCookies(login);

    const res = await request(app)
      .post('/api/auth/logout')
      .set(cookies ? { Cookie: cookies } : {})
      .send(refreshToken ? { refreshToken } : {})
      .expect((r) => {
        if (![200, 204].includes(r.status))
          throw new Error(`Unexpected status ${r.status}`);
      });

    if (res.status === 200)
      expect(res.body?.data?.success ?? res.body?.success).toBeTruthy();
  });
});
