import 'reflect-metadata';
import { jest } from '@jest/globals';

/* tiny helper so TS stops inferring `never` on jest.fn() */
const asMock = (fn: unknown) => fn as jest.MockedFunction<any>;

/* ===================== Mocks (must be defined BEFORE imports) ===================== */

/** serializers used by controller */
const mockSerializeUserForResponse = jest.fn((u: any) => u);
const mockSerializeUsers = jest.fn((arr: any[]) => arr);

jest.unstable_mockModule('../../serializers/user.serializer.js', () => ({
  serializeUserForResponse: mockSerializeUserForResponse,
  serializeUsers: mockSerializeUsers,
}));

/** query builders used by list/filter */
const mockBuildUserListQuery = jest.fn((q: any) => ({
  ...q,
  normalized: true,
}));
const mockBuildUserFilterQuery = jest.fn((q: any) => ({
  ...q,
  normalized: true,
  filtered: true,
}));

jest.unstable_mockModule('../../queries/user.queries.js', () => ({
  buildUserListQuery: mockBuildUserListQuery,
  buildUserFilterQuery: mockBuildUserFilterQuery,
}));

/** UserService surface used by controller */
const mockUserService = {
  getById: jest.fn(),
  getByEmail: jest.fn(),
  getByUsername: jest.fn(),
  list: jest.fn(),
  filter: jest.fn(),
  update: jest.fn(),
  changePassword: jest.fn(),
  setVerified: jest.fn(),
  delete: jest.fn(),
  setRole: jest.fn(),
};

jest.unstable_mockModule('../../services/user.service.js', () => ({
  UserService: mockUserService,
}));

/** Sequelize instance used only for .transaction in create/createEmployee */
const mockSequelize = {
  transaction: jest.fn(async (cb: (t: any) => any) => cb({})),
};
jest.unstable_mockModule('../../db/sequelize.js', () => ({
  sequelize: mockSequelize,
}));

/** Models used directly in controller for create/createEmployee/remove cleanup */
const mockUserModel = {
  create: jest.fn(),
};
const mockAuthorizationModel = {
  create: jest.fn(),
  destroy: jest.fn(),
};
jest.unstable_mockModule('../../models/user.model.js', () => ({
  UserModel: mockUserModel,
}));
jest.unstable_mockModule('../../models/authorization.model.js', () => ({
  AuthorizationModel: mockAuthorizationModel,
}));

/* ===================== Load SUT after all mocks ===================== */
const { UserController } = await import('../../controllers/user.controller.js');
const { UserService } = await import('../../services/user.service.js');
const { sequelize } = await import('../../db/sequelize.js');
const { UserModel } = await import('../../models/user.model.js');
const { AuthorizationModel } = await import(
  '../../models/authorization.model.js'
);
const { serializeUserForResponse, serializeUsers } = await import(
  '../../serializers/user.serializer.js'
);
const { buildUserListQuery, buildUserFilterQuery } = await import(
  '../../queries/user.queries.js'
);

