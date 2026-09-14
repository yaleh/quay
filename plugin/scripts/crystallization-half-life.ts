#!/usr/bin/env node
// crystallization-half-life.ts — measure the CRYSTALLIZATION HALF-LIFE of this repo's rules.
//
// ADR-004's claim ("a load-bearing rule that lives only as prose gets re-eroded by the density
// prior; it must become an executable check") rests today on ANECDOTES — CLAUDE.md's "same shape
// re-offended three times in one day" notes. This instrument turns the anecdote into a DISTRIBUTION:
// for every ADR and every CLAUDE.md hard rule it measures the interval from the rule being WRITTEN
// to its executable enforcement LANDING, and counts how many rules still have no artifact at all.
//
// WHAT IT ANSWERS
//   For each ADR in `adr/`: {id, 落笔日期, enforcement 字段值, 强制首次落地提交 SHA 与日期,
//   间隔天数, 状态} where 状态 ∈ {已强制, 部分, 无产物, N/A, 无法判定}.
//   Plus the population statistics: median / p90 / max interval, and the COMPLETE list (never a
//   sample) of rules with no artifact.
//   Plus the CLAUDE.md hard-rule side: per-rule artifact markers (该文件对多条自标「靠自觉」),
//   the count of self-labelled 靠自觉 rules, and a consistency check of each self-label against an
//   INDEPENDENT structural reading (do the artifacts the rule NAMES actually resolve on disk?).
//
// WHY THE STATUS VOCABULARY HAS FIVE VALUES, NOT TWO (硬规则 3b)
//   "无法判定" (cannot judge) is its OWN value and is never folded into "无产物" or "已强制": a
//   rule whose ADR cannot be read, or whose enforcement artifact cannot be resolved, must not
//   read the same as one that was read and found wanting — nor as one that was read and found
//   wired. "N/A" is likewise its own value: an ADR whose declaration explicitly resolves the
//   enforcement question as N/A (irreducibly judgmental, e.g. ADR-006/009/015) has DISCHARGED its
//   obligation per ADR-011 and is NOT a missing artifact. "部分" (partial) is the state the
//   finding's single point (ADR-007) lives in: SOME enforcement is wired, but at least one
//   declared face has no landed artifact / has rotted / has never been executed.
//
// WHAT IS MEASURED, AND FROM WHERE (the DoD's "real adr/ dir + real git history, no fixture")
//   - 落笔日期: frontmatter `date:`; else the body's `**日期**:` line; else the ADR file's own
//     git first-add date. The source used is recorded per record so the reading is auditable.
//   - enforcement 字段值: the frontmatter `enforcement:` scalar (incl. `|` / `>` block scalars)
//     and/or every body `<!-- enforcement ... -->` comment.
//   - 强制首次落地: for each repo path the declaration NAMES, the EARLIEST commit that added it
//     (`git log --diff-filter=A`). A named path is resolved by exact path, by glob, or by
//     basename-stem lookup (the declaration's spelling may have drifted — e.g. ADR-011 names a
//     `.mjs` that only ever existed as `.ts`; the resolution kind is recorded, never hidden).
//   - 状态: see classifyAdr().
//   - The "已接线但从未执行" signal reads `.quay/gate-events.jsonl` (the GateEvent carrier) for
//     the `adr-<id>` gate. ⚠️ It is TRI-STATE by construction: carrier missing/unreadable ⇒
//     `not-evaluated`, a value that NEVER masquerades as "zero events" (硬规则 3b). And a zero
//     here is a statement about the RECORD (no GateEvent was appended), not proof the check never
//     executed through a path that does not append one — see the report's `caveat` field.
//
// DELIBERATELY NOT DONE
//   - Does not run any enforcement command (running ADR-001/007's gates would mutate repo state
//     and is not needed: existence + first-landing + declared-wiring are the measured quantities).
//   - Does not judge whether a rule is "load-bearing" (ADR-004's own deferred E3 predicate).
//   - Does not write anything: it is a READER. The report is its only product.
//
// Exit codes: 0 = report produced; 2 = usage/environment error (no root, no adr/); 3 =
// NOT-EVALUATED (the `adr/` corpus or git history could not be read — an independent value, never
// conflated with "0 ADRs").
//
// Usage:
//   node --experimental-strip-types plugin/scripts/crystallization-half-life.ts [--root <dir>]
//     [--json] [--today <YYYY-MM-DD>] [--adr-dir <dir>] [--claude-md <path>]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── vocabulary ────────────────────────────────────────────────────────────────────────────────
/** Per-ADR status. "无法判定" is an INDEPENDENT value (硬规则 3b), never a synonym of the others. */
export type AdrStatus = "已强制" | "部分" | "无产物" | "N/A" | "无法判定";
/** How a declaration's named path was matched to a repo path.
 *   exact         — the spelled path is on disk
 *   exact-removed — the spelled path was ADDED at some commit and is gone now (rotation, not a typo)
 *   glob          — the token contains a glob metacharacter; matched against the repo index
 *   stem          — the spelling drifted (extension/dir); matched by basename stem
 *   unresolved    — nothing in the repo ever matched it (and it never landed at that spelling) */
export type Resolution = "exact" | "exact-removed" | "glob" | "stem" | "unresolved";
/** Tri-state read of a carrier: an unreadable carrier is NEVER reported as a zero. */
export type TriState = "evaluated" | "not-evaluated";

/** The class AC5 pins as the positive control — the label the `adr-<id>` gate's zero-event
 * reading carries. Spelled once, here, so the report and the check agree verbatim. */
export const LABEL_ADR_GATE_WIRED_BUT_NO_PER_MILESTONE_ARTIFACT =
  "enforcement 已接线但 per-milestone 判据无产物";
