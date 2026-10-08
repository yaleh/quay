# GOAL-030 ④ — ArchGuard before/after comparability (AC-339)

**Status:** recorded reading, `exit 0` (PASS).
**Task:** `gap-goal030-archguard-before-after-comparability`
**Goal:** GOAL-030 (§AC-339)
**Recorded:** 2026-10-08
**Root of the recorded run:** `/data/home/yale/work/quay-worktrees/gap-goal030-archguard-before-after-comparability`
(on branch `task/gap-goal030-archguard-before-after-comparability`, forked from `goal/GOAL-030`)

This file exists so that the "before/after comparable" reading does **not** live only in the criterion's
`mktemp -d /tmp/goal030-ag.XXXXXX` scratch (which is cleaned up on `EXIT`). The criterion itself is the
single source of truth — ⛔ no second comparability implementation was written.

## 1. What was run

The criterion is taken **from the Provider ABI**, not retyped:

```
node --experimental-strip-types packages/quay/bin/quay.ts goal show AC-339 --json   # → .criterion
```

- criterion source: `goals/AC-339-archguard-前后可比-….md` (`criterion: |` block scalar)
- extracted script `sha256` = `96f3e969413aaa3cf9954ea5f4a22eab0f6d1ebaff55fd2cacaa86b2abebaa3d`
  (identical across all four runs below — one criterion, four roots)
- executed with `bash` from the worktree root (the criterion `cd`s to `git rev-parse --show-toplevel`)

**archguard CLI actually used (resolved by the criterion itself, printed with `readlink -f`):**

```
/data/home/yale/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js
```

The criterion walks up from `$HOME/.claude/plugins/cache/archguard/archguard` looking for
`npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js`; it resolves at `$HOME/.claude/plugins`.
There is exactly **one** `$cli` for the whole run, and it analyzes **both** roots — so before/after are
produced by the same build (this is what makes the two readings comparable at all).

## 2. Analyzed roots (pre-merge arm)

`git merge-base --is-ancestor HEAD develop` is **false** on this branch, so the criterion takes the
**pre-merge** arm: it compares `before = git merge-base HEAD develop` against `after = HEAD`.

`before` is therefore whatever the branch's last common point with `develop` is — the original fork
point **until** the branch merges `develop` back in, and the **develop tip** afterwards. Both were
measured; the quantities do not move (only the two sha labels do):

| run | **before** = `merge-base HEAD develop` | **after** = `HEAD` |
|---|---|---|
| A — `goal/GOAL-030` tip, before any develop catch-up | `019995f65f87744d887cf1f79653d73cf8cd49cb` — the **fork point** | `e20ef12140bf3efef3c699b93044d84fcc83cde9` — `goal/GOAL-030` tip, **contains ②'s kernel wiring** |
| B — after `git merge develop` (×2) into the task branch | `ae703329ca14ebdca2d97f6f4e55c62b91d8c49a` — **develop tip** at that moment | `e05addf01b6c4abad2186fddb257d8ba912be55c` — merged task HEAD |

`mode = pre-merge` in both. Both sides are single-root extractions of the same two paths:

```
git archive <sha> packages plugin/scripts | tar -x -C <tmp>/<side>/tree
find <tree> -name node_modules -prune -exec rm -rf {} +
node "$cli" analyze -s <tmp>/<side>/tree -f json --output-dir <tmp>/<side>/out
```

i.e. **one `$cli`, two `git archive` single-root analyses** — not two different tools, not a
working-tree-vs-archive mix.

`git diff --name-status --no-renames <before> <after> -- packages plugin/scripts` over the range:
`A packages/quay/src/kernel/task-transition.ts` (added), **0 deleted** non-test `.ts`
(`packages/quay/test/task-transition.test.mjs` is a test and is excluded; `gate/lifecycle.ts`,
`plugin/scripts/ready-pool-check.ts`, `plugin/scripts/task-ops.ts` are modifications, not A/D).

