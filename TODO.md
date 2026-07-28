# Research OS TODO

> 这是项目的实时任务源。任何功能、修复、审计或文档工作都必须在开始、状态变化和完成时更新本文件。

最后更新：2026-07-29 02:46（Asia/Shanghai）

状态说明：`[ ]` 待处理，`[~]` 进行中，`[x]` 已完成并验证，`[!]` 阻塞。完成项必须附验证证据；不能用“已有 Schema/接口占位”代替真实实现。

## 当前状态

- 当前可用版本：可运行、可审计的本地 MVP，不是完整生产系统。
- 当前进行中：无。下一优先项为 `P0-RELATED-002`，尚未开始。
- 最新完整验收：`artifacts/acceptance/acceptance-20260729-012750.json`。
- 最新测试项目：`8c40dc70-519a-4c87-99ac-d37003a56640`（验收结束后为 cancelled）。
- 需求审计：`docs/requirements-audit-2026-07-28.md`。

## P0：科研可信度与执行安全

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
- [ ] `P0-REPRO-026` 为每次实验建立不可变、可复核但不追踪大文件的代码与环境快照。
  - 完成标准：实验开始前要求项目 Git 工作树干净；将已批准的代码/配置变更提交并创建 `run/<run_id>` tag；记录项目仓库 commit、Research OS 主仓库 commit、Runner 镜像 digest、ProjectSpec/策略/配置/随机种子、依赖锁文件和数据 manifest/hash；输出与源码快照建立 PostgreSQL 依赖关系。
  - 大文件策略：Git 只追踪源码、配置、BibTeX/LaTeX、manifest、哈希和小型元数据；Git 禁止追踪 PDF、PLY/PCD、PNG、模型权重、数据集、数据库备份、源码 bundle、Docker layer、Conda/package cache 和日志归档。源码 bundle、环境报告、数据/模型清单和大型产物保存到 MinIO 或受控 `artifacts/`，数据库只保存 URI、大小、SHA-256、版本和有效性元数据；主仓库 `.gitignore`、大小门禁和测试必须验证这一点。
  - 完成验证：用一次真实实验检查 Run ID 可恢复对应源码快照、配置、环境 digest、数据 manifest 和全部输出；模拟未提交修改、丢失本地源码和大文件误 `git add` 时均应拒绝或给出结构化错误，不得把备份大文件推送到 GitHub。

## P1：材料理解、结果检查与协作

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

- [ ] `P2-SEARCH-018` 增加 GitLab、数据集/模型注册表和合规网页检索，并统一限流、robots.txt 与条款记录。
- [ ] `P2-TRACKING-019` 按部署需求评估自托管 W&B/TensorBoard；不能削弱现有离线 MLflow 路径。
- [ ] `P2-QUEUE-020` 为长任务增加持久队列、租约、重试退避、幂等键和崩溃恢复。
- [ ] `P2-HA-021` 增加长期运行监控、健康告警、备份轮换、容量限制和升级/回滚演练。
- [ ] `P2-RAG-022` 仅在论文规模证明需要时引入 RAGFlow/LlamaIndex；保留 evidence ID 和页码追踪。
- [ ] `P2-GRAPH-023` 仅在 n8n 循环、分支和检查点恢复难以维护时评估 LangGraph，不提前增加双状态源。

## 文档与开发体验

- [x] `DOCS-024` 建立 GitHub 风格英文主 README、同步中文 README、真实 UI 截图和详细安装/配置/使用教程。
  - 完成标准：英文 `README.md` 默认入口、`README.zh-CN.md` 中文入口；两版章节与事实同步；包含真实 Research OS 页面截图、架构、快速开始、Windows Codex Bridge、环境变量、操作流程、安全、备份、升级、测试、故障排查和项目边界。
  - 维护要求：`AGENTS.md` 明确重大更新必须实时同步 README 双语版、配置示例、TODO、需求审计和相关 docs；CI/测试可检测双语 README 关键版本标记漂移。
  - 验证：`python scripts/check_docs_sync.py` 通过（17 个对应二级章节、相同同步版本与验收项目）；真实验收项目四张 JPEG 截图非空且浏览器控制台错误为 0；`docker compose config --quiet` 通过；API 容器 `12 passed`；3 个 Schema 与 3 个 n8n 工作流 JSON 均解析通过。

- [x] `REPO-025` 将当前 MVP 安全提交并推送到 `Karbo123/ResearchOS.git`，并建立重大更新自动提交约定。
  - 完成标准：只提交仓库内非敏感文件；配置 GitHub `origin`；提交前通过文档同步、Compose/Python/JSON/API 测试；使用当前 Windows Git 凭据推送当前分支；在 `AGENTS.md` 写明重大更新的自动 commit/push 触发、检查和禁止提交 Secret 规则。
  - 验证：远程初始状态为空；`origin=https://github.com/Karbo123/ResearchOS.git`；首次提交 `d13f175` 与最终完成记录 `fddf64f` 均已推送到 `origin/main`；暂存扫描排除了 `.env`、运行产物、项目工作区、数据库备份和常见 token/私钥模式；`git diff --cached --check`、`python scripts/check_docs_sync.py`、Compose 配置、Python 编译和 API `12 passed` 均通过。

## 已完成基线

- [x] `BASE-001` Docker Compose 本地部署，核心端口仅绑定 `127.0.0.1`。验证：`docker compose config --quiet`、`docker compose ps`。
- [x] `BASE-002` 多轮 Idea 澄清、严格 ProjectSpec 和危险 Idea 阻断。验证：完整验收短 Idea 与恶意 Idea 用例。
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
