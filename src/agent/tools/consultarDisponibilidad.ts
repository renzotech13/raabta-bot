import { z } from "zod";
import type { AgentTool } from "./types.js";
import { getServiceById } from "../../db/repositories/services.js";
import { getBusinessHours } from "../../db/repositories/businessHours.js";
import { getBloqueosEnRango } from "../../db/repositories/bloqueos.js";
import { supabase } from "../../db/client.js";
import { getAvailableSlots, getLocalWeekdayAndTime, timeStringToUtcDate } from "../../lib/availability.js";
import { BUFFER_MINUTES, MIN_LEAD_MINUTES, SLOT_STEP_MINUTES, BUSINESS_TIMEZONE } from "../../config/business.js";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 14;

const inputSchema = z.object({
  servicio_id: z.string(),
  fecha_desde: z.string().regex(FECHA_REGEX, "Formato de fecha debe ser YYYY-MM-DD"),
  fecha_hasta: z.string().regex(FECHA_REGEX, "Formato de fecha debe ser YYYY-MM-DD").optional(),
});

function addDays(fechaLocal: string, days: number): string {
  const d = new Date(`${fechaLocal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const consultarDisponibilidadTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: "consultar_disponibilidad",
  description:
    "Devuelve los horarios realmente libres (hora de Lima, formato HH:mm) para un servicio, entre fecha_desde y " +
    "fecha_hasta (máximo 14 días de rango; si se omite fecha_hasta se consulta solo fecha_desde). Nunca ofrezcas " +
    "un horario que no venga de este resultado.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      servicio_id: { type: "string", description: "Id del servicio, tal como lo devuelve consultar_servicios" },
      fecha_desde: { type: "string", description: "YYYY-MM-DD" },
      fecha_hasta: { type: "string", description: "YYYY-MM-DD, opcional" },
    },
    required: ["servicio_id", "fecha_desde"],
  },
  handler: async (input) => {
    const servicio = await getServiceById(input.servicio_id);
    if (!servicio || !servicio.duration_minutes) {
      return { error: "servicio_no_encontrado" };
    }

    const fechaHasta = input.fecha_hasta ?? input.fecha_desde;
    if (fechaHasta < input.fecha_desde) {
      return { error: "rango_invalido" };
    }
    const dias: string[] = [];
    for (let f = input.fecha_desde; f <= fechaHasta && dias.length < MAX_DIAS; f = addDays(f, 1)) {
      dias.push(f);
    }

    const businessHours = await getBusinessHours();
    const desdeUtc = timeStringToUtcDate(input.fecha_desde, "00:00", BUSINESS_TIMEZONE);
    const hastaUtc = timeStringToUtcDate(addDays(fechaHasta, 1), "00:00", BUSINESS_TIMEZONE);
    const [bloqueos, citasRows] = await Promise.all([
      getBloqueosEnRango(desdeUtc, hastaUtc),
      supabase
        .from("citas")
        .select("inicio_utc,fin_utc")
        .neq("estado", "cancelada")
        .lt("inicio_utc", hastaUtc.toISOString())
        .gt("fin_utc", desdeUtc.toISOString())
        .then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []).map((r) => ({ inicioUtc: new Date(r.inicio_utc as string), finUtc: new Date(r.fin_utc as string) }));
        }),
    ]);

    const now = new Date();
    const resultado = dias.map((fechaLocal) => {
      const slots = getAvailableSlots({
        fechaLocal,
        durationMinutes: servicio.duration_minutes!,
        timezone: BUSINESS_TIMEZONE,
        businessHours,
        bloqueos,
        existingCitas: citasRows,
        bufferMinutes: BUFFER_MINUTES,
        minLeadMinutes: MIN_LEAD_MINUTES,
        stepMinutes: SLOT_STEP_MINUTES,
        now,
      });
      return {
        fecha: fechaLocal,
        horas: slots.map((s) => getLocalWeekdayAndTime(s.inicioUtc, BUSINESS_TIMEZONE).time),
      };
    });

    return resultado;
  },
};
