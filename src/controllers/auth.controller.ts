// src/controllers/auth.controller.ts

/**
 * =============================================================================
 * AuthController — HTTP layer for authentication
 * =============================================================================
 * Response shape (no JWTs in body; tokens are set as httpOnly cookies):
 *  - Success with user: { message: string, data: { user, authorization } }
 *  - Logout:            204 No Content (no body)
 *
 * Authorization shape
 *  - Always **only** `{ role }` (no userId/timestamps). Example: { authorization: { role: "employee" } }
 *
 * Endpoints
 *  - POST /api/auth/register → create account, set cookies, return user + authorization
 *  - POST /api/auth/login    → verify credentials, set cookies, return user + authorization
 *  - POST /api/auth/refresh  → rotate tokens using refresh cookie, set cookies, return user + authorization
 *  - POST /api/auth/logout   → clear cookies
 *  - GET  /api/auth/me       → return current user + authorization (requires requireAuth)
 *
 * Notes
 *  - Cookies are configured via AuthService.cookieSpec()
 *  - Business logic (register/login/refresh) resides in AuthService
 *  - Errors are thrown as domain errors (AuthError, DuplicateError, NotFoundError)
 *    and should be handled by your global error middleware.
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import {
  AuthorizationModel,
} from '../models/authorization.model.js';
import type { AuthenticatedRequest } from '../middlewares/requireAuth.js';
import type { LoginDTO, RegisterDTO } from '../types/auth.js';
import { Role } from '../types/authorization.js';

/**
 * Set access & refresh cookies using the AuthService cookie spec.
 *
 * @param {Response} res - Express response
 * @param {{ accessToken: string; refreshToken: string }} tokens - Tokens to set
 */
function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string }
) {
  const { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOpts, refreshCookieOpts } =
    AuthService.cookieSpec();

  res.cookie(ACCESS_COOKIE, tokens.accessToken, accessCookieOpts);
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOpts);
}

/**
 * Clear access & refresh cookies using the AuthService cookie spec.
 *
 * @param {Response} res - Express response
 */
function clearAuthCookies(res: Response) {
  const { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOpts, refreshCookieOpts } =
    AuthService.cookieSpec();

  // Ensure path/samesite/secure match when clearing
  res.clearCookie(ACCESS_COOKIE, { ...accessCookieOpts, maxAge: 0 });
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOpts, maxAge: 0 });
}

/**
 * Fetch the user's authorization and return only `{ role }`.
 *
 * @param {string} userId - The user's UUID
 * @returns {Promise<{ role: Role } | null>}
 */
async function fetchAuthorization(
  userId: string
): Promise<{ role: Role } | null> {
  const row = (await AuthorizationModel.findOne({
    where: { userId },
    attributes: ['role'],
    raw: true,
  })) as { role: Role } | null;

  return row ? { role: row.role } : null;
}

export class AuthController {
  /**
   * POST /api/auth/register
   * Create a new user account, create default authorization ('user'),
   * set login cookies, and return { user, authorization }.
   *
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body as RegisterDTO;
      const { user, tokens } = await AuthService.register(payload);
      setAuthCookies(res, tokens);

      const authorization = await fetchAuthorization(user.userId);

      return res
        .status(201)
        .json({ message: 'Account created', data: { user, authorization } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/auth/login
   * Verify credentials, set login cookies, and return { user, authorization }.
   *
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as LoginDTO;
      const { user, tokens } = await AuthService.login(data);
      setAuthCookies(res, tokens);

      const authorization = await fetchAuthorization(user.userId);

      return res.json({
        message: 'Login successful',
        data: { user, authorization },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/auth/refresh
   * Rotate access & refresh tokens using the refresh cookie.
   * Return { user, authorization } (no tokens in body).
   *
   * @param {Request} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { REFRESH_COOKIE } = AuthService.cookieSpec();
      const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
      if (!refreshToken)
        return res.status(401).json({ message: 'No refresh token' });

      const {
        user,
        accessToken,
        refreshToken: newRefresh,
      } = await AuthService.refresh(refreshToken);

      setAuthCookies(res, { accessToken, refreshToken: newRefresh });

      const authorization = await fetchAuthorization(user.userId);

      return res.json({
        message: 'Tokens refreshed',
        data: { user, authorization },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/auth/logout
   * Clear auth cookies.
   *
   * @param {Request} _req
   * @param {Response} res
   * @param {NextFunction} next
   */
  static async logout(_req: Request, res: Response, next: NextFunction) {
    try {
      clearAuthCookies(res);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/auth/me
   * Return the authenticated user and authorization.
   * Requires `requireAuth` middleware to populate `req.user`.
   *
   * @param {AuthenticatedRequest} req
   * @param {Response} res
   */
  static async me(req: AuthenticatedRequest, res: Response) {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

    const authorization = await fetchAuthorization(req.user.userId);

    return res.json({
      message: 'Current user',
      data: { user: req.user, authorization },
    });
  }
}
