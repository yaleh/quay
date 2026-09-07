---
id: gap-meta-addressedtasks-input-without-output-channel
title: addressedTasks 是有入口无出口的读数——33 轮读到 110 次、四条输出通道无一是「回应一条被点名的 task」⇒ 0
  次响应，而这个 0 是无通道造成的，不能当作「无话可说」的发生率
status: done
labels:
  - gap
  - meta-driver
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/meta-driver.test.mjs
---
## Finding

**结论**：`addressedTasks` 读数（`label:meta-driver` 且未关闭的 task，`collectAddressedTasks`）是一个**建了入口却没有对应出口**的通道。实测 **33 轮读到非空 addressedTasks（累计 110 次提及），没有任何一轮的输出引用过它们**。

**根因不是 probe 不配合，是四条输出通道里没有一条的形态是「回应一条被点名的 task」**：

| 通道 | 产出物 | 能否回应一条已存在的 task |
|---|---|---|
| `divergences` | 轮记录里的解读 | 否（只由 criteria 派生） |
| `proposals` | 新 AC 记录（`goal-store write`） | 否（只能新建） |
| `autoDrive` | 新 task（`task create`） | 否（只能新建） |
| `decisions` | draft GOAL / needs-human task | 否（只能新建） |

⇒ 迄今 offered 的 7 项（autoDrive 5 / decision 2 / proposal 0）**全部**扎根于 `syncHealth.*` / `drivers.*`——它自己的发现，**没有一项来自被点名的 task**。

⊢ 这是本项目同一形状的又一实例，方向相反：`divergences` 是**有输出无处理者**；本条是**有输入无输出**。两者的共同根是同一条规则——**每一条输出必须落在一个已有唯一处理者、且该处理者具备相应动作的对象上**；建输入时没有同时确认出口，等价于建了一条通向不存在动作的路。

### ⚠️ 关键：那个 0 不是发生率（硬规则⑫，且这是本条最重要的一句）

「0 次响应」**不能**用来论证「meta-driver 对被点名的 task 无话可说」——它是**结构上不可能非零**的量（无通道 ⇒ 恒零），与硬规则④「一个结构上不可能取假的量不是测量」同源。

**所以本条 ⛔ 不建 `responses[]` 通道，只做测量那一步**：让 probe 对**每一条** addressedTask 明确输出「有意见 / 无意见」并落库，跑够窗口后用真实比例决定通道该不该建。若比例低到不值当，本条的结论就是「不建」——**这同样是本任务的合格结局**。

### 单一处理者原则不受影响（先说清，免得实现时越界）

task 的处理者恒为 promotion→worker。**本条只产出一个判定字段落进 meta-driver 自己的轮记录**，⛔ 不写 task 文件、⛔ 不改 task 的 status/labels。日后若真要建通道，其形态也应是**向 task body 追加一段复核意见**而非接管它——但那是另一条任务的事，本条不实现。

**方向倾向（供执行者判断，非强制）**：probe 规格新增一节，要求输出里对每条 addressedTask 给出 `{taskId, hasOpinion: true|false, note?}`；`meta-driver.ts` 解析并落进轮记录。⛔ **不接受**：只给一个总数（SPEC §5.3：不枚举对象则零指引价值）；⛔ 把「无意见」与「没读到这条 task」共用同一取值（硬规则③b：读不懂不得与合格同形，须有独立的「未评估」态）。

## AC

- [x] 轮记录里出现逐条可枚举的判定：对**每一条** addressedTask 给出 taskId 与三态之一（有意见 / 无意见 / 未评估），⛔ 不是总数、不是布尔。
- [x] 三态可区分且能取假：喂一个 probe 输出里明确说「无意见」的样本 ⇒ 该条为「无意见」；喂一个 probe 输出里**完全没提到**该 task 的样本 ⇒ 该条为「未评估」（⛔ 不得落成「无意见」）；喂一个有意见的样本 ⇒ 「有意见」。三个断言缺一不可。
- [x] 覆盖完整性：断言判定条数**等于** `addressedTasks` 条数（probe 少答一条 ⇒ 那条落「未评估」而不是被静默丢弃）；用一个 probe 只回答了部分 task 的样本做负控制。
- [x] ⛔ 该判定**不进** `readingsDigest`（它由 probe 输出派生、每轮可变，进摘要会废掉变化检测闸）；断言仅该判定变化时 `readingsDigest` 不变。
- [x] ⛔ 未写任何 task 文件：断言本轮改动路径下不发生对 `tasks/*.md` 的写入（单一处理者不变——task 的处理者仍是 promotion→worker）。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），三态与覆盖完整性的负控制均实跑确认能取假。
- [ ] **生产载体证据（非 fixture）**：改动落地后至少一轮真实记录里，对真实存在的 addressedTask 给出了非空三态；若彼时 addressedTasks 为空，须贴出该读数为空的真实输出作为支撑（⛔ 不得以 fixture 通过冒充生产已验，硬规则④推论三）。（待外部）
- [ ] **发生率读数写回任务体**：落地后累计至少 20 条判定（或说明为何窗口内取不到 20 条），给出「有意见」的条数与比例，并据此给出明确结论——建通道 / 不建通道。⛔ 不得以「继续观察」收尾而不给数（本条存在的全部意义就是取到这个数）。（待外部）
- [x] ⛔ 未建 `responses[]` 或任何向 task 回写的通道；⛔ 未改任何 task 的 status/labels；⛔ 未新增 driver kind、未新增周期性检查器（SPEC §5.1）。
- [x] ⛔ 未向 probe prompt 注入历史上下文（`.quay/profiles.yml:77` 的「每轮全新上下文」抗漂移设计不变）。

**验收注记（2026-09-07 worker）**：AC 1–5 全勾——实现 + `node --experimental-strip-types --test plugin/test/meta-driver.test.mjs` 实跑 79/79 全绿（新增 6 条：三态三样本可区分、覆盖完整性负控制、摘要不变、纯判定不写 task 文件）。DoD-2/3 为**落地后**生产载体观测（常驻 meta-driver 在 `.quay/meta-driver-round.jsonl` 逐轮累积 `addressedTaskOpinions`），故标 `（待外部）`；本 worker 未以 fixture 冒充生产已验（硬规则④推论三——实现落地、单测绿，但生产载体尚未跑出 20 条判定）。

## Touches

- `plugin/scripts/meta-driver.ts`
- `plugin/probes/meta-driver.md`
- `plugin/test/meta-driver.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-meta-addressedtasks-input-without-output-channel.md`