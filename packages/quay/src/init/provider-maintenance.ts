// packages/quay/src/init/provider-maintenance.ts — the provider phase: the enabled-provider TEXT flip, the project-internal plugin link, the stale MCP-entry migration, loop-scripts derivation, and the provider entry-file reading
//
// Extracted VERBATIM from packages/quay/src/init.ts (2026-10-29,
// gap-routine-architecture-analysis-core-src-flat-root-god-modules) as one PHASE of that god-module's
// split. `init.ts` re-exports every public symbol declared here, so all existing
// `from "./init.ts"` imports keep resolving; nothing in this file is a second implementation.
//
// Dependency direction is ONE-WAY (init.ts → delivery-surface → provider-maintenance → carrier-env):
// a phase module may import the ones BELOW it in that list and never `../init.ts` itself — importing
// the barrel back would close a cycle.


import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { resolveProviderEntry, NATIVE_PROVIDER_UNRESOLVABLE } from "../core/config.ts";
import { blockEnd, findChild } from "./carrier-env.ts";

// ── `quay provider switch <name>` — the TEXT half of the enabled-provider flip ─────────────────────
// (gap-provider-switch-no-dedicated-entry-point). Before this, the ONLY writer of a provider's
// `enabled:` was `generateConfigContent` — a FRESH workspace. Switching an existing project from
// native to github (or back) meant hand-editing `.quay/config.yml` with no validation before or
// after, which is the缺口 this closes.
//
// Same discipline as `ensureProviderCarrierEnvText`: a LINE-LEVEL edit, never a YAML round-trip — a
// round-trip reformats every other key and drops the comments that tell the operator which providers
// exist and what each one needs. Only the `enabled:` lines that actually CHANGE are rewritten, so a
// switch that is a no-op produces a byte-identical string (the caller writes nothing).

/** Why the flip could not be expressed. An INDEPENDENT state, never conflated with "nothing to do". */
export type SwitchProviderNote = null | "no-providers" | "inline-providers" | "no-target";

export interface SwitchEnabledProviderResult {
  /** The candidate text (byte-identical to the input when `changed` and `added` are both empty). */
  text: string;
  /** The `enabled:` rewrites actually applied, in file order. */
  changed: Array<{ provider: string; from: string; to: "true" | "false" }>;
  /** Providers that carried no `enabled:` key and gained one (only ever the target). */
  added: string[];
  note: SwitchProviderNote;
}

/**
 * Make `target` the enabled provider in a `.quay/config.yml` TEXT: `enabled: true` on the target's
 * entry, `enabled: false` on every other entry that currently says otherwise.
 *
 * A provider entry with NO `enabled:` key is already disabled (the runtime reads `enabled === true`,
 * `activeProvider` in config.ts) — so it is left alone rather than being spelled out: an absent key
 * and an explicit `false` mean the same thing, and rewriting the absent one would put a line the
 * user never wrote into their file.
 */
