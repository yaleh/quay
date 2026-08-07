// loop-shipping-exclusion-data.mjs — SINGLE SOURCE OF TRUTH for loop-shipping's AC1/AC1b
// exclusion table + the 5 old-path definitions (gap-exclusion-lists-have-no-necessity-check).
//
// Both consumers import from here so the table cannot drift between the AC1b live-reference scan
// and the inert-exclusion necessity check:
//   - plugin/test/loop-shipping.test.mjs            (the AC1/AC1b scan itself)
//   - plugin/test/loop-shipping-necessity-check.test.mjs  (the inert-entry detector)
//
// Entry shape: { rel, target, reason, retainedNote? }
//   - rel:      repo-relative label for reports.
//   - target:   the ABSOLUTE path the AC1b scan skips (a directory skips the whole subtree).
//   - reason:   why the path is in the exclusion list (the role it plays in the two-layer loop).
//   - retainedNote (OPTIONAL): a written justification for an entry whose target currently
//     contains ZERO hits of the 5 old-path patterns. The necessity check fails any inert entry
//     WITHOUT one (the ## Contract invariant's "或写明为何保留" branch). Present only on entries
//     that are deliberately kept despite suppressing nothing right now.

import path from 'node:path';

/**
 * The 5 formerly-plugin-external mechanism files' OLD paths (pre-move). Single source: the AC1
 * existence check asserts none of these exist on disk; the AC1b patterns derive from them.
 * (`scripts/heavy-op-token.sh` was removed 2026-08-06 — the heavy-op token was RETIRED entirely
 * by human ruling, see tasks/gap-session-liveness-remove-shared-events-and-lock.)
 */
