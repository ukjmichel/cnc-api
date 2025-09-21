// src/services/product-image.service.ts

/**
 * =============================================================================
 * ProductImageService — Business Logic Layer for Product Images (MySQL-ready)
 * =============================================================================
 * Purpose
 *  - Encapsulates all operations around the `ProductImageModel`.
 *  - Returns **plain entities/collections**; controllers handle any `{ data: ... }` wrapping.
 *
 * Capabilities
 *  - CRUD: create, getById, update, delete
 *  - Lookups: getByProductAndVariant, deleteByProductAndVariant
 *  - Upsert helper: upsertVariant (create-or-update by {productId, variant})
 *  - Listing: list (q + sort + pagination)
 *  - Filtering: filter (field-by-field + ranges)
 *
 * Notes
 *  - Uses the shared `withTransaction` helper from `src/utils/tx.ts`.
 *  - Unique constraint expected on (productId, variant) at the DB level.
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

import {
  NotFoundError,
  DuplicateError,
  BadRequestError,
} from '../errors/index.js';

import type {
  CreateProductImageDTO,
  ListProductImagesQuery,
  ProductImageFilters,
  ProductImageVariant,
  StringMatch,
  UpdateProductImageDTO,
} from '../types/product-image.js';
import { PRODUCT_IMAGE_VARIANTS } from '../types/product-image.js';
import { ProductImageModel } from '../models/product-image.model.js';

// ---- small helpers ----
const ALLOWED_VARIANTS = new Set<string>(
  PRODUCT_IMAGE_VARIANTS as unknown as string[]
);

/**
 * Check whether a string is a valid product image variant.
 * @param {string} v - Variant to test.
 * @returns {v is ProductImageVariant} True if the value is allowed.
 */
function isAllowedVariant(v: string): v is ProductImageVariant {
  return ALLOWED_VARIANTS.has(v);
}

/**
 * Very light URL sanity check.
 * Accepts http(s) URLs or absolute/relative paths (starts with "/").
 * @param {string} v - The URL string.
 * @returns {boolean} True if it looks like a valid URL/path.
 */
function isLikelyUrl(v: string) {
  return /^https?:\/\/|^\//i.test(v);
}

export class ProductImageService {
  // ===== CRUD =====

  /**
   * Create a product image.
   *
   * @param {CreateProductImageDTO} data - Image payload (productId, variant, url, alt?).
   * @returns {Promise<unknown>} Created image as plain JSON.
   * @throws {BadRequestError} If required fields are missing/invalid.
   * @throws {NotFoundError} If the product does not exist.
   * @throws {DuplicateError} If (productId, variant) already exists.
   */
  static async create(data: CreateProductImageDTO) {
    // Input validation with custom errors
    if (!data.productId?.trim()) {
      throw new BadRequestError('productId is required');
    }
    if (!data.url?.trim() || !isLikelyUrl(data.url)) {
      throw new BadRequestError('Invalid image url', { url: data.url });
    }
    if (!data.variant || !isAllowedVariant(data.variant)) {
      throw new BadRequestError('Invalid image variant', {
        variant: data.variant,
        allowed: PRODUCT_IMAGE_VARIANTS,
      });
    }

    return withTransaction(async (t: Transaction) => {
      // ensure product exists (nicer than raw FK failure)
      const product = await ProductModel.findByPk(data.productId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!product) throw new NotFoundError('Product not found');

      try {
        const img = await ProductImageModel.create(
          {
            productId: data.productId,
            url: data.url,
            variant: data.variant,
            alt: data.alt ?? null,
          },
          { transaction: t }
        );
        return img.toJSON();
      } catch (err: any) {
        if (err instanceof UniqueConstraintError) {
          // likely the (productId, variant) unique index was violated
          throw new DuplicateError(
            `An image for variant "${data.variant}" already exists for this product`
          );
        }
        throw err;
      }
    });
  }

  /**
   * Get a product image by its primary key.
   * @param {string} imageId - Image ID.
   * @returns {Promise<unknown>} Image as plain JSON.
   * @throws {NotFoundError} If the image does not exist.
   */
  static async getById(imageId: string) {
    const img = await ProductImageModel.findByPk(imageId);
    if (!img) throw new NotFoundError('Image not found');
    return img.toJSON();
  }

  /**
   * Get a product image by natural key (productId, variant).
   * @param {string} productId - Product ID.
   * @param {ProductImageVariant} variant - Image variant (e.g., "front", "back").
   * @returns {Promise<unknown>} Image as plain JSON.
   * @throws {NotFoundError} If no matching image exists.
   */
  static async getByProductAndVariant(
    productId: string,
    variant: ProductImageVariant
  ) {
    const img = await ProductImageModel.findOne({
      where: { productId, variant },
    });
    if (!img) throw new NotFoundError('Image not found');
    return img.toJSON();
  }

