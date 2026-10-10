---
id: gap-ac264-fleet-project-scope-deployment-rotted
title: AC-264 第二次立案：quay-fleet 的 project-scope plugin 部署已烂（settings 键被抹、install
  记录消失、config 绑定指向不存在的 cache 版本、marketplace 源目录被删）——真实重装 + 修复绑定 + 落成提交
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-264
---
---
id: gap-ac264-fleet-project-scope-deployment-rotted
title: AC-264 第二次立案：quay-fleet 的 project-scope plugin 部署已烂（settings 键被抹、install
  记录消失、config 绑定指向不存在的 cache 版本、marketplace 源目录被删）——真实重装 + 修复绑定 + 落成提交
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-264
---
**type:** execution

## Proposal

**这是 AC-264 的第二次立案。** 第一次 `gap-ac264-quay-fleet-project-scope-plugin-only-deployment` 已 `done`（2026-09-15 落地），但判据**当前为假**——本轮直接重跑 `goals/AC-264-…md` 的 criterion（逐字，cwd=/data/home/yale/work/quay），exit 1，stderr 逐字：

```
AC-264: /home/yale/work/quay-fleet/.claude/settings.json enabledPlugins carries no quay@* key (keys=[])
```

**为什么上一次的修复没有守住（全部为立案当轮直接量，非推断）**

上一次把「project scope 已启用」实现成了 **quay-fleet 仓里一个被跟踪的文件**（提交 `9009b43 deploy: project-scope quay plugin from the marketplace channel (AC-264)`），并往载体 `.quay/productization-verification.jsonl` 追加了一条 2026-09-15 的记录。但那不是静态事实——它是 Claude Code plugin 子系统管理的**活状态**，由若干 **在本仓之外、机器全局、且会被回收** 的产物共同承载，任一被回收，部署即死：

| 直接量 | 立案当轮（2026-10-09） | 上一轮记录（2026-09-15） |
|---|---|---|
| `quay-fleet/.claude/settings.json` 的 `enabledPlugins` | `{}`（键被抹；工作树相对 `9009b43` 是**未提交修改**，`git diff` 逐字见 Evidence） | `{"quay@quay": true}` |
| 同文件 `extraKnownMarketplaces.quay.source.path` | **缺失** | `/home/yale/work/quay-plugin-dist` |
| `~/.claude/plugins/installed_plugins.json` 里 quay-fleet 的 project-scope 记录 | **不存在**（`quay@quay` 只有 claudecodeui / cantus / `/tmp` scratch×2 / claudecodeui-worktrees 的 local·project 记录，外加一条 **user** scope 0.17.0） | `scope: project`, `projectPath: /data/home/yale/work/quay-fleet`, `installPath: …/0.7.0` |
| marketplace 源目录 `/home/yale/work/quay-plugin-dist` | **已删除**（`ls` 报不存在） | 存在（dist-plugin @ `578187b0…`） |
| `quay-fleet/.quay/config.yml` 的 `providers.native.path` | `…/cache/quay/quay/**0.9.0**/vendor/quay-native` —— 该版本目录**已不存在**（cache 现有 0.10.0/0.11.0/0.14.0/0.15.0/0.16.0/0.17.0） | `…/0.7.0/…`（当时存在） |

⇒ **两条纪律同时命中**：①硬规则 4b——判据（正确地）拒绝只信 self-report，改读 `settings.json` 的键作为「project scope 已启用」的直接量；但那个键本身是**可被别处重写的活投影**，所以它红了也说不清「整条链烂到哪」；②真正没被守住的是 AC 命题里的**「自足」**——上一轮记录把 `plugin_cache_path` 锚在一个**会被后续 `claude plugin install` 顶掉的 cache 版本**上、把 marketplace 源锚在一个**会被清理的临时目录**上。任何一个被回收，部署即死，而判据只读一个键，红得晚且无解释力。

⛔ **本任务不是把键写回去。** 手写 `{"quay@quay": true}` 到 settings.json 能让判据机械翻真，但那正是 AC-264 的 `expect` 逐字禁止的「只有自报字段」形态——`installed_plugins.json` 里没有 project-scope 记录时，那个键是**无机制背书的孤儿声明**。正确修复 = **真实地以 project scope + marketplace 渠道重装**，并让绑定落在**不会随别处操作被回收**的落点。

**要做的事**

