#!/usr/bin/env node
// provider-binding-resolvability-check.ts — does a quay project's provider binding resolve its
// runtime WITHOUT external $PATH assistance?
//
// (tasks/gap-pre-fix-upgraded-project-unresolvable-binding-undetected, AC1 option ①.)
//
// ── THE DEFECT THIS MAKES VISIBLE ───────────────────────────────────────────────────────────────
// A project upgraded BEFORE `quay-init`'s migration landed (commit ba960f503) keeps the legacy
// BARE-PATH binding form:
//
//     providers:
//       native:
//         path: .
//         mcp_entry:
//         - quay-native        # ← no separator: an OS $PATH lookup, not a path
//         - mcp
//
// The product spawns `mcp_entry[0]` verbatim with `cwd: <workspaceRoot>/<provider.path>`
// (packages/quay/src/cli/shared.ts:175-181). A bare `quay-native` therefore resolves to WHATEVER
// $PATH HAPPENS TO HOLD on the host that runs it — so the project's ability to read its own task
// board is not a property of the project at all. On a host with no `quay-native` on $PATH the read
// fails with a raw `Error: spawn quay-native ENOENT`, and NOTHING reports that this project is in
// the pre-migration binding form.
//
// WHY IT WENT UNSEEN (the task's core): the one reading that should have caught it
// (`plugin/scripts/verify-deliver-coldstart.sh` step_upgrade_existing ⑥) ran the CLI as
// `PATH="$PREFIX/bin:$PATH" node …` — an EXTERNAL $PATH ASSIST that supplies exactly the missing
// resolution. That reading was thus structurally incapable of taking the false value: "upgrade
// succeeded" and "the upgraded project is unusable" produced the SAME reading. Same family as
// 硬规则 4 (一个结构上不可能取假的量,不是测量) and 硬规则 4b (代理量与实际偏离).
//
// ── THE JUDGMENT (host-independent by construction — this is the whole point) ───────────────────
// The question is NOT "does this token resolve on MY machine" (that is `isPathBinary` in
// packages/quay/src/config-validate.ts:648, and it is the blind spot in product form: a token that
// resolves on the CURRENT process's $PATH is reported as fine, so the validator says OK on a host
// where the bare name happens to be installed). The question is:
//
//     Is the runtime NAMED BY A PATH the project itself controls?
//
// A token containing no path separator can only be satisfied by an external $PATH (or cwd) lookup
// ⇒ it is NOT a binding, and it is reported RED **regardless of whether it happens to resolve
// here**. A token containing a separator is resolved exactly the way the product resolves it —
// relative tokens against `<workspaceRoot>/<provider.path>` (cli/shared.ts:175, NOT against the
// workspace root) — and must exist. ⇒ The verdict is a function of the config bytes + the tree on
// disk, never of this process's environment.
//
// ── THREE-STATE OUTPUT (硬规则 3b: 读不懂输入 ≠ 合格) ───────────────────────────────────────────
//   path-resolved     the runtime token is a path (absolute, or relative to the provider dir) that
//                     EXISTS ⇒ 合格.
//   bare-path-name    the runtime token has no separator ⇒ RED. Resolvable only through $PATH.
//   dangling-absolute the token is an absolute path that does NOT exist ⇒ RED.
//   dangling-relative the token is a relative path that does NOT exist under the provider dir ⇒ RED.
//   no-mcp-entry      an enabled provider declares no mcp_entry at all ⇒ NOT-EVALUATED (a missing
//                     value is 未查, not 为假 — hard rule 6). config-validate.ts owns that defect.
//   unrecognized-shape no quay runtime token could be identified in mcp_entry ⇒ NOT-EVALUATED.
// The last two NEVER share an output word with `path-resolved`, so "could not evaluate" can never
// be read as "evaluated, fine".
//
// MODES:
//   default [--root <dir>] — human-readable per-provider breakdown + verdict. Exit 0 iff at least
//                            one binding was judged and none failed.
//   --json                 — machine-readable report (states map + per-provider rows).
//
// Exit codes: 0 = PASS (≥1 binding judged, no RED) · 1 = FAIL (≥1 RED binding) ·
//             2 = usage/env error · 3 = NOT-EVALUATED (no config / no enabled provider with a
//             judged binding / config unparseable) — never conflated with PASS.

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { helpExit, emitVerdict, isDirectEntry } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";

/** The token shapes that name a quay runtime (the migration's own predicate, kept identical). */
const RUNTIME_BASENAME = /^quay(-native)?\.(js|ts|mjs|cjs)$/;
/** The bare (separator-less) forms `quay-init`'s `is_bare_path_quay` recognizes. */
const BARE_QUAY_NAME = /^quay(-native)?$/;

export type BindingState =
  | "path-resolved"
  | "bare-path-name"
  | "dangling-absolute"
  | "dangling-relative"
  | "no-mcp-entry"
  | "unrecognized-shape";

