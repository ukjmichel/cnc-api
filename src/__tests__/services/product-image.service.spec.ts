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

// IMPORTANT: mock the tx module BEFORE importing the service
const fakeTx: any = { LOCK: { UPDATE: 'UPDATE' } };

await jest.unstable_mockModule('../../utils/tx.js', () => ({
  // provide a jest.fn so we can adjust implementation later if needed
  withTransaction: jest.fn(async (fn: any) => fn(fakeTx)),
}));

// Now import the mocked module and the subject under test
const tx = await import('../../utils/tx.js');
const { ProductImageService } = await import(
  '../../services/product-image.service.js'
);

// These can be static imports; they don't depend on the mocked module
import { ProductModel } from '../../models/product.model.js';
import { ProductImageModel } from '../../models/product-image.model.js';

import {
  BadRequestError,
  NotFoundError,
  DuplicateError,
} from '../../errors/index.js';

/**
 * NOTE ON TS-SAFE MOCKS
 * ---------------------
 * - For functions that resolve to void, prefer:
 *     mockImplementation(async () => undefined)
 *   instead of mockResolvedValue(undefined).
 *
 * - For functions that should reject with a specific error:
 *     mockImplementation(async () => { throw new SpecificError(...) })
 *   instead of mockRejectedValue(...).
 */

// ---------- helpers ----------
const mkId = (p = 'SKU') =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const mkUrl = (n = '') => `https://cdn.example.com/img${n ? '-' + n : ''}.jpg`;

