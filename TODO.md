# Research OS TODO

最后更新：2026-08-03（Asia/Shanghai）

状态只使用：`[ ]` 待处理、`[~]` 进行中、`[x]` 已完成且已验证、`[!]` 外部阻塞。

本文件是 Research OS 的实现合同和验收清单，不是宣传文案。只有代码、数据契约、测试、文档和真实适用验证都完成，任务才能标为 `[x]`。fixture、静态页面、数据库表、模型建议、旧缓存或无关实验都不能冒充真实能力。任何大模型、来源 API、Supermemory、GPU 或 LaTeX 调用失败，都必须保留结构化失败；禁止本地回复、换 provider、空数组、旧缓存或无关实验等 fallback。

## 1. 用户原始目标（唯一解释源）

Research OS 要做的是一个本地、可审计的科研工作台：用户像导师一样给出研究方向，AI 像学生一样按顺序完成 Idea 澄清、相关工作调研、公开代码复现、我们的方法开发、实验、日报/周报反馈和论文编译。每一步都必须留下来源、版本、审批、失败状态和可追溯的产物，不能把模型的猜测写成科学结论。

### 1.1 六个科研工作包

用户原始需求中的六项能力是六条独立工作流。页面可以把它们分组到四个一级入口，但不能把六项能力压缩成四张静态卡片。

| 顺序 | 工作包 | 用户实际要做的事 | 必须产生的真实链路 | 完成判定 | 禁止冒充 |
| --- | --- | --- | --- | --- | --- |
| 1 | 项目概述 / Idea 讨论 | 在聊天页面自由讨论主题、对象、问题、假设、目标、贡献、成功标准、风险和范围，逐步确认规格 | Mastra Idea Agent/Workflow -> 结构化候选 -> 用户确认/拒绝/要求修订 -> `IdeaVersion`/`ProjectSpec` | 每个字段有状态、来源、版本和决定；未确认字段阻止下游检索/实验 | 固定问卷、静态简介、模型直接宣布创新点 |
| 2 | 相关工作调研 | 用户提供少量 DOI、标题、URL、BibTeX、PDF 或已有 Paper；系统从常见学术来源发现更多候选 | seed -> provider attempt -> candidate 去重/provenance -> Paper/Evidence/ClaimReview -> 研究现状/引用图 | 失败、无匹配、部分结果、重复理由和来源都能审阅 | 一次搜索、标题猜 DOI、metadata 当全文证据、空数组当成功 |
| 3 | 相关工作代码复现与效果比较 | 找到论文明确提供的开源仓库，固定 commit，独立环境运行，比较论文报告与真实输出 | repo verification -> download Proposal -> reproduction `.venv` -> seed runs -> Artifact -> TypeScript comparison -> 待核验差异候选 | 许可证、commit、配置、数据、seed、原始指标和 hash 完整；失败保持可见 | 标题猜仓库、把复现代码放进方法代码、旧数字、无关 baseline、直接宣布创新 |
| 4 | 我们的方法代码 | 根据已确认 Idea、已审阅证据和允许消费的复现报告设计并实现自己的方法 | method Proposal -> 受限 diff -> 测试 -> commit -> remote/backup Proposal -> lineage | 代码变更有 diff、审批、测试、commit、备份和撤销信息 | 模型直接执行 shell/写文件、一次审批所有副作用、外部源码覆盖方法目录 |
| 5 | 实验结果管理与可视化 | 按当前 topic 运行真实实验，管理 seed、指标、loss、图像、点云、mesh、CSV/JSON/PDF 等产物 | topic-specific plan -> 固定入口/项目 `.venv` -> Run/seed -> 程序计算统计量 -> Artifact/hash/lineage -> React 预览 | 每个结果可回链到 Idea、方法 commit、数据、配置、Run 和 Artifact | 无关实验、预置图表、模型生成数字、空结果、fallback |
| 6 | 日报/周报、导师反馈与学术论文 | 查看 AI 的实际工作，给出反馈；用真实文献和实验结果生成可审阅稿件并编译 LaTeX | 真实事件 -> 不可变 Markdown 报告 -> feedback/Proposal/audit -> 章节/BibTeX/图表 lineage -> Linux `latexmk` | 报告段落、引用、图片和数字都能回链；编译失败没有成功 PDF 状态 | 模板日报、无来源章节、无证据引用、伪造图片/数字、失败仍保留成功 PDF |

页面落点（2026-08-02 用户新增需求）：工作包 3/4/5 全部归入 `实验实现` 一级入口（二级 `相关工作实现`/`本方法实现`）；工作包 6 的日报/周报与导师反馈归入 `项目概述`，学术论文撰写归入 `学术论文撰写` 一级入口。

### 1.2 两个横向标签栏

第一栏是固定的科研阶段入口，顺序不能按最近访问、完成度、模型建议或数据量变化：

1. `项目概述`
2. `相关工作调研`
3. `实验实现`
4. `学术论文撰写`

第二栏只显示当前一级入口的工作视图，不能把所有技术 Tab 平铺到一行。它必须按科研动作顺序排列：

| 一级入口 | 第二栏工作视图 | 对应用户动作 |
| --- | --- | --- |
| 项目概述 | `Idea 讨论`、`项目描述与研究问题`、`创新点与边界`、`项目进度与待决策`、`日报/周报与导师反馈` | 先把 Idea 说清楚，再查看 AI 实际工作并给出导师反馈，决定下一步 |
| 相关工作调研 | `种子与文献检索`、`文献库与全文证据`、`研究现状与引用图` | 从少量种子递归扩展并审阅证据；复现与比较已迁入 `实验实现` |
| 实验实现 | `本方法实现`、`相关工作实现` | 先开发自己的方法并运行真实实验，再复现并比较相关工作 |
| 学术论文撰写 | `论文项目与大纲`、`引用与 BibTeX`、`图表与实验数据选择`、`LaTeX 编译与 PDF 呈现` | 只把真实实验、反馈和证据组织成论文，不承载实验管理/可视化 |

`实验实现` 使用三级导航：一级入口 -> 二级 `本方法实现`/`相关工作实现` -> 三级具体页面。二级标签顺序固定为 `本方法实现` 在前、`相关工作实现` 在后；三级页面只在所属二级栏内显示，并位于二级栏下方的第三行导航，不再放在正文内部。

职责边界（用户 2026-08-02 新增需求）：

- 所有实验相关部分（复现、比较、实验计划、运行队列、指标、结果可视化、谱系）必须位于 `实验实现`，不得出现在 `相关工作调研` 或 `学术论文撰写`。
- `学术论文撰写` 只跟撰写论文有关：选择和使用实验数据/图表、引用与 BibTeX、LaTeX 编译、PDF 呈现。论文页可以引用实验 Artifact，但不能承担实验管理、运行或可视化职责。
- `日报/周报与导师反馈` 归入 `项目概述`（导师查看进度并反馈）；如果用户后续明确要求独立入口，再按新需求调整，不得擅自把反馈塞回论文撰写。

实验、报告/反馈和论文是三个独立的数据工作流，即使它们视觉上位于不同入口下，也不能互相绕过自己的审批和谱系门禁。旧的技术 `TabId` 只允许作为深链接兼容映射；不能继续作为新的顶层信息架构。

### 1.3 端到端用户顺序

1. 选择项目并确认当前 `project_id` 和权限范围。
2. 在 `Idea 讨论` 中用自然语言讨论问题，不使用固定问题队列。
3. 审阅 Idea Agent 提出的结构化字段；确认、拒绝或要求修订，生成不可变 `IdeaVersion`。
4. 输入少量文献种子，校验 DOI/标题/URL/BibTeX/PDF provenance。
5. 选择允许的来源和递归参数，审批后逐层发现引用，实时看到每次 provider attempt、进度、取消、partial 和 failure。
6. 审阅去重理由、字段来源冲突和候选；把需要全文的 Paper 转入受控 Artifact 和带页码/章节的 Evidence。
7. 由已确认 Paper、已定位 Evidence 和已接受 ClaimReview 生成研究现状矩阵、引用图和待核验 gap/cluster/duplicate-risk 候选。
8. 从 Paper 明确提供的 GitHub/GitLab URL 开始，验证论文匹配、许可证、固定 commit、入口、依赖、数据和系统要求。
9. 分别审批下载、依赖安装、每次复现运行和产物写入；复现源码与我们的方法代码永久分离。
10. 对论文报告指标和真实复现输出做 TypeScript 确定性比较；保存 mean/std、配置等价性、seed、原始指标和 Artifact hash。
11. 用户审阅比较差异；Mastra 只能提出带 Evidence/Artifact 依据的待核验创新、研究空白或反例候选。
12. 确认方法设计 Proposal，修改自己的项目代码，测试、commit、备份和远端同步都分别审批并审计。
13. 按 topic-specific 计划运行真实实验，管理多 seed 和所有产物；实验失败或上游失效时不能进入报告和论文。
14. 生成有真实事件来源的日报/周报，导师逐条给反馈，反馈只能进入 Feedback/Proposal，不能直接执行代码或实验。
15. 创建有证据和实验 lineage 的章节、BibTeX、图表，经过最终门禁后在 WSL2 隔离目录用 Linux `latexmk` 编译。

## 2. 不可违反的工程边界

### 2.1 TypeScript 与 Python

- `apps/`、API、数据库迁移、Mastra 集成、worker、运维脚本、验收脚本和测试运行时代码全部使用 TypeScript/TSX。
- React 是 `apps/web/src/` 的唯一 UI 业务源码入口。旧的 `index.html` 只能作为静态挂载壳，不能重新加入原生 HTML 交互。
- Python 仅允许作为科研实验或论文代码复现入口，路径必须位于 `projects/<project-id>/experiment/` 或其受控 reproduction 子目录，并使用该项目自己的 `projects/<project-id>/.venv`。
- Python 实验由 TypeScript supervisor 通过固定入口启动；模型不能提供命令、路径、依赖安装命令、shell、SQL、网络目标或可执行文件。
- 不允许为了“方便”把 Python 引擎、旧 `requirements.txt`、旧 SQLite、旧 JSON cache 或旧项目脚本加入应用运行路径。

### 2.2 WSL2 运行边界

- 完整应用栈只在 WSL2 Ubuntu 22.04 内运行：API `127.0.0.1:8080`、Mastra `127.0.0.1:4111`、Supermemory `127.0.0.1:6767` 及配置池端口。
- 开发、编辑、构建、测试和运维命令全部在 WSL2 shell 中执行；默认开发 shell 是 WSL2，不使用 Windows cmd/PowerShell。
- Windows 只作为调试浏览器客户端：固定使用 Windows Chrome，通过 mirrored 网络/端口转发以 `http://127.0.0.1:<port>` 访问 WSL2；不恢复 Windows 原生应用运行目标，不依赖 Docker。
- 当前唯一代码副本是 `/mnt/d/ResearchOS`，对应 Windows 的 `D:\ResearchOS`；禁止复制一份再同步导致双份事实源。
- 实验、Supermemory、Mastra、API、LaTeX 和数据库都在 WSL2 进程内运行；Windows Defender 只作为上传扫描的受控互操作依赖。
- 所有监听器默认只绑定回环地址。`0.0.0.0` 不能作为产品默认监听地址。

