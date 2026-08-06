# Research OS Workflow v2：项目级事件驱动科研运行时

> 文档状态：v2 已实现并通过 P0 验收（`[x]`）
> 对应 TODO：`P0-WORKFLOW-V2-001`
> 创建日期：2026-08-06（Asia/Shanghai）
> 适用代码副本：`/mnt/d/researchos`（WSL2 内开发，Windows 侧为 `D:\ResearchOS`）
> 旧方案记录：[`TODO-workflow.md`](./TODO-workflow.md) 保留为 v1 实施历史，不作为 v2 的执行设计

## 1. 决策摘要

Research OS 不再把整个科研项目实现为一个永不结束的 Mastra Workflow Run。

v2 保留“每个项目一份独立 `projects/<project-id>/workflow.ts`”以及“一个项目一张完整科研工作流图”，但把 workflow 的职责从“直接承载一个永久运行实例”改成“定义项目的科研语义、依赖关系、触发条件和执行策略”。实际执行由一个项目级持久化运行时负责，运行时按照事件唤醒协调器，再把可执行节点拆成多个有限、可恢复、可并行的任务。

核心模型是：

```text
projects/<project-slug>/workflow.ts
        │  项目级科研语义定义
        ▼
版本化 Workflow Definition
        │
        ▼
Project Runtime / Coordinator（持久化事件邮箱 + 状态投影）
        │  事务性地产生 ready node tasks
        ▼
PGlite Task Queue + 多 Worker
        │
        ├── Mastra Agent / Skill / Tool（一次有限的模型工作）
        ├── Supermemory（项目范围语义记忆）
        ├── 相关工作、实验、论文和报告服务
        └── 审批、Artifact、审计和反馈服务
        │
        ▼
Research OS 自绘 Workflow Graph
（静态语义图 + 实时节点运行状态 + 事件/证据 provenance）
```

这不是放弃 workflow，也不是把 workflow 退化成一张图片。`workflow.ts` 仍然是项目科研流程的可执行定义；只是它不再代表一个需要永远占用生命周期的物理 run。

## 2. 为什么废弃“永不结束的单个 Mastra Run”

### 2.1 概念上的问题

需要严格区分以下四个概念：

| 概念 | v2 的含义 |
| --- | --- |
| Workflow Definition | `workflow.ts` 中描述科研阶段、节点、边、触发器和策略的版本化定义 |
| Project Runtime | 一个项目长期存在的持久化状态、事件游标、版本和协调锁；空闲时只保存 `waiting` 状态 |
| Node Task | 一次具体的有限工作，例如搜索文献、生成章节、执行实验或等待审批 |
| Workflow Run | 某个事件或任务链的一次执行记录，属于项目运行时的子记录，不是项目唯一的永久进程 |

“项目只有一个 workflow”应当指项目只有一个逻辑定义和一个逻辑运行时，而不是强行让所有未来事件都塞进同一个永不结束的执行记录。

即使使用 Temporal，长期 workflow 也通常需要 `Continue-As-New` 来控制历史长度；因此可以保持稳定的逻辑 workflow ID，但不能把“一个永远不分段的物理 run”当成可靠的系统约束。

### 2.2 Mastra 能力的正确边界

当前安装版本为 `@mastra/core@1.55.0`、`mastra@1.21.0`。根据官方文档和当前类型定义：

- Mastra Workflow 适合有明确开始和结束的步骤图，支持顺序、并行、循环、sleep、suspend/resume，但不是项目级事件总线。
- `DurableAgent` 能恢复一次 Agent 执行；`untilIdle` 也只是等待当前一轮后台任务直到空闲，不是未来事件的永久订阅者。
- `EventedAgent` 使用 `startAsync()` 做 fire-and-forget，但执行仍属于一次 Agent 运行。
- `BackgroundTaskManager` 适合有限工具任务的排队、并发、重试和暂停；它内部仍有自己的任务 workflow，不能独自表达 Research OS 的科研依赖图、Proposal 门禁和项目版本迁移。
- `Signals` 当前是面向 Agent thread 的通知能力，不能直接替代项目级 DAG 调度器。
- Mastra Studio 主要展示其注册的 workflow/Agent 运行；它不能成为 v2 完整运行状态和上下文 provenance 的唯一图源。

Mastra 仍然保留在系统中，负责 Agent、Skills、Tools、模型调用、必要时的单任务 durable execution 和 HITL 能力；但不再负责项目总运行时。

### 2.3 当前代码证明了迁移必要性

- [`apps/mastra/src/mastra/workflow-runtime/loader.ts`](./apps/mastra/src/mastra/workflow-runtime/loader.ts) 的 `run()` 每次请求都会创建新的 Mastra run 并执行 `start()`，所以当前行为确实是“一次请求一次运行”。
- [`apps/server/src/task-worker.ts`](./apps/server/src/task-worker.ts) 使用进程级 `working` 标志，目前一个进程一次只领取一个任务，尚未形成真正的并行 worker 池。
- 当前运行记录仍有 `runtime/workflow-runs.json` 的已知偏差，不能作为完整的项目事件账本。
- [`docs/workflow-poc.md`](./docs/workflow-poc.md) 已确认 Mastra 同 key workflow 不会可靠替换，Studio 也不适合作为动态项目图的唯一来源。

## 3. v2 的目标与非目标

### 3.1 目标

