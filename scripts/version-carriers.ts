#!/usr/bin/env node --experimental-strip-types
/**
 * version-carriers — THE single table of version-bearing files (the "carriers") plus the read/write
 * primitives over it.
 *
 * (tasks/gap-version-stamp-generator-and-build-wiring, 2026-09-20; human ruling, verbatim:
 *  「a. 仍提交字面量，但写死为基础版本加 -dev，由生成器在改 VERSION 时一并更新。」
 *  「可以在 build 过程中，监测分支并加后缀，如 -dev。」)
 *
 * ── WHY THIS MODULE EXISTS (the defect it closes) ────────────────────────────────────────────────
 * `gap-version-single-source-root-file-and-resolver` landed the single SOURCE (`VERSION` at the repo
 * root + `resolveVersion`). It did not touch the fact that WRITING the derived form was still manual:
 * bumping `VERSION` left 15 literals to hand-edit before `version-consistency-check` went green, and
 * `packages/quay/scripts/package.sh` carried its own hand-copied three-way comparison as an
 * after-the-fact verification instead of a generation step.
 *
 * Two consumers must agree on "which files carry the version, and where inside them":
 *   • `version-consistency-check.ts` — the JUDGE (reads, compares against `resolveVersion`).
 *   • `stamp-version.ts`            — the GENERATOR (writes the derived form).
 * A second hand-maintained copy of that list in the generator is the exact "copy instead of
 * abstraction" drift this repo's ADR-004 discipline exists to prevent: the judge would keep passing
 * while the generator silently missed a carrier (or vice versa). So the list lives HERE, once, and
 * both import it. The 4 `package-lock.json` workspace entries — previously outside the judge's set
 * entirely — are members of this table, closing that gap.
 *
 * ── extract vs locate, and why BOTH ──────────────────────────────────────────────────────────────
 * `extract` is STRUCTURAL: it parses the file the way a reader (or npm) would and returns the version
 * it finds. That is the value the judgment is made on.
 * `locate` is TEXTUAL: it returns the byte span the generator will overwrite. A JSON re-serialization
 * round-trip would be simpler but is WRONG here — `delivery-manifest.json` deliberately keeps its
 * array items on one line, so `JSON.stringify(…, null, 2)` rewrites 45 lines into 195 (measured) and
 * the generator's diff stops being "the version changed" and becomes "the whole file was reformatted".
 * Textual replacement keeps the generator's diff minimal and reviewable.
 * The two are cross-checked on every read (`readCarrierVersion`): the span `locate` hands the
 * generator MUST be the field `extract` judged. Without that assertion, "the judge reads field A" and
 * "the generator writes field B" are indistinguishable (hard rule 4) and a mis-anchored `locate` would
 * silently stamp the wrong token while every check stayed green.
 *
 * ── THREE-VALUED, NEVER BOOLEAN (hard rule 3b) ───────────────────────────────────────────────────
 * Every failure path THROWS (or returns `{error}`) — a carrier this module cannot read must never
 * report a version-shaped value. `''` reads as "a version that happens to be empty" to a caller doing
 * `===`, which is the "could not read ⇒ looks like a pass" shape.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The byte span of a version token inside a carrier's raw content. */
export interface VersionSpan {
  /** the token currently occupying [start, end) */
  value: string;
  start: number;
  end: number;
}

export interface VersionCarrier {
  /** stable human label for reports (the 4 package-lock entries share a `path`, not a label) */
  label: string;
  /** path relative to the tree root the carrier is read/written in */
  path: string;
  /**
   * Structural read — what the JUDGMENT is made on. THROWS when the carrier cannot be evaluated
   * (never returns a value shaped like a pass).
   */
  extract(raw: string): string;
  /**
   * Textual locate — the span `stamp` rewrites. THROWS when the anchor is absent.
   */
  locate(raw: string): VersionSpan;
}

// ── primitives ───────────────────────────────────────────────────────────────────────────────────

/** Pull the [start,end) span of a capture group out of a `/d`-flagged match (exact, no re-scan). */
function spanOf(m: RegExpMatchArray, group = 1): VersionSpan {
  const indices = (m as unknown as { indices?: [number, number][] }).indices;
  if (!indices) {
    throw new Error('regex lacks the /d flag — cannot locate the span (internal error)');
  }
  const [start, end] = indices[group];
  return { value: m[group], start, end };
}

