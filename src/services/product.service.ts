// src/services/product.service.ts

/**
 * =============================================================================
 * ProductService — Business Logic Layer for Products (MySQL-ready)
 * =============================================================================
 * Purpose
 *  - Encapsulates all operations around the `ProductModel` (sequelize-typescript).
 *  - Returns **plain entities/collections**; controllers handle any `{ data: ... }` wrapping.
 *
 * Capabilities
 *  - CRUD: create, getById, update, delete
 *  - Lookups: getByCode (when productCode is present)
 *  - Listing: list (q + sort + pagination)
 *  - Filtering: filter (field-by-field + ranges)
 *
 * Notes
 *  - Uses a shared `withTransaction` helper from `src/utils/tx.ts`.
 *  - Built with symbol-safe where builders to avoid TS "unique symbol as index" issues.
 * =============================================================================
 */

import {
  Op,
  UniqueConstraintError,
  type Transaction,
  type FindOptions,
  type WhereOptions,
} from 'sequelize';

import { ProductModel } from '../models/product.model.js';
import { withTransaction } from '../utils/tx.js';

import type {
  CreateProductDTO,
  UpdateProductDTO,
  ListProductsQuery,
  ProductFilters,
  StringMatch,
} from '../types/product.js';

import { NotFoundError, DuplicateError } from '../errors/index.js';
import { ProductImageModel } from '../models/product-image.model.js';
import { publicUrlToAbsPathIfLocal, tryUnlink } from '../utils/upload.js';

export class ProductService {
  // ===== CRUD =====

  /**
   * Create a new product.
   *
   * Writes a single row in {@link ProductModel}. If `productCode` is present, it is
   * expected to be unique. Any model-level normalizations (e.g., trimming/uppercasing)
   * happen in model hooks.
   *
   * @param {CreateProductDTO} data - Input fields for a product.
   * @returns {Promise<Record<string, any>>} The created product as a plain JSON object.
   *
   * @example
   * await ProductService.create({
   *   productId: 'EAN:123',
   *   productCode: 'abc-123',
   *   productName: 'Sparkling Water',
   *   brands: 'Acme',
   *   quantity: 6,
   *   quantityUnit: 'bottles',
   *   description: '6x500ml pack'
   * });
   *
   * @throws {DuplicateError} When `productId` or `productCode` violates a unique constraint.
   */
  static async create(data: CreateProductDTO) {
    return withTransaction(async (t: Transaction) => {
      try {
        const product = await ProductModel.create(
          {
            productId: data.productId,
            productCode: data.productCode ?? null,
            productName: data.productName,
            brands: data.brands ?? null,
            quantity: data.quantity ?? null,
            quantityUnit: data.quantityUnit ?? null,
            description: data.description ?? null,
          },
          { transaction: t }
        );
        return product.toJSON();
      } catch (err: any) {
        if (err instanceof UniqueConstraintError) {
          // Likely productId PK or unique productCode violation
          throw new DuplicateError('Product ID or code already exists');
        }
        throw err;
      }
    });
  }

  /**
   * Get a single product by its primary key.
   *
   * @param {string} productId - Primary key of the product (e.g., EAN/UUID).
   * @returns {Promise<Record<string, any>>} The product as a plain JSON object.
   * @throws {NotFoundError} If no product is found.
   */
  static async getById(productId: string) {
    const product = await ProductModel.findByPk(productId);
    if (!product) throw new NotFoundError('Product not found');
    return product.toJSON();
  }

  /**
   * Get a single product by its unique code.
   *
   * Trims and uppercases the provided code to align with potential model
   * normalization hooks so lookups are stable.
   *
   * @param {string} productCode - Unique code to query by.
   * @returns {Promise<Record<string, any>>} The product as a plain JSON object.
   * @throws {NotFoundError} If no product is found for the given code.
   */
  static async getByCode(productCode: string) {
    // Normalize like the model hook (trim + uppercase) to ensure match
    const code = productCode?.trim().toUpperCase();
    const product = await ProductModel.findOne({
      where: { productCode: code },
    });
    if (!product) throw new NotFoundError('Product not found');
    return product.toJSON();
  }

