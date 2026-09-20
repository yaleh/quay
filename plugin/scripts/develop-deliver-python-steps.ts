#!/usr/bin/env node
// develop-deliver-python-steps.ts — the STEP CLI for `plugin/scripts/develop-deliver-tgz.sh`.
//
// WHY THIS FILE EXISTS (gap-arch-tsify-develop-deliver-tgz-python-heredocs; SPEC-architecture-
// consolidation-ts-and-shell-2026-09-19 §5 Phase 5.3, first stage). The shell entry carried TWELVE
// `python3` invocations — ten `<<'PY'` heredoc bodies plus two `python3 -c` one-liners — i.e. a
// program written in bash's quoting rules whose logic archguard cannot see, with no types and no
// unit-testable seam. The SPEC's rule is 「把「程序」收进 TS，把「胶水」留在 bash」: the LOGIC moves
// here, the shell keeps the ORCHESTRATION (which predicate runs when, in what order, with which
// report line). §5's second stage (「改编排」) is explicitly OUT of this task's scope.
//
// ⛔ WHY THIS IS A SIBLING CLI AND NOT A `quay` SUBCOMMAND. These predicates are internal to ONE
// shell entry; adding positional sub-verbs to the public `quay` CLI would change a user-facing
// surface for an internal need (the same ruling that produced the Phase 5.1 sibling
// `quay-init-steps.ts`). One precedent, one shape.
//
// HOW THE SHELL REACHES IT. `node --no-warnings --experimental-strip-types "$SCRIPT_DIR/
// develop-deliver-python-steps.ts" <step> [args…]` — the repo-tree form. ⚠️ The no-braces
// `$SCRIPT_DIR` spelling is LOAD-BEARING: `build-plugin-dist.mjs`'s rewriteShell matches
// `node --no-warnings --experimental-strip-types "$SCRIPT_DIR/X.ts"` (its rule at line 736) and
// rewrites it to `node --no-warnings "$SCRIPT_DIR/dist/X.js"` in the staged artifact. The
// `${SCRIPT_DIR}` spelling instead falls through to the generic rule at line 743, which swaps the
// extension but LEAVES `--experimental-strip-types` on the command line — and a bare Node 20 (the
// artifact's declared floor) rejects that flag. ⛔ Do not "tidy" the braces.
//
// EQUIVALENCE DISCIPLINE. Every step below is a LINE-FOR-LINE port of the python3 body it replaced,
// including its defects-of-shape, because the task's AC3 is stdout/exit-code EQUALITY on the same
// inputs. Where a python behaviour cannot be reproduced exactly it is called out in-place rather
// than silently improved (硬规则 3b: 「读不懂」 must not be shaped like 「合格」).
//   • `json.dumps(sort_keys=True)` → `canonicalJson`. Both are injective, so the dedup identity is
//     unchanged. The ONE divergence: python `json.dumps(1)` is "1" while `json.dumps(1.0)` is "1.0"
//     (int and float are distinct types), and JS has one number type. A carrier holding BOTH
//     `{"n":1}` and `{"n":1.0}` would dedup here and not there. No producer in this repo emits a
//     float for an integer field.
//   • python's `json.loads` accepts bare `NaN`/`Infinity`; `JSON.parse` does not. A line carrying one
//     is SKIPPED here and parsed as a float there. Evidence is written by JSON.stringify-shaped
//     producers, which emit `null`.
//   • `isinstance(x, int)` is True for python bools; JS booleans are not numbers. The only use is
//     `pre_upgrade_task_count`, a count no producer writes as `true`.
//   • python raises UnicodeDecodeError on invalid UTF-8; `fs.readFileSync(…, "utf8")` substitutes
//     U+FFFD. Only reachable for a corrupt carrier, which every consumer here already treats as
//     unreadable.
//
// EXIT CODES: 0 for a clean verdict. The verdict-distinguishing codes of `evidence-completeness`
// (0 COMPLETE / 2 PARTIAL / 3 ALL-MISSING) and `e2e-pairing` / `upgrade-pairing` (0 OK / 2 PARTIAL)
// are preserved VERBATIM — the shell maps them onto its own three distinguishable values, and a
// collapse here would make 「判为缺」 and 「脚本炸了」 the same shape. 2 also = usage error.

import fs from "node:fs";

// ── python-semantics primitives (the port's whole risk surface lives here) ────────────────────────