/* ============================== Test helpers =============================== */
type MockRes = {
  statusCode?: number;
  body?: any;
  status: jest.Mock;
  json: jest.Mock;
};
const makeRes = (): MockRes => {
  const res: any = {};
  res.statusCode = 200;
  res.status = jest.fn(function (code: number) {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn(function (payload: any) {
    res.body = payload;
    return res;
  });
  return res as MockRes;
};
const makeNext = () => jest.fn();

/* basic user shape for responses */
const mkUser = (over: Partial<any> = {}) => ({
  userId: 'u1',
  username: 'john',
  firstName: 'John',
  lastName: 'Doe',
  email: 'j@e.com',
  verified: false,
  authorization: null,
  ...over,
});

/* reset between tests */
beforeEach(() => {
  jest.clearAllMocks();
});

/* ================================= CREATE ================================= */

describe('UserController.create', () => {
  test('creates user + default role=user in a transaction, returns 201', async () => {
    const req: any = {
      body: {
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@mail.com',
        password: 'pw',
      },
    };
    const res = makeRes();
    const next = makeNext();

    // model create returns instance-like object with toJSON
    const created = mkUser({ userId: 'ua', email: 'alice@mail.com' });
    asMock(UserModel.create).mockResolvedValue({
      toJSON: () => ({ ...created }),
      userId: 'ua',
    } as any);
    asMock(AuthorizationModel.create).mockResolvedValue(undefined);

    await UserController.create(req, res as any, next);

    expect(sequelize.transaction).toHaveBeenCalled();
    expect(UserModel.create).toHaveBeenCalledWith(
      {
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@mail.com',
        password: 'pw',
      },
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(AuthorizationModel.create).toHaveBeenCalledWith(
      { userId: 'ua', role: 'user' },
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(serializeUserForResponse).toHaveBeenCalled();
    expect(res.body.data.user).toMatchObject({
      userId: 'ua',
      authorization: { role: 'user' },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('UserController.createEmployee', () => {
  test('creates user + role=employee in a transaction, returns 201', async () => {
    const req: any = {
      body: {
        username: 'bob',
        firstName: 'Bob',
        lastName: 'Brown',
        email: 'bob@mail.com',
        password: 'pw',
      },
    };
    const res = makeRes();
    const next = makeNext();

    const created = mkUser({ userId: 'ub', email: 'bob@mail.com' });
    asMock(UserModel.create).mockResolvedValue({
      toJSON: () => ({ ...created }),
      userId: 'ub',
    } as any);
    asMock(AuthorizationModel.create).mockResolvedValue(undefined);

    await UserController.createEmployee(req, res as any, next);

    expect(sequelize.transaction).toHaveBeenCalled();
    expect(AuthorizationModel.create).toHaveBeenCalledWith(
      { userId: 'ub', role: 'employee' },
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body.data.user.authorization).toEqual({ role: 'employee' });
    expect(next).not.toHaveBeenCalled();
  });
});

/* ================================= READS ================================== */

describe('UserController.getById', () => {
  test('returns 200 with serialized user', async () => {
    const req: any = { params: { id: 'u42' } };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.getById).mockResolvedValue(mkUser({ userId: 'u42' }));

    await UserController.getById(req, res as any, next);

    expect(UserService.getById).toHaveBeenCalledWith('u42');
    expect(serializeUserForResponse).toHaveBeenCalled();
    expect(res.body.data.user.userId).toBe('u42');
    expect(next).not.toHaveBeenCalled();
  });
});

describe('UserController.getByEmail', () => {
  test('returns 200 with serialized user', async () => {
    const req: any = { query: { email: 'x@y.z' } };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.getByEmail).mockResolvedValue(
      mkUser({ email: 'x@y.z' })
    );

    await UserController.getByEmail(req, res as any, next);

    expect(UserService.getByEmail).toHaveBeenCalledWith('x@y.z');
    expect(serializeUserForResponse).toHaveBeenCalled();
    expect(res.body.data.user.email).toBe('x@y.z');
  });
});

describe('UserController.getByUsername', () => {
  test('returns 200 with serialized user', async () => {
    const req: any = { query: { username: 'alice' } };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.getByUsername).mockResolvedValue(
      mkUser({ username: 'alice' })
    );

    await UserController.getByUsername(req, res as any, next);

    expect(UserService.getByUsername).toHaveBeenCalledWith('alice');
    expect(serializeUserForResponse).toHaveBeenCalled();
    expect(res.body.data.user.username).toBe('alice');
  });
});

/* =============================== LIST & FILTER ============================== */

describe('UserController.list', () => {
  test('builds query, calls service, normalizes collection + meta', async () => {
    const req: any = {
      query: { q: 'john', page: '2', pageSize: '5', role: 'employee' },
    };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.list).mockResolvedValue({
      users: [mkUser({ userId: 'u1' }), mkUser({ userId: 'u2' })],
      total: 12,
      page: 2,
      pageSize: 5,
      pages: 3,
    });

    await UserController.list(req, res as any, next);

    expect(buildUserListQuery).toHaveBeenCalledWith(req.query);
    expect(UserService.list).toHaveBeenCalledWith(
      expect.objectContaining({ normalized: true })
    );
    expect(serializeUsers).toHaveBeenCalled();
    expect(res.body.data.users).toHaveLength(2);
    expect(res.body.meta).toEqual({
      total: 12,
      page: 2,
      pageSize: 5,
      pages: 3,
    });
  });
});

describe('UserController.filter', () => {
  test('builds filter query, calls service, normalizes collection + meta', async () => {
    const req: any = { query: { q: 'a', verified: 'true', authRole: 'user' } };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.filter).mockResolvedValue({
      users: [mkUser({ userId: 'f1' })],
      total: 1,
      page: 1,
      pageSize: 20,
      pages: 1,
    });

    await UserController.filter(req, res as any, next);

    expect(buildUserFilterQuery).toHaveBeenCalledWith(req.query);
    expect(UserService.filter).toHaveBeenCalledWith(
      expect.objectContaining({ filtered: true })
    );
    expect(serializeUsers).toHaveBeenCalled();
    expect(res.body.data.users[0].userId).toBe('f1');
  });
});

/* ================================ MUTATIONS ================================= */

describe('UserController.update', () => {
  test('calls service.update and returns serialized user', async () => {
    const req: any = { params: { id: 'u7' }, body: { username: 'new' } };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.update).mockResolvedValue(
      mkUser({ userId: 'u7', username: 'new' })
    );

    await UserController.update(req, res as any, next);

    expect(UserService.update).toHaveBeenCalledWith('u7', { username: 'new' });
    expect(serializeUserForResponse).toHaveBeenCalled();
    expect(res.body.data.user.username).toBe('new');
  });
});

describe('UserController.changePassword', () => {
  test('calls service.changePassword and returns success', async () => {
    const req: any = {
      params: { id: 'u1' },
      body: { currentPassword: 'a', newPassword: 'b' },
    };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.changePassword).mockResolvedValue({ success: true });

    await UserController.changePassword(req, res as any, next);

    expect(UserService.changePassword).toHaveBeenCalledWith('u1', {
      currentPassword: 'a',
      newPassword: 'b',
    });
    expect(res.body.data).toEqual({ success: true });
  });
});

describe('UserController.setVerified', () => {
  test('calls service.setVerified and returns serialized user', async () => {
    const req: any = { params: { id: 'u1' }, body: { verified: true } };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.setVerified).mockResolvedValue(
      mkUser({ userId: 'u1', verified: true })
    );

    await UserController.setVerified(req, res as any, next);

    expect(UserService.setVerified).toHaveBeenCalledWith('u1', true);
    expect(serializeUserForResponse).toHaveBeenCalled();
    expect(res.body.data.user.verified).toBe(true);
  });
});

describe('UserController.remove', () => {
  test('deletes via service, cleans up authorization, returns success', async () => {
    const req: any = { params: { id: 'ux' } };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.delete).mockResolvedValue({ success: true });
    asMock(AuthorizationModel.destroy).mockResolvedValue(1 as any);

    await UserController.remove(req, res as any, next);

    expect(UserService.delete).toHaveBeenCalledWith('ux');
    expect(AuthorizationModel.destroy).toHaveBeenCalledWith({
      where: { userId: 'ux' },
    });
    expect(res.body.data).toEqual({ success: true });
  });
});

describe('UserController.setRole', () => {
  test('400 if body.role invalid', async () => {
    const req: any = { params: { id: 'u1' }, body: { role: 'nope' } };
    const res = makeRes();
    const next = makeNext();

    await UserController.setRole(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({ error: 'Invalid role' });
    expect(UserService.setRole).not.toHaveBeenCalled();
  });

  test('delegates to service and returns user with authorization', async () => {
    const req: any = { params: { id: 'u1' }, body: { role: 'employee' } };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.setRole).mockResolvedValue(
      mkUser({ userId: 'u1', authorization: { role: 'employee' } })
    );

    await UserController.setRole(req, res as any, next);

    expect(UserService.setRole).toHaveBeenCalledWith('u1', 'employee');
    expect(res.body.data.user.authorization).toEqual({ role: 'employee' });
  });
});

/* ============================== error path smoke ============================= */

describe('UserController error paths', () => {
  test('create bubbles to next on error', async () => {
    const req: any = { body: {} };
    const res = makeRes();
    const next = makeNext();

    asMock(sequelize.transaction).mockRejectedValueOnce(new Error('boom'));

    await UserController.create(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('getById bubbles to next on error', async () => {
    const req: any = { params: { id: 'u1' } };
    const res = makeRes();
    const next = makeNext();

    asMock(UserService.getById).mockRejectedValueOnce(new Error('nope'));

    await UserController.getById(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
