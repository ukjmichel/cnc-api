// src/config/sequelize.config.ts
/**
 * Programmatic Sequelize options built from centralized app config.
 *
 * Usage:
 *   import { Sequelize } from 'sequelize';
 *   import { sequelizeOptions } from '../config/sequelize.config.js';
 *   export const sequelize = new Sequelize(sequelizeOptions);
 */
import type { Options } from 'sequelize';

import { envToInt } from '../utils/envUtils.js'; // for optional pool/env knobs
import { config } from './env.js';

export const sequelizeOptions: Options = {
  dialect: 'mysql',
  host: config.mysqlHost,
  port: config.mysqlPort,
  username: config.mysqlUser,
  password: config.mysqlPassword,
  database: config.mysqlDatabase,

  // Optional SQL logging toggle via env (kept here so it’s easy to flip)
  logging: process.env.DB_LOG_SQL === 'true' ? console.log : false,

  // Match snake_case columns/tables if you prefer
  define: { underscored: true },

  // Pool tuning (safe defaults). You can also surface these in your config if desired.
  pool: {
    max: config.mysqlPool.max,
    min: config.mysqlPool.min,
    acquire: config.mysqlPool.acquire,
    idle: config.mysqlPool.idle,
  },
};
