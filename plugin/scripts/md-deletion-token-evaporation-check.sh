#!/usr/bin/env bash
# md-deletion-token-evaporation-check.sh — gap-md-deletion-token-evaporation-check
#
# Source-completeness 硬规则（认识论硬规则第 5 条）的第一个产物化：一个提交从 `*.md`
# 净删 ≥50 行时，被删内容的「独有词条集」（删除后仓库零出现的标识符/路径/专名）非空
# 即失败 + 打清单。C17 对照：无产物的纪律今晚被违反 5 次（抽样当全集、关键词法假阳性、
# 来源完备性），有产物的违反 0 次。
#
# 判据形态（manager 三要点，AC3-AC5）：
#   ① 全集不抽样——逐词条验证，不是抽查
#   ② 零出现才算无家——词条在别处仍出现即视为有正本（不追究语义等价）
#   ③ 失败给清单——失败信息输出词条清单本身，不是布尔
#
# 用法：
#   bash plugin/scripts/md-deletion-token-evaporation-check.sh [--check] [--diff <a> <b>]
#     --check        默认：检查最近一个提交（HEAD^..HEAD）的 *.md 净删是否 ≥阈值，
#                    是则对被删内容做词条蒸发检查
#     --diff <a> <b> 检查指定范围 a..b 的 *.md 删除（测试/复现用）
#     --threshold N  净删行数阈值（默认 50）
#   exit 0 = 无蒸发（通过）；1 = 有蒸发（失败 + 清单）；2 = 用法/环境错误
#
# @static-tier always
# @static-object docs/**/*.md CLAUDE.md orchestration/**/*.md README.md

set -uo pipefail

THRESHOLD=50
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || { echo "md-deletion-token-evaporation-check: cannot cd to repo root" >&2; exit 2; }

A=""
B=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) ;;
    --diff) A="$2"; B="$3"; shift 2 ;;
    --threshold) THRESHOLD="$2"; shift ;;
    --root) REPO_ROOT="$2"; cd "$REPO_ROOT" || { echo "cannot cd to --root $REPO_ROOT" >&2; exit 2; } ; shift 2 ;;
    -h|--help) sed -n '1,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "md-deletion-token-evaporation-check: unknown arg $1" >&2; exit 2 ;;
  esac
  shift
done

# ── 确定检查范围 ──────────────────────────────────────────────────────────────
if [ -n "$A" ]; then
  range_a="$A"; range_b="$B"
else
  # 默认 HEAD^..HEAD；merge 提交用第一个父
  range_b="HEAD"
  range_a="HEAD^"
  if ! git rev-parse --verify "$range_a" >/dev/null 2>&1; then
    echo "md-deletion-token-evaporation-check: no parent commit to diff (root commit?); PASS"
    exit 0
  fi
fi

# ── 找 *.md 净删 ≥ 阈值的文件 ────────────────────────────────────────────────
# numstat 每行: <added>\t<deleted>\t<path>（- 表示二进制）
mapfile -t mdnum < <(git diff --numstat "$range_a" "$range_b" -- '*.md' 2>/dev/null || true)

deleted_md_files=()
for line in "${mdnum[@]}"; do
  [ -z "$line" ] && continue
  add="${line%%$'\t'*}"; rest="${line#*$'\t'}"; del="${rest%%$'\t'*}"
  path="${rest#*$'\t'}"
  # 二进制行 add/del 为 '-'
  [[ "$add" =~ ^[0-9]+$ ]] || continue
  [[ "$del" =~ ^[0-9]+$ ]] || continue
  net=$((del - add))
  if [ "$net" -ge "$THRESHOLD" ]; then
    deleted_md_files+=("$path")
  fi
done

if [ "${#deleted_md_files[@]}" -eq 0 ]; then
  echo "md-deletion-token-evaporation-check: PASS — no *.md net-deletion ≥${THRESHOLD} lines in ${range_a}..${range_b}"
  exit 0
fi

# ── 对被删内容做词条抽取 ──────────────────────────────────────────────────────
# 取被删行（diff 的 '-' 行，排除 '---' 文件头）——全集，不抽样
deleted_text="$(git diff "$range_a" "$range_b" -- "${deleted_md_files[@]}" 2>/dev/null \
  | grep '^-[^-]' | sed 's/^-//')"

# 词条形态：反引号标识符、CamelCase 词、路径(a/b/x.ext)、方法调用 foo()、虚线词
# 广度抽取后再过滤：只保留「看起来是标识符」的词条（含大写/虚线/点号/括号），
# 丢弃纯小写散文词（line/this/…），避免负控制误报。
raw_tokens="$(printf '%s\n' "$deleted_text" \
  | grep -oE '\`[^\`]+\`|[A-Za-z_][A-Za-z0-9_.-]{2,}' \
  | sed 's/^`//; s/`$//' \
  | sed 's/[^A-Za-z0-9_]$//' \
  | sort -u)"
tokens="$(printf '%s\n' "$raw_tokens" \
  | grep -E '[A-Z]|[-.]|\(\)' \
  | grep -vE '^(the|and|this|that|with|from|have|will|line|file|files|test|tests|page|section|note|only|also|when|than|then|each|into|over|more|most|were|been|was|has|had|does|done|using|after|before|about|these|those|their|there|other|should|would|could|which|where|what|for|are|not|can|out|its|all|one|two|new|via|per|off|use|used|run|runs|now|here|see|may|must|read|doc|docs|md|txt|png|sh|ts|js|mjs|tsx|json|yml|yaml)$' \
  | sort -u)"

if [ -z "$tokens" ]; then
  echo "md-deletion-token-evaporation-check: PASS — net-deletion ≥${THRESHOLD} but no extractable tokens"
  exit 0
fi

# ── 逐词条验证：零出现才算无家（全集不抽样）──────────────────────────────────
homeless=()
for tok in $tokens; do
  # 跳过纯数字/过短词条（<3 chars 无鉴别力）
  [ "${#tok}" -ge 3 ] || continue
  if [[ "$tok" =~ ^[0-9]+$ ]]; then continue; fi
  # grep 当前工作树（排除 .git 与检查器自身），词条仍出现 = 有正本
  if ! grep -rIl --exclude-dir=.git --exclude-dir=node_modules --exclude="md-deletion-token-evaporation-check.sh" -F "$tok" . >/dev/null 2>&1; then
    homeless+=("$tok")
  fi
done

if [ "${#homeless[@]}" -eq 0 ]; then
  echo "md-deletion-token-evaporation-check: PASS — ${#deleted_md_files[@]} file(s) net-deleted ≥${THRESHOLD} lines, all tokens still present in repo (有正本)"
  exit 0
fi

# ── 失败：输出词条清单（不是布尔）────────────────────────────────────────────
echo "md-deletion-token-evaporation-check: FAIL — ${#homeless[@]} token(s) from the deleted *.md content have ZERO occurrence in the post-delete repo (来源完备性违反：被删内容整段蒸发):"
printf '  %s\n' "${homeless[@]}"
echo "md-deletion-token-evaporation-check:   check whether these identifiers/paths were supposed to have a source-of-truth elsewhere; if the deletion was intentional, the token should exist in its replacement"
exit 1
