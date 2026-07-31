# Research OS TODO

最后更新：2026-07-31（Asia/Shanghai）

状态：`[ ]` 待处理、`[~]` 进行中、`[x]` 已完成并验证、`[!]` 外部阻塞。

## 当前最高优先级

- [~] `P0-CONTRACT-053` 清除模型 provider/全局凭据隐式回退并修复默认运行目录验收边界。
  - 完成标准：Luna/Terra/Sol 的 URL、key 和 reasoning effort 只从各自层级配置或受控运行时覆盖读取；缺失层级 URL/key 必须直接返回结构化配置错误；默认服务目录必须能启动，恢复候选只能通过明确、可审计的运行配置切换；补充测试、文档和启动验收。
  - 当前状态：Mastra 与服务器的全局 URL/key 回退已删除，三档配置测试已通过；启动命令已改为显式加载项目 `.env`。原始 `runtime/research-os.pglite` 是旧 PostgreSQL 集群目录，仍保留不覆盖；已验证恢复候选必须通过 `RESEARCH_RUNTIME_DIR=runtime/restore-pglite-20260731` 显式启用。

- [x] `P0-DB-052` 从已保存的 PostgreSQL SQL 备份生成并验证非覆盖式 PGlite 恢复候选。
  - 完成标准：恢复工具使用 TypeScript、拒绝覆盖已有目录、按当前 schema 映射旧列、解析 COPY 数据、校验行数/关键表和数据库可读性；失败不得替换主库；成功后记录恢复候选路径和验证命令。
  - 已完成：新增 `npm run db:restore-dump`；从 `artifacts/backups/20260730T200648Z/postgres.sql` 生成 `runtime/restore-pglite-20260731`，导入并校验 12 个项目、34 个实验、223 个 Artifact、518 条消息和 11 个任务；恢复候选在临时 `8081` 端口通过 API 健康、模型设置脱敏和项目列表读取验证。原损坏主库未覆盖。

- [!] `P0-TS-NATIVE-047` 将应用迁移为原生 Windows TypeScript 系统。
  - 已完成：TypeScript 工作区；Hono API；PGlite 18 表迁移；Mastra Agents、Memory、Skills、Tools、Workflows 和 Studio 本机存储；三档独立模型配置；TypeScript Web 构建；持久工作流队列；审批/证据/论文草稿；Windows Defender 上传门禁；本机实验监督器；每项目 `.venv`；Windows `cmd.exe` 默认后端与 WSL2 可选后端；Node.js 运行时安装器源码。
  - 已完成清理：旧 `research-os` 容器、网络、命名卷和六个自建镜像已在最终备份校验后删除；仓库运行不再占用 Docker 资源。
  - 已验证代码能力：Luna/Terra/Sol 三档真实请求；模型失败直接返回结构化错误且不写助手消息；Mastra Studio 三个 Agent 与三个 Workflow graph；独立 `.venv`、数值指标/检查点/PLY/SHA-256 产物及进程树取消。
  - 已完成代码级验收：完整真实 Idea 验收、typecheck、测试、Mastra/Web 构建、文档检查、仓库零旧实现扫描和桌面 UI/Mastra graph 截图证据；README 双语版与需求审计已同步。
  - 当前状态：默认 `runtime/research-os.pglite` 启动时仍抛出 `PGlite RuntimeError: Aborted()`，但已生成并验证的 `runtime/restore-pglite-20260731` 恢复候选当前正在为 `127.0.0.1:8080` 和 `127.0.0.1:4111` 提供服务；API 健康、12 个项目读取、三档模型设置脱敏和 Mastra 工作流 graph 均已通过实际 HTTP 检查。原始目录和备份未覆盖；是否切换默认运行目录仍需用户明确批准。
  - 完成标准：仓库业务源码、脚本和测试只有 TypeScript；应用不依赖容器运行时；原生 typecheck/test/build、数据库迁移、`.venv` 实验、取消、Mastra Studio、浏览器和真实模型验收通过；默认服务启动并通过健康检查；文档同步；提交并推送。
  - 模型验收：三档默认 URL 从项目 `.env` 读取。模型或 key 无效时必须直接返回结构化错误且不写助手消息。

