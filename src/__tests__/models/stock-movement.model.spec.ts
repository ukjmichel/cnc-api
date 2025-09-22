/**
 * StockMovementModel — integration (MySQL)
 *
 * Verifies:
 *  - create + normalization (trim location/zone/reference) & DECIMAL support
 *  - ENUM guard on reason
 *  - FK integrity: product must exist
 *  - SET NULL on stock delete (movement persists, stockId -> null)
 *  - CASCADE on product delete (movement rows removed)
 *  - performedAt default (NOW)
 *  - toJSON surface
 */

import 'reflect-metadata';
import { describe, test, beforeAll, afterAll, expect } from '@jest/globals';
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../../test-utils/mysql.js';
import { ProductModel } from '../../models/product.model.js';
import { StockModel } from '../../models/stock.model.js';
import { StockMovementModel } from '../../models/stock-movement.model.js';

const mkProductId = (p = 'SKU') =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('StockMovementModel — integration (MySQL)', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    // Clean tables in safe FK order (movements -> stocks -> products -> auth/users via util)
    await sequelize.transaction(async (t) => {
      await StockMovementModel.destroy({ where: {}, transaction: t });
      await StockModel.destroy({ where: {}, transaction: t });
      await ProductModel.destroy({ where: {}, transaction: t });
      await cleanAllTables(t);
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('creates movement; trims fields; supports decimals; performedAt default; toJSON minimal', async () => {
    const productId = mkProductId();
    await ProductModel.create({
      productId,
      productName: 'Mineral Water',
      brands: 'Acme',
    });

    const stock = await StockModel.create({
      productId,
      quantity: 0,
      unitPrice: null,
      location: 'WH1',
      zone: 'Z-2',
      expirationDate: '2026-10-31',
    });

    const start = Date.now();
    const mv = await StockMovementModel.create({
      stockId: stock.stockId,
      productId,
      quantityDelta: 5.123, // DECIMAL(12,3)
      reason: 'in',
      reference: '  PO-001  ',
      location: '   WH1   ',
      zone: '  Z-2  ',
      expirationDate: '2026-10-31',
      unitPrice: 12.34, // DECIMAL(12,2)
      // performedAt omitted -> default NOW
    });

    const json = mv.toJSON();

    // Normalized/trimmed strings
    expect(json.location).toBe('WH1');
    expect(json.zone).toBe('Z-2');
    expect(json.reference).toBe('PO-001');

    // Numbers (DECIMALs) compare numerically
    expect(Number(json.quantityDelta)).toBeCloseTo(5.123, 3);
    expect(Number(json.unitPrice)).toBeCloseTo(12.34, 2);

    // performedAt defaulted near "now"
    const performedMs = new Date(json.performedAt as any).getTime();
    expect(performedMs).toBeGreaterThanOrEqual(start - 2000);
    expect(performedMs).toBeLessThanOrEqual(Date.now() + 2000);

    // Minimal surface
    expect(Object.keys(json).sort()).toEqual(
      [
        'movementId',
        'stockId',
        'productId',
        'quantityDelta',
        'reason',
        'reference',
        'location',
        'zone',
        'expirationDate',
        'unitPrice',
        'performedAt',
        'createdAt',
        'updatedAt',
      ].sort()
    );
  });

  test('ENUM guard: invalid reason is rejected', async () => {
    const productId = mkProductId();
    await ProductModel.create({
      productId,
      productName: 'Cola',
      brands: 'FizzCo',
    });

    await expect(
      StockMovementModel.create({
        stockId: null,
        productId,
        quantityDelta: 1,
        reason: 'not_a_reason' as any, // invalid
        reference: null,
        location: 'WH2',
        zone: null,
        expirationDate: null,
        unitPrice: null,
      })
    ).rejects.toBeDefined();
  });

  test('FK integrity: creating with non-existent productId fails', async () => {
    await expect(
      StockMovementModel.create({
        stockId: null,
        productId: mkProductId(), // not present
        quantityDelta: 1,
        reason: 'in',
        reference: 'X',
        location: 'WH3',
        zone: null,
        expirationDate: null,
        unitPrice: null,
      })
    ).rejects.toBeDefined();
  });

  test('SET NULL on stock delete: movement persists and stockId becomes null', async () => {
    const productId = mkProductId();
    await ProductModel.create({
      productId,
      productName: 'Tea',
      brands: 'Leafy',
    });

    const st = await StockModel.create({
      productId,
      quantity: 5,
      unitPrice: 2.5,
      location: 'S1',
      zone: 'Z-2',
      expirationDate: '2026-05-01',
    });

    const mv = await StockMovementModel.create({
      stockId: st.stockId,
      productId,
      quantityDelta: -2,
      reason: 'out',
      reference: null,
      location: 'S1',
      zone: 'Z-2',
      expirationDate: '2026-05-01',
      unitPrice: 2.5,
    });

    // Delete stock -> FK says SET NULL on movement.stockId
    await st.destroy();

    const reloaded = await StockMovementModel.findByPk(mv.movementId);
    expect(reloaded).toBeTruthy();
    expect(reloaded?.stockId).toBeNull();
  });

  test('CASCADE on product delete: deleting product removes its movements', async () => {
    const productId = mkProductId();
    const p = await ProductModel.create({
      productId,
      productName: 'Juice',
      brands: 'FruitCo',
    });

    await StockMovementModel.create({
      stockId: null,
      productId,
      quantityDelta: 10,
      reason: 'in',
      reference: 'INIT',
      location: 'WH1',
      zone: null,
      expirationDate: null,
      unitPrice: 1.1,
    });
    await StockMovementModel.create({
      stockId: null,
      productId,
      quantityDelta: -3,
      reason: 'out',
      reference: 'SO-1',
      location: 'WH1',
      zone: null,
      expirationDate: null,
      unitPrice: 1.1,
    });

    await p.destroy(); // should cascade to stock_movements

    const remain = await StockMovementModel.findAll({ where: { productId } });
    expect(remain.length).toBe(0);
  });
});
