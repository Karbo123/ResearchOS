# Research OS TODO

## 本轮新增任务

- [x] `P1-UX-045` 修正模型设置来源诊断并提升前端交互与发布交付体验。
  - 范围：明确显示三档模型的容器 `.env` 默认值/运行时覆盖来源；留空 key 保留既有值；改进配置错误诊断、设置弹窗、聊天/项目工作区的响应式交互和视觉一致性；核对 n8n 编排边界与 Windows GitHub Release 流程。
  - 完成标准：`medium` 不再因旧空 runtime 字段或错误保存语义被误报未配置；模型失败仍直接结构化报错；前端桌面/窄屏可操作且无溢出；n8n 不读取 key，安装器 Release 门禁与文档一致；适用测试和浏览器检查通过。
  - 验证结果：API 容器 `107 passed, 2 skipped`；`node --check apps/api/static/app.js`、`node --test scripts/test_chat_ux.mjs`（5 passed）、`docker compose config --quiet`、JSON/Idea case/文档同步检查通过；真实页面确认三档来源显示为“容器 .env 默认”、桌面/窄屏无横向溢出且设置卡片可操作；静态资源增加版本查询参数，避免浏览器缓存旧前端；GitHub token 失效，无法从本机直接发布 Release，保留工作流草稿/签名门禁状态。

- [x] `P1-MODEL-044` 修复环境默认模型配置被空运行时字段遮蔽，并提升模型设置页的可用性。
  - 范围：三档运行时配置按字段覆盖容器环境默认值；空 URL/key 不得覆盖 `.env`；补回归测试；改进前端设置页视觉层和错误反馈；发布流程只在容器内执行模型调用。
  - 完成标准：共享 `OPENAI_BASE_URL`/`OPENAI_API_KEY` 能为三档提供默认值，旧的空 runtime 字段不再导致 `medium` 未配置；前端设置页在桌面和窄屏可操作；测试、文档同步和浏览器检查通过。
  - 验证结果：API 容器 `102 passed, 2 skipped`；三档公开设置均为 `https://api.openai.com/v1` 且 `key_configured=true`；`check_docs_sync.py`、Idea case、Schema/Workflow JSON、Node UX `5 passed`、Compose 配置、浏览器桌面/窄屏无横向溢出和控制台错误为 0 均通过。未调用真实模型或外部学术 API。

- [x] `P0-LLM-041` 修正容器模型默认配置与三档设置面板体验。
  - 范围：`OPENAI_BASE_URL`/`OPENAI_API_KEY` 作为三档共享 `.env` 默认值，显式 tier 配置和网页 runtime 配置优先；模型失败仍直接返回结构化错误。
  - 完成标准：API、Compose、`.env.example`、双语 README、设置面板、自动化测试和真实浏览器桌面/窄屏检查一致。
  - 验证结果：API settings endpoint 显示 Luna/Terra/Sol 的 URL 为 `https://api.openai.com/v1` 且三档 key 已配置；API 测试、Compose、文档同步、Node UX、桌面/窄屏浏览器和控制台检查通过，未提交 key。
  - 实现提交：`895ec03`。
- [x] `P1-N8N-043` 明确并扩展 n8n 编排边界。
  - 范围：n8n 负责固定的聊天、检索、报告和项目流程编排；API 保留模型请求、Schema、权限、审批、状态和 fail-fast 安全边界。不得把 key 放进 workflow JSON 或让节点读取环境变量。
  - 完成标准：工作流 JSON、架构/运维文档和测试明确该边界；不以 n8n 重复实现 API 校验或引入 fallback。
  - 验证结果：n8n 工作流节点标注 API strict/fail-fast 边界，JSON 解析通过，容器重新导入并激活聊天、主流程和报告工作流；n8n 仍只访问 Compose 私有 `http://api:8080`，未复制模型 key 或启动 Windows 服务。

> 这是项目的实时任务源。任何功能、修复、审计或文档工作都必须在开始、状态变化和完成时更新本文件。

最后更新：2026-07-31（Asia/Shanghai，继续 P2-HA-021；并行保留 P1-PAPER-016、P1-UPLOAD-009、P0-RUNNER-007、P0-IMPACT-008、P2-INSTALLER-029）

本轮 P2-SEARCH-018 进展：GitLab、Hugging Face 数据集/模型注册表和受限 DuckDuckGo 网页候选已接入；记录资源类型、提供方、条款链接、限流快照和 robots 状态，网页搜索先检查 DuckDuckGo robots，正文候选状态为 deferred_until_fetch。提供方和 DOI BibTeX 失败进入 provider_errors，空异常也保留异常类型或 HTTP 状态，前端文献页显示候选合规摘要。

状态说明：`[ ]` 待处理，`[~]` 进行中，`[x]` 已完成并验证，`[!]` 阻塞。完成项必须附验证证据；不能用“已有 Schema/接口占位”代替真实实现。

## 当前状态

- Installer status: GitHub Actions run `30545994558` built `ResearchOS-Setup-0.2.0-x64.exe` and `SHA256SUMS.txt` for tag `v0.2.0`; the Release is intentionally Draft until signing and clean-VM acceptance are complete.
- Current work item: `P2-HA-021` is in progress; fixed local health/capacity/backup/recovery guardrails are now implemented, while HA clustering, automatic external alerting and unattended production rehearsal remain open.

- 当前可用版本：可运行、可审计的本地 MVP，不是完整生产系统。
- 当前进行中：`P2-HA-021`、`P1-PAPER-016`、`P1-UPLOAD-009`、`P0-RUNNER-007`、`P0-IMPACT-008`、`P2-INSTALLER-029`；`P2-SEARCH-018`、`P2-QUEUE-020`、`P2-TRACKING-019`、`P1-UX-045`、`P1-DB-017`、`P1-TRACKING-012`、`P1-REPORT-013`、`P1-VIEWER-011`、`P1-PATCH-015`、`P1-MODEL-044` 已完成，当前推进长期运行监控/备份恢复、材料大规模索引、论文语义/编译验收、真实 GPU 主机验证、影响图自动 Proposal 和正式安装器验收。
- 最新完整验收：`artifacts/acceptance/acceptance-20260730-015132.json`。
- 最新测试项目：`6d91ff49-12a5-406c-b7aa-cb96aa3f22e4`。
- 需求审计：`docs/requirements-audit-2026-07-28.md`。

## 已暂停的前序工作

下列事项均为**待处理**，除当前进行中的任务外按各自范围推进：

- `P2-INSTALLER-029`：已有 Windows 在线引导安装器源码；仍缺正式 EXE 生成、代码签名、Docker Desktop 许可复核、干净 Windows VM 安装/升级/卸载验收和发布校验和。
- 其余原始需求缺口继续按下面 P0/P1/P2 条目管理；不得因为已有 Schema、演示任务或文档描述而视为完成。

## P0：科研可信度与执行安全

- [x] `P0-LLM-036` 移除所有模型调用降级、隐式切换和宿主 Codex 配置读取。
  - 范围：Bridge 或其他模型提供商调用失败必须返回结构化 API 错误；不得切换到另一提供商、规则猜测、关键词回复或写入伪造助手消息。Bridge 只从项目环境变量读取非敏感模型/provider 配置，不读取 Windows Codex `config.toml`，不读取或复制认证文件。
  - 完成标准：API、Bridge、Schema、工具契约、前端错误显示、测试、双语 README、运维/安全文档、需求审计、`AGENTS.md` 和 `TODO.md` 一致；错误路径有自动化验证，成功路径仍保留严格结构化输出。
  - 验证要求：`docker compose config --quiet`、Python/JSON/文档同步检查、API 容器测试、聊天 UX 测试、`git diff --check`；不为本任务调用真实模型或外部学术 API。
  - 验证结果：删除 API 规则回复、自动 provider 切换和 `fallback_used` 契约；Bridge 只从项目 `.env` 读取非敏感配置，健康端点返回 `config_source=environment`；模型失败单测覆盖超时、显式 Bridge 优先和未配置 provider（API 容器 `23 passed`）；`docker compose config --quiet`、API/Runner Python 编译、`check_docs_sync.py`、`check_idea_case_sources.py`、7 个 Schema/Workflow JSON、`node --test scripts/test_chat_ux.mjs`（5 passed）和 `git diff --check` 通过；未调用真实模型或外部学术 API。

- [x] `P0-LLM-037` 将本机 Codex API key 迁移到项目未跟踪 `.env` 并接入宿主模型调用。
  - 范围：一次性从本机 `auth.json` 读取已授权的 `OPENAI_API_KEY`，写入项目 `.env`；Bridge 启动时只读取 `.env` 中的 key，并通过子进程环境提供给 Codex CLI。不得复制整个 `auth.json`，不得在日志、健康端点、Git 或聊天中暴露 key；后续运行代码不再读取 `.codex` 目录。
  - 完成标准：宿主 Bridge 使用项目 `.env` 中的 key，健康端点不返回 key；源 `auth.json` 仍由 Codex 保管但不再由运行时代码读取，项目只使用未跟踪 `.env` 作为 Bridge 的 Secret 输入；`.env.example`、Compose、安全/运维文档、`AGENTS.md` 和 TODO 一致，自动化验证 key 未进入输出和暂存区。
  - 验证结果：`OPENAI_API_KEY` 在项目 `.env` 中恰好 1 个且非空，`.env` 仍由 Git 忽略；Bridge `http://127.0.0.1:8092/health` 返回 `config_source=environment` 和 `auth_exposed=false`；离线子进程环境测试 `1 passed`；API 容器 `23 passed`；Compose、双语文档同步、Bridge/API/Runner Python 检查和服务健康检查通过；未调用真实模型或外部学术 API。

- [x] `P0-LLM-040` 将模型调用完全收敛到容器内，并提供三档独立网页配置。
  - 范围：API 直接调用 OpenAI-compatible URL；simple/medium/complex 分别配置 model、URL、key 和 reasoning effort；设置页不回显 key；Windows 不启动 Bridge 或 API 服务。
  - 完成标准：无 provider 切换、无本地降级、无无关实验 fallback；模型失败返回结构化错误；Compose、API、Schema、n8n、前端、双语 README、运维、安全、需求审计、AGENTS、TODO 和测试一致。
  - 验证结果：API 容器 `pytest -q`（29 passed）；`node --test scripts/test_chat_ux.mjs`（5 passed）；浏览器桌面/390x844 窄屏设置面板可打开、三个层级独立显示、滚动正常，console error 为 0；`docker compose config --quiet`、JSON/Idea case/文档同步、AST 和 `git diff --check` 通过。安装器只启动 Compose，前端移除无效的通用实验计划入口；未读取或提交 `.env`、Codex 配置或 key，未运行真实模型或无关 Idea。

