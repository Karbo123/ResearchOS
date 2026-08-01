# Research OS TODO

最后更新：2026-08-01（Asia/Shanghai）

状态：`[ ]` 待处理、`[~]` 进行中、`[x]` 已完成并验证、`[!]` 外部阻塞。

## 当前最高优先级

- [!] `P0-CONTRACT-053` 清除模型 provider/全局凭据隐式回退并修复默认运行目录验收边界。
  - 完成标准：Luna/Terra/Sol 的 URL、key 和 reasoning effort 只从各自层级配置或受控运行时覆盖读取；缺失层级 URL/key 必须直接返回结构化配置错误；默认服务目录必须能启动，恢复候选只能通过明确、可审计的运行配置切换；补充测试、文档和启动验收。
  - 当前状态：Mastra 与服务器的全局 URL/key 回退已删除，三档配置测试已通过；启动命令已改为显式加载项目 `.env`。当前 `.env` 显式选择并已实际验证 `runtime/restore-pglite-20260731`，原始 `runtime/research-os.pglite` 仍保留不覆盖。真实模型三档 key 尚未配置，解除条件是用户提供有效 key 后完成完整 acceptance；失败仍直接返回结构化错误。

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

- [!] `P0-SUPERMEMORY-052` 将 Supermemory 接入 Research OS，作为项目级语义 Agent Memory 管理工具；已核对官方 Mastra/Graph Memory/Super RAG 文档，已完成严格失败关闭的 SDK/Processor、项目范围查询 API、前端 Graph/RAG 入口和有界材料索引，但尚未完成真实 API 验收。
  - 官方资料：`https://supermemory.ai/docs/integrations/mastra.md`、`https://supermemory.ai/docs/concepts/graph-memory.md`、`https://supermemory.ai/docs/concepts/super-rag.md`、`https://supermemory.ai/docs/llms.txt`、`https://supermemory.ai/llms.txt`；已核对 `@supermemory/tools@2.1.1` 和 `supermemory@4.24.2` 的官方版本入口。实现仍必须以当前安装包类型和真实 API 响应为准；无法访问或不兼容时保持直接结构化错误，不得臆造接口。
  - [x] `P0-SUPERMEMORY-052-A` Mastra 集成与配置：使用官方 Mastra 集成承载 Supermemory 读写/检索；服务端只从项目 `.env`/受控运行时配置读取 Supermemory URL、key 和模型相关配置，网页只显示 `key_configured`；请求失败直接返回结构化错误，不使用本地 fallback、隐式 provider 切换或伪造助手消息。
  - [~] `P0-SUPERMEMORY-052-B` 项目隔离：每个 `project_id` 使用确定性的 Supermemory container tag 和本地权限校验；mock 两项目隔离测试已通过，真实两个项目泄漏测试待有效 Supermemory key/API。
  - [~] `P0-SUPERMEMORY-052-C` Graph Memory 可视化：网页左下角入口、当前 project scope、加载/空/错误状态和来源已实现；真实 provider graph 与桌面/移动端最新截图验收待有效 key。
  - [~] `P0-SUPERMEMORY-052-D` Super RAG 语义检索入口：Graph 弹窗和材料页已直接调用项目范围 hybrid 检索并保留来源/相似度/证据状态；真实返回格式和跨项目验收待有效 key。
  - [~] `P0-SUPERMEMORY-052-E` 文献与多模态摄取：参考 PDF 的页码 quote、SHA-256、Artifact 关联以及 Defender 扫描上传的 PDF/图片路径已实现；新增 PDF/文本有界分块，真实 PDF/图片 provider 摄取待有效 key。
  - [~] `P0-SUPERMEMORY-052-F` 业务接入面：Idea/project chat、feedback、报告、实验总结、实验计划、related work 和论文草稿均已接入或保留语义关联入口；完整事件重放、删除和远程验证待有效 key。
  - [!] `P0-SUPERMEMORY-052-G` 质量与安全验收：TypeScript schema、失败关闭、超时、幂等、mock 隔离、来源追溯、PDF/图片边界和未配置 key 失败测试已通过；真实 Supermemory API、两项目跨项目泄漏、端到端撤销/删除和真实浏览器 provider 状态的解除条件是配置有效 `SUPERMEMORY_API_KEY`。
  - 完成标准：代码、Mastra 集成、项目级隔离、Graph Memory 入口、Super RAG 入口、文献/长文本/多模态接入、SQL 责任边界、测试、浏览器证据、失败契约、文档和审计全部通过后才能标 `[x]`；当前保持 `[~]`。

