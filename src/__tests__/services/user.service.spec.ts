// src/__tests__/routes/user.route.e2e.spec.ts
import 'reflect-metadata';
import { jest } from '@jest/globals';

import {
  DuplicateError,
  NotFoundError,
  AuthError,
} from '../../errors/index.js';

/* -------------------- small helper to avoid `never` issues -------------------- */
const asMock = (fn: unknown) => fn as jest.MockedFunction<any>;

/* ---------------- ESM mocks must be registered BEFORE imports ---------------- */

const mockSerializeUser = jest.fn((u: any) => {
  if (!u) return u;
  const { password, ...rest } = u;
  return rest;
});
const mockSerializeUsers = jest.fn((arr: any[]) =>
  (arr || []).map((u) => {
    if (!u) return u;
    const { password, ...rest } = u;
    return rest;
  })
);
jest.unstable_mockModule('../../serializers/user.serializer.js', () => ({
  serializeUser: mockSerializeUser,
  serializeUsers: mockSerializeUsers,
}));

const mockWithTransaction = jest.fn(async (fn: any) => {
  const t = { LOCK: { UPDATE: 'UPDATE' } };
  return fn(t as any);
});
jest.unstable_mockModule('../../utils/tx.js', () => ({
  withTransaction: mockWithTransaction,
}));

const mockBuildUserWhere = jest.fn((q?: string, filters?: any) => {
  const out: any = {};
  if (q) out.q = q;
  if (filters) out.filters = filters;
  return out;
});
const mockNormalizeRoles = jest.fn((r?: any) =>
  r == null ? [] : Array.isArray(r) ? r : [r]
);
jest.unstable_mockModule('../../queries/user.queries.js', () => ({
  buildUserWhere: mockBuildUserWhere,
  normalizeRoles: mockNormalizeRoles,
}));

class UniqueConstraintErrorShim extends Error {
  constructor(message?: string) {
    super(message);
  }
}
const OpSymbols = {
  in: Symbol.for('sequelize.in'),
  and: Symbol.for('sequelize.and'),
};
jest.unstable_mockModule('sequelize', () => ({
  Op: OpSymbols,
  UniqueConstraintError: UniqueConstraintErrorShim,
}));

/** ---- Model method surfaces as plain jest.Mocks (kept as `any`) ---- */
const UserModelFns: any = {
  create: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  findAndCountAll: jest.fn(),
  destroy: jest.fn(),
};

const AuthorizationModelFns: any = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
};

jest.unstable_mockModule('../../models/user.model.js', () => ({
  UserModel: UserModelFns,
}));
jest.unstable_mockModule('../../models/authorization.model.js', () => ({
  AuthorizationModel: AuthorizationModelFns,
}));

/* ----------------------------- Load SUT after mocks ---------------------------- */
const { UserService } = await import('../../services/user.service.js');
const { UserModel } = await import('../../models/user.model.js');
const { AuthorizationModel } = await import(
  '../../models/authorization.model.js'
);
const { withTransaction } = await import('../../utils/tx.js');
const { serializeUser, serializeUsers } = await import(
  '../../serializers/user.serializer.js'
);
const { Op } = await import('sequelize');
const { buildUserWhere, normalizeRoles } = await import(
  '../../queries/user.queries.js'
);

/* --------------------------------- Helpers --------------------------------- */
type MockUser = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  verified: boolean;
  toJSON: () => any;
  set: jest.Mock<(patch: Partial<Record<string, unknown>>) => void>;
  save: jest.Mock<() => Promise<void>>;
  validatePassword: jest.Mock<(p: string) => Promise<boolean>>;
} & Record<string, unknown>;

/** ✅ Fixed: data-backed instance with getters/setters so overrides & updates persist */
const mkUser = (over: Partial<MockUser> = {}): MockUser => {
  // internal state (defaults + overrides)
  const data: any = {
    userId: 'u1',
    username: 'john',
    firstName: 'John',
    lastName: 'Doe',
    email: 'j@e.com',
    password: 'HASH',
    verified: false,
    ...over,
  };

  const inst: any = {};

  // bind properties to internal state
  for (const key of [
    'userId',
    'username',
    'firstName',
    'lastName',
    'email',
    'password',
    'verified',
  ]) {
    Object.defineProperty(inst, key, {
      enumerable: true,
      configurable: true,
      get: () => data[key],
      set: (v) => {
        data[key] = v;
      },
    });
  }

  inst.toJSON = () => ({ ...data });
  inst.set = jest.fn((patch: Partial<Record<string, unknown>>) =>
    Object.assign(data, patch)
  );
  inst.save = jest.fn(async () => {});
  inst.validatePassword = jest.fn(async (p: string) => p === 'current');

  return inst as MockUser;
};

