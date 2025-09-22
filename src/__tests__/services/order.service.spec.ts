/**
 * OrderService — unit tests (pure Jest mocks; no DB)
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
import { Op } from 'sequelize';

/* ---------------- ESM-safe mocks (MUST be before importing SUT) ---------------- */

const fakeTx: any = { LOCK: { UPDATE: 'UPDATE' } };
// @ts-ignore
jest.unstable_mockModule('../../utils/tx.js', () => ({
  withTransaction: async (fn: any) => fn(fakeTx),
}));

// Strongly type the filterOrders mock so mockResolvedValueOnce accepts your object
type FilterOrdersResult = {
  orders: Array<{ orderId: string }>;
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};
type FilterOrdersFn = (q: any) => Promise<FilterOrdersResult>;

const filterOrdersMock = jest.fn() as jest.MockedFunction<FilterOrdersFn>;
// @ts-ignore
jest.unstable_mockModule('../../queries/order.queries.js', () => ({
  filterOrders: filterOrdersMock,
}));

/* ---------------- Import SUT and models AFTER the mocks ---------------- */

const { OrderService } = await import('../../services/order.service.js');
const { OrderModel } = await import('../../models/order.model.js');
const { PickupSlotModel } = await import('../../models/pickup-slot.model.js');

import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../errors/index.js';

/* -------------------------------- helpers -------------------------------- */

function makeOrder(overrides: Partial<Record<string, any>> = {}) {
  const now = new Date();
  const state: any = {
    orderId: `ord-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    userId: null as string | null,
    status: 'pending',
    subtotal: '0.00',
    taxTotal: '0.00',
    grandTotal: '0.00',
    currency: 'USD',
    contactName: null as string | null,
    contactPhone: null as string | null,
    notes: null as string | null,
    pickupSlotId: null as string | null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  const row: any = {
    get: (k?: string) => (k ? state[k] : { ...state }),
    set: (patch: any, v?: any) => {
      if (typeof patch === 'string') state[patch] = v;
      else Object.assign(state, patch);
    },
    save: jest.fn(async () => {
      state.updatedAt = new Date();
      return undefined;
    }),
    reload: jest.fn(async () => row),
    destroy: jest.fn(async () => undefined),
    toJSON: () => ({ ...state }),
  };

  for (const k of Object.keys(state)) {
    Object.defineProperty(row, k, {
      get: () => state[k],
      set: (v) => (state[k] = v),
      enumerable: true,
      configurable: true,
    });
  }
  return row;
}

function makeSlot(overrides: Partial<Record<string, any>> = {}) {
  const state: any = {
    slotId: `slot-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    capacity: 5,
    reservedCount: 0,
    startTime: new Date(),
    endTime: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };

  const row: any = {
    get: (k?: string) => (k ? state[k] : { ...state }),
    set: (patch: any, v?: any) => {
      if (typeof patch === 'string') state[patch] = v;
      else Object.assign(state, patch);
    },
    save: jest.fn(async () => {
      state.updatedAt = new Date();
      return undefined;
    }),
    toJSON: () => ({ ...state }),
  };

  for (const k of Object.keys(state)) {
    Object.defineProperty(row, k, {
      get: () => state[k],
      set: (v) => (state[k] = v),
      enumerable: true,
      configurable: true,
    });
  }
  return row;
}

/* -------------------------------- lifecycle ------------------------------ */

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  filterOrdersMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/* --------------------------------- tests --------------------------------- */

