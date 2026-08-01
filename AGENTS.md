# Research OS 项目代理说明

本文件适用于仓库根目录及全部子目录。

## 项目边界

Research OS 是本地、可审计的科研自动化 MVP，不是生产系统。不得把元数据候选表述为全文证据，不得把系统集成结果表述为研究结论，不得把未执行契约表述为已实现能力。

业务应用、数据库迁移、运维脚本、验收和测试只使用 TypeScript。科研实验允许任意语言；Python 只允许出现在 `projects/<project-id>/experiment/`，并使用该项目自己的 `projects/<project-id>/.venv`。应用运行不得依赖容器引擎。默认开发与运行环境是 WSL2（Ubuntu 22.04，Node.js 26.5.1，仓库副本位于 ext4 而非 `/mnt/d`）；Windows 侧仅通过浏览器以 `127.0.0.1:<port>` 访问 WSL2 内服务。

主要组件：`apps/server/` 原生 API 与实验监督器，`apps/mastra/` Agents/Memory/Skills/Tools/Workflows/Studio，`apps/web/` React + TypeScript 组件前端，`projects/` 项目 Git 工作区，`artifacts/` 受控产物，`runtime/` 本机状态。

## 开发与运行环境

- 开发主仓库位于 Windows 侧 `D:\ResearchOS`，提交与推送只在这里执行；WSL2 内 `~/ResearchOS`（ext4）是运行/验证副本，API `8080`、Mastra `4111`、Supermemory `6767` 三服务都从该副本启动。修改 `apps/*`、`scripts/`、`package.json` 或根配置文件后，必须同步到运行副本并重建/重启对应服务，否则 Windows 浏览器访问的仍是旧代码（见 TODO `P2-WSL2-060`）。
- WSL2 默认非登录 shell 的 `node` 是 Ubuntu 系统自带的 v12.22.9，不满足仓库 `engines`；执行任何命令前先 `source ~/.nvm/nvm.sh` 并 `nvm use 26.5.1`（对齐 `.nvmrc`）。运行副本已安装该版本。
- Web 构建使用平台无关的 esbuild API（`apps/web/build.mjs` 定义 `process.env.NODE_ENV`）；不要在 package.json 里用 shell 内联 `--define` 传值，避免 Linux/bash 引号差异破坏构建产物。

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
- Supermemory 是长文本、事实、记录、文献知识和多模态内容的语义记忆系统；PGlite 只保存结构化业务状态、实体 ID、状态、审批、哈希、权限和审计，不把句子级语义内容硬编码为 SQL 查询。
- Supermemory 官方资料入口：`https://supermemory.ai/docs/integrations/mastra.md`、`https://supermemory.ai/docs/concepts/graph-memory.md`、`https://supermemory.ai/docs/concepts/super-rag.md`、`https://supermemory.ai/docs/llms.txt`、`https://supermemory.ai/llms.txt`。接入前必须按官方文档和当前安装版本类型定义核对 API，不能依据摘要或臆造字段。
- Supermemory 默认使用官方 Supermemory Local 自托管服务（本机 `127.0.0.1:6767`），不依赖 Supermemory 云端；其本地自动认证只允许回环地址。使用云端或其他非回环地址时必须显式配置 key，并保持同样的失败关闭约束。
- Supermemory embedding 配置遵循官方 `SUPERMEMORY_EMBEDDING_PROVIDER/MODEL/DIMENSIONS/BASE_URL` 和项目保留的 `SUPERMEMORY_EMBEDDING_API_KEY`；默认 provider 为 `local`，使用多语言 ONNX 模型 `Xenova/bge-m3`（1024 维，`server-v0.0.5` 二进制内置）。远程 embedding 只在官方 `server-v0.0.5` build 中实现（`server-v0.0.6` 与 `0.0.7-rc.2` 已回退到其内置的本地 ONNX worker，rc.2 二进制隔离实测配置远程变量仍加载本地 `Xenova/bge-base-en-v1.5`），WSL2 运行副本固定使用 v0.0.5 linux-x64 二进制；配置 `SUPERMEMORY_EMBEDDING_PROVIDER=openai` 时运行 `Qwen3-Embedding-8B`（1024 维，`https://ai.gitee.com/v1`，key 实测可用），默认 `local` 时运行 `Xenova/bge-m3`（1024 维，多语言）。`scripts/start-supermemory.ts` 在配置远程 provider 时校验二进制必须为 v0.0.5，否则拒绝启动；API 守卫对不支持远程 embedding 的 build 直接返回 `supermemory_embedding_unsupported`，不得静默使用本地向量。pgvector HNSW 属于 Supermemory 服务端二进制内部的 PGlite（`CREATE EXTENSION IF NOT EXISTS vector` + `vector(N)` 列），不是本项目代码：向量 upsert 阶段有约 1024 维上限（隔离实测 1024 维可用、1536/2000 维写入失败），2000 维需求因此被外部阻塞，二进制补丁无法解决该限制。v0.0.5 搜索路径 query embedding 超时硬编码 `interactive:800ms`（二进制源码确认，`/v4/search` 写死 interactive profile，schema 不接受 profile，官方配置无超时项，常规配置无法绕过）曾使延迟高于 800ms 的外部端点（如 `ai.gitee.com` 实测 0.65-1.1s）语义搜索失败关闭；该限制已由用户批准的字节级补丁解除并部署到生产（2026-08-01）：`sdk:800`→`sdk:20000` 等长替换（偏移约 220680316），3s 延迟端点搜索实测成功、生产 `ai.gitee.com` 搜索 timing 4398ms 成功。原版备份 `/home/karbo/bin/supermemory-server-linux-x64.v0.0.5-orig.bak`（sha256 `b2fccca3ff2b5607ce41028c759f375c4ecf5461adc9f3306f41c2757edaf375`）；在用补丁版 sha256 `7d19ddadf484a0539dd813227c2e24ad0e191b8e5db291c2caf2c1ef63a2e7d6`。服务端源码不在公开仓库（闭源构建），无法重新编译；上游升级到新 build 后必须按新偏移重打补丁并记录新哈希。切换模型/维度必须使用全新数据目录或完整重索引。
- Supermemory embedding 配置是**项目级且隔离的**：没有覆盖的项目使用全局 `.env` 默认（共享实例 `127.0.0.1:6767`）；项目级覆盖保存在 `runtime/project-embedding-settings.json`（0600、原子写入，与 model-settings.json 同模式），并为该项目启动独立 Supermemory 实例（端口 6770–6869，数据目录 `runtime/supermemory/projects/<projectId>/data`），不同项目可独立使用不同 provider/model/dimensions，向量空间互不污染。服务端 embedding 配置是启动时读取的全局环境变量、请求级不可覆盖，因此每个自定义项目必须走独立实例；配置远程 provider 的实例启动前同样校验二进制为 v0.0.5。读取接口只返回 `key_configured`，不得返回或打印 key。切换模型/维度必须全新数据目录：API 返回 409 `embedding_requires_reset`，确认 `reset_data:true` 后旧数据目录改名 `.bak-<时间戳>` 备份、该项目的语义记忆需重新摄入；仅改 base_url/key 时重启该项目实例，不重建数据。性能基准（2026-08-01，同 query 同语料隔离实测）：本地 bge-m3 单条嵌入 30–72ms/检索 58–159ms，远程 gitee Qwen3 单条 ~120–210ms/检索 286–653ms；**全局默认保持本地 bge-m3**。
- 所有 Supermemory memory 必须绑定一个不可变的 Research OS `project_id` 隔离域。读、写、检索、Graph Memory 可视化和 Super RAG 查询都必须带项目范围；禁止使用无项目的全局 memory、仅靠 prompt 约束隔离或把一个项目的 memory 作为另一个项目的上下文。跨项目查询必须是显式、经过审批且有审计记录的功能，目前默认禁止。
- 项目隔离必须同时落在 Supermemory 的官方 scope/container/resource/metadata 机制（以核对后的 API 为准）和本地权限校验中；每条语义 memory 还要保留项目、来源 Artifact、SHA-256、文献页码/章节、Idea 版本、实验/报告 ID 和证据状态等可审计关联。Supermemory 失败、超时、鉴权失败或返回无效数据时直接返回结构化错误，不得本地降级、换 provider、静默写入 SQL 或继续生成助手内容。
- Supermemory 真实验收以 `scripts/supermemory-acceptance.ts` 为准：文本摄取/搜索、双项目隔离、Graph 节点、Super RAG 和 delete 撤销（远端消失验证）已通过；`forget` 撤销依赖 LLM 抽取出的 memory 实体，PDF 终态处理依赖 LLM 抽取，配置的模型端点不可用（503）时两者都必须在 TODO 中标记外部阻塞 `[!]`，不得把 delete 验证冒充为 forget 验证。上传文件路径必须使用以 `/` 开头的 POSIX 绝对路径（本地 build 校验），图片上传需 `fileType:'image'` 加原始 `mimeType`。
- 参考 PDF、Idea 讨论、日报/周报 feedback、日报/周报正文、实验结果总结、实验设计依据和探索点、论文/related work 参考，以及图片分析/识别等多模态内容，按项目范围写入 Supermemory；原始文件和哈希仍由受控 Artifact 管理，Supermemory 不改变 PDF 证据、页码 quote 和人工复核约束。
- 网页左下角应提供项目范围内的 Supermemory Graph Memory 与语义检索入口。Graph 图和 Super RAG 结果必须显示当前 project scope、来源和权限状态，不得暴露其他项目的节点、事实或文献内容；功能未完成前不得在文档中表述为已实现。
- Luna、Terra、Sol 三档的 model、URL、key 和 reasoning effort 完全独立。读取接口只返回 `key_configured`。
- 运行时只读取项目 `.env`、`runtime/model-settings.json` 和 `runtime/project-embedding-settings.json`，不得读取 Codex 配置目录或 `auth.json`。
- 模型失败必须直接返回结构化错误；不得本地回复、隐式切换提供方、规则回答、伪造助手消息或替换为无关实验。
- HTTP 模型 URL 只允许回环和 RFC1918 私有地址；其他远程端点必须使用 HTTPS。
- Idea 澄清不使用固定问题队列。只询问当前真正阻碍规格确认的高信息问题。
- 自动化 Idea 输入只能来自 `tests/idea-cases/*.json`，并通过 TypeScript loader 按公开 ID 读取。