export const LABEL_ARTIFACT_DANGLING = "声明的产物是断链符号链接（在盘上但解析不到目标）";
export const LABEL_ARTIFACT_REMOVED = "声明的产物曾落地但现已不在盘上";
export const LABEL_ARTIFACT_NEVER_LANDED = "声明的产物从未落地且不在盘上";
export const LABEL_GATE_EVENTS_NOT_EVALUATED =
  "enforcement 已接线但 GateEvent 载体读不到（未评估，不等于零事件）";

export interface ArtifactRef {
  /** The token exactly as written in the declaration. */
  raw: string;
  /** True when the token contains a glob metacharacter. */
  glob: boolean;
  /** The repo-relative path this token resolved to (null when unresolved). */
  resolved: string | null;
  resolution: Resolution;
  /** Other repo files sharing this token's basename stem (evidence of spelling drift). */
  altMatches: string[];
  /** Present on disk AND, when a symlink, its target resolves. */
  present: boolean;
  /** A symlink whose target does not exist. */
  dangling: boolean;
  firstLandingSha: string | null;
  firstLandingDate: string | null;
}

export interface AdrRecord {
  id: string;
  file: string;
  /** The ADR's OWN lifecycle field (`status: accepted|proposed`) — NOT the verdict below. */
  lifecycle: "accepted" | "proposed" | "unknown";
  authoredDate: string | null;
  authoredDateSource: "frontmatter:date" | "body:**日期**" | "git:first-add" | "none";
  /** Raw enforcement declaration text (all sources joined), or null when none exists. */
  enforcementText: string | null;
  enforcementSources: Array<"frontmatter" | "body-comment">;
  /** `n-a` = the declaration resolves the question as N/A; `named` = it names repo paths;
   * `unnamed` = declared but names nothing; `absent` = no declaration at all. */
  enforcementKind: "n-a" | "named" | "unnamed" | "absent";
  artifacts: ArtifactRef[];
  /** Earliest first-landing across the declaration's artifacts — the "enforcement landed" moment. */
  landedSha: string | null;
  landedDate: string | null;
  /** Earliest first-landing across ALL declarations (body prose included). Differs from
   * `landedDate` when the body names instrumentation that predates the frontmatter binding. */
  landedAnyDate: string | null;
  /** Which reading produced `landedDate` — recorded so the headline is auditable. */
  landedSource: string;
  /** landedDate − authoredDate in days; null when either end is unreadable. */
  intervalDays: number | null;
  status: AdrStatus;
  /** Declared in `.quay/config.yml`'s `gates.adr` (the per-milestone wiring switch). */
  adrGateDeclared: boolean;
  gateEventReading: TriState;
  gateEventCount: number | null;
  caveats: string[];
  /** Zero or more reasons the record could not be judged; non-empty ⇒ status "无法判定". */
  undetermined: string[];
}

export interface HardRuleRecord {
  key: string;
  /** 〔...〕 marker texts found inside the rule's own block. */
  productMarkers: string[];
  noProductMarkers: string[];
  /** File-shaped tokens the rule NAMES inside a 产物 marker (backticked paths w/ a code ext). */
  namedArtifacts: string[];
  resolvedArtifacts: string[];
  unresolvedArtifacts: string[];
  /** Named artifacts whose basename occurs in an EXECUTED registry (test.sh / runner-static-gate.ts
   * / .quay/config.yml). Empty + named.length > 0 ⇒ the artifact exists but nothing runs it — the
   * hard-rule-9 shape ("可见性 ≠ 执行"). */
  wiredArtifacts: string[];
  /** Substrings in the rule's own block that RECORD A REPEAT (a re-offence of that rule). This is
   * the corpus's only re-offence carrier — it is SELF-REPORTED prose, so the matched text is
   * reported verbatim and the conclusion is drawn from what a reader can see, never from a rate.
   * It exists because ADR-004's claim is causal ("prose re-erodes, artifacts do not") and that
   * half is only testable against a re-offence reading. */
  repeatEvidence: string[];
  /** The rule's OWN label vs the independent structural reading. */
  selfLabel: "有产物" | "无产物（靠自觉）" | "混合" | "未标注";
  scriptVerdict:
    | "有产物且点名产物全部落地并已接线"
    | "有产物但未点名文件产物"
    | "产物名不落地"
    | "产物存在但无执行者"
    | "无产物（无对象可核）"
    | "未标注（无法核对）";
  consistent: boolean;
  inconsistentReason: string | null;
}

export interface Report {
  root: string;
  today: string;
  adr: {
    total: number;
    filesOnDisk: number;
    records: AdrRecord[];
    statusCounts: Record<string, number>;
    noArtifact: { total: number; accepted: number; proposed: number; list: string[] };
    nA: string[];
    undetermined: string[];
    /** Interval stats over ADRs whose enforcement landed at least once (incl. since-removed).
     * A NEGATIVE value means the mechanism predates the rule (the rule formalized an existing
     * practice) — kept in the distribution, and counted separately. */
    interval: {
      n: number;
      median: number | null;
      p90: number | null;
      max: number | null;
      negative: number;
      values: Array<{ id: string; days: number }>;
    };
    /** Still-in-effect subset (the decayed ones are the 半衰期 signal). */
    landedThenDecayed: string[];
  };
  claudeMd: {
    file: string;
    rules: HardRuleRecord[];
    selfLabelled: { total: number; keys: string[] };
    productLabelled: { total: number; keys: string[] };
    unlabelled: string[];
    /** Rules whose block carries no 〔产物…〕/〔无产物…〕 marker at all ⇒ the cross-check has no
     * input. Its own bucket, never counted as an inconsistency (硬规则 3b). */
    notCrossCheckable: string[];
    inconsistencies: Array<{ key: string; reason: string }>;
    /** The ADR-004 causal half, as far as this corpus can carry it: which rules RECORD a repeat,
     * split by whether the rule carries an artifact. A difference here is evidence for the claim;
     * their absence is evidence that the corpus cannot show it (and is reported as such). */
    repeatEvidence: { withArtifact: string[]; selfLabelled: string[]; unlabelled: string[] };
  };
}

