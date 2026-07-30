# 原始需求实现审计（2026-07-28）

## 结论

2026-07-30 影响传播增量：Proposal 创建和审批现在按 `ArtifactDependency` 计算 Idea、策略、代码、数据和产物删除变更的依赖后代，只使受影响的有效产物失效，并记录节点/边影响图、关联实验、检查点和局部重跑候选。影响分析现在使用显式变更类型契约；未知类型、缺少基准 Git/数据版本、缺少删除目标或目标不属于当前项目时直接返回结构化 `impact_*` 错误，不把未知根默认为 `current`。批准变更后，API 会为可安全恢复的终态检查点自动创建待审批 `experiment_rerun` Proposal；Proposal 仅允许成功/失败终态检查点，重建原白名单配置和持久化随机种子，仍需人工批准后才通过匹配的受控实验提交链，失败保留结构化错误。主题专属重跑同样只复用固定入口、原结构化计划和检查点状态，不会改用无关演示实验。

2026-07-30 patch 执行增量：新增结构化代码/配置/LaTeX patch Proposal，绑定项目 Git commit 与文件 SHA-256，生成确定性 diff；批准时复制到临时隔离目录，执行固定 Python/JSON/TOML/LaTeX 校验，再二次核对工作区、写回并提交 Git。暂存、写入、冲突、验证失败和提交失败会恢复原文件并保留结构化错误；成功 patch 可创建新的审批回滚 Proposal，回滚只使用固定 `git revert --no-edit`。外部发布明确禁用。patch 执行器与 API 路由测试 `12 passed`，完整 API 回归 `96 passed, 2 skipped`。

2026-07-30 论文草稿增量：项目概览新增“生成证据论文草稿”入口。`POST /api/projects/{project_id}/paper-draft` 只接受当前 Idea、页码/章节定位和非空 quote 的已核验证据，并只写入真实成功实验指标；metadata-only、缺失证据和未执行结果不会进入事实性论文内容。接口仅创建绑定 Idea 版本和 evidence IDs 的 `paper/main.tex` LaTeX patch Proposal，必须经现有 diff、审批、隔离验证和 Git 执行链；证据不足直接返回结构化错误。完整 Related Work、语义 claim 映射和生产级论文编译验收仍未完成。

2026-07-30 Artifact 预览增量：新增受限 `/api/artifacts/{artifact_id}/preview`，网页产物页现在可以显示 JSON/文本/CSV/TSV/PDF，以及不执行 HTML 的转义文本；ASCII PLY/PCD 通过固定点数/面片上限、降采样和 Canvas 拖拽旋转/缩放/重置进行预览，并保留下载入口。二进制点云、失效/缺失文件和解析限制直接返回结构化错误。API 容器 `70 passed, 2 skipped`，Node 语法检查、Compose、文档/Idea case 检查、桌面浏览器产物页和模型设置页检查通过；未调用模型、外部学术 API 或无关实验。

2026-07-30 MLflow 追踪增量：Runner 新增固定频率资源采样器，在活跃 MLflow Run 中记录进程/系统 CPU、内存和固定 GPU 数值查询，并将同一数值时间序列保存为受控 `resource-usage.jsonl`。Run 参数显式记录学习率、模型版本、Git/Research OS commit、镜像 digest、数据版本、种子、平台和网络策略；Runner 状态继续记录终态。GPU 不可用时只记录 `gpu_available=0`，不切换执行路径；采样器不记录 Secret、任意环境或命令输出。Runner 容器 `unittest`（9 tests）、不落盘导入/语法验证和镜像重建通过；未调用模型、外部学术 API 或无关实验。

