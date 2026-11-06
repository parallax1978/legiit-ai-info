import "server-only";

/*
  Access codes: 12 upper-case letters and digits without 0, O, 1, and I, so a
  code read over the phone or typed from paper is not mistaken. Redeeming one
  puts the user on the sponsored plan, which shares the paid plan's caps. The
  format and the redeem decision are pure; the rest takes the service client
  and is called from route handlers that checked the user.
*/
import { randomInt } from "node:crypto";
import type { PlanId } from "@/config";
import type { AccessCodeRow } from "@/lib/db/types";
import { DbError, type Db } from "@/lib/runs/db";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 12;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** A new code. `random(max)` returns an integer in [0, max); the default is the crypto one. */
export function generateAccessCode(random: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}

/** Upper-case, with the spaces and dashes people add for readability removed. */
export function normalizeAccessCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

export function isAccessCodeFormat(code: string): boolean {
  return CODE_RE.test(code);
}

export type RedeemRefusal = "bad_format" | "missing" | "expired" | "used_up" | "already_redeemed";

export type RedeemDecision = { ok: true } | { ok: false; reason: RedeemRefusal; message: string };

export const REDEEM_MESSAGES: Record<RedeemRefusal, string> = {
  bad_format: `That does not look like a code. Codes are ${CODE_LENGTH} letters and digits.`,
  missing: "That code does not exist. Check it and try again.",
  expired: "That code has expired.",
  used_up: "That code has been used as many times as it allows.",
  already_redeemed: "You have already redeemed this code.",
};

function refuse(reason: RedeemRefusal): RedeemDecision {
  return { ok: false, reason, message: REDEEM_MESSAGES[reason] };
}

/**
 * Whether a code may be redeemed now: it exists, this user has not redeemed
 * it before, it has not expired, and it has uses left. Pure.
 */
export function redeemDecision(
  code: Pick<AccessCodeRow, "max_uses" | "uses" | "expires_at"> | null,
  opts: { alreadyRedeemed: boolean; now?: Date },
): RedeemDecision {
  if (!code) return refuse("missing");
  if (opts.alreadyRedeemed) return refuse("already_redeemed");
  const now = opts.now ?? new Date();
  if (code.expires_at && Date.parse(code.expires_at) <= now.getTime()) return refuse("expired");
  if (code.uses >= code.max_uses) return refuse("used_up");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export async function listAccessCodes(db: Db): Promise<AccessCodeRow[]> {
  const res = await db.from("access_codes").select().order("created_at", { ascending: false });
  if (res.error) throw new DbError("list access codes", res.error);
  return res.data;
}

export interface AccessCodeView extends AccessCodeRow {
  expired: boolean;
  usedUp: boolean;
}

/** Every code with whether it still works, for the admin table. */
export async function listAccessCodeViews(db: Db, now: Date = new Date()): Promise<AccessCodeView[]> {
  const codes = await listAccessCodes(db);
  return codes.map((c) => ({
    ...c,
    expired: c.expires_at !== null && Date.parse(c.expires_at) <= now.getTime(),
    usedUp: c.uses >= c.max_uses,
  }));
}

export async function findAccessCode(db: Db, code: string): Promise<AccessCodeRow | null> {
  const res = await db.from("access_codes").select().eq("code", code).maybeSingle();
  if (res.error) throw new DbError("read access code", res.error);
  return res.data;
}

export interface NewAccessCode {
  label: string | null;
  maxUses: number;
  expiresAt: string | null;
  createdBy: string | null;
}

const CREATE_ATTEMPTS = 5;

/** Inserts a code with a fresh random value, trying again on the rare collision. */
export async function createAccessCode(db: Db, input: NewAccessCode): Promise<AccessCodeRow> {
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const res = await db
      .from("access_codes")
      .insert({
        code: generateAccessCode(),
        label: input.label,
        max_uses: input.maxUses,
        expires_at: input.expiresAt,
        created_by: input.createdBy,
      })
      .select()
      .single();
    if (!res.error) return res.data;
    if (res.error.code !== "23505") throw new DbError("create access code", res.error);
  }
  throw new Error("create access code: no unused code found");
}

