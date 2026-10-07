#!/usr/bin/env node
// verify-plugin-channel-assertions.ts — the ONE implementation of the release gate's channel
// assertions, runnable BOTH from CI (`release.yml` `verify-plugin-channel`) and locally.
//
// THE DEFECT THIS EXISTS FOR (tasks/gap-release-gate-verify-plugin-channel-misses-config-validate-
// version-pointer-scope-and-upgrade-assertions). The Claude Code plugin channel is the sole release
// channel (human ruling 2026-09-16), and `verify-plugin-channel` is its only gate. That gate proved
// exactly three things — "it installs, the drivers come up (alive==1), `serve` answers HTTP" — and
// nothing else. Meanwhile FOUR defects of exactly the size the gate exists to catch had already
// slipped through it:
//   1. `quay config validate` / MCP `config_validate` REJECT the config the official `/quay:init`
//      writes (0.16.0: init stopped writing native `mcp_entry`, the validator still demanded it) —
//      gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver;
//   2. `quay --version` reports `X.Y.Z-dev` on a RELEASE build because the byte bundle inlined the
//      version before stamping — gap-release-bundle-embeds-dev-version-after-stamp;
//   3. the project's `.quay/plugin` pointer / version records / frozen provider `path` are never
//      checked against the running plugin — gap-project-quay-pointer-is-init-plugin-root-…;
//   4. the serve host is spawned in the CALLER's session cgroup and dies on CloudCLI restart —
//      gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts.
// Each of those has a reading that a real install carries; the gate read none of them. A gate whose
// readings and "the artifact is correct" are separated by unread quantities is 硬规则 3b / 4c: the
// judgement does not cover the quantity it is taken to cover.
//
// ⛔ WHY THIS IS A SCRIPT AND NOT `run:` BLOCKS IN release.yml (proposal 修法 A): an assertion
// written inline in YAML can only run in CI — it cannot be replayed locally before dispatching a
// release, and every assertion would be written twice (once for `--scope project`, once for
// `--scope user`). One implementation, two call sites.
//
// ── THREE-VALUED OUTPUT (硬规则 3b/6) ────────────────────────────────────────────────────────────
// Every assertion is PASS / FAIL / **NOT-EVALUATED**. NOT-EVALUATED is what a reading emits when it
// COULD NOT READ ITS INPUT (no plugin.json, no server.json, the validator could not be run) — it is
// never folded into PASS. The summary line is `passed=<n> failed=<n> not-evaluated=<n>` and the exit
// code distinguishes the three populations: 0 = every assertion PASSED, 1 = at least one FAIL,
// 3 = no FAIL but at least one NOT-EVALUATED (a different exit code than all-pass on purpose — "could
// not judge" must not share an exit code with "judged and clean"), 2 = usage error.
//
// ── DIRECT READINGS ONLY (硬规则 4b) ─────────────────────────────────────────────────────────────
// Version assertions read the CARRIERS THEMSELVES (`VERSION`, `.claude-plugin/plugin.json`) and the
// byte bundle's own `--version` output — never a self-report from the artifact about itself. cgroup
// is read from `/proc/<pid>/cgroup`, not from any quay-written field.
//
// Run (CI and local replay use the SAME invocation):
//   node --experimental-strip-types plugin/scripts/verify-plugin-channel-assertions.ts \
//     --installed <installed-plugin-dir> --project <scratch-project-dir> --scope user|project
//   … --upgrade-from <previous-plugin-tree>   # local upgrade drill (见 --upgrade-from)
//
// ⛔ Run from a SOURCE checkout, not from the installed artifact: the installed artifact strips raw
// `.ts` (publish-dist-branch.sh deletes every plugin `.ts` before publishing), so this file exists
// there only as `scripts/dist/*.js` WHEN something in the shipped surface references it. The gate
// treats it as a checker, not as part of the deliverable, and runs it from the tag's own tree.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { flagValue, isDirectEntry } from "./gate-script-base.ts";
import {
  baselineFileAbs,
  judge as judgeRatchet,
  judgeShippedSize,
  measuredOf,
  overBaselineMessage,
  overSizeMessage,
  readBaselineFile,
  readRulesFromFile,
  readShippedSet,
  rulesFileAbs,
  shippedOf,
  type ShippedSetBaseline,
  type ShippedSetReading,
} from "./shipped-set-rules.ts";
import {
  defaultRepoRoot,
  deriveReachability,
  judgeShellReachability,
  type ReachabilityReading,
} from "./shipped-shell-reachability.ts";

export type AssertionState = "PASS" | "FAIL" | "NOT-EVALUATED";

export interface AssertionResult {
  id: string;
  state: AssertionState;
  /** Human-readable: the value observed and (for FAIL/NOT-EVALUATED) why it did not qualify. */
  detail: string;
}

export const EXIT_ALL_PASS = 0;
export const EXIT_FAIL = 1;
export const EXIT_NOT_EVALUATED = 3;
export const EXIT_USAGE = 2;

const VALID_SCOPES = ["user", "project", "local"];

/** Every installed plugin version, read from the plugin's OWN carriers (never a `--version`
 *  self-report). `—dev` is preserved verbatim — it is exactly the reading the version assertion
 *  exists to catch. */
export interface InstalledVersions {
  /** `<installed>/VERSION` (trimmed), or null when absent/unreadable. */
  versionFile: string | null;
  /** `<installed>/.claude-plugin/plugin.json` `.version`, or null. */
  pluginJson: string | null;
  /** stdout of `<installed>/bin/quay --version` (first non-empty line), or null. */
  cliVersion: string | null;
  /** Why a carrier could not be read (joined); empty when all three were read. */
  unreadable: string[];
}

