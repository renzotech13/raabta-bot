import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),

  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),
  GOOGLE_CALENDAR_ID: z.string().min(1),

  BUSINESS_TIMEZONE: z.string().default("America/Lima"),
  ESCALATION_PHONE: z.string().min(1),
  SITE_CATALOG_URL: z.string().url().optional(),

  RATE_LIMIT_MAX_PER_MINUTE: z.coerce.number().int().positive().default(20),
  DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().default(500_000),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`Variables de entorno inválidas o faltantes:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
