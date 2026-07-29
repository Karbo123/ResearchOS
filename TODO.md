# Research OS TODO

> 这是项目的实时任务源。任何功能、修复、审计或文档工作都必须在开始、状态变化和完成时更新本文件。

最后更新：2026-07-29（Asia/Shanghai，P0-REPRO-026 实验可复现快照仍在进行）

状态说明：`[ ]` 待处理，`[~]` 进行中，`[x]` 已完成并验证，`[!]` 阻塞。完成项必须附验证证据；不能用“已有 Schema/接口占位”代替真实实现。

## 当前状态

- 当前可用版本：可运行、可审计的本地 MVP，不是完整生产系统。
- 当前进行中：`P0-REPRO-026` 实验可复现快照、Git 大文件门禁与产物谱系接入仍待正式 Runner digest、真实实验恢复和发布级验收。
- 最新完整验收：`artifacts/acceptance/acceptance-20260729-012750.json`。
- 最新测试项目：`8c40dc70-519a-4c87-99ac-d37003a56640`（验收结束后为 cancelled）。
- 需求审计：`docs/requirements-audit-2026-07-28.md`。

## 已暂停的前序工作

下列事项均为**待处理**，本次只记录，不授权实现、运行完整验收或产生额外模型/API 成本：

- `P0-CLARIFY-027`：自适应澄清核心路径与三级路由已写入代码，但仍需在用户批准后完成全公开用例回归、异常/超时/并发一致性检查，并确认所有模式下 ProjectSpec 收敛没有回归。
- `P0-REGRESSION-032`：针对最新自适应澄清、模式 Toggle、Bridge 严格输入和消息 metadata 的完整端到端验收；必须只读取 `tests/idea-cases/`，每次真实调用前由用户明确批准测试范围和预计成本。
- `P2-INSTALLER-029`：已有 Windows 在线引导安装器源码；仍缺正式 EXE 生成、代码签名、Docker Desktop 许可复核、干净 Windows VM 安装/升级/卸载验收和发布校验和。
- 其余原始需求缺口继续按下面 P0/P1/P2 条目管理；不得因为已有 Schema、演示任务或文档描述而视为完成。

## P0：科研可信度与执行安全

- [x] `P0-LLM-036` 移除所有模型调用降级、隐式切换和宿主 Codex 配置读取。
  - 范围：Bridge 或其他模型提供商调用失败必须返回结构化 API 错误；不得切换到另一提供商、规则猜测、关键词回复或写入伪造助手消息。Bridge 只从项目环境变量读取非敏感模型/provider 配置，不读取 Windows Codex `config.toml`，不读取或复制认证文件。
  - 完成标准：API、Bridge、Schema、工具契约、前端错误显示、测试、双语 README、运维/安全文档、需求审计、`AGENTS.md` 和 `TODO.md` 一致；错误路径有自动化验证，成功路径仍保留严格结构化输出。
  - 验证要求：`docker compose config --quiet`、Python/JSON/文档同步检查、API 容器测试、聊天 UX 测试、`git diff --check`；不为本任务调用真实模型或外部学术 API。
  - 验证结果：删除 API 规则回复、自动 provider 切换和 `fallback_used` 契约；Bridge 只从项目 `.env` 读取非敏感配置，健康端点返回 `config_source=environment`；模型失败单测覆盖超时、显式 Bridge 优先和未配置 provider（API 容器 `23 passed`）；`docker compose config --quiet`、API/Runner Python 编译、`check_docs_sync.py`、`check_idea_case_sources.py`、7 个 Schema/Workflow JSON、`node --test scripts/test_chat_ux.mjs`（5 passed）和 `git diff --check` 通过；未调用真实模型或外部学术 API。