- 每个项目始终拥有唯一、独立、可审阅、可提交 Git 的 `projects/<project-slug>/workflow.ts`。
- workflow 按科研语义组织：项目概述、Idea、文献调研、方法、实验、论文五章、汇报、审批和工作流编辑，而不是巨大的动作 `if/else`。
- 一个项目可以同时有多个互不冲突的节点任务运行；文献检索、论文章节处理、实验队列和报告生成可以按依赖真正并行。
- 用户聊天、上传材料、审批决定、实验完成、定时任务和外部 provider 结果都能作为事件唤醒项目运行时。
- 服务器重启或 worker 崩溃后，事件、任务、租约、重试和节点状态可恢复，且不伪造成功。
- `workflow.ts` 修改后，经过 Proposal、校验、审批和项目 Git commit，可以在运行期加载新版本，无需重启服务。
- 新旧 workflow 版本有明确边界：新事件使用新版本，已启动任务按版本固定；状态迁移必须显式定义。
- Research OS 自己的图面板显示静态图、嵌套阶段、实时任务、上下文引用、审批、失败、重试和 provenance。

### 3.2 非目标

- 不维护一个无限循环、无限增长历史的 Mastra Workflow Run。
- 不把每条聊天消息、每个 token 或每一条 Supermemory 记忆默认画成永久图节点。
- 不让项目 `workflow.ts` 直接访问任意文件系统、Shell、SQL、网络地址、密钥或进程。
- 不让模型直接修改 workflow 文件；模型只能产生结构化 Proposal/diff，审批后才可落盘。
- 不以 Mastra Studio 的列表是否出现某个 workflow 作为 v2 完成标准。
- 不在 v2 首期为了“看起来 durable”引入多个互相竞争的队列系统。
- 不把 workflow 运行时误称为虚拟机隔离；不可信代码若未来允许执行，必须另行设计真正的进程/虚拟机边界。

## 4. 项目 workflow.ts 的职责

### 4.1 推荐形式：受限声明式 TypeScript DSL

`workflow.ts` 是 TypeScript 文件，但推荐它主要声明图和策略，节点的副作用通过经过审核的 capability registry 执行。这样既保留“每个项目可以有自己的 workflow.ts”，也避免 AI 热改代码时获得任意系统权限。

概念性接口如下，名称在实现阶段再由严格 Zod 契约固定：

```ts
import { defineProjectWorkflow, node, group, edge } from '@research-os/project-workflow'

export const workflowManifest = {
  schemaVersion: 1,
  templateVersion: 'research-lifecycle@2',
}

export default defineProjectWorkflow({
  groups: [
    group('literature', { labelKey: 'workflow.literature' }),
    group('method_experiment', { labelKey: 'workflow.methodExperiment' }),
    group('paper', { labelKey: 'workflow.paper' }),
  ],
  nodes: [
    node('conversation.context', { capability: 'context.projectSnapshot' }),
    node('conversation.turn', { capability: 'agent.projectChat', concurrency: 'thread-serial' }),
    node('literature.search', { capability: 'relatedWork.search', retry: 'explicit' }),
    node('paper.method', { capability: 'paper.revise', requires: ['experiment.valid-artifacts'] }),
  ],
  edges: [
    edge('conversation.context', 'conversation.turn'),
    edge('literature.search', 'literature.review'),
  ],
  triggers: ['chat.message', 'material.uploaded', 'approval.decided'],
})
```

这段示例只表达设计方向，不是可以直接复制运行的现有 API。实现时必须先建立严格契约、版本和测试。

### 4.2 文件内应表达的内容

- 科研阶段和嵌套语义分组。
- 节点的稳定语义 ID、显示文案 key、capability、输入/输出契约和副作用类型。
- 节点之间的顺序依赖、并行依赖、fan-out/fan-in 和条件边。
- 事件触发器、去重键、项目级/线程级并发策略。
- 审批、失败关闭、重试和取消策略。
- Memory/context 的读取范围、写入来源和 provenance 绑定。
- 可视化所需的节点说明、状态映射和细节链接。
- 版本兼容声明和必要的状态 migration 函数引用。

### 4.3 不应直接写入的内容

- API key、Cookie、token、密码和绝对路径。
- `fs`、`child_process`、`net`、`vm`、动态 import、任意 `fetch` 和任意 SQL。
- 未经 capability registry 批准的模型、provider、实验入口或外部仓库。
- 把模型输出直接转换成命令、路径、依赖安装指令或数据库语句。

如果未来确实需要项目自定义算法逻辑，应把逻辑放进经过 Proposal/审计的 capability，并在受控 worker 中执行；不把“任意 TypeScript 热加载”误认为安全隔离。

## 5. v2 运行时模型

### 5.1 项目创建

创建项目时执行以下确定性动作：

1. 校验并固定语义 slug；slug 是不可变的项目 ID，不能替换成 UUID。
2. 从默认模板复制 `projects/<slug>/workflow.ts`。
3. 在项目 Git 中提交 workflow 初始版本。
4. 在 PGlite 创建 `project_workflow_runtime`，active definition version 为 1，状态为 `waiting`。
5. 写入 `workflow.definition_activated` 审计事件。

这里不启动一个永不结束的物理 run；项目已经通过持久化 runtime 记录进入“可被事件唤醒”的长期状态。

### 5.2 事件入口

所有会改变项目工作流状态的操作都先写入项目范围事件。初始事件类型至少包括：