// Ensure tx.withTransaction always calls the callback with our fake tx
beforeEach(() => {
  (tx.withTransaction as unknown as jest.Mock).mockImplementation(
    async (fn: any) => fn(fakeTx)
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

// Build a minimal Sequelize "instance-like" object with save/set/toJSON
// IMPORTANT: expose property accessors so direct assignments (e.g., existing.url = '...')
// update the internal state; the service relies on direct assignment in upsertVariant.
function makeImageRow(overrides: Partial<Record<string, any>> = {}) {
  const state: any = {
    imageId: mkId('img'),
    productId: mkId('SKU'),
    url: mkUrl(),
    variant: 'front',
    alt: null,
    ...overrides,
  };

  const obj: any = {
    get: () => ({ ...state }),
    set: (patch: any) => Object.assign(state, patch),
    save: jest.fn().mockImplementation(async () => undefined),
    toJSON: () => ({
      imageId: state.imageId,
      productId: state.productId,
      url: state.url,
      variant: state.variant,
      alt: state.alt,
    }),
  };

  // Wire direct property access to internal state
  for (const key of [
    'imageId',
    'productId',
    'url',
    'variant',
    'alt',
  ] as const) {
    Object.defineProperty(obj, key, {
      get: () => state[key],
      set: (v) => {
        state[key] = v;
        return true;
      },
      enumerable: true,
      configurable: true,
    });
  }

  return obj;
}

// ---------- tests ----------
describe('ProductImageService.create', () => {
  test('creates image and returns plain JSON', async () => {
    const productId = mkId('SKU');

    jest
      .spyOn(ProductModel, 'findByPk')
      .mockResolvedValue({ get: () => ({ productId }) } as any);

    const row = makeImageRow({
      productId,
      variant: 'front',
      url: mkUrl('front'),
      alt: ' Nice ',
    });
    jest.spyOn(ProductImageModel, 'create').mockResolvedValue(row as any);

    const out = await ProductImageService.create({
      productId,
      url: row.get().url,
      variant: 'front',
      alt: ' Nice ',
    });

    expect(out).toEqual(row.toJSON());
    expect(ProductModel.findByPk).toHaveBeenCalledWith(
      productId,
      expect.objectContaining({ transaction: fakeTx, lock: fakeTx.LOCK.UPDATE })
    );
    expect(ProductImageModel.create).toHaveBeenCalledWith(
      { productId, url: row.get().url, variant: 'front', alt: ' Nice ' },
      expect.objectContaining({ transaction: fakeTx })
    );
  });

  test('validation → BadRequestError (missing productId / invalid url / invalid variant)', async () => {
    await expect(
      ProductImageService.create({
        productId: '',
        url: mkUrl(),
        variant: 'front' as any,
      })
    ).rejects.toBeInstanceOf(BadRequestError);

    await expect(
      ProductImageService.create({
        productId: mkId('SKU'),
        url: 'not-a-url',
        variant: 'front' as any,
      })
    ).rejects.toBeInstanceOf(BadRequestError);

    await expect(
      ProductImageService.create({
        productId: mkId('SKU'),
        url: mkUrl(),
        variant: 'nope' as any,
      })
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('NotFound when product missing', async () => {
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(null as any);
    await expect(
      ProductImageService.create({
        productId: mkId('SKU'),
        url: mkUrl(),
        variant: 'front' as any,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('UniqueConstraintError → DuplicateError', async () => {
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue({} as any);
    jest.spyOn(ProductImageModel, 'create').mockImplementation(async () => {
      throw new UniqueConstraintError({ message: 'dup', errors: [] } as any);
    });

    await expect(
      ProductImageService.create({
        productId: mkId('SKU'),
        url: mkUrl(),
        variant: 'front' as any,
      })
    ).rejects.toBeInstanceOf(DuplicateError);
  });
});

describe('ProductImageService.getById', () => {
  test('returns JSON', async () => {
    const row = makeImageRow();
    jest.spyOn(ProductImageModel, 'findByPk').mockResolvedValue(row as any);

    const out = await ProductImageService.getById(row.get().imageId);
    expect(out).toEqual(row.toJSON());
  });

  test('throws NotFound when missing', async () => {
    jest.spyOn(ProductImageModel, 'findByPk').mockResolvedValue(null as any);
    await expect(ProductImageService.getById('nope')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('ProductImageService.getByProductAndVariant', () => {
  test('returns JSON', async () => {
    const row = makeImageRow({ variant: 'front' });
    jest.spyOn(ProductImageModel, 'findOne').mockResolvedValue(row as any);

    const out = await ProductImageService.getByProductAndVariant(
      row.get().productId,
      'front' as any
    );
    expect(out).toEqual(row.toJSON());
  });

  test('throws NotFound', async () => {
    jest.spyOn(ProductImageModel, 'findOne').mockResolvedValue(null as any);
    await expect(
      ProductImageService.getByProductAndVariant('x', 'front' as any)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ProductImageService.update', () => {
  test('updates allowed fields and returns JSON', async () => {
    const row = makeImageRow({ variant: 'front', url: mkUrl('a'), alt: null });
    const saveSpy = jest.spyOn(row, 'save');

    jest.spyOn(ProductImageModel, 'findByPk').mockResolvedValue(row as any);

    const out = await ProductImageService.update(row.get().imageId, {
      url: mkUrl('b'),
      variant: 'back' as any,
      alt: '  ALT  ',
    });

    expect(saveSpy).toHaveBeenCalled();
    expect(out).toEqual(
      expect.objectContaining({
        url: mkUrl('b'),
        variant: 'back',
        alt: '  ALT  ',
      })
    );
  });

  test('validation errors → BadRequestError', async () => {
    const row = makeImageRow();
    jest.spyOn(ProductImageModel, 'findByPk').mockResolvedValue(row as any);

    await expect(
      ProductImageService.update(row.get().imageId, { url: 'bad' })
    ).rejects.toBeInstanceOf(BadRequestError);

    await expect(
      ProductImageService.update(row.get().imageId, { variant: 'nope' as any })
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('throws NotFound when row missing', async () => {
    jest.spyOn(ProductImageModel, 'findByPk').mockResolvedValue(null as any);
    await expect(
      ProductImageService.update('nope', { url: mkUrl() })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('UniqueConstraintError on save → DuplicateError', async () => {
    const row = makeImageRow();
    jest.spyOn(ProductImageModel, 'findByPk').mockResolvedValue(row as any);
    jest.spyOn(row, 'save').mockImplementation(async () => {
      throw new UniqueConstraintError({ message: 'dup', errors: [] } as any);
    });

    await expect(
      ProductImageService.update(row.get().imageId, { variant: 'back' as any })
    ).rejects.toBeInstanceOf(DuplicateError);
  });
});

describe('ProductImageService.delete', () => {
  test('deletes and returns success', async () => {
    jest.spyOn(ProductImageModel, 'destroy').mockResolvedValue(1 as any);
    const out = await ProductImageService.delete('img-1');
    expect(out).toEqual({ success: true });
  });

  test('throws NotFound when nothing deleted', async () => {
    jest.spyOn(ProductImageModel, 'destroy').mockResolvedValue(0 as any);
    await expect(ProductImageService.delete('img-1')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('ProductImageService.upsertVariant', () => {
  test('updates existing (productId, variant)', async () => {
    const productId = mkId('SKU');
    const existing = makeImageRow({
      productId,
      variant: 'front',
      url: mkUrl('old'),
      alt: null,
    });

    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue({} as any);
    jest.spyOn(ProductImageModel, 'findOne').mockResolvedValue(existing as any);

    const out = await ProductImageService.upsertVariant({
      productId,
      variant: 'front' as any,
      url: mkUrl('new'),
      alt: 'desc',
    });

    expect(out).toEqual(
      expect.objectContaining({
        productId,
        variant: 'front',
        url: mkUrl('new'),
        alt: 'desc',
      })
    );
    expect(existing.save).toHaveBeenCalled();
  });

  test('creates when none exists', async () => {
    const productId = mkId('SKU');
    const created = makeImageRow({
      productId,
      variant: 'front',
      url: mkUrl('fresh'),
      alt: 'a',
    });

    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue({} as any);
    jest.spyOn(ProductImageModel, 'findOne').mockResolvedValue(null as any);
    jest.spyOn(ProductImageModel, 'create').mockResolvedValue(created as any);

    const out = await ProductImageService.upsertVariant({
      productId,
      variant: 'front' as any,
      url: mkUrl('fresh'),
      alt: 'a',
    });

    expect(out).toEqual(created.toJSON());
  });

  test('NotFound when product missing', async () => {
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(null as any);
    await expect(
      ProductImageService.upsertVariant({
        productId: mkId('SKU'),
        variant: 'front' as any,
        url: mkUrl(),
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('validation parity with create → BadRequestError', async () => {
    await expect(
      ProductImageService.upsertVariant({
        productId: '',
        variant: 'front' as any,
        url: mkUrl(),
      })
    ).rejects.toBeInstanceOf(BadRequestError);

    await expect(
      ProductImageService.upsertVariant({
        productId: mkId('SKU'),
        variant: 'nope' as any,
        url: mkUrl(),
      })
    ).rejects.toBeInstanceOf(BadRequestError);

    await expect(
      ProductImageService.upsertVariant({
        productId: mkId('SKU'),
        variant: 'front' as any,
        url: 'bad',
      })
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('ProductImageService.deleteByProductAndVariant', () => {
  test('success', async () => {
    jest.spyOn(ProductImageModel, 'destroy').mockResolvedValue(2 as any);
    const out = await ProductImageService.deleteByProductAndVariant(
      'SKU-1',
      'front' as any
    );
    expect(out).toEqual({ success: true });
  });

  test('NotFound when nothing deleted', async () => {
    jest.spyOn(ProductImageModel, 'destroy').mockResolvedValue(0 as any);
    await expect(
      ProductImageService.deleteByProductAndVariant('SKU-1', 'front' as any)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ProductImageService.deleteAllByProduct', () => {
  test('returns urls & deleted count', async () => {
    const rows = [
      makeImageRow({ productId: 'SKU-1', url: mkUrl('1') }),
      makeImageRow({ productId: 'SKU-1', url: mkUrl('2') }),
    ];
    jest.spyOn(ProductImageModel, 'findAll').mockResolvedValue(rows as any);
    jest
      .spyOn(ProductImageModel, 'destroy')
      .mockResolvedValue(rows.length as any);

    const out = await ProductImageService.deleteAllByProduct('SKU-1');
    expect(out).toEqual({
      success: true,
      deleted: rows.length,
      urls: rows.map((r) => r.toJSON().url),
    });
  });

  test('NotFound when none exist', async () => {
    jest.spyOn(ProductImageModel, 'findAll').mockResolvedValue([] as any);
    await expect(
      ProductImageService.deleteAllByProduct('SKU-1')
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ProductImageService.list', () => {
  test('lists with paging, q → where, and order', async () => {
    const rows = [makeImageRow(), makeImageRow()];
    const spy = jest
      .spyOn(ProductImageModel, 'findAndCountAll')
      .mockResolvedValue({ rows: rows as any, count: 42 } as any);

    const res = await ProductImageService.list({
      q: 'water',
      page: 3,
      pageSize: 10,
      orderBy: 'url',
      orderDir: 'ASC',
    });

    // Verify the options passed to findAndCountAll
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as any;

    expect(call.limit).toBe(10);
    expect(call.offset).toBe(20);
    expect(call.order).toEqual([['url', 'ASC']]);

    // where should be { [Op.and]: [ { [Op.or]: [...] } ] }
    const topSyms = Object.getOwnPropertySymbols(call.where ?? {});
    expect(topSyms).toContain(Op.and);

    const andParts = call.where[Op.and] as any[];
    expect(Array.isArray(andParts)).toBe(true);
    expect(andParts.length).toBeGreaterThanOrEqual(1);

    // One of the parts must be an OR chunk for q
    const hasOr = andParts.some((part) =>
      Object.getOwnPropertySymbols(part).includes(Op.or)
    );
    expect(hasOr).toBe(true);

    expect(res.total).toBe(42);
    expect(res.page).toBe(3);
    expect(res.pageSize).toBe(10);
    expect(res.pages).toBe(Math.ceil(42 / 10));
    expect(res.images).toEqual(rows.map((r) => r.toJSON()));
  });
});

describe('ProductImageService.filter', () => {
  test('applies structured filters incl. variants and date ranges', async () => {
    const rows = [makeImageRow(), makeImageRow()];
    const spy = jest
      .spyOn(ProductImageModel, 'findAndCountAll')
      .mockResolvedValue({ rows: rows as any, count: 5 } as any);

    const res = await ProductImageService.filter({
      q: 'spark',
      page: 1,
      pageSize: 5,
      orderBy: 'createdAt',
      orderDir: 'DESC',
      filters: {
        productId: ['SKU-100', 'SKU-200'],
        url: 'cdn.example.com',
        alt: ['hero', 'front'],
        variant: ['front', 'back'] as any,
        createdAtFrom: '2024-01-01',
        createdAtTo: '2024-01-31',
        updatedAtFrom: '2024-02-01',
        updatedAtTo: '2024-02-28',
        match: 'like',
      } as any,
    });

    const call = spy.mock.calls[0][0] as any;

    // Basics
    expect(call.limit).toBe(5);
    expect(call.offset).toBe(0);
    expect(call.order).toEqual([['createdAt', 'DESC']]);

    const topSyms = Object.getOwnPropertySymbols(call.where ?? {});
    expect(topSyms).toContain(Op.and);
    const parts = call.where[Op.and] as any[];
    expect(Array.isArray(parts)).toBe(true);

    // Should include a variant IN condition
    const hasVariantIn = parts.some(
      (p) =>
        p?.variant && Object.getOwnPropertySymbols(p.variant).includes(Op.in)
    );
    expect(hasVariantIn).toBe(true);

    // Should include createdAt & updatedAt range chunks
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
    expect(res.images).toEqual(rows.map((r) => r.toJSON()));
  });
});