当前仓库是可运行、可审计的 Research OS MVP，不是原始需求的完整实现，更不能称为生产级或“完美实现”。核心闭环已经真实跑通，但完整论文证据链、官方代码复现、真实 GPU 主机验证、规则自动执行和外部通知仍未完成。

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
- 附件上传：PDF、JSON、CSV/TSV、UTF-8 文本/代码、图片 OCR 和 ZIP 清单通过 MIME、单文件 50 MB、ClamAV 私有扫描、路径、SHA-256、解析上限、会话/项目累计配额和安全归档检查后持久化；摘要会在上传成功后进入澄清与主题规划，ZIP 不解压或执行，扫描/解析/配额失败直接阻止模型请求。
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
- 原有通用分类/点云演示实验计划不属于用户 Idea，已移除自动生成路径。主题专属规划现已实现为严格的证据绑定 Proposal：生成前要求当前 ProjectSpec 和页码级全文证据，计划包含数据源、基线、指标、消融、统计检验、随机种子、资源预算、风险和成功标准；审批后执行会再次校验当前 Idea/证据/策略。主题 Runner 只调用项目固定 `experiment/main.py`，通过固定 JSON 路径传入计划和恢复状态，并要求 `metrics.json` 与 `checkpoint.json`；缺少入口、进程失败或产物不合法直接返回结构化错误，绝不回退到无关 demo。
- Windows 安装器已同步为只启动 Docker Compose，不再打包或启动 Bridge；前端不再显示会请求通用实验计划的操作按钮。
- Related Work 当前只生成证据覆盖、研究空白候选和重复研究候选；metadata-only 文献不能进入事实性证据，所有候选均要求人工复核。

## Runner 隔离增量（2026-07-30）

- Runner supervisor 现在通过唯一的 `runner-launcher` 服务为每个 Run 创建新的非 root 作业容器；launcher 使用固定镜像、固定 `python -m app.worker` 入口、固定内部网络、受控继承挂载和模板级 CPU/内存/PID 限制，Runner supervisor/API 不挂载 Docker socket。
- Launcher/Runner 任务契约拒绝任意 command、path、URL、network、image 和 environment 字段；监控器负责容器超时、取消和无终态退出的结构化错误。每 Run 使用带硬大小上限的 Docker tmpfs 输出 volume，终态同步产物后删除 job container 与 volume；Linux 单文件 `RLIMIT_FSIZE` 与运行目录累计检查仍作为第二道边界。
- 当前已是每 Run 独立容器，已完成固定主题入口、受控 Python、固定 micromamba/Conda Python、C++/CMake 和 GPU 请求模板；真实 GPU 主机验证仍未完成，`P0-RUNNER-007` 继续保持部分实现。未运行与当前用户主题无关的分类/点云实验，也没有把它们作为主题计划的替代路径。

## 逐项覆盖

