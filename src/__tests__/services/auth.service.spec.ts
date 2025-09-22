import 'reflect-metadata';
import { jest } from '@jest/globals';

const asMock = (fn: unknown) => fn as jest.MockedFunction<any>;

/* ========================= Mocks (must be BEFORE imports) ========================= */

/** Config values consumed at module load time */
const mockConfig = {
  jwtSecret: 'access-secret',
  jwtRefreshSecret: 'refresh-secret',
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '7d',
  nodeEnv: 'test',
  accessCookieName: 'access_token',
  refreshCookieName: 'refresh_token',
};
jest.unstable_mockModule('../../config/env.js', () => ({
  config: mockConfig,
}));

/** jsonwebtoken — deterministic sign/verify */
const jwtSign = jest.fn((payload: any, secret: string) => {
  const userId =
    (payload?.user && payload.user.userId) ||
    payload?.userId ||
    payload?.sub ||
    'unknown';
  if (secret === 'access-secret') return `acc.${userId}`;
  if (secret === 'refresh-secret') return `ref.${userId}`;
  return `signed.${userId}`;
});
const jwtVerify = jest.fn((token: string, secret: string) => {
  if (secret !== 'refresh-secret') throw new Error('bad secret');
  if (!token.startsWith('ref.')) throw new Error('bad token');
  const userId = token.slice(4);
  return { sub: userId, type: 'refresh', user: { userId } };
});
jest.unstable_mockModule('jsonwebtoken', () => ({
  default: { sign: jwtSign, verify: jwtVerify },
  sign: jwtSign,
  verify: jwtVerify,
}));

/** Sequelize operators + transaction function (from separate db module) */
const Op = {
  or: Symbol.for('sequelize.or'),
} as any;

const mockSequelize = {
  transaction: jest.fn(async (cb: (t: any) => any) =>
    cb({ LOCK: { UPDATE: 'UPDATE' } })
  ),
};
jest.unstable_mockModule('../../db/sequelize.js', () => ({
  sequelize: mockSequelize,
}));

/** Models used by the service */
const mockUserModel = {
  findOne: jest.fn(),
  findByPk: jest.fn(),
  create: jest.fn(),
};
const mockAuthorizationModel = {
  create: jest.fn(),
};
jest.unstable_mockModule('../../models/user.model.js', () => ({
  UserModel: mockUserModel,
}));
jest.unstable_mockModule('../../models/authorization.model.js', () => ({
  AuthorizationModel: mockAuthorizationModel,
}));

/** Also mock 'sequelize' export for Op (service imports Op from here) */
jest.unstable_mockModule('sequelize', () => ({
  Op,
  Transaction: class {},
}));

/* =============================== Load SUT ================================== */
const { AuthService } = await import('../../services/auth.service.js');
const { UserModel } = await import('../../models/user.model.js');
const { AuthorizationModel } = await import(
  '../../models/authorization.model.js'
);
const { sequelize } = await import('../../db/sequelize.js');
const jwt = await import('jsonwebtoken');

/* ============================== Test helpers =============================== */
const mkUserInst = (over: any = {}) => {
  const base = {
    userId: 'u1',
    username: 'john',
    email: 'j@e.com',
    verified: false,
    validatePassword: jest.fn(async (p: string) => p === 'pass'),
    toJSON: () => ({
      userId: 'u1',
      username: 'john',
      email: 'j@e.com',
      verified: false,
    }),
  };
  return { ...base, ...over };
};

beforeEach(() => {
  jest.clearAllMocks();
});

/* ================================= Register ================================= */

describe('AuthService.register', () => {
  test('creates user + authorization (role=user), returns jwt user and tokens', async () => {
    asMock(UserModel.findOne).mockResolvedValue(null);
    const created = mkUserInst({
      userId: 'nu',
      username: 'alice',
      email: 'a@b.com',
    });
    asMock(UserModel.create).mockResolvedValue(created as any);
    asMock(AuthorizationModel.create).mockResolvedValue(undefined);

    const out = await AuthService.register({
      username: 'alice',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'a@b.com',
      password: 'pw',
    });

    expect(sequelize.transaction).toHaveBeenCalled();
    expect(UserModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          [Op.or]: [{ username: 'alice' }, { email: 'a@b.com' }],
        }),
        lock: 'UPDATE',
      })
    );
    expect(UserModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'a@b.com',
        password: 'pw',
      }),
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(AuthorizationModel.create).toHaveBeenCalledWith(
      { userId: 'nu', role: 'user' },
      expect.objectContaining({ transaction: expect.any(Object) })
    );

    expect(out.user).toEqual({
      userId: 'nu',
      username: 'alice',
      email: 'a@b.com',
      verified: false,
    });
    expect(out.tokens.accessToken).toBe('acc.nu');
    expect(out.tokens.refreshToken).toBe('ref.nu');
    expect(jwt.sign).toHaveBeenCalled();
  });

  test('throws DuplicateError when user exists', async () => {
    asMock(UserModel.findOne).mockResolvedValue(mkUserInst() as any);

    await expect(
      AuthService.register({
        username: 'john',
        firstName: 'J',
        lastName: 'D',
        email: 'j@e.com',
        password: 'x',
      })
    ).rejects.toHaveProperty('name', 'DuplicateError');
    expect(UserModel.create).not.toHaveBeenCalled();
  });
});