- [x] `P0-IDEA-CASES-030` 建立公开、唯一、可审计的 Idea 测试用例目录。
  - 完成标准：所有用于 Idea 澄清、模型路由的输入与后续回答均保存为独立 UTF-8 JSON 文本文件；测试加载器只读取仓库内固定目录，拒绝重复 ID、未知字段、非法模式和命令行临时 Idea；测试脚本、单元测试和验收脚本不得隐藏、硬编码或运行时增添测试 Idea。
  - 文档要求：测试目录 README、项目级 `AGENTS.md`、双语 README 和需求审计都明确唯一来源规则及新增/修改用例方法。
  - 验证：自动检查测试代码不存在 Idea 字面量；单元测试与验收入口都通过同一严格加载器按文件名/ID读取用例。
  - 本轮额度约束：真实模型只允许调用 `tests/idea-cases/mnist-cnn.json` 一次；其他公开用例暂不发送给模型，完整 `scripts/acceptance_test.py` 暂不运行，等待用户后续明确批准。
  - 验证结果：`python scripts/check_idea_case_sources.py` 返回 `IDEA_CASES_OK=4`；所有 JSON 解析通过；容器测试 `17 passed`；唯一真实调用直接读取 `mnist-cnn.json`，未读取或发送其他 Idea 给模型。

- [ ] `P0-CLARIFY-027` 完成自适应 AI 对话与三级模型路由的剩余回归和收敛验证。
  - 背景：此前 `clarification.py` 使用固定 `QUESTIONS/ORDER`，即使 Idea 已包含 PyTorch、CUDA、CNN、MNIST 等明确语义，也可能机械追问领域；该编排缺陷的代码修复已完成，但尚未经过全部公开用例和异常路径回归。
  - 完成标准：每轮模型基于当前结构化草稿、对话上下文和用户新消息，推断有充分依据的领域/关键词，标记假设与不确定项，自适应生成少量高信息增益问题；不得再按固定问题清单逐项轮询；数据授权和资源信息不得因推断而绕过确认。
  - 模型路由：默认简单任务 `gpt-5.6-luna`、中等任务 `gpt-5.6-terra`、复杂任务 `gpt-5.6-sol`，模型名、复杂度阈值和各层推理强度均可由 `.env` 配置；每轮响应与审计元数据记录实际层级/模型，Codex Bridge 不暴露宿主认证文件。
  - 失败要求：模型不可用时必须返回明确的结构化错误；不得进入本地规则回复、固定问题队列或其他自动降级路径。
  - 验证：MNIST/CNN 输入应主动识别为机器学习/深度学习/计算机视觉/图像分类并询问真正缺失的实验约束；短输入仍需澄清；结构化输出、模型路由和模型失败报错均有测试。
  - 已完成部分：固定问题队列已移除；Luna/Terra/Sol 路由、严格输出、默认全自动/可选详细模式和 MNIST 单轮真实验证已实现。
  - 剩余工作：经用户批准后运行所有公开用例的多轮收敛、超时、并发和 Bridge/API 失败回归；在此之前不得把本项标记完成。

- [ ] `P0-REGRESSION-032` 对最新 Idea 澄清主链执行成本受控的完整端到端回归。
  - 范围：只允许从 `tests/idea-cases/*.json` 读取启用用例；禁止测试代码、命令行或运行时增加隐藏 Idea。
  - 审批：运行前列出将调用的 case ID、模型层级、最大轮数和预计模型/API 成本，并获得用户明确批准；默认只运行不调用模型的静态与单元检查。
  - 完成标准：公开用例覆盖不足信息、MNIST 工程基准、复杂/详细模式和项目创建主链；结果写入被 Git 忽略的 `artifacts/acceptance/`，脱敏摘要按需进入 `docs/evidence/`；不得生成虚假论文、结果或费用。

- [x] `P0-EVIDENCE-001` 实现合法 PDF 下载、哈希、全文解析、页码/章节定位和 quote 证据入库。
  - 完成标准：至少用 3 篇开放论文验证；每个 claim 保存原文、页码、PDF 哈希、稳定来源和 BibTeX；无法验证时禁止进入论文结论。
  - 验证：`acceptance-20260729-012750.json` 从全新 Idea 下载并解析 3 篇 allowlist 开放 PDF，保存 3 个 SHA-256、页码 quote、BibTeX、Artifact/Dependency 与 Git 证据 JSON；claim gate 明确排除 metadata/title。
- [ ] `P0-RELATED-002` 实现基于证据库的 Related Work、研究空白和重复研究分析。
  - 依赖：`P0-EVIDENCE-001`。
  - 完成标准：每个事实性句子可追踪到 evidence ID；不得仅凭标题、摘要或 DOI 标记为“已证实创新”。
