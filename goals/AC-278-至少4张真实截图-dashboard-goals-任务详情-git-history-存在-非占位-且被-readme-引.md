---
id: AC-278
title: 至少4张真实截图（Dashboard/Goals/任务详情/Git History）存在、非占位、且被 README 引用
status: achieved
kind: criterion
goal: GOAL-021
criterion: >-
  bash -c '

  DIR="docs/screenshots"

  REQUIRED="dashboard goals task-detail git-history"

  if [ ! -d "$DIR" ]; then echo "CAUSE=screenshots-dir-absent — $DIR does not
  exist yet" >&2; exit 1; fi

  missing=""

  tiny=""

  for name in $REQUIRED; do
    f=$(ls "$DIR"/*"$name"*.png 2>/dev/null | head -1)
    if [ -z "$f" ]; then missing="$missing $name"; continue; fi
    size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null)
    if [ -z "$size" ] || [ "$size" -lt 5000 ]; then tiny="$tiny $name(${size}b)"; fi
  done

  if [ -n "$missing" ]; then echo "CAUSE=screenshots-missing — no PNG matching
  these names found under $DIR:$missing" >&2; exit 1; fi

  if [ -n "$tiny" ]; then echo "CAUSE=screenshots-too-small — likely
  failed/blank capture (<5000 bytes):$tiny" >&2; exit 1; fi

  refcount=0

  for name in $REQUIRED; do
    f=$(ls "$DIR"/*"$name"*.png 2>/dev/null | head -1)
    base=$(basename "$f")
    if grep -qF "$base" README.md; then refcount=$((refcount+1)); fi
  done

  if [ "$refcount" -lt 4 ]; then echo "CAUSE=readme-references-incomplete — only
  $refcount/4 screenshot files are referenced by filename in README.md" >&2;
  exit 1; fi

  exit 0

  '
expect: exit 0 = docs/screenshots/ 下存在匹配 dashboard/goals/task-detail/git-history
  四个名字的 PNG，每个 ≥5000 字节（排除失败/空白截图），且全部 4 个文件名被 README.md 按文件名引用。exit 1 且 stderr
  带 CAUSE=：screenshots-dir-absent（目录不存在）/ screenshots-missing（缺具体某张）/
  screenshots-too-small（疑似失败截图）/ readme-references-incomplete（截图存在但 README
  没引用全）。
origin: manager 2026-09-16 激活，随 GOAL-021 一并生效
activatedAt: 2026-09-16T23:33:23.618Z
statusLog:
  - at: 2026-09-16T23:33:23.618Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-17T00:52:08.675Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-09-16T23:33:23.617Z
---