/**
 * Anchored regexes, declared ONCE and used by BOTH the structural and the textual half of their
 * carrier (the `/d` flag only makes the capture's span available; the pattern itself is shared, so the
 * two halves cannot drift apart).
 */
const README_VERSION_RE = /^quay plugin v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/dm;
const PLUGIN_STAMP_RE = /^(\S+)/dm;
/** The first `"version": "<v>"` token of a JSON file. */
const JSON_VERSION_RE = /"version"\s*:\s*"([^"]*)"/d;

/** The `packages/<dir>` workspace entry's `version` field, inside `package-lock.json`. */
function workspaceLockRe(dir: string): RegExp {
  // `"packages/quay":` can never match `"packages/quay-native":` — the closing quote is part of the
  // pattern, so the key must end exactly there (the prefix-ambiguity trap this repo has hit before).
  return new RegExp(`("packages/${dir}"\\s*:\\s*\\{[\\s\\S]*?"version"\\s*:\\s*")([^"]*)(")`, 'd');
}

/**
 * A carrier whose version is the FIRST `"version": "<v>"` token of a JSON file — used for the
 * `package.json` / `plugin.json` family and for `delivery-manifest.json`.
 */
function jsonVersionField(label: string, path: string): VersionCarrier {
  return {
    label,
    path,
    extract(raw) {
      const data = JSON.parse(raw);
      const v = data?.version;
      if (typeof v !== 'string' || v.length === 0) {
        throw new Error(`${path}: no string .version (cannot evaluate — not a pass)`);
      }
      return v;
    },
    locate(raw) {
      const m = raw.match(JSON_VERSION_RE);
      if (!m) throw new Error(`${path}: no "version": "..." token to rewrite (cannot stamp)`);
      return spanOf(m);
    },
  };
}

/**
 * ⛔ REMOVED (2026-09-20, gap-version-marketplace-omit-and-spec-amendment): the two carriers for a
 * marketplace's `quay` plugin-entry `version` used to live here (`marketplaceQuayEntry` +
 * `MARKETPLACE_QUAY_VERSION_RE`). They were deleted together with the FIELD ITSELF, on measurement
 * rather than on preference — see the table's comment below for the readings. Do not re-introduce
 * either half without re-running that measurement: a re-added field is stamped by the generator,
 * judged by the checker, and read by NOTHING.
 */

/** A `packages/<dir>` workspace entry inside `package-lock.json` (npm's lockfile, not a second source). */
function packageLockEntry(dir: string): VersionCarrier {
  const path = 'package-lock.json';
  const label = `package-lock.json (packages/${dir})`;
  const read = (raw: string): string => {
    const entry = JSON.parse(raw)?.packages?.[`packages/${dir}`];
    if (!entry || typeof entry.version !== 'string' || entry.version.length === 0) {
      throw new Error(`${path}: packages/${dir} has no string .version (cannot evaluate — not a pass)`);
    }
    return entry.version;
  };
  return {
    label,
    path,
    extract: read,
    locate(raw) {
      const m = raw.match(workspaceLockRe(dir));
      if (!m) throw new Error(`${path}: no packages/${dir} version token to rewrite (cannot stamp)`);
      return spanOf(m, 2);
    },
  };
}

// ── THE TABLE (single home — both the judge and the generator import this) ────────────────────────

