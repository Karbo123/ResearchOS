# 原始需求实现审计（2026-07-28）

## 结论

2026-07-30 影响传播增量：Proposal 创建和审批现在按 `ArtifactDependency` 计算 Idea、策略、代码、数据和产物删除变更的依赖后代，只使受影响的有效产物失效，并记录关联实验、检查点和局部重跑候选。检查点局部重跑 Proposal 仅允许成功/失败终态检查点，重建原白名单配置和持久化随机种子；批准后自动通过现有受控实验提交链，失败保留结构化错误。主题专属 Runner 尚未实现时仍直接返回未实现错误，无关演示实验不会作为替代路径。

当前仓库是可运行、可审计的 Research OS MVP，不是原始需求的完整实现，更不能称为生产级或“完美实现”。核心闭环已经真实跑通，但完整论文证据链、官方代码复现、通用计算执行、主题专属 Runner、规则自动执行和外部通知仍未完成。

## 本轮真实验收

- 配置来源：API 容器从 `.env` 或挂载的 `runtime/model-settings.json` 读取三个独立层级的模型 URL、model、key 和 reasoning effort；运行时代码不读取宿主机 Codex 配置目录或 `auth.json`
- 模型路由：`gpt-5.6-luna/low`、`gpt-5.6-terra/medium`、`gpt-5.6-sol`/`high`
- Windows Bridge：不再是运行依赖；Windows 不启动模型服务，API 容器直接调用配置的模型 URL
- 结果文件：`artifacts/acceptance/acceptance-20260730-015132.json`
- 脱敏证据：`docs/evidence/acceptance-20260730-015132.json`
- 测试项目：`6d91ff49-12a5-406c-b7aa-cb96aa3f22e4`
- 结果：全部自动验收断言通过

实际生成了 8 篇带 DOI/BibTeX 的文献记录，其中 3 篇开放 PDF 完成哈希、页码原文和证据入库；本次检索未命中代码仓库候选。验收验证了策略执行、暂停/恢复与取消终态、Idea v2、局部重跑、MLflow、PNG/PLY 产物和 LaTeX 编译，并记录 12 个检查点和 416 条实体依赖。合成实验指标只证明系统集成链可运行，不能证明研究假设成立。

额外定向测试结果：

- `AI`：保持在 `clarifying`，不臆造完整研究规格。
- PyTorch/CUDA CNN + MNIST 99%：网页 API 选择 `medium / gpt-5.6-terra / medium`，主动识别深度学习/计算机视觉与工程基准定位，不再固定询问“哪个领域”；浏览器验证等待进度、输入锁定、完成恢复和模型元数据，容器测试 17 项通过。
- 未授权恶意软件 Idea：该能力已按用户要求于 2026-07-29 移除（idea 安全/合规审查阻断不再保留），仅作历史记录留档。
- 附件上传：PDF、JSON、CSV/TSV、UTF-8 文本/代码、图片元数据和 ZIP 清单通过 MIME、50 MB 大小、路径、SHA-256、解析上限和安全归档检查后持久化；摘要会在上传成功后进入澄清与主题规划，图片不做 OCR，ZIP 不解压或执行，失败直接阻止模型请求。
- 暂停/恢复：暂停会阻止检索、计划和 Runner 提交，取消活动任务并记录检查点；恢复从暂停检查点继续，cancelled 为不可恢复终止状态。
- 长期规则：通过对话或策略页生成 Proposal、批准后写入 PostgreSQL；“至少五个随机种子”会生成 5 种子计划，3 种子旧 Proposal 返回结构化 409，并由 Runner 二次校验。
- 数据库：18 张业务表；测试项目保存 3 条页码级全文 evidence、3 个 PDF SHA-256 和 Git 证据 JSON；本次检索没有命中代码候选，官方验证记录仍为 0。
- PNG 抽查：准确率曲线、混淆矩阵和点云预览均为有效非空图像。

2026-07-29 澄清交互增量：新项目聊天增加严格的 `automatic|detailed` 模式，默认全自动并尽量减少追问，详细模式根据真实缺口扩大了解范围；两者均禁止固定问卷。测试 Idea、后续确认事实和项目对话输入统一迁移到 `tests/idea-cases/*.json`，严格加载器拒绝未知字段、路径覆盖和运行时注入。完整多用例回归已登记为 `P0-REGRESSION-032`。