- [x] `P0-IDEA-CASES-030` 建立公开、唯一、可审计的 Idea 测试用例目录。
  - 完成标准：所有用于 Idea 澄清、模型路由的输入与后续回答均保存为独立 UTF-8 JSON 文本文件；测试加载器只读取仓库内固定目录，拒绝重复 ID、未知字段、非法模式和命令行临时 Idea；测试脚本、单元测试和验收脚本不得隐藏、硬编码或运行时增添测试 Idea。
  - 文档要求：测试目录 README、项目级 `AGENTS.md`、双语 README 和需求审计都明确唯一来源规则及新增/修改用例方法。
  - 验证：自动检查测试代码不存在 Idea 字面量；单元测试与验收入口都通过同一严格加载器按文件名/ID读取用例。
  - 额度约束：真实模型当前只允许调用 `tests/idea-cases/mnist-cnn.json` 一次；其他公开用例暂不发送给模型，完整 `scripts/acceptance_test.py` 暂不运行。
  - 验证结果：`python scripts/check_idea_case_sources.py` 返回 `IDEA_CASES_OK=4`；所有 JSON 解析通过；容器测试 `17 passed`；唯一真实调用直接读取 `mnist-cnn.json`，未读取或发送其他 Idea 给模型。

- [x] `P0-CLARIFY-027` 完成自适应 AI 对话与三级模型路由的剩余回归和收敛验证。
  - 背景：此前 `clarification.py` 使用固定 `QUESTIONS/ORDER`，即使 Idea 已包含 PyTorch、CUDA、CNN、MNIST 等明确语义，也可能机械追问领域；该编排缺陷的代码修复已完成，但尚未经过全部公开用例和异常路径回归。
  - 完成标准：每轮模型基于当前结构化草稿、对话上下文和用户新消息，推断有充分依据的领域/关键词，标记假设与不确定项，自适应生成少量高信息增益问题；不得再按固定问题清单逐项轮询；数据授权和资源信息不得因推断而绕过确认。
  - 模型路由：默认简单任务 `gpt-5.6-luna`、中等任务 `gpt-5.6-terra`、复杂任务 `gpt-5.6-sol`，模型名、复杂度阈值和各层推理强度均可由 `.env` 配置；每轮响应与审计元数据记录实际层级/模型，Codex Bridge 不暴露宿主认证文件。
  - 失败要求：模型不可用时必须返回明确的结构化错误；不得进入本地规则回复、固定问题队列或其他自动降级路径。
  - 验证：MNIST/CNN 输入应主动识别为机器学习/深度学习/计算机视觉/图像分类并询问真正缺失的实验约束；短输入仍需澄清；结构化输出、模型路由和模型失败报错均有测试。
  - 已完成部分：固定问题队列已移除；Luna/Terra/Sol 路由、严格输出、默认全自动/可选详细模式和 MNIST 单轮真实验证已实现。
  - 验证结果：真实公开回归 `scripts/test_clarification_regression.py` 覆盖 4 个 case：`active-learning-3d` 使用 `complex / gpt-5.6-sol / high` 并在确认事实后收敛，复杂详细模式和短输入保持澄清，MNIST 使用 `medium / gpt-5.6-terra / medium`，两个并发 MNIST 会话均保持澄清。Bridge 不可用集成回归返回 `llm_request_failed`，不降级；Bridge HTTP 504 映射为 `llm_timeout`。服务端拒绝含“未确认/unknown”等数据或资源占位的规格进入确认。`docker compose exec -T api pytest -q`（27 passed）、`python scripts/check_idea_case_sources.py`、Compose 与 Python 检查通过；脱敏报告在被忽略的 `artifacts/idea-tests/clarification-regression-latest.json`。

- [x] `P0-REGRESSION-032` 对最新 Idea 澄清主链执行成本受控的完整端到端回归。
  - 范围：只允许从 `tests/idea-cases/*.json` 读取启用用例；禁止测试代码、命令行或运行时增加隐藏 Idea。
  - 审批：运行前列出将调用的 case ID、模型层级、最大轮数和预计模型/API 成本；默认只运行不调用模型的静态与单元检查。
  - 完成标准：公开用例覆盖不足信息、MNIST 工程基准、复杂/详细模式和项目创建主链；结果写入被 Git 忽略的 `artifacts/acceptance/`，脱敏摘要按需进入 `docs/evidence/`；不得生成虚假论文、结果或费用。
  - 验证结果：`scripts/acceptance_test.py` 真实验收通过，报告为 `acceptance-20260730-015132.json`，脱敏副本已归档到 `docs/evidence/`；验证 8 条论文记录、3 条全文证据、n8n/Runner/MLflow、暂停恢复与取消终态、Idea v2、局部重跑、LaTeX、12 个检查点和 416 条依赖。未输出 token 或凭据。

- [x] `P0-EVIDENCE-001` 实现合法 PDF 下载、哈希、全文解析、页码/章节定位和 quote 证据入库。
  - 完成标准：至少用 3 篇开放论文验证；每个 claim 保存原文、页码、PDF 哈希、稳定来源和 BibTeX；无法验证时禁止进入论文结论。
  - 验证：`acceptance-20260729-012750.json` 从全新 Idea 下载并解析 3 篇 allowlist 开放 PDF，保存 3 个 SHA-256、页码 quote、BibTeX、Artifact/Dependency 与 Git 证据 JSON；claim gate 明确排除 metadata/title。
- [x] `P0-RELATED-002` 实现基于证据库的 Related Work、研究空白和重复研究分析。
  - 依赖：`P0-EVIDENCE-001`。
  - 完成标准：每个事实性句子可追踪到 evidence ID；不得仅凭标题、摘要或 DOI 标记为“已证实创新”。
  - 验证结果：新增确定性 Related Work 单元测试，覆盖 metadata-only 不进入事实证据、page-level evidence 链接、覆盖候选和人工复核标记；API 容器 `pytest -q`（29 passed），文档同步、Compose、JSON、AST 和 `git diff --check` 通过。系统仍明确将研究空白/重复研究标为候选，不宣称科学结论。
- [x] `P0-CODE-003` 实现官方代码仓库交叉验证、许可证审查、commit/tag 固定和审批后受控下载。
  - 完成标准：作者/论文主页/仓库至少双源匹配；保存 URL、SPDX、commit、论文关系、下载时间和审计事件；未知许可证不得执行。
  - 验证结果：GitHub/GitLab HTTPS 提供方元数据、项目论文 DOI/完整标题与 `CITATION.cff`/README 形成显式匹配；已知 SPDX 和 40 位 commit 才能创建 `dependency_install` Proposal。批准后才下载受大小、条目、解压、路径和文件类型限制的归档，记录 URL、许可证、commit、论文关系、下载时间、归档 SHA-256、相对路径和审计事件，并提交项目 Git。API 容器 `47 passed`；仓库服务覆盖 URL allowlist、引用匹配、完整 commit、未知 SPDX、未验证候选、Proposal commit 不一致、路径穿越和符号链接；Compose、无落盘 Python 语法、JSON、文档同步、Idea case、前端 UX 和 `git diff --check` 通过。未调用真实模型、外部学术 API 或无关实验。
- [x] `P0-POLICY-004` 实现项目策略执行引擎，并在计划生成和 Runner 提交时二次强制校验。
  - 完成标准：策略违反请求返回结构化错误；验收覆盖种子数、引用证据和高成本审批规则。
  - 验证：`acceptance-20260729-005847.json` 覆盖中英文策略解析、5 种子计划、3 种子结构化拒绝、Runner 二次校验、引用证据就绪度和审批约束；浏览器验证策略页且无控制台错误。
- [x] `P0-STATE-005` 让暂停/取消成为强制执行闸门，而不仅是项目状态字段。
  - 完成标准：暂停项目拒绝新工作流、检索、计划和 Runner 提交；取消会停止活动任务；恢复后可从检查点继续。
  - 验证：`acceptance-20260729-003629.json` 覆盖暂停 409 闸门、活动 Runner 取消、检查点恢复和 cancelled 不可恢复；浏览器验证暂停时执行按钮禁用、恢复后重新可用。
- [x] `P0-PLAN-006` 用 ProjectSpec、文献证据和项目策略生成 Idea 专属实验计划。
  - 完成标准：真实列出数据集、基线、指标、消融、统计检验、随机种子、资源预算、风险和成功标准；不再固定返回合成 demo。
  - 验证结果：新增严格 `ExperimentPlan` Pydantic 契约和证据/Idea 版本/策略/预算/主题关联二次校验；`POST /api/projects/{project_id}/experiment-plan` 只在当前 ProjectSpec 有页码级全文证据时调用复杂层模型并创建 pending Proposal。批准主题计划提交时重新校验当前状态，Runner 未有匹配模板则返回 `topic_specific_runner_not_implemented`，不会回退到分类或点云 demo。API 容器 `pytest -q`（32 passed）、API 镜像重建、Compose 配置、JSON 契约、双语文档/需求审计同步和 `git diff --check` 通过；未调用真实模型、其他 Idea 或无关实验。
- [~] `P0-RUNNER-007` 增加每任务独立容器/作业隔离和参数化白名单任务模板。
  - 完成标准：支持受控 Python、C++/CMake、Conda 环境和可选 GPU；非 root、镜像 digest、网络策略、磁盘/CPU/GPU/内存/PID 配额、超时、取消和完整日志均有集成测试。
  - 当前实现：已有八个白名单模板：三个既有演示/LaTeX 模板、固定主题 `experiment/main.py` 入口，以及固定入口的 `python_analysis`、固定 `experiment/cpp`/`research_os_job` target 的 `cpp_cmake`、带 Docker GPU `DeviceRequest` 的 `gpu_python` 和使用镜像内固定 `/opt/conda/envs/research-os` micromamba Python 环境的 `conda_python`。主题模板只通过固定 JSON 路径接收结构化计划/恢复状态，要求 `metrics.json` 和 `checkpoint.json`；每个 Run 由 launcher 创建新的非 root 作业容器，使用固定镜像/入口/内部网络/受控挂载，具备 CPU、内存、PID、超时、取消和硬上限 tmpfs 输出 volume；终态同步产物后删除 job container 与 volume。用户不能提交镜像、命令、路径、网络、环境文件或依赖字段。
  - 当前缺口：GPU 仅完成受控 Docker 请求和无 GPU 时的结构化失败路径，未在真实 GPU 主机验证。任何模型或主题 Runner 失败都直接返回结构化错误，不使用 fallback 或无关演示实验。
- [~] `P0-IMPACT-008` 实现实体级影响分析、精确失效传播和检查点局部重跑。
  - 完成标准：Idea/配置/数据/代码修改只失效依赖后代；生成可审阅影响图；自动选择正确检查点，不再默认使全部产物失效。
  - 当前实现：Proposal 创建与审批重新计算 `ArtifactDependency` 影响图；Idea/策略/代码/数据/删除产物变更只使受影响的有效 Artifact 失效，记录受影响实验、检查点、重跑候选和审计事件；旧 Idea 版本 Proposal 会被拒绝。
  - 当前实现：新增 `POST /api/projects/{project_id}/checkpoints/{checkpoint_id}/rerun`；仅允许 `experiment_succeeded`/`experiment_failed` 的终态检查点，重建原白名单模板配置与持久化随机种子。通用 Proposal API 不能创建 `experiment_rerun`；审批与自动提交阶段再次核对源实验、检查点和完整 payload。批准后自动复用现有 `/api/experiments` 提交链，失败写入 Proposal 影响和审计记录；前端只显示自动提交状态，不提供第二个执行入口。
  - 当前进展：影响图现在输出可审阅的 artifact 节点/依赖边，并在批准 Idea、策略、代码、数据或依赖变更后，为有安全终态检查点的受影响实验自动创建待审批 `experiment_rerun` Proposal；Proposal 重新构建并绑定源实验、检查点、白名单配置和随机种子，仍需人工批准后才提交。任何模型或主题 Runner 失败都直接返回结构化错误，不使用 fallback 或无关演示实验。
  - 本轮增量：影响分析登记固定变更类型；未知类型、代码/依赖缺少基准 Git commit、数据缺少基准版本、删除缺少目标或目标不属于当前项目时直接返回结构化 `impact_*` 错误，不再把未知根默认为 `current` 或静默报告无影响。实验计划、诊断建议和外发变更明确保持非失效传播语义。
  - 当前缺口：完整语义级规则覆盖和生产级恢复编排仍需更多真实数据库/队列验证，因此任务继续保持 `[~]`。
  - 验证：API 容器 `pytest -q` 为 `84 passed, 2 skipped`；定向影响/检查点测试为 `19 passed`；新增测试覆盖未知变更类型、缺失代码/依赖 Git 根、缺失数据根和非法删除目标。`docker compose config --quiet`、API `py_compile`、Schema/Workflow JSON 解析、`check_docs_sync.py`、`check_idea_case_sources.py` 和 `git diff --check` 均通过。Runner 定向回归因本轮权限审查服务不可用未执行，不伪造其结果；真实 GPU 主机和完整生产队列恢复仍未完成。