/**
 * Every version-bearing file, in report order. 13 entries over 10 distinct files:
 * the 4 `packages/<name>/package.json`, the 4 `package-lock.json` workspace entries, `plugin.json`,
 * `plugin/README.md`, `plugin/vendor/quay/package.json`, `plugin/VERSION`, and `delivery-manifest.json`.
 *
 * ── WHY THE TWO `marketplace.json` ENTRIES ARE NOT HERE (2026-09-20) ─────────────────────────────
 * `gap-version-marketplace-omit-and-spec-amendment` measured whether the `plugins[].version` field of
 * a marketplace entry is read at all, and found that it IS NOT. The install cache is keyed by the
 * FETCHED PLUGIN's own `plugin.json` version — the marketplace entry's value never enters the
 * reading. Four real installs under an isolated `CLAUDE_CONFIG_DIR` (`claude plugin marketplace add` +
 * `claude plugin install quay@quay -s user --json` + `claude plugin list --json`):
 *
 *   dialect                marketplace entry `version`   list --json `version` / `installPath` key
 *   ─────────────────────  ───────────────────────────   ──────────────────────────────────────────
 *   root (github source)   `0.10.0-dev`                  `0.10.0`      (plugin.json on dist-plugin)
 *   root (github source)   ABSENT                        `0.10.0`      (identical to the row above)
 *   plugin (`source: "."`) `0.10.0-dev`                  `0.10.0-dev`  (plugin.json in that tree)
 *   plugin (`source: "."`) ABSENT                        `0.10.0-dev`  (identical to the row above)
 *   plugin (`source: "."`) **`9.9.9`** (deliberate)      `0.10.0-dev`  ← the decisive control
 *
 * The last row is the control the first four cannot supply by themselves (hard rule 4 推论四): a
 * marketplace advertising `9.9.9` against a `0.10.0-dev` plugin manifest still installs and reports
 * `0.10.0-dev`, so "the field is ignored" and "the field happens to agree" are distinguishable — and
 * it is ignored. The field therefore carried ZERO information while costing a hand-written committed
 * literal in two files, which is exactly the defect this table exists to make visible. So the field
 * was deleted from both files and these two entries left the table.
 *
 * ⛔ The consequence to keep in mind: nothing now checks these two files. A future author who re-adds
 * `"version"` to a marketplace entry gets a literal that is stamped by `stamp-version` (only for the
 * `plugin/` one — the root file is not under a build prefix), judged by nothing, and read by nothing.
 * Fix the mechanism, not the symptom: re-run the measurement above before bringing either half back.
 */
