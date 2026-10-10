#!/usr/bin/env bash
# Mutation case for direct-to-develop-bypass-check (gap-direct-to-develop-bypasses-fan-in-gates,
# 11b/C17 写所有权/越权直改面). Fixture: a temp git repo where develop has ONLY design-internal
# direct commits (.gitignore) → GREEN. Inject: a direct commit touching a CODE/ASSERTION-surface
# file (plugin/test/x.test.mjs) → the checker MUST go RED (直接提交 develop 绕过 fan-in 机件).
# Restore: reset away the code-surface commit → GREEN. The missing lock-events file is the
# vacuous "no lock holds" state (the checker's own documented semantics — the reflog `commit:`
# action is the primary signal).
#
# ── 落地词汇表的三个方向（gap-ac194-reflog-action-vocabulary-incomplete + 第五次变假）────────────
# 旧词汇表是**拼法白名单**（`push` | `/Fast-forward/`）⇒ 生产出现第三种 ref-level 落地拼法
# `branch: Reset to`（`git branch -f develop <t>`）时条条落进 unclassifiable ⇒ 硬规则③b fail-closed
# ⇒ AC-194 `expect: exit 0` 结构上不可达。本 case 把三个方向都钉成常驻证据（⛔ 缺一个就不能取假）：
#   ② refMove（`branch: Reset to`）落地【代码面】⇒ 仍是 ref-level 落地（不创建 commit）⇒ 必须 GREEN。
#      词汇表若被收窄回白名单，这一支立刻 RED。
#   ③ 读不懂的 action 形（`git update-ref -m <任意文本>`）⇒ 必须 NOT-EVALUATED（exit 3），且 reason
#      **逐字点名该形**（旧版只报 unclassifiable-commits-in-range 计数 ⇒ 下一个人要从计数反推）。
#   ④ 本仓通道声明的保留前缀（`quay-ref-landing: …`）落地【代码面】⇒ 必须 GREEN **且被结构分类**
#      （独立计数 ≥1）——第五次变假（tasks/gap-ac194-empty-reflog-action-from-message-less-update-ref）：
#      裸 `git update-ref`（无 -m）写出的空 action 与「人手外科直落 develop」同形 ⇒ 不可分类；修法是
#      生产者补保留前缀 + checker 给该前缀一个结构类。⛔ ④ 与 ③ 配对：③ 钉「任意其它 -m 仍 fail-closed」，
#      ④ 钉「那个具体前缀被分类」。变异钉：把 sanctionedRefMove 分支退回 unknown ⇒ ④ 立刻变 NOT-EVALUATED。
# 实测原文（git 2.43.0）：`git branch -f <已存在 b> <t>` ⇒ `branch: Reset to <t>`；
# `git update-ref -m <msg> <ref> <sha>` ⇒ `<msg>`。⚠️ `git branch -f <b>` 只在 <b> 未被检出时允许
# ⇒ 这几支先 `git checkout --detach`。
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

# ── ④ 本仓通道声明的保留前缀（`quay-ref-landing: …`）落地代码面 ⇒ 必须 GREEN 且**被分类** ──────────
# 第五次变假（tasks/gap-ac194-empty-reflog-action-from-message-less-update-ref）：本仓自己的落地通道
# （integration-batch-merge.ts 的 real-merge/ff CAS、sync-lag-check.sh 的 downsync）过去用**裸
# `git update-ref`（无 -m）** ⇒ reflog action 为空 ⇒ `(empty)`/unknown ⇒ 该 tip 落 unclassifiable ⇒
# 判据 NOT-EVALUATED（exit 3）⇒ AC-194 恒 fail。修法：生产者补保留前缀 `-m`（AC3）+ checker 给该前缀一个
# **结构分类** sanctionedRefMove（AC4）。本支同时是两个方向的钉子（缺一个就不能取假）：
#   · 正向：保留前缀的 ref-level 落地【代码面】⇒ 必须 GREEN（与 ② 的 refMove 同类：不创建 commit）；
#   · 变异钉：把 sanctionedRefMove 分支退回「一律 unknown」（与空/任意 -m 同形）⇒ 本支立刻 NOT-EVALUATED
#     ⇒ 本 case 报红（⛔ 这正是「只修生产者不修 checker」的形态会红的地方）。
# ⛔ 与 ③ 的负控配对：③ 证明「任意其它 -m 文本仍 NOT-EVALUATED」，本支证明「那个具体保留前缀被分类」。
git checkout -q --detach
printf 'export const cs3 = 1;\n' > "${repo}/plugin/scripts/cs3.ts"
git add -A
GIT_AUTHOR_DATE="2026-08-05T00:00:00Z" GIT_COMMITTER_DATE="2026-08-05T00:00:00Z" \
  git commit -q -m "feat: side head landed by the reserved quay-ref-landing form"
sanctioned_sha="$(git rev-parse HEAD)"
sanctioned_old="$(git rev-parse refs/heads/develop)"
git update-ref -m "quay-ref-landing: fast-forward ${sanctioned_old} -> ${sanctioned_sha}" \
  refs/heads/develop "${sanctioned_sha}" "${sanctioned_old}"
sanctioned_reflog="$(git reflog show develop --format=%gs | head -1)"
case "${sanctioned_reflog}" in
  "quay-ref-landing: "*) : ;;
  *) echo "FIXTURE: expected a 'quay-ref-landing: …' reflog form, got '${sanctioned_reflog}'" >&2; exit 4 ;;
esac
if checker_cmd; then :; else
  echo "sanctioned landing judged NOT GREEN: a code-surface \`${sanctioned_reflog}\` ref-level landing must be CLASSIFIED (sanctionedRefMove), not fall to NOT-EVALUATED (exit 3) — the producer's reserved prefix did not reach the checker's structural class" >&2
  exit 1
fi
sanctioned_count="$(checker_json | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{process.stdout.write(String((JSON.parse(s).denominator||{}).sanctionedRefMoveCommits??""))}catch{process.stdout.write("")}})')"
if [ "${sanctioned_count}" -lt 1 ] 2>/dev/null; then
  echo "sanctionedRefMoveCommits must count the sanctioned landing (got '${sanctioned_count}') — GREEN must come from the CLASS, not from a silent exemption" >&2
  exit 1
fi

echo "direct-to-develop-bypass-check mutation case: PASS (code-surface direct commit caught; design-internal restored; refMove landing GREEN; unknown action form NOT-EVALUATED with the form named; reserved quay-ref-landing prefix CLASSIFIED with an independent count)" >&2
exit 0
