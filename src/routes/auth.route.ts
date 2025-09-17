import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';

export const authRouter = Router();

authRouter.post('/register', AuthController.register);
authRouter.post('/login', AuthController.login);
authRouter.post('/refresh', AuthController.refresh);
authRouter.post('/logout', AuthController.logout);
authRouter.get('/me', requireAuth, AuthController.me);