/* ================================== Login ================================== */

describe('AuthService.login', () => {
  test('authenticates by username/email and returns user + tokens', async () => {
    const inst = mkUserInst({
      userId: 'u9',
      username: 'bob',
      email: 'b@c.com',
    });
    asMock(UserModel.findOne).mockResolvedValue(inst as any);

    const out = await AuthService.login({
      identifier: 'BoB',
      password: 'pass',
    });

    expect(UserModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          [Op.or]: [{ username: 'bob' }, { email: 'bob' }],
        }),
      })
    );
    expect(inst.validatePassword).toHaveBeenCalledWith('pass');
    expect(out.user).toEqual({
      userId: 'u9',
      username: 'bob',
      email: 'b@c.com',
      verified: false,
    });
    expect(out.tokens.accessToken).toBe('acc.u9');
    expect(out.tokens.refreshToken).toBe('ref.u9');
  });

  test('throws AuthError when user not found', async () => {
    asMock(UserModel.findOne).mockResolvedValue(null as any);
    await expect(
      AuthService.login({ identifier: 'x', password: 'y' })
    ).rejects.toHaveProperty('name', 'AuthError');
  });

  test('throws AuthError when password invalid', async () => {
    const inst = mkUserInst({ validatePassword: jest.fn(async () => false) });
    asMock(UserModel.findOne).mockResolvedValue(inst as any);
    await expect(
      AuthService.login({ identifier: 'john', password: 'bad' })
    ).rejects.toHaveProperty('name', 'AuthError');
  });
});

/* ================================= Refresh ================================= */

describe('AuthService.refresh', () => {
  test('verifies refresh token, loads user, returns rotated tokens + user', async () => {
    const inst = mkUserInst({
      userId: 'u5',
      username: 'eve',
      email: 'e@f.com',
    });
    asMock(UserModel.findByPk).mockResolvedValue(inst as any);

    const out = await AuthService.refresh('ref.u5');

    expect(jwt.verify).toHaveBeenCalledWith('ref.u5', 'refresh-secret');
    expect(UserModel.findByPk).toHaveBeenCalledWith('u5');
    expect(out.user).toEqual({
      userId: 'u5',
      username: 'eve',
      email: 'e@f.com',
      verified: false,
    });
    expect(out.accessToken).toBe('acc.u5');
    expect(out.refreshToken).toBe('ref.u5'); // rotated token (same format in this mock)
  });

  test('throws AuthError for invalid token', async () => {
    await expect(
      AuthService.refresh('not-a-refresh-token')
    ).rejects.toHaveProperty('name', 'AuthError');
  });

  test('throws NotFoundError if user missing', async () => {
    asMock(UserModel.findByPk).mockResolvedValue(null as any);
    await expect(AuthService.refresh('ref.gone')).rejects.toHaveProperty(
      'name',
      'NotFoundError'
    );
  });
});

/* ================================ cookieSpec ================================ */

describe('AuthService.cookieSpec', () => {
  test('returns cookie names and options from config', () => {
    const spec = AuthService.cookieSpec();
    expect(spec.ACCESS_COOKIE).toBe('access_token');
    expect(spec.REFRESH_COOKIE).toBe('refresh_token');
    // sanity on cookie options
    expect(spec.accessCookieOpts.httpOnly).toBe(true);
    expect(spec.refreshCookieOpts.path).toBe('/api/auth/refresh');
    // derived maxAge should be numbers
    expect(typeof spec.accessCookieOpts.maxAge).toBe('number');
    expect(typeof spec.refreshCookieOpts.maxAge).toBe('number');
  });
});