- [x] `P0-REPRO-026` 为每次实验建立不可变、可复核但不追踪大文件的代码与环境快照。
  - 完成标准：实验开始前要求项目 Git 工作树干净；将已批准的代码/配置变更提交并创建 `run/<run_id>` tag；记录项目仓库 commit、Research OS 主仓库 commit、Runner 镜像 digest、ProjectSpec/策略/配置/随机种子、依赖锁文件和数据 manifest/hash；输出与源码快照建立 PostgreSQL 依赖关系。
  - 大文件策略：Git 只追踪源码、配置、BibTeX/LaTeX、manifest、哈希和小型元数据；Git 禁止追踪 PDF、PLY/PCD、PNG、模型权重、数据集、数据库备份、源码 bundle、Docker layer、Conda/package cache 和日志归档。源码 bundle、环境报告、数据/模型清单和大型产物保存到 MinIO 或受控 `artifacts/`，数据库只保存 URI、大小、SHA-256、版本和有效性元数据；主仓库 `.gitignore`、大小门禁和测试必须验证这一点。
  - 完成验证：用一次真实实验检查 Run ID 可恢复对应源码快照、配置、环境 digest、数据 manifest 和全部输出；模拟未提交修改、丢失本地源码和大文件误 `git add` 时均应拒绝或给出结构化错误，不得把备份大文件推送到 GitHub。
  - 验证结果：`docker compose config --quiet`、全量 23 API tests + 5 reproducibility tests passed、Compose/文档/Idea case/JSON/Python 检查通过。真实实验 `run/26103a27`（`demo_classification`）在项目 `013493b8` 上成功验证：`run` tag 创建，`source.tar`（20KB）+ 8 个 JSON manifest 在 `artifacts/reproducibility/` 保存，9 条 Artifact 记录（全部 `valid=true`）写入 PostgreSQL，9 条 ArtifactDependency 记录（覆盖 experiment/idea_version/project_git_commit/run_tag/data_version/policy_snapshot/research_os_commit），Checkpoint `experiment_snapshot_created` 已记录。Runner 健康端点返回 `runner_image_digest_verified=true`。实验实际执行成功（accuracy=0.8467），6 个输出产物同步回 DB。宿主机直接 `py_compile` 仍受历史 root-owned `__pycache__` 拒绝，API 代码已在容器内通过语法校验。
  - 修正：发现并修复 Runner 非 root 用户 Git "dubious ownership" 问题（`apps/runner/Dockerfile` 增加 `git config --system --add safe.directory '*'`）。

## P1：材料理解、结果检查与协作

- [x] `P1-CLARIFY-MODE-031` 在新项目聊天窗口加入默认开启的澄清模式 Toggle。
  - 完成标准：开启时显示“全自动模式”，AI 基于可靠线索尽量推断并只询问阻碍规格或执行的少量关键问题；关闭时显示“详细模式”，AI 自适应覆盖目标、假设、贡献、数据、资源、评估、统计、时间和发表信息，但不得恢复固定问题队列。
  - 契约与审计：前端、Pydantic 请求、Codex Bridge 输入和模型提示使用严格 `automatic|detailed` 枚举；默认 `automatic`；每条用户与助手消息的数据库 metadata 记录实际模式。
  - 验证：测试覆盖默认值、两种模式的提示/问题预算、非法值拒绝和 metadata；浏览器检查默认开启、切换文案、发送期间等待反馈、窄屏布局和无控制台错误。
  - 验证结果：浏览器确认默认“全自动模式”、关闭后“详细模式”、发送期间输入与开关锁定、完成后恢复、桌面/窄屏无重叠且控制台错误为 0；MNIST 唯一真实调用为 `medium / gpt-5.6-terra / medium`，只追问两组关键约束且未再次询问领域；PostgreSQL 最新用户/助手 metadata 均为 `clarification_mode=automatic`。截图：`docs/assets/research-os-adaptive-chat.png`；脱敏运行证据：被 Git 忽略的 `artifacts/idea-tests/mnist-cnn-browser-latest.json`。

- [x] `P1-CHAT-UX-028` 完成新项目与项目监督对话等待反馈的剩余自动化回归。
  - 完成标准：发送后立即禁用重复提交并显示思考/结构化更新等阶段、耗时和非伪造的等待提示；完成、失败和超时状态清晰可见；键盘、窄屏和重复提交有测试；不能把不确定等待时间显示为虚假的精确百分比。
  - 验证：浏览器实际提交 Idea，截图确认加载反馈可见、完成后正确消失、布局无重叠且控制台无错误。
  - 已完成部分：新项目聊天已有不确定进度条、耗时、阶段提示、重复发送锁定、模式锁定和失败提示；MNIST 桌面/窄屏浏览器验证通过。
  - 本轮范围：补充 Ctrl/Cmd+Enter 键盘提交、统一请求超时/断线错误分类、恢复后可重试，以及新项目/项目监督聊天的自动化回归；不改变 API 契约。本轮真实验证只使用 `tests/idea-cases/mnist-cnn.json`；Bridge 恢复后最多进行一次实际模型调用，不调用其他 Idea 或外部学术 API。Bridge 未监听期间的前一次请求只验证失败提示和重试路径，不计入模型调用。
  - 验证结果：`node --test scripts/test_chat_ux.mjs`（5 passed）；真实浏览器仅使用 `mnist-cnn`，宿主 Bridge 成功返回 `medium / gpt-5.6-terra / medium`；页面实际显示等待状态、完成回复后释放输入框/模式开关，两个状态节点隐藏，桌面无水平溢出，截图已通过浏览器工具检查，未调用其他 Idea 或外部学术 API。脱敏记录：`artifacts/idea-tests/mnist-cnn-browser-rule-update.json`。

- [x] `P1-STREAM-038` 为新项目澄清提供真实、可审计的流式请求状态。
  - 范围：`POST /api/chat/stream` 只能流式报告应用可观察阶段（读取对话、选择路由、调用模型、保存结果）和最终结构化结果；不得输出、声称或伪造模型内部思维链。同步 `/api/chat` 保持既有契约。
  - 完成标准：项目只能在结构化规格 `ready_for_confirmation` 后创建；前端显示路由和阶段状态、错误和完成结果，桌面/窄屏无重叠，SSE 断流可安全处理；API 契约、自动化测试、双语 README/需求审计和 `TODO.md` 一致。
  - 验证：SSE 路由/进度/错误/结果、项目创建闸门和同步端点均有自动化测试；浏览器检查流式状态和控制台无错误；不为本项调用真实模型或外部学术 API。
  - 验证结果：`docker compose exec -T api pytest -q`（25 passed）、`node --test scripts/test_chat_ux.mjs`（5 passed）、`python scripts/check_idea_case_sources.py`（`IDEA_CASES_OK=4`）、`docker compose config --quiet`、`python scripts/check_docs_sync.py` 和 `git diff --check` 通过。浏览器桌面与窄屏检查无元素越界、无“思维”字样且控制台 error 为 0；未提交 Idea，未调用真实模型或外部学术 API。

- 2026-07-30 本轮 `P1-UPLOAD-009`：补齐上传路由回归，扫描/解析异常统一清理临时文件并返回结构化错误；同步和流式聊天在材料上下文失败时均不调用模型、不写助手消息；前端逐个上传，失败即停止且不发送聊天请求。API 定向 `16 passed, 2 skipped`、全量 `131 passed, 2 skipped`，Node UX `6 passed`，JS 语法检查、Compose、JSON、文档同步和 `git diff --check` 通过。提交：`fix:material-upload-fail-closed`。大规模材料库、跨材料检索和更广泛视觉能力仍未实现，任务保持 `[~]`。

- [~] `P1-UPLOAD-009` 解析已上传 PDF、图片、CSV/JSON、日志、文本和代码材料，并将受限摘要纳入澄清与规划。
  - 已完成部分：API 在模型请求前上传、通过私有 ClamAV 扫描并解析材料；保留原文件、MIME、SHA-256、解析器版本和派生元数据/文本；PDF 页码文本、JSON/CSV 预览、UTF-8 文本/代码、图片 OCR 和 ZIP 安全清单均有边界；路径穿越、二进制文本、恶意样本、扫描服务不可用、压缩比、解压大小、条目数、单文件 50 MB 以及会话/项目累计配额会直接返回结构化错误。
  - 完成标准：上传或解析失败必须阻止本轮模型调用；摘要只作为不可信上下文，不得执行附件命令或把图片/元数据表述为全文证据；测试覆盖格式、边界、上下文截断和前端上传顺序。
  - 本轮进展：新增项目范围的确定性词法检索接口和 Literature 页面分页结果；结果明确标记为 `unverified_material_context`，不暴露路径、不执行附件、不调用模型，也不升级为全文证据。定向测试覆盖排序、分页、项目隔离和结构化错误。
  - 剩余范围：大规模异步材料索引、跨材料语义检索和更广泛的视觉模型能力尚未实现，不得标记为完整多模态材料能力。
  - 本轮验证进展：`docker compose build api` 和 API 重启成功；ClamAV 服务显示 `healthy`；API 容器全量 `138 passed, 2 skipped`；容器内 `py_compile`、Compose 配置、JSON、文档同步、Idea case、`git diff --check` 和 `node --check apps/api/static/app.js` 已通过。浏览器实际检查确认 Literature 页面材料搜索面板、空结果状态和 `unverified_material_context` 边界可见，控制台错误为 0；证据截图为 `docs/assets/research-os-material-search.png`。已扫描且仍存在的图片会以受限临时 data URL 发送给当前模型；单张 4 MB、最多 4 张、总量 12 MB，大小/数量/读取失败直接返回结构化错误，不静默退回 OCR。
- [x] `P1-DIAG-010` 实现通用数值分析、失败诊断和后续实验建议闭环。
  - 完成标准：统计由 Python 计算；LLM 只解释和质疑；错误日志、异常指标和缺失数据会形成待审批建议。
