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
// import { requireAuth } from '../middlewares/requireAuth.js'; // optional per route

export const userRouter = Router();

// Public/private policy is up to you; here's a typical pattern:
// userRouter.use(requireAuth); // enable if you want all user routes protected

// CRUD + list/filter
userRouter.post('/', requireAuth, UserController.create);
userRouter.get('/', requireAuth, UserController.list);
userRouter.get('/filter', /* requireAuth, */ UserController.filter);

// Single-entity lookups
userRouter.get('/by-email', requireAuth, UserController.getByEmail);
userRouter.get('/by-username', requireAuth, UserController.getByUsername);
userRouter.get('/:id', requireAuth, UserController.getById);

// Mutations
userRouter.patch('/:id', requireAuth, UserController.update);
userRouter.patch('/:id/password', requireAuth, UserController.changePassword);
userRouter.patch('/:id/verified', requireAuth, UserController.setVerified);
userRouter.delete('/:id', requireAuth, UserController.remove);
