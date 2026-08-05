# Research OS 项目代理说明

本文件适用于仓库根目录及全部子目录。

## 项目边界

Research OS 是本地、可审计的科研自动化 MVP，不是生产系统。不得把元数据候选表述为全文证据，不得把系统集成结果表述为研究结论，不得把未执行契约表述为已实现能力。

业务应用、数据库迁移、运维脚本、验收和测试只使用 TypeScript。科研实验允许任意语言；Python 只允许出现在 `projects/<project-id>/experiment/`，并使用该项目自己的 `projects/<project-id>/.venv`。应用运行不得依赖容器引擎。**开发在 WSL2 内进行，不在 Windows 上进行**（2026-08-01 决定，2026-08-02 明确开发 shell）：开发、编辑、构建、测试和运维命令全部在 WSL2 shell 内执行，默认开发 shell 就是 WSL2（不是 Windows cmd/PowerShell）；代码仓库单副本 `/mnt/d/ResearchOS`（对应 Windows 侧 `D:\ResearchOS`，同一份文件），旧 ext4 副本 `~/ResearchOS` 仅作备份。Windows 侧只作为调试浏览器（Windows Chrome），通过 mirrored 网络/端口转发以 `127.0.0.1:<port>` 访问 WSL2 内服务；Windows 安装器、`cmd.exe` 启动器等原生路径已移除。

主要组件：`apps/server/` 原生 API 与实验监督器，`apps/mastra/` Agents/Memory/Skills/Tools/Workflows/Studio，`apps/web/` React + TypeScript 组件前端，`projects/` 项目 Git 工作区及项目专属 Artifact，根 `artifacts/` 仅保存共享备份/验收/测试/运维材料和历史迁移来源，`runtime/` 本机状态。

## 开发与运行环境

- 仓库只有**一份**：WSL2 内的 `/mnt/d/ResearchOS`（即 Windows 侧的 `D:\ResearchOS`，同一份文件，不需要同步）；所有开发、服务启动、测试和构建都以 `/mnt/d/ResearchOS` 为工作目录。API `8080`、Mastra `4111`、Supermemory `6767` 与项目配置池实例（6770–6869）都从 `/mnt/d/ResearchOS` 启动。由于 `/mnt/d`（drvfs）无 inotify 支持，`tsx watch` 不会自动感知文件变化（无论在哪个 shell 编辑），改完代码后必须手动重启对应服务（见 docs/operations.md）。旧 ext4 副本 `~/ResearchOS` 已不再作为运行副本，仅作备份。
- WSL2 默认非登录 shell 的 `node` 是 Ubuntu 系统自带的 v12.22.9，不满足仓库 `engines`；执行任何命令前先 `source ~/.nvm/nvm.sh` 并 `nvm use 26.5.1`（对齐 `.nvmrc`）。运行服务、测试和构建都必须用该 nvm Node 版本。
- Web 构建使用平台无关的 esbuild API（`apps/web/build.mjs` 定义 `process.env.NODE_ENV`）；不要在 package.json 里用 shell 内联 `--define` 传值，避免 Linux/bash 引号差异破坏构建产物。
- 调试浏览器固定使用 Windows Chrome；WSL2 内所有服务只监听 `127.0.0.1`，Windows Chrome 通过 mirrored 网络/端口转发访问 `http://127.0.0.1:<port>`。

## TODO 实时契约

1. 非微小工作必须先在 `TODO.md` 使用稳定任务 ID 登记并标为 `[~]`。
2. 方案、范围、依赖和阻塞变化时立即更新任务；不能只在聊天中说明。
3. 只有代码、测试、文档和真实适用验证完成后才能标为 `[x]`。
4. 外部依赖造成真实阻塞时使用 `[!]`，写清解除条件；普通困难保持 `[~]`。
5. 新缺陷和需求缺口必须进入 TODO。

状态只使用 `[ ]`、`[~]`、`[x]`、`[!]`。

