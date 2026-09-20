// anti-drift-touches-check.mjs — the NON-WAIVABLE after-the-fact HARD guardrail (DIR-044 increment 4;
// charters/DIR-044-concurrent-scheduler-D3.md Step 5). The pre-flight orthogonality check (increment
// 1) trusts the DECLARED `touches`. This check trusts NOTHING: after a concurrent batch has RUN, it
// takes each build's ACTUAL touched files (the driver supplies them from `git diff --numstat
// <base>..<build-branch>`) and HARD-FAILS if either:
//   (a) a build wrote OUTSIDE its declared touches (declaration was too narrow / dishonest), or
//   (b) two builds ACTUALLY touched the same file (the batch was mis-declared as disjoint).
// This is the guardrail that keeps a mis-declared `touches` from silently corrupting shared state —
// it MUST be able to bite (a RED fixture proves it). Native-only, no manda.
//
// ── anti_drift.exempt — project-configurable exemption globs ─────────────────────────────────────
// A target project may declare ONCE, in its WORKSPACE-ROOT `.quay/config.yml`, the globs whose files
// are EXEMPT from the per-file out-of-declared judgment of the driver mode below:
//
//   anti_drift:
//     exempt:
//       - glob: "server/modules/*/index.ts"
//         reason: "barrel re-export — an implementation change necessarily drags this file in"
//
// Four constraints (设计裁定 2026-09-20 — `sibling-barrel` 等关联规则明确否决: the exemption is a
// FLAT LIST OF GLOBS, never a relationship / built-in rule):
//   ① ONE flat list — no order, no negation, no relationship. A diff file matching ANY exempt glob
//      is not judged out-of-declared. How wide to cast it is the PROJECT's call (`**/index.ts` is
//      legal), so exempt globs are deliberately NOT run through isOverbroadDeclaration.
//   ② The output must ENUMERATE: every waived file is reported as `exempted: <file> <- <glob>` plus
//      a count, so "exempted" stays distinguishable from "was never changed" (硬规则 3).
//   ③ `reason` is REQUIRED on every entry. A missing/blank `reason`, a non-list `exempt`, or a
//      non-mapping `anti_drift` is MALFORMED ⇒ fail-closed with its OWN verdict (`malformed
//      anti_drift`, exit 2) — never the same shape as a pass, and never the same as
//      `out-of-declared` (硬规则 3b).
//   ④ READ SOURCE = the WORKSPACE ROOT (main checkout) config, resolved via `git rev-parse
//      --git-common-dir` and never from cwd — NOT the worktree copy. That file is gitignored (so it
//      does not exist in the merge target), and the equivalent defense is that a task must not be
//      able to open a waiver for itself by editing its own worktree copy.
// A missing config file (or a config carrying no `anti_drift` key) means NO exemptions — the
// pre-change behavior, byte for byte, and NOT an error.
//
// Exempt files do not count as "having done something": they are removed from the judged set BEFORE
// the judgment, so a diff whose non-exempt part is empty gets exactly the empty-diff verdict (the
// `--allow-empty` NON-WAIVABLE semantics are untouched). Exemption applies ONLY to the per-file
// out-of-declared arm — it does not enter the walker's ignored-directory set, the glob-expansion
// logic, or the cross-build-overlap / overbroad arms. (This comment deliberately does not spell that
// set's identifier: the task's AC pins `grep -c` on the diff to 0, and a mention in prose would
// satisfy a keyword grep while proving nothing — 硬规则 2.)
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
// Same YAML reader as the other driver-side config readers (driver-config.ts / suite-params.ts):
// the `yaml` package directly, NOT a Core-src module — a third-party install may have no packages/
// tree (worker-driver.ts:1487 states the same rule for its loop.* readers).
import { parse as parseYaml } from "yaml";
// Workspace-root resolution: the PARENT of `git rev-parse --git-common-dir`, order-independent and
// explicitly NOT the first `git worktree list` entry (repo-root.ts's own doc explains why). Reused
// rather than re-derived (ADR-004 single-source); it also gives us the "must not depend on cwd"
// property constraint ④ requires.
import { mainCheckoutRoot } from "./repo-root.ts";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, helpExit, flagValue } from "./gate-script-base.ts";
import { matchGlob, isOverbroadDeclaration, normalizePath, parseTouches } from "./touches-orthogonality-check.ts";
import { classifyBranch, detectDefaultBranch } from "../../packages/quay/src/branch-model.ts";