export const VERSION_CARRIERS: VersionCarrier[] = [
  jsonVersionField('packages/quay', 'packages/quay/package.json'),
  jsonVersionField('packages/quay-native', 'packages/quay-native/package.json'),
  jsonVersionField('packages/quay-github', 'packages/quay-github/package.json'),
  jsonVersionField('packages/quay-backlog', 'packages/quay-backlog/package.json'),
  jsonVersionField('plugin/.claude-plugin/plugin.json', 'plugin/.claude-plugin/plugin.json'),
  {
    // Prose carrier, not a machine field: its version lives inside the sentence
    // `quay plugin v<semver> — …`. Both halves are ANCHORED to that sentence and THROW when it cannot
    // be found — a reworded README must redden the gate (mode:'error'), never silently return '' and
    // read as "consistent" (hard rule 3b). Added by
    // gap-ac169-readme-version-not-in-version-consistency-set: README had drifted to v0.6.1 while
    // plugin.json was 0.6.3 across two bumps, precisely because it was NOT in this set.
    //
    // The capture group spans the WHOLE version token, INCLUDING an optional prerelease suffix. That is
    // not cosmetic: a `/^quay plugin v(\d+\.\d+\.\d+)\b/` form *looks* like it matches a version, but
    // `\b` holds between `0` and `-`, so on `quay plugin v0.7.0-dev` the group closes at `0.7.0` and
    // the suffixed token reads as a BARE `0.7.0` — exactly the self-description AC-272 exists to
    // eliminate (hard rule 4c: a quantity that does not survive the intermediate layer is not the
    // quantity being judged; this one was measured, not assumed). Widening the COMPARISON to
    // prefix-equality is NOT the fix — that would let `0.7.0-dev` and `0.7.0` judge each other
    // consistent, which is the ambiguity itself.
    label: 'plugin/README.md',
    path: 'plugin/README.md',
    extract(raw: string) {
      const m = raw.match(README_VERSION_RE);
      if (!m) {
        throw new Error(
          'no "quay plugin v<semver>" version line found in plugin/README.md (cannot evaluate — not a pass)',
        );
      }
      return m[1];
    },
    locate(raw: string) {
      const m = raw.match(README_VERSION_RE);
      if (!m) {
        throw new Error(
          'no "quay plugin v<semver>" version line found in plugin/README.md (cannot stamp)',
        );
      }
      return spanOf(m);
    },
  },
  jsonVersionField('plugin/vendor/quay/package.json', 'plugin/vendor/quay/package.json'),
  {
    // Plain-text version stamp (`plugin/VERSION` holds a bare semver and nothing else) — deliberately
    // NOT JSON.parse'd. Added by gap-ac259-version-union-lockstep-and-host-install-readings: this file
    // was the ONE member of the version-bearing union that no single judge covered. AC-259's criterion
    // enumerated it while this list did not (and vice versa for plugin/vendor/quay/package.json), so a
    // `plugin/VERSION`-only drift reddened AC-259 while this checker stayed green. Precedent on the real
    // release path: `6bf000622` claimed to bump "all 8 version-bearing files" and left plugin/VERSION at
    // 0.5.0 — requiring a second commit `bd466ce2a` to repair, with this checker green in between.
    // Both halves THROW when the file does not hold a semver token: an unreadable stamp must land in
    // mode:'error', never be shaped like a stamp that agrees (hard rule 3b).
    // The extractor returns the WHOLE trimmed line and `/^\d+\.\d+\.\d+/` is only a fail-closed GUARD,
    // not a capture — so `plugin/VERSION` holding `0.7.0-dev` reads back verbatim as `0.7.0-dev`, and
    // `locate` returns the same token's span (nothing is truncated on either side).
    label: 'plugin/VERSION',
    path: 'plugin/VERSION',
    extract(raw: string) {
      const v = raw.trim();
      if (!/^\d+\.\d+\.\d+/.test(v)) {
        throw new Error('no bare semver in plugin/VERSION (cannot evaluate — not a pass)');
      }
      return v;
    },
    locate(raw: string) {
      const m = raw.match(PLUGIN_STAMP_RE);
      if (!m) throw new Error('plugin/VERSION holds no token to rewrite (cannot stamp)');
      return spanOf(m);
    },
  },
  {
    // Added by gap-release-cut-via-workflow-dispatch (2026-09-15). `delivery-manifest.json` was the
    // ONE version-bearing file outside this set, and it drifted exactly the way this checker exists to
    // prevent: bumped through `08e8ec55f` (0.4.0 -> 0.5.0) and then left at `0.5.0` across the 0.6.x/0.7.x
    // bumps. The drift was invisible here but fatal on the release path — `delivery-manifest-check.ts`
    // then built the expected asset name as `quay-sea-${manifest.version}-${platform}` and EXACT-matched
    // it against the assets a run really published, so against release `v0.7.0` (assets
    // `quay-sea-0.7.0-*`) it matched nothing. Measured two-way in the task worktree with the real GitHub
    // Release: manifest 0.5.0 => 4 failures (2 SEA + 2 npm/plugin); manifest 0.7.0 => only the 2
    // npm/plugin failures that were there because that run's `release` job had failed and never uploaded
    // `quay-0.7.0.tgz`. Same shape as the plugin/README.md and plugin/VERSION additions above (hard rule
    // 5b: fixing the one instance that was reported does not mean it was the only one — the sweep over
    // the other version-bearing files returned this single remaining point).
    // ⚠️ 2026-09-16: that asset-name cross-check no longer exists — the npm-pack and Node-SEA release
    // lines were cancelled by the human ruling recorded in
    // orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md §11, and `delivery-manifest-check`'s
    // `--ci` asset-verification mode was removed with them. `delivery-manifest.json` STAYS in this union
    // regardless: it is still a version-bearing release artifact (its `version` field tracks the release
    // the manifest describes, and `delivery-manifest-check.test.ts` asserts it equals
    // packages/quay/package.json's), and the original drift — the reason it was added — is a property of
    // the file, not of the checker that happened to catch it.
    // ⛔ Its array items are deliberately ONE LINE EACH, so `locate` stamps the field textually and the
    // generator's diff stays one line — a JSON round-trip would reformat 45 lines into 195 (measured).
    label: 'delivery-manifest.json',
    path: 'delivery-manifest.json',
    extract(raw: string) {
      const v = JSON.parse(raw).version;
      if (typeof v !== 'string' || !/^\d+\.\d+\.\d+/.test(v)) {
        throw new Error('no semver in delivery-manifest.json .version (cannot evaluate — not a pass)');
      }
      return v;
    },
    locate(raw: string) {
      const m = raw.match(JSON_VERSION_RE);
      if (!m) throw new Error('delivery-manifest.json: no "version": "..." token to rewrite');
      return spanOf(m);
    },
  },
  packageLockEntry('quay'),
  packageLockEntry('quay-native'),
  packageLockEntry('quay-github'),
  packageLockEntry('quay-backlog'),
];

/** The distinct files the table covers (10 for the 13 entries — package-lock contributes 4 entries). */
export function carrierPaths(carriers: VersionCarrier[] = VERSION_CARRIERS): string[] {
  return [...new Set(carriers.map((c) => c.path))];
}