## 3. Readings (authoritative runs, all `exit 0`)

Run A (`before` = fork point `019995f65…`):

```
{"mode":"pre-merge","before":"019995f65f87744d887cf1f79653d73cf8cd49cb",
 "after":"e20ef12140bf3efef3c699b93044d84fcc83cde9",
 "files":{"before":417,"after":418},
 "cycles":{"before":1,"after":1},
 "k":{"before":14,"after":16},
 "nk":{"before":44,"after":44},
 "rev":0}
PASS: comparable before/after (pre-merge): files 417->418, cycles 1->1,
      plugin->kernel 14->16, plugin->non-kernel 44->44, reverse 0
```

Run B (`before` = develop tip `ae703329c…`, after the task branch merged `develop` twice) — **same
quantities, `exit 0`**:

```
{"mode":"pre-merge","before":"ae703329ca14ebdca2d97f6f4e55c62b91d8c49a",
 "after":"e05addf01b6c4abad2186fddb257d8ba912be55c",
 "files":{"before":417,"after":418},
 "cycles":{"before":1,"after":1},
 "k":{"before":14,"after":16},
 "nk":{"before":44,"after":44},
 "rev":0}
PASS: comparable before/after (pre-merge): files 417->418, cycles 1->1,
      plugin->kernel 14->16, plugin->non-kernel 44->44, reverse 0
```

| quantity | before | after | direction constraint | held? |
|---|---|---|---|---|
| analyzed `.ts` files (non-test) | **417** | **418** | Δ must equal the `git diff` A−D delta = `1 − 0 = 1` | ✅ 418−417 = 1 |
| directory cycles | **1** | **1** | must **not** increase | ✅ |
| `plugin/scripts` → `packages/quay/src/kernel` strength | **14** | **16** | must **increase** | ✅ |
| `plugin/scripts` → `packages/quay/src` (non-kernel) strength | **44** | **44** | must **not** increase | ✅ |
| `packages/**` → `plugin/**` reverse edges | — | **0** | must be **0** | ✅ |

`mode=pre-merge` in both runs. Run A: `before=019995f65f87744d887cf1f79653d73cf8cd49cb`,
`after=e20ef12140bf3efef3c699b93044d84fcc83cde9`. Run B: `before=ae703329ca14ebdca2d97f6f4e55c62b91d8c49a`,
`after=e05addf01b6c4abad2186fddb257d8ba912be55c`. Across A→B the `before` moved from the fork point to
the develop tip — `git rev-list --count 019995f65…ae703329c` = **9** commits of unrelated develop work
— and **not one of the five quantities moved** (none of those 9 commits changed a file under
`packages` or `plugin/scripts`, which is why the archived `before` tree is byte-equal in count).

### Why `→ kernel` rises 14 → **16** (not 14 → 15)

② (`gap-goal030-promotion-writes-via-kernel-transition`) introduces **two** new
`plugin/scripts → packages/quay/src/kernel` edges, one per file, each contributing strength 1:

1. `plugin/scripts/ready-pool-check.ts:215` —
   `import { decideTransition, patchStatusField as applyKernelStatusPatch, appendTaskStatusEvent } from "../../packages/quay/src/kernel/task-transition.ts";`
2. `plugin/scripts/task-ops.ts:70` —
   `export { patchStatusField } from "../../packages/quay/src/kernel/task-transition.ts";`
   (the kernel definition is re-exported so the four existing callers keep importing `./task-ops.ts`)

The strength is a **package-level sum over file-level edges**, so two new edges ⇒ `+2`.

> ⚠️ **This differs from the number the task's AC-3/AC-4 were written with (`14 → 15`).** That
> `14 → 15` came from the goal's own design-time note (`goals/GOAL-030-….md`, line 46: "AC-339 在临时
> 分支上实跑 archguard，加 kernel import 时 14→15 判绿"), which was measured on a **synthetic temp
> branch that added one kernel import** — not on the real ② landing. The real slice adds two.
> The reading below is the real one; see §4 for why this matters.