  /**
   * Update a product image.
   * Only provided fields are validated and updated.
   *
   * @param {string} imageId - Image ID.
   * @param {UpdateProductImageDTO} updates - Partial updates (url, variant, alt).
   * @returns {Promise<unknown>} Updated image as plain JSON.
   * @throws {BadRequestError} If supplied fields are invalid.
   * @throws {NotFoundError} If the image does not exist.
   * @throws {DuplicateError} If updating variant causes a (productId, variant) conflict.
   */
  static async update(imageId: string, updates: UpdateProductImageDTO) {
    // Validate only provided fields
    if (
      updates.url !== undefined &&
      (!updates.url.trim() || !isLikelyUrl(updates.url))
    ) {
      throw new BadRequestError('Invalid image url', { url: updates.url });
    }
    if (updates.variant !== undefined && !isAllowedVariant(updates.variant)) {
      throw new BadRequestError('Invalid image variant', {
        variant: updates.variant,
        allowed: PRODUCT_IMAGE_VARIANTS,
      });
    }

    return withTransaction(async (t: Transaction) => {
      const img = await ProductImageModel.findByPk(imageId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!img) throw new NotFoundError('Image not found');

      const allowed: UpdateProductImageDTO = {};
      if (updates.url !== undefined) allowed.url = updates.url;
      if (updates.variant !== undefined) allowed.variant = updates.variant;
      if (updates.alt !== undefined) allowed.alt = updates.alt;

      try {
        img.set(allowed as any);
        await img.save({ transaction: t });
        return img.toJSON();
      } catch (err: any) {
        if (err instanceof UniqueConstraintError) {
          // changing variant could collide on (productId, variant)
          throw new DuplicateError(
            'Another image already uses this variant for the same product'
          );
        }
        throw err;
      }
    });
  }

  /**
   * Delete a product image by ID.
   * @param {string} imageId - Image ID.
   * @returns {Promise<{ success: true }>} Success flag.
   * @throws {NotFoundError} If no image was deleted.
   */
  static async delete(imageId: string) {
    return withTransaction(async (t: Transaction) => {
      const n = await ProductImageModel.destroy({
        where: { imageId },
        transaction: t,
      });
      if (!n) throw new NotFoundError('Image not found');
      return { success: true };
    });
  }

  // ===== UPSERT BY (productId, variant) =====