function firstLine(s: string): string {
  const line = String(s)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? "";
}

function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Resolve a path through symlinks, or null when it does not exist / cannot be resolved. */
export function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

// ── readings (effects) ───────────────────────────────────────────────────────────────────────────

/** Run the INSTALLED plugin's CLI shim. Returns the spawnSync result; callers judge it. */
export function runInstalledCli(
  installedDir: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): { status: number | null; stdout: string; stderr: string; error: string | null } {
  const bin = path.join(installedDir, "bin", "quay");
  if (!fs.existsSync(bin)) {
    return { status: null, stdout: "", stderr: "", error: `no CLI shim at ${bin}` };
  }
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    error: r.error ? String((r.error as Error).message ?? r.error) : null,
  };
}

/** The three version carriers, read directly. */
export function readInstalledVersions(installedDir: string): InstalledVersions {
  const unreadable: string[] = [];

  const versionFile = readText(path.join(installedDir, "VERSION"));
  if (versionFile === null) unreadable.push("VERSION");

  let pluginJson: string | null = null;
  const pluginJsonRaw = readText(path.join(installedDir, ".claude-plugin", "plugin.json"));
  if (pluginJsonRaw === null) {
    unreadable.push(".claude-plugin/plugin.json");
  } else {
    try {
      const v = (JSON.parse(pluginJsonRaw) as { version?: unknown })?.version;
      if (typeof v === "string" && v.trim() !== "") pluginJson = v.trim();
      else unreadable.push(".claude-plugin/plugin.json (no string `version`)");
    } catch {
      unreadable.push(".claude-plugin/plugin.json (unparsable)");
    }
  }

  let cliVersion: string | null = null;
  const cli = runInstalledCli(installedDir, ["--version"], installedDir, 60_000);
  if (cli.error) {
    unreadable.push(`bin/quay --version (${cli.error})`);
  } else {
    const line = firstLine(cli.stdout);
    if (line === "") unreadable.push("bin/quay --version (no output)");
    else cliVersion = line;
  }

  return {
    versionFile: versionFile === null ? null : versionFile.trim(),
    pluginJson,
    cliVersion,
    unreadable,
  };
}

// ── pure judges ──────────────────────────────────────────────────────────────────────────────────
//
// Each judge is pure (given already-read values it returns an AssertionResult) so the fixture tests
// can drive the SAME judgement the runner uses — a test that re-implements the rule would be a test
// of the fixture, not of the shipping predicate.

/** Version carriers must all agree and none may carry a `-dev` suffix. */
export function judgeVersionConsistency(v: InstalledVersions): AssertionResult {
  const id = "version-consistency";
  if (v.unreadable.length > 0) {
    return {
      id,
      state: "NOT-EVALUATED",
      detail: `could not read carrier(s): ${v.unreadable.join("; ")} (⛔ not "versions agree")`,
    };
  }
  const carriers: Array<[string, string]> = [
    ["VERSION", v.versionFile as string],
    [".claude-plugin/plugin.json", v.pluginJson as string],
    ["bin/quay --version", v.cliVersion as string],
  ];
  const distinct = [...new Set(carriers.map(([, val]) => val))];
  const devCarriers = carriers.filter(([, val]) => /-dev\b/.test(val)).map(([name, val]) => `${name}=${val}`);
  if (distinct.length !== 1) {
    return {
      id,
      state: "FAIL",
      detail: `carriers disagree: ${carriers.map(([n, val]) => `${n}=${val}`).join(", ")} — a release build must carry ONE version`,
    };
  }
  if (devCarriers.length > 0) {
    return {
      id,
      state: "FAIL",
      detail: `release build carries a -dev version on: ${devCarriers.join(", ")} — the stamped carriers were not rebuilt into the byte bundle (gap-release-bundle-embeds-dev-version-after-stamp)`,
    };
  }
  return { id, state: "PASS", detail: `all carriers agree on ${distinct[0]} and none is -dev` };
}

/** `.quay/plugin` (the project's pointer) must resolve to the plugin Core is verifying. */
export function judgePointer(linkReal: string | null, installedReal: string | null): AssertionResult {
  const id = "project-pointer";
  if (linkReal === null) {
    return { id, state: "NOT-EVALUATED", detail: "the project has no `.quay/plugin` link (or it does not resolve) — nothing to compare" };
  }
  if (installedReal === null) {
    return { id, state: "NOT-EVALUATED", detail: "the installed plugin directory does not resolve — cannot compare the pointer to it" };
  }
  if (linkReal !== installedReal) {
    return { id, state: "FAIL", detail: `.quay/plugin → ${linkReal}, but the verified install is ${installedReal} (a stale/other-version pointer)` };
  }
  return { id, state: "PASS", detail: `.quay/plugin resolves to the verified install (${installedReal})` };
}

/** The native provider must NOT freeze a path / mcp_entry into the project config (Core resolves
 *  them from the plugin root; a frozen version path pins the project to a cache version). */
