---
id: gap-driver-test-fixture-json-read-before-write-complete-race
title: driver 测试 fixture 的 JSON 轮询读取存在"文件存在即读"竞态——existsSync 真但内容未写完时 JSON.parse 报错
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: finding
---
## Finding

两处 driver 测试基础设施里存在同一类 TOCTOU（time-of-check-to-time-of-use）竞态:轮询逻辑用"文件是否存在"(`fs.existsSync`)作为"内容是否写完"的代理信号,而写入方对目标路径不是原子发布(先写临时文件再 rename),导致轮询方可能在文件刚被创建、内容尚未写完时就读取并 `JSON.parse`,报出难以理解的解析错误而不是"还没写完,继续等"。

**实例1**:`plugin/test/driver-runtime.test.mjs:407-415`(测试"AC1 (worker cap) — start --kind worker --cap 2 ⇒ driver argv carries --concurrency 2")。轮询体:
```js
const p = path.join(root, ".quay", "worker-argv-dump.json");
if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
```
写入方 `FAKE_WORKER_DRIVER`(同文件 77-88 行)用 `fs.writeFileSync(path.join(root, '.quay', 'worker-argv-dump.json'), JSON.stringify(dump))` 直接写目标路径,不是"写临时文件再 rename"的原子发布。`existsSync` 可能在文件被创建(size=0 或写入未完成)但内容还没写完时就返回 true,导致 `JSON.parse` 报 "Unexpected end of JSON input"。

**实例2**:`plugin/test/worker-driver-resident.test.mjs`(测试"liveness wiring — resident loop calls the liveness checker each round")经由 `plugin/test/helpers/worker-driver-harness.mjs:75` 的 `readRoundLines`,在"文件存在即读"与"另一进程正在追加写入该文件"之间存在同类竞态,报错 "SyntaxError: Expected ',' or '}' after property value in JSON at position 428"。

**生产实测复现(不是理论推演)**:任务 `gap-manager-skill-session-embodiment-activation` 连续 3 次 worker 重试里,第2次(2026-09-06T03:05 前后,日志 `.quay/fan-in-suite-gap-manager-skill-session-embodiment-activation~wk-prod-1788285192~1788663344513-62cc66.log:1398-1412`)撞在实例2,第3次(2026-09-06T03:28 前后,日志 `.quay/fan-in-suite-gap-manager-skill-session-embodiment-activation~wk-prod-1788285192~1788665004746-090799.log:1972-1980`)撞在实例1——两次都与该任务自身改动(`plugin/skills/manager/SKILL.md`/`manager-start.sh`)完全无关,却耗尽了该任务的重试上限(RETRY_CAP_DEFAULT=3),把一个已经正确实现完成的任务机械翻成 needs-human。3 次重试里 2 次(2/3)撞在这类竞态上,不是孤例。

**为什么值得单独立案**:这类竞态会随机拖垮任何不相关任务的全量 suite fan-in——受害任务与本缺陷本身毫无关联,唯一的共同点是"运气不好撞上了正在跑的 driver 测试"。按"flaky 严重度=单价×重复次数"原则,一次任务的3次重试就命中2次,优先级不低。

## AC

- [x] `plugin/test/driver-runtime.test.mjs` 里 AC1(worker cap)的轮询逻辑改为"解析失败视为还没写完、继续轮询"(例如 `try { return JSON.parse(...) } catch { /* not yet, keep polling */ }`)而不是让 `JSON.parse` 直接抛出致命错误,或者 `FAKE_WORKER_DRIVER` 的写入改成"写临时文件 + `fs.renameSync` 原子发布"——两种任选其一即可消除该竞态窗口
- [x] `plugin/test/helpers/worker-driver-harness.mjs` 的 `readRoundLines`(及其在 `worker-driver-resident.test.mjs` 的调用点)同样改为"读到不完整/半行内容时视为还没写完、继续轮询"而不是让 `JSON.parse` 直接抛出——与上一条同一机制的镜像半边,两处都要修(硬规则5b:只修一处不算修好)
- [x] 为两个文件各写一个可复现的负控制:故意制造"文件存在但内容未写完/半行"的中间态(例如手动分两次 write 且中间插入一次读取,或 mock 一个延迟写完成的场景),断言修复前的旧逻辑会报错、修复后的新逻辑能正确等待并最终读到完整内容
- [x] `node --test plugin/test/driver-runtime.test.mjs` 与 `node --test plugin/test/worker-driver-resident.test.mjs` 各自单独运行全绿
- [ ] `node scripts/test.sh` 全绿(确认修复不引入新的全量 suite 回归)（待外部）

## DoD

修复落地后:
- 两处轮询逻辑(或对应写入逻辑)不再可能因为"文件刚创建、内容未写完"而抛出 JSON 解析错误——负控制测试实际制造过这个中间态并验证新逻辑正确处理(不是仅凭代码审查断言)
- 现有测试(driver-runtime.test.mjs / worker-driver-resident.test.mjs)保持原有断言意图不变,仅轮询/写入的健壮性发生变化
- 全量 suite 跑绿,且这两个测试文件不再是已知的"随机拖垮无关任务 fan-in"的flaky来源

## Touches

- plugin/test/driver-runtime.test.mjs
- plugin/test/helpers/worker-driver-harness.mjs
- plugin/test/worker-driver-resident.test.mjs
- tasks/gap-driver-test-fixture-json-read-before-write-complete-race.md