### 2.3 模型、Mastra 与失败关闭

- Luna、Terra、Sol 三档的 model、URL、key 和 reasoning effort 完全独立；读取 API 只能返回 `key_configured`，不能返回 key。
- Idea 澄清、项目监督和实验规划必须使用 Mastra Agent/Skills/Tools/Workflows；不能手写 Agent 循环或把提示词复制成另一套 Agent 实现。
- Mastra 负责模型推理和审批编排；确定性 HTTP adapter、Zod 校验、递归队列、去重、排序、数据库写入、指标统计、Artifact 校验和 lineage 检查由 TypeScript 服务负责。
- Agent 不得获得任意 Shell、SQL、文件路径、可执行程序或网络工具。模型输出不能直接成为命令、路径、SQL、依赖、URL、实验数字或论文事实。
- 模型配置错误、HTTP 失败、超时、鉴权失败、无效结构化输出、Supermemory 失败和来源失败都返回结构化错误；不本地回答、不隐式换 provider、不静默重试成成功、不写入伪造助手消息。
- 固定工作流任务的重启/恢复与模型 fallback 是两件事：队列可以恢复确定性状态，但不能用另一个模型或规则逻辑代替失败的模型请求。

### 2.4 Supermemory 与项目隔离

- Supermemory 是项目范围的语义 Memory、向量检索、Graph Memory 和 Super RAG；PGlite 只保存结构化状态、权限、实体 ID、审批、hash 和审计。
- 每条 memory 必须带不可变 `project_id` scope/container/resource、来源 Artifact、SHA-256、页码/章节、Idea 版本、实验/报告 ID 和证据状态。
- 相同 embedding provider/model/dimensions/base URL/key 的项目可以共享一个 Supermemory 配置池实例；项目隔离仍必须由 Supermemory scope 和本地权限同时保证。不同 embedding 配置必须使用不同池和不同数据目录。
- embedding 模型/维度切换必须新建数据目录或完整重索引，不能把不同向量空间混在同一个索引里。
- Supermemory 失败、超时、鉴权失败或返回无效数据时，直接返回结构化错误，不能改用 SQL 词法检索、另一 provider、本地旧缓存或无关实验。
- 当前外部阻塞依照 `P0-SUPERMEMORY-LOCAL-053` 记录，不能把 delete 验证写成 forget 验证，也不能把 fixture acceptance 写成真实图片/PDF 通过。

## 3. `D:\auto-related-work` 的复用边界

这是用户自己的旧项目，可以完整阅读和参考。允许复用的是经过审计的算法语义、字段含义、排序信号、异常场景、边界案例、数据处理设计和测试意图；不允许复用 Python 源码作为运行时依赖。

### 3.1 绝对禁止

- 不 `import`、`exec`、`child_process` 调用、symlink、npm workspace 引用、构建打包或运行时读取旧项目的任何 Python 文件。
- 不复制旧项目的 `.env`、key、Cookie、代理、SQLite/WAL、JSON cache、最终 JSON、HTML 交互或 `requirements.txt`。
- 不把旧项目的固定 topic、旧实验数字、旧爬取数据库、旧进度文件或旧日志当作当前项目事实。
- 不迁移 Google Scholar HTML/Cookie/住宅代理/CAPTCHA 隧道和无界全库爬取。
- 旧项目本身是用户的参考资料，不因为迁移工作而删除；删除旧目录不会等于完成 TypeScript 重写。

### 3.2 49 个 Git 跟踪文件的逐项处理台账

截至 2026-08-02，`git -C D:\auto-related-work ls-files` 返回 49 个 Git 跟踪文件。旧工作目录还包含 `.env`、`.pytest_cache/`、`__pycache__/`、SQLite/WAL、未跟踪的进度 JSON 和历史日志等本机生成物；这些不是可迁移的业务源文件，全部只做清点和淘汰记录，不能进入 Research OS 的构建、运行时、数据库或产物目录。以下表格覆盖 49 个受控文件，并把同一类文件合并展示；每一行都必须在实现或淘汰验证时有对应落点。

| 旧文件或文件组 | 处理 | Research OS 的 TypeScript 落点或淘汰理由 |
| --- | --- | --- |
| `backend/app.py` | 重写 | Hono route、`related-work/service.ts` 和 PGlite 状态；不复制 Flask 全局状态 |
| `backend/src/__init__.py` | 淘汰 | TypeScript workspace 不需要 Python package |
| `backend/src/ai_providers.py` | 重写有限行为 | Mastra model routing 和严格模型配置；不迁移 fallback/旧 key |
| `backend/src/author.py` | 重写有限行为 | `related-work/paper-fields.ts` 的姓名/initial 匹配；不抓作者主页或 h-index |
| `backend/src/cache_db.py` | 重写 | `related-work/cache.ts` 的项目范围 request hash、TTL、schema 和审计 |
| `backend/src/enrich_fields.py` | 重写 | `paper-fields.ts` 的字段 provenance/conflict；不让模型猜字段 |
| `backend/src/pipeline.py` | 重写 | TypeScript service + Mastra Workflow 编排；不迁移固定 topic 和无界副作用 |
| `backend/src/recursive_search.py` | 重写 | `recursive-search.ts` 的 depth/width/max_total、去重、取消、canonical edge 和失败状态 |
| `backend/src/references.py` | 重写 | source adapter 的引用读取、稳定排序和 failure attempt |
| `backend/src/scholar_search.py` | 重写有限行为/淘汰抓取 | Crossref/OpenAlex/Semantic Scholar/DBLP/arXiv adapter；淘汰 Scholar HTML/Cookie/代理 |
| `scripts/clean_titles.py` | 重写 | `paper-fields.ts` 的 NFKC、控制字符、DOI/title 规范化和 Vitest fixture |
| `scripts/crawl_db.py`、`crawl_gs.py`、`run_venue_crawl.py` | 淘汰 | 不迁移无界批量爬取、Scholar 爬取和代理 |
| `scripts/crawl_venues.py`、`crawl_venues_crossref.py` | 淘汰/有限重写 | 不迁移 venue 全库任务；保留 Crossref adapter 的有界请求行为 |
| `scripts/dl_keywords.py`、`dl_keywords_massive.py`、`massive_keywords.json` | 淘汰 | 不迁移百万关键词和无界成本任务 |
| `scripts/fill_to_1m.py`、`fill_1m_progress.json` | 淘汰 | 不迁移百万条目填充和旧进度 |
| `scripts/filter_titles_ai.py`、`filter_progress.json` | 淘汰 | 不迁移批量 AI 筛选和隐藏字段事实 |
| `scripts/refine_db.py`、`title_clean_log.json` | 淘汰/参考 | 只提取清洗测试意图，不读取旧数据库或日志 |
| `scripts/gs_crawl_progress.json`、`venue_crawl_progress.json`、`venue_crossref_progress.json`、`crawl_progress.json` | 淘汰 | 用项目范围 Run/Event/审计替代旧进度文件 |
| `scripts/venue_keywords.json` | 淘汰 | 不进入当前查询范围或运行时配置 |
| `tests/__init__.py` | 淘汰 | 使用 Vitest setup/factory |
| `tests/conftest.py` | 重写 | `apps/server/tests` 的 TypeScript fixtures/setup，不运行 pytest |
| `tests/fixtures/ai_test.json`、`test_final_null.json`、`test_null_full.json`、`test_null_output.json` | 参考后脱敏重写 | 转成严格 schema、invalid response、partial/failure fixture，不当作真实模型通过 |
| `tests/fixtures/test_profile_null.json` | 淘汰/参考 | 作者 profile 不属于当前范围，只保留 no-match 意图 |
| `tests/test_100_papers.py` | 重写有限行为 | Vitest 有界容量/分页 fixture，不跑固定外网 100 篇任务 |
| `tests/test_backoff.py` | 重写 | transport 的 5xx/429/timeout/cancel 和有界退避测试 |
| `tests/test_completeness.py` | 重写 | Paper 字段完整度和证据状态测试，不自动确认 Paper |
| `tests/test_full_pipeline.py` | 重写 | API/Mastra 阶段状态和审计 fixture，不复制终态 JSON |
| `tests/test_match.py`、`test_normalize.py` | 重写 | TypeScript 作者、标题、DOI 和文本规范化测试 |
| `tests/test_pipeline_field_sources.py` | 重写 | provenance、冲突和字段选择 API 测试 |
| `tests/test_precise_tracking.py` | 重写 | attempt、stage、failure、恢复和审计测试 |
| `tests/test_schema.py` | 重写 | Zod schema、provider invalid response 和边界测试 |
| `tests/test_seamgpt_full.py` | 淘汰/参考 | 只取阶段追踪意图，不迁移旧模型或固定 topic |
| `backend` 之外的 `.env`、`.env.example`、`.gitignore` | 参考后重写 | 当前项目自行脱敏、忽略和配置；旧密钥/代理不进入运行时 |
| `cache/scholar_cache.db`、`.db-shm`、`.db-wal` | 淘汰 | 不迁移旧 SQLite；如需数据迁移必须另建 Proposal、schema、hash 和备份 |
| `old_files/pipeline_output/run_log.txt` | 参考/淘汰 | 只能核对历史阶段，不能作为当前报告、实验或证据 |
| `.claude/settings.local.json`、`CLAUDE.md` | 淘汰/参考 | 不作为 Research OS agent 权限或代理规则 |
| `README.md`、`scholarly-analysis.md` | 参考后重写 | 当前 README/架构/TODO 自己描述 TypeScript、WSL2、Mastra 和失败关闭边界 |
| `requirements.txt` | 淘汰 | 应用、相关工作和 Mastra 不安装旧 Python 依赖 |
| `scholar_search.html`、`static/tailwind.css` | 淘汰 | React/TSX 是唯一 UI 业务实现 |

### 3.3 按旧项目能力拆分的 TypeScript 重写路线

旧项目不是“整目录搬进来”，而是提供一个已经验证过的相关工作引擎思路。Research OS 必须保留下面这些对用户有价值的行为，同时把实现、数据和安全边界重新建立在当前仓库中：

