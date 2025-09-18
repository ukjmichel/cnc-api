import { Optional } from 'sequelize';
import { Role } from './authorization';

export interface JwtUser {
  userId: string;
  username: string;
  email: string;
  verified: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterDTO {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface LoginDTO {
  /** username or email */
  identifier: string;
  password: string;
}
