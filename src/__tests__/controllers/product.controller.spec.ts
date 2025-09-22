// src/__tests__/controllers/product.controller.spec.ts
import 'reflect-metadata';
import { jest, describe, test, beforeEach, expect } from '@jest/globals';

const asMock = (fn: unknown) => fn as jest.MockedFunction<any>;

/* ============================== Mocks (before imports) ============================== */

const ProductServiceMock = {
  create: jest.fn(),
  getById: jest.fn(),
  getByCode: jest.fn(),
  list: jest.fn(),
  filter: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
jest.unstable_mockModule('../../services/product.service.js', () => ({
  ProductService: ProductServiceMock,
}));

const serializeProductMock = jest.fn((p: any) => ({ __s: true, ...p }));
const serializeProductsMock = jest.fn((arr: any[]) =>
  (arr || []).map((p) => ({ __s: true, ...p }))
);
jest.unstable_mockModule('../../serializers/product.serializer.js', () => ({
  serializeProduct: serializeProductMock,
  serializeProducts: serializeProductsMock,
}));

const buildListQueryMock = jest.fn((q: Record<string, unknown>) => ({
  __built: 'list',
  ...q,
}));
const buildFilterQueryMock = jest.fn((q: Record<string, unknown>) => ({
  __built: 'filter',
  ...q,
}));
jest.unstable_mockModule('../../queries/product.queries.js', () => ({
  buildProductListQuery: buildListQueryMock,
  buildProductFilterQuery: buildFilterQueryMock,
}));

/* ============================== Load SUT after mocks ============================== */

const { ProductController } = await import(
  '../../controllers/product.controller.js'
);
const { ProductService } = await import('../../services/product.service.js');
const { serializeProduct, serializeProducts } = await import(
  '../../serializers/product.serializer.js'
);
const { buildProductListQuery, buildProductFilterQuery } = await import(
  '../../queries/product.queries.js'
);

/* ================================== Helpers ================================== */

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const makeNext = () => jest.fn();

/* ================================== Tests ================================== */

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProductController.create', () => {
  test('201 + serialized product', async () => {
    const req: any = {
      body: {
        productId: 'EAN:123',
        productCode: 'ABC-123',
        productName: 'Sparkling Water',
        brands: 'Acme',
      },
    };
    const res = makeRes();
    const next = makeNext();

    const created = { productId: 'EAN:123', productName: 'Sparkling Water' };
    asMock(ProductService.create).mockResolvedValue(created);

    await ProductController.create(req, res, next);

    expect(ProductService.create).toHaveBeenCalledWith(req.body);
    expect(serializeProduct).toHaveBeenCalledWith(created);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      data: { product: { __s: true, ...created } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { body: { productId: 'x' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('oops');

    asMock(ProductService.create).mockRejectedValue(boom);

    await ProductController.create(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('ProductController.getById', () => {
  test('200 + serialized product', async () => {
    const req: any = { params: { id: 'P1' } };
    const res = makeRes();
    const next = makeNext();

    const found = { productId: 'P1', productName: 'Name' };
    asMock(ProductService.getById).mockResolvedValue(found);

    await ProductController.getById(req, res, next);

    expect(ProductService.getById).toHaveBeenCalledWith('P1');
    expect(serializeProduct).toHaveBeenCalledWith(found);
    expect(res.json).toHaveBeenCalledWith({
      data: { product: { __s: true, ...found } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'nope' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('not found');

    asMock(ProductService.getById).mockRejectedValue(boom);

    await ProductController.getById(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('ProductController.getByCode', () => {
  test('400 when missing productCode', async () => {
    const req: any = { query: {} };
    const res = makeRes();
    const next = makeNext();

    await ProductController.getByCode(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'productCode query param is required',
    });
    expect(ProductService.getByCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('200 + serialized product', async () => {
    const req: any = { query: { productCode: 'abc-123' } };
    const res = makeRes();
    const next = makeNext();

    const found = { productId: 'P2', productCode: 'ABC-123' };
    asMock(ProductService.getByCode).mockResolvedValue(found);

    await ProductController.getByCode(req, res, next);

    expect(ProductService.getByCode).toHaveBeenCalledWith('abc-123');
    expect(serializeProduct).toHaveBeenCalledWith(found);
    expect(res.json).toHaveBeenCalledWith({
      data: { product: { __s: true, ...found } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { query: { productCode: 'x' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('nope');

    asMock(ProductService.getByCode).mockRejectedValue(boom);
    await ProductController.getByCode(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('ProductController.list', () => {
  test('200 + serialized array + meta', async () => {
    const req: any = { query: { q: 'water', page: '3', pageSize: '10' } };
    const res = makeRes();
    const next = makeNext();

    const rows = [{ productId: 'L1' }, { productId: 'L2' }];
    asMock(ProductService.list).mockResolvedValue({
      products: rows,
      total: 42,
      page: 3,
      pageSize: 10,
      pages: 5,
    });

    await ProductController.list(req, res, next);

    expect(buildProductListQuery).toHaveBeenCalledWith(req.query);
    expect(ProductService.list).toHaveBeenCalledWith(
      expect.objectContaining({ __built: 'list' })
    );
    expect(serializeProducts).toHaveBeenCalledWith(rows as any);
    expect(res.json).toHaveBeenCalledWith({
      data: { products: rows.map((r) => ({ __s: true, ...r })) },
      meta: { total: 42, page: 3, pageSize: 10, pages: 5 },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { query: {} };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('bad list');

    asMock(ProductService.list).mockRejectedValue(boom);

    await ProductController.list(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('ProductController.filter', () => {
  test('200 + serialized array + meta', async () => {
    const req: any = {
      query: { q: 'spark', filters: '{"productName":["spark"]}' },
    };
    const res = makeRes();
    const next = makeNext();

    const rows = [{ productId: 'F1' }];
    asMock(ProductService.filter).mockResolvedValue({
      products: rows,
      total: 1,
      page: 1,
      pageSize: 20,
      pages: 1,
    });

    await ProductController.filter(req, res, next);

    expect(buildProductFilterQuery).toHaveBeenCalledWith(req.query);
    expect(ProductService.filter).toHaveBeenCalledWith(
      expect.objectContaining({ __built: 'filter' })
    );
    expect(serializeProducts).toHaveBeenCalledWith(rows as any);
    expect(res.json).toHaveBeenCalledWith({
      data: { products: rows.map((r) => ({ __s: true, ...r })) },
      meta: { total: 1, page: 1, pageSize: 20, pages: 1 },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { query: {} };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('bad filter');

    asMock(ProductService.filter).mockRejectedValue(boom);

    await ProductController.filter(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('ProductController.update', () => {
  test('200 + serialized product', async () => {
    const req: any = {
      params: { id: 'U1' },
      body: { productName: 'NewName' },
    };
    const res = makeRes();
    const next = makeNext();

    const updated = { productId: 'U1', productName: 'NewName' };
    asMock(ProductService.update).mockResolvedValue(updated);

    await ProductController.update(req, res, next);

    expect(ProductService.update).toHaveBeenCalledWith('U1', req.body);
    expect(serializeProduct).toHaveBeenCalledWith(updated);
    expect(res.json).toHaveBeenCalledWith({
      data: { product: { __s: true, ...updated } },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'U1' }, body: {} };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('nope');

    asMock(ProductService.update).mockRejectedValue(boom);

    await ProductController.update(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('ProductController.remove', () => {
  test('200 + success', async () => {
    const req: any = { params: { id: 'D1' } };
    const res = makeRes();
    const next = makeNext();

    asMock((ProductService as any).delete).mockResolvedValue({ success: true });

    await ProductController.remove(req, res, next);

    expect((ProductService as any).delete).toHaveBeenCalledWith('D1');
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'D1' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('delete fail');

    asMock((ProductService as any).delete).mockRejectedValue(boom);

    await ProductController.remove(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
