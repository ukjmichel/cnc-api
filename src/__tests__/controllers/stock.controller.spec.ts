/**
 * StockController — unit tests (pure Jest mocks, no DB)
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

import { StockController } from '../../controllers/stock.controller.js';
import { StockService } from '../../services/stock.service.js';
import * as StockQueries from '../../queries/stock.queries.js';
import { sequelize } from '../../db/sequelize.js';
import { BadRequestError } from '../../errors/index.js';

/* ----------------------------- helpers ----------------------------- */

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

const fakeTx: any = { LOCK: { UPDATE: 'UPDATE' } };

// Fully-typed lot JSON helper
function mkLot(overrides: Partial<Record<string, any>> = {}) {
  const now = new Date();
  return {
    stockId: `stk-${Math.random().toString(36).slice(2)}`,
    productId: 'P1',
    quantity: 0,
    unitPrice: null as number | null,
    location: 'A1',
    zone: null as string | null,
    expirationDate: null as string | null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ------------------------------- tests ------------------------------ */

describe('StockController.adjust', () => {
  test('200 → calls service in a transaction and returns result', async () => {
    const req = {
      body: {
        productId: 'P1',
        location: 'A1',
        quantityDelta: 5,
        unitPrice: 12.5,
      },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(sequelize, 'transaction')
      .mockImplementation(async (fn: any) => fn(fakeTx));
    const svcSpy = jest.spyOn(StockService, 'adjust').mockResolvedValue({
      lot: mkLot({ productId: 'P1', location: 'A1' }),
      finalQty: 10,
    } as any);

    await StockController.adjust(req, res, next);

    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(svcSpy).toHaveBeenCalledWith(req.body, fakeTx);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body?.data?.finalQty).toBe(10);
    expect(res.body?.data?.lot?.productId).toBe('P1');
    expect(res.body?.data?.lot?.location).toBe('A1');
    expect(next).not.toHaveBeenCalled();
  });

  test('400 → invalid quantityDelta (0) bubbles to next(BadRequestError)', async () => {
    const req = {
      body: { productId: 'P1', location: 'A1', quantityDelta: 0 },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await StockController.adjust(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(BadRequestError);
  });

  test('400 → missing productId bubbles to next(BadRequestError)', async () => {
    const req = {
      body: { productId: '', location: 'A1', quantityDelta: 1 },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await StockController.adjust(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('StockController.transfer', () => {
  test('200 → calls service in a transaction and returns result', async () => {
    const req = {
      body: {
        from: { productId: 'P1', location: 'A1' },
        to: { productId: 'P1', location: 'B1' },
        quantity: 3,
        unitPrice: 10,
      },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(sequelize, 'transaction')
      .mockImplementation(async (fn: any) => fn(fakeTx));
    const svcSpy = jest.spyOn(StockService, 'transfer').mockResolvedValue({
      from: { finalQty: 7, lot: mkLot({ productId: 'P1', location: 'A1' }) },
      to: { finalQty: 8, lot: mkLot({ productId: 'P1', location: 'B1' }) },
    } as any);

    await StockController.transfer(req, res, next);

    expect(sequelize.transaction).toHaveBeenCalled();
    expect(svcSpy).toHaveBeenCalledWith(req.body, fakeTx);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body?.data?.from?.finalQty).toBe(7);
    expect(res.body?.data?.to?.finalQty).toBe(8);
    expect(next).not.toHaveBeenCalled();
  });

  test('400 → missing from/to', async () => {
    const req = {
      body: { to: { productId: 'P1', location: 'B1' }, quantity: 1 },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await StockController.transfer(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });

  test('400 → non-positive quantity', async () => {
    const req = {
      body: {
        from: { productId: 'P1', location: 'A1' },
        to: { productId: 'P1', location: 'B1' },
        quantity: 0,
      },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await StockController.transfer(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('StockController.getOnHand', () => {
  test('200 → normalizes empty zone/expiration to null and returns number', async () => {
    const req = {
      query: { productId: 'P1', location: 'A1', zone: '', expirationDate: '' },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    const svcSpy = jest.spyOn(StockService, 'getOnHand').mockResolvedValue(42);

    await StockController.getOnHand(req, res, next);

    expect(svcSpy).toHaveBeenCalledWith({
      productId: 'P1',
      location: 'A1',
      zone: null,
      expirationDate: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body?.data?.onHand).toBe(42);
  });

  test('400 → missing productId', async () => {
    const req = {
      query: { productId: '', location: 'A1' },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await StockController.getOnHand(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('StockController.list', () => {
  test('200 → builds query with builder and returns meta mapping', async () => {
    const req = { query: { q: 'A1', page: '2' } } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    // Use the real builder (don’t spy on ESM namespace)
    const built = StockQueries.buildStockListQuery(req.query as any);

    const listSpy = jest.spyOn(StockService, 'list').mockResolvedValue({
      lots: [mkLot({ productId: 'P1' })],
      total: 25,
      page: built.page as number,
      pageSize: built.pageSize as number,
      pages: 3,
    });

    await StockController.list(req, res, next);

    expect(listSpy).toHaveBeenCalledWith(built);
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body?.data?.lots as any[]).map((x) => x.productId)).toEqual([
      'P1',
    ]);
    expect(res.body?.meta).toEqual({
      total: 25,
      page: built.page,
      pageSize: built.pageSize,
      pages: 3,
    });
  });
});

describe('StockController.filter', () => {
  test('200 → builds query with builder and returns meta mapping', async () => {
    const req = {
      query: { q: 'B1', filters: '{"location":["B1"]}' },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    // Use the real builder
    const built = StockQueries.buildStockFilterQuery(req.query as any);

    const filterSpy = jest.spyOn(StockService, 'filter').mockResolvedValue({
      lots: [mkLot({ productId: 'P2', location: 'B1' })],
      total: 5,
      page: built.page as number,
      pageSize: built.pageSize as number,
      pages: 1,
    });

    await StockController.filter(req, res, next);

    expect(filterSpy).toHaveBeenCalledWith(built);
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body?.data?.lots as any[]).map((x) => x.productId)).toEqual([
      'P2',
    ]);
    expect(res.body?.meta).toEqual({
      total: 5,
      page: built.page,
      pageSize: built.pageSize,
      pages: 1,
    });
  });
});

describe('StockController.lotsOfProduct', () => {
  test('200 → returns lots + meta(no pagination)', async () => {
    const req = { query: { productId: 'PX' } } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(StockService, 'listLots')
      .mockResolvedValue([
        mkLot({ productId: 'PX' }),
        mkLot({ productId: 'PX' }),
      ]);

    await StockController.lotsOfProduct(req, res, next);

    expect(StockService.listLots).toHaveBeenCalledWith({ productId: 'PX' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body?.data?.lots.length).toBe(2);
    expect(
      (res.body?.data?.lots as any[]).every((x) => x.productId === 'PX')
    ).toBe(true);
    expect(res.body?.meta).toEqual({
      total: 2,
      page: 1,
      pageSize: 2,
      pages: 1,
    });
  });

  test('400 → productId missing', async () => {
    const req = { query: { productId: '' } } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await StockController.lotsOfProduct(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('StockController.listSimple (legacy)', () => {
  test('200 → builds filters from query, slices manually with pagination', async () => {
    const req = {
      query: {
        productIds: 'A,B',
        zone: '',
        expirationDate: '',
        page: '2',
        pageSize: '2',
        location: 'WH1',
      },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    const rows = [
      mkLot({ productId: 'A' }),
      mkLot({ productId: 'B' }),
      mkLot({ productId: 'A' }),
      mkLot({ productId: 'B' }),
      mkLot({ productId: 'A' }),
    ];
    const svcSpy = jest.spyOn(StockService, 'listLots').mockResolvedValue(rows);

    await StockController.listSimple(req, res, next);

    // Filters constructed correctly
    expect(svcSpy).toHaveBeenCalledWith({
      productIds: ['A', 'B'],
      location: 'WH1',
      zone: null,
      expirationDate: null,
    });

    // Manual pagination: page=2, size=2 → items index 2 & 3
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body?.data?.lots as any[]).map((x) => x.productId)).toEqual([
      'A',
      'B',
    ]);
    expect(res.body?.meta).toEqual({
      total: 5,
      page: 2,
      pageSize: 2,
      pages: 3,
    });
  });
});

describe('StockController.rebuild', () => {
  test('200 → calls service in transaction and returns result', async () => {
    const req = {
      body: {
        productId: 'P1',
        location: 'A1',
        zone: null,
        expirationDate: null,
      },
    } as any as Request;
    const res = makeRes();
    const next = makeNext();

    jest
      .spyOn(sequelize, 'transaction')
      .mockImplementation(async (fn: any) => fn(fakeTx));
    const svcSpy = jest
      .spyOn(StockService, 'rebuildLotFromMovements')
      .mockResolvedValue({
        lot: mkLot({ productId: 'P1' }),
        movements: 3,
      } as any);

    await StockController.rebuild(req, res, next);

    expect(sequelize.transaction).toHaveBeenCalled();
    expect(svcSpy).toHaveBeenCalledWith(req.body, fakeTx);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body?.data?.movements).toBe(3);
    expect(res.body?.data?.lot?.productId).toBe('P1');
  });

  test('400 → missing productId', async () => {
    const req = { body: { productId: '', location: 'A1' } } as any as Request;
    const res = makeRes();
    const next = makeNext();

    await StockController.rebuild(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(
      BadRequestError
    );
  });
});