-  - 验证结果：新增 `apps/api/app/diagnostics.py` 和 `POST /api/projects/{project_id}/diagnostics`；计算有限指标的 count/mean/population std/min/max，解析结构化失败码与成功但缺失指标的运行，并生成去重、不可执行的 `diagnostic_suggestion` Proposal。API 测试 `60 passed`，前端 `node --check`、聊天 UX `5 passed`、Compose、文档同步、Idea case 和 `git diff --check` 通过；未调用真实模型、外部学术 API 或任何后续实验。
- [x] `P1-VIEWER-011` 增加 PLY/PCD/网格交互式 3D 查看器及 HTML/PDF/表格预览。
  - 已完成：增加受限 Artifact 预览契约、PLY/PCD 点云查看器和 HTML/PDF/表格预览；大文件固定降采样，HTML 只显示转义文本，解析失败直接返回结构化错误；保留产物谱系元数据和下载入口。
  - 完成标准：桌面和移动端可加载、旋转、缩放、下载；大型文件有降采样；产物谱系在查看器中可见。
  - 验证结果：`docker compose config --quiet`、API 容器 `70 passed, 2 skipped`、`node --check apps/api/static/app.js`、`python scripts/check_docs_sync.py`、`python scripts/check_idea_case_sources.py` 和 `git diff --check` 通过；浏览器实际检查模型设置页与完成项目产物页，确认 Luna/Terra/Sol 独立配置、JSON/PNG/ASCII PLY 预览、PLY 旋转/缩放/重置和下载入口，桌面无重叠、控制台错误为 0。未调用模型、外部学术 API 或无关实验。
- [x] `P1-TRACKING-012` 完善 MLflow 资源和环境追踪。
  - 已完成：补充固定频率的 CPU、内存、进程和 GPU 数值采样，写入 MLflow 时间序列与受控 `resource-usage.jsonl`；同时记录学习率、模型版本、平台/网络策略、镜像 digest、数据版本、Git commit、随机种子和 Runner 终态，禁止把 Secret 或任意用户环境传入采样产物。
  - 完成标准：记录学习率、连续 CPU/内存/GPU、模型版本、镜像 digest、数据版本、Git commit、种子和状态；敏感字段不会进入日志。
  - 验证结果：新增 `apps/runner/app/resource_tracking.py` 和 `apps/runner/tests/test_resource_tracking.py`；固定 `nvidia-smi` 数值查询、无 GPU 状态、JSONL 数值字段和 MLflow step 序列测试通过；Runner 镜像重建成功，容器 `python -B -m unittest discover -s tests -v`（9 tests）通过，Runner 只读文件系统保持不变；`docker compose config --quiet`、API 容器 `70 passed, 2 skipped`、`python scripts/check_docs_sync.py`、`python scripts/check_idea_case_sources.py` 和 `git diff --check` 通过。未调用模型、外部学术 API 或无关实验。
- [x] `P1-REPORT-013` 完善日报/周报内容及外部推送适配器。
  - 完成标准：覆盖新论文/BibTeX/代码、创新性变化、实验状态、异常、重点产物、真实资源/API 成本、Agent 决策和待审批事项；至少实现一种本地以外渠道并可关闭。
  - 已完成：报告由确定性服务汇总文献、页码/章节证据、代码候选、实验状态、显式记录的资源/成本、有效产物谱系、审计决策和待审批项；缺失成本不推断，元数据不升级为科学结论。`notify` 默认关闭，显式请求在启用配置后只发送一次 HTTPS webhook；禁用、URL、超时或非 2xx 失败均返回结构化错误，不尝试备用通道。
  - 验证结果：新增 `apps/api/app/reporting.py` 和 `apps/api/tests/test_reporting.py`；API 容器 `75 passed, 2 skipped`，报告/脱敏/时间窗口/webhook 失败不重试测试通过；`docker compose build api`、`docker compose config --quiet`、7 个 Schema/Workflow JSON、`python scripts/check_docs_sync.py`、`python scripts/check_idea_case_sources.py` 和 `git diff --check` 通过。未调用模型、外部学术 API 或无关实验。
- [x] `P1-INTENT-014` 用严格结构化分类替代对话变更的关键词识别。
  - 完成标准：解释、建议、执行变更、长期策略、暂停/恢复/取消、批准/驳回均有 Schema 和歧义测试；任何执行型输出仍需审批。
  - 已完成：已有项目聊天通过容器内配置模型返回严格 `SupervisionIntent`；只有白名单 Idea 字段和值或明确策略规则才创建 Proposal，暂停/恢复/取消/批准/驳回只提示对应闸门，不从聊天直接执行；分类失败直接返回 `llm_*` 结构化错误，不使用关键词或本地回复。
  - 验证结果：Schema `extra=forbid`、模型失败直返、关键词路径静态门禁和 API 全量 `78 passed, 2 skipped` 通过；`docker compose build api`、Compose、文档同步、Idea case、JSON 和 `git diff --check` 已通过。未调用真实模型、外部学术 API 或无关实验。
- [x] `P1-PATCH-015` 完成代码/配置/LaTeX patch 的“提案—diff—审批—隔离验证—Git commit—审计”执行器。
  - 完成标准：覆盖冲突、验证失败、回滚、依赖安装、覆盖/删除和对外发布禁用路径。
  - 验证结果：新增严格结构化文件操作契约和临时隔离验证器；批准后只对干净且仍位于基准 commit 的项目 Git 工作区执行，暂存、写入、验证、冲突和提交失败均恢复原文件并返回结构化错误。回滚通过新的待审批 Proposal 触发并固定使用 `git revert --no-edit`；外部发布保持明确拒绝。API 容器 `96 passed, 2 skipped`，patch 执行器与路由定向测试 `12 passed`，Compose、API `py_compile`、JSON、Idea case、文档同步和 `git diff --check` 通过；提交 `327c592` 已推送到 `origin/main`；未调用真实模型、外部学术 API 或无关实验。
- [~] `P1-PAPER-016` 实现基于验证证据的完整 LaTeX 论文生成与更新。
  - 依赖：`P0-EVIDENCE-001`、`P0-RELATED-002`、`P0-PLAN-006`。
  - 完成标准：Introduction、Related Work、Method、Experiments、Results、Limitations 和 References 可追踪；编译前必须审批 diff。
  - 本轮范围：生成器只接受具备 PDF SHA-256、BibTeX、稳定来源、页码/章节定位和非空 quote 的当前 Idea 证据；建立确定性的 claim-to-evidence map，Related Work 每条事实句必须带 evidence ID，实验结果必须带 run ID provenance；未支持的假设、贡献和结果明确标为 proposed/unexecuted，不补造论文事实。
  - 本轮进展：生成器现已输出完整章节、Scope/Method/Experiment 状态表、成功 Run 指标表、未执行结果说明、逐条 evidence ID/定位、claim-to-evidence map、Conclusion 和 References；可选预算/约束字段安全处理。claim map 增加 Unicode 归一化、英文 token、中文二元片段、目标/证据覆盖率、短语命中和有上限的多证据候选，但明确标记 `semantic_status=not_proven_lexical_candidates_only`。新增固定 `latexmk` 最小文档容器回归；本轮验证完成前语义 claim 映射质量和生产级 LaTeX 编译验收仍保持 `[~]`。
  - 编译 Proposal 现在绑定干净 `paper/main.tex` 的 Git commit/SHA-256，并在审批和 Runner 提交前复核，陈旧源直接结构化拒绝。完整语义 claim 映射和论文内容验收仍保持 `[~]`。
- [x] `P1-DB-017` 引入正式数据库迁移和最小权限角色。
  - 完成标准：使用迁移工具管理 18 张业务表；API、n8n、MLflow 使用独立角色/schema；备份恢复测试通过。
  - 验证结果：新增一次性 `db-migrate` 服务、Alembic `0001_initial` revision 和幂等角色 provisioning；API 使用业务表 CRUD 角色，n8n 使用 `n8n` schema 角色并保留启动所需数据库 `CREATE` 权限，MLflow 使用独立 `research_os_mlflow` 数据库。现有 PostgreSQL volume 上迁移成功，恢复到临时数据库后验证 19 张 public 表和 `0001_initial`，随后清理临时数据库与备份。API `99 passed, 2 skipped`、n8n 工作流启动并激活、Compose/JSON/文档同步/容器 Python 语法/`git diff --check` 通过。

## P2：覆盖面与长期运行

- [~] `P2-INSTALLER-029` 提供 Windows 单 EXE 引导安装器，使用户无需预配置 n8n 或手工复制配置。
  - 完成标准：发布一个签名/可校验的安装 EXE，内置 Research OS 应用文件和 Compose/n8n 工作流，首次运行生成本地 Secret、选择数据目录、检查 WSL2/虚拟化和 Docker Engine；Docker Desktop 缺失时可经用户明确同意下载官方安装器并请求管理员权限，完成后自动启动 Compose 和本地入口；模型请求始终在 API 容器内，不启动 Windows Bridge。
  - 边界：受 Docker Desktop 许可、体积和 Windows 管理员权限约束，不把 Docker 二进制、账号、Cookie、API key 或 Codex `auth.json` 硬编码进仓库/安装包；离线全量包需单独评估官方再分发许可。n8n 由 Research OS Compose 自动部署，用户无需已有 n8n。
  - 完成验证：在未安装 n8n 的干净 Windows VM 中仅运行 EXE，完成健康检查并打开 `http://127.0.0.1:8080/`；卸载保留/删除数据必须由用户选择；升级不覆盖 PostgreSQL/MinIO/n8n volumes。
  - 已完成部分：`installer/windows/` 已包含 bootstrap、Inno Setup、构建脚本和说明；`.github/workflows/installer-release.yml` 可在 `v*` tag 的 Windows runner 生成 EXE、SHA-256 和草稿 Release；尚未形成可发布二进制。
  - 剩余工作：本机缺 Inno Setup 且 GitHub CLI token 已失效，需在具备编译器和有效 GitHub 权限的 release 机器生成正式 EXE；完成代码签名、Docker Desktop 下载/许可边界复核，以及无 n8n 的干净 VM 安装、重启、升级、保留数据卸载与全删除卸载测试。

- [x] `P2-SEARCH-018` 增加 GitLab、数据集/模型注册表和合规网页检索，并统一限流、robots.txt 与条款记录。
  - 当前范围：为每个外部提供方使用固定 HTTPS 主机、合法 User-Agent、并发安全限流和超时；GitLab、Hugging Face 数据集/模型注册表和明确允许的网页检索结果只保留候选元数据；robots.txt 与条款/许可状态作为合规记录返回，任何失败只进入 `provider_errors`，不伪造结果。
  - 完成标准：结构化结果包含提供方、资源类型、robots/terms 状态和限流信息；GitLab、数据集/模型注册表、网页合规检查有定向测试；双语 README、需求审计、安全/运维、Schema、工具契约和 TODO 同步。
  - 验证结果：搜索定向 `6 passed`，API 全量 `119 passed, 2 skipped`；Docker Compose、文档同步、JSON 和前端 JS 语法通过；活动 MNIST 项目真实搜索在 Literature 页面显示 `code · github · robots not_applicable_api`、条款链接和“待核验”，控制台错误为 0；Semantic Scholar/网页不可用只记录 `provider_errors`，不伪造候选。
