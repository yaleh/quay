---
id: gap-anchor-envelope-probe-scope-never-appears-in-shared-host-enumeration
title: develop CI 仅剩的红：探针 scope 在有界等待 30s 后仍 4/4 不出现——上一条「加长等待」的修复被 CI 证伪
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal

develop 的 CI 现在**只剩一条红**（run 38768929572，2026-10-15T16:25Z；此前 5 条中 4 条已修）：

`plugin/test/driver-anchor-memory-envelope.test.mjs` → 「REAL cgroup — live sibling scopes are really COUNTED, and the derived ceiling really tightens」，**耗满 30 s 有界等待后 4/4 探针全缺**。

**上一条修复的前提已被 CI 证伪。** `gap-driver-anchor-memory-envelope-live-sibling-enumeration-load-flake`（已 `done`，修复提交 `ba245281a` 确认在 develop 上，`SIBLING_PROBE_APPEAR_TIMEOUT_MS = 30_000`）的前提是「只是单元注册慢，原来的 15 s 不够」。CI 原文读数否掉了它：

```
AssertionError: 4/4 probe scope(s) never appeared in the live cgroup enumeration within 30000 ms (elapsed 30213 ms)
  expected units : ["quay-anchor-sibling-probe-1792081608975-…-0.scope", … -1, -2, -3]
  last enumeration (count=18): ["quay-anchor-cantus-…","quay-anchor-claudecodeui-…",…,"quay-anchor-quay-1792081548211.scope",…]
  probe quay-anchor-sibling-probe-…-0.scope: pid=3582552 exit code=0 output="Running as unit: quay-anchor-sibling-probe-…-0.scope"
  （4 条探针逐条都是 exit code=0）
```

⇒ 探针**正常创建、跑满、exit 0，systemd 明确回报 `Running as unit`**，可是**整整 30 秒 4/4 都没出现在枚举里**；而同一次枚举里别的项目（含一个**比探针更新**的 `quay-anchor-quay-1792081548211.scope`）全都在。**所以这不是时间窗问题，「再调大超时」在结构上修不好它。**

枚举口径（已读码）：`listSharedHostScopes()`（`plugin/scripts/driver-runtime.ts`）是**直接 walk `/sys/fs/cgroup` 目录树**找目录名以 `.scope` 结尾（`SHARED_HOST_SCOPE_MAX_DEPTH = 8`、排除自身 unit），**不是** `systemctl list-units`。

⛔ **本任务不得把任何未实测的成因当结论**：候选假说（容器内用户管理器落点更深/在不同 slice、cgroupns 分层使 walk 够不到等）**都还没被验证**，第一步必须是取读数。

⛔ **两条红线**：不得靠「调大超时」、不得靠「削弱断言」（改成「枚举非空即可」/删掉该用例）来关掉它 —— 这条用例的全部价值就是「真的数到了同居 scope」。

## Plan

1. **先回答「这些探针 scope 到底落在哪」**，再谈修法。要取的读数：探针 `systemd-run --user --scope` 成功后，其 `.scope` 目录在 `/sys/fs/cgroup` 下的**完整实际路径**（逐层列出），以及 `listSharedHostScopes()` 在同一环境下的 walk 读数（根、`maxDepth`、**实际到达的层**、以及那棵树上为什么没有它）。
2. **判别成因**：是「落点/命名空间导致 walk 结构上够不到」，还是「walk 够得到但名字/时机不对」，还是别的。写出判别用的对照读数。
3. **按实测结论选修法**（二选一，各自都要满足 AC）：
   - (a) 若成因可修 ⇒ 让该用例在真实 CI run 里**真的转绿**；
   - (b) 若该环境**结构上不适用**（例如容器内用户管理器与「共享宿主枚举」这个前提不同层）⇒ 走**具名、可判别的 not-evaluated**，且必须挂在一个**被正面读出的环境判别量**上（形如既有的 `anchorSystemdRunAvailable()` 那种「读得出、能取假」的判别），⛔ **不得**用「它红了所以跳过」当判别。
4. **负控**：任何 not-evaluated 分支都必须在**正常（宿主）环境**下**不触发**。
5. 记录 A/B 读数。

## AC