## 执行安全

- 所有 API 输入使用严格 Zod schema；新增字段同步更新 JSON Schema、前端和测试。
- 禁止把模型输出传给任意命令、SQL、路径、依赖安装或网络目标。
- 高成本实验、代码/配置/LaTeX 修改、依赖安装、删除和发布必须经过 Proposal、diff、明确审批、复核、Git commit 和审计。
- 原生实验监督器只接受固定实验类型、项目 UUID、固定入口和结构化计划。服务在 WSL2/Linux 宿主时，Linux 原生后端是默认执行路径（`python3 -m venv` + `.venv/bin/python` + SIGKILL 进程树取消）；Windows 宿主仍可使用显式的 `windows`（`cmd.exe`）或 `wsl2` 后端，跨宿主组合直接返回结构化 400。
- 每个科研 Python 项目使用独立 `.venv`。监督器保留固定工作根、超时、进程树取消、有界日志、产物大小/格式校验和 SHA-256。
- 本机进程控制不能被表述为虚拟机级隔离。高风险不可信代码应使用用户明确配置的专用虚拟机。
- 上传必须经过 Windows Defender 固定扫描，扫描不可用或失败时按失败关闭。WSL2/Linux 宿主通过 interop（`/mnt/c` 下定位 `MpCmdRun.exe` + `wslpath -w` 路径转换）调用 Windows 侧 Defender；不可用时同样失败关闭。
- 所有服务只监听 `127.0.0.1`。不得把无感登录控制面暴露到局域网或公网。
- 不得打印、提交或外发 `.env`、key、Cookie、数据库文件、备份内容或认证材料。