// ── small utilities ───────────────────────────────────────────────────────────────────────────

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

function dedent(lines: string[]): string {
  const indents = lines.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => (l.trim() === "" ? "" : l.slice(min))).join("\n");
}

export function runGit(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** Frontmatter = the block between the FIRST two line-delimited `---` markers (never a naive
 * `split("---")`, which truncates silently on a `---` inside the body). */
export function splitFrontmatter(raw: string): { fm: string | null; body: string } {
  const lines = raw.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return { fm: null, body: raw };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return { fm: lines.slice(1, i).join("\n"), body: lines.slice(i + 1).join("\n") };
  }
  return { fm: null, body: raw };
}

/** Minimal YAML-ish frontmatter reader: `key: value`, quoted scalars, and `|` / `>` block scalars.
 * Only the five keys this instrument reads are ever consulted. */
export function parseFrontmatterFields(fm: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = fm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = lines[i].length - lines[i].trimStart().length;
    const rest = m[2];
    if (/^\s*[|>][-+]?\s*$/.test(rest)) {
      const buf: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === "") {
          // A blank line ends the block when the NEXT non-blank line is not more indented.
          let k = j + 1;
          while (k < lines.length && lines[k].trim() === "") k++;
          if (k >= lines.length) break;
          const ind = lines[k].length - lines[k].trimStart().length;
          if (ind <= indent) break;
          buf.push("");
          continue;
        }
        const ind = l.length - l.trimStart().length;
        if (ind <= indent) break;
        buf.push(l);
      }
      i = j - 1;
      const text = dedent(buf);
      out.set(m[1], rest.trim().startsWith(">") ? text.replace(/([^\n])\n(?!\n)/g, "$1 ").trim() : text.trim());
      continue;
    }
    out.set(m[1], unquote(rest));
  }
  return out;
}

/** A path-shaped token: at least one `.` with a code/config extension. Glob metachars allowed
 * (ADR-007's declaration names `experiments/.../git-lens-*.ts`). The trailing negative lookahead
 * stops `gate-events.jsonl` from matching as `.js` — a prefix hit is a different token, not a hit. */
const TOKEN_RE = /[A-Za-z0-9_@./*-]+\.(?:sh|mjs|cjs|js|mts|ts|tsx|yml|yaml)(?![A-Za-z0-9_])/g;
/** Tokens that are prose, not repo paths. */
const TOKEN_DENY = new Set(["e.g", "i.e", "etc", "vs", "v1", "e.g.", "no.js"]);
/** Path PREFIXES excluded from artifact candidates: `.quay/` holds config + runtime carriers, not
 * enforcement artifacts (the wiring they describe is read structurally from `gates.adr` instead). */
const TOKEN_PREFIX_DENY = [".quay/"];

export function extractArtifactTokens(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) {
    let t = m[0];
    t = t.replace(/^[*-]+/, "");
    // Strip a trailing `:NNN[:MM]` line reference (ADR-021's `proposal-convergence.ts:234`).
    t = t.replace(/:\d+(?::\d+)?$/, "");
    if (t.length < 4) continue;
    if (TOKEN_DENY.has(t.toLowerCase())) continue;
    if (TOKEN_PREFIX_DENY.some((p) => t.startsWith(p))) continue;
    if (!/^[A-Za-z0-9_@.]/.test(t)) continue;
    found.add(t);
  }
  return [...found];
}

// ── the repo-wide index (one walk; used for stem + glob resolution) ───────────────────────────

const WALK_SKIP = new Set([
  ".git", "node_modules", ".quay", "archive", "dist", ".claude",
]);

export interface RepoIndex {
  /** basename stem → repo-relative paths (an index, so a declaration's spelling drift is visible). */
  stems: Map<string, string[]>;
  allPaths: string[];
}

function stemOf(p: string): string {
  const b = path.basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

export function buildRepoIndex(root: string): RepoIndex {
  const stems = new Map<string, string[]>();
  const allPaths: string[] = [];
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (WALK_SKIP.has(e.name)) continue;
      if (e.name.startsWith("deliver-worktree-")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r, r);
      else {
        allPaths.push(r);
        const s = stemOf(r);
        const arr = stems.get(s);
        if (arr) arr.push(r);
        else stems.set(s, [r]);
      }
    }
  };
  walk(".", "");
  allPaths.sort();
  return { stems, allPaths };
}

function matchesGlob(p: string, glob: string): boolean {
  const rx = new RegExp(
    "^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, " ").replace(/\*/g, "[^/]*").replace(/ /g, ".*") + "$",
  );
  return rx.test(p);
}

/** Existence with symlink-awareness: a dangling symlink is NEITHER present nor absent-by-omission
 * — it is its own reading, and the report says so. */
export function probePath(root: string, rel: string): { present: boolean; dangling: boolean } {
  const abs = path.join(root, rel);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return { present: false, dangling: false };
  }
  if (!st.isSymbolicLink()) return { present: true, dangling: false };
  try {
    fs.statSync(abs);
    return { present: true, dangling: false };
  } catch {
    return { present: false, dangling: true };
  }
}

function firstLanding(root: string, rel: string): { sha: string; date: string } | null {
  const out = runGit(root, ["log", "--diff-filter=A", "--format=%H%x09%aI", "--", rel]);
  if (out === null) return null;
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1]; // git log is newest-first ⇒ the last line is the earliest add
  const [sha, date] = last.split("\t");
  if (!sha || !date) return null;
  return { sha, date };
}