export function judgeNativeNotFrozen(native: { present: boolean; path?: unknown; mcpEntry?: unknown }): AssertionResult {
  const id = "config-native-not-frozen";
  if (!native.present) {
    return { id, state: "NOT-EVALUATED", detail: "config.yml declares no `providers.native` — nothing to judge" };
  }
  const frozen: string[] = [];
  if (native.path !== undefined && native.path !== null) frozen.push(`path=${JSON.stringify(native.path)}`);
  if (native.mcpEntry !== undefined && native.mcpEntry !== null) frozen.push(`mcp_entry=${JSON.stringify(native.mcpEntry)}`);
  if (frozen.length > 0) {
    return {
      id,
      state: "FAIL",
      detail: `providers.native freezes ${frozen.join(", ")} — the config would pin the project to one cache version instead of following the plugin root (gap-project-quay-pointer-is-init-plugin-root-…)`,
    };
  }
  return { id, state: "PASS", detail: "providers.native omits path/mcp_entry (Core resolves them from the plugin root)" };
}

/** The config validator must accept the config `/quay:init` just wrote. */
export function judgeConfigValidateCli(status: number | null, output: string, error: string | null): AssertionResult {
  const id = "config-validate-cli";
  if (error) return { id, state: "NOT-EVALUATED", detail: `could not run \`quay config validate\`: ${error}` };
  if (status === 0) return { id, state: "PASS", detail: "`quay config validate` accepted the init-written config" };
  return {
    id,
    state: "FAIL",
    detail: `\`quay config validate\` exited ${status}: ${firstLine(output) || "(no output)"} — the official init writes a config the official validator rejects (gap-config-validate-requires-mcp-entry-…)`,
  };
}

/** The MCP `config_validate` tool must accept the same config (a second entry point over the same
 *  judge — a broken MCP wiring would pass the CLI assertion alone). */
export function judgeMcpConfigValidate(
  outcome: { ok: boolean; issues?: unknown; error: string | null },
): AssertionResult {
  const id = "config-validate-mcp";
  if (outcome.error) return { id, state: "NOT-EVALUATED", detail: `could not complete the MCP config_validate probe: ${outcome.error}` };
  if (outcome.ok) return { id, state: "PASS", detail: "MCP `config_validate` reported ok:true" };
  const issues = Array.isArray(outcome.issues) ? outcome.issues : [];
  const named = issues
    .map((i) => (i && typeof i === "object" && "message" in i ? String((i as { message: unknown }).message) : JSON.stringify(i)))
    .slice(0, 3)
    .join(" | ");
  return { id, state: "FAIL", detail: `MCP \`config_validate\` reported ok:false (${issues.length} issue(s))${named ? `: ${named}` : ""}` };
}

/** `driver status --json` must expose the version/pointer readings at all, and must not report the
 *  project pointer as `behind` (the link pointing at an older plugin than Core). */
export function judgeDriverStatusReadings(json: unknown): AssertionResult {
  const id = "driver-status-readings";
  if (json === null || typeof json !== "object") {
    return { id, state: "NOT-EVALUATED", detail: "`driver status --json` produced no readable JSON object" };
  }
  const obj = json as Record<string, unknown>;
  const missing = ["loaded_version", "path_quay_version", "pointer"].filter((k) => obj[k] === undefined);
  if (missing.length > 0) {
    return { id, state: "FAIL", detail: `\`driver status --json\` is missing reading(s) ${missing.join(", ")} — the loaded-version/pointer surface regressed` };
  }
  const pointer = obj.pointer as { state?: unknown };
  const pointerState = typeof pointer?.state === "string" ? pointer.state : null;
  if (pointerState === null) {
    return { id, state: "FAIL", detail: "`driver status --json`.pointer has no string `state`" };
  }
  if (pointerState === "behind") {
    return { id, state: "FAIL", detail: "`driver status --json`.pointer=behind — `.quay/plugin` points at an OLDER plugin than the running Core" };
  }
  if (pointerState === "not-evaluated") {
    return { id, state: "NOT-EVALUATED", detail: `readings present, but pointer=not-evaluated (loaded_version=${String(obj.loaded_version)}, path_quay_version=${String(obj.path_quay_version)})` };
  }
  return { id, state: "PASS", detail: `readings present; pointer=${pointerState}, loaded_version=${String(obj.loaded_version)}, path_quay_version=${String(obj.path_quay_version)}` };
}

/** The serve host must run in its OWN `quay-serve-*.scope`, not the caller's session cgroup. */
export function judgeServeCgroup(cgroupText: string | null): AssertionResult {
  const id = "serve-own-scope";
  if (cgroupText === null) {
    // The CANNOT-JUDGE branch (硬规则 3b), not a real-time assertion: the carrier is absent, or the
    // pid it names is dead — either way there is no live host to read a scope from, which is exactly
    // what NOT-EVALUATED means.
    return {
      id,
      state: "NOT-EVALUATED",
      detail: "no live serve host cgroup reading (`.quay/server.json` absent, or its pid is not alive)",
    };
  }
  const tail = cgroupText.trim();
  const ownScope = /(?:^|\/)app\.slice\/quay-serve-[^/]*\.scope$/.test(tail) || /(?:^|\/)quay-serve-[^/]*\.scope$/.test(tail);
  if (!ownScope) {
    return {
      id,
      state: "FAIL",
      detail: `serve host cgroup is ${tail} — not its own quay-serve-*.scope (it will die with the caller's session scope; gap-serve-host-spawned-in-caller-session-cgroup-…)`,
    };
  }
  return { id, state: "PASS", detail: `serve host runs in its own scope (${tail})` };
}

