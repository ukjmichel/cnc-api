// src/test-utils/mysql.ts
import { sequelize } from '../db/sequelize';

export async function cleanAllTables(): Promise<void> {
  const qi = sequelize.getQueryInterface();

  // 1) Disable FKs so delete order doesn't matter
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');

  // 2) Get all table names (handles both string[] and { tableName }[])
  const raw = await qi.showAllTables();
  const tableNames = (raw as any[]).map((t) =>
    typeof t === 'string' ? t : t.tableName
  );

  // 3) Delete everything (no TRUNCATE); skip SequelizeMeta if present
  for (const name of tableNames) {
    if (String(name).toLowerCase() === 'sequelizemeta') continue;
    await sequelize.query(`DELETE FROM \`${name}\``);
  }

  // 4) Re-enable FKs
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
}
