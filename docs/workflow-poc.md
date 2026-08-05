# Research OS 项目级 Workflow POC 报告

> 日期：2026-08-05
> 对应计划：`TODO-workflow.md` Phase 0
> 可复跑脚本：`scripts/workflow-poc/run-poc.ts`、`scripts/workflow-poc/poc-project-workflow.ts`

## 结论摘要

- Node 26.5.1 可以动态加载由 esbuild 编译并打包到 `runtime/workflow-cache/` 的项目 workflow `.mjs`，不依赖 tsx。
- Mastra `Workflow` 可以在不调用 `mastra.addWorkflow` 的情况下，通过 `__registerMastra` / `__registerPrimitives` 获得运行所需的 Mastra/storage/logger 注入，并直接 `createRun().start()`。
- `workflow.serializedStepGraph` 能返回结构化步骤图，包含步骤 ID 和类型，可同时用于静态校验与前端可视化。
- `mastra.addWorkflow(workflow, key)` 在 key 已存在时会静默跳过，不替换旧实例；因此热加载不能依赖框架级同 key 替换。
- Studio 只展示 Mastra 实例注册表中的 workflow；项目级热加载注册表如果独立于 `addWorkflow`，Studio 不会自动成为最新图的可靠来源。因此最终可视化以 `serializedStepGraph` 驱动的项目内图面板为主，Studio 保留为开发期辅助工具。

## 验证过程

### 1. esbuild + Node 动态加载

```bash
source ~/.nvm/nvm.sh
nvm use 26.5.1
TMPDIR=/tmp npx tsx scripts/workflow-poc/run-poc.ts
```

结果：

```json
{
  "id": "project-poc-research",
  "committed": true,
  "graphTypes": ["step", "step"],
  "graphStepIds": ["workflow-entry", "workflow-exit"]
}
```

再用普通 Node 直接 import 编译产物：

```bash
node --input-type=module -e "const m = await import('./runtime/workflow-poc/workflow-poc.mjs?v=plain-node'); ..."
```

结果：

```json
{"id":"project-node-research","steps":["workflow-entry","workflow-exit"]}
```

### 2. 不经过 addWorkflow 直接运行

```ts
workflow.__registerMastra(mastra)
workflow.__registerPrimitives({ logger: mastra.getLogger(), storage: mastra.getStorage() })
const run = await workflow.createRun({ resourceId: 'project:poc' })
const result = await run.start({ inputData: { project_id: 'poc-project' } })
```

结果：`status: "success"`，`result.status: "success"`。

### 3. addWorkflow 同 key 不替换

先注册 `description: "poc-v1"`，再用同 key 注册 `description: "poc-v2"`，读取注册表仍返回 `poc-v1`。

## 对后续实现的影响

1. 热加载核心采用“项目注册表 + 原子实例替换”，不使用 `addWorkflow` 做版本替换。
2. 项目 workflow 编译产物放在 `runtime/workflow-cache/<project-id>/workflow-<sha256>.mjs`，从仓库根目录解析 `@mastra/core`、`@mastra/core/workflows`、`zod` 和共享 kit。
3. 每次加载都要校验 `workflowManifest`、输入/输出 schema、步骤 ID 与 `serializedStepGraph`。
4. 前端图面板直接消费 `GET /internal/workflows/project/:projectId/graph` 返回的 `serializedStepGraph`；Mastra Studio 不作为生产环境唯一图源。
