---
id: gap-meta-addressedtasks-input-truncates-body-only-title-reaches-probe
title: 送件给 meta-driver 的通道只传 {id,status,title,labels}——任务正文整篇丢失且无任何机制报出，与「载体是完整
  task 文件、写入工具齐全」严重不匹配
status: superseded
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/meta-driver.test.mjs
---
## Finding

**结论**：把要求送给常驻 meta-driver 的唯一通道（立一条带 `label:meta-driver` 的任务）**只把标题送进去**，任务正文整篇丢失，而且**没有任何机制会报出这个丢失**。

### 一、按位置读，逐行

```
plugin/scripts/meta-driver.ts:761
export interface AddressedTask { id: string; status: string; title: string | null; labels: string[] }
```

`collectAddressedTasks()` 只从 frontmatter 取 `status` / `title` / `labels`，**从不读 `---` 之后的正文**；`buildProbePrompt()` 把整个 readings 对象 `JSON.stringify` 进提示词，所以 probe 看到的就是这四个字段。

### 二、这与输入侧其余部分严重不匹配（三者对照，实测）

| 对象 | 输入载体 | git 可见 | 写入工具 | **内容是否完整到达消费者** |
|---|---|---|---|---|
| task | `tasks/*.md` | ✓ 1801 文件 | `quay task create/edit` + `task_write` MCP + `quay-file-task` skill + `quay:quay-task` subagent | ✓ worker 收到**全文** |
| goal | `goals/*.md` | ✓ 48 | `quay goal write --origin` CLI | ✓ `origin` 全文 |
| meta（转向） | `orchestration/meta-driver-focus.md` 覆盖段 | ✓（2026-09-07 09:19 落地） | 手工编辑（与 `dispatch-preference.md` 同源） | ✓ 覆盖段**全文**进 `readings.focus`，且进摘要（`:614`） |
| **meta（送件）** | `tasks/*.md` + `label:meta-driver` | ✓ | 复用 task 全套工具 | **✗ 只有一行标题** |

⇒ **载体丰富、工具齐全、git 可见——通道却只有标题宽**。同一批工具写出来的同一种文件，送给 worker 是全文，送给 meta-driver 只剩标题。

### 三、⊢ 与输出侧那条恰成镜像（两条一起看才是完整形状）

- **输出侧**（`gap-meta-driver-has-no-visible-carrier-or-tools-unlike-task-goal-adr`）：入口是 git 可见的 task，**出口是本机 gitignored 的 jsonl** ⇒ 发件人看不到答复。
- **本条（输入侧）**：出口暂且不论，**入口本身就把内容截掉了** ⇒ 发件人写的东西根本没送到。

两条都不是「机制缺失」，而是**同一条通道的两端与中间宽度不一致**。

### 四、⚠️ 它是静默的（这是本条真正的严重性）

没有任何读数、日志或检查器会指出「这条 addressedTask 的正文有 N 字符未被送达」。发件人以为自己交代清楚了；probe 看到一行标题，据此给出 `hasOpinion:false`（「看过，无话可说」）——而这个「无话可说」**在载体上与「内容送到了但确实没什么可说」完全同形**（硬规则 3b）。

⊢ 本会话已实测到相邻现象：`addressedTaskOpinions` 通道 2026-09-07 03:46 落地，但 meta-driver 进程自 01:42 未重启 ⇒ 生产上跑的是旧代码、轮记录里根本没有该字段。**回执与送件两端都出过「看起来通了、其实没通」**。

### 五、修法可以很轻（probe 有工具权限，已核实）

`.quay/profiles.yml:78` 的 `meta-driver` 角色用 `profile: worker-default`；生产进程实测带 `"permissions":{"defaultMode":"bypassPermissions"}` ⇒ **probe 能自己读文件**。