/** `.quay/serve.log` must carry output (a host that discarded stdio leaves no diagnosis). */
export function judgeServeLog(size: number | null): AssertionResult {
  const id = "serve-log-nonempty";
  if (size === null) return { id, state: "NOT-EVALUATED", detail: "no `.quay/serve.log` in the project" };
  if (size === 0) return { id, state: "FAIL", detail: "`.quay/serve.log` exists but is empty — the serve host's stdio was discarded (gap-server-host-spawn-discards-stdio-…)" };
  return { id, state: "PASS", detail: `.quay/serve.log carries ${size} byte(s)` };
}

/** `quay server status --json` must read the running host's loaded version, and it must not be
 *  `behind` (the host is running a stale build). */
export function judgeServerStatus(json: unknown): AssertionResult {
  const id = "server-status-loaded-version";
  if (json === null || typeof json !== "object") {
    return { id, state: "NOT-EVALUATED", detail: "`quay server status --json` produced no readable JSON object" };
  }
  const obj = json as { status?: unknown; loaded_version?: unknown; pid?: unknown };
  if (obj.loaded_version === undefined) {
    return { id, state: "FAIL", detail: "`quay server status --json` has no `loaded_version` key — the serve-host version reading regressed" };
  }
  if (obj.status !== "running") {
    return { id, state: "NOT-EVALUATED", detail: `server status is ${String(obj.status)} (pid ${String(obj.pid)}) — no running host to read a loaded version from` };
  }
  if (obj.loaded_version === "behind") {
    return { id, state: "FAIL", detail: "`quay server status --json`.loaded_version=behind — the running serve host loaded an OLDER build than the installed one" };
  }
  if (obj.loaded_version === "not-evaluated") {
    return { id, state: "NOT-EVALUATED", detail: "server is running but its loaded_version could not be evaluated" };
  }
  return { id, state: "PASS", detail: `running host loaded_version=${String(obj.loaded_version)}` };
}

/** The plugin must be recorded as installed at the requested scope, from the verified directory.
 *  Record source: `~/.claude/plugins/installed_plugins.json` (the install record, a direct reading —
 *  not "the CLI claims it is installed"). */
export function judgeScopeInstall(record: unknown, installedReal: string | null): AssertionResult {
  const id = "scope-install-shape";
  if (record === null) {
    // CANNOT-JUDGE (硬规则 3b) — the record could not be read at all, so this does not assert
    // anything about a derived view being current.
    return {
      id,
      state: "NOT-EVALUATED",
      detail: "could not read the Claude plugin install record (installed_plugins.json)",
    };
  }
  if (installedReal === null) {
    return { id, state: "NOT-EVALUATED", detail: "the installed plugin directory does not resolve" };
  }
  const r = record as { scope?: unknown; entry?: { installPath?: unknown; projectPath?: unknown }; matches?: unknown };
  const n = typeof r.matches === "number" ? r.matches : 0;
  if (n === 0) {
    return { id, state: "FAIL", detail: "no install record for quay@quay at the requested scope — the install did not register where the gate says it did" };
  }
  const entry = r.entry ?? {};
  const installPath = typeof entry.installPath === "string" ? entry.installPath : null;
  const entryReal = installPath ? realpathOrNull(installPath) : null;
  if (entryReal === null) {
    return { id, state: "FAIL", detail: `the scope's install record has no resolvable installPath (${String(entry.installPath)})` };
  }
  if (entryReal !== installedReal) {
    return { id, state: "FAIL", detail: `the scope's install record points at ${entryReal}, not the verified install ${installedReal}` };
  }
  return { id, state: "PASS", detail: `install record at scope ${String(r.scope)} resolves to the verified install (${installedReal})` };
}

// ── the shipped set (tasks/gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-
//    size-ratchet, GOAL-029) ───────────────────────────────────────────────────────────────────────
//
// The release gate proved the artifact INSTALLS and RUNS. It never read WHICH FILES the artifact
// carries — and the assembly step (`publish-dist-branch.sh`'s bare `rsync -a --exclude='.git'`) was
// shipping the whole dev tree: 641 test/fixture files, 93 checker-mutation cases, and every
// dev-period baseline/exception/violation manifest (measured on 0.17.0: 1062 files / 66 MB). This
// assertion is the DIRECT reading of that quantity on the INSTALLED tree — the same rule set the
// assembly step used (`plugin/shipped-set-rules.txt`, one parser), plus the shrink-only size ratchet.
//
// ⛔ Not a self-report: the reading is a walk of `--installed` itself, never a number the artifact
// publishes about itself (硬规则 4b). The rules/baseline files are read from the SOURCE checkout this
// checker runs from (the artifact deliberately does not carry them — see the rules file's header).
export function judgeShippedSetClean(
  reading: ShippedSetReading,
  baseline: ShippedSetBaseline | null,
  artifactRoot: string,
): AssertionResult {
  const id = "shipped-set-clean";
  if (!reading.evaluated) {
    return { id, state: "NOT-EVALUATED", detail: reading.reason ?? "the installed tree could not be read against the shipped-set rules" };
  }
  if (reading.violations.length > 0) {
    const named = reading.violations.slice(0, 5).map((v) => `${v.path}${v.isDir ? "/" : ""} (rule ${v.rule})`).join(", ");
    return {
      id,
      state: "FAIL",
      detail: `${reading.violations.length} rule-excluded path(s) PRESENT in the installed artifact: ${named}${reading.violations.length > 5 ? ", …" : ""} — the assembly step shipped dev-only content (plugin/scripts/publish-dist-branch.sh + plugin/shipped-set-rules.txt)`,
    };
  }
  if (baseline === null) {
    return { id, state: "NOT-EVALUATED", detail: "no shipped-set baseline at plugin/shipped-set-baseline.json — the ratchet cannot be judged" };
  }
  const measured = measuredOf(reading); // the ratchet's axes: rule-excluded content present
  const verdict = judgeRatchet(measured, baseline, baseline, null);
  if (verdict.over.length > 0) {
    return { id, state: "FAIL", detail: `the installed artifact carries more dev-only content than the baseline allows — ${overBaselineMessage(measured, baseline, artifactRoot)}` };
  }
  // ② the SIZE ceiling: the artifact's own totals against the recorded clean reading. ⛔ This half
  // belongs HERE (release cadence, a human in the loop) and NOT in the per-run ratchet: those totals
  // move with every regenerated bundle, and measured churn on develop is ~1 build-input commit/hour,
  // so gating them per commit would be re-anchored blindly until it meant nothing (硬规则 4).
  if (baseline.shipped) {
    const size = judgeShippedSize(shippedOf(reading), baseline.shipped);
    if (!size.ok) {
      return { id, state: "FAIL", detail: `the installed artifact is larger than the recorded clean build — ${overSizeMessage(size, artifactRoot)}` };
    }
  }
  if (reading.unreadable.length > 0) {
    return {
      id,
      state: "NOT-EVALUATED",
      detail: `${reading.unreadable.length} path(s) of the installed tree could not be read (${reading.unreadable.slice(0, 3).join("; ")}) — the reading is partial`,
    };
  }
  const shipped = shippedOf(reading);
  return {
    id,
    state: "PASS",
    detail:
      `no rule-excluded content among ${reading.rulesInForce} rule(s); artifact ${shipped.files} files / ${shipped.bytes} bytes / ${shipped.shLines} .sh lines` +
      (baseline.shipped ? ` ≤ recorded ${baseline.shipped.files} / ${baseline.shipped.bytes} / ${baseline.shipped.shLines}` : " (no recorded size ceiling)"),
  };
}