/** python truthiness. `[]`/`{}`/`0`/`""`/`None`/`False` are falsy; JS disagrees about `[]`/`{}`. */
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (v === true) return true;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** python `repr()` for the value kinds that appear in evidence records. Only strings need care: the
 *  printed form of a python list (`['/a', '/b']`, `[]`) is part of the contract its consumers match. */
function pyRepr(v: unknown): string {
  if (typeof v === "string") {
    const quote = v.includes("'") && !v.includes('"') ? '"' : "'";
    const body = v
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .split(quote)
      .join(`\\${quote}`);
    return `${quote}${body}${quote}`;
  }
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`)
      .join(", ")}}`;
  }
  return pyStr(v);
}

/** python `str()`. `None` prints as "None" and bools as "True"/"False" — both load-bearing for the
 *  `$( … )` captures whose empty-vs-value distinction drives the trigger decision. */
function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  return pyRepr(v);
}

/** python `int(x)` — throws on anything it cannot convert, exactly as the `except: continue` arms of
 *  the pairing predicates rely on. `int(1.9)` truncates toward zero; `int(" 7 ")` matches. */
function pyInt(v: unknown): number {
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError(`cannot convert float to int: ${String(v)}`);
    return Math.trunc(v);
  }
  if (typeof v === "string" && /^[+-]?\d+$/.test(v.trim())) return Number.parseInt(v.trim(), 10);
  throw new TypeError(`invalid literal for int(): ${pyRepr(v)}`);
}

/** python `d.get(key)` for a record python requires to be a dict — a JSON array/string/scalar has no
 *  `.get`, and the original bodies relied on that raising `AttributeError`. */
function get(r: unknown, key: string): unknown {
  if (r === null || typeof r !== "object" || Array.isArray(r)) {
    throw new TypeError(`'${Array.isArray(r) ? "list" : typeof r}' object has no attribute 'get'`);
  }
  const v = (r as Record<string, unknown>)[key];
  return v === undefined ? null : v; // python's missing key is None, which is falsy/str()-able
}

/** `json.dumps(r, sort_keys=True)` — canonical and injective, so two records are the same record iff
 *  their signatures are equal. That is the whole dedup contract of `evidence-append`. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Iterate a file's non-blank JSONL records. `onBad` decides whether an unparseable line is skipped
 *  (the transport predicates) or fatal (the AC-248/AC-249 controls — their bodies had a bare
 *  `json.loads`, so a bad line is an exception there, not a `continue`). The raw line is passed to the
 *  callback because `evidence-append` writes the ORIGINAL bytes back out, never a re-serialization. */
function eachRecord(file: string, fn: (r: unknown, line: string) => void, onBad: "skip" | "throw"): void {
  const text = fs.readFileSync(file, "utf8"); // python's bare `open(…)` raises too
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch (err) {
      if (onBad === "throw") throw err;
      continue;
    }
    fn(r, line);
  }
}

/** python `sorted(...)` of a set of strings, printed as its list repr (`['a', 'b']` / `[]`). */
const sortedListRepr = (values: Iterable<string>): string => pyRepr([...values].sort());

/** python `",".join(sorted(...))` — the OTHER join form the pairing verdict lines use. */
const sortedJoin = (values: Iterable<string>): string => [...values].sort().join(",");

function add(map: Map<string, Set<string>>, k: string, v: string): void {
  let s = map.get(k);
  if (!s) map.set(k, (s = new Set()));
  s.add(v);
}

/** The (host, project_root) pairs present in BOTH sides, per host. */
function intersectPerHost(
  left: Map<string, Set<string>>,
  right: Map<string, Set<string>>,
  h: string
): Set<string> {
  const both = new Set<string>();
  for (const p of left.get(h) ?? []) if (right.get(h)?.has(p)) both.add(p);
  return both;
}

const out = (s: string): void => void process.stdout.write(s + "\n");

// ── the steps ─────────────────────────────────────────────────────────────────────────────────────

/** H1 (was `develop-deliver-tgz.sh:641-677`) — append the non-duplicate records of <evidence> into
 *  <carrier>; print how many were appended. Identity is the record's FULL field set, so a criterion
 *  that later adds a distinguishing dimension is picked up with no second "which fields count" list
 *  (the 2026-09-13 defect: a (ts,ac,host,project_root) key tuple dropped the second of two records
 *  differing only in `kind`). */