  /**
   * Update a product by ID.
   *
   * Only allows fields present in {@link UpdateProductDTO}. Uses a transaction
   * and row-level lock to avoid write conflicts.
   *
   * @param {string} productId - Primary key of the product to update.
   * @param {UpdateProductDTO} updates - Partial set of updatable fields.
   * @returns {Promise<Record<string, any>>} The updated product as plain JSON.
   *
   * @throws {NotFoundError} If the product does not exist.
   * @throws {DuplicateError} If `productCode` (or PK, if changed) collides with another row.
   */
  static async update(productId: string, updates: UpdateProductDTO) {
    return withTransaction(async (t: Transaction) => {
      const product = await ProductModel.findByPk(productId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!product) throw new NotFoundError('Product not found');

      const allowed: UpdateProductDTO = {};
      if (updates.productCode !== undefined)
        allowed.productCode = updates.productCode;
      if (updates.productName !== undefined)
        allowed.productName = updates.productName;
      if (updates.brands !== undefined) allowed.brands = updates.brands;
      if (updates.quantity !== undefined) allowed.quantity = updates.quantity;
      if (updates.quantityUnit !== undefined)
        allowed.quantityUnit = updates.quantityUnit;
      if (updates.description !== undefined)
        allowed.description = updates.description;

      try {
        product.set(allowed as any);
        await product.save({ transaction: t });
        return product.toJSON();
      } catch (err: any) {
        if (err instanceof UniqueConstraintError) {
          // Unique productCode collision (or PK, if changed via set)
          throw new DuplicateError('Product code already exists');
        }
        throw err;
      }
    });
  }

