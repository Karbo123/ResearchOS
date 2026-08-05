<!-- DOCS_SYNC_VERSION: 2026-08-05-03 -->

# Research OS

[English](README.md)

Research OS 是一个本地、可审计的科研自动化 MVP。应用业务代码使用 TypeScript，并以 Mastra 实现 Agent 和 Workflow。科研实验工作区允许使用任意语言；科研 Python 项目使用自己独立的 `.venv`。

## 当前状态

完整应用栈现已迁移到 WSL2（Ubuntu 22.04）内运行：TypeScript API、嵌入式 PostgreSQL 兼容状态库、Mastra 集成、持久工作流队列、React Web UI、审批门禁、Linux 原生实验监督器、产物账本、Windows Defender 上传门禁（通过 WSL interop）和 Supermemory Local。Node.js 26.5.1 由 WSL2 内的 nvm 管理；核心测试、TypeScript 构建和适用的本地验收已在 WSL2 内通过，依赖外部服务或被外部条件阻塞的验收仍按 `TODO.md` 如实记录。开发在 WSL2 shell 内进行（默认开发 shell 就是 WSL2，不使用 Windows cmd/PowerShell）；Windows Chrome 是调试浏览器，通过 mirrored 网络/端口转发以 `http://127.0.0.1:<port>` 访问服务。默认 `runtime/research-os.pglite` 正在使用（16 个项目）；`.env` 保持 `RESEARCH_RUNTIME_DIR=runtime`。此前损坏的目录单独保留用于检查，不会被自动使用。GPU 主机验证仍是独立的后续工作。**原生 Windows 宿主不再受支持**：完整应用栈在 WSL2 内运行，Windows 只作为浏览器客户端。

模型失败会直接返回结构化错误。系统不会改用本地回复、其他提供方或无关实验。

## 架构

- `apps/server`：Hono API、PGlite 状态、队列、证据、审批、报告、仓库验证/获取、产物账本和本机实验监控器。
- `apps/mastra`：Mastra Agents、Memory、Skills、受限 Tools、Workflows、定时任务和 Studio 工作流图。
- `apps/web`：React 19 + TypeScript 组件源码，以及由 esbuild 生成、API 直接托管的静态资源。
- `projects/<project-id>`：独立 Git 工作区。科研 Python 使用 `projects/<project-id>/.venv`；每个项目新产生的文件也都放在这个目录下面，包括 `projects/<project-id>/artifacts/`。
- `artifacts`：只保存共享的运维材料：备份、验收证据、测试/运维夹具和等待迁移或保留兼容的历史文件。新的项目上传文件、PDF、实验输出和复现归档不会写入这个根目录。
- `runtime`：被 Git 忽略的应用状态、模型覆盖、Mastra Memory、日志和 PID 数据。

PGlite 是持久业务状态源。Mastra Memory 不能替代项目、审批、产物或审计状态。

## 科研工作区导航

首页是“全部项目”控制台，每个项目打开后是一个可持续停留的科研工作台，页面使用两条横向导航栏。第一栏永远只有四个按科研顺序固定的一级入口：`项目概述`、`相关工作调研`、`实验实现`、`学术论文撰写`。第二栏始终列出该一级入口的科研任务，不再出现第三级内部工具标签。

项目概述固定为 `项目总览`、`Idea 讨论`、`待审批与决策`、`定期汇报与反馈`；相关工作调研固定为 `文献列表`、`研究可视化`、`种子文献扩展`；实验实现只保留 `本方法实现`、`相关工作实现` 两个二级标签，实验计划、运行队列、指标、产物可视化和谱系都属于所选实现工作区，不再拆成第三级标签；学术论文撰写固定为 `引言`、`相关工作`、`方法介绍`、`实验`、`结论` 五个章节，引用、BibTeX、图表、实验数据选择、LaTeX 编译和 PDF 审阅是章节工作区内的能力，不得作为顶层标签。

导航分组不能绕过工作流门禁：论文不能消费未复核证据或未验证实验结果，实验不能消费未经审批的方法变更。每个页面都绑定当前项目，深链接能恢复项目/区域/页面，结构化显示失败和审批状态，绝不会把外部或模型失败改成 fallback 结果。旧 hash 和旧深链接只作为兼容入口，统一映射到上述新合同中的唯一页面，不能恢复已删除的长导航结构：`method/*` 重定向到实验实现对应标签，旧论文页下的实验 hash 重定向到 `实验实现`，旧论文页下的日报/周报/反馈 hash 重定向到 `项目概述`。相关工作引擎也遵守同一边界：用户的 `D:\auto-related-work` 只作为算法、字段语义、边界案例和测试意图的只读参考，应用行为全部重写为 TypeScript，不导入或执行旧 Python 运行时。