- [x] AC1: 给出探针 scope 的**实际落点读数**（完整路径逐层列出 + 取的命令），⛔ 不许只写「可能是深度不够」这类未实测断言。

  **落点（逐层，取自在 `gh-runner-quay` 的同参数复现容器里跑出来的真值）**：

  ```
  /sys/fs/cgroup/                       <- walk 的 root
    system.slice/                       depth 1
      docker-<容器id>.scope/            depth 2   <- 容器自己的 cgroup（宿主上每个容器一个）
        user.slice/                     depth 3
          user-0.slice/                 depth 4
            user@0.service/             depth 5
              app.slice/                depth 6
                quay-anchor-sibling-probe-ac1-0.scope   depth 7   <- 探针
  ```

  **取的命令**（容器按 `docker inspect gh-runner-quay` 的实参复现：`--cgroupns=host`、绑挂宿主 `/sys/fs/cgroup`、`--tmpfs /run /tmp`、`seccomp/apparmor=unconfined`、`CAP_SYS_ADMIN/SYS_CHROOT/MKNOD`）：

  ```
  docker exec -e XDG_RUNTIME_DIR=/run/user/0 quay-ac-probe \
    systemd-run --user --scope --collect --unit=quay-anchor-sibling-probe-ac1-0.scope \
      -p MemoryMax=64M -p MemorySwapMax=0 /bin/sleep 120
  docker exec -e XDG_RUNTIME_DIR=/run/user/0 quay-ac-probe \
    systemctl --user show quay-anchor-sibling-probe-ac1-0.scope -p ControlGroup -p Slice
  docker exec quay-ac-probe sh -c 'find /sys/fs/cgroup -name "quay-anchor-sibling-probe-ac1-0.scope" -type d'
  ```

  **实测输出**：

  ```
  Slice=app.slice
  ControlGroup=/system.slice/docker-d977b31a12ed629071a2af69dffb4fa616e6c685b9751a861dc5256aeffffb74.scope/user.slice/user-0.slice/user@0.service/app.slice/quay-anchor-sibling-probe-ac1-0.scope
  find => /sys/fs/cgroup/system.slice/docker-d977b31a….scope/user.slice/user-0.slice/user@0.service/app.slice/quay-anchor-sibling-probe-ac1-0.scope
  ```

  **宿主对照**（本机、非容器）：同一条命令落在 **depth 5** ——
  `/sys/fs/cgroup/user.slice/user-1004.slice/user@1004.service/app.slice/quay-anchor-sibling-probe-<ts>-594004-0.scope`
  ⇒ 容器比宿主**恰好多两层**（`system.slice/` + `docker-<id>.scope/`）。

- [x] AC2: 给出 `listSharedHostScopes()` 在**同一环境**下的 walk 读数（root、maxDepth、实际到达的层、以及它为什么没看到探针），并据此给出**判别性结论**（哪个候选假说被支持/被排除）。

  **walk 读数（同容器，修复前）**：

  ```
  root      = /sys/fs/cgroup          （缺省）
  maxDepth  = 8                       （SHARED_HOST_SCOPE_MAX_DEPTH）
  PREFIXES  = ["quay-anchor-","quay-serve-"]
  /proc/self/cgroup = 0::/system.slice/docker-d977b31a….scope/init.scope
  selfScopeUnitName() = "init.scope"

  count  = 18          <- 与 CI 那次 `count=18` 同值、同 18 条清单
  reason = null
  unreadableDirs = []
  units  = 18 条，**全部**落在宿主层
           user.slice/user-<uid>.slice/user@<uid>.service/…/ 之下（depth 5）；
           **一条都不来自任何 `.scope` 目录内部**

  探针在不在读数里？ false
  探针实际在哪？  ["/sys/fs/cgroup/system.slice/docker-d977b31a….scope/user.slice/user-0.slice/user@0.service/app.slice/quay-anchor-sibling-probe-ac1-0.scope"]
  ```

  **实际到达的层 / 为什么没看到**（对同一棵树做带插桩的复演）：

  ```
  skipped .scope dirs (NOT descended into, 即遍历把它们当叶子):
     depth=1  docker-d977b31a….scope              (under /sys/fs/cgroup/system.slice)  <- 就是它
     depth=1  docker-<其余每个容器 id>.scope       (同形状)
     depth=0  init.scope
     depth=2  session-*.scope / depth=3 init.scope / …
  ```

  遍历在 **depth 1 的 `system.slice` 里看到 `docker-<id>.scope`**，因「`.scope` 目录 = 单元、其子树是委派子树」而 `continue` ⇒ **`user.slice/…` 那条链从 depth 3 起从未被访问**，探针（depth 7）结构上不可达。

  **判别性结论**：
  - 假说「**落点使 walk 结构上够不到**」→ **被支持**（探针在 depth 7，且恰好位于一个被当作叶子的 `.scope` 之下；宿主层那 18 条都在 `user.slice/` 下、不在任何 `.scope` 里，所以它们照旧可见）。
  - 假说「**walk 够得到、只是名字/时机不对**」→ **被排除**，两条独立对照：(i) **名字对**——systemd 回报的单元名与期望逐字相同，且前缀命中 `quay-anchor-`；(ii) **时机对**——探针成员 `sleep 30`，整个 30 s 有界窗口内它一直活着，而 30 098 ms 后的枚举快照仍是同一份 18 条（其中一个 `quay-anchor-quay-1792081548211.scope` **比探针还新**，它在里面）。
  - ⇒ 「再调大超时」在结构上不可能修好它（上一条修复的前提被证伪）。