  /**
   * Create or update an image by natural key (productId, variant).
   * If an image exists, updates its url/alt. Otherwise, creates a new row.
   *
   * @param {CreateProductImageDTO} data - Payload containing productId, variant, url, alt?.
   * @returns {Promise<unknown>} Upserted image as plain JSON.
   * @throws {BadRequestError} If payload is invalid.
   * @throws {NotFoundError} If product does not exist.
   */
  static async upsertVariant(data: CreateProductImageDTO) {
    // same validations as create
    if (!data.productId?.trim()) {
      throw new BadRequestError('productId is required');
    }
    if (!data.url?.trim() || !isLikelyUrl(data.url)) {
      throw new BadRequestError('Invalid image url', { url: data.url });
    }
    if (!data.variant || !isAllowedVariant(data.variant)) {
      throw new BadRequestError('Invalid image variant', {
        variant: data.variant,
        allowed: PRODUCT_IMAGE_VARIANTS,
      });
    }

    return withTransaction(async (t: Transaction) => {
      const product = await ProductModel.findByPk(data.productId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!product) throw new NotFoundError('Product not found');

      const existing = await ProductImageModel.findOne({
        where: { productId: data.productId, variant: data.variant },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (existing) {
        existing.url = data.url;
        existing.alt = data.alt ?? null;
        await existing.save({ transaction: t });
        return existing.toJSON();
      }

      const created = await ProductImageModel.create(
        {
          productId: data.productId,
          variant: data.variant,
          url: data.url,
          alt: data.alt ?? null,
        },
        { transaction: t }
      );
      return created.toJSON();
    });
  }

  /**
   * Delete an image by (productId, variant).
   * @param {string} productId - Product ID.
   * @param {ProductImageVariant} variant - Variant to delete.
   * @returns {Promise<{ success: true }>} Success flag.
   * @throws {NotFoundError} If no row was deleted.
   */
  static async deleteByProductAndVariant(
    productId: string,
    variant: ProductImageVariant
  ) {
    return withTransaction(async (t: Transaction) => {
      const n = await ProductImageModel.destroy({
        where: { productId, variant },
        transaction: t,
      });
      if (!n) throw new NotFoundError('Image not found');
      return { success: true };
    });
  }

  /**
   * Delete **all** images for a product.
   * Also returns the URLs so that callers can remove files from storage.
   *
   * @param {string} productId - Product ID.
   * @returns {Promise<{ success: true; deleted: number; urls: string[] }>}
   *   - `deleted`: number of DB rows removed
   *   - `urls`: list of image URLs to clean up
   * @throws {NotFoundError} If no images exist for the product.
   */
  static async deleteAllByProduct(productId: string) {
    return withTransaction(async (t: Transaction) => {
      // Collect URLs first so we can remove files after DB delete
      const rows = await ProductImageModel.findAll({
        where: { productId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!rows.length) {
        throw new NotFoundError('No images found for this product');
      }

      const urls = rows.map((r) => r.toJSON().url);

      const deleted = await ProductImageModel.destroy({
        where: { productId },
        transaction: t,
      });

      return { success: true, deleted, urls };
    });
  }

  // ===== LIST & FILTER =====

  /**
   * List images with optional free-text `q` across url/alt/productId.
   *
   * @param {ListProductImagesQuery} [query]
   * @param {number} [query.page=1] - 1-based page number.
   * @param {number} [query.pageSize=20] - Page size.
   * @param {string} [query.q] - Free-text search term.
   * @param {'createdAt'|'updatedAt'|'url'|'alt'|'productId'} [query.orderBy='createdAt']
   * @param {'ASC'|'DESC'} [query.orderDir='DESC']
   * @returns {Promise<{ images: unknown[]; total: number; page: number; pageSize: number; pages: number }>}
   */
  static async list(query: ListProductImagesQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query;

    const where = this.buildImageWhere(q, undefined);

    const options: FindOptions = {
      where,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [[orderBy, orderDir]],
    };

    const { rows, count } = await ProductImageModel.findAndCountAll(options);

    // type the map param to avoid noImplicitAny
    const images = rows.map((r: ProductImageModel) => r.toJSON());

    return {
      images,
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /**
   * Filter images with structured filters + free-text `q`.
   *
   * @param {ListProductImagesQuery} [query]
   * @param {number} [query.page=1]
   * @param {number} [query.pageSize=20]
   * @param {string} [query.q]
   * @param {ProductImageFilters} [query.filters]
   * @param {'createdAt'|'updatedAt'|'url'|'alt'|'productId'} [query.orderBy='createdAt']
   * @param {'ASC'|'DESC'} [query.orderDir='DESC']
   * @returns {Promise<{ images: unknown[]; total: number; page: number; pageSize: number; pages: number }>}
   */
  static async filter(query: ListProductImagesQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      filters,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query;

    const where = this.buildImageWhere(q, filters);

    const options: FindOptions = {
      where,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [[orderBy, orderDir]],
    };

    const { rows, count } = await ProductImageModel.findAndCountAll(options);

    const images = rows.map((r: ProductImageModel) => r.toJSON());

    return {
      images,
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  // ===== PRIVATE SEARCH HELPERS =====

  /**
   * Build a SQL LIKE pattern based on match mode.
   * @param {string} value - Input value.
   * @param {StringMatch} mode - Match mode.
   * @returns {string} LIKE pattern.
   * @private
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
   * Build a where fragment for a single string field with a scalar or array input.
   * @param {string} field - Column/attribute name.
   * @param {string|string[]} value - Value(s) to match.
   * @param {StringMatch} mode - Matching mode.
   * @returns {WhereOptions} Sequelize where fragment.
   * @private
   */
  private static stringFieldCondition(
    field: string,
    value: string | string[],
    mode: StringMatch
  ): WhereOptions {
    if (Array.isArray(value)) {
      if (mode === 'exact') return { [field]: { [Op.in]: value } };
      return {
        [Op.or]: value.map((v: string) => ({
          [field]: { [Op.like]: this.patternFor(v, mode) },
        })),
      };
    }
    if (mode === 'exact') return { [field]: value };
    return { [field]: { [Op.like]: this.patternFor(value, mode) } };
  }

  /**
   * Build the composite WHERE clause for images using free-text `q` and structured filters.
   * @param {string} [q] - Free-text search applied to url/alt/productId.
   * @param {ProductImageFilters} [filters] - Structured filters.
   * @returns {WhereOptions} Combined where clause (or empty object).
   * @private
   */
  private static buildImageWhere(
    q?: string,
    filters?: ProductImageFilters
  ): WhereOptions {
    const andParts: WhereOptions[] = [];

    // Free-text across url/alt/productId
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      andParts.push({
        [Op.or]: [
          { url: { [Op.like]: like } },
          { alt: { [Op.like]: like } },
          { productId: { [Op.like]: like } },
        ],
      });
    }

    if (filters) {
      const match: StringMatch = filters.match ?? 'like';

      if (filters.productId) {
        andParts.push(
          this.stringFieldCondition('productId', filters.productId, match)
        );
      }
      if (filters.url) {
        andParts.push(this.stringFieldCondition('url', filters.url, match));
      }
      if (filters.alt) {
        andParts.push(this.stringFieldCondition('alt', filters.alt, match));
      }

      // variant: exact match or IN list
      if (filters.variant) {
        const variants = Array.isArray(filters.variant)
          ? filters.variant
          : [filters.variant];
        andParts.push({ variant: { [Op.in]: variants } });
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

export const productImageService = ProductImageService;
