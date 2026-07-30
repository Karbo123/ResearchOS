<!-- DOCS_SYNC_VERSION: 2026-07-30-16 -->
<!-- ACCEPTANCE_PROJECT: 6d91ff49-12a5-406c-b7aa-cb96aa3f22e4 -->

说明：n8n 专用运行角色除 `n8n` Schema 权限外，还需要数据库 `CREATE` 权限，因为 n8n 启动时会执行 `CREATE SCHEMA IF NOT EXISTS`；它没有业务表权限。

模型默认连接使用 `.env` 中的 `OPENAI_BASE_URL` 与 `OPENAI_API_KEY`；三档显式 `RESEARCH_MODEL_URL_*` / `RESEARCH_MODEL_KEY_*` 或运行时文件中的非空字段覆盖默认值，旧空字段会继承 `.env`，API 不会返回 key。

模型默认连接使用 `.env` 中的 `OPENAI_BASE_URL` 与 `OPENAI_API_KEY`；三档显式 `RESEARCH_MODEL_URL_*` / `RESEARCH_MODEL_KEY_*` 或运行时文件中的非空字段覆盖默认值，旧空字段会继承 `.env`，API 不会返回 key。

说明：n8n 专用运行角色除 `n8n` Schema 权限外，还需要数据库 `CREATE` 权限，因为 n8n 启动时会执行 `CREATE SCHEMA IF NOT EXISTS`；它没有业务表权限。

`RUNNER_EXECUTOR_TIMEOUT_SECONDS` 控制 Runner 到固定 launcher 的请求超时；每 Run 容器在 Compose 内部创建，Windows 不启动 API 或模型服务。

<div align="center">

# Research OS

### 从研究 Idea 到可审计产物的本地优先、证据感知科研自动化系统

