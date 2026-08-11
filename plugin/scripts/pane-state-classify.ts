#!/usr/bin/env node
// pane-state-classify.ts — pure classifier for a Claude Code pane's state
// (tasks/gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable, rulings D/E).
//
// Every screen observer in this repo used to HASH the pane (`capture-pane` → mask → md5) and
// answer "did the screen change" — which cannot distinguish "the session is waiting for its user"
// from "the screen happened not to redraw". This module replaces that with a SHAPE CLASSIFIER:
//   classifyPaneState(paneText) -> { state, confidence, region, raw }
//
// Contract (ADR-016 Amendment 2026-08-04 boundary b): only the BOTTOM region of the pane (the
// input box + status line, the part a human actually watches) enters the decision path — never
// the whole screen. ADR-016 boundary a: the states are ENUMERATED (waiting-input /
// permission-prompt / busy / error-banner / unknown), not an open set.
//
// Two-tier anti-brittleness (ruling D):
//   tier-1  deterministic matching of the common shapes (cheap, pure, no tmux, no pty);
//   tier-2  nothing matches, or the shape is anomalous ⇒ return `unknown` and pass the bottom
//           region text through verbatim in `raw`, for the OUTER (an LLM) to read directly.
//           Without tier-2 a classifier silently goes blind on a new TUI version — and silent
//           blindness is exactly the failure shape of the whole hash family.
//
// Pure function: no side effects, never spawns or reads files. Its fixtures are recorded .txt
// pane texts, so the tests need no tmux server, no pty, no hand-built fake TUI (ruling E).
//
// Usage:
//   node pane-state-classify.ts [--selfcheck]   (runs the in-file RED/GREEN fixtures)

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ENUMERATED_STATES = ["waiting-input", "permission-prompt", "busy", "error-banner", "unknown"];

/** Default number of bottom lines the classifier examines. The Claude Code TUI's input box +
 * status line occupy the last ~6 lines (prompt line, separator, status line, plus one or two
 * content lines above). 10 gives a small margin while staying far short of the whole screen —
 * the margin matters because a scrolled content line (e.g. an elapsed "Worked for …" line) can
 * sit just above the input box, and we still want the region to be small enough that upper-screen
 * content can never flip the verdict (AC6 negative control). */
export const DEFAULT_BOTTOM_LINES = 10;

/** The bottom `lines` lines of a pane text, with trailing blank lines stripped first so the
 * region always ends at the last real content (the status line). Named + exported because AC2
 * pins the region-taking to this one function. */
export function bottomRegion(paneText: string, lines = DEFAULT_BOTTOM_LINES): string {
  let split = paneText.split("\n");
  while (split.length && split[split.length - 1].trim() === "") split = split.slice(0, -1);
  return split.slice(Math.max(0, split.length - lines)).join("\n");
}

// ── tier-1 shape signatures (deterministic; based on the recorded real panes 2026-08-04) ────────

/** Approval / permission dialogs the session is waiting on the user to decide. The recorded real
 * sample (trust-check: "Quick safety check: … trust this folder … Enter to confirm") plus the
 * tool-approval family ("Do you want to proceed?") the task's AC4 names. Deliberately does NOT
 * match the word "permissions" (the "bypass permissions on" mode indicator appears in every
 * status line of this fleet — a real capture tripped on exactly that).
 *
 * Allow/Deny/Grant access are NOT bare words here (gap-pane-state-allow-deny-bare-word-false-positive
 * + gap-pane-classify-allow-bare-word-and-agent-list-masks-busy defect 1): a bare case-insensitive
 * `Allow` matches a task title's `--allow-thin`, `Deny` matches any deny/denied title, and `Grant
 * access` matches any "need to grant access …" description — each turning a busy agent pane into a
 * fake permission-prompt (the inner fleet runs `bypass permissions on` — structurally no permission
 * box can ever appear, so that signal is pure noise). By POSITION/SHAPE, never by keyword (the same
 * lesson the "permissions" exclusion above records): a real approval dialog shows BOTH options —
 * either on one line ("Allow  ·  Deny  ·  Y/n"), on adjacent lines, or Allow/Deny sits at line start
 * as an option row (with the TUI's ❯/› gutter and optional numbering); a grant-access dialog is a
 * QUESTION ("Grant access to X?") whose buttons (Allow/Deny/Y/n) the option-row alternatives above
 * already match. A bare title/description word never satisfies any of those shapes. */
const PERMISSION_PROMPT_RE = new RegExp(
  "Do you want to proceed|Quick safety check|trust this folder|Enter to confirm|" +
    "Y\\/n\\b|" +
    "Grant access[^\\n]*\\?|" +
    "Allow\\b[^\\n]*\\bDeny\\b|Deny\\b[^\\n]*\\bAllow\\b|" +
    "Allow\\b[^\\n]*\\n[^\\n]*\\bDeny\\b|Deny\\b[^\\n]*\\n[^\\n]*\\bAllow\\b|" +
    "^\\s*[❯›>]?\\s*(?:1\\.\\s*)?Allow\\b|^\\s*[❯›>]?\\s*(?:1\\.\\s*)?Deny\\b",
  "im",
);

/** Dismissable / ignorable prompt markers — the distinguishing feature that tells a blocking
 * permission confirmation apart from a feedback questionnaire (tasks/gap-permission-prompt-vs-
 * dismissable-prompt-classifier, manager 2026-08-08 19:35Z). The Claude Code "How is Claude doing
 * this session?" questionnaire carries `(optional)` in its title and a `Dismiss` option; a REAL
 * blocking permission confirmation has NO dismiss branch. The questionnaire's OWN keybinding chrome
 * ("↑/↓ navigate · Enter to confirm · Esc to cancel") trips PERMISSION_PROMPT_RE when the overlay
 * is scrolled into the bottom region — that is the position-dependent false-busy (the same screen
 * classifies waiting-input once the overlay is out of the region). A region carrying BOTH a
 * permission signature AND a dismissable marker is a questionnaire, not a blocking dialog — it must
 * NOT count as busy (AC2). */
