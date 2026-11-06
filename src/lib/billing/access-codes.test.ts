import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  generateAccessCode,
  isAccessCodeFormat,
  normalizeAccessCode,
  redeemAccessCode,
  redeemDecision,
} from "./access-codes";
import { fakeDb } from "./fake-db";

describe("access code format", () => {
  it("makes 12 characters from the alphabet without 0, O, 1, and I", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateAccessCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isAccessCodeFormat(code)).toBe(true);
      expect(code).not.toMatch(/[0O1I]/);
    }
    expect(CODE_ALPHABET).not.toMatch(/[0O1I]/);
    expect(CODE_ALPHABET).toMatch(/^[A-Z2-9]+$/);
  });

  it("uses the random source it is given", () => {
    expect(generateAccessCode(() => 0)).toBe("AAAAAAAAAAAA");
    let n = 0;
    expect(generateAccessCode((max) => n++ % max)).toBe("ABCDEFGHJKLM");
  });

  it("makes different codes", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateAccessCode()));
    expect(codes.size).toBe(20);
  });

  it("normalizes what people type", () => {
    expect(normalizeAccessCode(" abcd-efgh jklm ")).toBe("ABCDEFGHJKLM");
    expect(normalizeAccessCode("ABCD\tEFGH\nJKLM")).toBe("ABCDEFGHJKLM");
  });

  it("rejects the wrong length and the confusable characters", () => {
    expect(isAccessCodeFormat("ABCDEFGHJKLM")).toBe(true);
    expect(isAccessCodeFormat("ABCDEFGHJKL")).toBe(false);
    expect(isAccessCodeFormat("ABCDEFGHJKLMN")).toBe(false);
    expect(isAccessCodeFormat("ABCDEFGHJKL0")).toBe(false);
    expect(isAccessCodeFormat("ABCDEFGHJKLO")).toBe(false);
    expect(isAccessCodeFormat("ABCDEFGHJKL1")).toBe(false);
    expect(isAccessCodeFormat("ABCDEFGHJKLI")).toBe(false);
    expect(isAccessCodeFormat("abcdefghjklm")).toBe(false);
  });
});

describe("redeemDecision", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const fresh = { max_uses: 3, uses: 0, expires_at: null };

  it("allows a live code with uses left", () => {
    expect(redeemDecision(fresh, { alreadyRedeemed: false, now })).toEqual({ ok: true });
    expect(redeemDecision({ ...fresh, expires_at: "2026-12-01T00:00:00Z" }, { alreadyRedeemed: false, now })).toEqual({ ok: true });
  });

  it("refuses a missing code", () => {
    expect(redeemDecision(null, { alreadyRedeemed: false, now })).toMatchObject({ ok: false, reason: "missing" });
  });

  it("refuses a code the user already redeemed, before anything else", () => {
    expect(redeemDecision({ ...fresh, uses: 3 }, { alreadyRedeemed: true, now })).toMatchObject({ ok: false, reason: "already_redeemed" });
  });

  it("refuses an expired code", () => {
    expect(redeemDecision({ ...fresh, expires_at: "2026-11-06T12:00:00Z" }, { alreadyRedeemed: false, now })).toMatchObject({
      ok: false,
      reason: "expired",
    });
    expect(redeemDecision({ ...fresh, expires_at: "2026-01-01T00:00:00Z" }, { alreadyRedeemed: false, now })).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a used-up code", () => {
    const d = redeemDecision({ ...fresh, uses: 3 }, { alreadyRedeemed: false, now });
    expect(d).toMatchObject({ ok: false, reason: "used_up" });
    if (!d.ok) expect(d.message).not.toMatch(/[–—]/);
  });
});

describe("redeemAccessCode", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const unique = { access_codes: [["code"]], access_code_redemptions: [["code_id", "user_id"]] };

  function world(plan: "free" | "paid" = "free", code: Record<string, unknown> = {}) {
    return fakeDb(
      {
        profiles: [{ id: user, plan, plan_updated_at: null }],
        access_codes: [{ id: "c1", code: "ABCDEFGHJKLM", label: "Test", max_uses: 2, uses: 0, expires_at: null, ...code }],
        access_code_redemptions: [],
      },
      { unique },
    );
  }

  it("records the redemption, takes a use, and sets the plan to sponsored", async () => {
    const w = world();
    const result = await redeemAccessCode(w.db, user, " abcd-efgh-jklm ");
    expect(result).toMatchObject({ ok: true, plan: "sponsored" });
    expect(w.tables.access_codes[0].uses).toBe(1);
    expect(w.tables.access_code_redemptions).toHaveLength(1);
    expect(w.tables.profiles[0].plan).toBe("sponsored");
    expect(typeof w.tables.profiles[0].plan_updated_at).toBe("string");
  });

  it("refuses the same user twice", async () => {
    const w = world();
    await redeemAccessCode(w.db, user, "ABCDEFGHJKLM");
    expect(await redeemAccessCode(w.db, user, "ABCDEFGHJKLM")).toMatchObject({ ok: false, status: 409 });
    expect(w.tables.access_codes[0].uses).toBe(1);
  });

  it("refuses a bad format, a missing code, an expired code, and a used-up code", async () => {
    expect(await redeemAccessCode(world().db, user, "nope")).toMatchObject({ ok: false, status: 400 });
    expect(await redeemAccessCode(world().db, user, "ZZZZZZZZZZZZ")).toMatchObject({ ok: false, status: 400 });
    expect(await redeemAccessCode(world("free", { expires_at: "2000-01-01T00:00:00Z" }).db, user, "ABCDEFGHJKLM")).toMatchObject({
      ok: false,
      status: 400,
      message: expect.stringMatching(/expired/),
    });
    const used = world("free", { uses: 2 });
    expect(await redeemAccessCode(used.db, user, "ABCDEFGHJKLM")).toMatchObject({ ok: false, status: 400 });
    expect(used.tables.access_code_redemptions).toHaveLength(0);
  });

  it("keeps a paid subscriber on the paid plan but still records the redemption", async () => {
    const w = world("paid");
    expect(await redeemAccessCode(w.db, user, "ABCDEFGHJKLM")).toMatchObject({ ok: true, plan: "paid" });
    expect(w.tables.profiles[0].plan).toBe("paid");
    expect(w.tables.access_code_redemptions).toHaveLength(1);
    expect(w.tables.access_codes[0].uses).toBe(1);
  });
});