export function resolveArtifact(root: string, index: RepoIndex, raw: string): ArtifactRef {
  const glob = /[*?[]/.test(raw);
  const ref: ArtifactRef = {
    raw,
    glob,
    resolved: null,
    resolution: "unresolved",
    altMatches: [],
    present: false,
    dangling: false,
    firstLandingSha: null,
    firstLandingDate: null,
  };
  if (glob) {
    const matches = index.allPaths.filter((p) => matchesGlob(p, raw));
    if (matches.length > 0) {
      ref.resolved = matches[0];
      ref.resolution = "glob";
      ref.altMatches = matches.slice(1);
    }
  } else {
    const probe = probePath(root, raw);
    if (probe.present || probe.dangling) {
      ref.resolved = raw;
      ref.resolution = "exact";
    } else {
      const fl0 = firstLanding(root, raw);
      if (fl0) {
        // The spelled path was tracked and has since been removed. Report the SPELLED path (its
        // own landing commit is the honest "enforcement landed" moment), not a same-stem survivor.
        ref.resolved = raw;
        ref.resolution = "exact-removed";
        ref.firstLandingSha = fl0.sha;
        ref.firstLandingDate = fl0.date;
        return ref;
      }
      const s = stemOf(raw);
      const rawDir = path.dirname(raw);
      const cands = (index.stems.get(s) ?? []).filter((p) => p !== raw);
      // Prefer a survivor in the SAME directory the declaration named, then the earliest landing,
      // then the shortest path — a deterministic order, so the reading is reproducible.
      const ranked = cands
        .map((p) => ({ p, sameDir: path.dirname(p) === rawDir ? 0 : 1, landed: firstLanding(root, p)?.date ?? "￿" }))
        .sort((a, b) => a.sameDir - b.sameDir || (a.landed < b.landed ? -1 : a.landed > b.landed ? 1 : 0) || a.p.length - b.p.length);
      if (ranked.length > 0) {
        ref.resolved = ranked[0].p;
        ref.resolution = "stem";
        ref.altMatches = ranked.slice(1).map((r) => r.p);
      }
    }
  }
  if (ref.resolved) {
    const probe = probePath(root, ref.resolved);
    ref.present = probe.present;
    ref.dangling = probe.dangling;
    const fl = firstLanding(root, ref.resolved);
    if (fl) {
      ref.firstLandingSha = fl.sha;
      ref.firstLandingDate = fl.date;
    }
  }
  return ref;
}

// ── ADR side ──────────────────────────────────────────────────────────────────────────────────

function bodyAuthoredDate(raw: string): string | null {
  const m = /^\s*\*\*日期\*\*\s*[:：]\s*(\d{4}-\d{2}-\d{2})/m.exec(raw);
  return m ? m[1] : null;
}

export function classifyAdr(rec: Omit<AdrRecord, "status" | "caveats">): { status: AdrStatus; caveats: string[] } {
  if (rec.undetermined.length > 0) return { status: "无法判定", caveats: [] };
  if (rec.enforcementKind === "n-a") return { status: "N/A", caveats: [] };
  const present = rec.artifacts.filter((a) => a.present);
  if (rec.enforcementKind === "absent" || rec.enforcementKind === "unnamed" || present.length === 0) {
    return { status: "无产物", caveats: [] };
  }
  const caveats: string[] = [];
  if (rec.artifacts.some((a) => a.dangling)) caveats.push(LABEL_ARTIFACT_DANGLING);
  if (rec.artifacts.some((a) => !a.present && !a.dangling && a.firstLandingSha)) caveats.push(LABEL_ARTIFACT_REMOVED);
  if (rec.artifacts.some((a) => !a.present && !a.dangling && !a.firstLandingSha) && present.length > 0) {
    caveats.push(LABEL_ARTIFACT_NEVER_LANDED);
  }
  if (rec.adrGateDeclared) {
    if (rec.gateEventReading === "not-evaluated") caveats.push(LABEL_GATE_EVENTS_NOT_EVALUATED);
    else if (rec.gateEventCount === 0) caveats.push(LABEL_ADR_GATE_WIRED_BUT_NO_PER_MILESTONE_ARTIFACT);
  }
  return { status: caveats.length > 0 ? "部分" : "已强制", caveats };
}

export function analyzeAdr(root: string, index: RepoIndex, relFile: string, todayMs: number): AdrRecord {
  const abs = path.join(root, relFile);
  const undetermined: string[] = [];
  let raw = "";
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (e) {
    undetermined.push(`ADR 文件读不到: ${String((e as Error).message)}`);
  }
  const { fm, body } = splitFrontmatter(raw);
  const fields = fm === null ? new Map<string, string>() : parseFrontmatterFields(fm);
  const id = fields.get("id") ?? path.basename(relFile).split("-").slice(0, 2).join("-");

  // ── authored date (three sources, recorded) ──
  let authoredDate: string | null = fields.get("date") ?? null;
  let authoredDateSource: AdrRecord["authoredDateSource"] = authoredDate ? "frontmatter:date" : "none";
  if (!authoredDate) {
    const b = bodyAuthoredDate(raw);
    if (b) {
      authoredDate = b;
      authoredDateSource = "body:**日期**";
    }
  }
  if (!authoredDate) {
    const fl = firstLanding(root, relFile);
    if (fl) {
      authoredDate = fl.date.slice(0, 10);
      authoredDateSource = "git:first-add";
    }
  }

  // ── enforcement declarations (each tagged with its source) ──
  const declarations: Array<{ source: "frontmatter" | "body-comment"; text: string }> = [];
  const fmEnf = fields.get("enforcement");
  if (fmEnf !== undefined && fmEnf.trim() !== "") declarations.push({ source: "frontmatter", text: fmEnf.trim() });
  for (const m of raw.matchAll(/<!--\s*enforcement\b([\s\S]*?)-->/g)) {
    declarations.push({ source: "body-comment", text: m[1].replace(/^\s*[:(]?\s*/, "").trim() });
  }
  const enforcementSources: AdrRecord["enforcementSources"] = declarations.map((d) => d.source);
  const enforcementText = declarations.length ? declarations.map((d) => d.text).join("\n---\n") : null;

  let enforcementKind: AdrRecord["enforcementKind"] = "absent";
  if (declarations.length > 0) {
    const startsN_A = declarations.some((d) => /^\s*N\/A\b/i.test(d.text));
    const tokens = new Set<string>();
    for (const d of declarations) for (const t of extractArtifactTokens(d.text)) tokens.add(t);
    if (startsN_A) enforcementKind = "n-a";
    else if (tokens.size > 0) enforcementKind = "named";
    else enforcementKind = "unnamed";
  }

  const artifacts: ArtifactRef[] = [];
  const orderedTokens: string[] = [];
  if (enforcementKind === "named") {
    const seen = new Map<string, ArtifactRef>();
    for (const d of declarations) {
      for (const t of extractArtifactTokens(d.text)) {
        if (!seen.has(t)) {
          seen.set(t, resolveArtifact(root, index, t));
          orderedTokens.push(t);
        }
      }
    }
    artifacts.push(...seen.values());
  }

  // ── earliest landing ──
  // The HEADLINE moment is the BOUND enforcement's: the FRONTMATTER `enforcement:` command's
  // subject — what ADR-007 calls "the gate wiring" — or, when there is no frontmatter binding, the
  // subject of the first body declaration. "Subject" = the declaration's FIRST path-shaped token:
  // an `enforcement:` value leads with the thing that enforces and elaborates afterwards
  // (ADR-011: `scripts/it0-…mjs — LANDED …` then cross-references). Landing dates of the
  // ELABORATION tokens are kept per-artifact (`artifacts[]`) and the earliest of ALL of them is
  // reported as `landedAnyDate` — never silently promoted to the headline.
  const earliest = (refs: ArtifactRef[]): { sha: string; date: string } | null => {
    const ls = refs.filter((a) => a.firstLandingDate).map((a) => ({ sha: a.firstLandingSha!, date: a.firstLandingDate! }));
    ls.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return ls[0] ?? null;
  };
  const headToken = enforcementKind === "named" ? (orderedTokens[0] ?? null) : null;
  const headRef = headToken ? artifacts.find((a) => a.raw === headToken) : undefined;
  const anyLanding = earliest(artifacts);
  const headLanding = headRef?.firstLandingDate ? { sha: headRef.firstLandingSha!, date: headRef.firstLandingDate } : null;
  const head = headLanding ?? anyLanding;
  const landedSha = head?.sha ?? null;
  const landedDate = head?.date ?? null;
  const landedAnyDate = anyLanding?.date ?? null;
  const landedSource: AdrRecord["landedSource"] = headLanding
    ? `declaration-head:${headRef!.raw}`
    : anyLanding
      ? "earliest-of-all-artifacts"
      : "none";

  let intervalDays: number | null = null;
  if (authoredDate && landedDate) {
    const a = Date.parse(`${authoredDate}T00:00:00Z`);
    const b = Date.parse(landedDate);
    if (Number.isFinite(a) && Number.isFinite(b)) intervalDays = Math.round((b - a) / 86400000);
  } else if (authoredDate === null) {
    undetermined.push("落笔日期读不到（frontmatter date / body **日期** / git first-add 三者皆无）");
  }

  const statusField = (fields.get("status") ?? "unknown") as AdrRecord["lifecycle"];
  const partial: Omit<AdrRecord, "status" | "caveats"> = {
    id,
    file: relFile,
    lifecycle: ["accepted", "proposed"].includes(statusField) ? statusField : "unknown",
    authoredDate,
    authoredDateSource,
    enforcementText,
    enforcementSources,
    enforcementKind,
    artifacts,
    landedSha,
    landedDate,
    landedAnyDate,
    landedSource,
    intervalDays,
    adrGateDeclared: false,
    gateEventReading: "not-evaluated",
    gateEventCount: null,
    undetermined,
  };
  // Classify with the gate-wiring fields still at their defaults; main() fills those from the
  // config/GateEvent carriers and re-classifies (the wiring switch is a workspace fact, not an
  // ADR-file fact, so it cannot be read here).
  const first = classifyAdr(partial);
  return { ...partial, status: first.status, caveats: first.caveats };
}

// ── config + gate-event carriers ──────────────────────────────────────────────────────────────

export interface GateDecls {
  adrIds: Set<string>;
  /** The raw config text (used to read "is this artifact declared as a gate at all"). */
  text: string;
  readable: boolean;
}

export function readGateDeclarations(root: string): GateDecls {
  try {
    const text = fs.readFileSync(path.join(root, ".quay", "config.yml"), "utf8");
    const adrIds = new Set<string>();
    const block = /^\s*adr:\s*$/m.exec(text);
    if (block) {
      const after = text.slice(block.index + block[0].length);
      for (const line of after.split("\n")) {
        const m = /^\s*-\s*"?([A-Za-z]+-\d+)"?/.exec(line);
        if (m) adrIds.add(m[1]);
        else if (/^\s*\S/.test(line) && !/^\s*#/.test(line)) break;
      }
    }
    return { adrIds, text, readable: true };
  } catch {
    return { adrIds: new Set(), text: "", readable: false };
  }
}

/** GateEvent counts per gate name. `null` = carrier unreadable ⇒ NOT-EVALUATED (硬规则 3b): an
 * unreadable carrier must never be reported as "0 events". */
export function readGateEvents(root: string): Map<string, number> | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, ".quay", "gate-events.jsonl"), "utf8");
  } catch {
    return null;
  }
  const counts = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let gate: unknown;
    try {
      gate = (JSON.parse(line) as { gate?: unknown }).gate;
    } catch {
      continue;
    }
    if (typeof gate !== "string") continue;
    counts.set(gate, (counts.get(gate) ?? 0) + 1);
  }
  return counts;
}

