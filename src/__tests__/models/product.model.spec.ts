// src/__tests__/models/product.model.spec.ts
/**
 * =============================================================================
 * ProductModel (MySQL) — integration-ish tests (no skip logic)
 * =============================================================================
 * - productId must ALREADY satisfy the regex (hooks normalize AFTER validation)
 * - Validate normalization for productCode/name/brands/unit/description
 * - Fail fast if DB is not reachable
 * =============================================================================
 */




import { Sequelize } from 'sequelize-typescript';
import { UniqueConstraintError, ValidationError } from 'sequelize';

import { config } from '../../config/env.js';
import { ProductModel } from '../../models/product.model.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
import { sequelize } from '../../db/sequelize.js';

function makeSequelize(): Sequelize {
  return new Sequelize({
    dialect: 'mysql',
    host: config.mysqlHost,
    port: config.mysqlPort,
    database: config.mysqlDatabase,
    username: config.mysqlUser,
    password: config.mysqlPassword,
    logging: config.dbLogSql ? console.log : false,
    pool: {
      max: config.mysqlPool.max,
      min: config.mysqlPool.min,
      acquire: config.mysqlPool.acquire,
      idle: config.mysqlPool.idle,
    },
    models: [ProductModel],
  });
}

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync();
  await cleanAllTables(); 
});

afterAll(async () => {
  await sequelize.close();
});

afterEach(async () => {
  await cleanAllTables();
});

describe('ProductModel (MySQL)', () => {
  test('creates minimal product (required fields only)', async () => {
    const p = await ProductModel.create({
      productId: 'SKU-001', // already valid
      productName: '  Fancy Widget  ', // will be trimmed
    } as any);

    // Ensure nullable fields are present as null (not undefined)
    await p.reload();

    expect(p.productId).toBe('SKU-001'); // unchanged
    expect(p.productName).toBe('Fancy Widget');
    expect(p.productCode).toBeNull();
    expect(p.brands).toBeNull();
    expect(p.quantity).toBeNull();
    expect(p.quantityUnit).toBeNull();
  });

  test('normalizes fields on create & update', async () => {
    const p = await ProductModel.create({
      productId: 'id.01',
      productCode: ' ab-12 ',
      productName: '  Name  ',
      brands: '  Brand, Inc. ',
      quantity: 1.5,
      quantityUnit: '  KG ',
      description: '  Long desc  ',
    } as any);

    expect(p.productId).toBe('id.01');
    expect(p.productCode).toBe('AB-12');
    expect(p.productName).toBe('Name');
    expect(p.brands).toBe('Brand, Inc.');
    expect(p.quantity).toBeCloseTo(1.5, 6);
    expect(p.quantityUnit).toBe('kg');
    expect(p.description).toBe('Long desc');

    p.productCode = ' zx 9 ';
    p.productName = '  New Name  ';
    p.brands = '  ACME  ';
    p.quantityUnit = '  ML ';
    p.description = '  Updated  ';
    await p.save();

    expect(p.productCode).toBe('ZX 9');
    expect(p.productName).toBe('New Name');
    expect(p.brands).toBe('ACME');
    expect(p.quantityUnit).toBe('ml');
    expect(p.description).toBe('Updated');
  });

  test('quantity DECIMAL getter returns number', async () => {
    const p = await ProductModel.create({
      productId: 'QTY-1',
      productName: 'Qty Test',
      quantity: 12.345,
      quantityUnit: 'ml',
    } as any);

    expect(typeof p.quantity).toBe('number');
    expect(p.quantity!).toBeCloseTo(12.345, 6);
  });

  test('unique constraint on productCode (case-insensitive via normalization)', async () => {
    await ProductModel.create({
      productId: 'A1',
      productName: 'Alpha',
      productCode: 'abc',
    } as any);

    await expect(
      ProductModel.create({
        productId: 'A2',
        productName: 'Alpha 2',
        productCode: 'ABC', // collides with normalized 'abc' → 'ABC'
      } as any)
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  test('productCode is optional — NULL duplicates allowed', async () => {
    const p1 = await ProductModel.create({
      productId: 'N1',
      productName: 'No Code 1',
      productCode: null,
    } as any);
    const p2 = await ProductModel.create({
      productId: 'N2',
      productName: 'No Code 2',
      productCode: null,
    } as any);

    expect(p1.productCode).toBeNull();
    expect(p2.productCode).toBeNull();
    expect(p1.productId).toBe('N1');
    expect(p2.productId).toBe('N2');
  });

  test('validation: productId format/length', async () => {
    await expect(
      ProductModel.create({
        productId: 'bad id!', // space + exclamation
        productName: 'Good',
      } as any)
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      ProductModel.create({
        productId: '',
        productName: 'Good',
      } as any)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('validation: productName length', async () => {
    await expect(
      ProductModel.create({
        productId: 'ok-1',
        productName: 'A', // too short (< 2)
      } as any)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('validation: productCode length/format', async () => {
    await expect(
      ProductModel.create({
        productId: 'ok-2',
        productName: 'Good',
        productCode: 'X', // too short (< 2)
      } as any)
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      ProductModel.create({
        productId: 'ok-3',
        productName: 'Good',
        productCode: 'GOOD*CODE', // invalid char
      } as any)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('validation: quantity cannot be negative', async () => {
    await expect(
      ProductModel.create({
        productId: 'qty-neg',
        productName: 'Bad Qty',
        quantity: -1,
        quantityUnit: 'g',
      } as any)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('validation: quantityUnit length', async () => {
    await expect(
      ProductModel.create({
        productId: 'unit-1',
        productName: 'Bad Unit',
        quantity: 1,
        quantityUnit: '', // too short (<1)
      } as any)
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      ProductModel.create({
        productId: 'unit-2',
        productName: 'Bad Unit 2',
        quantity: 1,
        quantityUnit:
          'this-unit-value-is-way-too-long-to-be-accepted-by-the-model',
      } as any)
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