beforeEach(() => {
  jest.clearAllMocks();
});

/* ---------------------------------- CREATE ---------------------------------- */
describe('UserService.create', () => {
  test('creates and serializes user', async () => {
    const inst = mkUser({ username: 'john', email: 'j@e.com' });
    asMock(UserModel.create).mockResolvedValue(inst as any);

    const out = await UserService.create({
      username: 'john',
      firstName: 'John',
      lastName: 'Doe',
      email: 'j@e.com',
      password: 'x',
    });

    expect(withTransaction).toHaveBeenCalled();
    expect(UserModel.create).toHaveBeenCalledWith(
      {
        username: 'john',
        firstName: 'John',
        lastName: 'Doe',
        email: 'j@e.com',
        password: 'x',
      },
      expect.objectContaining({ transaction: expect.anything() })
    );
    expect(serializeUser).toHaveBeenCalledWith(inst.toJSON());
    expect(out).toMatchObject({ username: 'john', email: 'j@e.com' });
    expect((out as any).password).toBeUndefined();
  });

  test('UniqueConstraintError -> DuplicateError', async () => {
    asMock(UserModel.create).mockRejectedValue(
      new UniqueConstraintErrorShim('dup') as any
    );

    await expect(
      UserService.create({
        username: 'john',
        firstName: 'a',
        lastName: 'b',
        email: 'e',
        password: 'x',
      })
    ).rejects.toBeInstanceOf(DuplicateError);
  });
});