const DISMISSABLE_PROMPT_RE = /\(optional\)|Dismiss|How is Claude doing this session/i;

/** Active processing: the definitive "esc to interrupt" status flag (the SAME signal
 * session-liveness.sh already uses to mean busy). It lives in the STATUS LINE (the last one or two
 * lines of the bottom region), NOT in scrolled content — the manager's analysis text has been
 * observed QUOTING the phrase "esc to interrupt" inside the bottom 10 lines while the session was
 * actually idle (real capture waiting-input-manager-3). Restricting the match to the last two
 * lines makes a quoted mention in content unable to fake a busy verdict.
 *
 * WHY esc-in-status-area ALONE means busy is CORRECT (no bypass-mode exception — do NOT re-add one):
 * tasks/gap-session-liveness-busy-mask-idle-with-subagents proposed a "constant bypass-mode esc"
 * distinction (an `esc to interrupt` in the status line with NO co-occurring active-processing
 * signal should read as idle). The manager FALSIFIED the premise 2026-08-08 15:2x (commit
 * 32c85b20 on develop): (1) a 13:05 idle capture of the real outer pane showed NO `esc to
 * interrupt` under the same bypass-permissions + monitors + agent conditions, and (2) a 60-sample
 * run was busy for only the first 9 samples then 51 consecutive waiting-input — impossible if the
 * esc were a constant mode indicator. The original replication was SELF-REFERENTIAL: it observed
 * the outer's own pane while the outer was running the instrumentation, so the pane was busy by
 * construction (observer-can't-observe-itself, the pgrep-self-match family). Real busy-ness
 * (an interruptible action in flight) is exactly when the TUI renders `esc to interrupt`; an idle
 * bypass-mode pane does not. A "co-occurring active signal" requirement would only add a
 * false-IDLE path (a busy pane whose work line is scrolled out of the bottom region would read
 * idle). The closure criterion is one real SESSION-IDLE, not a classifier heuristic. */
// BUSY_RE is truncation-tolerant (成因 A, gap-pane-classify-busy-truncated-by-column-width): when
// the tmux window is narrower than the status line, the TUI omits the tail with an ellipsis —
// `esc to interrupt` becomes `esc to interru…` (实测 inner width=67). The pre-fix /esc to
// interrupt/i missed the truncated form, so a busy pane read as idle (transcript 6s fresh but
// SESSION-IDLE). Matching the /esc to interr/ PREFIX covers the full string and EVERY truncation of
// the suffix — a truncated busy pane and a full busy pane both hit. Still restricted to the status
// area (below), so a scrolled-content quote cannot fake it.
const BUSY_RE = /esc to interr/i;

/** 成因 B — task-panel busy marker (gap-pane-classify-busy-truncated-by-column-width): when the TUI
 * renders the task/agent management view, the status line's `esc to interrupt` flag is REPLACED by
 * `ctrl+t to hide tasks` (实测 outer width=93, 28/28 agents running). Neither string appears then —
 * the panel chrome is the only busy proof. IMPORTANT distinction: `1 monitor` and `← N agent` alone
 * are AMBIENT counts that render even at idle (waiting-input-manager-* fixtures carry them), so they
 * must NOT be busy flags; only the panel-mode marker `ctrl+t to hide tasks` proves "有活在跑"
 * (a `monitor` count followed by `ctrl+t` is exactly the 成因 B status line).
 *
 * gap-pane-classify-needs-two-orthogonal-dimensions: `↓ to manage` is the panel-EXPANDED hint and is
 * deliberately NOT added here. It renders at idle too (every waiting-input fixture carries it), so as
 * a busy flag it would turn every idle pane busy — the exact misread the 成因 B comment warns about.
 * The expanded panel is covered NATURALLY by the orthogonal work_in_flight dimension
 * (classifyPaneStateOrthogonal): an expanded panel shows the agent list (`● main` / `◯ general-purpose`)
 * or the `← N agent` indicator, either of which sets work_in_flight=true WITHOUT making input_state
 * busy (AC4: 「或新字段天然覆盖」). */
const PANEL_BUSY_RE = /ctrl\+t to hide tasks/i;

/** Agent-list rows: when subagents are running the TUI renders the agent list BELOW the status line
 * (`● main` / `◯ general-purpose  …`), pushing the status line's `esc to interrupt` out of the
 * bottom-two-lines window — a busy pane then read as waiting-input (gap-pane-classify-allow-bare-
 * word-and-agent-list-masks-busy defect 2, idle-masks-busy, the reverse of busy-mask-idle). The
 * enumerated agent-list shape is a bullet glyph (● filled / ◯ hollow) + agent name; those rows are
 * excluded from the status area so the status line stays in the window. A scrolled-content bullet
 * that happens to use the same glyph is harmless: the window is anchored at the bottom by the input
 * + status lines that are always present, so a quoted-esc content line can never be pulled into it
 * (AC4 — the last-two-lines discipline is unchanged for panes without an agent list). */
const AGENT_LIST_LINE_RE = /^\s*[●◯]\s/;

/** Claude Code TUI chrome — the prompt/status-line vocabulary that proves "this is an interactive
 * Claude Code session pane" (as opposed to a bash prompt or a vim help screen). The orthogonal
 * input_state (classifyPaneStateOrthogonal) reads waiting-input only when chrome evidence is present
 * AND no blocking shape matched; without chrome the input_state is `unknown` (tier-2, the same
 * fail-loud philosophy as classifyPaneState). */
const CLAUDE_PANE_CHROME_RE = new RegExp(
  "❯|⏵⏵|bypass permissions|esc to interr|ctrl\\+t to hide tasks|↓ to manage|←\\s*\\d+\\s+agents?|\\d+\\s+monitors?",
  "i",
);

