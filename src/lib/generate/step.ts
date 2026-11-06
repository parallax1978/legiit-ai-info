import "server-only";

/*
  The generation job. createGeneration inserts the row the start route
  returns; stepGeneration does one bounded unit of work on it (one model call
  at most), guarded by a lease lock in generations, and returns the view. The
  browser calls it in a loop, the way it steps a crawl run.

  Rules every part follows, so a step the platform kills at its time limit, a
  transient error, or a second tab never leaves a generation stuck or broken:
  - The attempt is counted before any work. A part that keeps being cut off
    or keeps failing ends the generation after config.generate.maxStepAttempts
    instead of looping forever, and the project goes back to review.
  - Every write carries the lock token; a lost lease stops the step.
  - Work is rebuilt from the row, not trusted from the cursor: a part that
    needs the draft and finds none writes the page again.
  - Cost is the sum of llm_calls for the generation, so a call that was
    billed but could not be used is counted too.
*/
import { config } from "@/config";
import type { FactSheetRow, GenerationRow, Json, PlatformT, ProjectRow, RunLogEntry } from "@/lib/db/types";
import type { FactSheetData } from "@/lib/facts/types";
import type { CallContext } from "@/lib/llm/client";
import type { TokenUsage } from "@/lib/llm/cost";
import { hostOf } from "@/lib/projects/view";
import { appendLog, companyNameFrom, errorText, leaseAtRisk, lockCutoffIso, sumCost } from "@/lib/runs/logic";
import { createServiceClient } from "@/lib/supabase/service";
import { getTemplate } from "@/templates/about-v1";
import type { TemplateSpec } from "@/templates/types";
import * as q from "./db";
import { buildInstructions } from "./instructions";
import { buildJsonLd } from "./jsonld";
import { keyFactsRows } from "./keyfacts";
import { lintDraft } from "./lint";
import { renderPageHtml, renderWordpressHtml } from "./render";
import type { GenerationCursor, GenerationPart, LintReport, PageDraft, RenderInput, WriterResult } from "./types";
import {
  draftOf,
  generationCursorOf,
  generationPart,
  generationViewFromRow,
  questionsById,
  stalledGenerationMessage,
  stillToFillIds,
  type GenerationView,
} from "./view";
import { rewriteDraft, writeFaq, writeMain } from "./writer";

export type StepResult = { locked: boolean; generation: GenerationView };

type StepContext = {
  db: q.Db;
  /** When this step began. */
  started: number;
  userId: string;
  /** The lock token this step holds; every write is conditional on it. */
  token: string;
};

/** Everything a part needs from the project and the fact sheet. */
type Job = {
  project: ProjectRow;
  sheet: FactSheetRow;
  spec: TemplateSpec;
  data: FactSheetData;
  siteUrl: string;
  companyName: string;
};

/** Thrown when this step no longer holds the lock. The step stops without writing. */
class LeaseLostError extends Error {
  constructor() {
    super("The generation lock passed to another caller.");
    this.name = "LeaseLostError";
  }
}