/* ----------------------------------- READ ----------------------------------- */
describe('UserService.getById / getByEmail / getByUsername', () => {
  test('getById returns serialized user', async () => {
    const inst = mkUser({ userId: 'u42' });
    asMock(UserModel.findByPk).mockResolvedValue(inst as any);

    const out = await UserService.getById('u42');
    expect(UserModel.findByPk).toHaveBeenCalledWith('u42');
    expect(serializeUser).toHaveBeenCalledWith(inst.toJSON());
    expect(out).toMatchObject({ userId: 'u42' });
  });

  test('getById throws NotFoundError', async () => {
    asMock(UserModel.findByPk).mockResolvedValue(null as any);
    await expect(UserService.getById('nope')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  test('getByEmail returns serialized user', async () => {
    const inst = mkUser({ email: 'x@y.z' });
    asMock(UserModel.findOne).mockResolvedValue(inst as any);

    const out = await UserService.getByEmail('x@y.z');
    expect(UserModel.findOne).toHaveBeenCalledWith({
      where: { email: 'x@y.z' },
    });
    expect(out).toMatchObject({ email: 'x@y.z' });
  });

  test('getByEmail throws NotFoundError', async () => {
    asMock(UserModel.findOne).mockResolvedValue(null as any);
    await expect(UserService.getByEmail('none')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  test('getByUsername returns serialized user', async () => {
    const inst = mkUser({ username: 'alice' });
    asMock(UserModel.findOne).mockResolvedValue(inst as any);

    const out = await UserService.getByUsername('alice');
    expect(UserModel.findOne).toHaveBeenCalledWith({
      where: { username: 'alice' },
    });
    expect(out).toMatchObject({ username: 'alice' });
  });

  test('getByUsername throws NotFoundError', async () => {
    asMock(UserModel.findOne).mockResolvedValue(null as any);
    await expect(UserService.getByUsername('ghost')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

/* ----------------------------------- LIST ----------------------------------- */
describe('UserService.list', () => {
  test('lists users with pagination, no role filter', async () => {
    asMock(buildUserWhere).mockReturnValue({ filters: { v: 1 } });
    asMock(normalizeRoles).mockReturnValue([]);

    const rows = [mkUser({ userId: 'u1' }), mkUser({ userId: 'u2' })];
    asMock(UserModel.findAndCountAll).mockResolvedValue({
      rows,
      count: 42,
    } as any);
    asMock(AuthorizationModel.findAll).mockResolvedValue([] as any);

    const res = await UserService.list({
      page: 3,
      pageSize: 10,
      q: 'john',
      orderBy: 'createdAt',
      orderDir: 'DESC',
    });

    expect(buildUserWhere).toHaveBeenCalledWith('john', undefined);
    expect(UserModel.findAndCountAll).toHaveBeenCalledWith({
      where: { filters: { v: 1 } },
      limit: 10,
      offset: 20,
      order: [['createdAt', 'DESC']],
    });
    expect(serializeUsers).toHaveBeenCalledWith(expect.any(Array));
    expect(res.total).toBe(42);
    expect(res.page).toBe(3);
    expect(res.pageSize).toBe(10);
    expect(res.pages).toBe(Math.ceil(42 / 10));
  });

  test('applies authRole filter via AuthorizationModel → empty when no ids', async () => {
    asMock(buildUserWhere).mockReturnValue({ base: true });
    asMock(normalizeRoles).mockReturnValue(['administrator']);
    asMock(AuthorizationModel.findAll).mockResolvedValue([] as any);

    const res = await UserService.list({ authRole: 'administrator' } as any);

    expect(AuthorizationModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: ['userId'],
        where: expect.any(Object), // role: { [Op.in]: [...] }
      })
    );
    expect(res).toEqual({
      users: [],
      total: 0,
      page: 1,
      pageSize: 20,
      pages: 1,
    });
  });

  test('attaches auth roles to returned users', async () => {
    asMock(buildUserWhere).mockReturnValue({});
    asMock(normalizeRoles).mockReturnValue([]);

    const rows = [mkUser({ userId: 'a1' }), mkUser({ userId: 'a2' })];
    asMock(UserModel.findAndCountAll).mockResolvedValue({
      rows,
      count: 2,
    } as any);
    asMock(AuthorizationModel.findAll).mockResolvedValue([
      { userId: 'a2', role: 'employee' },
    ] as any);

    const res = await UserService.list({ page: 1, pageSize: 5 });

    const serializedInput = asMock(serializeUsers).mock.calls[0][0];
    const itemA2 = serializedInput.find((u: any) => u.userId === 'a2');
    expect(itemA2.authorization).toEqual({ role: 'employee' });
    expect(res.users.length).toBe(2);
  });
});

/* ---------------------------------- FILTER ---------------------------------- */
describe('UserService.filter', () => {
  test('merges verified→filters and paginates', async () => {
    asMock(buildUserWhere).mockReturnValue({ combined: true });
    asMock(normalizeRoles).mockReturnValue([]);

    const rows = [mkUser({ userId: 'f1' })];
    asMock(UserModel.findAndCountAll).mockResolvedValue({
      rows,
      count: 1,
    } as any);
    asMock(AuthorizationModel.findAll).mockResolvedValue([] as any);

    const res = await UserService.filter({
      q: 'abc',
      verified: true,
      pageSize: 5,
    } as any);

    expect(buildUserWhere).toHaveBeenCalledWith('abc', { verified: true });
    expect(UserModel.findAndCountAll).toHaveBeenCalledWith({
      where: { combined: true },
      limit: 5,
      offset: 0,
      order: [['createdAt', 'DESC']],
    });
    expect(res.users.length).toBe(1);
  });

  test('authRole inside filter → empty when no ids', async () => {
    asMock(buildUserWhere).mockReturnValue({});
    asMock(normalizeRoles).mockReturnValue(['user']);
    asMock(AuthorizationModel.findAll).mockResolvedValue([] as any);

    const res = await UserService.filter({ authRole: ['user'] } as any);
    expect(res).toEqual({
      users: [],
      total: 0,
      page: 1,
      pageSize: 20,
      pages: 1,
    });
  });
});

/* ---------------------------------- UPDATE ---------------------------------- */
describe('UserService.update', () => {
  test('updates allowed fields and serializes', async () => {
    const inst = mkUser({ userId: 'u7' });
    asMock(UserModel.findByPk).mockResolvedValue(inst as any);

    const out = await UserService.update('u7', {
      username: 'newname',
      firstName: 'A',
      lastName: 'B',
      email: 'x@y.z',
    });

    expect(UserModel.findByPk).toHaveBeenCalledWith(
      'u7',
      expect.objectContaining({
        lock: 'UPDATE',
        transaction: expect.any(Object),
      })
    );
    expect(inst.set).toHaveBeenCalledWith({
      username: 'newname',
      firstName: 'A',
      lastName: 'B',
      email: 'x@y.z',
    });
    expect(inst.save).toHaveBeenCalled();
    expect(out.userId).toBe('u7');
    expect((out as any).password).toBeUndefined();
  });

  test('throws NotFoundError when user missing', async () => {
    asMock(UserModel.findByPk).mockResolvedValue(null as any);
    await expect(
      UserService.update('missing', { username: 'x' })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('UniqueConstraintError -> DuplicateError on save', async () => {
    const inst = mkUser();
    asMock(UserModel.findByPk).mockResolvedValue(inst as any);
    asMock(inst.save).mockRejectedValue(
      new UniqueConstraintErrorShim('dup') as any
    );

    await expect(
      UserService.update('u1', { email: 'taken@mail.com' })
    ).rejects.toBeInstanceOf(DuplicateError);
  });
});

/* -------------------------------- PASSWORD -------------------------------- */
describe('UserService.changePassword', () => {
  test('changes password when current is valid', async () => {
    const inst = mkUser();
    asMock(UserModel.findByPk).mockResolvedValue(inst as any);

    const res = await UserService.changePassword('u1', {
      currentPassword: 'current',
      newPassword: 'new',
    });

    expect(inst.validatePassword).toHaveBeenCalledWith('current');
    expect(inst.password).toBe('new');
    expect(inst.save).toHaveBeenCalled();
    expect(res).toEqual({ success: true });
  });

  test('throws AuthError when current password is wrong', async () => {
    const inst = mkUser();
    asMock(UserModel.findByPk).mockResolvedValue(inst as any);

    await expect(
      UserService.changePassword('u1', {
        currentPassword: 'bad',
        newPassword: 'new',
      })
    ).rejects.toBeInstanceOf(AuthError);
  });

  test('throws NotFoundError when user missing', async () => {
    asMock(UserModel.findByPk).mockResolvedValue(null as any);
    await expect(
      UserService.changePassword('nope', {
        currentPassword: 'x',
        newPassword: 'y',
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

/* -------------------------------- VERIFIED ------------------------------- */
describe('UserService.setVerified', () => {
  test('sets verified flag', async () => {
    const inst = mkUser({ verified: false });
    asMock(UserModel.findByPk).mockResolvedValue(inst as any);

    const out = await UserService.setVerified('u1', true);

    expect(inst.verified).toBe(true);
    expect(inst.save).toHaveBeenCalled();
    expect(out.verified).toBe(true);
  });

  test('throws NotFoundError when user missing', async () => {
    asMock(UserModel.findByPk).mockResolvedValue(null as any);
    await expect(UserService.setVerified('nope', true)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

/* --------------------------------- DELETE --------------------------------- */
describe('UserService.delete', () => {
  test('deletes and returns success', async () => {
    asMock(UserModel.destroy).mockResolvedValue(1 as any);

    const res = await UserService.delete('u1');

    expect(UserModel.destroy).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      transaction: expect.any(Object),
    });
    expect(res).toEqual({ success: true });
  });

  test('throws NotFoundError when nothing deleted', async () => {
    asMock(UserModel.destroy).mockResolvedValue(0 as any);
    await expect(UserService.delete('missing')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

/* ---------------------------------- ROLES ---------------------------------- */
describe('UserService.setRole', () => {
  test('updates existing Authorization row', async () => {
    const inst = mkUser({ userId: 'u1' });
    asMock(UserModel.findByPk).mockResolvedValue(inst as any);

    const existing = {
      userId: 'u1',
      role: 'user',
      save: jest.fn(async () => {}),
    };
    asMock(AuthorizationModel.findOne).mockResolvedValue(existing as any);

    const out = await UserService.setRole('u1', 'administrator');

    expect(AuthorizationModel.findOne).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      transaction: expect.any(Object),
      lock: 'UPDATE',
    });
    expect(existing.role).toBe('administrator');
    expect(existing.save).toHaveBeenCalled();
    expect(out.authorization).toEqual({ role: 'administrator' });
  });

  test('creates Authorization row when missing', async () => {
    const inst = mkUser({ userId: 'u2' });
    asMock(UserModel.findByPk).mockResolvedValue(inst as any);
    asMock(AuthorizationModel.findOne).mockResolvedValue(null as any);
    asMock(AuthorizationModel.create).mockResolvedValue(undefined as any);

    const out = await UserService.setRole('u2', 'employee');

    expect(AuthorizationModel.create).toHaveBeenCalledWith(
      { userId: 'u2', role: 'employee' },
      { transaction: expect.any(Object) }
    );
    expect(out.authorization).toEqual({ role: 'employee' });
  });

  test('throws NotFoundError when user missing', async () => {
    asMock(UserModel.findByPk).mockResolvedValue(null as any);
    await expect(UserService.setRole('nope', 'user')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