[![Docker Compose](https://img.shields.io/badge/Docker%20Compose-local--first-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![n8n](https://img.shields.io/badge/n8n-1.121.0-EA4B71?logo=n8n&logoColor=white)](n8n/workflows)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)](apps)
[![MLflow](https://img.shields.io/badge/Tracking-self--hosted%20MLflow-0194E2?logo=mlflow&logoColor=white)](http://127.0.0.1:5000)

**[English](README.md) · [简体中文](README.zh-CN.md)**

</div>

> **当前状态：可运行、经过真实验收的本地 MVP。** Research OS 已验证编排、审批、证据、谱系、Runner 与产物主链，但目前**不能**宣称已具备生产级自主文献综述、官方代码复现、任意 GPU 调度或完整论文自动写作能力。在将它用于真实科研判断前，请先阅读[原始需求审计](docs/requirements-audit-2026-07-28.md)。

![Research OS 概览](docs/assets/research-os-overview.jpg)

## 为什么需要 Research OS

研究项目的上下文经常散落在聊天、论文表格、实验目录和稿件中。Research OS 围绕持久化 `project_id` 与版本化 `ResearchIdea/ProjectSpec` 把这些对象连接起来：

- 从自然语言 Idea 和自适应 AI 多轮澄清开始：自动识别明显上下文、公开假设，不使用固定问卷。默认开启的**全自动模式**尽量少问；关闭开关后进入**详细模式**，更全面但仍自适应地了解需求。
- 在创建项目之前拦截信息不足或明显不可行的 Idea。
- 将 Idea、策略、审批、检查点、任务、实验、证据和产物持久化到 PostgreSQL；聊天记录不是唯一状态源。
- 通过 Crossref、OpenAlex、Semantic Scholar、arXiv 和 DBLP 检索，保存 DOI/BibTeX 以及提供方错误。
- 明确区分 `metadata-only` 候选和带 PDF 哈希、页码/章节、原文 quote 与来源 URL 的 `fulltext-evidence`。
- 高成本实验、代码/配置/LaTeX 修改、安装依赖、覆盖/删除及对外发布必须先生成方案并得到明确审批。
- 以非 root、资源受限 Runner 执行少量白名单实验，通过自托管 MLflow 与 MinIO 记录指标和产物。
- 批准的实验进入 Runner 前必须保持项目工作树干净，创建不可变的 `run/<run_id>` tag，并在受控产物目录保存带哈希的源码、环境、数据、模型和配置快照。
- 生成可检查、可下载并带谱系的 PNG/PDF/JSON/PLY，而不是只返回一段 LLM 结论。
- 网页可预览有效产物：JSON/文本/CSV/TSV/PDF 受限展示，HTML 只显示转义后的原文；ASCII PLY/PCD 提供可拖拽旋转、滚轮缩放、重置、可选网格线框和固定降采样上限的点云画布，并保留下载入口。失效产物继续显示记录但不可预览。
- 支持受限的 PDF、JSON、CSV/TSV、文本、代码、图片和 ZIP 清单上传；每个附件都必须通过私有 ClamAV 扫描和受限解析后才能持久化或作为不可信上下文发送，扫描/解析失败会阻止模型调用，图片使用有上限的 OCR，ZIP 内容不会解压或执行；会话和项目累计配额在事务锁下执行。
- 在同一项目对话中暂停、从检查点恢复、取消、修改 Idea，并生成日报/周报。

## 效果截图

以下截图来自真实验收项目，不包含 token 或凭据。最新完整验收项目为 `6d91ff49-12a5-406c-b7aa-cb96aa3f22e4`。

![自适应澄清识别 MNIST/CNN 领域并记录 Terra 模型层级](docs/assets/research-os-adaptive-chat.png)

上面的新项目对话展示了默认开启的全自动模式开关，并从 PyTorch、CUDA、CNN 和 MNIST 推断出深度学习/计算机视觉领域，指出该目标首先是工程基准而不能自动宣称科研创新，并选择了可配置的中等成本 `gpt-5.6-terra` 路由。关闭开关会进入详细模式，针对相关缺口扩大了解范围，但不会退回固定问卷。等待回复期间，界面会显示不确定进度条、已等待时间和当前分析提示，不会伪造精确完成百分比。

| 项目概览 | 文献与证据 |
| --- | --- |
| ![概览](docs/assets/research-os-overview.jpg) | ![文献](docs/assets/research-os-literature.jpg) |

| 产物画廊 | 持久化策略与审批闸门 |
| --- | --- |
| ![产物](docs/assets/research-os-artifacts.jpg) | ![策略](docs/assets/research-os-policies.jpg) |

截图有意展示证据边界：部分 DOI 记录只是 `metadata-only`，只有保存了页码原文的记录才标记为 `fulltext-evidence`。损坏或因 Idea 变化而失效的产物不会静默消失，而会继续显示并明确标为无效。

## 系统架构

```mermaid
flowchart LR
    U["用户：Idea、文件、反馈"] --> UI["Research OS Web UI"]
    UI --> API["FastAPI API\nProjectSpec、审批与谱系"]
    API --> PG[("PostgreSQL\n业务状态源")]
    API --> N8N["n8n 1.121.0\n主流程、聊天、报告"]
    N8N --> API
    API --> R["Runner\n白名单异步作业"]
    R --> ML["MLflow"]
    ML --> MI[("MinIO\n大文件产物")]
    API --> S["学术检索\nCrossref/OpenAlex/S2/arXiv/DBLP"]
    API --> B["配置的模型 API\nAPI 容器直连"]
    B --> C[".env 提供方/模型覆盖\nLuna low / Terra medium / Sol high"]
```

API 与 Runner 是执行强制边界。n8n 负责编排受限工作流，但不能读取容器环境变量、执行任意 SQL，或把任意 Shell 命令交给 Runner。Idea 澄清采用受严格 Schema 约束的自适应对话 Agent：每轮整体更新草稿，但没有 Shell、文件系统、SQL 或网络工具。模型请求由 API 容器直接发送到三个独立配置的 OpenAI-compatible URL。API 不读取 Windows Codex 配置目录、`auth.json`，也不依赖 Windows 模型服务；调用失败直接返回结构化错误，不切换提供方、不生成本地回复。

当前 Runner 隔离方式是为每个 Run 创建一个新的非 root 作业容器。`runner-launcher` 是唯一的 Docker 控制边界，也是唯一挂载 Docker socket 的服务；API 和 Runner 都不挂载 socket，Windows 不启动 API、Runner 或模型进程。固定作业镜像、内部网络、受控挂载、任务模板、命令、资源限制、超时、取消和环境均由部署代码选择；用户请求不能选择镜像、命令、路径、网络或环境。未支持的主题专属执行直接返回结构化错误，API 不会替换成通用 demo 或其他模型/provider。

## 能力矩阵

已批准的 Idea、策略、代码、数据和产物变更现在按 `ArtifactDependency` 计算实体级影响，只使依赖后代失效，并记录可审阅的节点/边影响图；对安全终态检查点自动创建待审批重跑 Proposal，批准后才执行固定入口，不会自动执行或替换为无关实验。未知变更类型、没有可验证 Git/数据/产物根的变更会直接返回结构化错误，不会被当作无影响变更。

| 范围 | MVP 状态 | 当前真实能力 |
| --- | --- | --- |
| Idea 对话与澄清 | **已实现（自适应 MVP）** | 全草稿 AI 分析、默认全自动/可选详细模式、假设/风险记录、Luna/Terra/Sol 成本路由、可见等待状态、严格 Schema 和结构化模型错误。模型调用失败不会切换提供方，也不会生成规则回复。 |
| 项目初始化 | **已实现** | UUID、Git 工作区、目录、Idea v1、PostgreSQL 状态、检查点和 n8n 触发。 |
| 文献检索 | **已实现（有限范围）** | Crossref、OpenAlex、Semantic Scholar、arXiv、DBLP、DOI BibTeX；GitHub/GitLab 先作为候选，经过论文记录、仓库引用、许可证和固定 commit 交叉核验后才能申请下载。 |
| 全文证据 | **已实现（MVP）** | 白名单 HTTPS PDF、PDF/quote SHA-256、页码/章节、原文与 BibTeX 持久化。 |
| Idea 专属实验规划 | **已实现（需审批）** | API 使用当前 ProjectSpec、页码级全文证据和生效策略快照，生成包含数据源、基线、指标、消融、统计检验、种子、预算、风险和成功标准的严格主题专属计划 Proposal。 |
| 人工监督 | **已实现（MVP）** | 对解释/建议、Idea/策略变更、状态和审批请求使用严格模型意图分类；只有具体 Idea/策略变更会创建审批 Proposal，暂停/恢复/取消及批准/驳回不会从聊天直接执行。 |
| 实验执行 | **已实现（有限范围）** | 八个 Runner 白名单任务，其中包含固定主题入口契约和镜像内固定 micromamba/Conda Python 环境；非 root、CPU/内存/PID/每 Run 硬上限 tmpfs 输出 volume、超时/取消、指标、MLflow、PNG/PLY/PDF/日志产物，以及执行前可复核快照闸门。 |
| 数值诊断 | **已实现（受限范围）** | 实验页由 Python 确定性计算已持久化指标和结构化失败码，并生成需审批、不会自动执行的后续建议。LLM 只能解释或质疑结果，不能计算统计量或启动后续工作。 |
| MLflow 追踪 | **已实现（受限范围）** | 每个 Runner 任务记录学习率/模型版本、Git/数据/种子/镜像身份、平台和网络策略；Runner 状态保存终态，并以固定频率将进程/系统 CPU、内存和 GPU 数值写入 MLflow 及 `resource-usage.jsonl`。无 GPU 时明确记录 `gpu_available=0`，不使用其他执行路径。 |
| 产物谱系 | **已实现（MVP）** | Idea 版本、实验、不可变 run tag、源码 tar、ProjectSpec/策略/配置/环境/数据/模型/依赖清单、Git/数据/配置哈希、MLflow Run、产物与依赖元数据。正式镜像 digest 仍需配置，实时验收仍待执行。 |
| 产物预览 | **已实现（受限范围）** | 网页以转义文本预览 JSON/文本/CSV/TSV/PDF/HTML，并以固定上限渲染 ASCII PLY/PCD 点云，支持旋转、缩放、重置、可选网格线框、谱系元数据和下载。二进制点云、缺失/失效产物及解析上限错误均返回结构化错误。 |
| 通用科研自治 | **部分实现/路线图** | 真实 GPU 主机验证、更完整的多模态材料库、证据驱动 Related Work 与完整论文仍待实现。网页现在可以在存在页码级核验证据时生成证据论文草稿 Proposal；生成器要求 PDF 哈希、BibTeX、稳定 URL、定位、claim 和 quote，并输出确定性的 claim-to-evidence map；metadata-only 记录会被拒绝，没有真实实验指标时会明确标为未执行。当前已支持固定主题 `experiment/main.py`、受控 Python、固定 micromamba/Conda Python、C++/CMake 和白名单 GPU 请求模板，并在每 Run 独立非 root 容器中使用硬上限输出 volume；代码/配置/LaTeX 修改已支持结构化操作、隔离验证、冲突检查、Git 提交、审计和需审批的 Git 回滚；对外发布明确禁用。官方 GitHub/GitLab 仓库核验、审批后固定 commit 导入、确定性报告和可选 HTTPS 报告 webhook 已实现。 |

## 前置条件

- Windows 10/11 与 Docker Desktop 4.x 或更新版本。
- Docker Desktop 切换到 **Linux containers** 和 `desktop-linux` engine。它表示 Docker Desktop 在自身管理的 VM/WSL2 后端中运行 Linux 镜像，不需要另外安装一个 Linux 系统。
- Docker Compose v2（运行 `docker compose version` 检查）。
- 至少 8 GB 可用内存；同时运行 MLflow、n8n、PostgreSQL、MinIO、API 和 Runner 时建议准备 12–16 GB。
- 运行本地校验脚本时，宿主机需要 Python 3.12+；模型调用不需要 Windows Bridge。
- 只需要 Python 3.12+ 执行本地校验脚本；模型 URL、模型名、key 和推理强度由 `.env` 或网页左下角的模型配置面板设置。

## Windows 快速开始

### 单 EXE 安装器状态

[`installer/windows`](installer/windows/README.md) 已包含在线引导安装器定义：打包 Research OS 与 Compose/n8n 工作流；当前运行时把模型请求留在 API 容器内，不启动 Windows Bridge。若缺少 Docker Desktop，只在用户勾选同意后从官方地址下载，并在提权执行前校验 Authenticode 签名。生成的 EXE 不进入 Git。GitHub Actions 按 `v*` tag 在 Windows runner 构建 EXE、SHA-256 和草稿 Release；从同一 tag 手动运行并明确选择 `publish=true` 后，只有配置签名证书 Secret、签名验证通过且重新计算校验和才会正式发布。该路径目前**还不是正式发布的一键安装包**：签名凭据、Docker Desktop 再分发/许可复核及干净 Windows VM 验收仍属于 `P2-INSTALLER-029`。

下方手动方式仍是当前受支持的安装路径。

在仓库根目录打开 PowerShell：

```powershell
Set-Location D:\n8n-ai-research-workflows
Copy-Item .env.example .env
```

首次启动前编辑 `.env`，把所有包含 `change-me`、`replace-with` 和 `*-dev-*` 的值改成长随机值。可以用以下命令生成：

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

请分别为 `POSTGRES_PASSWORD`、`MINIO_ROOT_PASSWORD`、`N8N_ENCRYPTION_KEY`、`N8N_LOCAL_OWNER_PASSWORD` 和 `RUNNER_SHARED_SECRET` 生成不同值。三个模型层级可在 `.env` 或网页设置面板中独立配置。不要提交 `.env`。

API 容器在 Docker Compose 私有网络内直接调用三个模型 URL。Windows 不需要启动 Bridge 或其他 API 服务；网页设置接口只返回 `key_configured`，不会返回 key。

默认路由为：简单轮次 `gpt-5.6-luna`/low，中等轮次 `gpt-5.6-terra`/medium，复杂轮次 `gpt-5.6-sol`/high（`reasoning_effort=high`）。API 通过可配置的确定性阈值选择层级，模型不能自行升级到更昂贵层级。模型服务失败时 API 返回结构化错误，不切换提供方，也不生成本地回复。

### 构建并启动 Compose

回到仓库 PowerShell：

```powershell
# 首次检出，或修改了 Dockerfile、服务依赖、API/Runner 源码、MLflow 源码等镜像输入后。
docker compose up --build -d

# 镜像已经存在时的日常启动命令。
docker compose up -d
docker compose ps
```

只有镜像输入发生变化或镜像被删除时才使用 `--build`。修改运行时挂载的
`projects/`、`artifacts/` 和 `n8n/workflows/` 不需要构建镜像。修改 n8n
工作流后，只重新创建 n8n 容器以再次执行启动导入：

```powershell
docker compose up -d --force-recreate n8n
```

等待 `postgres`、`api`、`runner`、`n8n`、`mlflow`、`minio` 和 `minio-init` 进入健康/完成状态，然后打开：

| 服务 | 本地地址 | 用途 |
| --- | --- | --- |
| Research OS | [127.0.0.1:8080](http://127.0.0.1:8080) | Idea 对话与项目面板 |
| n8n 自动登录 | [127.0.0.1:8080/api/n8n/open](http://127.0.0.1:8080/api/n8n/open) | 把本地 n8n Cookie 交给浏览器 |
| n8n 直接地址 | [127.0.0.1:5678](http://127.0.0.1:5678) | 工作流编辑与排障 |
| MLflow | [127.0.0.1:5000](http://127.0.0.1:5000) | Run、指标、参数和产物 |
| MinIO Console | [127.0.0.1:9001](http://127.0.0.1:9001) | 对象存储管理 |
| API 文档 | [127.0.0.1:8080/docs](http://127.0.0.1:8080/docs) | OpenAPI 与受限接口 |

Research OS 侧边栏通过 `/api/n8n/open` 打开 n8n。API 使用 `.env` 中仅保存在服务端的本地 Owner 凭据登录 n8n，转发 n8n 自己签发的 HttpOnly Cookie，再跳转到 `/home/workflows`。正常使用时不需要输入或记忆 n8n 密码。这只是个人电脑上的便利登录，不是安全边界：所有端口必须保持 `127.0.0.1`，不要通过局域网、反向代理或隧道暴露自动登录入口。

## 第一个项目操作流程

### 澄清请求状态

新项目澄清请求使用 `POST /api/chat/stream` 时，界面只显示可审计的应用事件：路由选择、请求准备、调用模型、保存结果、失败和最终结构化结果。界面绝不显示、声称或重建模型内部思维链。只有返回的结构化规格处于 `ready_for_confirmation` 后才能创建项目；未完成的对话会返回冲突，不会创建项目。

1. 点击**新研究项目**并输入 Idea。**全自动模式**默认开启、尽量减少打断；希望规格生成前更全面地了解需求时，关闭开关进入**详细模式**。
2. 检查 AI 的理解、推断领域、假设和成组追问；纠正错误推断，两种模式都不会逐字段执行固定问卷。
   Enter 用于换行；Ctrl+Enter 或 Cmd+Enter 提交。请求等待期间，输入框和模式开关会锁定；超时或连接错误会显示在对话中，并释放控件以便重试。
3. 审核生成的 `ProjectSpec`。字段缺失、数据所有权不明或资源风险明显时，系统会保持澄清状态并禁止创建项目。
4. 确认规格后，系统创建 UUID、Git 工作区、项目目录、Idea v1、数据库状态、检查点和 n8n 主流程任务。
5. 检查**文献**页。把 `metadata-only` 当作检索候选；只有同时具有稳定来源、PDF 哈希、页码/章节与原文 quote 的 `fulltext-evidence` 才能支撑事实性结论。
6. 检查 **Related Work** 的证据覆盖、研究空白候选和重复研究候选。它们都只是候选，不证明新颖性或科学结论。
7. 在**实验**页生成主题专属计划前，必须先有页码级全文证据。API 会把严格计划保存为待审批 Proposal，并绑定当前 Idea 版本、证据 ID 和策略快照。在**审批**页批准后才允许进入执行闸门；当前 Runner 仍会对主题专属执行返回结构化错误，绝不会替换成通用 demo。
8. 在项目概览的研究规格区域点击“生成证据论文草稿”前，必须已经导入页码级核验证据。API 只创建绑定当前 Idea 版本、证据 ID、确定性 claim map 和真实成功运行的 `paper/main.tex` 替换 patch Proposal；Related Work 每条事实句带 evidence ID，结果带 run ID；metadata-only 会直接拒绝，没有实验结果则明确保留未执行状态。批准前不会写文件，也不会编译 LaTeX。
9. 在项目对话中要求解释、建议或提出变更。执行型请求会转换为结构化 Proposal 并等待批准，不会静默执行。
10. 在**策略**页添加“所有实验至少使用五个随机种子”等长期规则。批准后的策略保存在 PostgreSQL，并在计划、API 提交和 Runner 三处强制执行。
11. 可以暂停、恢复、取消、修改 Idea 或从适当检查点请求局部重跑。成功或失败实验的检查点可在网页中创建需人工审批的局部重跑 Proposal；它只复用原白名单模板、配置和已持久化随机种子，批准后由 API 自动进入同一个受控 `/api/experiments` 提交链。代码/配置/LaTeX 修改使用结构化 patch、隔离验证、冲突检查和需审批的 Git 提交；回滚必须创建新的审批 Proposal。提交失败会保留结构化错误，绝不会选择无关实验。未知变更类型、没有可验证 Git/数据/产物根的变更以及对外发布会直接拒绝。已取消项目是终止状态，不能恢复。

## 运行自带验收示例

所有研究 Idea 和项目对话测试输入都以公开 UTF-8 JSON 文本保存在 [`tests/idea-cases`](tests/idea-cases)，这里是唯一允许的来源；测试代码不得嵌入或注入额外 Idea。新增或检查用例后运行：

```powershell
python scripts/check_idea_case_sources.py
```

需要一次低成本真实检查时，`test_mnist_idea.py` 只读取 `mnist-cnn.json`、只执行一轮 API/模型调用，并把被 Git 忽略的结果写到 `artifacts/idea-tests/mnist-cnn-latest.json`：

```powershell
python scripts/test_mnist_idea.py
```

下面的完整验收会调用多个公开用例、真实模型、外部学术 API 和 Runner 作业，因此成本更高；只在确实需要该范围时运行。

最新全自动/详细模式变更已完成上面所述的 `mnist-cnn` 定向真实验证，以及下方 `P0-REGRESSION-032` 记录的多用例端到端回归。

验收脚本会检查容器直连模型配置、学术 API、PostgreSQL、n8n 和证据优先的 Related Work；不会运行无关的通用实验：

```powershell
python scripts/acceptance_test.py
```

建议探针：

| 输入 | 预期行为 |
| --- | --- |
| `AI` | 保持澄清，不得臆造完整研究规格。 |
| PyTorch/CUDA CNN 在 MNIST 上达到 99% | 推断深度学习/计算机视觉，识别为工程基准，默认使用 Terra 层级，并询问研究定位、数据授权、算力和评估约束。 |
| 上述 3D 主动学习 Idea | 创建项目、检索论文，批准后执行受限实验并生成可检查产物。 |

旧版完整验收记录的脱敏副本仍保留在 [`acceptance-20260730-015132.json`](docs/evidence/acceptance-20260730-015132.json) 作为历史证据，不能视为当前自动实验路径。新的定向验收写入被忽略的 `artifacts/acceptance/`，从 API 容器直接使用配置的 Luna/Terra/Sol 路由，验证证据覆盖并验证无关实验计划被拒绝。

## 配置参考

`.env.example` 是可版本化的安全模板。下表覆盖 Compose 和 API 容器使用的用户配置：

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD` | 是 | PostgreSQL 数据库和凭据。使用唯一密码；已有 volume 后修改需要迁移/恢复方案。 |
| `API_DB_USER`、`API_DB_PASSWORD` | 是 | API 专用运行角色；API 不使用 PostgreSQL bootstrap 角色，也不会在启动时执行 Schema DDL。 |
| `N8N_DB_USER`、`N8N_DB_PASSWORD` | 是 | n8n 专用角色，用于 `n8n` Schema。由于 n8n 启动时会执行 `CREATE SCHEMA IF NOT EXISTS`，还需要数据库 `CREATE`；不会获得业务表权限。 |
| `MLFLOW_DB_USER`、`MLFLOW_DB_PASSWORD` | 是 | MLflow 专用角色，并作为独立 `research_os_mlflow` 数据库的 owner。 |
| `MINIO_ROOT_USER`、`MINIO_ROOT_PASSWORD` | 是 | MinIO 管理凭据，MLflow 使用它把产物保存到 `research-artifacts`。 |
| `N8N_ENCRYPTION_KEY` | 是 | 必须长期保持不变的 n8n 加密密钥；丢失后已存凭据可能无法解密。 |
| `N8N_LOCAL_OWNER_EMAIL`、`N8N_LOCAL_OWNER_PASSWORD` | 自动登录必需 | 仅供 `/api/n8n/open` 使用的本地 Owner，密码只在服务端使用，不渲染到页面。 |
| `RESEARCH_LLM_PROVIDER`、`MODEL_REQUEST_TIMEOUT_SECONDS` | 是 | 必须为 `openai`；API 容器直连配置的提供方，调用失败直接返回错误。 |
| `RESEARCH_MODEL_SIMPLE`、`RESEARCH_MODEL_URL_SIMPLE`、`RESEARCH_MODEL_KEY_SIMPLE`、`RESEARCH_REASONING_SIMPLE` | 是 | 独立的 Luna 简单层，默认 `gpt-5.6-luna`/`low`。 |
| `RESEARCH_MODEL_MEDIUM`、`RESEARCH_MODEL_URL_MEDIUM`、`RESEARCH_MODEL_KEY_MEDIUM`、`RESEARCH_REASONING_MEDIUM` | 是 | 独立的 Terra 中等层，默认 `gpt-5.6-terra`/`medium`。 |
| `RESEARCH_MODEL_COMPLEX`、`RESEARCH_MODEL_URL_COMPLEX`、`RESEARCH_MODEL_KEY_COMPLEX`、`RESEARCH_REASONING_COMPLEX` | 是 | 独立的 Sol 复杂层，默认 `gpt-5.6-sol`/`high`。 |
| `MODEL_SETTINGS_PATH` | Compose 内部 | 可写的 `runtime/model-settings.json` 挂载路径；网页保存 key，读取接口只返回 `key_configured`。 |
| `RESEARCH_ROUTER_SIMPLE_MAX`、`RESEARCH_ROUTER_MEDIUM_MAX` | 是 | 确定性复杂度分数边界，默认 `2` 与 `7`。 |
| `GITHUB_TOKEN`、`GITLAB_TOKEN` | 可选 | 提高提供方 API 配额；仓库结果在交叉验证前仍只是候选。凭据只由 API 容器读取，不挂载给 n8n 或 Runner。 |
| `SEMANTIC_SCHOLAR_API_KEY` | 可选 | Semantic Scholar 的可选配额凭据。 |
| `RUNNER_SHARED_SECRET`、`RUNNER_MAX_SECONDS` | 是 | API 到 Runner 的凭据和受限任务最大执行时间。 |
| `RUNNER_IMAGE_DIGEST` | 发布必需；本地可用占位值 | 期望的不可变 Runner 镜像 digest，例如 `sha256:<64 位十六进制字符>`。本地开发的 `unavailable` 会被记录为未核验，不能作为发布身份。 |
| `RESEARCH_OS_COMMIT` | 发布必需；本地可自动探测 | 每次运行记录的 Research OS 完整 40 位 Git commit。容器部署应显式设置；宿主机 API 可自动探测仓库 commit。 |
| `REPORT_TIMEZONE` | 是 | n8n 定时与报告时区，默认 `Asia/Shanghai`。 |
| `REPORT_NOTIFICATIONS_ENABLED`、`REPORT_WEBHOOK_URL`、`REPORT_WEBHOOK_SECRET`、`REPORT_WEBHOOK_TIMEOUT_SECONDS` | 可选，默认关闭 | 报告请求显式传 `notify=true` 时可发送一次 HTTPS webhook；URL 无效、服务不可用或发送失败都会返回结构化错误，不尝试备用通道。 |

`DATABASE_URL`、`MIGRATION_DATABASE_URL`、`RUNNER_URL`、`MLFLOW_TRACKING_URI`、`PROJECTS_ROOT`、`ARTIFACTS_ROOT` 与固定 n8n webhook URL 等内部变量由 `docker-compose.yml` 生成，不应作为用户侧 Secret 暴露。一次性的 `db-migrate` 服务负责创建三个运行角色并执行版本化 Alembic migration，然后 API、n8n 和 MLflow 才会启动。

## 存储与谱系

```text
projects/<project-slug>/       Git 仓库、配置、BibTeX、LaTeX、检查点
artifacts/                     Runner 产物、验收 JSON、受控日志
                               reproducibility/<project_id>/<run_id>/ 快照
PostgreSQL                     项目、Idea 版本、论文、证据、任务、实验、
                               Proposal、策略、反馈、检查点、产物、依赖与审计
MinIO volume                   MLflow 产物仓库与大型实验文件
Docker volumes                 postgres-data、minio-data、n8n-data
```

每个生成产物应携带或可查询到 `project_id`、`idea_version`、实验/Run ID、Git commit、数据版本、配置、MLflow Run ID、SHA-256 与有效性/依赖状态。结果失效时，UI 会保留记录并标记无效，而不是静默继续使用。

每次提交的 Run 还会有一个受控可复现包：带注释的 `run/<run_id>` tag、`source.tar`、ProjectSpec、策略、有效配置、环境报告、数据/模型清单、依赖锁文件哈希和顶层 `snapshot.json`。数据库保存 URI、大小、SHA-256、有效性与 `artifact_dependencies`；大文件和备份留在 Git 之外。Runner 执行前会再次检查 tag、干净工作树、快照哈希和镜像身份。要达到发布级声明，仍需配置 `RUNNER_IMAGE_DIGEST` 并完成完整实时验收。

## 安全模型

- 所有公开 Compose 端口仅绑定 `127.0.0.1`；启用自动登录时禁止改成 `0.0.0.0`。
- Runner 使用非 root、只读根文件系统、drop capabilities、`no-new-privileges`、PID/CPU/内存限制、超时/取消与枚举任务类型。
- LLM 输出只接受受限 JSON，永远不能直接变成任意 Shell、SQL、文件路径或无限制网络访问。
- n8n 设置 `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`；内置工作流只访问固定 Compose 私有地址，Code 节点不能读取 Secret。
- 高成本工作、代码/配置/LaTeX、依赖安装、覆盖/删除、合并和对外发布必须经过 Proposal → diff/影响 → 明确批准 → 隔离执行 → 验证 → Git/审计。
- 学术来源遵守 HTTPS/域名白名单、合法 API、超时、错误记录和速率限制。标题相似不等于官方仓库，只有 DOI 元数据也不等于全文证据。
- 禁止提交 `.env`、Codex `auth.json`、Cookie、数据库备份、Runner/MinIO Secret 或含敏感输入的 Bridge 日志。

完整加固清单和本地自动登录信任边界见 [docs/security.md](docs/security.md)。

## 日常运维

```powershell
# 启动已有镜像和容器；这是日常使用的命令。
docker compose up -d

# 只有镜像输入发生变化时才重建受影响服务。
docker compose up -d --build api runner runner-launcher mlflow

# 修改了挂载的 n8n 工作流时重新创建 n8n 容器，不重建镜像。
docker compose up -d --force-recreate n8n

# 状态与日志
docker compose ps
docker compose logs --tail=100 api runner n8n

# 停止但保留容器和 volume
docker compose stop

# 删除容器和网络，保留命名 volume
docker compose down

# 校验 Compose 与文档同步契约
docker compose config --quiet
python scripts/check_docs_sync.py
```

完整交接说明见 [docs/operations.md](docs/operations.md)，其中包含 n8n Owner 重置、备份/恢复、项目状态闸门、服务恢复和验收证据。架构和工具边界见 [docs/architecture.md](docs/architecture.md) 与 [schemas/tool-contracts.json](schemas/tool-contracts.json)。

### 备份概要

升级前备份 PostgreSQL、`projects/`、`artifacts/` 与 Docker 命名 volume。本地 SQL 备份示例：

```powershell
New-Item -ItemType Directory -Force artifacts\backups | Out-Null
docker compose exec -T postgres pg_dump -U research -d research_os > artifacts\backups\research_os.sql
```

数据库备份可能包含哈希、元数据或凭据材料，必须保留在本地并妥善保护。只在已停止/隔离的实例中核对目标 volume 与凭据后恢复。MinIO 与 n8n 的命名 volume 也必须备份，详见 [docs/operations.md](docs/operations.md)。

## 验证与开发

```powershell
# 快速校验
docker compose config --quiet
python scripts/check_docs_sync.py
python -m py_compile apps/api/app/main.py apps/runner/app/main.py scripts/acceptance_test.py

# 容器测试
docker compose exec -T api pytest -q

# 前端聊天状态回归（不调用模型/API）
node --test scripts/test_chat_ux.mjs

# 完整端到端验收（调用真实模型/API）
python scripts/acceptance_test.py
```

本仓库把验收 JSON 与页面截图作为证据。单元测试通过或端点返回 HTTP 200，并不等于原始科研目标已经被科学复现。

## 常见问题排查

| 现象 | 检查项 |
| --- | --- |
| Docker 提示 Linux engine 不可用 | Docker Desktop → Settings/General → 启用 WSL2 backend，切换到 Linux containers，然后运行 `docker info`。 |
| API 已启动，但 Idea 澄清失败 | 检查三个模型 URL/key、`RESEARCH_LLM_PROVIDER=openai`、设置接口的 `key_configured` 状态和 `docker compose logs api`。API 会返回结构化模型错误，不生成降级回复。 |
| n8n 要求输入密码 | 从 Research OS 侧边栏或 `/api/n8n/open` 打开；确认 `.env` Owner 与 n8n 数据库一致。不要关闭用户管理。 |
| n8n 自动登录返回 503/401 | 确认 n8n 正常、Owner 密码至少 12 位、`N8N_INTERNAL_URL` 为 `http://n8n:5678`，然后重启 `api n8n`。 |
| webhook 返回 404 | 确认三个内置工作流均为 Active；修改工作流 JSON 后需要重新创建 n8n 容器。 |
| 报告推送失败 | 默认保持关闭；启用后检查 HTTPS URL、超时、目标响应和 `REPORT_NOTIFICATIONS_ENABLED=true`。API 不尝试其他通道。 |
| 检索论文数量较少 | 检查 `provider_errors`；外部 API 可能限流或不返回 DOI，系统只记录缺失，绝不伪造结果。 |
| Runner 请求被拒绝 | 查看结构化策略错误与待审批 Proposal；暂停/取消状态和随机种子不足都是强制闸门。 |
| Runner 请求被快照闸门拒绝 | 查看 `project_worktree_dirty`、`git_policy_violation`、`project_source_missing` 或 `snapshot_manifest_missing` 等结构化错误；提交源代码/配置、移除被禁止的大文件，并保持项目 Git 工作树干净后重试。 |
| 产物下载 404 | 检查 `valid` 状态与 `artifacts/` 路径。失效产物会保留元数据，但不得继续使用。 |
| Windows 文件权限看起来异常 | API 拥有可写项目/产物挂载；Runner 以只读方式挂载项目，只能写受控产物。 |

## 路线图与真实边界

已批准变更的实体级依赖失效、可审阅影响图、局部重跑建议和批准后的自动检查点提交已实现；影响图会为可安全恢复的终态实验自动创建待审批 Proposal，不会自动执行或切换为无关实验。主题固定入口和通用隔离作业已经接入，真实 GPU 主机验证仍属于路线图。

主题专属实验规划已经实现为证据绑定、策略校验和审批门控的 Proposal；批准计划会通过固定 `experiment/main.py` 入口执行，并要求结构化指标与检查点产物。系统不会回退到无关的分类或点云 demo。

最重要的未完成项记录在 [`TODO.md`](TODO.md)：需审批的多用例澄清回归、聊天超时/键盘测试、证据驱动 Related Work/新颖性分析、真实 GPU 主机验证、持久队列、更完整的材料解析、交互式 3D 查看器、完整证据驱动 LaTeX 写作，以及单 EXE 安装器的签名与干净 VM 验收。固定主题 `experiment/main.py`、受控 Python、固定 micromamba/Conda Python、C++/CMake 和白名单 GPU 请求已通过每 Run 独立容器与硬上限输出 volume 执行。批准后的检查点重跑只通过匹配的白名单提交链自动进入队列；失败仍直接保留结构化错误，不会改用无关演示实验。确定性日报/周报已经包含运营指标，并可在启用后显式推送一次 HTTPS webhook。官方仓库/许可证核验和受控固定 commit 下载已实现并保留审批闸门；已批准变更的实体级依赖失效和局部重跑建议也已实现。RAGFlow/LlamaIndex 与 LangGraph 会等到数据规模或流程复杂度确实需要时再引入。

不要把当前合成分类/点云任务当作科学结果，不要把 `metadata-only` 当作页码已核验引用，也不要把本地自动登录入口暴露到个人电脑之外。

## 贡献与文档同步契约

修改代码或工作流前先阅读 [`AGENTS.md`](AGENTS.md)。每次重大更新必须在同一个变更集中同步更新：

1. 实际行为/配置与相关 `docs/` 页面；
2. `.env.example` 或其他配置示例；
3. `README.md` 与 `README.zh-CN.md`，保持事实与章节顺序一致；
4. `TODO.md` 的状态、完成标准与验证证据；
5. 当原始需求覆盖变化时更新需求审计。

交付前运行 `python scripts/check_docs_sync.py`。该脚本会检查共享文档版本标记、验收项目事实、必要截图，以及两份 README 中的关键模型与端口描述。

重大更新通过全部适用检查后，项目维护契约要求自动创建范围明确的 Conventional Commit，并把当前分支推送到已授权的 `origin`。自动化必须复核暂存 diff，并排除 `.env`、认证文件、Cookie、数据库备份、Secret、临时输出和未经审查的大型产物；禁止 force push 或改写远程历史。

## 许可证与来源政策

本仓库是面向私有/本地科研编排的 MVP 脚手架。下载、执行或再分发任何外部论文、数据集、模型与代码前，必须单独核查许可证。系统可以记录来源 URL 和候选元数据，但不会自动授予第三方材料使用权。
