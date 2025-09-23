/**
 * OrderItemsController — unit tests (pure Jest mocks; no DB)
 */

import 'reflect-metadata';
import {
  describe,
  test,
  beforeEach,
  afterEach,
  expect,
  jest,
} from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

import { BadRequestError, NotFoundError } from '../../errors/index.js';

// ----------------------------- ESM-safe mocks -----------------------------

// Service layer mocks (exported as a module before importing SUT)
const svc = {
  create: jest.fn(),
  createMany: jest.fn(),
  listByOrder: jest.fn(),
  getOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  filter: jest.fn(),
};

await jest.unstable_mockModule('../../services/order-item.service.js', () => ({
  orderItemService: svc,
}));

// SUT (controller) AFTER module mocks
const { OrderItemsController } = await import(
  '../../controllers/order-item.controller.js'
);

// Static import for model (we'll spy on it)
import { OrderModel } from '../../models/order.model.js';

// ----------------------------- helpers -----------------------------------

function makeRes() {
  const res: Partial<Response> & { statusCode?: number; body?: any } = {};
  (res.status as any) = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  (res.json as any) = jest.fn((payload: any) => {
    res.body = payload;
    return res as Response;
  });
  return res as Response & { statusCode?: number; body?: any };
}

function makeNext() {
  return jest.fn() as unknown as NextFunction & jest.Mock;
}

// ----------------------------- lifecycle ---------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

// ----------------------------- tests -------------------------------------

