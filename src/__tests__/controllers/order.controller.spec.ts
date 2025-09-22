/**
 * OrderController — unit tests (pure Jest mocks; no DB)
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
import { Op } from 'sequelize';

import { OrderController } from '../../controllers/order.controller.js';
import { OrderService } from '../../services/order.service.js';
import { OrderItemModel } from '../../models/order-item.model.js';
import { StockModel } from '../../models/stock.model.js';
import { BadRequestError, NotFoundError } from '../../errors/index.js';

/* -------------------------------- helpers -------------------------------- */

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

// IMPORTANT: expose fields (like stockId) as own props since controller reads r.stockId directly
function mkItemRow(json: any) {
  return {
    ...json, // <-- make stockId, quantity, etc. directly accessible
    toJSON: () => ({ ...json }),
    get: (k?: string) => (k ? json[k] : { ...json }),
  } as any;
}

function mkStockRow(json: any) {
  return {
    ...json,
    toJSON: () => ({ ...json }),
    get: (k?: string) => (k ? json[k] : { ...json }),
    stockId: json.stockId,
  } as any;
}

/* -------------------------------- lifecycle ------------------------------ */

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* --------------------------------- tests --------------------------------- */

describe('OrderController.create', () => {
  test('201 → calls service and returns { data: { order } }', async () => {
    const req = {
      body: { status: 'pending', currency: 'USD' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    const order = { orderId: 'O1', status: 'pending' };
    jest.spyOn(OrderService, 'create').mockResolvedValue(order as any);

    await OrderController.create(req, res, next);

    expect(OrderService.create).toHaveBeenCalledWith(req.body);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body?.data?.order).toEqual(order);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('OrderController.list', () => {
  test('200 → builds query & maps meta', async () => {
    const req = {
      query: {
        page: '2',
        pageSize: '5',
        orderBy: 'grandTotal',
        orderDir: 'ASC',
        userId: ' U1 ',
        status: 'paid,pending',
        pickupSlotId: 'null',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    const out = {
      orders: [{ orderId: 'O1' }],
      total: 10,
      page: 2,
      pageSize: 5,
      pages: 2,
    };
    const svcSpy = jest
      .spyOn(OrderService, 'list')
      .mockResolvedValue(out as any);

    await OrderController.list(req, res, next);

    expect(svcSpy).toHaveBeenCalledWith({
      filters: {
        userId: 'U1',
        status: ['paid', 'pending'],
        pickupSlotId: null,
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      },
      page: 2,
      pageSize: 5,
      orderBy: 'grandTotal',
      orderDir: 'ASC',
    });

    expect(res.body?.data?.orders).toEqual([{ orderId: 'O1' }]);
    expect(res.body?.meta).toEqual({
      total: 10,
      page: 2,
      pageSize: 5,
      pages: 2,
    });
  });
});

describe('OrderController.filter', () => {
  test('200 → alias of list (same meta mapping)', async () => {
    const req = {
      query: { page: '1', pageSize: '20', status: 'draft' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderService, 'list').mockResolvedValue({
      orders: [{ orderId: 'O2' }],
      total: 1,
      page: 1,
      pageSize: 20,
      pages: 1,
    } as any);

    await OrderController.filter(req, res, next);

    expect(OrderService.list).toHaveBeenCalledWith({
      filters: { status: 'draft' },
      page: 1,
      pageSize: 20,
      orderBy: undefined,
      orderDir: undefined,
    });
    expect(res.body?.data?.orders[0]?.orderId).toBe('O2');
    expect(res.body?.meta?.total).toBe(1);
  });
});

describe('OrderController.getById', () => {
  test('200 → returns order with items enriched with minimal stock info', async () => {
    const req = { params: { orderId: 'ORD-1' } } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderService, 'getById').mockResolvedValue({
      orderId: 'ORD-1',
      userId: 'U1',
      status: 'pending',
    } as any);

    const items = [
      mkItemRow({
        orderId: 'ORD-1',
        stockId: 'S1',
        quantity: '2.00',
        unitPrice: '5.00',
        lineTotal: '10.00',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      mkItemRow({
        orderId: 'ORD-1',
        stockId: null,
        quantity: '1.00',
        unitPrice: '3.00',
        lineTotal: '3.00',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ];
    jest.spyOn(OrderItemModel, 'findAll').mockResolvedValue(items as any);

    const stocks = [
      mkStockRow({
        stockId: 'S1',
        productId: 'P1',
        expirationDate: '2025-01-01',
      }),
    ];
    const stockSpy = jest
      .spyOn(StockModel, 'findAll')
      .mockResolvedValue(stocks as any);

    await OrderController.getById(req, res, next);

    const [[arg]] = stockSpy.mock.calls as unknown as [[any]];
    const syms = Object.getOwnPropertySymbols(arg.where?.stockId ?? {});
    expect(syms).toContain(Op.in);

    const got = res.body?.data?.order;
    expect(got.orderId).toBe('ORD-1');
    expect(Array.isArray(got.items)).toBe(true);

    expect(got.items[0]).toEqual({
      quantity: '2.00',
      unitPrice: '5.00',
      lineTotal: '10.00',
      productId: 'P1',
      expirationDate: '2025-01-01',
    });
    expect(got.items[1]).toEqual({
      quantity: '1.00',
      unitPrice: '3.00',
      lineTotal: '3.00',
      productId: null,
      expirationDate: null,
    });
  });

  test('404 → order missing', async () => {
    const req = { params: { orderId: 'missing' } } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderService, 'getById').mockResolvedValue(null as any);

    await OrderController.getById(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });
});

describe('OrderController.updateTotals', () => {
  test('200 → validates strings and returns order', async () => {
    const req = {
      params: { orderId: 'O1' },
      body: { subtotal: '10.50', taxTotal: '0.84', grandTotal: '11.34' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(OrderService, 'updateTotals')
      .mockResolvedValue({ orderId: 'O1', grandTotal: '11.34' } as any);

    await OrderController.updateTotals(req, res, next);

    expect(OrderService.updateTotals).toHaveBeenCalledWith('O1', req.body);
    expect(res.body?.data?.order?.grandTotal).toBe('11.34');
  });

  test('400 → missing/invalid decimal strings', async () => {
    const req = {
      params: { orderId: 'O1' },
      body: { subtotal: 1, taxTotal: '0', grandTotal: '1' }, // subtotal not string
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    await OrderController.updateTotals(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('OrderController.updateContact', () => {
  test('200 → calls service and returns order', async () => {
    const req = {
      params: { orderId: 'O1' },
      body: { contactName: 'Bob', notes: 'leave at door' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(OrderService, 'updateContact')
      .mockResolvedValue({ orderId: 'O1', contactName: 'Bob' } as any);

    await OrderController.updateContact(req, res, next);

    expect(OrderService.updateContact).toHaveBeenCalledWith('O1', req.body);
    expect(res.body?.data?.order?.contactName).toBe('Bob');
  });
});

describe('OrderController.changeStatus', () => {
  test('200 → requires status and returns order', async () => {
    const req = {
      params: { orderId: 'O1' },
      body: { status: 'paid' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(OrderService, 'changeStatus')
      .mockResolvedValue({ orderId: 'O1', status: 'paid' } as any);

    await OrderController.changeStatus(req, res, next);

    expect(OrderService.changeStatus).toHaveBeenCalledWith('O1', 'paid');
    expect(res.body?.data?.order?.status).toBe('paid');
  });

  test('400 → missing status', async () => {
    const req = { params: { orderId: 'O1' }, body: {} } as any as Request;
    const res = makeRes();
    const next = makeNext();

    await OrderController.changeStatus(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('OrderController.setPickupSlot', () => {
  test('200 → assign id', async () => {
    const req = {
      params: { orderId: 'O1' },
      body: { pickupSlotId: 'S1' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(OrderService, 'setPickupSlot')
      .mockResolvedValue({ orderId: 'O1', pickupSlotId: 'S1' } as any);

    await OrderController.setPickupSlot(req, res, next);

    expect(OrderService.setPickupSlot).toHaveBeenCalledWith('O1', 'S1');
    expect(res.body?.data?.order?.pickupSlotId).toBe('S1');
  });

  test('200 → unassign with null', async () => {
    const req = {
      params: { orderId: 'O1' },
      body: { pickupSlotId: null },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(OrderService, 'setPickupSlot')
      .mockResolvedValue({ orderId: 'O1', pickupSlotId: null } as any);

    await OrderController.setPickupSlot(req, res, next);

    expect(OrderService.setPickupSlot).toHaveBeenCalledWith('O1', null);
    expect(res.body?.data?.order?.pickupSlotId).toBe(null);
  });
});

describe('OrderController.remove', () => {
  test('200 → returns { deleted: true } wrapper', async () => {
    const req = { params: { orderId: 'O1' } } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(OrderService, 'remove')
      .mockResolvedValue({ deleted: true } as any);

    await OrderController.remove(req, res, next);

    expect(OrderService.remove).toHaveBeenCalledWith('O1');
    expect(res.body?.data).toEqual({ deleted: true });
  });
});

describe('OrderController.listSelf', () => {
  test('200 → injects req.user.userId into filters', async () => {
    const req = {
      user: { userId: 'U9' },
      query: {
        status: 'draft,paid',
        pickupSlotId: 'null',
        page: '3',
        pageSize: '7',
        orderBy: 'createdAt',
        orderDir: 'DESC',
      },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    const out = {
      orders: [{ orderId: 'O3' }],
      total: 7,
      page: 3,
      pageSize: 7,
      pages: 1,
    };
    const spy = jest.spyOn(OrderService, 'list').mockResolvedValue(out as any);

    await OrderController.listSelf(req as any, res, next);

    expect(spy).toHaveBeenCalledWith({
      filters: { status: ['draft', 'paid'], pickupSlotId: null, userId: 'U9' },
      page: 3,
      pageSize: 7,
      orderBy: 'createdAt',
      orderDir: 'DESC',
    });
    expect(res.body?.meta?.total).toBe(7);
    expect(res.body?.data?.orders[0]?.orderId).toBe('O3');
  });
});

describe('OrderController.getSelfById', () => {
  test('200 → returns own order with items + embedded stock (stockId removed inside stock)', async () => {
    const req = {
      params: { orderId: 'ORD-7' },
      user: { userId: 'U7' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest.spyOn(OrderService, 'getById').mockResolvedValue({
      orderId: 'ORD-7',
      userId: 'U7',
      status: 'pending',
    } as any);

    const rows = [
      mkItemRow({
        orderId: 'ORD-7',
        stockId: 'S7',
        quantity: '2.00',
        unitPrice: '5.00',
        lineTotal: '10.00',
      }),
    ];
    jest.spyOn(OrderItemModel, 'findAll').mockResolvedValue(rows as any);

    const stocks = [
      mkStockRow({
        stockId: 'S7',
        productId: 'P7',
        location: 'WH1',
        zone: null,
        expirationDate: '2026-01-01',
      }),
    ];
    jest.spyOn(StockModel, 'findAll').mockResolvedValue(stocks as any);

    await OrderController.getSelfById(req as any, res, next);

    const order = res.body?.data?.order;
    expect(order.orderId).toBe('ORD-7');
    expect(order.items?.length).toBe(1);

    const item = order.items[0];
    expect(item.stock).toEqual({
      productId: 'P7',
      location: 'WH1',
      zone: null,
      expirationDate: '2026-01-01',
    });
    expect(item.stockId).toBe('S7');
    expect(item.stock.stockId).toBeUndefined();
  });

  test('404 → order not found or not owned by user', async () => {
    const req = {
      params: { orderId: 'X' },
      user: { userId: 'U1' },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(OrderService, 'getById')
      .mockResolvedValue({ orderId: 'X', userId: 'OTHER' } as any);

    await OrderController.getSelfById(req as any, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });
});
