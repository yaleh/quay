#!/usr/bin/env bash
# landing-map-check.sh — verify orchestration/context-slimming/p1-landing-map.tsv.
#
# WHAT IT CHECKS (the enumerated set, all of them, with printed counts — hard rule 3
# "枚举，不布尔": a boolean would hide "the object is gone" as "the check failed"):
#
#   A. 覆盖率    map 数据行数 == 快照行数，行号恰为 1..N（无缺口/无重复），
#                且每行第 2 列逐字节等于快照的同号行（映射表是【对着快照】写的，不是臆造的）。
#   B. 无空去向  `awk -F'\t' '$3==""'` 命中 0 行 —— AC1 的字面判据。
#   C. 去向可解析 第 3 列每一个去向都必须真的存在：
#                  CLAUDE.md:标题            → 新 CLAUDE.md 第 1 行是 `# CLAUDE.md`
#                  CLAUDE.md:规则<N>         → 新 CLAUDE.md 有 `^<N>[bc]?\. \*\*`（硬规则项）
#                  CLAUDE.md:<标题文本>      → 新 CLAUDE.md 有 `^## <标题文本>$`
#                  casebook#<锚点>           → docs/epistemology-casebook.md 有 `^## <锚点>$`
#                  archive#R<NN>             → orchestration/archive/AC58-retired-clauses.md 有 `^## R<NN> `
#                  dup:<去向>                → 递归解析该去向
#                解析不出 ⇒ 记 UNRESOLVED（独立取值），**不与 OK 同形**（硬规则 3b）。
#
# DELIBERATELY NOT DONE: 不判断「去向选得对不对」。那是一次判断，由 P1 任务体与 casebook
#   承载；本脚本只判「每一行都有去向，且该去向真的存在」——这是可机械判定的那一半。
#
# 三值输出：每个去向记 OK / UNRESOLVED / NOT-EVALUATED（目标文件缺失时，**不返回 0**）。
#   目标文件缺失 ⇒ exit 2 且摘要里出现 NOT-EVALUATED，绝不静默按 0 处理（硬规则 3b）。
#
# 自检（两条负控制，证明本脚本不是恒绿）：
#   --selfcheck  ① 对一份**故意留空第 3 列**的临时副本跑检查 B ⇒ 必须命中 ≥1 行；
#                ② 对一份**故意写不可解析去向**的临时副本跑检查 C ⇒ 必须记 ≥1 个 UNRESOLVED。
#   未突变 ⇒ 同一套检查在全绿映射表上 0 命中。
#
# Usage: bash orchestration/context-slimming/landing-map-check.sh [--root <repo-root>] [--selfcheck]
# Exit: 0 = 全绿；1 = 有红；2 = 输入缺失/无法评估（NOT-EVALUATED）。

set -uo pipefail

ROOT=""
SELFCHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="${2:-}"; shift 2 ;;
    --selfcheck) SELFCHECK=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "landing-map-check: unknown arg: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$ROOT" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

SNAP="$ROOT/orchestration/context-slimming/baseline/CLAUDE.md.snapshot"
MAP="$ROOT/orchestration/context-slimming/p1-landing-map.tsv"
NEWCLAUDE="$ROOT/CLAUDE.md"
CASEBOOK="$ROOT/docs/epistemology-casebook.md"
ARCHIVE="$ROOT/orchestration/archive/AC58-retired-clauses.md"

missing=0
for f in "$SNAP" "$MAP" "$NEWCLAUDE" "$CASEBOOK" "$ARCHIVE"; do
  if [ ! -f "$f" ]; then echo "NOT-EVALUATED: input absent: $f"; missing=1; fi
done
if [ "$missing" -eq 1 ]; then
  echo "landing-map-check: NOT-EVALUATED — cannot evaluate with absent inputs (NOT a pass, NOT a zero)"
  exit 2
fi

# ── resolver: one destination string → OK / UNRESOLVED ─────────────────────────────
# Prints the verdict on stdout. Never conflates "unresolvable" with "resolved".
resolve_dest() {
  local dest="$1" depth="${2:-0}"
  if [ "$depth" -gt 8 ]; then echo "UNRESOLVED"; return; fi
  case "$dest" in
    dup:*)
      resolve_dest "${dest#dup:}" $((depth + 1))
      ;;
    CLAUDE.md:标题)
      if [ "$(head -1 "$NEWCLAUDE")" = "# CLAUDE.md" ]; then echo "OK"; else echo "UNRESOLVED"; fi
      ;;
    CLAUDE.md:规则*)
      local n="${dest#CLAUDE.md:规则}"
      if /usr/bin/grep -qE "^${n}[bc]?\. \*\*" "$NEWCLAUDE"; then echo "OK"; else echo "UNRESOLVED"; fi
      ;;
    CLAUDE.md:*)
      local h="${dest#CLAUDE.md:}"
      if /usr/bin/grep -qxF -- "## $h" "$NEWCLAUDE"; then echo "OK"; else echo "UNRESOLVED"; fi
      ;;
    casebook#*)
      local a="${dest#casebook#}"
      if /usr/bin/grep -qxF -- "## $a" "$CASEBOOK"; then echo "OK"; else echo "UNRESOLVED"; fi
      ;;
    archive#R*)
      local r="${dest#archive#}"
      if /usr/bin/grep -qE -- "^## ${r} " "$ARCHIVE"; then echo "OK"; else echo "UNRESOLVED"; fi
      ;;
    "")
      echo "UNRESOLVED"
      ;;
    *)
      echo "UNKNOWN-FORM"
      ;;
  esac
}