| 事件 | 触发示例 |
| --- | --- |
| `chat.message.received` | 用户发送项目对话 |
| `material.uploaded` | 上传 PDF、图片或文本材料 |
| `literature.operation.requested` | 搜索、种子扩展、递归调研 |
| `experiment.plan.approved` | 实验计划 Proposal 获批 |
| `experiment.run.completed` | 实验监督器产生真实结果或结构化失败 |
| `paper.section.requested` | 翻译、修订、章节写作请求 |
| `approval.decided` | 用户批准、拒绝或要求修订 |
| `report.window.reached` | 日报/周报时间窗口到达 |
| `workflow.task.completed` | 某个节点任务完成 |
| `workflow.task.failed` | 某个节点任务失败或超时 |
| `workflow.definition.activated` | 新版 workflow 通过审批并激活 |

事件只携带结构化实体 ID、版本、哈希、状态和必要的小型输入；长文本仍由消息表、Artifact 和 Supermemory 按既有职责保存，不把语义全文复制进事件表。

### 5.3 Coordinator

Coordinator 是项目级单写者逻辑，不需要一直占用一个 Node 进程。它被事件、任务完成、定时器或恢复流程唤醒，工作完成后退出或进入等待。

每次协调遵循以下流程：

1. 按项目 slug 获取短租约，避免两个 coordinator 同时推进同一项目游标。
2. 读取 active workflow definition 和尚未处理的事件。
3. 根据当前状态、已完成节点和图依赖计算 ready nodes。
4. 为每个 ready node 创建带幂等键的有限任务。
5. 在同一事务中推进事件游标、更新节点状态并写入 outbox/唤醒记录。
6. 释放租约；不等待模型、不执行实验、不持有长连接。

Coordinator 必须是尽量纯的确定性逻辑。模型调用、网络 provider、文件处理和实验执行都放到 worker capability，避免协调器因外部请求慢或失败而锁住项目。

### 5.4 Worker 池

Worker 领取的是有限任务，而不是“永久运行的图节点”。任务至少携带：

```text
task_id
project_id
workflow_definition_version
node_id
trigger_event_id
capability_id
input_reference
idempotency_key
status / attempt / lease / timeout
```

worker 行为要求：

- 多个 worker 可以同时领取不同项目或同一项目中无冲突的节点。
- 同一对话线程保持顺序；同一资源有明确的锁或并发策略。
- 任务采用租约、心跳、超时、有限重试和取消；重启后可恢复过期租约。
- handler 必须幂等；重试不能重复写 Artifact、重复提交 Proposal 或重复生成消息。
- provider 失败、模型失败、结构化输出失败直接写入失败事件，不换 provider、不伪造成功、不生成 fallback 回复。
- fan-in 节点只有在所有必需的上游节点完成且状态有效时才 ready；partial/failed/blocked 必须显式显示。

现有 [`apps/server/src/task-worker.ts`](./apps/server/src/task-worker.ts) 的 `working` 单锁需要改成可配置的多 worker 循环或多进程 worker；不能只把同一个 `setInterval` 调快来冒充并行。

### 5.5 空闲与恢复

项目没有 ready 任务时，runtime 状态为 `waiting`，不调用模型、不占用 worker、不制造空轮询 run。新事件进入 mailbox 后再唤醒协调器。

服务重启时：

- 未提交完成的事件仍在事件表中。
- 过期任务租约被恢复为 `queued`/`retrying`。
- 已完成任务不重复执行，依靠幂等键和唯一约束确认。
- 运行中的外部实验按既有 supervisor 恢复/失败契约处理。
- 项目 runtime 从 PGlite 重建，不依赖内存 Map 或 `runtime/workflow-runs.json` 才能知道项目状态。

## 6. 数据模型与持久化

v2 不把所有状态放进一个 JSON 文件，建议新增或迁移为以下结构化表。表名可在数据库迁移阶段调整，但字段契约必须稳定：

### 6.1 `workflow_definitions`

- `project_id`：语义 slug 外键。
- `version`、`source_sha256`、`git_commit`、`status`。
- `graph_json`：规范化后的静态图，不含密钥和长文本。
- `compiled_ref`：运行期编译缓存的受控引用。
- `created_at`、`activated_at`、`deactivated_at`、`validation_error`。

### 6.2 `project_workflow_runtime`

- `project_id` 主键。
- `active_definition_version`、`state_version`、`event_cursor`。
- `status`：`waiting`、`dispatching`、`blocked`、`failed`、`paused`。
- `coordinator_lease_token`、`lease_until`。
- `last_error`、`updated_at`。

### 6.3 `workflow_events`

- `id`、项目范围 `sequence`、`event_type`、`payload`、`source`。
- `definition_version`、`causation_id`、`correlation_id`。
- `idempotency_key`、`created_at`、`processed_at`。
- 项目级唯一约束，禁止跨项目复用事件。

### 6.4 `workflow_node_runs`

- `project_id`、`node_id`、`node_run_id`、`definition_version`。
- `trigger_event_id`、`status`、`attempt`、`input_ref`、`output_ref`。
- `blocked_reason`、`error_code`、`started_at`、`finished_at`。
- `task_id`、`worker_id` 和上游节点引用。

### 6.5 `workflow_tasks`

可以扩展当前 `tasks` 表，也可以单独建立表；不得同时维护两套对同一任务的真实状态。任务必须保存 workflow 版本、节点 ID、幂等键、租约和失败信息。

PGlite 只保存结构化状态、实体 ID、哈希、权限和审计。长文本、论文内容、对话语义和多模态记忆继续由既有消息、Artifact 和 Supermemory 保存。

## 7. 默认科研 workflow 的迁移

旧版默认图是 Mastra Workflow 的动作入口包装。v2 要把它转换为语义图，不是把所有动作再塞进一个更大的 switch。

### 7.1 语义分组

默认 workflow 至少包含以下顶层 group：