// normalizePath (canonical: strips ./, collapses //, resolves ./.. segments, drops trailing /, case
// preserved for the case-significant Linux repo) is single-source in touches-orthogonality-check.mjs
// and re-exported here for this module's tests. Closes the audit's H1 dot-segment class.
export { normalizePath };

// ── fileWithinDeclared ───────────────────────────────────────────────────────────────────────────
// True iff `file` matches at least one declared glob. An empty declaration → nothing is within
// (fail-closed: an undeclared write is drift). Paths and globs are normalized first (H1).
export function fileWithinDeclared(file, declaredGlobs) {
  const f = normalizePath(file);
  for (const g of declaredGlobs) if (matchGlob(normalizePath(g), f)) return true;
  return false;
}

// ── readAntiDriftExempt — the workspace-root `anti_drift.exempt` reader ───────────────────────────
// Reads `<workspaceRoot>/.quay/config.yml` (the MAIN checkout — see constraint ④ in the header) and
// returns a THREE-VALUED result, never a boolean (硬规则 3b — "could not read it" must not share an
// output shape with "read it and it is fine"):
//   { status: "absent"    }               → no config file / no `anti_drift` key / no `exempt` key
//                                            ⇒ NO exemptions (= the pre-change behavior, not an error)
//   { status: "ok", entries: [{glob, reason}] } → a well-formed list (possibly empty)
//   { status: "malformed", message }      → present but unreadable as the documented shape
//                                            ⇒ the CALLER fail-closes with its own verdict
// "absent" is deliberately NOT "malformed": a project that never opted in has a valid, empty waiver
// list. A root that exists but carries no `anti_drift` key is the same case, not a defect.
// An entry's `reason` is required and must be non-blank: an unexplained waiver is indistinguishable
// from a forgotten one, so it is refused rather than silently honored.
export function readAntiDriftExempt(workspaceRoot) {
  if (!workspaceRoot) return { status: "absent" };
  const configPath = path.join(workspaceRoot, ".quay", "config.yml");
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch {
    return { status: "absent" }; // no config file (ENOENT etc.) ⇒ no exemptions, not an error
  }
  let doc;
  try {
    doc = parseYaml(text);
  } catch (e) {
    return { status: "malformed", message: `${configPath} is not valid YAML (${e.message})` };
  }
  // A config whose ROOT is not a mapping cannot carry `anti_drift` at all ⇒ treat as absent (same
  // as the "no such key" case), rather than inventing a defect the project did not make.
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { status: "absent" };
  const ad = doc.anti_drift;
  if (ad === undefined || ad === null) return { status: "absent" };
  if (typeof ad !== "object" || Array.isArray(ad)) {
    return { status: "malformed", message: "anti_drift must be a mapping with an `exempt` key" };
  }
  const ex = ad.exempt;
  if (ex === undefined || ex === null) return { status: "absent" };
  if (!Array.isArray(ex)) {
    return { status: "malformed", message: "anti_drift.exempt must be a LIST of {glob, reason} entries" };
  }
  const entries = [];
  for (let i = 0; i < ex.length; i++) {
    const e = ex[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      return { status: "malformed", message: `anti_drift.exempt[${i}] must be a mapping with a \`glob\` and a \`reason\`` };
    }
    const glob = e.glob;
    if (typeof glob !== "string" || !glob.trim()) {
      return { status: "malformed", message: `anti_drift.exempt[${i}] is missing a non-empty string \`glob\`` };
    }
    const reason = e.reason;
    if (typeof reason !== "string" || !reason.trim()) {
      return { status: "malformed", message: `anti_drift.exempt[${i}] (glob "${glob.trim()}") is missing a non-empty \`reason\` — every exemption must say why it is an exception` };
    }
    entries.push({ glob: glob.trim(), reason: reason.trim() });
  }
  return { status: "ok", entries };
}

