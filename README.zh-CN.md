<!-- DOCS_SYNC_VERSION: 2026-08-01-19 -->

# Research OS

[English](README.md)

Research OS 是一个本地、可审计的科研自动化 MVP。应用业务代码使用 TypeScript，并以 Mastra 实现 Agent 和 Workflow。科研实验工作区允许使用任意语言；科研 Python 项目使用自己独立的 `.venv`。

## 当前状态

完整应用栈现已迁移到 WSL2（Ubuntu 22.04）内运行：TypeScript API、嵌入式 PostgreSQL 兼容状态库、Mastra 集成、持久工作流队列、React Web UI、审批门禁、Linux 原生实验监督器、产物账本、Windows Defender 上传门禁（通过 WSL interop）和 Supermemory Local。Node.js 26.5.1 由 WSL2 内的 nvm 管理，全部测试、构建和真实验收都在 WSL2 内通过；Windows 侧浏览器通过 mirrored 网络以 `http://127.0.0.1:<port>` 访问服务。默认 `runtime/research-os.pglite` 正在使用（16 个项目）；`.env` 保持 `RESEARCH_RUNTIME_DIR=runtime`。此前损坏的目录单独保留用于检查，不会被自动使用。GPU 主机验证仍是独立的后续工作。**原生 Windows 宿主不再受支持**：完整应用栈在 WSL2 内运行，Windows 只作为浏览器客户端。

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

- Windows 10/11 x64 + WSL2（Ubuntu 22.04），并在 `.wslconfig` 启用 `networkingMode=mirrored`
- WSL2 内的 nvm，以及仓库默认的 Node.js `26.5.1`（`package.json` 仍兼容 Node.js `>=22.13`）
- WSL2 内的 Git
- Python 3（含 `python3-venv`），用于科研 Python 实验
- Windows 主机上的 Windows Defender（WSL2 通过 interop 挂载调用）用于上传扫描
- WSL2 内提供 `latexmk` 的 TeX 发行版，用于论文编译

## 快速启动

```bash
nvm install 26.5.1
nvm use 26.5.1
npm ci
npm run build
npm start
```

仓库通过 `.nvmrc` 固定开发用 Node.js 版本。请用 `nvm current` 和 `node --version` 确认当前版本；不要再使用独立的便携 Node.js 目录。新开的非登录 WSL shell 仍可能回退到 Ubuntu 系统自带的 Node 12.x，请在执行任何命令前先运行 `source ~/.nvm/nvm.sh` 或 `nvm use 26.5.1`。仓库**只有一份**：`D:\ResearchOS` 就是 WSL2 里的 `/mnt/d/ResearchOS`（同一份文件，无需同步），所有服务都从 `/mnt/d/ResearchOS` 启动。注意 `/mnt/d`（drvfs）没有 inotify 支持，Windows 侧编辑代码后 `tsx watch` 不会自动重启，请手动重启受影响的服务。原生 Windows 宿主不再受支持，不存在 Windows 安装器；旧的 ext4 运行副本 `~/ResearchOS` 仅作备份。

