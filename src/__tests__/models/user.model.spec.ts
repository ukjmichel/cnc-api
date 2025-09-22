// src/__tests__/models/user.model.spec.ts
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
import { AuthorizationModel } from '../../models/authorization.model.js';
import { config } from '../../config/env.js';
import { cleanAllTables } from '../../../test-utils/mysql.js';

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
  await sequelize.authenticate();
  await sequelize.sync();
  await sequelize.transaction(async (t) => {
    await cleanAllTables(t);
  });
});

afterEach(async () => {
  await sequelize.transaction(async (t) => {
    await cleanAllTables(t);
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('UserModel (MySQL)', () => {
  test('creates user, normalizes fields, hashes password, and hides it in JSON', async () => {
    const u = await UserModel.create({
      username: 'JohnDOE',
      firstName: ' John  ',
      lastName: "  O'Connor ",
      email: 'JOHN@EXAMPLE.COM', // no spaces; validators run first
      password: 'secret123',
      verified: false,
    });

    // Normalization
    expect(u.username).toBe('johndoe');
    expect(u.email).toBe('john@example.com');
    expect(u.firstName).toBe('John');
    expect(u.lastName).toBe("O'Connor");

    // Hashing + validation
    expect(u.password).not.toBe('secret123');
    expect(u.password.length).toBeGreaterThan(20);
    await expect(u.validatePassword('secret123')).resolves.toBe(true);
    await expect(u.validatePassword('wrong')).resolves.toBe(false);

    // toJSON omits password
    const json = u.toJSON() as any;
    expect(json.password).toBeUndefined();
    expect(json.username).toBe('johndoe');
  });

  test('unique constraints on username and email', async () => {
    await UserModel.create({
      username: 'uniqueuser',
      firstName: 'Alpha',
      lastName: 'Beta',
      email: 'u@e.com',
      password: 'x',
    });

    await expect(
      UserModel.create({
        username: 'uniqueuser', // dup username
        firstName: 'Gamma',
        lastName: 'Delta',
        email: 'another@e.com',
        password: 'y',
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError);

    await expect(
      UserModel.create({
        username: 'anotheruser',
        firstName: 'Epsilon',
        lastName: 'Zeta',
        email: 'u@e.com', // dup email
        password: 'z',
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  test('re-hashes when password changes (validatePassword respects new value)', async () => {
    const u = await UserModel.create({
      username: 'changer',
      firstName: 'Alice',
      lastName: 'Brown',
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
    const u = await UserModel.create({
      username: 'mixedCase',
      firstName: '  First ',
      lastName: ' Last  ',
      email: 'MIX@MAIL.COM',
      password: 'p',
    });

    u.username = 'MixedCASE2'; // no spaces
    u.email = 'SECOND@MAIL.COM'; // no spaces
    u.firstName = '  Alice ';
    u.lastName = ' SMITH  ';
    await u.save();

    expect(u.username).toBe('mixedcase2');
    expect(u.email).toBe('second@mail.com');
    expect(u.firstName).toBe('Alice');
    expect(u.lastName).toBe('SMITH');
  });
});
