// src/__tests__/controllers/product.controller.spec.ts

/**
 * ProductController — unit tests (pure Jest mocks; no DB)
 * @jest-environment node
 */


/* ================================ Helpers ================================= */

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function makeNext() {
  return jest.fn();
}

/* ========================= Mock setup ========================= */

const mockCreate = jest.fn();
const mockGetById = jest.fn();
const mockGetByCode = jest.fn();
const mockList = jest.fn();
const mockFilter = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

const mockSerializeProduct = jest.fn((p: any) => ({ __s: true, ...p }));
const mockSerializeProducts = jest.fn((arr: any[]) =>
  (arr || []).map((p) => ({ __s: true, ...p }))
);

const mockBuildListQuery = jest.fn((q: Record<string, unknown>) => ({
  __built: 'list',
  ...q,
}));

const mockBuildFilterQuery = jest.fn((q: Record<string, unknown>) => ({
  __built: 'filter',
  ...q,
}));

// Mock modules
jest.mock('../../services/product.service.js', () => ({
  ProductService: {
    create: mockCreate,
    getById: mockGetById,
    getByCode: mockGetByCode,
    list: mockList,
    filter: mockFilter,
    update: mockUpdate,
    delete: mockDelete,
  },
}));

jest.mock('../../serializers/product.serializer.js', () => ({
  serializeProduct: mockSerializeProduct,
  serializeProducts: mockSerializeProducts,
}));

jest.mock('../../queries/product.queries.js', () => ({
  buildProductListQuery: mockBuildListQuery,
  buildProductFilterQuery: mockBuildFilterQuery,
}));

/* ========================= Import after mocks ========================= */

import { ProductController } from '../../controllers/product.controller.js';

/* ================================ Lifecycle ================================= */

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockCreate.mockClear();
  mockGetById.mockClear();
  mockGetByCode.mockClear();
  mockList.mockClear();
  mockFilter.mockClear();
  mockUpdate.mockClear();
  mockDelete.mockClear();
  mockSerializeProduct.mockClear();
  mockSerializeProduct.mockImplementation((p: any) => ({ __s: true, ...p }));
  mockSerializeProducts.mockClear();
  mockSerializeProducts.mockImplementation((arr: any[]) =>
    (arr || []).map((p) => ({ __s: true, ...p }))
  );
  mockBuildListQuery.mockClear();
  mockBuildListQuery.mockImplementation((q: Record<string, unknown>) => ({
    __built: 'list',
    ...q,
  }));
  mockBuildFilterQuery.mockClear();
  mockBuildFilterQuery.mockImplementation((q: Record<string, unknown>) => ({
    __built: 'filter',
    ...q,
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/* ================================= Tests ================================= */

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
    mockCreate.mockResolvedValue(created);

    await ProductController.create(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith(req.body);
    expect(mockSerializeProduct).toHaveBeenCalledWith(created);
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

    mockCreate.mockRejectedValue(boom);

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
    mockGetById.mockResolvedValue(found);

    await ProductController.getById(req, res, next);

    expect(mockGetById).toHaveBeenCalledWith('P1');
    expect(mockSerializeProduct).toHaveBeenCalledWith(found);
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

    mockGetById.mockRejectedValue(boom);

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
    expect(mockGetByCode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('200 + serialized product', async () => {
    const req: any = { query: { productCode: 'abc-123' } };
    const res = makeRes();
    const next = makeNext();

    const found = { productId: 'P2', productCode: 'ABC-123' };
    mockGetByCode.mockResolvedValue(found);

    await ProductController.getByCode(req, res, next);

    expect(mockGetByCode).toHaveBeenCalledWith('abc-123');
    expect(mockSerializeProduct).toHaveBeenCalledWith(found);
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

    mockGetByCode.mockRejectedValue(boom);
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
    mockList.mockResolvedValue({
      products: rows,
      total: 42,
      page: 3,
      pageSize: 10,
      pages: 5,
    });

    await ProductController.list(req, res, next);

    expect(mockBuildListQuery).toHaveBeenCalledWith(req.query);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ __built: 'list' })
    );
    expect(mockSerializeProducts).toHaveBeenCalledWith(rows as any);
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

    mockList.mockRejectedValue(boom);

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
    mockFilter.mockResolvedValue({
      products: rows,
      total: 1,
      page: 1,
      pageSize: 20,
      pages: 1,
    });

    await ProductController.filter(req, res, next);

    expect(mockBuildFilterQuery).toHaveBeenCalledWith(req.query);
    expect(mockFilter).toHaveBeenCalledWith(
      expect.objectContaining({ __built: 'filter' })
    );
    expect(mockSerializeProducts).toHaveBeenCalledWith(rows as any);
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

    mockFilter.mockRejectedValue(boom);

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
    mockUpdate.mockResolvedValue(updated);

    await ProductController.update(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith('U1', req.body);
    expect(mockSerializeProduct).toHaveBeenCalledWith(updated);
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

    mockUpdate.mockRejectedValue(boom);

    await ProductController.update(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('ProductController.remove', () => {
  test('200 + success', async () => {
    const req: any = { params: { id: 'D1' } };
    const res = makeRes();
    const next = makeNext();

    mockDelete.mockResolvedValue({ success: true });

    await ProductController.remove(req, res, next);

    expect(mockDelete).toHaveBeenCalledWith('D1');
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } });
    expect(next).not.toHaveBeenCalled();
  });

  test('on error -> next(err)', async () => {
    const req: any = { params: { id: 'D1' } };
    const res = makeRes();
    const next = makeNext();
    const boom = new Error('delete fail');

    mockDelete.mockRejectedValue(boom);

    await ProductController.remove(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