2026-07-30 完整端到端回归增量（历史运行）：`P0-REGRESSION-032` 当时使用宿主 Bridge、外部学术 API、PostgreSQL、n8n、Runner 和 MLflow 完成验收；新报告验证了 8 条论文记录、3 条全文证据、12 个检查点和 416 条依赖，结果已保存到被忽略的运行时报告并归档脱敏副本。该报告只代表当时的历史运行，当前运行路径已改为 API 容器直连模型。

2026-07-29 可复现快照增量：`P0-REPRO-026` 已接入本地实验提交和 Runner 执行门禁。批准实验要求项目 Git 工作树干净、Git 文件扩展名/目录/10 MB 大小门禁通过，并创建不可变 `run/<run_id>` tag；受控 `artifacts/reproducibility/<project_id>/<run_id>/` 保存 `source.tar`、ProjectSpec、策略、有效配置/随机种子、环境、数据/模型清单、依赖锁文件哈希和 `snapshot.json`。API 与 Runner 各校验一次，PostgreSQL 写入 `Artifact`/`ArtifactDependency`/`Checkpoint` 谱系，并提供 `/api/experiments/{run_id}/reproducibility` 查询和源码下载入口。本批次已完成真实实验验收：`RUNNER_IMAGE_DIGEST` 和 `RESEARCH_OS_COMMIT` 已配置真实值、Runner 非 root Git 门禁修复、`demo_classification` 实验真实提交并成功执行（accuracy=0.8467），快照谱系完整持久化。任务标记完成。

2026-07-30 流式澄清状态增量：`P1-STREAM-038` 已实现 `POST /api/chat/stream`。该接口和前端只报告可审计的应用阶段（读取对话、路由选择、准备请求、调用模型、保存结果）、结构化错误和最终结果；不得输出、声称、推断或伪造模型内部思维链。项目创建仍由服务端以 `ready_for_confirmation` 严格闸门保护，未完成规格返回冲突。API/SSE、同步端点、项目创建闸门、公开 Idea case 来源、桌面/窄屏浏览器与控制台检查均通过；本轮未调用真实模型或外部学术 API。

2026-07-30 自适应澄清回归增量：`P0-CLARIFY-027` 已完成。公开四用例真实回归覆盖简单/中等/复杂路由、自动/详细模式、确认事实收敛与两个并发 MNIST 会话。3D active-learning 现在稳定进入 `complex / gpt-5.6-sol / high`；模型填写“未确认/unknown”等数据或资源占位时，服务端仍保持 `clarifying`。模型服务不可用时返回结构化错误，没有本地降级或 provider 切换。

## 当前模型与实验范围更新

- 模型调用改为 API 容器直连三个独立配置的 OpenAI-compatible URL；Windows Codex Bridge 不再是运行依赖，也不读取 Codex 配置目录。
- LLM 调用失败直接返回结构化 API 错误；禁止本地降级、provider 切换和规则回复。
- 原有通用分类/点云演示实验计划不属于用户 Idea，已移除自动生成路径。主题专属规划现已实现为严格的证据绑定 Proposal：生成前要求当前 ProjectSpec 和页码级全文证据，计划包含数据源、基线、指标、消融、统计检验、随机种子、资源预算、风险和成功标准；审批后执行会再次校验当前 Idea/证据/策略。当前 Runner 尚无主题专属执行模板，返回 `topic_specific_runner_not_implemented`，绝不回退到无关 demo。
- Windows 安装器已同步为只启动 Docker Compose，不再打包或启动 Bridge；前端不再显示会请求通用实验计划的操作按钮。
- Related Work 当前只生成证据覆盖、研究空白候选和重复研究候选；metadata-only 文献不能进入事实性证据，所有候选均要求人工复核。

## Runner 隔离增量（2026-07-30）

