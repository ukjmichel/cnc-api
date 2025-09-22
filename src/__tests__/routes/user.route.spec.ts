import 'reflect-metadata';
import { jest } from '@jest/globals';

const asMock = (fn: unknown) => fn as jest.MockedFunction<any>;

/* ========================= Mocks (before imports) ========================= */

// Middlewares: pass-through but record calls
const requireAuth = jest.fn((req: any, _res: any, next: any) => next());
const requireEmployeeOrAdmin = jest.fn((req: any, _res: any, next: any) =>
  next()
);
const requireAdmin = jest.fn((req: any, _res: any, next: any) => next());

jest.unstable_mockModule('../../middlewares/requireAuth.js', () => ({
  requireAuth,
}));
jest.unstable_mockModule('../../middlewares/requireRole.js', () => ({
  requireEmployeeOrAdmin,
  requireAdmin,
}));

// Controllers: annotate params so `res` is not `unknown`
const ctrl = {
  create: jest.fn(async (_req: any, res: any) =>
    res
      .status(201)
      .json({
        data: { user: { userId: 'new', authorization: { role: 'user' } } },
      })
  ),
  createEmployee: jest.fn(async (_req: any, res: any) =>
    res
      .status(201)
      .json({
        data: { user: { userId: 'emp', authorization: { role: 'employee' } } },
      })
  ),
  list: jest.fn(async (_req: any, res: any) =>
    res.json({
      data: { users: [{ userId: 'u1' }] },
      meta: { total: 1, page: 1, pageSize: 20, pages: 1 },
    })
  ),
  filter: jest.fn(async (_req: any, res: any) =>
    res.json({
      data: { users: [{ userId: 'f1' }] },
      meta: { total: 1, page: 1, pageSize: 20, pages: 1 },
    })
  ),
  getByEmail: jest.fn(async (req: any, res: any) =>
    res.json({
      data: { user: { userId: 'e1', email: String(req.query.email || '') } },
    })
  ),
  getByUsername: jest.fn(async (req: any, res: any) =>
    res.json({
      data: {
        user: { userId: 'n1', username: String(req.query.username || '') },
      },
    })
  ),
  getById: jest.fn(async (req: any, res: any) =>
    res.json({ data: { user: { userId: String(req.params.id) } } })
  ),
  update: jest.fn(async (req: any, res: any) =>
    res.json({
      data: { user: { userId: String(req.params.id), ...(req.body || {}) } },
    })
  ),
  changePassword: jest.fn(async (_req: any, res: any) =>
    res.json({ data: { success: true } })
  ),
  setVerified: jest.fn(async (req: any, res: any) =>
    res.json({
      data: {
        user: {
          userId: String(req.params.id),
          verified: Boolean(req.body?.verified),
        },
      },
    })
  ),
  remove: jest.fn(async (_req: any, res: any) =>
    res.json({ data: { success: true } })
  ),
  setRole: jest.fn(async (req: any, res: any) =>
    res.json({
      data: {
        user: {
          userId: String(req.params.id),
          authorization: { role: req.body?.role },
        },
      },
    })
  ),
};

jest.unstable_mockModule('../../controllers/user.controller.js', () => ({
  UserController: ctrl,
}));

/* ========================= Load SUT after mocks ========================= */
import express from 'express';
import request from 'supertest';

const { userRouter } = await import('../../routes/user.route');

/* ============================= Test server ============================== */
const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRouter);
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  return app;
};

let app: express.Express;

beforeEach(() => {
  jest.clearAllMocks();
  app = makeApp();
});

/* ================================ Tests ================================= */