1. `project_context`：项目状态、Idea 版本、权限和当前工作区上下文。
2. `conversation`：项目对话、上下文组装、Agent turn、记忆写入和反馈。
3. `literature`：种子文献、来源搜索、引用扩展、字段补全、证据复核和研究现状。
4. `method_and_experiment`：方法候选、实验计划、审批、执行、指标、Artifact 和谱系。
5. `paper`：引言、相关工作、方法介绍、实验、结论五个章节及其引用/图表/LaTeX 能力。
6. `reporting`：日报、周报、反馈和来源快照。
7. `governance`：Proposal、审批、拒绝、修订和审计。
8. `workflow_editing`：自然语言提出 workflow diff、验证、审批、提交和激活。

### 7.2 典型依赖和并行

```text
chat.message.received
    └─> context.snapshot ─> conversation.agent_turn ─> memory.write

material.uploaded
    └─> material.extract
          ├─> literature.index
          └─> context.invalidate

literature.search
    ├─> crossref / openalex / semantic-scholar（并行且来源显式）
    └─> normalize ─> deduplicate ─> evidence.review

paper.requested
    ├─> introduction
    ├─> related-work
    ├─> method
    ├─> experiments
    └─> conclusion
          └─> chapter.fan-in / citation-check / compile gate
```

论文五章可以并行处理，但论文实验章节必须等待有效实验 Artifact；相关工作中的 provider 失败不能静默换 provider；所有结果都必须保留来源和项目范围。

### 7.3 迁移规则

- `project_chat` 不再启动整张图，而是向项目事件邮箱追加 `chat.message.received`，由 conversation 子图生成必要任务。
- 相关工作递归运行不再等待整个项目 workflow 返回，改为多个带 depth/width/max_total 的节点任务和进度事件。
- 报告调度只追加 `report.window.reached`，不枚举项目并同步等待所有项目完成。
- 论文翻译、修订和实验规划成为节点 capability；公开 API 只负责写事件和读取任务/节点状态。
- 审批不是把整个项目 run 挂起，而是把对应 Proposal 节点置为 `waiting_approval`；批准事件只唤醒受影响的下游节点。
- workflow 编辑只更新 definition Proposal，不直接改变正在执行的 node run。

## 8. Mastra 与其它系统的职责

### 8.1 Mastra 保留的能力

- 使用 Mastra Agent、Skills 和 Tools 执行 Idea 澄清、项目监督、实验规划和文档/论文文本工作。
- 单个 Agent 任务需要断线恢复、HITL 或后台工具时，可以使用 `DurableAgent` / `EventedAgent`。
- 由 Mastra 负责模型请求、结构化输出和 Agent tracing；模型失败直接结构化失败。
- 继续通过官方 Supermemory Mastra 集成使用项目范围语义记忆。

### 8.2 不再让 Mastra 承担的能力

- 不让 Mastra Workflow 作为项目级永久协调器。
- 不用 Mastra Studio registry 作为项目 workflow 的唯一事实来源。
- 不把 Mastra Memory 当作项目状态、审批账本、Artifact lineage 或事件日志。
- 不同时用 Mastra BackgroundTaskManager 和 Research OS 原生队列保存同一个任务的状态；首期以 PGlite 队列为唯一任务事实源。

### 8.3 Supermemory 与上下文

Supermemory 继续负责长文本、事实、对话记录、文献知识和多模态语义内容；PGlite 保存结构化实体、状态、权限、Proposal、哈希和审计。

每个 context node 必须带：

- 不可变 `project_id`。
- 当前工作区 area/tab 或 conversation scope。
- 查询使用的真实用户消息或受限查询文本。
- Paper/Evidence/Artifact/Experiment/Idea/Report 的来源引用。
- Memory 查询结果的权限和 provenance 状态。

图中显示的是 context node 和来源边；点击后才展开具体记忆，不默认把跨项目或无范围记忆带入上下文。

## 9. 热加载与版本治理

### 9.1 激活流程

1. 用户通过项目对话提出修改意图。
2. `workflowEditAgent` 只生成结构化 Proposal 和受限 unified diff。
3. 临时工作区编译并校验 graph schema、capability 白名单、依赖闭合、并发策略和 migration。
4. 运行不产生副作用的 dry-run 和静态安全检查。
5. 用户审批后写入 `projects/<slug>/workflow.ts`，创建项目 Git commit。
6. loader 轮询 `/mnt/d` 文件哈希，生成新 definition cache。
7. 新版本写入 `workflow_definitions`，通过事务更新 active pointer，并追加审计事件。

### 9.2 新旧版本边界

- 已经开始的 node run 固定 `definition_version` 和 capability 版本。
- 新事件默认使用新的 active version。
- 旧版本只有在仍有任务、挂起 Proposal 或恢复需求时保留。
- 改变节点 ID、输入 schema、状态含义或依赖关系时，必须提供显式 migration；无法迁移就保持 `blocked`，不能静默改写。
- 新文件非法时不激活；当前运行不被破坏，新事件返回结构化 `workflow_definition_invalid`，直到用户修复并重新提交。不能把旧版本静默伪装成新版本。
- `/mnt/d` 没有可靠 inotify，首期继续使用轮询 + SHA-256；loader/协调器源代码变化仍需要重启，只有项目 definition 文件实现无重启热加载。

## 10. 自绘图可视化

### 10.1 图数据

后端返回规范化 `WorkflowGraphSnapshot`，至少包含：

- `project_id`、definition version、source hash、Git commit。
- group/subgraph 层级、节点、边、trigger、capability 和输入/输出摘要。
- 当前 runtime 状态和 event cursor。
- 节点运行实例、任务、重试、worker、错误和阻塞原因。
- 上下游实体引用及 provenance 状态。
- 当前项目范围和权限信息。