// ── the reachable shell set (tasks/gap-shipped-shell-limited-to-runtime-reachable-set-and-delivery-
//    verify-tools-leave-the-artifact, GOAL-029) ────────────────────────────────────────────────────
//
// `shipped-set-clean` above judges what the artifact must NOT carry by KIND. It cannot see the other
// half of the narrowing: a `.sh` that is neither test nor fixture nor baseline, yet that no runtime
// surface reaches — a delivery tool for a cancelled channel, or a retired classic-pipeline gate. The
// 0.17.0 artifact carried 90 such non-test `.sh` (28,642 lines). This assertion is the DIRECT reading
// of that quantity on the INSTALLED tree, judged against the set `shipped-shell-reachability.ts`
// derives from the SOURCE checkout's roots.
//
// ⛔ Not a self-report (硬规则 4b): the artifact side is a walk of `installedDir` itself. The SOURCE
// side is derived here, from the checkout this checker runs from — never read out of the artifact.
export function judgeShippedShellReachable(installedDir: string, reading: ReachabilityReading): AssertionResult {
  const v = judgeShellReachability(installedDir, reading);
  return { id: v.id, state: v.state, detail: v.detail };
}

/** The effect the judge above needs: derive the source checkout's reachable `.sh` set. */
export function readSourceShellReachability(): ReachabilityReading {
  return deriveReachability(defaultRepoRoot());
}

/** The effect the judge above needs: walk the INSTALLED tree against the source checkout's rules. */
export function readInstalledShippedSet(installedDir: string): { reading: ShippedSetReading; baseline: ShippedSetBaseline | null } {
  const loaded = readRulesFromFile(rulesFileAbs());
  if (loaded === null) {
    return {
      reading: {
        evaluated: false,
        reason: `the shipped-set rule file is unreadable (${rulesFileAbs()})`,
        totals: { files: 0, bytes: 0, shLines: 0 },
        forbidden: { files: 0, bytes: 0, shLines: 0 },
        violations: [],
        unreadable: [],
        rulesInForce: 0,
      },
      baseline: null,
    };
  }
  return { reading: readShippedSet(installedDir, loaded.rules), baseline: readBaselineFile(baselineFileAbs()) };
}

// ── the install-record reader (the one effect judgeScopeInstall needs) ───────────────────────────

/** Read `~/.claude/plugins/installed_plugins.json` and pick the entry matching `scope` (and, for
 *  project/local scope, `projectDir`). Returns null when the record file is unreadable. */
export function readScopeInstallRecord(
  homeDir: string,
  scope: string,
  projectDir: string,
): unknown | null {
  const recordPath = path.join(homeDir, ".claude", "plugins", "installed_plugins.json");
  const raw = readText(recordPath);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const plugins = (parsed as { plugins?: Record<string, unknown> } | null)?.plugins;
  if (!plugins || typeof plugins !== "object") return { scope, matches: 0 };
  const entries = (plugins as Record<string, unknown>)["quay@quay"];
  if (!Array.isArray(entries)) return { scope, matches: 0 };
  const projectReal = realpathOrNull(projectDir);
  const candidates = entries.filter((e) => {
    if (!e || typeof e !== "object") return false;
    const o = e as Record<string, unknown>;
    if (o.scope !== scope) return false;
    if (scope === "user") return true;
    const pp = typeof o.projectPath === "string" ? realpathOrNull(o.projectPath) : null;
    return pp !== null && projectReal !== null && pp === projectReal;
  });
  return { scope, matches: candidates.length, entry: candidates[candidates.length - 1] };
}

// ── MCP config_validate probe (JSON-RPC over the installed CLI's stdio) ───────────────────────────

