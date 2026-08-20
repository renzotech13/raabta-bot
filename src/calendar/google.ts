import { google, type calendar_v3 } from "googleapis";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { buildEventBody, type EventInput } from "./eventBuilder.js";

let cachedClient: calendar_v3.Calendar | null = null;

function getCalendarClient(): calendar_v3.Calendar {
  if (cachedClient) return cachedClient;

  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email: string; private_key: string };
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  cachedClient = google.calendar({ version: "v3", auth });
  return cachedClient;
}

/**
 * El calendario nunca debe bloquear una reserva: las tres funciones de
 * abajo atrapan cualquier error, lo loguean, y devuelven null/false en vez
 * de lanzar. Quien las llama (citas.ts) decide qué hacer con el fallo
 * (dejar google_event_id en null para que retrySync.ts reintente después).
 */
export async function createCalendarEvent(input: EventInput): Promise<string | null> {
  try {
    const calendar = getCalendarClient();
    const res = await calendar.events.insert({
      calendarId: env.GOOGLE_CALENDAR_ID,
      requestBody: buildEventBody(input),
    });
    return res.data.id ?? null;
  } catch (err) {
    logger.error({ err }, "No se pudo crear el evento de Google Calendar");
    return null;
  }
}

export async function updateCalendarEvent(eventId: string, input: EventInput): Promise<boolean> {
  try {
    const calendar = getCalendarClient();
    await calendar.events.update({
      calendarId: env.GOOGLE_CALENDAR_ID,
      eventId,
      requestBody: buildEventBody(input),
    });
    return true;
  } catch (err) {
    logger.error({ err, eventId }, "No se pudo actualizar el evento de Google Calendar");
    return false;
  }
}

export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  try {
    const calendar = getCalendarClient();
    await calendar.events.delete({ calendarId: env.GOOGLE_CALENDAR_ID, eventId });
    return true;
  } catch (err) {
    logger.error({ err, eventId }, "No se pudo borrar el evento de Google Calendar");
    return false;
  }
}
