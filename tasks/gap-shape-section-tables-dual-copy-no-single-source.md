---
id: gap-shape-section-tables-dual-copy-no-single-source
title: shape 判定的「哪些标题算 AC/DoD」是两份手抄名单——store.ts 缺 draft/suffix 变体，与
  ready-pool-check 分歧（同一对文件第 2 次同类分歧）
status: done
labels:
  - gap
  - gate
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test
    packages/quay-native/test/gate-shape-dispatch.test.mjs
---
## Finding

**结论**：author→ready 的 shape 判定，CLAUDE.md 明写「is the single judge quay and meta-cc must share」，但「哪些标题算 AC/DoD」实际是**两份互不相干的手抄名单**，且已漂移。

两侧实测（按位置读，非关键词）：

- `plugin/scripts/ready-pool-check.ts:700` `SHAPE_SECTIONS.finding.ac` = `["AC","Acceptance Criteria","AC（draft）","AC (draft)",...AC_SUFFIX_VARIANTS]`
- `packages/quay-native/src/store.ts:57/65/74/91` `SHAPE_REGISTRY.*.sections.ac` = `["AC","Acceptance Criteria"]`，`dod` = `["DoD","Definition of Done"]`

即 store.ts 侧**缺失**两批变体：①`（draft）`/`(draft)` 变体（2026-08-09 由 gap-todo-shape-mismatch-author-gate 加入，只加到 ready-pool-check）；②`AC_SUFFIX_VARIANTS`/`DOD_SUFFIX_VARIANTS` 共 4 条 suffixed 标题（2026-08-13 加入，同样只加到一侧）。两次独立增补都只落到两份副本中的一份。

**直接实证（同一 body，两判据相反结论，同一分钟内）**：provider 侧 `task_check` 返回 `shape:"finding"`、`artifacts:{proposal:true, ac:false, dod:false}`、`acTotal:0` ⇒ `missing artifacts: ac, dod`；而同一时刻 promotion-driver 用 ready-pool-check 的判据把同一任务体自动 `todo → ready` 晋升（随后的 task_write 撞 `CAS conflict: expected "todo" but actual is "ready"`）。

**为什么必须结构性修，而不是把缺的变体补到 store.ts**：同一对文件、同一契约的分歧**这是第 2 次**。第 1 次是 `cand-cjk-proposal-slot-word-boundary`（status done），标题即「store.check() 的 \b 使 ## 人的裁定 提案槽别名永不匹配，与 ready-pool-check 判据分歧」，且引用了同一句 CLAUDE.md。那次统一的是**匹配语义**（`\b` → 整行精确匹配），**没有碰两份 section 名单**——所以本次分歧在结构上必然幸存。再补一次名单 = 第 3 次点修，把下一次漂移留给下一个人。

**已枚举：无既有机制拥有这个问题**（硬规则⑤，三个候选逐个查过，非只查一个就断言）：

- `plugin/scripts/mirror-pair-drift-check.ts` — 锁定 `plugin/scripts` ↔ `experiments/quay-perpetual-stream/scripts` 的**同基名 + 逐字节相同**镜像类；本对是跨目录、异名（ready-pool-check.ts vs store.ts）、且只有子结构须一致 ⇒ 不覆盖。
- `plugin/scripts/dual-source-check.ts` — 管「两个执行者做同一件事」（driver 路径 vs 会话路径退役），不是数据表副本 ⇒ 不覆盖。
- `plugin/scripts/workflows-dual-copy-drift-check.ts` — 已被 mirror-pair-drift-check 明文取代。

**可行性已实测，非推测**：`import { SHAPE_REGISTRY } from ".../packages/quay-native/src/store.ts"` 在 `node --experimental-strip-types` 下干跑通过，打印 `keys: contract,finding,plan,proposal` 与 `finding.ac: ["AC","Acceptance Criteria"]`。结构差异是 store.ts 每个 shape 有 `sections` 嵌套 + `planKeys`，ready-pool-check 的 `SHAPE_SECTIONS` 是扁平的 ⇒ 适配约为 `SHAPE_SECTIONS[shape] = SHAPE_REGISTRY[shape].sections`。

**方向倾向（供执行者判断，非强制）**：以 `store.ts` 的 `SHAPE_REGISTRY` 为单一正源（产品层不依赖方法论层，方法论层依赖产品层是正确方向），把缺失的 draft/suffix 变体加进正源，`ready-pool-check.ts` 改为 import 而非手抄。⛔ 若执行者判断这条新分层边不可接受，退路是把名单抽到一个双方都 import 的共享数据文件——但**不接受「两边各补一份名单」**，那不解决问题。

