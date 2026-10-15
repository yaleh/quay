---
id: gap-anchor-envelope-probe-scope-never-appears-in-shared-host-enumeration
title: develop CI 仅剩的红：探针 scope 在有界等待 30s 后仍 4/4 不出现——上一条「加长等待」的修复被 CI 证伪
status: todo
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

- [ ] AC1: 给出探针 scope 的**实际落点读数**（完整路径逐层列出 + 取的命令），⛔ 不许只写「可能是深度不够」这类未实测断言。
- [ ] AC2: 给出 `listSharedHostScopes()` 在**同一环境**下的 walk 读数（root、maxDepth、实际到达的层、以及它为什么没看到探针），并据此给出**判别性结论**（哪个候选假说被支持/被排除）。
- [ ] AC3: 按 Plan 3 的 (a) 或 (b) 落地；粘贴 `git diff --name-only` 证明改动只落在 Touches。
- [ ] AC4: **负控（not-evaluated 分支专用）**：若走了 (b)，必须给出「正常宿主环境下该 not-evaluated 分支**不触发**」的对照读数（两侧都贴）；若走了 (a)，必须给出一条负控证明该用例**仍能取假**（例如让探针不建 scope 后必须在有界时间内红）。
- [ ] AC5: **断言强度未被削弱**：改动后该用例仍然要求枚举里含**本探针**的 scope（除非按 AC3(b) 走了具名 not-evaluated），并贴出改动后的枚举读数。
- [ ] AC6: 改动只落在声明的 `## Touches` 文件内（贴 `git diff --name-only`）。

## DoD

- 落地后 develop 的**真实 CI run** 中该用例不再是失败项：粘贴 **run id + 结论 + 该 run 的 testFiles**。⛔ **本机全绿不是替代品** —— 上一条任务正是拿「本机 A/B 全绿」当成了「CI 也绿」，而 CI 在它落地后又跑了 4 次全红。
- ⛔ 若落地后下一轮 develop CI **仍在红**：本任务**不是 done** —— 必须 retreat 回 ready 并在 `## Disposition` 写明实测读数与下一步，⛔ 不得以 `done` 收尾。
- ⛔ 不引入新的 CI 失败项。
- ⛔ 达成方式不得是：调大 `SIBLING_PROBE_APPEAR_TIMEOUT_MS`、删除/跳过该用例、把断言改成「枚举非空即可」。

## Touches

- plugin/test/driver-anchor-memory-envelope.test.mjs
- plugin/scripts/driver-runtime.ts
- tasks/gap-anchor-envelope-probe-scope-never-appears-in-shared-host-enumeration.md