/** The RED states — the ones that mean "this project cannot name its own runtime". */
export const RED_STATES: ReadonlySet<BindingState> = new Set<BindingState>([
  "bare-path-name",
  "dangling-absolute",
  "dangling-relative",
]);

/** The NOT-EVALUATED states — a missing/unreadable input, never a verdict of 合格. */
export const NOT_EVALUATED_STATES: ReadonlySet<BindingState> = new Set<BindingState>([
  "no-mcp-entry",
  "unrecognized-shape",
]);

export interface ProviderRow {
  id: string;
  enabled: boolean;
  providerPath: string;
  baseDir: string;
  mcpEntry: unknown;
  runtimeToken: string | null;
  runtimeTokenIndex: number | null;
  state: BindingState;
  /** The absolute path the token resolves to when it IS a path; null for bare names. */
  resolved: string | null;
  exists: boolean;
  /** How many tokens in mcp_entry looked like a quay runtime (first match is classified). */
  runtimeTokenCandidates: number;
}

export interface BindingReport {
  root: string;
  configPath: string;
  providers: ProviderRow[];
  states: Record<string, number>;
  /** How many enabled providers produced a JUDGED binding (path-resolved or a RED state). */
  judged: number;
  failed: number;
  notEvaluated: number;
}

/** True iff the token could be a path rather than an OS $PATH lookup (has a separator). */
function hasSeparator(token: string): boolean {
  return token.includes("/") || token.includes(path.sep);
}

/**
 * runtimeToken — which token of `mcp_entry` NAMES the runtime, by SHAPE (hard rule 2: by position,
 * not by keyword):
 *   - a token whose basename is a quay runtime file (`…/quay-native.ts`) — the canonical
 *     `["node", <runtime>, "mcp"]` form, and also the index-0 `[<runtime>, "mcp"]` form;
 *   - a bare `quay` / `quay-native` word — the pre-migration PATH form, whose runtime token sits at
 *     index 0 (`["quay-native", "mcp"]`; `mcp_entry[1]` there is the `mcp` VERB, which is exactly
 *     the index confusion that made the pre-ba960f503 migration read nothing at all).
 * Returns the FIRST match (and how many matched) so a pathological entry can never silently pass by
 * supplying a decoy: the classified token is reported in the JSON.
 */
export function runtimeToken(me: unknown): {
  token: string | null;
  index: number | null;
  candidates: number;
} {
  if (!Array.isArray(me)) return { token: null, index: null, candidates: 0 };
  let first: { token: string; index: number } | null = null;
  let candidates = 0;
  me.forEach((raw, i) => {
    if (typeof raw !== "string" || raw === "") return;
    const isRuntimeFile = RUNTIME_BASENAME.test(path.basename(raw));
    const isBareQuay = !hasSeparator(raw) && BARE_QUAY_NAME.test(raw);
    if (!isRuntimeFile && !isBareQuay) return;
    candidates += 1;
    if (first === null) first = { token: raw, index: i };
  });
  return { token: first?.token ?? null, index: first?.index ?? null, candidates };
}

/** Classify ONE provider's runtime binding. Pure function of the config row + the tree on disk. */
export function classifyProvider(
  id: string,
  prov: Record<string, unknown>,
  workspaceRoot: string,
): ProviderRow {
  const enabled = prov.enabled !== false;
  const providerPath = typeof prov.path === "string" && prov.path !== "" ? prov.path : ".";
  // The product's OWN resolution base: cli/shared.ts:175 resolves the provider dir against the
  // workspace root and spawns with that as cwd. Judging relative tokens against the workspace root
  // instead would mis-detect the host repo's own `./bin/quay-native.ts` as dangling.
  const baseDir = path.resolve(workspaceRoot, providerPath);
  const me = prov.mcp_entry;
  const { token, index, candidates } = runtimeToken(me);

  const row: ProviderRow = {
    id,
    enabled,
    providerPath,
    baseDir,
    mcpEntry: me ?? null,
    runtimeToken: token,
    runtimeTokenIndex: index,
    state: "no-mcp-entry",
    resolved: null,
    exists: false,
    runtimeTokenCandidates: candidates,
  };

  if (token === null) {
    // No runtime token at all: either mcp_entry is absent/empty (config-validate.ts owns it) or no
    // token looks like a quay runtime — in both cases this checker has nothing to judge.
    row.state = Array.isArray(me) && me.length > 0 ? "unrecognized-shape" : "no-mcp-entry";
    return row;
  }
  if (!hasSeparator(token)) {
    // A bare word is satisfied only by an OS $PATH (or cwd) lookup — deliberately NOT consulted.
    row.state = "bare-path-name";
    return row;
  }
  const resolved = path.isAbsolute(token) ? token : path.resolve(baseDir, token);
  row.resolved = resolved;
  let exists = false;
  try {
    exists = fs.statSync(resolved).isFile();
  } catch {
    exists = false;
  }
  row.exists = exists;
  if (exists) {
    row.state = "path-resolved";
  } else {
    row.state = path.isAbsolute(token) ? "dangling-absolute" : "dangling-relative";
  }
  return row;
}

