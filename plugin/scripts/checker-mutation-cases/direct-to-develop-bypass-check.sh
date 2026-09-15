#!/usr/bin/env bash
# Mutation case for direct-to-develop-bypass-check (gap-direct-to-develop-bypasses-fan-in-gates,
# 11b/C17 写所有权/越权直改面). Fixture: a temp git repo where develop has ONLY design-internal
# direct commits (.gitignore) → GREEN. Inject: a direct commit touching a CODE/ASSERTION-surface
# file (plugin/test/x.test.mjs) → the checker MUST go RED (直接提交 develop 绕过 fan-in 机件).
# Restore: reset away the code-surface commit → GREEN. The missing lock-events file is the
# vacuous "no lock holds" state (the checker's own documented semantics — the reflog `commit:`
# action is the primary signal).
#
# ── 落地词汇表的两个方向（gap-ac194-reflog-action-vocabulary-incomplete）────────────────────────
# 旧词汇表是**拼法白名单**（`push` | `/Fast-forward/`）⇒ 生产出现第三种 ref-level 落地拼法
# `branch: Reset to`（`git branch -f develop <t>`）时条条落进 unclassifiable ⇒ 硬规则③b fail-closed
# ⇒ AC-194 `expect: exit 0` 结构上不可达。本 case 把两个方向都钉成常驻证据（⛔ 缺一个就不能取假）：
#   ② refMove（`branch: Reset to`）落地【代码面】⇒ 仍是 ref-level 落地（不创建 commit）⇒ 必须 GREEN。
#      词汇表若被收窄回白名单，这一支立刻 RED。
#   ③ 读不懂的 action 形（`git update-ref -m <任意文本>`）⇒ 必须 NOT-EVALUATED（exit 3），且 reason
#      **逐字点名该形**（旧版只报 unclassifiable-commits-in-range 计数 ⇒ 下一个人要从计数反推）。
# 实测原文（git 2.43.0）：`git branch -f <已存在 b> <t>` ⇒ `branch: Reset to <t>`；
# `git update-ref -m <msg> <ref> <sha>` ⇒ `<msg>`。⚠️ `git branch -f <b>` 只在 <b> 未被检出时允许
# ⇒ 这两支先 `git checkout --detach`。
set -u
name="direct-to-develop-bypass-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="${workdir}/repo"

rm -rf "${repo}"
mkdir -p "${repo}"

git() { command git -C "${repo}" "$@"; }

# ── seed the repo: develop with a design-internal direct commit (.gitignore) ────────────────────────
git init -q
git config user.name "mutation-test"
git config user.email "mt@example.com"
git branch -M develop
printf '.quay/\n' > "${repo}/.gitignore"
git add -A
GIT_AUTHOR_DATE="2026-08-01T00:00:00Z" GIT_COMMITTER_DATE="2026-08-01T00:00:00Z" \
  git commit -q -m "chore: gitignore"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/direct-to-develop-bypass-check.ts" \
    --root "${repo}" >/dev/null 2>&1
}

# 退出码 + JSON 读数分开取（bash 里同时拿两者要么靠临时文件、要么跑两次——两次更清楚，单次 ~0.4s）。
checker_json() {
  node --no-warnings --experimental-strip-types "${checker_dir}/direct-to-develop-bypass-check.ts" \
    --root "${repo}" --json 2>/dev/null
}

# GREEN baseline: only a design-internal direct commit → exit 0.
if checker_cmd; then :; else
  echo "baseline RED on design-internal-only direct commit (checker always-red?)" >&2
  exit 4
fi

# INJECT: a direct commit touching a code/assertion-surface file → MUST go RED.
mkdir -p "${repo}/plugin/test"
printf 'export const x = 1;\n' > "${repo}/plugin/test/x.test.mjs"
git add -A
GIT_AUTHOR_DATE="2026-08-02T00:00:00Z" GIT_COMMITTER_DATE="2026-08-02T00:00:00Z" \
  git commit -q -m "test: direct code commit"
if checker_cmd; then
  echo "mutation NOT caught: a direct commit to plugin/test/x.test.mjs stayed GREEN (直接提交绕过 fan-in 机件未报)" >&2
  exit 1
