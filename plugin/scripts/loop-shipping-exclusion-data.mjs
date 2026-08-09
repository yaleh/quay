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
    { rel: 'docs/analysis/batch2-queue-state.md', target: path.join(repoRoot, 'docs', 'analysis', 'batch2-queue-state.md'), reason: "the queue-state's tick records reference the deployed tick-doc target layout (docs/analysis/ + orchestration/ paths) as living documentation — same class as the deployed copies excluded below", retainedNote: "kept despite currently inert (0 hits of the 5 old-path patterns): the queue-state is a GITIGNORED runtime ledger (16:1x rule — never committed, read from disk via tail) whose tick records quote deployed tick-doc commands verbatim. A tick that quotes a deployed tick-doc line (which the AC1b scan sees as a live reference) lands exactly when the next tick appends — so the entry oscillates between inert and live. When a pack/verification run materializes a copy of the target layout, the queue-state's quoted commands carry the same old-path strings and the scan must not flag the ledger itself as the reference. (oldPaths shrank 6→5 on 2026-08-06 with heavy-op-token.sh's retirement, leaving it inert until the next append.)" },
    { rel: 'orchestration/tick-log.md', target: path.join(repoRoot, 'orchestration', 'tick-log.md'), reason: "the outer's running log", retainedNote: "kept despite currently inert (0 hits of the 5 old-path patterns): the outer tick-log is a GITIGNORED runtime ledger (16:1x rule — never committed) whose entries quote the tick-doc/scripts commands the outer actually ran, including deployed-target-layout paths. Each outer tick appends verbatim command text, so the entry oscillates between inert and live exactly as new entries land; when a verification round copies the target layout, the log's quoted commands carry the same old-path strings and must not be flagged as the reference. (oldPaths shrank 6→5 on 2026-08-06 with heavy-op-token.sh's retirement, leaving it inert until the next append.)" },
    { rel: 'orchestration/manager-pending.md', target: path.join(repoRoot, 'orchestration', 'manager-pending.md'), reason: "the manager's pending-task ledger — a GITIGNORED runtime file (16:1x rule — never committed) whose entries quote deployed tick-doc paths (e.g. 'orchestration/orchestrator-loop-tick.md:640') while tracking contradictions against the tick-doc templates. Same class as tick-log.md / batch2-queue-state.md: the ledger documents the DEPLOYED target layout (orchestration/ + docs/analysis/) as living reference, so the AC1b scan must not flag the ledger itself as a stale source-copy reference. Surfaced by AC1b scan 2026-08-08 (fixed-overhead measurement round): manager-pending.md:21 quotes the deployed outer tick-doc path.", retainedNote: "kept despite currently inert in a FRESH checkout (the target is a GITIGNORED runtime ledger — 16:1x rule, never committed — so it does NOT exist in a fresh clone and the necessity scan sees 0 hits only because the file is absent). The manager appends/edits this ledger during operation (tracking pending tasks + tick-doc contradictions), and its entries quote deployed-target-layout paths verbatim; when the manager next writes a quoted deployed tick-doc line the AC1b scan would flag the ledger as a live reference. The entry must stay to keep the scan from mis-attributing the ledger's own quotes — same oscillation class as tick-log.md." },
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
    {
      rel: 'plugin/scripts/adr016-screen-use-check.ts',
      target: path.join(pluginDir, 'scripts', 'adr016-screen-use-check.ts'),
      reason: "ADR-016 screen-use check's MD_TICK_DOCS scans the DEPLOYED tick-doc copies (incl. orchestration/orchestrator-loop-tick.md) for the md5(capture-pane) anti-pattern — a target-layout reference to a live deployed doc, not a stale source-copy reference (surfaced by the AC1b scan 2026-08-09 on the converged tree: the adr016-md5-ban scope-gap fan-in added MD_TICK_DOCS after the exclusion table was built)",
    },
    {
      rel: 'orchestration/orchestrator-tick-core.md',
      target: path.join(repoRoot, 'orchestration', 'orchestrator-tick-core.md'),
      reason: "outer tick 执行核 — references the DEPLOYED copy orchestration/orchestrator-loop-tick.md (1095 lines, excluded above) as its extraction source + (src:N) anchor; the anchor still points at the deployed copy during the parallel-comparison period. Same target-layout class as adr016-screen-use-check.ts (surfaced by the AC1b scan 2026-08-09: the exec-cores landed after the exclusion table was built)",
    },
    {
      rel: 'orchestration/manager-tick-core.md',
      target: path.join(repoRoot, 'orchestration', 'manager-tick-core.md'),
      reason: "manager tick 执行核 — cites deployed-path provenance (orchestration/orchestrator-loop-tick.md:302) for rules it borrowed from the outer doc; references the deployed copy as the live anchor target. Same class as orchestrator-tick-core.md above (surfaced by the AC1b scan 2026-08-09)",
    },
    {
      rel: 'orchestration/manager-tick-log.md',
      target: path.join(repoRoot, 'orchestration', 'manager-tick-log.md'),
      reason: "the manager's running tick log — a GITIGNORED runtime ledger (16:1x rule, never committed) whose historical entries quote deployed tick-doc paths verbatim (orchestrator-loop-tick.md:320/:605). Same class as manager-pending.md / tick-log.md above: the ledger documents the DEPLOYED target layout as living reference (surfaced by the AC1b scan 2026-08-09)",
      retainedNote: "kept despite currently inert in a FRESH checkout (the target is a GITIGNORED runtime ledger — 16:1x rule, never committed — so it does NOT exist in a fresh clone and the necessity scan sees 0 hits only because the file is absent). The manager appends/edits this ledger during operation (its running tick log), and its entries quote deployed tick-doc paths verbatim; when the manager next writes a quoted deployed tick-doc line the AC1b scan would flag the ledger as a live reference. The entry must stay to keep the scan from mis-attributing the ledger's own quotes — same oscillation class as manager-pending.md / tick-log.md.",
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
      rel: 'plugin/scripts/no-manager-tick-doc-check.ts',
      target: path.join(pluginDir, 'scripts', 'no-manager-tick-doc-check.ts'),
      reason: "the C3 manager-step checker SCANS the quay-local deployed outer tick doc at orchestration/orchestrator-loop-tick.md (its DEFAULT_DOCS pair is the shipped template + the quay-local landing — a real file that legitimately lives there), not a stale reference to a moved mechanism",
    },
    {
      rel: 'plugin/test/no-manager-tick-doc-check.test.mjs',
      target: path.join(pluginDir, 'test', 'no-manager-tick-doc-check.test.mjs'),
      reason: "asserts the checker scans BOTH the shipped template and the quay-local deployed outer tick doc — target-layout reference, same class as the checker itself",
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
    {
      rel: 'orchestration/manager-phase-goal.md',
      target: path.join(repoRoot, 'orchestration', 'manager-phase-goal.md'),
      reason: "manager's operational doc referencing the quay-local deployed outer tick doc at orchestration/orchestrator-loop-tick.md — a real materialized copy (the C3 no-manager-tick-doc checker's quay-local landing, same target-layout class), not a stale reference to a moved mechanism",
    },
    {
      rel: 'plugin/scripts/instrument-failure-check.ts',
      target: path.join(pluginDir, 'scripts', 'instrument-failure-check.ts'),
      reason: "the instrument's ## Contract scan surface (DEFAULT_SURFACE) intentionally includes the deployed tick-doc copies (orchestration/ + docs/analysis/) alongside the canonical plugin/loop/ copies — it scans the layout consumers actually receive, not a stale source-copy reference",
    },
    {
      rel: 'plugin/scripts/checker-mutation-cases/instrument-failure-check.sh',
      target: path.join(pluginDir, 'scripts', 'checker-mutation-cases', 'instrument-failure-check.sh'),
      reason: "mutation-case fixture whose scan surface MUST match instrument-failure-check.ts DEFAULT_SURFACE (the 'must match' invariant makes it a mirror of the instrument's deployed-layout surface)",
    },
    {
      rel: 'plugin/test/instrument-failure-check.test.mjs',
      target: path.join(pluginDir, 'test', 'instrument-failure-check.test.mjs'),
      reason: "tests the instrument against its deployed-layout scan surface (copySurfaceTo copies DEFAULT_SURFACE incl. the orchestration/ deployed copies); target-layout reference, same class as the instrument itself",
    },
    {
      rel: 'plugin/test/quay-init-loop.test.mjs',
      target: path.join(pluginDir, 'test', 'quay-init-loop.test.mjs'),
      reason: "asserts quay-init's DEPLOYED layout — quay-init.sh lays tick docs at orchestration/orchestrator-loop-tick.md + docs/analysis/fast-mode-loop-tick.md (target layout); the assertion verifies the consumer workspace tracks the deployed copies, not a stale source-copy reference",
    },
    {
      rel: 'plugin/scripts/verify-delivery-surface.ts',
      target: path.join(pluginDir, 'scripts', 'verify-delivery-surface.ts'),
      reason: "consumer-laid target layout reference — verify-delivery-surface.ts's LAID_MANIFEST deliverables intentionally reference the consumer's laid tick-doc paths (orchestration/orchestrator-loop-tick.md + docs/analysis/fast-mode-loop-tick.md, added by gap-verify-delivery-surface-checks-source-layout-not-consumer-laid; --layout laid verifies a quay-init --loop consumer's orchestration/ + docs/analysis/ copies) — same class as adr016-screen-use-check / no-manager-tick-doc-check / instrument-failure-check",
      retainedNote: "kept despite possibly inert in a SOURCE-only checkout (develop pre-fan-in): the LAID_MANIFEST consumer-laid deliverables only exist when the consumer-laid manifest is present — the main-checkout state the AC1b scan flags. In that state the deliverables carry the old tick-doc paths VERBATIM and AC1b would flag the checker as a live reference; the reference is INTENTIONAL (the laid-layout completeness check validates the consumer's deployed copies, not a stale source-copy). The entry oscillates between inert (source-only checkout) and live (consumer-laid manifest present) — same oscillation class as the batch2-queue-state / tick-log / manager-pending entries",
    },
    // NOTE: plugin/loop/ is fully excluded: the tick-doc templates legitimately spell the TARGET
    // layout (orchestration/ + docs/analysis/ for a cold-started project). Their own old-path
    // strings are therefore only policed by AC1c's three assertions, and AC1c's liveLines filter
    // drops `>`-blockquote lines, so old paths inside reference/blockquote blocks are NOT scanned
    // here — intentional: blockquotes are documentation of the target layout, not live instructions.
    //
    // The necessity-check invariant (## Contract): every exclusion entry must either suppress a
    // hit of the 5 old-path patterns in its own target (non-inert), or carry a `retainedNote`
    // justifying why it is kept while inert. All file-level targets above contain at least one
    // old-path pattern hit EXCEPT the verify-delivery-surface.ts entry, which carries a retainedNote:
    // its old-path references live in LAID_MANIFEST (consumer-laid deliverables) that is absent from
    // a SOURCE-only checkout but present in the main-checkout state the AC1b scan flags.
  ];
}