function evidenceAppend(carrier: string, evidence: string): number {
  const existing = new Set<string>();
  try {
    eachRecord(carrier, (r) => {
      try {
        existing.add(canonicalJson(r));
      } catch {
        /* python: except Exception: pass */
      }
    }, "skip");
  } catch (err) {
    // python's outer arm catches FileNotFoundError ONLY — anything else propagates.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
  // ⛔ Carrier opened first, evidence second — the same order as the original
  // `with open(carrier,"a") as out, open(evidence) as f:`. An unreadable evidence file must leave the
  // same observable state: the carrier created (if absent) and empty.
  const fd = fs.openSync(carrier, "a");
  let appended = 0;
  try {
    eachRecord(evidence, (r, line) => {
      const sig = canonicalJson(r);
      if (existing.has(sig)) return;
      existing.add(sig);
      fs.writeSync(fd, line + "\n"); // the ORIGINAL bytes, verbatim — never a re-serialization
      appended += 1;
    }, "skip");
  } finally {
    fs.closeSync(fd);
  }
  return appended;
}

/** H2 (was `:716-743`) — the declared-vs-produced ac set difference. Three DISTINGUISHABLE values:
 *  0 COMPLETE / 2 PARTIAL (with the missing list) / 3 ALL-MISSING. A partial run must never be shaped
 *  like a complete one (硬规则 3b). */
function evidenceCompleteness(evidenceFile: string, expectedArg: string): number {
  const present = new Set<unknown>();
  eachRecord(evidenceFile, (r) => {
    // ⛔ BARE, exactly as the original: its `try/except` covers `json.loads` ONLY. A non-object line
    // (a JSON array, say) raises out of the whole body there — an abort, not a `continue`. Wrapping
    // this in a try would turn 「脚本炸了」 into a verdict, which is the one collapse 硬规则 3b forbids.
    const a = get(r, "ac");
    if (pyTruthy(a)) present.add(a);
  }, "skip");
  const exp = expectedArg.split(/\s+/).filter((x) => x !== "");
  const have = exp.filter((a) => present.has(a));
  if (have.length === 0) {
    out(`ALL-MISSING present=${present.size}`);
    return 3;
  }
  const missing = exp.filter((a) => !present.has(a)).sort();
  if (missing.length > 0) {
    out(`PARTIAL present=${have.length} missing=${missing.length} list=${missing.join(",")}`);
    return 2;
  }
  out(`COMPLETE present=${have.length}`);
  return 0;
}

/** Shared body of H3/H4: read the pairing maps, then print the OK or PARTIAL verdict. */
function pairingVerdict(
  left: Map<string, Set<string>>,
  right: Map<string, Set<string>>,
  okWord: string,
  missingWord: string,
  leftTag: string,
  rightTag: string,
  noRecords: string
): number {
  const hosts = [...new Set([...left.keys(), ...right.keys()])].sort();
  const paired = hosts.filter((h) => (left.get(h)?.size ?? 0) > 0 && intersectPerHost(left, right, h).size > 0);
  if (paired.length > 0) {
    const union = new Set<string>();
    for (const h of paired) for (const p of intersectPerHost(left, right, h)) union.add(p);
    out(`${okWord} host=${paired.join(",")} roots=${sortedJoin(union)}`);
    return 0;
  }
  // ⛔ 不静默：print BOTH sides' root sets per host (a bare "no pair" is not checkable evidence).
  const detail =
    hosts.map((h) => `host=${h} ${leftTag}=${sortedListRepr(left.get(h) ?? [])} ${rightTag}=${sortedListRepr(right.get(h) ?? [])}`).join(" ; ") ||
    noRecords;
  out(`PARTIAL ${missingWord} ${detail}`);
  return 2;
}

/** H3 (was `:782-824`) — GOAL-009-AC-240: record-KIND completeness is not closure. AC-203 (a live
 *  driver) and AC-207 (a driver that produced a real commit) can arrive from two DISJOINT batches of
 *  witnesses, so the per-host question is whether both share ONE project_root. */
function e2ePairing(evidenceFile: string): number {
  const a203 = new Map<string, Set<string>>();
  const a207 = new Map<string, Set<string>>();
  eachRecord(evidenceFile, (r) => {
    const h = pyStr(pyTruthy(get(r, "host")) ? get(r, "host") : "");
    const pr = pyStr(pyTruthy(get(r, "project_root")) ? get(r, "project_root") : "");
    if (!h || !pr) return;
    let alive: number, recs: number, gates: number;
    try {
      alive = pyInt(pyTruthy(get(r, "driver_alive")) ? get(r, "driver_alive") : 0);
      recs = pyInt(pyTruthy(get(r, "carrier_records")) ? get(r, "carrier_records") : 0);
      gates = pyInt(pyTruthy(get(r, "gate_events")) ? get(r, "gate_events") : 0);
    } catch {
      return; // python: except Exception: continue
    }
    if (get(r, "ac") === "GOAL-009-AC-203" && get(r, "has_plugin_dir") === false && alive === 1 && recs > 0) {
      add(a203, h, pr);
    }
    if (
      get(r, "ac") === "GOAL-009-AC-207" &&
      get(r, "task_status") === "done" &&
      gates > 0 &&
      get(r, "produced_by_driver") === true &&
      pyTruthy(get(r, "commit_sha")) &&
      pyTruthy(get(r, "task_id"))
    ) {
      add(a207, h, pr);
    }
  }, "skip");
  return pairingVerdict(a203, a207, "E2E-PAIR OK", "E2E_PAIR_MISSING=1", "AC203_roots", "AC207_roots", "no AC-203/AC-207 records at all");
}

/** H4 (was `:857-905`) — GOAL-009-AC-239: an AC-239 record only counts on a root an AC-238 record
 *  ALSO proved upgraded. Without it a brand-new project running the same e2e would forge "post-
 *  upgrade". The two predicates are the criterion's, letter for letter — ⛔ neither relaxed nor
 *  tightened here. */
function upgradePairing(evidenceFile: string): number {
  const a238 = new Map<string, Set<string>>();
  const a239 = new Map<string, Set<string>>();
  eachRecord(evidenceFile, (r) => {
    const h = pyStr(pyTruthy(get(r, "host")) ? get(r, "host") : "");
    const pr = pyStr(pyTruthy(get(r, "project_root")) ? get(r, "project_root") : "");
    if (!h || !pr) return;
    if (
      get(r, "ac") === "GOAL-009-AC-238" &&
      typeof get(r, "pre_upgrade_task_count") === "number" &&
      Number.isInteger(get(r, "pre_upgrade_task_count")) &&
      (get(r, "pre_upgrade_task_count") as number) > 0 &&
      get(r, "post_upgrade_task_count") === get(r, "pre_upgrade_task_count") &&
      typeof get(r, "pre_upgrade_runtime_age_days") === "number" &&
      Number.isFinite(get(r, "pre_upgrade_runtime_age_days")) &&
      (get(r, "pre_upgrade_runtime_age_days") as number) >= 1 &&
      get(r, "runtime_replaced") === true &&
      get(r, "task_list_ok") === true &&
      pyTruthy(get(r, "build_sha"))
    ) {
      add(a238, h, pr);
    }
    let gates: number;
    try {
      gates = pyInt(pyTruthy(get(r, "gate_events")) ? get(r, "gate_events") : 0);
    } catch {
      return; // python: except Exception: continue
    }
    if (
      get(r, "ac") === "GOAL-009-AC-239" &&
      get(r, "task_status") === "done" &&
      gates > 0 &&
      get(r, "produced_by_driver") === true &&
      pyTruthy(get(r, "commit_sha")) &&
      pyTruthy(get(r, "task_id"))
    ) {
      add(a239, h, pr);
    }
  }, "skip");
  return pairingVerdict(a238, a239, "UPGRADE-PAIR OK", "UPGRADE_PAIR_MISSING=1", "AC238_roots", "AC239_roots", "no AC-238/AC-239 records at all");
}

const AC248 = "GOAL-016-AC-248";
const AC249 = "GOAL-016-AC-249";

/** The AC-248 shape predicate, verbatim: `is False` / `is True` — the values must be JSON booleans,
 *  so `0`/`1` and `"false"`/`"true"` BOTH take it false (the criterion is not merely "a value"). */
function adrFlipPasses(r: Record<string, unknown>): boolean {
  return r.adr_check_before_detects === false && r.adr_check_after_detects === true && pyTruthy(r.adr_check_probe_tool);
}

/** The AC-249 commit-files predicate, verbatim: the union must carry a code face AND a doc face, and
 *  a `./`-prefixed path does NOT satisfy `startswith("src/")`. */
function completeChangePasses(cf: unknown, taskId: unknown): boolean {
  return (
    Array.isArray(cf) &&
    cf.length > 0 &&
    cf.some((x) => pyStr(x).startsWith("src/") || pyStr(x).startsWith("scripts/")) &&
    cf.some((x) => pyStr(x).includes("ADR-007") || pyStr(x).startsWith("docs/adr")) &&
    pyTruthy(taskId)
  );
}

/** H5/H6 (was `:1350-1362` and `:1364-1383`) — the AC-248 shape control's two readings.
 *  ⛔ The impostor arm's `n` guard is preserved: with no AC-248 record at all it prints "0"
 *  (not evaluated), a DIFFERENT value from "the impostors were refused" ("1"). */
function adrFlipShape(carrier: string, variant: "positive" | "impostors"): string {
  if (variant === "positive") {
    let ok = false;
    eachRecord(carrier, (r) => {
      if (get(r, "ac") !== AC248) return;
      ok = adrFlipPasses(r as Record<string, unknown>);
    }, "throw");
    return ok ? "1" : "0";
  }
  let n = 0;
  let bad: Record<string, unknown>[] = [{}, {}];
  eachRecord(carrier, (r) => {
    if (get(r, "ac") !== AC248) return;
    const rec = r as Record<string, unknown>;
    bad = [
      { ...rec, adr_check_before_detects: 0, adr_check_after_detects: 1 },
      { ...rec, adr_check_before_detects: "false", adr_check_after_detects: "true" },
    ];
    n = 1;
  }, "throw");
  if (!n) return "0";
  return bad.some((rec) => adrFlipPasses(rec)) ? "0" : "1";
}

/** H7..H10 (was `:1460-1475`, `:1477-1491`, `:1493-1507`, `:1509-1523`) — the AC-249 commit_files
 *  readings. `positive` reads the transported record; the three impostors carry the HARDCODED
 *  one-sided / `./`-prefixed lists the original bodies hardcoded (they exercise the predicate), and
 *  print INVERTED — "1" means "the impostor was correctly refused". */
function completeChangePredicate(carrier: string, variant: "positive" | "code-only" | "doc-only" | "dot-slash"): string {
  if (variant !== "positive") {
    const cf =
      variant === "code-only"
        ? ["scripts/check-adr.ts", "tests/unit/scripts/check-adr.test.ts"]
        : variant === "doc-only"
          ? ["quay-adr/ADR-007.md", "docs/notes.md"]
          : ["./scripts/check-adr.ts", "quay-adr/ADR-007.md"];
    // ⛔ Preserved verbatim, including the shape defect: the original walks the carrier only to decide
    // whether the reading is APPLICABLE at all, then evaluates the hardcoded list. With no AC-249
    // record it printed "1" (= refused) — a false pass the shell never reaches, because the carrier
    // always carries one by construction. Fixing it here would change stdout on that input, and AC3 is
    // stdout equality (硬规则 3b's mirror: an "improvement" nobody measured is not an equivalence).
    let ok = false;
    eachRecord(carrier, (r) => {
      if (get(r, "ac") !== AC249) return;
      ok =
        cf.some((x) => x.startsWith("src/") || x.startsWith("scripts/")) &&
        cf.some((x) => x.includes("ADR-007") || x.startsWith("docs/adr"));
    }, "throw");
    return ok ? "0" : "1";
  }
  let ok = false;
  eachRecord(carrier, (r) => {
    if (get(r, "ac") !== AC249) return;
    ok = completeChangePasses(get(r, "commit_files"), get(r, "task_id"));
  }, "throw");
  return ok ? "1" : "0";
}

/** H11 (was `:1661`) — one field of the deliver state file, or "" for ANY failure (the shell's
 *  `2>/dev/null || echo ""` contract). The empty-vs-value distinction is what the trigger's hold
 *  turns on, so a missing key must be "" and never the string "None". */
function stateField(stateFile: string, key: string): string {
  const r: unknown = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  // python's `d.get` requires a dict; a JSON list/scalar raises AttributeError and the shell's
  // `|| echo ""` turns that into the empty value.
  if (r === null || typeof r !== "object" || Array.isArray(r)) throw new TypeError("state file is not a JSON object");
  const o = r as Record<string, unknown>;
  // python `d.get(key, '')`: a MISSING key is '' — but a key PRESENT with a null value is None and
  // prints "None". Those are different outputs, so the presence test is hasOwnProperty, not `=== null`.
  return Object.prototype.hasOwnProperty.call(o, key) ? pyStr(o[key]) : "";
}

/** H12 (was `:1673`) — seconds since an ISO-8601 timestamp, floored at 0. A timestamp carrying no
 *  zone is UNUSABLE (python raises subtracting a naive from an aware datetime) and must read as ""
 *  rather than as a fabricated 0, which would satisfy `[ -n ]` and silently mis-apply the hold. */
function ageSeconds(ts: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([+-]\d{2}:?\d{2})?$/.exec(
    ts.replace(/Z/g, "+00:00")
  );
  if (!m) throw new Error(`Invalid isoformat string: ${pyRepr(ts)}`);
  const zone = m[8];
  if (!zone) throw new Error("can't subtract offset-naive and offset-aware datetimes");
  const zm = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
  const offsetMin = (zm[1] === "-" ? -1 : 1) * (Number(zm[2]) * 60 + Number(zm[3]));
  const ms =
    Date.UTC(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] ?? "0"),
      Number((m[7] ?? "").padEnd(3, "0").slice(0, 3))
    ) -
    offsetMin * 60_000;
  return Math.max(0, Math.trunc((Date.now() - ms) / 1000));
}