静态图与运行状态必须分开建模，避免刷新图定义时丢失历史运行记录。

### 10.2 前端呈现

- Research OS 项目页的自绘图是生产环境主入口。
- Mastra Studio 只作为 Agent/局部调试工具或兼容入口。
- 支持 group 折叠、节点详情、运行路径、失败筛选、时间线和事件跳转。
- 运行状态使用明确的成功、等待、运行、失败、取消、阻塞颜色；不以颜色作为唯一信息。
- Apple 风格要求：磨砂玻璃分层、半透明背景、克制阴影、稳定间距、清晰层级、浅/暗主题、四语言、键盘可达、`prefers-reduced-motion`。
- 移动端默认显示语义分组和当前路径，详细节点进入可滑动详情面板，不能把完整 DAG 挤成不可读的缩略图。
- 空、加载、partial、failed、blocked、跨项目拒绝和版本迁移状态必须分别呈现。

## 11. 需要修改的代码和文档

### 11.1 需要新建或重构的后端模块

- `apps/server/src/project-workflow/definition-contracts.ts`：workflow definition、节点、边、trigger、策略和版本契约。
- `apps/server/src/project-workflow/definition-loader.ts`：编译、哈希、静态校验、缓存和原子激活。
- `apps/server/src/project-workflow/coordinator.ts`：项目事件游标、ready node 计算、租约和任务派发。
- `apps/server/src/project-workflow/event-store.ts`：事件追加、幂等、因果链和 outbox。
- `apps/server/src/project-workflow/task-dispatch.ts`：节点任务创建、依赖、取消、重试和 fan-in。
- `apps/server/src/project-workflow/capabilities.ts`：固定 capability registry；不得让 workflow 文件直接获得任意 I/O。
- `apps/server/src/project-workflow/runtime-service.ts`：项目创建、恢复、暂停、删除和状态查询。
- `apps/server/src/project-workflow/graph-service.ts`：静态图和运行时状态的统一投影。

### 11.2 需要修改的现有模块

- `apps/server/src/database.ts`：新增 workflow definition、runtime、event、node run、outbox/lease 迁移。
- `apps/server/src/task-worker.ts`：去掉进程级单一 `working` 限制，改为可配置并发 worker；任务携带 project/version/node 元数据。
- `apps/server/src/project-service.ts`：创建项目时初始化 v2 runtime 和模板版本；删除项目时清理 definition、事件、任务和缓存。
- `apps/server/src/index.ts`：公开 API 改成追加事件、读取节点/任务状态，不同步等待整张图结束。
- `apps/server/src/report-scheduler.ts`：只产生项目范围的 report event，并使用幂等键防止重复窗口。
- `apps/mastra/src/mastra/index.ts`：保留 Agent/API/Studio；移除项目总 workflow 注册和项目总运行调度依赖。
- `apps/mastra/src/mastra/workflow-runtime/loader.ts`：改造成项目 definition loader，或在迁移完成后删除 Mastra Workflow 专用部分。
- `packages/workflow-kit/`：去除对 Mastra Workflow step graph 的强耦合，只保留可复用的纯契约/校验；Mastra 专用 adapter 移到 `apps/mastra/`。若共享范围不再需要，评估将核心迁入 `apps/server/src/project-workflow/`，避免形成含义不清的“零件库”。
- `projects/<slug>/workflow.ts`：从 Mastra `createWorkflow()` 工厂迁移为 v2 definition DSL。

### 11.3 需要新建或修改的前端模块

- `apps/web/src/components/WorkflowGraphCard.tsx`：从 `serializedStepGraph` 改为 `WorkflowGraphSnapshot`。
- 新增节点状态、运行时间线、事件详情、上下文 provenance 和版本差异面板。
- 新增 SSE/轮询订阅，项目切换时严格清理旧项目的事件流。
- 所有文案走 i18n；浅色/暗色、桌面/移动端和 reduced-motion 都要真实浏览器验收。

### 11.4 需要同步的文档

- `TODO.md`：维护 `P0-WORKFLOW-V2-001` 状态、依赖和验收结果。
- `TODO-workflow.md`：保留历史记录，并在顶部标明 v2 已取代其“Mastra Workflow 总执行器”目标，避免后来接手者误用旧计划。
- `docs/architecture.md`：更新系统边界、事件/任务/Agent 分工和数据源说明。
- `docs/operations.md`：补充 worker 并发、租约、恢复、热加载、definition 版本和故障处理。
- `README.md`、`README.zh-CN.md`、`AGENTS.md`：只有真实实现和验收完成后，才更新为已实现能力；同步 `DOCS_SYNC_VERSION`。

## 12. 实施阶段

### Phase 0：冻结决策和契约（P0）

- [x] `V2-000` 固化术语：definition、runtime、event、node run、task、Agent turn、memory/context；在 API、数据库和 UI 中使用同一套名称。 [Apple 设计验收]
- [x] `V2-001` 设计严格 Zod/JSON Schema：graph、node、edge、trigger、capability、状态、错误和 migration。 [Apple 设计验收]
- [x] `V2-002` 对照 Mastra 官方文档和当前 `@mastra/core@1.55.0` 类型，记录 DurableAgent、EventedAgent、BackgroundTask 和 Workflow 的保留边界。 [Apple 设计验收]
- [x] `V2-003` 设计 PGlite 迁移和幂等/租约契约，明确不把长文本和 Supermemory 事实复制进结构化事件表。 [Apple 设计验收]