// ── partitionExempt — split the diff into judged vs exempted ─────────────────────────────────────
// A file matching ANY exempt glob is REMOVED from the judged set (so it can never be an
// out-of-declared violation) and recorded as `{file, glob}` for the required enumeration. The first
// matching glob wins (the list is unordered — only which glob matched is reported). Exempt globs are
// deliberately NOT screened by isOverbroadDeclaration: casting the net wide is the project's call.
export function partitionExempt(actualFiles, exemptEntries) {
  const entries = Array.isArray(exemptEntries) ? exemptEntries : [];
  const judged = [];
  const exempted = [];
  for (const f of actualFiles || []) {
    const nf = normalizePath(f);
    const hit = entries.find((e) => matchGlob(normalizePath(e.glob), nf));
    if (hit) exempted.push({ file: nf, glob: normalizePath(hit.glob) });
    else judged.push(f);
  }
  return { judged, exempted };
}

// ── checkAntiDrift ───────────────────────────────────────────────────────────────────────────────
// builds: [{ id, declaredGlobs:[glob...], actualFiles:[path...] }].
// opts: { allowEmpty } — when true, a ZERO-build manifest is waived (explicit --allow-empty escape
// hatch, default deny). The pure function throws on empty-unless-allowEmpty exactly like it throws
// on a malformed manifest, so the CLI maps both to HARD FAIL (never a silent OK).
// Returns { ok, violations:[{type, ...}] }. ok=false on ANY violation (HARD FAIL). Two violation
// kinds: "out-of-declared" (a build wrote a file matching none of its declared globs) and
// "cross-build-overlap" (two builds actually touched the same file).
export function checkAntiDrift(builds, opts) {
  // (a-1) FAIL-CLOSED on a malformed manifest — a NON-WAIVABLE guardrail must not silently pass on bad
  // input (DIR-049 wiring-audit finding: `b.actualFiles || []` treated a wrong-field-name manifest as
  // empty → ANTI-DRIFT OK). Match serial-fanin-absorb's strictness: every build needs a string id and
  // array declaredGlobs/actualFiles, else throw (the CLI maps the throw to HARD FAIL, not OK).
  if (!Array.isArray(builds)) throw new Error("checkAntiDrift: manifest must be a JSON array of builds");
  // (a-0) EMPTY-SET guard (gap-checks-that-verify-an-empty-set-must-fail-closed): a manifest of ZERO
  // builds means no batch actually ran, so this NON-WAIVABLE guardrail would "verify" nothing and
  // report ANTI-DRIFT OK — indistinguishable from "never looked". serial-fanin-absorb already throws
  // on an empty builds array (computeFanIn: "empty builds — nothing to absorb"); this guard makes the
  // after-the-fact guardrail equally strict, with an explicit --allow-empty escape hatch (default deny).
  if (builds.length === 0 && !(opts && opts.allowEmpty)) {
    throw new Error(
      "checkAntiDrift: empty builds manifest (0 builds) — no batch actually ran, so this NON-WAIVABLE guardrail verified nothing (fail-closed: 'no problems' must not be indistinguishable from 'never looked'; pass --allow-empty to waive)"
    );
  }
  for (const b of builds) {
    if (!b || typeof b.id !== "string" || !b.id) throw new Error("checkAntiDrift: every build needs a string id");
    if (!Array.isArray(b.declaredGlobs)) throw new Error(`checkAntiDrift: build "${b.id}" is missing an array declaredGlobs (fail-closed — a NON-WAIVABLE guardrail does not pass on a malformed manifest)`);
    if (!Array.isArray(b.actualFiles)) throw new Error(`checkAntiDrift: build "${b.id}" is missing an array actualFiles (fail-closed)`);
  }
  const violations = [];
  // (a0) overbroad declaration: a build may not validate its writes against a meaningless scope
  // (`**`, `packages/**`, …). Without this, an overbroad-but-legal glob absorbs any stray write and
  // the out-of-declared arm is toothless (audit finding H3 — needs no dishonest driver). Single-source
  // predicate shared with the pre-flight (ADR-004).
  for (const b of builds) {
    const bad = (b.declaredGlobs || []).find((g) => isOverbroadDeclaration(g));
    if (bad) violations.push({ type: "overbroad-declaration", build: b.id, glob: bad });
  }
  // (a) out-of-declared: every actual write must match a declared glob.
  for (const b of builds) {
    for (const f of b.actualFiles || []) {
      if (!fileWithinDeclared(f, b.declaredGlobs || [])) {
        violations.push({ type: "out-of-declared", build: b.id, file: normalizePath(f) });
      }
    }
  }
  // (b) cross-build-overlap: no file may be touched by two builds (paths normalized — H1).
  for (let i = 0; i < builds.length; i++) {
    for (let j = i + 1; j < builds.length; j++) {
      const setB = new Set((builds[j].actualFiles || []).map(normalizePath));
      for (const f of builds[i].actualFiles || []) {
        if (setB.has(normalizePath(f))) violations.push({ type: "cross-build-overlap", a: builds[i].id, b: builds[j].id, file: normalizePath(f) });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Driver input surface (gap-anti-drift-touches-zero-coverage-fast-mode) ──────────────────────────
// The fast-mode fan-in path runs this module as a GATE with the ACTUAL diff (the files the fan-in
// would land) vs the task's DECLARED `## Touches`:
//   node --experimental-strip-types anti-drift-touches-check.ts --task <id> --worktree <dir>
//        [--merge-target <ref>]
// The classic-loop driver (anti-drift-touches-check.sh) supplied a pre-computed manifest from
// `git diff --numstat`; THIS driver computes the actual diff itself (`git diff --name-only
// <merge-target>...HEAD` — the task's own commits, i.e. exactly what fan-in-ff-merge would land)
// and reads the declared globs from the task body (the ONE touches-parser). The judgment — one
// build whose every actual file must fall within a declared glob — is the SAME checkAntiDrift as
// the manifest-file mode (a single build cannot cross-build-overlap; out-of-declared and
// overbroad-declaration are HARD FAIL). The judgment logic is UNCHANGED; only the input surface is new.

/** Compute the files the fan-in would land: `git diff --name-only <merge-target>...HEAD` in the
 *  worktree. After the fan-in workflow's step-1 merge of the merge-target into the task worktree,
 *  this is exactly the set of files the ff-merge would move onto the merge target. Fail-closed: a
 *  git error THROWS — the caller maps it to a usage/env error (exit 2), never a silent OK.
 *  ⚠️ `-c core.quotepath=false`：git 默认对含非 ASCII 的文件名输出 C-quoted 形态（前导引号 +
 *  `\ooo` 八进制转义），使本函数的逐字节 `--name-only` 结果与声明 `## Touches` 的真实 UTF-8
 *  文件名无法匹配 ⇒ 非 ASCII 文件被误判 out-of-declared（gap-branch-rename-manager-doc-to-author
 *  触碰 docs/references/维度边界…md 时实测触发）。关闭 quotepath 让 `--name-only` 输出原始路径
 *  字节，恢复对非 ASCII 路径的精确匹配（同 direct-to-develop-bypass-check.ts gitCommitFiles 的
 *  修法）。 */
export function computeActualFiles(worktree, mergeTarget) {
  const out = execFileSync("git", ["-C", worktree, "-c", "core.quotepath=false", "diff", "--name-only", `${mergeTarget}...HEAD`], {
    encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"],
  });
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Build the single-build manifest a task fan-in must satisfy: the declared `## Touches` globs vs
 *  the ACTUAL files the fan-in would land. `parseTouches` (the ONE parser) resolves a missing Touches
 *  section to [] — fail-closed: any actual file then violates (an undeclared write is drift). */
export function buildTaskManifest(taskBody, actualFiles) {
  const { globs } = parseTouches(String(taskBody ?? ""));
  return [{ id: "task", declaredGlobs: globs, actualFiles }];
}

/** Driver verdict over one task build: checkAntiDrift (judgment UNCHANGED) with the task's declared
 *  Touches vs its actual diff. Returns the checkAntiDrift result plus the manifest for transparency.
 *  `opts.exempt` (the workspace-root `anti_drift.exempt` entries) removes matching files from the
 *  JUDGED set before the judgment runs — the judgment itself is untouched, so an all-exempt diff is
 *  judged exactly like an empty one. `actualFiles` stays the full diff for transparency; `judgedFiles`
 *  is what the verdict actually saw, and `exempted` is the enumeration the output must report. */
export function checkTaskAntiDrift(taskBody, actualFiles, opts) {
  const { judged, exempted } = partitionExempt(actualFiles, opts && opts.exempt);
  const builds = buildTaskManifest(taskBody, judged);
  return {
    ...checkAntiDrift(builds, opts),
    builds,
    actualFiles,
    judgedFiles: judged,
    exempted,
    declaredGlobs: builds[0].declaredGlobs,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  anti-drift-touches-check.mjs [--allow-empty] <ran-batch-manifest.json>\n" +
      "  anti-drift-touches-check.mjs --task <id> --worktree <dir> [--merge-target <ref>] [--allow-empty]\n" +
      "    (driver mode — fast-mode fan-in gate: actual diff vs declared ## Touches)\n" +
      "    Waivers: `anti_drift.exempt` in the WORKSPACE-ROOT .quay/config.yml (a list of\n" +
      "    {glob, reason}); waived files are reported as `exempted: <file> <- <glob>`.\n",
  );
}

/** Driver-mode body: run the anti-drift check over ONE task build. Exit 0 = clean (every actual
 *  file within the declared Touches, declaration not overbroad); 1 = HARD FAIL (out-of-declared
 *  write or overbroad declaration); 2 = usage/env error (task file missing / git diff unavailable /
 *  MALFORMED `anti_drift.exempt` in the workspace-root config — fail-closed, never a silent OK);
 *  3 = BASELINE-MISMATCH (the merge target is not a continuation of the default branch). */
function runTaskDriver({ taskId, worktree, mergeTarget, allowEmpty }) {
  const taskPath = path.join(worktree, "tasks", `${taskId}.md`);
  if (!fs.existsSync(taskPath)) {
    process.stderr.write(`anti-drift-touches-check: task file not found: ${taskPath}\n`);
    return 2;
  }
  // ── BASELINE SANITY (gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing) ──────
  // The judgment below is `git diff --name-only <mergeTarget>...HEAD` vs the task's declared
  // `## Touches`. That diff is ONLY the task's own work when <mergeTarget> is the line the branch
  // forked from / will be fast-forwarded onto. When the target is a FOREIGN line (not a
  // continuation of the project's default branch) the three-dot diff is the mainline's entire
  // divergence from it — measured 2026-09-11 on a real upgraded project copy: 1566 files, which no
  // `## Touches` list can cover. The old output reported that as "1566 violation(s)", i.e. it
  // blamed the TASK for the BASELINE's shape and cost the operator hours chasing a worker that had
  // in fact implemented its fix correctly. Distinct cause ⇒ distinct verdict (never folded into the
  // violation count) and a distinct exit code.
  //
  // `allowCurrentBranch: false`: inside a task worktree HEAD is `task/<id>`, never a default-branch
  // proxy (using it would invert the predicate and misreport every healthy fan-in).
  const defaultBranch = detectDefaultBranch(worktree, { allowCurrentBranch: false });
  const baseline = classifyBranch(worktree, mergeTarget, defaultBranch);
  if (baseline.state === "divergent") {
    process.stdout.write(
      `BASELINE-MISMATCH: merge target '${mergeTarget}' is not a continuation of the project's ` +
      `default branch '${defaultBranch}' — ${baseline.detail}.\n` +
      `  The ${mergeTarget}...HEAD diff is therefore the mainline's divergence, NOT task ${taskId}'s ` +
      `own work; no declaration of ## Touches can satisfy it. This is a BASELINE defect, not an ` +
      `out-of-declared write by the task.\n` +
      `  Remedy: \`quay init --force --adopt-branch-model\` (preserves the old tip as ` +
      `'${mergeTarget}-pre-quay-init-<sha>' and re-points '${mergeTarget}' at '${defaultBranch}'), ` +
      `then re-dispatch the task.\n`,
    );
    return 3;
  }
  let actualFiles;
  try {
    actualFiles = computeActualFiles(worktree, mergeTarget);
  } catch (e) {
    process.stderr.write(
      `anti-drift-touches-check: could not compute git diff (${mergeTarget}...HEAD) in ${worktree}: ${e.message}\n`,
    );
    return 2;
  }
  // ── anti_drift.exempt (workspace-root config; see the header's constraint ④) ────────────────────
  // Resolved from the WORKSPACE ROOT, not the worktree: the worktree copy is the one a task can edit
  // itself. `malformed` is a DISTINCT verdict with a DISTINCT exit code — a broken waiver list must
  // not present as either a pass or an out-of-declared write (硬规则 3b). An unresolvable root ("" —
  // not a git repo) degrades to "no exemptions", i.e. the STRICTER direction, never a waiver.
  const workspaceRoot = mainCheckoutRoot(worktree);
  const exemptRead = readAntiDriftExempt(workspaceRoot);
  if (exemptRead.status === "malformed") {
    // Wording note: this text deliberately does NOT contain the token `out-of-declared`. A broken
    // waiver list and a stray write must stay separable by a plain grep — "可区分" is only real if
    // it survives the cheapest discriminator (硬规则 3b).
    process.stdout.write(
      `ANTI-DRIFT CONFIG ERROR: malformed anti_drift in ${path.join(workspaceRoot, ".quay", "config.yml")} — ` +
        `${exemptRead.message}\n  This is NOT a stray write by the task: the exemption list could not be ` +
        `evaluated, so the check fail-closes rather than judging with an unknown waiver set.\n`,
    );
    return 2;
  }
  const exempt = exemptRead.status === "ok" ? exemptRead.entries : [];
  let r;
  try {
    r = checkTaskAntiDrift(fs.readFileSync(taskPath, "utf8"), actualFiles, { allowEmpty, exempt });
  } catch (e) {
    // malformed task/input → fail-closed HARD FAIL (never silently pass a NON-WAIVABLE guardrail)
    process.stdout.write(`ANTI-DRIFT HARD FAIL: malformed input — ${e.message}\n`);
    return 1;
  }
  // Enumeration is mandatory (constraint ②): "exempted" must be distinguishable from "never changed".
  const exemptLines = r.exempted.length
    ? `  exempted (${r.exempted.length}) by workspace-root anti_drift.exempt:\n` +
      r.exempted.map((e) => `    exempted: ${e.file} <- ${e.glob}\n`).join("")
    : "";
  if (r.ok) {
    process.stdout.write(
      `ANTI-DRIFT OK: task ${taskId} — ${r.judgedFiles.length} actual file(s), all within declared Touches (${r.declaredGlobs.length} glob(s))\n` +
        exemptLines,
    );
    return 0;
  }
  process.stdout.write(`ANTI-DRIFT HARD FAIL: task ${taskId} — ${r.violations.length} violation(s)\n` + exemptLines);
  for (const v of r.violations) {
    if (v.type === "overbroad-declaration") {
      process.stdout.write(`  overbroad-declaration: task declares "${v.glob}" (too broad to validate stray writes against)\n`);
    } else {
      process.stdout.write(`  out-of-declared: task wrote ${v.file} (matches no declared Touches glob)\n`);
    }
  }
  return 1;
}

export async function main(argv) {
  const args = argv.slice(2).filter((a) => a !== undefined);
  if (args.includes("--help") || args.includes("-h")) {
    helpExit(
      "Usage:\n" +
        "  anti-drift-touches-check.mjs [--allow-empty] <ran-batch-manifest.json>\n" +
        "  anti-drift-touches-check.mjs --task <id> --worktree <dir> [--merge-target <ref>] [--allow-empty]\n" +
        "    (driver mode — fast-mode fan-in gate: actual diff vs declared ## Touches)\n" +
        "    Waivers: `anti_drift.exempt` in the WORKSPACE-ROOT .quay/config.yml (a list of\n" +
        "    {glob, reason}); waived files are reported as `exempted: <file> <- <glob>`.",
    );
  }
  const allowEmpty = args.includes("--allow-empty");
  // Driver mode (gap-anti-drift-touches-zero-coverage-fast-mode): --task <id> --worktree <dir>
  // [--merge-target <ref>] — the fast-mode fan-in gate. Reads the task body's declared Touches and
  // computes the actual diff itself; the judgment is the SAME checkAntiDrift as the manifest mode.
  if (args.includes("--task")) {
    const taskId = flagValue(args, "--task");
    if (!taskId) { usage(); return 2; }
    const worktree = path.resolve(flagValue(args, "--worktree") ?? process.cwd());
    const mergeTarget = flagValue(args, "--merge-target") ?? "develop";
    return runTaskDriver({ taskId, worktree, mergeTarget, allowEmpty });
  }
  // ── manifest-file mode (the classic-loop driver): [--allow-empty] <ran-batch-manifest.json>
  const files = args.filter((a) => a !== "--allow-empty");
  if (files.length !== 1) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: manifest not found: ${files[0]}\n`); return 2; }
  let builds;
  try {
    builds = JSON.parse(fs.readFileSync(files[0], "utf8"));
  } catch (e) {
    process.stderr.write(`ERROR: manifest is not valid JSON: ${e.message}\n`);
    return 2;
  }
  if (!Array.isArray(builds)) { process.stderr.write("ERROR: manifest must be a JSON array of builds\n"); return 2; }
  let r;
  try {
    r = checkAntiDrift(builds, { allowEmpty });
  } catch (e) {
    // malformed manifest → fail-closed HARD FAIL (never silently pass a NON-WAIVABLE guardrail)
    process.stdout.write(`ANTI-DRIFT HARD FAIL: malformed manifest — ${e.message}\n`);
    return 1;
  }
  if (r.ok) {
    process.stdout.write(`ANTI-DRIFT OK: ${builds.length} builds, no out-of-declared writes, no cross-build overlap\n`);
    return 0;
  }
  process.stdout.write(`ANTI-DRIFT HARD FAIL: ${r.violations.length} violation(s)\n`);
  for (const v of r.violations) {
    if (v.type === "overbroad-declaration") process.stdout.write(`  overbroad-declaration: build ${v.build} declares "${v.glob}" (too broad to validate stray writes against)\n`);
    else if (v.type === "out-of-declared") process.stdout.write(`  out-of-declared: build ${v.build} wrote ${v.file} (matches no declared glob)\n`);
    else process.stdout.write(`  cross-build-overlap: builds ${v.a} & ${v.b} both touched ${v.file}\n`);
  }
  return 1;
}

if (isDirectEntry(import.meta, undefined, "anti-drift-touches-check")) {
  main(process.argv).then((code) => process.exit(code));
}
