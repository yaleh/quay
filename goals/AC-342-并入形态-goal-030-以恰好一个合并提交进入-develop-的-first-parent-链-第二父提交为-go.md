---
id: AC-342
title: 并入形态：GOAL-030 以恰好一个合并提交进入 develop 的 first-parent 链，第二父提交为 goal 分支
  tip，且分支上的提交不出现在 first-parent 链上
status: active
kind: criterion
goal: GOAL-030
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  read -r landed tip <<<"$(node -e '(()=>{const fs=require("fs");let s="";try{s=fs.readFileSync(".quay/gate-events.jsonl","utf8")}catch{};let r="";for(const l of s.split("\n")){try{const e=JSON.parse(l);if(e.gate==="goal-merge-result"&&e.item_id==="GOAL-030"&&e.payload&&e.payload.outcome==="landed")r=e.payload.landedSha+" "+e.payload.tipSha}catch{}};process.stdout.write(r)})()')"
  [ -n "${landed:-}" ] || { echo "NOT-EVALUATED: GOAL-030 has no landed goal-merge-result yet (post-merge AC)" >&2; exit 3; }
  fp=$(git rev-list --first-parent develop)
  printf '%s\n' "$fp" | grep -qx "$landed" || { echo "CAUSE=merge-not-on-first-parent — $landed is not on develop's first-parent chain" >&2; exit 1; }
  [ "$(git rev-list --parents -n1 "$landed" | wc -w)" -eq 3 ] || { echo "CAUSE=not-a-merge-commit — $landed does not have exactly two parents" >&2; exit 1; }
  [ "$(git rev-parse "$landed^2")" = "$(git rev-parse "$tip")" ] || { echo "CAUSE=wrong-second-parent — $landed^2 is not the goal tip $tip" >&2; exit 1; }
  leak=$(git rev-list "$landed^1..$tip" | grep -xF -f <(printf '%s\n' "$fp") | head -1)
  [ -z "$leak" ] || { echo "CAUSE=branch-commit-on-first-parent — goal-branch commit $leak appears on develop's first-parent chain" >&2; exit 1; }
  echo "PASS: GOAL-030 entered develop as exactly one merge commit $landed (second parent = goal tip $tip); no goal-branch commit on the first-parent chain"
expect: exit 0 = 恰为一个合并提交且无分支提交混入；exit 1 = 形态不符；exit 3 = 尚未并入。
origin: 人 2026-10-08「现在开始执行…正式创建一个真实的重构 goal，并启用 goal branch」：goal
  分支机制首个真实试点，范围严格限于晋升路径的 todo→ready / ready→todo 两条写入；先验证“在分支上运行 Quay 并验证
  Quay”的自举路径，健康度达标后才进入更大重构。
activatedAt: 2026-10-08T02:34:01.295Z
statusLog:
  - at: 2026-10-08T02:34:01.295Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-08 授权立项并进入 GOAL-030（goal 分支首个真实试点）；承接任务已立并停放（needs-human），激活本
      AC 不会触发乱序自动立案
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-08T02:34:01.295Z
phase: post-merge
---
