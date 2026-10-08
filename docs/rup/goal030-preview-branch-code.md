# GOAL-030 ⑤ — 预览实例自举：AC-340 在 goal 判据树上取 0

任务：`gap-goal030-preview-runs-branch-code`（goal_ac: AC-340，经 `goal/GOAL-030` 落地）
取证时刻：**2026-10-08T03:07:36Z – 2026-10-08T03:08:57Z**（UTC；本机 +0800）
判据：`goals/AC-340-预览运行分支代码-…md` 的 `criterion`（⛔ 本任务未改判据一个字）

这份文档固化「预览实例真的被起起来、且 AC-340 在它身上取到 0」的读数。判据的真值由一个**在跑的进程**承载，
所以下面每个读数都带它自己的采集命令——复核者可以逐条重放。

---

## 1. 被求值的树：判据 worktree ≡ 预览 worktree

AC-340 的求值树是 `goalCriterionWorktreeDir(root, "GOAL-030")`（`packages/quay/src/goal-store.ts` 的单一推导，
经 `.quay/config.yml` 的 worktree 命名空间解析，⛔ 不是硬编码的 `quay-worktrees` 字面量）。
`previewWorktreeDir`（`packages/quay/src/goal-preview.ts:83`）返回**同一个**路径——树只有一个，预览与判据不可能分叉。

```
$ git -C /home/yale/work/quay-worktrees/goal-GOAL-030 rev-parse HEAD
6a00432cae4f349f336436aa9de963a331887d02

$ git -C /data/home/yale/work/quay rev-parse goal/GOAL-030
6a00432cae4f349f336436aa9de963a331887d02
```

⇒ 两 sha 相同：判据/预览 worktree 停在分支 tip 上（由 goal-driver 的 `ensureGoalCriterionWorktree`
建/刷，⛔ 本任务没有手工 `git worktree add` 补建）。

依赖装配：`ensureWorktreeNodeModules` 的结果是 **`linked`**——
`/home/yale/work/quay-worktrees/goal-GOAL-030/node_modules -> /data/home/yale/work/quay/node_modules`
（⛔ 不是 `source-absent` / `failed`）。`.quay/` 快照存在（含 `config.yml`），启动前**没有** `server.json`
——预览从「无实例身份文件」起步，它自己的 serve 发布自己的登记（§4.10 裁定㉓）。

---

## 2. 起预览

```
$ node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts \
    goal preview GOAL-030 start --port 20830 --root /data/home/yale/work/quay --json
{
  "goal": "GOAL-030",
  "action": "start",
  "previewRoot": "/home/yale/work/quay-worktrees/goal-GOAL-030",
  "state": "started",
  "pid": 1038773,
  "host": "172.28.0.1",
  "port": 20830,
  "detail": "preview serve pid 1038773 up at /home/yale/work/quay-worktrees/goal-GOAL-030 (log .../preview-serve.log)"
}
```

`--port` 显式给了 20830（≥1，且未被占用、≠ 生产端口 20119）。host 取自 `.quay/config.yml` 的 `serve.host`
（172.28.0.1）；⛔ 不是 `0.0.0.0`，人可寻址。

状态复核：

```
$ node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts \
    goal preview GOAL-030 status --json --root /data/home/yale/work/quay
{ "goal": "GOAL-030", "action": "status",
  "previewRoot": "/home/yale/work/quay-worktrees/goal-GOAL-030",
  "state": "running", "pid": 1038773, "host": "172.28.0.1", "port": 20830,
  "detail": "pid 1038773 alive, web on 172.28.0.1:20830" }
```

### 读数一：预览 serve 的入口在**本树内**（直接量，读 `/proc`）

```
$ tr '\0' '\n' < /proc/1038773/cmdline
/data/home/yale/.nvm/versions/node/v24.21.0/bin/node
--experimental-strip-types
/home/yale/work/quay-worktrees/goal-GOAL-030/packages/quay/bin/quay.ts
serve
--port
20830

$ readlink -f /home/yale/work/quay-worktrees/goal-GOAL-030/packages/quay/bin/quay.ts
/data/home/yale/work/quay-worktrees/goal-GOAL-030/packages/quay/bin/quay.ts
```

**入口文件 realpath** = `/data/home/yale/work/quay-worktrees/goal-GOAL-030/packages/quay/bin/quay.ts`
——它就在被求值树 `/data/home/yale/work/quay-worktrees/goal-GOAL-030` 之内（⛔ 不是主检出的入口）。

### 读数二：活 web 地址（`live-web-address.ts` = 该 root 活地址的唯一定义点）

```
$ node --no-warnings --experimental-strip-types \
    /home/yale/work/quay-worktrees/goal-GOAL-030/plugin/scripts/live-web-address.ts \
    /home/yale/work/quay-worktrees/goal-GOAL-030
172.28.0.1:20830          # rc=0
```

