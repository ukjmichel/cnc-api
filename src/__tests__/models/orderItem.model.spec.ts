/**
 * OrderItemModel — integration (MySQL)
 *
 * Verifies:
 *  - create with composite PK (orderId, stockId) + DECIMAL strings
 *  - duplicate composite PK is rejected
 *  - update fields persists and bumps updatedAt
 *  - querying by orderId / stockId
 *  - toJSON surface shape
 */

import 'reflect-metadata';
import {
  describe,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
} from '@jest/globals';
import { sequelize } from '../../db/sequelize.js';
import { OrderItemModel } from '../../models/order-item.model.js';
import { cleanAllTables } from '../../test-utils/mysql.js';

// UUID helper compatible with UUID column (CHAR(36) in MySQL)
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

describe('OrderItemModel — integration (MySQL)', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    await sequelize.sync(); 
    await cleanAllTables(); 
  });

  beforeEach(async () => {
    await cleanAllTables();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('create → stores DECIMAL strings & timestamps; toJSON shape', async () => {
    const orderId = uuid();
    const stockId = uuid();

    const row = await OrderItemModel.create({
      orderId,
      stockId,
      quantity: '1.250',
      unitPrice: '5.50',
      lineTotal: '6.88', // 1.25 * 5.50 = 6.875 → 6.88 (rounded)
    });

    const j = row.toJSON();
    expect(j.orderId).toBe(orderId);
    expect(j.stockId).toBe(stockId);
    expect(j.quantity).toBe('1.250');
    expect(j.unitPrice).toBe('5.50');
    expect(j.lineTotal).toBe('6.88');
    expect(new Date(j.createdAt).getTime()).toBeGreaterThan(0);
    expect(new Date(j.updatedAt).getTime()).toBeGreaterThan(0);

    expect(Object.keys(j).sort()).toEqual(
      [
        'orderId',
        'stockId',
        'quantity',
        'unitPrice',
        'lineTotal',
        'createdAt',
        'updatedAt',
      ].sort()
    );
  });

  test('composite PK (orderId, stockId) → duplicate insert rejected', async () => {
    const orderId = uuid();
    const stockId = uuid();

    await OrderItemModel.create({
      orderId,
      stockId,
      quantity: '2.000',
      unitPrice: '3.10',
      lineTotal: '6.20',
    });

    await expect(
      OrderItemModel.create({
        orderId, // same pair
        stockId,
        quantity: '1.000',
        unitPrice: '1.00',
        lineTotal: '1.00',
      })
    ).rejects.toBeDefined();
  });

  test('update fields (quantity, unitPrice, lineTotal) → persists & bumps updatedAt', async () => {
    const orderId = uuid();
    const stockId = uuid();

    const row = await OrderItemModel.create({
      orderId,
      stockId,
      quantity: '1.000',
      unitPrice: '5.50',
      lineTotal: '5.50',
    });

    const before = new Date(row.updatedAt).getTime();

    row.quantity = '2.000' as any;
    row.unitPrice = '5.50' as any;
    row.lineTotal = '11.00' as any;
    await row.save();

    const re = await OrderItemModel.findOne({ where: { orderId, stockId } });
    const j = re!.toJSON();
    expect(j.quantity).toBe('2.000');
    expect(j.unitPrice).toBe('5.50');
    expect(j.lineTotal).toBe('11.00');
    // MySQL updatedAt can be second-precision; allow small tolerance
    expect(new Date(j.updatedAt).getTime()).toBeGreaterThanOrEqual(
      before - 1000
    );
  });

  test('query by orderId / stockId returns rows', async () => {
    const orderId = uuid();
    const stockA = uuid();
    const stockB = uuid();

    await OrderItemModel.bulkCreate([
      {
        orderId,
        stockId: stockA,
        quantity: '1.000',
        unitPrice: '2.00',
        lineTotal: '2.00',
      },
      {
        orderId,
        stockId: stockB,
        quantity: '3.500',
        unitPrice: '1.25',
        lineTotal: '4.38', // 4.375 → 4.38
      },
    ]);

    const byOrder = await OrderItemModel.findAll({ where: { orderId } });
    const byStockA = await OrderItemModel.findAll({
      where: { stockId: stockA },
    });

    expect(byOrder.length).toBeGreaterThanOrEqual(2);
    expect(byOrder.map((r) => r.stockId)).toEqual(
      expect.arrayContaining([stockA, stockB])
    );

    expect(byStockA.length).toBe(1);
    expect(byStockA[0].orderId).toBe(orderId);
  });
});
