/**
 * OrderItemService — unit tests (pure Jest mocks; no DB)
 * @jest-environment node
 */

import type { ListOrderItemsResult } from '../../types/order-item.js';

/* -------------------------------- helpers -------------------------------- */

function makeItemRow(state: Record<string, any>) {
  const s: Record<string, any> = { ...state };
  const row: any = {
    get: (k?: string) => (k ? s[k] : { ...s }),
    set: (k: any, v?: any) => {
      if (typeof k === 'string') s[k] = v;
      else Object.assign(s, k);
    },
    save: jest.fn(async () => ({ toJSON: () => ({ ...s }) })),
    toJSON: () => ({ ...s }),
  };
  for (const k of Object.keys(s)) {
    Object.defineProperty(row, k, {
      get: () => s[k],
      set: (v) => (s[k] = v),
      enumerable: true,
      configurable: true,
    });
  }
  return row;
}

function makeStockRow(state: Record<string, any>) {
  const s: Record<string, any> = {
    stockId: `S-${Math.random().toString(36).slice(2)}`,
    productId: `P-${Math.random().toString(36).slice(2)}`,
    quantity: '10.000',
    unitPrice: '2.00',
    location: 'WH1',
    zone: null,
    expirationDate: '2026-01-01',
    ...state,
  };
  const row: any = {
    get: (k?: string) => (k ? s[k] : { ...s }),
    set: (k: any, v?: any) => {
      if (typeof k === 'string') s[k] = v;
      else Object.assign(s, k);
    },
    save: jest.fn(async () => ({ toJSON: () => ({ ...s }) })),
    toJSON: () => ({ ...s }),
  };
  for (const k of Object.keys(s)) {
    Object.defineProperty(row, k, {
      get: () => s[k],
      set: (v) => (s[k] = v),
      enumerable: true,
      configurable: true,
    });
  }
  return row;
}

/* ---------------- Mock setup ---------------- */

const fakeTx: any = { LOCK: { UPDATE: 'UPDATE' } };
const mockTransaction = jest.fn(async (fn: any) => fn(fakeTx));

const filterOrderItemsMock = jest.fn<Promise<ListOrderItemsResult>, [any]>();

// Mock the modules
jest.mock('../../db/sequelize.js', () => ({
  sequelize: {
    transaction: mockTransaction,
  },
}));

jest.mock('../../queries/order-item.queries.js', () => ({
  filterOrderItems: filterOrderItemsMock,
}));

/* ---------------- Import after mocks ---------------- */

import { orderItemService } from '../../services/order-item.service.js';
import { OrderItemModel } from '../../models/order-item.model.js';
import { StockModel } from '../../models/stock.model.js';
import { StockMovementModel } from '../../models/stock-movement.model.js';
import { BadRequestError, NotFoundError } from '../../errors/index.js';

/* -------------------------------- lifecycle ------------------------------ */

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockTransaction.mockClear();
  mockTransaction.mockImplementation(async (fn: any) => fn(fakeTx));
  filterOrderItemsMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/* --------------------------------- tests --------------------------------- */

