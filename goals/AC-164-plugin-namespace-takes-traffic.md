---
id: AC-164
title: 插件命名空间承接生产流量
status: achieved
kind: criterion
goal: GOAL-003
criterion: >-
  root=$(git rev-parse --show-toplevel) || exit 1

  dir="$HOME/.claude/projects/$(printf '%s' "$root" | sed 's|/|-|g')"

  [ -d "$dir" ] || exit 1

  L=$(mktemp); find "$dir" -name '*.jsonl' -mtime -1 > "$L" 2>/dev/null

  n=$(wc -l < "$L")

  [ "$n" -gt 0 ] || { rm -f "$L"; exit 1; }

  a=$(xargs -r -a "$L" grep -oh '"name":"mcp__plugin_quay_quay__[a-z_]*"'
  2>/dev/null | wc -l)

  b=$(xargs -r -a "$L" grep -oh '"name":"mcp__quay__[a-z_]*"' 2>/dev/null | wc
  -l)

  rm -f "$L"

  [ $((a+b)) -gt 0 ] || exit 1

  [ "$a" -gt "$b" ]
expect: exit 0（本项目 transcript 目录 24h 窗口内，按 "name" 字段计的 mcp__plugin_quay_quay__
  真调用数 > mcp__quay__ 真调用数；文件集为空或两者皆 0 时 fail-closed 判假，不与合格同形）
origin: >
  人 2026-09-02 裁定②「本项目自己使用的扩展应当与产品交付的是同一个」。正本

  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §4（顺序不可颠倒——它承载 3 天 178
  次生产流量）。
---

**判据（能取假）**：迁移后一个观测窗口内 `mcp__plugin_quay_quay__*` 调用数 **>** `mcp__quay__*`
（当前是 6 : 178，方向相反）。

**取假**：不迁就不会翻转。


