# raabta-bot

Agente conversacional de WhatsApp para Raabta Beauty Academy: agenda, consulta,
reagenda y cancela citas de forma autónoma vía WhatsApp Cloud API + Claude.

## Estado

**Fase 1 (estructura y webhook)** — completa: servidor Fastify, verificación
y recepción de webhooks con validación de firma, dedupe, parser de payloads
de Meta, cliente de envío, logger con redacción de teléfonos.

**Fase 2 (capa de datos)** — completa: esquema en Supabase (clientes, citas,
horario comercial, bloqueos, conversaciones, mensajes), con protección real
contra doble-reserva vía `EXCLUDE` constraint de Postgres (no un chequeo
manual en transacción). Motor de disponibilidad puro en TypeScript
(`lib/availability.ts`), 18 tests. Verificado con un test de concurrencia
real contra la base de datos.

**Fase 3 (el agente)** — completa:
- 7 tools (`agent/tools/`): `consultar_servicios`, `consultar_disponibilidad`,
  `agendar_cita`, `consultar_mis_citas`, `reagendar_cita`, `cancelar_cita`,
  `escalar_a_humano`. Cada una valida su input con Zod antes de ejecutar, y
  el teléfono del cliente viene siempre del contexto del mensaje real —
  nunca de un parámetro que el modelo podría pasar mal.
- `agent/systemPrompt.ts` — catálogo, horario y políticas reales inyectados
  desde Supabase en cada llamada.
- `agent/runner.ts` — loop de tool use con Claude (`claude-sonnet-5`, prompt
  cacheado), máximo 5 iteraciones; agotarlas o cualquier error termina en un
  mensaje de fallback y la conversación escalada, nunca en silencio.
- `agent/handleMessage.ts` — conecta el webhook con el runner: persiste
  clientes/conversaciones/mensajes, aplica timeout de 25s, envía la
  respuesta por WhatsApp.
- Política de cancelación (30 min de antelación) aplicada de verdad en el
  repositorio, no solo mencionada en el prompt.

**Fase 4 (Google Calendar + click-to-chat)** — completa:
- `calendar/google.ts` — crea/actualiza/borra eventos vía Service Account
  (`googleapis`). Las tres funciones atrapan cualquier error y devuelven
  `null`/`false` en vez de lanzar: el calendario nunca bloquea una reserva.
- `citas.ts` (repositorio) sincroniza el calendario automáticamente al
  crear y cancelar citas — `reagendarCita()` lo hereda gratis, ya que por
  dentro cancela la cita vieja y crea una nueva.
- `calendar/retrySync.ts` — barrido cada 5 min (`setInterval` en
  `index.ts`) que reintenta las citas confirmadas sin `google_event_id`.
- Botón click-to-chat: ya existía en `web/` (`index.html`, `salon.html`,
  `academia.html`) apuntando al WhatsApp humano actual — se le agregó un
  mensaje precargado. **El número se mantiene igual por ahora**: el día
  que exista el número nuevo dedicado al bot, el cambio es reemplazarlo
  en esos mismos 6 enlaces `wa.me/...`.

**Fase 5 (seguridad, costos y despliegue)** — completa:
- `lib/rateLimit.ts` — máx. `RATE_LIMIT_MAX_PER_MINUTE` (default 20)
  mensajes/minuto por teléfono; el exceso se descarta sin responder.
- `db/repositories/usage.ts` + tabla `bot_daily_usage` (Supabase, no en
  memoria — sobrevive a un restart) — tope diario de tokens
  (`DAILY_TOKEN_BUDGET`, default 500,000). Al superarlo, el bot deja de
  llamar a Claude, responde un mensaje fijo, y avisa a
  `ESCALATION_PHONE` (máximo una vez por hora).
- `whatsapp/window.ts` — respeta la ventana de servicio de 24h de Meta;
  fuera de ventana no intenta texto libre, solo lo deja registrado para
  seguimiento manual. Se usa tanto para la respuesta al cliente como para
  el aviso a `ESCALATION_PHONE`.
- Auditoría de secretos: `ANTHROPIC_API_KEY`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_APP_SECRET` y `SUPABASE_SERVICE_ROLE_KEY` nunca pasan por el
  logger; `.env` en `.gitignore` desde Fase 1.
- `Dockerfile` (multi-stage, sin volumen — el estado vive en Supabase,
  el contenedor es stateless) + `docker-compose.yml`.

**Pendiente, fuera de código**: número de WhatsApp nuevo dedicado al bot
(requiere verificación de Meta Business Manager), y las credenciales
reales de producción en el `.env` del servidor.

## Desarrollo local

```bash
npm install
cp .env.example .env   # completar credenciales reales
npm run dev
```

`GET /health` para healthcheck. `npm test` corre los tests de Vitest —
todos corren sin credenciales reales excepto `tests/citas.concurrency.test.ts`,
que se salta automáticamente si falta `SUPABASE_SERVICE_ROLE_KEY`.

## Desplegar

1. **Crear la App en Meta for Developers** ([developers.facebook.com/apps](https://developers.facebook.com/apps)):
   "Crear app" → tipo "Business" → agregar el producto **WhatsApp**.
2. **Registrar el número**: en el panel de WhatsApp de la app, agregar el
   número de teléfono dedicado al bot (requiere verificarlo por SMS/llamada).
   Este es el número que reemplaza a `51904719939` en los 6 enlaces
   `wa.me/...` de `web/` una vez que exista.
3. **Token permanente vía System User** (no el token temporal de prueba,
   que expira en 24h): en el Business Manager → Configuración del negocio
   → Usuarios del sistema → crear uno con rol Admin, asignarle la app de
   WhatsApp, generar un token con los permisos `whatsapp_business_messaging`
   y `whatsapp_business_management`, sin fecha de expiración. Ese valor va
   en `WHATSAPP_ACCESS_TOKEN`.
4. **Configurar el webhook**: en el panel de WhatsApp de la app →
   Configuración → Webhook → URL pública del servidor (`https://.../webhook`)
   + el mismo valor que `WHATSAPP_VERIFY_TOKEN` en `.env` → suscribirse al
   campo `messages`.
5. **`WHATSAPP_APP_SECRET`**: Configuración de la app → Básica → "Secreto
   de la app" (mostrar).
6. **`WHATSAPP_PHONE_NUMBER_ID`**: panel de WhatsApp de la app, junto al
   número registrado en el paso 2.
7. **Desplegar con Docker**:
   ```bash
   cp .env.example .env   # completar con las credenciales reales
   docker compose up -d --build
   ```
   El servidor necesita una URL pública con HTTPS para el webhook de
   Meta (un reverse proxy o el dominio del proveedor de hosting elegido).

## Decisión de arquitectura: Supabase en vez de SQLite

El brief original pedía SQLite (`better-sqlite3`). Se usa **Supabase Postgres**
(el mismo proyecto que ya usan el sitio público y el panel admin) en su lugar,
para que citas hechas por WhatsApp y por `reserva.html` compartan una sola
fuente de verdad — evita reservas duplicadas entre canales y que el panel
admin tenga que mirar dos lugares distintos.