| 旧项目中的能力 | 当前项目的 TypeScript 落点 | 必须保留的用户价值 | 必须改变或禁止的实现 |
| --- | --- | --- | --- |
| `scholar_search.py` 多来源搜索与结果整理 | `related-work/source-adapters.ts`、`transport.ts`、`service.ts` | 用少量用户种子发现候选 Paper，并保留 provider、请求、响应、时间和失败原因 | 不再抓 Google Scholar HTML，不使用 Cookie、住宅代理、CAPTCHA 隧道；来源请求有界、合法、可取消，失败不是空成功 |
| `enrich_fields.py` 的字段补全、完整度和缺失字段报告 | `related-work/paper-fields.ts`、`contracts.ts` | 逐字段知道标题、作者、年份、DOI、摘要、来源和冲突来自哪里 | provider 只能补全与 DOI/精确标题匹配的字段；模型不能猜字段，用户不确认就不能把候选变成 Paper |
| `author.py` 的作者和姓名匹配 | `paper-fields.ts` 的规范化/匹配函数与 Vitest fixture | 稳定的作者、标题、DOI 规范化和跨来源去重 | 不迁移 Google Scholar 个人档案、h-index、邮箱或作者主页爬取；这些不属于当前相关工作主链 |
| `recursive_search.py`、`references.py` 的引用递归 | `related-work/recursive-search.ts`、各 source adapter、数据库 citation edge | 按 `depth/width/max_total` 分层扩展引用，保留 frontier、去重、排序、边和进度 | 不使用固定的跨学科 query 列表，不做无界全库爬取；DBLP/arXiv 未实现 references 契约时必须明确显示 search-only |
| `cache_db.py` 的响应缓存 | `related-work/cache.ts` + PGlite `related_work_request_cache` | 同一项目重复请求可以审计地复用真实成功响应，降低来源压力 | 不读旧 SQLite/WAL/JSON cache；缓存键必须含 project、provider、operation、参数和 schema，损坏、过期或失败都失败关闭 |
| `pipeline.py` 的阶段和 SSE 进度 | TypeScript service/worker、Mastra Workflow、结构化事件 API | 用户能看到 seed、provider attempt、递归层、候选、失败、取消和 partial 的真实进度 | 不复制 Python 全局状态或固定 topic；Mastra 负责 Agent/Workflow 编排，确定性抓取、校验、持久化和统计由 TypeScript 执行 |
| `app.py` 的 Flask API 和 `scholar_search.html` | Hono API + React/TSX `LiteratureTab`/工作区页面 | 从网页输入种子、审阅候选、选择字段、批准递归并查看来源 | 不保留原生 HTML 交互、Flask 服务或 Python 进程；所有输入用 Zod，页面显示 project scope、来源和结构化失败 |
| `clean_titles.py`、`test_normalize.py`、`test_match.py` | `paper-fields.ts` + server Vitest tests | 相同论文在不同 provider 返回时可稳定归一化和去重 | 不能把旧 JSON 结果当 fixture 真相；fixture 只验证算法意图，真实 provider 仍需独立验收 |
| `test_backoff.py`、`test_precise_tracking.py`、`test_schema.py` 等 | `related-work/*.test.ts`、API/acceptance tests | 429、5xx、timeout、cancel、invalid response、no-match、partial 和恢复行为可验证 | 测试不能把 fallback、空数组或无关实验当作通过；外部服务失败必须保留失败状态 |
| venue/massive crawl、`dl_keywords*`、`fill_to_1m.py`、AI 批量筛选 | 明确淘汰，无 TypeScript 落点 | 当前用户只需要项目范围、topic-specific、有审批的科研调研 | 不迁移百万关键词、全库填充、固定旧主题、无限成本任务或旧进度文件 |

这条路线表达的是“复用研究引擎的可迁移思想”，而不是“复用旧项目运行代码”。相关工作实现的最小闭环必须是：用户种子 -> 受控来源尝试 -> 候选与字段 provenance -> 人工确认 -> 引用递归 -> 全文 Evidence/ClaimReview -> 研究现状/引用图 -> 明确仓库验证 -> 独立复现 -> TypeScript 指标比较。任何一步失败都停在该步并保留可审计失败，不能跳到下一步，也不能使用旧结果补齐。

### 3.4 迁移验收与排除清单

- [ ] `AUTO-TS-01` 使用一个用户提供的真实 seed 验收搜索，不调用旧项目 CLI、不加载旧缓存、不运行 `python`，并在 UI 展示每次 provider attempt。
- [ ] `AUTO-TS-02` 对同一个 Paper 验收多 provider 字段冲突、用户选择、字段 provenance 和 `metadata_only`/`page_quote`/`claim_reviewed` 状态；没有 PDF quote 时不能进入 confirmed matrix。
- [ ] `AUTO-TS-03` 验收至少两层引用递归、去重、宽度/总量上限、取消和 partial/failure；确认 DBLP/arXiv search-only 能力不会伪装成 references 完整能力。
- [ ] `AUTO-TS-04` 验收缓存命中、过期、schema 不兼容、损坏、失败不覆盖成功、取消不写缓存和双项目隔离；旧 SQLite/WAL/JSON 不得被读取。
- [ ] `AUTO-TS-05` 验收论文明确提供的 GitHub/GitLab 固定 commit 复现与 TypeScript 比较，复现源码只能进入 `experiment/reproductions/`，不得进入 `code/` 或方法 Git。
- [ ] `AUTO-TS-06` 运行 `scripts/check-language-boundary.ts` 并检查构建产物、依赖图和运行脚本；旧 Python 只能出现在项目科研实验/复现目录，不能成为应用服务依赖。

台账关闭条件：每个“重写”行为在当前仓库有严格 TypeScript 类型、Zod 输入、项目范围持久化、结构化失败、测试和适用运行证据；每个“淘汰”项不出现在 `apps/`、`scripts/`、数据库迁移、构建上下文、运行时依赖图和发布产物中。`D:\auto-related-work` 本身不需要被删除。

## 4. 当前实现状态和待办任务

主任务：`P0-RESEARCH-WORKSPACE-070`。文档合同：`P0-DOC-RESEARCH-076`。导航重构：`P0-NAV-078`。下列状态是当前真实状态，不能因为一个子页面能打开就提前关闭上级任务。

### 4.1 文档合同

- [~] `P0-DOC-RESEARCH-076` 将用户的四个一级入口、第二栏工作视图、六个工作包、14 步科研顺序、相关工作递归/复现/比较链路和旧项目逐文件 TypeScript 边界整理为唯一合同。
  - [x] `076a` 固定四个一级入口和第二栏映射（含 `实验实现` 二级 `相关工作实现`/`本方法实现` 与第三级具体页面），明确实验归入 `实验实现`、报告/反馈归入 `项目概述`、论文撰写归入 `学术论文撰写`，三者仍是独立工作流。
  - [x] `076b` 写清每个工作包的用户动作、真实输入、实体产物、审批门禁、失败出口和不得冒充的内容。
  - [x] `076c` 登记 `D:\auto-related-work` 的 49 个 Git 跟踪文件，并单独记录 `.env`、缓存、进度、日志和 Python 字节码等生成物；区分 TypeScript 重写、人工参考和明确淘汰。
  - [x] `076g` 按搜索、字段补全、作者匹配、递归、缓存、阶段进度、UI、测试和无界批处理逐项说明可复用行为、TypeScript 落点和禁止迁移内容。
  - [ ] `076d` 用真实 React route/tab、API、数据库实体、测试和浏览器截图逐项对照本合同；页面打开或 fixture 通过不能单独关闭。
  - [ ] `076e` 完成下游业务实现后同步 `AGENTS.md`、`README.md`、`README.zh-CN.md`、架构/安全/运维文档和 `DOCS_SYNC_VERSION`。
  - [ ] `076f` 运行适用类型检查、测试、构建、文档检查、语言边界检查和浏览器验收；真实外部阻塞保持 `[!]`。

### 4.2 一级入口与前端信息架构

- [~] `070-A` React + TypeScript 四入口、两栏导航（`实验实现` 内为三级导航）、项目列表独立滚动和 WSL2 浏览器访问正在落地。
  - [~] `070-A0` 统一 favicon 与左上角 brand 的小尺寸几何标识；需要检查 16px/27px/30px、高 DPI、亮暗背景、加载路径和可访问名称。
  - [x] `070-A1` `apps/web/src/` 是唯一 React UI 源码入口；旧原生 HTML 交互未进入运行路径，构建产物由 TypeScript 生成。
  - [~] `070-A2` 一级入口与 Tab 归属按 `P0-NAV-078` 重构：`overview`、`related_work`、`implementation`（旧 `method` 兼容重定向）、`paper`（一级标签改名为《学术论文撰写》）；实验 Tab 全部迁入 `implementation`，报告/反馈迁入 `overview`。仍需真实 API 数据、刷新/前进后退、深链接和浏览器验收。
  - [ ] `070-A3` 为每个二级视图实现独立的 empty、loading、success、failure、approval、cancelled、partial、no-evidence、permission-denied 状态；每种状态显示 error code、来源、project scope、可重试条件和下一步。
  - [ ] `070-A4` 在 Windows Chrome 通过 WSL2 服务完成 100% 桌面、窄桌面和移动宽度截图；项目列表、第二栏、表格、Markdown、diff、图表无溢出/重叠，滚动条保留可用性但不显示突兀的 Win11 原生样式。
  - [ ] `070-A5` 每个页面显示 project scope、更新时间、权限、最近失败和待审批动作；切换项目后不能残留上一个项目的 candidates、graph、report、feedback 或 memory。
  - [ ] `070-A6` 第一栏固定排序，第二栏只随当前入口变化，第三级只随所属二级栏变化；刷新、前进/后退、深链接、移动端折叠、键盘焦点和 `aria-current` 恢复同一 project/area/subtab/tab。

### 4.3 项目概述 / Idea

- [~] `070-B` Idea Agent/聊天、规格字段和进度摘要已有部分实现。
  - [ ] `070-B1` 每个字段显示 `model_candidate`、`user_confirmed`、`unresolved`、来源、Idea 版本和差异；未确认字段阻止下游 query、方法和实验。
  - [ ] `070-B2` 创新点、边界、重复风险、反例和待核验问题必须绑定 Paper/Evidence/Claim/IdeaVersion；不能由模型直接宣布创新。
  - [ ] `070-B3` 进度时间线包含 SearchRun、复现、Artifact、报告、反馈、失败、取消、暂停、审批和上游失效。
  - [ ] `070-B4` Idea 聊天只通过 Mastra Agent/Skills/Tools/Workflow，保存 session、run、档位、输入/输出 hash、结构化候选和用户决定；不得复制固定问题队列或让模型直接写代码、配置、实验、报告和论文。

### 4.4 相关工作调研（复现/比较 UI 归入实验实现）