function toJson(value: unknown): Json {
  return value as Json;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminal(status: GenerationRow["status"]): boolean {
  return status === "done" || status === "failed";
}

/** Site origin plus /about: where the owner will publish the page. */
export function pageUrlFor(siteUrl: string): string {
  try {
    return `${new URL(siteUrl).origin}/about`;
  } catch {
    return `${siteUrl.replace(/\/+$/, "")}/about`;
  }
}

/** A generation updates the project only while it is the project's latest. */
export function generationOwnsProject(project: Pick<ProjectRow, "latest_generation_id">, generationId: string): boolean {
  return !project.latest_generation_id || project.latest_generation_id === generationId;
}

/** Input tokens as billed: the prompt plus what was read from and written to the cache. */
function promptTokens(usage: TokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * Inserts the generation for a project's fact sheet, records the usage
 * event, and points the project at it. The platform comes from the latest
 * run when it knows one, else from the project. Returns the row.
 */
export async function createGeneration(db: q.Db, project: ProjectRow, userId: string, sheet: FactSheetRow): Promise<GenerationRow> {
  const run = project.latest_crawl_run_id ? await q.getRun(db, project.latest_crawl_run_id) : null;
  const platform: PlatformT = run && run.platform !== "unknown" ? run.platform : project.platform;
  const cursor: GenerationCursor = { part: "main", lintAttempts: 0 };

  let gen: GenerationRow | null = null;
  // Two starts at once race for the same version number (unique per project); the loser tries once more.
  for (let attempt = 0; gen === null; attempt++) {
    const version = (await q.maxGenerationVersion(db, project.id)) + 1;
    try {
      gen = await q.insertGeneration(db, {
        project_id: project.id,
        user_id: userId,
        version,
        fact_sheet_id: sheet.id,
        fact_sheet_version: sheet.version,
        status: "queued",
        platform,
        page_url: pageUrlFor(project.site_url),
        cursor: toJson(cursor),
        log: [],
        attempts: 0,
      });
    } catch (e) {
      if (e instanceof q.DbError && e.code === "23505" && attempt < 2) continue;
      throw e;
    }
  }

  try {
    // Counted before the project points at the generation, so every page that starts is counted
    // (the usage caps read these events); one that cannot be counted does not start.
    await q.insertUsageEvent(db, userId, project.id, "generation_started");
    await q.updateProject(db, project.id, { latest_generation_id: gen.id, status: "generating" });
  } catch (e) {
    // Nothing should step a generation that was not set up; mark it failed and report the error.
    await q
      .updateGeneration(db, gen.id, { status: "failed", error: "The page could not be started." })
      .catch(() => undefined);
    throw e;
  }
  return gen;
}

// ---------------------------------------------------------------------------
// Guarded writes
// ---------------------------------------------------------------------------

function assertLease(ctx: StepContext): void {
  if (leaseAtRisk(ctx.started, Date.now(), config.generate.lockLeaseMs)) throw new LeaseLostError();
}

/** Writes the generation while this step still holds the lock; throws LeaseLostError otherwise. */
async function writeGen(ctx: StepContext, generationId: string, patch: q.GenerationUpdate): Promise<GenerationRow> {
  assertLease(ctx);
  const row = await q.updateGenerationLocked(ctx.db, generationId, ctx.token, patch);
  if (!row) throw new LeaseLostError();
  return row;
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

export async function stepGeneration(generationId: string, userId: string): Promise<StepResult> {
  const db = createServiceClient();
  const started = Date.now();

  const current = await q.getGeneration(db, generationId);
  if (!current || current.user_id !== userId) throw new Error("Generation not found");
  if (isTerminal(current.status)) return { locked: false, generation: generationViewFromRow(current) };

  const token = crypto.randomUUID();
  const startedIso = new Date(started).toISOString();
  const locked = await q.tryLockGeneration(
    db,
    generationId,
    token,
    lockCutoffIso(started, config.generate.lockLeaseMs),
    startedIso,
  );
  if (!locked) {
    const latest = (await q.getGeneration(db, generationId)) ?? current;
    return { locked: true, generation: generationViewFromRow(latest) };
  }

  const ctx: StepContext = { db, started, userId, token };
  let gen = locked;
  try {
    if (isTerminal(gen.status)) return { locked: false, generation: generationViewFromRow(gen) };

    // Count the attempt before doing anything, so a step the platform kills counts too.
    const part = generationPart(gen) ?? "main";
    const attempts = (gen.attempts ?? 0) + 1;
    if (attempts > config.generate.maxStepAttempts) {
      gen = await failGeneration(ctx, gen, stalledGenerationMessage(part));
      return { locked: false, generation: generationViewFromRow(gen) };
    }
    gen = await writeGen(ctx, generationId, {
      attempts,
      status: gen.status === "queued" ? "writing" : gen.status,
      cursor: toJson({ ...generationCursorOf(gen.cursor), part }),
      error: null,
    });

    gen = await runPart(ctx, gen, part);
  } catch (e) {
    if (e instanceof LeaseLostError) {
      const latest = (await q.getGeneration(db, generationId).catch(() => null)) ?? gen;
      return { locked: true, generation: generationViewFromRow(latest) };
    }
    gen = await recordStepError(ctx, generationId, gen, e);
  } finally {
    try {
      await q.releaseGeneration(db, generationId, token);
    } catch (e) {
      // The lease expires on its own; the next step can still take it.
      console.error(`generation ${generationId}: could not release the lock: ${errorText(e)}`);
    }
  }
  return { locked: false, generation: generationViewFromRow(gen) };
}

async function runPart(ctx: StepContext, gen: GenerationRow, part: GenerationPart): Promise<GenerationRow> {
  const job = await loadJob(ctx, gen);
  if (!job) {
    return failGeneration(
      ctx,
      gen,
      "The fact sheet this page was started from is gone. Scan the site again, then generate the page.",
    );
  }

  if (part === "main") return mainPart(ctx, gen, job);

  // Every part after the first needs the draft an earlier step stored. A row without one (a
  // cut-off write, a cleared column) starts over rather than render something broken.
  const draft = draftOf(gen.draft);
  if (!draft) {
    const noted = await writeGen(ctx, gen.id, {
      status: "writing",
      cursor: toJson({ ...generationCursorOf(gen.cursor), part: "main" }),
      log: appendLog(gen.log, "warn", "The draft was not saved; writing the page again"),
    });
    return mainPart(ctx, noted, job);
  }

  switch (part) {
    case "faq":
      return faqPart(ctx, gen, job, draft);
    case "lint":
      return lintPart(ctx, gen, job, draft);
    case "finish":
      return finishPart(ctx, gen, job, draft);
  }
}

/** The project, the fact sheet the generation was started from, and what the writer needs from them. */
async function loadJob(ctx: StepContext, gen: GenerationRow): Promise<Job | null> {
  const project = await q.getProject(ctx.db, gen.project_id);
  const sheet = gen.fact_sheet_id ? await q.getFactSheet(ctx.db, gen.fact_sheet_id) : null;
  if (!sheet || !sheet.data || typeof sheet.data !== "object") return null;
  const spec = getTemplate(sheet.template_id);
  const data: FactSheetData = { templateId: spec.id, fields: sheet.data.fields ?? {} };
  const companyName = companyNameFrom(data) ?? project.business_name?.trim() ?? "";
  return {
    project,
    sheet,
    spec,
    data,
    siteUrl: project.site_url,
    companyName: companyName || hostOf(project.site_url),
  };
}

function callContext(ctx: StepContext, gen: GenerationRow, purpose: string): CallContext {
  return { userId: ctx.userId, projectId: gen.project_id, generationId: gen.id, purpose };
}

/**
 * Stores what a writer call produced and moves the cursor on. The attempt
 * counter starts over because the part finished; the cost is read back from
 * llm_calls so a billed call that failed earlier is in it too.
 */
async function afterCall(
  ctx: StepContext,
  gen: GenerationRow,
  result: WriterResult,
  next: { status: GenerationRow["status"]; cursor: GenerationCursor; lintReport?: LintReport },
  message: string,
): Promise<GenerationRow> {
  const cost = sumCost(await q.generationLlmCosts(ctx.db, gen.id));
  return writeGen(ctx, gen.id, {
    draft: toJson(result.draft),
    model: result.model,
    tokens_in: (gen.tokens_in ?? 0) + promptTokens(result.usage),
    tokens_out: (gen.tokens_out ?? 0) + result.usage.outputTokens,
    cost_usd: cost,
    status: next.status,
    cursor: toJson(next.cursor),
    ...(next.lintReport ? { lint_report: toJson(next.lintReport) } : {}),
    attempts: 0,
    error: null,
    log: appendLog(gen.log, "info", message),
  });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// main: everything but the FAQ and the closing
// ---------------------------------------------------------------------------

async function mainPart(ctx: StepContext, gen: GenerationRow, job: Job): Promise<GenerationRow> {
  const result = await writeMain({
    spec: job.spec,
    data: job.data,
    siteUrl: job.siteUrl,
    companyName: job.companyName,
    ctx: callContext(ctx, gen, "write_page"),
  });
  const d = result.draft;
  return afterCall(
    ctx,
    gen,
    result,
    { status: "writing", cursor: { ...generationCursorOf(gen.cursor), part: "faq" } },
    `Wrote the page: ${plural(d.offerings.length, "offering", "offerings")}, ${plural(d.differentiators.length, "differentiator", "differentiators")}, ${plural(d.customers.length, "customer segment", "customer segments")}`,
  );
}

// ---------------------------------------------------------------------------
// faq: the questions and the closing onto the draft
// ---------------------------------------------------------------------------

async function faqPart(ctx: StepContext, gen: GenerationRow, job: Job, draft: PageDraft): Promise<GenerationRow> {
  const result = await writeFaq({
    spec: job.spec,
    data: job.data,
    siteUrl: job.siteUrl,
    companyName: job.companyName,
    draft,
    ctx: callContext(ctx, gen, "write_faq"),
  });
  return afterCall(
    ctx,
    gen,
    result,
    { status: "linting", cursor: { ...generationCursorOf(gen.cursor), part: "lint", lintAttempts: 0 } },
    `Wrote ${plural(result.draft.faq.length, "question", "questions")} with answers`,
  );
}

// ---------------------------------------------------------------------------
// lint: check the copy; rewrite what fails, up to config.generate.lintAttempts
// ---------------------------------------------------------------------------

async function lintPart(ctx: StepContext, gen: GenerationRow, job: Job, draft: PageDraft): Promise<GenerationRow> {
  const cursor = generationCursorOf(gen.cursor);
  const lintAttempts = cursor.lintAttempts ?? 0;
  const report: LintReport = { ...lintDraft(draft, job.data, job.spec), attempts: lintAttempts };
  const n = report.issues.length;

  if (report.passed || lintAttempts >= config.generate.lintAttempts) {
    const message = report.passed
      ? lintAttempts > 0
        ? `The copy passed every check after ${plural(lintAttempts, "rewrite", "rewrites")}`
        : "The copy passed every check"
      : `${plural(n, "issue", "issues")} left after ${plural(lintAttempts, "rewrite", "rewrites")}; the page ships with its report`;
    return writeGen(ctx, gen.id, {
      lint_report: toJson(report),
      cursor: toJson({ ...cursor, part: "finish", lintAttempts }),
      attempts: 0,
      error: null,
      log: appendLog(gen.log, report.passed ? "info" : "warn", message),
    });
  }

  const result = await rewriteDraft({
    spec: job.spec,
    data: job.data,
    siteUrl: job.siteUrl,
    companyName: job.companyName,
    draft,
    report,
    ctx: callContext(ctx, gen, "rewrite_page"),
  });
  return afterCall(
    ctx,
    gen,
    result,
    { status: "linting", cursor: { ...cursor, part: "lint", lintAttempts: lintAttempts + 1 }, lintReport: report },
    `Rewrote the copy for ${plural(n, "issue", "issues")} (pass ${lintAttempts + 1} of ${config.generate.lintAttempts})`,
  );
}

// ---------------------------------------------------------------------------
// finish: the key facts, the schema, the two HTML files, the instructions
// ---------------------------------------------------------------------------

async function finishPart(ctx: StepContext, gen: GenerationRow, job: Job, draft: PageDraft): Promise<GenerationRow> {
  const { spec, data, siteUrl, companyName, sheet } = job;
  const pageUrl = gen.page_url ?? pageUrlFor(siteUrl);

  const keyFacts = keyFactsRows(spec, data);
  const jsonld = buildJsonLd({ spec, data, draft, siteUrl, pageUrl });
  const stillToFill = stillToFillIds(spec, data, draft);
  const input: RenderInput = {
    draft,
    keyFacts,
    jsonld,
    companyName,
    pageUrl,
    siteUrl,
    questions: questionsById(spec, stillToFill, companyName),
  };
  const pageHtml = renderPageHtml(input);
  const wordpressHtml = renderWordpressHtml(input);
  const instructions = buildInstructions({
    platform: gen.platform,
    companyName,
    existingSchema: Array.isArray(sheet.existing_schema) ? sheet.existing_schema : [],
    data,
    pageUrl,
  });
  const cost = sumCost(await q.generationLlmCosts(ctx.db, gen.id));

  // The project first, then the generation: a retry after a cut-off here redoes both,
  // so the project can never point at a page that is not there.
  await syncProject(ctx, gen);

  const finishedAt = nowIso();
  let log = appendLog(gen.log, "info", "Built the page, the schema, and the instructions", finishedAt);
  if (stillToFill.length) {
    log = appendLog(log, "warn", `${plural(stillToFill.length, "field is", "fields are")} still to fill; the page leaves a note where each belongs`, finishedAt);
  }
  log = appendLog(log, "info", "Your page is ready", finishedAt);

  return writeGen(ctx, gen.id, {
    page_html: pageHtml,
    wordpress_html: wordpressHtml,
    schema: toJson(jsonld),
    instructions_md: instructions,
    still_to_fill: stillToFill,
    title: draft.metaTitle.trim() || draft.title.trim() || null,
    meta_description: draft.metaDescription.trim() || null,
    status: "done",
    cursor: toJson({ ...generationCursorOf(gen.cursor), part: "finish" }),
    attempts: 0,
    error: null,
    cost_usd: cost,
    log,
  });
}

/** Marks the project ready and points it at this generation, unless a newer generation has taken the project over. */
async function syncProject(ctx: StepContext, gen: GenerationRow): Promise<void> {
  const project = await q.getProject(ctx.db, gen.project_id);
  if (!generationOwnsProject(project, gen.id)) return;
  assertLease(ctx);
  await q.updateProject(ctx.db, project.id, { status: "ready", latest_generation_id: gen.id });
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Records the error on the row and keeps the cursor, so the next step tries
 * the same part again; after config.generate.maxStepAttempts tries the
 * generation fails. Reads the row again first, so what an earlier part of
 * this step saved is kept.
 */
async function recordStepError(ctx: StepContext, generationId: string, last: GenerationRow, e: unknown): Promise<GenerationRow> {
  const message = errorText(e);
  console.error(`generation ${generationId}: step failed on part ${generationPart(last) ?? "main"}: ${message}`);
  const fresh = (await q.getGeneration(ctx.db, generationId).catch(() => null)) ?? last;
  const log = appendLog(fresh.log, "error", message);
  // The call may have been billed even though it failed.
  const cost = await q
    .generationLlmCosts(ctx.db, generationId)
    .then(sumCost)
    .catch(() => null);
  try {
    if ((fresh.attempts ?? 0) >= config.generate.maxStepAttempts) {
      return await failGeneration(
        ctx,
        fresh,
        message,
        appendLog(log, "error", `The page writer stopped after ${config.generate.maxStepAttempts} tries.`),
        cost,
      );
    }
    return await writeGen(ctx, generationId, { error: message, log, ...(cost !== null ? { cost_usd: cost } : {}) });
  } catch (e2) {
    if (e2 instanceof LeaseLostError) return fresh;
    throw e2;
  }
}

/**
 * Marks the generation failed with a message a person can read, and sends
 * the project back to review when this generation is its latest.
 */
async function failGeneration(
  ctx: StepContext,
  gen: GenerationRow,
  message: string,
  log: RunLogEntry[] = appendLog(gen.log, "error", message),
  cost: number | null = null,
): Promise<GenerationRow> {
  const updated = await writeGen(ctx, gen.id, {
    status: "failed",
    error: message,
    log,
    ...(cost !== null ? { cost_usd: cost } : {}),
  });
  try {
    const project = await q.getProject(ctx.db, gen.project_id);
    if (generationOwnsProject(project, gen.id)) await q.updateProject(ctx.db, project.id, { status: "review" });
  } catch (e) {
    console.error(`generation ${gen.id}: could not update the project after the failure: ${errorText(e)}`);
  }
  return updated;
}
