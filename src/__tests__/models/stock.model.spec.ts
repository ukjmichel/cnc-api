/**
 * StockModel — integration (MySQL)
 *
 * Verifies:
 *  - create + normalization (trim location/zone), decimal support, toJSON surface
 *  - composite-unique (productId, location, zone, expirationDate)
 *  - FK integrity (product must exist)
 *  - CASCADE on product delete
 *  - updates re-run normalization and can hit unique violation
 */

import 'reflect-metadata';
import { describe, test, beforeAll, afterAll, expect } from '@jest/globals';
import { UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
import { ProductModel } from '../../models/product.model.js';
import { StockModel } from '../../models/stock.model.js';

// Helpers
const mkProductId = (p = 'SKU') =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('StockModel — integration (MySQL)', () => {
  // src/__tests__/models/stock-movement.model.spec.ts
  beforeAll(async () => {
    await sequelize.authenticate();
    await sequelize.sync(); 
    await cleanAllTables(); 
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('creates stock; trims location/zone; supports decimals; toJSON minimal', async () => {
    const productId = mkProductId();
    await ProductModel.create({
      productId,
      productName: 'Sparkling Water',
      brands: 'Acme',
    });

    const s = await StockModel.create({
      productId,
      quantity: 1.234, // DECIMAL(12,3)
      unitPrice: 9.99, // DECIMAL(12,2)
      location: '   A1   ',
      zone: '  Z-3  ',
      expirationDate: '2026-01-31',
    });

    const json = s.toJSON();
    expect(json.productId).toBe(productId);
    // normalized/trimmed
    expect(json.location).toBe('A1');
    expect(json.zone).toBe('Z-3');
    // decimals should round/serialize appropriately
    expect(Number(json.quantity)).toBeCloseTo(1.234, 3);
    expect(Number(json.unitPrice)).toBeCloseTo(9.99, 2);
    // minimal surface
    expect(Object.keys(json).sort()).toEqual(
      [
        'stockId',
        'productId',
        'quantity',
        'unitPrice',
        'location',
        'zone',
        'expirationDate',
        'createdAt',
        'updatedAt',
      ].sort()
    );
  });

  test('composite-unique: (productId, location, zone, expirationDate)', async () => {
    const productId = mkProductId();
    await ProductModel.create({
      productId,
      productName: 'Cola',
      brands: 'FizzCo',
    });

    await StockModel.create({
      productId,
      quantity: 2,
      unitPrice: 1.1,
      location: 'D1',
      zone: 'Z-5',
      expirationDate: '2026-03-01',
    });

    await expect(
      StockModel.create({
        productId,
        quantity: 3,
        unitPrice: 1.2,
        location: '  D1  ', // will trim to D1
        zone: '  Z-5  ', // will trim to Z-5
        expirationDate: '2026-03-01',
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError);

    // different expirationDate → allowed
    await expect(
      StockModel.create({
        productId,
        quantity: 3,
        unitPrice: 1.2,
        location: 'D1',
        zone: 'Z-5',
        expirationDate: '2026-04-01',
      })
    ).resolves.toBeDefined();
  });

  test('FK integrity: creating with non-existent productId fails', async () => {
    await expect(
      StockModel.create({
        productId: mkProductId(), // not in DB
        quantity: 1,
        unitPrice: 1.0,
        location: 'X1',
        zone: 'Z-1',
        expirationDate: null,
      })
    ).rejects.toBeDefined(); // Dialect throws a DB error (FK constraint)
  });

  test('CASCADE delete: deleting product removes its stocks', async () => {
    const productId = mkProductId();
    const p = await ProductModel.create({
      productId,
      productName: 'Tea',
      brands: 'Leafy',
    });
    await StockModel.create({
      productId,
      quantity: 5,
      unitPrice: 2.5,
      location: 'S1',
      zone: 'Z-2',
      expirationDate: '2026-05-01',
    });

    await p.destroy(); // CASCADE should clean child rows

    const remain = await StockModel.findAll({ where: { productId } });
    expect(remain.length).toBe(0);
  });

  test('updates re-run normalization; unique violation can happen on update', async () => {
    const productId = mkProductId();
    await ProductModel.create({
      productId,
      productName: 'Juice',
      brands: 'FruitCo',
    });

    // "a" and "b" share the same expirationDate to make collisions meaningful
    const exp = '2026-03-01';

    const a = await StockModel.create({
      productId,
      quantity: 2,
      unitPrice: 1.1,
      location: 'D1',
      zone: 'Z-5',
      expirationDate: exp,
    });

    const b = await StockModel.create({
      productId,
      quantity: 7,
      unitPrice: 1.3,
      location: 'D2',
      zone: 'Z-7',
      expirationDate: exp, // same as "a" so we can collide later
    });

    /**
     * IMPORTANT:
     * If your model uses shadow columns for the composite unique index
     * (e.g. _uk_* fields) and a normalize hook, set them explicitly so the
     * UPDATE hits the DB unique constraint in this test.
     */
    b.set({
      location: '  D1  ',
      zone: '   Z-5   ',
    });
    (b as any).set({
      _uk_productId: productId,
      _uk_location: 'D1',
      _uk_zone: 'Z-5',
      _uk_expirationDate: exp,
    });

    await expect(b.save()).rejects.toBeInstanceOf(UniqueConstraintError);

    // Benign update still normalizes and succeeds
    a.set({ location: '  D1  ', zone: '  Z-5  ' });
    await expect(a.save()).resolves.toBeDefined();
  });
});
