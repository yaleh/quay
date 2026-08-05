#!/usr/bin/env bash
# laydown-set-check.sh — 冷启动 gate：派生铺设集内脚本全绿（铺什么验什么），非「整个套件绿」。
#
# gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite (2026-08-05).
#
# 缺陷：冷启动 gate 判据用「整个套件绿」，但冷启动只铺「派生铺设集」——任何与铺设集无关的套件
# 失败都会无限期阻塞冷启动。这是与「红窗一刀切停派发」同一根作用域轴上的同型缺陷（交叉标注：
# gap-red-window-dispatch-stop-should-be-shared-gate-conditional——同一作用域轴，不同机制：
# suite-RED 处置 vs 冷启动 gate）。
#
# 正确判据：gate = 派生铺设集内脚本的测试全绿（lay what you verify）。铺设集机械派生——
#   grep plugin/skills/*/SKILL.md + plugin/loop/*.md 里的 `plugin/scripts/*` 引用，
#   与 quay-init.sh 的 DERIVED_SCRIPTS 同一派生源（无手写清单，漂移免疫；不需新机制）。
#
# 输出 stdout 的 `laydown_set_green: green|red` 字段（Contract measure）。
#   退出码: 0 = green（铺设集内测试全绿，可铺）；
#           1 = red（铺设集内某测试失败，阻塞冷启动）；
#           2 = 用法/内部错误。
#
# 负控制（不静默回退到整个套件）：若从铺设集解析出 0 个测试文件，fail-closed 报 red——
#   「铺什么验什么」不允许用「整个套件绿」代替（adversarial-review：gate 不得静默回退到全量）。
# 铺设集内某脚本没有直接测试文件时，报告为 no-test（可见，不阻塞）——只有「解析出的测试失败」
#   才是红。
#
# 用法: bash plugin/scripts/laydown-set-check.sh [--root <dir>] [--list] [--json]
#   --root <dir>  从该目录派生（缺省 $(pwd)；在目标项目里跑时用目标项目根）。
#   --list        只打印派生铺设集（脚本 + 解析出的测试文件 + 无直接测试的脚本），不跑测试
#                 （AC2 机械派生证据 / 调试）。
#   --json        机器可读输出（laydown_set_green 字段 + 明细；脚本名只含 [a-zA-Z0-9._-]，
#                 无 JSON 转义需求）。
set -uo pipefail

ROOT="$(pwd)"
MODE="check"
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="${2:-}"; shift 2 ;;
    --list) MODE="list"; shift ;;
    --json) JSON=1; shift ;;
    *) echo "laydown-set-check: unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$ROOT" ] || [ ! -d "$ROOT/plugin" ]; then
  echo "laydown-set-check: --root must point at a quay repo root (plugin/ missing): $ROOT" >&2
  exit 2
fi

# 机械派生铺设集 —— 与 quay-init.sh `DERIVED_SCRIPTS` 完全相同的 grep/派生源（单源，无第二份手写清单）。
DERIVED="$(grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+' "$ROOT/plugin/skills"/*/SKILL.md "$ROOT/plugin"/loop/*.md 2>/dev/null | sed 's#^plugin/scripts/##' | sort -u || true)"

# 每个派生脚本 → 直接测试文件（basename-pair 约定：<dir>/foo.{ts,sh,mjs,txt} → plugin/test/foo.test.mjs，
# 与 select-tests-for-touches.ts 的 basename 规则同一约定）。
TEST_FILES=()
NO_TEST=()
N_SCRIPTS=0
while IFS= read -r s; do
  [ -n "$s" ] || continue
  N_SCRIPTS=$((N_SCRIPTS + 1))
  base="$s"
  case "$base" in
    *.ts)  base="${base%.ts}" ;;
    *.sh)  base="${base%.sh}" ;;
    *.mjs) base="${base%.mjs}" ;;
    *.txt) base="${base%.txt}" ;;
  esac
  t="plugin/test/${base}.test.mjs"
  if [ -f "$ROOT/$t" ]; then
    TEST_FILES+=("$t")
  else
    NO_TEST+=("$s")
  fi
done <<<"$DERIVED"

# ── --list：只打印派生集，不跑测试（AC2 证据/调试）──────────────────────────────────────────────
if [ "$MODE" = "list" ]; then
  if [ "$JSON" = "1" ]; then
    python3 - "$N_SCRIPTS" "$(printf '%s' "$DERIVED" | tr '\n' ',')" "$(IFS=,; echo "${TEST_FILES[*]}")" "$(IFS=,; echo "${NO_TEST[*]}")" <<'PYEOF'
