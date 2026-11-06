# Evidence — gap-primitives-decouple-from-quay-fleet

Date: 2026-11-06

## What changed

`packages/quay/src/primitives/` 的四个会话读写原语（`pty-frame` / `delivery-audit` /
`session-liveness` / `session-schema`）此前被声明为 quay-fleet 的逐字节副本，规则是「去 quay-fleet 改再
re-pin」；`primitives-drift-check.ts` 经 manifest 的 `fleetRepo` 读仓库外的 `/data/home/yale/work/quay-fleet-org.git`，
缺失即 exit 3，而 `runner-static-gate.ts:691` 把它接进静态门。上游已冻结，于是那条不变式在换一台机器上
永久 NOT-EVALUATED —— 一个诚实的「读不懂输入」，但也是一个没人能消费的读数。

本任务翻转方向：**quay 成为 canonical**。

1. `PROVENANCE.md` — 主语改为「quay 是权威」，就地修改 = 同一提交内重记基线；quay-fleet 的来源、冻结
   镜像与退役经过移入一节显式标注的 **READ-ONLY RECORD**（历史，不是规则、不是指针）。
2. `primitives-drift-manifest.json` — 删 `fleetRepo` / `fleetSha` / `fleetSourceDir`；只剩 `localDir` +
   四个 sha256（值与改动前逐字相同）。
3. `primitives-drift-check.ts` — 单侧比对：只读 manifest 与四个本地文件；**不再 import
   `node:child_process`，不再跑任何 `git`**。状态：0 一致 / 1 漂移（含声明文件缺失）/ 2 用法错误 /
   3 基线不可读。`--fleet` 现在是**显式用法错误（exit 2）**，不再被静默忽略（一个陈旧的双侧调用方
   否则会以为做过双侧比对）。
4. `runner-static-gate.ts` — 注释与行为一致（不再有「外部仓库缺失 ⇒ NOT-EVALUATED」路径）；接法不变。
5. 测试 — `primitives-drift-check.test.mjs` 改为「本地基线」正/负臂；`session-primitives-adoption.test.mjs`
   删掉 `fleetRepo` 读取与 `t.skip` 分支（该不变式现在**不可能**落进「跳过」态）。
6. 机件与目录声明 — `checker-mutation-cases/primitives-drift-check.sh` 重写为无 git 夹具；
   `capability-catalog-declarations.json` 的 QUESTION / INVALIDATION / LAST_REAFFIRMED 三表同步。
7. 注释与夹具去耦 — `serve-send.ts` / `observation.ts` / `inner-blocked-signal.ts` 不再声称
   「byte-identical to the pinned quay-fleet blob」；`goal-store.test.mjs` 的 quay-fleet 二进制名换成中性
   占位；`spec-reporter-suite-log-bda3e2.txt` 保留为**历史夹具**（md5 仍被测试钉住），来源说明写在
   旁边的 `…bda3e2.provenance.md`（⛔ 不改夹具本身，否则 md5 自证失效）。

## AC2 — `rg` 命中计数（before / after）

命令（AC2 原文）：

```sh
rg -n 'fleetRepo|/data/home/yale/work/quay-fleet' plugin/scripts packages/quay
```

改动前（`git grep` 于本任务 fork 点 `fecaf6ba6`，同一 pattern）：

```
BEFORE lines: 28
BEFORE files: 5
  packages/quay/src/primitives/PROVENANCE.md
  packages/quay/test/init.test.mjs
  plugin/scripts/checker-mutation-cases/primitives-drift-check.sh
  plugin/scripts/primitives-drift-check.ts
  plugin/scripts/primitives-drift-manifest.json
```

改动后：

```
$ rg -n 'fleetRepo|/data/home/yale/work/quay-fleet' plugin/scripts packages/quay
packages/quay/src/primitives/PROVENANCE.md:75:| Archive of record | `/data/home/yale/work/quay-fleet-org.tar.gz` (read-only) |
packages/quay/src/primitives/PROVENANCE.md:76:| Frozen bare mirror | `/data/home/yale/work/quay-fleet-org.git` |
```

