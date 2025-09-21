// src/routes/user.routes.ts

/**
 * =============================================================================
 * User routes — REST endpoints for user management
 * =============================================================================
 * Mount under: /api/users
 *
 * Notes
 * - Roles are stored in AuthorizationModel (not on UserModel).
 * - List/filter endpoints accept `?authRole=` (canonical) or `?role=` (alias)
 *   to filter by authorization role at the DB level.
 * - Setting a user's role is done via PATCH /api/users/:id/role.
 * - Access control: all routes require Employee or Admin EXCEPT
 *   - POST /api/users/employee (Admin only)
 *   - PATCH /api/users/:id/role (Admin only)
 * =============================================================================
 */

import { Router } from 'express';
import { UserController } from '../controllers/user.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import {
  requireEmployeeOrAdmin,
  requireAdmin,
} from '../middlewares/requireRole.js';

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
 * /api/users/employee:
 *   post:
 *     summary: Create an employee user (authorization role "employee")
 *     description: Creates a new user and assigns AuthorizationModel role "employee".
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
  '/employee',
  requireAuth,
  requireAdmin,
  UserController.createEmployee
);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List users with pagination and optional authorization role filter
 *     description: >
 *       Filters by role stored in AuthorizationModel. Accepts `role` (alias) or `authRole` (canonical).
 *       You may supply multiple values: `?authRole=employee&authRole=administrator`.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Free-text search
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, default: 20 }
 *       - in: query
 *         name: authRole
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [user, employee, administrator]
 *             - type: array
 *               items:
 *                 type: string
 *                 enum: [user, employee, administrator]
 *           example: [employee, administrator]
 *         description: DB-side filter via AuthorizationModel.role (canonical)
 *       - in: query
 *         name: role
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [user, employee, administrator]
 *             - type: array
 *               items:
 *                 type: string
 *                 enum: [user, employee, administrator]
 *         description: Alias of `authRole`
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "createdAt:desc" }
 *         description: Sorting (field:dir). Supported fields: createdAt, updatedAt, username, firstName, lastName, email
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
 *     summary: Advanced filter + q with optional authorization role filter
 *     description: >
 *       Filters by role stored in AuthorizationModel. Accepts `role` (alias) or `authRole` (canonical).
 *       You may supply multiple values: `?authRole=user&authRole=employee`.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Free-text search
 *       - in: query
 *         name: authRole
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [user, employee, administrator]
 *             - type: array
 *               items:
 *                 type: string
 *                 enum: [user, employee, administrator]
 *         description: DB-side role filter via AuthorizationModel.role (canonical)
 *       - in: query
 *         name: role
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [user, employee, administrator]
 *             - type: array
 *               items:
 *                 type: string
 *                 enum: [user, employee, administrator]
 *         description: Alias of `authRole`
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, default: 20 }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "createdAt:desc" }
 *         description: Sorting (field:dir). Supported fields: createdAt, updatedAt, username, firstName, lastName, email
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

/**
 * @swagger
 * /api/users/{id}/role:
 *   patch:
 *     summary: Set a user's role (AuthorizationModel)
 *     description: Assigns a role to a user in the AuthorizationModel. Returns the normalized user with `authorization: { role }`.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [user, employee, administrator]
 *     responses:
 *       200:
 *         description: Updated user
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal error
 */
userRouter.patch(
  '/:id/role',
  requireAuth,
  requireAdmin,
  UserController.setRole
);
