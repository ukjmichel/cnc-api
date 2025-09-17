/**
 * Sequelize Authorization Model — associates a user with a role.
 *
 * Roles: "user" | "employee" | "administrator"
 * - PK/FK: userId (UUID) → users.userId
 * - CASCADE on user updates/deletes
 * - Timestamps enabled
 */

import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
  PrimaryKey,
} from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { UserModel } from './user.model.js';

export type Role = 'user' | 'employee' | 'administrator';

export interface AuthorizationAttributes {
  userId: string;
  role: Role;
}

export interface AuthorizationCreationAttributes
  extends Optional<AuthorizationAttributes, 'role'> {}

@Table({ tableName: 'authorization', timestamps: true })
export class AuthorizationModel
  extends Model<AuthorizationAttributes, AuthorizationCreationAttributes>
  implements AuthorizationAttributes
{
  /** FK + PK to users.userId */
  @ForeignKey(() => UserModel)
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    allowNull: false,
    unique: true, // PK implies unique; kept for clarity
  })
  declare userId: string;

  /** Assigned role */
  @Column({
    type: DataType.ENUM('user', 'employee', 'administrator'),
    allowNull: false,
    defaultValue: 'user',
    validate: {
      isIn: [['user', 'employee', 'administrator']],
    },
  })
  declare role: Role;

  /** Association to parent user (with cascade rules) */
  @BelongsTo(() => UserModel, {
    foreignKey: 'userId',
    targetKey: 'userId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  declare user: UserModel;

  // Timestamps (typing)
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}
