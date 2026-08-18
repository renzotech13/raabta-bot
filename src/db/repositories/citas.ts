import { supabase } from "../client.js";
import { getBusinessHours } from "./businessHours.js";
import { getBloqueosEnRango } from "./bloqueos.js";
import { getServiceById } from "./services.js";
import { isSlotAvailable, type ExistingCita } from "../../lib/availability.js";
import { BUFFER_MINUTES, MIN_LEAD_MINUTES, BUSINESS_TIMEZONE } from "../../config/business.js";

export type Cita = {
  id: string;
  cliente_id: string;
  servicio_id: string;
  inicio_utc: string;
  fin_utc: string;
  estado: "confirmada" | "cancelada" | "completada" | "no_asistio";
  google_event_id: string | null;
  creada_por: "bot" | "humano";
  notas: string | null;
  created_at: string;
  updated_at: string;
};

export type CrearCitaResult = { ok: true; cita: Cita } | { ok: false; reason: "conflicto_horario" | "fuera_de_politica" };

/**
 * Vuelve a validar disponibilidad (defensa en profundidad, aunque el
 * agente ya la haya consultado antes) e intenta crear la cita. El EXCLUDE
 * constraint de Postgres es la garantía real ante condiciones de carrera:
 * si dos solicitudes llegan casi al mismo tiempo para el mismo horario,
 * Postgres rechaza la segunda inserción de forma atómica y ese error
 * (23P01) se traduce aquí a un resultado tipado en vez de una excepción.
 */
export async function crearCita(params: {
  clienteId: string;
  servicioId: string;
  inicioUtc: Date;
  finUtc: Date;
  creadaPor?: "bot" | "humano";
  notas?: string;
}): Promise<CrearCitaResult> {
  const desdeRango = new Date(params.inicioUtc.getTime() - 24 * 60 * 60_000);
  const hastaRango = new Date(params.finUtc.getTime() + 24 * 60 * 60_000);

  const [businessHours, bloqueos, existingCitas] = await Promise.all([
    getBusinessHours(),
    getBloqueosEnRango(desdeRango, hastaRango),
    listarCitasEnRango(desdeRango, hastaRango),
  ]);

  const check = isSlotAvailable({
    inicioUtc: params.inicioUtc,
    finUtc: params.finUtc,
    timezone: BUSINESS_TIMEZONE,
    businessHours,
    bloqueos,
    existingCitas,
    bufferMinutes: BUFFER_MINUTES,
    minLeadMinutes: MIN_LEAD_MINUTES,
    now: new Date(),
  });
  if (!check.available) {
    return { ok: false, reason: check.reason === "solapamiento" ? "conflicto_horario" : "fuera_de_politica" };
  }

  const { data, error } = await supabase
    .from("citas")
    .insert({
      cliente_id: params.clienteId,
      servicio_id: params.servicioId,
      inicio_utc: params.inicioUtc.toISOString(),
      fin_utc: params.finUtc.toISOString(),
      creada_por: params.creadaPor ?? "bot",
      notas: params.notas ?? null,
    })
    .select("*")
    .single();

  if (error) {
    // 23P01 = exclusion_violation: otra cita ganó la carrera y ocupó el
    // horario entre nuestro chequeo de arriba y este INSERT.
    if (error.code === "23P01") {
      return { ok: false, reason: "conflicto_horario" };
    }
    throw error;
  }

  return { ok: true, cita: data as Cita };
}

async function listarCitasEnRango(desdeUtc: Date, hastaUtc: Date): Promise<ExistingCita[]> {
  const { data, error } = await supabase
    .from("citas")
    .select("inicio_utc,fin_utc")
    .neq("estado", "cancelada")
    .lt("inicio_utc", hastaUtc.toISOString())
    .gt("fin_utc", desdeUtc.toISOString());
  if (error) throw error;
  return (data ?? []).map((row) => ({
    inicioUtc: new Date(row.inicio_utc as string),
    finUtc: new Date(row.fin_utc as string),
  }));
}

