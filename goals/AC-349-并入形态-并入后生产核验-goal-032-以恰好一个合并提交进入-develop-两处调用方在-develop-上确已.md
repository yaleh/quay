---
id: AC-349
title: 并入形态 + 并入后生产核验：GOAL-032 以恰好一个合并提交进入 develop，两处调用方在 develop 上确已委托给 kernel
status: achieved
kind: criterion
goal: GOAL-032
criterion: |-
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  pair=$(node -e '(()=>{const fs=require("fs");let s="";try{s=fs.readFileSync(".quay/gate-events.jsonl","utf8")}catch{};let r="";for(const l of s.split("\n")){try{const e=JSON.parse(l);if(e.gate==="goal-merge-result"&&e.item_id==="GOAL-032"&&e.payload&&e.payload.outcome==="landed")r=e.payload.landedSha+" "+e.payload.tipSha}catch{}};process.stdout.write(r)})()')
  [ -n "$pair" ] || { echo "NOT-EVALUATED: GOAL-032 has no landed goal-merge-result yet (post-merge AC)" >&2; exit 3; }
  landed=${pair%% *}; tip=${pair##* }
  fpf=$(mktemp /tmp/goal032-fp.XXXXXX); trap 'rm -f "$fpf"' EXIT
  git rev-list --first-parent develop > "$fpf"
  grep -qx "$landed" "$fpf" || { echo "CAUSE=merge-not-on-first-parent — $landed is not on develop's first-parent chain" >&2; exit 1; }
  [ "$(git rev-list --parents -n1 "$landed" | wc -w)" -eq 3 ] || { echo "CAUSE=not-a-merge-commit — $landed does not have exactly two parents" >&2; exit 1; }
  [ "$(git rev-parse "$landed^2")" = "$(git rev-parse "$tip")" ] || { echo "CAUSE=wrong-second-parent — $landed^2 is not the goal tip $tip" >&2; exit 1; }
  leak=$(git rev-list "$landed^1..$tip" | grep -xF -f "$fpf" | head -1)
  [ -z "$leak" ] || { echo "CAUSE=branch-commit-on-first-parent — goal-branch commit $leak appears on develop's first-parent chain" >&2; exit 1; }
  # ── RE-ANCHOR (AC-349, gap-ac349-criterion-reanchor-after-core-sink) ─────────────────────────────
  # 下面这一段此前钉的是【路径】：`packages/quay/src/criterion-fidelity.ts` 必须含 `parseBinaryVerdict`。
  # 提交 35dc5da93（"refactor(core): sink the gate substrate into src/core …"）把实现整体下沉到
  # `packages/quay/src/core/criterion-fidelity.ts`，src 根同名文件改为纯转发 re-export
  # （`export * from "./core/criterion-fidelity.ts";`）。代码没退化，判据却因路径钉转红。
  # ⇒ 被测量的保证本身与【实现落在哪个文件】无关，所以判据改成位置无关：在 develop 的
  #    `packages/quay/src` 里 `export function parseFidelityVerdict(` 的定义【恰好一处】，且那一处
  #    委托给 kernel 的 `parseBinaryVerdict`。一条定义 = 没有半搬壳/重复实现（0 = 函数被删，
  #    ≥2 = 复制）；委托 = 保证仍成立。
  # ⛔ 不得靠往 src 根转发文件里塞 `parseBinaryVerdict` 字样来“修绿”：那会让转发文件看起来像实现，
  #    而判据读的是【唯一一处定义】所在的文件，不是任意含有该字样的文件。
  # ⛔ 不要改回具体路径：下一次合法的分层移动会再次让判据转红，而代码是对的。
  fid_defs=$(git grep -l -E '^export function parseFidelityVerdict\(' develop -- packages/quay/src)
  fid_count=$(printf '%s\n' "$fid_defs" | sed '/^$/d' | wc -l)
  [ "$fid_count" -eq 1 ] || { echo "CAUSE=fidelity-not-thin-wrapper-or-duplicated — expected exactly 1 'export function parseFidelityVerdict(' definition under packages/quay/src on develop, found $fid_count" >&2; exit 1; }
  fid_path=${fid_defs#develop:}
  git show "develop:$fid_path" | grep -q 'parseBinaryVerdict' || { echo "CAUSE=production-not-delegated-fidelity — develop's $fid_path does not delegate to the kernel parser" >&2; exit 1; }
  # sufficiency 调用方同样以 develop ref 读，不信工作树里的同名文件。
  git show develop:plugin/scripts/goal-driver.ts | grep -q 'parseBinaryVerdict' || { echo "CAUSE=production-not-delegated-sufficiency — develop's goal-driver.ts does not delegate" >&2; exit 1; }
  # 公共导入面：src 根路径仍是转发 re-export（外部消费者按该路径 import）。
  git show develop:packages/quay/src/criterion-fidelity.ts | grep -q 'export \* from "./core/criterion-fidelity.ts"' || { echo "CAUSE=fidelity-public-import-surface-broken — develop's src-root criterion-fidelity.ts is no longer the forwarding re-export" >&2; exit 1; }
  echo "PASS: GOAL-032 landed as exactly one merge commit (second parent = goal tip); develop's single parseFidelityVerdict definition and goal-driver both delegate to the kernel parser, and the src-root path is still the forwarding re-export"
expect: exit 0 = 合并形态正确、develop 上 parseFidelityVerdict 定义唯一且委托 kernel 的
  parseBinaryVerdict、goal-driver 亦委托、src 根路径仍为转发 re-export；exit 1 = CAUSE=
  指明哪一项（merge-not-on-first-parent | not-a-merge-commit | wrong-second-parent |
  branch-commit-on-first-parent | fidelity-not-thin-wrapper-or-duplicated |
  production-not-delegated-fidelity | production-not-delegated-sufficiency |
  fidelity-public-import-surface-broken）；exit 3 = 尚未并入（无 landed
  goal-merge-result）或不在 git 仓库
origin: GOAL-032 并入验收，同构 AC-342/AC-345
activatedAt: 2026-10-09T01:55:10.012Z
statusLog:
  - at: 2026-10-09T01:55:10.012Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-09T03:14:01.006Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-09T01:55:10.011Z
phase: post-merge
---