| 原始能力 | 判定 | 实际状态 |
|---|---|---|
| Docker Compose 私有化部署 | 已实现（MVP） | PostgreSQL、n8n、API、Runner、MLflow、MinIO 均可启动，Web 端口仅绑定 `127.0.0.1`。 |
| 初始聊天、多轮澄清、ProjectSpec | 已实现（自适应 MVP） | 每轮 AI 整体更新草稿、推断明显领域并公开假设；默认全自动模式只问阻塞性关键信息，详细模式按相关缺口扩大了解范围，均不使用固定问卷；Luna/Terra/Sol 分级路由和严格 Pydantic/JSON Schema 已通过四公开用例真实回归、收敛和并发验证。模型失败返回结构化错误，不切换 provider、不生成规则回复、不写入助手消息。未确认数据/资源占位不能绕过确认闸门。流式状态仅限应用可观察阶段与最终结构化结果，绝不暴露或伪造模型思维链；API/SSE、公开用例来源和浏览器验收已通过。信息不足不创建项目。测试输入只来自公开 `tests/idea-cases`。 |
| 文件、论文、图片、数据、代码上传 | 部分实现 | 已接入私有 ClamAV 扫描、受限 PDF、JSON、CSV/TSV、文本/代码和图片 OCR，并执行单文件、会话和项目配额；附件仍是不可信摘要上下文，ZIP 仅安全清单，完整多模态理解和大规模材料库仍未实现。 |
| 确认后项目初始化 | 已实现 | 创建 UUID、Git、工作目录、Idea v1、数据库记录、文献/实验/论文目录和检查点，并触发 n8n。 |
| 可行性、重复、资源风险 | 部分实现 | 不可行/资源不足目标会保持在澄清或标为中等可行性；资源字段会澄清；重复研究与创新性只能做 DOI 元数据级初筛。（2026-07-29：危险/未授权目标阻断已按用户要求移除。） |
| 多源论文与 BibTeX 检索 | 部分实现 | Crossref、OpenAlex、Semantic Scholar、arXiv、DBLP 和 DOI BibTeX 已接入；没有 GitLab 和通用网页检索。 |
| PDF、引用关系、页码原文证据 | 部分实现 | 开放 PDF allowlist 下载、哈希、pypdf 页码 quote、BibTeX、Artifact/Dependency、Git JSON 已用 3 篇论文验证；尚未构建引用关系图，也未完成 claim 到多证据的语义核验。 |
| 官方代码、数据集、模型与主页定位 | 部分实现 | GitHub/GitLab 先生成候选；API 已能读取提供方元数据、项目论文记录和仓库 `CITATION.cff`/README，要求 DOI 或完整标题形成显式双源匹配。作者主页、数据集和模型定位仍不是通用能力。 |
| 代码许可审查与受控下载 | 已实现（需审批） | 已知 SPDX、40 位 commit 和 `verified_official=true` 才能创建 `dependency_install` Proposal；批准后下载受限归档，拒绝路径穿越/链接/特殊文件，记录下载时间、URL、SHA-256、论文关系并提交项目 Git。未知许可证、未验证候选和未批准 Proposal 均不能触发网络下载。 |
| 文献综述、研究空白、新颖性判断 | 部分实现 | 端点会明确拒绝仅凭元数据作强结论；尚不能生成全文证据支撑的 Related Work 或可靠研究空白。 |
| Idea 专属实验与统计计划 | 已实现（受控 Runner） | API 已按当前 ProjectSpec、页码级全文证据和策略生成绑定 Idea 版本的结构化计划 Proposal，并经过审批/二次校验；批准后只执行项目固定 `experiment/main.py`，要求 `metrics.json` 与 `checkpoint.json`，失败不替换为固定合成 demo。 |
| Python/C++/Conda/CMake/LaTeX Runner | 部分实现 | HTTP 异步 Runner、非 root、白名单、只读项目挂载、八个固定模板、硬上限输出 volume、超时、取消、日志、固定主题入口、受控 Python、镜像内固定 micromamba/Conda、CMake 和 GPU 请求、LaTeX 已实现；真实 GPU 主机验证仍未完成。 |
| 实验可复现快照与 Git 大文件门禁 | 已实现（MVP 已完成） | 干净工作树、不可变 run tag、源码 tar、ProjectSpec/策略/配置/环境/数据/模型/依赖 manifest、SHA-256、API/Runner 双重校验和 Artifact/Dependency/Checkpoint 谱系已接入；`RUNNER_IMAGE_DIGEST` 与 `RESEARCH_OS_COMMIT` 已配置真实值；Run `26103a27` 真实实验（demo_classification）已验证完整快照持久化，实验成功执行（accuracy=0.8467）。Runner 非 root Git 门禁已修复。 |
| 数值分析与失败诊断 | 已实现（受限闭环） | `POST /api/projects/{project_id}/diagnostics` 由 Python 计算有限数值指标的 count/mean/population std/min/max，解析结构化失败码和成功但缺失指标的运行；异常会生成去重、只记录证据且不执行的 `diagnostic_suggestion` Proposal，模型只能解释/质疑，不能计算或启动建议。任意日志/CSV/多模态自动推断仍不属于当前能力。 |
| PNG/PLY/PDF 产物及谱系 | 已实现（受限预览） | 真实生成、预览/下载，并关联实验、Idea 版本、Git、数据版本和 MLflow；网页支持 JSON/文本/CSV/TSV/PDF 和转义 HTML 文本，以及固定上限的 ASCII PLY/PCD 点云 Canvas、旋转、缩放、重置和可选网格线框。二进制点云、失效文件和解析限制返回结构化错误；这仍不是完整任意格式 3D 引擎。 |
| 实验跟踪 | 已实现（受限范围） | 自托管 MLflow + MinIO 记录参数、学习率/模型版本、种子、Git、数据版本、镜像 digest、指标和产物；Runner 按固定频率记录进程/系统 CPU、内存和 GPU 数值，并保存 `resource-usage.jsonl`。没有 W&B/TensorBoard；真实 GPU 主机验证仍属于 Runner 任务缺口。 |
| PostgreSQL/Git/大文件持久化 | 已实现（受控 MVP） | 18 张业务表由版本化 Alembic migration 管理；`db-migrate` 在 API/n8n/MLflow 启动前幂等创建独立运行角色。API 只使用业务表 CRUD 权限，n8n 只使用 `n8n` schema，MLflow 使用独立数据库；Git 管理文本和 manifest，受控 artifacts 保存源码 bundle/大文件元数据，MLflow artifact 使用 MinIO，快照通过 Artifact/Dependency 建立谱系。正式备份轮换、恢复演练和更细的生产网络隔离仍属于 P2 运维范围。 |
| 日报/周报与推送 | 已实现（受限范围） | n8n 每日/每周定时生成确定性运营报告并存入 Web UI，覆盖文献/证据/代码候选、实验状态、已报告资源与成本、产物、审计决策和待审批项；可通过默认关闭的 HTTPS webhook 在显式 `notify=true` 请求中推送。未实现特定飞书、Slack、Telegram 或邮件 SDK，缺失的 provider 成本不会被猜测。 |
| 同一项目对话监督 | 已实现（受限范围） | 对话、反馈、解释/建议与变更分类可持久化；新项目和项目监督聊天支持等待阶段、重复提交锁定、Ctrl/Cmd+Enter 提交及超时/断线后重试；已有项目消息由容器内模型返回严格 `SupervisionIntent`，Idea/策略变更仍需 Proposal 审批，状态/审批意图不从聊天直接执行。模型失败直接返回结构化错误。 |
| Proposal、diff、审批、审计 | 已实现（受控范围） | 实验、Idea 修订、策略、代码/配置/LaTeX patch 和依赖安装具有 Proposal/diff/审批/审计路径；patch 执行器只接受结构化文件操作，在临时隔离目录验证后提交 Git，覆盖冲突、失败恢复、覆盖/删除和审批回滚；外部发布明确禁用。更复杂的多文件语义合并和生产级队列仍不属于 MVP。 |
| 长期项目策略 | 已实现（MVP） | 可通过审批写入 `policies`，不依赖聊天历史；中英文种子、引用证据和高成本/对外审批规则会结构化显示，种子规则在计划、API 提交和 Runner 三处执行。其他自由文本规则仍需扩展解析器。 |
| Idea 版本、影响分析与局部重跑 | 部分实现 | Idea v2、审计、实体级依赖失效、显式变更类型/根校验、可审阅节点/边影响图和需审批的检查点局部重跑 Proposal 已实现；批准变更会为安全终态检查点自动创建待审批重跑 Proposal，批准后提交匹配的原白名单或主题固定入口并记录失败；复杂语义规则和完整生产级恢复编排仍未完成。 |
| n8n AI Agent 和高层子工作流工具 | 部分实现 | 3 个激活工作流负责聊天网关、主流程和报告；多数工具是受限 FastAPI 端点，不是独立 n8n 子工作流，也未使用 n8n AI Agent 长循环。 |
| 严格 JSON、双重校验、Shell/路径隔离 | 已实现（MVP） | API 与 Runner 使用 Pydantic `extra=forbid` 和白名单；LLM 不接触任意 Shell/SQL/路径，n8n 节点不能读取容器环境变量。 |
| Related Work 与完整论文自动写作 | 部分实现 | 已可从当前 Idea、页码级核验证据和真实成功实验生成完整章节结构的 `paper/main.tex` patch Proposal；metadata-only 会被拒绝，没有结果会明确保留未执行状态，且批准前不写文件。仍未完成语义 claim 到多证据的精确映射、完整 Related Work 内容质量和生产级论文编译验收。 |
| 项目暂停、恢复与取消 | 已实现（MVP） | 状态是后端强制闸门；暂停阻止新检索/计划/Runner 提交并取消活动任务，恢复使用暂停检查点，cancelled 不可恢复；完整验收和浏览器交互已验证。 |
| 长期运行与生产可靠性 | 部分实现 | Compose restart、n8n 重试、Runner 状态落盘、中断恢复和项目状态闸门可用；没有持久队列、HA、每任务独立容器、磁盘配额和默认拒绝出网。 |
| Windows 单 EXE 安装 | 部分实现 | 已有 Inno Setup 在线引导安装器、自动 Secret、官方 Docker 下载签名校验和 Compose/n8n 自动启动；当前不打包或启动 Windows Bridge。尚未生成签名发布 EXE，也未完成干净 VM、升级/卸载和 Docker 许可验收。 |

