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
import { execFileSync } from 'node:child_process';

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
 * The staging-test build-artifact dir NAME prefix. quay-init-laydown-dist-closure.test.mjs's
 * stagePackagedPlugin() stages a packaged-plugin copy at
 * `packages/quay/plugin-staging-<pid>-<counter>/` (INSIDE the repo tree so esbuild resolves yaml;
 * see that file's STAGED_PREFIX rationale). A KILLED run (OOM/interrupt) leaves those dirs behind as
 * orphans — `after()` never runs. walkCorpus must skip them BY NAME exactly like node_modules/.git/
 * dist: it is an fs traversal that does NOT respect gitignore, and an orphan carries a full plugin/
 * copy whose tick-doc old-path strings (loop/orchestrator-loop-tick.md etc.) + scripts/*.ts false-red
 * AC1b/AC2 (2026-08-25: plugin-staging-3477285-{0,1} red, worker hand-deleted to restore).
 * (gap-orphan-staging-dirs-pollute-walkcorpus)
 */
export const stagingDirPrefix = 'plugin-staging-';

/**
 * Absolute paths of every git worktree CONTAINER that the fs-based `walk()` must NOT scan as
 * main-repo content (gap-loop-shipping-scan-does-not-exclude-worktrees).
 *
 * A git worktree is a COMPLETE content copy of the repo (own checkout, own stale-path strings and
 * file copies). `walk()` is an fs traversal that does NOT respect gitignore — without this exclusion
 * an outer-layer agent worktree under `.claude/worktrees/` (or a milestone worktree under
 * `milestones/M<NN>/worktrees/`) is swept into the corpus and its old-path references / second
 * fast-mode-telemetry.ts copy false-red AC1b / AC2.
 *
 * Belt-and-suspenders, two sources:
 *   - `.claude/worktrees/` (the Claude Code subagent-worktree root) is ALWAYS excluded — it can
 *     hold residue (dirs whose `git worktree` registration was removed, e.g. a stale `agent-*`)
 *     that `git worktree list` no longer reports, and an `agent-*` copy is exactly the 2026-08-10
 *     false-red source;
 *   - every NON-main path from `git worktree list --porcelain` is excluded too — registered
 *     worktree copies anywhere (`/home/yale/work/quay-worktrees/*`, `milestones/M<NN>/worktrees/*`,
 *     `/tmp/*`), not just `.claude/worktrees/`.
 *
 * The main repo root is never excluded (that is the tree the scan is FOR).
 *
 * @param {string} repoRoot absolute repo root
 * @returns {Set<string>} absolute container paths
 */
export function worktreeContainerPaths(repoRoot) {
  const root = path.resolve(repoRoot);
  const containers = new Set([path.join(root, '.claude', 'worktrees')]);
  let porcelain = '';
  try {
    porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    // git unavailable / not a git repo — the .claude/worktrees container above is still excluded.
    return containers;
  }
  for (const line of porcelain.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const wt = path.resolve(line.slice('worktree '.length).trim());
    if (wt !== root) containers.add(wt);
  }
  return containers;
}

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
      rel: 'plugin/scripts/outer-anchor-check.ts',
      target: path.join(pluginDir, 'scripts', 'outer-anchor-check.ts'),
      reason: "the AC80 anchor checker's LAYERS.inner.requiredPointers documents the [inner-tick] prompt's required rationale pointer as the CONSUMER-laid docs/analysis/fast-mode-loop-tick.md (gap-ac80-anchor-prompt-consumer-path-fix) — a target-layout reference (quay-init lays the inner tick doc to docs/analysis/), same class as quay-init.sh / cold-start skill",
    },
    {
      rel: 'plugin/test/outer-anchor-check.test.mjs',
      target: path.join(pluginDir, 'test', 'outer-anchor-check.test.mjs'),
      reason: "pins the AC80 INNER_PROMPT (rationale pointer now the consumer-laid docs/analysis/fast-mode-loop-tick.md) + the LAYERS.inner.requiredPointers assertion — target-layout reference, same class as the checker itself",
    },
    {
      rel: 'plugin/test/outer-cron-registry.test.mjs',
      target: path.join(pluginDir, 'test', 'outer-cron-registry.test.mjs'),
      reason: "pins the AC80 INNER_PROMPT constant (rationale pointer now the consumer-laid docs/analysis/fast-mode-loop-tick.md, same prompt as outer-anchor-check.test.mjs) + the sha256/registry assertions — target-layout reference, same class as outer-anchor-check.test.mjs (added when the AC81 anchor recreation flipped the INNER_PROMPT to the consumer-laid pointer, gap-ac80-anchor-prompt-consumer-path-fix)",
    },
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
      rel: 'plugin/skills/manager/SKILL.md',
      target: path.join(pluginDir, 'skills', 'manager', 'SKILL.md'),
      reason: "manager skill's layer table lists where each layer ships IN A CONSUMER project (orchestration/ + docs/analysis/ — the quay-init --loop consumer landing, gap-quay-init-loop-tick-doc-paths-reference-unlanded-plugin-loop). Same target-layout class as cold-start/SKILL.md / init/SKILL.md",
    },
    {
      rel: 'packages/quay/test/install-config-driven-e2e.test.mjs',
      target: path.join(repoRoot, 'packages', 'quay', 'test', 'install-config-driven-e2e.test.mjs'),
      reason: "asserts the laid-down target layout: REQUIRED_PRODUCT_FILES lists the cold-started project's orchestration/ + docs/analysis/ tick-doc paths (the reinstall-gate e2e, landed RED-first; its target-layout references were never added here)",
    },
    {
      rel: 'packages/quay/test/install-config-driven-e2e-runtime.test.mjs',
      target: path.join(repoRoot, 'packages', 'quay', 'test', 'install-config-driven-e2e-runtime.test.mjs'),
      reason: "the RUNTIME-LANDING/BUILD half of the install-config-driven e2e family — split from install-config-driven-e2e.test.mjs by gap-split-three-phase-floor-files (2026-08-12, 6cba27d4; test bodies byte-identical to the pre-split file). productSource() maps the laid-down orchestration/ + docs/analysis/ tick-doc paths back to their plugin/loop/ sources and REQUIRED_PRODUCT_FILES asserts the consumer's laid-down target layout; same target-layout class as the pre-split file excluded above",
    },
    {
      rel: 'packages/quay/test/install-config-driven-e2e-upgrade.test.mjs',
      target: path.join(repoRoot, 'packages', 'quay', 'test', 'install-config-driven-e2e-upgrade.test.mjs'),
      reason: "the UPGRADE/CONFIG-PRESERVATION half of the install-config-driven e2e family — split from install-config-driven-e2e.test.mjs by gap-split-three-phase-floor-files (2026-08-12, 6cba27d4; test bodies byte-identical to the pre-split file). productSource() maps the laid-down orchestration/ + docs/analysis/ tick-doc paths back to their plugin/loop/ sources; same target-layout class as the pre-split file excluded above",
    },
    {
      rel: 'plugin/test/quay-init-loop-consumer-doc-refs.test.mjs',
      target: path.join(pluginDir, 'test', 'quay-init-loop-consumer-doc-refs.test.mjs'),
      reason: "asserts the consumer-laid layout (docs/analysis/ + orchestration/ paths) — the AC37 consumer-doc-refs install family (gap-quay-init-loop-tick-doc-paths-reference-unlanded-plugin-loop). Same target-layout class as install-config-driven-e2e.test.mjs",
    },
    {
      rel: 'plugin/loop',
      target: path.join(pluginDir, 'loop'),
      reason: "canonical templates: their /loop prompts and cross-refs reference the CONSUMER landing (orchestration/ + docs/analysis/ — the paths quay-init lays them to), which are the AC37 'old' path strings; the template-params note spells the same target layout. The docs' cross-refs must NOT use plugin/loop/ (never laid in a consumer)",
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
    {
      rel: 'plugin/test/outer-loop-tick-split.test.mjs',
      target: path.join(pluginDir, 'test', 'outer-loop-tick-split.test.mjs'),
      reason: "the AC38 outer-doc-split test asserts BOTH the plugin/loop/ template AND the orchestration/ deployed instance copy — orchestration/orchestrator-loop-tick.md is the AC38 instance landing (a real materialized deployed copy, excluded above), not a stale source-copy reference; same target-layout class as quay-init-loop-consumer-doc-refs / no-manager-tick-doc-check",
    },
    { rel: 'README.md', target: path.join(repoRoot, 'README.md'), reason: "the cold-start section documents the TARGET project's laid-down layout (orchestration/ + docs/analysis/)" },
    {
      rel: 'docs/proposals/archguard-generation-era-primitives.md',
      target: path.join(repoRoot, 'docs', 'proposals', 'archguard-generation-era-primitives.md'),
      reason: "proposal record (archguard generation-era primitives) — §2.9 分发边界 documents a three-round experiment that edits the DEPLOYED tick-doc copy at orchestration/orchestrator-loop-tick.md via `quay-init.sh --all --loop --root t3` (the consumer target layout), a transcript excerpt of the deployed copy, not a live source-copy reference to the moved mechanism; same target-layout class as quay-init.sh / install-config-driven-e2e.test.mjs",
    },
    {
      rel: 'experiments/quay-perpetual-stream/fixtures/scheduler',
      target: path.join(repoRoot, 'experiments', 'quay-perpetual-stream', 'fixtures', 'scheduler'),
      reason: "replay fixtures (gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet): the eligibility check's OUTPUT embeds the old-path regex patterns as DATA (the replay pins what the scheduler names), not live callers",
    },
    {
      rel: 'orchestration/manager-phase-goal.md',
      target: path.join(repoRoot, 'orchestration', 'manager-phase-goal.md'),
      reason: "manager's operational doc referencing the quay-local deployed outer tick doc at orchestration/orchestrator-loop-tick.md — a real materialized copy (the C3 no-manager-tick-doc checker's quay-local landing, same target-layout class), not a stale reference to a moved mechanism",
      retainedNote: '2026-08-14 拆分后命中随正文迁至 manager-phase-goal-archive.md ⇒ 本条目现压制 0 处；' +
        '保留是因为新 AC 一律写在现行文件（archive 只读），下一个阶段的 AC 会重新产生命中。' +
        '若两个阶段后仍 hits=0，删除本条目。',
    },
    {
      rel: 'orchestration/manager-phase-goal-archive.md',
      target: path.join(repoRoot, 'orchestration', 'manager-phase-goal-archive.md'),
      reason: "read-only historical archive of the pre-split manager-phase-goal — its old-path reference to orchestration/orchestrator-loop-tick.md documents the pre-move drift analysis (plugin 1309 vs orchestration 1164 lines, 954 shared) verbatim; archives are historical records, never live callers",
      retainedNote: '2026-08-14 拆分（4025→723 行）后，archive 保留拆分前的正文，其中 :191 的旧路径引用（orchestrator-loop-tick 漂移实测）是历史记录不是活引用；' +
        'archive 只读（AC58 形态：标注不删），AC1b 扫描不得把它当 live reference。' +
        '若 archive 被删除（历史归档退役），本条目一并删。',
    },
    {
      rel: 'orchestration/archive/AC58-retired-clauses.md',
      target: path.join(repoRoot, 'orchestration', 'archive', 'AC58-retired-clauses.md'),
      reason: "read-only historical archive of retired orchestration clauses — its old-path references to orchestration/orchestrator-loop-tick.md (lines 492/514: the retired B3/B4 batch-merge + D-boundary clause 来源记录) document the retired clauses' source verbatim; archives are historical records, never live callers (same class as manager-phase-goal-archive.md)",
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
      rel: 'plugin/scripts/tick-core-static-check.ts',
      target: path.join(pluginDir, 'scripts', 'tick-core-static-check.ts'),
      reason: "the execution-core static-coverage checker's PROHIBITION_DOCS intentionally includes the deployed outer tick doc at orchestration/orchestrator-loop-tick.md (the boundary table) alongside the deployed execution cores + prohibition docs — it scans the deployed docs the outer loop actually runs against (same target-layout class as instrument-failure-check / no-manager-tick-doc-check, surfaced by the AC1b scan 2026-08-10 on the tick-core-static-check fan-in)",
    },
    {
      rel: 'plugin/scripts/checker-mutation-cases/tick-core-static-check.sh',
      target: path.join(pluginDir, 'scripts', 'checker-mutation-cases', 'tick-core-static-check.sh'),
      reason: "mutation-case fixture whose scan surface MUST match tick-core-static-check.ts PROHIBITION_DOCS (writes the deployed orchestration/orchestrator-loop-tick.md boundary-table doc into its temp root) — the 'must match' invariant makes it a mirror of the checker's deployed-layout surface, same class as checker-mutation-cases/instrument-failure-check.sh",
    },
    {
      rel: 'plugin/test/tick-core-static-check.test.mjs',
      target: path.join(pluginDir, 'test', 'tick-core-static-check.test.mjs'),
      reason: "tests the checker against its deployed-layout scan surface (PROHIBITION_DOCS fixtures incl. orchestration/orchestrator-loop-tick.md written into the baseline root); target-layout reference, same class as instrument-failure-check.test.mjs",
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
    {
      rel: 'plugin/scripts/verify-deliver-coldstart.sh',
      target: path.join(pluginDir, 'scripts', 'verify-deliver-coldstart.sh'),
      reason: "AC88's delivery-verification script — its step2_init (L1 laid-down check) and step3_coldstart probes verify the consumer's TARGET layout (orchestration/orchestrator-loop-tick.md + docs/analysis/fast-mode-loop-tick.md, the paths quay-init --loop lays in a consumer project), so the old-path strings are the verification OBJECT, not stale source-copy references — same class as quay-init.sh / cold-start SKILL / verify-delivery-surface.ts",
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
    { rel: '.quay', target: path.join(repoRoot, '.quay'), reason: "runtime directory (manager-inbox / fan-in-preserve / full-suite-state / gate-events / inner-wakeup-heartbeat etc.) — gitignored but walk() is an fs traversal that does NOT respect gitignore, so the ledger/message files are swept into the corpus and their quoted deployed tick-doc paths (e.g. outer-recovery-ack quoting orchestrator-loop-tick.md) false-red AC1b on the MAIN checkout (the verify-worktree path has no .quay, which is why the workflow passes while main stays red — gap-loop-shipping-ac1b-main-excludes-quay-and-outer-doc-split). Same class as the orchestration/tick-log.md + manager-pending.md runtime-ledger entries above: the runtime files document the DEPLOYED target layout as living reference, not a stale source-copy" },
    {
      rel: 'plugin/test/outer-doc-split.test.mjs',
      target: path.join(pluginDir, 'test', 'outer-doc-split.test.mjs'),
      reason: "asserts the AC38 doc-split target layout — the check verifies no live reference to the 5 old paths remains in the moved docs, so its own AC1b-style assertion strings reference the old paths as the CHECK OBJECT (same target-layout class as quay-init-loop-consumer-doc-refs.test.mjs / install-config-driven-e2e.test.mjs / quay-init-loop.test.mjs — the check exists to police the old paths, so the scan must not flag the check itself as the reference)",
    },
  ];
}