- [~] `070-C` 五个来源 adapter、种子、递归 Proposal/Run、项目隔离、候选审阅、字段 provenance、研究现状投影、复现和比较服务已有基础实现。按 `078c`，复现与比较的 UI 页面位于 `实验实现 -> 相关工作实现`，本节的 service/API/审批/谱系要求不变。
  - [~] `070-C1` Crossref/OpenAlex/Semantic Scholar/DBLP/arXiv 的 success/no-match/invalid/429/timeout/cancel 都记录 `SourceAttempt`；DBLP/arXiv search-only 能力必须在 UI 明示。
  - [~] `070-C2` DOI、标题、HTTPS URL、BibTeX、受控 PDF 和已有 Paper seed 已做项目范围校验；仍需补齐用户输入、Artifact 和 seed-candidate provenance 的完整 UI。
  - [~] `070-C3` 递归按 depth/width/max_total 分层执行，支持审批、稳定排序、canonical 去重、引用边、进度、取消、partial/failure 和恢复；仍需独立进程重启 API 验收。
  - [~] `070-C4` PDF/全文 Evidence 保存稳定 URL、SHA-256、页码/章节、原文 quote 和证据状态；metadata-only 只能是候选，不能进入 confirmed matrix。
  - [~] `070-C5` 字段 provenance 按字段显示 provider、source attempt、用户值、冲突组和人工决定；模型 enrichment 必须是 Proposal，失败不覆盖已有成功字段。
  - [~] `070-C6` 研究现状矩阵只消费 confirmed Paper + located Evidence + accepted ClaimReview，保留 IdeaVersion、source snapshot 和 project scope；gap/cluster/duplicate-risk 是待核验候选。
  - [~] `070-C7` 引用图只投影显式关系；节点显示 candidate/Paper/Evidence/ClaimReview 层级，边显示 relation/evidence/permission；API 必须分别返回 `matrix_status` 与 `graph_status`，不能因为矩阵为空就把已有引用图显示为 `empty`；空、partial、failure 和跨项目响应不能共用一张静态图。
  - [~] `070-C8` 代码复现按 repository verify -> fixed commit download -> dependency Proposal -> run Proposal -> artifact Proposal 分步审批；外部复现代码存于 `experiment/reproductions/`，绝不进入方法代码。
    - [~] `070-C8a` 只从 Paper 明确的 GitHub/GitLab URL 发现候选，不从标题猜仓库；记录 locator 和来源。
    - [~] `070-C8b` 验证 DOI/精确标题匹配、SPDX 许可证、默认分支、40 位 commit、entrypoint、依赖、数据、系统/GPU 要求；未知字段保持 candidate/blocked。
    - [~] `070-C8c` 下载、依赖安装、运行、产物写入各自 Proposal；归档限制、路径穿越、链接文件、源码 hash、`.venv` containment 和有界日志必须复核。
    - [~] `070-C8d` 复现 Run 记录 source commit、入口、seed、配置、原始指标、日志、Artifact hash 和失败码；仍需一个与当前 topic 相关且用户允许的真实 Linux 仓库端到端验收。
  - [~] `070-C9` TypeScript/PGlite/API/隔离/失败关闭测试已通过；仍需浏览器 fixture 和真实 provider acceptance。
    - [x] `070-C9a` transport 覆盖 5xx 有界重试、429、invalid JSON、timeout、AbortSignal cancel、响应大小上限；五个 adapter 覆盖成功、no-match、schema 错误和 invalid XML。
    - [x] `070-C9b` 覆盖 DOI/stable ID/title-year 去重、稳定 tie-break、depth/width/max_total、取消、确定性序列化、非悬空边和 canonical edge。
    - [~] `070-C9c` cache hit/miss、失败不覆盖成功、TTL/schema/request hash、项目隔离、审计和 running -> queued/partial 已测试；仍需同一 candidate 的多 provider provenance 和独立进程重启 API。
    - [~] `070-C9d` seed/candidate/Proposal/recursive run/人工确认/项目隔离 API 主链已测试；仍需 Artifact/证据跨项目矩阵和失败可重试但不覆盖成功的完整 fixture。
    - [ ] `070-C9e` 浏览器验收候选审阅、来源抽屉、去重理由、递归进度、研究现状矩阵、引用图、复现 Proposal、空/loading/partial/failure/blocked 和项目切换。
    - [ ] `070-C9f` 使用当前 `.env` 合法配置做真实 provider 验收；失败如实记录 `[!]`，不使用旧缓存、换 provider 或 fallback。
    - [x] `070-C9g` `scripts/check-language-boundary.ts` 已扫描应用、脚本、迁移、worker、运维和测试；没有旧 Python runtime、旧项目路径、旧 cache/终态引用。受监督实验目录中的合法 `.py` 入口不误报。
  - [~] `070-C10` 比较服务和待核验候选已实现；真实 topic-specific 复现和浏览器状态仍未完成。
    - [x] `070-C10a` 比较输入要求 project scope、confirmed Paper、accepted ClaimReview、locator、SHA-256、fixed commit、Artifact 和完整 Run。
    - [x] `070-C10b` TypeScript 计算 count/mean/population std/min/max/delta/relative_delta/signal，并保存 source snapshot、commit、data/config/seed 和 Artifact hash；缺字段/失败/配置不等价保持 `partial`/`blocked`。
    - [x] `070-C10c` 候选带 basis/evidence/artifact，支持 accepted/rejected/reopened 和审计；候选永远不是科学结论。
    - [~] `070-C10d` comparison 列表、详情、decision API、React 指标/门禁/Artifact/候选状态和双项目测试已落地；仍需浏览器、窄屏截图和真实复现。

### 4.5 实验实现 -> 本方法实现（原“我们的方法代码”）

- [~] `070-D` 项目代码目录和受限文件树已有基础，Git/备份/Proposal 闭环未完成。按 `078d`，方法设计、代码工作区、变更与审批、Git 与备份等 UI 页面位于 `实验实现 -> 本方法实现`。
  - [ ] `070-D1` 方法设计只消费确认的 `ProjectSpec/IdeaVersion`、审阅后的 Paper/Evidence/ClaimReview 和允许的复现报告，输出结构化候选、依赖、数据契约、风险、假设和实验建议，并保存输入 ID、Mastra run 和版本 hash。
  - [ ] `070-D2` 代码详情、受限 diff、依赖变更、测试结果和 Git 状态完善；只允许项目 containment 内的 allowlist 文件类型/相对路径，拒绝 shell、SQL、绝对路径、网络目标和可执行文件注入。
  - [ ] `070-D3` 写文件、配置、依赖、branch、commit、remote sync、push、冲突和恢复各自建立 Proposal/审计，包含 diff、影响、成本、撤销和审批。
  - [ ] `070-D4` 备份代码、配置模板、Git metadata、Artifact metadata 和 SHA-256；恢复先在隔离目录验证，不能包含 `.env`、key、Cookie、数据库原文件或认证材料。
  - [ ] `070-D5` UI 明确区分外部复现代码和我们的方法代码的物理目录、branch、commit、来源和 lineage；未审批/未测试/未 commit 的代码不得进入实验。
  - [ ] `070-D6` 通过双项目 containment、恶意文件名、超大 diff、符号链接、依赖篡改、remote 凭据泄漏、恢复冲突和重复 commit 测试。

### 4.6 实验实现 -> 本方法实现（实验结果与可视化）

- [ ] `070-E` 实验结果闭环尚未完成。按 `078d`，实验计划与结果、运行队列、指标统计、结果与可视化、实验谱系等 UI 页面位于 `实验实现 -> 本方法实现`，不得再出现在 `学术论文撰写`。
  - [ ] `070-E1` 实验计划固定实验类型、当前 topic 问题/假设、入口、项目 `.venv`、seed、IdeaVersion、方法 commit、数据版本、配置指纹、资源限制和审批人；缺字段不得入队。
  - [ ] `070-E2` TypeScript supervisor 管理固定入口、队列、进程树取消、超时、暂停/恢复、有界日志、资源和失败状态；mean/std/置信区间只能由程序根据真实 seed 计算。
  - [ ] `070-E3` Artifact 预览覆盖 PNG/JPEG、Markdown/JSON/CSV、loss/时序、PLY/点云、mesh/PDF；校验 containment、大小、MIME/魔数、hash、Run 和撤销状态。
  - [ ] `070-E4` 结果回链 IdeaVersion、方法 commit、数据、配置、Run、seed、日志和 Artifact；失败/取消/无效产物不得进入报告或论文。GPU/CUDA 真实验收受 `P0-RUNNER-007` 阻塞时保持 `[!]`。
  - [ ] `070-E5` 实验页面分开展示计划、运行、指标、产物和 lineage，支持多 seed、缺失/失败 seed、partial/cancelled；禁止无关 baseline、预置图表、空数组成功和任何 fallback。
  - [ ] `070-E6` 通过重复确定性、数值精度、异常指标、超大产物、符号链接、错误扩展名、跨项目 Artifact 和上游失效递归测试。

### 4.7 项目概述 -> 日报/周报与导师反馈

- [~] `070-F` 已有独立报告、反馈收件箱和 lineage 检查，事件驱动生成和反馈闭环未完成。按 `078g`，日报、周报、导师反馈、决策与审计等 UI 页面位于 `项目概述` 的二级栏，不再位于论文撰写入口。
  - [~] `070-F1` 报告按时间窗口读取真实对话、审计、任务、实验、Proposal、provider attempt 和反馈，保存 event_count、时间窗口、cutoff、来源 ID、失败/阻塞和证据边界；Mastra report run、段落 provenance 和完整 source snapshot 仍待完成。
  - [~] `070-F2` 日报、周报、反馈和审计页面已独立于项目概述静态卡片；日期/状态/来源筛选、段落来源抽屉和版本选择仍待完成。
  - [ ] `070-F3` 反馈只能创建 feedback/Proposal；支持逐条确认、拒绝、要求修订、指派上游实体、状态变更和审计，不能直接触发代码、依赖、实验或 Git。
  - [ ] `070-F4` Markdown preview 使用受控渲染器，保留标题、表格、代码、图片和上游链接；历史版本不可变，重试生成新版本。
  - [ ] `070-F5` UI 区分已完成事实、结构化失败、等待导师决定、模型建议、未核验候选和外部阻塞，显示来源、权限和下一步。
  - [~] `070-F6` 报告读取侧已检查 source snapshot、project scope、实体存在性和 Artifact `valid`；失败/跨项目/缺失来源为 `blocked`，只渲染 valid Markdown。事件驱动生成、反馈引用和完整复现 lineage 仍待完成。
    - [x] `070-F6a` `report-lineage.test.ts` 覆盖 valid、legacy_unverified、scope mismatch/missing source/invalid Artifact 四种边界。

### 4.8 学术论文撰写

- [ ] `070-G` 论文项目和 Linux 编译闭环尚未完成。按 `078e/f`，本区域只承载写作相关页面（论文项目、大纲与章节、引用与 BibTeX、图表选择与插入、实验数据选择与引用、LaTeX 编译、PDF 呈现），不承载实验管理/可视化。
  - [ ] `070-G1` 论文、章节、作者/导师协作、写作 Proposal、修订记录、AI disclosure 和阶段门禁结构化；章节不可变，修改产生 diff。
  - [ ] `070-G2` Markdown/LaTeX preview 保留 Paper/Evidence/Claim/BibTeX/page quote 关联；引用面板拒绝 metadata-only 或无 locator Evidence。
  - [ ] `070-G3` 只能选择 lineage 完整且有效的 Experiment/Artifact 插入图片和数字，保留 caption、指标来源、commit、数据版本、配置指纹和 Run ID。
  - [ ] `070-G4` Linux `latexmk` 使用隔离目录、固定入口、有界日志、PDF Artifact、编译 hash 和失败诊断；不在 Windows 原生侧启动编译服务。
  - [ ] `070-G5` 最终门禁检查引用、证据、图表、实验、数据、上游有效性、AI disclosure、导师反馈和未决 Proposal；有缺口就阻止 PDF 交付。
  - [ ] `070-G6` 章节、引用、图表和实验都能回链上游；Paper/Evidence/Run/Artifact 失效时标记受影响段落并阻止编译。
  - [ ] `070-G7` 验收模型失败不产生伪段落、BibTeX key 稳定、引用不重复、图片路径 containment、编译失败无成功状态、跨项目拒绝和历史版本可回看。

### 4.9 端到端

- [ ] `070-H` 四个一级入口（含 `实验实现`）、六个工作包的数据流、状态/权限/失败关闭、project isolation、键盘导航、桌面/移动截图、真实来源、实验、报告和论文门禁全部通过。不以静态占位页、fixture 数字、旧缓存或无关 baseline 替代真实链路。