- [~] `P0-SUPERMEMORY-052` 将 Supermemory 接入 Research OS，作为项目级语义 Agent Memory 管理工具；已核对官方 Mastra/Graph Memory/Super RAG 文档，已完成严格失败关闭的初步 SDK/Processor、项目范围查询 API 和前端 Graph 入口，但尚未完成完整业务摄取、删除/撤销、来源追溯、跨项目真实隔离和真实 API 验收。
  - 官方资料：`https://supermemory.ai/docs/integrations/mastra.md`、`https://supermemory.ai/docs/concepts/graph-memory.md`、`https://supermemory.ai/docs/concepts/super-rag.md`、`https://supermemory.ai/docs/llms.txt`、`https://supermemory.ai/llms.txt`；已核对 `@supermemory/tools@2.1.1` 和 `supermemory@4.24.2` 的官方版本入口。实现仍必须以当前安装包类型和真实 API 响应为准；无法访问或不兼容时保持直接结构化错误，不得臆造接口。
  - `P0-SUPERMEMORY-052-A` Mastra 集成与配置：使用官方 Mastra 集成承载 Supermemory 读写/检索；服务端只从项目 `.env`/受控运行时配置读取 Supermemory URL、key 和模型相关配置，网页只显示 `key_configured`；请求失败直接返回结构化错误，不使用本地 fallback、隐式 provider 切换或伪造助手消息。
  - `P0-SUPERMEMORY-052-B` 项目隔离：为每个 Research OS `project_id` 建立稳定的 Supermemory scope/container/resource/metadata 隔离（以官方 API 核对结果为准），所有写入、事实检索、Graph Memory 和 Super RAG 查询都必须带项目范围；两个项目必须有跨项目泄漏测试，不能只依赖 prompt 或前端过滤。跨项目访问默认禁止，若未来需要必须有 Proposal、权限、审计和明确用户操作。
  - `P0-SUPERMEMORY-052-C` Graph Memory 可视化：网页左下角增加 Supermemory Graph Memory 入口；图视图必须绑定当前 project、显示加载/空/错误/权限状态和来源，不能将全局或其他项目的 graph 混入当前项目。入口、Graph URL/token 代理和 CSP/权限边界必须经过浏览器桌面与移动端验收。
  - `P0-SUPERMEMORY-052-D` Super RAG 语义检索入口：提供项目范围的历史事实/记录检索页，支持查询、来源、相关 Artifact、Idea 版本、时间和证据状态；结果必须保留 Supermemory 返回的来源和置信信息，不能把检索候选直接升级为论文事实或实验结论。
  - `P0-SUPERMEMORY-052-E` 文献与多模态摄取：参考 PDF 及其页码/章节、quote、SHA-256、来源 URL、Artifact ID，上传后按项目写入 Supermemory；支持图片结果分析/识别等多模态内容，但原图/原 PDF 仍进入受控 Artifact，Supermemory 失败不能丢弃或伪造本地语义结果。
  - `P0-SUPERMEMORY-052-F` 业务接入面：Idea 讨论及澄清、日报 feedback、日报/周报正文、实验结果汇报总结、实验设计依据与探索点、论文写作与 related work 参考等长文本语义内容使用 Supermemory；SQL 只保留结构化实体、状态、关系、权限、审批、哈希和审计索引，并建立可重放、幂等、可删除的 memory 关联。
  - `P0-SUPERMEMORY-052-G` 质量与安全验收：完成 TypeScript schema、最小权限、项目隔离、失败关闭、超时、重复写入、删除/撤销、来源追溯、PDF/图片边界和真实模型/真实 Supermemory API 测试；验证两个项目互不可见、Graph 与 RAG 入口不越权、模型失败不写助手消息，并更新双语 README、架构/安全/运维、`.env.example`、需求审计和本 TODO。
  - 完成标准：代码、Mastra 集成、项目级隔离、Graph Memory 入口、Super RAG 入口、文献/长文本/多模态接入、SQL 责任边界、测试、浏览器证据、失败契约、文档和审计全部通过后才能标 `[x]`；当前保持 `[~]`。

## 已并入本次迁移

- [x] `P0-MASTRA-046` Mastra Agent 与 Workflow 实现代码已保留并迁入原生 Node 运行时。
- [x] `P0-LLM-040` 三档独立模型设置与 key 不回显契约已迁移。
- [x] `P2-QUEUE-020` 项目启动持久队列、租约、幂等和有界重试已迁移。
- [x] `P0-EVIDENCE-001` 开放 PDF 下载、SHA-256、页码 quote 和证据状态已迁移到 TypeScript。
- [x] `P1-PAPER-016` 证据约束论文草稿保持待审批 Patch，不把元数据或未执行结果升级为事实。

