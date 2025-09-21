// src/routes/auth.routes.ts

/**
 * =============================================================================
 * Auth routes — registration, login, token refresh, logout, and current user
 * =============================================================================
 * Mount under: /api/auth
 *
 * Notes
 * - Only `GET /api/auth/me` requires authentication (via bearer JWT).
 * - `POST /api/auth/login` returns access/refresh tokens.
 * - `POST /api/auth/refresh` exchanges a valid refresh token for new tokens.
 * - `POST /api/auth/logout` invalidates the refresh token (implementation-specific).
 * - Registration typically creates a user account; your controller may also return tokens.
 * =============================================================================
 */

import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';

export const authRouter = Router();

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Authentication and session management
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Tokens:
 *       type: object
 *       properties:
 *         accessToken:
 *           type: string
 *           description: Short-lived JWT used for authenticated requests
 *         refreshToken:
 *           type: string
 *           description: Long-lived token used to obtain new access tokens
 *       required: [accessToken, refreshToken]
 *     AuthRegisterInput:
 *       type: object
 *       required: [username, firstName, lastName, email, password]
 *       properties:
 *         username: { type: string }
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         email: { type: string, format: email }
 *         password: { type: string, format: password }
 *     AuthLoginInput:
 *       type: object
 *       required: [usernameOrEmail, password]
 *       properties:
 *         usernameOrEmail: { type: string }
 *         password: { type: string, format: password }
 *     AuthRefreshInput:
 *       type: object
 *       required: [refreshToken]
 *       properties:
 *         refreshToken: { type: string }
 *     DataTokens:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/Tokens'
 *     # Reuse User schema from Users routes if defined there
 *     # Otherwise uncomment the minimal User schema below or adjust the $ref.
 *     # User:
 *     #   type: object
 *     #   properties:
 *     #     userId: { type: string }
 *     #     username: { type: string }
 *     #     firstName: { type: string }
 *     #     lastName: { type: string }
 *     #     email: { type: string, format: email }
 *     #     verified: { type: boolean }
 *     #     createdAt: { type: string, format: date-time }
 *     #     updatedAt: { type: string, format: date-time }
 *     #     authorization:
 *     #       type: object
 *     #       properties:
 *     #         role:
 *     #           type: string
 *     #           enum: [user, employee, administrator]
 *     DataUser:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             user:
 *               $ref: '#/components/schemas/User'
 *     DataUserAndTokens:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             user:
 *               $ref: '#/components/schemas/User'
 *             tokens:
 *               $ref: '#/components/schemas/Tokens'
 *     DataSuccess:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             success:
 *               type: boolean
 *               example: true
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthRegisterInput'
 *     responses:
 *       201:
 *         description: Registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/DataUserAndTokens'
 *                 - $ref: '#/components/schemas/DataUser'
 *       400:
 *         description: Validation error
 *       409:
 *         description: Conflict (duplicate email/username)
 *       500:
 *         description: Internal error
 */
authRouter.post('/register', AuthController.register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with username/email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthLoginInput'
 *     responses:
 *       200:
 *         description: Authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataTokens'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Internal error
 */
authRouter.post('/login', AuthController.login);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for new tokens
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthRefreshInput'
 *     responses:
 *       200:
 *         description: New tokens issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataTokens'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid or expired refresh token
 *       500:
 *         description: Internal error
 */
authRouter.post('/refresh', AuthController.refresh);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout and invalidate the refresh token
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataSuccess'
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal error
 */
authRouter.post('/logout', AuthController.logout);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the currently authenticated user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataUser'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal error
 */
authRouter.get('/me', requireAuth, AuthController.me);