- [ ] `P0-CODE-003` 实现官方代码仓库交叉验证、许可证审查、commit/tag 固定和审批后受控下载。
  - 完成标准：作者/论文主页/仓库至少双源匹配；保存 URL、SPDX、commit、论文关系、下载时间和审计事件；未知许可证不得执行。
- [x] `P0-POLICY-004` 实现项目策略执行引擎，并在计划生成和 Runner 提交时二次强制校验。
  - 完成标准：策略违反请求返回结构化错误；验收覆盖种子数、引用证据和高成本审批规则。
  - 验证：`acceptance-20260729-005847.json` 覆盖中英文策略解析、5 种子计划、3 种子结构化拒绝、Runner 二次校验、引用证据就绪度和审批约束；浏览器验证策略页且无控制台错误。
- [x] `P0-STATE-005` 让暂停/取消成为强制执行闸门，而不仅是项目状态字段。
  - 完成标准：暂停项目拒绝新工作流、检索、计划和 Runner 提交；取消会停止活动任务；恢复后可从检查点继续。
  - 验证：`acceptance-20260729-003629.json` 覆盖暂停 409 闸门、活动 Runner 取消、检查点恢复和 cancelled 不可恢复；浏览器验证暂停时执行按钮禁用、恢复后重新可用。
- [ ] `P0-PLAN-006` 用 ProjectSpec、文献证据和项目策略生成 Idea 专属实验计划。
  - 完成标准：真实列出数据集、基线、指标、消融、统计检验、随机种子、资源预算、风险和成功标准；不再固定返回合成 demo。
- [ ] `P0-RUNNER-007` 增加每任务独立容器/作业隔离和参数化白名单任务模板。
  - 完成标准：支持受控 Python、C++/CMake、Conda 环境和可选 GPU；非 root、镜像 digest、网络策略、磁盘/CPU/GPU/内存/PID 配额、超时、取消和完整日志均有集成测试。
- [ ] `P0-IMPACT-008` 实现实体级影响分析、精确失效传播和检查点局部重跑。
  - 完成标准：Idea/配置/数据/代码修改只失效依赖后代；生成可审阅影响图；自动选择正确检查点，不再默认使全部产物失效。
- [~] `P0-REPRO-026` 为每次实验建立不可变、可复核但不追踪大文件的代码与环境快照。
  - 完成标准：实验开始前要求项目 Git 工作树干净；将已批准的代码/配置变更提交并创建 `run/<run_id>` tag；记录项目仓库 commit、Research OS 主仓库 commit、Runner 镜像 digest、ProjectSpec/策略/配置/随机种子、依赖锁文件和数据 manifest/hash；输出与源码快照建立 PostgreSQL 依赖关系。
  - 大文件策略：Git 只追踪源码、配置、BibTeX/LaTeX、manifest、哈希和小型元数据；Git 禁止追踪 PDF、PLY/PCD、PNG、模型权重、数据集、数据库备份、源码 bundle、Docker layer、Conda/package cache 和日志归档。源码 bundle、环境报告、数据/模型清单和大型产物保存到 MinIO 或受控 `artifacts/`，数据库只保存 URI、大小、SHA-256、版本和有效性元数据；主仓库 `.gitignore`、大小门禁和测试必须验证这一点。
  - 完成验证：用一次真实实验检查 Run ID 可恢复对应源码快照、配置、环境 digest、数据 manifest 和全部输出；模拟未提交修改、丢失本地源码和大文件误 `git add` 时均应拒绝或给出结构化错误，不得把备份大文件推送到 GitHub。
  - 本轮范围：先完成本地 Git/Runner/API 门禁、快照元数据与受控产物归档；真实完整验收、外部模型和外部学术 API 仍不运行。
  - 本地验证结果：`docker compose config --quiet`、`docker compose up --build -d`、API `/api/health`、n8n/MLflow HTTP 200、PostgreSQL healthy、Runner/API 启动日志、`docker compose exec -T api pytest -q`（`21 passed`）、`python scripts/check_idea_case_sources.py`（`IDEA_CASES_OK=4`）、`python scripts/check_docs_sync.py`、全部 Schema/Workflow JSON 解析和 `git diff --check` 通过。
  - 剩余解除条件：配置真实 `RUNNER_IMAGE_DIGEST=sha256:<64 hex>`；完成一次真实实验的源码 tar、manifest、环境/数据恢复和全部输出验收；用户明确批准后再运行完整模型/学术 API 验收。宿主机直接 `py_compile` 仍受历史容器生成的 root-owned `__pycache__` 拒绝，API 代码已在容器内通过语法校验，Runner 已通过启动导入校验。

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