/** The status area = the last up-to-two non-blank, non-agent-list lines of the bottom region (the
 * status line and its possible continuation). Busy is judged HERE, not across the whole bottom
 * region — a quoted `esc to interrupt` in scrolled content must never fake a busy verdict. */
function statusArea(region: string): string {
  const lines = region.split("\n").filter((l) => l.trim() !== "" && !AGENT_LIST_LINE_RE.test(l));
  return lines.slice(-2).join("\n");
}

/** Error-banner signatures. Unverified against a real capture until one occurs (annotated
 * unavailable-until-real-occurence); conservative on purpose — a false "error" is worse than a
 * tier-2 unknown, so only unmistakable failure markers match. */
const ERROR_BANNER_RE = /isApiErrorMessage|an error occurred|something went wrong|isApiError|connection error|unable to reach/i;

/** The input box: the `❯` prompt line (Claude Code's input gutter) — present at idle and busy
 * alike, so it only proves "this is an interactive Claude session", and waiting-input additionally
 * requires that no busy/prompt/error signature matched first (order of checks below). */
const INPUT_PROMPT_RE = /❯/;

export interface ClassifyResult {
  state: string;
  confidence: number;
  region: string;
  raw: string;
}

/** Classify a pane text. Only the bottom region enters the decision path (ADR-016 boundary b).
 * Tier-1 checks run most-specific-first; anything unmatched falls to tier-2 (unknown + raw). */
export function classifyPaneState(paneText: string, opts: { lines?: number } = {}): ClassifyResult {
  const region = bottomRegion(paneText, opts.lines ?? DEFAULT_BOTTOM_LINES);
  // A dismissable questionnaire (candidate A, gap-permission-prompt-vs-dismissable-prompt-classifier):
  // when the region carries BOTH a permission signature AND a dismissable marker, the prompt is
  // ignorable (a feedback questionnaire, e.g. "How is Claude doing this session? (optional)" with a
  // "0: Dismiss" option) — NOT a blocking permission confirmation. Real permission dialogs have no
  // dismiss branch, so the exclusion never weakens a genuine grant/deny prompt (AC3 negative
  // control). Falling through lets the questionnaire read as waiting-input (when the ❯ prompt is
  // present) or unknown — both non-busy in _sl_pane_verdict, so SESSION-IDLE is not blocked.
  if (PERMISSION_PROMPT_RE.test(region) && !DISMISSABLE_PROMPT_RE.test(region)) {
    return { state: "permission-prompt", confidence: 0.85, region, raw: region };
  }
  const statusAreaText = statusArea(region);
  // Busy judgment must not depend on a SINGLE string (gap-pane-classify-busy-truncated-by-column-
  // width): BUSY_RE covers 成因 A (truncated `esc to interru…` at 67 cols, and the full form);
  // PANEL_BUSY_RE covers 成因 B (the task-panel view replaces the flag with `ctrl+t to hide tasks`
  // — seen on the 93-col outer with 28/28 agents running). Either ⇒ busy. The ambient `1 monitor` /
  // `← N agent` counts are NOT busy flags (they render at idle too — see waiting-input fixtures).
  if (BUSY_RE.test(statusAreaText) || PANEL_BUSY_RE.test(statusAreaText)) {
    return { state: "busy", confidence: 0.9, region, raw: region };
  }
  if (ERROR_BANNER_RE.test(region)) {
    return { state: "error-banner", confidence: 0.75, region, raw: region };
  }
  if (INPUT_PROMPT_RE.test(region)) {
    return { state: "waiting-input", confidence: 0.6, region, raw: region };
  }
  // tier-2: no common shape matched — hand the region to the outer to read (never a silent guess).
  return { state: "unknown", confidence: 0, region, raw: region };
}

// ── two orthogonal dimensions (gap-pane-classify-needs-two-orthogonal-dimensions) ─────────────────
// The single five-state enum above has ONE slot, but a pane's real state is TWO ORTHOGONAL
// dimensions:
//   ① input_state     — can the MAIN THREAD receive input?
//                       (waiting-input / permission-prompt / busy / error-banner / unknown)
//   ② work_in_flight  — is a BACKGROUND agent running? (boolean)
// The measured real pane `⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent · ↓ to manage`
// + agent list (● main / ◯ general-purpose) is {input idle + agents running} — the single enum has
// no slot for it, so classifyPaneState honestly returned unknown. MARKER-STALE is the monitor's
// HONEST REPORT of that unrepresentable combo, not a classifier bug (the task's root finding). The
// two fields make it representable: waiting-input + true.

/** Whether the bottom region is an interactive Claude Code pane (chrome evidence). The `❯` prompt,
 * the ⏵⏵ mode indicator, the status-line vocabulary, or an agent-list row all count. */
export function regionLooksLikeClaudePane(region: string): boolean {
  if (INPUT_PROMPT_RE.test(region)) return true;
  if (region.split("\n").some((l) => AGENT_LIST_LINE_RE.test(l))) return true;
  return CLAUDE_PANE_CHROME_RE.test(region);
}

/** work_in_flight — the SECOND orthogonal dimension: is a background agent running? True when the
 * region shows an agent-list row (`● main` / `◯ general-purpose` — AGENT_LIST_LINE_RE) or the status
 * line's `← N agent` indicator. Deliberately NOT a busy flag — the old comment's rejection is
 * PRESERVED (these render at idle too, see the waiting-input-manager-* fixtures); they are the
 * independent work-in-flight dimension, orthogonal to whether the main thread can receive input. */
export function paneShowsWorkInFlight(region: string): boolean {
  if (region.split("\n").some((l) => AGENT_LIST_LINE_RE.test(l))) return true;
  const m = region.match(/←\s*(\d+)\s+agents?/i);
  return m !== null && Number(m[1]) > 0;
}

export interface OrthogonalClassifyResult {
  input_state: string;
  work_in_flight: boolean;
  region: string;
  raw: string;
}

