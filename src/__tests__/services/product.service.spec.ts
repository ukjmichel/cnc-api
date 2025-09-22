// src/__tests__/services/product.service.spec.ts
import 'reflect-metadata';
import { jest, describe, test, beforeEach, expect } from '@jest/globals';

const asMock = (fn: unknown) => fn as jest.MockedFunction<any>;

/* ========================= Mocks (must be before imports) ========================= */

class UniqueConstraintErrorShim extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'UniqueConstraintError';
  }
}
const OpSymbols = {
  and: Symbol.for('sequelize.and'),
  or: Symbol.for('sequelize.or'),
  like: Symbol.for('sequelize.like'),
  gte: Symbol.for('sequelize.gte'),
  lte: Symbol.for('sequelize.lte'),
  in: Symbol.for('sequelize.in'),
  not: Symbol.for('sequelize.not'),
};
jest.unstable_mockModule('sequelize', () => ({
  Op: OpSymbols,
  UniqueConstraintError: UniqueConstraintErrorShim,
}));

const mockWithTransaction = jest.fn(async (fn: (t: any) => any) => {
  const t = { LOCK: { UPDATE: 'UPDATE' } };
  return fn(t);
});
jest.unstable_mockModule('../../utils/tx.js', () => ({
  withTransaction: mockWithTransaction,
}));

const ProductModelFns: any = {
  create: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  findAndCountAll: jest.fn(),
  destroy: jest.fn(),
};
const ProductImageModelFns: any = {
  findAll: jest.fn(),
  destroy: jest.fn(),
};
jest.unstable_mockModule('../../models/product.model.js', () => ({
  ProductModel: ProductModelFns,
}));
jest.unstable_mockModule('../../models/product-image.model.js', () => ({
  ProductImageModel: ProductImageModelFns,
}));

const mockPublicUrlToAbsPathIfLocal = jest.fn((u: string) => u);
const mockTryUnlink = jest.fn(async () => true);
jest.unstable_mockModule('../../utils/upload.js', () => ({
  publicUrlToAbsPathIfLocal: mockPublicUrlToAbsPathIfLocal,
  tryUnlink: mockTryUnlink,
}));

const { DuplicateError, NotFoundError } = await import('../../errors/index.js');

/* ========================= Load SUT after mocks ========================= */
const { ProductService } = await import('../../services/product.service.js');
const { ProductModel } = await import('../../models/product.model.js');
const { ProductImageModel } = await import(
  '../../models/product-image.model.js'
);
const { withTransaction } = await import('../../utils/tx.js');
const { Op } = await import('sequelize');
const { publicUrlToAbsPathIfLocal, tryUnlink } = await import(
  '../../utils/upload.js'
);

const OpAny: any = Op;

/* ================================ Helpers ================================= */

type MockProduct = {
  productId: string;
  productCode: string | null;
  productName: string;
  brands: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  description: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  toJSON: () => any;
  set: jest.Mock<(patch: Partial<Record<string, unknown>>) => void>;
  save: jest.Mock<() => Promise<void>>;
  get?: (k: string) => any;
} & Record<string, unknown>;

const mkProduct = (over: Partial<MockProduct> = {}): MockProduct => {
  const data: any = {
    productId: 'EAN:1',
    productCode: 'ABC-1',
    productName: 'Water',
    brands: 'Acme',
    quantity: 6,
    quantityUnit: 'bottles',
    description: '6x500ml',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...over,
  };

  const inst: any = {};
  for (const key of [
    'productId',
    'productCode',
    'productName',
    'brands',
    'quantity',
    'quantityUnit',
    'description',
    'createdAt',
    'updatedAt',
  ]) {
    Object.defineProperty(inst, key, {
      enumerable: true,
      configurable: true,
      get: () => data[key],
      set: (v) => {
        data[key] = v;
      },
    });
  }
  inst.toJSON = () => ({ ...data });
  inst.set = jest.fn((patch: Partial<Record<string, unknown>>) =>
    Object.assign(data, patch)
  );
  inst.save = jest.fn(async () => {});
  inst.get = (k: string) => data[k];

  return inst as MockProduct;
};

beforeEach(() => {
  jest.clearAllMocks();
});

/* ================================= Tests ================================= */