/** Spawn `<installed>/bin/quay mcp`, run one `config_validate` and return its verdict. The three
 *  JSON-RPC frames are pipelined in one write; the server processes them in order, so no interactive
 *  staging is needed. Times out (never hangs the gate) and always kills the child. */
export async function probeMcpConfigValidate(
  installedDir: string,
  projectDir: string,
  timeoutMs = 45_000,
): Promise<{ ok: boolean; issues?: unknown; error: string | null }> {
  const bin = path.join(installedDir, "bin", "quay");
  if (!fs.existsSync(bin)) return { ok: false, error: `no CLI shim at ${bin}` };

  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ["mcp"], { cwd: projectDir, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      resolve({ ok: false, error: `spawn failed: ${String((err as Error)?.message ?? err)}` });
      return;
    }
    let out = "";
    let err = "";
    let settled = false;
    const finish = (r: { ok: boolean; issues?: unknown; error: string | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `timed out after ${timeoutMs}ms` }), timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      // Responses are newline-delimited JSON. Look for the id:2 (tools/call) answer.
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes("\"id\":2") && !line.includes("\"id\": 2")) continue;
        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const m = msg as { result?: { isError?: unknown; structuredContent?: unknown; content?: unknown }; error?: unknown };
        if (m.error !== undefined) {
          finish({ ok: false, error: `JSON-RPC error: ${JSON.stringify(m.error)}` });
          return;
        }
        const sc = m.result?.structuredContent as { ok?: unknown; issues?: unknown } | undefined;
        if (sc && typeof sc === "object" && typeof sc.ok === "boolean") {
          finish({ ok: sc.ok, issues: sc.issues, error: null });
          return;
        }
        // Fall back to parsing the text content block.
        const content = Array.isArray(m.result?.content) ? (m.result?.content as Array<{ text?: unknown }>) : [];
        const text = content.map((c) => (typeof c.text === "string" ? c.text : "")).join("");
        try {
          const parsed = JSON.parse(text) as { ok?: unknown; issues?: unknown };
          if (typeof parsed.ok === "boolean") {
            finish({ ok: parsed.ok, issues: parsed.issues, error: null });
            return;
          }
        } catch {
          /* not JSON text */
        }
        finish({ ok: false, error: "config_validate returned no {ok} payload" });
        return;
      }
    });
    child.stderr?.on("data", (d: Buffer) => {
      err += d.toString("utf8");
    });
    // A fast-exiting server can close the read end before our write lands; an unhandled EPIPE here
    // would crash the checker (not merely fail the probe). Swallow it — the `exit` handler below
    // turns it into an honest NOT-EVALUATED reason.
    child.stdin?.on("error", () => {
      /* the exit/close handler reports the real reason */
    });
    child.on("error", (e) => finish({ ok: false, error: `child error: ${String(e?.message ?? e)}` }));
    // `close` (not `exit`): it fires only after stdout/stderr are drained, so a stub that prints and
    // exits immediately still has its answer parsed before this reports "exited before answering".
    child.on("close", (code) => {
      if (!settled) finish({ ok: false, error: `mcp server exited (code ${code}) before answering${err ? `: ${firstLine(err)}` : ""}` });
    });

    const frames = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "verify-plugin-channel-assertions", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "config_validate", arguments: {} } },
    ];
    try {
      child.stdin?.write(frames.map((f) => JSON.stringify(f)).join("\n") + "\n");
    } catch (e) {
      finish({ ok: false, error: `stdin write failed: ${String((e as Error)?.message ?? e)}` });
    }
  });
}

// ── serve readings ───────────────────────────────────────────────────────────────────────────────

/** Read `/proc/<server.json pid>/cgroup` (or `<procRoot>/…`, the test seam). null when there is no
 *  live host. */