/** Two orthogonal fields instead of one enum slot. input_state uses the same most-specific-first
 * shape checks as classifyPaneState (permission → busy → error → waiting-input), but the final
 * waiting-input leg requires only Claude-Code chrome evidence (not a `❯`) — so the real pane's
 * STATUS LINE ALONE (`⏵⏵ bypass permissions on … · ← 1 agent · ↓ to manage`, no `❯`) reads
 * waiting-input instead of unknown. work_in_flight is computed independently. */
export function classifyPaneStateOrthogonal(paneText: string, opts: { lines?: number } = {}): OrthogonalClassifyResult {
  const region = bottomRegion(paneText, opts.lines ?? DEFAULT_BOTTOM_LINES);
  const work_in_flight = paneShowsWorkInFlight(region);
  let input_state: string;
  if (PERMISSION_PROMPT_RE.test(region) && !DISMISSABLE_PROMPT_RE.test(region)) {
    input_state = "permission-prompt";
  } else {
    const statusAreaText = statusArea(region);
    if (BUSY_RE.test(statusAreaText) || PANEL_BUSY_RE.test(statusAreaText)) {
      input_state = "busy";
    } else if (ERROR_BANNER_RE.test(region)) {
      input_state = "error-banner";
    } else if (regionLooksLikeClaudePane(region)) {
      input_state = "waiting-input";
    } else {
      input_state = "unknown";
    }
  }
  return { input_state, work_in_flight, region, raw: region };
}

// ── --check-residue mode (tasks/gap-residue-check-crystallized-as-tool-mode) ─────────────────────
// "box has text vs actually submitted" must be a TOOL judgment, not role memory (human ruling
// 2026-08-05, relayed by the manager). The distinguishing criterion is the C-u CLEARING BEHAVIOR
// (fault 6's mechanized judgment, orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md): a
// plain-text capture carries no style info, so a gray ghost-suggestion and a real typed-but-
// unsubmitted line look IDENTICAL in a static snapshot. Only "does C-u make the box empty?" tells
// them apart:
//   empty                  — the input line after `❯` is empty (only whitespace / NBSP);
//   real-unsubmitted-text  — C-u CLEARED the input line (bounded loop, fault 1's ~30 cap);
//   ghost-suggestion-only  — C-u left the pane BYTE-IDENTICAL through N cycles (fault 6);
//   unknown                — the probe could not decide (ambiguous partial clear / no prompt line):
//                            fail loud, never a silent guess (tier-2 philosophy).
// The runtime probe (side-effectful, tmux) is the judgment; the verdict itself is a PURE function
// over the capture sequence, so fixtures and tests need no live pane.

export type ResidueState = "empty" | "real-unsubmitted-text" | "ghost-suggestion-only" | "unknown";

/** Bounded C-u cap for the runtime probe — matches send-keys-reliable.sh's RELIABLE_CLEAR_MAX=50
 * (fault 1: a long multi-line real message can need ~30 C-u). The probe must never loop forever. */
export const RESIDUE_CLEAR_MAX_DEFAULT = 50;

/** ANSI CSI sequences are stripped from the input-line CONTENT (typed text is plain; the renderer
 * adds color escapes). The byte-identical ghost comparison below uses the RAW capture, not this. */
const ANSI_CSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
const NBSP = " ";

/** The input line: the LAST line of the bottom region carrying the `❯` prompt (matching
 * send-keys-reliable.sh's `grep '❯' | tail -n 1`). Returns null when no prompt line is present. */
export function inputLine(paneText: string, lines?: number): string | null {
  const region = bottomRegion(paneText, lines);
  const regionLines = region.split("\n");
  for (let i = regionLines.length - 1; i >= 0; i--) {
    if (regionLines[i].includes("❯")) return regionLines[i];
  }
  return null;
}

/** Content after the `❯` prompt on the input line, ANSI-stripped and NBSP-stripped (fault 8: an
 * empty Claude Code input box renders as `❯` + U+00A0, and NBSP is NOT whitespace to the C locale,
 * so it must be stripped explicitly). Returns null when there is no `❯` prompt line in the bottom
 * region. */
export function afterPromptContent(paneText: string, lines?: number): string | null {
  const line = inputLine(paneText, lines);
  if (line === null) return null;
  const idx = line.indexOf("❯");
  return line.slice(idx + 1).replace(ANSI_CSI_RE, "").replaceAll(NBSP, "");
}

export type InputResidueStatic = "empty" | "has-text" | "no-input-line";

/** Static examination of a SINGLE pane snapshot. This is the part a static capture can answer —
 * and no more: "has-text" says nothing about real-vs-ghost (dispatch-review point 1: static text
 * has no style info), which is exactly why the runtime probe exists. */
export function classifyInputResidueStatic(paneText: string, lines?: number): InputResidueStatic {
  const after = afterPromptContent(paneText, lines);
  if (after === null) return "no-input-line";
  return after.trim() === "" ? "empty" : "has-text";
}

export interface ResidueVerdict {
  state: ResidueState;
  reason: string;
}

/** The probe's VERDICT as a pure function over a capture sequence (captures[0] = before; the rest
 * = the pane after each C-u cycle). This is the fault-6 criterion mechanized:
 *   empty                          → the box is already empty — no residue to clear;
 *   some later capture empty       → C-u cleared it → real typed-but-unsubmitted text;
 *   every capture byte-identical   → C-u had NO effect at all → gray ghost-suggestion (fault 6);
 *   anything else                  → changed-but-never-emptied → ambiguous, fail loud.
 * The byte-identical comparison is the task's OWN criterion (AC2: "C-u 循环 N 次 pane 逐字不变"),
 * deliberately distinct from ADR-016 boundary (c)'s forbidden whole-screen HASH as a STATE
 * classifier: here the question is "did C-u change anything?", not "what state is the pane in?". */
