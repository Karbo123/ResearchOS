# Research OS 项目代理说明

本文件适用于仓库根目录及所有子目录。进入本项目工作的任何 Agent 或自动化工具都必须遵守本文件。

## 项目定位

Research OS 当前是一个可运行、可审计的本地科研自动化 MVP，不是完整生产系统。不得把元数据检索表述为全文证据核验，不得把合成 demo 指标表述为研究 Idea 的科学结论，也不得把未执行的工具契约表述为已实现功能。

主要组件：

- `apps/api/`：FastAPI、聊天澄清、项目状态、检索、审批、报告和 Web UI。
- `apps/runner/`：非 root、参数白名单、异步执行、取消/超时、日志和 MLflow。
- `n8n/workflows/`：主研究、项目聊天、日报/周报编排。
- `schemas/`：ProjectSpec、初始 Idea 和高层工具 JSON Schema。
- `infra/postgres/`：PostgreSQL/n8n/MLflow 初始化。
- `projects/`：每个研究项目的独立 Git 工作区。
- `artifacts/`：Runner 产物、验收 JSON 和受控本地日志。
- `docs/`：架构、安全、运维、模板和需求审计。

PostgreSQL 是业务状态源；聊天记录不是唯一记忆。代码、配置、BibTeX 和 LaTeX 使用 Git；大文件进入 MinIO 或受控文件系统。

## TODO.md 是实时任务源

根目录 `TODO.md` 必须始终与实际工作状态一致。

1. 开始任何非微小工作前，找到对应稳定任务 ID；没有对应项时先新增条目和完成标准。
2. 开始执行时把状态改为 `[~]`，并更新“最后更新”和“当前进行中”。
3. 方案、范围或依赖变化时立即更新任务描述，不能等到最终回复才一次性补写。
4. 只有实现、验证和必要文档全部完成后才能标记 `[x]`，并在条目或更新记录中写明验证命令/产物。
5. 外部依赖或用户决策造成真实阻塞时标记 `[!]`，写清阻塞条件和解除条件；普通困难不能标为阻塞。
6. 任务部分完成仍保持 `[~]` 或拆成已完成与待处理子项，不得用模糊“基本完成”关闭任务。
7. 新发现的缺陷、风险和原始需求缺口必须进入 TODO；不得只留在聊天、日志或代码注释里。
8. 每次结束工作前复核 `TODO.md`。最终回复中的完成状态必须与文件一致。

状态只使用：`[ ]` 待处理、`[~]` 进行中、`[x]` 已完成并验证、`[!]` 阻塞。

## 安全边界

- 禁止把 LLM 输出直接传给任意 Shell、任意 SQL、任意文件路径或无限制网络工具。
- Agent 能调用的能力必须是参数受限的高层 API/工作流，并经过 Pydantic/JSON Schema 校验；Runner 必须再次校验。
- Runner 保持非 root、`no-new-privileges`、capability drop、资源限制、固定工作根和命令/任务白名单。
- 高成本实验、代码/配置/LaTeX 修改、依赖安装、覆盖/删除、合并和对外发布必须走 Proposal、diff、明确批准、隔离执行、验证、Git commit 和审计流程。
- 不得打印、提交或外发 `.env`、Codex `auth.json`、Cookie、数据库凭据、Runner secret、MinIO secret 或数据库备份内容。
- 不得把 `5678`、`8080`、`5000`、`9001` 等本地服务端口改为公网/局域网监听后继续使用无感登录。
- n8n 节点必须保持 `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`；内置工作流只使用固定 Compose 私有服务地址。
- 文献引用必须可验证。没有全文 quote、页码/章节和稳定来源时，只能标为元数据候选，不能支撑论文事实性结论。
- 仓库标题匹配只是候选。未核验作者/论文关联、许可证和 commit 前，不得标为官方或执行代码。

## 模型与状态

