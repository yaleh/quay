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
 * status line of this fleet — a real capture tripped on exactly that). */
const PERMISSION_PROMPT_RE =
  /Do you want to proceed|Quick safety check|trust this folder|Enter to confirm|Grant access|Allow|Deny|Y\/n\b/i;

/** Active processing: the definitive "esc to interrupt" status flag (the SAME signal
 * session-liveness.sh already uses to mean busy). It lives in the STATUS LINE (the last one or two
 * lines of the bottom region), NOT in scrolled content — the manager's analysis text has been
 * observed QUOTING the phrase "esc to interrupt" inside the bottom 10 lines while the session was
 * actually idle (real capture waiting-input-manager-3). Restricting the match to the last two
 * lines makes a quoted mention in content unable to fake a busy verdict. */
const BUSY_RE = /esc to interrupt/i;

/** The status area = the last up-to-two non-blank lines of the bottom region (the status line and
 * its possible continuation). Busy is judged HERE, not across the whole bottom region. */
function statusArea(region: string): string {
  const lines = region.split("\n").filter((l) => l.trim() !== "");
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
  if (PERMISSION_PROMPT_RE.test(region)) {
    return { state: "permission-prompt", confidence: 0.85, region, raw: region };
  }
  if (BUSY_RE.test(statusArea(region))) {
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

  // GREEN: a permission dialog (the recorded trust-check family).
  const prompt = [
    "Quick safety check: Is this a project you created or one you trust?",
    "❯ 1. Yes, I trust this folder ✔",
    "  2. No, exit",
    "Enter to confirm · Esc to cancel",
  ].join("\n");
  check("green-permission-prompt", classifyPaneState(prompt).state === "permission-prompt");

  // tier-2 GREEN: an unmatched screen → unknown, with the region passed through verbatim in raw.
  const weird = "a vim help screen\n~ ~ ~\n~ ~ ~\n(1 of 12)   help.txt";
  const r = classifyPaneState(weird);
  check("tier2-unknown", r.state === "unknown");
  check("tier2-raw-passthrough", r.raw === bottomRegion(weird) && r.raw.includes("help.txt"));

  // AC6 (region): identical bottom region, different upper content → same verdict.
  const upperA = "some upper text\n".repeat(30) + idle;
  const upperB = "completely different upper\n".repeat(30) + idle;
  check("ac6-region-same-verdict", classifyPaneState(upperA).state === classifyPaneState(upperB).state);

  console.log(`\npane-state-classify --selfcheck: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const ok = selfcheck();
  process.exit(ok ? 0 : 1);
}
