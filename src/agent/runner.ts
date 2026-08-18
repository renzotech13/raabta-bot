import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { getHistorialReciente } from "../db/repositories/mensajes.js";
import { escalarConversacion } from "../db/repositories/conversaciones.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { getToolDefinitions, executeTool } from "./tools/index.js";
import type { AgentContext } from "./tools/types.js";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ITERATIONS = 5;
const MAX_TOKENS = 1024;

export const FALLBACK_MESSAGE =
  "Disculpa, tuve un problema para procesar tu mensaje. Ya avisé a un asesor de Raabta para que te escriba.";

/**
 * Ejecuta el loop de tool use hasta que Claude devuelve una respuesta final
 * de texto, o hasta agotar MAX_TOOL_ITERATIONS. Cualquier falla (excepción,
 * o agotar las iteraciones sin resolución) termina en el mensaje de
 * fallback + la conversación escalada — nunca en silencio.
 */
export async function runAgent(ctx: AgentContext, userMessage: string): Promise<string> {
  try {
    const [historial, systemPrompt] = await Promise.all([
      getHistorialReciente(ctx.conversacionId, 20, 24),
      buildSystemPrompt(),
    ]);

    const messages: Anthropic.MessageParam[] = historial.map((m) => ({
      role: m.rol,
      content: m.contenido,
    }));
    messages.push({ role: "user", content: userMessage });

    const tools = getToolDefinitions();

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      });

      if (response.stop_reason !== "tool_use") {
        const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
        if (textBlock?.text) return textBlock.text;
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const result = await executeTool(block.name, block.input, ctx);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    logger.warn({ conversacionId: ctx.conversacionId }, "Se agotaron las iteraciones de tools sin respuesta final");
    await escalarConversacion(ctx.conversacionId);
    return FALLBACK_MESSAGE;
  } catch (err) {
    logger.error({ err, conversacionId: ctx.conversacionId }, "Error en el loop del agente");
    await escalarConversacion(ctx.conversacionId).catch(() => {});
    return FALLBACK_MESSAGE;
  }
}