## 数据与证据

- PGlite 是结构化业务状态源；Supermemory 是项目范围的语义 Agent Memory；聊天记录、Mastra 自带 Memory 或 Supermemory 任一单独系统都不能替代另一方的职责。SQL 不保存未经必要的句子级语义副本，Supermemory 也不能替代审批、权限、状态、Artifact 哈希或审计账本。
- 代码、配置、BibTeX 和 LaTeX 使用项目 Git；大文件进入 `artifacts/`。
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
npm run supermemory:acceptance
npx tsx scripts/ops-guard.ts status
```

主链、模型、Mastra、实验、数据库或产物谱系变化还必须运行 `npx tsx scripts/acceptance-test.ts`；Mastra Approval/HITL 变化还必须运行 `npm run mastra:hitl:check`。真实模型无效时记录结构化失败，不得伪造通过。
`npm run supermemory:acceptance` 需要本机 Supermemory Local 服务在 `127.0.0.1:6767` 运行（WSL2 内启动 linux-x64 二进制），且使用隔离的临时数据库；脚本只删除带 `acceptance` 标记的远端容器，不会触碰真实项目记忆。核心验证通过而外部阻塞未解除时，脚本如实返回 `partial`（退出码 1）：配置的模型端点返回 `503` 时 `forget` 撤销与 PDF 终态处理无法验证；图片摄取需要 Gemini/Vertex key，`0.0.7-rc.2` 各平台 build 在无 key 时处理图片都会崩溃。任何阻塞步骤都不得降级为本地 fallback 或伪造成通过。

README.md 保持英文，README.zh-CN.md 保持中文，章节顺序、命令、端口、环境变量、能力和限制同步；更新时同步 `DOCS_SYNC_VERSION`。重大更新同步 `.env.example`、架构、运维、安全、需求审计和 TODO。UI 变化需要真实浏览器检查和无重叠截图。

## Git 交付

重大更新验证通过后只暂存本任务文件，复核 `git diff --check`、暂存统计和敏感文件名，再使用 Conventional Commit。已配置且已授权的 `origin` 可以正常 push；禁止 force push、改写历史或输出认证信息。任何验收失败都不得标记任务完成或自动提交。