## 已并入本次迁移

- [x] `P0-MASTRA-046` Mastra Agent 与 Workflow 实现代码已保留并迁入原生 Node 运行时。
- [x] `P0-LLM-040` 三档独立模型设置与 key 不回显契约已迁移。
- [x] `P2-QUEUE-020` 项目启动持久队列、租约、幂等和有界重试已迁移。
- [x] `P0-EVIDENCE-001` 开放 PDF 下载、SHA-256、页码 quote 和证据状态已迁移到 TypeScript。
- [x] `P1-PAPER-016` 证据约束论文草稿保持待审批 Patch，不把元数据或未执行结果升级为事实。

## 后续任务

- [~] `P0-SUPERMEMORY-LOCAL-053` 切换到 Supermemory Local 自托管：默认使用本机 `127.0.0.1:6767`，支持官方 Local 的 localhost 自动认证和显式本地 key；云端/非回环地址仍强制鉴权。同步配置、Mastra、双语文档、运维说明、真实本地服务验收和失败契约；不得使用云端或静默替代 provider。
  - [x] `P0-SUPERMEMORY-LOCAL-053-A` 本地回环自动认证、显式 key、Mastra 同步、配置状态与失败关闭测试已补齐；云端/非回环仍强制鉴权。
  - [x] `P0-SUPERMEMORY-LOCAL-053-B` 官方 embedding 配置面（provider/model/dimensions/base_url/项目保留 key）已加入 `.env`/示例、状态接口、前端提示和双语文档；远程 embedding 在当前 build 不支持时失败关闭。
  - [!] `P0-SUPERMEMORY-LOCAL-053-C` Supermemory Local `0.0.7-rc.2` 二进制只实现本地 ONNX embedding（`Xenova/bge-base-en-v1.5`，768 维，仅英语）；官方文档中的 `SUPERMEMORY_EMBEDDING_PROVIDER/MODEL/DIMENSIONS/BASE_URL` 在该 build 中未实现。解除条件：安装实现远程 embedding 环境变量的服务端 build，并在真实服务上完成 1024 维 API 摄取/检索验收；切换维度前必须使用全新数据目录或完整重索引。