- Windows Codex Bridge 默认读取当前机器的 Codex 配置；不得把认证文件挂载进容器。
- 自适应澄清默认使用三级成本路由：简单 `gpt-5.6-luna/low`、中等 `gpt-5.6-terra/medium`、复杂 `gpt-5.6-sol/high`；当前完整系统验收仍使用复杂层 `gpt-5.6-sol`、`reasoning_effort=high`。变更模型、阈值或强度时同时更新 `.env.example`、Compose、README 双语版、TODO、需求审计和测试期望。
- Idea 澄清不得恢复固定问题队列。模型每轮应整体分析草稿、公开可纠正假设并提出少量高信息问题；Schema 必填检查不是对话脚本。澄清 Agent 不得获得任意 Shell、文件、SQL 或网络工具。
- 新项目聊天的 `clarification_mode` 只能是 `automatic|detailed`，默认 `automatic`。全自动模式尽量推断可逆信息并只询问阻碍规格、安全、合规或执行的少量关键问题；详细模式基于当前缺口扩大了解范围，但仍不得采用固定问题顺序、重复询问或臆造关键事实。实际模式必须写入用户和助手消息 metadata。
- `tests/idea-cases/` 是所有自动化 Idea/研究对话测试输入的唯一来源。测试脚本只能通过 `scripts/idea_case_loader.py` 按公开 case ID 读取 UTF-8 JSON；禁止在测试代码、命令行参数、fixture 或运行时生成器中隐藏、硬编码或临时增添 Idea。新增/修改测试必须提交独立 case 文件并通过 `python scripts/check_idea_case_sources.py`。
- LLM 失败时可以使用确定性澄清降级，但不能绕过 ProjectSpec、审批或 Runner 校验。
- Idea 变更必须创建新版本并记录影响；不得静默覆盖旧 Idea 或继续使用已失效结果。

## 实现规则

- 先阅读相关模块和 `docs/requirements-audit-2026-07-28.md`，优先沿用现有 FastAPI、SQLAlchemy、n8n、Pydantic 和 Runner 模式。
- 修改保持最小范围；不要顺手重构不相关模块，不要覆盖用户已有改动。
- 结构化数据使用 Pydantic、JSON Schema 或数据库模型，不用脆弱的字符串拼接替代解析。
- API/Runner 输入默认 `extra=forbid`；新增字段必须同步更新 Pydantic、JSON Schema、工具契约、前端和测试。
- 数据库结构变化必须可迁移、可回滚，并更新架构文档；不要依赖聊天历史补偿缺失状态。
- 外部 API 必须有合法 User-Agent、超时、限流/退避和部分失败记录；不得伪造论文、BibTeX、许可证或搜索结果。
- 数值结果由程序计算，LLM 负责解释、质疑和提出待审批建议。
- 产物必须记录 SHA-256、实验、Idea 版本、Git commit、数据版本、配置、MLflow Run ID 和有效性。
- 前端产物预览必须同时提供下载入口；固定尺寸布局不能因动态内容发生重排或覆盖。

## 验证要求

按改动风险选择验证，但完成相关任务前至少执行适用项：

```powershell
docker compose config --quiet
python -m py_compile apps/api/app/main.py apps/runner/app/main.py scripts/codex_llm_bridge.py
docker compose exec -T api pytest -q
Get-ChildItem schemas\*.json,n8n\workflows\*.json | ForEach-Object { Get-Content -Raw -Encoding UTF8 $_.FullName | ConvertFrom-Json | Out-Null }
```

涉及主链、模型、n8n、Runner、数据库、MLflow 或产物谱系时还必须运行：

```powershell
python scripts/acceptance_test.py
```

完整验收会调用真实模型和外部学术 API，结果必须写入 `artifacts/acceptance/`，且不得包含 token。前端或可视化变化需要浏览器实际检查；PNG/PLY/3D 变化还需验证文件非空、画面非空、尺寸和下载入口。
当用户明确限制模型额度或指定单一公开用例时，只运行相应的定向真实测试，不得顺带调用其他 Idea；静态检查和不调用模型的单元测试可以继续。完整验收保持待处理，直到用户明确批准扩大真实调用范围。

## 文档与完成定义

- 行为、配置、端口、环境变量、部署或安全边界变化时同步更新 README 和对应 `docs/` 文件。
- 原始需求覆盖变化时更新需求审计；未完成能力继续明确标为“部分实现”或“未实现”。
- 完成定义包括：代码/工作流、Schema、数据库状态、测试、可视化证据、文档和 `TODO.md` 状态一致。
- 不得仅因为接口存在、Schema 已声明、测试使用 mock、命令能启动或页面能打开，就宣称端到端功能完成。