export function classifyResidueFromCaptures(captures: string[]): ResidueVerdict {
  if (!captures.length) return { state: "unknown", reason: "no captures to judge" };
  const before = captures[0];
  const staticState = classifyInputResidueStatic(before);
  if (staticState === "empty") return { state: "empty", reason: "input line after ❯ is empty" };
  if (staticState === "no-input-line") {
    return { state: "unknown", reason: "no ❯ prompt line found in the bottom region" };
  }
  for (let i = 1; i < captures.length; i++) {
    if (classifyInputResidueStatic(captures[i]) === "empty") {
      return { state: "real-unsubmitted-text", reason: `C-u cleared the input line at capture ${i}` };
    }
  }
  if (captures.every((c) => c === before)) {
    return { state: "ghost-suggestion-only", reason: "input line byte-identical through all C-u cycles (fault 6)" };
  }
  return { state: "unknown", reason: "input line changed but never emptied — ambiguous, fail loud" };
}

export interface ResidueProbeResult {
  state: ResidueState;
  reason: string;
  captures: number;
}

/** Runtime probe against a pane target: capture → loop C-u + capture (bounded) → judge with
 * classifyResidueFromCaptures. This turns the fault-6 judgment from a human eyeball into a command
 * artifact. The probe is bounded (RESIDUE_CLEAR_MAX_DEFAULT) and fail-loud on a target that cannot
 * be captured or a verdict it cannot make. */