2026-07-30 代码来源可信链增量：`P0-CODE-003` 已实现候选仓库的 GitHub/GitLab 元数据、论文记录与 `CITATION.cff`/README 双源匹配，保存已知 SPDX、40 位 commit 和验证来源；未知许可证、未固定 commit、未验证候选或未批准 Proposal 均不能触发下载。批准后仅下载受限归档，拒绝路径穿越、符号链接和特殊文件，写入 SHA-256、下载时间、论文关系和项目 Git 提交。作者主页/数据集/模型的通用定位仍未实现；本增量已完成测试和文档同步，`P0-CODE-003` 标记为 `[x]`。

2026-07-30 Runner 隔离增量：`P0-RUNNER-007` 新增唯一 Docker launcher 和每 Run 独立非 root 作业容器；固定镜像、入口、内部网络、受控挂载、CPU/内存/PID/超时/取消和白名单契约均由容器内代码执行。累计目录配额、Linux `RLIMIT_FSIZE` 单文件上限和结构化超限错误继续保留；真正 volume 级磁盘配额、GPU、通用 Python/C++/Conda 仍未实现，任务保持 `[~]`。
2026-07-30 Runner 模板/配额增量：`P0-RUNNER-007` 增加固定入口的 Python、固定 CMake target 的 C++ 和 Docker GPU 请求模板；每 Run 改用带硬大小上限的 tmpfs 输出 volume，终态同步产物后清理 job container 与 volume。Runner `6 passed`、launcher 普通/真实 Docker 集成各 `8 passed`、API `57 passed`，集成后无 managed volume 残留。Conda、主题专属 Runner 和真实 GPU 主机验证仍未完成；未调用模型、外部学术 API 或无关实验。
2026-07-30 Runner Conda 增量：`P0-RUNNER-007` 在 `research-os-runner` 镜像内预构建固定 `/opt/conda/envs/research-os` micromamba Python 3.12 环境，新增 `conda_python` 白名单模板；请求仍只能选择 `experiment/*.py` 入口，不能提交环境文件、依赖、命令或网络配置。`micromamba 2.3.2`、固定环境 Python `3.12.13`、API `57 passed`、Runner `6 passed`、launcher `8 passed`（含两个真实 Docker 集成测试）通过；主题专属 Runner 和真实 GPU 主机验证仍未完成，未调用模型、外部学术 API 或无关实验。

