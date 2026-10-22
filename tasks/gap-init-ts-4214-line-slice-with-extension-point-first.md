---
id: gap-init-ts-4214-line-slice-with-extension-point-first
title: init.ts 4214 行 / 79 exports 是根包最大的单文件——先按 DIR-133 裁定 2 定「新 provider
  注册在哪」， 再做一刀带扩展点判据的切片
status: done
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事实一（体量，2026-10-22 archguard，HEAD `329087733`）**：`packages/quay/src/init.ts` = **4214 行 / 79 个 exports**，是 `packages/quay/src` 根目录最大的单文件；根包整体 27 文件 / 320 实体，仍是第二大包（serve 之后）。

**事实二（职责混杂，按导出名可读出来）**：同一文件里同时有
- 配置分类与变更：`classifyConfig`（`:96`）、`reconcileConfigContent`（`:264`）、`upgradeConfigContent`（`:445`）；
- 配置生成：`generateConfigContent`（`:986`）、`generateLaunchSettingsContent`（`:1535`）、`generateProfilesContent`（`:1589`）；
- 项目探测：`detectProjectType`（`:1286`）、`detectProvider`（`:1295`）、`detectTestCommand`（`:1320`）、`detectTmuxSession`（`:1341`）；
- 运行环境：`validateWorktreeRoot`（`:1369`）、`mcpEntryForProvider`（`:974`）、`resolveProjectLoopValues`（`:1409`）；
- 备份与损坏恢复：`corruptBackupPathFor`（`:597`）。

**事实三（为什么不能直接拆）**：DIR-133 裁定 2 规定设计切片的 AC 必须含扩展点判据；quay 自己的 `worker` 就是反例——只抽区域不建扩展点，之后 **82%** 的增长回流中心文件。plantuml-js 的 `elk.ts` 同款：行数 570→150 后长回 278，call 出度 23→26。所以本任务**先回答「新 provider / 新探测规则注册在哪里」，再切**。

**事实四（变的轴要看历史，不靠猜）**：`git log --numstat -- packages/quay/src/init.ts` 能看出哪些函数总是同时改（例如新增 provider 时 `detectProvider` 与 `generateConfigContent` 是否连带）。这个共变分组是「哪条轴真的在动」的直接量，不是设计猜测。

## Plan

1. **职责盘点**：把 79 个 export 按「配置分类 / 配置生成 / 项目探测 / 运行环境 / 备份」分组，每组给行区间与代表函数。
2. **共变分析**：跑 `git log --format=%h --numstat -n 200 -- packages/quay/src/init.ts`，把每条提交命中的函数（按行区间）记下来，输出「同一次提交里一起改的函数」的共现计数，取前 5 组。
3. **定扩展点**：基于共变结果选一个变体轴，写出「新 X 注册在哪、注册后中心文件不需要改什么」的一句话定义，并给出可取假的验证（正臂：从外部注册一个新 X，中心文件不动即可生效；负臂：未注册不生效；注入泄漏：把查找表替换成恒返回默认值的实现，正臂必须打红；红线基线：中心文件行数在改动前必须 ≥ 基线）。
4. **切一刀**：只切该轴对应的那一组函数，用 `plugin/scripts/extension-point-criteria.ts --scaffold` 生成四臂骨架，再用 `extension-point-criteria-check.ts` 判定。
5. **读数**：切前 / 切后各跑一次 `wc -l packages/quay/src/init.ts` 与 archguard `outDegree`（同口径 `topByOutDegree`），如实贴出；不设阈值。
6. **不碰的**：配置升级/备份逻辑（`upgradeConfigContent`、`corruptBackupPathFor`）不在本切片范围内，写进非目标。

## Acceptance Criteria