- [x] AC3: 按 Plan 3 的 (a) 或 (b) 落地；粘贴 `git diff --name-only` 证明改动只落在 Touches。

  走 **(a) 成因可修**（⛔ 未走 not-evaluated 分支，未调超时、未删用例、未削弱断言）。

  ```
  $ git diff --name-only develop...HEAD
  plugin/scripts/driver-runtime.ts
  plugin/test/driver-anchor-memory-envelope.test.mjs
  ```

  两处均在 `## Touches`（第三个是任务文件本身，由 ABI 写入）。

  **修法**：新增 `selfCgroupScopeAncestors()`（`plugin/scripts/driver-runtime.ts`）——从 `/proc/self/cgroup` 取出自己**之上**那些以 `.scope` 结尾的段，写成相对 cgroup 根的路径；`listSharedHostScopes()` 的树遍历**只对这条链**继续下行。
  - 别的容器（`docker-<other>.scope`）仍是叶子 ⇒ ⛔ 没有把「委派子树不是单元」这条不变量整体放宽。
  - 祖先本身**不计数**（它是自己那条链，就是 `N+1` 里的 `+1`，数它会数两遍）。
  - 读不到 / 无 `0::` 行 ⇒ **空集** ⇒ 退回原来的「`.scope` 即叶子」语义（宿主行为逐字节不变）。
  - 祖先判定用**相对 `root` 的路径**（`cgroupRoot` 是可注入测试缝，绝对路径会让夹具对不上）。
  - 同时钉了一条**固化夹具回归用例**（纯夹具，⛔ 不依赖真的是容器）：自己的容器要下探 / 别人的容器仍是叶子 / 无 unified 行退回叶子语义。

  附带（硬规则 5b，改了 `selfScopeUnitName` 的读文件那两行，抽成共享 `readProcSelfCgroupText()`）：`grep -rn 'endsWith(".scope")'` 全仓逐条看过——唯一的**树遍历**处就是本处；`effective-capacity-probe.ts:333` 是**祖先链**遍历（root→self，本来就会穿过祖先 `.scope`），**不是**同类缺陷，未改（它也不在 Touches 内）。

- [x] AC4: **负控（not-evaluated 分支专用）**：若走了 (b)，必须给出「正常宿主环境下该 not-evaluated 分支**不触发**」的对照读数（两侧都贴）；若走了 (a)，必须给出一条负控证明该用例**仍能取假**（例如让探针不建 scope 后必须在有界时间内红）。

  走了 (a)，故给**「仍能取假」**的负控。把探针成员换成不存在的可执行文件（⇒ `systemd-run` 在**注册单元之前**就失败，即**探针不建 scope**），在同容器里跑：

  ```
  x REAL cgroup — live sibling scopes are really COUNTED, and the derived ceiling really tightens (243.874112ms)
    AssertionError: 4/4 probe scope(s) never appeared in the live cgroup enumeration within 30000 ms
      (the bounded wait's explicit limit; elapsed 221 ms).
    probe quay-anchor-sibling-probe-…-0.scope: pid=4423 exit code=1 signal=null
      output="Failed to find executable /nonexistent-ac4/sleep: No such file or directory"
    （4 条逐条同形）
  ```

  ⇒ **在有界时间内红**（elapsed **221 ms**，不是把 30 s 上界空等满），且失败是**具名的**（每条探针自己的下场都在报告里）。断言仍能取到假值。

  **A/B 对照（红→绿的因就是本改动）**：同一容器、同一夹具，把 `driver-runtime.ts` 换回 develop 版 ⇒ **逐字复现 CI 那句红**（`4/4 probe scope(s) never appeared in the live cgroup enumeration within 30000 ms (elapsed 30098 ms)`，`last enumeration (count=18)` 与 CI 的 18 条清单一致）；换回本任务版 ⇒ 同一条用例 **255.9 ms 转绿**。

