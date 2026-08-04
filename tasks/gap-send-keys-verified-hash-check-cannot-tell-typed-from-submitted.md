---
id: gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted
title: send-keys-verified.sh reports delivered on pane-hash change alone — that
  changes the instant text is typed, before Enter is confirmed processed, so a
  lost/delayed Enter is misreported as delivered
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  superseded: true
  superseded_by: gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable
  superseded_at: 2026-08-04
---

> **SUPERSEDED by outer ruling F (2026-08-04) — `orchestration/outer-rulings-2026-08-04-A-F.md`.**
> The hash-heuristic approach is dead per human ruling: input-confirmation is lower priority
> (a mis-sent message is still observable), and the state this task guarded ("message sitting
> unsubmitted in the input box") is exactly the pane-visible shape that ruling D's classifier
> covers. **ACs intentionally not satisfied — closed by supersession, not by the gate.**
> Worktree work (251 lines) preserved on branch `task/gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted` @ `6a51f964`, unmerged.

**type:** execution

## Proposal

Found live during the 2026-08-04 second-OOM recovery, driving `quay-0:inner` from the outer
session after a role-boundary correction (outer must drive inner via `send-keys`, not implement
directly — see `orchestration/inner-brief-2026-08-04-second-restart.md` and this session's own
correction from the human).

**Real, reproduced sequence** (not hypothetical):

```
$ bash plugin/scripts/send-keys-verified.sh quay-0:inner "执行 .../fast-mode-loop-tick.md 中的 tick 指令..."
send-keys-verified: 已送达 quay-0:inner（哈希 99303f0cd7572dad → c186423bf0d74349）
$ echo $?
0
```

The script reported success (hash changed, exit 0) exactly per its own documented contract
(`plugin/scripts/send-keys-verified.sh:48-52`: "哈希未变 = 没送达" → hash CHANGED here, so it
reports delivered). **But the target's input box still showed the full instruction text,
un-submitted, 20+ real seconds later:**

```
$ tmux capture-pane -t quay-0:inner -p -S -20   # taken ~20s after the "已送达" report
❯ 执行 /home/yale/work/quay/plugin/loop/fast-mode-loop-tick.md 中的 tick
  指令。背景：...
─────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle)
```

No `Harmonizing…`/thinking indicator, no cleared input box — the pane looked exactly like an
unsent draft. Only after manually re-sending a bare `tmux send-keys -t quay-0:inner Enter` did
the target actually start processing (`Harmonizing… (2s · thinking)` appeared 3s later, input
box cleared).

### Root cause

`send-keys-verified.sh` sends `C-u` → text (`-l`) → `Enter` as three separate calls (correctly,
per its own header comment and `CLAUDE.md`'s "combined drops the Enter" rule), then sleeps
`SETTLE` (default `0.5`s, `send-keys-verified.sh:26`) and diffs the pane hash. **The hash changes
the instant the typed text appears in the input box — before Enter's effect can be observed.**
0.5s later, the hash is already different from `hash_before` (text is now visibly there)
regardless of whether Enter actually reached and was processed by the target Claude Code
session. The check's stated judgment criterion — "hash unchanged = not delivered" — is true but
insufficient: **a changed hash is consistent with BOTH "message submitted" and "text typed, Enter
lost/delayed/still-rendering"**. The script cannot currently distinguish these two cases, and in
this real run it reported the wrong one.

This is exactly the failure class the script's own header says it was built to prevent
(2026-08-03: "outer 输入框里有一行没发出去的文字... 不可复现→不为它建检测") — except this time
it WAS reproduced, live, with exact hashes and timestamps, by the very mechanism meant to
prevent it.

## Contract

```
measure delivered_state_after_settle = `tmux capture-pane -p -t <fixture pane>` 内容里是否出现「输入已清空 + 进入 thinking/处理态」的可观察标记字段
band delivered_state_after_settle = 必须能与「文本仍原样躺在输入框」区分——不能只看 pane 哈希是否变化
invariant 一次误报「已送达」而实际未提交，比脚本原本要防的「文字没发出去」危害更大——它训练出对 exit 0 的信任
invoke `bash plugin/scripts/send-keys-verified.sh <target> <text>`
control 正常一次性送达（Enter 立即被消费）的既有用例必须仍然报 exit 0；不能为了堵这个洞把所有正常送达也判失败
resume 先找一个可复现的判据（thinking 指示器 / 输入框清空 / 光标位置），再改退出码逻辑
```

## Chosen mechanism

**Do not just lengthen `SETTLE`** — that's a timing band-aid (the same shape as `task-over-90m`'s
threshold problem elsewhere in this repo: tuning a proxy instead of finding a structural signal),
and it would slow down every legitimately-fast delivery too.

Find a state signal that distinguishes "text sitting in the input box" from "message submitted
and the target is processing it" — candidates:
1. **Input box emptied** — after a real submit, the prompt line goes back to `❯ ` with no text.
   A stalled unsubmitted message leaves the typed text visible. Compare pane content specifically
   at the input-box region, not a whole-pane hash.
2. **A processing indicator appears** (`Harmonizing…`/`Cogitated…`/`esc to interrupt` — observed
   in this incident's own transcript) — poll for one of these markers within a bounded window
   instead of a single fixed-delay hash diff.
3. **Retry-Enter fallback**: if after `SETTLE` the input box still shows the sent text verbatim,
   resend a bare `Enter` once and re-check, before declaring failure — since this incident shows
   a bare follow-up `Enter` recovers it.

**Not doing**: not switching away from three-separate-calls (that part is correct and documented
elsewhere); not silently retrying without ever reporting the first attempt needed a nudge — if a
retry is added, its use must be visible in the output, not swallowed.

## Acceptance Criteria

- [ ] AC1: a fixture reproduces this incident's shape — text delivered, Enter NOT processed within
      `SETTLE`, pane hash changes anyway — and the CURRENT script is shown reporting a false
      "delivered" (red-first, real run pasted)
- [ ] AC2: after the fix, the same fixture correctly reports non-delivery (or auto-recovers via a
      visible retry) instead of a false positive
- [ ] AC3: negative control — a normal, fast, real delivery (Enter processed well within `SETTLE`)
      still reports success; the fix must not turn working cases into false failures
- [ ] AC4: `plugin/test/send-keys-verified.test.mjs` covers both directions with `node:test`,
      `// @test-group product` (this is install/operational infra, user-facing per the repo's own
      convention for scripts other sessions depend on)

## Definition of Done

- [ ] AC1-AC3 real-run outputs pasted into this task body
- [ ] Full suite 2x green (`fail 0` and `cancelled 0`)
- [ ] Task body records the real incident hashes/timestamps above as the reproduction case,
      not a synthetic one invented after the fact

## Touches

- plugin/scripts/send-keys-verified.sh
- plugin/test/send-keys-verified.test.mjs

## Dispatch review

reviewer: none
at: 2026-08-04T09:5xZ
changed: 无（外层建任务，未经正式闸口审查——`reviewer: none` 是被记录的选择）
