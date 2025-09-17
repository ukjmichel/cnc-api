// src/services/auth.service.ts

/**
 * =============================================================================
 * AuthService — Authentication & Token Issuance Layer
 * =============================================================================
 * Purpose
 *  - Owns user authentication flows: register, login, refresh.
 *  - Issues and validates JWT access/refresh tokens.
 *  - Delegates password hashing/normalization to `UserModel` hooks.
 *
 * Config
 *  - All env-driven values come from `config` (src/config/env.ts):
 *      * `config.jwtSecret`, `config.jwtRefreshSecret`
 *      * `config.jwtExpiresIn`, `config.jwtRefreshExpiresIn`
 *      * `config.nodeEnv`, `config.accessCookieName`, `config.refreshCookieName`
 *
 * Security
 *  - httpOnly cookies; `secure` + stricter `sameSite` in production.
 *  - Refresh token rotation on each refresh.
 *
 * Errors
 *  - DuplicateError (409) on unique username/email.
 *  - AuthError (401) on invalid credentials/tokens.
 *  - NotFoundError (404) if the user no longer exists.
 * =============================================================================
 */

import jwt, {
  type Secret,
  type SignOptions,
  type JwtPayload,
} from 'jsonwebtoken';
import type { CookieOptions } from 'express';
import { Op, Transaction } from 'sequelize';

import { config } from '../config/env.js';
import { sequelize } from '../db/sequelize.js';
import { UserModel } from '../models/user.model.js';
import { AuthorizationModel } from '../models/authorization.model.js'; // <-- add
import { NotFoundError, AuthError, DuplicateError } from '../errors/index.js';
import type {
  RegisterDTO,
  LoginDTO,
  JwtUser,
  AuthTokens,
} from '../types/auth.js';

/** Cookie key for short-lived access token (from config). */
const ACCESS_COOKIE = config.accessCookieName;
/** Cookie key for refresh token (from config). */
const REFRESH_COOKIE = config.refreshCookieName;

/** Prod flag (from config). */
const isProd = config.nodeEnv === 'production';

/** Strongly-typed secrets and sign options (prevents TS overload errors). */
const ACCESS_SECRET: Secret = config.jwtSecret;
const REFRESH_SECRET: Secret = config.jwtRefreshSecret;
const ACCESS_SIGN_OPTS: SignOptions = { expiresIn: config.jwtExpiresIn };
const REFRESH_SIGN_OPTS: SignOptions = {
  expiresIn: config.jwtRefreshExpiresIn,
};

/**
 * Parse a compact duration like "15m", "1h", "7d" to milliseconds.
 *
 * @param {string} s - Duration string (e.g., "15m", "1h", "7d").
 * @returns {number} Milliseconds representation (defaults to 15 minutes if invalid).
 */
function parseDurationToMs(s: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim());
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const unit = m[2];
  const mult =
    unit === 's'
      ? 1000
      : unit === 'm'
      ? 60000
      : unit === 'h'
      ? 3600000
      : 86400000;
  return n * mult;
}

/** Default cookie options for access token. */
const accessCookieOpts: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'strict' : 'lax',
  path: '/',
  maxAge: parseDurationToMs(config.jwtExpiresIn as unknown as string),
};

/** Default cookie options for refresh token (narrow path surface). */
const refreshCookieOpts: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'strict' : 'lax',
  path: '/api/auth/refresh',
  maxAge: parseDurationToMs(config.jwtRefreshExpiresIn as unknown as string),
};

/**
 * Project user model down to a safe JWT payload shape.
 *
 * @param {UserModel} u - Sequelize user instance.
 * @returns {JwtUser} Minimal, non-sensitive user representation.
 */
function toJwtUser(u: UserModel): JwtUser {
  return {
    userId: u.userId,
    username: u.username,
    email: u.email,
    verified: u.verified,
  };
}

/**
 * Sign an access token.
 *
 * @param {JwtUser} payload - User data to embed in token.
 * @returns {string} JWT access token.
 */
function signAccess(payload: JwtUser): string {
  return jwt.sign(payload, ACCESS_SECRET, ACCESS_SIGN_OPTS);
}

