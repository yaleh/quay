---
id: AC-347
title: 结构与范围护栏：kernel/verdict-parse.ts 提供
  parseBinaryVerdict，两个旧函数薄包装、调用方零改动，routine-quota 文件未被触碰
status: achieved
kind: criterion
goal: GOAL-032
criterion: >-
  set -u


  # ── WHY THIS CRITERION IS RE-ANCHORED (AC-347, 2026-10-20)
  ────────────────────────────

  # The previous criterion pinned the delegation to the literal path

  # `packages/quay/src/criterion-fidelity.ts` and judged PASS on 2026-10-09.

  # Commit 35dc5da93 ("refactor(core): sink the gate substrate into src/core to
  break

  # the '' <-> gate directory SCC") then moved the implementation DOWN to

  # `packages/quay/src/core/criterion-fidelity.ts` and left the src-root file as
  a pure

  # forwarding re-export. The guarantee did not regress — the criterion's PATH
  PIN did.

  # ⇒ This criterion states "the thin wrapper exists and delegates"
  POSITION-INDEPENDENTLY:

  #   exactly ONE `export function parseFidelityVerdict` definition under
  packages/quay/src,

  #   and that file calls parseBinaryVerdict. If the file moves again, this
  still measures

  #   the same guarantee instead of the same string of paths.

  # ⛔ Do NOT move the implementation back to the src root: the forwarding
  structure is

  #    precisely what breaks the src-root <-> gate directory SCC. This criterion
  must not be

  #    made green by pasting `parseBinaryVerdict` into the forwarding file
  either.


  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"


  # 硬规则 2 — 按位置判定，不按关键词：a mention of `parseBinaryVerdict` in a comment or in

  # an import line is NOT delegation. Strip full-line comments, then require
  CALL syntax

  # (`parseBinaryVerdict(`), so the predicate fails on a file that merely names
  the kernel.

  code_only() { grep -vE '^[[:space:]]*(//|/\*|\*)' "$1"; }


  # a. kernel canonical implementation (position: kernel is the fixed placement,
  pinned on purpose)

  f="packages/quay/src/kernel/verdict-parse.ts"

  [ -f "$f" ] || { echo "NOT-EVALUATED: $f not found" >&2; exit 3; }

  grep -q "export function parseBinaryVerdict" "$f" || { echo
  "CAUSE=no-canonical-function — kernel verdict-parse.ts missing
  parseBinaryVerdict export" >&2; exit 1; }

  grep -nE "^import" "$f" | grep -vE 'from ["'"'"']\./|from ["'"'"']node:' && {
  echo "CAUSE=kernel-boundary-violation — verdict-parse.ts imports outside
  kernel/bare specifiers" >&2; exit 1; }


  # b. fidelity thin wrapper, POSITION-INDEPENDENT: exactly ONE definition under
  packages/quay/src

  defs=$(grep -rl --include='*.ts' -E '^export function parseFidelityVerdict'
  packages/quay/src 2>/dev/null)

  n=$(printf '%s\n' "$defs" | sed '/^$/d' | wc -l)

  [ "$n" -eq 1 ] || { echo "CAUSE=fidelity-not-thin-wrapper-or-duplicated —
  expected exactly 1 'export function parseFidelityVerdict' definition under
  packages/quay/src, found $n (0 = function deleted; >=2 = half-moved shell or
  duplicate implementation)" >&2; exit 1; }

  fid="$defs"

  code_only "$fid" | grep -q "parseBinaryVerdict(" || { echo
  "CAUSE=fidelity-not-delegated — $fid does not CALL parseBinaryVerdict (a
  mention in a comment or an import alone is not delegation)" >&2; exit 1; }


  # c. the delegation call site in that same file is verbatim unchanged

  grep -q "parseFidelityVerdict(res.stdout, res.exitCode)" "$fid" || { echo
  "CAUSE=fidelity-caller-changed — criterionFidelityVerdict's call site must be
  unchanged" >&2; exit 1; }


  # d. the public import surface is unbroken: the src-root path still forwards
  to core/

  pub="packages/quay/src/criterion-fidelity.ts"

  grep -q 'export \* from "./core/criterion-fidelity.ts"' "$pub" || { echo
  "CAUSE=fidelity-public-import-surface-broken — $pub must keep forwarding to
  ./core/criterion-fidelity.ts" >&2; exit 1; }


  # e. goal-driver: canonical parse imported, thin wrapper kept, call site
  unchanged

  gd="plugin/scripts/goal-driver.ts"

  [ -f "$gd" ] || { echo "NOT-EVALUATED: $gd not found" >&2; exit 3; }

  code_only "$gd" | grep -q "parseBinaryVerdict(" || { echo
  "CAUSE=sufficiency-not-delegated — goal-driver.ts does not CALL
  parseBinaryVerdict (import/comment mention only)" >&2; exit 1; }

  grep -q "export function parseSemanticSufficiencyVerdict" "$gd" || { echo
  "CAUSE=sufficiency-signature-removed — parseSemanticSufficiencyVerdict must
  still exist" >&2; exit 1; }

  grep -q "parseSemanticSufficiencyVerdict(r.stdout, r.status)" "$gd" || { echo
  "CAUSE=sufficiency-caller-changed — sampleSemanticSufficiency's call site must
  be unchanged" >&2; exit 1; }


  # f. scope guard: routine-quota files remain untouched vs develop.

  #    Three-state (硬规则 3b): without the `develop` ref this range cannot be
  evaluated at all,

  #    so say NOT-EVALUATED instead of letting a failed `git diff` read as
  "clean".

  git rev-parse --verify -q develop >/dev/null || { echo "NOT-EVALUATED: ref
  'develop' not found — routine-quota scope guard cannot be evaluated" >&2; exit
  3; }

  for bad in plugin/scripts/drivers.yml plugin/scripts/driver-config.ts
  plugin/scripts/routine-file-gate.ts plugin/scripts/probe-routine.ts; do
    [ -n "$(git diff develop -- "$bad" 2>/dev/null)" ] && { echo "CAUSE=touched-routine-quota-file — $bad is out of scope for this goal" >&2; exit 1; }
  done


  echo "PASS: kernel/verdict-parse.ts exports parseBinaryVerdict; exactly one
  parseFidelityVerdict definition ($fid) delegates to it with its call site
  unchanged; src root still forwards to core/; goal-driver delegates and keeps
  its signature/call site; routine-quota files untouched"
expect: exit 0 = kernel 正本落地、packages/quay/src 下恰好一个 parseFidelityVerdict
  定义且真正调用 parseBinaryVerdict、调用点不变、src 根仍转发 core/、goal-driver 三项成立、routine-quota
  未触碰；exit 1 = CAUSE= 指明具体哪一条（no-canonical-function / kernel-boundary-violation
  / fidelity-not-thin-wrapper-or-duplicated / fidelity-not-delegated /
  fidelity-caller-changed / fidelity-public-import-surface-broken /
  sufficiency-not-delegated / sufficiency-signature-removed /
  sufficiency-caller-changed / touched-routine-quota-file）；exit 3 =
  NOT-EVALUATED（不在 git 仓库内 / kernel 文件缺失 / goal-driver 缺失 / develop ref 缺失）
origin: GOAL-032 结构护栏，见 goal body「范围与非目标」
activatedAt: 2026-10-09T01:55:06.628Z
statusLog:
  - at: 2026-10-09T01:55:06.628Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-09T02:19:09.707Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-09T01:55:06.628Z
---