/**
 * The SINGLE SOURCE's repo-relative path — `VERSION` at the repo root. Deliberately NOT a member of
 * `VERSION_CARRIERS`: the carriers are DERIVED from it (`version-consistency-check.ts` judges every
 * carrier against `resolveVersion(VERSION)`), so it is the source and not a carrier. It still belongs
 * in THIS module, which is the single home of "which files carry a version" (hard rule 5b): a
 * release-cut next-version bump rewrites the source AND every carrier, so a consumer asking "which
 * files does a version bump touch?" must not hand-copy either half. (Mirrors the one read site,
 * `resolve-version.ts`'s `resolve(root, 'VERSION')`.)
 */
export const VERSION_SOURCE_PATH = "VERSION";

/**
 * Every repo-relative path a release-cut NEXT-VERSION bump rewrites: the derived carriers
 * (`carrierPaths()`) plus the single SOURCE (`VERSION_SOURCE_PATH`). Derived from the ONE table so a
 * consumer never hand-copies the file list (tasks/gap-ac194-release-bump-classified-as-bypass AC3).
 * ⛔ This is "the paths the bump writes", NOT "every version-bearing path": e.g. the closure-ratchet
 * baseline the bump also re-anchors lives under `docs/` (design-internal), which a branch that wants
 * the SET already excludes on its own.
 */
export function versionBearingPaths(carriers: VersionCarrier[] = VERSION_CARRIERS): string[] {
  return [...new Set([...carrierPaths(carriers), VERSION_SOURCE_PATH])];
}

export interface CarrierReading {
  label: string;
  path: string;
  version: string;
  error?: string;
}

/**
 * Read one carrier from `root`, cross-checking that the span `locate` will rewrite is the field
 * `extract` judged. Returns `{version:'', error}` — never a pass-shaped value — when either half fails
 * or when the two disagree.
 */
export function readCarrierVersion(root: string, carrier: VersionCarrier): CarrierReading {
  const base: CarrierReading = { label: carrier.label, path: carrier.path, version: '' };
  let raw: string;
  try {
    raw = readFileSync(resolve(root, carrier.path), 'utf-8');
  } catch (e: any) {
    return { ...base, error: `unreadable: ${e?.message ?? String(e)}` };
  }
  let structural: string;
  let span: VersionSpan;
  try {
    structural = carrier.extract(raw);
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
  try {
    span = carrier.locate(raw);
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
  if (span.value !== structural) {
    // The judge and the generator would be looking at DIFFERENT tokens — refuse rather than pick one.
    return {
      ...base,
      error:
        `extract/locate disagree in ${carrier.path}: the judged field holds ${JSON.stringify(structural)} ` +
        `but the token that would be rewritten is ${JSON.stringify(span.value)} (refusing — a generator ` +
        `whose anchor is not the judged field must not run)`,
    };
  }
  return { ...base, version: structural };
}

export function readCarriers(root: string, carriers: VersionCarrier[] = VERSION_CARRIERS): CarrierReading[] {
  return carriers.map((c) => readCarrierVersion(root, c));
}

/** The new raw content with `carrier`'s version token replaced by `version`. Pure. THROWS if unanchored. */
export function stampedContent(raw: string, carrier: VersionCarrier, version: string): string {
  const span = carrier.locate(raw);
  return raw.slice(0, span.start) + version + raw.slice(span.end);
}

// ── BUILD-MODE PROJECTION ────────────────────────────────────────────────────────────────────────
/**
 * A build artifact tree (`plugin/` in the repo, the assembled orphan `dist-plugin` tree, the npm-pack
 * snapshot `packages/quay/plugin/`) has the PLUGIN layout at its root, not the repo layout: the
 * carriers that exist there are the ones this table spells under `plugin/`, with that prefix dropped.
 * Projecting the table this way (rather than writing a second, hand-maintained list) is what keeps
 * "which files carry a version" a single fact: adding a carrier under `plugin/` automatically becomes
 * a build-time carrier, and the projection cannot silently omit one.
 */
export function buildCarriers(top: string): VersionCarrier[] {
  const prefix = top.endsWith('/') ? top : `${top}/`;
  return VERSION_CARRIERS.filter((c) => c.path.startsWith(prefix)).map((c) => ({
    ...c,
    path: c.path.slice(prefix.length),
    label: `${c.label} [build:${c.path}]`,
  }));
}
