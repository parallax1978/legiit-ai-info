import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "./cost";

describe("estimateCostUsd", () => {
  it("prices a small Haiku call at the base tier", () => {
    // 6,000 in at $0.10/M = 0.0006; 500 out at $0.50/M = 0.00025
    expect(estimateCostUsd("claude-haiku-5-5", { inputTokens: 6_000, outputTokens: 500 })).toBe(
      0.00085,
    );
  });

  it("moves the whole request to the long-context tier past 100k prompt tokens", () => {
    const usd = estimateCostUsd("claude-haiku-5-5", {
      inputTokens: 90_000,
      outputTokens: 1_000,
      cacheReadTokens: 20_000,
    });
    // 90,000 * 0.5 + 1,000 * 2.5 + 20,000 * 0.05 = 45,000 + 2,500 + 1,000 = 48,500 / 1e6
    expect(usd).toBe(0.0485);
  });

  it("prices Sonnet with cache reads", () => {
    const usd = estimateCostUsd("claude-sonnet-5-5", {
      inputTokens: 10_000,
      outputTokens: 5_000,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 1_000,
    });
    // 10,000*2 + 5,000*10 + 2,000*0.1 + 1,000*2.5 = 20,000 + 50,000 + 200 + 2,500 = 72,700 / 1e6
    expect(usd).toBe(0.0727);
  });
});
