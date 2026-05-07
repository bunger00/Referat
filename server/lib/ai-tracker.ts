import { openai } from "./openai-client";
import { logger } from "./logger";
import { db } from "../db";
import { aiUsageLog } from "@shared/schema";

/**
 * Estimat-priser per 1M tokens (USD), oppdater når OpenAI endrer dem.
 * Bruker integer microcents (1 microcent = 0.001 USD = 0.00001 USD/token unit).
 */
const PRICING_USD_PER_MTOKEN: Record<string, { prompt: number; completion: number }> = {
  "gpt-4.1": { prompt: 2.0, completion: 8.0 },
  "gpt-4o": { prompt: 2.5, completion: 10.0 },
  "gpt-4o-mini": { prompt: 0.15, completion: 0.6 },
  "whisper-1": { prompt: 0, completion: 0 }, // Audio billes per minutt, ikke tokens
};

function estimateMicrocents(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING_USD_PER_MTOKEN[model] ?? { prompt: 0, completion: 0 };
  // 1 USD = 100,000 microcents. Per token: prompt USD/M / 1_000_000 = X USD/token = X * 100_000 microcents/token.
  const promptUSD = (promptTokens * p.prompt) / 1_000_000;
  const completionUSD = (completionTokens * p.completion) / 1_000_000;
  return Math.round((promptUSD + completionUSD) * 100_000);
}

type CompletionParams = Parameters<typeof openai.chat.completions.create>[0];

/**
 * Wrapper rundt openai.chat.completions.create som logger usage til
 * ai_usage_log-tabellen. Best-effort — feil i logging skal aldri stoppe
 * brukerens forespørsel.
 *
 * Bruk:
 *   const resp = await trackedChatCompletion(
 *     { endpoint: "/api/analyze", userId },
 *     { model: "gpt-4.1", messages, ... }
 *   );
 */
export async function trackedChatCompletion(
  meta: { endpoint: string; userId: string | null },
  params: CompletionParams,
) {
  const resp = await openai.chat.completions.create(params);
  // Fire-and-forget: aldri block på logging
  (async () => {
    try {
      const usage = (resp as any).usage;
      if (!usage) return;
      const model = String((params as any).model ?? "unknown");
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
      const costMicrocents = estimateMicrocents(model, promptTokens, completionTokens);
      await db.insert(aiUsageLog).values({
        userId: meta.userId,
        endpoint: meta.endpoint,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        costMicrocents,
      } as any);
    } catch (err: any) {
      logger.warn({ err: err?.message }, "AI usage log failed (non-fatal)");
    }
  })().catch(() => {});
  return resp;
}