### 4.10 导航重构：实验职责归位与论文撰写边界（用户新增需求）

用户 2026-08-02 新增需求，作为 `070-A`/`070-D`/`070-E`/`070-F`/`070-G` 的 UI 信息架构修订合同，优先级高于旧“学术论文入口承载实验结果”的描述。核心：把所有实验相关部分移动到实验标签页；把《我们的方法》替换为《实验实现》（二级《相关工作实现》《本方法实现》，三级为具体页面）；把《学术论文》更名为《学术论文撰写》，只保留撰写论文相关功能。

- [~] `P0-NAV-078` 重构一级/二级/三级导航，使实验职责全部归位到 `实验实现`，论文入口只保留撰写功能。
  - [x] `078a` 一级入口固定为：`项目概述`、`相关工作调研`、`实验实现`、`学术论文撰写`。`ResearchArea` 新增实现区 id（建议 `implementation`），旧 `method` 深链接必须重定向到 `implementation`；`TAB_AREA`、`AREA_DEFAULT_TAB`、类型定义和测试同步更新。
  - [x] `078b` `实验实现` 二级栏固定为 `本方法实现`、`相关工作实现` 两个子标签，顺序不可交换；三级页只在所属二级栏内显示。
  - [x] `078c` `相关工作实现` 三级页：`代码复现`、`效果比较`。这两个 Tab 从 `相关工作调研` 区域迁出；UI 行为、API、审批与谱系保持不变。
  - [x] `078d` `本方法实现` 三级页：`方法设计`、`代码工作区`、`变更与审批`、`Git 与备份`、`实验计划与结果`、`运行队列`、`指标统计`、`结果与可视化`、`实验谱系`。原 `我们的方法` 分组和原 `学术论文 -> 实验结果` 分组的内容全部并入这里。
  - [x] `078e` 从 `学术论文撰写` 移除所有实验管理/可视化页面（`experiments`、`experiment_queue`、`experiment_metrics`、`artifacts`、`lineage`）；这些页面只能出现在 `实验实现 -> 本方法实现`。
  - [x] `078f` `学术论文撰写` 只保留写作相关页面：`论文项目`、`大纲与章节`、`引用与 BibTeX`、`图表选择与插入`、`实验数据选择与引用`、`LaTeX 编译`、`PDF 呈现/审阅`。`图表选择与插入` 只列出 lineage 完整且有效的实验 Artifact 供选择插入，禁止在论文页复刻实验管理/运行/可视化界面；`实验数据选择与引用` 只做数据/数字选择与 lineage 展示。
  - [x] `078g` `日报/周报与导师反馈` 从 `学术论文撰写` 移入 `项目概述` 的二级栏（导师查看进度并反馈）；若用户后续明确要独立入口，再按新需求调整，不得擅自把反馈塞回论文撰写。
  - [x] `078h` 深链接兼容映射至少包含：旧 `method_design`/`code_workspace`/`policies`/`approvals` -> `implementation` 对应 Tab；旧 `paper#experiments`/`paper#experiment_queue`/`paper#experiment_metrics`/`paper#artifacts`/`paper#lineage` -> `implementation` 对应 Tab；旧 `paper#daily_reports`/`paper#weekly_reports`/`paper#feedback_inbox`/`paper#feedback_audit`/`paper#reports` -> `overview` 对应 Tab；`paper` 下写作 Tab 保持归属但标签更新。刷新、前进/后退、移动端折叠、键盘焦点和 `aria-current` 恢复同一 project/area/subtab/tab。
  - [x] `078i` 论文入口默认值改为写作相关 Tab（如 `paper_outline`），不再默认落到实验页；`AREA_DEFAULT_TAB` 同步。
  - [~] `078j` 新增/更新组件测试：区域与 Tab 归属、hash 重定向、默认 Tab、论文页不含实验管理内容、实验实现页包含全部实验 Tab、项目切换不残留跨区域状态。
  - [x] `078k` 更新 `ProjectView.tsx`、`types.ts`、`App.tsx` 和相关 Tab 组件；删除不再使用的旧分组/空壳；同步 `README.md`、`README.zh-CN.md`、`AGENTS.md`、架构/安全文档和 `DOCS_SYNC_VERSION`，避免旧的一级入口/职责描述残留。
  - [ ] `078l` 浏览器验收：Windows Chrome 访问 WSL2 服务，100% 桌面、窄桌面和移动宽度截图；验证 `实验实现` 二级/三级导航、`学术论文撰写` 无实验管理内容、`项目概述` 含报告/反馈入口、项目列表独立滚动和无重叠/溢出。
  - [x] `078m` 将论文撰写的页面 Tab 直接提升为 `学术论文撰写` 的二级导航；移除“论文写作与编译”单一分组及正文内重复导航，保留页面 ID、hash 深链接、默认页和四语言文案。已通过类型检查、导航检查、UI 检查、Web 构建、文档同步检查和测试。
  - [x] `078n` 将项目工作区地址改为无 `#` 的 History API 路径 `/project/<semantic-slug>/<area>/<tab>`；历史 slug/UUID/hash 保持兼容。新项目 slug 的两词加四位后缀规则由 `P0-PROJECT-URL-099` 继续维护。URL 中的 Idea 页面使用 `overview/idea`，已通过 slug、导航、SPA 直达、类型、构建和测试检查。
  - [~] `078o` 将 `实验实现` 的第三级具体页面从正文内部提升到一级入口与二级入口下方，形成三行导航；二级顺序调整为 `本方法实现`、`相关工作实现`，并保留旧深链接映射与响应式可访问导航。
  - [x] `078p` 修复 `overview/idea` 与 `overview/overview_spec` 复用同一正文的问题，使项目概述和项目规格页面呈现不同内容；移除第三级导航中不可点击的分组说明文字，只保留可点击页面标签。已通过四语言 UI、导航检查、Web 构建和完整测试。

### 4.11 多语言支持与中文文案母语化（用户新增需求）

用户 2026-08-02 新增需求：网页支持多语言，在页面右上角提供语言切换；支持简体中文、繁体中文、英语、西班牙语，默认简体中文。用户明确要求逐个审核现有呈现出来的中文，站在汉语母语使用者的角度，尤其是小白、初次使用者，让每个词汇一眼就能看懂其含义，不产生歧义；对概念性内容提供鼠标悬停 tooltip 作更直接、详细的解释。本任务的产品界面文案范围：按钮、标签、导航、状态、错误、toast、空态、aria-label、title/tooltip 等应用自身文案；模型生成内容（聊天回复、报告正文、论文正文、实验日志等动态内容）保持原文，不自动翻译，如需翻译另行登记需求。

- [~] `P0-UI-I18N-079` 多语言基础设施、右上角语言切换和中文文案母语化审核。
  - [x] `079a` 在 `Topbar` 的 `.top-actions` 区域增加语言切换下拉，提供 `简体中文（zh-CN）`、`繁体中文（zh-TW）`、`英语（en）`、`西班牙语（es）` 四个选项，默认 `zh-CN`；切换立即重渲染全部界面文案，不刷新页面，不改变当前 project/area/tab。
  - [x] `079b` 语言选择持久化到 `localStorage`（如 `researchos.locale`），刷新、前进/后退、重新打开页面保持；不把语言代码写入深链接路径或旧 hash，避免污染项目/区域/页面解析；读取优先级为 localStorage > 默认 `zh-CN`。
  - [x] `079c` 采用轻量、类型安全的 i18n 方案（例如 `i18next`，或自建 `dictionaries/*.ts` + `t(key, params)` hook），所有 UI 文案迁移为 key；禁止继续在 TSX 中散落硬编码中文。四个语言各一份字典，统一通过 key 读取。
  - [x] `079d` 四份字典的校对要求：`zh-CN` 按汉语母语习惯逐句审核；`zh-TW` 不能机械逐字转码，必须按繁体中文使用习惯校对；`en`、`es` 需人工或模型审核润色，保证自然、无歧义、术语一致。
  - [x] `079e` 中文母语化全面审核：逐个审核 `apps/web/src/**/*.tsx`（`Sidebar`、`Topbar`、`ProjectView`、`IdeaView`、`ProjectChat`、`ModelSettingsModal`、`MemoryGraphModal`、全部 Tab 组件、`previews.tsx`、`ui.tsx` 等）中所有呈现给用户的中文，从小白/初次使用者视角确认一眼可懂、直截了当；同一概念全站统一译名，不混用中英混排；对 `Idea`、`规格`、`证据`、`Claim`、`谱系`、`审批`、`候选`、`partial`、`blocked`、`failure`、`provenance` 等专业词汇建立统一术语表，术语表与用户确认后作为唯一翻译来源。
  - [x] `079f` 审核覆盖：一级/二级/三级导航标签、按钮、表单、状态徽标（empty/loading/partial/failure/blocked/candidate/confirmed 等的中文呈现）、错误提示、toast、空态、加载态、aria-label、title、tooltip，以及模型配置、项目记忆图、嵌入设置等弹窗内的全部文案；2026-08-02 补完 API 结构化错误本地化、状态徽标字典映射和 `Mastra Workflows` 侧栏链接四语言译名。
  - [x] `079g` Tooltip：对概念性、缩写、专业术语或状态含义不直观的 UI 元素增加鼠标悬停 tooltip，给出直白、详细的解释，帮助小白理解；tooltip 文案参与 i18n；键盘聚焦也可显示，移动端通过长按/点击显示，不阻塞操作。
  - [~] `079h` 可访问性与响应式：语言切换与主题切换控件在右上角相邻排列，窄屏不溢出；`<html lang>` 随语言更新；语言切换后字数变化时按钮、标签、表格不破裂、不重叠。
  - [~] `079i` 测试与验收：字典完整性测试（四语言无缺 key、无未翻译残留）、默认 `zh-CN`、切换即时生效、持久化、深链接不串语言；浏览器四语言桌面/窄屏截图，检查无漏译、无生硬译名、无重叠溢出；截图验收并入 `070-A4`/`078l`。
  - [x] `079j` 完成后同步 `README.md`、`README.zh-CN.md`、`AGENTS.md`、架构/UI 文档和 `DOCS_SYNC_VERSION`，说明支持的语言、默认语言、术语表位置和动态内容翻译边界。
  - [x] `079k` 清理残余 UI 硬编码：`api.ts` 超时/离线/请求失败文案、App 初始助手消息、Topbar 元数据、概览状态/版本文案全部改为 i18n key；新增 `scripts/check-ui-i18n.ts`（TypeScript AST 扫描、忽略注释）并纳入 `ui:check`，确保 TS/TSX 不再散落硬编码中文。
  - [x] `079l` 窄屏 Topbar 语言/主题控件压缩，消除 390px 视口文档级横向溢出（语言/主题图标隐藏、select 限宽、标题与 meta 截断）；导航横向滚动保留为可访问的溢出容器。
  - [x] `079m` 已迁移项目范围、Run、seed、commit、unresolved、材料/资源状态等残余应用术语到四语言字典；`scripts/check-ui-i18n.ts` 已覆盖可见英文硬编码检查。四语言桌面主屏截图复查通过，`Mastra Workflows` 已按语言显示为对应译名；窄屏/全页面截图仍归入 `079h`/`079i`。
  - [x] `079n` 清理前端角色化表达：不再以导师、老师、监督者、学生或 `YOU`/`AI` 作为用户与系统的角色关系展示；反馈、处理状态和聊天身份改为中性产品文案与图标。已完成 Web 构建、源码/产物扫描、Web 类型检查、i18n 检查和完整 `npm run check`。
  - [x] `079o` 修复长标题挤压 Topbar 右侧操作区和标题行高不足的问题：标题区可收缩并最多舒适显示两行，语言/主题/状态/刷新控件保持稳定空间；工作区随顶部实际高度填充剩余空间，已通过响应式样式、Web 构建和 UI 检查。真实浏览器截图仍归入 `079h`/`079i`。

