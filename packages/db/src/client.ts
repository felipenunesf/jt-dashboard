import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';

let _queryClient: Sql | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  return url;
}

function ensureClient() {
  if (!_queryClient) {
    _queryClient = postgres(getDatabaseUrl(), {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    _db = drizzle(_queryClient, { schema });
  }
}

/**
 * Lazy proxy: a conexão Postgres só é estabelecida na primeira query.
 * Isso evita problemas de ordem de import quando dotenv ainda não rodou.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    ensureClient();
    return Reflect.get(_db as object, prop);
  },
});

/**
 * Cliente postgres bruto, também lazy.
 */
export function getQueryClient(): Sql {
  ensureClient();
  return _queryClient!;
}

/**
 * Fecha a conexão (graceful shutdown).
 */
export async function closeDb(): Promise<void> {
  if (_queryClient) {
    await _queryClient.end();
    _queryClient = null;
    _db = null;
  }
}

export type Database = ReturnType<typeof drizzle<typeof schema>>;