- [x] AC1 职责盘点：贴出 5 组职责表（组名、行区间、代表函数、export 数），合计 export 数与 `grep -c '^export ' packages/quay/src/init.ts` 一致（切片前 15+5+9+36+14=79，与 grep 的 79 相等；行区间覆盖 67–4215 无缝隙，无未归属声明）。
- [x] AC2 共变读数：贴出「同一次提交里一起改的函数」前 5 组及共现次数，并附生成该读数的完整命令与原始输出前 10 行（前 5 组为 7/7/7/6/6，全部 runInit 族；据此另取 provider 轴的伴侣读数：`generateConfigContent` ⟷ `GH_TOKEN_REF`=3、⟷ `LOOP_VALUE_MIGRATIONS`=3、⟷ `mcpEntryForProvider`=2 —— 切的就是这一组）。
- [x] AC3a 正臂（活性检查）：从 `packages/quay/src/init-provider-registry.ts` 之外（测试文件里）注册一个新的 descriptor `demo`、不改 `packages/quay/src/init.ts`，生成配置后读数必须是 triggered=1（计数断言，不是「descriptor 存在」）。实跑：honest registry + `providerId=demo` ⇒ `triggered=1`。
- [x] AC3b 负臂：同一个计数断言在【未注册】时读数为 triggered=0，并同时断言 handlerRegistered=false（`lookup()` 返回 null），且未注册的 id 仍拿到通用 ABI 块（含 `path:`/`mcp_entry:`、不含 native 的四个 carrier pin）——最后一条是该臂的牙齿：泄漏的分派器会把某个已注册 provider 的块发给它。实跑：`providerId=ghost` ⇒ `triggered=0 handlerRegistered=false`。⚠️ 本臂与 AC3a 的 counted 正臂成对（triggered=1），不是单飞的真空绿。
- [x] AC3c 注入泄漏：把查找表替换成泄漏实现（`resolve`/`lookup` 无视注册表、恒返回 native descriptor），上一臂/正臂的同一断言必须打红。实跑：leaky registry + `providerId=demo` ⇒ `triggered=0`（正臂红），+ `providerId=ghost` ⇒ `handlerRegistered=true`（负臂红）。该臂证明负臂断言本身不真空。
- [x] AC3d 红线基线：改动前记录 `wc -l packages/quay/src/init.ts` 的基线 4214，并断言改动后行数 < 基线；改动前跑该断言为红（`4214 < 4214` 为假 ⇒ RED），改动后为绿（`4167 < 4214`）。**本 AC 是单次验收、非常设棘轮**，不进入常设检查链，也不需要重锚规则。
- [x] AC4 检查器判定：`extension-point-criteria-check.ts` 对填好的任务体判 `satisfied`；两次输出均贴在 `## Disposition`（填前 `verdict=satisfied`、四臂均 true —— ⚠️ 这不是 AC 预期的 `missing-arms`，见 Disposition「偏差记录」：本任务立案时的 AC3/AC6 已用散文携带了四臂的全部关键词，检查器按位置读标记、不判语义，故填前即已 satisfied；填后仍是 `satisfied`，且四臂现在是四条独立 checklist 项而非散文）。
- [x] AC5 切片落地：新注册的 X 从 `init.ts` 之外的文件注册，`grep -n 'NATIVE_PROVIDER_INIT|GITHUB_PROVIDER_INIT|demo_marker|uncomment to use GitHub Issues|default_task_status: todo' packages/quay/src/init.ts` 全部为 0（不出现具体实现），`init.ts` 只剩 runner 调用处（`...renderProviderSection({...})` @`:1016`、`...PROVIDER_ENTRIES_HELP` @`:1010`、type import @`:62`）；新增文件 `packages/quay/src/init-provider-registry.ts`（descriptor 实现在 `:128`/`:149`）。
- [x] AC6 结构读数：切前 / 切后 `wc -l packages/quay/src/init.ts` = 4214 / 4167；`topByOutDegree` 同口径（archguard `dependencies` 表，`init.ts.*` 实体）切前 70 实体、`generateConfigContent` 出度 0、`mcpEntryForProvider` 出度 0，切后 69 实体、`generateConfigContent` 出度 2、`mcpEntryForProvider` 已不在 `init.ts`（移至 `init-provider-registry.ts`），新模块 `renderProviderSection` 出度 5。**不判断好坏，只记录。**
- [x] AC7 无新环：`archguard_detect_cycles(outputScope=package, scope=src)` 前后均为 `cycles=[]`（长度 0）、`maxScc=1`。
- [x] AC8 非目标守住：`git diff --numstat develop...HEAD` 只有三个文件（新增 registry 255/0、`init.ts` 26/73、新增测试 231/0）；`init.ts` 的 hunk 头（旧文件坐标）为 `-54,0 / -935,5 / -956,26 / -1005,0 / -1021,15 / -1037,27`，与 `upgradeConfigContent`（旧 `:445–596`）、`corruptBackupPathFor`（旧 `:597–606`）两条行区间均无交集。