项目工作区使用可读的无井号地址，例如 `/project/cnn-minimal-2q95/overview/overview`。语义 slug（例如 `native-acceptance-a8b9`）现在是项目在数据库、项目目录、workflow、Supermemory container tag 和项目设置中的不可变唯一标识；新代码禁止再为项目生成 UUID。创建项目时，缩写使用两个语义英文小写单词加四位小写字母/数字随机后缀，服务器检查完整标识是否唯一。用户手动填写时也必须遵守 `word-word-xxxx` 格式。历史三词地址、UUID 地址和旧 hash 地址只作为兼容别名保留可访问，不会把数据库中的历史 slug 强行改名。

### 学术论文工作区

论文章节存放在 `projects/<project-id>/paper/`，并在项目内独立 Git 仓库中保存版本。默认生成的草稿使用自包含的 CVPR 风格模板（`paper/cvpr.sty` 加双栏 article 前导），通过 Linux `latexmk` 编译。批准任意 `patch_kind=latex` 的论文 `code_patch` Proposal 后，系统会自动排队一次 `compile_latex` 运行；论文工作区会轮询排队/运行中的编译状态，并展示真实 PDF Artifact 或结构化编译错误。中文逐句翻译仅供界面理解，原子写回 `paper/translations.json` 并记录审计事件，绝不写入最终 PDF。缺少项目内 `.git` 的旧项目会在首次访问论文工作区时自动迁移，并补写项目级 `.gitignore`。

## 项目文件存储边界

项目自己的文件按项目目录隔离：上传材料、证据 PDF、实验运行目录、复现归档、论文输出和受控 Artifact 都解析到 `projects/<project-id>/artifacts/` 或该项目工作区下的其他明确子目录。PGlite 只保存共享索引、ID、哈希、状态、权限和审计记录，不会把项目文件变成全局文件。删除项目时，会同时删除数据库记录、语义记忆、项目配置以及完整的 `projects/<project-id>/` 目录。

根目录 `artifacts/` 不是第二个仍在使用的项目文件仓库。`artifacts/backups/`、`artifacts/acceptance/`、`artifacts/acceptance-supermemory/`、`artifacts/ops/`、`artifacts/idea-tests/` 和 `artifacts/test-materials/` 保存全局运维、验收或测试材料。按 UUID 命名的目录和旧项目路径可能作为历史迁移来源继续存在；服务启动时会把有数据库索引的项目文件复制到所属项目目录，读取侧暂时保留只读兼容回退，直到迁移或明确清理。新的应用写入不会再指向这些旧路径。

## 界面语言与主题

语言与主题控件位于左下角设置面板，右上角不再重复放置。语言支持简体中文（默认）、繁体中文、英语和西班牙语，选择保存在本地并在刷新后保持；界面文案全部走 i18n key 与统一术语表，聊天回复、报告/论文正文和实验日志等模型或数据动态内容保持原文，不自动翻译。主题提供浅色（默认）和暗色两档，使用 Apple System Colors 与语义 CSS 变量实现毛玻璃、分层阴影和弹簧动效；两档主题与四种语言的最终真实浏览器截图验收仍在 `P0-UI-THEME-080` 与 `P0-UI-I18N-079` 中跟踪。

报告是带谱系的记录，不是打开历史页面时对当前数据库状态的无条件快照。新生成的日报/周报只读取其时间窗口内真实发生的对话消息、审计事件、任务、实验、Proposal、provider attempt 和用户反馈，并保存时间窗口、data cutoff、事件/来源 ID、项目 ID，以及生成内容时使用的 Paper、Evidence、Experiment、有效 Artifact 和 Proposal ID。窗口内没有事件时接口返回结构化 `report_no_events`，页面保持 `empty`，不会生成“今天完成了”之类的模板报告。读取项目时会重新校验声明的来源 ID 和项目归属；没有快照的旧报告标记为 `legacy_unverified`，项目范围不一致、跨项目来源、来源被删除或 Artifact 已失效的报告标记为 `blocked`，并且不渲染正文。这样可以防止历史报告把已经删除或失效的实验数据继续显示成当前证据。`apps/server/tests/report-lineage.test.ts` 和 `apps/server/tests/reports-api.test.ts` 覆盖谱系、无事件窗口、真实事件来源、无效 Artifact 和跨项目来源。

## 环境要求

- Windows 10/11 x64 + WSL2（Ubuntu 22.04），并在 `.wslconfig` 启用 `networkingMode=mirrored`
- WSL2 shell 作为默认开发 shell（不使用 Windows cmd/PowerShell 做开发）
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