## 后续任务

- [x] `P1-UI-055` 将 `apps/web` 从前端原生 DOM/HTML 实现整体重写为 React 19 + TypeScript 组件应用；保留当前 API、Supermemory、Mastra、实验和审批功能契约，删除过时的 `public/index.html` 大段标记、`app.ts`/`chat-ux.ts` 原生 DOM 代码和未使用的旧产物；构建仍由 server 静态托管，桌面与移动端真实浏览器验收通过。
- [x] `P1-UI-054` 使用已安装的 `ui-skills`/`baseline-ui` 对 `apps/web` 主界面完成统一视觉重设计；保留当前 API、Supermemory、Mastra、实验和审批功能契约，统一导航层级、信息密度、表单反馈、产物展示和桌面/移动端布局。`npm run build --workspace @research-os/web` 通过；真实浏览器已检查新 Idea、项目概览、产物图库、模型设置弹窗和移动端，页面无横向溢出、无重叠、无新增控制台错误；未引入渐变、无边界装饰卡片或模型失败 fallback。
- [ ] `P1-DEPS-049` 跟进 Mastra 固定的 `@ai-sdk/provider-utils@3.0.30` 上游审计告警；等待兼容补丁后升级并重跑生产依赖审计，禁止强制覆盖不兼容的间接依赖。
- [ ] `P1-MASTRA-050` 按 Mastra 官方能力扩展 Research OS，官方文档入口为 `https://mastra.ai/llms.txt`；先从该导航定位主题，再核对 `https://mastra.ai/docs/` 和当前安装版本类型定义。所有子任务必须保持无 fallback、严格 schema、Proposal 审批、Git/audit 记录和本地服务边界。
  - [x] `P1-MASTRA-050-A` 接入 Mastra Agent Approval 与 Workflow Human-in-the-loop：为高成本工具、依赖安装、代码/配置修改、实验提交和外部发布定义 `requireApproval` 或 `suspend()/resume()`；审批绑定工具名、参数指纹、用户、Proposal、策略版本和审计记录；PGlite Proposal 仍是业务审批源。已通过 `npm run mastra:hitl:check` 验证暂停载荷、拒绝恢复、Proposal 状态和审计绑定；当前没有把测试 Proposal 当作业务批准。
  - [ ] `P1-MASTRA-050-B` 接入 Guardrails/Processors：评估输入规范化、提示注入检测、敏感信息/密钥清理、输出格式校验、成本上限、流式输出过滤和失败关闭行为；不得把处理器变成模型失败时的本地回答或隐式 provider 切换。
  - [ ] `P1-MASTRA-050-C` 评估 Supervisor Agents、Agent-as-tool、Workflow-as-tool 和 delegation hooks：将文献检索、证据审查、实验规划、论文草稿等专业角色组合为可审计的协调链；限制消息传播、工具权限、最大迭代次数和模型路由，不得形成无界 Agent 循环。
  - [ ] `P1-MASTRA-050-D` 评估 Mastra Memory 与 Supermemory 的职责边界：Supermemory 负责项目级语义 Memory、Graph Memory 和 Super RAG；Mastra 只负责官方 Agent 集成与运行时编排；明确 resource/thread/project scope、压缩、成本、删除和 PGlite 结构化状态边界，不能让任一 Memory 系统成为唯一业务记忆。
  - [ ] `P1-MASTRA-050-E` 使用 Mastra RAG 能力实现材料索引：对已通过上传门禁和 PDF 解析的材料执行 bounded chunking、embedding、向量检索、metadata filter、rerank，并评估 GraphRAG；每个 chunk 必须保留材料 Artifact、SHA-256、页码/章节、来源和证据状态，元数据不得升级为全文证据。
  - [ ] `P1-MASTRA-050-F` 接入 Mastra Evals/Datasets：把 `tests/idea-cases/*.json` 和公开 Idea 测试输入映射为版本化 Dataset；使用 rule-based/LLM scorer、Quick Checks、Gates/Verdicts 和 Multi-turn Evals 检验澄清质量、结构化输出、证据约束、模型路由和失败契约；真实模型失败必须保留为失败结果。
  - [ ] `P1-MASTRA-050-G` 接入 Mastra Observability/Tracing/Feedback：记录 Agent、Workflow、Tool、模型调用的 trace、span、token、耗时、成本和人工反馈，并在 Studio 中可回溯到具体运行；评估本地开发存储与 OLAP 指标存储的边界，禁止把业务数据库或实验结论伪装成 Mastra telemetry。
  - [ ] `P2-MASTRA-050-H` 评估 Durable Agents、Background Tasks、Signals、Goals、Schedules 和 workflow snapshots/time travel：用于跨重启的长期研究监督、等待外部回调、报告计划和失败步骤恢复；与现有 PGlite 队列、租约、幂等、取消和 audit 进行对照，只有通过恢复/取消/并发验收后才替换现有实现。
  - [ ] `P2-MASTRA-050-I` 对 Workspace/Sandbox、Browser、MCP/A2A、Channels、Voice、Agent Controller、Code Mode、Editor/Agent Builder 做范围评估；Idea Agent 默认不启用任意文件系统、Shell、网络目标或代码编辑能力，Browser/Channels/Voice 只有出现明确产品需求并完成权限审查后接入。
  - 完成标准：每个实际接入能力都有 TypeScript 实现、严格 schema、最小权限测试、失败测试、文档说明、审计字段和真实适用验收；未采用的能力必须记录原因，不能仅以“Mastra 支持”表述为已实现。
