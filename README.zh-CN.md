<!-- DOCS_SYNC_VERSION: 2026-08-01-08 -->

# Research OS

[English](README.md)

Research OS 是一个本地、可审计的科研自动化 MVP。应用业务代码使用 TypeScript，并以 Mastra 实现 Agent 和 Workflow。科研实验工作区允许使用任意语言；科研 Python 项目使用自己独立的 `.venv`。

## 当前状态

原生 Windows 迁移已经完成代码级实现，应用测试和 NVM for Windows 管理的 Node.js 26.5.1 构建均已通过。TypeScript API、嵌入式 PostgreSQL 兼容状态库、Mastra 集成、持久工作流队列、React Web UI、审批门禁、本机实验监督器、产物账本、Windows Defender 上传门禁和 Windows 安装器源码已经实现。默认 `runtime/research-os.pglite` 已从经过验证的非覆盖式恢复候选重建并投入使用（16 个项目）；`.env` 保持 `RESEARCH_RUNTIME_DIR=runtime`。此前损坏的目录单独保留用于检查，不会被自动使用。干净机器上的安装器签名/发布和 GPU 主机验证仍是独立的后续工作。

模型失败会直接返回结构化错误。系统不会改用本地回复、其他提供方或无关实验。

## 架构

- `apps/server`：Hono API、PGlite 状态、队列、证据、审批、报告、仓库验证/获取、产物账本和本机实验监控器。
- `apps/mastra`：Mastra Agents、Memory、Skills、受限 Tools、Workflows、定时任务和 Studio 工作流图。
- `apps/web`：React 19 + TypeScript 组件源码，以及由 esbuild 生成、API 直接托管的静态资源。
- `projects/<project-id>`：独立 Git 工作区。科研 Python 使用 `projects/<project-id>/.venv`。
- `artifacts`：受控上传、证据 PDF、实验产物、验收结果和备份。
- `runtime`：被 Git 忽略的应用状态、模型覆盖、Mastra Memory、日志和 PID 数据。

PGlite 是持久业务状态源。Mastra Memory 不能替代项目、审批、产物或审计状态。

## 环境要求

- Windows 10/11 x64
- NVM for Windows，以及仓库默认的 Node.js `26.5.1`（`package.json` 仍兼容 Node.js `>=22.13`）
- Git for Windows
- Windows Defender，用于上传扫描
- 可选：Python 3.11+，仅用于科研 Python 实验
- 可选：WSL2，必须在实验中显式选择
- 可选：提供 `latexmk.exe` 的 TeX 发行版

## 快速启动

```powershell
nvm install 26.5.1
nvm use 26.5.1
npm ci
npm run build
npm start
```

仓库通过 `.nvmrc` 固定开发用 Node.js 版本。请用 `nvm current` 和 `node --version` 确认当前版本；不要再使用独立的便携 Node.js 目录。Windows 安装器源码目前单独携带自己的 Node.js 运行时，与开发 shell 的版本管理相互独立。

