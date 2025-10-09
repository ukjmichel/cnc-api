// src/__tests__/controllers/user.controller.spec.ts

/**
 * UserController — unit tests (pure Jest mocks; no DB)
 * @jest-environment node
 */

/* ================================ Helpers ================================= */

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function makeNext() {
  return jest.fn();
}

/* ========================= Mock setup ========================= */

const mockGetById = jest.fn();
const mockGetByEmail = jest.fn();
const mockGetByUsername = jest.fn();
const mockList = jest.fn();
const mockFilter = jest.fn();
const mockUpdate = jest.fn();
const mockChangePassword = jest.fn();
const mockSetVerified = jest.fn();
const mockDelete = jest.fn();
const mockSetRole = jest.fn();

const mockSerializeUserForResponse = jest.fn((u: any) => ({ __s: true, ...u }));
const mockSerializeUsers = jest.fn((arr: any[]) =>
  (arr || []).map((u) => ({ __s: true, ...u }))
);

const mockBuildUserListQuery = jest.fn((q: Record<string, unknown>) => ({
  __built: 'list',
  ...q,
}));

const mockBuildUserFilterQuery = jest.fn((q: Record<string, unknown>) => ({
  __built: 'filter',
  ...q,
}));

const mockUserModelCreate = jest.fn();
const mockAuthorizationModelCreate = jest.fn();
const mockAuthorizationModelDestroy = jest.fn();

const mockTransaction = jest.fn(async (cb: (t: any) => any) => cb({}));

// Mock modules
jest.mock('../../services/user.service.js', () => ({
  UserService: {
    getById: mockGetById,
    getByEmail: mockGetByEmail,
    getByUsername: mockGetByUsername,
    list: mockList,
    filter: mockFilter,
    update: mockUpdate,
    changePassword: mockChangePassword,
    setVerified: mockSetVerified,
    delete: mockDelete,
    setRole: mockSetRole,
  },
}));

jest.mock('../../serializers/user.serializer.js', () => ({
  serializeUserForResponse: mockSerializeUserForResponse,
  serializeUsers: mockSerializeUsers,
}));

jest.mock('../../queries/user.queries.js', () => ({
  buildUserListQuery: mockBuildUserListQuery,
  buildUserFilterQuery: mockBuildUserFilterQuery,
}));

jest.mock('../../models/user.model.js', () => ({
  UserModel: {
    create: mockUserModelCreate,
  },
}));

jest.mock('../../models/authorization.model.js', () => ({
  AuthorizationModel: {
    create: mockAuthorizationModelCreate,
    destroy: mockAuthorizationModelDestroy,
  },
}));

jest.mock('../../db/sequelize.js', () => ({
  sequelize: {
    transaction: mockTransaction,
  },
}));

/* ========================= Import after mocks ========================= */

import { UserController } from '../../controllers/user.controller.js';

/* ================================ Lifecycle ================================= */