describe('ProductService.create', () => {
  test('creates product and returns plain JSON', async () => {
    const inst = mkProduct({
      productId: 'EAN:123',
      productCode: 'XYZ-123',
      productName: 'Sparkling',
      brands: 'FizzCo',
      quantity: 4,
      quantityUnit: 'pack',
      description: '4x330ml',
    });
    asMock(ProductModel.create).mockResolvedValue(inst as any);

    const out = await ProductService.create({
      productId: 'EAN:123',
      productCode: 'XYZ-123',
      productName: 'Sparkling',
      brands: 'FizzCo',
      quantity: 4,
      quantityUnit: 'pack',
      description: '4x330ml',
    });

    expect(withTransaction).toHaveBeenCalled();
    expect(ProductModel.create).toHaveBeenCalledWith(
      {
        productId: 'EAN:123',
        productCode: 'XYZ-123',
        productName: 'Sparkling',
        brands: 'FizzCo',
        quantity: 4,
        quantityUnit: 'pack',
        description: '4x330ml',
      },
      expect.objectContaining({ transaction: expect.anything() })
    );
    expect(out).toMatchObject({ productId: 'EAN:123', productCode: 'XYZ-123' });
  });

  test('UniqueConstraintError -> DuplicateError', async () => {
    asMock(ProductModel.create).mockRejectedValue(
      new UniqueConstraintErrorShim('dup')
    );
    await expect(
      ProductService.create({
        productId: 'p1',
        productCode: 'C1',
        productName: 'Name',
      } as any)
    ).rejects.toBeInstanceOf(DuplicateError);
  });
});

