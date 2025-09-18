import { Optional } from "sequelize";

export type Role = 'user' | 'employee' | 'administrator';

export interface AuthorizationAttributes {
  userId: string;
  role: Role;
}

export interface AuthorizationCreationAttributes
  extends Optional<AuthorizationAttributes, 'role'> {}