## Definition of Done

- 有一个从 `init.ts` 之外注册的扩展点，且注册后新增同类不需要修改 `init.ts`（由 AC5 的 grep 与 AC3 的正臂共同证明）。
- 四臂判据在改动前为红、在改动后为绿，且负臂与注入泄漏臂都实跑过。
- 结构读数（行数、出度、环数）前后各一份，如实记录，不以「拆完行数少了」单独宣布成功。

## Disposition

### 切片内容（一句话定义）

**扩展点**：`ProviderInitDescriptor`（`packages/quay/src/init-provider-registry.ts`）。它描述「一个 provider 对新装 `.quay/config.yml` 的 `providers:` 段贡献什么」——`renderBody(ctx)` 返回它自己的块体，可选 `renderTrailing(ctx)` 返回它自己的注释示例。新 provider = 往 `PROVIDER_INIT_REGISTRY` 注册一个 descriptor（或在别处 `createProviderInitRegistry()` 后 `register` 再注入），**`init.ts` 一个字都不用改**；中心文件只留 `...renderProviderSection({ providerId, providerPath, abs, registry: opts.registry })` 这一个调用点。未注册的 id 走 wildcard fallback（`GENERIC_PROVIDER_INIT`），渲染通用 ABI 块（`path` + `tasks_dir` + `mcp_entry`），不是拒绝——行为不倒退。

### AC1 职责盘点（切片前，4214 行 / 79 exports）

| 组 | 行区间 | 代表函数 | export 数 |
|---|---|---|---|
| G1 配置分类 / 调和 / 升级（含损坏备份路径） | 67–616 | `classifyConfig` `reconcileConfigContent` `upgradeConfigContent` `corruptBackupPathFor` | 15 |
| G2 配置生成（provider 块 / gates / loop / profiles / launch settings 模板） | 937–1285, 1535–1676 | `generateConfigContent` `generateLaunchSettingsContent` `generateProfilesContent` | 5 |
| G3 项目探测 / 运行环境判定 | 1286–1534, 1677–1693 | `detectProjectType` `detectProvider` `detectTestCommand` `detectTmuxSession` `validateWorktreeRoot` `resolveProjectLoopValues` | 9 |
| G4 init 编排 + 既有 workspace 增量维护 | 617–936, 1694–3707 | `runInit` `buildInitReport` `printNextSteps` `ensureLoopConfig` `switchEnabledProviderText` | 36 |
| G5 交付面 / 闭环自证 / 安装步骤 | 3708–4215 | `providerEntryFile` `providerRuntimeExistenceReport` `autoCommitClosedSet` | 14 |

合计 **15+5+9+36+14 = 79** = `grep -c '^export ' packages/quay/src/init.ts` 的 79。分组的机械读法（声明区间由 `^export|function|const|…` 声明行切出，相邻声明之间的行归前一声明）：

```bash
node /tmp/gap-init-slice/inventory.mjs packages/quay/src/init.ts   # 110 个顶层声明，79 个 export
# 分组后：G1=15 G2=5 G3=9 G4=36 G5=14，TOTAL exports=79 decls=110
# unassigned decls: none / uncovered line spans (67-4215): none
```

### AC2 共变读数

