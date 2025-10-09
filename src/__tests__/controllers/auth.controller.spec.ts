// src/__tests__/controllers/auth.controller.spec.ts

/**
 * AuthController — unit tests (pure Jest mocks; no DB)
 * @jest-environment node
 */

/* ================================ Helpers ================================= */

function makeRes() {
  const res: any = {};
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

function makeNext() {
  return jest.fn();
}

/* ========================= Mock setup ========================= */

const mockCookieSpec = {
  ACCESS_COOKIE: 'at',
  REFRESH_COOKIE: 'rt',
  accessCookieOpts: { httpOnly: true, path: '/', sameSite: 'lax' as const },
  refreshCookieOpts: { httpOnly: true, path: '/', sameSite: 'lax' as const },
};

const mockCookieSpecFn = jest.fn(() => mockCookieSpec);
const mockRegister = jest.fn();
const mockLogin = jest.fn();
const mockRefresh = jest.fn();

// Mock modules
jest.mock('../../services/auth.service.js', () => ({
  AuthService: {
    cookieSpec: mockCookieSpecFn,
    register: mockRegister,
    login: mockLogin,
    refresh: mockRefresh,
  },
}));

/* ========================= Import after mocks ========================= */

import { AuthController } from '../../controllers/auth.controller.js';
import { AuthorizationModel } from '../../models/authorization.model.js';

/* ================================ Lifecycle ================================= */

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockCookieSpecFn.mockClear();
  mockCookieSpecFn.mockReturnValue(mockCookieSpec);
  mockRegister.mockClear();
  mockLogin.mockClear();
  mockRefresh.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/* ================================= Tests ================================= */

describe('AuthController.register', () => {
  test('sets cookies and returns user + authorization (201)', async () => {
    const req: any = {
      body: {
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'a@b.com',
        password: 'pw',
      },
    };
    const res = makeRes();
    const next = makeNext();

    const user = { userId: 'u1', username: 'alice' };
    mockRegister.mockResolvedValue({
      user,
      tokens: { accessToken: 'AT', refreshToken: 'RT' },
    });
    jest
      .spyOn(AuthorizationModel, 'findOne')
      .mockResolvedValue({ role: 'user' } as any);

    await AuthController.register(req, res, next);

    expect(mockRegister).toHaveBeenCalledWith(req.body);
    expect(res.cookie).toHaveBeenCalledWith(
      mockCookieSpec.ACCESS_COOKIE,
      'AT',
      mockCookieSpec.accessCookieOpts
    );
    expect(res.cookie).toHaveBeenCalledWith(
      mockCookieSpec.REFRESH_COOKIE,
      'RT',
      mockCookieSpec.refreshCookieOpts
    );
    expect(AuthorizationModel.findOne).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      attributes: ['role'],
      raw: true,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Account created',
      data: { user, authorization: { role: 'user' } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { body: { username: 'x' } };
    const res = makeRes();
    const next = makeNext();

    const boom = new Error('boom');
    mockRegister.mockRejectedValue(boom);

    await AuthController.register(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('AuthController.login', () => {
  test('sets cookies and returns user + authorization (200)', async () => {
    const req: any = { body: { identifier: 'alice', password: 'pw' } };
    const res = makeRes();
    const next = makeNext();

    const user = { userId: 'u2', username: 'alice' };
    mockLogin.mockResolvedValue({
      user,
      tokens: { accessToken: 'AT2', refreshToken: 'RT2' },
    });
    jest
      .spyOn(AuthorizationModel, 'findOne')
      .mockResolvedValue({ role: 'employee' } as any);

    await AuthController.login(req, res, next);

    expect(mockLogin).toHaveBeenCalledWith(req.body);
    expect(res.cookie).toHaveBeenCalledWith(
      mockCookieSpec.ACCESS_COOKIE,
      'AT2',
      mockCookieSpec.accessCookieOpts
    );
    expect(res.cookie).toHaveBeenCalledWith(
      mockCookieSpec.REFRESH_COOKIE,
      'RT2',
      mockCookieSpec.refreshCookieOpts
    );
    expect(res.json).toHaveBeenCalledWith({
      message: 'Login successful',
      data: { user, authorization: { role: 'employee' } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { body: { identifier: 'a', password: 'x' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('nope');

    mockLogin.mockRejectedValue(boom);

    await AuthController.login(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('AuthController.refresh', () => {
  test('uses refresh cookie, rotates tokens, returns user + authorization', async () => {
    const req: any = { cookies: { [mockCookieSpec.REFRESH_COOKIE]: 'OLD_RT' } };
    const res = makeRes();
    const next = makeNext();

    const user = { userId: 'u3', username: 'carol' };
    mockRefresh.mockResolvedValue({
      user,
      accessToken: 'NEW_AT',
      refreshToken: 'NEW_RT',
    });
    jest.spyOn(AuthorizationModel, 'findOne').mockResolvedValue({
      role: 'administrator',
    } as any);

    await AuthController.refresh(req, res, next);

    expect(mockRefresh).toHaveBeenCalledWith('OLD_RT');
    expect(res.cookie).toHaveBeenCalledWith(
      mockCookieSpec.ACCESS_COOKIE,
      'NEW_AT',
      mockCookieSpec.accessCookieOpts
    );
    expect(res.cookie).toHaveBeenCalledWith(
      mockCookieSpec.REFRESH_COOKIE,
      'NEW_RT',
      mockCookieSpec.refreshCookieOpts
    );
    expect(res.json).toHaveBeenCalledWith({
      message: 'Tokens refreshed',
      data: { user, authorization: { role: 'administrator' } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('no refresh cookie -> 401', async () => {
    const req: any = { cookies: {} };
    const res = makeRes();
    const next = makeNext();

    await AuthController.refresh(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'No refresh token' });
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { cookies: { [mockCookieSpec.REFRESH_COOKIE]: 'OLD_RT' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('bad refresh');

    mockRefresh.mockRejectedValue(boom);
    await AuthController.refresh(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('AuthController.logout', () => {
  test('clears cookies and returns 204', async () => {
    const req: any = {};
    const res = makeRes();
    const next = makeNext();

    await AuthController.logout(req, res, next);

    expect(res.clearCookie).toHaveBeenCalledWith(
      mockCookieSpec.ACCESS_COOKIE,
      expect.objectContaining({ ...mockCookieSpec.accessCookieOpts, maxAge: 0 })
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      mockCookieSpec.REFRESH_COOKIE,
      expect.objectContaining({
        ...mockCookieSpec.refreshCookieOpts,
        maxAge: 0,
      })
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = {};
    const res = makeRes();
    const next = makeNext();

    // simulate throw inside logout
    mockCookieSpecFn.mockImplementation(() => {
      throw new Error('cookie fail');
    });

    await AuthController.logout(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('AuthController.me', () => {
  test('401 when no req.user', async () => {
    const req: any = {};
    const res = makeRes();

    await AuthController.me(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
  });

  test('returns current user + authorization (200)', async () => {
    const req: any = { user: { userId: 'u9', username: 'zoe' } };
    const res = makeRes();
    jest
      .spyOn(AuthorizationModel, 'findOne')
      .mockResolvedValue({ role: 'user' } as any);

    await AuthController.me(req, res);

    expect(AuthorizationModel.findOne).toHaveBeenCalledWith({
      where: { userId: 'u9' },
      attributes: ['role'],
      raw: true,
    });
    expect(res.json).toHaveBeenCalledWith({
      message: 'Current user',
      data: { user: req.user, authorization: { role: 'user' } },
    });
  });
});