1. 在 quay-fleet 里**真实重装**（`claude plugin marketplace add <现存源> --scope project` + `claude plugin install quay@quay --scope project`），使两个直接量**同时**在场：`settings.json.enabledPlugins` 含 `quay@*` **且** `installed_plugins.json` 出现 quay-fleet 的 `scope: project` 记录。缺一不算。
2. 修复 `quay-fleet/.quay/config.yml` 的绑定：`providers.native.path` / `mcp_entry` 指向**当前真实存在**的 cache 版本（或一个**稳定的、不随别处安装被回收**的 copy）；`QUAY_NATIVE_ADR_DIR` / `GOAL_DIR` / `META_DIR` 三个 env **逐字保留**（删了会让该项目的 goals/ADR/meta 静默读写 quay 自己的 store，已有既存 gap 记录）。
3. 把 quay-fleet 里被跟踪的 `.claude/settings.json` 改动**落成提交**（⛔ 留在工作树 = 硬规则 11b 的「已生效而未记录」，且机械 fan-in 的 clean-tree 前置会红——上一轮正是栽在 `working tree not clean`）。
4. 重跑 AC-264 判据逐字 → exit 0；并**补一条新的载体记录**（`.quay/productization-verification.jsonl`），字段在写盘前**当场重读** settings.json 与 config.yml 两个直接量（⛔ 不抄 2026-09-15 那条的 0.7.0 旧值）。
5. **诊断上一轮为何未守住**：给出可证伪的定位（哪次操作抹掉了键 / 删了 marketplace 源 / 顶掉了 cache），并据此判断「自足」要不要一道**取假**的常驻检查——若判定需要则落地并给出取假读数；若判定为一次性手工操作、且给出证据，可记为无需（硬规则 12）。

<!-- dedup-ref --> 仅作追溯，不改变本任务的派发与验收：`gap-ac161-4th-regression-agent-runs-scope-user-install-to-refresh-a-shared-plugin-cache`（done）处理的是相邻面「user 级 `~/.claude/settings.json` 被顺手 `--scope user` 安装污染」，其新闸只落在 **user 级**；`gap-ac264-quay-fleet-project-scope-plugin-only-deployment`（done）是本条的前一次修复，其 `## Evidence` 的部署命令与负控制是本次复现的基线。本条修的是 **project 级** 状态被抹，那两条的落点均不覆盖。

## Acceptance Criteria

- [ ] AC1（真实重装的两个直接量同时在场）：`/home/yale/work/quay-fleet/.claude/settings.json` 的 `enabledPlugins` 含 `quay@*` 键 **∧** `~/.claude/plugins/installed_plugins.json` 的 `plugins["quay@quay"]` 中存在 `scope=="project"` ∧ `realpath(projectPath)==realpath("/home/yale/work/quay-fleet")` 的记录（注意 `/home/yale` 是 `/data/home/yale` 的软链，两处写法都要 `realpath` 归一）。命令：
```
python3 - <<'P'
import json, os, sys
ep = json.load(open("/home/yale/work/quay-fleet/.claude/settings.json")).get("enabledPlugins") or {}
half1 = any(str(k).startswith("quay@") for k in ep)
d = json.load(open(os.path.expanduser("~/.claude/plugins/installed_plugins.json")))
fleet = os.path.realpath("/home/yale/work/quay-fleet")
half2 = any(e.get("scope") == "project" and os.path.realpath(e.get("projectPath","")) == fleet
            for e in d.get("plugins",{}).get("quay@quay",[]))
print("settings_key=%s install_record=%s" % (half1, half2)); sys.exit(0 if (half1 and half2) else 1)
P
```
→ 读数应打印 `settings_key=True install_record=True`。⛔ 只有 `settings_key=True` 不算——那正是被禁止的自报形态。

- [ ] AC2（config 绑定指向真实存在的 cache、不指开发检出，三个 env 保留）：
```
python3 - <<'P'
import os
cfg = open("/home/yale/work/quay-fleet/.quay/config.yml").read()
paths = [l.split("path:",1)[1].strip() for l in cfg.splitlines() if l.strip().startswith("path:")]
assert paths, "no 'path:' binding line"
for p in paths:
    assert ".claude/plugins/cache/" in p, ("not cache-bound", p)
    assert "/home/yale/work/quay/plugin" not in p and "/home/yale/work/quay/packages" not in p, ("dev-bound", p)
    assert os.path.exists(p), ("bound cache path does not exist", p)
for k in ("QUAY_NATIVE_ADR_DIR","QUAY_NATIVE_GOAL_DIR","QUAY_NATIVE_META_DIR"):
    assert k in cfg, ("dropped env", k)
print("AC2 ok:", paths)
P
```
→ 读数应打印 `AC2 ok: [...]`，且列出的 `path:` 在盘上真实存在。

- [ ] AC3（改动落成提交，不是工作树里的未记录态）：`git -C /data/home/yale/work/quay-fleet status --porcelain -- .claude/settings.json` 输出为空 **∧** `git -C /data/home/yale/work/quay-fleet show HEAD:.claude/settings.json` 的 `enabledPlugins` 含 `quay@*`。
```
test -z "$(git -C /data/home/yale/work/quay-fleet status --porcelain -- .claude/settings.json)" \
&& git -C /data/home/yale/work/quay-fleet show HEAD:.claude/settings.json | python3 -c 'import json,sys;ep=json.load(sys.stdin).get("enabledPlugins") or {};sys.exit(0 if any(str(k).startswith("quay@") for k in ep) else 1)'
```

- [ ] AC4（判据逐字翻真）：以 cwd=`/data/home/yale/work/quay` 逐字重跑 `goals/AC-264-…md` 的 `criterion`（⛔ 从 goal 文件提取原文，不手抄），`exit 0`；在 Evidence 贴出 exit code 与 stderr（成功时为空）。