describe('OrderItemsController.create', () => {
  test('201 → ensures order exists, injects orderId, delegates to service, returns { data: { item } }', async () => {
    const req = {
      params: { orderId: 'ORD-1' },
      headers: {},
      body: { stockId: 'S1', quantity: '1.250' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue({} as any);
    svc.create.mockImplementation(async () => ({
      orderId: 'ORD-1',
      stockId: 'S1',
      quantity: '1.250',
      unitPrice: '2.00',
      lineTotal: '2.50',
    }));

    await OrderItemsController.create(req, res, next);

    expect(OrderModel.findByPk).toHaveBeenCalledWith('ORD-1');
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ORD-1',
        stockId: 'S1',
        quantity: '1.250',
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body?.data?.item?.stockId).toBe('S1');
    expect(next).not.toHaveBeenCalled();
  });

  test('400 → missing orderId param', async () => {
    const req = {
      params: { orderId: '' },
      body: {},
      headers: {},
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    await OrderItemsController.create(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });

  test('404 → order not found', async () => {
    const req = {
      params: { orderId: 'X' },
      headers: {},
      body: { stockId: 'S', quantity: '1' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);

    await OrderItemsController.create(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });

  test('400 → rejects direct stock adjust sentinel (header)', async () => {
    const req = {
      params: { orderId: 'ORD-1' },
      headers: { 'x-direct-stock-adjust': 'true' },
      body: { stockId: 'S1', quantity: '1' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    await OrderItemsController.create(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('OrderItemsController.createMany', () => {
  test('201 → ensures order exists, validates non-empty array, normalizes & delegates to service', async () => {
    const req = {
      params: { orderId: 'ORD-2' },
      headers: {},
      body: [
        { stockId: 'S1', quantity: 1, unitPrice: 2, lineTotal: 2 },
        { stockId: 'S2', quantity: '0.500' },
      ],
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue({} as any);
    const created = [
      {
        orderId: 'ORD-2',
        stockId: 'S1',
        quantity: '1.000',
        unitPrice: '2.00',
        lineTotal: '2.00',
      },
      {
        orderId: 'ORD-2',
        stockId: 'S2',
        quantity: '0.500',
        unitPrice: '3.00',
        lineTotal: '1.50',
      },
    ];
    svc.createMany.mockImplementation(async () => created);

    await OrderItemsController.createMany(req, res, next);

    expect(OrderModel.findByPk).toHaveBeenCalledWith('ORD-2');
    expect(svc.createMany).toHaveBeenCalledWith([
      {
        orderId: 'ORD-2',
        stockId: 'S1',
        quantity: '1',
        unitPrice: '2',
        lineTotal: '2',
      },
      {
        orderId: 'ORD-2',
        stockId: 'S2',
        quantity: '0.500',
        unitPrice: undefined,
        lineTotal: undefined,
      },
    ]);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body?.data?.created?.length).toBe(2);
  });

  test('400 → body must be non-empty array', async () => {
    const req = {
      params: { orderId: 'ORD-2' },
      headers: {},
      body: [],
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue({} as any);

    await OrderItemsController.createMany(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });

  test('404 → order not found', async () => {
    const req = {
      params: { orderId: 'X' },
      headers: {},
      body: [{ stockId: 'S', quantity: '1' }],
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);

    await OrderItemsController.createMany(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });

  test('400 → rejects direct stock adjust sentinel (internal flag)', async () => {
    const req = {
      params: { orderId: 'ORD-2' },
      headers: {},
      body: [{ stockId: 'S1', quantity: '1' }],
      __directAdjust: true,
    } as any as Request & { __directAdjust?: boolean };
    const res = makeRes();
    const next = makeNext();

    await OrderItemsController.createMany(req as any, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('OrderItemsController.listForOrder', () => {
  test('200 → ensures order exists, builds query (numbers), delegates, maps meta', async () => {
    const req = {
      params: { orderId: 'ORD-3' },
      query: {
        page: '2',
        pageSize: '5',
        orderBy: 'createdAt',
        orderDir: 'DESC',
      },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue({} as any);
    svc.listByOrder.mockImplementation(async () => ({
      items: [{ orderId: 'ORD-3', stockId: 'S1' }],
      total: 7,
      page: 2,
      pageSize: 5,
      pages: 2,
    }));

    await OrderItemsController.listForOrder(req, res, next);

    const callArg = (svc.listByOrder as unknown as jest.Mock).mock
      .calls[0][1] as any; // <-- cast to any to avoid 'unknown'

    expect(callArg.page).toBe(2);
    expect(callArg.pageSize).toBe(5);
    expect(callArg.orderBy).toBe('createdAt');
    expect(callArg.orderDir).toBe('DESC');

    expect(res.body?.data?.items?.[0]?.stockId).toBe('S1');
    expect(res.body?.meta).toEqual({
      total: 7,
      page: 2,
      pageSize: 5,
      pages: 2,
    });
  });

  test('400 → missing orderId', async () => {
    const req = { params: { orderId: '' }, query: {} } as any as Request;
    const res = makeRes();
    const next = makeNext();

    await OrderItemsController.listForOrder(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });

  test('404 → order not found', async () => {
    const req = { params: { orderId: 'X' }, query: {} } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);

    await OrderItemsController.listForOrder(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });
});

describe('OrderItemsController.getOne', () => {
  test('200 → ensures order exists, delegates to service, returns { data: { item } }', async () => {
    const req = {
      params: { orderId: 'ORD-4', stockId: 'S9' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue({} as any);
    svc.getOne.mockImplementation(async () => ({
      orderId: 'ORD-4',
      stockId: 'S9',
    }));

    await OrderItemsController.getOne(req, res, next);

    expect(svc.getOne).toHaveBeenCalledWith('ORD-4', 'S9');
    expect(res.body?.data?.item?.stockId).toBe('S9');
  });

  test('404 → order not found', async () => {
    const req = { params: { orderId: 'X', stockId: 'S' } } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);

    await OrderItemsController.getOne(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });
});

describe('OrderItemsController.update', () => {
  test('200 → ensures order exists, delegates to service, returns updated item', async () => {
    const req = {
      params: { orderId: 'ORD-5', stockId: 'S1' },
      body: { quantity: '2.500', unitPrice: '3.00' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue({} as any);
    svc.update.mockImplementation(async () => ({
      orderId: 'ORD-5',
      stockId: 'S1',
      quantity: '2.500',
      unitPrice: '3.00',
      lineTotal: '7.50',
    }));

    await OrderItemsController.update(req, res, next);

    expect(svc.update).toHaveBeenCalledWith('ORD-5', 'S1', req.body);
    expect(res.body?.data?.item?.lineTotal).toBe('7.50');
  });

  test('404 → order not found', async () => {
    const req = {
      params: { orderId: 'X', stockId: 'S1' },
      body: {},
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);

    await OrderItemsController.update(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });
});

describe('OrderItemsController.remove', () => {
  test('200 → ensures order exists, delegates to service, returns { deleted: true }', async () => {
    const req = {
      params: { orderId: 'ORD-6', stockId: 'S1' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue({} as any);
    svc.remove.mockImplementation(async () => ({ deleted: true }));

    await OrderItemsController.remove(req, res, next);

    expect(svc.remove).toHaveBeenCalledWith('ORD-6', 'S1');
    expect(res.body?.data).toEqual({ deleted: true });
  });

  test('404 → order not found', async () => {
    const req = { params: { orderId: 'X', stockId: 'S1' } } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);

    await OrderItemsController.remove(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });
});

describe('OrderItemsController.filter', () => {
  test('200 → builds filters & paging, delegates to service, maps meta', async () => {
    const req = {
      query: {
        page: '3',
        pageSize: '10',
        orderBy: 'createdAt',
        orderDir: 'ASC',
        orderId: 'ORD-9',
        stockId: 'S9',
        productId: 'P9',
        createdFrom: '2024-01-01',
        createdTo: '2024-01-31',
        quantityMin: '1',
        quantityMax: '5.5',
        unitPriceMin: '2',
        unitPriceMax: '9.99',
        lineTotalMin: '3.14',
        lineTotalMax: '99.95',
      },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    svc.filter.mockImplementation(async () => ({
      items: [{ orderId: 'ORD-9', stockId: 'S9' }],
      total: 11,
      page: 3,
      pageSize: 10,
      pages: 2,
    }));

    await OrderItemsController.filter(req, res, next);

    const callArg = (svc.filter as unknown as jest.Mock).mock
      .calls[0][0] as any; // <-- cast

    expect(callArg.page).toBe(3);
    expect(callArg.pageSize).toBe(10);
    expect(callArg.orderBy).toBe('createdAt');
    expect(callArg.orderDir).toBe('ASC');

    expect(callArg.filters).toEqual(
      expect.objectContaining({
        orderId: 'ORD-9',
        stockId: 'S9',
        productId: 'P9',
        createdFrom: '2024-01-01',
        createdTo: '2024-01-31',
        quantityMin: 1,
        quantityMax: 5.5,
        unitPriceMin: 2,
        unitPriceMax: 9.99,
        lineTotalMin: 3.14,
        lineTotalMax: 99.95,
      })
    );

    expect(res.body?.meta).toEqual({
      total: 11,
      page: 3,
      pageSize: 10,
      pages: 2,
    });
    expect(res.body?.data?.items?.[0]?.stockId).toBe('S9');
  });
});
