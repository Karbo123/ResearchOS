<!-- DOCS_SYNC_VERSION: 2026-07-31-04 -->

# Research OS

[English](README.md)

Research OS 是一个本地、可审计的科研自动化 MVP。应用业务代码使用 TypeScript，并以 Mastra 实现 Agent 和 Workflow。科研实验工作区允许使用任意语言；科研 Python 项目使用自己独立的 `.venv`。

## 当前状态

原生 Windows 迁移已经完成本地 MVP 范围内的实现和验收。TypeScript API、嵌入式 PostgreSQL 兼容状态库、Mastra 集成、持久工作流队列、Web UI、审批门禁、本机实验监督器、产物账本、Windows Defender 上传门禁和 Windows 安装器源码已经实现。验收已覆盖真实模型请求、项目状态切换、本机科研执行、取消、Mastra Studio 和浏览器界面。干净机器上的安装器签名/发布和 GPU 主机验证仍是独立的后续工作。

模型失败会直接返回结构化错误。系统不会改用本地回复、其他提供方或无关实验。

## 架构

- `apps/server`：Hono API、PGlite 状态、队列、证据、审批、报告、仓库验证/获取、产物账本和本机实验监控器。
- `apps/mastra`：Mastra Agents、Memory、Skills、受限 Tools、Workflows、定时任务和 Studio 工作流图。
- `apps/web`：TypeScript 浏览器源码和生成的静态资源。
- `projects/<project-id>`：独立 Git 工作区。科研 Python 使用 `projects/<project-id>/.venv`。
- `artifacts`：受控上传、证据 PDF、实验产物、验收结果和备份。
- `runtime`：被 Git 忽略的应用状态、模型覆盖、Mastra Memory、日志和 PID 数据。

PGlite 是持久业务状态源。Mastra Memory 不能替代项目、审批、产物或审计状态。

## 环境要求

- Windows 10/11 x64
- Node.js 22.13 或更新版本；安装器固定使用 Node.js 22.22 LTS
- Git for Windows
- Windows Defender，用于上传扫描
- 可选：Python 3.11+，仅用于科研 Python 实验
- 可选：WSL2，必须在实验中显式选择
- 可选：提供 `latexmk.exe` 的 TeX 发行版

## 快速启动

```powershell
npm ci
npm run build
npm start
```

打开 [http://127.0.0.1:8080](http://127.0.0.1:8080)。Mastra Studio 和工作流图位于 [http://127.0.0.1:4111](http://127.0.0.1:4111)，也可以从网页左下角进入。

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

## 验证证据

当前 Web UI 和 Mastra 图已经在真实浏览器中检查。模型设置截图显示三档配置、正确的 `/v1` 地址、推理强度和 key 状态；不会显示任何 key 内容。

![Research OS 总览](docs/assets/research-os-overview.jpg)

![独立模型设置](docs/assets/research-os-model-settings.jpg)

![Mastra 工作流图](docs/assets/research-os-mastra-workflow.jpg)

## 实验隔离

模型不能提供命令、可执行程序、路径、URL、环境变量或网络目标。批准后的 Run 只能选择固定实验类型和项目内入口。Windows 是默认后端，通过固定 `cmd.exe` 参数契约调用项目解释器；WSL2 是必须显式选择的可选后端。

每个科研 Python 项目使用自己的 `.venv`，依赖不会安装到应用运行时。监督器强制固定项目根、超时、进程树取消、有界日志、有限数值 `metrics.json`、结构化 `checkpoint.json`、SHA-256 产物和审计事件。本机进程隔离弱于专用虚拟机，文档不会夸大这一边界。

## 仓库验证与获取

“文献”页可以为论文添加 GitHub 或 GitLab HTTPS 代码仓库候选。验证会记录提供方元数据和引用文件，要求 DOI 或精确标题匹配，检查已知 SPDX 许可证，并固定 40 位 commit。下载不会自动执行，而是创建 `dependency_install` Proposal；批准时还会重新验证当前快照。

批准后的归档会执行大小、条目数、解压大小、路径穿越和链接文件检查，保存为带 SHA-256 的 Artifact，解压到 `projects/<project-id>/code/repositories/`，写入 Artifact 依赖谱系，并提交到项目 Git 工作区。这些记录证明可复现的源码获取过程，但不能单独证明仓库一定是官方实现，也不能证明代码具有科学有效性。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run idea-cases:check
npm run docs:check
npm run ops:status
npm run acceptance
```

最终验收会调用当前配置的真实模型和外部学术 API；模型端点或 key 无效时必须直接失败。

## 限制

这是本地 MVP，不是生产级安全边界，也不是科学结论生成器。元数据候选不是全文证据；页码 quote 仍需 claim 级人工复核；实验产物只说明实验测量结果，不能自动证明研究假设。本机进程控制不等于虚拟机隔离。真实 GPU 主机验证、语义 claim 映射和干净机器安装验收仍是未完成工作。仓库获取仅限于上面描述的已验证、审批门禁归档流程。