### Phase 1：项目级 definition loader（P0）

- [x] `V2-010` 新建 v2 `workflow.ts` 默认模板和纯 definition loader；新项目生成版本 1 并提交项目 Git。 [Apple 设计验收]
- [x] `V2-011` 完成编译、静态安全扫描、capability 白名单、图闭合、schema、migration 和 dry-run 校验。 [Apple 设计验收]
- [x] `V2-012` 建立 definition 版本注册表、active pointer、source hash、git commit 和错误状态。 [Apple 设计验收]
- [x] `V2-013` 在 `/mnt/d` 通过轮询实现项目文件热加载；非法版本不得激活，且返回结构化错误。 [Apple 设计验收]

### Phase 2：事件账本和项目 Coordinator（P0）

- [x] `V2-020` 新增 `workflow_events`、`project_workflow_runtime`、`workflow_node_runs` 和 outbox/lease 数据表。 [Apple 设计验收]
- [x] `V2-021` 实现按项目 slug 的事件追加、顺序号、幂等键、因果链和项目隔离。 [Apple 设计验收]
- [x] `V2-022` 实现单项目 coordinator 租约、事件游标、状态归约和 ready node 计算。 [Apple 设计验收]
- [x] `V2-023` 实现 `waiting`、`blocked`、`paused`、`failed` 和恢复状态；空闲时不得启动模型或制造无意义 run。 [Apple 设计验收]

### Phase 3：并行任务池（P0）

- [x] `V2-030` 重构原生 task worker 为可配置并发池，支持多 worker、租约心跳、超时、取消、有限重试和重启恢复；运行中取消由 API 写入 `cancel_requested`，worker 在当前 capability 完成后关闭为 `cancelled`，排队/重试任务直接关闭，节点 run 认领后立即置为 `running`。 [Apple 设计验收]
- [x] `V2-031` 将任务绑定 `project_id + definition_version + node_id + trigger_event_id`，防止热加载后旧任务执行新逻辑。 [Apple 设计验收]
- [x] `V2-032` 迁移材料索引、相关工作、实验复现和报告任务；同一任务不得同时进入 Mastra BackgroundTaskManager 和原生队列。 [Apple 设计验收]
- [x] `V2-033` 实现 fan-out/fan-in、线程串行、项目并发上限和资源锁，验证多个独立节点真实同时运行。 [Apple 设计验收]
- [x] `V2-034` 为每个 capability 增加幂等测试，确保重试不会重复写消息、Proposal、Artifact 或 Memory link。 [Apple 设计验收]

### Phase 4：默认科研 workflow 迁移（P0）

- [x] `V2-040` 把项目对话改为 `chat.message.received` 事件和有限 Agent turn；保留当前项目范围 memory/context 规则。 [Apple 设计验收]
- [x] `V2-041` 把相关工作调研迁移为可并行 provider/递归节点，保留 provenance、缓存、取消、进度和失败关闭。 [Apple 设计验收]
- [x] `V2-042` 把方法设计、实验计划、审批、执行、指标和 Artifact lineage 接入节点图。 [Apple 设计验收]
- [x] `V2-043` 把论文五章、引用检查、图表选择、LaTeX compile gate 和逐句翻译接入论文 group。 [Apple 设计验收]
- [x] `V2-044` 把报告/反馈改为时间事件，保存真实 source snapshot，不在没有事件时生成模板化正文。 [Apple 设计验收]
- [x] `V2-045` 把 workflow 编辑改为 definition Proposal -> 临时验证 -> 用户审批 -> Git commit -> active version。 [Apple 设计验收]

### Phase 5：API 和工作区状态（P0）

- [x] `V2-050` 新增项目事件、runtime、node run、task、definition 和 graph snapshot API，所有输入使用严格 Zod。 [Apple 设计验收]
- [x] `V2-051` 公开聊天、论文、实验和相关工作接口改为追加事件/读取结果，不同步等待整个项目 workflow。 [Apple 设计验收]
- [x] `V2-052` 增加项目范围 SSE 或等价订阅，断线后先发快照再发增量，切换项目时不得串流旧项目事件。 [Apple 设计验收]
- [x] `V2-053` 删除项目时清理运行时、事件、节点、任务、definition cache、订阅和审计引用，不留下孤儿状态。 [Apple 设计验收]

### Phase 6：自绘图和视觉验收（P0）

- [x] `V2-060` 将前端图源从 Mastra `serializedStepGraph` 迁移到 `WorkflowGraphSnapshot`。 [Apple 设计验收]
- [x] `V2-061` 支持语义分组折叠、节点详情、运行路径、失败/阻塞筛选、事件跳转和上下文 provenance。 [Apple 设计验收]
- [x] `V2-062` 完成四语言、浅/暗主题、桌面/移动端、键盘操作、无障碍、无重叠和 reduced-motion 验收。 [Apple 设计验收]
- [x] `V2-063` 使用真实项目、真实事件和真实失败状态进行浏览器截图检查；fixture 只能补充边界，不得替代真实链路。 [Apple 设计验收]