- [x] AC5: **断言强度未被削弱**：改动后该用例仍然要求枚举里含**本探针**的 scope（除非按 AC3(b) 走了具名 not-evaluated），并贴出改动后的枚举读数。

  **未削弱**：`units.every((u) => seen.has(u))` 与 `assert.fail(siblingProbeTimeoutReport(...))` **一字未改** —— 该用例仍要求枚举里含**本探针自己那四条 scope 的名字**（⛔ 不是「枚举非空即可」）；`SIBLING_PROBE_APPEAR_TIMEOUT_MS` 仍是 **30_000**（⛔ 未调大）；该用例**未被删除、未被跳过**。同文件另外两条夹具用例（含「自己的 unit 被排除」「scope 的 inner cgroup 不算单元」）也一字未改。

  **改动后的枚举读数**（同容器，探针在飞时）：

  ```
  count       = 19      <- 修前 18
  ancestors   = ["system.slice/docker-d977b31a….scope"]
  probe present? = true
  reason      = null
  units       = [ …宿主层原那 18 条…, "quay-anchor-sibling-probe-ac1-0.scope" ]
  ```

  **两臂测试读数**（同一条用例）：
  - 容器（CI 形状）：`✔ REAL cgroup — live sibling scopes are really COUNTED, and the derived ceiling really tightens (255.9ms)`；该文件 14/14 pass，0 fail。
  - 宿主（本机，非容器）：同一条 **258.2 ms** 绿；14/14 pass，0 fail（⇒ 修法对宿主是 no-op）。

- [x] AC6: 改动只落在声明的 `## Touches` 文件内（贴 `git diff --name-only`）。

  ```
  $ git diff --name-only develop...HEAD
  plugin/scripts/driver-runtime.ts
  plugin/test/driver-anchor-memory-envelope.test.mjs

  $ node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
      --task gap-anchor-envelope-probe-scope-never-appears-in-shared-host-enumeration \
      --worktree <wt> --merge-target develop
  ANTI-DRIFT OK: task gap-anchor-envelope-probe-scope-never-appears-in-shared-host-enumeration
    — 2 actual file(s), all within declared Touches (3 glob(s))
  ```

  另外：`scripts/test.sh --for-task gap-anchor-envelope-probe-scope-never-appears-in-shared-host-enumeration --allow-thin` ⇒ **exit 0**（change-relevant 静态检查全 PASS + 该文件 14/14）。直接消费方 `full-suite-runner-cgroup.test.mjs`（56/56）、`full-suite-runner-declared-memory-guard.test.mjs`（5/5）、以及 `driver-runtime-s*.test.mjs` + `driver-anchor*.test.mjs`（89/89）均绿。

## DoD

- 落地后 develop 的**真实 CI run** 中该用例不再是失败项：粘贴 **run id + 结论 + 该 run 的 testFiles**。⛔ **本机全绿不是替代品** —— 上一条任务正是拿「本机 A/B 全绿」当成了「CI 也绿」，而 CI 在它落地后又跑了 4 次全红。
- ⛔ 若落地后下一轮 develop CI **仍在红**：本任务**不是 done** —— 必须 retreat 回 ready 并在 `## Disposition` 写明实测读数与下一步，⛔ 不得以 `done` 收尾。
- ⛔ 不引入新的 CI 失败项。
- ⛔ 达成方式不得是：调大 `SIBLING_PROBE_APPEAR_TIMEOUT_MS`、删除/跳过该用例、把断言改成「枚举非空即可」。

## Touches

- plugin/test/driver-anchor-memory-envelope.test.mjs
- plugin/scripts/driver-runtime.ts
- tasks/gap-anchor-envelope-probe-scope-never-appears-in-shared-host-enumeration.md