- [~] `P1-VIZ-051` 将科研训练与实验产物可视化内置到 Research OS 的 TypeScript Web 应用，不把 TensorBoard 或 W&B 作为默认运行服务或硬依赖。
  - [x] `P1-VIZ-051-A` 定义受监督的时间序列产物契约：在现有有限数值 `metrics.json` 之外增加有界 `metrics.jsonl` 或等价 JSON schema，支持 epoch/batch、loss、accuracy、learning rate、validation 指标、时间戳和 seed；限制行数、字段、数值范围、文件大小并执行 SHA-256 和 Artifact 账本登记。`npm run experiment:check` 已验证文件、解析、SHA-256、账本和受控预览。
  - [ ] `P1-VIZ-051-B` 在 `apps/web` 使用 TypeScript 实现 loss/accuracy/learning-rate 曲线、多 seed 对比、图例、缩放、悬停读数、缺失值/失败状态和移动端布局；优先使用轻量、可审计的 SVG/canvas 或成熟 TypeScript 图表库，先验证依赖再加入 package lock。
  - [ ] `P1-VIZ-051-C` 扩展产物查看器：支持 PNG/JPEG/WebP/GIF 图片预览、视频 `video` 播放/暂停/进度/大小限制、JSON/CSV/日志文本预览、PLY/点云预览和下载；所有媒体必须经过 MIME、大小、路径、symlink、SHA-256 和项目权限校验。
  - [ ] `P1-VIZ-051-D` 将可视化绑定到 Experiment、Run、Checkpoint、Proposal、Git commit、数据版本和配置；模型只解释已计算曲线，不生成或修改数值结果；失败或取消的运行不能显示为成功曲线。
  - [ ] `P1-VIZ-051-E` 完成 TypeScript 单元测试、产物边界测试、恶意媒体/超大文件测试和真实浏览器桌面/移动端截图验收；TensorBoard 仅作为训练日志格式和交互设计参考，W&B 仅作为未来可选外部协作集成评估。
- [x] `P0-REPO-048` 补齐原生仓库双源验证、许可证检查和审批后归档下载。
  - 已完成：候选录入、GitHub/GitLab 双源 DOI/精确标题匹配、SPDX 与固定 commit 门禁、审批后固定归档 Artifact、安全解压、项目 Git 提交、Artifact 依赖谱系、审计记录和前端入口。
  - 历史验证：`npm run typecheck`、`npm test --workspace @research-os/server -- --no-cache`（6 files/15 tests）、`npm run build`（Node 24.14.0）、`npm run docs:check`、`git diff --check`、API `127.0.0.1:8080/api/health` 和 Mastra `127.0.0.1:4111/health`。当前复查的服务健康检查受 `P0-TS-NATIVE-047` 数据库阻塞影响。
  - 限制：本轮未执行真实第三方仓库下载；真实 provider 网络、许可证元数据和论文关联仍需在用户选择候选后通过界面验证，系统不会把未执行结果标为成功。
