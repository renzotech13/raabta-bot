import { supabase } from "../client.js";

export type Mensaje = {
  id: string;
  conversacion_id: string;
  rol: "user" | "assistant";
  contenido: string;
  wa_message_id: string | null;
  created_at: string;
};

export async function guardarMensaje(params: {
  conversacionId: string;
  rol: "user" | "assistant";
  contenido: string;
  waMessageId?: string;
}): Promise<Mensaje> {
  const { data, error } = await supabase
    .from("mensajes")
    .insert({
      conversacion_id: params.conversacionId,
      rol: params.rol,
      contenido: params.contenido,
      wa_message_id: params.waMessageId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Mensaje;
}

/** Últimos N mensajes de una conversación, o de las últimas `sinceHours` horas, lo que sea menor. */
export async function getHistorialReciente(
  conversacionId: string,
  maxMensajes = 20,
  sinceHours = 24,
): Promise<Mensaje[]> {
  const since = new Date(Date.now() - sinceHours * 60 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("mensajes")
    .select("*")
    .eq("conversacion_id", conversacionId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(maxMensajes);
  if (error) throw error;
  return ((data ?? []) as Mensaje[]).reverse();
}