export function switchEnabledProviderText(text: string, target: string): SwitchEnabledProviderResult {
  const lines = text.split("\n");
  const noop = (note: SwitchProviderNote): SwitchEnabledProviderResult => ({ text, changed: [], added: [], note });

  const prov = findChild(lines, 0, lines.length, "providers", 0);
  if (!prov) return noop("no-providers");
  // `providers: {native: {...}}` (a flow mapping) has no per-provider LINE to rewrite. Refusing is
  // the honest answer (硬规则 3b) — the alternative is a full re-serialization of the user's file.
  const provRest = lines[prov[0]]!.slice(lines[prov[0]]!.indexOf(":") + 1).trim();
  if (provRest !== "" && !provRest.startsWith("#")) return noop("inline-providers");

  // The provider entries are the block's DIRECT children — the smallest indent of a `key:` line
  // inside it. Deriving it (rather than assuming two spaces) keeps this edit working on a config
  // indented any other way.
  const provEnd = blockEnd(lines, prov[0], prov[1]);
  let childInd: number | null = null;
  for (let i = prov[0] + 1; i < provEnd; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^(\s*)[A-Za-z0-9_-]+\s*:/.exec(line);
    if (!m) continue;
    const ind = m[1]!.length;
    if (ind > prov[1] && (childInd === null || ind < childInd)) childInd = ind;
  }
  if (childInd === null) return noop("no-target");

  // Collect the entries FIRST (with their block extents), then apply the edits back-to-front: an
  // insert shifts every later index, and rewriting in reverse keeps every earlier index valid.
  const entries: Array<{ pid: string; start: number; end: number }> = [];
  for (let i = prov[0] + 1; i < provEnd; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^(\s*)([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (!m || m[1]!.length !== childInd) continue;
    entries.push({ pid: m[2]!, start: i, end: blockEnd(lines, i, childInd) });
  }
  if (!entries.some((e) => e.pid === target)) return noop("no-target");

  const out = [...lines];
  const changed: SwitchEnabledProviderResult["changed"] = [];
  const added: string[] = [];

  for (let n = entries.length - 1; n >= 0; n--) {
    const { pid, start, end } = entries[n]!;
    const want: "true" | "false" = pid === target ? "true" : "false";
    const at = findChild(out, start + 1, Math.min(end, out.length), "enabled", childInd + 1);
    if (!at) {
      if (pid !== target) continue; // no `enabled:` key ⇒ already disabled (see the doc comment above)
      out.splice(start + 1, 0, `${" ".repeat(childInd + 2)}enabled: ${want}`);
      added.push(pid);
      continue;
    }
    const [lineIdx, lineInd] = at;
    const rawValue = out[lineIdx]!.slice(out[lineIdx]!.indexOf(":") + 1);
    const hash = rawValue.indexOf("#");
    const valuePart = hash >= 0 ? rawValue.slice(0, hash) : rawValue;
    const current = valuePart.trim();
    if (current === want) continue;
    // The trailing comment AND the whitespace run before it are PRESERVED — on a real config that
    // comment is the sentence explaining why this provider is (or is not) the default, and the run
    // is what aligns it with the neighbouring lines. Dropping either would silently rewrite
    // documentation the edit was never asked to touch (and would make a switch-and-switch-back
    // non-byte-identical, which is the property the round-trip test pins).
    const pad = valuePart.slice(valuePart.trimEnd().length);
    out[lineIdx] = `${" ".repeat(lineInd)}enabled: ${want}${pad}${hash >= 0 ? rawValue.slice(hash) : ""}`;
    changed.push({ provider: pid, from: current, to: want });
  }

  changed.reverse(); // the edits were applied back-to-front; report them in FILE order
  return { text: out.join("\n"), changed, added, note: null };
}

// ── project-internal plugin link (gap-config-provider-path-frozen-to-versioned-cache-dir; the
//    SELECTION RULE rewritten by gap-project-quay-pointer-is-init-plugin-root-and-version-records-
//    derive-from-it) ────────────────────────────────────────────────────────────────────────────────
//
// DEFECT (first half). `/quay:init` wrote the provider binding as `<installPath>/vendor/quay-native`,
// where `installPath` is the plugin MARKETPLACE cache dir — a path that CONTAINS the installed version
// (`~/.claude/plugins/cache/quay/quay/0.14.0/`). Upgrading the plugin left the config untouched, so
// Core kept launching the OLD provider bundle forever.
//
// DEFECT (second half, this task). The replacement — an INTERNAL link `<project>/.quay/plugin ->
// <that project's registry-resolved installPath>` — gave the link a SECOND resolver. The session layer
// decides which plugin version a session actually loads; the registry tier rule (`projectPath`-matching
// local/project entry wins, else the `user` entry) is a DIFFERENT rule, so the two necessarily diverge.
// Measured 2026-10-06: claudecodeui's project record stayed at 0.14.0 while the user entry moved to
// 0.15.0, and every session started after 07:14:55 loaded 0.15.0 — the link, if re-pointed from the
// registry, would have named a version no session was running.
//
// RULING (human, 2026-10-06): the link target is the plugin root THIS init run executes from
// (`${CLAUDE_PLUGIN_ROOT}` / `--plugin-root`) — ⛔ never a registry lookup. There is exactly ONE
// binding producer (this link), one guidance consumer (a Core-absent consumer such as a CloudCLI
// server `execFile`, cwd = the project root), and the drift between them is REPORTED by `driver
// status`'s `pointer` reading — never auto-corrected (several plugin versions can be live in one
// project at once, so a runtime refresh would clobber whichever wrote last).
//
// ⛔ Core NEVER writes this link from any runtime path (driver start / serve / MCP). Only `/quay:init`
// writes it.
//
// RULING (human, 2026-10-25) — the link is RETIRED. The 2026-10-06 ruling still bound the link to
// "the plugin root the last init ran from", which is a SECOND version resolver beside the session
// layer's plugin-scope rule; the two necessarily diverge (measured 2026-10-06: the link sat at
// 0.14.0 while every session loaded 0.15.0). So `quay init` no longer CREATES `<ws>/.quay/plugin`:
//
//   · a SYMLINK left by an older init is DELETED (`retired`);
//   · nothing at the path ⇒ `absent`;
//   · a REGULAR FILE or DIRECTORY there is the user's content — the closed set does not own that
//     name, so it is REFUSED and left byte-identical (`refused`);
//   · `--dry-run` reports what it WOULD do and writes nothing (`would-retire`).
//
// External consumers (no Core in the loop) locate the CLI through the Claude Code plugin-scope
// contract instead — `docs/references/external-consumer-cli-location.md`. ⛔ Nothing in Core reads
// this path, so deleting it moves no binding.

export type ProjectPluginLinkReading =
  /** A symlink was deleted by THIS run. */
  | { state: "retired"; path: string; target: string | null }
  /** A `--dry-run` found a symlink and wrote nothing. */
  | { state: "would-retire"; path: string; target: string | null }
  /** Nothing exists at the path. */
  | { state: "absent"; path: string }
  /** Something that is NOT a symlink is at the path — the user's content, left untouched. */
  | { state: "refused"; path: string; reason: string }
  /** A symlink is at the path but the unlink failed — it is still there. */
  | { state: "delete-failed"; path: string; reason: string }
  /** The path could not be inspected at all — ⛔ not `absent` (missing ≠ unreadable). */
  | { state: "unreadable"; path: string; reason: string };

/** Version of a plugin ROOT (its `.claude-plugin/plugin.json` `version`). null = unreadable.
 *  ⛔ NEVER `quay --version` output — the shipped bundle embeds the dev version, so that reading is a
 *  different quantity (gap-release-bundle-embeds-dev-version-after-stamp). */
export function readPluginRootVersion(pluginRoot: string | null): string | null {
  if (!pluginRoot) return null;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"))?.version;
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

export interface ProjectPluginLinkOpts {
  wsRoot: string;
  dryRun: boolean;
  /**
   * Where the human-facing lines go (default `console.log`). ⛔ `quay init --json` must put ONE
   * parseable JSON document on stdout, so its caller passes a sink that writes to stderr — otherwise
   * this step's reporting would corrupt the machine-readable output it promises.
   */
  log?: (line: string) => void;
}

/**
 * Retire `<ws>/.quay/plugin` — the guidance link `/quay:init` used to create (human ruling
 * 2026-10-25). ⛔ This function can only DELETE a symlink; there is no create branch, by design.
 * Idempotent: `retired` the first time, `absent` on every later run.
 *
 * A real (non-symlink) file/dir at the path is REFUSED, never clobbered — the closed set does not own
 * arbitrary user content at that name — and the reason names the path. `--dry-run` reports
 * `would-retire` and writes nothing.
 */
export function retireProjectPluginLink(o: ProjectPluginLinkOpts): ProjectPluginLinkReading {
  const log = o.log ?? ((line: string) => console.log(line));
  const linkPath = path.join(o.wsRoot, ".quay", "plugin");

  let existing: fs.Stats | null = null;
  try {
    existing = fs.lstatSync(linkPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ENOENT (nothing there) and ENOTDIR (`.quay` is not a directory) both mean "no entry at this
    // path". ⛔ Every other code means we could not LOOK — a different reading (硬规则 3b).
    if (code === "ENOENT" || code === "ENOTDIR") {
      log("  project-plugin-link: absent — no .quay/plugin entry (init no longer creates it)");
      return { state: "absent", path: linkPath };
    }
    const reason = `${linkPath} could not be inspected (${err instanceof Error ? err.message : String(err)})`;
    log(`  project-plugin-link: UNREADABLE — ${reason} (nothing was changed)`);
    return { state: "unreadable", path: linkPath, reason };
  }

  if (!existing.isSymbolicLink()) {
    const kind = existing.isDirectory() ? "directory" : "regular file";
    const reason = `${linkPath} exists and is not a symlink (${kind})`;
    log(`  project-plugin-link: REFUSED — ${reason}; left byte-identical (the closed set does not own it)`);
    return { state: "refused", path: linkPath, reason };
  }

  let target: string | null = null;
  try { target = fs.readlinkSync(linkPath); } catch { target = null; }

  if (o.dryRun) {
    log(`  would-retire: .quay/plugin -> ${target ?? "<unreadable target>"} (a dry run writes nothing)`);
    return { state: "would-retire", path: linkPath, target };
  }

  try {
    fs.unlinkSync(linkPath);
  } catch (err: unknown) {
    const reason = `${linkPath} could not be deleted (${err instanceof Error ? err.message : String(err)})`;
    log(`  project-plugin-link: DELETE-FAILED — ${reason}; the link is still there`);
    return { state: "delete-failed", path: linkPath, reason };
  }
  log(`  retired: .quay/plugin (was -> ${target ?? "<unreadable target>"}; init no longer creates it)`);
  return { state: "retired", path: linkPath, target };
}

export interface MigrateMcpEntryOpts {
  cfgPath: string;
  installProvider: string;
  installRuntime: string;
  installCore: string;
  wsRoot: string;
  dryRun: boolean;
  backupTs: string;
  /**
   * Where the human-facing report lines go (default `console.log`). ⛔ The CLI's `--json` mode MUST
   * pass a stderr sink: stdout carries exactly ONE JSON document, and these lines would otherwise
   * splice themselves into it.
   */
  log?: (line: string) => void;
}

/**
 * `migrate_stale_mcp_entry` — the UPGRADE-CHANNEL migration for the RETIRED project-local runtime.
 *
 * Ruling (AC1 of gap-dist-runtime-not-self-contained-reads-external-package-json; UPDATED by
 * gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it, and by the
 * 2026-10-25 link retirement): the provider binding no longer names a provider DIRECTORY at all —
 * `<ws>/.quay/plugin` is not created any more, so `path`/`mcp_entry` are simply DELETED here. Core
 * resolves the native provider from its own plugin root (`plugin-root.ts`; the default is
 * `<plugin-root>/vendor/quay-native`). A versioned install-cache path (which still EXISTS on disk) is
 * now ALSO a migration trigger. The now-unreferenced project-local copy is retired to a backup ONLY
 * when it is unreferenced, recognizably quay's own install-generated runtime, and STALE; a
 * byte-current copy is left byte-identical (AC3), and a directory we cannot recognize is NEVER
 * touched (硬规则 3b: "could not evaluate" must not share an output with "evaluated, fine").
 *
 * SCOPE GUARD: an arbitrary dangling path (e.g. `./nonexistent/runtime.js`) is left untouched so the
 * vendor-runtime negative control keeps its meaning.
 */
export function migrateStaleMcpEntry(o: MigrateMcpEntryOpts): void {
  const say = o.log ?? ((line: string) => console.log(line));
  if (!fs.existsSync(o.cfgPath)) return;
  const data = (YAML.parse(fs.readFileSync(o.cfgPath, "utf8")) ?? {}) as Record<string, unknown>;
  const providers = data["providers"];
  const prov = (typeof providers === "object" && providers !== null ? (providers as Record<string, unknown>)["native"] : undefined) as
    | Record<string, unknown>
    | undefined;
  if (typeof prov !== "object" || prov === null || Array.isArray(prov)) return;

  const sha = (p: string): string | null => {
    try {
      return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    } catch {
      return null;
    }
  };
  const under = (p: string, base: string): boolean => {
    const abs = path.resolve(p);
    return abs === base || abs.startsWith(base + path.sep);
  };

  const rtDir = path.join(o.wsRoot, ".quay", "runtime");
  const inRetiredRuntime = (p: unknown): boolean => {
    const s = String(p);
    const cands = path.isAbsolute(s) ? [s] : [s, path.join(o.wsRoot, s)];
    return cands.some((c) => under(c, rtDir));
  };

  // The single source of truth for the fate of <ws>/.quay/runtime, computed ONCE from the ORIGINAL
  // bytes (before any move), so "the runtime dir is stale" has one definition.
  //   absent | retire (stale) | keep (byte-identical) | unknown (not quay's shape / unreadable)
  const retiredRtState = (): "absent" | "retire" | "keep" | "unknown" => {
    let st: fs.Stats;
    try {
      st = fs.statSync(rtDir);
    } catch {
      return "absent";
    }
    if (!st.isDirectory()) return "absent";
    const known = [
      [path.join(rtDir, "bin", "quay-native.js"), o.installRuntime],
      [path.join(rtDir, "bin", "quay.js"), o.installCore],
    ].filter(([t]) => fs.existsSync(t!));
    if (known.length === 0 || known.some(([, s]) => sha(s!) === null)) return "unknown";
    return known.some(([t, s]) => sha(t!) !== sha(s!)) ? "retire" : "keep";
  };
  const rtState = retiredRtState();

  let changed = false;
  const removed: string[] = [];

  // (gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it): the provider
  // binding no longer names a provider DIRECTORY at all — Core resolves the native provider from its
  // own plugin root (`plugin-root.ts`; the default is `<plugin-root>/vendor/quay-native`). So the two
  // keys that used to carry a path are DELETED here, LINE-WISE. ⛔ Never a YAML re-serialization: that
  // drops every comment, and `.quay/` is gitignored so the original bytes are unrecoverable.
  //
  // The `.quay/runtime` judgment below is unchanged and reads the ORIGINAL binding (whether it
  // referenced the retired dir) — ⛔ not the text this step deletes.
  const stripped = stripNativeProviderBindingLines(fs.readFileSync(o.cfgPath, "utf8"));
  if (stripped.removed.length > 0) {
    changed = true;
    for (const r of stripped.removed) removed.push(`providers.native.${r}`);
  }

  // Whether ANYTHING in the (post-deletion) config still points at the retired runtime. Read from the
  // STRIPPED text, ⛔ not from the parsed `prov`: the native binding this step just deleted is exactly
  // the reference that used to keep the runtime alive, so consulting the pre-deletion parse would
  // keep a now-orphaned copy forever.
  const referencedByBinding = (): boolean =>
    stripped.text.includes(rtDir) || /(^|[\s"'])\.quay\/runtime/.test(stripped.text);

  const backupDir = path.join(o.wsRoot, ".quay", "quay-init-backups", o.backupTs);
  if (rtState === "retire" && !referencedByBinding()) {
    let dest = path.join(backupDir, "runtime");
    if (o.dryRun) {
      say(`  would-retire-orphan-runtime: ${rtDir} -> ${dest} (retired layout, unreferenced, stale vs this delivery — AC1)`);
    } else {
      fs.mkdirSync(backupDir, { recursive: true });
      let n = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(backupDir, `runtime-${n}`);
        n++;
      }
      fs.renameSync(rtDir, dest);
      say(`  retired-orphan-runtime: ${rtDir} -> backup ${dest} (retired layout, unreferenced, stale vs this delivery — AC1)`);
    }
  } else if (rtState === "retire") {
    say(`  kept-referenced-runtime: ${rtDir} (still referenced by the provider binding — NOT retired)`);
  } else if (rtState === "keep") {
    say(`  kept-runtime-copy: ${rtDir} (byte-identical to this delivery — untouched, AC3)`);
  } else if (rtState === "unknown") {
    say(`  kept-unrecognized-runtime-dir: ${rtDir} (not quay's install-generated runtime shape — never touched)`);
  }

  if (!changed) return;
  const note = "the native provider is resolved from the plugin root, so the config carries no path";
  if (o.dryRun) {
    for (const m of removed) say(`  would-remove: ${m} (${note})`);
    return;
  }
  fs.writeFileSync(o.cfgPath, stripped.text, "utf8");
  for (const m of removed) say(`  removed: ${m} (${note})`);
}

/**
 * Delete `providers.native.path` and `providers.native.mcp_entry` from a config's TEXT, line-wise,
 * leaving every other line (comments included) byte-for-byte. Returns the new text and the list of
 * `<key> <value>` descriptions of what went.
 *
 * A key with an INLINE value is one line; the block-sequence form (`mcp_entry:` then `- node` …) is
 * the key line plus its contiguous list items. Both forms are deleted. The scan is scoped to the
 * `providers:` → `native:` block by indentation, so a `path:` under another provider is untouched.
 */
function stripNativeProviderBindingLines(text: string): { text: string; removed: string[] } {
  const lines = text.split("\n");
  const out: string[] = [];
  const removed: string[] = [];
  let inProviders = false;
  let nativeIndent: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "") { out.push(line); continue; }
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      inProviders = /^providers:\s*(#.*)?$/.test(line);
      nativeIndent = null;
      out.push(line);
      continue;
    }
    if (!inProviders) { out.push(line); continue; }
    if (nativeIndent === null) {
      if (/^native:\s*(#.*)?$/.test(trimmed)) nativeIndent = indent;
      out.push(line);
      continue;
    }
    if (indent <= nativeIndent) { nativeIndent = null; out.push(line); continue; }
    const m = /^(path|mcp_entry):\s*(.*)$/.exec(trimmed);
    if (!m) { out.push(line); continue; }
    const inline = m[2]!.replace(/\s+#.*$/, "").trim();
    if (inline === "") {
      // Block-sequence form: consume the key line plus its contiguous `- …` items.
      let j = i + 1;
      const items: string[] = [];
      while (j < lines.length) {
        const l = lines[j]!;
        const lt = l.trim();
        if (lt === "" || lt.startsWith("#")) break;
        const li = l.length - l.trimStart().length;
        if (li < indent || !lt.startsWith("- ")) break;
        items.push(lt.replace(/^- /, ""));
        j++;
      }
      removed.push(`${m[1]}: [${items.join(", ")}]`);
      i = j - 1;
      continue;
    }
    removed.push(`${m[1]}: ${inline}`);
    // (the inline line itself is dropped)
  }
  return { text: out.join("\n"), removed };
}

/**
 * `_derive_loop_scripts_once`'s dependency-closure pass (step (d)): repeat to a fixpoint — for every
 * script name in the round-start snapshot, read its `${SCRIPT_DIR}/<rel>` references and append the
 * ones that are non-empty, not in the NEVER_LAYDOWN set, and exist under `<pluginRoot>/scripts/`.
 * Then rewrite the file with the sorted unique names.
 *
 * The closure regex keeps the PACKAGED two-segment form `${SCRIPT_DIR}/dist/X.js`: `package.sh`
 * rewrites `.ts` refs to `dist/X.js`, and a single-segment `[a-zA-Z0-9._-]*` used to truncate that
 * to `dist`, so the bundle never entered the laydown set. The prefix is STRIPPED (not the basename),
 * so `dist/X.js` stays scripts/-relative.
 *
 * ONE pass replaces the retired per-script `grep`/`sed`/`sort` triple + per-dep `grep -qxF`; those
 * per-script subprocess spawns were the dominant wall-clock cost of the derivation.
 */
export function deriveLoopScriptsClosure(o: { outPath: string; pluginRoot: string; neverLaydown: string }): void {
  const never = new Set(o.neverLaydown.split(/\s+/).filter(Boolean));
  const REF_RE = /(?:\$\{SCRIPT_DIR\}\/|\$SCRIPT_DIR\/)([a-zA-Z0-9][a-zA-Z0-9._/-]*)/g;
  const read = (p: string): string => {
    try {
      return fs.readFileSync(p).toString("utf8");
    } catch {
      return "";
    }
  };
  const names: string[] = [];
  for (const ln of fs.readFileSync(o.outPath, "utf8").split("\n")) {
    const t = ln.replace(/\n$/, "");
    if (t) names.push(t);
  }
  const seen = new Set(names);
  let changed = true;
  let rnd = 0;
  while (changed && rnd < 20) {
    changed = false;
    rnd += 1;
    for (const s of [...names]) {
      const script = path.join(o.pluginRoot, "scripts", s);
      if (!fs.existsSync(script) || !fs.statSync(script).isFile()) continue;
      for (const m of read(script).matchAll(REF_RE)) {
        const dep = m[1]!;
        if (!dep) continue;
        if (never.has(dep)) continue;
        const depPath = path.join(o.pluginRoot, "scripts", dep);
        if (!fs.existsSync(depPath) || !fs.statSync(depPath).isFile()) continue;
        if (!seen.has(dep)) {
          names.push(dep);
          seen.add(dep);
          changed = true;
        }
      }
    }
  }
  const outText = [...new Set(names)].sort().map((x) => x + "\n").join("");
  fs.writeFileSync(o.outPath, outText, "utf8");
}

/**
 * The COMPLETE laydown-set derivation — the TS home of `quay-init.sh`'s `_derive_loop_scripts_once`
 * (+ its stability-checked `derive_loop_scripts` wrapper). Ported verbatim so the shell's derivation
 * helpers (and the library-mode `source` contract they served) can be DELETED
 * (gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script AC4/AC5):
 * `plugin/scripts/laydown-set-check.sh` — the sole remaining consumer — now calls this through the
 * step CLI instead of sourcing the installer.
 *
 * The set is the union of FOUR sources, so there is no second hand-maintained copy to drift:
 *   (a) prefix-derived — every `plugin/scripts/<name>` reference in ALL shipped skills + loop docs +
 *       delivered workflows (a delivered workflow calling a script makes it a required landing);
 *   (b) bare-resolved  — every BARE `<name>.<ext>` token in the MECHANISM corpus (the cold-start skill
 *       + the loop tick docs) that exists under `<pluginRoot>/scripts/`;
 *   (c) explicit       — the mechanism files the docs name with NO path at all, plus the checkers'
 *       ESM-`./` transitive deps (invisible to the `${SCRIPT_DIR}/` closure), plus the self-describing
 *       capability catalog and the L1/L2 delivery-surface checkers;
 *   (c2/c3) consolidated grouped-entry members and the three exec-core tick docs;
 *   (d) closure        — every `${SCRIPT_DIR}/<sibling>` reference, repeated to a fixpoint.
 * `archive/**` is excluded: a doc-referenced script moved to `archive/<date>/…` is no longer part of
 * the live set (restore re-registers it).
 *
 * STABILITY CHECK (gap-quay-init-torn-read-derive-loop-scripts): the derivation greps the shipped
 * corpus, and under heavy load a killed grep/sort returns a PARTIAL (torn) set — which then lays
 * fewer scripts than the docs reference. Two independent passes must agree, retried up to three
 * times; the last snapshot is returned when they never do (a torn set is caught downstream by the
 * referenced-not-landed gate).
 */
export function deriveLoopScripts(o: { pluginRoot: string; neverLaydown: string }): { names: string[]; stable: boolean } {
  const never = new Set(o.neverLaydown.split(/\s+/).filter(Boolean));
  return stableDerivation(() => deriveLoopScriptsOnce(o.pluginRoot, never));
}

/**
 * The installer itself is never a laydown member: it is the script DOING the laying down, and a
 * target that received a copy of it would be carrying a second installer. The default lives here so
 * the gate does not have to name it — a consumer that must spell the installer's path is a consumer
 * that still reads as depending on it.
 */
export const DEFAULT_NEVER_LAYDOWN = "quay-init.sh";

/** Retry the derivation until two independent passes agree (see `deriveLoopScripts`). */
function stableDerivation(once: () => string[]): { names: string[]; stable: boolean } {
  let last: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = once();
    const b = once();
    if (a.length > 0 && a.join("\n") === b.join("\n")) return { names: a, stable: true };
    last = a;
  }
  return { names: last, stable: false };
}

function listFilesSafe(patternDir: string, filter: (name: string) => boolean): string[] {
  try {
    return fs.readdirSync(patternDir).filter(filter).map((n) => path.join(patternDir, n));
  } catch {
    return [];
  }
}

/** One derivation pass — steps (a)+(b)+(c)+(c2)+(c3) + the archive filter + the (d) closure. */
function deriveLoopScriptsOnce(pluginRoot: string, never: Set<string>): string[] {
  const read = (p: string): string => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const names = new Set<string>();

  // (a) prefix-derived over the FULL corpus — shipped skills, loop docs, AND delivered workflows.
  const aFiles = [
    ...listFilesSafe(path.join(pluginRoot, "skills"), () => true).flatMap((d) => listFilesSafe(d, (n) => n === "SKILL.md")),
    ...listFilesSafe(path.join(pluginRoot, "loop"), (n) => n.endsWith(".md")),
    ...listFilesSafe(path.join(pluginRoot, "workflows"), (n) => n.endsWith(".js")),
  ];
  for (const f of aFiles) {
    for (const m of read(f).matchAll(/plugin\/scripts\/([a-zA-Z0-9._-]+)/g)) names.add(m[1]!);
  }

  // (b) bare-resolved over the MECHANISM corpus (cold-start skill + the loop tick docs).
  const mechFiles = [
    path.join(pluginRoot, "skills", "cold-start", "SKILL.md"),
    ...listFilesSafe(path.join(pluginRoot, "loop"), (n) => n.endsWith(".md")),
  ].filter((f) => fs.existsSync(f));
  for (const f of mechFiles) {
    for (const m of read(f).matchAll(/(^|[^/a-zA-Z0-9._-])([a-zA-Z0-9._-]+\.[a-zA-Z0-9]+)/g)) {
      const tok = m[2]!;
      if (never.has(tok)) continue;
      if (!fs.existsSync(path.join(pluginRoot, "scripts", tok))) continue;
      names.add(tok);
    }
  }

  // (c) explicit additions — bare-name mechanism files the docs never spell with a path, the
  //     checkers' ESM-`./` transitive deps (invisible to the `${SCRIPT_DIR}/` closure below), the
  //     capability catalog, and the L1/L2 delivery-surface checkers. Each entry's REASON lives in the
  //     shell file's own header before the retirement; the list itself is data, not prose.
  for (const explicit of [
    "inner-idle-log.ts", "it0-split-or-commit-check.ts", "pipe-exit-code-check.sh",
    "gate-script-base.ts", "workflow-event-schema.mjs", "task-schema.ts", "task-ops.ts",
    "shape-sections.ts", "regex-escape.ts", "touches-parser.ts", "task-status.ts",
    "wiring-coverage-check.ts", "capability-catalog.sh", "l1-delivery-surface-check.ts",
    "dead-loop-check.sh", "inner-blocked-signal.ts", "inner-forensics.mjs",
    // transcript-set.mjs: ESM `./` transitive dep of inner-forensics.mjs (invisible to the
    // `${SCRIPT_DIR}/` closure below) — laying down the consumer without it breaks its import.
    "transcript-set.mjs",
    "task-contract-check.ts", "task-status-drift-check.ts", "touches-orthogonality-check.ts",
    "verify-delivery-surface.ts", "precommit-guard.ts", "touches-one-entry-one-path-check.ts",
    "quay-session.ts", "repo-root.sh", "repo-root.ts", "checker-io.ts", "driver-result.ts",
    "canonical-test-files.ts", "suite-params.ts", "over90-task-gate.ts", "semantic-trigger.ts",
    "main-thread-edit-check.ts", "per-file-cpu-report.mjs",
  ]) names.add(explicit);

  // (c2) consolidated grouped-entry members: `name: "X", file: "Y"` declarations in `quay-*.ts`.
  for (const f of listFilesSafe(path.join(pluginRoot, "scripts"), (n) => n.startsWith("quay-") && n.endsWith(".ts"))) {
    for (const m of read(f).matchAll(/name: "[a-zA-Z0-9._-]+", file: "([a-zA-Z0-9._-]+)"/g)) {
      const member = m[1]!;
      if (never.has(member)) continue;
      if (!fs.existsSync(path.join(pluginRoot, "scripts", member))) continue;
      names.add(member);
    }
  }

  // (c3) the exec-core tick docs (shipped from plugin/loop/, laid into orchestration/).
  for (const tick of ["orchestrator-tick-core.md", "fast-mode-tick-core.md", "manager-tick-core.md"]) names.add(tick);

  // archive/** exclusion: a doc-referenced script that has been archived is no longer part of the set.
  const archiveDir = path.join(pluginRoot, "..", "archive");
  if (fs.existsSync(archiveDir)) {
    const archived = new Set<string>();
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else archived.add(e.name);
      }
    };
    try {
      walk(archiveDir);
    } catch {
      /* unreadable archive ⇒ no exclusion, the safe direction (lays MORE, never fewer) */
    }
    for (const name of [...names]) if (archived.has(name)) names.delete(name);
  }

  // (d) dependency closure to a fixpoint — the same single implementation the shell step uses.
  const tmp = path.join(os.tmpdir(), `quay-laydown-derive-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmp, [...names].sort().map((x) => x + "\n").join(""), "utf8");
  try {
    deriveLoopScriptsClosure({ outPath: tmp, pluginRoot, neverLaydown: [...never].join(" ") });
    return fs.readFileSync(tmp, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * `verify_provider_runtime_existence`'s reader: the runtime file the native provider's launch argv
 * names — `mcp_entry[1]` (the canonical `["node", <runtime>, …]` slot), resolved through the SAME
 * judge the runtime uses (`resolveProviderEntry`) so an OMITTED binding is no longer "nothing to
 * verify": native omits path/mcp_entry by design, and the file to verify is then
 * `<plugin-root>/vendor/quay-native/dist/quay-native.js`.
 *
 * Three-state return (硬规则 3b — "could not evaluate" must not print as "evaluated, fine"):
 *   `<path>`             the runtime file to check for existence/freshness.
 *   `NOT-EVALUATED:<why>` no native provider entry, or the native binding was omitted AND no plugin
 *                        root could be resolved. The caller reports this as its own state.
 *
 * `pluginRoot` is the caller's already-resolved plugin root (the shell passes `$PLUGIN_ROOT`);
 * omitted/undefined ⇒ the real `resolvePluginRoot()`.
 */
export function providerEntryFile(cfgPath: string, pluginRoot?: string | null): string {
  try {
    const doc = (YAML.parse(fs.readFileSync(cfgPath, "utf8")) ?? {}) as Record<string, unknown>;
    const providers = doc["providers"];
    const prov = (typeof providers === "object" && providers !== null ? (providers as Record<string, unknown>)["native"] : undefined) as
      | Record<string, unknown>
      | undefined;
    if (typeof prov !== "object" || prov === null || Array.isArray(prov)) {
      return "NOT-EVALUATED:no providers.native entry in the config";
    }
    const resolved = resolveProviderEntry("native", prov, pluginRoot);
    const mcp = resolved.mcpEntry;
    if (Array.isArray(mcp) && mcp.length >= 2) return String(mcp[1]);
    return `NOT-EVALUATED:${NATIVE_PROVIDER_UNRESOLVABLE} (native omits path/mcp_entry and no plugin root could be resolved)`;
  } catch (e: unknown) {
    return `NOT-EVALUATED:unreadable config (${e instanceof Error ? e.message : String(e)})`;
  }
}