- [ ] AC5（补新载体记录，字段当场重读）：`.quay/productization-verification.jsonl` 追加一条 `ac: "GOAL-019-AC-264"` 记录，其 `plugin_cache_path` 指向**当前真实存在**的 cache 目录且不含 `verify-` / `probe` / `/tmp/`；追加脚本在写盘前对 `settings.json.enabledPlugins` 与 `config.yml` 绑定两个直接量**当场重读**后写入（⛔ 不抄 2026-09-15 那条的旧值）。读回：
```
python3 -c 'import json;r=[json.loads(l) for l in open("/data/home/yale/work/quay/.quay/productization-verification.jsonl") if l.strip()];r=[x for x in r if x.get("ac")=="GOAL-019-AC-264"];print(r[-1] if r else None)'
```
→ 读数：最后一条 `ts` / `plugin_cache_path` 为**本轮**新写入。

- [ ] AC6（诊断 + 是否加常驻检查，带证据）：在 `## Result` 给出上一轮键消失 / 源目录被删 / cache 被顶的可证伪定位（`stat` / `git log` / transcript 锚点，至少一条直接量），并据此决定是否新增一道取假常驻检查：若新增，给出其**取假读数**（改动前如何红、改回如何绿）；若判定为一次性手工操作且给出证据，明记「无需常驻检查」。⛔ 不允许无证据的「可能是……」。

## Definition of Done

- [ ] AC1–AC6 全勾；`quay task check <id>` 的 `missing` 为 `[]`。
- [ ] **判据翻 pass**：以 cwd=`/data/home/yale/work/quay` 逐字重跑 `goals/AC-264-…md` 的 criterion ⇒ exit 0（直接读数，不是本任务体自称）——即点名的两个文件系统直接量（`settings.json` 键 / `config.yml` 绑定）**同时**为真。
- [ ] driver 在下一轮独立复验该 criterion 仍 pass（本任务带 `goal_ac: AC-264`）。（待外部）
- [ ] **REAL LANDING（DIR-026 Reading A）**：不是「文件里写着 quay@quay」，而是 quay-fleet 真的以 project scope 消费了 marketplace 渠道的插件——`installed_plugins.json` 有该项目的 project-scope 记录 ∧ `config.yml` 绑定的 cache 路径 `test -e` 为真 ∧ 该路径**不是**探测/临时形态（不含 `verify-` / `probe` / `/tmp/`）。⛔ 只改文件不重装、或只重装不落提交，都不算。
- [ ] 负控制做过并留档：把 `settings.json.enabledPlugins` 手工改回 `{}`（或把 config 绑定改回开发检出）⇒ AC-264 判据翻假；恢复 ⇒ 翻真。
- [ ] scoped 门 `bash scripts/test.sh --for-task <id>` 绿（若本任务未改本仓源码，按 `scripts/test.sh` 的 scoped 语义记录实际读数）。

## Evidence

（执行时填：判据 exit code、两条直接量的当场读数、重装命令与 `installed_plugins.json` 回读、负控制前后。）

立案当轮的起点读数（供对照）：

```
$ git -C /data/home/yale/work/quay-fleet diff -- .claude/settings.json
-  "enabledPlugins": {
-    "quay@quay": true
-  },
-  "extraKnownMarketplaces": {
-    "quay": { "source": { "source": "directory", "path": "/home/yale/work/quay-plugin-dist" } }
-  }
+  "enabledPlugins": {}

$ sha256sum /home/yale/work/quay-fleet/.claude/settings.json
9465082acdd740b0510988911fb9cb1db7f6910c4e6389887c6fc8f17bbfbb8c

$ git -C /data/home/yale/work/quay-fleet log --oneline -2 -- .claude/settings.json
9009b43 deploy: project-scope quay plugin from the marketplace channel (AC-264)
2b26f9d fix(config): pin adr/goal/meta dirs to the project, not the quay repo

$ ls /home/yale/.claude/plugins/cache/quay/quay/
0.10.0  0.11.0  0.14.0  0.15.0  0.16.0  0.17.0      # config 绑定的 0.9.0 不在其中
```

## Touches

- .quay/productization-verification.jsonl
- tasks/gap-ac264-fleet-project-scope-deployment-rotted.md

**Touches 说明（本仓 Touches 纪律）**：修复对象（quay-fleet 的 `.claude/settings.json` / `.quay/config.yml` / `installed_plugins.json`）**不在本仓内**，无法作为本仓 Touches 条目声明——同前次修复 `gap-ac264-quay-fleet-project-scope-plugin-only-deployment` 的处理。故本仓 Touches 只列**真实会动的两个**：证据载体 `.quay/productization-verification.jsonl` 与自身任务体（self-touch）。⛔ 若 AC6 决定新增一道本仓内的取假检查（源码 + 测试），执行时须用 `task_write` 把该源码与测试文件补进 Touches 后再动它们。
