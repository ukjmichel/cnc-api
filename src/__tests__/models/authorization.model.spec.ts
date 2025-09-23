// src/__tests__/models/authorization.model.spec.ts
/**
 * =============================================================================
 * AuthorizationModel (MySQL) — integration-ish tests
 * =============================================================================
 * Reads DB connection info from your dynamic config (src/config/env.ts).
 * Assumes DB is reachable; fails fast if not.
 *
 * Covers:
 *  - create with default role
 *  - enum validation (invalid role rejected)
 *  - unique constraint (one row per userId)
 *  - CASCADE delete: removing User deletes Authorization row
 * =============================================================================
 */

import 'reflect-metadata';
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from '@jest/globals';

import { Sequelize } from 'sequelize-typescript';
import { ValidationError, UniqueConstraintError } from 'sequelize';

import { UserModel } from '../../models/user.model.js';
import { AuthorizationModel } from '../../models/authorization.model.js';
import { config } from '../../config/env.js';
import { cleanAllTables } from '../../test-utils/mysql.js';

let sequelize: Sequelize;

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
    models: [UserModel, AuthorizationModel],
  });
}

beforeAll(async () => {
  sequelize = makeSequelize();

  // Fail fast if DB is not reachable
  await sequelize.authenticate();

  // Ensure schema exists without dropping; keeps FKs & indexes intact
  await sequelize.sync();

  // Start from a known-empty state (FK-safe)
  await sequelize.transaction(async (t) => {
    await cleanAllTables(t);
  });
});

afterAll(async () => {
  if (sequelize) await sequelize.close();
});

afterEach(async () => {
  // FK-safe cleanup between tests
  await sequelize.transaction(async (t) => {
    await cleanAllTables(t);
  });
});

describe('AuthorizationModel (MySQL)', () => {
  test('creates with default role "user"', async () => {
    const u = await UserModel.create({
      username: 'roleuser',
      firstName: 'Role',
      lastName: 'User',
      email: 'r@e.com',
      password: 'pw',
    });

    const a = await AuthorizationModel.create({ userId: u.userId } as any);

    expect(a.userId).toBe(u.userId);
    expect(a.role).toBe('user'); // defaultValue on column
  });

  test('rejects invalid role (enum validation)', async () => {
    const u = await UserModel.create({
      username: 'badrole',
      firstName: 'Bad',
      lastName: 'Role',
      email: 'b@r.com',
      password: 'pw',
    });

    await expect(
      AuthorizationModel.create({ userId: u.userId, role: 'superadmin' as any })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('enforces uniqueness (one Authorization per userId)', async () => {
    const u = await UserModel.create({
      username: 'uniq',
      firstName: 'Uniq',
      lastName: 'One',
      email: 'u@q.com',
      password: 'pw',
    });

    await AuthorizationModel.create({
      userId: u.userId,
      role: 'employee',
    } as any);

    await expect(
      AuthorizationModel.create({
        userId: u.userId,
        role: 'administrator',
      } as any)
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  test('CASCADE delete: deleting User removes Authorization row', async () => {
    const u = await UserModel.create({
      username: 'cascade',
      firstName: 'Cas',
      lastName: 'Cade',
      email: 'c@a.com',
      password: 'pw',
    });

    await AuthorizationModel.create({
      userId: u.userId,
      role: 'employee',
    } as any);

    // sanity: row exists
    const before = await AuthorizationModel.findOne({
      where: { userId: u.userId },
    });
    expect(before).not.toBeNull();

    await u.destroy(); // should cascade

    const after = await AuthorizationModel.findOne({
      where: { userId: u.userId },
    });
    expect(after).toBeNull();
  });
});
