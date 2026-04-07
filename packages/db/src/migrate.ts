import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql);

async function main() {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './migrations' });
  console.log('Migrations complete.');
  await sql.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