- [x] `P1-UI-055` 将 `apps/web` 从前端原生 DOM/HTML 实现整体重写为 React 19 + TypeScript 组件应用；保留当前 API、Supermemory、Mastra、实验和审批功能契约，删除过时的 `public/index.html` 大段标记、`app.ts`/`chat-ux.ts` 原生 DOM 代码和未使用的旧产物；构建仍由 server 静态托管，桌面与移动端真实浏览器验收通过。
- [x] `P1-UI-054` 使用已安装的 `ui-skills`/`baseline-ui` 对 `apps/web` 主界面完成统一视觉重设计；保留当前 API、Supermemory、Mastra、实验和审批功能契约，统一导航层级、信息密度、表单反馈、产物展示和桌面/移动端布局。`npm run build --workspace @research-os/web` 通过；真实浏览器已检查新 Idea、项目概览、产物图库、模型设置弹窗和移动端，页面无横向溢出、无重叠、无新增控制台错误；未引入渐变、无边界装饰卡片或模型失败 fallback。
- [!] `P1-DEPS-049` 跟进 Mastra 固定的 `@ai-sdk/provider-utils@3.0.30` 上游审计告警；直接 `tar` 已升级到 `7.5.22` 并清除严重漏洞，剩余 `@ai-sdk/provider-utils`/`undici` 风险仍由当前 Mastra/Supermemory 上游传递依赖固定，暂无兼容补丁，禁止强制覆盖不兼容的间接依赖。解除条件是上游发布兼容修复后重跑 `npm audit --omit=dev`。
- [~] `P1-MASTRA-050` 按 Mastra 官方能力扩展 Research OS，官方文档入口为 `https://mastra.ai/llms.txt`；先从该导航定位主题，再核对 `https://mastra.ai/docs/` 和当前安装版本类型定义。所有子任务必须保持无 fallback、严格 schema、Proposal 审批、Git/audit 记录和本地服务边界；仅真实 Supermemory provider 的材料索引验收仍待外部 key。
  - [x] `P1-MASTRA-050-A` 接入 Mastra Agent Approval 与 Workflow Human-in-the-loop：为高成本工具、依赖安装、代码/配置修改、实验提交和外部发布定义 `requireApproval` 或 `suspend()/resume()`；审批绑定工具名、参数指纹、用户、Proposal、策略版本和审计记录；PGlite Proposal 仍是业务审批源。已通过 `npm run mastra:hitl:check` 验证暂停载荷、拒绝恢复、Proposal 状态和审计绑定；当前没有把测试 Proposal 当作业务批准。
  - [x] `P1-MASTRA-050-B` 接入 Guardrails/Processors：Unicode 规范化、secret block、提示注入检测、system prompt 清理、严格 structured output 和失败关闭已接入；不会生成本地回答或切换 provider。
  - [x] `P1-MASTRA-050-C` 评估 Supervisor Agents、Agent-as-tool、Workflow-as-tool 和 delegation hooks：新增有界 Research Coordinator，限定三个 specialist、消息过滤、单次委派步数和最大步骤，不形成无界循环。
  - [x] `P1-MASTRA-050-D` 评估 Mastra Memory 与 Supermemory 的职责边界：Supermemory 负责项目级语义 Memory/Graph/Super RAG，Mastra 负责 Agent 编排和运行态；PGlite 仍是结构化状态、审批和审计源。
  - [~] `P1-MASTRA-050-E` 材料索引已使用官方 Supermemory 项目范围 hybrid/RAG 路径实现有界 PDF/文本 chunk、来源过滤和多模态上传；未另行启用 Mastra 内置向量存储，待真实 provider 验收确认职责边界。
  - [x] `P1-MASTRA-050-F` 接入 Mastra Evals/Datasets：`tests/idea-cases/*.json` 已映射版本化 Dataset，包含 Quick Checks、严格 scorer 和 gate 检查；真实模型失败仍保留为失败。
  - [x] `P1-MASTRA-050-G` 接入 Mastra Observability/Tracing/Feedback：本地 LibSQL trace、敏感数据过滤、Agent/Workflow 运行关联和人工 feedback 入口已接入，不把 telemetry 写成业务结论。
  - [x] `P2-MASTRA-050-H` 评估 Durable Agents、Background Tasks、Signals、Goals、Schedules 和 snapshots/time travel：当前 PGlite 队列已覆盖租约、幂等、重启恢复和取消；未替换为未经过并发验收的实验性能力，理由已记录在架构/运维文档。
  - [x] `P2-MASTRA-050-I` 完成 Workspace/Sandbox、Browser、MCP/A2A、Channels、Voice、Agent Controller、Code Mode、Editor/Agent Builder 范围评估；未启用任意文件、Shell、网络目标或代码编辑能力，除非未来有明确需求和权限审查。
  - 完成标准：每个实际接入能力都有 TypeScript 实现、严格 schema、最小权限测试、失败测试、文档说明、审计字段和真实适用验收；未采用的能力必须记录原因，不能仅以“Mastra 支持”表述为已实现。
- [x] `P1-VIZ-051` 将科研训练与实验产物可视化内置到 Research OS 的 TypeScript Web 应用，不把 TensorBoard 或 W&B 作为默认运行服务或硬依赖。
  - [x] `P1-VIZ-051-A` 定义受监督的时间序列产物契约：在现有有限数值 `metrics.json` 之外增加有界 `metrics.jsonl` 或等价 JSON schema，支持 epoch/batch、loss、accuracy、learning rate、validation 指标、时间戳和 seed；限制行数、字段、数值范围、文件大小并执行 SHA-256 和 Artifact 账本登记。`npm run experiment:check` 已验证文件、解析、SHA-256、账本和受控预览。
  - [x] `P1-VIZ-051-B` 已实现 TypeScript SVG/canvas 曲线、多 seed、图例、窗口缩放、悬停读数、缺失值断线、失败状态和移动端 seed 控件。
  - [x] `P1-VIZ-051-C` 已实现受 MIME、大小、路径、symlink、SHA-256 和项目权限校验的图片、视频、JSON/CSV/日志、PLY/点云预览与下载。
  - [x] `P1-VIZ-051-D` 已绑定 Experiment、Run、Checkpoint、Proposal、Git commit、数据版本和配置；失败/取消运行不会显示成功曲线，模型不生成数值。
  - [x] `P1-VIZ-051-E` 已补 TypeScript 边界测试和真实桌面/移动浏览器检查；TensorBoard/W&B 均未作为运行依赖。