import json, sys
n, scripts, tests, notests = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
print(json.dumps({
  "derived_scripts": int(n),
  "scripts": [x for x in scripts.split(",") if x],
  "test_files": [x for x in tests.split(",") if x],
  "no_test_scripts": [x for x in notests.split(",") if x],
}))
PYEOF
  else
    echo "derived_scripts: $N_SCRIPTS"
    for s in $DERIVED; do
      base="$s"
      case "$base" in
        *.ts)  base="${base%.ts}" ;;
        *.sh)  base="${base%.sh}" ;;
        *.mjs) base="${base%.mjs}" ;;
        *.txt) base="${base%.txt}" ;;
      esac
      t="plugin/test/${base}.test.mjs"
      if [ -f "$ROOT/$t" ]; then
        echo "  plugin/scripts/$s -> $t"
      else
        echo "  plugin/scripts/$s -> NO-TEST"
      fi
    done
  fi
  exit 0
fi

# ── 负控制：0 个测试文件解析出来 ⇒ fail-closed red，绝不静默回退到整个套件 ──────────────────────
if [ "${#TEST_FILES[@]}" -eq 0 ]; then
  if [ "$JSON" = "1" ]; then
    python3 - "$N_SCRIPTS" "$(IFS=,; echo "${NO_TEST[*]}")" <<'PYEOF'
import json, sys
n, notests = sys.argv[1], sys.argv[2]
print(json.dumps({"laydown_set_green": "red",
  "reason": "0 test files resolved from the derived laydown set — fail-closed; the cold-start gate NEVER falls back to the whole suite",
  "derived_scripts": int(n), "test_files_run": [],
  "no_test_scripts": [x for x in notests.split(",") if x], "pass": 0, "fail": 0}))
PYEOF
  else
    echo "laydown_set_green: red"
    echo "  reason: 0 test files resolved from the derived laydown set ($N_SCRIPTS scripts) — fail-closed; the cold-start gate NEVER falls back to the whole suite"
    echo "  no_test_scripts: ${#NO_TEST[@]} (derived but no direct test — nothing to verify, so the gate cannot go green)"
    for s in "${NO_TEST[@]}"; do echo "    plugin/scripts/$s"; done
  fi
  exit 1
fi

# ── 跑铺设集内测试（串行 --test-concurrency=1：avoid 已知负载敏感族在并发下 flake）──────────────
cd "$ROOT" || exit 2
# 本 gate 可能从另一个 node --test 进程里被调用（冷启动 skill 的演练/测试）——node --test 会向子进程
# 注入 NODE_TEST_CONTEXT=child-v8 / NODE_TEST_WORKER_ID，让嵌套的 `node --test` 误以为自己已是子
# 测试进程（跑 0 个测试、exit 0、摘要为空）。env -u 清掉这两个变量，让嵌套跑成一次全新的顶层测试。
TEST_OUT="$(env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test --test-concurrency=1 "${TEST_FILES[@]}" 2>&1)"
TEST_CODE=$?

# node --test 摘要行（`ℹ pass 2` / `# pass 2` 两种形态）——用「<label> <digits> 到行尾」匹配，避免
# 误吞单个测试名里的 `passes (...)`。解析失败时缺省 0（摘要总在最末，正常总能解析到）。
read -r T_PASS T_FAIL T_CANCEL <<<"$(printf '%s\n' "$TEST_OUT" | python3 -c '
import sys, re
text = sys.stdin.read()
def grab(label):
    m = re.findall(r"(?:^|[^A-Za-z])%s[ \t]+([0-9]+)[ \t]*$" % label, text, re.M)
    return m[0] if m else "0"
print(grab("pass"), grab("fail"), grab("cancelled"))
')"

if [ "$JSON" = "1" ]; then
  python3 - "$N_SCRIPTS" "$(IFS=,; echo "${TEST_FILES[*]}")" "$(IFS=,; echo "${NO_TEST[*]}")" "$T_PASS" "$T_FAIL" "$T_CANCEL" <<'PYEOF'
import json, sys
n, tests, notests, tpass, tfail, tcancel = sys.argv[1:]
print(json.dumps({
  "laydown_set_green": "green" if int(tfail) == 0 else "red",
  "derived_scripts": int(n),
  "test_files_run": [x for x in tests.split(",") if x],
  "no_test_scripts": [x for x in notests.split(",") if x],
  "pass": int(tpass), "fail": int(tfail), "cancelled": int(tcancel),
}))
PYEOF
else
  if [ "$TEST_CODE" -eq 0 ]; then
    echo "laydown_set_green: green"
  else
    echo "laydown_set_green: red"
  fi
  echo "  derived_scripts: $N_SCRIPTS"
  echo "  test_files_run: ${#TEST_FILES[@]} (pass $T_PASS / fail $T_FAIL / cancelled $T_CANCEL)"
  echo "  no_test_scripts: ${#NO_TEST[@]} (reported, not gating)"
  printf '%s\n' "$TEST_OUT" | tail -n 25
fi

if [ "$TEST_CODE" -eq 0 ]; then
  exit 0
else
  exit 1
fi
