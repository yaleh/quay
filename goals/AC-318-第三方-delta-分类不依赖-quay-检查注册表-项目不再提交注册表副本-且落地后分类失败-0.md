---
id: AC-318
title: 第三方 delta 分类不依赖 quay 检查注册表——项目不再提交注册表副本，且落地后分类失败 = 0
status: active
kind: criterion
goal: GOAL-027
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: 不在
  git 仓库内" >&2; exit 3; }

  cd "$root"

  T="${QUAY_THIRD_PARTY_ROOT:-/data/home/yale/work/claudecodeui}"

  [ -d "$T/.quay" ] || { echo "NOT-EVALUATED: 第三方项目不存在：$T（用
  QUAY_THIRD_PARTY_ROOT 指定）" >&2; exit 3; }

  [ -e "$T/packages/quay-native" ] && { echo "NOT-EVALUATED: $T 是 quay
  自身形态，不是第三方项目" >&2; exit 3; }

  if git -C "$T" ls-files --error-unmatch plugin/scripts/runner-static-gate.ts
  >/dev/null 2>&1; then
    echo "CAUSE=第三方项目仍提交着 quay 的检查注册表副本 plugin/scripts/runner-static-gate.ts（模仿 quay 形态才能分类，契约未声明化）" >&2; exit 1
  fi

  since=$(git log develop
  --grep='gap-fan-in-delta-classify-declared-doc-surfaces' --format=%cI
  2>/dev/null | tail -1)

  [ -n "$since" ] || { echo "CAUSE=delta 分类声明化尚未落地 develop（没有提及
  gap-fan-in-delta-classify-declared-doc-surfaces 的提交）" >&2; exit 1; }

  python3 - "$T/.quay" "$since" <<'P'

  import glob, json, os, sys

  from datetime import datetime

  d, since = sys.argv[1], datetime.fromisoformat(sys.argv[2])

  ok = failed = 0

  for f in glob.glob(os.path.join(d, "fan-in-*.log")):
      for line in open(f, encoding="utf-8", errors="replace"):
          if '"step":"delta"' not in line:
              continue
          try:
              r = json.loads(line)
              ts = datetime.fromisoformat(str(r["ts"]).replace("Z", "+00:00"))
          except Exception:
              continue
          if r.get("step") != "delta" or ts <= since:
              continue
          if "classify failed" in str(r.get("reason", "")):
              failed += 1
          else:
              ok += 1
  print(f"窗口 >{since.isoformat()}：delta 分类成功={ok} 分类失败={failed}")

  if ok + failed == 0:
      sys.stderr.write("NOT-EVALUATED: 落地后该第三方项目尚无 fan-in delta 判定，窗口内无样本\n"); sys.exit(3)
  if failed:
      sys.stderr.write(f"CAUSE=落地后仍有 {failed} 次 delta 分类失败（回落为无条件跑全量 suite）\n"); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0（第三方项目未跟踪 plugin/scripts/runner-static-gate.ts，且实现落地后其 fan-in 日志里
  delta 判定 ≥1 次、classify failed 0 次）；窗口无样本 ⇒ exit 3
origin: 立条依据：2026-09-23 对第三方项目
  /data/home/yale/work/claudecodeui（CloudCLI，2026-09-20→09-23，worker-driven
  inner，142 条任务）的驱动过程复盘。人 2026-09-23 裁定：「本仓库形态靠文件是否存在来判断」立为 goal，第 1/2/6 项作为其实例
  task，其余缺陷立独立 task（「按你的意见执行」）。 对应 GOAL-027 范围③；复盘第 2 项的遗留部分（上游 caeca6f9c 只修了
  ff-merge 证书闸，fan-in 第 4 步仍在 worktree 里找注册表）。
activatedAt: 2026-10-01T18:07:03.567Z
statusLog:
  - at: 2026-10-01T18:07:03.567Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-01T18:07:03.567Z
---
**判据（能取假）**：①第三方项目 git 里不再跟踪 `plugin/scripts/runner-static-gate.ts`（证明不是靠模仿 quay 形态过关）；②`gap-fan-in-delta-classify-declared-doc-surfaces` 落地 develop 之后，第三方 `.quay/fan-in-*.log` 中 `step:"delta"` 的记录至少 1 条，且 reason 含 `classify failed` 的为 0 条。

**取假**：落笔当轮在 claudecodeui 上 exit 1（仍跟踪注册表副本）。伪造落地时刻重放：成功 166 / 失败 11 ⇒ exit 1。