**已查的约束（执行者实测，第二条被推翻）**：`ready-pool-check.ts` 不在 `plugin/test/driver-cli.test.mjs:39` 的 `KERNEL_DEPS` 闭集内，故本改动不破坏 kernel hermetic closure（这条仍成立）。⚠️ 但「跨 `packages/` 的相对 import 会在 temp root 解析失败」这条**不是「若日后」而是立刻成立**——不是 KERNEL_DEPS，而是 **quay-init laydown**：`ready-pool-check.ts` 是 laydown 到消费者项目的机件（`promotion-driver.ts:123` 以 `node …/plugin/scripts/ready-pool-check.ts` 运行），消费者项目**没有 `packages/` 源码树**（只有 vendored dist bundle）⇒ 静态 `import "../../packages/quay-native/src/store.ts"` 必报 `ERR_MODULE_NOT_FOUND`（npm-pack-e2e 的 build-plugin-dist 实测抓到了「Could not resolve ../../packages/quay-native/src/store.ts」）。

**零新增定时检查器**：本条的修法是消灭副本本身（无从漂移），不新增周期性检查机制。

**与 `cand-cjk-proposal-slot-word-boundary`（done）的关系（实现记录，DoD④）**：那次修的是**匹配语义**（`\b` → 整行精确匹配，store.check() 的 CJK 提案槽别名），本次修的是**名单来源**（两份手抄 section 名单 → 单一正源）。两者合起来才使「is the single judge quay and meta-cc must share」这句 CLAUDE.md 契约在结构上成立：先有同一套 `\b`-free 整行精确匹配语义，再把「哪些标题算 AC/DoD」收敛到一个注册表，两个判官才真正读同一个东西。**实现选择（采「退路」共享数据文件，非「方向倾向」的 import store.ts）**：以 `plugin/scripts/shape-sections.ts` 为单一正源（纯数据，无 import），`store.ts` 与 `ready-pool-check.ts` **双方都 import 它**。名单落在 laydown 集合内的 `plugin/scripts/`（quay-init 显式条目加入，避免 consumer 侧 `ERR_MODULE_NOT_FOUND`）；产品层 store.ts 反向 import 纯数据文件（esbuild bundle 内联进自足 dist，产品构建不受影响）；并给 store.ts 的 heading 正则补 `escapeRegExp`——否则新注册的括号标题（`AC (draft)` / `Acceptance Criteria (runnable)` 等）会被当 regex 捕获组、永不匹配字面标题。

## AC

- [x] 单一正源成立：`plugin/scripts/ready-pool-check.ts` 不再自行维护一份 AC/DoD 标题名单，其判定所用的 section 名单与 `packages/quay-native/src/store.ts` 的 `SHAPE_REGISTRY` 为同一来源（import，或双方共同 import 的共享数据）。判据：一条命令分别从两侧取同一 shape 的 ac/dod 数组并逐元素比较，全部相等 ⇒ exit 0。
- [x] 分歧消失（行为级，非源码排版级）：对同一个含 `## Finding` + `## AC（draft）` + `## DoD（draft）` 的任务体，`store.check()` 与 `ready-pool-check` 的 `artifactsComplete()` 给出一致的 artifacts 判定。⛔ 判据须读两个函数的返回对象，不得 grep 源码是否含某字符串。
- [x] 能取假的负控制：从单一正源中删掉 `（draft）` 变体后，上一条判据立即变红（证明它测的是真行为，不是恒真回声）。
- [x] 既有 ASCII 标题（Proposal/Contract/AC/DoD/Finding/Plan）匹配行为不变：`packages/quay-native/test/gate-shape-dispatch.test.mjs` 与 `plugin/test/ready-pool-check.test.mjs` 全绿。

## DoD

- [x] 上述判据本轮实跑通过并贴出输出（⛔ 不是转述、不是「应该会过」），且负控制实跑确认能取假。
- [x] 修的是「两份手抄名单」这个结构本身：改动后再往任一 shape 加一个新标题变体，两个判官会**同时**看见它；这一点须由一个具体动作证明（例如临时加一个变体后两侧同时识别），而不是靠断言。
- [x] ⛔ 未新增任何周期性/定时检查机制；⛔ 未采用「两边各补一份名单」的修法。
- [x] 与 `cand-cjk-proposal-slot-word-boundary`（done）的关系写入任务体：那次修匹配语义、本次修名单来源，两者合起来才使「单一判官」这句 CLAUDE.md 契约在结构上成立。

## Touches

- `packages/quay-native/src/store.ts`
- `plugin/scripts/ready-pool-check.ts`
- `packages/quay-native/test/gate-shape-dispatch.test.mjs`
- `plugin/test/ready-pool-check.test.mjs`
- `plugin/scripts/shape-sections.ts`
- `plugin/scripts/quay-init.sh`
- `plugin/scripts/capability-catalog.sh`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-shape-section-tables-dual-copy-no-single-source.md`