**方向倾向（供执行者判断，非强制；三选一并写明理由）**：
- **甲（最轻，规格侧）**：`plugin/probes/meta-driver.md` 明确写「readings 只给 id/title；**需要细节时自己读 `tasks/<id>.md`**」。零机械改动。⚠️ 但它是**指令不是保证**——probe 可能不读，而且「读没读」在载体上不可区分（硬规则⑨：守与不守无法区分 ⇒ 只能靠意志）。⇒ 若选甲，须同时给一个可观测的产物（例如要求 `note` 里引用正文中的一处内容）。
- **乙（读数侧，带上限）**：`AddressedTask` 增一个正文字段（全文或前 N 字符）。⚠️ 须先**测量**当前 addressedTasks 集合的正文总字节（立案时 7 条），再决定要不要截断——⛔ 不得凭空设一个 N（硬规则④推论一：成本结构未知前不设阈值）。⚠️ 正文进读数 ⇒ 进摘要 ⇒ 改正文会触发判读，这是**正确**行为（与 focus 覆盖段同理），但须显式断言。
- **丙（结构侧）**：约定送件时把要求写进 title，正文只作人读——即**承认现状为设计**。⚠️ 若选丙，必须在 probe 规格与立案 skill 两处都写明「正文不会被送达」，否则发件人会继续误以为正文有效。
- ⛔ **不接受**：①什么都不做（发件人会继续损失内容且不自知）；②把全部 1801 个任务的正文塞进读数（addressedTasks 是带标签的子集，⛔ 不要扩大到全库）。

## AC

- [ ] 送达面被显式确定并可被机械核对：给出一条命令，读出「一条 addressedTask 有多少内容实际进入了 probe 提示词」（字节数或字段清单），⛔ 不是断言「现在送全了」。
- [ ] **丢失不再静默（无论选甲/乙/丙都必须满足）**：当任务正文非空而其内容未被送达时，该事实在**读数或轮记录**里可被读出（例如 `bodyBytes` 与 `bodyDelivered` 两个字段），⛔ 不得与「正文本来就是空的」同形（硬规则 3b）。
- [ ] 双向能取假：给一条**正文非空**的 addressedTask ⇒ 上一条的读数反映出正文的存在与送达状态；给一条**正文为空**的 ⇒ 取值不同。两个方向都断言。
- [ ] 选乙时的成本护栏：先贴出当前 addressedTasks 集合的正文总字节实测值，再说明所选的上限（若有）来自哪个读数；⛔ 不得出现一个没有测量支撑的字面量。
- [ ] 端到端：立一条**正文里含一个标题中没有的具体要求**的 `label:meta-driver` 任务 ⇒ 下一轮 probe 的 `addressedTaskOpinions[].note` 能反映出那个要求（选丙则相反：断言 note **不**反映，且规格已写明正文不送达）。
- [ ] 既有行为不回归：`addressedTasks` 的采集范围仍是「未关闭 + 带该标签」，`plugin/test/meta-driver.test.mjs` 全绿。

## DoD

- [ ] 上述判据本轮实跑并贴出输出（⛔ 不是转述），双向负控制实跑确认能取假。
- [ ] **生产载体证据（非 fixture）**：用真实的 7 条（或彼时实际数量）addressedTasks 跑一轮真实判读，贴出送达面的真实读数；⛔ 不得以单测通过冒充（硬规则④推论三）。
- [ ] 甲/乙/丙 选了哪个、为何另两个不合适，写进任务体；选甲须给出「读没读」的可观测产物（硬规则⑨）。
- [ ] 与 `gap-meta-driver-has-no-visible-carrier-or-tools-unlike-task-goal-adr`（输出侧）的关系写入任务体：两条是同一通道的两端，说明为何都需要、且互不重叠。
- [ ] ⛔ 未把全库任务正文塞进读数；⛔ 未新增 driver kind、未新增周期性检查器（SPEC §5.1）；⛔ 未改动 `addressedTasks` 的标签/状态筛选范围。
- [ ] **落地后须重启 meta-driver 并确认新字段出现在真实轮记录里**——本会话已实测「代码落地但 driver 未重启 ⇒ 生产跑旧代码、字段根本不存在」，⛔ 不可跳过这一步。

## Touches

- `plugin/scripts/meta-driver.ts`
- `plugin/probes/meta-driver.md`
- `plugin/test/meta-driver.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-meta-addressedtasks-input-truncates-body-only-title-reaches-probe.md`
