/**
 * =============================================================================
 * App — Express application bootstrap (no network listener here)
 * =============================================================================
 * Responsibilities
 *  - Create and configure the Express app instance.
 *  - Register global middleware (JSON body, cookies, etc.).
 *  - Mount routers (e.g., /api/auth).
 *
 * Notes
 *  - The server (port/listen) lives in src/server.ts.
 *  - This file is imported by tests as a pure app (supertest-friendly).
 * =============================================================================
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.route.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { userRouter } from './routes/user.route.js';
import productRouter from './routes/product.route.js';

export const app = express();

/** Core middleware */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/** Routes */
app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/products', productRouter);

app.use(errorHandler);
