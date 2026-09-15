---
id: gap-driver-status-misreports-anchor-hosted-kind-as-down
title: quay driver status --kind &lt;k&gt; 误报被 driver-anchor 托管的 kind 为
  alive=0/running=0(host=supervisor)，实际该 kind 正在正常运转
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
## Finding

Real-machine evidence, gathered this session on 2026-09-14/15 while migrating quay's own production drivers from the legacy per-kind supervisor form to the single-anchor form, `/home/yale/work/quay`, commit range around `017d4f8f4`..`a4fbd481c` on develop.

After migrating all 6 kinds (promotion/worker/outer/quality/meta/goal) onto a single `driver-anchor.ts __anchor` process (confirmed via `ps`: one process, pid stable, `anchor.json` lists all 6 kinds), `quay driver status --kind worker --json` and `--kind outer --json` reported:

```
{"kind":"worker","host":"supervisor","anchor_pid":4014875,"supervisor_pid":null,"driver_pid":null,"alive":0,"running":0,...}
```

i.e. `alive=0`/`running=0`/`host=supervisor` — reads as "this kind is down" — while the SAME kind's `promotion`/`quality`/`meta`/`goal` siblings, migrated via the exact same mechanism at the exact same time, correctly reported `host="anchor", driver_pid=<anchor pid>, alive=1, running=1`.

Cross-checked against ground truth (bypassing the CLI entirely): `.quay/worker-round.jsonl` and `.quay/outer-round.jsonl`'s last records were timestamped 1-20 seconds before the query — i.e. both kinds were genuinely alive and actively ticking under the anchor at the exact moment `driver status` reported them as down. This was reproduced twice independently (both right after the initial migration, and again ~15 minutes later after the driver-anchor dist-closure fix had fully settled), and also triggered a real false alarm from a standing external Monitor watching this repo's drivers ("ALL 6 driver kinds down simultaneously for 180s — shape matches a real ecosystem-wide outage") when in fact the anchor process and all 6 kinds' round files were fresh.

Likely mechanism (not yet root-caused by the filer — implementer should verify against current code, not assume): `driver status`'s per-kind reporting path in `plugin/scripts/driver-runtime.ts` appears to read a per-kind pid file (`.quay/<kind>-driver.pid` / `.quay/<kind>-driver-supervisor.pid`) that no longer exists/gets updated once a kind is anchor-hosted, and doesn't consistently fall back to querying the anchor's own internal state (`.quay/anchor.json` + the anchor's own liveness) for EVERY kind — `promotion`/`quality`/`meta`/`goal` happened to report correctly (`host=anchor`) while `worker`/`outer` did not, in the exact same anchor/environment, so whatever branch decides `host` is inconsistent across kinds rather than uniformly broken or uniformly working.

Impact: this is a `硬规则 4b`-class defect (a status reading that looks like ground truth but is actually a decayed/wrong proxy) — it will keep generating false "driver is down" alarms (human-facing CLI output, `quay server status --json`, and any external monitor built on top of `driver status`) for any anchor-hosted deployment, indefinitely, unless fixed. Given AC-255 (process consolidation) just landed in production, EVERY kind will be anchor-hosted going forward, so this bug's blast radius is now the entire fleet, not an edge case.

Dedup check performed (this session, via `task_list` search): `gap-driver-status-carrier-path-source-label-mismatch` (status ready) was checked and confirmed to be a DIFFERENT, unrelated provenance bug — which carrier file supplied a timestamp, not whether a kind is reported alive/dead. Searches for "host=supervisor", "driver status misreport", "anchor-hosted", "误报" surfaced no other task naming this specific alive/host misreport mechanism. Not a duplicate of any existing task.

## Root cause confirmed (追加, 2026-09-15, 由另一会话精确定位)

之前的"可能机制"现在有精确证据支持,并且发现范围比原始报告更广——不只是 `quay driver status` CLI 误报,dashboard 的 `renderMgrCard`(`packages/quay/src/serve-dashboard.ts:821`)也受同一根因影响,表现为**同一症状的不同外观**(CLI 显示 `alive=0`,dashboard 显示"未运行")。