- Runner supervisor 现在通过唯一的 `runner-launcher` 服务为每个 Run 创建新的非 root 作业容器；launcher 使用固定镜像、固定 `python -m app.worker` 入口、固定内部网络、受控继承挂载和模板级 CPU/内存/PID 限制，Runner supervisor/API 不挂载 Docker socket。
- Launcher/Runner 任务契约拒绝任意 command、path、URL、network、image 和 environment 字段；监控器负责容器超时、取消和无终态退出的结构化错误。每 Run 使用带硬大小上限的 Docker tmpfs 输出 volume，终态同步产物后删除 job container 与 volume；Linux 单文件 `RLIMIT_FSIZE` 与运行目录累计检查仍作为第二道边界。
- 当前已是每 Run 独立容器，已完成受控 Python、C++/CMake 和 GPU 请求模板；Conda、主题专属 Runner 和真实 GPU 主机验证仍未完成，`P0-RUNNER-007` 继续保持部分实现。未运行与当前用户主题无关的分类/点云实验，也没有把它们作为主题计划的替代路径。

## 逐项覆盖

| 原始能力 | 判定 | 实际状态 |
|---|---|---|
| Docker Compose 私有化部署 | 已实现（MVP） | PostgreSQL、n8n、API、Runner、MLflow、MinIO 均可启动，Web 端口仅绑定 `127.0.0.1`。 |
| 初始聊天、多轮澄清、ProjectSpec | 已实现（自适应 MVP） | 每轮 AI 整体更新草稿、推断明显领域并公开假设；默认全自动模式只问阻塞性关键信息，详细模式按相关缺口扩大了解范围，均不使用固定问卷；Luna/Terra/Sol 分级路由和严格 Pydantic/JSON Schema 已通过四公开用例真实回归、收敛和并发验证。模型失败返回结构化错误，不切换 provider、不生成规则回复、不写入助手消息。未确认数据/资源占位不能绕过确认闸门。流式状态仅限应用可观察阶段与最终结构化结果，绝不暴露或伪造模型思维链；API/SSE、公开用例来源和浏览器验收已通过。信息不足不创建项目。测试输入只来自公开 `tests/idea-cases`。 |
| 文件、论文、图片、数据、代码上传 | 部分实现 | 已解析受限 PDF、JSON、CSV/TSV、文本/代码并把摘要用于澄清/规划；图片仅元数据、ZIP 仅安全清单，未实现 OCR、完整多模态理解、独立恶意样本扫描或大规模材料库。 |
| 确认后项目初始化 | 已实现 | 创建 UUID、Git、工作目录、Idea v1、数据库记录、文献/实验/论文目录和检查点，并触发 n8n。 |
| 可行性、重复、资源风险 | 部分实现 | 不可行/资源不足目标会保持在澄清或标为中等可行性；资源字段会澄清；重复研究与创新性只能做 DOI 元数据级初筛。（2026-07-29：危险/未授权目标阻断已按用户要求移除。） |
| 多源论文与 BibTeX 检索 | 部分实现 | Crossref、OpenAlex、Semantic Scholar、arXiv、DBLP 和 DOI BibTeX 已接入；没有 GitLab 和通用网页检索。 |
| PDF、引用关系、页码原文证据 | 部分实现 | 开放 PDF allowlist 下载、哈希、pypdf 页码 quote、BibTeX、Artifact/Dependency、Git JSON 已用 3 篇论文验证；尚未构建引用关系图，也未完成 claim 到多证据的语义核验。 |
| 官方代码、数据集、模型与主页定位 | 部分实现 | GitHub/GitLab 先生成候选；API 已能读取提供方元数据、项目论文记录和仓库 `CITATION.cff`/README，要求 DOI 或完整标题形成显式双源匹配。作者主页、数据集和模型定位仍不是通用能力。 |
| 代码许可审查与受控下载 | 已实现（需审批） | 已知 SPDX、40 位 commit 和 `verified_official=true` 才能创建 `dependency_install` Proposal；批准后下载受限归档，拒绝路径穿越/链接/特殊文件，记录下载时间、URL、SHA-256、论文关系并提交项目 Git。未知许可证、未验证候选和未批准 Proposal 均不能触发网络下载。 |
| 文献综述、研究空白、新颖性判断 | 部分实现 | 端点会明确拒绝仅凭元数据作强结论；尚不能生成全文证据支撑的 Related Work 或可靠研究空白。 |
| Idea 专属实验与统计计划 | 部分实现 | API 已按当前 ProjectSpec、页码级全文证据和策略生成绑定 Idea 版本的结构化计划 Proposal，并经过审批/二次校验；主题专属 Runner 执行模板尚未完成，不会使用固定合成 demo。 |
| Python/C++/Conda/CMake/LaTeX Runner | 部分实现 | HTTP 异步 Runner、非 root、白名单、只读项目挂载、六个固定模板、硬上限输出 volume、超时、取消、日志、受控 Python/CMake 和 GPU 请求、LaTeX 已实现；Conda、主题专属模板和真实 GPU 主机验证未完成。 |
| 实验可复现快照与 Git 大文件门禁 | 已实现（MVP 已完成） | 干净工作树、不可变 run tag、源码 tar、ProjectSpec/策略/配置/环境/数据/模型/依赖 manifest、SHA-256、API/Runner 双重校验和 Artifact/Dependency/Checkpoint 谱系已接入；`RUNNER_IMAGE_DIGEST` 与 `RESEARCH_OS_COMMIT` 已配置真实值；Run `26103a27` 真实实验（demo_classification）已验证完整快照持久化，实验成功执行（accuracy=0.8467）。Runner 非 root Git 门禁已修复。 |
| 数值分析与失败诊断 | 部分实现 | Python 计算均值、标准差、混淆矩阵并写 MLflow；没有面向任意日志/CSV/多模态结果的自动诊断闭环。 |
| PNG/PLY/PDF 产物及谱系 | 部分实现 | 真实生成、预览/下载，并关联实验、Idea 版本、Git、数据版本和 MLflow；PLY 只有 PNG 预览，没有交互式 3D/PCD/网格查看器。 |
| 实验跟踪 | 部分实现 | 自托管 MLflow + MinIO 可用，记录参数、种子、Git、数据版本、指标和产物；真实验收已验证配置的 Runner digest 与 Research OS commit 进入快照谱系；没有 W&B/TensorBoard、GPU 轨迹或连续资源曲线。 |
| PostgreSQL/Git/大文件持久化 | 已实现（MVP） | 18 张 SQLAlchemy 表覆盖状态源；Git 管理文本和 manifest，受控 artifacts 保存源码 bundle/大文件元数据，MLflow artifact 使用 MinIO，快照通过 Artifact/Dependency 建立谱系。缺少正式迁移工具和细粒度数据库角色。 |
| 日报/周报与推送 | 部分实现 | n8n 每日/每周定时生成报告并存入 Web UI；未接入飞书、Slack、Telegram、邮件，也不完整统计资源/API 成本和关键 Agent 决策。 |
| 同一项目对话监督 | 部分实现 | 对话、反馈、解释/建议与变更分类可持久化；新项目和项目监督聊天支持等待阶段、重复提交锁定、Ctrl/Cmd+Enter 提交及超时/断线后重试；分类主要靠关键词，不是健壮的结构化意图模型。 |
| Proposal、diff、审批、审计 | 部分实现 | 实验、Idea 修订、配置和 LaTeX 有两阶段流程；代码补丁、依赖安装、删除、外发只有契约/提案模型，没有完整执行器。 |
| 长期项目策略 | 已实现（MVP） | 可通过审批写入 `policies`，不依赖聊天历史；中英文种子、引用证据和高成本/对外审批规则会结构化显示，种子规则在计划、API 提交和 Runner 三处执行。其他自由文本规则仍需扩展解析器。 |
| Idea 版本、影响分析与局部重跑 | 部分实现 | Idea v2、审计、检查点、实体级依赖失效和需审批的检查点局部重跑 Proposal 已实现；批准后会自动提交原白名单重跑并记录失败；主题 Runner 和完整语义级失效仍未完成。 |
| n8n AI Agent 和高层子工作流工具 | 部分实现 | 3 个激活工作流负责聊天网关、主流程和报告；多数工具是受限 FastAPI 端点，不是独立 n8n 子工作流，也未使用 n8n AI Agent 长循环。 |
| 严格 JSON、双重校验、Shell/路径隔离 | 已实现（MVP） | API 与 Runner 使用 Pydantic `extra=forbid` 和白名单；LLM 不接触任意 Shell/SQL/路径，n8n 节点不能读取容器环境变量。 |
| Related Work 与完整论文自动写作 | 未实现 | 只生成最小 LaTeX 模板并受控编译 PDF；Related Work 明确是占位文字，没有证据驱动的完整论文撰写。 |
| 项目暂停、恢复与取消 | 已实现（MVP） | 状态是后端强制闸门；暂停阻止新检索/计划/Runner 提交并取消活动任务，恢复使用暂停检查点，cancelled 不可恢复；完整验收和浏览器交互已验证。 |
| 长期运行与生产可靠性 | 部分实现 | Compose restart、n8n 重试、Runner 状态落盘、中断恢复和项目状态闸门可用；没有持久队列、HA、每任务独立容器、磁盘配额和默认拒绝出网。 |
| Windows 单 EXE 安装 | 部分实现 | 已有 Inno Setup 在线引导安装器、自动 Secret、官方 Docker 下载签名校验和 Compose/n8n 自动启动；当前不打包或启动 Windows Bridge。尚未生成签名发布 EXE，也未完成干净 VM、升级/卸载和 Docker 许可验收。 |