**28 → 2 行，5 → 1 个文件。** 残余两条全部落在 `PROVENANCE.md` 中那一节标题为
`## Source history — READ-ONLY RECORD, not a rule and not a live pointer` 的历史记录里（AC2 明确允许）。
实现面（`primitives-drift-check.ts`、manifest、mutation case）**零命中**。

其他载体（不在 AC2 的搜索面内，故未改）：`docs/analysis/*.json` 是历史分析快照，
`plugin/test/worker-fan-in-spec-attribution.test.mjs` 的注释与 `plugin/test/fixtures/` 的历史日志是
**捕获字节的出处说明**，不是本仓库的读取指针。

## AC3 — checker 只读仓库内基线；三种状态实测

夹具 root（`mktemp -d`）内四个 primitive + 本地基线 manifest，逐条取实际退出码：

| 控制 | 动作 | 实际退出码 |
|---|---|---|
| 基线绿 | 文件与基线逐字节相同 | `0` |
| 负控 1 | 删掉一个 primitive（`pty-frame.mjs`） | `1` |
| 负控 2 | 改文件、基线不动 | `1` |
| 负控 3 | 只改基线 sha256（换成另一个合法 64-hex），文件不动 | `1` |
| 基线不可读 | 删掉 manifest | `3` |
| 基线不可解析 | manifest 是非法 JSON | `3` |
| 基线空 | `files: {}` | `3` |
| 基线值不是 sha256 | `"pty-frame.mjs": "deadbeef"` | `3` |
| 退役旗标 | `--fleet <path>` | `2` |

`检查器只读仓库内基线`的另一半（不是靠读源码断言）：在 **PATH 指向空目录**（没有 `git`、没有
`sha256sum`、没有任何外部二进制）下跑真实检出，仍然 exit 0 —— 见下节。

## AC4/DoD — 「无外部镜像仍可评估」的读数

真实检出、**不给任何外部输入**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/primitives-drift-check.ts --root <worktree>
primitives-drift-check: 4 file(s) compared against the local baseline (packages/quay/src/primitives)
  ok    pty-frame.mjs: local=0e0934cfc16d baseline=0e0934cfc16d
  ok    delivery-audit.mjs: local=5da101bc15d1 baseline=5da101bc15d1
  ok    session-liveness.mjs: local=f2a462a963ef baseline=f2a462a963ef
  ok    session-schema.mjs: local=36350484ebf0 baseline=36350484ebf0
primitives-drift-check: PASS — all four primitives match their recorded local baseline.
exit=0
```

同一命令，`PATH` 置空：

```
$ env PATH=<empty-dir> node ... primitives-drift-check.ts --root <worktree>
... same four `ok` lines ...
primitives-drift-check: PASS — all four primitives match their recorded local baseline.
exit=0
```

改动前同一根因下的读数对照（历史）：外部镜像不在的机器上恒为 `exit 3 / NOT-EVALUATED`。现在
`exit 3` 只剩一个来源 —— **基线 manifest 本身读不出来**，而在任何 checkout 里它都在。

## AC5 / AC1 — 测试

```
$ node --test plugin/test/primitives-drift-check.test.mjs plugin/test/session-primitives-adoption.test.mjs
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ skipped 0
exit 0
```

（`session-primitives-adoption.test.mjs` 的 skip 数从 1 变为 0：那条 `t.skip` 分支已随外部依赖一起删除。）

mutation case：

```
$ bash plugin/scripts/checker-mutation-cases/primitives-drift-check.sh <tmpdir>
primitives-drift-check mutation case: PASS (green → one-byte drift RED → restored green;
NOT-EVALUATED exit 3 for an absent baseline and for an uninterpretable baseline value; --fleet exit 2)
exit=0
```

`packages/quay/test/goal-store.test.mjs`（二进制名中性化）：100 tests / 100 pass。

## ADR-007 dark axis

`L_D`/`L_G` 本任务未取数值读数：改动是**依赖方向的清理**（去掉一条指向仓库外的读取边），不是结构
度量的变化。该轴仍暗，理由见任务体 `## ADR-007 dark axis` 一节。