export function probeResidueTarget(target: string, maxClicks = RESIDUE_CLEAR_MAX_DEFAULT): ResidueProbeResult {
  const captures: string[] = [];
  const capture = (): { ok: boolean; out: string; err: string } => {
    const r = spawnSync("tmux", ["capture-pane", "-p", "-t", target], { encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
  };
  const send = (keys: string): void => {
    spawnSync("tmux", ["send-keys", "-t", target, keys], { encoding: "utf8" });
  };

  const first = capture();
  if (!first.ok) {
    return { state: "unknown", reason: `capture failed for target ${target} (${first.err.trim() || "no such pane"})`, captures: 0 };
  }
  captures.push(first.out);
  if (classifyInputResidueStatic(first.out) === "empty") {
    return { state: "empty", reason: "input line after ❯ is empty (probe: no C-u needed)", captures: captures.length };
  }
  for (let i = 0; i < maxClicks; i++) {
    send("C-u");
    const cur = capture();
    if (!cur.ok) {
      return { state: "unknown", reason: `capture failed mid-probe (${cur.err.trim()})`, captures: captures.length };
    }
    captures.push(cur.out);
    if (classifyInputResidueStatic(cur.out) === "empty") {
      return { state: "real-unsubmitted-text", reason: `C-u cleared the input line at cycle ${i + 1}`, captures: captures.length };
    }
  }
  const verdict = classifyResidueFromCaptures(captures);
  return {
    state: verdict.state,
    reason: `${verdict.reason} (probe ran ${captures.length - 1} C-u cycles, cap ${maxClicks})`,
    captures: captures.length,
  };
}

/** `--check-residue` CLI: emits one JSON line with a `state` field (the measure/band contract reads
 * `stdout 的 state 字段`). Exit 0 when state is one of the three enumerated states; 1 when the
 * verdict is `unknown` (fail loud); 2 on usage error.
 *   file mode   — a real on-disk pane recording; with `--after <file>` the two snapshots give the
 *                 full three-state judgment; a single snapshot yields `empty` or `unknown`+reason
 *                 (a static text cannot decide real-vs-ghost);
 *   target mode — anything else is treated as a pane target and probed live (bounded C-u loop). */
export function runCheckResidue(argv: string[]): number {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flagValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const afterFile = flagValue("--after");
  const maxClicksRaw = flagValue("--max-clicks");
  const maxClicksParsed = maxClicksRaw ? Number.parseInt(maxClicksRaw, 10) : NaN;
  // A degenerate cap (non-numeric or < 1) falls back to the default — a 0-click "probe" would
  // see a single capture and misread real text as ghost (trivially identical), so refuse it.
  const maxClicks = Number.isFinite(maxClicksParsed) && maxClicksParsed >= 1
    ? maxClicksParsed
    : RESIDUE_CLEAR_MAX_DEFAULT;
  const arg = positional[0];

  const emit = (payload: Record<string, unknown>, exitCode: number): number => {
    process.stdout.write(JSON.stringify(payload) + "\n");
    return exitCode;
  };

  if (!arg) {
    process.stderr.write(
      "usage: pane-state-classify.ts --check-residue <pane.txt|target> [--after after.txt] [--max-clicks N]\n",
    );
    return 2;
  }

  if (fs.existsSync(arg)) {
    const before = fs.readFileSync(arg, "utf8");
    const staticState = classifyInputResidueStatic(before);
    if (staticState === "empty") {
      return emit({ state: "empty", reason: "input line after ❯ is empty", staticState, file: arg }, 0);
    }
    if (afterFile && fs.existsSync(afterFile)) {
      const after = fs.readFileSync(afterFile, "utf8");
      const verdict = classifyResidueFromCaptures([before, after]);
      return emit(
        { state: verdict.state, reason: verdict.reason, staticState, file: arg, afterFile },
        verdict.state === "unknown" ? 1 : 0,
      );
    }
    // Single static snapshot with text: undecidable without the C-u probe (dispatch-review point
    // 1). Fail loud with the reason — never silently guess real or ghost.
    return emit(
      {
        state: "unknown",
        reason:
          "single static snapshot with text cannot distinguish real residue from a ghost suggestion; run against a live target or pass --after <post-C-u capture>",
        staticState,
        file: arg,
      },
      1,
    );
  }

  const probe = probeResidueTarget(arg, maxClicks);
  return emit({ ...probe, target: arg, maxClicks }, probe.state === "unknown" ? 1 : 0);
}

// ── in-file self-check (ADR-018 pattern: prove BOTH the RED and GREEN paths) ──────────────────────

export function selfcheck(): boolean {
  let pass = 0;
  let fail = 0;
  const check = (name, cond, detail = "") => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
  };

  // GREEN: a real waiting-input screen (empty input + status line, no busy flag).
  const idle = [
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage",
  ].join("\n");
  check("green-waiting-input", classifyPaneState(idle).state === "waiting-input");

  // GREEN: busy (the status-line "esc to interrupt" flag, present even though the input box is).
  const busy = [
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ← 1 agent · ↓ to manage",
  ].join("\n");
  check("green-busy", classifyPaneState(busy).state === "busy");

  // ── busy judgment not single-string: 成因 A truncation + 成因 B panel flags ─────────────────────
  // (gap-pane-classify-busy-truncated-by-column-width)

  // GREEN (成因 A): the 67-column TUI truncates the status line's "esc to interrupt" with an
  // ellipsis → "esc to interru…" (实测 inner width=67). Pre-fix BUSY_RE required the full string and
  // missed it, reading a busy pane as idle (transcript 6s fresh but SESSION-IDLE). Must read BUSY.
  const truncated67col = "⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interru…";
  check("green-truncated-67col-busy", classifyPaneState(truncated67col).state === "busy");
  // RED relabel: the truncated busy flag must never read waiting-input (idle masking busy).
  check("truncated-67col-red-not-waiting", classifyPaneState(truncated67col).state !== "waiting-input");

  // GREEN (成因 A positive control): the FULL "esc to interrupt" still reads busy.
  check("green-full-text-busy", classifyPaneState(busy).state === "busy");

  // GREEN (成因 B): the outer's 93-column task-panel rendering REPLACES "esc to interrupt" with
  // "ctrl+t to hide tasks" (real 2026-08-11 outer capture, 28/28 agents running). No esc string at
  // all — only the panel chrome. Must read BUSY.
  const outerPanel = [
    "⏵⏵ bypass permissions on · 1 monitor · ctrl+t to hide tasks · ← 1 agent · ↓ to manage",
    "◯ execute-suite-fix  A15 … 28/28 agents done · 1h 0m 59s · ↓ 2.0m tokens · ⚠ Large workflow",
  ].join("\n");
  check("green-outer-panel-busy", classifyPaneState(outerPanel).state === "busy");
  // RED relabel: the panel-rendered busy pane must never read waiting-input.
  check("outer-panel-red-not-waiting", classifyPaneState(outerPanel).state !== "waiting-input");
  // RED negative control: the AMBIENT "1 monitor · ← 1 agent" counts that render at idle are NOT a
  // busy signal by themselves (waiting-input fixtures carry them) — a status line with only those
  // counts must stay waiting-input, never flip to busy.
  check("ambient-counts-red-not-busy", classifyPaneState(idle).state === "waiting-input");

  // GREEN: a permission dialog (the recorded trust-check family).
  const prompt = [
    "Quick safety check: Is this a project you created or one you trust?",
    "❯ 1. Yes, I trust this folder ✔",
    "  2. No, exit",
    "Enter to confirm · Esc to cancel",
  ].join("\n");
  check("green-permission-prompt", classifyPaneState(prompt).state === "permission-prompt");

  // GREEN (candidate A, gap-permission-prompt-vs-dismissable-prompt-classifier): a dismissable
  // feedback questionnaire. Its own keybinding chrome ("Enter to confirm") trips PERMISSION_PROMPT_RE
  // when the overlay is in the bottom region, but the `(optional)` / `Dismiss` markers prove it is
  // ignorable — it must NOT read as permission-prompt (AC2), and reads as waiting-input (non-busy).
  const questionnaire = [
    "● How is Claude doing this session? (optional)",
    "  1: Bad",
    "  2: Fine",
    "  3: Good",
    "  0: Dismiss",
    "  ↑/↓ navigate · Enter to confirm · Esc to cancel",
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage",
  ].join("\n");
  check("green-questionnaire-waiting-input", classifyPaneState(questionnaire).state === "waiting-input");
  // RED relabel: the questionnaire must NEVER read as a blocking permission prompt (busy-mask-idle).
  check("questionnaire-red-not-permission", classifyPaneState(questionnaire).state !== "permission-prompt");
  // AC3 negative control: the genuine permission dialog is UNCHANGED by the dismissable exclusion.
  check("green-real-permission-still-prompt", classifyPaneState(prompt).state === "permission-prompt");

  // ── bare Allow/Deny false-positive regression (gap-pane-state-allow-deny-bare-word-false-positive) ──

  // GREEN: a busy agent pane whose task title carries `--allow-thin` must read BUSY, never
  // permission-prompt (the pre-fix bare `Allow` /i matched the title and faked a dialog).
  const allowThinTitle = [
    "◯ general-purpose  Re-running scoped test with --allow-thin   11m 15s · ↓193.4k tokens",
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ← 1 agent · ↓ to manage",
  ].join("\n");
  check("green-allow-thin-busy", classifyPaneState(allowThinTitle).state === "busy");
  check("allow-thin-red-not-permission", classifyPaneState(allowThinTitle).state !== "permission-prompt");
  // RED relabel: a title word "Deny"/"denied" alone (mid-line, no co-option) must NOT trip either.
  const deniedTitle = [
    "◯ general-purpose  Task: denied access to tool   9m 20s · ↓150.1k tokens",
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ← 1 agent · ↓ to manage",
  ].join("\n");
  check("denied-red-not-permission", classifyPaneState(deniedTitle).state !== "permission-prompt");
  // GREEN: a genuine Allow/Deny approval dialog (pair on adjacent lines + line-start Allow) still
  // reads permission-prompt.
  const allowDenyDialog = [
    "Do you want to proceed?",
    "❯ Allow",
    "  Deny",
    "  Enter to confirm · Esc to cancel",
  ].join("\n");
  check("green-allow-deny-dialog-prompt", classifyPaneState(allowDenyDialog).state === "permission-prompt");

  // ── agent-list-masks-busy (gap-pane-classify-allow-bare-word-and-agent-list-masks-busy defect 2) ──

  // GREEN: a busy pane whose status line ("esc to interrupt") sits ABOVE the running agent list
  // (● main / ◯ general-purpose) with the input at the bottom. Pre-fix statusArea took the last 2
  // non-blank lines = agent line + input, so esc was out of the window → waiting-input (idle masking
  // busy). Must read BUSY.
  const agentsBelow = [
    "⏵⏵ bypass permissions on",
    "  esc to interrupt  ← 1 agent",
    "  ● main",
    "  ◯ general-purpose  running",
    "❯",
  ].join("\n");
  check("green-agents-below-busy", classifyPaneState(agentsBelow).state === "busy");
  // RED relabel: it must NEVER read waiting-input (idle masking busy is the defect).
  check("agents-below-red-not-waiting", classifyPaneState(agentsBelow).state !== "waiting-input");

  // ── Grant access shape (gap-pane-classify-allow-bare-word-and-agent-list-masks-busy defect 1) ──

  // RED: a busy agent pane whose description mentions "grant access" WITHOUT a dialog shape (no
  // question, no option row) must read BUSY, never permission-prompt.
  const grantTitle = [
    "◯ general-purpose  Need to grant access to the shared drive   11m 15s · ↓193.4k tokens",
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ← 1 agent · ↓ to manage",
  ].join("\n");
  check("grant-access-red-not-permission", classifyPaneState(grantTitle).state !== "permission-prompt");
  check("grant-access-green-busy", classifyPaneState(grantTitle).state === "busy");
  // GREEN: a genuine grant-access confirmation dialog (question + Allow/Deny buttons) still reads
  // permission-prompt.
  const grantDialog = [
    "Grant access to this folder?",
    "Allow  ·  Deny",
    "Enter to confirm · Esc to cancel",
  ].join("\n");
  check("green-grant-dialog-prompt", classifyPaneState(grantDialog).state === "permission-prompt");

  // tier-2 GREEN: an unmatched screen → unknown, with the region passed through verbatim in raw.
  const weird = "a vim help screen\n~ ~ ~\n~ ~ ~\n(1 of 12)   help.txt";
  const r = classifyPaneState(weird);
  check("tier2-unknown", r.state === "unknown");
  check("tier2-raw-passthrough", r.raw === bottomRegion(weird) && r.raw.includes("help.txt"));

  // ── two orthogonal dimensions (gap-pane-classify-needs-two-orthogonal-dimensions) ────────────────

  // GREEN: the measured real pane — status line `⏵⏵ bypass permissions on (shift+tab to cycle) ·
  // ← 1 agent · ↓ to manage` + agent list (● main / ◯ general-purpose) = {input idle + agents
  // running}. The single enum has no slot (the old classifier returned unknown); the two fields
  // make it representable: waiting-input + true (AC2/AC3 verification anchor).
  const realPaneStatusLine = "⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent · ↓ to manage";
  const oReal = classifyPaneStateOrthogonal(realPaneStatusLine);
  check("orthogonal-real-input-state", oReal.input_state === "waiting-input");
  check("orthogonal-real-work-in-flight", oReal.work_in_flight === true);
  // The status line ALONE (no ❯) reads waiting-input in the orthogonal view (chrome evidence), where
  // the old single-enum classifier honestly reported unknown (the MARKER-STALE root).
  check("orthogonal-old-unknown-still-unknown", classifyPaneState(realPaneStatusLine).state === "unknown");

  // GREEN: the full pane (with ❯ + agent rows below) reads waiting-input + true.
  const oRealFull = classifyPaneStateOrthogonal([
    "● main",
    "◯ general-purpose  Reviewing the full diff summary.  17m 13s",
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  " + realPaneStatusLine,
  ].join("\n"));
  check("orthogonal-real-full-input-state", oRealFull.input_state === "waiting-input");
  check("orthogonal-real-full-work-in-flight", oRealFull.work_in_flight === true);

  // RED: `← N agent` is a work-in-flight flag, NOT a busy flag — an idle status line with it must
  // stay waiting-input (AC3: the old comment's rejection preserved; `↓ to manage` is also not busy).
  const idleWithAgent = classifyPaneStateOrthogonal(idle);
  check("orthogonal-idle-agent-input-state", idleWithAgent.input_state === "waiting-input");
  check("orthogonal-idle-agent-work-in-flight", idleWithAgent.work_in_flight === true);
  // A busy pane (esc to interrupt) still reads input_state=busy, and work_in_flight is independent.
  const oBusy = classifyPaneStateOrthogonal(busy);
  check("orthogonal-busy-input-state", oBusy.input_state === "busy");
  check("orthogonal-busy-work-in-flight", oBusy.work_in_flight === true);
  // The pure idle pane (no `← N agent`, no agent list) reads work_in_flight=false.
  const idleNoAgent = [
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · ↓ to manage",
  ].join("\n");
  const oIdleNoAgent = classifyPaneStateOrthogonal(idleNoAgent);
  check("orthogonal-idle-no-agent-input-state", oIdleNoAgent.input_state === "waiting-input");
  check("orthogonal-idle-no-agent-work-in-flight", oIdleNoAgent.work_in_flight === false);
  // tier-2 preserved: a non-Claude screen still reads input_state=unknown in the orthogonal view.
  check("orthogonal-tier2-unknown", classifyPaneStateOrthogonal(weird).input_state === "unknown");
  // permission-prompt keeps its slot in the orthogonal view.
  check("orthogonal-permission-input-state", classifyPaneStateOrthogonal(prompt).input_state === "permission-prompt");

  // AC6 (region): identical bottom region, different upper content → same verdict.
  const upperA = "some upper text\n".repeat(30) + idle;
  const upperB = "completely different upper\n".repeat(30) + idle;
  check("ac6-region-same-verdict", classifyPaneState(upperA).state === classifyPaneState(upperB).state);

  // ── residue checks (GREEN real + RED relabel, ADR-018) ─────────────────────────────────────────

  // GREEN: an empty input box → empty (no C-u needed).
  check("residue-empty", classifyResidueFromCaptures([idle]).state === "empty");
  // GREEN: real typed text, C-u cleared it → real-unsubmitted-text.
  const realBefore = "line above\n───────────────────────────────\n❯ fix the bug report\n───────────────────────────────\n  status line";
  const realAfter = "line above\n───────────────────────────────\n❯ \n───────────────────────────────\n  status line";
  check("residue-real-cleared", classifyResidueFromCaptures([realBefore, realAfter]).state === "real-unsubmitted-text");
  // GREEN: C-u left the pane byte-identical → ghost-suggestion-only (fault 6 criterion).
  const ghostPane = "line above\n───────────────────────────────\n❯ Try \"fix lint errors\"\n───────────────────────────────\n  status line";
  check("residue-ghost-identical", classifyResidueFromCaptures([ghostPane, ghostPane]).state === "ghost-suggestion-only");
  // RED relabel: an unchanged pane must NOT be read as real-unsubmitted (the mutation a regression
  // would introduce) and a cleared pane must NOT be read as ghost.
  check("residue-red-ghost-not-real", classifyResidueFromCaptures([ghostPane, ghostPane]).state !== "real-unsubmitted-text");
  check("residue-red-real-not-ghost", classifyResidueFromCaptures([realBefore, realAfter]).state !== "ghost-suggestion-only");
  // RED: changed-but-never-emptied → unknown (ambiguous, fail loud, never a silent guess).
  check("residue-unknown-ambiguous", classifyResidueFromCaptures(["❯ abc", "❯ ab"]).state === "unknown");
  // RED: no prompt line in the bottom region → unknown, not a guess.
  check("residue-unknown-no-prompt", classifyResidueFromCaptures(["a vim help screen", "~ ~ ~"]).state === "unknown");
  // AC1 reuse: classifyInputResidueStatic distinguishes the static part.
  check("residue-static-empty", classifyInputResidueStatic(idle) === "empty");
  check("residue-static-has-text", classifyInputResidueStatic(realBefore) === "has-text");

  console.log(`\npane-state-classify --selfcheck: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const args = process.argv.slice(2);
  // THREE-WAY exclusive entry (ad-arm1 gate #1: the old fall-through ran selfcheck()+exit() after
  // --classify's stdin.resume(), exiting before stdin was consumed — the classifier never ran for
  // shell consumers, explaining the session-liveness busy/idle failures; --check-residue was
  // unreachable outside the else).
  if (args[0] === "--classify") {
    // Shell-consumer seam (session-liveness.sh): read the pane text on stdin, print the
    // classification as PLAIN TEXT — line 1 = state, line 2 = the bottom region (real newlines).
    // Pure — no tmux, no file reads, no writes beyond stdout. The busy/idle judgment in
    // session-liveness.sh consumes THIS instead of a whole-pane hash (ADR-016 Amendment 2026-08-04,
    // ruling D): the verdict is a SHAPE of the bottom region, so volatile chrome (token counter /
    // spinner / ✻ residue) can never flip it. Plain text (not JSON) keeps the bash consumer to ONE
    // subprocess per round (fewer transient shells → less load on the mount-count tests).
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => { input += d; });
    process.stdin.on("end", () => {
      // --orthogonal (gap-pane-classify-needs-two-orthogonal-dimensions): line 1 = input_state,
      // line 2 = work_in_flight (0|1), line 3+ = the bottom region. session-liveness.sh reads this
      // shape to feed its MARKER-STALE suppression (work_in_flight ⇒ transcript-fresh + idle is
      // self-consistent, not an anomaly).
      if (args.includes("--orthogonal")) {
        const o = classifyPaneStateOrthogonal(input);
        process.stdout.write(o.input_state + "\n" + (o.work_in_flight ? "1" : "0") + "\n" + o.region + "\n");
      } else {
        const r = classifyPaneState(input);
        process.stdout.write(r.state + "\n" + r.region + "\n");
      }
      process.exit(0);
    });
    process.stdin.resume();
    // do NOT fall through — return here; the async stdin path owns the process lifecycle.
  } else if (args[0] === "--pane-text") {
    // Contract invoke seam (gap-pane-classify-busy-truncated-by-column-width): classify a literal
    // pane text passed as the NEXT argument (no stdin, no file) — the outer verification reads the
    // `state` field of `--json` (the measure/band surface). `--json` emits the full classify result;
    // without it, prints "state\nregion" (the same line-1 state contract as --classify, for bash
    // consumers). Pure — no tmux, no file reads.
    const text = args[1] ?? "";
    const r = classifyPaneState(text);
    const o = classifyPaneStateOrthogonal(text);
    if (args.includes("--orthogonal")) {
      // The two-orthogonal-field surface (Contract invoke form for AC2/AC3).
      if (args.includes("--json")) {
        process.stdout.write(JSON.stringify(o) + "\n");
      } else {
        process.stdout.write(o.input_state + "\n" + (o.work_in_flight ? "1" : "0") + "\n" + o.region + "\n");
      }
    } else if (args.includes("--json")) {
      // Superset: keep the legacy single-enum fields (state/confidence) AND expose the two
      // orthogonal fields (input_state/work_in_flight) — the Contract's measure reads
      // input_state/work_in_flight from this seam while old consumers keep state/confidence.
      process.stdout.write(JSON.stringify({ ...r, input_state: o.input_state, work_in_flight: o.work_in_flight }) + "\n");
    } else {
      process.stdout.write(r.state + "\n" + r.region + "\n");
    }
    process.exit(0);
  } else if (args[0] === "--check-residue") {
    process.exit(runCheckResidue(args.slice(1)));
  } else {
    const ok = selfcheck();
    process.exit(ok ? 0 : 1);
  }
}