- [ ] `P1-UPLOAD-009` 解析已上传 PDF、图片、CSV/JSON、日志、文本和代码材料，并将提取结果纳入澄清与规划。
  - 完成标准：保留原文件、MIME、SHA-256、解析器版本和派生文本；恶意文件扫描、压缩炸弹和大小限制有测试。
- [ ] `P1-DIAG-010` 实现通用数值分析、失败诊断和后续实验建议闭环。
  - 完成标准：统计由 Python 计算；LLM 只解释和质疑；错误日志、异常指标和缺失数据会形成待审批建议。
- [ ] `P1-VIEWER-011` 增加 PLY/PCD/网格交互式 3D 查看器及 HTML/PDF/表格预览。
  - 完成标准：桌面和移动端可加载、旋转、缩放、下载；大型文件有降采样；产物谱系在查看器中可见。
- [ ] `P1-TRACKING-012` 完善 MLflow 资源和环境追踪。
  - 完成标准：记录学习率、连续 CPU/内存/GPU、模型版本、镜像 digest、数据版本、Git commit、种子和状态；敏感字段不会进入日志。
- [ ] `P1-REPORT-013` 完善日报/周报内容及外部推送适配器。
  - 完成标准：覆盖新论文/BibTeX/代码、创新性变化、实验状态、异常、重点产物、真实资源/API 成本、Agent 决策和待审批事项；至少实现一种本地以外渠道并可关闭。
- [ ] `P1-INTENT-014` 用严格结构化分类替代对话变更的关键词识别。
  - 完成标准：解释、建议、执行变更、长期策略、暂停/恢复/取消、批准/驳回均有 Schema 和歧义测试；任何执行型输出仍需审批。
- [ ] `P1-PATCH-015` 完成代码/配置/LaTeX patch 的“提案—diff—审批—隔离验证—Git commit—审计”执行器。
  - 完成标准：覆盖冲突、验证失败、回滚、依赖安装、覆盖/删除和对外发布禁用路径。
- [ ] `P1-PAPER-016` 实现基于验证证据的完整 LaTeX 论文生成与更新。
  - 依赖：`P0-EVIDENCE-001`、`P0-RELATED-002`、`P0-PLAN-006`。
  - 完成标准：Introduction、Related Work、Method、Experiments、Results、Limitations 和 References 可追踪；编译前必须审批 diff。
- [ ] `P1-DB-017` 引入正式数据库迁移和最小权限角色。
  - 完成标准：使用迁移工具管理 18 张业务表；API、n8n、MLflow 使用独立角色/schema；备份恢复测试通过。

## P2：覆盖面与长期运行

- [ ] `P2-INSTALLER-029` 提供 Windows 单 EXE 引导安装器，使用户无需预配置 n8n 或手工复制配置。
  - 完成标准：发布一个签名/可校验的安装 EXE，内置 Research OS 应用文件和 Compose/n8n 工作流，首次运行生成本地 Secret、选择数据目录、检查 WSL2/虚拟化和 Docker Engine；Docker Desktop 缺失时可经用户明确同意下载官方安装器并请求管理员权限，完成后自动启动 Compose、Codex Bridge 和本地入口。
  - 边界：受 Docker Desktop 许可、体积和 Windows 管理员权限约束，不把 Docker 二进制、账号、Cookie、API key 或 Codex `auth.json` 硬编码进仓库/安装包；离线全量包需单独评估官方再分发许可。n8n 由 Research OS Compose 自动部署，用户无需已有 n8n。
  - 完成验证：在未安装 n8n 的干净 Windows VM 中仅运行 EXE，完成健康检查并打开 `http://127.0.0.1:8080/`；卸载保留/删除数据必须由用户选择；升级不覆盖 PostgreSQL/MinIO/n8n volumes。
  - 已完成部分：`installer/windows/` 已包含 bootstrap、Inno Setup、构建脚本和说明；尚未形成可发布二进制。
  - 剩余工作：生成正式 EXE、签名并发布 SHA-256；复核 Docker Desktop 下载/许可边界；完成无 n8n 的干净 VM 安装、重启、升级、保留数据卸载与全删除卸载测试。

