// Dark-axis record — the PER-MILESTONE half of ADR-007
// (tasks/gap-adr007-per-milestone-dark-axis-enforcement-gate).
//
// ADR-007 ("Instrument the dark axes L_G/L_D/L_S — a milestone is not judged on L_T alone") shipped
// TWO halves. The INSTRUMENT-INTEGRITY half landed in M41: the `adr-007` gate runs
// git-lens-selfcheck.sh, which regression-tests the three proxies against fixtures (their ability to
// still detect a prose-heavy diff / a new cycle / a weak module). The PER-MILESTONE half was
// recorded in the ADR comments as STILL FUTURE WORK and never landed: nothing required any given
// task to actually CONSULT a dark axis before it could be called done. This module is that half's
// judgment. `docs/references/维度边界与结晶——从熔融实现中发现原则.md` §10.3/§10.4 is why: a quantified
// reading that is not wired into a fail-closed judgment stays an instrumentation paper and never
// changes whether a task may land.
//
// ── The judgment is a THREE-state (+1) classification of a task BODY ─────────────────────────────
//   RECORDED      — the body carries a parseable L_D/L_G reading: the axis token at a LINE START
//                   (after an optional bullet/quote/bold prefix) whose block carries >=1 concrete
//                   NUMERIC quantity. The parsed axes + numbers are returned so the caller can
//                   PRINT them (AC1) — the reading is the numbers, not the word "L_G".
//   DISCLAIMED    — the body carries the explicit declaration `该轴仍暗,理由:<...>` (or the English
//                   `axis still dark, reason: <...>`). A REASON IS REQUIRED: a bare "still dark" is
//                   not a decision, so it does not discharge the obligation.
//   MISSING       — neither. This is the state the ready→done gate fails CLOSED on.
//   NOT-EVALUATED — the input was not a readable body at all. Its OWN value, never folded into
//                   MISSING and never into RECORDED (CLAUDE.md 硬规则 3b: an unreadable input must
//                   not be shaped like a verdict about the input's content — "read it and there is
//                   nothing" and "could not read it" are different facts).
//
// ── WHY POSITION-BASED, NOT KEYWORD-BASED (CLAUDE.md 硬规则 2) ───────────────────────────────────
// ~51 task files in this repo already contain the strings "L_G"/"L_D" in PROSE — this ADR's own
// discussion, retrospectives, proposals, other gap tasks quoting it. A keyword scan would report a
// reading for every one of them, i.e. it would report RECORDED precisely where nothing was recorded.
// The axis token must therefore sit AT A LINE START (optionally after `- `/`* `/`> `/`1. `/`**`) and
// be followed by a measurable quantity. "L_G 是最暗的轴（见 ADR-007）" is a MENTION; the accepted
// forms are RECORDS:
//
//   - L_G archguard: cycles=0, god-modules=0
//   - L_D: code:doc=1:8
//   L_G structural-drift (fallback proxy) — scanned 6050 files under packages/
//     cycles found: 0
//     god-modules found: 0
//     verdict: PASS
//   > L_S: mutants killed=42/48
//
// The last form works because a reading BLOCK is the axis line plus its indented continuation
// lines — the shape of a pasted probe output (`git-lens-l-g-structural-drift.ts` prints exactly
// this). The quantity must be NUMERIC (`key=value` / `key: value` with a numeric value): a bare
// number is not enough, or `L_G (ADR-007) 未测` would be misread as a reading of `7`.

export type DarkAxisState = "RECORDED" | "DISCLAIMED" | "MISSING" | "NOT-EVALUATED";

export interface DarkAxisReading {
  /** The axis token that anchored the block: `L_D` | `L_G` | `L_S`. */
  axis: string;
  /** 1-based line number of the anchor line inside the body. */
  line: number;
  /** The concrete quantities parsed out of the reading block, in order of appearance. */
  numbers: number[];
  /** The anchor line, trimmed (the human-readable provenance of the reading). */
  text: string;
}

export interface DarkAxisDisclaimer {
  line: number;
  text: string;
  /** The declared reason (the part after `理由:` / `reason:`), single-line. */
  reason: string;
}

export interface DarkAxisVerdict {
  state: DarkAxisState;
  /** Every L_D/L_G/L_S reading found, in body order. An L_S reading is REPORTED (the caller prints
   *  the full picture) but does not by itself satisfy RECORDED — AC1 binds the gate to L_D/L_G. */
  readings: DarkAxisReading[];
  /** The declaration when present. Reported even alongside readings, so an operator sees that an
   *  axis was explicitly disclaimed as well as read. */
  disclaimer: DarkAxisDisclaimer | null;
  reason: string;
}