## 模型、Mastra 与 Supermemory

- Mastra 官方 LLM 文档导航为 `https://mastra.ai/llms.txt`。需要查阅 Mastra 能力、API 或版本行为时，先从该地址定位主题，再阅读对应的 `https://mastra.ai/docs/` 官方页面和当前安装版本的类型定义；不得根据搜索摘要、旧缓存或未核对版本的示例推断实现。
- Mastra 文档只能说明框架能力，不能放宽本项目的安全边界、无 fallback 约束、审批门禁、固定实验入口或密钥处理规则。接入新能力前必须把范围、依赖、数据流和验收补充到 `TODO.md`，并以当前项目的严格 Zod 契约和审计要求复核。
- Idea 澄清、项目监督和实验规划使用 Mastra Agent；不得手写 Agent 循环或复制提示词。
- Idea Agent 使用 Mastra Agent、Skills 和 Tools；语义 Agent Memory 统一由 Supermemory 管理，并通过 Supermemory 官方 Mastra 集成接入。Mastra 自带 Memory 不能作为 Research OS 的唯一或默认语义事实源。Agent 不得获得任意 Shell、SQL、文件路径、可执行程序或网络工具。
- React 工作区导航固定为科研流程：首页是“全部项目”控制台，不承载 Idea 对话；进入项目后左侧项目列表默认收起，通过边缘箭头滑入/滑出，右侧始终保留唯一一个跨页面持续存在的项目级多轮对话。第一栏只能按 `项目概述 -> 相关工作调研 -> 实验实现 -> 学术论文撰写` 排列；项目概述二级固定为 `项目总览 -> Idea 讨论 -> 待审批与决策 -> 定期汇报与反馈`；相关工作调研二级固定为 `文献列表 -> 研究可视化 -> 种子文献扩展`；实验实现只保留 `本方法实现`、`相关工作实现` 两个二级标签，不使用第三级标签栏，两个页面共用“左侧实验列表 + 右侧实验详情”布局，实验相关部分（复现、比较、计划、队列、指标、产物可视化、谱系）只能位于 `实验实现`；`学术论文撰写` 二级固定为 `引言 -> 相关工作 -> 方法介绍 -> 实验 -> 结论`，引用、BibTeX、图表与实验数据选择、LaTeX 编译、PDF 呈现是章节工作区内的能力，不得作为顶层标签，也不承载实验管理/可视化。前端不得使用“导师/老师”等角色文案。项目工作区正常使用无井号的 `/project/<semantic-slug>/<area>/<tab>` History API 地址，URL 中的 `idea` 映射到内部 Idea Tab；旧 hash 和旧 UUID 地址只能兼容映射到对应内部页面，不能恢复被淘汰的长导航结构。导航重构按 `TODO.md` 的 `P0-WORKSPACE-108A` 推进，完成前不得把旧标签结构重新写回 README 或 AGENTS。
- 论文工作区默认生成自包含 CVPR 风格模板（`paper/cvpr.sty`），论文源码、引用和图表位于项目内 Git；批准 `patch_kind=latex` 的 `code_patch` 后自动排队 `compile_latex`，成功才展示 PDF，失败保留结构化错误；逐句中译只原子写回 `paper/translations.json` 供界面参考，不进入 PDF。
- 语言与主题控件位于左下角设置面板，不出现在网页右上角：语言支持 `zh-CN`（默认）、`zh-TW`、`en`、`es`；主题提供浅色（默认）、暗色两档，使用语义 CSS 变量并按 Apple 配色规范实现。UI 文案必须走 i18n key 与统一术语表，禁止在 TSX 中硬编码中文；模型/数据动态内容（聊天回复、报告/论文正文、实验日志）保持原文，不自动翻译。语言/主题功能完成并通过四语言、两主题真实浏览器验收前，不得在 README 中写成已实现。
- 相关工作调研允许阅读并复用用户自有项目 `/mnt/d/auto-related-work`（即 Windows `D:\auto-related-work`）中的算法、字段 schema、缓存策略、测试思路和数据处理设计；“复用”指把可用逻辑翻译成 TypeScript 后纳入 Research OS，不得把该项目的 Python 文件、Python 运行时、旧缓存或 Python 业务模块直接作为 Research OS 依赖。旧项目中的硬编码代理、外部密钥和 Google Scholar 隧道不能直接带入，必须改成当前项目的显式配置、合法来源适配器和结构化失败。
- 相关工作引擎的 TypeScript 目标能力包括：Crossref/OpenAlex/Semantic Scholar/DBLP/arXiv/Unpaywall source adapters、完整 BibTeX 解析（作者、venue、年份、DOI、摘要）、用户种子文献、depth/width/max_total 引用递归、标题归一化与跨来源去重、多轮字段补全与 Python 完整度阈值、作者机构增量合并、arXiv API 完整作者/摘要与 arXiv HTML5 作者机构/通讯作者解析、引用图、研究现状矩阵、代码仓库候选、取消/进度事件、缓存和结构化失败。字段 provenance 必须区分 `provider`、`user_input`、`controlled_artifact`，provider 补全必须通过 DOI 或标题匹配；多 provider 是显式可审计的来源策略，不是模型或服务失败后的静默 fallback。Google Scholar 爬虫、Cookie、住宅代理和 CAPTCHA 隧道仍然禁止迁移。代码复现完成后，TypeScript 只能根据固定 commit、相同数据/配置/seed 和真实 Artifact 计算效果比较；Mastra 可以提出有证据链接的待核验创新/研究空白候选，但用户确认前不得把候选写成创新结论或论文事实。
- 相关工作请求缓存必须写入 PGlite 的 `related_work_request_cache`，并同时保存 `project_id`、provider、operation、请求哈希、schema 版本、请求 URL/参数、真实 response、provider status、TTL、创建/过期时间和命中计数。缓存命中只允许复用同一项目、同一 provider、同一 operation、同一请求哈希、兼容 schema 且未过期的结构化真实结果；命中/未命中、过期、schema 不兼容、内部响应无效和写入跳过必须有 audit event。失败结果不能把已有成功覆盖成空成功；取消结果不写入缓存；缓存损坏必须失败关闭，不得换 provider、读取旧项目缓存或用空数组补齐。
- 研究现状矩阵与图必须使用 `papers.confirmed` 表示用户确认，不能把 `papers.verified` 当作确认或全文证据。`/api/projects/:projectId/research-status` 只允许当前项目的确认 Paper、带页码/章节 locator 的 Evidence 和 accepted ClaimReview 进入 ready 矩阵；每行保留 Paper/Evidence/ClaimReview/Idea 版本 provenance，未知主题、方法、数据集、指标和限制显示 `unresolved`。图只投影数据库已保存的引用、Paper-Evidence、ClaimReview-Evidence 关系，provider 引用边固定为 `metadata_only`；gap/cluster/duplicate-risk 只能是待核验候选，接受候选不等于科学结论。
- 引用图的 React 视图必须把候选、Paper、Evidence、ClaimReview 分层显示为可访问的交互图；节点详情保留来源、stable ID、locator、状态、证据状态和 `project_scoped` 权限，鼠标与键盘选择都必须可用。空、partial、failed、跨项目和切换项目状态必须分别呈现；截图、fixture 或图形布局不能替代真实 provider、证据和审计验收。
- Supermemory 是长文本、事实、记录、文献知识和多模态内容的语义记忆系统；PGlite 只保存结构化业务状态、实体 ID、状态、审批、哈希、权限和审计，不把句子级语义内容硬编码为 SQL 查询。
- Mastra 的 Supermemory 输入处理器只把真实用户消息（最多 2000 字符）作为语义检索查询，不把项目 JSON 或整段上下文作为 embedding query。
- 报告必须只从对应时间窗口内真实发生的对话消息、审计事件、任务、实验、Proposal、provider attempt 和用户反馈生成，并保存 `source_snapshot`：当前 `project_id`、窗口、data cutoff、事件/来源 ID，以及生成时使用的 Paper、Evidence、Experiment、有效 Artifact、Proposal ID。窗口没有真实事件时必须返回结构化 `report_no_events` 并保持 `empty`，不得生成模板化“已完成”内容。读取报告时重新验证项目归属和来源有效性；没有快照的历史行只标记为 `legacy_unverified`，项目范围不一致、跨项目来源、来源缺失或 Artifact 失效时标记为 `blocked`，前端不得渲染其正文。报告不能作为删除来源后的证据副本，也不能绕过 Paper/Evidence/ClaimReview、实验和审批门禁。
- Supermemory 官方资料入口：`https://supermemory.ai/docs/integrations/mastra.md`、`https://supermemory.ai/docs/concepts/graph-memory.md`、`https://supermemory.ai/docs/concepts/super-rag.md`、`https://supermemory.ai/docs/llms.txt`、`https://supermemory.ai/llms.txt`。接入前必须按官方文档和当前安装版本类型定义核对 API，不能依据摘要或臆造字段。
- Supermemory 默认使用官方 Supermemory Local 自托管服务（本机 `127.0.0.1:6767`），不依赖 Supermemory 云端；其本地自动认证只允许回环地址。使用云端或其他非回环地址时必须显式配置 key，并保持同样的失败关闭约束。
- Supermemory embedding 配置遵循官方 `SUPERMEMORY_EMBEDDING_PROVIDER/MODEL/DIMENSIONS/BASE_URL` 和项目保留的 `SUPERMEMORY_EMBEDDING_API_KEY`；默认 provider 为 `local`，使用多语言 ONNX 模型 `Xenova/bge-m3`（1024 维，`server-v0.0.5` 二进制内置）。远程 embedding 只在官方 `server-v0.0.5` build 中实现（`server-v0.0.6` 与 `0.0.7-rc.2` 已回退到其内置的本地 ONNX worker，rc.2 二进制隔离实测配置远程变量仍加载本地 `Xenova/bge-base-en-v1.5`），WSL2 运行副本固定使用 v0.0.5 linux-x64 二进制；配置 `SUPERMEMORY_EMBEDDING_PROVIDER=openai` 时运行 `Qwen3-Embedding-8B`（1024 维，`https://ai.gitee.com/v1`，key 实测可用），默认 `local` 时运行 `Xenova/bge-m3`（1024 维，多语言）。`scripts/start-supermemory.ts` 在配置远程 provider 时校验二进制必须为 v0.0.5，否则拒绝启动；API 守卫对不支持远程 embedding 的 build 直接返回 `supermemory_embedding_unsupported`，不得静默使用本地向量。pgvector HNSW 属于 Supermemory 服务端二进制内部的 PGlite（`CREATE EXTENSION IF NOT EXISTS vector` + `vector(N)` 列），不是本项目代码：向量 upsert 阶段有约 1024 维上限（隔离实测 1024 维可用、1536/2000 维写入失败），2000 维需求因此被外部阻塞，二进制补丁无法解决该限制。v0.0.5 搜索路径 query embedding 超时硬编码 `interactive:800ms`（二进制源码确认，`/v4/search` 写死 interactive profile，schema 不接受 profile，官方配置无超时项，常规配置无法绕过）曾使延迟高于 800ms 的外部端点（如 `ai.gitee.com` 实测 0.65-1.1s）语义搜索失败关闭；该限制已由用户批准的字节级补丁解除并部署到生产（2026-08-01）：`sdk:800`→`sdk:20000` 等长替换（偏移约 220680316），3s 延迟端点搜索实测成功、生产 `ai.gitee.com` 搜索 timing 4398ms 成功。原版备份 `/home/karbo/bin/supermemory-server-linux-x64.v0.0.5-orig.bak`（sha256 `b2fccca3ff2b5607ce41028c759f375c4ecf5461adc9f3306f41c2757edaf375`）；在用补丁版 sha256 `7d19ddadf484a0539dd813227c2e24ad0e191b8e5db291c2caf2c1ef63a2e7d6`。服务端源码不在公开仓库（闭源构建），无法重新编译；上游升级到新 build 后必须按新偏移重打补丁并记录新哈希。切换模型/维度必须使用全新数据目录或完整重索引。
- Supermemory embedding 配置是**项目级且隔离的**：没有覆盖的项目使用全局 `.env` 默认（共享实例 `127.0.0.1:6767`）；项目级覆盖保存在 `runtime/project-embedding-settings.json`（0600、原子写入，与 model-settings.json 同模式）。相同配置（provider/model/dimensions/base_url/key 完全一致）的项目**复用同一个配置池实例**（端口 6770–6869，数据目录 `runtime/supermemory/pools/<pool-key>/data`，池注册表 `runtime/embedding-pools.json`），项目之间仍通过 Supermemory container tag 隔离、向量空间互不污染；配置不同则分配到不同池，不会为每个项目盲目新建实例。服务端 embedding 配置是启动时读取的全局环境变量、请求级不可覆盖，因此自定义配置必须走独立池实例；配置远程 provider 的实例启动前同样校验二进制为 v0.0.5。读取接口只返回 `key_configured`，不得返回或打印 key。切换模型/维度必须全新数据目录：API 返回 409 `embedding_requires_reset`，确认 `reset_data:true` 后旧数据目录改名 `.bak-<时间戳>` 备份、该项目的语义记忆需重新摄入；仅改 base_url/key 时重启该池实例，不重建数据。池实例子进程不继承宿主的 HTTP(S)_PROXY 环境变量（过期的 WSL NAT 代理地址会破坏远程 embedding 与 HuggingFace 下载）；需要代理时显式配置 `SUPERMEMORY_PROXY_URL`。性能基准（2026-08-01，同 query 同语料隔离实测）：本地 bge-m3 单条嵌入 30–72ms/检索 58–159ms，远程 gitee Qwen3 单条 ~120–210ms/检索 286–653ms；**全局默认保持本地 bge-m3**。
- 所有 Supermemory memory 必须绑定一个不可变的 Research OS `project_id` 隔离域。读、写、检索、Graph Memory 可视化和 Super RAG 查询都必须带项目范围；禁止使用无项目的全局 memory、仅靠 prompt 约束隔离或把一个项目的 memory 作为另一个项目的上下文。跨项目查询必须是显式、经过审批且有审计记录的功能，目前默认禁止。
- 项目隔离必须同时落在 Supermemory 的官方 scope/container/resource/metadata 机制（以核对后的 API 为准）和本地权限校验中；每条语义 memory 还要保留项目、来源 Artifact、SHA-256、文献页码/章节、Idea 版本、实验/报告 ID 和证据状态等可审计关联。Supermemory 失败、超时、鉴权失败或返回无效数据时直接返回结构化错误，不得本地降级、换 provider、静默写入 SQL 或继续生成助手内容。
- Supermemory 真实验收以 `scripts/supermemory-acceptance.ts` 为准：文本摄取/搜索、双项目隔离、Graph 节点、Super RAG 和 delete 撤销（远端消失验证）已通过；`forget` 撤销依赖 LLM 抽取出的 memory 实体，PDF 终态处理依赖 LLM 抽取，配置的模型端点不可用（503）时两者都必须在 TODO 中标记外部阻塞 `[!]`，不得把 delete 验证冒充为 forget 验证。上传文件路径必须使用以 `/` 开头的 POSIX 绝对路径（本地 build 校验），图片上传需 `fileType:'image'` 加原始 `mimeType`。
- 参考 PDF、Idea 讨论、定期汇报与用户反馈、汇报正文、实验结果总结、实验设计依据和探索点、论文/related work 参考，以及图片分析/识别等多模态内容，按项目范围写入 Supermemory；原始文件和哈希仍由受控 Artifact 管理，Supermemory 不改变 PDF 证据、页码 quote 和人工复核约束。
- 代码复现候选只能来自 Paper 已保存的明确仓库 URL、`CITATION.cff`/README 等引用文件或合法 provider API；不得根据论文标题猜 GitHub/GitLab 仓库。许可证、论文/仓库双源匹配、固定 commit、入口、依赖、数据、系统/GPU 要求和受控写入目录必须分别记录，任一未知就保持 candidate 并阻止下载。
- 网页左下角应提供项目范围内的 Supermemory Graph Memory 与语义检索入口。Graph 图和 Super RAG 结果必须显示当前 project scope、来源和权限状态，不得暴露其他项目的节点、事实或文献内容；功能未完成前不得在文档中表述为已实现。
- 代码模型内部按 `simple/medium/complex` 三档（界面只显示“轻量级 / 通用 / 最强大”，不绑定供应商或系列），model、URL、key 和 reasoning effort 完全独立；另设 `document` 文档文本模型，默认 `deepseek-v4-flash` + `http://127.0.0.1:3000/v1`，用于聊天解释与文档式文本。读取接口只返回 `key_configured`。默认文档模型在部分网关会因中国区显式启用限制返回 403（属上游 RegionError），不得静默换模型、伪造回复或把该 403 当成请求格式问题；`DOC-MODEL-107` 已通过运行时配置可用文档模型完成真实聊天与论文验收解除，未配置可用模型时保持结构化失败。
- 设置面板一级标签固定为 `通用 -> 模型 -> 系统`：`通用` 只放外观（界面语言与主题，全局），`模型` 放全部模型设置，`系统` 放全局代理。除外观外所有设置都是**项目级**的（代码三档、文档文本、图片识别、图片生成、Embedding、语音识别），按项目保存在 `runtime/project-settings.json`（0600、原子写入、删除项目时清理），没有覆盖时回退 `.env` 默认；模型页在未打开项目时提示先打开项目。全局代理仍保存在 `runtime/model-settings.json`。
- 模型设置还包含 `vision` 图片识别模型（默认 `mimo-v2.5` + `http://10.31.107.77:3000/v1`，key 留空回退 medium）与 `image_generation` 图片生成模型（默认 `gpt-image-2-official` + `https://api.apimart.ai/v1`，可配置 1k/2k/4k 与 low/medium/high，默认 1k/low/n=1）。二者与代码/文档模型一样只把 key 写入项目级 `runtime/project-settings.json`，读取接口只返回 `key_configured`。聊天或 Idea 讨论包含图片附件时，Idea 澄清优先使用 vision 模型，仍失败关闭；图片生成只通过 `/images/generations` 兼容接口调用。每个已配置模型都提供“测试连接”按钮，只发送最小请求验证连通性（图片生成提交一个最省钱的真实任务，不下载不展示）。
- 设置面板通用页的语言与主题是草稿状态：点击后不会立即生效，必须点击“保存配置”才写入 localStorage 并应用；关闭或切换页面未保存时保持原值。通用页只在设置面板内出现，不出现在网页右上角。
- 项目工作流采用项目级单一 Mastra Workflow：每个项目一份 `projects/<project-id>/workflow.ts`（属于项目内 Git），新项目由默认模板初始化，已有项目用幂等脚本补齐；Mastra 默认每 500ms 轮询哈希热加载到 `runtime/workflow-cache/<project-id>/`（`/mnt/d` 无 inotify，所以热加载只覆盖 `workflow.ts` 本身，loader/运行时源码变化仍需重启 Mastra）。任何 workflow 修改都必须先生成可审阅 diff Proposal，经临时校验、用户审批和项目 Git 提交后才生效；非法文件保留上一有效版本并返回结构化错误。项目页图面板以 `serializedStepGraph` 为数据源，Mastra Studio 仅作开发辅助。运行记录暂存 `runtime/workflow-runs.json`（已知偏差，后续迁 PGlite 需保持字段契约）；删除项目时同步清理注册表、编译缓存与运行记录。
- 项目范围内的项目对话、论文翻译/修订和实验规划公开 API 统一先走项目级 workflow 入口，workflow 分支通过受限内部 API 端点（`/internal/chat`、`/internal/projects/:id/paper-translate|paper-revise|experiment-plan`）执行真实模型与状态写入；项目创建前的 Idea 澄清仍由 Idea Agent 直接处理，不属于项目 workflow。
- 运行时只读取项目 `.env`、`<RESEARCH_RUNTIME_DIR>/model-settings.json`（未设置该变量时默认 `runtime/model-settings.json`；API 与 Mastra 共用同一路径，保存全局代理）、`<RESEARCH_RUNTIME_DIR>/project-settings.json`（默认 `runtime/project-settings.json`，保存项目级模型/语音覆盖）、`runtime/project-embedding-settings.json` 和 `runtime/embedding-pools.json`，不得读取 Codex 配置目录或 `auth.json`。
- 模型失败必须直接返回结构化错误；不得本地回复、隐式切换提供方、规则回答、伪造助手消息或替换为无关实验。
- OpenAI Responses/兼容网关对开启 JSON mode 或 Structured Outputs 的请求，要求 effective input 中至少有一条 input message 含大小写不敏感的 `json`；顶层 `instructions` 或仅放在 system/developer 提示中的 `json` 不算。Research OS 只允许在真正请求 JSON 结构化输出的调用中，把 `Return a JSON object that conforms to the requested JSON Schema.` 注入到实际 `input` 消息（Mastra 使用 `structuredJsonInput`/`structuredJsonValue`，Supermemory bridge 使用 `JSON_INSTRUCTION`）；`strictJsonSchema: true` 本身不开启 JSON mode，不能单独作为注入依据。普通自由文本请求禁止为了规避该校验而人为添加 `json` 字样，也不得把所有模型请求一律注入 JSON 指令；新增结构化调用必须同步使用注入 helper 并保留相应请求体契约测试。
- HTTP 模型 URL 只允许回环和 RFC1918 私有地址；其他远程端点必须使用 HTTPS。
- Idea 澄清不使用固定问题队列。只询问当前真正阻碍规格确认的高信息问题。
- 自动化 Idea 输入只能来自 `tests/idea-cases/*.json`，并通过 TypeScript loader 按公开 ID 读取。