## 双语文档同步契约

每一次重大更新必须在同一个工作批次中及时同步文档、配置示例和任务状态。重大更新包括但不限于：用户可见行为、API/Schema、数据库、n8n 工作流、Runner 任务、模型或推理强度、环境变量、端口、容器版本、权限/安全边界、审批语义、持久化结构、验收流程、截图和原始需求覆盖发生变化。

1. 默认入口 `README.md` 必须保持英文；中文入口为 `README.zh-CN.md`。两版必须保持相同的章节顺序、命令、端口、环境变量、模型、验收数字、能力状态、风险和限制，不得只更新其中一版。
2. 每次同步两版 README 时，同时更新文件顶部相同的 `DOCS_SYNC_VERSION`。若最新验收项目发生变化，还要同步 `ACCEPTANCE_PROJECT`、截图、验收文件路径和数字。
3. 配置或部署变化必须同步 `.env.example`、`docker-compose.yml`、相关 Schema/工作流示例和 `docs/operations.md`/`docs/security.md`；所有示例只能包含占位 Secret，不能复制真实 `.env`。
4. 工作开始、状态变化、发现缺口和完成时立即更新 `TODO.md`。原始需求覆盖发生变化时同步 `docs/requirements-audit-2026-07-28.md`，不得只在聊天中说明。
5. 用户界面或可视化发生重大变化时，重新从真实本地项目生成 `docs/assets/` 截图，检查非空、无 Secret、无重叠和浏览器控制台无错误；README 两版引用同一组证据截图。
6. 文档中的“已实现”必须有代码和验收证据支撑。合成实验只能表述为系统集成验证，元数据候选不能表述为全文证据，GitHub 标题候选不能表述为官方实现。
7. 交付前运行 `python scripts/check_docs_sync.py`、适用的 Compose/Python/JSON/测试命令，并检查 Markdown 中引用的本地文件存在。同步检查失败时，重大更新不得标记完成。

## 重大更新的 Git 自动提交与推送

本项目要求重大更新在验证通过后自动形成 Git 提交，并按仓库当前授权配置推送到已配置的 `origin`。重大更新沿用上一节定义，包括功能、API/Schema、数据库、n8n/Runner、模型、配置、端口、安全边界、验收、截图和文档结构变化。

1. 重大更新开始时先在 `TODO.md` 新增稳定任务 ID，状态设为 `[~]`；实现、文档、配置、测试和同步检查全部完成后才允许提交。
2. 提交前必须检查 `git status --short`、`git diff --check`、`python scripts/check_docs_sync.py` 和适用的 Compose/Python/JSON/容器/验收测试；若检查失败，不得 commit 或 push。
3. 只暂存本次任务明确范围内的文件。必须排除 `.env`、Codex `auth.json`、Cookie、数据库备份、日志中的 Secret、模型权重、临时目录和任何未审查的大型产物；提交前用 `git diff --cached --stat` 和敏感文件名检查复核。
4. commit message 使用可读的 Conventional Commit 风格，例如 `docs: synchronize bilingual project documentation` 或 `feat: enforce project policy gate`，并在 `TODO.md` 更新记录中写入 commit 和验证证据。
5. 若 `origin` 已存在且用户已明确授权远程同步，完成 commit 后推送当前分支；若远程未配置，先使用用户指定的仓库 URL 设置 `origin`。不得擅自 force push、改写历史、删除远程分支或推送到其他仓库。
6. 推送失败时保留本地提交，将任务标为 `[!]` 并记录可复现的阻塞原因；不得为了“自动完成”打印、复制或索要认证密钥。Windows 已配置的 Git Credential Manager、SSH agent 或其他免密方式由用户机器负责，Agent 只调用标准 Git 命令。
7. 自动提交不是绕过审查：每次重大更新仍需遵守双语 README、配置示例、相关 docs、需求审计和 TODO 同步契约；小型纯本地实验输出不应自动提交。