> 验收记录（2026-08-06）：`scripts/workflow-v2-browser-check.mjs` 在真实 Chrome 中通过 `zh-CN/zh-TW/en/es` 四语言 × `light/dark` 两主题的桌面检查，以及同样的四语言 × 两主题 390px 移动端检查，并验证 `prefers-reduced-motion: reduce` 生效；确认 8 个语义分组、20 个节点、5 个筛选、分组折叠、节点详情、失败筛选、事件驱动实时更新和事件时间线跳转到关联节点均正常，`lang`/`data-theme` 与设置一致且无横向溢出；截图保存在 `runtime/workflow-v2-browser/`，`mimo-v2.5` 复核 `zh-TW`、`es` 的浅/暗主题与移动端 Workflow 图组件 Apple 风格无问题。本轮同时收紧了中性状态标签与次要文本对比度、筛选与分组卡片间距，并强化暗色主题的玻璃层级。`npm run workflow:v2:check` 通过真实 `approval.decided` 事件，`governance.approval` 节点到达 `succeeded` 并写入 Proposal/audit；209 个服务端测试、全量 typecheck、build、docs/UI/language/navigation/idea-cases/ops:status 均通过。`npm run acceptance` 在运行时临时配置可用文档模型（`gpt-5.6-terra`）后通过；默认 `deepseek-v4-flash`/`gpt-5.6-sol` 在网关的 Responses 兼容性/RegionError 问题属于上游，未配置可用模型时保持结构化失败。

> 补充验收记录（2026-08-06）：新增 `POST /api/projects/:projectId/workflow/tasks/:taskId/cancel` 与任务取消链路。`project-workflow-runtime.test.ts` 真实触发 `test.project_serial` 长任务，等待 `project_serial_a` 进入 `running` 后调用取消接口，节点 run 最终关闭为 `cancelled`、`error_code='cancelled'`，任务不再被新 worker 认领；认领后的节点 run 会立即更新为 `running`，图面板状态不再停留在 `queued`。迁移新增 `tasks.cancel_requested`，删除项目清理已包含任务/节点/事件。浏览器验收改为按事件 `correlation_id` 断言实时更新，并对 SSE 客户端断开时的轮询拒绝、任务心跳、报告调度、definition 扫描审计和相关工作后台启动做了隔离，避免后台定时器把整个 API 进程带崩。

> 缺陷修复记录（2026-08-06）：真实浏览器验收在 reduced-motion 步骤反复断开/重连 workflow SSE 时发现 API 仍会因未捕获的 `reader.cancel()` 拒绝崩溃（Node 26 默认 fatal unhandled rejection）。根因在 Hono 4.12.32 的 `StreamingApi`，其 abort 订阅器把 `reader.cancel()` 作为裸 Promise 触发，客户端断开且 cancel 拒绝时直接逃逸。新增 `scripts/patch-hono-stream.ts` 与 `postinstall`，只给该取消补 `.catch(() => {})`；同时为任务 worker 恢复失败和 API 顶层增加未处理拒绝日志兜底。修复后重跑完整检查、`workflow:v2:check`、浏览器验收和 `ops:status`，API 进程在多次 SSE 重载后仍存活。

### Phase 7：可靠性和未来执行后端（P1）

- [ ] `V2-070` 将旧 `runtime/workflow-runs.json` 的必要字段迁移到 PGlite，并验证重启恢复、幂等、租约过期和重复事件。 [Apple 设计验收]
- [ ] `V2-071` 运行长时间并发压力、worker 崩溃、模型超时、重复 webhook、审批延迟和 definition 热更新演练。 [Apple 设计验收]
- [ ] `V2-072` 设计 `ProjectExecutionBackend` 接口，保留将来接入 Temporal 的边界；不在没有 PoC 和运维条件时直接引入新基础设施。 [Apple 设计验收]
- [ ] `V2-073` 如果选择 Temporal，验证 Signal、Activity 并行、Continue-As-New、workflow versioning 和项目 slug workflow ID；不得把动态 TS 热加载误写成无需部署的能力。 [Apple 设计验收]

## 13. API 契约方向

v2 不再把 `POST /internal/workflows/project/:id/run` 作为所有请求的唯一同步入口。建议逐步增加：

```text
POST /api/projects/:projectId/workflow/events
GET  /api/projects/:projectId/workflow/runtime
GET  /api/projects/:projectId/workflow/definition
GET  /api/projects/:projectId/workflow/graph
GET  /api/projects/:projectId/workflow/node-runs
GET  /api/projects/:projectId/workflow/tasks
GET  /api/projects/:projectId/workflow/events
GET  /api/projects/:projectId/workflow/stream
POST /api/projects/:projectId/workflow/definition/preview
POST /api/projects/:projectId/workflow/definition/proposals
POST /api/projects/:projectId/workflow/definition/:version/activate
```

所有 endpoint 必须：

- 接受语义 slug，不接受旧 UUID 项目标识。
- 校验项目归属、权限、Proposal 和状态。
- 返回结构化错误，不生成 fallback。
- 不把 API key、Cookie、数据库文件或原始认证材料返回给前端。

## 14. 测试与验收

### 14.1 单元和集成测试

- definition schema、节点 ID、边闭合、循环检测、capability 白名单和 migration。
- 同一事件重复提交只产生一个逻辑 node task。
- 两个独立节点在同一时间运行；有依赖的节点不会提前运行。
- 同一项目对话线程保持顺序，不同项目相互隔离。
- worker 崩溃、租约过期、重试、取消、超时和服务重启可恢复。
- 旧 definition 任务不会被新 definition 代码执行。
- provider/model/Memory 失败保持 failed/blocked，不变成空成功或 fallback。
- 删除项目不会留下事件、任务、缓存或 Supermemory 跨项目引用。

### 14.2 真实验收命令

在实现对应阶段运行并如实记录：

```bash
source ~/.nvm/nvm.sh
nvm use 26.5.1
npm run typecheck
npm test
npm run build
npm run docs:check
npx tsx scripts/acceptance-test.ts
npm run workflow:v2:check
npx tsx scripts/ops-guard.ts status
```