默认运行数据库可从 Windows 浏览器访问 [http://127.0.0.1:8080](http://127.0.0.1:8080)（服务在 WSL2 内仅监听回环地址）。Mastra Studio 和工作流图位于 [http://127.0.0.1:4111](http://127.0.0.1:4111)，也可以从网页左下角进入。启动命令会自动加载 `.env`；`RESEARCH_RUNTIME_DIR` 是显式且可审计的运行目录选择，损坏目录单独保留。

损坏的数据库目录单独保留，不会被自动使用。仍然可以使用 `npm run db:restore-dump -- artifacts/backups/20260730T200648Z/postgres.sql runtime/restore-pglite-20260731` 生成并检查新的非覆盖式恢复候选；检查完成后，可以在 `.env` 中显式设置 `RESEARCH_RUNTIME_DIR`，`npm start` 会自动加载该配置。

无人值守运行可以使用 `npm run ops:monitor -- once` 做一次有界的 API/Mastra 健康检查，也可以使用 `npm run ops:monitor -- watch 3600` 运行一小时监控；结构化事件会追加到 `runtime/ops/health-events.jsonl`。显式配置 `RESEARCH_ALERT_WEBHOOK_URL` 后，状态转移和失败事件可以发送到告警接收端。`npm run ops:recovery-drill -- <backup-id>` 会校验备份哈希，在临时目录安全列出并解压归档，拒绝链接和路径穿越，检查必要目录后删除演练目录，不接触在线数据。

开发命令：

```bash
npm run dev
npm run typecheck
npm test
```

## 模型设置

Luna、Terra、Sol 三档完全独立，每档分别拥有 model、URL、key 和 reasoning effort。设置读取接口只返回 `key_configured`，不会返回 key。运行时代码只读取项目 `.env` 和 `runtime/model-settings.json`，不会读取 Codex 配置或认证文件。

项目 `.env` 当前将三档默认 URL 都设为本地 OpenAI-compatible 端点 `http://127.0.0.1:3000/v1`（模型网关运行在 Windows 主机，WSL2 通过 mirrored 回环访问）。运行时设置仍可完全独立地覆盖每一档。

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

Embedding 通过 `.env` 中的 `SUPERMEMORY_EMBEDDING_PROVIDER`、`SUPERMEMORY_EMBEDDING_MODEL`、`SUPERMEMORY_EMBEDDING_DIMENSIONS`、`SUPERMEMORY_EMBEDDING_BASE_URL` 和项目保留的 `SUPERMEMORY_EMBEDDING_API_KEY` 配置。默认 provider 是 `local`，使用多语言 ONNX 模型 `Xenova/bge-m3`（1024 维）。远程 embedding（OpenAI / OpenAI-compatible / Gemini）只在官方 `server-v0.0.5` build 中实现；`server-v0.0.6` 与 `0.0.7-rc.2` 已回退到其内置的本地 ONNX worker（`Xenova/bge-base-en-v1.5`，768 维，仅英语；2026-08-01 已对 v0.0.6 与 rc.2 两个二进制隔离启动+摄入复核）。WSL2 运行副本固定使用 `server-v0.0.5` linux-x64 二进制：配置 `SUPERMEMORY_EMBEDDING_PROVIDER=openai` 时运行 `Qwen3-Embedding-8B`（1024 维，`https://ai.gitee.com/v1`），默认 `local` 时运行 `Xenova/bge-m3`（1024 维，多语言）；`scripts/start-supermemory.ts` 在配置远程 provider 时会拒绝启动非 v0.0.5 二进制，API 守卫也会以 `supermemory_embedding_unsupported` 失败关闭，绝不静默使用本地向量。2026-08-01 实测：配置可用 `SUPERMEMORY_EMBEDDING_API_KEY` 后，摄入会真实发起 `POST /v1/embeddings` 并成功 upsert 向量（1024 维）。用户要求的 2000 维仍被一个上游硬限制挡住（详见 TODO 053-C）：服务端 pgvector HNSW 在向量 upsert 阶段有约 1024 维上限（隔离实测 1024 维端到端可用；1536 维与 2000 维均报 `Failed to upsert chunk embeddings`，API 已正确返回对应维度向量，失败发生在索引写入），因此 1024 维是已验证可用配置，二进制补丁无法解决该限制；另一个 800ms 搜索超时限制（v0.0.5 二进制中 query embedding 超时硬编码 `interactive:800ms`，`/v4/search` 写死 interactive profile，schema 不接受 profile，官方配置无超时项，常规配置无法绕过，而 `ai.gitee.com` 实测 0.65-1.1s）已由补丁解除。**经用户批准，2026-08-01 已部署字节级补丁**：该常量在二进制偏移约 220680316 处以明文 JS 存在，将 `sdk:800` 等长替换为 `sdk:20000` 后二进制可正常启动；3s 延迟 embedding 端点搜索实测成功（timing 3026ms、score 1），生产环境对 `ai.gitee.com` 实测成功（timing 4398ms、score 0.79）。补丁不改变 `--version`（仍报 0.0.5），不解决 2000 维 HNSW 上限。原版二进制备份：`/home/karbo/bin/supermemory-server-linux-x64.v0.0.5-orig.bak`（sha256 `b2fccca3ff2b5607ce41028c759f375c4ecf5461adc9f3306f41c2757edaf375`）；在用补丁版 sha256 `7d19ddadf484a0539dd813227c2e24ad0e191b8e5db291c2caf2c1ef63a2e7d6`。为什么打补丁：Supermemory 服务端源码为闭源（公开 monorepo 不含 server），v0.0.5 之后没有任何官方 build 实现远程 embedding，API 无超时覆盖项，而摄入与 `/v3/search` 链路实测完整可用——要让语义搜索在延迟 >800ms 的端点（如 `ai.gitee.com` 0.65-1.1s）上工作，唯一现实路径就是补丁二进制。切换模型或维度必须使用全新的 Supermemory 数据目录或完整重索引。

Embedding 配置是**项目级且完全隔离**的。没有覆盖的项目使用全局 `.env` 默认值（共享实例 `127.0.0.1:6767`）。项目级覆盖（网页左下角设置 → Embedding）由**配置池**提供服务：provider/model/dimensions/base_url/key 完全相同的项目共享同一个 Supermemory 实例（端口从 6770–6869 分配）和同一个加密数据目录 `runtime/supermemory/pools/<pool-key>/data`，项目隔离仍由不可变的 Supermemory container tag 保证；配置不同则进入不同池，因此不同项目仍可使用不同 provider、模型和维度，向量空间互不污染。覆盖配置保存在 `runtime/project-embedding-settings.json`（0600 权限、原子写入），池注册表在 `runtime/embedding-pools.json`；API 永不返回 key，只返回 `key_configured`。池实例在第一次记忆请求时懒启动，且不会继承过期的 WSL 代理环境变量（需要代理时显式配置 `SUPERMEMORY_PROXY_URL`）。切换模型或维度必须使用全新数据目录：API 会以 `embedding_requires_reset`（409）拒绝，直到确认 `reset_data: true`，随后旧数据目录保留为 `.bak-<时间戳>` 备份，该项目的语义记忆需要重新摄入。2026-08-01 基准（同 query 同语料、隔离实例）：本地 `Xenova/bge-m3` 1024 维单条嵌入 30–72ms、完整检索 58–159ms；远程 `Qwen3-Embedding-8B`（gitee）单条嵌入约 120–210ms、完整检索 286–653ms——**全局默认保持本地 bge-m3**。同日经公开 API 的端到端验证：两个本地同配置项目共享池端口 6770（`shared_projects: 2`），远程配置项目使用独立池端口 6771；两个池的摄入→搜索往返均成功，且在同一池内一个项目摄入的记忆不会被另一个项目检索到。

语义结果只能作为候选，并保留来源、Artifact、页码/定位、哈希和证据状态元数据。项目材料接口 `/api/projects/<project-id>/materials/search` 使用同一项目范围的 Supermemory hybrid 检索；本地服务不可用时不会用 SQL 词法结果、其他 provider 或无关实验代替。缺少本地服务、鉴权失败、返回数据无效或写入失败时，系统直接返回结构化错误，不会降级。

真实 Supermemory Local 验收（`npm run supermemory:acceptance`，证据位于 `artifacts/acceptance/supermemory-local-*.json`）已验证文本摄取与可搜索 chunk、双项目隔离无跨项目泄漏、Graph Memory 节点、Super RAG 文档结果、依赖 LLM 的 `forget` 撤销（撤销后远端 memory 实体消失），以及通过远端消失验证的 delete 撤销。在两项外部阻塞解除前，验收会如实记录为 `partial` 而不是通过：PDF 终态处理需要 Gemini/Vertex key（PDF 提取会从 Mistral OCR 回退到 Gemini，缺 key 时卡在 `extracting`）；图片摄取同样需要 Gemini/Vertex key，`0.0.7-rc.2` 各平台 build（Windows 与 Linux）在无该 key 时处理图片都会崩溃。2026-08-01 隔离实测确认：配置可用的 OpenAI-compatible LLM 端点不会改变 PDF 提取路径，提取器仍硬编码 Mistral OCR → Gemini 2.5 Flash。图片同理——即使后端是多模态 OpenAI-compatible 模型（`gpt-5.6` 实测可接受图片输入），二进制里的图片描述步骤仍硬编码 Gemini provider。这些阻塞记录在 `TODO.md` 中，不会降级为本地 fallback。

## 实验隔离

模型不能提供命令、可执行程序、路径、URL、环境变量或网络目标。批准后的 Run 只能选择固定实验类型和项目内入口，并固定使用 Linux 后端执行（`python3 -m venv` + `.venv/bin/python`）。旧的 `windows`（`cmd.exe`）与 `wsl2` 启动器已随原生 Windows 支持一并移除。

每个科研 Python 项目使用自己的 `.venv`，依赖不会安装到应用运行时。监督器强制固定项目根、超时、进程树取消、有界日志、有限数值 `metrics.json`、结构化 `checkpoint.json`、SHA-256 产物和审计事件。本机进程隔离弱于专用虚拟机，文档不会夸大这一边界。

## 仓库验证与获取

“文献”页可以为论文添加 GitHub 或 GitLab HTTPS 代码仓库候选。验证会记录提供方元数据和引用文件，要求 DOI 或精确标题匹配，检查已知 SPDX 许可证，并固定 40 位 commit。下载不会自动执行，而是创建 `dependency_install` Proposal；批准时还会重新验证当前快照。

批准后的归档会执行大小、条目数、解压大小、路径穿越和链接文件检查，保存为带 SHA-256 的 Artifact，解压到 `projects/<project-id>/code/repositories/`，写入 Artifact 依赖谱系，并提交到项目 Git 工作区。这些记录证明可复现的源码获取过程，但不能单独证明仓库一定是官方实现，也不能证明代码具有科学有效性。

## 依赖谱系与检查点恢复

成功实验会把 Idea 版本、项目 Git commit、配置指纹、引用的论文/证据/仓库/上传材料、生成的 Artifact 和 Checkpoint 登记到语义依赖账本。项目查看时会重新核对上游指纹；批准后的 Idea 或代码修改、上游记录变化、来源缺失或 Artifact 失效会递归使相关实验、Artifact 和 Checkpoint 失效。

检查点恢复绝不是直接重跑。API 会校验 Checkpoint、来源运行状态、当前 Idea 版本、Git 基线、Artifact 路径、链接文件状态、文件存在性和 SHA-256，然后创建 `experiment_rerun` Proposal。只有批准后才会按原请求入队；依赖失败或已失效时直接返回结构化错误，不能显示为成功运行。

## 验证

```bash
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

这是本地 MVP，不是生产级安全边界，也不是科学结论生成器。元数据候选不是全文证据；页码 quote 仍需 claim 级人工复核；实验产物只说明实验测量结果，不能自动证明研究假设。本机进程控制不等于虚拟机隔离。真实 GPU 主机验证和语义 claim 映射仍是未完成工作。仓库获取仅限于上面描述的已验证、审批门禁归档流程。