所有开发命令都在 WSL2 shell 中执行，工作目录是 `/mnt/d/ResearchOS`（它与 Windows 的 `D:\ResearchOS` 是同一份文件，无需同步）；不要用 Windows cmd/PowerShell 做开发。仓库通过 `.nvmrc` 固定开发用 Node.js 版本。请用 `nvm current` 和 `node --version` 确认当前版本；不要再使用独立的便携 Node.js 目录。新开的非登录 WSL shell 仍可能回退到 Ubuntu 系统自带的 Node 12.x，请在执行任何命令前先运行 `source ~/.nvm/nvm.sh` 或 `nvm use 26.5.1`。注意 `/mnt/d`（drvfs）没有 inotify 支持，即使在 WSL2 内编辑代码，`tsx watch` 也不会自动重启，请手动重启受影响的服务。原生 Windows 宿主不再受支持，不存在 Windows 安装器；旧的 ext4 运行副本 `~/ResearchOS` 仅作备份。

默认运行数据库可从 Windows 浏览器访问 [http://127.0.0.1:8080](http://127.0.0.1:8080)（服务在 WSL2 内仅监听回环地址）。Mastra Studio 和工作流图位于 [http://127.0.0.1:4111](http://127.0.0.1:4111)，也可以从网页左下角进入。启动命令会自动加载 `.env`；`RESEARCH_RUNTIME_DIR` 是显式且可审计的运行目录选择，损坏目录单独保留。

损坏的数据库目录单独保留，不会被自动使用。仍然可以使用 `npm run db:restore-dump -- artifacts/backups/20260730T200648Z/postgres.sql runtime/restore-pglite-20260731` 生成并检查新的非覆盖式恢复候选；检查完成后，可以在 `.env` 中显式设置 `RESEARCH_RUNTIME_DIR`，`npm start` 会自动加载该配置。

无人值守运行可以使用 `npm run ops:monitor -- once` 做一次有界的 API/Mastra 健康检查，也可以使用 `npm run ops:monitor -- watch 3600` 运行一小时监控；结构化事件会追加到 `runtime/ops/health-events.jsonl`。显式配置 `RESEARCH_ALERT_WEBHOOK_URL` 后，状态转移和失败事件可以发送到告警接收端。`npm run ops:recovery-drill -- <backup-id>` 会校验备份哈希，在临时目录安全列出并解压归档，拒绝链接和路径穿越，检查必要目录后删除演练目录，不接触在线数据。

开发命令：

```bash
npm run dev
npm run typecheck
npm test
```

这些命令都在 WSL2 shell 中运行；UI 调试与验收使用 Windows Chrome，通过端口转发访问 `http://127.0.0.1:8080`（或配置的端口）。

## 模型设置

左下角设置面板有三个一级标签：`通用`（只放外观，即界面语言与浅色/暗色主题，两者是全局设置）、`模型`（所有模型设置，按项目独立保存并随项目切换）、`系统`（全局代理）。语言与主题先进入草稿状态，只有点击“保存配置”才会真正应用；未保存就关闭会保留原值。没有打开项目时，模型页会提示先打开项目，因为代码三档、文档文本、图片识别、图片生成、Embedding 与语音识别全部都是项目级配置。

代码模型内部使用 `simple` / `medium` / `complex` 三档。界面只显示“轻量级模型 / 通用模型 / 最强大的模型”，不绑定任何厂商或系列，因此不同供应商都可以填充这三档。每档分别拥有 model、URL、key 和 reasoning effort。当前 `.env.example` 映射为 `gpt-5.6-luna`、`gpt-5.6-terra`、`gpt-5.6-sol`，但 UI 永远不会显示这些名字。项目级运行时覆盖保存在 `runtime/project-settings.json`（0600 权限、原子写入，删除项目时一并清理）；没有覆盖时回退到项目 `.env` 默认。全局代理仍保存在 `runtime/model-settings.json`。设置读取接口只返回 `key_configured`，不会返回 key。运行时代码只读取项目 `.env`、`runtime/project-settings.json` 和 `runtime/model-settings.json`，不会读取 Codex 配置或认证文件。

项目 `.env` 当前将代码模型默认 URL 都设为本地 OpenAI-compatible Responses API base `http://127.0.0.1:3000/v1`（模型网关运行在 Windows 主机，WSL2 通过 mirrored 回环访问）。Research OS 会自行追加 `/responses`；不要把 `/chat/completions`、`/completions` 或 `/responses` 这样的操作地址填入配置。运行时设置仍可完全独立地覆盖每一档。

- `simple`：`RESEARCH_MODEL_SIMPLE`、`RESEARCH_MODEL_URL_SIMPLE`、`RESEARCH_MODEL_KEY_SIMPLE`、`RESEARCH_REASONING_SIMPLE`
- `medium`：`RESEARCH_MODEL_MEDIUM`、`RESEARCH_MODEL_URL_MEDIUM`、`RESEARCH_MODEL_KEY_MEDIUM`、`RESEARCH_REASONING_MEDIUM`
- `complex`：`RESEARCH_MODEL_COMPLEX`、`RESEARCH_MODEL_URL_COMPLEX`、`RESEARCH_MODEL_KEY_COMPLEX`、`RESEARCH_REASONING_COMPLEX`
- `document`：`RESEARCH_DOCUMENT_MODEL`（默认 `deepseek-v4-flash`）、`RESEARCH_DOCUMENT_MODEL_URL`（默认 `http://127.0.0.1:3000/v1`）、`RESEARCH_DOCUMENT_MODEL_KEY`（留空回退到 `RESEARCH_MODEL_KEY_MEDIUM`）
- `vision`：`RESEARCH_VISION_MODEL`（默认 `mimo-v2.5`）、`RESEARCH_VISION_MODEL_URL`（默认 `http://10.31.107.77:3000/v1`）、`RESEARCH_VISION_MODEL_KEY`（留空回退到 `RESEARCH_MODEL_KEY_MEDIUM`）
- `image_generation`：`RESEARCH_IMAGE_MODEL`（默认 `gpt-image-2-official`）、`RESEARCH_IMAGE_MODEL_URL`（默认 `https://api.apimart.ai/v1`）、`RESEARCH_IMAGE_MODEL_KEY`、`RESEARCH_IMAGE_RESOLUTION`（默认 `1k`）、`RESEARCH_IMAGE_QUALITY`（默认 `low`）
- 共享请求时限：`MODEL_REQUEST_TIMEOUT_SECONDS`

`document` 模型用于生成可读的聊天解释和文档式文本。默认 `deepseek-v4-flash` 在当前固定网关会返回 403（`The latest version of this model is only available hosted in China and requires explicit opt in`）。这是上游模型/网关可用性错误，不是请求格式问题；在设置面板配置可用文档模型前，聊天保持失败关闭。该阻塞已登记为 TODO 的 `[!] DOC-MODEL-107`。

`vision` 模型在聊天或 Idea 讨论包含图片附件时负责理解图片内容；它与其他代码档一样使用 Responses API base URL，且失败关闭，不静默换模型。`image_generation` 通过 `/images/generations` 兼容接口生成图片，界面可选择 1k/2k/4k 与 low/medium/high，默认使用最省钱的 `1:1`、`1k`、`low`、`n=1`。两类密钥都是项目级配置，只写入被忽略的 `runtime/project-settings.json`，读取接口只返回 `key_configured`。

每个已配置模型（代码三档、文档文本、图片识别、图片生成、语音识别）都提供“测试连接”按钮，使用最小请求体验证 URL、key 与模型是否可用；图片生成测试会提交一个最省钱的真实任务，不会下载或展示生成图片。

`系统` 页提供全局代理开关。开启时 URL 输入框与开关同一行显示，并控制 Mastra、Supermemory bridge、语音转写和远程 Embedding 出口；关闭时全部直连。回环与 RFC1918 私有地址始终绕过代理。

系统接受 HTTPS 端点；HTTP 只允许回环地址和 RFC1918 私有地址，包括本地 OpenAI-compatible 服务。

所有生产 Mastra Agent、子 Agent 委派、提示注入检测器和实验计划请求都使用 OpenAI Responses provider。结构化输出统一使用严格的 `text.format.type=json_schema` 业务 schema，不发送旧的 `response_format` 字段，也不发送会触发当前错误的 `json_object`。provider HTTP 错误、超时、鉴权失败、非法响应和 schema 错误都会返回结构化错误；系统不会生成默认助手回复、空成功结果、隐式切换 provider 或无关实验 fallback。当前 Supermemory 二进制的内部模型路径仍可能使用 Chat 兼容协议，因此 `npm run supermemory:start` 会把它指向只监听回环地址的 TypeScript bridge。bridge 只向固定网关发送 `/responses` 请求，加入必要的 JSON 指令，把有效响应转换回二进制需要的格式，并在每个错误处失败关闭。

## 项目科研工作流

每个科研项目在 `projects/<project-id>/workflow.ts` 拥有自己独立的 Mastra workflow，并纳入项目内 Git。新项目从默认模板复制；已有项目通过幂等脚本补齐，不覆盖已定制文件。Mastra 默认每 500ms 扫描一次项目文件（`RESEARCH_WORKFLOW_POLL_INTERVAL_MS` 可调），把变更源码编译到 `runtime/workflow-cache/<project-id>/`，校验 manifest、图结构、导入白名单与 dry-run 后原子替换为新版本，无需重启服务。非法文件保留上一有效版本并返回结构化错误；挂起运行固定使用创建时的旧版本，通过 `runtime/workflow-runs.json` 恢复。

在项目对话中可以直接提出工作流修改需求。工作流编辑 Agent 只生成可审阅 diff，API 先在临时工作区校验，审批通过后写回项目 `workflow.ts` 并提交项目 Git，再由 loader 热加载。项目页会展示当前工作流图、版本、源码哈希与最近运行（数据源为 Mastra `serializedStepGraph`）；Mastra Studio 保留为开发辅助视图。

项目对话、论文翻译/修订和实验规划请求都会先经过项目级 workflow 入口；workflow 分支再通过受限内部 API 端点执行真实的模型与状态写入。项目创建前的 Idea 澄清按设计仍不归属任何项目 workflow。

汇报调度由 API 的确定性调度器逐项目分发（`RESEARCH_REPORT_POLL_SECONDS`、`RESEARCH_REPORT_DAILY_TIME`、`RESEARCH_REPORT_WEEKLY_TIME`、`RESEARCH_REPORT_WEEKDAY`、`RESEARCH_REPORT_TIMEOUT_SECONDS`）。删除项目时会同步清理该项目的 workflow 注册表、编译缓存、运行记录与项目目录。

## Claim 与证据复核

PDF 页码原文在人工创建并决定 Claim Review 前都只是证据候选。“文献”页和 `/api/projects/<project-id>/claim-reviews` 接口会强制当前项目 evidence ID、一次性终态决策、证据状态标记和审计记录。接受复核只表示人工检查过 quote，不会把元数据升级为全文证据，也不会证明科学结论。

## 相关工作调研流水线

相关工作现在是参考用户自己的 `D:\auto-related-work` 后全部重写的 TypeScript 科研流水线，不依赖 Python 运行时。`apps/server/src/related-work/` 已有严格 Zod 契约 `PaperCandidate`、`SourceAttempt`、`SourceFailure`、`CitationEdge`，并完成 Crossref、OpenAlex、Semantic Scholar、DBLP、arXiv、Unpaywall 六个来源适配器及离线 fixture 测试。每次来源尝试都会保留 provider、请求 URL、HTTP 状态、结果数、检索时间，以及超时、限流、取消和无效响应等结构化失败。

当前 TypeScript 确定性内核还覆盖标题/作者规范化、标题匹配、字段完整度、缺失字段报告、有界退避，以及带确定性去重、进度、取消和非悬空引用边的 `depth/width/max_total` 递归收集。项目范围的种子和递归 API 已接入“文献”页：`POST /api/projects/<project-id>/related-work/seeds` 接受 DOI、标题、HTTPS URL、BibTeX、受控 PDF Artifact 或当前项目已有 Paper；`POST /api/projects/<project-id>/related-work/recursive-plan` 只创建待审批 Proposal；批准后会持久化 provider attempt、进度事件、候选、排序原因和引用边。Crossref、OpenAlex、Semantic Scholar 的 references API 已实现；DBLP/arXiv 目前仍是搜索适配器，待补充引用契约。候选审阅和字段 provenance 也已经是项目范围的：provider、用户输入和受控 Artifact 来源彼此区分，provider 补全必须通过 DOI/标题匹配，不匹配结果不会写入候选，字段冲突必须由用户选择，确认 Paper 仍必须人工批准。研究现状页现在只从 `confirmed` Paper、带页码/章节定位的 Evidence 和 accepted ClaimReview 建立矩阵，保存行级 provenance，支持主题/方法/年份筛选以及 JSON/CSV/Markdown 导出；引用图 API 只投影当前项目中明确保存的引用、Paper-Evidence 和 ClaimReview-Evidence 关系。研究空白、聚类和重复风险只能记录为可审计的待核验候选，不能直接当成结论。旧项目只能提供字段设计、规范化、匹配、完整度评分、缓存、排序、递归搜索思路和测试意图；Research OS 的运行模块、API、持久化、worker 和测试必须全部使用 TypeScript，不能导入或执行旧 Python 文件、虚拟环境、Google Scholar 隧道、硬编码代理、密钥、缓存或业务模块。provider 失败必须保留并显示为结构化失败，不能当作成功的空结果。

种子 BibTeX 会按嵌套花括号解析为标题、作者、venue、年份、DOI 和摘要，再写入用户输入 provenance。字段补全采用有界多轮迭代，使用 Python 项目的完整度评分（达到 85% 提前停止），Unpaywall 按 DOI 补全开放获取 PDF，arXiv 按 ID 拉取完整作者列表和摘要，并按匹配姓名增量合并 Crossref/OpenAlex/DBLP 作者机构；arXiv HTML5 作者块还会显式提供机构、邮箱和通讯作者标记，作为可审计的 arXiv 补全策略。Google Scholar 爬虫、Cookie、住宅代理和 CAPTCHA 隧道仍按设计排除。

Provider 响应现在使用项目范围的 PGlite 请求缓存。缓存键包含项目、provider、操作、规范化请求参数和当前 schema 版本；行中保留请求 URL、参数、真实响应、provider 状态、TTL、过期时间和命中次数。只有同一项目、同一请求、schema 兼容且未过期的条目才会回放。命中、未命中、过期、schema 不兼容、缓存响应损坏以及“失败保留已有成功”的写入跳过都会写入审计；失败不能覆盖已有成功，取消请求不进入缓存。默认 TTL 为 `RESEARCH_RELATED_WORK_CACHE_TTL_SECONDS=86400`。

当前引用图已经是可交互的项目范围分层 SVG，而不是装饰性静态图片。候选、Paper、Evidence、ClaimReview 按固定列布局；数据库中明确保存的关系使用箭头和证据状态样式；鼠标点击或键盘选择节点后，会显示类型、状态、stable ID、provider/来源、locator、证据状态和 `project_scoped` 权限。空响应、接口失败和 partial 响应都保持真实状态显示。桌面检查以及 2026-08-02 对真实空图、窄屏横向滚动且页面主体无横向溢出、键盘选中、项目 scope 和切换项目清理旧详情的浏览器检查已通过。截图接口在设备缩放下产生重复拼接伪影，因此不把它计为视觉截图证据；加载/失败/partial fixture、研究现状矩阵的完整窄屏验收以及多种真实关系同时存在的图仍在 `TODO.md` 中，不能提前写成完成。

相关工作还包括复现和比较：已验证的论文仓库只能在固定 commit 的独立 reproduction 工作区和该复现自己的 `.venv` 中运行；随后由 TypeScript 根据真实指标、数据/配置/seed、日志和 Artifact 哈希做程序化比较。Mastra 可以把这些已绑定来源的比较整理成用户可审阅的待核验创新/研究空白候选，但不能根据元数据、单次运行或模型措辞直接宣布创新、优于原文或论文结论。

代码复现页面可以调用 `GET /api/projects/<project-id>/papers/<paper-id>/repositories/discover`。它只从 Paper 已保存的 metadata 或来源 URL 中提取明确的 GitHub/GitLab 链接，绝不会根据标题猜仓库。仓库验证会记录论文/仓库引用文件证据、SPDX 状态、默认分支、固定 40 位 commit，以及入口、依赖、数据获取、系统/GPU 要求和项目受控写入目录的独立 readiness 检查；任一检查未知都继续停留在候选状态。仓库归档不是科研证据，下载、环境创建、执行和结果回写必须分别经过审批；`D:\auto-related-work` 的 Python 运行时、代理隧道、Cookie、密钥和缓存都不会被导入。

## 验证证据

当前 Web UI 已经重写为 React + TypeScript 组件应用，不再使用原生 DOM/HTML 实现，并已在真实浏览器中检查。桌面和移动端的新 Idea 输入、项目概览、文献/材料检索、产物图库、模型设置、项目对话和 Mastra 入口均已覆盖；移动端没有横向溢出，控制台没有错误。模型设置流程使用 `通用 / 模型 / 系统` 三个一级标签和按用途划分的模型区块；浏览器检查已覆盖滑动标签、项目级模型页、代理 URL 显隐，以及只显示 key 状态、绝不显示 key 内容。

![Research OS 总览](docs/assets/research-os-overview.jpg)

![独立模型设置](docs/assets/research-os-model-settings.jpg)

![Mastra 工作流图](docs/assets/research-os-mastra-workflow.jpg)

## 项目语义记忆

Supermemory 默认通过本机自托管的 Supermemory Local 服务 `http://127.0.0.1:6767` 运行。Supermemory Local 将加密数据库保存在本机，并提供 Memory API、hybrid 语义检索、Graph 上下文和文档摄取，不依赖 Supermemory 云端服务。安装官方自托管二进制后，`npm run supermemory:start` 会先启动只监听回环地址的模型 bridge（默认 `127.0.0.1:3010`），再把 bridge 的 base 和 `.env` 中配置的 key 以后台隐藏方式传给 Supermemory；日志写入 `runtime/` 并等待健康端点；`npm run supermemory:stop` 停止记录的 Supermemory 进程和 bridge。当前二进制请保持 `SUPERMEMORY_MODEL_BRIDGE_ENABLED=true`，端口可用 `SUPERMEMORY_MODEL_BRIDGE_PORT` 调整。本机回环请求可以使用 Supermemory Local 的自动认证；如果使用非回环地址，则必须配置显式 `SUPERMEMORY_API_KEY`。每次操作都使用不可变的项目 container tag 做隔离。API 已提供状态、摄取、项目范围 hybrid 检索、Graph Memory 上下文、关联记录查询，以及经过审批的 forget/delete 操作。PDF、图片和上传材料摄取仅允许已经校验的项目 Artifact 或经过 Defender 扫描的上传文件；PDF/文本会执行有界分块，每个 chunk 保留上传文件 ID、SHA-256、页码或文本定位和证据状态，原始文件仍由本地 Artifact 保存。

Embedding 通过 `.env` 中的 `SUPERMEMORY_EMBEDDING_PROVIDER`、`SUPERMEMORY_EMBEDDING_MODEL`、`SUPERMEMORY_EMBEDDING_DIMENSIONS`、`SUPERMEMORY_EMBEDDING_BASE_URL` 和项目保留的 `SUPERMEMORY_EMBEDDING_API_KEY` 配置。默认 provider 是 `local`，使用多语言 ONNX 模型 `Xenova/bge-m3`（1024 维）。远程 embedding（OpenAI / OpenAI-compatible / Gemini）只在官方 `server-v0.0.5` build 中实现；`server-v0.0.6` 与 `0.0.7-rc.2` 已回退到其内置的本地 ONNX worker（`Xenova/bge-base-en-v1.5`，768 维，仅英语；2026-08-01 已对 v0.0.6 与 rc.2 两个二进制隔离启动+摄入复核）。WSL2 运行副本固定使用 `server-v0.0.5` linux-x64 二进制：配置 `SUPERMEMORY_EMBEDDING_PROVIDER=openai` 时运行 `Qwen3-Embedding-8B`（1024 维，`https://ai.gitee.com/v1`），默认 `local` 时运行 `Xenova/bge-m3`（1024 维，多语言）；`scripts/start-supermemory.ts` 在配置远程 provider 时会拒绝启动非 v0.0.5 二进制，API 守卫也会以 `supermemory_embedding_unsupported` 失败关闭，绝不静默使用本地向量。2026-08-01 实测：配置可用 `SUPERMEMORY_EMBEDDING_API_KEY` 后，摄入会真实发起 `POST /v1/embeddings` 并成功 upsert 向量（1024 维）。用户要求的 2000 维仍被一个上游硬限制挡住（详见 TODO 053-C）：服务端 pgvector HNSW 在向量 upsert 阶段有约 1024 维上限（隔离实测 1024 维端到端可用；1536 维与 2000 维均报 `Failed to upsert chunk embeddings`，API 已正确返回对应维度向量，失败发生在索引写入），因此 1024 维是已验证可用配置，二进制补丁无法解决该限制；另一个 800ms 搜索超时限制（v0.0.5 二进制中 query embedding 超时硬编码 `interactive:800ms`，`/v4/search` 写死 interactive profile，schema 不接受 profile，官方配置无超时项，常规配置无法绕过，而 `ai.gitee.com` 实测 0.65-1.1s）已由补丁解除。**经用户批准，2026-08-01 已部署字节级补丁**：该常量在二进制偏移约 220680316 处以明文 JS 存在，将 `sdk:800` 等长替换为 `sdk:20000` 后二进制可正常启动；3s 延迟 embedding 端点搜索实测成功（timing 3026ms、score 1），生产环境对 `ai.gitee.com` 实测成功（timing 4398ms、score 0.79）。补丁不改变 `--version`（仍报 0.0.5），不解决 2000 维 HNSW 上限。原版二进制备份：`/home/karbo/bin/supermemory-server-linux-x64.v0.0.5-orig.bak`（sha256 `b2fccca3ff2b5607ce41028c759f375c4ecf5461adc9f3306f41c2757edaf375`）；在用补丁版 sha256 `7d19ddadf484a0539dd813227c2e24ad0e191b8e5db291c2caf2c1ef63a2e7d6`。为什么打补丁：Supermemory 服务端源码为闭源（公开 monorepo 不含 server），v0.0.5 之后没有任何官方 build 实现远程 embedding，API 无超时覆盖项，而摄入与 `/v3/search` 链路实测完整可用——要让语义搜索在延迟 >800ms 的端点（如 `ai.gitee.com` 0.65-1.1s）上工作，唯一现实路径就是补丁二进制。切换模型或维度必须使用全新的 Supermemory 数据目录或完整重索引。

Embedding 配置是**项目级且完全隔离**的。没有覆盖的项目使用全局 `.env` 默认值（共享实例 `127.0.0.1:6767`）。项目级覆盖（网页左下角设置 → Embedding）由**配置池**提供服务：provider/model/dimensions/base_url/key 完全相同的项目共享同一个 Supermemory 实例（端口从 6770–6869 分配）和同一个加密数据目录 `runtime/supermemory/pools/<pool-key>/data`，项目隔离仍由不可变的 Supermemory container tag 保证；配置不同则进入不同池，因此不同项目仍可使用不同 provider、模型和维度，向量空间互不污染。覆盖配置保存在 `runtime/project-embedding-settings.json`（0600 权限、原子写入），池注册表在 `runtime/embedding-pools.json`；API 永不返回 key，只返回 `key_configured`。池实例在第一次记忆请求时懒启动，且不会继承过期的 WSL 代理环境变量（需要代理时显式配置 `SUPERMEMORY_PROXY_URL`）。切换模型或维度必须使用全新数据目录：API 会以 `embedding_requires_reset`（409）拒绝，直到确认 `reset_data: true`，随后旧数据目录保留为 `.bak-<时间戳>` 备份，该项目的语义记忆需要重新摄入。2026-08-01 基准（同 query 同语料、隔离实例）：本地 `Xenova/bge-m3` 1024 维单条嵌入 30–72ms、完整检索 58–159ms；远程 `Qwen3-Embedding-8B`（gitee）单条嵌入约 120–210ms、完整检索 286–653ms——**全局默认保持本地 bge-m3**。同日经公开 API 的端到端验证：两个本地同配置项目共享池端口 6770（`shared_projects: 2`），远程配置项目使用独立池端口 6771；两个池的摄入→搜索往返均成功，且在同一池内一个项目摄入的记忆不会被另一个项目检索到。

语义结果只能作为候选，并保留来源、Artifact、页码/定位、哈希和证据状态元数据。项目材料接口 `/api/projects/<project-id>/materials/search` 使用同一项目范围的 Supermemory hybrid 检索；本地服务不可用时不会用 SQL 词法结果、其他 provider 或无关实验代替。缺少本地服务、鉴权失败、返回数据无效或写入失败时，系统直接返回结构化错误，不会降级。

真实 Supermemory Local 验收（`npm run supermemory:acceptance`，证据位于 `artifacts/acceptance/supermemory-local-*.json`）已验证文本摄取与可搜索 chunk、双项目隔离无跨项目泄漏、Graph Memory 节点、Super RAG 文档结果、依赖 LLM 的 `forget` 撤销（撤销后远端 memory 实体消失），以及通过远端消失验证的 delete 撤销。在两项外部阻塞解除前，验收会如实记录为 `partial` 而不是通过：PDF 终态处理需要 Gemini/Vertex key（PDF 提取会从 Mistral OCR 回退到 Gemini，缺 key 时卡在 `extracting`）；图片摄取同样需要 Gemini/Vertex key，`0.0.7-rc.2` 各平台 build（Windows 与 Linux）在无该 key 时处理图片都会崩溃。2026-08-01 隔离实测确认：配置可用的 OpenAI-compatible LLM 端点不会改变 PDF 提取路径，提取器仍硬编码 Mistral OCR → Gemini 2.5 Flash。图片同理——即使后端是多模态 OpenAI-compatible 模型（`gpt-5.6` 实测可接受图片输入），二进制里的图片描述步骤仍硬编码 Gemini provider。这些阻塞记录在 `TODO.md` 中，不会降级为本地 fallback。

## 实验隔离

模型不能提供命令、可执行程序、路径、URL、环境变量或网络目标。批准后的 Run 只能选择固定实验类型和项目内入口，并固定使用 Linux 后端执行（`python3 -m venv` + `.venv/bin/python`）。旧的 `windows`（`cmd.exe`）与 `wsl2` 启动器已随原生 Windows 支持一并移除。

每个科研 Python 项目使用自己的 `.venv`，依赖不会安装到应用运行时。监督器强制固定项目根、超时、进程树取消、有界日志、有限数值 `metrics.json`、结构化 `checkpoint.json`、SHA-256 产物和审计事件。本机进程隔离弱于专用虚拟机，文档不会夸大这一边界。

## 仓库验证与获取

“相关工作实现”页可以为论文添加 GitHub 或 GitLab HTTPS 代码仓库候选。验证会记录提供方元数据和引用文件，要求 DOI 或精确标题匹配，检查已知 SPDX 许可证，并固定 40 位 commit。下载不会自动执行，而是创建 `repository_download` Proposal；批准时还会重新验证当前快照。

批准后的归档会执行大小、条目数、解压大小、路径穿越和链接文件检查，保存为带 SHA-256 的源码 Artifact，并解压到 `projects/<project-id>/experiment/reproductions/<reproduction-id>/source`；不会进入 `code/`，也不会自动提交项目方法 Git。`POST /api/projects/<project-id>/reproductions/<reproduction-id>/dependency-plan` 会为受控的 `requirements*.txt` 创建独立 `repository_dependency_install` Proposal，批准后创建该复现自己的 `.venv`。`POST .../run-plan` 创建 `repository_reproduction_run` Proposal；Linux worker 把固定源码复制到独立运行目录，只使用 `.venv/bin/python`、相对 Python 入口、固定 seed、结构化配置、有界日志和超时。成功运行只生成待审批的 `repository_artifact_write` Proposal，批准后才把重新校验哈希的结果复制到 Artifact 账本。复现结果始终与我们的方法代码、实验和论文结论分开。

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
npm run language-boundary:check
npm run ops:status
npm run mastra:hitl:check
npm run acceptance
```

代码级检查和真实模型验收已经使用当前配置的模型与外部学术 API；模型端点或 key 无效时仍会直接返回结构化错误。针对重建后的默认数据库（16 个项目）的运行检查已经通过；损坏目录单独保留，不会被自动使用。

## 限制

这是本地 MVP，不是生产级安全边界，也不是科学结论生成器。元数据候选不是全文证据；页码 quote 仍需 claim 级人工复核；实验产物只说明实验测量结果，不能自动证明研究假设。本机进程控制不等于虚拟机隔离。真实 GPU 主机验证和语义 claim 映射仍是未完成工作。仓库获取仅限于上面描述的已验证、审批门禁归档流程。
