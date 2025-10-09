// src/__tests__/services/product.service.spec.ts

/**
 * ProductService — unit tests (pure Jest mocks; no DB)
 * @jest-environment node
 */

import { Op, UniqueConstraintError } from 'sequelize';

/* ========================= Type imports only ========================= */
import type { ListProductsQuery } from '../../types/product.js';

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

function mkProduct(over: Partial<MockProduct> = {}): MockProduct {
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
}

/* ========================= Mock setup ========================= */

const fakeTx: any = { LOCK: { UPDATE: 'UPDATE' } };
const mockWithTransaction = jest.fn(async (fn: any) => fn(fakeTx));

const mockPublicUrlToAbsPathIfLocal = jest.fn((u: string) => u);
const mockTryUnlink = jest.fn(async () => true);

// Mock modules
jest.mock('../../utils/tx.js', () => ({
  withTransaction: mockWithTransaction,
}));

jest.mock('../../utils/upload.js', () => ({
  publicUrlToAbsPathIfLocal: mockPublicUrlToAbsPathIfLocal,
  tryUnlink: mockTryUnlink,
}));

/* ========================= Import after mocks ========================= */

import { ProductService } from '../../services/product.service.js';
import { ProductModel } from '../../models/product.model.js';
import { ProductImageModel } from '../../models/product-image.model.js';
import { DuplicateError, NotFoundError } from '../../errors/index.js';

/* ================================ Lifecycle ================================= */

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockWithTransaction.mockClear();
  mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeTx));
  mockPublicUrlToAbsPathIfLocal.mockClear();
  mockPublicUrlToAbsPathIfLocal.mockImplementation((u: string) => u);
  mockTryUnlink.mockClear();
  mockTryUnlink.mockImplementation(async () => true);
});

afterEach(() => {
  jest.restoreAllMocks();
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
    jest.spyOn(ProductModel, 'create').mockResolvedValue(inst as any);

    const out = await ProductService.create({
      productId: 'EAN:123',
      productCode: 'XYZ-123',
      productName: 'Sparkling',
      brands: 'FizzCo',
      quantity: 4,
      quantityUnit: 'pack',
      description: '4x330ml',
    });

    expect(mockWithTransaction).toHaveBeenCalled();
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
      expect.objectContaining({ transaction: fakeTx })
    );
    expect(out).toMatchObject({ productId: 'EAN:123', productCode: 'XYZ-123' });
  });

  test('UniqueConstraintError -> DuplicateError', async () => {
    jest
      .spyOn(ProductModel, 'create')
      .mockRejectedValue(new UniqueConstraintError({ message: 'dup' } as any));
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
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(inst as any);

    const out = await ProductService.getById('X1');
    expect(ProductModel.findByPk).toHaveBeenCalledWith('X1');
    expect(out).toMatchObject({ productId: 'X1' });
  });

  test('throws NotFound when missing', async () => {
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(null as any);
    await expect(ProductService.getById('nope')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('ProductService.getByCode', () => {
  test('normalizes (trim + uppercase) and finds product', async () => {
    const inst = mkProduct({ productCode: 'ABC-123' });
    jest.spyOn(ProductModel, 'findOne').mockResolvedValue(inst as any);

    const out = await ProductService.getByCode('  abc-123 ');
    expect(ProductModel.findOne).toHaveBeenCalledWith({
      where: { productCode: 'ABC-123' },
    });
    expect(out.productCode).toBe('ABC-123');
  });

  test('throws NotFound when missing', async () => {
    jest.spyOn(ProductModel, 'findOne').mockResolvedValue(null as any);
    await expect(ProductService.getByCode('zzz')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('ProductService.update', () => {
  test('updates allowed fields and returns JSON', async () => {
    const inst = mkProduct({ productId: 'P7', productName: 'Old' });
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(inst as any);

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
        transaction: fakeTx,
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
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(null as any);
    await expect(
      ProductService.update('nope', { productName: 'x' })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('UniqueConstraintError on save -> DuplicateError', async () => {
    const inst = mkProduct({ productId: 'P1' });
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(inst as any);
    (inst.save as any).mockRejectedValue(
      new UniqueConstraintError({ message: 'dup' } as any)
    );

    await expect(
      ProductService.update('P1', { productCode: 'TAKEN' })
    ).rejects.toBeInstanceOf(DuplicateError);
  });
});

describe('ProductService.delete', () => {
  test('deletes images and product, then unlinks local files', async () => {
    const inst = mkProduct({ productId: 'DEL1' });
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(inst as any);

    jest.spyOn(ProductImageModel, 'findAll').mockResolvedValue([
      { get: (k: string) => (k === 'url' ? '/uploads/a.jpg' : undefined) },
      {
        get: (k: string) => (k === 'url' ? 'http://ext.com/b.jpg' : undefined),
      },
    ] as any);

    jest.spyOn(ProductImageModel, 'destroy').mockResolvedValue(2 as any);
    jest.spyOn(ProductModel, 'destroy').mockResolvedValue(1 as any);

    const out = await ProductService.delete('DEL1');

    expect(mockWithTransaction).toHaveBeenCalled();
    expect(ProductImageModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'DEL1' },
        lock: 'UPDATE',
        transaction: fakeTx,
      })
    );
    expect(ProductImageModel.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'DEL1' },
        transaction: fakeTx,
      })
    );
    expect(ProductModel.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'DEL1' },
        transaction: fakeTx,
      })
    );

    expect(mockPublicUrlToAbsPathIfLocal).toHaveBeenCalledTimes(2);
    expect(mockTryUnlink).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ success: true });
  });

  test('throws NotFound when product missing', async () => {
    jest.spyOn(ProductModel, 'findByPk').mockResolvedValue(null as any);
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
    jest
      .spyOn(ProductModel, 'findAndCountAll')
      .mockResolvedValue({ rows, count: 42 } as any);

    const res = await ProductService.list({
      page: 3,
      pageSize: 10,
      q: 'water',
      orderBy: 'productName',
      orderDir: 'ASC',
    });

    const calls = (ProductModel.findAndCountAll as jest.Mock).mock.calls;
    const call = calls[0][0];
    expect(call.limit).toBe(10);
    expect(call.offset).toBe(20);
    expect(call.order).toEqual([['productName', 'ASC']]);

    // buildProductWhere wraps q under { [Op.and]: [ { [Op.or]: [...] } ] }
    const where = call.where ?? {};
    const whereSyms = Object.getOwnPropertySymbols(where);
    expect(whereSyms).toContain(Op.and);

    const andParts = (where as any)[Op.and] as any[];
    expect(Array.isArray(andParts)).toBe(true);

    const innerOr = andParts.find((p) =>
      Object.getOwnPropertySymbols(p).includes(Op.or)
    );
    expect(innerOr).toBeTruthy();

    const clauses = (innerOr as any)[Op.or];
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
    jest
      .spyOn(ProductModel, 'findAndCountAll')
      .mockResolvedValue({ rows, count: 1 } as any);

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

    const calls = (ProductModel.findAndCountAll as jest.Mock).mock.calls;
    const call = calls[0][0];

    expect(call.limit).toBe(5);
    expect(call.offset).toBe(0);
    expect(call.order).toEqual([['createdAt', 'DESC']]);

    const where = call.where ?? {};
    const hasAnd = Object.getOwnPropertySymbols(where).includes(Op.and);
    expect(hasAnd).toBe(true);

    const andParts = (where as any)[Op.and] as any[];
    const qtyPart = andParts.find((p) => p.quantity);
    const qtyAndSym = Op.and;

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
