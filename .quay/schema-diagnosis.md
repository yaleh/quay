# 任务文件格式与工具支持诊断报告

**日期**: 2026-09-03  
**分析对象**: task_write MCP 工具、任务 schema 定义、depends_on 字段处理  

---

## 执行摘要

检查发现了三层间的**不对称与不完整**：
1. task_write MCP 工具 schema 中缺少 depends_on 顶级参数
2. parseTask 函数不支持 extra 块下的嵌套结构（虽然 readDependsOn 可以处理）
3. 文档中没有清楚的说明用户如何通过 task_write 写入 depends_on

---

## 发现详情

### 1. task_write MCP Schema 定义（缺失 depends_on 参数）

**位置**: `packages/quay-native/src/mcp-server.ts:121-146`

```typescript
server.registerTool(
  "task_write",
  {
    description: "Write/patch one task's frontmatter and/or body in the native Provider's task store.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      status: z.string().optional(),
      labels: z.array(z.string()).optional(),
      parent: z.string().nullable().optional(),
      children: z.array(z.string()).optional(),
      body: z.string().optional(),
      extra: z.record(z.string(), z.any()).optional(),  // ← depends_on 必须通过这里
      expectedStatus: z.string().optional(),
    },
  },
  // ...
);
```

**问题**:
- ✅ `extra` 参数存在，可传 JSON 对象
- ✅ 支持注释 (QN-007) 说明 extra 是「逃生舱口」
- ❌ **不支持 `depends_on` 作为顶级参数**
- ❌ **文档中未说明 depends_on 应如何传递**（是否作为 `extra.depends_on`？）
- ❌ **schema 中未定义 extra 的子结构**（诸如 depends_on 应为数组）

---

### 2. Store.write() 实现（支持 extra，但有限制）

**位置**: `packages/quay-native/src/store.ts:1063`

```typescript
function write(id: string, { 
  title, status, labels, parent, children, extra, body, expectedStatus 
}: { 
  title?: string; status?: string; labels?: string[]; parent?: string | null; 
  children?: string[]; extra?: Record<string, unknown>;  // ← 接受任意 JSON
  body?: string; expectedStatus?: string; 
}): (Task & { updatedAt?: number }) | null
```

**处理逻辑** (第 1104 行):
```typescript
if (extra !== undefined) frontmatter.extra = extra;
```

**能力**:
- ✅ 接受任意 JSON 对象作为 extra
- ✅ 直接写入前言，支持嵌套结构
- ✅ 通过 `YAML.stringify()` 序列化为有效 YAML

**限制**:
- 没有 schema 验证（接受任何 JSON）
- depends_on 是否应该在 extra 里需要用户自己知道

---

### 3. parseTask() 函数（不对称：只读标量值）

**位置**: `plugin/scripts/task-schema.ts:150-203`

parseTask 解析 extra 块的方式（第 180-189 行）：

```typescript
const extra = {};
const eLines = frontmatterRaw.split(/\r?\n/);
const eIdx = eLines.findIndex((l) => /^extra:\s*$/.test(l));
if (eIdx >= 0) {
  for (let i = eIdx + 1; i < eLines.length; i++) {
    if (/^\S/.test(eLines[i])) break;  // ← 非缩进行表示块结束
    const m = eLines[i].match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) {
      let v = m[2].trim().replace(/^["']|["']$/g, "");
      extra[m[1]] = v;  // ← 只存储标量值
    }
  }
}
```

**问题**:
- ✅ 支持 `extra: { key: value, ... }` 内联形式
- ✅ 支持 `extra:` 块下的标量键值对
- ❌ **不支持嵌套结构** —— `depends_on:` 下的 `- item` 列表被忽略
- ❌ **测试证实**：task_write 写入 `extra: { depends_on: [dep1, dep2] }` 后，parseTask 读回时 `extra.depends_on` 为空字符串

**实际测试结果**:
```
Input to task_write:  extra: { depends_on: [dep1, dep2], schema: v1 }
    ↓ (YAML 序列化) 
Written to file:  
  extra:
    depends_on:
      - dep1
      - dep2
    schema: v1
    ↓ (parseTask 读取)
parseTask result:  extra.depends_on = ""
```

---

### 4. readDependsOn() 函数（设计原意是支持嵌套，但文档隐晦）

**位置**: `plugin/scripts/task-schema.ts:205-227`

readDependsOn 注释说（第 207-208 行）：
> either form may sit at column 0 or be indented under `extra:`

**实现**（第 213-224 行）：
```typescript
export function readDependsOn(frontmatterRaw) {
  const flow = frontmatterRaw.match(/^[ \t]*depends_on:\s*\[([^\]]*)\]\s*$/m);
  if (flow) return flow[1].split(",").map(s => s.trim()...).filter(Boolean);
  
  const lines = frontmatterRaw.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^[ \t]*depends_on:\s*$/.test(l));
  if (idx < 0) return [];
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+-\s+(.+?)\s*$/);  // ← 支持缩进列表
    if (m) out.push(m[1]...);
    else if (/^\S/.test(lines[i])) break;  // ← 非缩进行表示块结束
  }
  return out;
}
```

**能力**:
- ✅ 支持 `depends_on: [a, b]` 流形式（任何缩进）
- ✅ 支持 `depends_on:` 块形式（任何缩进，包括嵌在 extra 下）
- ✅ **测试验证：所有四种形式都返回正确结果**

**使用者** (被 slot-refill, driver-filters, ready-pool-check 调用):
```typescript
for (const d of readDependsOn(task.frontmatterRaw)) deps.push(d);
```

---

### 5. 调用路径现状

