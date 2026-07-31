# Research OS 项目代理说明

本文件适用于仓库根目录及全部子目录。

## 项目边界

Research OS 是本地、可审计的科研自动化 MVP，不是生产系统。不得把元数据候选表述为全文证据，不得把系统集成结果表述为研究结论，不得把未执行契约表述为已实现能力。

业务应用、数据库迁移、运维脚本、验收和测试只使用 TypeScript。科研实验允许任意语言；Python 只允许出现在 `projects/<project-id>/experiment/`，并使用该项目自己的 `projects/<project-id>/.venv`。应用运行不得依赖容器引擎。

主要组件：`apps/server/` 原生 API 与实验监督器，`apps/mastra/` Agents/Memory/Skills/Tools/Workflows/Studio，`apps/web/` React + TypeScript 组件前端，`projects/` 项目 Git 工作区，`artifacts/` 受控产物，`runtime/` 本机状态。

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
- 所有 Supermemory memory 必须绑定一个不可变的 Research OS `project_id` 隔离域。读、写、检索、Graph Memory 可视化和 Super RAG 查询都必须带项目范围；禁止使用无项目的全局 memory、仅靠 prompt 约束隔离或把一个项目的 memory 作为另一个项目的上下文。跨项目查询必须是显式、经过审批且有审计记录的功能，目前默认禁止。
- 项目隔离必须同时落在 Supermemory 的官方 scope/container/resource/metadata 机制（以核对后的 API 为准）和本地权限校验中；每条语义 memory 还要保留项目、来源 Artifact、SHA-256、文献页码/章节、Idea 版本、实验/报告 ID 和证据状态等可审计关联。Supermemory 失败、超时、鉴权失败或返回无效数据时直接返回结构化错误，不得本地降级、换 provider、静默写入 SQL 或继续生成助手内容。
- 参考 PDF、Idea 讨论、日报/周报 feedback、日报/周报正文、实验结果总结、实验设计依据和探索点、论文/related work 参考，以及图片分析/识别等多模态内容，按项目范围写入 Supermemory；原始文件和哈希仍由受控 Artifact 管理，Supermemory 不改变 PDF 证据、页码 quote 和人工复核约束。
- 网页左下角应提供项目范围内的 Supermemory Graph Memory 与语义检索入口。Graph 图和 Super RAG 结果必须显示当前 project scope、来源和权限状态，不得暴露其他项目的节点、事实或文献内容；功能未完成前不得在文档中表述为已实现。
- Luna、Terra、Sol 三档的 model、URL、key 和 reasoning effort 完全独立。读取接口只返回 `key_configured`。
- 运行时只读取项目 `.env` 和 `runtime/model-settings.json`，不得读取 Codex 配置目录或 `auth.json`。
- 模型失败必须直接返回结构化错误；不得本地回复、隐式切换提供方、规则回答、伪造助手消息或替换为无关实验。
- HTTP 模型 URL 只允许回环和 RFC1918 私有地址；其他远程端点必须使用 HTTPS。
- Idea 澄清不使用固定问题队列。只询问当前真正阻碍规格确认的高信息问题。
- 自动化 Idea 输入只能来自 `tests/idea-cases/*.json`，并通过 TypeScript loader 按公开 ID 读取。

## 执行安全

- 所有 API 输入使用严格 Zod schema；新增字段同步更新 JSON Schema、前端和测试。
- 禁止把模型输出传给任意命令、SQL、路径、依赖安装或网络目标。
- 高成本实验、代码/配置/LaTeX 修改、依赖安装、删除和发布必须经过 Proposal、diff、明确审批、复核、Git commit 和审计。
- 原生实验监督器只接受固定实验类型、项目 UUID、固定入口和结构化计划。Windows `cmd.exe` 是默认后端；WSL2 必须显式选择。
- 每个科研 Python 项目使用独立 `.venv`。监督器保留固定工作根、超时、进程树取消、有界日志、产物大小/格式校验和 SHA-256。
- 本机进程控制不能被表述为虚拟机级隔离。高风险不可信代码应使用用户明确配置的专用虚拟机。
- 上传必须经过 Windows Defender 固定扫描，扫描不可用或失败时按失败关闭。
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

```powershell
npm run typecheck
npm test
npm run build
npm run idea-cases:check
npm run docs:check
npx tsx scripts/ops-guard.ts status
```

主链、模型、Mastra、实验、数据库或产物谱系变化还必须运行 `npx tsx scripts/acceptance-test.ts`；Mastra Approval/HITL 变化还必须运行 `npm run mastra:hitl:check`。真实模型无效时记录结构化失败，不得伪造通过。

README.md 保持英文，README.zh-CN.md 保持中文，章节顺序、命令、端口、环境变量、能力和限制同步；更新时同步 `DOCS_SYNC_VERSION`。重大更新同步 `.env.example`、架构、运维、安全、需求审计和 TODO。UI 变化需要真实浏览器检查和无重叠截图。

## Git 交付

重大更新验证通过后只暂存本任务文件，复核 `git diff --check`、暂存统计和敏感文件名，再使用 Conventional Commit。已配置且已授权的 `origin` 可以正常 push；禁止 force push、改写历史或输出认证信息。任何验收失败都不得标记任务完成或自动提交。
