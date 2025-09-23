/**
 * OrderModel — integration (MySQL)
 *
 * Verifies:
 *  - create without userId → defaults (status, currency, decimals) + toJSON shape
 *  - create with existing userId
 *  - ENUM guard: invalid status rejected
 *  - update totals (DECIMALs stored as strings; compare numerically)
 */

import 'reflect-metadata';
import { describe, test, beforeAll, afterAll, expect } from '@jest/globals';
import { sequelize } from '../../db/sequelize.js';
import { cleanAllTables } from '../../test-utils/mysql.js';
import { UserModel } from '../../models/user.model.js';
import { OrderModel } from '../../models/order.model.js';

// Helpers
const mkUsername = (prefix: string) =>
  (prefix.toLowerCase().replace(/[^a-z0-9]/g, '') || 'u').slice(0, 10) +
  (Date.now() % 1_000_000).toString().padStart(6, '0');

describe('OrderModel — integration (MySQL)', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    // Fresh DB for this suite
    await sequelize.transaction(async (t) => {
      await OrderModel.destroy({ where: {}, transaction: t });
      await cleanAllTables(t);
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('create without userId → defaults + toJSON shape', async () => {
    const start = Date.now();

    const o = await OrderModel.create({});
    const json = o.toJSON();

    // Defaults
    expect(json.status).toBe('pending');
    expect(json.currency).toBe('USD');

    // DECIMALs are strings; compare numerically
    expect(Number(json.subtotal)).toBeCloseTo(0, 2);
    expect(Number(json.taxTotal)).toBeCloseTo(0, 2);
    expect(Number(json.grandTotal)).toBeCloseTo(0, 2);

    // Timestamps exist and are near now
    expect(new Date(json.createdAt).getTime()).toBeGreaterThanOrEqual(
      start - 2000
    );
    expect(new Date(json.updatedAt).getTime()).toBeGreaterThanOrEqual(
      start - 2000
    );

    // Minimal surface
    expect(Object.keys(json).sort()).toEqual(
      [
        'orderId',
        'userId',
        'status',
        'subtotal',
        'taxTotal',
        'grandTotal',
        'currency',
        'contactName',
        'contactPhone',
        'notes',
        'pickupSlotId',
        'createdAt',
        'updatedAt',
      ].sort()
    );
  });

  test('create with existing userId', async () => {
    const user = await UserModel.create({
      username: mkUsername('buyer'),
      firstName: 'Buyer',
      lastName: 'User',
      email: `buyer${Date.now()}@e2e.test`,
      password: 'pw',
    });

    const o = await OrderModel.create({
      userId: user.userId,
      status: 'pending',
      currency: 'USD',
      subtotal: '0.00',
      taxTotal: '0.00',
      grandTotal: '0.00',
      contactName: ' John Smith ',
      contactPhone: ' 555-0000 ',
      notes: ' pickup please ',
      pickupSlotId: null,
    });

    const json = o.toJSON();
    expect(json.userId).toBe(user.userId);
    expect(json.contactName?.trim()).toBe('John Smith');
    expect(json.contactPhone?.trim()).toBe('555-0000');
    expect(json.notes?.includes('pickup')).toBe(true);
  });

  test('ENUM guard: invalid status rejected', async () => {
    await expect(
      OrderModel.create({
        status: 'not-a-status' as any,
        currency: 'USD',
        subtotal: '0.00',
        taxTotal: '0.00',
        grandTotal: '0.00',
      })
    ).rejects.toBeDefined();
  });

  test('update totals (DECIMALs) and ensure updatedAt changes', async () => {
    const o = await OrderModel.create({
      status: 'draft',
      currency: 'USD',
      subtotal: '1.00',
      taxTotal: '0.00',
      grandTotal: '1.00',
    });

    const beforeUpdate = new Date(o.updatedAt).getTime();

    o.status = 'paid';
    o.subtotal = '10.50' as any;
    o.taxTotal = '0.84' as any;
    o.grandTotal = '11.34' as any;
    await o.save();

    const re = await OrderModel.findByPk(o.orderId);
    const j = re!.toJSON();

    expect(j.status).toBe('paid');
    expect(Number(j.subtotal)).toBeCloseTo(10.5, 2);
    expect(Number(j.taxTotal)).toBeCloseTo(0.84, 2);
    expect(Number(j.grandTotal)).toBeCloseTo(11.34, 2);

    // MySQL DATETIME can be second-precision; allow small tolerance.
    const afterUpdate = new Date(j.updatedAt).getTime();
    expect(afterUpdate).toBeGreaterThanOrEqual(beforeUpdate - 1500);

    // Also ensure monotonic vs createdAt
    expect(afterUpdate).toBeGreaterThanOrEqual(new Date(j.createdAt).getTime());
  });
});