fi

# RESTORE: reset away the code-surface commit → GREEN again.
git reset -q --hard HEAD~1
if checker_cmd; then :; else
  echo "RESTORE still RED after removing the mutation (checker stuck red?)" >&2
  exit 4
fi

# ── ② refMove 形（`branch: Reset to`，第三种实测落地拼法）落地代码面 ⇒ 必须仍 GREEN ──────────────
# 只把 develop ref 移到**已存在的** commit、不创建 commit ⇒ 与 fan-in push / merge --ff-only 同类。
git checkout -q --detach
mkdir -p "${repo}/plugin/scripts"
printf 'export const cs = 1;\n' > "${repo}/plugin/scripts/cs.ts"
git add -A
GIT_AUTHOR_DATE="2026-08-03T00:00:00Z" GIT_COMMITTER_DATE="2026-08-03T00:00:00Z" \
  git commit -q -m "feat: code-surface committed on a side head, landed by ref move"
side_sha="$(git rev-parse HEAD)"
git branch -f develop "${side_sha}"
reflog_line="$(git reflog show develop --format=%gs | head -1)"
case "${reflog_line}" in
  "branch: Reset to "*) : ;;
  *) echo "FIXTURE: expected 'branch: Reset to <t>' reflog form, got '${reflog_line}'" >&2; exit 4 ;;
esac
if checker_cmd; then :; else
  echo "refMove vocabulary too narrow: a code-surface \`${reflog_line}\` landing was judged RED — ref-level landings (no commit created) must be GREEN like push / merge --ff-only" >&2
  exit 1
fi

# ── ③ 读不懂的 action 形 ⇒ NOT-EVALUATED（exit 3）+ reason 逐字点名该形 ───────────────────────────
# `git update-ref -m <任意文本>` 写出的 action 就是那串文本——结构上读不懂 ⇒ fail-closed（硬规则③b），
# ⛔ 不得与合格同形，也⛔ 不得只报计数（下一个人要从计数反推是哪种形）。
# ⚠️ 目标 commit 必须**在 develop reflog 里没有 `commit:` 条目**：三态判定里 direct 优先于 unclassifiable
# （历史 reset-reapply 形态），拿一个曾被直投过的 commit 做载体 ⇒ 它被判 direct 而不是 unclassifiable
# ⇒ 未知形被掩盖（实测踩过：第一次写这一支就是用 develop~1 做的载体、checker 返回 exit 0）。
# ⇒ 载体另起一个只在 detached HEAD 上创建、从未当过 develop tip 的 commit。
printf 'export const cs2 = 1;\n' > "${repo}/plugin/scripts/cs2.ts"
git add -A
GIT_AUTHOR_DATE="2026-08-04T00:00:00Z" GIT_COMMITTER_DATE="2026-08-04T00:00:00Z" \
  git commit -q -m "feat: second side head (never a develop commit: entry)"
unknown_sha="$(git rev-parse HEAD)"
git update-ref -m "mutation-unknown-form" refs/heads/develop "${unknown_sha}"
unknown_rc=0
if checker_cmd; then unknown_rc=0; else unknown_rc=$?; fi
if [ "${unknown_rc}" -ne 3 ]; then
  echo "unknown reflog action form must be NOT-EVALUATED (exit 3), got exit ${unknown_rc}" >&2
  exit 1
fi
unknown_reason="$(checker_json | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).reason??""))}catch{process.stdout.write("")}})')"
if [ "${unknown_reason}" != "unsupported-reflog-action: mutation-unknown-form" ]; then
  echo "reason must name the unsupported action form verbatim, got: '${unknown_reason}'" >&2
  exit 1
fi

# RESTORE ② 的 GREEN（`branch -f` 是 refMove ⇒ 不得留下 unknown 形）。
git branch -f develop "${side_sha}"
if checker_cmd; then :; else
  echo "RESTORE after the unknown-form branch is still not GREEN" >&2
  exit 4
fi

echo "direct-to-develop-bypass-check mutation case: PASS (code-surface direct commit caught; design-internal restored; refMove landing GREEN; unknown action form NOT-EVALUATED with the form named)" >&2
exit 0