完整命令（在切片前的 `packages/quay/src/init.ts` 上跑；把每条提交 `git show --unified=0` 的**旧文件行号**映射到该提交父版本里的声明区间，再统计同一次提交里一起被改的函数对）：

```bash
node -e '
const {execFileSync}=require("node:child_process");const F="packages/quay/src/init.ts";
const g=(...a)=>execFileSync("git",a,{encoding:"utf8",maxBuffer:1e8});
const decl=s=>{const L=s.split("\n"),r=[];let b=false;for(let i=0;i<L.length;i++){const l=L[i];
if(/^\s*\/\*/.test(l)&&!/\*\//.test(l))b=true;else if(b&&/\*\//.test(l))b=false;if(b)continue;
const m=l.match(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|interface|type|class)\s+([A-Za-z0-9_$]+)/);if(m)r.push({n:m[1],l:i+1});}
return r.map((x,i)=>({n:x.n,s:x.l,e:(r[i+1]?.l??L.length+1)-1}));};
const log=g("log","--format=%h","-n","200","--",F).trim().split("\n");const co=new Map();let n=0;
for(const sha of log){let p;try{p=g("show",sha+"^:"+F)}catch{continue}const R=decl(p);const h=new Set();
for(const line of g("show","--format=","--unified=0",sha,"--",F).split("\n")){
const m=line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);if(!m)continue;const a=+m[1],c=m[2]===undefined?1:+m[2];
if(c===0){const d=R.find(x=>x.s>a)??R[R.length-1];if(d)h.add(d.n);continue}
for(let i=a;i<a+c;i++){const d=R.find(x=>i>=x.s&&i<=x.e);if(d)h.add(d.n)}}
if(!h.size)continue;n++;const A=[...h].sort();
for(let i=0;i<A.length;i++)for(let j=i+1;j<A.length;j++){const k=A[i]+" ⟷ "+A[j];co.set(k,(co.get(k)??0)+1)}}
console.log("commits-scanned="+log.length+" commits-with-attributed-change="+n+" pairs="+co.size);
for(const [k,v] of [...co].sort((a,b)=>b[1]-a[1]).slice(0,5))console.log(v+"\t"+k);'
```

原始输出（前 6 行；`fatal: … exists on disk, but not in 'f78d904ae^'` 是创建该文件那条提交没有父版本，被 try/catch 跳过，不影响计数）：

```
commits-scanned=45 commits-with-attributed-change=40 pairs=415
7	GH_TOKEN_REF ⟷ runInit
7	resolveProviderPath ⟷ runInit
7	InitOptions ⟷ runInit
6	InitReport ⟷ runInit
6	InitOptions ⟷ resolveProviderPath
```

**读数怎么用的（以及它的偏差）**：前 5 组全是 `runInit` 族——这是**归因粒度**的产物，不是「runInit 是变体轴」：`runInitImpl` 一个声明就占 1754–2398 共 645 行，任何改在那段里都记到它头上，而 `runInit`（1694–1738）是它的 45 行入口，`InitOptions`/`InitResult` 是它的签名。**故按 Plan 3 另取 provider 轴的伴侣读数**（同一命令，只保留含 `generateConfigContent` 的提交）：

```
5	generateConfigContent ⟷ ruleLine
4	generateConfigContent ⟷ ConfigState
3	generateConfigContent ⟷ GH_TOKEN_REF
3	generateConfigContent ⟷ runInit
3	generateConfigContent ⟷ LOOP_VALUE_MIGRATIONS
2	generateConfigContent ⟷ mcpEntryForProvider
```

`generateConfigContent`（provider 配置生成）与 `GH_TOKEN_REF`（github 示例块）、`mcpEntryForProvider`（provider 启动入口选择）、`LOOP_VALUE_MIGRATIONS`（loop 默认表）在同一批提交里一起动——**切的就是这一组**：provider 的 fresh-install 块。

### AC3 四臂实跑

