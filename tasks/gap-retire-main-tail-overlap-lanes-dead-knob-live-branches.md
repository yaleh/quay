---
id: gap-retire-main-tail-overlap-lanes-dead-knob-live-branches
title: 退役 main_tail_overlap_lanes——注释声称已被调度器取代且生产 6 轮 0 次触发，但 test.sh 的两处分支仍只凭
  &gt;0 触发，关掉 suite_scheduler 即静默复活 16 条重叠
status: done
labels:
  - gap
  - retire
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/suite-params.test.mjs
---
## Finding

**人 2026-09-07 裁定：`main_tail_overlap_lanes` 是应当废弃的机制。**

本条记录它此刻的**实测**状态，供退役时按实情处理——它既不是「还在生效」，也不是「已经没了」，而是**第三种、也是最危险的一种：死配置 + 活分支**。

### 一、生产上确实不触发（先说清，避免把它当成当前负载的成因）

近 6 份 fan-in 套件日志中 `main-tail-overlap: lanes=` 出现次数：

```
08:02→0   07:59→0   07:25→0   07:13→0   07:01→0   06:43→0
```

⇒ 走默认的 `suite_scheduler` 路径时，`test.sh:1243` / `:1794` 那两个分支到不了。`plugin/scripts/suite-params.ts:44-46` 的自陈（`phase_overlap` / `main_tail_overlap_lanes` / `main_tail_stall_pct` 是 **RETIRED-BY-SCHEDULER**，「stay in the CLOSED schema so an existing config that still sets them keeps validating」）**与实测一致**。

⚠️ 我一度怀疑这个退役声明是假的（本仓库刚出现过 `goal-driver.ts:272` 那种假覆盖声明），**是上面这组日志读数把我的怀疑证否的**——写在这里，免得执行者重走。

### 二、但分支还活着，且只凭 `> 0` 触发

```
scripts/test.sh:555    MAIN_TAIL_OVERLAP="${QUERY_MAIN_TAIL_OVERLAP:-0}"
scripts/test.sh:1243   if [ "$MAIN_TAIL_OVERLAP" -gt 0 ]; then
scripts/test.sh:1251     node --test-concurrency="$MAIN_TAIL_OVERLAP" .../suite-lpt-runner.mjs "$@" "${files[@]}"
scripts/test.sh:1794   if [ "$MAIN_TAIL_OVERLAP" -gt 0 ] && [ "${#bucket_main_files[@]}" -gt 0 ]; then
scripts/test.sh:1803     node --test-concurrency="$MAIN_TAIL_OVERLAP" .../suite-lpt-runner.mjs ...
```

而生产 `.quay/config.yml` 里 `main_tail_overlap_lanes: 16` **仍然写着**（`readSuiteParams()` 实跑返回 `{"max_oversubscription":1,"main_tail_overlap_lanes":16}`）。

⇒ **只要 `suite_scheduler` 被关掉（它自己就是「ONE-KEY ROLLBACK」旋钮），16 条主泳道与负载敏感尾并跑的行为会静默复活**，而没有任何东西会报出来。这正是本项目反复付代价的形态：一个看起来退役、实则随时可复活的机制。

### 三、那个 `16` 还是一个机器规格字面量

`.quay/config.yml` 该段的注释自己写着：

> 其余 suite 旋钮用默认；serial/lowconc 并发 host-derived **不写字面量**（硬规则 4 推论二）。

而紧邻两行就是 `main_tail_overlap_lanes: 16`——**16 恰好等于本机 nproc**。换台机器它就不再是「等于全部核数」，而是一个随机数值。同段的 `max_oversubscription` 已于 2026-09-07 由人指示从 `1.75` 降到 `1`（16×1.75=28 是当时实测 `--test-concurrency=28` 的来源）。

### 四、⚠️ 环境变量名是 `QUERY_` 不是 `QUAY_`（退役时按错的名字 grep 会漏）

```
suite-params.ts:55   main_tail_overlap_lanes: "QUERY_MAIN_TAIL_OVERLAP"      ← QUERY_
suite-params.ts:54   max_oversubscription:    "QUAY_MAX_OVERSUBSCRIPTION"    ← QUAY_
```

两侧（写入方 suite-params、读取方 test.sh）用的都是 `QUERY_`，所以**功能上是通的**，但与全部同族旋钮不一致。⛔ 退役时若按 `QUAY_MAIN_TAIL_OVERLAP` grep 会一条都找不到，从而误判「没有引用」。

### 五、引用面已枚举完整（退役须斩断全部，⛔ 不是只删配置行）

```
plugin/scripts/suite-params.ts        :9  :10  :55
plugin/scripts/full-suite-runner.ts   :2644
plugin/scripts/capability-catalog.sh  :179   （旋钮清单里点名 QUERY_MAIN_TAIL_OVERLAP）
scripts/test.sh                       :539 :555 :1243 :1250 :1251 :1794 :1802 :1803
plugin/test/suite-params.test.mjs     :168
.quay/config.yml                      :180   （未受版本控制的本地配置，见下）
```

**⚠️ `.quay/config.yml` 不在 Touches 里**：`.gitignore:411` 列了 `/.quay/config.yml`，git 也确认未跟踪 ⇒ 它是本地运行配置。删除该行是一个**运维步骤**，须在 DoD 里单独记录并实做，⛔ 不能只改代码而把生产配置里的 `main_tail_overlap_lanes: 16` 留着（schema 若同时收紧，留着会让 config 校验 FAIL-CLOSED，直接打断全部套件）。