### 4.12 两主题切换（用户新增需求）

用户 2026-08-02 新增需求：在页面右上角提供浅色、暗色两种主题的切换，使用 dropdown 选择；默认浅色主题；主题配色遵循苹果公司（Apple）的颜色设计规范。主题只改变视觉呈现，不改变布局、功能和数据。随后用户明确撤销两档彩色主题，项目只保留浅色与暗色。

- [~] `P0-UI-THEME-080` 右上角两主题切换与 Apple 规范配色。
  - [x] `080a` 在 `Topbar` 的 `.top-actions` 区域、语言切换旁边增加主题下拉，提供 `浅色`、`暗色` 两档，默认 `浅色`；切换立即生效，不刷新页面，不影响当前 project/area/tab 和语言。
  - [x] `080b` 主题选择持久化到 `localStorage`（如 `researchos.theme`），刷新、前进/后退、重新打开页面保持；不写进 URL；默认浅色。
  - [x] `080c` 实现方式：把现有 `apple-glass.css` 中写死的颜色、阴影、毛玻璃参数收敛为语义 CSS 变量，通过根节点 `data-theme="light|dark"`（或等价机制）切换两套主题；组件不再内联写死颜色，统一使用语义变量。
  - [x] `080d` 浅色主题：默认主题，保持当前 Apple 玻璃、磨砂、半透明质感；白/浅灰层次、Apple System Colors 语义色（如强调蓝 `#007AFF` 系），文字、边框、阴影、滚动条、进度条、选中态和焦点环全部统一。
  - [x] `080e` 暗色主题：按 Apple 暗色设计规范实现（近黑背景、深灰层次、低饱和强调色、暗色下毛玻璃/磨砂正确显示），不是简单反色；所有界面元素必须跟随暗色变量，无死色、无突兀的 Win11 原生控件样式。
  - [x] `080f` 原两档彩色主题方案已按用户后续决定彻底删除，不再进入功能范围，避免增加视觉噪声和主题维护成本。
  - [x] `080g` 覆盖全部界面：卡片、表格、表单、Modal、Toast、tooltip、Markdown preview、图表/点云预览、diff、滚动条、进度条、选中态、hover、focus ring 在两种主题下均正确，文字与背景对比度至少满足 WCAG AA。
  - [~] `080h` 主题与语言、导航互不干扰：切换主题不改变语言，不改变 project/area/tab，刷新后恢复所选主题且无闪烁、无布局跳动。
  - [~] `080i` 测试与验收：两主题桌面/窄屏截图、颜色变量引用检查（禁止组件内联写死颜色）、持久化测试、切换无闪烁；截图验收并入 `070-A4`/`078l`。
  - [x] `080j` 完成后同步 `README.md`、`README.zh-CN.md`、`AGENTS.md`、架构/UI 文档和 `DOCS_SYNC_VERSION`，说明两主题、默认浅色和 Apple 配色规范。
  - [x] `080k` 已审计两套主题的正文、次要文字、成功/失败/警告状态、表单错误、图表标签和移动端 Modal 操作栏；残余硬编码文字色已迁移到语义变量，时间序列图随主题切换。代表性文字对比度均达到 WCAG AA：浅色次要文字 5.07:1、暗色次要文字 5.42:1、暗色错误文字 4.52:1。
  - [x] `080l` 已将浅色主题一级标签选中态改为蓝色玻璃层，不再使用纯黑背景；主题选项与历史存储值已收敛为 `light`、`dark`，旧彩色值自动回落到 `light`。
  - [x] `080m` 用户决定彻底删除两档彩色主题；已移除主题类型、下拉选项、四语言彩色名称、彩色 CSS 变量/规则、六色卡片规则、旧兼容分支和相关文档描述，并通过全仓引用复查。
  - [x] `080n` 将右上角语言/主题控件从原生 `<select>` 替换为主题感知的自绘菜单，解决系统下拉列表背景与页面不一致的问题；保留键盘导航、焦点、点击外部关闭和两主题适配。`typecheck`、`ui:check`、Web `build` 和 `git diff --check` 已通过；真实浏览器截图仍由 `080i` 跟踪。

### 4.13 错误地址与自定义 404 页面（用户新增需求）

- [~] `P0-UI-ERROR-081` 为不存在或拼写错误的网页地址提供统一的主题感知、自定义 404 页面，并在 3 秒后返回首页。
  - [x] `081a` 服务端对非 API 的未知浏览器路径回退到 SPA，保留 API 与静态资源的真实 404 行为；已用独立端口 HTTP 请求验证。
  - [x] `081b` 前端识别无效工作区路径和不存在的项目，独立渲染居中玻璃质感 404 页面，不显示普通工作区壳层。
  - [x] `081c` 404 页面支持 `zh-CN`、`zh-TW`、`en`、`es`，显示当前无效路径、明确说明、首页按钮和 3 秒倒计时。
  - [x] `081d` 计时结束使用 History API 回到首页，手动首页按钮立即返回，并处理刷新、前进/后退与主题切换逻辑。
  - [~] `081e` 待完成四语言、浅色/暗色、桌面/窄屏真实浏览器截图验收；代码已通过 Web/server 类型检查、Web/server/Mastra 构建、导航/UI/i18n、文档/语言边界检查和 104 项 server 测试。当前浏览器连接因 WSL 工作区路径被浏览器沙箱拒绝，解除条件是可用的浏览器验收环境。

### 4.14 项目级隔离、项目管理和工作区交互（用户新增需求）

- [~] `P0-PROJECT-UX-082` 将项目专属数据按项目目录隔离，并补齐项目删除、侧栏宽度和标签交互。
  - [!] `082a` 新写入的上传、实验输出、文献 PDF、复现归档和 Artifact 文件已统一写入 `projects/<project-id>/artifacts/`；共享数据库保留结构化索引、状态、哈希和审计；启动时会幂等迁移旧 `artifacts/` 文件。历史 Supermemory 生成的部分全局文件目录属于 UID `10002` 且当前 WSL 用户无目录删除权限，已复制到项目目录并审计为 `cleanup_pending`；解除条件是为该历史目录提供删除权限后再次运行迁移。
  - [x] `082b` 左侧项目列表提供 Apple 风格删除确认对话框，后端校验目标项目名称和 `DELETE` 后删除数据库记录、语义记忆、项目目录、关联产物和项目级配置；新增 API 与隔离测试。初版要求用户同时手输项目名称和 `DELETE`，前端手输名称步骤已由 `P0-PROJECT-UX-096` 移除，名称改为随当前目标自动提交并继续由后端校验。
  - [x] `082c` 左侧栏支持拖拽调整宽度，限制最小/最大宽度，支持键盘调整、持久化和窄屏禁用拖拽。
  - [x] `082d` 一级、二级和第三级标签栏使用非线性滑动选中指示器，支持语言切换、窗口变化、横向滚动和键盘操作。
  - [!] `082e` 代码检查、四语言字典、两主题样式、删除隔离测试和桌面/窄屏规则检查已完成；真实浏览器截图验收被当前 Browser sandbox 拒绝 `/mnt/d/researchos` 工作区，解除条件是提供可访问该 WSL 工作区的浏览器验收环境。

- [~] `P0-PROJECT-UX-083` 修复项目正文 `tab-content` 的长内容滚动，并统一 Apple 风格滚动条。
  - [x] `083a` 为桌面和移动端补齐工作区高度链、flex/grid 最小高度和正文独立滚动约束；复用项目列表的细窄圆角滚动条，并适配浅色/暗色对比度；已通过类型检查、UI 检查、构建和差异校验。
  - [ ] `083b` 完成真实浏览器桌面、窄屏和长内容截图验收，确认正文滚动条可见、可操作且不产生页面级溢出。

- [~] `P0-PROJECT-UX-084` 优化项目删除入口和确认对话框的可见性、误操作防护与层级。
  - [x] `084a` 删除入口改为悬停后出现的红色垃圾桶图标，不占用未显示时的项目列表宽度；确认框统一确认词字体。原项目名称输入框及其复制/粘贴限制已由 `P0-PROJECT-UX-096` 移除，只保留手动 `DELETE` 确认。
  - [ ] `084b` 完成真实浏览器浅色/暗色截图验收，确认删除图标动画、项目列表布局和顶部磨砂遮罩无重叠问题。

- [~] `P0-PROJECT-UX-085` 优化前端分栏尺寸交互，减少固定宽度造成的内容截断，并统一紧凑桌面密度。
  - [x] `085a` 将左侧项目栏拖拽改为合帧的直接预览，保留最小/最大宽度、键盘调整和持久化，避免每个指针事件触发整页 React 重渲染；已通过类型检查、UI 检查和构建。
  - [x] `085b` 为项目工作区右侧项目对话增加可拖拽分隔条，限制范围、持久化宽度并支持键盘调整；窄屏继续使用浮层，不显示分隔条；已通过类型检查、UI 检查和构建。
  - [x] `085c` 为新建项目页右侧规格栏增加可拖拽分隔条，限制范围、持久化宽度并支持键盘调整；移动端保持单栏布局；已通过类型检查、UI 检查和构建。
  - [~] `085d` 统一桌面端的紧凑间距、标题、按钮和面板尺寸，减少内容被截断的情况；完成桌面/窄屏/移动端真实浏览器验收后再关闭。

- [~] `P0-PROJECT-UX-086` 为项目列表增加 Apple 风格的置顶与删除动作层，并保持项目排序和多语言一致。
  - [x] `086a` 增加项目 `pinned` 持久化字段、置顶 API 和置顶优先列表排序；补充服务端隔离与排序测试。
  - [x] `086b` 将项目列表操作改为右侧双按钮动作层：悬停 1 秒部分露出、3 秒完全展开，离开时平滑收回；键盘聚焦立即可用。
  - [x] `086c` 增加四语言置顶/取消置顶标签和操作反馈，适配浅色/暗色主题，避免操作按钮改变列表布局。
  - [~] `086d` 类型检查、UI 检查、完整 server 测试（29 个测试文件、108 个测试）、构建、导航/文档/语言边界检查均通过；真实浏览器截图仍受当前 Browser sandbox 无法访问 `/mnt/d/researchos` 阻塞，`npm run acceptance` 另因创建项目主链返回既有 `500 internal_error` 未通过，待可用验收环境和主链修复后完成。

