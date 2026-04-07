import { z } from 'zod';

/**
 * Schema central de variáveis de ambiente.
 * Cada app (web/worker) faz seu próprio parse com o subset que precisa.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
});

export const webEnvSchema = baseEnvSchema.extend({
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  NEXTAUTH_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD_HASH: z.string().min(20),
});

/**
 * Schema de uma Meta Ad Account configurada pelo usuário.
 * Aceita o ID com ou sem prefixo "act_" — normalizado depois.
 */
export const metaAccountSchema = z.object({
  account_id: z.string().min(1),
  name: z.string().min(1),
  pixel_ids: z.array(z.string().min(1)).default([]),
});

export type MetaAccount = z.infer<typeof metaAccountSchema>;

export const workerEnvSchema = baseEnvSchema.extend({
  WORKER_PORT: z.coerce.number().int().positive().default(4000),
  WORKER_PUBLIC_URL: z.string().url().optional(),
  META_SYSTEM_USER_TOKEN: z.string().min(20).optional(),
  META_ACCOUNTS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return [] as MetaAccount[];
      try {
        const parsed = JSON.parse(value) as unknown;
        return z.array(metaAccountSchema).parse(parsed);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `META_ACCOUNTS deve ser JSON válido: ${(err as Error).message}`,
        });
        return z.NEVER;
      }
    }),
  META_TEST_EVENT_CODE: z.string().optional(),
  META_API_VERSION: z.string().default('v22.0'),
  META_CAPI_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  ZAPI_INSTANCES: z.string().optional(),
  WHATSAPP_WEBHOOK_SECRET: z.string().optional(),
  GHL_PRIVATE_TOKEN: z.string().optional(),
  GHL_LOCATION_ID: z.string().optional(),
  GHL_WEBHOOK_SECRET: z.string().optional(),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    throw new Error('Environment validation failed');
  }
  return result.data;
}