describe('validateStockAvailable', () => {
  test('succeeds when stock exists and has sufficient qty (with TX lock)', async () => {
    const stock = makeStockRow({ stockId: 'S1', quantity: '5.000' });
    const spy = jest
      .spyOn(StockModel, 'findByPk')
      .mockResolvedValue(stock as any);

    const out = await orderItemService.validateStockAvailable(
      'S1',
      '1.250',
      fakeTx
    );

    expect(spy).toHaveBeenCalledWith(
      'S1',
      expect.objectContaining({ transaction: fakeTx, lock: 'UPDATE' })
    );
    expect(out).toBe(stock);
  });

  test('throws NotFoundError when stock missing', async () => {
    jest.spyOn(StockModel, 'findByPk').mockResolvedValue(null as any);
    await expect(
      orderItemService.validateStockAvailable('NOPE', '1.000', fakeTx)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('throws BadRequestError when insufficient on-hand', async () => {
    const stock = makeStockRow({ stockId: 'S1', quantity: '0.500' });
    jest.spyOn(StockModel, 'findByPk').mockResolvedValue(stock as any);
    await expect(
      orderItemService.validateStockAvailable('S1', '0.750', fakeTx)
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('deductAndMove', () => {
  test('decreases stock.quantity (3dp), saves, and writes OUT movement snapshot', async () => {
    const stock = makeStockRow({
      stockId: 'S1',
      productId: 'P1',
      quantity: '10.000',
      unitPrice: '3.25',
      location: 'WH9',
      zone: 'A1',
      expirationDate: '2027-12-31',
    });

    const mvSpy = jest
      .spyOn(StockMovementModel, 'create')
      .mockImplementation(async () => ({} as any));

    await orderItemService.deductAndMove(
      stock as any,
      'ORD-1',
      '1.250',
      fakeTx
    );

    // 10 - 1.250 = 8.750
    expect(Number(stock.quantity)).toBeCloseTo(8.75, 3);
    expect((stock as any).save).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: fakeTx })
    );

    expect(mvSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stockId: 'S1',
        productId: 'P1',
        quantityDelta: -1.25,
        reason: 'out',
        reference: 'order:ORD-1',
        location: 'WH9',
        zone: 'A1',
        expirationDate: '2027-12-31',
        unitPrice: '3.25',
        performedAt: expect.any(Date),
      }),
      expect.objectContaining({ transaction: fakeTx })
    );
  });
});

describe('create', () => {
  test('creates new line when none exists (defaults unitPrice to stock.unitPrice, rounds qty 3dp, lineTotal qty×price)', async () => {
    const stock = makeStockRow({
      stockId: 'S1',
      productId: 'P1',
      quantity: '5.000',
      unitPrice: '2.00',
    });

    jest.spyOn(StockModel, 'findByPk').mockResolvedValue(stock as any);
    jest.spyOn(OrderItemModel, 'findOne').mockResolvedValue(null as any);

    const created = {
      orderId: 'ORD-1',
      stockId: 'S1',
      quantity: '1.250',
      unitPrice: '2.00',
      lineTotal: '2.50',
    };
    jest
      .spyOn(OrderItemModel, 'create')
      .mockResolvedValue(makeItemRow(created) as any);

    const moveSpy = jest
      .spyOn(orderItemService as any, 'deductAndMove')
      .mockImplementation(async () => undefined);

    const out = await orderItemService.create({
      orderId: 'ORD-1',
      stockId: 'S1',
      quantity: '1.25', // → '1.250'
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(moveSpy).toHaveBeenCalled();

    expect(OrderItemModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'ORD-1', stockId: 'S1' },
        transaction: fakeTx,
        lock: 'UPDATE',
      })
    );
    expect(OrderItemModel.create).toHaveBeenCalledWith(
      {
        orderId: 'ORD-1',
        stockId: 'S1',
        quantity: '1.250',
        unitPrice: '2.00',
        lineTotal: '2.50',
      },
      expect.objectContaining({ transaction: fakeTx })
    );

    expect(out).toEqual(created);
  });

  test('merges with existing line (adds qty, respects unitPrice override, recomputes lineTotal)', async () => {
    const stock = makeStockRow({
      stockId: 'S1',
      quantity: '9.000',
      unitPrice: '5.00',
    });
    jest.spyOn(StockModel, 'findByPk').mockResolvedValue(stock as any);

    const existing = makeItemRow({
      orderId: 'ORD-1',
      stockId: 'S1',
      quantity: '1.000',
      unitPrice: '5.00',
      lineTotal: '5.00',
    });
    jest.spyOn(OrderItemModel, 'findOne').mockResolvedValue(existing as any);

    jest
      .spyOn(orderItemService as any, 'deductAndMove')
      .mockImplementation(async () => undefined);

    const out = await orderItemService.create({
      orderId: 'ORD-1',
      stockId: 'S1',
      quantity: '0.500',
      unitPrice: '4.00', // override
    });

    expect(existing.save).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: fakeTx })
    );
    expect(out.quantity).toBe('1.500');
    expect(out.unitPrice).toBe('4.00');
    expect(out.lineTotal).toBe('6.00');
  });

  test('missing orderId or stockId → BadRequestError', async () => {
    await expect(
      orderItemService.create({
        orderId: '',
        stockId: 'S1',
        quantity: '1',
      } as any)
    ).rejects.toBeInstanceOf(BadRequestError);

    await expect(
      orderItemService.create({
        orderId: 'O1',
        stockId: '',
        quantity: '1',
      } as any)
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('createMany', () => {
  test('creates two new lines atomically (pre-validates all, deducts each, returns results)', async () => {
    const s1 = makeStockRow({
      stockId: 'S1',
      quantity: '10.000',
      unitPrice: '2.00',
    });
    const s2 = makeStockRow({
      stockId: 'S2',
      quantity: '10.000',
      unitPrice: '3.00',
    });

    const valSpy = jest
      .spyOn(orderItemService as any, 'validateStockAvailable')
      .mockResolvedValueOnce(s1 as any)
      .mockResolvedValueOnce(s2 as any);

    const moveSpy = jest
      .spyOn(orderItemService as any, 'deductAndMove')
      .mockImplementation(async () => undefined);

    jest.spyOn(OrderItemModel, 'findOne').mockResolvedValue(null as any);

    const c1 = makeItemRow({
      orderId: 'O1',
      stockId: 'S1',
      quantity: '1.000',
      unitPrice: '2.00',
      lineTotal: '2.00',
    });
    const c2 = makeItemRow({
      orderId: 'O1',
      stockId: 'S2',
      quantity: '0.500',
      unitPrice: '3.00',
      lineTotal: '1.50',
    });

    const createSpy = jest
      .spyOn(OrderItemModel, 'create')
      .mockResolvedValueOnce(c1 as any)
      .mockResolvedValueOnce(c2 as any);

    const out = await orderItemService.createMany([
      { orderId: 'O1', stockId: 'S1', quantity: '1.000' },
      { orderId: 'O1', stockId: 'S2', quantity: '0.500' },
    ]);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(valSpy).toHaveBeenCalledTimes(2);
    expect(moveSpy).toHaveBeenCalledTimes(2);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(out).toEqual([c1.toJSON(), c2.toJSON()]);
  });

  test('merges when same (orderId, stockId) appears twice in payload', async () => {
    const stock = makeStockRow({
      stockId: 'S1',
      quantity: '10.000',
      unitPrice: '2.00',
    });
    jest
      .spyOn(orderItemService as any, 'validateStockAvailable')
      .mockResolvedValue(stock as any);
    jest
      .spyOn(orderItemService as any, 'deductAndMove')
      .mockImplementation(async () => undefined);

    const created = makeItemRow({
      orderId: 'O1',
      stockId: 'S1',
      quantity: '1.000',
      unitPrice: '2.00',
      lineTotal: '2.00',
    });
    const existing = makeItemRow({
      orderId: 'O1',
      stockId: 'S1',
      quantity: '1.000',
      unitPrice: '2.00',
      lineTotal: '2.00',
    });

    const findOneSpy = jest
      .spyOn(OrderItemModel, 'findOne')
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(existing as any);

    jest.spyOn(OrderItemModel, 'create').mockResolvedValue(created as any);

    const out = await orderItemService.createMany([
      { orderId: 'O1', stockId: 'S1', quantity: '1.000' },
      { orderId: 'O1', stockId: 'S1', quantity: '0.500' },
    ]);

    expect(findOneSpy).toHaveBeenCalledTimes(2);
    expect(existing.save).toHaveBeenCalled();
    expect(out[1].quantity).toBe('1.500');
    expect(out[1].lineTotal).toBe('3.00');
  });

  test('empty array → BadRequestError', async () => {
    await expect(orderItemService.createMany([] as any)).rejects.toBeInstanceOf(
      BadRequestError
    );
  });
});

describe('getOne', () => {
  test('returns item when found', async () => {
    const row = makeItemRow({
      orderId: 'O1',
      stockId: 'S1',
      quantity: '1.000',
      unitPrice: '2.00',
      lineTotal: '2.00',
    });
    jest.spyOn(OrderItemModel, 'findOne').mockResolvedValue(row as any);

    const out = await orderItemService.getOne('O1', 'S1');
    expect(out.orderId).toBe('O1');
    expect(out.stockId).toBe('S1');
  });

  test('missing → NotFoundError', async () => {
    jest.spyOn(OrderItemModel, 'findOne').mockResolvedValue(null as any);
    await expect(orderItemService.getOne('O1', 'S1')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('update', () => {
  test('patches quantity and unitPrice, recomputes lineTotal, saves', async () => {
    const row = makeItemRow({
      orderId: 'O1',
      stockId: 'S1',
      quantity: '1.000',
      unitPrice: '2.00',
      lineTotal: '2.00',
    });
    jest.spyOn(OrderItemModel, 'findOne').mockResolvedValue(row as any);

    const out = await orderItemService.update('O1', 'S1', {
      quantity: '2.500',
      unitPrice: '3.00',
    });

    expect(row.save).toHaveBeenCalled();
    expect(out.quantity).toBe('2.500');
    expect(out.unitPrice).toBe('3.00');
    expect(out.lineTotal).toBe('7.50');
  });

  test('missing → NotFoundError', async () => {
    jest.spyOn(OrderItemModel, 'findOne').mockResolvedValue(null as any);
    await expect(
      orderItemService.update('O1', 'S1', { quantity: '1.000' })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('remove', () => {
  test('returns { deleted: true } when destroy count > 0', async () => {
    jest.spyOn(OrderItemModel, 'destroy').mockResolvedValue(1 as any);
    const out = await orderItemService.remove('O1', 'S1');
    expect(OrderItemModel.destroy).toHaveBeenCalledWith({
      where: { orderId: 'O1', stockId: 'S1' },
    });
    expect(out).toEqual({ deleted: true });
  });

  test('missing → NotFoundError', async () => {
    jest.spyOn(OrderItemModel, 'destroy').mockResolvedValue(0 as any);
    await expect(orderItemService.remove('O1', 'S1')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('filter & listByOrder (delegates to query layer)', () => {
  test('filter → calls filterOrderItems and returns result', async () => {
    filterOrderItemsMock.mockResolvedValueOnce({
      items: [{ orderId: 'O1', stockId: 'S1' }] as any,
      total: 1,
      page: 1,
      pageSize: 20,
      pages: 1,
    });

    const out = await orderItemService.filter({
      page: 1,
      pageSize: 20,
      orderBy: 'createdAt',
      orderDir: 'desc',
    });

    expect(filterOrderItemsMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 })
    );
    expect(out.total).toBe(1);
  });

  test('listByOrder → injects orderId into filters and delegates', async () => {
    filterOrderItemsMock.mockResolvedValueOnce({
      items: [{ orderId: 'O9', stockId: 'S9' }] as any,
      total: 1,
      page: 1,
      pageSize: 10,
      pages: 1,
    });

    const out = await orderItemService.listByOrder('O9', {
      page: 1,
      pageSize: 10,
      filters: { stockId: 'S9' },
    });

    expect(filterOrderItemsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ orderId: 'O9', stockId: 'S9' }),
        page: 1,
        pageSize: 10,
      })
    );
    expect(out.items[0].orderId).toBe('O9');
  });
});
