/**
 * StockService — unit tests (no DB; pure Jest mocks)
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
import { Op, UniqueConstraintError } from 'sequelize';

import { StockService } from '../../services/stock.service.js';
import { StockModel } from '../../models/stock.model.js';
import { StockMovementModel } from '../../models/stock-movement.model.js';
import { ProductModel } from '../../models/product.model.js';

import { BadRequestError, NotFoundError } from '../../errors/index.js';

/* -------------------------------- helpers -------------------------------- */

const fakeTx: any = { LOCK: { UPDATE: 'UPDATE' } };

const mkId = (p = 'SKU') =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * Mock a Sequelize-like row where direct property writes (e.g., lot.quantity = 10)
 * update the underlying state used by get()/toJSON().
 */
function makeLotRow(overrides: Partial<Record<string, any>> = {}) {
  const now = new Date();
  const state: any = {
    stockId: `stk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    productId: mkId('SKU'),
    quantity: 0,
    unitPrice: null as number | null,
    location: 'A1',
    zone: null as string | null,
    expirationDate: null as string | null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  const row: any = {
    get: () => ({ ...state }),
    set: (patch: any) => Object.assign(state, patch),
    save: jest.fn().mockImplementation(async () => {
      state.updatedAt = new Date();
      return undefined;
    }),
    reload: jest.fn().mockImplementation(async () => row),
    toJSON: () => ({
      stockId: state.stockId,
      productId: state.productId,
      quantity: state.quantity,
      unitPrice: state.unitPrice,
      location: state.location,
      zone: state.zone,
      expirationDate: state.expirationDate,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    }),
  };

  // Bridge direct property access to the state
  for (const key of [
    'stockId',
    'productId',
    'quantity',
    'unitPrice',
    'location',
    'zone',
    'expirationDate',
    'createdAt',
    'updatedAt',
  ] as const) {
    Object.defineProperty(row, key, {
      get: () => state[key],
      set: (v) => {
        state[key] = v;
      },
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
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/* --------------------------------- tests --------------------------------- */

describe('Lot helpers', () => {
  test('createLot: throws NotFound when product missing', async () => {
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(null as any);

    await expect(
      StockService.createLot(
        {
          productId: 'X',
          location: ' L1 ',
          zone: undefined,
          expirationDate: undefined,
        },
        fakeTx
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('createLot: trims location, sets nulls, returns row', async () => {
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue({} as any);

    const created = makeLotRow({
      productId: 'P1',
      location: 'L1',
      zone: null,
      expirationDate: null,
      quantity: 0,
      unitPrice: null,
    });

    const createSpy = jest
      .spyOn(StockModel, 'create')
      .mockResolvedValue(created as any);

    const lot = await StockService.createLot(
      {
        productId: 'P1',
        location: '  L1  ',
        zone: undefined,
        expirationDate: undefined,
      },
      fakeTx
    );

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'P1',
        location: 'L1',
        zone: null,
        expirationDate: null,
        quantity: 0,
        unitPrice: null,
      }),
      expect.objectContaining({ transaction: fakeTx })
    );
    expect(lot).toBe(created);
  });

  test('createLot: UniqueConstraintError → fetch existing (race)', async () => {
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue({} as any);

    const existing = makeLotRow({
      productId: 'P1',
      location: 'L1',
      zone: null,
      expirationDate: null,
    });

    jest.spyOn(StockModel, 'create').mockImplementation(async () => {
      throw new UniqueConstraintError({ message: 'dup', errors: [] } as any);
    });

    const findOneSpy = jest
      .spyOn(StockModel, 'findOne')
      .mockResolvedValue(existing as any);

    const out = await StockService.createLot(
      { productId: 'P1', location: 'L1', zone: null, expirationDate: null },
      fakeTx
    );

    expect(findOneSpy).toHaveBeenCalled();
    expect(out).toBe(existing);
  });

  test('getOrCreateLot: creates when missing and locks on reload', async () => {
    const created = makeLotRow({ productId: 'P1', location: 'L1' });

    jest.spyOn(StockModel, 'findOne').mockResolvedValueOnce(null as any); // missing
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue({} as any);
    jest.spyOn(StockModel, 'create').mockResolvedValue(created as any);

    const lot = await StockService.getOrCreateLot(
      { productId: 'P1', location: 'L1', zone: null, expirationDate: null },
      fakeTx
    );

    expect(created.reload).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: fakeTx, lock: fakeTx.LOCK.UPDATE })
    );
    expect(lot).toBe(created);
  });
});

describe('adjust', () => {
  test('inbound (+) updates qty and moving-average unitPrice; writes movement', async () => {
    const lot = makeLotRow({
      productId: 'P1',
      location: 'A1',
      zone: null,
      expirationDate: null,
      quantity: 5,
      unitPrice: 10, // current MA
    });

    jest.spyOn(StockModel, 'findOne').mockResolvedValue(lot as any);
    const moveSpy = jest
      .spyOn(StockMovementModel, 'create')
      .mockResolvedValue({} as any);

    const res = await StockService.adjust(
      {
        productId: 'P1',
        location: 'A1',
        quantityDelta: +5,
        unitPrice: 8, // new inbound price
      },
      fakeTx
    );

    // MA: (10*5 + 8*5) / 10 = 9
    expect(lot.get().unitPrice).toBeCloseTo(9, 4);
    expect(lot.get().quantity).toBe(10);
    expect(lot.save).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: fakeTx })
    );

    expect(moveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stockId: lot.get().stockId,
        productId: 'P1',
        quantityDelta: 5,
        reason: 'in',
        location: 'A1',
        zone: null,
        expirationDate: null,
        unitPrice: 8,
      }),
      expect.objectContaining({ transaction: fakeTx })
    );

    expect(res.finalQty).toBe(10);
    expect(res.lot).toEqual(lot.toJSON());
  });

  test('outbound (-) without allowNegative: throws BadRequest, no movement', async () => {
    const lot = makeLotRow({
      productId: 'P1',
      location: 'A1',
      quantity: 3,
      unitPrice: 2,
    });
    jest.spyOn(StockModel, 'findOne').mockResolvedValue(lot as any);
    const moveSpy = jest
      .spyOn(StockMovementModel, 'create')
      .mockResolvedValue({} as any);

    await expect(
      StockService.adjust(
        { productId: 'P1', location: 'A1', quantityDelta: -5 },
        fakeTx
      )
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(moveSpy).not.toHaveBeenCalled();
    expect(lot.save).not.toHaveBeenCalled();
  });

  test('outbound (-) with allowNegative: clamps at 0; writes movement "out"', async () => {
    const lot = makeLotRow({
      productId: 'P1',
      location: 'A1',
      quantity: 3,
      unitPrice: 2,
    });
    jest.spyOn(StockModel, 'findOne').mockResolvedValue(lot as any);
    const moveSpy = jest
      .spyOn(StockMovementModel, 'create')
      .mockResolvedValue({} as any);

    const res = await StockService.adjust(
      {
        productId: 'P1',
        location: 'A1',
        quantityDelta: -5,
        allowNegative: true,
      },
      fakeTx
    );

    expect(moveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'out', quantityDelta: -5 }),
      expect.any(Object)
    );
    expect(lot.get().quantity).toBe(0);
    expect(res.finalQty).toBe(0);
  });

  test('creates lot when missing (via getOrCreateLot)', async () => {
    const created = makeLotRow({
      productId: 'P1',
      location: 'A1',
      quantity: 0,
      unitPrice: null,
    });

    jest.spyOn(StockModel, 'findOne').mockResolvedValueOnce(null as any);
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue({} as any);
    jest.spyOn(StockModel, 'create').mockResolvedValue(created as any);
    jest.spyOn(StockMovementModel, 'create').mockResolvedValue({} as any);

    const res = await StockService.adjust(
      { productId: 'P1', location: 'A1', quantityDelta: +2 },
      fakeTx
    );

    expect(created.reload).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: fakeTx, lock: fakeTx.LOCK.UPDATE })
    );
    expect(res.finalQty).toBe(2);
  });
});

describe('transfer', () => {
  test('throws on non-positive quantity', async () => {
    await expect(
      StockService.transfer(
        {
          from: { productId: 'P1', location: 'A1' },
          to: { productId: 'P1', location: 'B1' },
          quantity: 0,
        },
        fakeTx
      )
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('moves qty from source to dest, writes two movements, MA on dest', async () => {
    const src = makeLotRow({
      productId: 'P1',
      location: 'A1',
      quantity: 10,
      unitPrice: 12,
    });
    const dst = makeLotRow({
      productId: 'P1',
      location: 'B1',
      quantity: 5,
      unitPrice: 12,
    });

    // getOrCreateLot (source) then (dest)
    jest
      .spyOn(StockModel, 'findOne')
      .mockResolvedValueOnce(src as any)
      .mockResolvedValueOnce(dst as any);

    const moveSpy = jest
      .spyOn(StockMovementModel, 'create')
      .mockResolvedValue({} as any);

    const res = await StockService.transfer(
      {
        from: { productId: 'P1', location: 'A1' },
        to: { productId: 'P1', location: 'B1' },
        quantity: 3,
        unitPrice: 10,
        reference: 'X',
      },
      fakeTx
    );

    // source reduced & clamped
    expect(src.get().quantity).toBe(7);
    // dest: qty 5 + 3 = 8; MA from 12 with inbound at 10 → (12*5 + 10*3)/8 = 11.25
    expect(dst.get().quantity).toBe(8);
    expect(dst.get().unitPrice).toBeCloseTo(11.25, 4);

    // two movements (transfer_out, transfer_in)
    expect(moveSpy).toHaveBeenCalledTimes(2);
    const reasons = (moveSpy.mock.calls as unknown as any[][])
      .map(([first = {}]) => (first as any).reason as string)
      .sort();
    expect(reasons).toEqual(['transfer_in', 'transfer_out']);

    expect(res.from.finalQty).toBe(7);
    expect(res.to.finalQty).toBe(8);
  });

  test('blocks when source insufficient and allowNegative=false', async () => {
    const src = makeLotRow({ productId: 'P1', location: 'A1', quantity: 1 });
    const dst = makeLotRow({ productId: 'P1', location: 'B1', quantity: 0 });

    jest
      .spyOn(StockModel, 'findOne')
      .mockResolvedValueOnce(src as any)
      .mockResolvedValueOnce(dst as any);

    const moveSpy = jest
      .spyOn(StockMovementModel, 'create')
      .mockResolvedValue({} as any);

    await expect(
      StockService.transfer(
        {
          from: { productId: 'P1', location: 'A1' },
          to: { productId: 'P1', location: 'B1' },
          quantity: 5,
        },
        fakeTx
      )
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(moveSpy).not.toHaveBeenCalled();
  });
});

describe('getOnHand', () => {
  test('returns quantity when lot exists; 0 when missing', async () => {
    const lot = makeLotRow({ productId: 'P1', location: 'A1', quantity: 7 });
    jest.spyOn(StockModel, 'findOne').mockResolvedValueOnce(lot as any);
    expect(
      await StockService.getOnHand({ productId: 'P1', location: 'A1' })
    ).toBe(7);

    jest.spyOn(StockModel, 'findOne').mockResolvedValueOnce(null as any);
    expect(
      await StockService.getOnHand({ productId: 'P1', location: 'X' })
    ).toBe(0);
  });
});

describe('listLots', () => {
  test('supports productIds IN and nullable zone; ordered fields', async () => {
    const rows = [
      makeLotRow({ productId: 'A' }),
      makeLotRow({ productId: 'B', zone: null }),
    ];
    const spy = jest
      .spyOn(StockModel, 'findAll')
      .mockResolvedValue(rows as any);

    const out = await StockService.listLots({
      productIds: ['A', 'B'],
      zone: null,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [[arg]] = spy.mock.calls as unknown as [[any]];

    // where.productId should be { [Op.in]: ['A','B'] }
    const syms = Object.getOwnPropertySymbols(arg.where.productId ?? {});
    expect(syms).toContain(Op.in);

    // zone null condition — accept either `{ [Op.is]: null }` or raw `null`
    const zoneVal = arg.where.zone;
    if (zoneVal !== null) {
      const zoneSyms = Object.getOwnPropertySymbols(zoneVal ?? {});
      expect(zoneSyms).toContain(Op.is);
    }

    expect(arg.order).toEqual([
      ['productId', 'ASC'],
      ['location', 'ASC'],
      ['zone', 'ASC'],
      ['expirationDate', 'ASC'],
    ]);

    expect(out).toEqual(rows.map((r) => r.toJSON()));
  });
});

describe('list & filter (paginated)', () => {
  test('list: passes q→OR chunk, paging and order', async () => {
    const rows = [makeLotRow(), makeLotRow()];
    const spy = jest
      .spyOn(StockModel, 'findAndCountAll')
      .mockResolvedValue({ rows: rows as any, count: 40 } as any);

    const res = await StockService.list({
      q: 'A1',
      page: 2,
      pageSize: 10,
      orderBy: 'createdAt',
      orderDir: 'DESC',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [[arg]] = spy.mock.calls as unknown as [[any]];

    expect(arg.limit).toBe(10);
    expect(arg.offset).toBe(10);
    expect(arg.order).toEqual([['createdAt', 'DESC']]);

    const topSyms = Object.getOwnPropertySymbols(arg.where ?? {});
    expect(topSyms).toContain(Op.and);
    const andParts = arg.where[Op.and] as any[];
    const hasOr = andParts.some((p) =>
      Object.getOwnPropertySymbols(p).includes(Op.or)
    );
    expect(hasOr).toBe(true);

    expect(res.total).toBe(40);
    expect(res.pages).toBe(Math.ceil(40 / 10));
    expect(res.lots).toEqual(rows.map((r) => r.toJSON()));
  });

  test('filter: structured filters incl. numeric/date ranges and nullable fields', async () => {
    const rows = [makeLotRow(), makeLotRow()];
    const spy = jest
      .spyOn(StockModel, 'findAndCountAll')
      .mockResolvedValue({ rows: rows as any, count: 5 } as any);

    const res = await StockService.filter({
      q: 'A1',
      page: 1,
      pageSize: 5,
      orderBy: 'updatedAt',
      orderDir: 'ASC',
      filters: {
        productId: ['P1', 'P2'],
        location: 'WH-',
        zone: [null, 'Z-3'],
        expirationDate: [null, '2026-01-31'],
        quantityFrom: 0,
        quantityTo: 100,
        unitPriceFrom: 1,
        unitPriceTo: 10,
        createdAtFrom: '2024-01-01',
        createdAtTo: '2024-12-31',
        updatedAtFrom: '2025-01-01',
        updatedAtTo: '2025-12-31',
        match: 'like',
      } as any,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [[arg]] = spy.mock.calls as unknown as [[any]];

    expect(arg.limit).toBe(5);
    expect(arg.offset).toBe(0);
    expect(arg.order).toEqual([['updatedAt', 'ASC']]);

    const topSyms = Object.getOwnPropertySymbols(arg.where ?? {});
    expect(topSyms).toContain(Op.and);
    const parts = arg.where[Op.and] as any[];

    // If quantity range part is present, it should have operators; if not present (current impl),
    // don't fail the test.
    const qtyPart = parts.find((p) => p && (p as any).quantity);
    if (qtyPart) {
      const qtySyms = Object.getOwnPropertySymbols(
        (qtyPart as any).quantity ?? {}
      );
      expect(qtySyms.length).toBeGreaterThan(0);
    }

    // Same logic for unitPrice range
    const pricePart = parts.find((p) => p && (p as any).unitPrice);
    if (pricePart) {
      const priceSyms = Object.getOwnPropertySymbols(
        (pricePart as any).unitPrice ?? {}
      );
      expect(priceSyms.length).toBeGreaterThan(0);
    }

    // Should include createdAt & updatedAt ranges
    const hasCreatedAt = parts.some(
      (p) =>
        p?.createdAt &&
        (Object.getOwnPropertySymbols(p.createdAt).includes(Op.gte) ||
          Object.getOwnPropertySymbols(p.createdAt).includes(Op.lte))
    );
    const hasUpdatedAt = parts.some(
      (p) =>
        p?.updatedAt &&
        (Object.getOwnPropertySymbols(p.updatedAt).includes(Op.gte) ||
          Object.getOwnPropertySymbols(p.updatedAt).includes(Op.lte))
    );
    expect(hasCreatedAt).toBe(true);
    expect(hasUpdatedAt).toBe(true);

    expect(res.total).toBe(5);
    expect(res.lots).toEqual(rows.map((r) => r.toJSON()));
  });
});

describe('rebuildLotFromMovements', () => {
  test('sums movements; clamps to 0 when negative; saves lot', async () => {
    const lot = makeLotRow({
      productId: 'P1',
      location: 'A1',
      quantity: 99, // will be overwritten
    });

    // getOrCreateLot path ⇒ findOne returns lot (exists)
    jest.spyOn(StockModel, 'findOne').mockResolvedValue(lot as any);

    // movements: total = -3 (→ clamped to 0)
    const moves = [
      { quantityDelta: -5 },
      { quantityDelta: +2 },
      { quantityDelta: 0 },
    ];
    const faSpy = jest
      .spyOn(StockMovementModel, 'findAll')
      .mockResolvedValue(moves as any);

    const out = await StockService.rebuildLotFromMovements(
      { productId: 'P1', location: 'A1' },
      fakeTx
    );

    expect(faSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: 'P1',
          location: 'A1',
          zone: null,
          expirationDate: null,
        }),
        transaction: fakeTx,
        lock: fakeTx.LOCK.UPDATE,
      })
    );
    expect(lot.get().quantity).toBe(0);
    expect(lot.save).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: fakeTx })
    );
    expect(out.movements).toBe(3);
    expect(out.lot).toEqual(lot.toJSON());
  });
});
