// packages/quay/src/init/carrier-env.ts — the carrier-directory pin (`ensure_provider_carrier_env`) and the line-level YAML block helpers it shares with the provider switch
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
import { escapeRegExp } from "../kernel/regex-escape.ts";

export interface EnsureCarrierEnvOpts {
  cfgPath: string;
  wsRoot: string;
  dryRun: boolean;
}

export interface EnsureCarrierEnvTextOpts {
  wsRoot: string;
}

export interface CarrierEnvTextResult {
  /** The possibly-updated config text (byte-identical to the input when `pinned` is empty). */
  text: string;
  /** The keys appended, in the order they were appended. */
  pinned: Array<{ key: string; value: string }>;
  /** Why nothing was pinned — never silently absent (硬规则 3b: an unreadable shape is its own state). */
  note: null | "no-providers" | "no-native" | "inline-env";
}

/** The carrier-directory pins `ensure_provider_carrier_env` backfills, with the directory each names. */
const CARRIER_KINDS: ReadonlyArray<readonly [string, string]> = [
  ["QUAY_NATIVE_ADR_DIR", "adr"],
  ["QUAY_NATIVE_GOAL_DIR", "goals"],
  ["QUAY_NATIVE_META_DIR", "meta"],
];

/**
 * `ensure_provider_carrier_env` — pin the provider's carrier directories in an EXISTING config's
 * `providers.native.env` map. The root cause (carrier-dirs derived from the resolved tasks dir) is
 * already fixed; this pin is the second, independent half — it makes the isolation VISIBLE AND
 * AUDITABLE in the config the user owns instead of leaving it implicit.
 *
 * IDEMPOTENT + MINIMAL is the whole design: a LINE-LEVEL insert, never a YAML round-trip (a
 * `safe_dump` would reformat every other key of a file that needed no change and lose its
 * comments). Only the MISSING keys are appended to the env block, adjacent to the existing ones; a
 * key already present is NEVER overwritten (the user's own value wins), and a config whose env
 * block already carries all three is left byte-for-byte untouched — no write, hence no diff.
 *
 * The inserted values MIRROR the form of the existing tasks-dir pin (`./tasks` → `./adr`, an
 * absolute `/ws/tasks` → `/ws/adr`), so the env block does not mix absolute and relative forms.
 *
 * ⛔ This is the TEXT-ONLY half (gap-init-single-engine-state-based-upgrade-validate-before-write):
 * the upgrade engine edits an IN-MEMORY candidate, so the insert must be expressible as
 * text → text. `ensureProviderCarrierEnv` below is the file-writing wrapper over this ONE
 * implementation — there is no second copy of the line-level logic.
 */
// ── line-address helpers shared by EVERY text-level edit of `.quay/config.yml` ────────────────────
// These three are the whole addressing model for a comment-preserving edit: a `key:` is located by
// INDENTATION, never by a YAML round-trip (a round-trip reformats the file and drops the comments
// that document which providers exist and what each one needs).
//
// ⛔ Module scope, not closures inside one caller (硬规则 5b): `ensureProviderCarrierEnvText` and
// `switchEnabledProviderText` are two edits of the SAME file, and a second private copy of the
// indentation rules is exactly how the two would come to disagree about where a block ends.
function indentOf(s: string): number {
  return s.length - s.trimStart().length;
}

/**
 * First index >= start+1 in `lines` that is non-blank with indent <= parentInd, else lines.length.
 *
 * `export`ed for `provider-maintenance.ts` (the provider switch edits the SAME file through the same
 * addressing model); ⛔ NOT re-exported from `../init.ts`, so the package surface is unchanged.
 */
export function blockEnd(lines: string[], start: number, parentInd: number): number {
  let j = start + 1;
  while (j < lines.length) {
    if (lines[j]!.trim() && indentOf(lines[j]!) <= parentInd) return j;
    j++;
  }
  return lines.length;
}

/**
 * [index, indent] of the first `key:` line in lines[start, end) at indent >= minIndent.
 *
 * `export`ed for `provider-maintenance.ts` for the same reason as `blockEnd` above (one addressing
 * model, not a second private copy); ⛔ not re-exported from `../init.ts`.
 */
export function findChild(lines: string[], start: number, end: number, key: string, minIndent: number): [number, number] | null {
  const pat = new RegExp("^(\\s*)" + escapeRegExp(key) + "\\s*:");
  for (let i = start; i < end; i++) {
    const m = pat.exec(lines[i]!);
    if (m && m[1]!.length >= minIndent) return [i, m[1]!.length];
  }
  return null;
}