- [ ] `P2-SEARCH-018` 增加 GitLab、数据集/模型注册表和合规网页检索，并统一限流、robots.txt 与条款记录。
- [ ] `P2-TRACKING-019` 按部署需求评估自托管 W&B/TensorBoard；不能削弱现有离线 MLflow 路径。
- [ ] `P2-QUEUE-020` 为长任务增加持久队列、租约、重试退避、幂等键和崩溃恢复。
- [ ] `P2-HA-021` 增加长期运行监控、健康告警、备份轮换、容量限制和升级/回滚演练。
- [ ] `P2-RAG-022` 仅在论文规模证明需要时引入 RAGFlow/LlamaIndex；保留 evidence ID 和页码追踪。
- [ ] `P2-GRAPH-023` 仅在 n8n 循环、分支和检查点恢复难以维护时评估 LangGraph，不提前增加双状态源。

## 文档与开发体验

- [x] `DOCS-035` 删除完整真实验收必须等待用户扩大授权的项目规则。
  - 范围：删除 `AGENTS.md` 第 89 行的完整验收等待门槛；保留第 42 行高成本实验、代码/配置/依赖和对外发布的 Proposal/明确批准/隔离执行要求；Bridge 恢复后最多进行一次 `mnist-cnn` 模型提交且不调用外部学术 API，Bridge 未监听期间的失败请求不计入模型调用。
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
- [x] `BASE-006` 自托管 MLflow、MinIO/受控文件系统、PNG/PLY/JSON/PDF 产物和依赖记录。验证：最新验收 7 个检查点、101 条依赖。
- [x] `BASE-007` n8n 主流程、聊天网关、日报/周报工作流和本地 Cookie 自动登录。验证：3 个 Active 工作流，自动入口进入 `/home/workflows`。
- [x] `BASE-008` PostgreSQL 持久化 18 张业务表，聊天不是唯一状态源。验证：项目重载后 Idea、审批、策略、实验、产物和反馈仍存在。

## 更新记录

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
- 2026-07-29：`P1-CHAT-UX-028` 仍为 `[~]`；剩余解除条件是用户批准一次公开 Idea 的真实浏览器提交并检查完成/失败状态，不能用无模型回归替代。
- 2026-07-29：`P1-CHAT-UX-028` 实现提交 `ed738ee` 已创建，包含前端状态逻辑、无模型回归、双语文档和需求审计更新；待 TODO 记录提交后推送。
- 2026-07-29：`DOCS-034` 提交 `996e942` 已创建，待最终复核后推送；本次提交未包含 `.env`、凭据、运行产物或数据库/volume 内容。
- 2026-07-29：完成 `DOCS-035` 与 `P1-CHAT-UX-028`；删除 `AGENTS.md` 原第 89 行的完整验收等待门槛，保留高成本实验审批；以宿主权限启动 Codex Bridge，`mnist-cnn` 浏览器真实调用成功（`gpt-5.6-terra`/medium），等待/恢复、无溢出和脱敏验证记录通过；未调用其他 Idea 或外部学术 API。
- 2026-07-29：完成 `P0-LLM-036`；模型调用失败现在返回结构化 API 错误，禁止自动切换 provider、规则/关键词回复和伪造助手消息；Bridge 改为只使用项目 `.env` 的非敏感配置，健康端点不再返回宿主 Codex 路径；同步 API/Bridge、Schema、测试、双语 README、运维/安全、需求审计和 `AGENTS.md`，未运行真实模型或外部学术 API，提交记录随后补入本条。