## 执行安全

- 所有 API 输入使用严格 Zod schema；新增字段同步更新 JSON Schema、前端和测试。
- 禁止把模型输出传给任意命令、SQL、路径、依赖安装或网络目标。
- 高成本实验、代码/配置/LaTeX 修改、依赖安装、删除和发布必须经过 Proposal、明确审批、复核和审计；凡是修改本项目代码还必须有受限 diff 与 Git commit。外部复现源码不写入本项目方法 Git，复现下载、依赖安装、运行和产物登记分别使用各自的 Proposal。
- 原生实验监督器只接受固定实验类型、项目 UUID、固定入口和结构化计划，执行后端固定为 `linux`（`python3 -m venv` + `.venv/bin/python` + `latexmk` + SIGKILL 进程树取消）；旧的 `windows`/`wsl2` 后端已随原生 Windows 支持一并移除。
- 每个科研 Python 项目使用独立 `.venv`。监督器保留固定工作根、超时、进程树取消、有界日志、产物大小/格式校验和 SHA-256。
- 代码复现固定使用 `repository_download`、`repository_dependency_install`、`repository_reproduction_run`、`repository_artifact_write` 四种受控 Proposal：源码位于 `projects/<project-id>/experiment/reproductions/<reproduction-id>/source`，依赖安装只允许受控 `requirements*.txt`，运行只接受相对 Python 入口和结构化 seed/config，成功运行必须先等待产物 Proposal 批准。旧的仓库 `dependency_install` 只能失败关闭，不能再次触发下载或自动 Git commit。
- 本机进程控制不能被表述为虚拟机级隔离。高风险不可信代码应使用用户明确配置的专用虚拟机。
- 上传必须经过 Windows Defender 固定扫描，扫描不可用或失败时按失败关闭。WSL2/Linux 宿主通过 interop（`/mnt/c` 下定位 `MpCmdRun.exe` + `wslpath -w` 路径转换）调用 Windows 侧 Defender；不可用时同样失败关闭。
- 所有服务只监听 `127.0.0.1`。不得把无感登录控制面暴露到局域网或公网。
- 不得打印、提交或外发 `.env`、key、Cookie、数据库文件、备份内容或认证材料。