**先排除一个方向(重要,避免误修)**:另一位协作者曾怀疑是 `packages/quay/src/serve-dashboard.ts:821` 的 `d.running === true` 类型不匹配(以为 `running` 字段运行时是数字 `1` 不是布尔 `true`)。**这个怀疑不成立**——直接调用 `observation.ts` 的 `readDriverStatus()`(dashboard 真实读的那条路径,in-process 调 `aliveness()`,零 CLI/JSON 往返)实测确认 `running` 字段运行时确实是**真布尔值**(`typeof d.running === "boolean"`)。`quay driver status --json` 的 CLI 输出把 `running` 转成 `1`/`0` 是那个**独立、故意**的 CLI 契约(`driver-runtime.ts` 的 `statusForKind()` 显式 `a.running ? 1 : 0`),dashboard 根本不读这条路径,两者是完全不同的代码路径,不要混着修。

**真正的根因,已用生产读数验证**:`aliveness()`(`plugin/scripts/driver-runtime.ts:1668`)对 anchor 托管的 kind,用 `anchorHosts()`(`:705`)判断"这个 kind 是否被 anchor 接管"——判据是 `.quay/<kind>-driver.pid` 文件里的值**严格等于**当前活着的 anchor 自己的 pid。若不匹配(文件缺失/内容是别的值),`hosted=false`,于是 `running` 回落到**旧的 legacy 判据** `supervisorAlive && driverAlive`——而 anchor 托管的 kind **根本没有 supervisor 进程**,`supervisorAlive` 恒 false,`running` 因此恒 false,即使该 kind 的 round 记录几秒钟前刚写过。

生产实测(`/home/yale/work/quay`,anchor pid=4014875,六个 kind 均已确认在 anchor 下真实运转):

```
promotion: .quay/promotion-driver.pid = 4014875（匹配 anchor pid）⇒ hosted=true ⇒ running=true（正确）
worker/outer/quality/meta/goal: .quay/<kind>-driver.pid 文件【完全缺失】⇒ hosted=false ⇒ running=false（错误——这五个 kind 全部真实存活，round 记录均为几秒前）
```

**pid 文件缺失本身的根因,已定位到写者层但尚未完全查清为何 5/6 不一致**:`driver-anchor.ts:127-140` 的 `startKindTask()` 注释明确写着"写者分工":`pidSelf=true` 的 kind 由**该 kind 自己的 main() 代码**在进入常驻循环后自写 pid 文件(⛔ anchor 不能预写,那会把"刚 spawn"伪装成"已就绪");只有 `pidSelf=false` 的 kind(注释点名 worker)才由 anchor 代写。实测每个 driver 自己文件里的自写代码:

```
grep "writeFileSync.*pid\b" 各 driver 文件:
  promotion-driver.ts   ✅ 有（:790，实测该 kind 唯一 running=true 的）
  outer-driver.ts       ✅ 有（:405）— 但实测该 kind 仍 running=false，pid 文件仍缺失，与"有自写代码"矛盾，未查清为何
  quality-gate-driver.ts ✅ 有（:1055）— 同上，有代码但实测仍缺失，未查清
  goal-driver.ts        ❌ 完全没有 pid 文件自写代码
  meta-driver.ts        ❌ 完全没有 pid 文件自写代码
  worker-driver.ts      （pidSelf=false，理论上该由 anchor 代写；anchor 侧代写代码存在于 driver-anchor.ts:137，
                          但实测 worker 的 pid 文件同样缺失，anchor 代写路径为何没生效也未查清）
```

⛔ **未完全定位的部分,留给实现者**:`outer`/`quality`/`worker` 三者"有对应写入代码,但生产实测 pid 文件仍缺失"这一半没有查清——可能是条件触发的写入时机问题(比如只在某个分支/某次特定启动路径才写)、也可能是 anchor 迁移时清理逻辑把已写的文件又删了、也可能是这三个 kind 自 anchor 迁移后从未真正走过一次"进入常驻循环"的完整生命周期分支。**明确排除**：`goal-driver.ts`/`meta-driver.ts` 两个是结构性缺失(压根没有这段代码),不需要再猜测,直接补齐即可；另外三个需要实测追踪一次完整生命周期(加日志/打断点或读 anchor.log 的时间线)才能定位。

**验证方法(可复跑)**:
```
node --experimental-strip-types -e '
import { readDriverStatus } from "./packages/quay/src/observation.ts";
const r = await readDriverStatus("/home/yale/work/quay");
for (const d of r) console.log(d.kind, "running=", d.running, typeof d.running, "lastTs=", d.lastTs);
'
```
（这是 dashboard 真实读的路径，直接暴露症状，不需要跑 web server）

## Correction to the above (追加, 同一会话, 几分钟后)

