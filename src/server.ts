// src/server.ts
/**
 * Express server bootstrap with Sequelize (MySQL) & MongoDB connections + unified health at "/".
 * Uses the shared Express app from src/app.ts.
 */
import 'dotenv/config';
import { app } from './app.js';
import { initDb, pingDb, registerDbShutdown } from './db/sequelize.js';
import { connectMongoDB, pingMongoDB, closeMongoDB } from './db/mongo.js';
import { config } from './config/env.js';

// helpful behind reverse proxies
app.set('trust proxy', true);

/** Promise timeout helper for DB ping */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Root: unified status (app + both databases)
 * - 200 when all DBs ok, 503 when any DB down
 */
app.get('/', async (_req, res) => {
  let mysqlStatus: 'ok' | 'down';
  let mysqlError: string | undefined;
  let mongoStatus: 'ok' | 'down';
  let mongoError: string | undefined;

  // Check MySQL
  try {
    await withTimeout(pingDb(), 1500);
    mysqlStatus = 'ok';
  } catch (err: any) {
    mysqlStatus = 'down';
    mysqlError = err?.message ?? 'MySQL error';
  }

  // Check MongoDB
  try {
    await withTimeout(pingMongoDB(), 1500);
    mongoStatus = 'ok';
  } catch (err: any) {
    mongoStatus = 'down';
    mongoError = err?.message ?? 'MongoDB error';
  }

  const allDbsOk = mysqlStatus === 'ok' && mongoStatus === 'ok';

  const payload = {
    service: 'LAO MARKET API',
    status: 'ok', // app status
    env: config.nodeEnv,
    port: config.port,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    databases: {
      mysql:
        mysqlStatus === 'ok'
          ? { status: 'ok' }
          : { status: 'down', error: mysqlError },
      mongodb:
        mongoStatus === 'ok'
          ? { status: 'ok' }
          : { status: 'down', error: mongoError },
    },
  };

  res.status(allDbsOk ? 200 : 503).json(payload);
});

// Health endpoints
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/health/db', async (_req, res) => {
  const results: any = { time: new Date().toISOString() };
  let hasError = false;

  // Check MySQL
  try {
    await withTimeout(pingDb(), 1500);
    results.mysql = 'ok';
  } catch (err: any) {
    results.mysql = { status: 'down', error: err?.message ?? 'MySQL error' };
    hasError = true;
  }

  // Check MongoDB
  try {
    await withTimeout(pingMongoDB(), 1500);
    results.mongodb = 'ok';
  } catch (err: any) {
    results.mongodb = {
      status: 'down',
      error: err?.message ?? 'MongoDB error',
    };
    hasError = true;
  }

  res.status(hasError ? 500 : 200).json(results);
});

// Individual database health checks
app.get('/health/mysql', async (_req, res) => {
  try {
    await withTimeout(pingDb(), 1500);
    res.json({ mysql: 'ok', time: new Date().toISOString() });
  } catch (err: any) {
    res
      .status(500)
      .json({ mysql: 'down', error: err?.message ?? 'MySQL error' });
  }
});

app.get('/health/mongodb', async (_req, res) => {
  try {
    await withTimeout(pingMongoDB(), 1500);
    res.json({ mongodb: 'ok', time: new Date().toISOString() });
  } catch (err: any) {
    res
      .status(500)
      .json({ mongodb: 'down', error: err?.message ?? 'MongoDB error' });
  }
});

async function start() {
  try {
    // Initialize both databases
    await initDb(); // MySQL/Sequelize
    await connectMongoDB(); // MongoDB/Mongoose

    // Register shutdown handlers for both databases
    registerDbShutdown();
    registerMongoShutdown();

    app.listen(config.port, () => {
      console.log(
        `Server running at ${
          config.baseUrl ?? `http://localhost:${config.port}`
        } (port ${config.port})`
      );
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

/** Register graceful shutdown for MongoDB */
function registerMongoShutdown(): void {
  const handler = async () => {
    try {
      await closeMongoDB();
    } catch (err) {
      console.error('Error closing MongoDB:', err);
    }
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
}

start();