- [x] `P0-REPO-048` 补齐原生仓库双源验证、许可证检查和审批后归档下载。
  - 已完成：候选录入、GitHub/GitLab 双源 DOI/精确标题匹配、SPDX 与固定 commit 门禁、审批后固定归档 Artifact、安全解压、项目 Git 提交、Artifact 依赖谱系、审计记录和前端入口。
  - 历史验证：`npm run typecheck`、`npm test --workspace @research-os/server -- --no-cache`（6 files/15 tests）、`npm run build`（Node 24.14.0）、`npm run docs:check`、`git diff --check`、API `127.0.0.1:8080/api/health` 和 Mastra `127.0.0.1:4111/health`。当前复查的服务健康检查受 `P0-TS-NATIVE-047` 数据库阻塞影响。
  - 限制：本轮未执行真实第三方仓库下载；真实 provider 网络、许可证元数据和论文关联仍需在用户选择候选后通过界面验证，系统不会把未执行结果标为成功。
- [x] `P0-IMPACT-008` 补齐完整语义依赖失效和复杂检查点恢复。
  - 已完成：实验、Artifact、Idea、Git、证据、仓库、上传材料和配置依赖绑定；上游指纹漂移检测；递归失效传播；检查点 Artifact 路径、链接文件、存在性和 SHA-256 校验；`experiment_rerun` Proposal；批准后自动恢复入队；普通实验接口禁止重复提交恢复 Proposal。
  - 验证：`npm run typecheck`、`npm test --workspace @research-os/server`（7 files/18 tests）、Mastra Node 24 构建、`git diff --check`、`npm run docs:check`。
- [!] `P0-RUNNER-007` 在真实 GPU Windows/WSL2 主机验证 GPU 任务与资源记录；解除条件是可用的真实 GPU 主机，当前只能完成 CPU/固定监督器验收。
- [~] `P1-UPLOAD-009` 增加大规模异步材料索引和跨材料语义检索：已加入固定 `material_index` 队列、Defender 后索引、PDF/文本有界 chunk、图片/不可提取 PDF 原文件上传和项目范围 Supermemory hybrid 搜索；真实 Supermemory API、失败重放和跨材料结果验收待配置 key。
- [x] `P1-PAPER-016B` 完成 claim 到多证据的语义人工复核工作台：严格多 evidence API、项目权限、接受/拒绝决策、审计记录、文献页 UI，以及 Claim Review 到 LaTeX Proposal/Patch 的端到端约束和验证均已完成。已通过隔离 API 测试、临时项目 Git Patch 测试和真实浏览器表单检查；接受复核仍只表示人工检查 quote，不等于科学结论。
- [!] `P2-INSTALLER-029` 完成签名 EXE、干净 Windows VM 安装/升级/卸载验收和 GitHub Release 发布；工作流和 Inno Setup 源码已准备，解除条件是签名证书、干净 VM 和用户授权的 Release 发布。
- [~] `P2-HA-021` 增加长期无人值守运行、外部告警和恢复演练。
  - 当前推进：增加有界健康监控、失败事件 JSONL、受限告警 webhook 配置和只读备份恢复演练；真实长期部署、外部告警接收端和跨重启恢复演练仍需在目标 Windows 主机上执行。

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
- `2026-08-01` Claim Review 与运维复查：新增隔离 API 回归（项目 evidence scope、一次性决策、审计）及 Claim Review 到 LaTeX Proposal/批准 Patch 的临时 Git 工作区端到端测试；真实浏览器确认文献页表单、页码 quote 选择和提交门禁。新增有界 `ops:monitor` 健康事件记录/受限告警与 `ops:recovery-drill` 备份哈希、归档安全和临时恢复演练；两份历史备份演练通过，API/Mastra 健康检查通过。
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
- `2026-08-01` Supermemory Local embedding 复查：官方文档列出 `SUPERMEMORY_EMBEDDING_PROVIDER/MODEL/DIMENSIONS/BASE_URL`，但 `server-v0.0.7-rc.2` 源码与二进制均未实现远程 embedding，只实现本地 ONNX（`Xenova/bge-base-en-v1.5`，768 维，仅英语）。项目已加入双模式配置、状态字段、前端提示与失败关闭测试；配置远程 embedding 而当前 build 不支持时直接返回 `supermemory_embedding_unsupported`。`npm run typecheck`、`npm test`（12 文件、34 测试）、`npm run build`、`npm run docs:check`、`npm run idea-cases:check` 和 `ops-guard status` 通过；真实模型 acceptance 因本地模型端点 `503 Service temporarily unavailable` 失败，未伪造通过。补齐了 `.env` 中三档 `RESEARCH_MODEL_KEY_*`，API 设置接口已显示三档 `key_configured=true`。
