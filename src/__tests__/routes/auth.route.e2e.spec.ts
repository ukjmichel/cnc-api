import 'reflect-metadata';
import { jest } from '@jest/globals';

const asMock = (fn: unknown) => fn as jest.MockedFunction<any>;

/* ========================= Mocks (BEFORE imports) ========================= */

// validators: pass-through, so we can assert they ran
const vRegisterBody = jest.fn((req: any, _res: any, next: any) => next());
const vLoginBody = jest.fn((req: any, _res: any, next: any) => next());
const vRefreshBody = jest.fn((req: any, _res: any, next: any) => next());
jest.unstable_mockModule('../../validators/auth.validators.js', () => ({
  vRegisterBody,
  vLoginBody,
  vRefreshBody,
}));

// guard for /me
const requireAuth = jest.fn((req: any, _res: any, next: any) => next());
jest.unstable_mockModule('../../middlewares/requireAuth.js', () => ({
  requireAuth,
}));

// controller handlers (annotate params as any so res isn't unknown)
const ctrl = {
  register: jest.fn(async (_req: any, res: any) =>
    res.status(201).json({
      data: {
        user: { userId: 'u1', username: 'alice' },
        tokens: { accessToken: 'acc', refreshToken: 'ref' },
      },
    })
  ),
  login: jest.fn(async (_req: any, res: any) =>
    res.json({ data: { accessToken: 'acc', refreshToken: 'ref' } })
  ),
  refresh: jest.fn(async (_req: any, res: any) =>
    res.json({ data: { accessToken: 'newacc', refreshToken: 'newref' } })
  ),
  logout: jest.fn(async (_req: any, res: any) =>
    res.json({ data: { success: true } })
  ),
  me: jest.fn(async (_req: any, res: any) =>
    res.json({ data: { user: { userId: 'me', username: 'current' } } })
  ),
};
jest.unstable_mockModule('../../controllers/auth.controller.js', () => ({
  AuthController: ctrl,
}));

/* ========================== Load SUT after mocks ========================== */
import express from 'express';
import request from 'supertest';
const { authRouter } = await import('../../routes/auth.route');

/* =============================== Test app ================================= */
const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  return app;
};

let app: express.Express;
beforeEach(() => {
  jest.clearAllMocks();
  app = makeApp();
});

/* ================================= Tests ================================== */

describe('Auth routes — wiring, validators, guards', () => {
  test('POST /api/auth/register → runs validator & controller (201)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Doe',
        email: 'a@b.com',
        password: 'x',
      })
      .expect(201);

    expect(vRegisterBody).toHaveBeenCalled();
    expect(ctrl.register).toHaveBeenCalled();
    expect(res.body.data.user).toMatchObject({
      userId: 'u1',
      username: 'alice',
    });
    expect(res.body.data.tokens).toEqual({
      accessToken: 'acc',
      refreshToken: 'ref',
    });
  });

  test('POST /api/auth/login → runs validator & controller (200)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: 'alice', password: 'x' })
      .expect(200);

    expect(vLoginBody).toHaveBeenCalled();
    expect(ctrl.login).toHaveBeenCalled();
    expect(res.body.data).toEqual({ accessToken: 'acc', refreshToken: 'ref' });
  });

  test('POST /api/auth/refresh → runs validator & controller (200)', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'ref' })
      .expect(200);

    expect(vRefreshBody).toHaveBeenCalled();
    expect(ctrl.refresh).toHaveBeenCalled();
    expect(res.body.data).toEqual({
      accessToken: 'newacc',
      refreshToken: 'newref',
    });
  });

  test('POST /api/auth/logout → calls controller (200)', async () => {
    const res = await request(app).post('/api/auth/logout').expect(200);

    expect(ctrl.logout).toHaveBeenCalled();
    expect(res.body.data).toEqual({ success: true });
  });

  test('GET /api/auth/me → requires auth and returns user (200)', async () => {
    const res = await request(app).get('/api/auth/me').expect(200);

    expect(requireAuth).toHaveBeenCalled();
    expect(ctrl.me).toHaveBeenCalled();
    expect(res.body.data.user).toEqual({ userId: 'me', username: 'current' });
  });
});