export const oldPaths = [
  'orchestration/orchestrator-loop-tick.md',
  'docs/analysis/fast-mode-loop-tick.md',
  'orchestration/watch/inner-forensics.mjs',
  'orchestration/watch/inner-state.sh',
  'scripts/resource-gate.sh',
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The AC1b scan regexes, DERIVED from oldPaths so the two can never disagree:
 * the `scripts/*.sh` old paths are SUBSTRINGS of the new `plugin/scripts/*.sh` paths, so those
 * two get a `(?<!plugin/)` negative lookbehind to match only the bare old form; the
 * `orchestration/` + `docs/analysis/` old paths are NOT substrings of their new `plugin/loop/`
 * locations, so plain substring is exact there. (Same matching semantics as the original inline
 * literals — verified in the 2026-08-05 derivation check.)
 */
export const oldPathPatterns = oldPaths.map((s) =>
  s.startsWith('scripts/')
    ? new RegExp(`(?<!plugin/)${escapeRegExp(s)}`)
    : new RegExp(escapeRegExp(s)),
);

/**
 * The AC1b exclusion table: files that MAY legitimately mention the old paths (historical record /
 * target-layout / the pattern definitions themselves) and are therefore exempt from the
 * "no live reference" scan. Directory targets exclude their whole subtree.
 *
 * @param {string} repoRoot  absolute repo root (parent of plugin/)
 * @param {string} pluginDir absolute plugin/ dir
 */
export function exclusionEntries(repoRoot, pluginDir) {
  return [
    { rel: 'tasks', target: path.join(repoRoot, 'tasks'), reason: 'historical task records (descriptions of the past)' },
    { rel: 'milestones', target: path.join(repoRoot, 'milestones'), reason: 'historical milestone journals' },
    { rel: 'docs/analysis/batch2-queue-state.md', target: path.join(repoRoot, 'docs', 'analysis', 'batch2-queue-state.md'), reason: "the queue-state's tick records reference the deployed tick-doc target layout (docs/analysis/ + orchestration/ paths) as living documentation — same class as the deployed copies excluded below" },
    { rel: 'orchestration/tick-log.md', target: path.join(repoRoot, 'orchestration', 'tick-log.md'), reason: "the outer's running log" },
    { rel: 'plugin/scripts/quay-init.sh', target: path.join(pluginDir, 'scripts', 'quay-init.sh'), reason: 'target layout (orchestration/ + docs/analysis/)' },
    {
      rel: 'plugin/scripts/os-anchor-install.sh',
      target: path.join(pluginDir, 'scripts', 'os-anchor-install.sh'),
      reason: 'drives FOREIGN/legacy workspaces (meta-cc, archguard) that may still run the old orchestration/ layout — the old tick-doc path is a supported target, not a quay-repo reference (live ref surfaced by the AC1b scan 2026-08-05: os-anchor landed 11:05Z, the AC1b table predated it)',
    },
    {
      rel: 'docs/analysis/fast-mode-loop-tick.md',
      target: path.join(repoRoot, 'docs', 'analysis', 'fast-mode-loop-tick.md'),
      reason: "deployed copy of the inner tick-doc template — its template-params NOTE documents the TARGET layout (same class as plugin/loop/, excluded below)",
    },
    {
      rel: 'orchestration/orchestrator-loop-tick.md',
      target: path.join(repoRoot, 'orchestration', 'orchestrator-loop-tick.md'),
      reason: "deployed copy of the outer tick-doc template — its template-params NOTE documents the TARGET layout (same class as plugin/loop/, excluded below)",
    },
    { rel: 'test/cold-start-e2e.sh', target: path.join(repoRoot, 'test', 'cold-start-e2e.sh'), reason: 'target layout (asserts the laid-down project)' },
    { rel: 'test/cold-start-oneliner-e2e.sh', target: path.join(repoRoot, 'test', 'cold-start-oneliner-e2e.sh'), reason: 'AC8d target-layout paths (the cold start operates on orchestration/ + docs/analysis/)' },
    { rel: 'plugin/skills/init/SKILL.md', target: path.join(pluginDir, 'skills', 'init', 'SKILL.md'), reason: "mapping table's target column" },
    {
      rel: 'plugin/skills/cold-start/SKILL.md',
      target: path.join(pluginDir, 'skills', 'cold-start', 'SKILL.md'),
      reason: "cold-start skill operates on the TARGET project's laid-down layout (orchestration/ + docs/analysis/) — the AC8d target-layout paths, not the quay plugin/loop paths",
    },
    {
      rel: 'packages/quay/test/install-config-driven-e2e.test.mjs',
      target: path.join(repoRoot, 'packages', 'quay', 'test', 'install-config-driven-e2e.test.mjs'),
      reason: "asserts the laid-down target layout: REQUIRED_PRODUCT_FILES lists the cold-started project's orchestration/ + docs/analysis/ tick-doc paths (the reinstall-gate e2e, landed RED-first; its target-layout references were never added here)",
    },
    {
      rel: 'plugin/loop',
      target: path.join(pluginDir, 'loop'),
      reason: "canonical templates: their /loop prompts and cross-refs use plugin/loop/; the only old-path strings left are in the template-params note documenting the TARGET layout",
    },
    {
      rel: 'packages/quay/plugin',
      target: path.join(repoRoot, 'packages', 'quay', 'plugin'),
      reason: "gitignored pack-time snapshot of plugin/ (package.sh materializes it so the tarball carries the bundle); byte-identical to plugin/, which is excluded above — same old-path strings are target-layout documentation, not live references",
      retainedNote: "kept despite currently inert: the target is a gitignored pack-time snapshot that does NOT exist in a fresh checkout, so the necessity scan sees 0 hits only because no pack has materialized it yet. When a pack IS made, the snapshot is byte-identical to plugin/ (excluded above) and carries the same target-layout old-path strings, so the entry must stay to keep the AC1b scan from flagging the snapshot as a live reference. (oldPaths shrank 6→5 when heavy-op-token.sh was retired 2026-08-06, which left the entry inert until the next pack.)",
    },
    { rel: 'plugin/test/loop-shipping.test.mjs', target: path.join(pluginDir, 'test', 'loop-shipping.test.mjs'), reason: "this file's own regexes + AC1c snippet array define the old paths" },
    {
      rel: 'plugin/scripts/loop-shipping-exclusion-data.mjs',
      target: path.join(pluginDir, 'scripts', 'loop-shipping-exclusion-data.mjs'),
      reason: "defines the 5 old paths (oldPaths) + the AC1b patterns + this exclusion table — the reference point, not a live caller; mirrors loop-shipping.test.mjs's own self-exclusion",
    },
    {
      rel: 'plugin/test/task-contract-check.test.mjs',
      target: path.join(pluginDir, 'test', 'task-contract-check.test.mjs'),
      reason: "fixtures test the invoke-entry-path criterion with OLD-path invoke commands (historical done tasks); data, not live refs",
    },
    { rel: 'README.md', target: path.join(repoRoot, 'README.md'), reason: "the cold-start section documents the TARGET project's laid-down layout (orchestration/ + docs/analysis/)" },
    {
      rel: 'experiments/quay-perpetual-stream/fixtures/scheduler',
      target: path.join(repoRoot, 'experiments', 'quay-perpetual-stream', 'fixtures', 'scheduler'),
      reason: "replay fixtures (gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet): the eligibility check's OUTPUT embeds the old-path regex patterns as DATA (the replay pins what the scheduler names), not live callers",
    },
    // NOTE: plugin/loop/ is fully excluded: the tick-doc templates legitimately spell the TARGET
    // layout (orchestration/ + docs/analysis/ for a cold-started project). Their own old-path
    // strings are therefore only policed by AC1c's three assertions, and AC1c's liveLines filter
    // drops `>`-blockquote lines, so old paths inside reference/blockquote blocks are NOT scanned
    // here — intentional: blockquotes are documentation of the target layout, not live instructions.
    //
    // The necessity-check invariant (## Contract): every exclusion entry must either suppress a
    // hit of the 5 old-path patterns in its own target (non-inert), or carry a `retainedNote`
    // justifying why it is kept while inert. None of the entries above carry a retainedNote today —
    // every file-level target currently contains at least one old-path pattern hit.
  ];
}
