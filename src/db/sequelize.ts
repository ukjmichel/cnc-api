// src/db/sequelize.ts
import { Sequelize } from 'sequelize-typescript';
import { config } from '../config/env.js';
import { registerAssociations } from '../models/associations.js';


const logging = config.dbLogSql ? (sql: string) => console.log(sql) : false;

export const sequelize = new Sequelize({
  dialect: 'mysql',
  host: config.mysqlHost,
  port: config.mysqlPort,
  database: config.mysqlDatabase,
  username: config.mysqlUser,
  password: config.mysqlPassword,
  logging,
  pool: config.mysqlPool,
  define: { timestamps: true, underscored: false },
  timezone: '+00:00',
});

// Add models and wire associations after constructing Sequelize
registerAssociations(sequelize);

export async function initDb(): Promise<void> {
  await sequelize.authenticate();

  switch (config.dbSync) {
    case 'sync':
      await sequelize.sync();
      console.log('🗄️  DB sync: sync');
      break;
    case 'alter':
      await sequelize.sync({ alter: true });
      console.log('🗄️  DB sync: alter');
      break;
    case 'force':
      await sequelize.sync({ force: true });
      console.log('🗄️  DB sync: force (tables dropped & recreated)');
      break;
    case 'none':
    default:
      console.log('🗄️  DB sync: none (no schema changes on boot)');
      break;
  }

  console.log('✅ Sequelize connected');
}

export async function pingDb(): Promise<void> {
  await sequelize.authenticate();
}
export async function closeDb(): Promise<void> {
  await sequelize.close();
}
export function registerDbShutdown(): void {
  const handler = async () => {
    try {
      await closeDb();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
}