上面那节的诊断本身是对的(bug 机制、CLI 与 dashboard 是两条独立路径、5/6 kind 的 pid 文件确实缺失),但结尾那句"⛔ 未完全定位的部分,留给实现者"是**误导的**——我当时用的是自己几小时前手工重建的 `packages/quay/plugin/scripts/dist/driver-runtime.js`(打包产物,不是这个任务实际改的源码 `plugin/scripts/driver-runtime.ts`),那份 dist 是在这个任务的修复落地**之前**构建的,过期了。

刚才用同一份 `package.sh` 重新打包(拉取当前 `plugin/scripts/driver-runtime.ts` 的最新内容,含这个任务落地的 `anchorHosts()`/`readAnchorState()` 修复)后,直接对着 `/home/yale/work/quay` 复测 `observation.ts` 的 `readDriverStatus()`(dashboard 真实读的那条路径):

```
promotion running= true lastTs= 2026-09-15T07:35:39.672Z
worker    running= true lastTs= 2026-09-15T07:35:47.406Z
outer     running= true lastTs= 2026-09-15T07:35:32Z
quality   running= true lastTs= 2026-09-15T07:35:39.673Z
meta      running= true lastTs= 2026-09-15T07:35:39.673Z
goal      running= true lastTs= 2026-09-15T07:27:49.723Z
```

**六个全部正确显示 `running=true`**——这个任务的修复是完整、正确的,不存在"3/6 kind 仍然有问题"这回事。上面那句"未完全定位的部分"应该撤回:`.quay/<kind>-driver.pid` 这五个文件继续缺失是**预期行为**,不是遗留 bug——修复后的 `anchorHosts()` 本来就不再依赖这五个文件(改读 `.quay/anchor.json` 这个每轮重写的回读面),它们缺不缺已经不影响判据结果。

这也顺带证实了一条已知纪律(memory: driver-code-fix-activation-requires-main-sync-restart):**修复代码落到 `plugin/scripts/*.ts` 源码里,不等于生产在跑的 dist 产物已经拿到它**——`packages/quay/plugin/scripts/dist/*.js` 是打包产物,只有重新跑一次 `package.sh`(或等价的 build-plugin-dist 步骤)才会拿到最新源码。这个任务的 AC4"real-machine verification"如果当时是对着一份没有及时重建的 dist 产物验证的,会误判"部分修复"——但现在用新鲜重建的产物复测,确认是完全修复的,不需要再追加任何后续任务。

## AC

- [x] AC1: root cause confirmed — the exact code path in `driver-runtime.ts` (or wherever `quay driver status`/`server status` derives `host`/`alive`/`running` per kind) that produces `host=supervisor, alive=0` for an anchor-hosted kind, and why it differs between kinds that report correctly vs. incorrectly.
- [x] AC2: fix lands so `quay driver status --kind <k> --json` correctly reports `host="anchor", alive=1, running=1` for EVERY kind currently hosted by a live anchor process, cross-checked against that kind's own round-file freshness (not just internal state self-report).
- [x] AC3: negative control — a kind NOT declared in `anchor.json` (or with no live anchor at all) must still correctly report `alive=0`/legacy form as appropriate; the fix must not make "down" unreportable.
- [x] AC4: real-machine verification on `/home/yale/work/quay` (or an isolated fixture reproducing the anchor-hosted shape) — all 6 kinds queried individually report consistently with their actual round-file freshness.
- [x] AC5: a regression test exists that would have caught this (asserts `host`/`alive` for an anchor-hosted kind against a fixture where the per-kind legacy pid file is deliberately absent/stale).

## DoD

Landed on develop: the per-kind `host`/`alive`/`running` derivation in `quay driver status --kind <k>` (and any consumer of it, e.g. `quay server status --json`) correctly reports every anchor-hosted kind as alive/running when its round-carrier is fresh, for ALL 6 kinds uniformly (not just the 4 that happened to work), verified against real round-file timestamps on a real workspace (not just a green test in isolation). The regression test in AC5 fails on the pre-fix code and passes on the post-fix code (prefix-code-swap negative control). No kind's "down" reporting capability is lost (AC3 still discriminates a genuinely-down/non-anchor kind).

## Touches

- plugin/scripts/driver-runtime.ts
- packages/quay/src/cli/server.ts
- plugin/test/driver-runtime.test.mjs
- tasks/gap-driver-status-misreports-anchor-hosted-kind-as-down.md
