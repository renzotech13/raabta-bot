# raabta-bot

Agente conversacional de WhatsApp para Raabta Beauty Academy: agenda, consulta,
reagenda y cancela citas de forma autónoma vía WhatsApp Cloud API + Claude.

## Estado

**Fase 1 (estructura y webhook)** — completa:
- Servidor Fastify con TypeScript estricto.
- `GET /webhook` — verificación de Meta.
- `POST /webhook` — valida `X-Hub-Signature-256`, responde 200 de inmediato,
  procesa async, deduplica por `message.id`, ignora tipos no soportados.
- `whatsapp/parser.ts` — normaliza el payload de Meta (texto, audio, botones/listas
  interactivos; delivery receipts y tipos no manejados se descartan).
- `whatsapp/client.ts` — `sendText`, `sendButtons` contra la Graph API.
- Logger estructurado (pino) con redacción de teléfonos en todos los niveles.

**Pendiente**: capa de datos (Supabase — mismo proyecto que `web/`/`admin/`),
agente con tools, Google Calendar, despliegue.

## Desarrollo local

```bash
npm install
cp .env.example .env   # completar credenciales reales
npm run dev
```

`GET /health` para healthcheck. `npm test` corre los tests de Vitest.

## Decisión de arquitectura: Supabase en vez de SQLite

El brief original pedía SQLite (`better-sqlite3`). Se usa **Supabase Postgres**
(el mismo proyecto que ya usan el sitio público y el panel admin) en su lugar,
para que citas hechas por WhatsApp y por `reserva.html` compartan una sola
fuente de verdad — evita reservas duplicadas entre canales y que el panel
admin tenga que mirar dos lugares distintos.