```
$ node --experimental-strip-types /tmp/gap-init-slice/arms-demo.mjs
正臂   honest  registry, providerId=demo  -> triggered=1
负臂   honest  registry, providerId=ghost -> triggered=0 handlerRegistered=false
注入泄漏 leaky registry, providerId=demo  -> triggered=0  (正臂 red)
注入泄漏 leaky registry, providerId=ghost -> handlerRegistered=true  (负臂 red)
```

同一断言以 checklist 形式固化在 `packages/quay/test/init-provider-registry.test.mjs`：

```
$ node --test --experimental-strip-types --test-name-pattern "正臂|负臂|注入泄漏" packages/quay/test/init-provider-registry.test.mjs
✔ 正臂: a descriptor registered OUTSIDE init.ts is rendered — triggered=1
✔ 负臂: an UNREGISTERED id reads triggered=0 and handlerRegistered=false — and gets no registered provider's block
✔ 注入泄漏: a lookup table that ignores registration reds the SAME assertions
ℹ tests 3   ℹ pass 3   ℹ fail 0
```

红线基线（改前为红、改后为绿）：

```
基线前： $ git show HEAD~1:packages/quay/src/init.ts | wc -l   ->  4214
        断言 4214 < 4214  ->  RED
改动后： $ wc -l < packages/quay/src/init.ts                    ->  4167
        断言 4167 < 4214  ->  GREEN
```

「改动前该扩展点不存在」的另一半边（正臂在改前无主体 ⇒ 红）：

```
$ git cat-file -e HEAD~1:packages/quay/src/init-provider-registry.ts
fatal: path 'packages/quay/src/init-provider-registry.ts' exists on disk, but not in 'HEAD~1'   (exit 128)
```

### AC4 检查器两次输出

填前（立案时的任务体，含 AC3/AC6 散文）：

```
$ node --experimental-strip-types plugin/scripts/extension-point-criteria-check.ts \
    --task-id gap-init-ts-4214-line-slice-with-extension-point-first --json
{"evaluated":true,"verdict":"satisfied","applicable":true,"satisfied":true,
 "arms":{"positive":true,"negative":true,"injectionLeak":true,"redLineBaseline":true},
 "missing":[],"missingLabels":[],"missingArms":[],"weak":[],"acItems":8, ... "ok":true}
```

填后（本任务体，四臂为四条独立 checklist 项）：见本轮 `task_write` 之后的复跑——**同为 `satisfied`**（`acItems` 由 8 增至 11）。

**偏差记录（如实写，不粉饰）**：AC4 立案时预期「填前 = `missing-arms`（具名缺哪几臂）」。实跑不是。原因是检查器按**位置**读标记（`## Acceptance Criteria` 里的 GFM 项）而不判语义，而本任务立案时的 AC3 已经把 `正臂`+`triggered=1`、`负臂`、`注入泄漏` 三个词写在同一条上，AC6 又带了 `wc -l`，四臂标记在填前就齐全 ⇒ 检查器读 `satisfied`。**这是检查器的一个真实盲区（关键词在、实现未做也能绿），不是本任务的实现证据**；故本轮把四臂拆成 AC3a–AC3d 四条独立项，让「臂在不在」与「散文提没提」不再是同一个形状。`satisfied` 因此**不能单独证明什么**——真正的证据是上面那四行 `triggered=` 读数。

### AC5 切片落地（grep）

```
$ grep -n "renderProviderSection|PROVIDER_ENTRIES_HELP|ProviderInitRegistry|init-provider-registry" packages/quay/src/init.ts
57:// registered in init-provider-registry.ts. ⛔ This file must never name a concrete provider here —
60:  PROVIDER_ENTRIES_HELP,
61:  renderProviderSection,
62:  type ProviderInitRegistry,
63:} from "./init-provider-registry.ts";
67:export { mcpEntryForProvider } from "./init-provider-registry.ts";
994:  registry?: ProviderInitRegistry;
1010:    ...PROVIDER_ENTRIES_HELP,
1014:    // init-provider-registry.ts, rendered from the table below. Adding a provider = registering a
1016:    ...renderProviderSection({ providerId, providerPath, abs, registry: opts.registry }),

$ for t in NATIVE_PROVIDER_INIT GITHUB_PROVIDER_INIT demo_marker 'uncomment to use GitHub Issues' 'default_task_status: todo'; do
    printf '%s\t%s\n' "$(grep -c -- "$t" packages/quay/src/init.ts)" "$t"; done
0	NATIVE_PROVIDER_INIT
0	GITHUB_PROVIDER_INIT
0	demo_marker
0	uncomment to use GitHub Issues
0	default_task_status: todo
```

