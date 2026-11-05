import { config, type ModelId, type ModelPricing } from "@/config";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * USD cost of one call. Haiku 5.5 prices a request by its prompt length: all
 * input tokens, cache reads and writes included, over the threshold pay the
 * higher tier for the whole request.
 */
export function estimateCostUsd(model: ModelId, usage: TokenUsage): number {
  const p: ModelPricing = config.pricing[model];
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const promptTokens = usage.inputTokens + cacheRead + cacheWrite;

  let rates = {
    input: p.input,
    output: p.output,
    cacheRead: p.cacheRead,
    cacheWrite: p.cacheWrite,
  };
  if (p.longContext && promptTokens > p.longContext.threshold) {
    rates = {
      input: p.longContext.input,
      output: p.longContext.output,
      cacheRead: p.longContext.cacheRead,
      cacheWrite: p.longContext.cacheWrite,
    };
  }

  const usd =
    (usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      cacheRead * rates.cacheRead +
      cacheWrite * rates.cacheWrite) /
    1_000_000;

  return Math.round(usd * 1_000_000) / 1_000_000;
}
