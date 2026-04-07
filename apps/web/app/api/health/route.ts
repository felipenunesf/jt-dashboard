import { NextResponse } from 'next/server';
import { db } from '@jt/db';
import { sql } from 'drizzle-orm';

const startedAt = Date.now();

export async function GET() {
  const dbStart = Date.now();
  let dbOk = false;
  let dbError: string | undefined;
  let dbLatency = 0;

  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
    dbLatency = Date.now() - dbStart;
  } catch (err) {
    dbLatency = Date.now() - dbStart;
    dbError = (err as Error).message;
  }

  const status = dbOk ? 'ok' : 'down';
  const httpCode = dbOk ? 200 : 503;

  return NextResponse.json(
    {
      status,
      service: 'jt-web',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      checks: {
        db: { ok: dbOk, latency_ms: dbLatency, ...(dbError && { error: dbError }) },
      },
    },
    { status: httpCode },
  );
}