/** Read `.quay/config.yml` and classify every provider. Throws for unreadable/unparseable input. */
export function audit(root: string): BindingReport {
  const configPath = path.join(root, ".quay", "config.yml");
  if (!fs.existsSync(configPath)) {
    throw new Error(`no .quay/config.yml under ${root} — not a quay workspace`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const data = parseYaml(raw) as Record<string, unknown> | null;
  if (data === null || typeof data !== "object") {
    throw new Error(`${configPath} is not a YAML mapping`);
  }
  const providers = (data.providers ?? {}) as Record<string, unknown>;
  const rows: ProviderRow[] = [];
  for (const [id, prov] of Object.entries(providers)) {
    if (prov === null || typeof prov !== "object" || Array.isArray(prov)) continue;
    rows.push(classifyProvider(id, prov as Record<string, unknown>, root));
  }
  const states: Record<string, number> = {};
  for (const r of rows) states[r.state] = (states[r.state] ?? 0) + 1;
  const enabled = rows.filter((r) => r.enabled);
  const judged = enabled.filter(
    (r) => r.state === "path-resolved" || RED_STATES.has(r.state),
  ).length;
  const failed = enabled.filter((r) => RED_STATES.has(r.state)).length;
  const notEvaluated = enabled.filter((r) => NOT_EVALUATED_STATES.has(r.state)).length;
  return { root, configPath, providers: rows, states, judged, failed, notEvaluated };
}

function reportText(r: BindingReport): string {
  const lines: string[] = [];
  lines.push(`provider binding resolvability — ${r.configPath}`);
  for (const p of r.providers) {
    const mark = RED_STATES.has(p.state)
      ? "RED           "
      : p.state === "path-resolved"
        ? "ok            "
        : "NOT-EVALUATED ";
    const dis = p.enabled ? "" : " (disabled — informational only)";
    const where = p.resolved ? ` -> ${p.resolved}` : "";
    lines.push(
      `  [${mark}] ${p.id}: ${p.state}  token=${JSON.stringify(p.runtimeToken)}${where}${dis}`,
    );
  }
  return lines.join("\n");
}

const usage =
  "usage: node provider-binding-resolvability-check.ts [--root <dir>] [--json]\n" +
  "  Judges whether each enabled provider's mcp_entry names its runtime by a PATH the project\n" +
  "  controls (absolute, or relative to the provider dir) that exists — WITHOUT consulting $PATH.\n" +
  "  A bare token (e.g. `quay-native`) is RED even when $PATH happens to resolve it.\n" +
  "  Exit: 0 = PASS; 1 = FAIL (>=1 bare-path/dangling binding); 2 = usage/env error;\n" +
  "        3 = NOT-EVALUATED (no config / nothing judgeable) — never conflated with PASS";

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : repoRoot());
  if (rootArg !== -1 && (args[rootArg + 1] === undefined || args[rootArg + 1] === "")) {
    console.error("ERROR: --root requires a directory");
    return 2;
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`ERROR: root is not a directory: ${root}`);
    return 2;
  }

  let report: BindingReport;
  try {
    report = audit(root);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return emitVerdict(
      { status: "not-evaluated", message: `provider-binding-resolvability-check: ${msg}`, detail: { root } },
      { json: asJson, stream: "stderr" },
    );
  }

  if (!asJson) console.log(reportText(report));
  if (report.failed > 0) {
    const bad = report.providers
      .filter((p) => RED_STATES.has(p.state))
      .map((p) => `${p.id}=${p.state}`)
      .join(", ");
    return emitVerdict(
      {
        status: "fail",
        message:
          `provider-binding-resolvability-check: ${report.failed} provider binding(s) do not resolve ` +
          `without $PATH assistance (${bad}) — re-run quay-init on this project to migrate the binding`,
        detail: report,
      },
      { json: asJson },
    );
  }
  if (report.judged === 0) {
    return emitVerdict(
      {
        status: "not-evaluated",
        message:
          `provider-binding-resolvability-check: no enabled provider with a judgeable runtime binding ` +
          `(${report.providers.length} provider(s), ${report.notEvaluated} not-evaluated) — nothing was judged`,
        detail: report,
      },
      { json: asJson, stream: "stderr" },
    );
  }
  return emitVerdict(
    {
      status: "pass",
      message:
        `provider-binding-resolvability-check: ${report.judged} provider binding(s) name their runtime ` +
        `by a resolvable path (no $PATH assistance required)`,
      detail: report,
    },
    { json: asJson },
  );
}

if (isDirectEntry(import.meta)) {
  process.exit(main(process.argv));
}
