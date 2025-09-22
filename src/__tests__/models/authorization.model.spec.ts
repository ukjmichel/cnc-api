/**
 * =============================================================================
 * AuthorizationModel (MySQL) — integration-ish tests
 * =============================================================================
 * Reads DB connection info from your dynamic config (src/config/env.ts).
 * If the DB isn't reachable in CI/local, tests will skip gracefully.
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

let sequelize: Sequelize;
let canConnect = false;

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
  try {
    await sequelize.authenticate();
    canConnect = true;
    await sequelize.sync({ force: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[AuthorizationModel MySQL tests] Skipping — cannot connect to MySQL:',
      (err as Error).message
    );
  }
});

afterAll(async () => {
  if (canConnect && sequelize) await sequelize.close();
});

afterEach(async () => {
  if (!canConnect) return;
  // Clear child table first (FK), then parent
  await AuthorizationModel.destroy({
    where: {},
    truncate: true,
    cascade: true,
  });
  await UserModel.destroy({ where: {}, truncate: true, cascade: true });
});

describe('AuthorizationModel (MySQL)', () => {
  const skipIfNoDB = () => {
    if (!canConnect) {
      // eslint-disable-next-line no-console
      console.warn(
        '[AuthorizationModel tests] DB not reachable; skipping test.'
      );
      return true;
    }
    return false;
  };

  test('creates with default role "user"', async () => {
    if (skipIfNoDB()) return;

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
    if (skipIfNoDB()) return;

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
    if (skipIfNoDB()) return;

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
    if (skipIfNoDB()) return;

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