// ── Line anchoring ───────────────────────────────────────────────────────────────────────────────
// Optional list marker (`- `, `* `, `+ `, `1. `) WITH an optional checkbox (`[x] ` / `[ ] `), optional
// blockquote (`> `), optional bold (`**`), then the token. Anchored with `^` per-line so a token
// buried mid-sentence never qualifies. The checkbox form matters in practice: a DoD/AC checklist is
// the NATURAL place a task author records a reading (`- [x] L_G structural-drift — scanned …`), and
// a record that is not recognized is a fail-closed false negative on a real write.
const LINE_PREFIX = "^(?:\\s*(?:[-*+]\\s+(?:\\[[ xX]\\]\\s*)?|\\d+\\.\\s+(?:\\[[ xX]\\]\\s*)?|>\\s*))?(?:\\*\\*)?\\s*";

/** The axis token must sit at a line start and must not be a prefix of a longer identifier
 *  (`L_DOC` must not read as `L_D`). */
const AXIS_AT_LINE_START_RE = new RegExp(`${LINE_PREFIX}(L_[DGS])(?![A-Za-z0-9_])`);

/** A numeric quantity in measurement position: a KEY, a `=`/`:` separator, then a number (a ratio
 *  value like `1:8` counts as both of its numbers). Deliberately NOT "any bare number" — `(ADR-007)`,
 *  `#123`, `2026-09-13` are references and dates, not readings, and the ~51 prose mentions of the
 *  axes are full of them. Two guards make that hold:
 *    - the key must contain at least one LETTER or CJK character. Without it, `12:30` (a clock time)
 *      and `2026-09` (a date fragment) parse as `key:value` measurements.
 *    - the separator is required at all. `L_G (ADR-007) 未测` therefore carries no measurement.
 *  This accepts the three probes' own stdout verbatim, e.g.
 *  `L_D code:doc — docLines=812 codeLines=6500 ratio=1:8 verdict=PROSE_HEAVY` and
 *  `L_S behavior-variance — … totalMutants=48 killed=42 survived=6 mutationScore=0.875 verdict=PASS`. */
const KEY = "[^\\s=：]{0,39}[A-Za-z\\u4e00-\\u9fff][^\\s=：]{0,39}";
const VALUE = "-?\\d+(?:\\.\\d+)?(?:\\s*[:：/]\\s*\\d+(?:\\.\\d+)?)?";
const NUMERIC_MEASUREMENT_RE = new RegExp(`(?:^|[\\s(（[，,;；])(${KEY})\\s*[=:：]\\s*(${VALUE})`);

/** The explicit "axis still dark" declaration, at a line start, optionally labelled with its axis
 *  (`L_G：该轴仍暗,理由:...`). */
const DISCLAIM_ZH_RE = new RegExp(`${LINE_PREFIX}(?:L_[DGS]\\s*[：:=]?\\s*)?该轴仍暗`);
const DISCLAIM_EN_RE = new RegExp(`${LINE_PREFIX}(?:L_[DGS]\\s*[：:=]?\\s*)?axis\\s+still\\s+dark\\b`, "i");

/** A reason turns the declaration into a decision. Position-based too: `理由:` / `reason:` must
 *  itself appear, followed by at least one non-space character. `该轴仍暗` alone (or `理由不明`) is
 *  NOT a discharge — it is the same silence the gate exists to catch, wearing a marker. */
const REASON_ZH_RE = /理由\s*[：:]\s*(\S.*)$/;
const REASON_EN_RE = /\breason\s*[：:]\s*(\S.*)$/i;

/** True for a body line that CONTINUES a reading block: indented, non-blank (the shape of a pasted
 *  probe output's per-signal lines under the `L_G …` header). */
function isBlockContinuation(line: string): boolean {
  return /^\s+\S/.test(line);
}

function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(Number(m[0]));
  return out;
}

/** Extract the numbers attached to measurement positions in a block, in order. Only the VALUE side
 *  is reported — the key's own digits (`code:doc`, `ADR-007`) are labels, not readings. */
function measurementNumbers(blockLines: string[]): number[] {
  const out: number[] = [];
  for (const line of blockLines) {
    // Global scan: one line may carry several signals (`cycles=0 god-modules=2`).
    const probe = new RegExp(NUMERIC_MEASUREMENT_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = probe.exec(line)) !== null) {
      for (const n of numbersIn(m[2])) out.push(n);
      if (m[0].length === 0) probe.lastIndex++;
    }
  }
  return out;
}