### 读数三：首页 HTTP 状态码

```
$ curl -sL -o /dev/null -w '%{http_code}\n' --max-time 20 http://172.28.0.1:20830/
200
```

---

## 3. AC-340 判据在预览树上取 0

判据原文从 goal store 取出后 `bash` 执行，cwd = 该 worktree：

```
$ node -e 'process.stdout.write(require("/tmp/ac340.json").criterion)' > /tmp/ac340-crit.sh
$ cd /home/yale/work/quay-worktrees/goal-GOAL-030 && bash /tmp/ac340-crit.sh
PASS: serve pid 1038773 under /data/home/yale/work/quay-worktrees/goal-GOAL-030 runs this tree's own entry
      (/data/home/yale/work/quay-worktrees/goal-GOAL-030/packages/quay/bin/quay.ts)
      and serves http://172.28.0.1:20830/ (200 after redirects)
$ echo $?
0
```

（stderr 为空。stdout 为上面 `PASS:` 那一段，逐字取自判据最后一行。）

---

## 4. 负对照：这条判据**能取假**（两个方向）

一个只在真样本上验过的判据不是测量。同一份 `/tmp/ac340-crit.sh`，在两棵**在被求值树之外**的临时 git 树上各跑一次：

### (a) 登记了「跑主检出入口的 serve」的树 ⇒ `exit 1`

树：`mktemp -d` 的 git 仓库，`.quay/server.json` 是**主检出登记的原样拷贝**（其 pid 1769873 是活着的**生产** serve，
入口 = 主检出自己的 `packages/quay/bin/quay.ts`）。

```
$ cd /tmp/ac340-neg-a-csnC7A && bash /tmp/ac340-crit.sh
CAUSE=serve-runs-foreign-code — the serve registered under /tmp/ac340-neg-a-csnC7A runs
/data/home/yale/work/quay/packages/quay/bin/quay.ts, not this tree's own code
$ echo $?
1
```

⇒ 判据抓住了「被求值树登记的 serve 跑的是别处的代码」，并且 **stdout 为空、只在 stderr 报因**
（⛔ 不把假当成 PASS）。

### (b) 没有 `.quay/server.json` 的树 ⇒ `exit 3`

```
$ cd /tmp/ac340-neg-b-Pe6uUH && bash /tmp/ac340-crit.sh
NOT-EVALUATED: no live quay serve registered under /tmp/ac340-neg-b-Pe6uUH
(.quay/server.json absent or pid dead) — start the preview with: quay goal preview GOAL-030 start --port <n>
$ echo $?
3
```

⇒ 「没有可求值的对象」拿到的是**独立取值 3**，与「合格（0）」和「为假（1）」都不同形（硬规则 3b）。

| 场景 | exit | 关键串 |
|---|---|---|
| 预览树（本树自己入口 + 首页 200） | **0** | `PASS: serve pid 1038773 … runs this tree's own entry` |
| 外来代码树（登记了跑主检出入口的 serve） | **1** | `CAUSE=serve-runs-foreign-code` |
| 无登记树 | **3** | `NOT-EVALUATED` |

---

## 5. 边界（本读数的时效性，如实注记）

AC-340 是 **live-probe** 类判据：真值由进程承载，不是文件里的常量。因此：

- goal-driver 在分支 tip 前移时会 `checkout --detach --force <新 tip>` 刷新判据 worktree
  （`ensureGoalCriterionWorktree` 的 `refreshed` 分支），并在刷新失败重建时 `stopPreviewServe`
  （§4.10 裁定㉒）；`.quay/` 快照（裁定㉓）也会让预览内的写操作随刷新丢弃。
- 所以本任务证明的是**执行当刻、分支 tip `6a00432ca` 上**的读数。此后若有同 goal 的任务把
  `goal/GOAL-030` 的 tip 再推前，预览会被停、AC-340 回到 `exit 3`——`quay goal merge` 前按本文 §2
  的**同一条命令**重起预览即可（一步）。⛔ 不得为了维持 `exit 0` 而改判据、给判据 worktree 手搓状态、
  或把 serve 起在主检出上冒充预览。
- ⛔ 本任务全程没有停、没有重启**生产** serve（主检出 `.quay/server.json` 登记的 pid 1769873），
  也没有动 `goal-preview.ts` 的行为。

---

## 6. 留给人的预览

预览 serve **保持运行**（`quay goal merge` 的前置就是它），地址：

```
http://172.28.0.1:20830/     (pid 1038773, workspace root = /home/yale/work/quay-worktrees/goal-GOAL-030)
```

停止：`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal preview GOAL-030 stop --root /data/home/yale/work/quay`