/**
 * Sign a refresh token (rotated on each refresh).
 *
 * @param {JwtUser} payload - User data to embed in token.
 * @returns {string} JWT refresh token.
 */
function signRefresh(payload: JwtUser): string {
  const body = { sub: payload.userId, type: 'refresh', user: payload };
  return jwt.sign(body, REFRESH_SECRET, REFRESH_SIGN_OPTS);
}

export class AuthService {
  /**
   * Register a new user and immediately issue access/refresh tokens.
   * Also creates a default authorization with role "user".
   *
   * @param {RegisterDTO} data - Registration payload.
   * @returns {Promise<{ user: JwtUser; tokens: AuthTokens }>} Created user (safe shape) and tokens.
   * @throws {DuplicateError} When username or email already exists.
   */
  static async register(
    data: RegisterDTO
  ): Promise<{ user: JwtUser; tokens: AuthTokens }> {
    return sequelize.transaction(async (t: Transaction) => {
      // Pre-check for nicer error (still backed by DB unique constraints)
      const existing = await UserModel.findOne({
        where: {
          [Op.or]: [{ username: data.username }, { email: data.email }],
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (existing)
        throw new DuplicateError('Username or email already exists');

      // Create the user
      const user = await UserModel.create(
        {
          username: data.username,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          password: data.password, // hashed by model hook
        },
        { transaction: t }
      );

      // Create default authorization (role: 'user') in the SAME transaction
      await AuthorizationModel.create(
        { userId: user.userId, role: 'user' },
        { transaction: t }
      );

      const jwtUser = toJwtUser(user);
      const tokens: AuthTokens = {
        accessToken: signAccess(jwtUser),
        refreshToken: signRefresh(jwtUser),
      };
      return { user: jwtUser, tokens };
    });
  }

  /**
   * Login with username **or** email, verify password, and issue tokens.
   *
   * @param {LoginDTO} payload - Identifier (username/email) and password.
   * @returns {Promise<{ user: JwtUser; tokens: AuthTokens }>} Safe user and fresh tokens.
   * @throws {AuthError} When credentials are invalid.
   */
  static async login(
    payload: LoginDTO
  ): Promise<{ user: JwtUser; tokens: AuthTokens }> {
    const { identifier, password } = payload;
    const lowered = identifier.toLowerCase();

    const user = await UserModel.findOne({
      where: { [Op.or]: [{ username: lowered }, { email: lowered }] },
    });
    if (!user) throw new AuthError('Invalid credentials');

    const valid = await user.validatePassword(password);
    if (!valid) throw new AuthError('Invalid credentials');

    const jwtUser = toJwtUser(user);
    const tokens: AuthTokens = {
      accessToken: signAccess(jwtUser),
      refreshToken: signRefresh(jwtUser),
    };
    return { user: jwtUser, tokens };
  }

  /**
   * Validate a refresh token and rotate both access & refresh tokens.
   *
   * @param {string} refreshToken - The httpOnly refresh token value.
   * @returns {Promise<AuthTokens & { user: JwtUser }>} New tokens and current user.
   * @throws {AuthError} When the refresh token is invalid or malformed.
   * @throws {NotFoundError} If the referenced user no longer exists.
   */
  static async refresh(
    refreshToken: string
  ): Promise<AuthTokens & { user: JwtUser }> {
    let decoded: JwtPayload | string;
    try {
      decoded = jwt.verify(refreshToken, REFRESH_SECRET) as JwtPayload | string;
    } catch {
      throw new AuthError('Invalid refresh token');
    }

    const userId = (decoded as any)?.user?.userId || (decoded as any)?.sub;
    if (!userId) throw new AuthError('Invalid refresh token');

    const user = await UserModel.findByPk(userId);
    if (!user) throw new NotFoundError('User not found');

    const jwtUser = toJwtUser(user);
    const tokens: AuthTokens = {
      accessToken: signAccess(jwtUser),
      refreshToken: signRefresh(jwtUser),
    };
    return { ...tokens, user: jwtUser };
  }

  /**
   * Return cookie names and default cookie options for controllers to set/clear.
   */
  static cookieSpec() {
    return {
      ACCESS_COOKIE,
      REFRESH_COOKIE,
      accessCookieOpts,
      refreshCookieOpts,
    };
  }
}