describe('create', () => {
  test('creates pending order with defaults (no slot)', async () => {
    const created = makeOrder({ status: 'pending' });
    const createSpy = jest
      .spyOn(OrderModel, 'create')
      .mockResolvedValue(created as any);

    const out = await OrderService.create({});

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        status: 'pending',
        subtotal: '0',
        taxTotal: '0',
        grandTotal: '0',
        currency: 'USD',
        pickupSlotId: null,
      }),
      expect.objectContaining({ transaction: fakeTx })
    );
    expect(out.status).toBe('pending');
  });

  test('invalid status → BadRequestError', async () => {
    await expect(
      OrderService.create({ status: 'nope' as any })
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('with pickupSlotId and consuming status → _assignSlot(enforceCapacity=true)', async () => {
    const created = makeOrder({ status: 'pending' });
    jest.spyOn(OrderModel, 'create').mockResolvedValue(created as any);

    const assignSpy = jest
      .spyOn(OrderService as any, '_assignSlot')
      .mockResolvedValue(undefined);

    await OrderService.create({ status: 'pending', pickupSlotId: 'S1' });

    expect(assignSpy).toHaveBeenCalledWith(created, 'S1', true, fakeTx);
  });

  test('with pickupSlotId and non-consuming status → _assignSlot(enforceCapacity=false)', async () => {
    const created = makeOrder({ status: 'draft' });
    jest.spyOn(OrderModel, 'create').mockResolvedValue(created as any);

    const assignSpy = jest
      .spyOn(OrderService as any, '_assignSlot')
      .mockResolvedValue(undefined);

    await OrderService.create({ status: 'draft', pickupSlotId: 'S1' });

    expect(assignSpy).toHaveBeenCalledWith(created, 'S1', false, fakeTx);
  });
});

describe('getById', () => {
  test('found → returns toJSON', async () => {
    const row = makeOrder({ status: 'paid' });
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(row as any);

    const out = await OrderService.getById(row.orderId);
    expect(out.orderId).toBe(row.orderId);
    expect(out.status).toBe('paid');
  });

  test('missing → NotFoundError', async () => {
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);
    await expect(OrderService.getById('nope')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('list', () => {
  test('paging + sort + filters → findAndCountAll args composed correctly', async () => {
    const rows = [makeOrder(), makeOrder()];
    const facSpy = jest
      .spyOn(OrderModel, 'findAndCountAll')
      .mockResolvedValue({ rows: rows as any, count: 42 } as any);

    const res = await OrderService.list({
      page: 2,
      pageSize: 10,
      orderBy: 'grandTotal',
      orderDir: 'ASC',
      filters: {
        userId: 'u1',
        status: ['paid', 'pending'],
        pickupSlotId: null,
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      },
    });

    expect(facSpy).toHaveBeenCalledTimes(1);
    const [[arg]] = facSpy.mock.calls as unknown as [[any]];

    expect(arg.limit).toBe(10);
    expect(arg.offset).toBe(10);
    expect(arg.order).toEqual([['grandTotal', 'ASC']]);

    const topSyms = Object.getOwnPropertySymbols(arg.where ?? {});
    expect(topSyms).toContain(Op.and);
    const parts = arg.where[Op.and] as any[];

    expect(parts.some((p) => p?.userId === 'u1')).toBe(true);

    const statusPart = parts.find((p) => p?.status);
    const statusSyms = Object.getOwnPropertySymbols(statusPart?.status ?? {});
    expect(statusSyms).toContain(Op.in);

    expect(parts.some((p) => p?.pickupSlotId === null)).toBe(true);

    const created = parts.find((p) => p?.createdAt);
    const createdSyms = Object.getOwnPropertySymbols(created?.createdAt ?? {});
    expect(createdSyms).toEqual(expect.arrayContaining([Op.gte, Op.lte]));

    expect(res.total).toBe(42);
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(10);
    expect(res.pages).toBe(Math.ceil(42 / 10));
    expect(res.orders).toEqual(rows.map((r) => r.toJSON()));
  });
});

describe('filter (delegates to query)', () => {
  test('calls filterOrders and returns its result', async () => {
    filterOrdersMock.mockResolvedValueOnce({
      orders: [{ orderId: 'x' }],
      total: 1,
      page: 1,
      pageSize: 20,
      pages: 1,
    });

    const out = await OrderService.filter({
      page: 1,
      pageSize: 20,
      includeItems: true,
    } as any);

    expect(filterOrdersMock).toHaveBeenCalledWith(
      expect.objectContaining({ includeItems: true })
    );
    expect(out.total).toBe(1);
    expect(out.orders[0].orderId).toBe('x');
  });
});

describe('updateTotals', () => {
  test('updates decimal-string totals and saves', async () => {
    const o = makeOrder({ status: 'pending', subtotal: '1.00' });
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);

    const out = await OrderService.updateTotals(o.orderId, {
      subtotal: '10.50',
      taxTotal: '0.84',
      grandTotal: '11.34',
      currency: 'USD',
    });

    expect(o.save).toHaveBeenCalled();
    expect(out.subtotal).toBe('10.50');
    expect(out.taxTotal).toBe('0.84');
    expect(out.grandTotal).toBe('11.34');
  });

  test('missing → NotFoundError', async () => {
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);
    await expect(
      OrderService.updateTotals('nope', {
        subtotal: '1',
        taxTotal: '0',
        grandTotal: '1',
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateContact', () => {
  test('patches contact fields', async () => {
    const o = makeOrder({});
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);

    const out = await OrderService.updateContact(o.orderId, {
      contactName: ' Alice ',
      contactPhone: ' 555-0000 ',
      notes: ' please ring ',
    });

    expect(o.save).toHaveBeenCalled();
    expect(out.contactName).toBe(' Alice ');
    expect(out.contactPhone).toBe(' 555-0000 ');
    expect(out.notes).toContain('ring');
  });

  test('missing → NotFoundError', async () => {
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);
    await expect(OrderService.updateContact('nope', {})).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('changeStatus (capacity sync)', () => {
  test('draft → pending with slot → reserves +1 (capacity ok)', async () => {
    const o = makeOrder({ status: 'draft', pickupSlotId: 'S1' });
    const slot = makeSlot({ slotId: 'S1', capacity: 2, reservedCount: 1 });

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);
    const findSlot = jest
      .spyOn(PickupSlotModel, 'findByPk')
      .mockResolvedValue(slot as any);

    const out = await OrderService.changeStatus(o.orderId, 'pending');

    expect(findSlot).toHaveBeenCalledWith(
      'S1',
      expect.objectContaining({ transaction: fakeTx, lock: fakeTx.LOCK.UPDATE })
    );
    expect(slot.get('reservedCount')).toBe(2);
    expect(out.status).toBe('pending');
  });

  test('pending → cancelled with slot → releases -1', async () => {
    const o = makeOrder({ status: 'pending', pickupSlotId: 'S1' });
    const slot = makeSlot({ slotId: 'S1', capacity: 3, reservedCount: 2 });

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);
    const findSlot = jest
      .spyOn(PickupSlotModel, 'findByPk')
      .mockResolvedValue(slot as any);

    const out = await OrderService.changeStatus(o.orderId, 'cancelled');

    expect(findSlot).toHaveBeenCalled();
    expect(slot.get('reservedCount')).toBe(1);
    expect(out.status).toBe('cancelled');
  });

  test('invalid new status → BadRequestError', async () => {
    await expect(
      OrderService.changeStatus('x', 'nope' as any)
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('consuming → consuming (no boundary cross) does not touch slot', async () => {
    const o = makeOrder({ status: 'pending', pickupSlotId: 'S1' });

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);
    jest
      .spyOn(PickupSlotModel, 'findByPk')
      .mockResolvedValue(makeSlot({ slotId: 'S1' }) as any);

    const out = await OrderService.changeStatus(o.orderId, 'paid');
    expect(out.status).toBe('paid');
  });

  test('reserve would exceed capacity → ConflictError', async () => {
    const o = makeOrder({ status: 'draft', pickupSlotId: 'S1' });
    const slot = makeSlot({ slotId: 'S1', capacity: 1, reservedCount: 1 });

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);
    jest.spyOn(PickupSlotModel, 'findByPk').mockResolvedValue(slot as any);

    await expect(
      OrderService.changeStatus(o.orderId, 'pending')
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('setPickupSlot', () => {
  test('no change (same id) → returns current JSON', async () => {
    const o = makeOrder({ pickupSlotId: 'S1', status: 'pending' });
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);

    const out = await OrderService.setPickupSlot(o.orderId, 'S1');
    expect(out.pickupSlotId).toBe('S1');
  });

  test('assign from null while consuming → reserves +1', async () => {
    const o = makeOrder({ pickupSlotId: null, status: 'pending' });
    const slot = makeSlot({ slotId: 'S2', capacity: 2, reservedCount: 1 });

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);
    jest.spyOn(PickupSlotModel, 'findByPk').mockResolvedValue(slot as any);

    const out = await OrderService.setPickupSlot(o.orderId, 'S2');

    expect(slot.get('reservedCount')).toBe(2);
    expect(out.pickupSlotId).toBe('S2');
  });

  test('switch while consuming → release old (-1) then reserve new (+1)', async () => {
    const o = makeOrder({ pickupSlotId: 'A', status: 'pending' });
    const slotOld = makeSlot({ slotId: 'A', capacity: 3, reservedCount: 2 });
    const slotNew = makeSlot({ slotId: 'B', capacity: 3, reservedCount: 1 });

    const findPk = jest
      .spyOn(OrderModel, 'findByPk')
      .mockResolvedValue(o as any);

    const slotSpy = jest
      .spyOn(PickupSlotModel, 'findByPk')
      .mockResolvedValueOnce(slotOld as any)
      .mockResolvedValueOnce(slotNew as any)
      .mockResolvedValueOnce(slotNew as any);

    const out = await OrderService.setPickupSlot(o.orderId, 'B');

    expect(findPk).toHaveBeenCalledWith(
      o.orderId,
      expect.objectContaining({ transaction: fakeTx, lock: fakeTx.LOCK.UPDATE })
    );
    expect(slotOld.get('reservedCount')).toBe(1);
    expect(slotNew.get('reservedCount')).toBe(2);
    expect(out.pickupSlotId).toBe('B');
  });

  test('unassign while consuming → releases -1', async () => {
    const o = makeOrder({ pickupSlotId: 'S3', status: 'pending' });
    const slot = makeSlot({ slotId: 'S3', capacity: 4, reservedCount: 2 });

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);
    jest.spyOn(PickupSlotModel, 'findByPk').mockResolvedValue(slot as any);

    const out = await OrderService.setPickupSlot(o.orderId, null);

    expect(slot.get('reservedCount')).toBe(1);
    expect(out.pickupSlotId).toBe(null);
  });

  test('assign while non-consuming → does NOT bump reserved', async () => {
    const o = makeOrder({ pickupSlotId: null, status: 'draft' });
    const slot = makeSlot({ slotId: 'S4', capacity: 1, reservedCount: 1 });

    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);
    jest.spyOn(PickupSlotModel, 'findByPk').mockResolvedValue(slot as any);

    const out = await OrderService.setPickupSlot(o.orderId, 'S4');

    expect(slot.get('reservedCount')).toBe(1);
    expect(out.pickupSlotId).toBe('S4');
  });

  test('missing order → NotFoundError', async () => {
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);
    await expect(
      OrderService.setPickupSlot('nope', 'S1')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('assign to non-existent slot → NotFoundError', async () => {
    const o = makeOrder({ status: 'pending' });
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);
    jest.spyOn(PickupSlotModel, 'findByPk').mockResolvedValue(null as any);

    await expect(
      OrderService.setPickupSlot(o.orderId, 'missing')
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('remove', () => {
  test('consuming with slot → releases -1 then destroys', async () => {
    const o = makeOrder({ status: 'pending', pickupSlotId: 'S1' });
    const slot = makeSlot({ slotId: 'S1', capacity: 3, reservedCount: 2 });

    const findOrder = jest
      .spyOn(OrderModel, 'findByPk')
      .mockResolvedValue(o as any);
    const findSlot = jest
      .spyOn(PickupSlotModel, 'findByPk')
      .mockResolvedValue(slot as any);

    const out = await OrderService.remove(o.orderId);

    expect(findOrder).toHaveBeenCalledWith(
      o.orderId,
      expect.objectContaining({ transaction: fakeTx, lock: fakeTx.LOCK.UPDATE })
    );
    expect(findSlot).toHaveBeenCalled();
    expect(slot.get('reservedCount')).toBe(1);
    expect(o.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: fakeTx })
    );
    expect(out).toEqual({ deleted: true });
  });

  test('non-consuming or no slot → just destroy', async () => {
    const o = makeOrder({ status: 'draft', pickupSlotId: null });
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(o as any);
    const slotSpy = jest
      .spyOn(PickupSlotModel, 'findByPk')
      .mockResolvedValue(makeSlot() as any);

    const out = await OrderService.remove(o.orderId);
    expect(slotSpy).not.toHaveBeenCalled();
    expect(o.destroy).toHaveBeenCalled();
    expect(out.deleted).toBe(true);
  });

  test('missing → NotFoundError', async () => {
    jest.spyOn(OrderModel, 'findByPk').mockResolvedValue(null as any);
    await expect(OrderService.remove('nope')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