- [~] `P0-PROJECT-UX-087` 将左上角 Research OS 品牌标识改为居中的首页入口。
  - [x] `087a` 图标与品牌名称合并为一个可点击按钮，复用首页导航并提供四语言无障碍名称。
  - [x] `087b` 调整浅色/暗色和窄屏样式，使品牌整体在侧栏中保持协调居中且不破坏移动端布局。
  - [~] `087c` 类型检查、UI/i18n/主题检查、构建和差异校验均通过；真实浏览器验收仍受当前 Browser sandbox 无法访问 `/mnt/d/researchos` 阻塞。

- [~] `P0-PROJECT-UX-088` 修复项目列表操作按钮从右侧出现时的离散跳变。
  - [x] `088a` 将 1 秒后的部分露出改为持续 2 秒的连续滑入与透明度过渡，3 秒时自然停稳。
  - [~] `088b` UI 检查、Web 构建和差异校验均通过；真实浏览器验收仍受当前 Browser sandbox 无法访问 `/mnt/d/researchos` 阻塞。

- [~] `P0-PROJECT-UX-089` 调整左上角 Research OS 首页按钮的悬停背景和垂直尺寸。
  - [x] `089a` 去掉悬停背景圆角和多余位移，将按钮高度提高到完整包住品牌图标并保留上下间距。
  - [~] `089b` UI 检查、Web 构建和差异校验均通过；真实浏览器验收仍受当前 Browser sandbox 无法访问 `/mnt/d/researchos` 阻塞。

- [~] `P0-PROJECT-UX-090` 修复项目置顶/删除图标悬停时的状态切换跳变，改为单条连续时间线。
  - [x] `090a` 悬停立即启动 3 秒揭示动画，前 1 秒保持极少露出，后 2 秒连续从右侧滑入；3 秒只开放操作，不改变视觉位置。
  - [~] `090b` 类型检查、UI 检查、Web 构建和差异校验均通过；真实浏览器验收仍受当前 Browser sandbox 无法访问 `/mnt/d/researchos` 阻塞。
  - [x] `090c` 更新 HTML 中的版本化资源查询参数，强制浏览器加载最新的 `app.js` 和主题 CSS，避免继续复用旧动画缓存。

- [~] `P0-PROJECT-UX-091` 修复鼠标焦点被误判为键盘焦点导致项目操作图标立即完整显示。
  - [x] `091a` 仅对 `:focus-visible` 键盘焦点立即展开操作层，鼠标点击焦点继续使用悬停连续动画。
  - [~] `091b` 类型检查、UI 检查、Web 构建和差异校验均通过；真实浏览器验收仍受当前 Browser sandbox 无法访问 `/mnt/d/researchos` 阻塞。

- [~] `P0-PROJECT-UX-092` 用逐帧 DOM 动画替代项目操作图标的 CSS 关键帧，确保悬停时真实连续过渡。
  - [x] `092a` 使用 `requestAnimationFrame` 驱动置顶/删除图标从右侧逐帧滑入、渐显和缩放，离开时逐帧收回；键盘焦点继续立即展开。
  - [~] `092b` 类型检查、UI 检查、Web 构建和差异校验均通过；真实浏览器验收仍受当前 Browser sandbox 无法访问 `/mnt/d/researchos` 阻塞。

- [~] `P0-PROJECT-UX-093` 将项目操作图标从逐帧实现还原为纯 CSS 过渡，并缩短为立即开始、持续 1 秒的滑入效果。
  - [x] `093a` 移除 JavaScript 逐帧动画，悬停立即设置 CSS 过渡目标，持续 1 秒从右侧滑入，离开时快速平滑收回。
  - [~] `093b` 类型检查、UI 检查、Web 构建和差异校验均通过；真实浏览器验收仍受当前 Browser sandbox 无法访问 `/mnt/d/researchos` 阻塞。

- [x] `P0-PROJECT-UX-094` 将项目操作图标显示完全交给 CSS `:hover`/`:focus-visible`，移除 React 显示状态对过渡的干扰。
  - [x] `094a` 使用 `.project-row:hover` 直接触发 1 秒滑入，使用 `:has(:focus-visible)` 支持键盘立即显示，按钮保持可访问且不依赖计时器。
  - [x] `094b` 类型检查、UI 检查、Web 构建和差异校验通过；已通过 Windows Headless Chrome CDP 建立可采样真实 hover 计算样式的浏览器反馈环。
  - [x] `094c` 修正动作层的横向溢出与瞬时显示：固定 58px 右侧裁剪窗口，只让 66px 外的动作轨道做纯 CSS 位移；项目列表真实浏览器 `clientWidth` 与 `scrollWidth` 全程一致，未再被撑宽。
  - [x] `094d` 真实浏览器确认并修复三项根因：Windows Chrome 命中 `prefers-reduced-motion: reduce` 后移除 transform、通用 `.project-list button` 规则覆盖动作按钮 transition、原 spring 曲线在前 400ms 完成约 93% 位移。资源版本更新至 `project-actions-11`；reduced-motion 原始环境下 0/40/100/200/400/700/1000ms 多帧采样、收回采样、三轮重复悬停和截图验收均通过。

- [x] `P0-PROJECT-UX-095` 消除项目操作按钮滑入前提前出现的大块右侧空白。
  - [x] `095a` 真实 Chrome 复现并修复：旧实现 hover 后 100ms 动作轨道仍接近右侧边界，但标题因 `padding-right` 被 reduced-motion 规则瞬间完成而从 165px 缩至 104px。现将标题让位与动作轨道统一为相同的纯 CSS 时长和曲线，并将最终预留从 72px 收紧至 66px；资源版本更新至 `project-actions-12`。100ms 标题仍为 159.8px、padding 仅 16.2px，0/100/250/400/700/1000ms 进度同步、280ms 收回同步、宽度稳定和关键帧截图验收均通过。

- [x] `P0-PROJECT-UX-096` 收紧项目操作动画时长，恢复真实置顶能力，并简化删除确认流程。
  - [x] `096a` 将置顶/删除动作层和标题让位的纯 CSS 滑入时长从 1 秒缩短至 0.5 秒，资源版本更新至 `project-actions-13`。Windows Chrome 在原生 `prefers-reduced-motion: reduce` 环境下采样 0/125/250/500ms，padding 与轨道均报告 `0.5s` 并同步到达终点，列表宽度保持稳定。
  - [x] `096b` 置顶失败根因是 `/mnt/d` 不支持 inotify 后，`8080` 仍运行未注册 pin 路由、未加载 `pinned` 迁移的旧 API 进程，真实请求复现为 `404 not_found`。手动重启后健康检查通过，项目列表返回 `pinned`，真实 API 和 Windows Chrome 均验证非首位项目置顶后成为首项、取消置顶成功；服务端置顶测试 2 项通过，验收数据已恢复原状态。
  - [x] `096c` 删除确认框移除项目名称输入，只显示不可编辑的删除目标并要求手动输入 `DELETE`；输入框自动聚焦、将 `delete` 规范为大写、禁用粘贴/拖放且限制 6 字符，项目名称由前端自动提交并继续通过后端严格校验。`zh-CN`、`zh-TW`、`en`、`es` 在浅色/暗色共 8 组真实浏览器检查均只有一个输入框且无溢出；Web/server 类型检查、Web 构建、UI/i18n、导航、语言边界及删除/置顶定向测试通过。

- [x] `P0-PROJECT-UX-097` 统一项目页面上下文、主题自适应、项目排序交互和聊天输入行为；已完成 Web/server 类型检查、构建、29 个测试文件共 109 个测试、UI/i18n/主题检查、真实 Chrome 回归和主链验收。
  - [x] `097a` 将项目范围、更新时间、状态和失败提示从每个 `tab-content` 移到共享顶部标题区域，避免每个内容页面重复渲染；真实浏览器确认顶部仅有一个上下文区域。
  - [x] `097b` 修复浅色/暗色切换下 AI 头像、聊天附件按钮和输入框的硬编码颜色，统一使用主题语义变量；真实 Chrome 已检查浅色/暗色渲染与对比度。
  - [x] `097c` 已置顶项目悬停时只显示取消置顶和删除两个动作；新增置顶项目通过持久化 `sidebar_order` 追加到现有置顶组末尾，并已真实点击验证。
  - [x] `097d` 支持项目列表长按后通过 Pointer Events 拖拽调整同一置顶组内的项目顺序，顺序持久化并补齐严格 API、迁移和排序测试；真实拖拽后已恢复验收数据顺序。
  - [x] `097e` 聊天输入框保留 Enter 换行、Ctrl+Enter 发送，空白消息不发送；输入为空时显示发送快捷键提示，并覆盖新建项目与项目对话两处输入框；真实 Chrome 已验证。

- [x] `P0-PROJECT-DELETE-098` 修复置顶项目无法删除的回归，并覆盖置顶状态下的删除请求与前端状态清理。
  - [x] `098a` 删除确认提交前重新读取当前项目标题，避免置顶重排后的旧项目快照触发严格标题校验；删除成功后立即从前端列表移除目标并继续刷新服务端列表。
  - [x] `098b` 项目操作层提高到独立堆叠层并阻止 Pointer Events 进入长按拖拽逻辑；服务端回归覆盖“先置顶、再删除”完整路径，Windows Chrome 已确认置顶项目的删除按钮可命中并打开确认框。

- [x] `P0-PROJECT-URL-099` 将新项目地址标识收敛为“两个英文单词 + 四位小写字母/数字”格式，并明确项目级 Artifact 存储边界；已完成真实数据库迁移、旧链接兼容和全量验证。
  - [x] `099a` 服务端、Mastra schema/提示词和前端手动输入统一要求严格格式 `^[a-z]+-[a-z]+-[a-z0-9]{4}$`；自动生成只接受两个语义关键词，再由服务端生成唯一四字符后缀。
  - [x] `099b` 为已有不符合规则的项目生成严格新 slug，并在 `project_slug_aliases` 保存旧 slug 以保持旧链接兼容；UUID 地址继续直接解析。新项目冲突使用新的随机后缀重试，不能产生第三个英文单词或数字长后缀；已在真实数据库迁移并验证旧地址回查。
  - [x] `099c` 更新四语言文案、服务端错误、测试、README/架构说明和 URL 示例，明确四字符后缀不是语义词。
  - [x] `099d` 复查项目专属文件只写入 `projects/<project-id>/`；根目录 `artifacts/` 仅保留全局备份、验收/测试/运维材料和历史兼容迁移来源，并补充清晰的目录说明；数据库中的项目 Artifact/上传记录已全部落在项目路径，历史孤立文件不自动删除。
  - [x] `099e` 已完成类型检查、110 项服务端测试、slug/API 定向测试、UI/i18n 检查、Web/Server/Mastra 构建、文档/语言边界/导航检查、真实 API 迁移验证和差异检查；本任务相关文件可独立提交。