// ── dispatch ──────────────────────────────────────────────────────────────────────────────────────

const USAGE = `usage: develop-deliver-python-steps.ts <step> [args…]

steps (each mirrors the python3 invocation it replaced in plugin/scripts/develop-deliver-tgz.sh):
  evidence-append            <carrier> <evidence>          → stdout: appended count (H1)
  evidence-completeness      <evidence> <expected-ac-set>  → stdout: verdict; exit 0/2/3 (H2)
  e2e-pairing                <evidence>                    → stdout: verdict; exit 0/2 (H3)
  upgrade-pairing            <evidence>                    → stdout: verdict; exit 0/2 (H4)
  adrflip-bool-shape         <carrier> positive|impostors  → stdout: 1/0 (H5/H6)
  complete-change-predicate  <carrier> positive|code-only|doc-only|dot-slash → stdout: 1/0 (H7..H10)
  state-field                <state-file> <key>            → stdout: python str(value) or '' (H11)
  age-seconds                <iso-8601>                    → stdout: integer seconds (H12)
`;

function main(): number {
  const [step, ...args] = process.argv.slice(2);
  if (!step || step === "--help" || step === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const need = (n: number): void => {
    if (args.length < n) {
      process.stderr.write(`develop-deliver-python-steps: '${step}' needs ${n} argument(s), got ${args.length}\n${USAGE}`);
      throw new Error("usage");
    }
  };
  switch (step) {
    case "evidence-append":
      need(2);
      out(String(evidenceAppend(args[0]!, args[1]!)));
      return 0;
    case "evidence-completeness":
      need(2);
      return evidenceCompleteness(args[0]!, args[1]!);
    case "e2e-pairing":
      need(1);
      return e2ePairing(args[0]!);
    case "upgrade-pairing":
      need(1);
      return upgradePairing(args[0]!);
    case "adrflip-bool-shape": {
      need(2);
      const v = args[1]!;
      if (v !== "positive" && v !== "impostors") throw new Error(`unknown variant '${v}'`);
      out(adrFlipShape(args[0]!, v));
      return 0;
    }
    case "complete-change-predicate": {
      need(2);
      const v = args[1]!;
      if (v !== "positive" && v !== "code-only" && v !== "doc-only" && v !== "dot-slash") {
        throw new Error(`unknown variant '${v}'`);
      }
      out(completeChangePredicate(args[0]!, v));
      return 0;
    }
    case "state-field":
      need(2);
      out(stateField(args[0]!, args[1]!));
      return 0;
    case "age-seconds":
      need(1);
      out(String(ageSeconds(args[0]!)));
      return 0;
    default:
      process.stderr.write(`develop-deliver-python-steps: unknown step '${step}'\n${USAGE}`);
      return 2;
  }
}

try {
  process.exitCode = main();
} catch (err: unknown) {
  const usage = err instanceof Error && err.message === "usage";
  if (!usage) {
    process.stderr.write(`develop-deliver-python-steps: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exitCode = usage ? 2 : 1;
}
