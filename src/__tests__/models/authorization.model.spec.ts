// src/__tests__/models/authorization.model.spec.ts
/**
 * AuthorizationModel (MySQL) — integration tests
 * - Utilise le sequelize partagé (src/db/sequelize.ts) pour éviter les doubles pools.
 * - Schéma propre avec sync({ force: true }).
 * - Nettoyage FK-safe entre tests via cleanAllTables().
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

import { ValidationError, UniqueConstraintError } from 'sequelize';

import { sequelize } from '../../db/sequelize.js';
import { UserModel } from '../../models/user.model.js';
import { AuthorizationModel } from '../../models/authorization.model.js';
import { cleanAllTables } from '../../test-utils/mysql.js';

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync(); 
  await cleanAllTables(); 
});

afterEach(async () => {
  await cleanAllTables();
});

afterAll(async () => {
  await sequelize.close(); 
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
    expect(a.role).toBe('user'); // defaultValue
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

    const before = await AuthorizationModel.findOne({
      where: { userId: u.userId },
    });
    expect(before).not.toBeNull();

    await u.destroy(); // CASCADE

    const after = await AuthorizationModel.findOne({
      where: { userId: u.userId },
    });
    expect(after).toBeNull();
  });
});
