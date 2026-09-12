---
id: AC-172
title: draft 状态可用，且有真实的 draft GOAL 载体
status: achieved
kind: criterion
goal: GOAL-001
criterion: |
  GS=packages/quay/src/goal-store.ts
  T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
  if ! node --no-warnings --experimental-strip-types "$GS" write AC-900 --goal GOAL-900 \
        --title t --criterion 'exit 0' --expect e --origin o --expect-absent --root "$T" \
        >"$T/w.out" 2>&1; then
    echo "CAUSE=write-failed — 不传 --status 的写入失败（默认应落 draft）: $(cat "$T/w.out")" >&2
    exit 1
  fi
  if ! d="$(node --no-warnings --experimental-strip-types "$GS" list --status draft --root "$T" 2>&1)"; then
    echo "CAUSE=list-draft-failed — list --status draft 执行失败: $d" >&2
    exit 1
  fi
  if ! printf '%s' "$d" | grep -q '"id": "AC-900"'; then
    echo "CAUSE=write-not-draft — 不传 --status 时默认落的不是 draft（写入即激活，正是本条要堵的缺陷）: $d" >&2
    exit 1
  fi
  if ! a="$(node --no-warnings --experimental-strip-types "$GS" list --status active --root "$T" 2>&1)"; then
    echo "CAUSE=list-active-failed — list --status active 执行失败: $a" >&2
    exit 1
  fi
  if printf '%s' "$a" | grep -q '"AC-900"'; then
    echo "CAUSE=default-activated — 默认写入的 draft 记录出现在 active 列表里: $a" >&2
    exit 1
  fi
  exit 0
expect: >-
  exit 0 = 目标库的 draft 状态**可用且默认不激活**：不传 --status 的 write() 落成 draft（⛔ 不是
  active）、`list --status draft` 取得到它、`list --status active` 取不到它。失败时 exit 1 且 stderr
  携带 `CAUSE=…` 成因（AC-241 同一纪律，⛔ 不再是无输出的裸 exit 1）。
  ⚠️ **2026-09-12 改判（gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass 的 AC5 显式处置，
  ⛔ 不是「已知悉」）**：原判据是 `list --status draft` 在**本仓**至少返回一条 GOAL- 记录 —— 那是
  「draft 有真实载体」的**一次性见证**，载体 = GOAL-003；GOAL-003 早已被激活，而一个「只在下阶段撰稿时
  才被使用」的状态**结构上无法**要求它任何时候都有活载体 ⇒ 原形态**结构性变假**（2026-09-12 实测：
  exit 1、零输出，且因无成因输出而每轮污染 AC-241）。故把判据收敛到它真正的**常设**半边（draft 可用 ∧
  默认不激活），见证半边记为已完成的一次性验收。⛔ 不构造假 draft GOAL 来喂判据（那是 gate-gameability），
  ⛔ 也不把「词表里有 draft 这个字符串」当判据（那正是本条 origin 明令不接受的形态）。
origin: |
  人 2026-09-06 裁定「draft 状态接受」。
  立条依据（推导，非偏好）：现词表无"写好但未启动"态且 write() 默认 status="active"
  (goal-store.ts:258) ⇒ 写入即激活；叠加硬上限后，cap 满时连撰写都会被堵死——
  上限本该只约束激活。该状态在散文里已存在：manager-phase-goal.md:174
  「📋 下一阶段（已创建，未启动）」，44f8813d2 明写「未切换、未启动、不得据此派发」。
---

**判据（能取假）**：`list --status draft` 至少返回一条 `GOAL-` 记录。

**取假**：今天必假两次——`VALID_GOAL_STATUSES`（`goal-store.ts:46`）不含 `draft`，
且 `goals/` 不存在。仅改词表而不产生真实 draft 载体，仍判假。

**⊢ 这条判的是"状态有真实用户"，不是"状态被定义了"**：
真实载体是 `GOAL-003`（下一阶段「插件面收敛」），它在 `AC-171` 的迁移中以 `draft` 落盘。

**配套改动**：`write()` 的默认 status 由 `active` 改为 **`draft`**——**默认不激活**，
与人裁定 3「暂不做自动晋升机制」同向；激活是一个显式动作。