  /**
   * Delete a product (and its related images), then best-effort delete local files.
   *
   * Steps (inside a single transaction):
   *  1) Lock the product row to ensure existence and avoid concurrent deletes.
   *  2) Load related {@link ProductImageModel} rows and collect their URLs.
   *  3) Delete image rows and the product row.
   *
   * After the transaction commits, any local files pointed to by image URLs
   * are unlinked (best-effort; failures are logged but do not throw).
   *
   * @param {string} productId - Primary key of the product to delete.
   * @returns {Promise<{ success: true }>} Success flag.
   *
   * @throws {NotFoundError} If the product does not exist.
   */
  static async delete(productId: string) {
    // We'll collect URLs inside the TX, then delete files after commit
    const urlsToDelete: string[] = [];

    await withTransaction(async (t: Transaction) => {
      // 1) Ensure product exists (lock for update)
      const product = await ProductModel.findByPk(productId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!product) throw new NotFoundError('Product not found');

      // 2) Find related images and collect URLs
      const imgs = await ProductImageModel.findAll({
        where: { productId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      urlsToDelete.push(...imgs.map((r) => r.get('url') as string));

      // 3) Explicitly delete image rows (don’t rely on DB cascade so we control cleanup)
      if (imgs.length) {
        await ProductImageModel.destroy({
          where: { productId },
          transaction: t,
        });
      }

      // 4) Delete product
      await ProductModel.destroy({
        where: { productId },
        transaction: t,
      });
    });

    // 5) After commit: best-effort unlink local files
    await Promise.all(
      urlsToDelete.map((u) =>
        tryUnlink(publicUrlToAbsPathIfLocal(u), 'product.service')
      )
    );

    return { success: true };
  }

  // ===== LIST & FILTER =====

  /**
   * List products with optional free-text search and pagination.
   *
   * The `q` parameter searches across `productId`, `productCode`, `productName`,
   * and `brands` using SQL `LIKE` semantics (case sensitivity depends on collation).
   *
   * @param {ListProductsQuery} [query]
   * @param {number} [query.page=1] - 1-based page index.
   * @param {number} [query.pageSize=20] - Page size.
   * @param {string} [query.q] - Free-text query.
   * @param {'createdAt'|'updatedAt'|'productName'|'productCode'|'brands'} [query.orderBy='createdAt'] - Sort column.
   * @param {'ASC'|'DESC'} [query.orderDir='DESC'] - Sort direction.
   *
   * @returns {Promise<{ products: Record<string, any>[]; total: number; page: number; pageSize: number; pages: number }>}
   */
  static async list(query: ListProductsQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query;

    const where = this.buildProductWhere(q, undefined);

    const options: FindOptions = {
      where,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [[orderBy, orderDir]],
    };

    const { rows, count } = await ProductModel.findAndCountAll(options);

    return {
      products: rows.map((p) => p.toJSON()),
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /**
   * Filter products using structured filters plus optional free-text `q`.
   *
   * See {@link ProductFilters} for all supported fields. Range filters are inclusive.
   * Quantity range ignores NULL quantities.
   *
   * @param {ListProductsQuery} [query]
   * @param {number} [query.page=1] - 1-based page index.
   * @param {number} [query.pageSize=20] - Page size.
   * @param {string} [query.q] - Free-text query across several fields.
   * @param {ProductFilters} [query.filters] - Structured filters (ids, codes, names, ranges).
   * @param {'createdAt'|'updatedAt'|'productName'|'productCode'|'brands'} [query.orderBy='createdAt'] - Sort column.
   * @param {'ASC'|'DESC'} [query.orderDir='DESC'] - Sort direction.
   *
   * @returns {Promise<{ products: Record<string, any>[]; total: number; page: number; pageSize: number; pages: number }>}
   */
  static async filter(query: ListProductsQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      filters,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query;

    const where = this.buildProductWhere(q, filters);

    const options: FindOptions = {
      where,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [[orderBy, orderDir]],
    };

    const { rows, count } = await ProductModel.findAndCountAll(options);

    return {
      products: rows.map((p) => p.toJSON()),
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  // ===== PRIVATE SEARCH HELPERS =====

  /**
   * Build a SQL LIKE/ILIKE pattern from a value and match mode.
   * Case sensitivity depends on DB collation.
   *
   * @private
   * @param {string} value - Raw string to patternize.
   * @param {StringMatch} mode - 'exact' | 'startsWith' | 'endsWith' | 'like'.
   * @returns {string} A pattern suitable for Sequelize LIKE operator.
   */
  private static patternFor(value: string, mode: StringMatch) {
    switch (mode) {
      case 'exact':
        return value;
      case 'startsWith':
        return `${value}%`;
      case 'endsWith':
        return `%${value}`;
      case 'like':
      default:
        return `%${value}%`;
    }
  }

  /**
   * Create a WHERE fragment for a single string field using a value or array of values.
   *
   * @private
   * @param {string} field - Column/attribute name.
   * @param {string|string[]} value - One or many values to match.
   * @param {StringMatch} mode - Matching mode.
   * @returns {WhereOptions} Sequelize where fragment.
   */
  private static stringFieldCondition(
    field: string,
    value: string | string[],
    mode: StringMatch
  ): WhereOptions {
    if (Array.isArray(value)) {
      if (mode === 'exact') return { [field]: { [Op.in]: value } };
      return {
        [Op.or]: value.map((v) => ({
          [field]: { [Op.like]: this.patternFor(v, mode) },
        })),
      };
    }
    if (mode === 'exact') return { [field]: value };
    return { [field]: { [Op.like]: this.patternFor(value, mode) } };
  }

  /**
   * Build a composite WHERE clause for products using free-text `q`
   * and structured filters.
   *
   * @private
   * @param {string|undefined} q - Free-text query applied across common fields.
   * @param {ProductFilters|undefined} filters - Structured field filters.
   * @returns {WhereOptions} Combined Sequelize where clause (possibly empty object).
   */
  private static buildProductWhere(
    q?: string,
    filters?: ProductFilters
  ): WhereOptions {
    const andParts: WhereOptions[] = [];

    // Free-text across id/code/name/brands
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      andParts.push({
        [Op.or]: [
          { productId: { [Op.like]: like } },
          { productCode: { [Op.like]: like } },
          { productName: { [Op.like]: like } },
          { brands: { [Op.like]: like } },
        ],
      });
    }

    if (filters) {
      const match: StringMatch = filters.match ?? 'like';

      if (filters.productId)
        andParts.push(
          this.stringFieldCondition('productId', filters.productId, match)
        );
      if (filters.productCode)
        andParts.push(
          this.stringFieldCondition('productCode', filters.productCode, match)
        );
      if (filters.productName)
        andParts.push(
          this.stringFieldCondition('productName', filters.productName, match)
        );
      if (filters.brands)
        andParts.push(
          this.stringFieldCondition('brands', filters.brands, match)
        );
      if (filters.quantityUnit)
        andParts.push(
          this.stringFieldCondition('quantityUnit', filters.quantityUnit, match)
        );

      // Quantity range (inclusive) — ignores NULL quantities
      if (
        typeof filters.quantityFrom === 'number' ||
        typeof filters.quantityTo === 'number'
      ) {
        const range = {
          ...(typeof filters.quantityFrom === 'number'
            ? { [Op.gte]: filters.quantityFrom }
            : {}),
          ...(typeof filters.quantityTo === 'number'
            ? { [Op.lte]: filters.quantityTo }
            : {}),
        };

        andParts.push({
          quantity: {
            [Op.and]: [{ [Op.not]: null }, range],
          },
        });
      }

      // createdAt range
      if (filters.createdAtFrom || filters.createdAtTo) {
        const createdCond = {
          ...(filters.createdAtFrom
            ? { [Op.gte]: new Date(filters.createdAtFrom) }
            : {}),
          ...(filters.createdAtTo
            ? { [Op.lte]: new Date(filters.createdAtTo) }
            : {}),
        };
        andParts.push({ createdAt: createdCond });
      }

      // updatedAt range
      if (filters.updatedAtFrom || filters.updatedAtTo) {
        const updatedCond = {
          ...(filters.updatedAtFrom
            ? { [Op.gte]: new Date(filters.updatedAtFrom) }
            : {}),
          ...(filters.updatedAtTo
            ? { [Op.lte]: new Date(filters.updatedAtTo) }
            : {}),
        };
        andParts.push({ updatedAt: updatedCond });
      }
    }

    return andParts.length ? ({ [Op.and]: andParts } as WhereOptions) : {};
  }
}

export const productService = ProductService;