- [x] `P0-IMPACT-008` 补齐完整语义依赖失效和复杂检查点恢复。
  - 已完成：实验、Artifact、Idea、Git、证据、仓库、上传材料和配置依赖绑定；上游指纹漂移检测；递归失效传播；检查点 Artifact 路径、链接文件、存在性和 SHA-256 校验；`experiment_rerun` Proposal；批准后自动恢复入队；普通实验接口禁止重复提交恢复 Proposal。
  - 验证：`npm run typecheck`、`npm test --workspace @research-os/server`（7 files/18 tests）、Mastra Node 24 构建、`git diff --check`、`npm run docs:check`。
- [ ] `P0-RUNNER-007` 在真实 GPU Windows/WSL2 主机验证 GPU 任务与资源记录。
- [ ] `P1-UPLOAD-009` 增加大规模异步材料索引和跨材料语义检索。
- [ ] `P1-PAPER-016B` 完成 claim 到多证据的语义人工复核工作台。
- [ ] `P2-INSTALLER-029` 完成签名 EXE、干净 Windows VM 安装/升级/卸载验收和 GitHub Release 发布。
- [ ] `P2-HA-021` 增加长期无人值守运行、外部告警和恢复演练。

## 本轮验证记录

- `2026-07-31` `P1-UI-055` 复查：`apps/web` 已从原生 DOM 脚本重写为 React 19 + TypeScript 组件应用；`index.html` 只剩挂载点，旧 `app.ts`/`chat-ux.ts`/`chat-ux.js` 已删除，新增 `favicon.svg`。根目录 `npm run typecheck`、`npm test -- --no-cache`（9 个测试文件、27 个测试）、`npm run docs:check`、`npm run idea-cases:check`、完整 `npm run build` 和 `ops-guard status` 均通过；真实浏览器桌面/移动端检查无横向溢出、无控制台错误，项目、文献、实验、报告、模型设置和项目记忆图弹窗均可打开。
- `P0-SUPERMEMORY-052` 复查：已加入 `supermemory` 官方 SDK、严格输入/输出 Processor、项目 `containerTag` 隔离、`/memory/status|search|graph` API 和左下角 Graph Memory UI；未配置 Supermemory key 时直接返回 `supermemory_not_configured`，不显示本地伪造结果。真实 Supermemory API、两个项目跨项目泄漏测试、长文本/PDF/图片摄取、幂等删除/撤销、来源链和浏览器运行态验收仍未完成，任务保持 `[~]`。
- `2026-07-31` 复查：修复 `apps/web/src/app.ts` Graph 响应的 TypeScript 类型错误；`npm run typecheck`、提升权限后的 `npm run build` 和 `npm test -- --no-cache` 均通过（8 个测试文件、20 个测试）。API/Mastra 旧进程重启时发现当前系统 `node` 为 `20.13.1`，不满足仓库 `>=22.13`，服务因 `pdfjs-dist` 的 `DOMMatrix` 依赖退出；因此不能记录为运行时启动通过，需使用 Node 22.13+ 后重新验收。
- `2026-07-31` 运行态复查：使用官方 Node `22.22.0` 便携运行时和未覆盖主库的 `runtime/restore-pglite-20260731` 启动 API/Mastra；健康检查、项目读取、三档模型设置、`/memory/status` 和未配置 key 时的 `503 supermemory_not_configured` 均通过。浏览器确认项目详情页契约归一化、项目统计、Graph Memory 弹窗和直接失败状态正常；修复 `apps/web/src/app.ts` 的扁平/嵌套项目响应兼容，重建 Web 并确认无新增控制台错误。默认损坏数据库仍未切换，真实 Supermemory key/API 仍未配置。
- `2026-07-31` Supermemory 代码复查：Node 24.14.0 下 `npm run typecheck`、`npm test --workspace @research-os/server -- --no-cache`（8 个测试文件、21 个测试）、服务端 build 和 Web build 均通过。同步双语 README、运维、安全和需求审计，明确项目 container tag、memory_links 账本、PDF/图片边界、审批撤销和失败关闭契约；真实 Supermemory key/API、两项目隔离和端到端撤销仍未验证，因此 `P0-SUPERMEMORY-052` 保持 `[~]`。
- `2026-07-31` 最新运行态复查：用 Node 24 和 `runtime/restore-pglite-20260731` 在临时 `127.0.0.1:8081` 启动最新 API，读取 12 个项目；模型设置三档均显示 `http://10.31.107.77:3000/v1`、来源 `env_default`，仅返回 `key_configured`。无 Supermemory key 时 ingest/search/graph 均返回 `503 supermemory_not_configured`，memory_links 只保留失败账本；现有 Mastra `127.0.0.1:4111/health` 返回 200。临时 8081 进程和验证文件已停止/清理，默认损坏主库未覆盖。
- `P0-IMPACT-008` 复查：`npm run typecheck`、`npm test --workspace @research-os/server`（7 files/18 tests）、Mastra Node 24.14.0 生产构建、`git diff --check` 和双语文档同步均已通过。
- `2026-07-31` 当前复查未通过完整验证：`npm run typecheck`、`npm run docs:check`、`npm run idea-cases:check`、API/Mastra 健康检查通过；`npm test -- --no-cache` 有 2 个 Windows `EPERM` 失败（`impact-service.test.ts` 创建 `artifacts/runs`、`venv.integration.test.ts` 创建 `projects` 临时目录），`npm run build` 使用当前 Node `20.13.1` 失败（仓库要求 `>=22.13`，同时 Web 输出文件被拒绝写入）。因此不能宣称当前目标全部完成；待使用可用 Node 22.13+、可写工作区重跑测试和构建，并重新处理默认 PGlite 目录问题。
- `P0-TS-NATIVE-047` 当前复查：`npm run typecheck`、提升权限后的 `npm test -- --no-cache`（7 files/18 tests）和 `npm run build` 均通过；默认目录仍复现 `PGlite RuntimeError: Aborted()`，但恢复候选实际通过 `8080`/`4111` 健康检查、项目读取、三档模型设置和 Mastra workflow graph 检查；未覆盖主库，默认运行目录切换仍待用户批准。
- `2026-07-31` 本次复查：项目 Node 22.22.0 下 `npm run typecheck`、`npm run docs:check`、`npm run idea-cases:check`、API/Mastra 健康检查和 `npm test -- --no-cache`（9 个测试文件、27 个测试）通过；Web/API 构建通过，但完整 `npm run build` 仍在 Mastra Studio 产出目录因已存在的 `@libsql` 原生模块被占用而以 `EPERM` 失败。因此当前仍不能标记全部完成；P0-TS-NATIVE-047、P0-SUPERMEMORY-052 和 P1-VIZ-051 继续保持未完成/阻塞状态，其他开放任务不变。
- `2026-07-31` Node 运行时复查：NVM for Windows 已接管当前 shell，`nvm current` 为 `26.5.1`，实际 `node` 路径为 `C:\nvm4w\nodejs\node.exe`；Node 26 下 `npm run typecheck`、`npm test -- --no-cache`（9 个测试文件、27 个测试）和完整 `npm run build` 均通过。新增根目录 `.nvmrc` 和双语运行说明；此前创建的 `C:\tmp\research-os-node22` 便携运行时已确认，但删除操作被破坏性操作审查服务 `503` 阻塞，目录仍保留；NVM 管理的版本未删除。
- `2026-07-31` Mastra HITL 复查：Node 26 下 `npm run mastra:hitl:check` 真实调用本地 Mastra/API，验证 `suspend()` 返回项目、Proposal、工具、参数指纹和策略版本，随后用 `resume()` 拒绝测试 Proposal；Proposal 状态、用户和 Mastra 审批绑定均在项目审计账本中核对通过。该检查不调用模型、不执行实验、不批准任何高成本操作。
- `npm run typecheck`：TypeScript server、web、scripts 和 Mastra 已通过。
- `npm run idea-cases:check`：4 个公开 Idea case 通过；来源扫描改用 TypeScript 目录递归，不依赖 Node 22 专有的 `fs.globSync`。
- `npm run docs:check`：双语文档同步版本 `2026-07-31-07` 通过。
- `npm run db:migrate`：`0001-native-typescript` 已在 `runtime/research-os.pglite` 成功应用。
- `npm run db:restore-dump -- artifacts/backups/20260730T200648Z/postgres.sql runtime/restore-pglite-20260731`：非覆盖式恢复成功；临时 API `127.0.0.1:8081/api/health` 返回 200，`/api/projects` 读取 12 个项目；默认 `runtime/research-os.pglite` 仍未替换，等待明确恢复切换批准。
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