默认运行数据库（从验证过的恢复候选重建）可从 [http://127.0.0.1:8080](http://127.0.0.1:8080) 访问。Mastra Studio 和工作流图位于 [http://127.0.0.1:4111](http://127.0.0.1:4111)，也可以从网页左下角进入。启动命令会自动加载 `.env`；`RESEARCH_RUNTIME_DIR` 是显式且可审计的运行目录选择，损坏目录单独保留。

损坏的数据库目录单独保留，不会被自动使用。仍然可以使用 `npm run db:restore-dump -- artifacts/backups/20260730T200648Z/postgres.sql runtime/restore-pglite-20260731` 生成并检查新的非覆盖式恢复候选；检查完成后，可以在 `.env` 中显式设置 `RESEARCH_RUNTIME_DIR`，`npm start` 会自动加载该配置。

无人值守运行可以使用 `npm run ops:monitor -- once` 做一次有界的 API/Mastra 健康检查，也可以使用 `npm run ops:monitor -- watch 3600` 运行一小时监控；结构化事件会追加到 `runtime/ops/health-events.jsonl`。显式配置 `RESEARCH_ALERT_WEBHOOK_URL` 后，状态转移和失败事件可以发送到告警接收端。`npm run ops:recovery-drill -- <backup-id>` 会校验备份哈希，在临时目录安全列出并解压归档，拒绝链接和路径穿越，检查必要目录后删除演练目录，不接触在线数据。

开发命令：

```powershell
npm run dev
npm run typecheck
npm test
```

## 模型设置

Luna、Terra、Sol 三档完全独立，每档分别拥有 model、URL、key 和 reasoning effort。设置读取接口只返回 `key_configured`，不会返回 key。运行时代码只读取项目 `.env` 和 `runtime/model-settings.json`，不会读取 Codex 配置或认证文件。

项目 `.env` 当前将三档默认 URL 都设为本地 OpenAI-compatible 端点 `http://10.31.107.77:3000/v1`。运行时设置仍可完全独立地覆盖每一档。

- Luna（`gpt-5.6-luna`）：`RESEARCH_MODEL_SIMPLE`、`RESEARCH_MODEL_URL_SIMPLE`、`RESEARCH_MODEL_KEY_SIMPLE`、`RESEARCH_REASONING_SIMPLE`
- Terra（`gpt-5.6-terra`）：`RESEARCH_MODEL_MEDIUM`、`RESEARCH_MODEL_URL_MEDIUM`、`RESEARCH_MODEL_KEY_MEDIUM`、`RESEARCH_REASONING_MEDIUM`
- Sol（`gpt-5.6-sol`）：`RESEARCH_MODEL_COMPLEX`、`RESEARCH_MODEL_URL_COMPLEX`、`RESEARCH_MODEL_KEY_COMPLEX`、`RESEARCH_REASONING_COMPLEX`
- 共享请求时限：`MODEL_REQUEST_TIMEOUT_SECONDS`

系统接受 HTTPS 端点；HTTP 只允许回环地址和 RFC1918 私有地址，包括本地 OpenAI-compatible 服务。

## Claim 与证据复核

PDF 页码原文在人工创建并决定 Claim Review 前都只是证据候选。“文献”页和 `/api/projects/<project-id>/claim-reviews` 接口会强制当前项目 evidence ID、一次性终态决策、证据状态标记和审计记录。接受复核只表示人工检查过 quote，不会把元数据升级为全文证据，也不会证明科学结论。

## 验证证据

当前 Web UI 已经重写为 React + TypeScript 组件应用，不再使用原生 DOM/HTML 实现，并已在真实浏览器中检查。桌面和移动端的新 Idea 输入、项目概览、文献/材料检索、产物图库、模型设置、项目对话和 Mastra 入口均已覆盖；移动端没有横向溢出，控制台没有错误。模型设置截图显示三档配置、正确的 `/v1` 地址、推理强度和 key 状态；不会显示任何 key 内容。

![Research OS 总览](docs/assets/research-os-overview.jpg)

![独立模型设置](docs/assets/research-os-model-settings.jpg)

![Mastra 工作流图](docs/assets/research-os-mastra-workflow.jpg)

## 项目语义记忆

Supermemory 默认通过本机自托管的 Supermemory Local 服务 `http://127.0.0.1:6767` 运行。Supermemory Local 将加密数据库保存在本机，并提供 Memory API、hybrid 语义检索、Graph 上下文和文档摄取，不依赖 Supermemory 云端服务。安装官方自托管二进制后，`npm run supermemory:start` 会用 `.env` 中配置的模型端点和 key 以后台隐藏方式启动它，日志写入 `runtime/` 并等待健康端点；`npm run supermemory:stop` 停止该记录的进程。本机回环请求可以使用 Supermemory Local 的自动认证；如果使用非回环地址，则必须配置显式 `SUPERMEMORY_API_KEY`。每次操作都使用不可变的项目 container tag 做隔离。API 已提供状态、摄取、项目范围 hybrid 检索、Graph Memory 上下文、关联记录查询，以及经过审批的 forget/delete 操作。PDF、图片和上传材料摄取仅允许已经校验的项目 Artifact 或经过 Defender 扫描的上传文件；PDF/文本会执行有界分块，每个 chunk 保留上传文件 ID、SHA-256、页码或文本定位和证据状态，原始文件仍由本地 Artifact 保存。

Embedding 通过 `.env` 中的 `SUPERMEMORY_EMBEDDING_PROVIDER`、`SUPERMEMORY_EMBEDDING_MODEL`、`SUPERMEMORY_EMBEDDING_DIMENSIONS`、`SUPERMEMORY_EMBEDDING_BASE_URL` 和项目保留的 `SUPERMEMORY_EMBEDDING_API_KEY` 配置。当前捆绑的 Supermemory Local `0.0.7-rc.2` 二进制只实现本地 ONNX worker（`Xenova/bge-base-en-v1.5`，768 维，仅英语）。2026-08-01 已实测复核：把远程 embedding 环境变量作为进程环境传给隔离的 `0.0.7-rc.2` 实例，启动仍加载本地 ONNX worker（本地 stub 端点收到 0 请求），而配置的 OpenAI-compatible embedding API 本身可正常返回 1024 维向量。当已安装 build 不支持远程 provider（`openai`/`gemini`）却请求远程 embedding 时，系统直接返回 `supermemory_embedding_unsupported`，不会静默改用本地向量。切换模型或维度必须使用全新的 Supermemory 数据目录或完整重索引。

语义结果只能作为候选，并保留来源、Artifact、页码/定位、哈希和证据状态元数据。项目材料接口 `/api/projects/<project-id>/materials/search` 使用同一项目范围的 Supermemory hybrid 检索；本地服务不可用时不会用 SQL 词法结果、其他 provider 或无关实验代替。缺少本地服务、鉴权失败、返回数据无效或写入失败时，系统直接返回结构化错误，不会降级。

真实 Supermemory Local 验收（`npm run supermemory:acceptance`，证据位于 `artifacts/acceptance/supermemory-local-*.json`）已验证文本摄取与可搜索 chunk、双项目隔离无跨项目泄漏、Graph Memory 节点、Super RAG 文档结果、依赖 LLM 的 `forget` 撤销（撤销后远端 memory 实体消失），以及通过远端消失验证的 delete 撤销。在两项外部阻塞解除前，验收会如实记录为 `partial` 而不是通过：PDF 终态处理需要 Gemini/Vertex key（PDF 提取会从 Mistral OCR 回退到 Gemini，缺 key 时卡在 `extracting`）；图片摄取同样需要 Gemini/Vertex key，当前捆绑的 `0.0.7-rc.2` Windows build 在无该 key 时处理图片会崩溃。2026-08-01 隔离实测确认：配置可用的 OpenAI-compatible LLM 端点不会改变 PDF 提取路径，提取器仍硬编码 Mistral OCR → Gemini 2.5 Flash。图片同理——即使后端是多模态 OpenAI-compatible 模型（`gpt-5.6` 实测可接受图片输入），二进制里的图片描述步骤仍硬编码 Gemini provider。这些阻塞记录在 `TODO.md` 中，不会降级为本地 fallback。

## 实验隔离

模型不能提供命令、可执行程序、路径、URL、环境变量或网络目标。批准后的 Run 只能选择固定实验类型和项目内入口。Windows 是默认后端，通过固定 `cmd.exe` 参数契约调用项目解释器；WSL2 是必须显式选择的可选后端。

每个科研 Python 项目使用自己的 `.venv`，依赖不会安装到应用运行时。监督器强制固定项目根、超时、进程树取消、有界日志、有限数值 `metrics.json`、结构化 `checkpoint.json`、SHA-256 产物和审计事件。本机进程隔离弱于专用虚拟机，文档不会夸大这一边界。

## 仓库验证与获取

“文献”页可以为论文添加 GitHub 或 GitLab HTTPS 代码仓库候选。验证会记录提供方元数据和引用文件，要求 DOI 或精确标题匹配，检查已知 SPDX 许可证，并固定 40 位 commit。下载不会自动执行，而是创建 `dependency_install` Proposal；批准时还会重新验证当前快照。

批准后的归档会执行大小、条目数、解压大小、路径穿越和链接文件检查，保存为带 SHA-256 的 Artifact，解压到 `projects/<project-id>/code/repositories/`，写入 Artifact 依赖谱系，并提交到项目 Git 工作区。这些记录证明可复现的源码获取过程，但不能单独证明仓库一定是官方实现，也不能证明代码具有科学有效性。

## 依赖谱系与检查点恢复

成功实验会把 Idea 版本、项目 Git commit、配置指纹、引用的论文/证据/仓库/上传材料、生成的 Artifact 和 Checkpoint 登记到语义依赖账本。项目查看时会重新核对上游指纹；批准后的 Idea 或代码修改、上游记录变化、来源缺失或 Artifact 失效会递归使相关实验、Artifact 和 Checkpoint 失效。

检查点恢复绝不是直接重跑。API 会校验 Checkpoint、来源运行状态、当前 Idea 版本、Git 基线、Artifact 路径、链接文件状态、文件存在性和 SHA-256，然后创建 `experiment_rerun` Proposal。只有批准后才会按原请求入队；依赖失败或已失效时直接返回结构化错误，不能显示为成功运行。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run idea-cases:check
npm run docs:check
npm run ops:status
npm run mastra:hitl:check
npm run acceptance
```

代码级检查和真实模型验收已经使用当前配置的模型与外部学术 API；模型端点或 key 无效时仍会直接返回结构化错误。针对重建后的默认数据库（16 个项目）的运行检查已经通过；损坏目录单独保留，不会被自动使用。

## 限制

这是本地 MVP，不是生产级安全边界，也不是科学结论生成器。元数据候选不是全文证据；页码 quote 仍需 claim 级人工复核；实验产物只说明实验测量结果，不能自动证明研究假设。本机进程控制不等于虚拟机隔离。真实 GPU 主机验证、语义 claim 映射和干净机器安装验收仍是未完成工作。仓库获取仅限于上面描述的已验证、审批门禁归档流程。