function mkUser(over: Partial<any> = {}) {
  return {
    userId: 'u1',
    username: 'john',
    firstName: 'John',
    lastName: 'Doe',
    email: 'j@e.com',
    verified: false,
    authorization: null,
    ...over,
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  mockGetById.mockClear();
  mockGetByEmail.mockClear();
  mockGetByUsername.mockClear();
  mockList.mockClear();
  mockFilter.mockClear();
  mockUpdate.mockClear();
  mockChangePassword.mockClear();
  mockSetVerified.mockClear();
  mockDelete.mockClear();
  mockSetRole.mockClear();

  mockSerializeUserForResponse.mockClear();
  mockSerializeUserForResponse.mockImplementation((u: any) => ({
    __s: true,
    ...u,
  }));
  mockSerializeUsers.mockClear();
  mockSerializeUsers.mockImplementation((arr: any[]) =>
    (arr || []).map((u) => ({ __s: true, ...u }))
  );

  mockBuildUserListQuery.mockClear();
  mockBuildUserListQuery.mockImplementation((q: Record<string, unknown>) => ({
    __built: 'list',
    ...q,
  }));
  mockBuildUserFilterQuery.mockClear();
  mockBuildUserFilterQuery.mockImplementation((q: Record<string, unknown>) => ({
    __built: 'filter',
    ...q,
  }));

  mockUserModelCreate.mockClear();
  mockAuthorizationModelCreate.mockClear();
  mockAuthorizationModelDestroy.mockClear();
  mockTransaction.mockClear();
  mockTransaction.mockImplementation(async (cb: (t: any) => any) => cb({}));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/* ================================= Tests ================================= */

/* ================================= CREATE ================================= */

describe('UserController.create', () => {
  test('201 + creates user with default role=user in transaction', async () => {
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

    const created = mkUser({ userId: 'ua', email: 'alice@mail.com' });
    mockUserModelCreate.mockResolvedValue({
      toJSON: () => ({ ...created }),
      userId: 'ua',
    });
    mockAuthorizationModelCreate.mockResolvedValue(undefined);

    await UserController.create(req, res, next);

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockUserModelCreate).toHaveBeenCalledWith(
      {
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@mail.com',
        password: 'pw',
      },
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(mockAuthorizationModelCreate).toHaveBeenCalledWith(
      { userId: 'ua', role: 'user' },
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockSerializeUserForResponse).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      data: {
        user: expect.objectContaining({
          __s: true,
          userId: 'ua',
        }),
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { body: {} };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('transaction failed');

    mockTransaction.mockRejectedValue(boom);

    await UserController.create(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('UserController.createEmployee', () => {
  test('201 + creates user with role=employee in transaction', async () => {
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
    mockUserModelCreate.mockResolvedValue({
      toJSON: () => ({ ...created }),
      userId: 'ub',
    });
    mockAuthorizationModelCreate.mockResolvedValue(undefined);

    await UserController.createEmployee(req, res, next);

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockAuthorizationModelCreate).toHaveBeenCalledWith(
      { userId: 'ub', role: 'employee' },
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      data: {
        user: expect.objectContaining({
          __s: true,
          userId: 'ub',
        }),
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { body: {} };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('transaction failed');

    mockTransaction.mockRejectedValue(boom);

    await UserController.createEmployee(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

/* ================================= READS ================================== */

describe('UserController.getById', () => {
  test('200 + serialized user', async () => {
    const req: any = { params: { id: 'u42' } };
    const res = makeRes();
    const next = makeNext();

    const found = mkUser({ userId: 'u42' });
    mockGetById.mockResolvedValue(found);

    await UserController.getById(req, res, next);

    expect(mockGetById).toHaveBeenCalledWith('u42');
    expect(mockSerializeUserForResponse).toHaveBeenCalledWith(found);
    expect(res.json).toHaveBeenCalledWith({
      data: { user: { __s: true, ...found } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'nope' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('not found');

    mockGetById.mockRejectedValue(boom);

    await UserController.getById(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('UserController.getByEmail', () => {
  test('200 + serialized user', async () => {
    const req: any = { query: { email: 'x@y.z' } };
    const res = makeRes();
    const next = makeNext();

    const found = mkUser({ email: 'x@y.z' });
    mockGetByEmail.mockResolvedValue(found);

    await UserController.getByEmail(req, res, next);

    expect(mockGetByEmail).toHaveBeenCalledWith('x@y.z');
    expect(mockSerializeUserForResponse).toHaveBeenCalledWith(found);
    expect(res.json).toHaveBeenCalledWith({
      data: { user: { __s: true, ...found } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { query: { email: 'bad' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('not found');

    mockGetByEmail.mockRejectedValue(boom);

    await UserController.getByEmail(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('UserController.getByUsername', () => {
  test('200 + serialized user', async () => {
    const req: any = { query: { username: 'alice' } };
    const res = makeRes();
    const next = makeNext();

    const found = mkUser({ username: 'alice' });
    mockGetByUsername.mockResolvedValue(found);

    await UserController.getByUsername(req, res, next);

    expect(mockGetByUsername).toHaveBeenCalledWith('alice');
    expect(mockSerializeUserForResponse).toHaveBeenCalledWith(found);
    expect(res.json).toHaveBeenCalledWith({
      data: { user: { __s: true, ...found } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { query: { username: 'bad' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('not found');

    mockGetByUsername.mockRejectedValue(boom);

    await UserController.getByUsername(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

/* =============================== LIST & FILTER ============================== */

describe('UserController.list', () => {
  test('200 + serialized array + meta', async () => {
    const req: any = {
      query: { q: 'john', page: '2', pageSize: '5', role: 'employee' },
    };
    const res = makeRes();
    const next = makeNext();

    const rows = [mkUser({ userId: 'u1' }), mkUser({ userId: 'u2' })];
    mockList.mockResolvedValue({
      users: rows,
      total: 12,
      page: 2,
      pageSize: 5,
      pages: 3,
    });

    await UserController.list(req, res, next);

    expect(mockBuildUserListQuery).toHaveBeenCalledWith(req.query);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ __built: 'list' })
    );
    expect(mockSerializeUsers).toHaveBeenCalledWith(rows);
    expect(res.json).toHaveBeenCalledWith({
      data: { users: rows.map((r) => ({ __s: true, ...r })) },
      meta: { total: 12, page: 2, pageSize: 5, pages: 3 },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { query: {} };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('bad list');

    mockList.mockRejectedValue(boom);

    await UserController.list(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('UserController.filter', () => {
  test('200 + serialized array + meta', async () => {
    const req: any = { query: { q: 'a', verified: 'true', authRole: 'user' } };
    const res = makeRes();
    const next = makeNext();

    const rows = [mkUser({ userId: 'f1' })];
    mockFilter.mockResolvedValue({
      users: rows,
      total: 1,
      page: 1,
      pageSize: 20,
      pages: 1,
    });

    await UserController.filter(req, res, next);

    expect(mockBuildUserFilterQuery).toHaveBeenCalledWith(req.query);
    expect(mockFilter).toHaveBeenCalledWith(
      expect.objectContaining({ __built: 'filter' })
    );
    expect(mockSerializeUsers).toHaveBeenCalledWith(rows);
    expect(res.json).toHaveBeenCalledWith({
      data: { users: rows.map((r) => ({ __s: true, ...r })) },
      meta: { total: 1, page: 1, pageSize: 20, pages: 1 },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { query: {} };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('bad filter');

    mockFilter.mockRejectedValue(boom);

    await UserController.filter(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

/* ================================ MUTATIONS ================================= */

describe('UserController.update', () => {
  test('200 + serialized user', async () => {
    const req: any = { params: { id: 'u7' }, body: { username: 'new' } };
    const res = makeRes();
    const next = makeNext();

    const updated = mkUser({ userId: 'u7', username: 'new' });
    mockUpdate.mockResolvedValue(updated);

    await UserController.update(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith('u7', { username: 'new' });
    expect(mockSerializeUserForResponse).toHaveBeenCalledWith(updated);
    expect(res.json).toHaveBeenCalledWith({
      data: { user: { __s: true, ...updated } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'u7' }, body: {} };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('update failed');

    mockUpdate.mockRejectedValue(boom);

    await UserController.update(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('UserController.changePassword', () => {
  test('200 + success', async () => {
    const req: any = {
      params: { id: 'u1' },
      body: { currentPassword: 'a', newPassword: 'b' },
    };
    const res = makeRes();
    const next = makeNext();

    mockChangePassword.mockResolvedValue({ success: true });

    await UserController.changePassword(req, res, next);

    expect(mockChangePassword).toHaveBeenCalledWith('u1', {
      currentPassword: 'a',
      newPassword: 'b',
    });
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'u1' }, body: {} };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('password change failed');

    mockChangePassword.mockRejectedValue(boom);

    await UserController.changePassword(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('UserController.setVerified', () => {
  test('200 + serialized user', async () => {
    const req: any = { params: { id: 'u1' }, body: { verified: true } };
    const res = makeRes();
    const next = makeNext();

    const updated = mkUser({ userId: 'u1', verified: true });
    mockSetVerified.mockResolvedValue(updated);

    await UserController.setVerified(req, res, next);

    expect(mockSetVerified).toHaveBeenCalledWith('u1', true);
    expect(mockSerializeUserForResponse).toHaveBeenCalledWith(updated);
    expect(res.json).toHaveBeenCalledWith({
      data: { user: { __s: true, ...updated } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'u1' }, body: { verified: true } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('set verified failed');

    mockSetVerified.mockRejectedValue(boom);

    await UserController.setVerified(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('UserController.remove', () => {
  test('200 + success + cleanup authorization', async () => {
    const req: any = { params: { id: 'ux' } };
    const res = makeRes();
    const next = makeNext();

    mockDelete.mockResolvedValue({ success: true });
    mockAuthorizationModelDestroy.mockResolvedValue(1);

    await UserController.remove(req, res, next);

    expect(mockDelete).toHaveBeenCalledWith('ux');
    expect(mockAuthorizationModelDestroy).toHaveBeenCalledWith({
      where: { userId: 'ux' },
    });
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'ux' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('delete failed');

    mockDelete.mockRejectedValue(boom);

    await UserController.remove(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('UserController.setRole', () => {
  test('400 if body.role invalid', async () => {
    const req: any = { params: { id: 'u1' }, body: { role: 'nope' } };
    const res = makeRes();
    const next = makeNext();

    await UserController.setRole(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid role' });
    expect(mockSetRole).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('200 + user with authorization', async () => {
    const req: any = { params: { id: 'u1' }, body: { role: 'employee' } };
    const res = makeRes();
    const next = makeNext();

    const updated = mkUser({
      userId: 'u1',
      authorization: { role: 'employee' },
    });
    mockSetRole.mockResolvedValue(updated);

    await UserController.setRole(req, res, next);

    expect(mockSetRole).toHaveBeenCalledWith('u1', 'employee');
    expect(res.json).toHaveBeenCalledWith({ data: { user: updated } });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'u1' }, body: { role: 'employee' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('set role failed');

    mockSetRole.mockRejectedValue(boom);

    await UserController.setRole(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});