export function readServeCgroup(projectDir: string, procRoot: string): string | null {
  const raw = readText(path.join(projectDir, ".quay", "server.json"));
  if (raw === null) return null;
  let pid: unknown;
  try {
    pid = (JSON.parse(raw) as { pid?: unknown })?.pid;
  } catch {
    return null;
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  const cgroup = readText(path.join(procRoot, String(pid), "cgroup"));
  return cgroup;
}

// ── report / exit ────────────────────────────────────────────────────────────────────────────────

export function summarize(results: AssertionResult[]): { passed: number; failed: number; notEvaluated: number } {
  let passed = 0;
  let failed = 0;
  let notEvaluated = 0;
  for (const r of results) {
    if (r.state === "PASS") passed++;
    else if (r.state === "FAIL") failed++;
    else notEvaluated++;
  }
  return { passed, failed, notEvaluated };
}

export function exitCodeFor(results: AssertionResult[]): number {
  const s = summarize(results);
  if (s.failed > 0) return EXIT_FAIL;
  if (s.notEvaluated > 0) return EXIT_NOT_EVALUATED;
  return EXIT_ALL_PASS;
}

export function formatReport(results: AssertionResult[]): string {
  const lines = results.map((r) => `${r.id} ${r.state} — ${r.detail}`);
  const s = summarize(results);
  lines.push(`passed=${s.passed} failed=${s.failed} not-evaluated=${s.notEvaluated}`);
  return lines.join("\n");
}

// ── the runner ───────────────────────────────────────────────────────────────────────────────────

export interface RunnerOptions {
  installedDir: string;
  projectDir: string;
  scope: string;
  /** Test seam: where to read `/proc/<pid>/cgroup` from. Default `/proc`. */
  procRoot?: string;
  /** Test seam: HOME for the install-record lookup. Default `process.env.HOME`. */
  homeDir?: string;
  upgradeFrom?: string;
  onAssertion?: (r: AssertionResult) => void;
}

/** Run every assertion. Effects only; judgement lives in the `judge*` functions above. */
export async function runAssertions(opts: RunnerOptions): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  const push = (r: AssertionResult) => {
    results.push(r);
    opts.onAssertion?.(r);
  };
  const installedReal = realpathOrNull(opts.installedDir);
  const projectDir = opts.projectDir;
  const procRoot = opts.procRoot ?? "/proc";
  const homeDir = opts.homeDir ?? process.env.HOME ?? "";

  if (opts.upgradeFrom) {
    // ── upgrade drill (local mode): link→old ⇒ run init ⇒ link→new ⇒ validate ────────────────
    const oldReal = realpathOrNull(opts.upgradeFrom);
    const linkBefore = realpathOrNull(path.join(projectDir, ".quay", "plugin"));
    push(
      linkBefore !== null && oldReal !== null && linkBefore === oldReal
        ? { id: "upgrade-link-before", state: "PASS", detail: `.quay/plugin points at the previous plugin tree (${oldReal})` }
        : {
            id: "upgrade-link-before",
            state: linkBefore === null ? "NOT-EVALUATED" : "FAIL",
            detail: `expected .quay/plugin → ${String(oldReal)}, observed ${String(linkBefore)} (the drill must start from a project pointed at the previous tree)`,
          },
    );

    const initOk = runUpgradeInit(opts.installedDir, projectDir);
    if (initOk.error) {
      push({ id: "upgrade-link-after", state: "NOT-EVALUATED", detail: `the re-init could not be run: ${initOk.error}` });
      push({ id: "upgrade-validate-after", state: "NOT-EVALUATED", detail: "skipped — the re-init could not be run" });
      return results;
    }

    const linkAfter = realpathOrNull(path.join(projectDir, ".quay", "plugin"));
    push(
      linkAfter !== null && installedReal !== null && linkAfter === installedReal
        ? { id: "upgrade-link-after", state: "PASS", detail: `.quay/plugin now points at the new plugin tree (${installedReal})` }
        : { id: "upgrade-link-after", state: "FAIL", detail: `after init, .quay/plugin → ${String(linkAfter)}, expected ${String(installedReal)} — /quay:init did not re-point the link` },
    );

    const v = runInstalledCli(opts.installedDir, ["config", "validate", "--root", projectDir], projectDir);
    const output = `${v.stdout}\n${v.stderr}`;
    push(judgeConfigValidateCli(v.error ? null : v.status, output, v.error));
    // Re-label the validate assertion so the upgrade sequence reads as its own family.
    const last = results[results.length - 1];
    last.id = "upgrade-validate-after";
    return results;
  }

  // 1. config validate (CLI) — the config `/quay:init` wrote must be accepted.
  const validate = runInstalledCli(opts.installedDir, ["config", "validate", "--root", projectDir], projectDir);
  push(judgeConfigValidateCli(validate.error ? null : validate.status, `${validate.stdout}\n${validate.stderr}`, validate.error));

  // 2. config validate (MCP) — the same judge over the second entry point.
  const mcp = await probeMcpConfigValidate(opts.installedDir, projectDir);
  push(judgeMcpConfigValidate(mcp));

  // 3. version carriers agree, no -dev.
  push(judgeVersionConsistency(readInstalledVersions(opts.installedDir)));

  // 4. the shipped set: no dev-only content, and within the shrink-only size ratchet.
  const shipped = readInstalledShippedSet(opts.installedDir);
  push(judgeShippedSetClean(shipped.reading, shipped.baseline, opts.installedDir));

  // 4b. the reachable shell set: every `.sh` the artifact carries is one the runtime can reach.
  push(judgeShippedShellReachable(opts.installedDir, readSourceShellReachability()));

  // 5. `.quay/plugin` → the verified install.
  push(judgePointer(realpathOrNull(path.join(projectDir, ".quay", "plugin")), installedReal));

  // 6. native provider not frozen in the project config.
  push(readAndJudgeNativeConfig(projectDir));

  // 7. driver status readings.
  const ds = runInstalledCli(opts.installedDir, ["driver", "status", "--kind", "promotion", "--json", "--root", projectDir], projectDir);
  push(judgeDriverStatusReadings(parseJsonOrNull(ds.error ? "" : ds.stdout)));

  // 8-9. serve host: own scope + non-empty log.
  push(judgeServeCgroup(readServeCgroup(projectDir, procRoot)));
  push(judgeServeLog(readSizeOrNull(path.join(projectDir, ".quay", "serve.log"))));

  // 10. server status loaded version.
  const ss = runInstalledCli(opts.installedDir, ["server", "status", "--json", "--root", projectDir], projectDir);
  push(judgeServerStatus(parseJsonOrNull(ss.error ? "" : ss.stdout)));

  // 11. install record at the requested scope.
  push(judgeScopeInstall(readScopeInstallRecord(homeDir, opts.scope, projectDir), installedReal));

  return results;
}