2026-07-30 代码来源可信链增量：`P0-CODE-003` 已实现候选仓库的 GitHub/GitLab 元数据、论文记录与 `CITATION.cff`/README 双源匹配，保存已知 SPDX、40 位 commit 和验证来源；未知许可证、未固定 commit、未验证候选或未批准 Proposal 均不能触发下载。批准后仅下载受限归档，拒绝路径穿越、符号链接和特殊文件，写入 SHA-256、下载时间、论文关系和项目 Git 提交。作者主页/数据集/模型的通用定位仍未实现；本增量已完成测试和文档同步，`P0-CODE-003` 标记为 `[x]`。

2026-07-30 Runner 隔离增量：`P0-RUNNER-007` 新增唯一 Docker launcher 和每 Run 独立非 root 作业容器；固定镜像、入口、内部网络、受控挂载、CPU/内存/PID/超时/取消和白名单契约均由容器内代码执行。累计目录配额、Linux `RLIMIT_FSIZE` 单文件上限和结构化超限错误继续保留；真正 volume 级磁盘配额、GPU、通用 Python/C++/Conda 仍未实现，任务保持 `[~]`。
2026-07-30 Runner 模板/配额增量：`P0-RUNNER-007` 增加固定入口的 Python、固定 CMake target 的 C++ 和 Docker GPU 请求模板；每 Run 改用带硬大小上限的 tmpfs 输出 volume，终态同步产物后清理 job container 与 volume。Runner `6 passed`、launcher 普通/真实 Docker 集成各 `8 passed`、API `57 passed`，集成后无 managed volume 残留。Conda、主题专属 Runner 和真实 GPU 主机验证仍未完成；未调用模型、外部学术 API 或无关实验。

## 关键风险

1. UI 已区分元数据记录与页码原文证据；但自动提取 quote 仍需在 Related Work 阶段把具体事实性 claim 精确映射到 evidence ID，不能仅因论文已有全文证据就宣称任意结论成立。
2. 合成实验只能验证系统编排和产物链，不能证明用户研究 Idea 的科学结论。
3. 未识别的自由文本策略会明确标为人工规则；只有结构化显示为 enforced 的约束才会自动执行。
4. n8n 自动登录仅适用于本机个人部署；任何能访问本机端口的进程都可能进入控制面，不能暴露到局域网或公网。
5. Runner 镜像 digest 与 Research OS commit 已在本地真实验收中验证并进入快照谱系，但这不等于完成发布级镜像签名、外部环境复现或生产可靠性验收。

## 达到原始目标仍需完成

优先级最高的是官方代码验证与许可后下载、主题专属 Runner 执行模板和通用隔离作业、语义依赖失效/自动检查点恢复、外部通知，以及完整证据驱动论文生成。主题专属计划本身已完成生成与审批门控，但在 Runner 模板完成前不得声称实验已执行。完成其余能力之前，系统应继续标记为 MVP。
