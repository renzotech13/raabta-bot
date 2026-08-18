import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors.js";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

async function callGraphApi(body: Record<string, unknown>): Promise<void> {
  const url = `${GRAPH_BASE_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error({ status: res.status, errorBody }, "Falló el envío a WhatsApp Graph API");
    throw new AppError("No se pudo enviar el mensaje de WhatsApp", "whatsapp_send_failed", 502);
  }
}

export async function sendText(to: string, body: string): Promise<void> {
  await callGraphApi({
    to,
    type: "text",
    text: { body, preview_url: false },
  });
}

export type ButtonOption = { id: string; title: string };

/** WhatsApp permite un máximo de 3 botones por mensaje interactivo. */
export async function sendButtons(to: string, body: string, options: ButtonOption[]): Promise<void> {
  if (options.length === 0 || options.length > 3) {
    throw new AppError("sendButtons requiere entre 1 y 3 opciones", "invalid_buttons", 500);
  }
  await callGraphApi({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: options.map((opt) => ({
          type: "reply",
          reply: { id: opt.id, title: opt.title },
        })),
      },
    },
  });
}
