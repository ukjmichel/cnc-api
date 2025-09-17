// src/server.ts
/**
 * Express server bootstrap with Sequelize DB connection & unified health at "/".
 * Uses the shared Express app from src/app.ts.
 */
import 'dotenv/config';
import { app } from './app.js';
import { initDb, pingDb, registerDbShutdown } from './db/sequelize.js';
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
 * Root: unified status (app + db)
 * - 200 when db ok, 503 when db down
 */
app.get('/', async (_req, res) => {
  let dbStatus: 'ok' | 'down';
  let dbError: string | undefined;

  try {
    await withTimeout(pingDb(), 1500);
    dbStatus = 'ok';
  } catch (err: any) {
    dbStatus = 'down';
    dbError = err?.message ?? 'DB error';
  }

  const payload = {
    service: 'LAO MARKET API',
    status: 'ok', // app status
    env: config.nodeEnv,
    port: config.port,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    db:
      dbStatus === 'ok' ? { status: 'ok' } : { status: 'down', error: dbError },
  };

  res.status(dbStatus === 'ok' ? 200 : 503).json(payload);
});

// Health endpoints
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/health/db', async (_req, res) => {
  try {
    await withTimeout(pingDb(), 1500);
    res.json({ db: 'ok', time: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ db: 'down', error: err?.message ?? 'DB error' });
  }
});

async function start() {
  try {
    await initDb();
    registerDbShutdown();

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

start();
