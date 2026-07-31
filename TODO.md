# Research OS TODO

最后更新：2026-07-31（Asia/Shanghai）

状态：`[ ]` 待处理、`[~]` 进行中、`[x]` 已完成并验证、`[!]` 外部阻塞。

## 当前最高优先级

- [x] `P0-TS-NATIVE-047` 将应用迁移为原生 Windows TypeScript 系统。
  - 已完成：TypeScript 工作区；Hono API；PGlite 18 表迁移；Mastra Agents、Memory、Skills、Tools、Workflows 和 Studio 本机存储；三档独立模型配置；TypeScript Web 构建；持久工作流队列；审批/证据/论文草稿；Windows Defender 上传门禁；本机实验监督器；每项目 `.venv`；Windows `cmd.exe` 默认后端与 WSL2 可选后端；Node 22 安装器源码。
  - 已完成清理：旧 `research-os` 容器、网络、命名卷和六个自建镜像已在最终备份校验后删除；仓库运行不再占用 Docker 资源。
  - 已验证：Luna/Terra/Sol 三档真实请求；模型失败直接返回结构化错误且不写助手消息；Mastra Studio 三个 Agent 与三个 Workflow graph；桌面与 390px 移动端设置、聊天和工作流入口；独立 `.venv`、数值指标/检查点/PLY/SHA-256 产物及进程树取消。
  - 已完成：完整真实 Idea 验收、最终 typecheck/test/build/迁移/文档检查、仓库零旧实现扫描和桌面 UI/Mastra graph 截图证据；README 双语版与需求审计已同步。
  - 完成标准：仓库业务源码、脚本和测试只有 TypeScript；应用不依赖容器运行时；原生 typecheck/test/build、数据库迁移、`.venv` 实验、取消、Mastra Studio、浏览器和真实模型验收通过；文档同步；提交并推送。
  - 模型验收：三档默认 URL 从项目 `.env` 读取。模型或 key 无效时必须直接返回结构化错误且不写助手消息。

## 已并入本次迁移

- [x] `P0-MASTRA-046` Mastra Agent 与 Workflow 实现代码已保留并迁入原生 Node 运行时。
- [x] `P0-LLM-040` 三档独立模型设置与 key 不回显契约已迁移。
- [x] `P2-QUEUE-020` 项目启动持久队列、租约、幂等和有界重试已迁移。
- [x] `P0-EVIDENCE-001` 开放 PDF 下载、SHA-256、页码 quote 和证据状态已迁移到 TypeScript。
- [x] `P1-PAPER-016` 证据约束论文草稿保持待审批 Patch，不把元数据或未执行结果升级为事实。

## 后续任务

- [ ] `P1-DEPS-049` 跟进 Mastra 固定的 `@ai-sdk/provider-utils@3.0.30` 上游审计告警；等待兼容补丁后升级并重跑生产依赖审计，禁止强制覆盖不兼容的间接依赖。
- [ ] `P0-REPO-048` 补齐原生仓库双源验证、许可证检查和审批后归档下载。
- [ ] `P0-IMPACT-008` 补齐完整语义依赖失效和复杂检查点恢复。
- [ ] `P0-RUNNER-007` 在真实 GPU Windows/WSL2 主机验证 GPU 任务与资源记录。
- [ ] `P1-UPLOAD-009` 增加大规模异步材料索引和跨材料语义检索。
- [ ] `P1-PAPER-016B` 完成 claim 到多证据的语义人工复核工作台。
- [ ] `P2-INSTALLER-029` 完成签名 EXE、干净 Windows VM 安装/升级/卸载验收和 GitHub Release 发布。
- [ ] `P2-HA-021` 增加长期无人值守运行、外部告警和恢复演练。

## 本轮验证记录

- `npm run typecheck`：TypeScript server、web、scripts 和 Mastra 已通过。
- `npm run idea-cases:check`：4 个公开 Idea case 通过；来源扫描改用 TypeScript 目录递归，不依赖 Node 22 专有的 `fs.globSync`。
- `npm run docs:check`：双语文档同步版本 `2026-07-31-03` 通过。
- `npm run db:migrate`：`0001-native-typescript` 已在 `runtime/research-os.pglite` 成功应用。
- Docker 最终备份：`artifacts/backups/20260730T200648Z/` 的 SQL、PostgreSQL 卷和 MinIO 卷均通过可读性检查并记录 SHA-256；随后仅删除 `research-os` 的 11 个容器、3 个网络、2 个卷和 6 个自建镜像，标签复核为空。
- 三档实际 `.env` URL 与配置示例均为 `http://10.31.107.77:3000/v1`；key 只检查是否存在，不输出值。
- `npm run model-failure:check`：受控无效端点返回 `llm_request_failed`，失败轮没有持久化助手消息，并在 `finally` 恢复 `.env` 默认配置。
- `npm run experiment:check`：两个项目分别创建 `.venv`；固定 Windows `cmd.exe` 后端生成有限数值指标、结构化检查点、非空 PLY 与四条 SHA-256 记录；取消时终止完整进程树并写入 `cancelled`。
- 浏览器实测：1910x1075 桌面与 390x844 移动端无横向溢出和控制台错误；三档设置显示正确 URL、推理强度、key 已配置状态且不回显 key；Mastra Studio graph 显示三个 Agent 与三个 Workflow。
- Mastra/Web/Server 构建、Vitest（5 文件、10 测试）及双语文档同步检查已通过；Mastra 构建使用 Node 22.22.0。
- 完整真实 Idea 验收：`artifacts/acceptance/acceptance-20260731033509.json` 已通过；`active-learning-3d` 两次真实请求分别路由到 Terra/medium 与 Sol/high，公开设置不含 key，URL 与项目 `.env` 一致，项目创建、暂停和恢复状态门禁通过。
- 浏览器证据已写入 `docs/assets/research-os-overview.jpg`、`docs/assets/research-os-model-settings.jpg` 和 `docs/assets/research-os-mastra-workflow.jpg`，截图不含 key 内容；README 双语版已引用同一组证据。
- 最终仓库扫描：业务源码、脚本和测试没有 `.py`；没有旧编排、容器文件、旧 Python 服务路径或旧模型服务路径；`.env`、运行时数据库、备份和密钥未进入变更范围。
- 交付边界：本地 MVP 迁移已完成；签名 EXE、干净 Windows VM 安装/升级/卸载、GitHub Release 发布、真实 GPU 主机验证和后续研究能力仍由后续任务保留。
- 提交审计：`d02f649`（`feat:migrate-research-os-to-native-typescript`）。