2026-07-30 数据库迁移增量：`P1-DB-017` 新增一次性 `db-migrate` Compose 服务、版本化 Alembic 初始 revision 和幂等角色 provisioning。API 使用只授予业务表 CRUD 的独立角色，n8n 只访问 `n8n` schema，MLflow 使用独立 `research_os_mlflow` 数据库和角色；API 启动缺少 `alembic_version` 时直接失败，不再隐式 `create_all`/`ALTER TABLE`。备份轮换、恢复演练和生产级网络隔离仍属于 P2 运维范围。

## 关键风险

2026-07-30 模型配置与编排增量：三档模型在容器启动时读取共享 `OPENAI_BASE_URL`/`OPENAI_API_KEY` 默认值，显式 tier 配置和运行时文件中的非空字段覆盖共享值，空的旧 runtime 字段不再遮蔽 `.env`；配置缺失或请求失败直接返回结构化错误。n8n 保留固定聊天、检索、报告和项目编排，模型请求与严格 Schema/审批/状态校验仍在 API 容器，避免复制 Secret 或绕过安全边界。

1. UI 已区分元数据记录与页码原文证据；但自动提取 quote 仍需在 Related Work 阶段把具体事实性 claim 精确映射到 evidence ID，不能仅因论文已有全文证据就宣称任意结论成立。
2. 合成实验只能验证系统编排和产物链，不能证明用户研究 Idea 的科学结论。
3. 未识别的自由文本策略会明确标为人工规则；只有结构化显示为 enforced 的约束才会自动执行。
4. n8n 自动登录仅适用于本机个人部署；任何能访问本机端口的进程都可能进入控制面，不能暴露到局域网或公网。
5. Runner 镜像 digest 与 Research OS commit 已在本地真实验收中验证并进入快照谱系，但这不等于完成发布级镜像签名、外部环境复现或生产可靠性验收。

## 达到原始目标仍需完成

优先级最高的是官方代码验证与许可后下载、真实 GPU 主机验证、语义依赖失效/自动检查点恢复、外部通知，以及完整证据驱动论文生成。主题专属计划、固定入口执行和主题检查点恢复已完成受控实现，但这不等于用户研究假设已经得到科学验证。完成其余能力之前，系统应继续标记为 MVP。
