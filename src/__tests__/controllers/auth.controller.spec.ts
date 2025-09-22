// src/__tests__/controllers/auth.controller.spec.ts
import 'reflect-metadata';
import { jest, describe, test, beforeEach, expect } from '@jest/globals';

const asMock = (fn: unknown) => fn as jest.MockedFunction<any>;

/* ============================ Mocks (before imports) ============================ */

const mockCookieSpec = {
  ACCESS_COOKIE: 'at',
  REFRESH_COOKIE: 'rt',
  accessCookieOpts: { httpOnly: true, path: '/', sameSite: 'lax' as const },
  refreshCookieOpts: { httpOnly: true, path: '/', sameSite: 'lax' as const },
};

const AuthServiceMock = {
  cookieSpec: jest.fn(() => mockCookieSpec),
  register: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
};
jest.unstable_mockModule('../../services/auth.service.js', () => ({
  AuthService: AuthServiceMock,
}));

const AuthorizationModelMock = {
  findOne: jest.fn(),
};
jest.unstable_mockModule('../../models/authorization.model.js', () => ({
  AuthorizationModel: AuthorizationModelMock,
}));

/* ============================ Load SUT after mocks ============================ */

const { AuthController } = await import('../../controllers/auth.controller.js');
const { AuthService } = await import('../../services/auth.service.js');
const { AuthorizationModel } = await import(
  '../../models/authorization.model.js'
);

/* ================================= Helpers ================================= */

const makeRes = () => {
  const res: any = {};
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
};

const makeNext = () => jest.fn();

/* ================================== Tests ================================== */

beforeEach(() => {
  jest.clearAllMocks();
  asMock(AuthService.cookieSpec).mockReturnValue(mockCookieSpec);
});

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
    asMock(AuthService.register).mockResolvedValue({
      user,
      tokens: { accessToken: 'AT', refreshToken: 'RT' },
    });
    asMock(AuthorizationModel.findOne).mockResolvedValue({ role: 'user' });

    await AuthController.register(req, res, next);

    expect(AuthService.register).toHaveBeenCalledWith(req.body);
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
    asMock(AuthService.register).mockRejectedValue(boom);

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
    asMock(AuthService.login).mockResolvedValue({
      user,
      tokens: { accessToken: 'AT2', refreshToken: 'RT2' },
    });
    asMock(AuthorizationModel.findOne).mockResolvedValue({ role: 'employee' });

    await AuthController.login(req, res, next);

    expect(AuthService.login).toHaveBeenCalledWith(req.body);
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

    asMock(AuthService.login).mockRejectedValue(boom);

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
    asMock(AuthService.refresh).mockResolvedValue({
      user,
      accessToken: 'NEW_AT',
      refreshToken: 'NEW_RT',
    });
    asMock(AuthorizationModel.findOne).mockResolvedValue({
      role: 'administrator',
    });

    await AuthController.refresh(req, res, next);

    expect(AuthService.refresh).toHaveBeenCalledWith('OLD_RT');
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
    expect(AuthService.refresh).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { cookies: { [mockCookieSpec.REFRESH_COOKIE]: 'OLD_RT' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('bad refresh');

    asMock(AuthService.refresh).mockRejectedValue(boom);
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
    asMock(AuthService.cookieSpec).mockImplementation(() => {
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
    asMock(AuthorizationModel.findOne).mockResolvedValue({ role: 'user' });

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
