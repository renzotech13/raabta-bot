import { supabase } from "../client.js";

export type Conversacion = {
  id: string;
  cliente_id: string;
  ultimo_mensaje_at: string;
  estado: "activa" | "escalada" | "cerrada";
  created_at: string;
};

/** Reutiliza la conversación activa del cliente si existe; si no, crea una nueva. */
export async function getOrCreateConversacionActiva(clienteId: string): Promise<Conversacion> {
  const { data: existing, error: findError } = await supabase
    .from("conversaciones")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("estado", "activa")
    .order("ultimo_mensaje_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing as Conversacion;

  const { data: created, error: insertError } = await supabase
    .from("conversaciones")
    .insert({ cliente_id: clienteId })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return created as Conversacion;
}

export async function marcarUltimoMensaje(conversacionId: string): Promise<void> {
  const { error } = await supabase
    .from("conversaciones")
    .update({ ultimo_mensaje_at: new Date().toISOString() })
    .eq("id", conversacionId);
  if (error) throw error;
}

export async function escalarConversacion(conversacionId: string): Promise<void> {
  const { error } = await supabase.from("conversaciones").update({ estado: "escalada" }).eq("id", conversacionId);
  if (error) throw error;
}