涉及 Supermemory、真实 provider、实验、论文编译、浏览器和并发恢复的验收必须使用真实适用条件；外部服务不可用时标记 `[!]`，不得用 fixture 或 fallback 伪造通过。

### 14.3 关键验收场景

1. 项目创建后没有常驻进程，但 runtime 显示 `waiting`；发送一条聊天事件后只启动 conversation 相关节点。
2. 同时提交文献搜索、论文修订和实验任务，多个 worker 真实并行，互不覆盖状态。
3. 在任务运行中修改 workflow.ts；旧任务继续使用旧版本，新事件使用新版本。
4. 写入非法 workflow.ts；版本不激活，API 返回明确错误，修复后可恢复。
5. coordinator 和 worker 分别重启；未完成事件和任务可恢复，已完成任务不重复执行。
6. 打开项目图，看到语义分组、实时节点状态、上下文来源、失败原因和当前项目范围；切换项目后不泄漏上一个项目内容。
7. 在移动端、浅色/暗色和四种语言下检查图面板、运行时间线、节点详情和状态徽标无裁切、重叠或不可读文本。

## 15. 方案比较和保留决策

| 方案 | v2 结论 | 原因 |
| --- | --- | --- |
| 永不结束的单个 Mastra Workflow Run | 放弃 | 历史无限增长、并发边界不自然、热更新和恢复复杂，且所有事件共享一个生命周期 |
| Mastra Durable/Evented Agent 作为项目总协调器 | 不采用为主架构 | 适合 Agent turn，不是项目事件/DAG/版本账本 |
| Mastra BackgroundTaskManager 作为全部队列 | 首期不采用 | 与现有 PGlite 任务事实源重复，且不表达科研语义依赖 |
| 纯 XState/状态图 | 不足 | 可建模和可视化，但不自带可靠持久化、租约和任务执行 |
| Inngest | 保留评估 | 事件函数方便，但本地审计、项目级图和长期状态仍需自建 |
| Temporal | P1 外部执行后端候选 | 长期 Signal、Activity、并行和 Continue-As-New 强，但引入服务和确定性/版本部署约束 |
| PGlite 事件协调器 + 原生 worker 池 | 当前推荐 | 复用现有本地存储、审计、项目隔离和 TypeScript 运行边界，能逐步迁移，不增加基础设施 |

当前推荐不是“自研一个没有边界的完整编排平台”，而是在已有 PGlite 和任务队列之上补齐最小的事件账本、协调器、版本和图投影；同时把执行后端抽象出来，为未来 Temporal 留出替换点。

## 16. 风险与处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| workflow.ts 变成任意代码执行入口 | 可读取进程权限或泄露密钥 | 声明式 DSL、capability 白名单、Proposal/审批、静态扫描；不把本机进程当沙箱 |
| 事件和任务重复投递 | 重复模型调用或重复产物 | 幂等键、唯一约束、事务 outbox、handler 幂等和来源 hash |
| 新旧 definition 状态不兼容 | 运行中节点无法继续 | 版本 pin + 显式 migration；无法迁移则 blocked |
| 同一项目多任务写同一上下文 | 对话/状态乱序 | project coordinator 单写者、thread serial、资源锁和 CAS |
| worker 并发增加后触发模型/ provider 限流 | 成本和失败增加 | 全局/项目/模型档位并发配额、队列背压、明确失败；不换 provider |
| 图展示信息过载 | 用户无法理解 | 静态图、运行图、事件和 context 分层；默认折叠，详情按需展开 |
| 未来迁移 Temporal 造成两套语义 | 数据和状态分裂 | 先固定事件、任务、definition、node run 契约，再实现 backend adapter |

## 17. 文档和实施规则

- 本文件是 v2 方案和待办，不代表功能已经实现。
- `TODO.md` 的 `P0-WORKFLOW-V2-001` 是唯一总任务；每个 Phase 完成后必须同步状态、依赖、阻塞和真实验收证据。
- 旧 `TODO-workflow.md` 不删除，用于解释 v1 已做的 Mastra loader/Studio POC；任何 v1 内容与本文件冲突时，以本文件和最新 `TODO.md` 为准。
- 在 v2 核心运行时、事件账本、并行 worker、热加载和图面板真实验收完成前，README、AGENTS 和架构文档不得把 v2 写成已实现。
- 所有前端图、状态、时间线和节点详情遵循 Research OS 的 Apple 风格：磨砂玻璃、半透明层次、稳定间距、克制动效、浅/暗主题、四语言和移动端适配；视觉通过真实浏览器截图验收后才能关闭相关任务。

## 18. 参考资料

- Mastra Workflows Overview：https://mastra.ai/docs/workflows/overview
- Mastra Workflows Control Flow：https://mastra.ai/docs/workflows/control-flow
- Mastra Durable Agents：https://mastra.ai/docs/long-running-agents/durable-agents
- Mastra Background Tasks：https://mastra.ai/docs/long-running-agents/background-tasks
- Mastra Studio：https://mastra.ai/docs/studio/overview
- Temporal Workflows：https://docs.temporal.io/workflows
- Temporal Signals：https://docs.temporal.io/workflows#signals
- Temporal Continue-As-New：https://docs.temporal.io/workflows#continue-as-new
- Inngest Functions：https://www.inngest.com/docs/functions
- 当前 v1 POC：[`docs/workflow-poc.md`](./docs/workflow-poc.md)
- 当前架构：[`docs/architecture.md`](./docs/architecture.md)
- 项目代理约束：[`AGENTS.md`](./AGENTS.md)
