import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { AppError } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.js";
import { webhookRoutes } from "./routes/webhook.js";
import { adminRoutes } from "./routes/admin.js";
import { syncPendingCitas } from "./calendar/retrySync.js";
import { enviarRecordatoriosPendientes } from "./notifications/recordatorios.js";

const CALENDAR_RETRY_INTERVAL_MS = 5 * 60_000;
const RECORDATORIOS_INTERVAL_MS = 15 * 60_000;

const app = Fastify({ loggerInstance: logger, trustProxy: true });

// Captura el body crudo antes de parsearlo como JSON: la validación de
// firma de Meta (X-Hub-Signature-256) se calcula sobre los bytes exactos
// del request, no sobre el objeto ya parseado.
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
  request.rawBody = body as Buffer;
  try {
    const json = body.length ? JSON.parse(body.toString("utf8")) : {};
    done(null, json);
  } catch (err) {
    done(err as Error, undefined);
  }
});

// El panel admin corre en otro dominio (Vercel), así que necesita CORS.
// Lista blanca explícita: sin ADMIN_ORIGINS configurado no se permite
// ningún origen cruzado, y el webhook de Meta no usa CORS de todos modos.
const adminOrigins = env.ADMIN_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

await app.register(cors, {
  origin: adminOrigins,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

await app.register(healthRoutes);
await app.register(webhookRoutes);
await app.register(adminRoutes);

app.setErrorHandler((err, request, reply) => {
  // Un AppError trae un código y un status pensados para el cliente; el
  // resto se colapsa a 500 para no filtrar detalles internos.
  if (err instanceof AppError) {
    logger.warn({ err: err.message, code: err.code, url: request.url }, "Error controlado");
    return reply.status(err.statusCode).send({ error: err.code });
  }
  logger.error({ err, url: request.url }, "Error no manejado");
  return reply.status(500).send({ error: "internal_error" });
});

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ port: env.PORT }, "raabta-bot escuchando");
} catch (err) {
  logger.error({ err }, "No se pudo iniciar el servidor");
  process.exit(1);
}

setInterval(() => {
  syncPendingCitas().catch((err: unknown) => {
    logger.error({ err }, "Fallo el barrido de reintento de Google Calendar");
  });
}, CALENDAR_RETRY_INTERVAL_MS);

setInterval(() => {
  enviarRecordatoriosPendientes().catch((err: unknown) => {
    logger.error({ err }, "Fallo el barrido de recordatorios de cita");
  });
}, RECORDATORIOS_INTERVAL_MS);