- [x] `P0-MODEL-API-100` 全量审计并迁移 Research OS 的大模型请求到 OpenAI Responses API，修复结构化 JSON 请求契约并移除模型失败后的所有成功型 fallback。
  - [x] `100a` 逐处核对 Mastra Agent、子 Agent 委派、Tools/Workflows/Evals 和服务端 Mastra client；Research OS 自有生产模型请求都通过 `@ai-sdk/openai` 的 `responses()` 使用 `/responses`。Supermemory 闭源子进程仍只能按其兼容 Chat 接口发起内部请求，但现在统一被本地 loopback TypeScript bridge 接收并转换到固定网关的 `/responses`，因此固定网关不再收到旧 Chat 请求；桥接失败直接结构化失败，不切换 provider 或生成 fallback。
  - [x] `100b` 所有结构化调用使用 Responses Structured Outputs 的 `text.format.type=json_schema` 和严格业务 schema；请求不发送 `json_object` 或互斥的旧 `response_format` 字段，Agent/Skill 提示明确要求 JSON。
  - [x] `100c` 模型配置 URL 统一作为 Responses API base URL 处理，拒绝包含 `/chat/completions`、`/completions` 或 `/responses` 的操作地址，并限制为 HTTPS 或回环/私有 HTTP；Luna/Terra/Sol 保持独立的 model、URL、key 和 reasoning effort，key 不进入返回值、日志或审计。
  - [x] `100d` provider HTTP、超时、鉴权、schema、拒绝和空/不完整响应全部失败关闭，返回稳定结构化错误；没有默认助手消息、空成功结果、伪造项目 slug/计划或隐式换 provider。Guardrail detector provider 失败同样直接阻断请求。
  - [x] `100e` 增加可捕获请求 URL/body 的 Responses 契约测试、4xx/5xx/超时/非法结构化响应、guardrail 失败关闭和 Mastra client 非 JSON 测试；已通过 typecheck、127 项全量服务端测试、build、Mastra HITL/evals、Idea/navigation/UI 检查和主链真实验收（2 次真实模型调用）。本轮补充的 `model-failure:check` 在正常首轮请求处收到模型网关 HTTP 502，未伪造通过；失败关闭由 Responses provider/guardrail/mastra-client 契约测试覆盖。Supermemory 真实验收已尝试但远端文档保持 `queued`，按既有 `P0-SUPERMEMORY-LOCAL-053` 外部阻塞记录，未伪造通过。

- [~] `P0-MODEL-API-101` 2026-08-03 用户在上游模型控制面板看到 `Response input messages must contain the word 'json' ... json_object`；当前仓库源码、Responses 构建产物和契约测试均确认 Research OS 自有 Agent/Guardrail 请求不再发送 `json_object`、`response_format` 或 `/chat/completions`。旧的 `runtime/mastra.err.log` 仍保留 2026-08-01 迁移前的旧请求；另有闭源 Supermemory 子进程可能按自身实现调用兼容 Chat API，无法由本仓库改写。
  - [x] `101a` 为所有 Research OS 自有结构化调用的实际 `input` 文本显式加入 JSON 输出指令，并增加兼容性测试；捕获的最终 Agent 请求确认使用 `/v1/responses`、`text.format.type=json_schema` 且 `input` 含 `json`，即使上游把 schema 兼容降级为 `json_object` 也不会因缺少提示词而拒绝。全量 134 项测试和完整构建通过。
  - [!] `101b` 外部控制面板报错的最终来源仍需从请求时间、路径和 request-id 确认；当前仓库无法读取该控制面板。旧的 `runtime/mastra.err.log` 已确认迁移前 Mastra 的 Chat 请求，新的真实桥接探针已收到固定网关 HTTP 200；外部面板仍需提供 request-id 才能把历史告警与当前进程逐条对应。
  - [x] `101c` 增加只监听 `127.0.0.1` 的 TypeScript Responses bridge，严格校验 Supermemory Chat body，将 `response_format=json_schema/json_object` 转为 `text.format.type=json_schema`，在 `input` 消息中加入 JSON 指令，并将有效 Responses 文本/工具调用转换回 Chat 响应；上游错误、超时、流式请求和无效响应均失败关闭。桥接契约 5 项、进程级转换探针和固定网关真实 HTTP 200 已通过。
  - [x] `101e` 修复固定网关不支持 Responses `item_reference` 导致的 Agent 502：所有 Mastra Responses 请求显式使用 `store:false`，将 Skills/Tools 的历史展开为完整 `function_call`/`function_call_output` 输入；保留严格 `text.format.type=json_schema`、JSON 指令和失败关闭。真实 `/api/chat`、带 Skill 的内部 Agent 探针、`model-failure:check` 和主链验收（2 次真实模型调用）均已通过固定网关；guardrail 契约测试覆盖 `store:false`。完整 typecheck、134 项服务端测试、Web/Server/Mastra 构建、docs/language-boundary/navigation/ui/idea-cases 检查均通过。
  - [~] `101d` 重启全局 Supermemory 和已发现的 embedding pool 后，两个运行实例的 `OPENAI_BASE_URL` 已核对为 `http://127.0.0.1:3010/v1`；隔离 Supermemory 文本 `add` 仍保持 `queued`、没有触发 memory-agent，因此未把“Supermemory 内部请求已真实捕获”冒充为完成。下一步仅需在有可处理的真实文档/LLM-agent 队列时确认 bridge 收到的原始请求形状。

- [x] `P0-MODEL-API-102` 将“仅结构化输出请求才在 input 消息注入 `json` 字样，普通自由文本请求禁止注入”的规则固化到 AGENTS.md；已逐处复核 Mastra 的 6 个 `generate` 调用点、Mastra workflows/evals/skills/tools 和 Supermemory Responses bridge，确认所有生产请求只在 `structuredOutput`/`response_format` 存在时注入。定向 18 项请求体契约测试通过，未发现全量注入、Chat Completions 残留或 `json_object` 请求。

- [x] `P0-UI-VOICE-103` 为所有聊天文本输入（Idea 讨论与项目对话）添加免费的浏览器内置语音输入，使用 Web Speech API，不依赖后端或第三方服务。
  - [x] `103a` 新增可复用 `VoiceInputButton`，支持开始/停止、实时转写、语言跟随界面、权限/无语音/设备错误提示和减少动画偏好；浏览器不支持时显示禁用状态。
  - [x] `103b` 接入 Idea 讨论与项目对话两个 composer，并更新四语言文案、明暗主题样式和移动端三列/四列网格；Web 类型检查、构建、UI/i18n、语言边界检查和真实 Chrome DOM/布局回归通过。
  - [x] `103c` 增加按住 `Ctrl+Space` 识别、松开停止的快捷键，并在 composer 提示中展示快捷键用法；Web 类型检查、构建、UI/i18n、语言边界检查和真实 Chrome DOM 回归通过。

## 5. 平台任务和外部阻塞

- [~] `P0-MASTRA-050` Agent/Memory/Skills/Tools/Workflows/Approval 使用 Mastra；材料索引和真实 provider 验收仍需外部条件。接入新 Mastra API 前先核对 `https://mastra.ai/llms.txt`、官方文档和当前类型定义。
- [!] `P0-SUPERMEMORY-LOCAL-053` 当前 Supermemory server build 的远程 embedding/PDF/图片能力存在已验证限制；保持失败关闭。解除条件：受支持的 Linux build/源码补丁和可用模型端点完成真实验收，或用户明确批准新的兼容实现。
- [!] `P0-RUNTIME-101` 当前正式 `runtime/research-os.pglite` 在首次 SQL 查询时稳定抛出 PGlite `RuntimeError: Aborted()`；锁清理和独立复制均不能恢复，正式库与备份已保留未覆盖。已用 `artifacts/backups/20260730T200648Z/postgres.sql` 生成并校验独立 `runtime/restore-pglite-model-check-20260803` 候选供本轮 API/失败边界验证，但不能自动替换正式运行目录。解除条件：人工审阅恢复候选并明确选择恢复，或从经验证的 PGlite 备份恢复正式库后重新完成 API/浏览器验收。
- [!] `P0-RUNNER-007` 目标 WSL2 主机的真实 GPU/CUDA 资源尚未验收；CPU supervisor 测试不能代表 GPU 通过。
- [x] `P0-WSL2-008` Windows 原生宿主不再是支持目标；WSL2 是默认开发 shell（nvm Node 26.5.1、共享 `/mnt/d/ResearchOS`、Linux API/Mastra/实验运行路径已验证）。Windows Chrome 仅作为调试浏览器，通过端口转发访问 WSL2 服务。
- [!] `P0-DEPS-056` 当前 Mastra/deployer 依赖链的上游 Hono advisory 需等待兼容修复；不能用破坏性降级掩盖。
- [~] `P1-UPLOAD-009` 大规模材料索引、项目范围语义检索和失败重放；PDF/图片终态仍受 Supermemory 外部条件阻塞。
- [~] `P2-HA-021` 长期无人值守、外部告警、备份恢复和跨重启演练尚未完成。

## 6. 执行顺序

0. 先完成 `P0-NAV-078` 导航重构与职责分离；同步落地 `P0-UI-I18N-079`（右上角语言切换、i18n 框架、术语表与中文母语化审核）和 `P0-UI-THEME-080`（右上角四主题切换、Apple 规范语义变量）的基础设施，再继续各工作包的 UI 验收，避免旧页面归属、硬编码文案和写死颜色继续复用。
1. 先关闭 `070-A`、`070-B`：两栏导航、页面状态、项目隔离和 Idea 结构化确认。
2. 完成 `070-C2/C3/C4/C5/C6/C7/C9`：种子、来源、递归、证据、provenance、矩阵、图、cache、恢复和浏览器验收。
3. 完成 `070-C8/C10` 的真实 topic-specific 代码复现和比较后（UI 位于 `实验实现 -> 相关工作实现`），才允许进入本方法设计。
4. 完成 `070-D` 的方法代码 Proposal、diff、测试、Git、remote 和备份后（UI 位于 `实验实现 -> 本方法实现`），才允许实验消费方法代码。
5. 完成 `070-E` 的真实实验、统计、Artifact 和 lineage 后（UI 位于 `实验实现 -> 本方法实现`），报告和论文才可以消费实验结果。
6. 完成 `070-F` 报告/反馈闭环（UI 位于 `项目概述`），再完成 `070-G` 论文证据、BibTeX、图表和 LaTeX 编译（UI 位于 `学术论文撰写`）。
7. 最后执行 `070-H` 全链路验收，并同步代码、测试、README、AGENTS、架构/安全/运维文档和 `DOCS_SYNC_VERSION`。

每次开始非微小工作前先把对应任务标为 `[~]`；范围、依赖、阻塞改变时立即更新；只有真实出口全部通过才能标为 `[x]`。验收失败保持 `[~]` 或 `[!]`，不得提交或 push。

## 7. 必跑验证

应用、数据库、运维和测试使用 TypeScript；科研 Python 例外只在项目实验/复现目录。适用命令：

```text
npm run typecheck
npm test
npm run build
npm run idea-cases:check
npm run docs:check
npm run language-boundary:check
npm run supermemory:acceptance
npx tsx scripts/acceptance-test.ts
npx tsx scripts/ops-guard.ts status
npm run mastra:hitl:check
npm run mastra:evals:check
npm run model-failure:check
npm run experiment:check
```

相关工作改动至少还要运行：

```text
npm run typecheck --workspace @research-os/server
npm run typecheck --workspace @research-os/web
npm test --workspace @research-os/server -- related-work
```

真实 provider、模型、Supermemory、GPU、LaTeX 或外部告警不可用时，记录结构化错误、复现步骤和解除条件；不得用 fixture 通过冒充真实验收。