describe('User routes — middleware & wiring', () => {
  test('POST /api/users → create (requires auth + employeeOrAdmin)', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'a@b.com',
        password: 'x',
      })
      .expect(201);

    expect(requireAuth).toHaveBeenCalled();
    expect(requireEmployeeOrAdmin).toHaveBeenCalled();
    expect(ctrl.create).toHaveBeenCalled();
    expect(res.body.data.user).toMatchObject({
      userId: 'new',
      authorization: { role: 'user' },
    });
  });

  test('POST /api/users/employee → createEmployee (requires auth + admin)', async () => {
    const res = await request(app)
      .post('/api/users/employee')
      .send({
        username: 'bob',
        firstName: 'Bob',
        lastName: 'Brown',
        email: 'b@c.com',
        password: 'y',
      })
      .expect(201);

    expect(requireAuth).toHaveBeenCalled();
    expect(requireAdmin).toHaveBeenCalled();
    expect(ctrl.createEmployee).toHaveBeenCalled();
    expect(res.body.data.user.authorization).toEqual({ role: 'employee' });
  });

  test('GET /api/users → list (requires auth + employeeOrAdmin)', async () => {
    const res = await request(app)
      .get('/api/users?q=john&page=2&pageSize=5&authRole=employee')
      .expect(200);

    expect(requireAuth).toHaveBeenCalled();
    expect(requireEmployeeOrAdmin).toHaveBeenCalled();
    expect(ctrl.list).toHaveBeenCalled();
    expect(res.body).toEqual({
      data: { users: [{ userId: 'u1' }] },
      meta: { total: 1, page: 1, pageSize: 20, pages: 1 },
    });
  });

  test('GET /api/users/filter → filter (requires auth + employeeOrAdmin)', async () => {
    const res = await request(app)
      .get('/api/users/filter?q=a&role=administrator')
      .expect(200);

    expect(requireAuth).toHaveBeenCalled();
    expect(requireEmployeeOrAdmin).toHaveBeenCalled();
    expect(ctrl.filter).toHaveBeenCalled();
    expect(res.body.data.users[0].userId).toBe('f1');
  });

  test('GET /api/users/by-email → getByEmail', async () => {
    const res = await request(app)
      .get('/api/users/by-email?email=x@y.z')
      .expect(200);

    expect(requireAuth).toHaveBeenCalled();
    expect(requireEmployeeOrAdmin).toHaveBeenCalled();
    expect(ctrl.getByEmail).toHaveBeenCalled();
    expect(res.body.data.user.email).toBe('x@y.z');
  });

  test('GET /api/users/by-username → getByUsername', async () => {
    const res = await request(app)
      .get('/api/users/by-username?username=alice')
      .expect(200);

    expect(ctrl.getByUsername).toHaveBeenCalled();
    expect(res.body.data.user.username).toBe('alice');
  });

  test('GET /api/users/:id → getById', async () => {
    const res = await request(app).get('/api/users/u42').expect(200);
    expect(ctrl.getById).toHaveBeenCalled();
    expect(res.body.data.user.userId).toBe('u42');
  });

  test('PATCH /api/users/:id → update', async () => {
    const res = await request(app)
      .patch('/api/users/u7')
      .send({ username: 'new' })
      .expect(200);

    expect(ctrl.update).toHaveBeenCalled();
    expect(res.body.data.user).toMatchObject({ userId: 'u7', username: 'new' });
  });

  test('PATCH /api/users/:id/password → changePassword', async () => {
    const res = await request(app)
      .patch('/api/users/u1/password')
      .send({ currentPassword: 'a', newPassword: 'b' })
      .expect(200);

    expect(ctrl.changePassword).toHaveBeenCalled();
    expect(res.body.data).toEqual({ success: true });
  });

  test('PATCH /api/users/:id/verified → setVerified', async () => {
    const res = await request(app)
      .patch('/api/users/u1/verified')
      .send({ verified: true })
      .expect(200);

    expect(ctrl.setVerified).toHaveBeenCalled();
    expect(res.body.data.user).toMatchObject({ userId: 'u1', verified: true });
  });

  test('DELETE /api/users/:id → remove', async () => {
    const res = await request(app).delete('/api/users/u9').expect(200);
    expect(ctrl.remove).toHaveBeenCalled();
    expect(res.body.data).toEqual({ success: true });
  });

  test('PATCH /api/users/:id/role → setRole (requires admin)', async () => {
    const res = await request(app)
      .patch('/api/users/u5/role')
      .send({ role: 'employee' })
      .expect(200);

    expect(requireAdmin).toHaveBeenCalled();
    expect(ctrl.setRole).toHaveBeenCalled();
    expect(res.body.data.user.authorization).toEqual({ role: 'employee' });
  });
});