| 操作 | 入口 | 写函数 | 读函数 | 缺口 |
|------|------|--------|--------|------|
| CLI task edit | quay-native CLI | store.write() | parse() | 仅支持标量 extra |
| MCP task_write | quay-native MCP | store.write() | parse() | 仅支持标量 extra |
| 派发前置检查 | slot-refill.ts | - | readDependsOn() | ✅ 能读嵌套 |
| 晋升检查 | ready-pool-check.ts | - | readDependsOn() | ✅ 能读嵌套 |
| 工作流 driver | driver-filters.ts | - | readDependsOn() | ✅ 能读嵌套 |

**关键观察**：
- 读取路径用 readDependsOn()（支持嵌套）
- 但写入路径（task_write）的文档未明确说明如何写入

---

## 三层一致性缺口

### 缺口 1: 文档与工具不对齐

| 层 | 声明 | 实际 |
|----|------|------|
| CLAUDE.md | "readDependsOn…能读…嵌入 extra 下的 depends_on" | 真，但文档隐晦 |
| task-schema.ts | "依赖的机器可读之家" | 支持读，但 parseTask 不支持 parse 嵌套 |
| task_write schema | 无声明 | 支持写（通过 extra），但无说明 |

### 缺口 2: parseTask vs readDependsOn 不对称

```
parseTask("  extra:\n    depends_on: [a, b]")
  → extra: { depends_on: "" }  ❌

readDependsOn("  extra:\n    depends_on: [a, b]")
  → [a, b]  ✅
```

这是因为两个函数的设计目的不同：
- parseTask：用于结构化的前言对象化（支持 JSON 序列化）
- readDependsOn：用于原始字符串的关系提取（正则查询）

但用户看到的是：同一个数据，两种读法，结果不一样。

### 缺口 3: Schema 标注的不完整性

task-schema.ts 第 1 行的块注释说：
> this module exports pure, side-effect-free check functions...  
> The validator IS the schema: this module exports pure...  
> **The human-readable, generated-FROM-code view of that schema**

但 task_write 的 schema（在 mcp-server.ts 中，用 Zod 定义）：
- ❌ 没有 depends_on 说明
- ❌ extra 的子结构（包括 depends_on 应为数组）未定义
- ❌ 与 task-schema.ts 的正式定义没有跨越二者的一致性检查

---

## 发现的现状（截至今日运作）

1. **流程可用**：虽然文档隐晦，但实际流程有效
   - 用户通过 task_write + `extra: { depends_on: [...] }` 写入
   - YAML 序列化正确嵌套
   - readDependsOn 能正确读取和解析
   - 派发/晋升检查正常工作

2. **隐患**：文档空白导致
   - 新用户无法发现正确用法
   - parseTask 的局限被隐藏（有 parseTask 就误以为能读所有 extra 内容）
   - 跨工具一致性无保障

3. **技术债**：
   - 三个读函数（parse, parseTask, readDependsOn）各有各的实现
   - 没有一个单一的权威前言解析器
   - depends_on 字段的「两个主体」（顶级 vs 嵌在 extra 下）未被正式化

---

## 建议

### 短期（文档）
1. **更新 mcp-server.ts 的 task_write schema 注释**
   ```typescript
   // extra 中可包含 depends_on（数组）用于声明前置任务
   // 示例：extra: { depends_on: [dep1, dep2], schema: "v1" }
   extra: z.record(z.string(), z.any()).optional(),
   ```

2. **在 CLAUDE.md 中添加 task_write 用法示例**
   - 展示如何通过 MCP 写入 depends_on

3. **补充 task-schema.ts 顶部的人类可读 schema 视图**
   - 说明 depends_on 可在顶级或嵌入 extra

### 中期（工具支持）
1. **强化 parseTask 支持嵌套 extra**
   - 或至少在读取失败时给予警告
   - 添加 parseTaskNested() 或让 parseTask 使用完整 YAML.parse()

2. **在 task_write schema 中添加 depends_on 顶级参数**（可选，但提高易用性）
   ```typescript
   inputSchema: {
     // ... 其他参数
     depends_on: z.array(z.string()).optional(),  // 便捷参数
     extra: z.record(z.string(), z.any()).optional(),
   }
   ```
   实现时：如果 depends_on 被传递，将其合并到 extra 中

3. **添加单元测试验证 task_write → readDependsOn 的循环**
   ```typescript
   test("task_write + readDependsOn round-trip", () => {
     const task = store.write(id, { extra: { depends_on: [dep1, dep2] } });
     const deps = readDependsOn(task.frontmatterRaw);
     assert.deepEqual(deps, [dep1, dep2]);
   });
   ```

### 长期（架构）
1. **统一前言解析**
   - 创建单一的 `parseFrontmatterCompletely()` 函数
   - 返回完全结构化的对象（包括嵌套 extra）
   - 被所有消费者使用（parseTask, readDependsOn 都在其上层）

2. **明确 depends_on 在 schema 中的位置**
   - 考虑提升为顶级字段（如 parent/children）
   - 或作为 task-schema.ts 中的正式声明部分

3. **生成工具 schema 文档**
   - 从 task-schema.ts 正式定义自动生成 mcp-server.ts 的 Zod schema
   - 消除手工维护的不一致

---

## 检查清单

- [x] task_write MCP schema 定义已读
- [x] store.write() 实现已读
- [x] parseTask 实现已读
- [x] readDependsOn 实现已读
- [x] 四种 depends_on 形式已测试
- [x] readDependsOn 确认支持嵌入 extra
- [x] parseTask 确认不支持嵌套 extra（仅标量）
- [x] 跨工具调用路径已追踪
- [x] 文档和代码的不对称已确认

---

## 结论

**当前状态**：可用但隐晦  
**建议优先级**：短期文档 > 中期工具 > 长期架构  
**影响范围**：所有使用 MCP task_write 写入前置任务的用户  