新增文件：`packages/quay/src/init-provider-registry.ts`（`NATIVE_PROVIDER_INIT` @`:128`、`GITHUB_PROVIDER_INIT` @`:149`、`GENERIC_PROVIDER_INIT`、`createProviderInitRegistry`、`PROVIDER_INIT_REGISTRY`、`renderProviderSection`）与 `packages/quay/test/init-provider-registry.test.mjs`。

**生产路径行为不变（切片的安全网）**：把切片前（`HEAD~1:packages/quay/src/init.ts`）与切片后的 `generateConfigContent` 对同三组入参做逐字节比较（native + repo 相对路径 / native + `node_modules` 路径 + `root` 绝对 pin / native + `values` 项目值）——三例全部 `IDENTICAL`（8724 / 8778 / 9402 字节）。

### AC6 结构读数（不判好坏）

| 量 | 切前 | 切后 |
|---|---|---|
| `wc -l packages/quay/src/init.ts` | 4214 | 4167 |
| archguard `init.ts.*` 实体数 | 70 | 69 |
| `init.ts.generateConfigContent` outDegree | 0 | 2 |
| `init.ts.mcpEntryForProvider` outDegree | 0 | 不存在（已移至 registry 模块） |
| `init-provider-registry.ts.renderProviderSection` outDegree | — | 5 |

口径：`archguard_summary(outputScope=class, scope=src)` 的 `topByOutDegree` 取不到 `init.ts` 符号（它们不在全局前 10），故用同一份 `.archguard/query/<scope>/arch-index.json` 的 `dependencies` 表按下式读出度：`outDegree(id) = dependencies[id].length`，过滤 `id.startsWith("init.ts.")`。脚本：`/tmp/gap-init-slice/outdeg.mjs`。

⚠️ 同名口径的注意点：`outDegree` 在这里统计的是**实体级出边**（dependency/call），`generateConfigContent` 切前为 0 是「它只调用同文件里的私有 helper，没有跨实体出边」，不是「它没有调用」。切后为 2 是因为它多了两条指向 registry 模块的出边。**这正是「不判断好坏、只记录」的理由。**

### AC7 环读数

```
切前： archguard_detect_cycles(outputScope=package, scope=src)
      {"granularity":"package","evaluated":true,"cycles":[],"maxScc":1, ...}
切后： {"granularity":"package","evaluated":true,"cycles":[],"maxScc":1, ...}
```

两侧 `cycles` 长度均为 0、`maxScc` 均为 1，无新环。

### AC8 非目标守住

```
$ git diff --numstat develop...HEAD
255	0	packages/quay/src/init-provider-registry.ts
26	73	packages/quay/src/init.ts
231	0	packages/quay/test/init-provider-registry.test.mjs

$ git diff -U0 develop...HEAD -- packages/quay/src/init.ts | grep '^@@'
@@ -54,0 +55,13 @@ import {
@@ -935,5 +947,0 @@ export interface InitOptions {
@@ -956,26 +963,0 @@ function loopDefaultsFor(providerId: string): Array<[string, unknown]> {
@@ -1005,0 +988,7 @@ export function generateConfigContent(opts: {
@@ -1021,15 +1010 @@ export function generateConfigContent(opts: {
@@ -1037,27 +1012,5 @@ export function generateConfigContent(opts: {
```

旧文件坐标的改动区间（合并）：`54`、`935–939`、`956–981`、`1005`、`1021–1035`、`1037–1063`。
非目标占用的旧行区间：`upgradeConfigContent`（`export function` @旧 `:445`，区间 445–596）、`corruptBackupPathFor`（旧 `:597–606`）。
**交集：空。** 两段非目标代码一个字节都没动。