## 数据与证据

- PGlite 是结构化业务状态源；Supermemory 是项目范围的语义 Agent Memory；聊天记录、Mastra 自带 Memory 或 Supermemory 任一单独系统都不能替代另一方的职责。SQL 不保存未经必要的句子级语义副本，Supermemory 也不能替代审批、权限、状态、Artifact 哈希或审计账本。
- 代码、配置、BibTeX 和 LaTeX 使用项目 Git；项目自己的大文件进入 `projects/<project-id>/artifacts/`，根 `artifacts/` 只用于共享备份、验收/测试/运维材料和历史兼容迁移来源。
- 外部 API 使用合法 User-Agent、超时、限流意识和部分失败记录。
- 没有 PDF SHA-256、稳定来源、页码/章节和原文 quote 时，记录只能是元数据候选。
- 数值结果由程序计算；模型只能解释、质疑和提出待审批建议。
- 产物记录 SHA-256、实验、Idea 版本、Git commit、数据版本、配置、Run ID 和有效性。

## 验证与文档

适用验证至少包括：

```bash
npm run typecheck
npm test
npm run build
npm run idea-cases:check
npm run docs:check
npm run language-boundary:check
npm run supermemory:acceptance
npx tsx scripts/ops-guard.ts status
```

主链、模型、Mastra、实验、数据库或产物谱系变化还必须运行 `npx tsx scripts/acceptance-test.ts`；Mastra Approval/HITL 变化还必须运行 `npm run mastra:hitl:check`。真实模型无效时记录结构化失败，不得伪造通过。
`npm run supermemory:acceptance` 需要本机 Supermemory Local 服务在 `127.0.0.1:6767` 运行（WSL2 内启动 linux-x64 二进制），且使用隔离的临时数据库；脚本只删除带 `acceptance` 标记的远端容器，不会触碰真实项目记忆。核心验证通过而外部阻塞未解除时，脚本如实返回 `partial`（退出码 1）：配置的模型端点返回 `503` 时 `forget` 撤销与 PDF 终态处理无法验证；图片摄取需要 Gemini/Vertex key，`0.0.7-rc.2` 各平台 build 在无 key 时处理图片都会崩溃。任何阻塞步骤都不得降级为本地 fallback 或伪造成通过。

README.md 保持英文，README.zh-CN.md 保持中文，章节顺序、命令、端口、环境变量、能力和限制同步；更新时同步 `DOCS_SYNC_VERSION`。重大更新同步 `.env.example`、架构、运维、安全、需求审计和 TODO。UI 变化需要真实浏览器检查和无重叠截图；语言/主题变化还需要四语言、两主题的真实浏览器截图验收。

## Git 交付

重大更新验证通过后只暂存本任务文件，复核 `git diff --check`、暂存统计和敏感文件名，再使用 Conventional Commit。已配置且已授权的 `origin` 可以正常 push；禁止 force push、改写历史或输出认证信息。任何验收失败都不得标记任务完成或自动提交。