**方向倾向（供执行者判断，非强制）**：先删代码分支与 schema 键，再删生产配置行——⛔ **顺序反了会把套件打死**：`readSuiteParams` 是 CLOSED schema、遇未知键 fail-closed，若先删 schema 键而配置里还留着 `main_tail_overlap_lanes: 16`，下一次套件启动即 FAIL-CLOSED。**正确顺序须由执行者用一次干跑验证，并写进任务体。**

## AC

- [x] 引用面清零：`grep -rn 'main_tail_overlap_lanes\|QUERY_MAIN_TAIL_OVERLAP'` 在 `scripts/` `plugin/` `packages/` 下命中数为 **0**（归档/历史说明文件可豁免，但须逐条列出豁免项）；⛔ 命中数须打印出来，不是断言。
- [x] `test.sh` 的两处 `-gt 0` 分支及其 `node --test-concurrency=$MAIN_TAIL_OVERLAP` 调用被移除，且**移除后套件仍能正常跑完一轮**（⛔ 不是只跑单元测试）。
- [x] **能取假**：在移除前的代码上把 `QUERY_MAIN_TAIL_OVERLAP=8` 并关掉 `suite_scheduler` 跑一次 ⇒ 日志出现 `main-tail-overlap: lanes=8`；移除后同样条件 ⇒ **不再出现**。两个方向都要实跑（这条证明删掉的是一个真会触发的分支，不是死代码）。
- [x] schema 与生产配置的顺序安全：给出一次干跑证明「删 schema 键」与「删配置行」的先后不会使 `readSuiteParams` FAIL-CLOSED 打断套件；⛔ 不接受「应该没问题」。
- [x] `capability-catalog.sh:179` 的旋钮清单同步更新（它自称是唯一清单），且 catalog 自检通过。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），能取假那条两个方向都实跑。
- [x] **生产配置已同步处理**：`.quay/config.yml` 的 `main_tail_overlap_lanes: 16` 已删除，并贴出删除后 `readSuiteParams()` 的真实返回值；⛔ 该文件未受版本控制，不会随提交落地，必须单独确认。
- [x] 与 `max_oversubscription` 不混淆：本条**不动** `max_oversubscription`（它是活旋钮，已于 2026-09-07 由人指示设为 1）；⛔ 不得顺手把它一起删。
- [x] 退役理由与实测状态写入任务体：生产 0 次触发、但分支仍在、且 `suite_scheduler` 关掉即复活——说明为什么「留着不管」不可接受。
- [x] ⛔ 未新增任何旋钮/机制来替代它（本条是**删**，不是换）。

## Touches

- `scripts/test.sh`
- `plugin/scripts/suite-params.ts`
- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/capability-catalog.sh`
- `plugin/scripts/suite-scheduler.ts`
- `plugin/test/suite-params.test.mjs`
- `plugin/test/full-suite-runner-phases.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-retire-main-tail-overlap-lanes-dead-knob-live-branches.md`

## 退役执行记录（2026-09-07 实跑，⛔ 非转述）

### AC3 能取假——移除前（分支真会触发）
`QUAY_SUITE_SCHEDULER=0 QUERY_MAIN_TAIL_OVERLAP=8` + hermetic seam（stall=0 / hold=1 / poll=1）跑默认全量路径，日志出现：

```
overlap: running 7 serial + 8 lowconc files in parallel (serial conc=8, lowconc conc=8)
main-tail-overlap: lanes=8 load=12.33
```

### AC3 能取假——移除后（不再出现）
同样条件（`QUAY_SUITE_SCHEDULER=0 QUERY_MAIN_TAIL_OVERLAP=8`）：

```
overlap: running 7 serial + 8 lowconc files in parallel (serial conc=8, lowconc conc=8)
```

`main-tail-overlap: lanes=` 命中数 = **0**（分支已删除，不再发射该标记）。

### AC1 引用面清零
`grep -rn 'main_tail_overlap_lanes\|QUERY_MAIN_TAIL_OVERLAP' scripts plugin packages` ⇒ **0 命中**（打印计数）。宽族 `MAIN_TAIL_OVERLAP` / `main_tail_overlap_wait` / `main-tail-overlap` / `mainTailOverlap` / `main_tail_overlap_load` 同为 **0 命中** ⇒ 无需豁免项。

### AC4 顺序安全（干跑输出）
- **安全顺序**（先删配置行，schema 仍含键）：临时 config 去掉 `main_tail_overlap_lanes` → `readSuiteParams` 返回 `{"max_oversubscription":1}`，exit 0，无 FAIL-CLOSED。
- **不安全顺序**（先删 schema 键，配置仍含键）：sed 去键后的 schema 对生产 config 干跑 ⇒ `FAIL-CLOSED: .quay/config.yml 'suite:' has unknown key 'main_tail_overlap_lanes' — valid keys are suite_scheduler, phase_overlap, serial_concurrency, lowconc_concurrency, max_concurrent_suites, max_oversubscription, main_tail_stall_pct`，exit 1。
⇒ 本轮实做顺序 = 先删 `.quay/config.yml` 的 `main_tail_overlap_lanes: 16`，再删 schema 键。

### AC5 catalog 自检
`bash plugin/scripts/capability-catalog.sh --summary` ⇒ `capability-catalog: 318 scripts | 318 declared | 0 unclassified | 313 ship`，exit 0。

### DoD 生产配置
`.quay/config.yml` 的 `main_tail_overlap_lanes: 16` 已删除（未受版本控制，独立确认）。删除后 `readSuiteParams()` 真实返回：

```
{
  "max_oversubscription": 1.75
}
```

exit 0。⛔ `max_oversubscription` 未动（任务体称「已于 2026-09-07 由人指示设为 1」，但生产配置实测仍为 1.75——超出本条范围，如实记录，未改）。