// ── CLAUDE.md hard-rule side ──────────────────────────────────────────────────────────────────

const RULE_START_DOT = /^(\d{1,2}[a-z]?)\.\s+\*\*/;
const RULE_START_BOLD = /^\s*\*\*(\d{1,2}[a-z])[（\s]/;
const MARKER_RE = /〔[\s\S]*?〕/g;
/** Re-offence carriers in a rule's own prose: an explicitly named repeat family, or a count attached
 * to a repeat verb. Deliberately narrow — every OTHER "N 次" in a rule block is a cost or instance
 * count, not a repeat, and a broad pattern would turn this reading into noise. The matched text is
 * reported, so a wrong match is visible rather than silently counted. */
const REPEAT_RE = /(?:再犯|复发|重犯|同形状?)/g;
const REPEAT_COUNT_RE = /(?:一天内|同日|连续|再次|连犯|又连|又犯|四次|三次|两次|多次|发生率[^\n]{0,8}\d)/g;
/** A file-shaped token inside backticks: a path with a code extension, no whitespace. */
const BACKTICK_PATH_RE = /`([^`\s]+\.(?:sh|mjs|cjs|js|mts|ts|tsx))`/g;

export function parseHardRules(root: string, claudeMdRel: string, index: RepoIndex): HardRuleRecord[] {  let raw: string;
  try {
    raw = fs.readFileSync(path.join(root, claudeMdRel), "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => /^##\s+认识论硬规则/.test(l));
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start + 1, end);

  // The EXECUTED registry surface: a basename here means the artifact is reached by a path that
  // actually runs (the suite runner, its code-class checker registry, or a declared gate).
  const registryBasenames = new Set<string>();
  for (const rel of ["scripts/test.sh", "plugin/scripts/runner-static-gate.ts", ".quay/config.yml"]) {
    try {
      const t = fs.readFileSync(path.join(root, rel), "utf8");
      for (const m of t.matchAll(/[A-Za-z0-9_@.-]+\.(?:sh|mjs|cjs|js|mts|ts|tsx)/g)) registryBasenames.add(m[0]);
    } catch {
      /* an unreadable registry contributes nothing; it is not evidence of absence */
    }
  }

  const starts: Array<{ at: number; key: string }> = [];
  for (let i = 0; i < section.length; i++) {
    const a = RULE_START_DOT.exec(section[i]);
    const b = RULE_START_BOLD.exec(section[i]);
    const key = a?.[1] ?? b?.[1];
    if (key) starts.push({ at: i, key });
  }

  const out: HardRuleRecord[] = [];
  for (let i = 0; i < starts.length; i++) {
    const { at, key } = starts[i];
    const stop = i + 1 < starts.length ? starts[i + 1].at : section.length;
    const block = section.slice(at, stop).join("\n");
    const productMarkers: string[] = [];
    const noProductMarkers: string[] = [];
    for (const m of block.matchAll(MARKER_RE)) {
      const t = m[0];
      if (/无产物|靠自觉|无独立产物/.test(t)) noProductMarkers.push(t);
      else if (/产物/.test(t)) productMarkers.push(t);
    }
    const namedArtifacts = new Set<string>();
    for (const pm of productMarkers) {
      for (const m of pm.matchAll(BACKTICK_PATH_RE)) namedArtifacts.add(m[1]);
    }
    const named = [...namedArtifacts];
    const resolved: string[] = [];
    const unresolved: string[] = [];
    const wiredArtifacts: string[] = [];
    for (const n of named) {
      const ref = resolveArtifact(root, index, n);
      if (ref.present) resolved.push(n);
      else unresolved.push(n);
      if (registryBasenames.has(path.basename(n))) wiredArtifacts.push(n);
    }

    const repeatEvidence = [...new Set([...block.matchAll(REPEAT_RE), ...block.matchAll(REPEAT_COUNT_RE)].map((m) => m[0]))];

    let selfLabel: HardRuleRecord["selfLabel"];    if (productMarkers.length > 0 && noProductMarkers.length > 0) selfLabel = "混合";
    else if (noProductMarkers.length > 0) selfLabel = "无产物（靠自觉）";
    else if (productMarkers.length > 0) selfLabel = "有产物";
    else selfLabel = "未标注";

    let scriptVerdict: HardRuleRecord["scriptVerdict"];
    let consistent = true;
    let inconsistentReason: string | null = null;
    if (selfLabel === "未标注") {
      // No self-label exists ⇒ there is NOTHING to cross-check. This is its own value (硬规则 3b:
      // "无法核对" must not read like "核对过且一致"), so it is reported as its own bucket rather
      // than as an inconsistency.
      scriptVerdict = "未标注（无法核对）";
    } else if (named.length === 0) {
      scriptVerdict = selfLabel === "无产物（靠自觉）" ? "无产物（无对象可核）" : "有产物但未点名文件产物";
    } else if (unresolved.length > 0) {
      scriptVerdict = "产物名不落地";
      consistent = false;
      inconsistentReason = `自标有产物，但点名的产物在盘上解析不到: ${unresolved.join(", ")}`;
    } else if (wiredArtifacts.length === 0) {
      scriptVerdict = "产物存在但无执行者";
      consistent = false;
      inconsistentReason =
        `自标有产物且产物都在盘上，但没有任何一个出现在已执行的登记面（scripts/test.sh / runner-static-gate.ts / .quay/config.yml）: ` +
        `${named.join(", ")} —— 硬规则 9 的形态（可见性 ≠ 执行）`;
    } else {
      scriptVerdict = "有产物且点名产物全部落地并已接线";
    }
    out.push({
      key,
      productMarkers,
      noProductMarkers,
      namedArtifacts: named,
      resolvedArtifacts: resolved,
      unresolvedArtifacts: unresolved,
      wiredArtifacts,
      repeatEvidence,
      selfLabel,
      scriptVerdict,
      consistent,
      inconsistentReason,
    });
  }
  return out;
}

// ── interval statistics ───────────────────────────────────────────────────────────────────────

/** Nearest-rank percentile: index = ceil(p·n) − 1 over the ASCENDING values. Stated explicitly so
 * the reading is reproducible rather than "the middle-ish one". */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

export function median(sortedAsc: number[]): number | null {
  if (sortedAsc.length === 0) return null;
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 ? sortedAsc[mid] : Math.round(((sortedAsc[mid - 1] + sortedAsc[mid]) / 2) * 10) / 10;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────

function resolveRoot(explicit: string | null): { root: string } | { error: string; code: 2 | 3 } {
  if (explicit) {
    const abs = path.resolve(explicit);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return { error: `--root does not exist: ${abs}`, code: 2 };
    }
    if (!st.isDirectory()) return { error: `--root is not a directory: ${abs}`, code: 2 };
    // The caller NAMED this root. A root that cannot produce the corpus is NOT-EVALUATED (3) — the
    // distinct value for "could not be read", never the usage error (2) and never "0 ADRs".
    return { root: abs };
  }
  const seeds: string[] = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const seed of seeds) {
    let dir = path.resolve(seed);
    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(path.join(dir, "adr")) && fs.existsSync(path.join(dir, "CLAUDE.md"))) return { root: dir };
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return { error: "cannot resolve a repo root (need a dir holding adr/ and CLAUDE.md); pass --root", code: 2 };
}

function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  return s + " ".repeat(Math.max(0, n - w));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let rootArg: string | null = null;
  let json = false;
  let today: string | null = null;
  let adrDirRel = "adr";
  let claudeMdRel = "CLAUDE.md";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") rootArg = argv[++i] ?? null;
    else if (a.startsWith("--root=")) rootArg = a.slice(7);
    else if (a === "--json") json = true;
    else if (a === "--today") today = argv[++i] ?? null;
    else if (a.startsWith("--today=")) today = a.slice(8);
    else if (a === "--adr-dir") adrDirRel = argv[++i] ?? adrDirRel;
    else if (a === "--claude-md") claudeMdRel = argv[++i] ?? claudeMdRel;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: node --experimental-strip-types crystallization-half-life.ts [--root <dir>] [--json]\n" +
          "         [--today <YYYY-MM-DD>] [--adr-dir <dir>] [--claude-md <path>]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`crystallization-half-life: unknown arg: ${a}\n`);
      process.exit(2);
    }
  }

  const resolved = resolveRoot(rootArg);
  if ("error" in resolved) {
    process.stderr.write(`crystallization-half-life: ${resolved.error}\n`);
    process.exit(resolved.code);
  }
  const root = resolved.root;

  const adrAbs = path.join(root, adrDirRel);
  let adrFiles: string[] = [];
  try {
    adrFiles = fs.readdirSync(adrAbs).filter((n) => n.endsWith(".md")).sort();
  } catch (e) {
    process.stderr.write(`crystallization-half-life: NOT-EVALUATED — adr dir unreadable (${adrAbs}): ${String((e as Error).message)}\n`);
    process.exit(3);
  }
  const gitOk = runGit(root, ["rev-parse", "--git-dir"]) !== null;
  if (!gitOk) {
    process.stderr.write("crystallization-half-life: NOT-EVALUATED — git history unreadable; the landing/interval readings have no source\n");
    process.exit(3);
  }

  const todayIso = today ?? new Date().toISOString().slice(0, 10);
  const index = buildRepoIndex(root);
  const gates = readGateDeclarations(root);
  const events = readGateEvents(root);

  const records: AdrRecord[] = [];
  for (const f of adrFiles) {
    const rec = analyzeAdr(root, index, `${adrDirRel}/${f}`, Date.parse(`${todayIso}T00:00:00Z`));
    // The per-milestone wiring switch: the ADR is declared in `.quay/config.yml`'s `gates.adr`.
    rec.adrGateDeclared = gates.adrIds.has(rec.id);
    if (rec.adrGateDeclared) {
      if (events === null) {
        rec.gateEventReading = "not-evaluated";
        rec.gateEventCount = null;
      } else {
        rec.gateEventReading = "evaluated";
        rec.gateEventCount = events.get(`adr-${rec.id.split("-")[1]}`) ?? 0;
      }
    }
    const verdict = classifyAdr(rec);
    rec.status = verdict.status;
    rec.caveats = verdict.caveats;
    records.push(rec);
  }

  const statusCounts: Record<string, number> = {};
  for (const r of records) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  const noArtifactRecords = records.filter((r) => r.status === "无产物");
  const measured = records
    .filter((r) => r.intervalDays !== null)
    .map((r) => ({ id: r.id, days: r.intervalDays! }))
    .sort((a, b) => a.days - b.days);
  const days = measured.map((m) => m.days);

  const hardRules = parseHardRules(root, claudeMdRel, index);
  const selfLabelled = hardRules.filter((r) => r.noProductMarkers.length > 0).map((r) => r.key);
  const productLabelled = hardRules.filter((r) => r.productMarkers.length > 0 && r.noProductMarkers.length === 0).map((r) => r.key);
  const unlabelled = hardRules.filter((r) => r.selfLabel === "未标注").map((r) => r.key);
  const inconsistencies = hardRules.filter((r) => !r.consistent).map((r) => ({ key: r.key, reason: r.inconsistentReason ?? "" }));

  const report: Report = {
    root,
    today: todayIso,
    adr: {
      total: records.length,
      filesOnDisk: adrFiles.length,
      records,
      statusCounts,
      noArtifact: {
        total: noArtifactRecords.length,
        accepted: noArtifactRecords.filter((r) => r.lifecycle === "accepted").length,
        proposed: noArtifactRecords.filter((r) => r.lifecycle === "proposed").length,
        list: noArtifactRecords.map((r) => r.id),
      },
      nA: records.filter((r) => r.status === "N/A").map((r) => r.id),
      undetermined: records.filter((r) => r.status === "无法判定").map((r) => r.id),
      interval: {
        n: measured.length,
        median: median(days),
        p90: percentile(days, 0.9),
        max: days.length ? days[days.length - 1] : null,
        negative: days.filter((d) => d < 0).length,
        values: measured,
      },
      landedThenDecayed: records.filter((r) => r.status === "无产物" && r.landedSha !== null).map((r) => r.id),
    },
    claudeMd: {
      file: claudeMdRel,
      rules: hardRules,
      selfLabelled: { total: selfLabelled.length, keys: selfLabelled },
      productLabelled: { total: productLabelled.length, keys: productLabelled },
      unlabelled,
      notCrossCheckable: unlabelled,
      inconsistencies,
      repeatEvidence: {
        withArtifact: hardRules.filter((r) => r.repeatEvidence.length > 0 && r.productMarkers.length > 0).map((r) => r.key),
        selfLabelled: hardRules.filter((r) => r.repeatEvidence.length > 0 && r.noProductMarkers.length > 0).map((r) => r.key),
        unlabelled: hardRules.filter((r) => r.repeatEvidence.length > 0 && r.productMarkers.length === 0 && r.noProductMarkers.length === 0).map((r) => r.key),
      },
    },
  };

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exit(0);
  }

  const L: string[] = [];
  L.push(`crystallization half-life — ${root}`);
  L.push(`today=${todayIso}  adr files on disk=${adrFiles.length}  analyzed=${records.length}`);
  L.push("");
  L.push(`${pad("ADR", 10)}${pad("落笔", 12)}${pad("源", 18)}${pad("落地", 12)}${pad("间隔d", 8)}状态`);
  L.push("-".repeat(78));
  for (const r of records) {
    L.push(
      pad(r.id, 10) +
        pad(r.authoredDate ?? "-", 12) +
        pad(r.authoredDateSource, 18) +
        pad(r.landedDate ? r.landedDate.slice(0, 10) : "-", 12) +
        pad(r.intervalDays === null ? "-" : String(r.intervalDays), 8) +
        r.status +
        (r.caveats.length ? `  [${r.caveats.length} caveat]` : ""),
    );
  }
  L.push("");
  L.push(`状态分布: ${JSON.stringify(statusCounts)}`);
  L.push(`N/A（明确判定不可机械强制，不算无产物）: ${report.adr.nA.join(", ") || "(none)"}`);
  L.push(`无法判定（独立取值）: ${report.adr.undetermined.join(", ") || "(none)"}`);
  L.push(`至今无产物: ${report.adr.noArtifact.total} 条 (accepted ${report.adr.noArtifact.accepted} / proposed ${report.adr.noArtifact.proposed})`);
  L.push(`  清单: ${report.adr.noArtifact.list.join(", ") || "(none)"}`);
  L.push(`  其中曾落地后移除: ${report.adr.landedThenDecayed.join(", ") || "(none)"}`);
  L.push(
    `间隔分布 (n=${report.adr.interval.n}): 中位 ${report.adr.interval.median} d | p90 ${report.adr.interval.p90} d | 最大 ${report.adr.interval.max} d | 负值(机制先于规则) ${report.adr.interval.negative}`,
  );
  L.push("");
  L.push(`CLAUDE.md 硬规则: ${hardRules.length} 条 | 自标靠自觉 ${report.claudeMd.selfLabelled.total} 条 | 纯有产物 ${report.claudeMd.productLabelled.total} 条`);
  L.push(`  自标靠自觉: ${report.claudeMd.selfLabelled.keys.join(", ")}`);
  L.push(`  未标注（无法核对，独立取值）: ${report.claudeMd.notCrossCheckable.join(", ") || "(none)"}`);
  L.push(`  不一致: ${inconsistencies.length ? inconsistencies.map((i) => `${i.key}(${i.reason})`).join(" | ") : "(none)"}`);
  L.push(
    `  自陈再犯（该仓库唯一的再犯载体，自报散文）: 有产物 ${report.claudeMd.repeatEvidence.withArtifact.join(", ") || "(none)"}` +
      ` | 靠自觉 ${report.claudeMd.repeatEvidence.selfLabelled.join(", ") || "(none)"}` +
      ` | 未标注 ${report.claudeMd.repeatEvidence.unlabelled.join(", ") || "(none)"}`,
  );
  L.push("");
  L.push("caveat 明细:");
  for (const r of records.filter((x) => x.caveats.length > 0)) {
    L.push(`  ${r.id}: ${r.caveats.join(" / ")}`);
  }
  process.stdout.write(L.join("\n") + "\n");
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  void main();
}