/** True when the user has redeemed any code: the webhook keeps them sponsored when a subscription ends. */
export async function hasRedeemedAccessCode(db: Db, userId: string): Promise<boolean> {
  const res = await db.from("access_code_redemptions").select("id").eq("user_id", userId).limit(1);
  if (res.error) throw new DbError("read redemptions", res.error);
  return (res.data?.length ?? 0) > 0;
}

async function userRedeemed(db: Db, codeId: string, userId: string): Promise<boolean> {
  const res = await db.from("access_code_redemptions").select("id").eq("code_id", codeId).eq("user_id", userId).limit(1);
  if (res.error) throw new DbError("read redemption", res.error);
  return (res.data?.length ?? 0) > 0;
}

export type RedeemResult =
  | { ok: true; plan: PlanId; message: string }
  | { ok: false; status: 400 | 409; message: string };

const CLAIM_ATTEMPTS = 3;

/** Takes one use of the code while it still has one: an optimistic write against the count it read. */
async function claimUse(db: Db, row: AccessCodeRow): Promise<boolean> {
  let seen = row;
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    if (seen.uses >= seen.max_uses) return false;
    const res = await db
      .from("access_codes")
      .update({ uses: seen.uses + 1 })
      .eq("id", seen.id)
      .eq("uses", seen.uses)
      .select("id")
      .maybeSingle();
    if (res.error) throw new DbError("count the use", res.error);
    if (res.data) return true;
    const again = await findAccessCode(db, seen.code);
    if (!again) return false;
    seen = again;
  }
  return false;
}

/**
 * Redeems a code for the user: records the redemption, takes one use, and
 * sets the plan to sponsored. A paid subscriber keeps the paid plan; the
 * redemption still counts, so the plan falls back to sponsored, not free, if
 * the subscription ends.
 */
export async function redeemAccessCode(db: Db, userId: string, rawCode: string): Promise<RedeemResult> {
  const code = normalizeAccessCode(rawCode);
  if (!isAccessCodeFormat(code)) return { ok: false, status: 400, message: REDEEM_MESSAGES.bad_format };

  const row = await findAccessCode(db, code);
  const alreadyRedeemed = row ? await userRedeemed(db, row.id, userId) : false;
  const decision = redeemDecision(row, { alreadyRedeemed });
  if (!decision.ok) {
    return { ok: false, status: decision.reason === "already_redeemed" ? 409 : 400, message: decision.message };
  }
  if (!row) return { ok: false, status: 400, message: REDEEM_MESSAGES.missing };

  // The redemption row first: its unique key stops a double submit from taking two uses.
  const inserted = await db.from("access_code_redemptions").insert({ code_id: row.id, user_id: userId });
  if (inserted.error) {
    if (inserted.error.code === "23505") return { ok: false, status: 409, message: REDEEM_MESSAGES.already_redeemed };
    throw new DbError("record redemption", inserted.error);
  }

  if (!(await claimUse(db, row))) {
    const removed = await db.from("access_code_redemptions").delete().eq("code_id", row.id).eq("user_id", userId);
    if (removed.error) console.error("redemption rollback failed:", removed.error.message);
    return { ok: false, status: 409, message: REDEEM_MESSAGES.used_up };
  }

  const profile = await db.from("profiles").select("plan").eq("id", userId).maybeSingle();
  if (profile.error) throw new DbError("read plan", profile.error);
  const current: PlanId = profile.data?.plan ?? "free";
  if (current === "paid") {
    return {
      ok: true,
      plan: "paid",
      message: "Your code is saved. You stay on the paid plan, and the code keeps your access if the subscription ends.",
    };
  }
  const updated = await db
    .from("profiles")
    .update({ plan: "sponsored", plan_updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (updated.error) throw new DbError("set plan", updated.error);
  return { ok: true, plan: "sponsored", message: "Your code is redeemed. You have the sponsored plan now." };
}
