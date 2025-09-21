// src/routes/user.routes.ts

/**
 * =============================================================================
 * User routes — REST endpoints for user management
 * =============================================================================
 * Mount under: /api/users
 * =============================================================================
 */

import { Router } from 'express';
import { UserController } from '../controllers/user.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireEmployeeOrAdmin } from '../middlewares/requireRole.js';
// import { requireAuth } from '../middlewares/requireAuth.js'; // optional per route

export const userRouter = Router();

// Public/private policy is up to you; here's a typical pattern:
// userRouter.use(requireAuth); // enable if you want all user routes protected

/**
 * @swagger
 * tags:
 *   - name: Users
 *     description: User management and queries
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Authorization:
 *       type: object
 *       properties:
 *         role:
 *           type: string
 *           enum: [user, employee, administrator]
 *     User:
 *       type: object
 *       properties:
 *         userId:
 *           type: string
 *         username:
 *           type: string
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         verified:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         authorization:
 *           $ref: '#/components/schemas/Authorization'
 *     UserCreateInput:
 *       type: object
 *       required: [username, firstName, lastName, email, password]
 *       properties:
 *         username: { type: string }
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         email: { type: string, format: email }
 *         password: { type: string, format: password }
 *     UserUpdateInput:
 *       type: object
 *       properties:
 *         username: { type: string }
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         email: { type: string, format: email }
 *     ChangePasswordInput:
 *       type: object
 *       required: [currentPassword, newPassword]
 *       properties:
 *         currentPassword: { type: string }
 *         newPassword: { type: string }
 *     VerifiedInput:
 *       type: object
 *       required: [verified]
 *       properties:
 *         verified: { type: boolean }
 *     DataUser:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             user:
 *               $ref: '#/components/schemas/User'
 *     DataUsersWithMeta:
 *       type: object
 *       properties:
 *         data:
 *           type: object
 *           properties:
 *             users:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *         meta:
 *           type: object
 *           properties:
 *             total: { type: integer, example: 120 }
 *             page: { type: integer, example: 1 }
 *             pageSize: { type: integer, example: 20 }
 *             pages: { type: integer, example: 6 }
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
 * /api/users:
 *   post:
 *     summary: Create a user (default role "user")
 *     description: Creates a new user. The response strips any top-level `role` and exposes `authorization.role`.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserCreateInput'
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataUser'
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Conflict (duplicate email/username)
 *       500:
 *         description: Internal error
 */
userRouter.post(
  '/',
  requireAuth,
  requireEmployeeOrAdmin,
  UserController.create
);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List users with pagination and optional role filter
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Free-text search
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "createdAt:desc" }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, default: 20 }
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [user, employee, administrator]
 *         description: Controller-side role filter applied after fetching
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataUsersWithMeta'
 *       400:
 *         description: Invalid query
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal error
 */
userRouter.get('/', requireAuth, requireEmployeeOrAdmin, UserController.list);

/**
 * @swagger
 * /api/users/filter:
 *   get:
 *     summary: Advanced filter + q with optional role filter
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Free-text search
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [user, employee, administrator]
 *         description: Controller-side role filter applied after fetching
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, default: 20 }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "createdAt:desc" }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataUsersWithMeta'
 *       400:
 *         description: Invalid filters
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal error
 */
userRouter.get(
  '/filter',
  requireAuth,
  requireEmployeeOrAdmin,
  UserController.filter
);

/**
 * @swagger
 * /api/users/by-email:
 *   get:
 *     summary: Get a user by email
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema: { type: string, format: email }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataUser'
 *       400:
 *         description: Missing/invalid email
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
userRouter.get(
  '/by-email',
  requireAuth,
  requireEmployeeOrAdmin,
  UserController.getByEmail
);

/**
 * @swagger
 * /api/users/by-username:
 *   get:
 *     summary: Get a user by username
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataUser'
 *       400:
 *         description: Missing/invalid username
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
userRouter.get(
  '/by-username',
  requireAuth,
  requireEmployeeOrAdmin,
  UserController.getByUsername
);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get a user by ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataUser'
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
userRouter.get(
  '/:id',
  requireAuth,
  requireEmployeeOrAdmin,
  UserController.getById
);

/**
 * @swagger
 * /api/users/{id}:
 *   patch:
 *     summary: Update profile fields (no password)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserUpdateInput'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataUser'
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
userRouter.patch(
  '/:id',
  requireAuth,
  requireEmployeeOrAdmin,
  UserController.update
);

/**
 * @swagger
 * /api/users/{id}/password:
 *   patch:
 *     summary: Change a user's password
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordInput'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataSuccess'
 *       400:
 *         description: Validation error / weak password
 *       403:
 *         description: Forbidden / invalid current password
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
userRouter.patch(
  '/:id/password',
  requireAuth,
  requireEmployeeOrAdmin,
  UserController.changePassword
);

/**
 * @swagger
 * /api/users/{id}/verified:
 *   patch:
 *     summary: Set a user's verification status
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifiedInput'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataUser'
 *       400:
 *         description: Invalid body
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
userRouter.patch(
  '/:id/verified',
  requireAuth,
  requireEmployeeOrAdmin,
  UserController.setVerified
);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete a user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DataSuccess'
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal error
 */
userRouter.delete(
  '/:id',
  requireAuth,
  requireEmployeeOrAdmin,
  UserController.remove
);
