// src/types/user.ts
import type { Optional } from 'sequelize';

export interface UserAttributes {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string; // hashed at rest (via model hooks)
  verified: boolean;
}

export type UserCreationAttributes = Optional<
  UserAttributes,
  'userId' | 'verified'
>;

export type StringMatch = 'exact' | 'like' | 'startsWith' | 'endsWith';

export interface UserFilters {
  userId?: string | string[];
  username?: string | string[];
  firstName?: string | string[];
  lastName?: string | string[];
  email?: string | string[];
  verified?: boolean;

  createdAtFrom?: string | Date;
  createdAtTo?: string | Date;
  updatedAtFrom?: string | Date;
  updatedAtTo?: string | Date;

  match?: StringMatch;
}

export interface CreateUserDTO {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface UpdateUserDTO {
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface ChangePasswordDTO {
  currentPassword: string;
  newPassword: string;
}

export interface ListUsersQuery {
  page?: number;
  pageSize?: number;

  /** Free-text search across username, email, firstName, lastName, userId */
  q?: string;

  /** Field-by-field filters */
  filters?: UserFilters;

  /** Sorting */
  orderBy?:
    | 'createdAt'
    | 'updatedAt'
    | 'username'
    | 'firstName'
    | 'lastName'
    | 'email'
    | 'role'; // <-- add role here
  orderDir?: 'ASC' | 'DESC';
}