export function ensureProviderCarrierEnvText(text: string, o: EnsureCarrierEnvTextOpts): CarrierEnvTextResult {
  const lines = text.split("\n");
  const noop = (note: CarrierEnvTextResult["note"]): CarrierEnvTextResult => ({ text, pinned: [], note });

  // ── locate providers: → native: → env: by INDENTATION, not by a yaml round-trip ─────────────────
  const prov = findChild(lines, 0, lines.length, "providers", 0);
  if (!prov) return noop("no-providers");
  const native = findChild(lines, prov[0] + 1, blockEnd(lines, prov[0], prov[1]), "native", prov[1] + 1);
  if (!native) return noop("no-native");
  const nativeEnd = blockEnd(lines, native[0], native[1]);
  const env = findChild(lines, native[0] + 1, nativeEnd, "env", native[1] + 1);

  // ── collect the keys the env block already carries ──────────────────────────────────────────────
  const present: Record<string, string> = {};
  if (env) {
    const rest = lines[env[0]]!.slice(lines[env[0]]!.indexOf(":") + 1).trim();
    if (rest && !rest.startsWith("{")) return noop("inline-env");
    if (rest.startsWith("{")) {
      for (const m of rest.matchAll(/(QUAY_NATIVE_\w+)\s*:/g)) present[m[1]!] = "";
    } else {
      const keyRe = /^(\s*)(QUAY_NATIVE_\w+)\s*:\s*(.*)$/;
      for (let i = env[0] + 1; i < blockEnd(lines, env[0], env[1]); i++) {
        const m = keyRe.exec(lines[i]!);
        if (m && m[1]!.length > env[1]) present[m[2]!] = m[3]!.trim();
      }
    }
  }

  const missing = CARRIER_KINDS.filter(([k]) => !(k in present));
  if (missing.length === 0) return noop(null);

  const rawTasks = (present["QUAY_NATIVE_TASKS_DIR"] ?? "./tasks").trim().replace(/^["']|["']$/g, "");
  const absolute = rawTasks.startsWith("/") || rawTasks.startsWith("~");
  const valueFor = (kind: string): string => (absolute ? `${o.wsRoot}/${kind}` : `./${kind}`);
  const pinned = missing.map(([k, kind]) => ({ key: k, value: valueFor(kind) }));

  // ── append the missing keys to the END of the env block (or create the block, if absent) ────────
  const newLines = [...lines];
  let insertAt: number;
  let baseInd: number;
  let added: string[];
  if (!env) {
    insertAt = nativeEnd;
    baseInd = native[1] + 2;
    added = [" ".repeat(baseInd) + "env:", ...pinned.map((p) => `${" ".repeat(baseInd + 2)}${p.key}: "${p.value}"`)];
  } else {
    let last = env[0];
    for (let i = env[0] + 1; i < blockEnd(lines, env[0], env[1]); i++) {
      if (lines[i]!.trim()) last = i;
    }
    insertAt = last + 1;
    baseInd = env[1] + 2;
    added = pinned.map((p) => `${" ".repeat(baseInd)}${p.key}: "${p.value}"`);
  }
  newLines.splice(insertAt, 0, ...added);
  return { text: newLines.join("\n"), pinned, note: null };
}

/**
 * The FILE-writing wrapper over `ensureProviderCarrierEnvText` — the shell step's entry. Prints the
 * step's report lines (byte-identical to the pre-refactor output) and writes only when something
 * was actually pinned.
 */
export function ensureProviderCarrierEnv(o: EnsureCarrierEnvOpts): void {
  if (!fs.existsSync(o.cfgPath)) return;
  const res = ensureProviderCarrierEnvText(fs.readFileSync(o.cfgPath, "utf8"), { wsRoot: o.wsRoot });

  if (res.note === "no-providers") {
    console.log("  note: .quay/config.yml has no providers: section — carrier env pins not applicable (nothing written)");
    return;
  }
  if (res.note === "no-native") {
    console.log("  note: providers: has no native: entry — carrier env pins not applicable (nothing written)");
    return;
  }
  if (res.note === "inline-env") {
    console.error(
      "  note: providers.native.env has an unrecognized inline form — carrier env pins NOT applied " +
        "(add QUAY_NATIVE_ADR_DIR/QUAY_NATIVE_GOAL_DIR/QUAY_NATIVE_META_DIR by hand)",
    );
    return;
  }
  if (res.pinned.length === 0) {
    console.log("  unchanged: .quay/config.yml providers.native.env: (four carrier dirs already pinned — no rewrite, AC4)");
    return;
  }

  if (o.dryRun) {
    for (const p of res.pinned) {
      console.log(`  would-pin: providers.native.env.${p.key}: "${p.value}" (carrier dir pin — AC4)`);
    }
    return;
  }

  fs.writeFileSync(o.cfgPath, res.text, "utf8");
  for (const p of res.pinned) {
    console.log(`  pinned: .quay/config.yml providers.native.env.${p.key}: "${p.value}" (carrier dir pin — AC4)`);
  }
}
