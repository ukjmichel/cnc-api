// src/models/user.model.ts
/**
 * =============================================================================
 * UserModel — Sequelize (sequelize-typescript)
 * =============================================================================
 * Unique indexes are declared at BOTH the column and table level to ensure
 * MySQL creates (and later preserves) the DB-level constraints reliably.
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
  Index,
} from 'sequelize-typescript';
import bcrypt from 'bcrypt';
import { UserAttributes, UserCreationAttributes } from '../types/user.js';
import { config } from '../config/env.js';

@Table({
  tableName: 'users',
  timestamps: true,
  indexes: [
    { name: 'uk_users_username', unique: true, fields: ['username'] },
    { name: 'uk_users_email', unique: true, fields: ['email'] },
  ],
})
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
  @Index('uk_users_username')
  @Column({
    // 191 keeps unique index safe with utf8mb4 collations
    type: DataType.STRING(191),
    allowNull: false,
    validate: {
      len: {
        args: [2, 20],
        msg: 'Username must be between 2 and 20 characters',
      },
      is: {
        args: /^[a-zA-Z0-9]+$/,
        msg: 'Username can only contain letters and numbers',
      },
    },
  })
  declare username: string;

  @Column({
    type: DataType.STRING(191),
    allowNull: false,
    validate: {
      len: {
        args: [2, 30],
        msg: 'First name must be between 2 and 30 characters',
      },
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
      len: {
        args: [2, 30],
        msg: 'Last name must be between 2 and 30 characters',
      },
      is: {
        args: /^[a-zA-ZÀ-ÖØ-öø-ÿ' -]+$/u,
        msg: 'Last name can only contain letters, spaces, hyphens, and apostrophes',
      },
    },
  })
  declare lastName: string;

  @Unique('uk_users_email')
  @Index('uk_users_email')
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
  static normalizeFields(instance: UserModel) {
    if (instance.changed('email') && typeof instance.email === 'string') {
      instance.email = instance.email.trim().toLowerCase();
    }
    if (instance.changed('username') && typeof instance.username === 'string') {
      instance.username = instance.username.trim().toLowerCase();
    }
    if (
      instance.changed('firstName') &&
      typeof instance.firstName === 'string'
    ) {
      instance.firstName = instance.firstName.trim();
    }
    if (instance.changed('lastName') && typeof instance.lastName === 'string') {
      instance.lastName = instance.lastName.trim();
    }
  }

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

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }

  toJSON() {
    const attributes = { ...this.get() } as Record<string, unknown>;
    delete attributes.password;
    return attributes;
  }
}