describe('ProductService.getById', () => {
  test('returns product JSON', async () => {
    const inst = mkProduct({ productId: 'X1' });
    asMock(ProductModel.findByPk).mockResolvedValue(inst as any);

    const out = await ProductService.getById('X1');
    expect(ProductModel.findByPk).toHaveBeenCalledWith('X1');
    expect(out).toMatchObject({ productId: 'X1' });
  });

  test('throws NotFound when missing', async () => {
    asMock(ProductModel.findByPk).mockResolvedValue(null as any);
    await expect(ProductService.getById('nope')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('ProductService.getByCode', () => {
  test('normalizes (trim + uppercase) and finds product', async () => {
    const inst = mkProduct({ productCode: 'ABC-123' });
    asMock(ProductModel.findOne).mockResolvedValue(inst as any);

    const out = await ProductService.getByCode('  abc-123 ');
    expect(ProductModel.findOne).toHaveBeenCalledWith({
      where: { productCode: 'ABC-123' },
    });
    expect(out.productCode).toBe('ABC-123');
  });

  test('throws NotFound when missing', async () => {
    asMock(ProductModel.findOne).mockResolvedValue(null as any);
    await expect(ProductService.getByCode('zzz')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('ProductService.update', () => {
  test('updates allowed fields and returns JSON', async () => {
    const inst = mkProduct({ productId: 'P7', productName: 'Old' });
    asMock(ProductModel.findByPk).mockResolvedValue(inst as any);

    const out = await ProductService.update('P7', {
      productName: 'New Name',
      brands: 'BrandX',
      quantity: 12,
      quantityUnit: 'pcs',
      description: 'desc',
    });

    expect(ProductModel.findByPk).toHaveBeenCalledWith(
      'P7',
      expect.objectContaining({
        transaction: expect.anything(),
        lock: 'UPDATE',
      })
    );
    expect(inst.set).toHaveBeenCalledWith({
      productName: 'New Name',
      brands: 'BrandX',
      quantity: 12,
      quantityUnit: 'pcs',
      description: 'desc',
    });
    expect(inst.save).toHaveBeenCalled();
    expect(out.productName).toBe('New Name');
  });

  test('throws NotFound when product missing', async () => {
    asMock(ProductModel.findByPk).mockResolvedValue(null as any);
    await expect(
      ProductService.update('nope', { productName: 'x' })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('UniqueConstraintError on save -> DuplicateError', async () => {
    const inst = mkProduct({ productId: 'P1' });
    asMock(ProductModel.findByPk).mockResolvedValue(inst as any);
    asMock(inst.save).mockRejectedValue(new UniqueConstraintErrorShim('dup'));

    await expect(
      ProductService.update('P1', { productCode: 'TAKEN' })
    ).rejects.toBeInstanceOf(DuplicateError);
  });
});

describe('ProductService.delete', () => {
  test('deletes images and product, then unlinks local files', async () => {
    const inst = mkProduct({ productId: 'DEL1' });
    asMock(ProductModel.findByPk).mockResolvedValue(inst as any);

    asMock(ProductImageModel.findAll).mockResolvedValue([
      { get: (k: string) => (k === 'url' ? '/uploads/a.jpg' : undefined) },
      {
        get: (k: string) => (k === 'url' ? 'http://ext.com/b.jpg' : undefined),
      },
    ] as any);

    asMock(ProductImageModel.destroy).mockResolvedValue(2 as any);
    asMock(ProductModel.destroy).mockResolvedValue(1 as any);

    const out = await ProductService.delete('DEL1');

    expect(withTransaction).toHaveBeenCalled();
    expect(ProductImageModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'DEL1' },
        lock: 'UPDATE',
        transaction: expect.anything(),
      })
    );
    expect(ProductImageModel.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'DEL1' },
        transaction: expect.anything(),
      })
    );
    expect(ProductModel.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'DEL1' },
        transaction: expect.anything(),
      })
    );

    expect(publicUrlToAbsPathIfLocal).toHaveBeenCalledTimes(2);
    expect(tryUnlink).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ success: true });
  });

  test('throws NotFound when product missing', async () => {
    asMock(ProductModel.findByPk).mockResolvedValue(null as any);
    await expect(ProductService.delete('nope')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('ProductService.list', () => {
  test('lists with paging, q -> where, and order', async () => {
    const rows = [
      mkProduct({ productId: 'L1' }),
      mkProduct({ productId: 'L2' }),
    ];
    asMock(ProductModel.findAndCountAll).mockResolvedValue({
      rows,
      count: 42,
    } as any);

    const res = await ProductService.list({
      page: 3,
      pageSize: 10,
      q: 'water',
      orderBy: 'productName',
      orderDir: 'ASC',
    });

    const call = asMock(ProductModel.findAndCountAll).mock.calls[0][0];
    expect(call.limit).toBe(10);
    expect(call.offset).toBe(20);
    expect(call.order).toEqual([['productName', 'ASC']]);

    // ✅ buildProductWhere wraps q under { [Op.and]: [ { [Op.or]: [...] } ] }
    const where = call.where ?? {};
    const whereSyms = Object.getOwnPropertySymbols(where);
    expect(whereSyms).toContain(OpAny.and);

    const andParts = (where as any)[OpAny.and] as any[];
    expect(Array.isArray(andParts)).toBe(true);

    const innerOr = andParts.find((p) =>
      Object.getOwnPropertySymbols(p).includes(OpAny.or)
    );
    expect(innerOr).toBeTruthy();

    const clauses = (innerOr as any)[OpAny.or];
    expect(Array.isArray(clauses)).toBe(true);
    expect(clauses.length).toBeGreaterThanOrEqual(1);

    expect(res.total).toBe(42);
    expect(res.page).toBe(3);
    expect(res.pageSize).toBe(10);
    expect(res.pages).toBe(Math.ceil(42 / 10));
    expect(res.products.length).toBe(2);
  });
});

describe('ProductService.filter', () => {
  test('applies structured filters incl. quantity + date ranges', async () => {
    const rows = [mkProduct({ productId: 'F1' })];
    asMock(ProductModel.findAndCountAll).mockResolvedValue({
      rows,
      count: 1,
    } as any);

    const res = await ProductService.filter({
      q: 'fizz',
      page: 1,
      pageSize: 5,
      orderBy: 'createdAt',
      orderDir: 'DESC',
      filters: {
        match: 'startsWith',
        productName: 'Spa',
        productCode: ['A', 'B'],
        brands: 'Ac',
        quantityUnit: 'pcs',
        quantityFrom: 2,
        quantityTo: 10,
        createdAtFrom: '2023-01-01',
        createdAtTo: '2023-12-31',
        updatedAtFrom: '2024-01-01',
        updatedAtTo: '2024-12-31',
      },
    });

    const call = asMock(ProductModel.findAndCountAll).mock.calls[0][0];

    expect(call.limit).toBe(5);
    expect(call.offset).toBe(0);
    expect(call.order).toEqual([['createdAt', 'DESC']]);

    const where = call.where ?? {};
    const hasAnd = Object.getOwnPropertySymbols(where).includes(OpAny.and);
    expect(hasAnd).toBe(true);

    const andParts = (where as any)[OpAny.and] as any[];
    const qtyPart = andParts.find((p) => p.quantity);
    const qtyAndSym = OpAny.and;

    expect(qtyPart.quantity[qtyAndSym]).toBeTruthy();
    expect(qtyPart.quantity[qtyAndSym]).toEqual(
      expect.arrayContaining([expect.any(Object)])
    );

    expect(andParts.some((p) => p.createdAt)).toBe(true);
    expect(andParts.some((p) => p.updatedAt)).toBe(true);

    expect(res.total).toBe(1);
    expect(res.products.length).toBe(1);
  });
});
