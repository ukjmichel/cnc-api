// src/models/user.model.ts
/**
 * =============================================================================
 * UserModel — Sequelize (sequelize-typescript)
 * =============================================================================
 * Table: users
 *
 * Fields
 *  - userId      UUIDv4 primary key (unique)
 *  - username    unique, normalized (trim+lowercase), 2–20 alphanumeric
 *  - firstName   2–30 chars, letters/space/hyphen/apostrophe, trimmed
 *  - lastName    2–30 chars, letters/space/hyphen/apostrophe, trimmed
 *  - email       unique, normalized (trim+lowercase), valid email
 *  - password    bcrypt hash (never exposed by toJSON)
 *  - verified    boolean (default: false)
 *  - createdAt / updatedAt
 *
 * Hooks
 *  - hashPassword       (BeforeCreate/BeforeUpdate): re-hash when password changes
 *    • salt rounds read from config/env (BCRYPT_SALT_ROUNDS or BCRYPT_ROUNDS)
 *  - normalizeFields    (BeforeCreate/BeforeUpdate): trim/lowercase as needed
 *
 * Methods
 *  - validatePassword(plain: string) → Promise<boolean>
 *  - toJSON() → plain object without `password`
 *
 * Notes
 *  - Unique indexes: uk_users_username, uk_users_email
 *  - Use mysql2 driver for MySQL; works with other Sequelize dialects as well.
 * =============================================================================
 */

import {
  Column,
  Model,
  Table,
  DataType,
  BeforeCreate,
  BeforeUpdate,
  Unique,
} from 'sequelize-typescript';
import bcrypt from 'bcrypt';
import { UserAttributes, UserCreationAttributes } from '../types/user.js';
import { config } from '../config/env.js'; // <- use your dynamic env

@Table({ tableName: 'users', timestamps: true })
export class UserModel
  extends Model<UserAttributes, UserCreationAttributes>
  implements UserAttributes
{
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
    unique: true,
  })
  declare userId: string;

  @Unique('uk_users_username')
  @Column({
    type: DataType.STRING(191),
    allowNull: false,
    validate: {
      len: { args: [2, 20], msg: 'Username must be between 2 and 20 characters' },
      is: { args: /^[a-zA-Z0-9]+$/, msg: 'Username can only contain letters and numbers' },
    },
  })
  declare username: string;

  @Column({
    type: DataType.STRING(191),
    allowNull: false,
    validate: {
      len: { args: [2, 30], msg: 'First name must be between 2 and 30 characters' },
      is: {
        args: /^[a-zA-ZÀ-ÖØ-öø-ÿ' -]+$/u,
        msg: 'First name can only contain letters, spaces, hyphens, and apostrophes',
      },
    },
  })
  declare firstName: string;

  @Column({
    type: DataType.STRING(191),
    allowNull: false,
    validate: {
      len: { args: [2, 30], msg: 'Last name must be between 2 and 30 characters' },
      is: {
        args: /^[a-zA-ZÀ-ÖØ-öø-ÿ' -]+$/u,
        msg: 'Last name can only contain letters, spaces, hyphens, and apostrophes',
      },
    },
  })
  declare lastName: string;

  @Unique('uk_users_email')
  @Column({
    type: DataType.STRING(191),
    allowNull: false,
    validate: { isEmail: { msg: 'Email must be valid' } },
  })
  declare email: string;

  @Column({ type: DataType.STRING(191), allowNull: false })
  declare password: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare verified: boolean;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  @BeforeCreate
  @BeforeUpdate
  static async hashPassword(instance: UserModel) {
    if (instance.changed('password')) {
      const rounds = Number(
        (config as any).BCRYPT_SALT_ROUNDS ??
          (config as any).BCRYPT_ROUNDS ??
          10
      );
      const salt = await bcrypt.genSalt(rounds);
      instance.password = await bcrypt.hash(instance.password, salt);
    }
  }

  @BeforeCreate
  @BeforeUpdate
  static normalizeFields(instance: UserModel) {
    if (instance.changed('email') && typeof instance.email === 'string') {
      instance.email = instance.email.trim().toLowerCase();
    }
    if (instance.changed('username') && typeof instance.username === 'string') {
      instance.username = instance.username.trim().toLowerCase();
    }
    if (instance.changed('firstName') && typeof instance.firstName === 'string') {
      instance.firstName = instance.firstName.trim();
    }
    if (instance.changed('lastName') && typeof instance.lastName === 'string') {
      instance.lastName = instance.lastName.trim();
    }
  }

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }

  toJSON() {
    const attributes = { ...this.get() } as Record<string, unknown>;
    delete attributes.password;
    return attributes;
  }
}