export function parseJsonOrNull(text: string): unknown | null {
  const t = String(text).trim();
  if (t === "") return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function readSizeOrNull(p: string): number | null {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

/** Parse the project config and judge the native provider's frozen-path shape. */
export function readAndJudgeNativeConfig(projectDir: string): AssertionResult {
  const raw = readText(path.join(projectDir, ".quay", "config.yml"));
  if (raw === null) {
    return { id: "config-native-not-frozen", state: "NOT-EVALUATED", detail: "no `.quay/config.yml` in the project" };
  }
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    return { id: "config-native-not-frozen", state: "NOT-EVALUATED", detail: `config.yml did not parse: ${String((e as Error)?.message ?? e)}` };
  }
  const native = ((doc as { providers?: Record<string, unknown> } | null)?.providers ?? {})["native"] as
    | Record<string, unknown>
    | undefined;
  if (!native || typeof native !== "object") {
    return judgeNativeNotFrozen({ present: false });
  }
  return judgeNativeNotFrozen({ present: true, path: native.path, mcpEntry: native.mcp_entry });
}

/** Run `/quay:init` from the installed tree against the project (the upgrade drill's middle step).
 *  The command is overridable via `QUAY_VERIFY_INIT_CMD` so fixture tests can drive the sequence
 *  without a full real init; the real default is what the local replay and CI use. */
export function runUpgradeInit(installedDir: string, projectDir: string): { error: string | null } {
  // ⛔ RE-POINTED (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch): this drill
  // drives the shipped UPGRADE ENTRY, and that is the CLI entry point now — `scripts/quay-init.sh` is
  // a ≤40-line shim over it. Running the CLI directly is what makes the drill exercise the engine
  // rather than a front for it; a shim that silently stopped forwarding would otherwise let this
  // gate pass while the real path was broken.
  const initEntry = path.join(installedDir, "bin", "quay");
  if (!fs.existsSync(initEntry)) return { error: `no bin/quay in ${installedDir}` };
  const override = process.env.QUAY_VERIFY_INIT_CMD;
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: installedDir,
    QUAY_VERIFY_INSTALLED: installedDir,
    QUAY_VERIFY_PROJECT: projectDir,
  };
  const r = override
    ? spawnSync("sh", ["-c", override], { cwd: projectDir, env, encoding: "utf8", timeout: 300_000 })
    : spawnSync(
        initEntry,
        ["init", "--root", projectDir, "--project", path.basename(projectDir), "--plugin-root", installedDir],
        { cwd: projectDir, env, encoding: "utf8", timeout: 300_000 },
      );
  if (r.error) return { error: String((r.error as Error).message ?? r.error) };
  if (r.status !== 0) return { error: `quay init exited ${r.status}: ${firstLine(r.stderr ?? "") || firstLine(r.stdout ?? "")}` };
  return { error: null };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

function usage(): string {
  return [
    "Usage: verify-plugin-channel-assertions.ts --installed <dir> --project <dir> [--scope user|project|local] [--json]",
    "       verify-plugin-channel-assertions.ts --installed <dir> --project <dir> --upgrade-from <previous-plugin-tree> [--json]",
    "",
    "Asserts a Claude Code plugin-channel install is CORRECT — not merely installable: the config the",
    "init wrote validates (CLI + MCP), the version carriers agree and carry no -dev, the shipped set",
    "carries no dev-only content and is within its shrink-only size ratchet, the project",
    "pointer/config are not frozen to a cache version, the driver/server version readings exist, and",
    "the serve host runs in its own systemd scope.",
    "",
    "Each assertion prints `<id> <PASS|FAIL|NOT-EVALUATED> — <detail>`; the last line is",
    "`passed=<n> failed=<n> not-evaluated=<n>`.",
    "",
    "exit 0 = every assertion PASSED / 1 = at least one FAIL /",
    "3 = no FAIL but at least one NOT-EVALUATED / 2 = usage error.",
    "",
    "Environment seams (tests only): QUAY_VERIFY_PROC_ROOT, QUAY_VERIFY_HOME, QUAY_VERIFY_INIT_CMD.",
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    process.stderr.write(usage() + "\n");
    return EXIT_USAGE;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage() + "\n");
    return EXIT_ALL_PASS;
  }

  const installedDir = flagValue(argv, "--installed");
  const projectDir = flagValue(argv, "--project");
  const scope = flagValue(argv, "--scope") ?? "project";
  const upgradeFrom = flagValue(argv, "--upgrade-from");
  const json = argv.includes("--json");

  if (!installedDir || !projectDir) {
    process.stderr.write(`ERROR: --installed and --project are both required.\n${usage()}\n`);
    return EXIT_USAGE;
  }
  if (!VALID_SCOPES.includes(scope)) {
    process.stderr.write(`ERROR: --scope must be one of ${VALID_SCOPES.join("|")} (got ${scope}).\n`);
    return EXIT_USAGE;
  }

  const results = await runAssertions({
    installedDir: path.resolve(installedDir),
    projectDir: path.resolve(projectDir),
    scope,
    procRoot: process.env.QUAY_VERIFY_PROC_ROOT,
    homeDir: process.env.QUAY_VERIFY_HOME,
    upgradeFrom: upgradeFrom ? path.resolve(upgradeFrom) : undefined,
  });

  if (json) {
    const s = summarize(results);
    process.stdout.write(
      JSON.stringify({ installed: path.resolve(installedDir), project: path.resolve(projectDir), scope, assertions: results, passed: s.passed, failed: s.failed, notEvaluated: s.notEvaluated }, null, 2) + "\n",
    );
  } else {
    process.stdout.write(formatReport(results) + "\n");
  }
  return exitCodeFor(results);
}

if (isDirectEntry(import.meta, process.argv[1], "verify-plugin-channel-assertions")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`verify-plugin-channel-assertions: fatal ${String((err as Error)?.stack ?? err)}\n`);
      process.exit(EXIT_NOT_EVALUATED);
    },
  );
}
