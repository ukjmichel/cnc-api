// src/__tests__/models/user.model.spec.ts
/**
 * =============================================================================
 * UserModel (MySQL) — integration tests (uses src/config/env.ts)
 * =============================================================================
 * This suite reads DB connection info from your dynamic config:
 *   import { config } from '../../config/env.js'
 * so values are resolved by `requireEnv` with TEST__* overrides when
 * NODE_ENV=test.
 *
 * It covers:
 *  - creation + normalization (username/email/first/last)
 *  - bcrypt hashing + validatePassword()
 *  - toJSON() hides password
 *  - unique constraints (username, email)
 *  - re-hash when password changes
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
import { UniqueConstraintError } from 'sequelize';
import { UserModel } from '../../models/user.model.js';
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
    models: [UserModel],
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
      '[UserModel MySQL tests] Skipping — cannot connect to MySQL:',
      (err as Error).message
    );
  }
});

afterAll(async () => {
  if (canConnect && sequelize) await sequelize.close();
});

afterEach(async () => {
  if (!canConnect) return;
  await UserModel.destroy({ where: {}, truncate: true, cascade: true });
});

describe('UserModel (MySQL)', () => {
  const skipIfNoDB = () => {
    if (!canConnect) {
      // eslint-disable-next-line no-console
      console.warn('[UserModel tests] DB not reachable; skipping test.');
      return true;
    }
    return false;
  };

  test('creates user, normalizes fields, hashes password, and hides it in JSON', async () => {
    if (skipIfNoDB()) return;

    const u = await UserModel.create({
      username: 'JohnDOE',
      firstName: ' John  ',
      lastName: "  O'Connor ",
      email: '  JOHN@EXAMPLE.COM ',
      password: 'secret123',
      verified: false,
    });

    // Normalization
    expect(u.username).toBe('johndoe');
    expect(u.email).toBe('john@example.com');
    expect(u.firstName).toBe('John');
    expect(u.lastName).toBe("O'Connor");

    // Hashing
    expect(u.password).not.toBe('secret123');
    expect(u.password.length).toBeGreaterThan(20);

    // Validate password
    await expect(u.validatePassword('secret123')).resolves.toBe(true);
    await expect(u.validatePassword('wrong')).resolves.toBe(false);

    // toJSON omits password
    const json = u.toJSON() as any;
    expect(json.password).toBeUndefined();
    expect(json.username).toBe('johndoe');
  });

  test('unique constraints on username and email', async () => {
    if (skipIfNoDB()) return;

    await UserModel.create({
      username: 'uniqueuser',
      firstName: 'A',
      lastName: 'B',
      email: 'u@e.com',
      password: 'x',
    });

    await expect(
      UserModel.create({
        username: 'uniqueuser',
        firstName: 'C',
        lastName: 'D',
        email: 'another@e.com',
        password: 'y',
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError);

    await expect(
      UserModel.create({
        username: 'anotheruser',
        firstName: 'E',
        lastName: 'F',
        email: 'u@e.com',
        password: 'z',
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  test('re-hashes when password changes (validatePassword respects new value)', async () => {
    if (skipIfNoDB()) return;

    const u = await UserModel.create({
      username: 'changer',
      firstName: 'A',
      lastName: 'B',
      email: 'changer@example.com',
      password: 'oldpass',
    });

    const oldHash = u.password;

    u.password = 'newpass';
    await u.save();

    expect(u.password).not.toBe(oldHash);
    await expect(u.validatePassword('oldpass')).resolves.toBe(false);
    await expect(u.validatePassword('newpass')).resolves.toBe(true);
  });

  test('normalizes on update as well', async () => {
    if (skipIfNoDB()) return;

    const u = await UserModel.create({
      username: 'mixedCase',
      firstName: '  First ',
      lastName: ' Last  ',
      email: 'MIX@MAIL.COM',
      password: 'p',
    });

    u.username = '  MixedCASE2 ';
    u.email = 'SECOND@MAIL.COM ';
    u.firstName = '  Alice ';
    u.lastName = ' SMITH  ';
    await u.save();

    expect(u.username).toBe('mixedcase2');
    expect(u.email).toBe('second@mail.com');
    expect(u.firstName).toBe('Alice');
    expect(u.lastName).toBe('SMITH');
  });
});