/**
 * Citas futuras de un teléfono específico. Filtra SIEMPRE por el teléfono
 * de quien escribe (nunca por un cita_id/cliente_id que el modelo podría
 * pasar mal) — así un cliente no puede ver ni tocar citas de otro número
 * aunque el agente se equivoque en un parámetro.
 */
export async function listarCitasFuturasPorTelefono(telefono: string): Promise<Cita[]> {
  const { data, error } = await supabase
    .from("citas")
    .select("*, clientes!inner(telefono)")
    .eq("clientes.telefono", telefono)
    .neq("estado", "cancelada")
    .gte("inicio_utc", new Date().toISOString())
    .order("inicio_utc");
  if (error) throw error;
  return data as Cita[];
}

export type MutarCitaResult =
  | { ok: true; cita: Cita }
  | { ok: false; reason: "no_encontrada" | "no_autorizado" | "fuera_de_politica_cancelacion" };

async function getCitaSiPerteneceATelefono(citaId: string, telefono: string): Promise<Cita | null> {
  const { data, error } = await supabase
    .from("citas")
    .select("*, clientes!inner(telefono)")
    .eq("id", citaId)
    .eq("clientes.telefono", telefono)
    .maybeSingle();
  if (error) throw error;
  return data as Cita | null;
}

/**
 * Política real del negocio (mismo texto que reserva.html): cancelar con
 * al menos 30 minutos de antelación. Se aplica acá, no solo se le pide al
 * modelo que la mencione — así una cancelación de último minuto se
 * rechaza aunque el agente se equivoque.
 */
const MIN_CANCEL_LEAD_MINUTES = 30;

export async function cancelarCita(citaId: string, telefono: string, motivo?: string): Promise<MutarCitaResult> {
  const existing = await getCitaSiPerteneceATelefono(citaId, telefono);
  if (!existing) return { ok: false, reason: "no_autorizado" };

  const minutosParaLaCita = (new Date(existing.inicio_utc).getTime() - Date.now()) / 60_000;
  if (minutosParaLaCita < MIN_CANCEL_LEAD_MINUTES) {
    return { ok: false, reason: "fuera_de_politica_cancelacion" };
  }

  const { data, error } = await supabase
    .from("citas")
    .update({ estado: "cancelada", notas: motivo ?? existing.notas })
    .eq("id", citaId)
    .select("*")
    .single();
  if (error) throw error;
  return { ok: true, cita: data as Cita };
}

export async function reagendarCita(params: {
  citaId: string;
  telefono: string;
  nuevoInicioUtc: Date;
}): Promise<CrearCitaResult | MutarCitaResult> {
  const existing = await getCitaSiPerteneceATelefono(params.citaId, params.telefono);
  if (!existing) return { ok: false, reason: "no_autorizado" };

  // La duración es la del servicio original, no un valor que el llamador
  // deba calcular — evita que un caller pase un fin_utc inconsistente.
  const servicio = await getServiceById(existing.servicio_id);
  if (!servicio?.duration_minutes) return { ok: false, reason: "conflicto_horario" };
  const nuevoFinUtc = new Date(params.nuevoInicioUtc.getTime() + servicio.duration_minutes * 60_000);

  // Reagendar = cancelar la actual + crear una nueva: así la validación de
  // disponibilidad (incluida la protección del EXCLUDE constraint) es
  // exactamente la misma que para una cita nueva, sin lógica duplicada.
  const cancelled = await cancelarCita(params.citaId, params.telefono, "Reagendada");
  if (!cancelled.ok) return cancelled;

  const created = await crearCita({
    clienteId: existing.cliente_id,
    servicioId: existing.servicio_id,
    inicioUtc: params.nuevoInicioUtc,
    finUtc: nuevoFinUtc,
    creadaPor: existing.creada_por,
    notas: `Reagendada desde cita ${params.citaId}`,
  });

  if (!created.ok) {
    // El nuevo horario no funcionó: revertimos la cancelación para no
    // dejar al cliente sin cita.
    await supabase.from("citas").update({ estado: "confirmada", notas: existing.notas }).eq("id", params.citaId);
  }

  return created;
}