function findDisclaimer(lines: string[]): DarkAxisDisclaimer | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!DISCLAIM_ZH_RE.test(line) && !DISCLAIM_EN_RE.test(line)) continue;
    // The reason may sit on the declaration line or on the immediately following non-blank line
    // (a wrapped declaration is still one declaration). It must NOT be looked for further away —
    // an unrelated later `理由:` must not retroactively discharge a marker.
    const candidates = [line];
    for (let j = i + 1; j < lines.length && j <= i + 1; j++) {
      if (lines[j].trim() !== "") candidates.push(lines[j]);
    }
    for (const c of candidates) {
      const zh = c.match(REASON_ZH_RE);
      const en = c.match(REASON_EN_RE);
      const reason = (zh ? zh[1] : en ? en[1] : null);
      if (reason && reason.trim() !== "") {
        return { line: i + 1, text: line.trim(), reason: reason.trim() };
      }
    }
    // Marker present, no reason: NOT a discharge (see REASON_*_RE). Fall through so a later,
    // properly-formed declaration in the same body still counts.
  }
  return null;
}

/**
 * Classify a task body against the ADR-007 per-milestone predicate.
 *
 * Pure: no I/O, no clock, no workspace. `body` is `unknown` on purpose — a stub/incomplete Task may
 * carry no body at all, and that must be reported as NOT-EVALUATED rather than silently read as
 * "nothing recorded" (which would be a verdict the input does not support).
 */
export function classifyDarkAxisRecord(body: unknown): DarkAxisVerdict {
  if (typeof body !== "string") {
    return {
      state: "NOT-EVALUATED",
      readings: [],
      disclaimer: null,
      reason:
        "NOT-EVALUATED — the task carries no readable body (typeof body !== string). An unreadable " +
        "input is neither evidence of a record nor evidence of its absence (硬规则 3b).",
    };
  }

  const lines = body.split("\n");
  const readings: DarkAxisReading[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = AXIS_AT_LINE_START_RE.exec(lines[i]);
    if (!m) continue;
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length && isBlockContinuation(lines[j]); j++) block.push(lines[j]);
    const numbers = measurementNumbers(block);
    if (numbers.length === 0) continue; // a mention, not a record
    readings.push({ axis: m[1], line: i + 1, numbers, text: lines[i].trim() });
  }

  const disclaimer = findDisclaimer(lines);
  const substantive = readings.filter((r) => r.axis === "L_D" || r.axis === "L_G");

  if (substantive.length > 0) {
    const shown = substantive
      .map((r) => `${r.axis}(line ${r.line})=[${r.numbers.join(", ")}]`)
      .join(" ");
    return {
      state: "RECORDED",
      readings,
      disclaimer,
      reason: `RECORDED — ${substantive.length} L_D/L_G reading(s) with concrete quantities: ${shown}`,
    };
  }

  if (disclaimer) {
    return {
      state: "DISCLAIMED",
      readings,
      disclaimer,
      reason: `DISCLAIMED — explicit declaration at line ${disclaimer.line}: "${disclaimer.text}" (理由: ${disclaimer.reason})`,
    };
  }

  const otherAxes = readings.length > 0 ? ` (found only non-L_D/L_G reading(s): ${readings.map((r) => r.axis).join(", ")})` : "";
  return {
    state: "MISSING",
    readings,
    disclaimer: null,
    reason:
      `MISSING — the task body records no L_D/L_G reading (a numeric quantity at an axis-anchored ` +
      `line) and carries no explicit "该轴仍暗,理由:<...>" declaration${otherAxes}. ADR-007 requires ` +
      `one or the other before the task may be called done.`,
  };
}

/**
 * The gate function for the `dark-axis` named gate (packages/quay/src/gate/registry.ts) — the
 * fail-closed verdict shape `runGate` consumes. Same judgment as the CLI
 * (`plugin/scripts/dark-axis-record-check.ts`); both call {@link classifyDarkAxisRecord}, so there is
 * no second copy of the rule to drift.
 *
 * RECORDED and DISCLAIMED pass. MISSING fails. NOT-EVALUATED fails closed too — but with its OWN
 * reason text, so a caller can tell "the record is absent" from "the record could not be read"
 * (硬规则 3b: `ok:false` alone would make those two indistinguishable).
 */
export function darkAxisGateCheck(task: { body?: unknown } | null | undefined): { ok: boolean; reason: string } {
  const verdict = classifyDarkAxisRecord(task?.body);
  return {
    ok: verdict.state === "RECORDED" || verdict.state === "DISCLAIMED",
    reason: `dark-axis (ADR-007 per-milestone predicate): ${verdict.reason}`,
  };
}

/**
 * True when the task body has a `## DoD` / `## Definition of Done` heading. Kept here (not in the
 * gate) because it is a pure body fact the CLI also reports.
 */
export function hasDodSection(body: unknown): boolean {
  if (typeof body !== "string") return false;
  return /^##\s+(?:DoD|Definition of Done)\b/m.test(body);
}