- [x] `P2-TRACKING-019` 按部署需求评估自托管 W&B/TensorBoard；不能削弱现有离线 MLflow 路径。
  - 当前评估：Research OS 的当前单机 Compose MVP 已由 MLflow + MinIO 记录参数、指标、资源采样、Run、产物和谱系；W&B 需要额外账号/服务与出站控制，TensorBoard 不能覆盖当前 PostgreSQL/Artifact/MLflow 统一谱系。因此本轮不增加第二状态源或外部 SaaS 依赖。
  - 完成标准：双语 README、架构/运维说明明确比较、保留 MLflow 离线路径；若部署需求以后证明需要 TensorBoard/W&B，必须作为独立 Proposal/架构变更评审。
  - 验证结果：已同步双语 README、架构、运维和需求审计；明确 MLflow/PostgreSQL 为事实源，不增加第二状态源或出站依赖。`python scripts/check_docs_sync.py` 通过（`2026-07-30-20`），`git diff --check` 通过。
- [x] `P2-QUEUE-020` 为项目启动/恢复长任务增加持久队列、租约、重试退避、幂等键和崩溃恢复。
  - 本轮范围：将研究启动任务从 FastAPI `BackgroundTasks` 移到独立 `queue-worker` 容器；Task 持久化幂等键、最大尝试次数、下一次执行时间、租约截止时间和 lease token。worker 使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 领取任务，租约过期可恢复，失败按固定指数退避并在上限后结构化终止；项目暂停/取消仍是后端闸门。
  - 完成标准：API 重启不丢任务；同一幂等键不重复入队；worker 崩溃后过期 lease 可重新领取；重试次数、退避和最终失败可审计；容器/迁移/单元与集成验证通过。
  - 本轮验证：新增 Alembic `0002_task_queue`、独立 `queue-worker` Compose 服务和 API/worker 共用镜像；新增白名单幂等入队函数，数据库唯一索引冲突会返回已有任务，不会重复插入；项目详情只暴露队列时间/尝试状态，不暴露 lease token。现有数据库真实迁移到 `0002_task_queue`，幂等入队、过期 lease 回收和陈旧 token 防护集成通过；API `122 passed, 2 skipped`，Python/Compose/Schema/n8n JSON/文档同步/`git diff --check` 通过。实验提交仍直接进入受控 Runner 链，Runner 执行链持久化排队属于 `P0-RUNNER-007` 范围。
- [~] `P2-HA-021` 增加长期运行监控、健康告警、备份轮换、容量限制和升级/回滚演练。
  - 本轮开始：现有运维说明只有手工 pg_dump/volume 备份命令，缺少固定的健康快照、容量门禁、轮换和隔离恢复验收；新增工作将保持本地、结构化、无外发通知和无数据覆盖。
  - 本轮实现：新增 `scripts/ops_guard.py`，固定探测 API/n8n/MLflow 和九个 Compose 服务，固定检查 projects/artifacts/backups 容量；备份生成 PostgreSQL dump、projects、artifacts、三个命名 volume 的压缩归档和 SHA-256 manifest，轮换只删除合法且带 manifest 的旧备份；恢复演练拒绝符号链接/路径穿越，只写隔离目录并复核 Compose 配置。
  - 本轮验证：`scripts/test_ops_guard.py` 为 `7 passed`；真实健康快照 `status=ok`（九个 Compose 服务、API/n8n/MLflow HTTP 200）；容量快照 `status=ok`（artifacts 约 42.7 MB、projects 约 0.47 MB）；真实备份 `20260730T163859Z`、SHA-256 manifest、保留轮换和隔离恢复演练均成功，恢复结果 `live_data_untouched=true`、`compose_config_validated=true`；非法 snapshot 路径和负容量门限均直接返回结构化错误。未创建额外 helper 镜像，volume 归档复用已有 `postgres:16-alpine`。
  - 当前缺口：本地结构化告警尚未接入外部通知，未实现 HA 集群/自动故障转移，也未完成长期无人值守 Windows VM 升级/回滚演练；任务保持 `[~]`。
- [ ] `P2-RAG-022` 仅在论文规模证明需要时引入 RAGFlow/LlamaIndex；保留 evidence ID 和页码追踪。
- [ ] `P2-GRAPH-023` 仅在 n8n 循环、分支和检查点恢复难以维护时评估 LangGraph，不提前增加双状态源。

## 文档与开发体验

- [x] `DOCS-039` 同步最新真实验收结果与项目文档事实。
  - 范围：同步双语 README、需求审计、运维验收说明、TODO 和文档同步检查脚本；复核 `AGENTS.md` 是否仍符合“模型失败返回结构化错误、运行时只读项目 `.env`”规则；归档脱敏验收证据。
  - 完成标准：所有文档使用最新验收报告 `acceptance-20260730-015132.json` 和项目 `6d91ff49-12a5-406c-b7aa-cb96aa3f22e4`；最新路由、检查点和依赖数字一致；`check_docs_sync.py`、Compose、JSON、Python、适用测试和 `git diff --check` 通过；不提交 `.env`、认证文件或运行时原件。
  - 验证结果：`python scripts/check_docs_sync.py`、`docker compose config --quiet`、Schema/Workflow JSON 解析、`python scripts/check_idea_case_sources.py`、`git diff --check` 和 `docker compose exec -T api pytest -q`（27 passed）通过；API 容器 Python 编译通过，Runner 容器为只读文件系统，宿主历史 root-owned `__pycache__` 未被修改；证据 JSON 敏感字段扫描为空。AGENTS.md 无需修改。

- [x] `DOCS-035` 删除完整真实验收必须等待用户扩大授权的项目规则。
  - 范围：删除 `AGENTS.md` 第 89 行的完整验收等待门槛；保留第 42 行高成本实验、代码/配置/依赖和对外发布的 Proposal/明确批准/隔离执行要求；Bridge 恢复后最多进行一次 `mnist-cnn` 模型提交且不调用外部学术 API，Bridge 未监听期间的失败请求不计入模型调用。后续将 TODO.md 和 README 中所有"用户批准"约束一并移除。
  - 完成标准：`AGENTS.md`、TODO、运维说明和实际验证范围一致；定向浏览器验证完成后记录脱敏产物，不把其他 Idea 或 token 写入仓库。
  - 验证结果：删除 `AGENTS.md` 原第 89 行；保留原第 42 行高成本执行审批；`docs/operations.md`、双语 README 同步，`python scripts/check_docs_sync.py` 通过；实际范围为 `mnist-cnn` 单一用例、一次成功模型调用、零外部学术 API。

- [x] `DOCS-034` 明确 Compose 的首次构建、日常启动和按服务重建边界，并限制 Docker 构建上下文。
  - 完成标准：首次部署使用 `docker compose up --build -d`，已有镜像的日常启动使用 `docker compose up -d`；API/Runner/MLflow 镜像输入变化时只重建受影响服务；挂载的 `projects/`、`artifacts/` 和 n8n 工作流变化不触发镜像构建；`.dockerignore` 排除 `.env`、运行数据、Git 元数据和宿主机文档；英文/中文 README、运维和安全文档保持一致。
  - 当前范围：不删除已有 volume，不改变服务端口、挂载路径或镜像版本；仅修复操作说明和构建上下文边界。
  - 验证结果：`python scripts/check_docs_sync.py`、`docker compose config --quiet`、`python scripts/check_idea_case_sources.py`、4 个 Schema 与 3 个 n8n 工作流 JSON 解析、`git diff --check` 均通过；未触发镜像重建或真实模型/API 验收。

- [x] `DOCS-033` 归档此前未完成工作并把当前已完成代码安全纳入 Git。
  - 范围：只更新 TODO/必要说明、审查现有变更、排除 Secret/运行产物/大文件、运行零成本验证、提交并推送当前分支；不实现任何 P0/P1/P2 待处理功能，不运行完整验收。
  - 完成标准：TODO 状态不再把暂停任务标为进行中；双语 README 与需求审计说明完整回归仍待批准；`git diff --check`、文档同步、Idea case 门禁、Compose/JSON/Python/JS 检查和现有 17 项容器测试证据有效；提交推送到 `origin/main`。
  - 验证结果：`python scripts/check_docs_sync.py`、`python scripts/check_idea_case_sources.py`、Python 编译、Node 语法、JSON 解析、`docker compose config --quiet` 和 `git diff --check` 均通过；未运行完整验收、其他 Idea、真实模型或外部学术 API。本次功能/文档归档提交为 `db1c72b`，本条记录提交为 `dc3b519`，两者均已推送到 `origin/main`。

- [x] `DOCS-024` 建立 GitHub 风格英文主 README、同步中文 README、真实 UI 截图和详细安装/配置/使用教程。
  - 完成标准：英文 `README.md` 默认入口、`README.zh-CN.md` 中文入口；两版章节与事实同步；包含真实 Research OS 页面截图、架构、快速开始、Windows Codex Bridge、环境变量、操作流程、安全、备份、升级、测试、故障排查和项目边界。
  - 维护要求：`AGENTS.md` 明确重大更新必须实时同步 README 双语版、配置示例、TODO、需求审计和相关 docs；CI/测试可检测双语 README 关键版本标记漂移。
  - 验证：`python scripts/check_docs_sync.py` 通过（17 个对应二级章节、相同同步版本与验收项目）；真实验收项目四张 JPEG 截图非空且浏览器控制台错误为 0；`docker compose config --quiet` 通过；API 容器 `12 passed`；3 个 Schema 与 3 个 n8n 工作流 JSON 均解析通过。

- [x] `REPO-025` 将当前 MVP 安全提交并推送到 `Karbo123/ResearchOS.git`，并建立重大更新自动提交约定。
  - 完成标准：只提交仓库内非敏感文件；配置 GitHub `origin`；提交前通过文档同步、Compose/Python/JSON/API 测试；使用当前 Windows Git 凭据推送当前分支；在 `AGENTS.md` 写明重大更新的自动 commit/push 触发、检查和禁止提交 Secret 规则。
  - 验证：远程初始状态为空；`origin=https://github.com/Karbo123/ResearchOS.git`；首次提交 `d13f175` 与最终完成记录 `fddf64f` 均已推送到 `origin/main`；暂存扫描排除了 `.env`、运行产物、项目工作区、数据库备份和常见 token/私钥模式；`git diff --cached --check`、`python scripts/check_docs_sync.py`、Compose 配置、Python 编译和 API `12 passed` 均通过。

## 已完成基线

- [x] `BASE-001` Docker Compose 本地部署，核心端口仅绑定 `127.0.0.1`。验证：`docker compose config --quiet`、`docker compose ps`。
- [x] `BASE-002` 多轮 Idea 澄清与严格 ProjectSpec。验证：完整验收短 Idea 用例。
- [x] `BASE-003` 项目 UUID、Git、目录、Idea 版本、任务和检查点初始化。验证：验收项目 v1/v2 与 Git commit。
- [x] `BASE-004` Crossref、OpenAlex、Semantic Scholar、arXiv、DBLP、DOI BibTeX 和 GitHub 候选检索。验证：最新验收 8 篇可追溯记录；早期完整验收曾得到 3 个候选，候选数随检索结果变化且不得伪造。
- [x] `BASE-005` 两阶段实验/Idea/LaTeX 审批、审计和受限 Runner 主链。验证：未批准请求被拒，批准后异步运行成功。
- [x] `BASE-006` 自托管 MLflow、MinIO/受控文件系统、PNG/PLY/JSON/PDF 产物和依赖记录。验证：最新验收 12 个检查点、416 条依赖。
- [x] `BASE-007` n8n 主流程、聊天网关、日报/周报工作流和本地 Cookie 自动登录。验证：3 个 Active 工作流，自动入口进入 `/home/workflows`。
- [x] `BASE-008` PostgreSQL 持久化 18 张业务表，聊天不是唯一状态源。验证：项目重载后 Idea、审批、策略、实验、产物和反馈仍存在。

