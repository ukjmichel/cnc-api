

import {
  UniqueConstraintError,
  ValidationError,
  ForeignKeyConstraintError,
} from 'sequelize';
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
import { ProductModel } from '../../models/product.model.js';
import {
  ProductImageModel,
  PRODUCT_IMAGE_VARIANTS,
} from '../../models/product-image.model.js';

const mkProductId = (prefix = 'PROD') =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync(); 
  await cleanAllTables(); 
});

beforeEach(async () => {
  await cleanAllTables();
});
afterEach(async () => {
  await cleanAllTables();
});

afterAll(async () => {
  await sequelize.close();
});

describe('ProductImageModel — integration (MySQL)', () => {
  test('creates image; normalizes url/variant/alt; toJSON is minimal', async () => {
    const productId = mkProductId();
    // ✅ Create minimal valid product (avoid schema-specific constraints)
    await ProductModel.create({
      productId,
      productName: 'Sparkling Water',
    });

    const created = await ProductImageModel.create({
      productId,
      url: '  https://cdn.example.com/img.jpg  ',
      variant: 'cover', // will be normalized to lowercase
      alt: '  Nice photo  ',
    });

    expect(created.url).toBe('https://cdn.example.com/img.jpg');
    expect(created.variant).toBe('cover');
    expect(created.alt).toBe('Nice photo');

    const json = created.toJSON();
    expect(Object.keys(json).sort()).toEqual(
      ['imageId', 'productId', 'url', 'variant', 'alt'].sort()
    );
    expect(json.productId).toBe(productId);
    expect(json.variant).toBe('cover');
  });

  test('enforces unique (productId, variant)', async () => {
    const productId = mkProductId();
    await ProductModel.create({ productId, productName: 'Soda' });

    await ProductImageModel.create({
      productId,
      url: 'https://x/cover1.jpg',
      variant: 'cover',
    });

    await expect(
      ProductImageModel.create({
        productId,
        url: 'https://x/cover2.jpg',
        variant: 'cover',
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  test('allows same variant for different products', async () => {
    const p1 = mkProductId('A');
    const p2 = mkProductId('B');
    await ProductModel.bulkCreate([
      { productId: p1, productName: 'A' },
      { productId: p2, productName: 'B' },
    ]);

    const [i1, i2] = await Promise.all([
      ProductImageModel.create({
        productId: p1,
        url: 'https://x.jpg',
        variant: 'cover',
      }),
      ProductImageModel.create({
        productId: p2,
        url: 'https://y.jpg',
        variant: 'cover',
      }),
    ]);

    expect(i1.variant).toBe('cover');
    expect(i2.variant).toBe('cover');
  });

  test('rejects invalid variant (ENUM)', async () => {
    const productId = mkProductId();
    await ProductModel.create({ productId, productName: 'Tea' });

    // MySQL returns a DatabaseError for invalid ENUM inserts.
    await expect(
      ProductImageModel.create({
        productId,
        url: 'https://x.jpg',
        variant: 'not_a_variant' as any,
      })
    ).rejects.toHaveProperty(
      'name',
      expect.stringMatching(/Sequelize(Validation|Database)Error/)
    );

    // sanity: valid variant works
    await expect(
      ProductImageModel.create({
        productId,
        url: 'https://x.jpg',
        variant: PRODUCT_IMAGE_VARIANTS[0],
      })
    ).resolves.toBeTruthy();
  });

  test('rejects empty url (length validation)', async () => {
    const productId = mkProductId();
    await ProductModel.create({ productId, productName: 'Juice' });

    await expect(
      ProductImageModel.create({
        productId,
        url: '', // too short
        variant: 'front',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('FK integrity: creating with non-existent productId fails', async () => {
    const missingId = mkProductId('MISSING');

    await expect(
      ProductImageModel.create({
        productId: missingId,
        url: 'https://x.jpg',
        variant: 'back',
      })
    ).rejects.toBeInstanceOf(ForeignKeyConstraintError);
  });

  test('CASCADE delete: removing product removes its images', async () => {
    const productId = mkProductId();
    await ProductModel.create({ productId, productName: 'Coffee' });

    await ProductImageModel.bulkCreate([
      { productId, url: 'https://x1.jpg', variant: 'front' },
      { productId, url: 'https://x2.jpg', variant: 'back' },
    ]);

    const before = await ProductImageModel.findAll({ where: { productId } });
    expect(before).toHaveLength(2);

    await ProductModel.destroy({ where: { productId } });

    const after = await ProductImageModel.findAll({ where: { productId } });
    expect(after).toHaveLength(0);
  });

  test('updates re-run normalization (e.g., variant uppercased → lowercased)', async () => {
    const productId = mkProductId();
    await ProductModel.create({ productId, productName: 'Cereal' });

    const img = await ProductImageModel.create({
      productId,
      url: 'https://x.jpg',
      variant: 'front',
      alt: '  label  ',
    });

    img.variant = 'FRONT' as any;
    img.alt = '  new label  ';
    await img.save();

    expect(img.variant).toBe('front');
    expect(img.alt).toBe('new label');
  });
});
