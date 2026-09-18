---
id: gap-webui-manager-body-copy-en-zh
title: /manager 正文文案在 lang=en 下仍是硬编码中文（三层状态卡、Monitor 注册表、观测指标说明）—— 正文本地化系列，照
  /dashboard 已定 pattern
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /manager`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**16 行**，几乎全是界面文案：

| en 下可见的中文（例） |
|---|
| `Manager / Outer / Inner — 三层状态`（标题后缀） |
| `三层自适应探测：多信号加权判定，缺失信号诚实标注「未检测到」…`（页首说明） |
| `Loop / 会话` · `Monitor 注册表` · `本仓库（项目类）` · `兄弟项目` · `读` · `单一登记表。` · `主要观测指标` |
| `未接入/无数据`（多处重复的同一状态词）· `— …/loop-driver-check.sh 缺失（产品安装无 methodology 层 → 未接入）` |
| `pool/floor/deficit/cap 读` · `（promotion-driver round 记录，cap 默认 5，floor = cap × 4）` · `release=… · develop 领先 0 提交` |

源码位置：`packages/quay/src/serve-system.ts` 的 `handleManager` 路径（该文件非注释中文行共 17 条，与 `/system` 共用文件）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/manager` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern，本任务照抄其「决定记录」①~⑨，不重新设计）。`/system` 在同一文件，由 `gap-webui-system-body-copy-en-zh` 处理；两条 Touches 重叠、由驱动串行，本条只动 `/manager` 独占的渲染串。**同一状态词出现在多处（`未接入/无数据`）——按「一个渲染串一行」共用字典行，不是每处一行**（决定记录 ①）；若与 dashboard 已有的同义行（`DASHBOARD_LABELS` 里的「未接入/无数据」）语义完全相同，**复用同一字典行的做法要显式评估**：跨表引用会制造耦合，优先在本页新增自己的行，并在任务体记录取舍。

## Plan

1. **红基线**：`startServer({port:0})`，`Cookie: lang=en` GET `/manager`，逐行列出含 CJK 的行（剔 endonym），贴完整清单；同一谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `MANAGER_KEYS` + `MANAGER_LABELS` + `managerLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量；插值行用模板 + `fillLabel`，例如 `release={v} · develop 领先 {n} 提交`）。
3. **改 `handleManager` 路径**：全部经字典；标题后缀与页名并列处理（页名走 `pageNameFor`，后缀走本页字典）。**读失败/缺失诊断串**（如 `loop-driver-check.sh 缺失…`）里 `<script 名>` 是数据、其余是文案，按模板拆开。
4. 该页若有局部刷新端点：必须带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`serve-manager.test.mjs`、`serve-ac95-views.test.mjs` 等钉中文的断言改显式 zh；负向断言必须显式 zh；先实跑找红清单，不在 Touches 的先补 Touches。
6. **新测试** `packages/quay/test/serve-manager-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh。
7. **因果对照**：`managerLabelsFor` 钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；落地后重启常驻 serve 并 headless Chrome 截图。

## AC

- [ ] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/manager` 界面文案中文行完整清单与条数；谓词先对 zh 干跑命中。
- [ ] **AC2（en 清零）**：改后界面中文行 = 0；剩余含中文的行逐条归类为用户数据（无则写「无」）。
- [ ] **AC3（zh 零变化）**：改前后各抓一次 `lang=zh` 响应，去动态数据后 diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；测试断言两列非空、`en` 无 CJK；删任一列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（所有渲染路径带语言）**：列出该页全部渲染入口/刷新端点，逐个在 `?lang=zh` 下抓取断言仍 zh。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [ ] **AC8（真实浏览器形态）**：重启 serve，headless Chrome 截图 `/manager?lang=en` 与 `?lang=zh`，en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/manager` 界面文案全为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体，⛔ 不读渲染函数返回值。
2. AC6 因果对照实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`/system` 与其余页正文不动。
4. 重启 serve + 截图（AC8），⛔ 不以「已落地」代替「页面已变」。
5. 可回滚：还原取词调用、删 `MANAGER_*`。

## Touches

- tasks/gap-webui-manager-body-copy-en-zh.md
- packages/quay/src/serve-system.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-manager-body-i18n.test.mjs (new)
- packages/quay/test/serve-manager.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
