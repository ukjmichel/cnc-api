/**
 * Sequelize Model for Users (UserModel).
 * - UUID primary key
 * - Unique: userId, username, email
 * - Bcrypt password hashing (hooks)
 * - Normalization (lowercase/trim for email & username)
 * - Safe toJSON (password omitted)
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
import { Optional } from 'sequelize';
import { UserAttributes, UserCreationAttributes } from '../types/user';

// ----- Model -----
@Table({
  tableName: 'users',
  timestamps: true,
})
export class UserModel
  extends Model<UserAttributes, UserCreationAttributes>
  implements UserAttributes
{
  /** Primary key (UUID v4) — unique by definition */
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
    // `unique: true` is redundant when `primaryKey: true`,
    // but harmless if you prefer explicitness.
    unique: true,
  })
  declare userId: string;

  /** Unique username (alphanumeric, 2–20 chars) */
  @Unique('uk_users_username')
  @Column({
    type: DataType.STRING(191), // safe for unique indexes on utf8mb4
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

  /** First name */
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

  /** Last name */
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

  /** Unique email (normalized to lowercase) */
  @Unique('uk_users_email')
  @Column({
    type: DataType.STRING(191), // safe for unique indexes on utf8mb4
    allowNull: false,
    validate: {
      isEmail: { msg: 'Email must be valid' },
    },
  })
  declare email: string;

  /** Hashed password (bcrypt) */
  @Column({
    type: DataType.STRING(191),
    allowNull: false,
  })
  declare password: string;

  /** Email verification flag */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare verified: boolean;

  /** Timestamps */
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // ----- Hooks -----

  /** Hash password on create/update if changed */
  @BeforeCreate
  @BeforeUpdate
  static async hashPassword(instance: UserModel) {
    if (instance.changed('password')) {
      const salt = await bcrypt.genSalt(10);
      instance.password = await bcrypt.hash(instance.password, salt);
    }
  }

  /** Normalize fields (trim/lowercase where appropriate) */
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

  // ----- Methods -----

  /** Compare plaintext password against stored hash */
  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }

  /** Hide password in JSON output */
  toJSON() {
    const attributes = { ...this.get() } as Record<string, unknown>;
    delete attributes.password;
    return attributes;
  }
}