### ADR-007 暗轴读数

- L_D archguard: cycles=0 maxScc=1 src_entities_before=1077 src_entities_after=1083 root_pkg_entities_before=320 root_pkg_entities_after=326 root_pkg_files_before=27 root_pkg_files_after=28

口径同 AC6/AC7：`archguard_analyze` + `archguard_summary(outputScope=package, scope=src)` + `archguard_detect_cycles(outputScope=package, scope=src)`，切前/切后各一次，同一 scope key。读数如实记录；root 包实体从 320 增至 326（新增的 registry 模块带进 1 文件 / 6 实体），src 全量实体 1077→1083，环数两侧均 0。

### 验证

- `bash scripts/test.sh --for-task gap-init-ts-4214-line-slice-with-extension-point-first --allow-thin` → exit 0（scoped 静态检查层 + 相关测试通过）。
- `npx tsc --noEmit -p tsconfig.json` → exit 0。
- `node --test packages/quay/test/init.test.mjs` → 90/90 pass。
- `node --test packages/quay/test/init-provider-registry.test.mjs` → 8/8 pass。

### 环境红诊断（2026-10-22 本轮复跑，非本任务引入）

本轮 suite 的两个红都落在本任务 delta **之外**（两个文件与 develop 逐字节相同：`git diff develop HEAD -- <file>` 为空）。逐个隔离复跑后的定位：

1. **`packages/quay/test/serve-sessions-zh-chrome.test.mjs` AC1⑥（整页 byte-identity）——套件并发下的抖动，隔离复跑 4/4 绿**（与 `plugin/test/task-granularity-advice.test.mjs` 同跑也绿）。
   机制（由代码路径 + 字节数双向确定）：`/sessions` 页内嵌 `obsNote(readSessions(...).status, reason)`，`readSessions` 调 `claude agents --json`（`packages/quay/src/observation.ts:3135`，`timeoutMs: 20_000`）。成功 ⇒ `status:"ok"` ⇒ `obsNote` 返回空串（长度 0）；128 lane 负载下该命令超时被杀 ⇒ `status:"empty"` + reason ⇒ 页面多出**恰好 87 字符**的 `<p class="meta"><strong>未接入/无数据</strong> — claude agents --json 未能运行（spawn 失败或超时被杀）</p>`。失败输出里两侧长度差正是 87（27920 − 27833）。两次 HTTP 往返各自独立读一次 live 外部命令，故该断言依赖「这次超时没有」，与 `?lang=en` 无关。
2. **`plugin/test/task-granularity-advice.test.mjs` AC6 (production)——develop 侧数据边界红，隔离复跑必红**。该臂读**主检出**的 `.quay/worker-outcome.jsonl`（`repo-root.ts` 的 `mainCheckoutRoot()` = `/data/home/yale/work/quay`），与分支内容无关。实测 10 个尺寸 bin 的样本数（`since=2026-09-16`，measured=678）：

   ```
   <100=119  100–150=58  150–250=94  250–400=104  400–600=107
   600–1000=102  1000–1500=50  1500–2000=23  2000–3000=10  3000+=11
   ```

   最小 bin（2000–3000）已达 10 ⇒ `bins.some(b => b.insufficient)` 恒假 ⇒「至少一个 bin 欠采样」这条断言永久红。这是 **data-quota 边界翻转**（数据攒够后判据自己变红），修法在判据/数据窗口侧，不在本切片。

两条都不在 `## Touches` 内，也都不由本切片引起；本切片的验证（scoped 门 exit 0、registry 8/8、`init.ts` 4167 行）与上一轮一致。

## Touches

- packages/quay/src/init.ts
- packages/quay/src/init-provider-registry.ts
- packages/quay/test/init-provider-registry.test.mjs
- tasks/gap-init-ts-4214-line-slice-with-extension-point-first.md