## 更新记录

- 2026-07-30：继续 `P2-INSTALLER-029`；GitHub Actions 现将普通 `v*` tag 限定为草稿 Release；同一 tag 手动选择 `publish=true` 时强制要求签名证书 Secret、Authenticode 验证和重新计算 SHA-256，缺少签名条件直接失败，不发布未签名 EXE。正式 EXE、Docker Desktop 许可复核、干净 Windows VM 安装/升级/卸载验收仍未完成，任务保持 `[~]`。实现提交：`38919c0`。
- 2026-07-29：根据 `docs/requirements-audit-2026-07-28.md` 建立实时 TODO；记录完整验收结果和策略未执行、页码证据为 0、官方仓库为 0 等已知缺口。
- 2026-07-29：完成 `P0-STATE-005`；新增统一 active 状态守卫、任务/Runner 取消、暂停检查点恢复、终止状态保护、n8n active 过滤、前端状态控制和严格 Proposal 内容匹配。完整验收与浏览器验证通过。开始 `P0-POLICY-004`。
- 2026-07-29：完成 `P0-POLICY-004`；长期规则先提案审批，再解析为种子、引用和高成本/对外审批约束；计划、API 提交和 Runner 双重强制，UI 显示执行与证据就绪状态。开始 `P0-EVIDENCE-001`。
- 2026-07-29：完成 `P0-EVIDENCE-001`；新增开放学术域名 allowlist、HTTPS/重定向复验、25 MB 上限、PDF magic、pypdf 页码提取、PDF/quote SHA-256、BibTeX、Artifact/Dependency、PostgreSQL metadata 和 Git 证据归档。修复 API/Runner 非 root 共享目录所有权冲突及 Runner 启动前异常悬挂。
- 2026-07-29：`DOCS-024` 进入截图与文档实现阶段；从验收项目 `8c40dc70-519a-4c87-99ac-d37003a56640` 保存概览、文献、产物和策略页真实截图，浏览器控制台错误为 0。
- 2026-07-29：完成 `DOCS-024`；英文 `README.md` 成为 GitHub 风格默认入口，新增同步中文 `README.zh-CN.md`、四张真实 UI JPEG、详细配置/安装/使用/安全/备份/升级/排障说明、`.env.example` 注释、`AGENTS.md` 双语同步契约和 `scripts/check_docs_sync.py` 自动检查。Compose、Python、JSON、12 个容器测试和浏览器验证通过。
- 2026-07-29：完成 `REPO-025`；设置 `origin` 为 `https://github.com/Karbo123/ResearchOS.git`，以 `d13f175` 将 57 个非敏感源码/文档/Schema/工作流/截图文件推送到 `main`，并在 `AGENTS.md`、双语 README 中记录重大更新自动 commit/push 契约。
- 2026-07-29：根据用户要求新增 `P0-REPRO-026`；明确每次实验代码/环境快照与大文件隔离策略，后续实现不得把备份、数据、模型权重、源码 bundle 或日志归档纳入 Git 跟踪。
- 2026-07-29：新增 `P0-CLARIFY-027`、`P1-CHAT-UX-028` 和 `P2-INSTALLER-029`；开始将固定九问澄清替换为自适应 AI 对话，加入 Luna/Terra/Sol 可配置分级路由和真实等待反馈；记录 Windows 单 EXE 安装器的安全、许可与干净 VM 验收边界。
- 2026-07-29：完成 `P0-IDEA-CASES-030` 与 `P1-CLARIFY-MODE-031`；建立 `tests/idea-cases` 唯一测试输入源、严格加载/静态门禁、默认全自动/可选详细模式、Bridge/Schema/工具契约与 PostgreSQL metadata 审计。静态检查、Compose、双语文档同步、17 项容器测试、浏览器桌面/窄屏和单次 MNIST/Terra 真实调用通过；按用户要求暂停，未运行其他 Idea、完整验收、commit 或 push。
- 2026-07-29：完成 `DOCS-033`；将暂停的自适应澄清回归、完整回归、聊天 UX 剩余测试、单 EXE 安装器验收及其余原始需求缺口写入 TODO，修正文档中的状态/测试数量，完成零成本检查，并以 `db1c72b` 归档当前安全源码与文档；未执行任何待处理功能。
- 2026-07-29：`DOCS-033` 的最终记录提交 `dc3b519` 已推送到 `origin/main`；工作区不再有本次任务的未提交变更，待处理 TODO 仍保持未执行状态。
- 2026-07-29：继续 `P0-REPRO-026`；修复 `docker-compose.yml` Runner 环境变量缩进，`docker compose config --quiet` 与 `docker compose up --build -d` 通过，PostgreSQL/API/Runner/n8n/MLflow/MinIO 已启动。容器全量测试首次为 `19 passed, 1 failed`，确认 `active-learning-3d.json` 的 `medium` 期望是既有可行性门控移除后的过期夹具，已同步为 `high`，待重跑全部验证。
- 2026-07-29：完成本轮本地验证与文档同步；API 容器全量测试重跑为 `21 passed`，`IDEA_CASES_OK=4`、`check_docs_sync.py`、JSON 解析、Compose 配置、服务状态和 `git diff --check` 通过。提交 `1888850`（`feat:add-reproducibility-snapshot-gate`）已创建；`P0-REPRO-026` 继续保持 `[~]`，因为本地 Runner digest 未核验，真实实验恢复和完整实时验收尚未执行。
- 2026-07-29：开始 `DOCS-034`；确认之前重复使用 `docker compose up --build -d` 会触发不必要的 API/Runner/MLflow 重建，且仓库缺少 `.dockerignore`，根目录构建上下文会包含运行数据和潜在本地 Secret。
- 2026-07-29：完成 `DOCS-034`；新增根目录 `.dockerignore`，同步双语 README、`docs/operations.md` 和 `docs/security.md`，明确 `up -d` 日常启动、按服务 `--build` 重建与 n8n 工作流重新导入规则；全部静态检查通过，未运行真实模型/API 验收。
- 2026-07-29：恢复 `P1-CHAT-UX-028`；确认现有 UI 已有等待/锁定基础，但缺少 Ctrl/Cmd+Enter 契约、请求超时/断线分类和无模型自动化回归，开始补齐。
- 2026-07-29：完成 `P1-CHAT-UX-028` 本轮实现部分；新增 `chat-ux.js` 忙碌闸门、Ctrl/Cmd+Enter 契约、300 秒请求超时与断线分类，接入新项目和项目监督聊天；`node --test scripts/test_chat_ux.mjs`（5 passed）、Node 语法、API 容器 `21 passed`、Compose/文档/Idea case 检查通过；浏览器桌面/窄屏和已有项目监督聊天检查无水平溢出、等待区 `role=status`、控制台错误为 0，未提交真实 Idea。
- 2026-07-29：`P1-CHAT-UX-028` 仍为 `[~]`；剩余解除条件是完成一次公开 Idea 的真实浏览器提交并检查完成/失败状态，不能用无模型回归替代。
- 2026-07-29：`P1-CHAT-UX-028` 实现提交 `ed738ee` 已创建，包含前端状态逻辑、无模型回归、双语文档和需求审计更新；待 TODO 记录提交后推送。
- 2026-07-29：`DOCS-034` 提交 `996e942` 已创建，待最终复核后推送；本次提交未包含 `.env`、凭据、运行产物或数据库/volume 内容。
- 2026-07-29：完成 `DOCS-035` 与 `P1-CHAT-UX-028`；删除 `AGENTS.md` 原第 89 行的完整验收等待门槛，保留高成本实验审批；以宿主权限启动 Codex Bridge，`mnist-cnn` 浏览器真实调用成功（`gpt-5.6-terra`/medium），等待/恢复、无溢出和脱敏验证记录通过；未调用其他 Idea 或外部学术 API。
- 2026-07-29：完成 `P0-LLM-036`；模型调用失败现在返回结构化 API 错误，禁止自动切换 provider、规则/关键词回复和伪造助手消息；Bridge 改为只使用项目 `.env` 的非敏感配置，健康端点不再返回宿主 Codex 路径；同步 API/Bridge、Schema、测试、双语 README、运维/安全、需求审计和 `AGENTS.md`，未运行真实模型或外部学术 API。提交：`ab21258`；验证：API `23 passed`、Compose/文档/Idea case/JSON/Python/Node 检查通过。
- 2026-07-29：完成 `P0-LLM-037`；按用户要求仅将本机 `auth.json` 的 `OPENAI_API_KEY` 值迁移到未跟踪 `.env`，Bridge 运行时不读取 `.codex`，只通过子进程环境传递该 key；同步 `.env.example`、`AGENTS.md`、双语 README、运维/安全和需求审计。健康端点、离线 Bridge 环境测试、API `23 passed`、Compose、文档同步和服务检查通过；未调用真实模型或外部学术 API。提交：`9404bb1`。
- 2026-07-29：复核 `P0-LLM-037` 文档一致性；补充双语 README 的 Bridge 故障排查，明确检查 `.env` 中的 `OPENAI_API_KEY`；`check_docs_sync.py` 通过，任务继续保持 `[x]`。
- 2026-07-29：继续 `P0-REPRO-026`；将 `.env` 中 `RUNNER_IMAGE_DIGEST` 配置为真实 `sha256:f3abc673cce53eaee012e627646caca95e9dfdb1b6080b19001f348f12f04f21`，`RESEARCH_OS_COMMIT=b4903d38b7fba70b685571cb7039c1fbb22b9767`；更新 `docker-compose.yml` 将 `RESEARCH_OS_COMMIT` 传递给 API 服务，使 API 容器内 `resolve_research_os_commit()` 正确返回真实 commit；Runner 健康端点确认 `runner_image_digest_verified=true`；API 全量 23 passed、reproducibility 5 passed、Compose/文档/JSON/Idea case/Python 检查通过；更新 `docs/requirements-audit-2026-07-28.md` 中发布身份状态。
- 2026-07-29：完成 `P0-REPRO-026` 真实实验验收；修复 Runner Dockerfile 中 Git "dubious ownership" 阻止非 root 用户读取项目仓库的问题（`git config --system --add safe.directory '*'`）；通过提案 `5e305b36` 在项目 `013493b8` 成功提交并执行 `demo_classification` 实验（run_id=`26103a27`），验证：`run/26103a27` tag 创建，source.tar + 8 个 manifest 快照写入 `artifacts/reproducibility/`，9 条 Artifact 记录（全部 valid=true）+ 9 条 ArtifactDependency 写入 PostgreSQL，Reproducibility 查询返回 `validation.status=verified`，实验成功执行（accuracy=0.8467, mlflow_run_id=`eb9000a1`），6 个输出产物同步入库。
- 2026-07-30：开始 `P1-STREAM-038`；现有未提交流式面板改为只展示可观察的请求处理状态，不展示或伪造模型内部思维；恢复项目创建必须等待 `ready_for_confirmation` 的服务端闸门，待补齐 SSE 与浏览器验证。
- 2026-07-30：完成 `P1-STREAM-038`；SSE 仅公开应用可观察的请求阶段与结构化结果，不输出模型内部推理。API/SSE、同步端点、项目创建闸门、公开 Idea case 来源、桌面/窄屏浏览器和控制台检查均通过；未调用真实模型或外部学术 API。
- 2026-07-30：开始 `P0-CLARIFY-027`；将按 `tests/idea-cases/` 的公开用例验证多轮收敛、超时、并发和 Bridge/API 失败路径，测试输入不在代码或命令行中临时增加。
- 2026-07-30：`P0-CLARIFY-027` 首次 `mnist-cnn` 真实回归出现 `phase` 断言不匹配，第二次同一公开用例通过并保存脱敏结果（`medium` / `gpt-5.6-terra` / `medium`）。已修正回归脚本先落盘响应再断言；该不稳定性须由多轮、并发和失败路径回归覆盖，任务继续保持 `[~]`。
- 2026-07-30：完成 `P0-CLARIFY-027`；修复 3D 主动学习的复杂层路由、Bridge/API 超时边界、未确认数据/资源占位绕过确认闸门与回归产物丢失。4 个公开 case、多轮收敛、并发 MNIST、真实 Bridge 不可用及结构化 504 回归均通过；未创建项目、运行实验或调用学术 API。
- 2026-07-30：完成 `P0-CLARIFY-027` 最终验证；`check_docs_sync.py`、API `27 passed`、聊天 UX `5 passed`、Idea case、Compose、JSON、Python、Node 和 `git diff --check` 均通过，Bridge 健康且未提交密钥或运行产物。
- 2026-07-30：开始 `P0-REGRESSION-032`；执行现有 `scripts/acceptance_test.py`，输入仅来自 `tests/idea-cases/`，结果写入被忽略的 `artifacts/acceptance/`，不把 token 或凭据写入报告。
- 2026-07-30：完成 `P0-REGRESSION-032`；完整真实验收通过，项目 `6d91ff49-12a5-406c-b7aa-cb96aa3f22e4`，报告 `acceptance-20260730-015132.json`，脱敏证据副本已提交到 `docs/evidence/`。
- 2026-07-30：开始 `DOCS-039`；复核发现 README 已指向新验收，但文档同步脚本、中文 README、需求审计、运维验收说明和部分 TODO 基线数字仍引用旧验收事实；`AGENTS.md` 的模型失败与项目 `.env` 规则无需修改。
- 2026-07-30：完成 `DOCS-039`；同步双语 README、需求审计、运维说明、TODO 和同步脚本，归档脱敏验收证据；全部适用验证通过，未暂存 `.env`、认证文件、Docker 配置文件或运行时原件。实现提交：`e08e798`。
- 2026-07-30：开始 `P0-RELATED-002`；先复核现有文献、全文 evidence、claim gate、报告和 API 契约，禁止把元数据候选或合成指标直接写成事实性结论。
- 2026-07-30：开始 `P0-LLM-040`；移除运行链路中的 Windows Bridge，API 改为容器内直连三档独立模型配置；移除 n8n 自动生成通用分类/点云实验计划，主题专属规划未实现时直接返回结构化错误；前端新增左下角模型设置入口，key 只写入忽略的 runtime 挂载文件。
- 2026-07-30：继续 `P0-LLM-040` 与 `P0-RELATED-002`；Windows 安装器不再打包或启动 Bridge，前端移除无效的通用实验计划按钮，Related Work 新增证据边界单元测试。历史验收中的 Bridge/合成实验记录仅作历史证据，不代表当前运行路径。
- 2026-07-30：完成 `P0-LLM-040` 与 `P0-RELATED-002`；验证 API `29 passed`、前端 UX `5 passed`、浏览器设置面板桌面/窄屏检查、Compose/JSON/Idea case/文档同步/AST/`git diff --check`，清理历史 dangling Docker 镜像，删除废弃 Bridge 脚本并清理验收脚本中的旧通用实验路径。未运行真实模型、其他 Idea 或无关实验；功能提交 `4ff3ef4`、清理提交 `4fb4905`、验收入口提交 `8798473`。
- 2026-07-30：开始并完成 `P0-PLAN-006`；新增严格主题专属实验计划契约、复杂层模型直连、全文证据/Idea 版本/策略/预算/主题关联校验、审批 Proposal 持久化、批准后二次校验和前端生成入口。主题 Runner 尚未实现时直接结构化报错，禁止 fallback；同步双语 README、架构/运维/安全边界、需求审计和工具契约。API 容器 `32 passed`，Compose/API 镜像重建、JSON、文档同步和 `git diff --check` 已通过；未调用真实模型、其他 Idea 或无关实验。
- P0-RUNNER-007 当前实现：`runner-launcher` 是唯一 Docker socket 控制边界；每个 Run 使用新的非 root 作业容器、固定 `python -m app.worker` 入口、八个白名单任务模板、固定内部网络、受控继承挂载、CPU/内存/PID/硬上限 tmpfs 输出 volume、超时、取消和结构化终态监控。用户不能提交镜像、命令、路径、网络或环境字段；模型失败和主题不支持不触发任何 fallback。
- P0-RUNNER-007 终态清理：Launcher 的输出同步现在串行且幂等；只读同步 helper、job container 和输出 volume 的清理必须全部成功才返回 `artifacts_synced=true`。Runner 超时和取消会校验该字段，清理失败返回结构化错误，不把停止请求或 HTTP 成功误报为已清理。
- P0-RUNNER-007 当前缺口：GPU 仅完成受控 Docker 请求和无 GPU 时的结构化失败路径，未在真实 GPU 主机验证；主题固定入口和检查点恢复已实现。未运行无关分类/点云实验，任务继续保持 `[~]`。
- P0-RUNNER-007 验证：`docker compose build api runner runner-launcher` 与服务重建成功；容器内 `micromamba 2.3.2`、固定环境 Python `3.12.13`；API `57 passed`，Runner unittest `6 passed`，launcher 普通契约测试 `8 passed`（2 个显式集成用例跳过），真实 per-run Docker 集成测试 `8 passed`；集成后受控 volume 无残留。未调用模型、外部学术 API 或无关实验；任务保持 `[~]`。
- P0-RUNNER-007 提交：`efacc9d` 已创建并与 `d0ad650` 一起推送到 `origin/main`。
- 2026-07-30：完成本轮 `P0-IMPACT-008` 实体级影响分析部分；发现 Idea 审批仍会使项目全部有效 Artifact 失效，新增只读依赖图分析、审批时重新计算、局部 Artifact 失效和审计记录；补齐数据/代码根与检查点建议。验证通过：API `38 passed`、Compose/JSON/Idea case/文档同步/`git diff --check`；提交 `c559704` 已创建，P0-IMPACT-008 继续保持 `[~]`，因为自动主题重跑和 Runner 检查点恢复尚未实现。
- 2026-07-30：开始 `P1-UPLOAD-009`；新增受限材料解析和摘要上下文，前端改为先上传/解析再请求模型，失败直接阻止本轮调用；图片保持 metadata-only，ZIP 只读清单，不解压或执行。同步双语 README、架构、运维、安全和需求审计。验证：API 容器 `42 passed`、`py_compile`、Compose、文档同步、Idea case、前端 UX `5 passed`、`git diff --check` 和浏览器设置面板桌面/窄屏检查通过；图片 OCR、独立恶意样本扫描和大规模材料库仍未实现，任务保持 `[~]`。实现提交：`00441b5` 已推送到 `origin/main`。
- 2026-07-30：继续 `P0-IMPACT-008`；完成检查点局部重跑 Proposal、前端入口、审批/提交二次一致性校验和篡改 payload 测试。当前只支持人工审批后的原白名单重跑，不自动执行，不切换模型，不用无关演示实验替代。API `54 passed`、前端语法/UX、Compose、Idea case、文档同步和 `git diff --check` 通过；任务继续保持 `[~]`，等待主题 Runner 与自动检查点恢复。
- 2026-07-30：继续 `P0-IMPACT-008`；开始将已批准的检查点重跑自动提交到现有白名单 Runner 链，保留源实验/检查点/payload 二次校验，禁止前端二次执行和任何 fallback。待补齐 API 单测、浏览器状态显示、文档同步和验证。
- 2026-07-30：完成本轮 `P0-IMPACT-008` 自动检查点提交：批准 `experiment_rerun` 后自动复用 `/api/experiments` 受控链，失败保留结构化错误并写入审计，前端移除二次执行按钮；主题专属 Runner 仍未实现，不能把它标记为已完成。API `56 passed`；文档同步、Schema/Compose/JSON、Idea case、API 容器编译、前端语法/UX、浏览器面板和 `git diff --check` 均通过。实现提交：`dd8d552`。
- 2026-07-30：继续 `P0-RUNNER-007`；开始扩展受控 Python/C++/GPU 模板和每 Run Docker volume 配额。所有入口保持固定命令、项目内受限入口文件和无 fallback；Conda 运行时与真实 volume 集成验证完成前不标记任务完成。
- 2026-07-30：继续 `P0-RUNNER-007`；开始加入镜像内预构建的固定 micromamba/Conda Python 环境。请求只能选择 `experiment/*.py` 入口，不能提交环境文件、依赖、命令或网络配置；待完成镜像构建、容器运行时检查、契约测试和文档同步。
- 2026-07-30：完成本轮 `P0-RUNNER-007` Conda 增量；修正 micromamba 2.3.2 不支持的 `--quiet/--no-capture-output` 参数，固定命令改为 `micromamba run --prefix /opt/conda/envs/research-os python experiment/*.py`。最终容器内 `micromamba 2.3.2`、Conda Python `3.12.13`、API `57 passed`、Runner `6 passed`、launcher `8 passed`（含两个真实 Docker 集成测试）、`check_docs_sync.py`、Idea case、Compose、前端 UX 和 `git diff --check` 均通过；清理 4 个 dangling 中间镜像。主题专属 Runner/检查点恢复和真实 GPU 主机验证仍未实现，任务保持 `[~]`。
- 2026-07-30：完成 `P1-DIAG-010`；诊断结果由 Python 确定性计算，失败/缺失指标只生成需要人工审批且不自动执行的建议，禁止模型计算或启动后续工作。API `60 passed`，未调用真实模型、外部学术 API 或无关实验。
- 2026-07-30：继续 `P0-RUNNER-007` 与 `P0-IMPACT-008`；新增 `topic_specific` 白名单模板，固定执行项目 `experiment/main.py`，以固定 JSON 路径传入已批准计划和检查点恢复状态，并要求结构化 `metrics.json`/`checkpoint.json`；API、Runner、launcher 三层拒绝命令/路径/镜像/网络/依赖字段。批准主题计划现在可通过网页执行，主题检查点重跑复用原计划和源状态并自动进入受控提交链；缺少入口、产物或进程失败直接返回结构化错误，不使用任何 fallback。容器验证：API `61 passed`，Runner `7 passed`，launcher `8 passed`（2 skipped）；新增主题恢复/产物测试，前端 `node --check` 已通过，真实 GPU 主机验证和影响图自动创建 Proposal 仍未完成，任务保持 `[~]`。
- 2026-07-30：`P0-IMPACT-008` 增加显式变更类型和依赖根校验；未知类型、无基准 Git/数据版本或非法删除目标直接返回结构化 `impact_*` 错误。API `84 passed, 2 skipped`，定向影响/检查点测试 `19 passed`，Compose/JSON/文档同步/Idea case/语法检查通过；Runner 定向回归因权限审查服务不可用未执行，未伪造结果。实现提交：`9d3338f`。
- 2026-07-30：修正 `scripts/acceptance_test.py` 的过时主题计划断言；验收入口不再期待 `topic_specific` “未实现”，也不调用模型-backed 计划生成或用分类/点云实验替代，而是明确记录计划仍需审批且本入口未启动模型请求。静态检查和容器测试继续通过；`P0-RUNNER-007` 的真实 GPU 主机验证与 `P0-IMPACT-008` 的影响图自动 Proposal 仍未完成。
- 2026-07-30：继续 `P0-IMPACT-008`；影响图新增 artifact 节点/依赖边和实验依赖识别，批准变更后自动创建待审批局部重跑 Proposal，重跑 payload 仍由源检查点和白名单模板重建，禁止自动执行或 fallback。API 容器 `63 passed`；文档待最终同步检查，真实 GPU 主机验证、完整语义规则和生产级恢复编排仍未完成。
- 2026-07-30：继续 `P0-IMPACT-008`；修正影响图检查点选择，只推荐与受影响实验绑定的最新 `experiment_succeeded`/`experiment_failed` 检查点，忽略项目暂停等不可重跑检查点；补充回归夹具。API 容器全量 `76 passed, 2 skipped`，未调用模型、外部学术 API 或无关实验；任务继续保持 `[~]`，真实 GPU 主机验证、完整语义规则和生产级恢复编排仍未完成。
- 2026-07-30：完成 `P1-INTENT-014`；已有项目聊天改用容器内模型的严格 `SupervisionIntent` 分类，移除变更/策略关键词识别；只有白名单 Idea/策略字段完整时创建审批 Proposal，状态和审批意图不直接执行，模型失败直接返回结构化错误。API `78 passed, 2 skipped`、Compose/文档同步/Idea case/JSON/`git diff --check` 通过；未调用真实模型、外部学术 API 或无关实验。
- 2026-07-30：完成 `P1-MODEL-044`；修复空的旧 `runtime/model-settings.json` 字段遮蔽容器 `.env` 默认值的问题，统一设置页的轻量卡片视觉和默认值说明；新增 Windows GitHub Actions EXE/SHA-256 草稿 Release 工作流。n8n 继续负责固定工作流编排，模型调用、严格 Schema、审批和 fail-fast 校验仍由 API 容器负责，避免把动态 key 写入 workflow。API 容器 `102 passed, 2 skipped`，浏览器桌面/窄屏检查通过；P2-INSTALLER-029 因缺 Inno Setup、签名证书、干净 VM 和失效 GitHub token 继续进行中。
- 2026-07-30：继续 `P1-UPLOAD-009`；增加已扫描图片的受限视觉输入，最多 4 张、单张 4 MB、总量 12 MB，使用临时 data URL 传给当前配置模型，不写入消息或运行日志；文件缺失、读取失败或超限直接返回结构化错误，不使用 OCR/模型 fallback。README 双语同步版本 `2026-07-30-17`；API 容器 `108 passed, 2 skipped`，Compose/Python/文档/Idea case/`git diff --check` 通过。大规模材料库和更广泛视觉能力仍未完成。
- 2026-07-31：继续 `P1-UPLOAD-009`；新增项目范围 `GET /api/projects/{project_id}/materials/search`，对已扫描材料名称、解析元数据和受限摘要执行确定性词法检索，支持 `limit`/`offset` 分页，结果明确标记 `deterministic_lexical_metadata_only` 与 `unverified_material_context`，不泄露路径、不执行附件、不调用模型。增加白名单字段索引和路径字段回归，前端 Literature 面板支持搜索和加载更多；README 双语、运维说明、需求审计和截图证据同步。API 容器 `138 passed, 2 skipped`，浏览器桌面检查通过；大规模异步索引、跨材料语义检索和更广泛视觉能力仍未完成。实现提交：`5b9a657`。
- 2026-07-30：继续 `P1-PAPER-016`；新增 evidence-grounded `paper/main.tex` 生成器和 `POST /api/projects/{project_id}/paper-draft`，只接受当前 Idea、已核验页码/章节 quote，并仅写入真实成功实验指标；metadata-only、缺失证据和未执行结果不会升级为论文事实。前端概览新增“生成证据论文草稿”按钮，接口只创建需审批的 LaTeX replace Proposal，批准前不写文件。同步工具契约、双语 README、运维说明和需求审计；新增缺失 Idea、metadata-only 和严格证据 Proposal 路由回归；API 容器 `106 passed, 2 skipped`，Node UX `5 passed`，文档/Idea case/Compose/容器 Python/JSON/`git diff --check` 和浏览器模型设置桌面/窄屏检查通过，控制台错误为 0。完整语义 claim 映射、生产级论文编译和完整论文能力仍未完成，任务保持 `[~]`。提交：`72b4c68`。
- 2026-07-30：完成 `P1-UX-045`；修复浏览器缓存旧静态资源导致的模型来源不显示问题，新增 `app.js`/`styles.css` 版本查询参数；确认三档共享容器 `.env` 默认 URL/key、设置弹窗、未保存保护和模型失败直报错误；n8n/API 边界与 Windows Release 签名门禁保持一致。API `107 passed, 2 skipped`，Node UX `5 passed`，Compose/JSON/文档同步/Idea case/JS 检查通过；浏览器桌面/窄屏无横向溢出。GitHub token 失效，正式 Release 仍待有效权限和签名/干净 VM 验收。
- 2026-07-30：继续 `P1-PAPER-016`；扩展 evidence-grounded `paper/main.tex` 生成器为完整确定性章节结构，增加 Method/Experiment 状态表、成功 Run 指标表、未执行结果、逐条 evidence ID/定位、claim-to-evidence map、Conclusion 和 References，并安全处理可选约束/预算字段。新增无结果和 provenance 回归；API `107 passed, 2 skipped`，文档与结构检查待本轮最终复核。语义 claim 映射质量和生产级 LaTeX 编译验收仍未完成。
- 2026-07-30：继续 `P2-QUEUE-020`；研究启动/恢复任务改由 PostgreSQL 持久队列和独立 `queue-worker` 领取，增加 lease、幂等键、指数退避和过期 lease 回收；API 不再把必需的 n8n 编排交给进程内 `BackgroundTasks`。真实数据库迁移为 `0002_task_queue`，临时过期任务集成验证成功，API `112 passed, 2 skipped`，Compose/语法/文档/Idea case/`git diff --check` 通过。实验 Runner 队列、完整崩溃恢复和生产级队列观测仍未完成。
- 2026-07-30：Docker Desktop Linux engine 恢复后复核模型配置和前端：`docker compose config --quiet` 通过；API 容器 `112 passed, 2 skipped`；`GET /api/settings/models` 脱敏结果显示 Luna/Terra/Sol 三档 URL/key 均来自 `env_default` 且 `key_configured=true`，medium 不再误报未配置；浏览器设置面板桌面 1440px 和窄屏 390px 均无横向溢出，三档卡片可操作，控制台错误为 0。GitHub CLI 当前已登录，但正式安装器 Release 仍受签名证书、Authenticode 验证和干净 Windows VM 门禁约束；不绕过门禁发布未签名 EXE。
- 2026-07-30：完成 `P2-QUEUE-020`；API 创建/恢复项目任务统一走白名单幂等入队函数，唯一键冲突返回已有 Task；项目详情返回 `max_attempts`、下一次执行时间、租约截止时间和更新时间，但不返回 lease token。API `122 passed, 2 skipped`；真实 PostgreSQL 集成验证幂等入队、过期 lease 重新领取和陈旧 lease 忽略；queue-worker 已恢复运行。实现仍不把实验 Runner 执行链误称为持久队列。
- 2026-07-30：继续 `P1-PAPER-016`；编译 Proposal 绑定干净项目 `paper/main.tex` 的 Git commit/SHA-256，审批时和 `compile_latex` Runner 提交前双重核验，源文件变化返回 `compile_approval_source_changed`。论文/patch 定向测试 `40 passed`，Runner 固定 latexmk 测试通过；真实带 `references.bib` 项目的 `paper/main.tex` 在 Runner 容器按实际工作目录编译成功并生成 77KB 非空 PDF。语义 claim 映射仍只是人工复核候选，P1-PAPER-016 继续保持 `[~]`。
- 2026-07-30：继续 `P1-PAPER-016`；claim map 增加多语言归一化 lexical candidate 与人工复核字段，新增 Runner 容器内固定 `latexmk` 最小文档回归。候选仍不升级为语义证据或科学结论；`semantic_status=not_proven_lexical_candidates_only`、完整语义核验和生产级论文编译验收继续保持未完成。
- 2026-07-30：本轮验证通过文档同步、Compose、JSON、JS、聊天 UX、API `117 passed, 2 skipped`、Runner `10 passed` 和 launcher `6 passed, 2 skipped`；新增 `test_fixed_latexmk_command_produces_a_nonempty_pdf` 通过。`scripts/acceptance_test.py` 在首次真实模型请求处收到 HTTP 502 `llm_request_failed`，未使用 fallback、未写伪造助手消息且未生成验收通过产物；P1-PAPER-016 继续保持 `[~]`。实现提交：`8ee8e57`。
- 2026-07-30：继续 `P0-RUNNER-007`；修复 Launcher 终态同步并发竞态，清理 helper/job container/output volume 任一失败都 fail-closed；Runner 超时/取消必须确认 `artifacts_synced=true`。容器内 Runner `10 passed`、Launcher `10 passed`，启用显式 Docker 集成测试后两个真实隔离测试均通过，Runner/Launcher `py_compile` 通过，Compose 服务重建成功。真实 GPU 主机验证仍未完成，任务保持 `[~]`；未调用模型、外部学术 API 或无关实验。实现提交：`662d608`。
- 2026-07-30：完成 `P2-SEARCH-018`；修正 GitHub 资源候选缺少 `provider/resource_type` 导致前端显示 `unknown` 的问题，并让空的 provider 异常保留异常类型/HTTP 状态。活动项目真实检索、浏览器 Literature 页面、provider errors 和合规候选显示均已验证，任务标记 `[x]`。
- 2026-07-31：继续 `P2-HA-021`；新增固定范围健康/容量/备份/恢复工具和 7 项单测。真实 Compose 健康快照、容量检查、备份 `20260730T163859Z`、SHA-256 manifest、轮换及隔离恢复演练通过；恢复不覆盖 live volume，固定 volume 归档复用已有 `postgres:16-alpine` 镜像。HA 集群、自动外部告警和长期无人值守生产演练仍未完成，任务保持 `[~]`。实现提交：`8defbb5`。