# ── A. coverage: count / contiguity / text identity ───────────────────────────────
snap_n=$(wc -l < "$SNAP")
map_n=$(wc -l < "$MAP")
gaps=$(awk -F'\t' '$1!=NR {c++} END{print c+0}' "$MAP")
mismatch=$(awk -F'\t' 'NR==FNR{a[FNR]=$0; next} {if (a[$1+0] != $2) c++} END{print c+0}' "$SNAP" "$MAP")

# ── B. AC1 literal predicate ──────────────────────────────────────────────────────
empty_dest=$(awk -F'\t' '$3==""' "$MAP" | wc -l)

# ── C. destination resolvability ──────────────────────────────────────────────────
ok=0; unresolved=0; unknown=0
unresolved_list="$(mktemp)"
# ⚠️ 读法必须是 `IFS= read -r line` + `cut -fN`，**不能是 `IFS=$'\t' read -r a b c d`**：
# TAB 是 IFS 空白字符，bash 的 read 会把【连续 TAB】折叠成一个 ⇒ 第 2 列为空的行（快照里
# 大把空行）会整体左移，把 note 当成 destination（实测：382 行里 43 行被误读为 UNKNOWN-FORM）。
while IFS= read -r mapline; do
  lineno="$(printf '%s' "$mapline" | cut -f1)"
  dest="$(printf '%s' "$mapline" | cut -f3)"
  v="$(resolve_dest "$dest")"
  case "$v" in
    OK) ok=$((ok + 1)) ;;
    UNRESOLVED) unresolved=$((unresolved + 1)); printf '  line %s → %s\n' "$lineno" "$dest" >> "$unresolved_list" ;;
    *) unknown=$((unknown + 1)); printf '  line %s → %s (%s)\n' "$lineno" "$dest" "$v" >> "$unresolved_list" ;;
  esac
done < "$MAP"

echo "landing-map-check @ $ROOT"
echo "  A. snapshot lines      : $snap_n"
echo "     map data lines      : $map_n"
echo "     line-no gaps/dups   : $gaps"
echo "     text mismatches     : $mismatch"
echo "  B. empty-destination   : $empty_dest"
echo "  C. destinations OK     : $ok"
echo "     destinations UNRESOLVED: $unresolved"
echo "     destinations UNKNOWN   : $unknown"
if [ "$unresolved" -gt 0 ] || [ "$unknown" -gt 0 ]; then
  echo "  --- unresolved destinations ---"
  cat "$unresolved_list"
fi
rm -f "$unresolved_list"

verdict=0
[ "$snap_n" = "$map_n" ] || { echo "  FAIL: map row count != snapshot line count"; verdict=1; }
[ "$gaps" = "0" ] || { echo "  FAIL: line numbers are not 1..N"; verdict=1; }
[ "$mismatch" = "0" ] || { echo "  FAIL: col2 text does not match the snapshot line"; verdict=1; }
[ "$empty_dest" = "0" ] || { echo "  FAIL: $empty_dest row(s) have an empty destination column"; verdict=1; }
[ "$unresolved" = "0" ] || { echo "  FAIL: $unresolved destination(s) do not resolve"; verdict=1; }
[ "$unknown" = "0" ] || { echo "  FAIL: $unknown destination(s) use an unknown form"; verdict=1; }

# ── selfcheck: two negative controls (a恒绿 check would pass both) ────────────────
if [ "$SELFCHECK" -eq 1 ]; then
  tmpd="$(mktemp -d)"
  # control 1: deliberately blank col3 on one row
  awk -F'\t' 'BEGIN{OFS="\t"} NR==5 {$3=""} {print}' "$MAP" > "$tmpd/map-empty.tsv"
  n1=$(awk -F'\t' '$3==""' "$tmpd/map-empty.tsv" | wc -l)
  if [ "$n1" -ge 1 ]; then echo "  selfcheck 1 PASS: blanked-col3 fixture caught ($n1 row)"; else echo "  selfcheck 1 FAIL: predicate is dead (blanked col3 not caught)"; verdict=1; fi
  # control 2: deliberately unresolvable destination
  sed -n '6p' "$MAP" | awk -F'\t' 'BEGIN{OFS="\t"} {$3="CLAUDE.md:不存在的节标题"} {print}' > "$tmpd/one.tsv"
  d2=$(awk -F'\t' '{print $3}' "$tmpd/one.tsv")
  v2="$(resolve_dest "$d2")"
  if [ "$v2" = "UNRESOLVED" ]; then echo "  selfcheck 2 PASS: fabricated destination caught (UNRESOLVED)"; else echo "  selfcheck 2 FAIL: resolver accepted a fabricated destination (got: $v2)"; verdict=1; fi
  # control 3 (the other direction): the UNMODIFIED map's row 6 destination must resolve.
  d3=$(sed -n '6p' "$MAP" | awk -F'\t' '{print $3}')
  v3="$(resolve_dest "$d3")"
  if [ "$v3" = "OK" ]; then echo "  selfcheck 3 PASS: real destination on row 6 resolves ($d3)"; else echo "  selfcheck 3 FAIL: real destination did not resolve (got: $v3)"; verdict=1; fi
  rm -rf "$tmpd"
fi

if [ "$verdict" -eq 0 ]; then echo "PASS — every snapshot line has a destination and every destination resolves"; else echo "FAIL — see above"; fi
exit "$verdict"
