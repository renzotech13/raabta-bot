import Fastify from "fastify";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { healthRoutes } from "./routes/health.js";
import { webhookRoutes } from "./routes/webhook.js";
import { syncPendingCitas } from "./calendar/retrySync.js";

const CALENDAR_RETRY_INTERVAL_MS = 5 * 60_000;

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

await app.register(healthRoutes);
await app.register(webhookRoutes);

app.setErrorHandler((err, request, reply) => {
  logger.error({ err, url: request.url }, "Error no manejado");
  reply.status(500).send({ error: "internal_error" });
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