## 4. Negative control — the criterion can take a false value

The control was run in a **throwaway scratch worktree** (detached HEAD, `git worktree remove`d
afterwards) so the task branch stayed byte-pristine; the criterion reads `git archive HEAD` (git
objects), so a control edit has to be **committed** to be visible to it.
Backups are `cp`; restore is `cp` — ⛔ **no `git checkout`** was used to restore.

| # | mutation | HEAD | `k` | criterion | stderr |
|---|---|---|---|---|---|
| NC-A | remove `ready-pool-check.ts`'s kernel import **only** | `32b92696c…` | 14 → 15 | **exit 0** | *(empty)* |
| NC-B | also sever `task-ops.ts`'s kernel re-export | `ec39139ee…` | 14 → 14 | **exit 1** | `CAUSE=kernel-edge-not-observed — plugin/scripts->kernel strength 14 -> 14 (the slice adds a kernel import; archguard did not see it)` |
| NC-R | `cp` both backups back (byte-identical) | `864a78638…` | 14 → 16 | **exit 0** | *(empty)* |

Restored-file hashes match the backups exactly:
`ready-pool-check.ts` = `a0dd3f6b434809f5f5bd27d8f5ad8543dd06c2889126b25ca45ec498250adafd`,
`task-ops.ts` = `7127c053825887218cee1e137f862112ce1b619a24ac3e814e6c1320a19302b8`.

**NC-A falsifies the task AC-4's stated mechanism.** AC-4 says that deleting *"`applyPromotions` 的
kernel import"* (i.e. `ready-pool-check.ts:215` alone) must produce `exit 1`. It does not — it yields
`exit 0`, because that file's edge was only **one of two** the slice added (§3). The AC's expected
number was inherited from a one-import fixture (硬规则 4 推论三: a judgement only a fixture satisfies
is an echo, not a measurement) and was never validated against the real ② landing.

**NC-B is the control that actually takes a false value** — it severs *both* edges the slice added, and
the criterion reports precisely the named cause (`kernel-edge-not-observed`) with `exit 1`. So AC-4's
governing claim ("负对照能取假" — the negative control *can* take a false value) holds, and the
criterion is **not vacuous**; only its parenthetical arithmetic was wrong.

No source behaviour is changed by this task: the NC mutations existed only inside the removed scratch
worktree (its detached-HEAD commits are unreachable and were never on the task branch).

## 5. Reproduce

```bash
WT=/data/home/yale/work/quay-worktrees/gap-goal030-archguard-before-after-comparability
cd "$WT"
node --experimental-strip-types packages/quay/bin/quay.ts goal show AC-339 --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).criterion))' \
  > /tmp/ac339.sh
bash /tmp/ac339.sh; echo "exit=$?"     # → PASS: comparable before/after (pre-merge) … ; exit=0
git merge-base HEAD develop            # → 019995f65f87744d887cf1f79653d73cf8cd49cb
git rev-parse HEAD                     # → e20ef12140bf3efef3c699b93044d84fcc83cde9
```

`docs/rup/goal030-archguard-before-after.md` ✅ `test -f` exit 0;
`grep -cE 'kernel'` on this file ≥ 1 ✅.

## 6. Self-reference note (`after` is always `HEAD`)

The criterion sets `after = git rev-parse HEAD`, so *any* commit moves the "after" sha. This is
harmless by construction: the criterion extracts **only** `packages` and `plugin/scripts`
(`git archive <sha> packages plugin/scripts`), and this file lives under `docs/`. Commits made by
this task therefore cannot change `files` / `cycles` / `k` / `nk` / `rev` — only the recorded `after`
string. §3 pins the reading against `goal/GOAL-030` tip `e20ef1214…`, which is the branch source
state actually under test; a confirmation re-run at the task's own (docs-committed) HEAD reproduced
all five readings identically (both runs recorded in the task's `## Evidence`).
