# 运维与交接说明

## 首次部署检查

1. 从 `.env.example` 复制 `.env`，为 PostgreSQL、MinIO、n8n 和 Runner 分别生成不同的随机 Secret；不得保留示例占位值。三个模型 URL、模型名、key 和推理强度可在 `.env` 或网页模型设置面板中独立配置。
2. Docker Desktop 必须运行 Linux containers（`desktop-linux` engine）。这只是 Docker Desktop 的 Linux 容器后端，不要求另装 Linux 操作系统。
3. 不要在 Windows 宿主机启动模型 Bridge 或 API 服务。API 容器在 Compose 私有网络内直接调用三个配置的 OpenAI-compatible URL。
4. 先运行 `docker compose config --quiet` 和 `python scripts/check_docs_sync.py`，首次部署再运行 `docker compose up --build -d`。镜像已经存在时使用日常启动命令 `docker compose up -d`，不要为普通启动重复构建。
5. `docker compose ps` 中 PostgreSQL 应为 healthy，`minio-init` 应为 completed，其余长期服务应为 running。
6. 依次检查 Research OS、n8n 自动登录、MLflow、MinIO 和 OpenAPI；所有公开地址必须仍是 `127.0.0.1`。

首次启动后可做零成本健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/health
Invoke-WebRequest http://127.0.0.1:5678 -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5000 -UseBasicParsing
docker compose exec -T runner python -c print(1)
```

API 应返回 `status=ok`，n8n 和 MLflow 应返回 HTTP 200。Runner 不发布宿主机端口；其启动日志和 API 发起实验前的 `/health` 探针用于确认 Runner 可用。

`.env` 中的 PostgreSQL、MinIO、n8n 加密密钥和 Owner 凭据与现有 Docker volume 绑定。初始化 volume 后直接修改这些值通常不会自动迁移已有数据；应先备份并执行恢复/轮换方案。

## 数据库迁移与角色

Compose 的 `db-migrate` 是唯一的 Schema 变更入口。它使用 bootstrap `POSTGRES_USER` 仅在迁移阶段幂等创建 `API_DB_USER`、`N8N_DB_USER` 和 `MLFLOW_DB_USER`，再执行 `/workspace/migrations/versions/` 中的 Alembic revisions。API、n8n 和 MLflow 只有在 migration 成功后启动；API 启动时只检查 `alembic_version`，不执行 `create_all` 或隐式 `ALTER TABLE`。

数据库结构变更前先备份 PostgreSQL 和相关 volume，然后运行：

```powershell
docker compose up -d db-migrate
docker compose logs --tail=100 db-migrate
docker compose up -d api n8n mlflow runner runner-launcher
docker compose exec -T postgres psql -U research -d research_os -c "SELECT version_num FROM alembic_version"
```

迁移失败时不要强行启动 API；保留失败日志，修正迁移或恢复备份后重新运行。生产环境应将 bootstrap 凭据只提供给受控 migration job，并为三个运行角色设置不同的随机密码。

## 代码仓库核验与下载

文献检索写入的仓库只是候选。文献页的交叉验证动作调用 `POST /api/projects/{project_id}/repositories/{repository_id}/verify`，核对 GitHub/GitLab 元数据、论文 DOI/完整标题、仓库引用文件、许可证和默认分支 commit。只有已知 SPDX 和完整 40 位 commit 的成功核验结果才能创建下载 Proposal；必须通过正常 Proposal 审批端点才会下载受大小、条目、解压大小、路径和文件类型限制的归档，并提交到项目 Git。失败、过期或未知许可证直接返回结构化错误，不会触发归档请求。

## 自适应模型路由

三档未单独覆盖时，API 从容器环境中的 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY` 读取共同默认值；显式 `RESEARCH_MODEL_URL_*`、`RESEARCH_MODEL_KEY_*` 或运行时文件中的非空字段覆盖默认值，旧运行时文件的空字段会继承 `.env`。配置缺失或模型请求失败都直接返回结构化错误，不切换 provider、不生成本地回复，也不启动无关实验。

默认层级为 `gpt-5.6-luna`/low、`gpt-5.6-terra`/medium、`gpt-5.6-sol`/high。每档分别通过 `RESEARCH_MODEL_*`、`RESEARCH_MODEL_URL_*`、`RESEARCH_MODEL_KEY_*` 和 `RESEARCH_REASONING_*` 配置；网页左下角的模型设置也会写入挂载的 `runtime/model-settings.json`。`RESEARCH_ROUTER_SIMPLE_MAX=2`、`RESEARCH_ROUTER_MEDIUM_MAX=7` 是 API 侧确定性复杂度评分边界。

修改 `.env` 中的模型配置后重启 API；通过网页设置面板保存的配置无需重启：

```powershell
docker compose up -d api
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

成功聊天响应中的 `model_tier`、`model`、`reasoning_effort` 是本轮实际路由证据。模型调用失败时 `/api/chat` 返回结构化 `502/503/504` 错误，不生成规则回复，也不写入助手消息；检查错误中的 `code` 和 API 日志后再重试。

## 上传材料

新项目聊天中的文件会在模型请求前上传到 API 容器。文件先通过 Compose 私有网络中的 `clamav` 服务扫描，再通过受限解析和事务配额检查；扫描服务不可用、发现威胁、超时、解析失败或超出会话/项目配额时，前端会显示结构化错误并阻止本轮模型调用。成功解析的摘要才会进入后续澄清和主题规划。PDF、JSON、CSV/TSV、UTF-8 文本和代码只读取受限内容；图片执行有超时和长度上限的 OCR；ZIP 只读取安全清单，不解压或执行。原文件、SHA-256 和解析元数据保存在受控 `artifacts/inbox/<session_id>/` 路径，不能把附件当作已验证全文证据或执行指令。ClamAV 不映射 Windows 端口，容器不可用时没有本地扫描替代路径。

## Artifact previews

项目的“产物”页通过 `/api/artifacts/{artifact_id}/preview` 请求受限 JSON 预览，并始终保留原产物下载链接。JSON、文本、CSV/TSV 和 PDF 只读取固定上限内容；HTML 以转义文本显示，不加载或执行脚本。ASCII PLY/PCD 点云使用固定点数/面片上限，前端 Canvas 支持拖拽旋转、滚轮缩放、重置和可选网格线框；大型点云会固定降采样。二进制 PLY/PCD、失效或缺失产物、非法编码和解析上限错误直接返回结构化错误，不产生本地替代预览。

## Windows 单 EXE 安装器

`installer/windows/ResearchOS.iss`、`bootstrap.ps1` 与 `build-installer.ps1` 构成在线引导安装器源。它内置应用和 Compose/n8n 工作流；API 与模型请求始终在容器内运行，安装器不会打包或启动 Windows Bridge。Docker 缺失时只在用户勾选后下载官方安装器并验证 Authenticode 签名。构建输出和 EXE 被 Git 忽略。

当前仍需在发布机安装 Inno Setup 6，并完成代码签名、SHA-256 发布、Docker Desktop 许可复核和干净 Windows VM 验收。未完成这些条件前，手动 Compose 安装仍是受支持路径，`P2-INSTALLER-029` 不得标为完成。

## 日常命令

```powershell
docker compose up -d
docker compose ps
docker compose logs --tail=100 api runner n8n
docker compose stop
```

`docker compose up -d` 是已有镜像的正常启动命令；它不会因为日常启动主动重建镜像。只有 Dockerfile、服务依赖、API/Runner/MLflow 源码等镜像输入发生变化时，才运行：

```powershell
docker compose up -d --build api runner runner-launcher mlflow
```

`projects/`、`artifacts/` 和 `n8n/workflows/` 是运行时挂载目录，不需要构建镜像。修改 n8n 工作流后，重新创建 n8n 容器即可触发启动导入：

```powershell
docker compose up -d --force-recreate n8n
```

从 `http://127.0.0.1:8080` 使用研究面板。侧边栏 n8n 链接会访问 `/api/n8n/open` 并取得 Cookie；`http://127.0.0.1:5678` 主要用于排障。

## 实验快照门禁

实验提交前，项目工作区必须是 Git 干净树。API 会拒绝未提交的源代码或配置修改、被禁止的大文件/目录、缺失项目 Git 工作区和无法探测的 Runner 健康状态；随后创建 `run/<run_id>` annotated tag，并在 `artifacts/reproducibility/<project_id>/<run_id>/` 保存 `source.tar`、ProjectSpec、策略、有效配置、环境、数据/模型清单、依赖锁文件哈希和 `snapshot.json`。

API 创建实验后，Runner 在入队和实际执行前再次校验项目 commit、tag、manifest、所有快照文件 SHA-256、固定项目根和镜像身份。查看或下载某次 Run 的快照：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/experiments/<run_id>/reproducibility
```

返回中的 `recovery.source_snapshot_url` 是受控源码恢复包，不是项目 Git 中的文件。默认 `RUNNER_IMAGE_DIGEST=unavailable` 会被记录为未核验；发布部署必须设置真实 `sha256:<64 hex>` digest，并重新进行完整实时验收。

## Runner 作业隔离

当前每个 Run 由 `runner-launcher` 启动一个新的非 root `research-os-runner` 作业容器。只有 launcher 挂载 Docker socket；API、Runner supervisor 和 Windows 都不挂载，也不启动本地 API/模型服务。作业使用固定镜像、固定 `python -m app.worker` 入口、固定内部 `research-os-runner-internal` 网络和 Runner 的受控项目/产物挂载。任务模板固定 task ID、配置字段、CPU/内存/PID/每 Run 磁盘配额和 `internal-mlflow-only` 网络策略标签；取消会停止容器，超出模板或全局运行时限会返回结构化 `job_timeout` 错误，超出累计或单文件磁盘限制会返回结构化配额错误。Launcher/Runner 都不接受命令、路径、URL、网络、镜像或环境注入字段。失败只返回结构化错误，不使用备用执行器、provider fallback 或无关实验替代。

这是隔离基础设施的部分实现：每 Run 独立容器、八个白名单模板（包括固定 `experiment/main.py` 主题入口和镜像内固定 micromamba/Conda Python 环境）、硬上限 tmpfs 输出 volume，以及受控 GPU 请求已经由 launcher 提供；真实 GPU 主机验证仍由 `P0-RUNNER-007` 跟踪。主题入口必须读取固定环境路径中的结构化计划，可选读取恢复状态，并在输出目录写入 `metrics.json` 与 `checkpoint.json`；缺少入口、进程失败或产物不合法都会直接生成结构化错误，不会运行无关的分类或点云实验。

每个 Runner 任务还会在 MLflow 活跃 Run 内按固定间隔记录进程/系统 CPU、内存和固定 `nvidia-smi` 查询得到的 GPU 数值，并在受控输出目录保存 `resource-usage.jsonl`。运行参数显式记录 `learning_rate`、`model_version`、Git commit、Research OS commit、镜像 digest、数据版本、随机种子和策略快照；Secret、任意环境变量和 GPU 命令输出不会进入记录。无 GPU 时记录 `gpu_available=0`，不会改用其他 Runner 路径。

## n8n 自动登录

n8n 当前版本已不支持旧的 `N8N_BASIC_AUTH_*` 和 `N8N_USER_MANAGEMENT_DISABLED`。本项目保留一个内部本地 Owner：API 调用官方 Login/Owner Setup，转发 n8n 签发的 HttpOnly Cookie，不伪造 JWT，也不把密码写进浏览器页面或聊天。

若 `.env` Owner 凭据与数据库不一致，先备份再重置：

```powershell
docker compose exec -T postgres pg_dump -U research -d research_os --schema=n8n --file=/tmp/n8n-backup.sql
docker compose cp postgres:/tmp/n8n-backup.sql artifacts/n8n-backup.sql
docker compose exec -T n8n n8n user-management:reset
docker compose restart n8n api
```

再次打开 `/api/n8n/open` 会初始化 `.env` 中的 Owner。该模式只适用于 `127.0.0.1` 个人实例；服务器或多人部署必须关闭自动登录入口并使用正常账户、SSO 或反向代理认证。

当前 Compose 固定 n8n `1.121.0`，并设置 `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`、`N8N_GIT_NODE_DISABLE_BARE_REPOS=true`。三个内置工作流通过 Compose 私有 DNS 的固定 `http://api:8080` 地址调用 Research API，因此不需要向节点开放环境变量。如果以后修改内部服务名，应同时修改 `n8n/workflows/*.json`，然后重建 n8n 以重新导入并激活工作流。

## 常见排障

- 项目未进入 `awaiting_experiment_approval`：查看项目 `tasks`、`/api/projects/{id}/audit` 和 n8n 日志。
- n8n webhook 404：确认三个工作流为 Active，且数据库存在 `research-os/start` 与 `research-os/chat` 路径。
- 报告推送：日报/周报默认只保存到 Web UI。若需要外部推送，设置 `REPORT_NOTIFICATIONS_ENABLED=true`、无内嵌凭据的 HTTPS `REPORT_WEBHOOK_URL`，可选设置 `REPORT_WEBHOOK_SECRET`，再向 `/api/reports` 显式发送 `{ "project_id": "<uuid>", "period": "daily", "notify": true }`。禁用、URL 无效、超时或非 2xx 都返回结构化错误，不尝试备用通道；API 容器负责请求，Windows 不启动通知服务。
- 文献部分失败：`/api/search` 会返回 `provider_errors`，其他提供方继续落库；外部 API 限流不应伪造结果。
- Runner 状态不同步：调用 `/api/experiments/{run_id}/sync`。Runner 状态保存在 `artifacts/.runner-state`；重启时未完成任务会标记为中断失败。
- Runner 在快照门禁被拒：检查结构化错误 `project_worktree_dirty`、`git_policy_violation`、`project_source_missing`、`snapshot_manifest_missing` 或 `runner_image_changed`；提交项目源代码/配置、移除被禁止的大文件，并保持项目 Git 工作树干净后重试。
- 产物下载 404：检查 `valid` 和文件是否仍在 `artifacts/`。Idea 变更会使受影响结果失效。
- 模型调用失败：检查三个模型 URL/key、`RESEARCH_LLM_PROVIDER=openai`、`runtime/model-settings.json` 的挂载权限和 `docker compose logs api`。API 会返回结构化模型错误，不会切换 provider 或生成本地回复。

## 项目状态控制

Web UI 概览页提供暂停、恢复和取消。暂停会立即阻止新的检索、创新性评估、实验/编译计划和 Runner 提交，并尝试取消 queued/running 实验与任务；响应中的 `runner_outcomes` 和 `cancellation_errors` 用于判断 Runner 是否真正停止。恢复只允许 paused 项目，并使用 `project_paused` 检查点恢复稳定阶段。cancelled 项目不能恢复。

API 示例：

```powershell
Invoke-RestMethod -Method Post -ContentType application/json -Body '{"action":"pause","reason":"maintenance"}' http://127.0.0.1:8080/api/projects/<project_id>/state
Invoke-RestMethod -Method Post -ContentType application/json -Body '{"action":"resume","reason":"maintenance completed"}' http://127.0.0.1:8080/api/projects/<project_id>/state
```

项目状态变更与 Runner 取消结果都会写入 `audit_events` 和 `checkpoints`。若 `cancellation_errors` 非空，先恢复 Runner 连通性，再次调用暂停/取消以重试仍处于活动状态的 run。

## 数值诊断

在实验页点击“数值诊断”，或调用 `POST /api/projects/<project_id>/diagnostics`。API 只读取已持久化的实验指标和错误，使用 Python 确定性计算均值、总体标准差、范围，并列出结构化失败码与缺失 `metrics.json` 的成功运行。异常会生成去重的 `diagnostic_suggestion` Proposal；它只包含证据运行 ID，批准前不会执行任何后续实验或配置变更。模型只允许解释和质疑诊断结果，不能计算数值或直接执行建议。

## 检查点局部重跑

实验同步为 `succeeded` 或 `failed` 后，网页实验行会在存在对应检查点时显示“提出局部重跑”。已批准的 Idea、策略、代码、数据或依赖变更也会依据 `ArtifactDependency` 影响图自动创建对应的待审批 Proposal。该按钮和自动生成的 Proposal 都只接受成功/失败检查点、已终止源实验、原白名单配置和已持久化随机种子。通用 Proposal 接口不能伪造 `experiment_rerun`，审批和提交阶段还会再次比较检查点快照。未知变更类型、缺少基准 Git/数据版本或删除当前项目之外的产物会在影响分析阶段直接返回结构化 `impact_*` 错误。批准后 API 自动使用现有 `/api/experiments` 提交链；提交失败会把结构化错误写入 Proposal 影响和审计记录，前端不提供第二个执行入口，也不会替换成与当前 Idea 无关的分类或点云实验。

## 代码/配置/LaTeX patch

调用 `POST /api/projects/<project_id>/patch-proposals` 创建 patch Proposal。请求必须绑定当前项目的完整 Git commit，并逐个声明固定目录内的 `create`、`replace` 或 `delete` 文件操作；替换和删除必须提供文件 SHA-256。代码只能写入 `experiment/`/`src/`，配置只能写入 `configs/`，LaTeX 只能写入 `paper/`。API 先生成可审阅 diff，批准时在临时隔离目录运行固定 Python、JSON、TOML 和 LaTeX 结构校验，再二次核对 HEAD/hash 并提交 Git。冲突、脏工作树、验证失败或 commit 失败都会返回结构化错误并恢复原文件。已提交 patch 的回滚必须调用 `POST /api/proposals/<proposal_id>/rollback` 创建新的待审批 Proposal；对外发布 Proposal 审批会明确返回 `external_publish_disabled`。

## 修改配置

1. 修改 `.env` 或版本化 Schema/工作流。
2. 执行 Compose、Python、JSON 和测试校验。
3. 仅修改 `.env`、挂载目录或工作流时运行 `docker compose up -d`；修改镜像输入时运行 `docker compose up -d --build api runner runner-launcher mlflow`，再检查服务日志和健康端点。
4. 高成本实验、依赖安装、覆盖/删除、发布和代码变更必须通过 Proposal 审批。

推荐校验：

```powershell
docker compose config --quiet
python scripts/check_idea_case_sources.py
python scripts/check_docs_sync.py
python -m py_compile apps/api/app/main.py apps/runner/app/main.py scripts/acceptance_test.py
node --test scripts/test_chat_ux.mjs
docker compose exec -T api pytest -q
python scripts/acceptance_test.py
```

完整验收会调用真实模型、外部学术 API 和 Runner；按本次任务明确的 case、轮数和成本范围运行，未纳入范围的公开用例不得发送给模型。`py_compile` 在部分 Windows 工作区可能因历史容器生成的 root-owned `__pycache__` 失败，此时应在 API/Runner 容器内执行语法检查，并把权限原因记录到 TODO。

## 数据恢复

- 项目代码与 Idea：`projects/<slug>/.git`。
- 业务/n8n/MLflow 元数据：PostgreSQL volume 或 `pg_dump`。
- MLflow 大文件：MinIO volume；Runner 文件：`artifacts/`。
- 恢复后启动服务，先执行容器静态检查和证据/项目状态核验；当前不会自动运行与用户 Idea 无关的合成实验。主题专属计划会先根据当前 ProjectSpec、页码级证据和策略生成 pending Proposal，必须明确批准；批准后的执行还会再次校验 Idea/证据/策略，当前 Runner 尚无主题模板时直接返回结构化错误，不会替换为无关演示实验。

数据库备份可能包含密码哈希或凭据密文，模型请求日志和 `.env` 也属于敏感本地文件，不应提交或外发。

## 备份与恢复演练

至少同时保护四类数据：PostgreSQL 业务/n8n/MLflow 元数据、`projects/` Git 工作区、`artifacts/` Runner 文件，以及 MinIO/n8n 命名 volume。只备份其中一类不能完整恢复谱系。

创建本地备份目录并导出数据库：

```powershell
New-Item -ItemType Directory -Force artifacts\backups | Out-Null
docker compose exec -T postgres pg_dump -U research -d research_os > artifacts\backups\research_os.sql
```

停机后备份命名 volume（Compose 项目名固定为 `research-os`）：

```powershell
docker compose stop
docker run --rm -v research-os_postgres-data:/source:ro -v "${PWD}\artifacts\backups:/backup" alpine tar -czf /backup/postgres-data.tgz -C /source .
docker run --rm -v research-os_minio-data:/source:ro -v "${PWD}\artifacts\backups:/backup" alpine tar -czf /backup/minio-data.tgz -C /source .
docker run --rm -v research-os_n8n-data:/source:ro -v "${PWD}\artifacts\backups:/backup" alpine tar -czf /backup/n8n-data.tgz -C /source .
docker compose start
```

同时使用受控备份工具复制 `projects/` 和 `artifacts/`；不要把备份加入 Git。恢复应先在新建的空白测试实例中演练：核对 `.env`、恢复 PostgreSQL/volume/文件、启动服务，再验证一个项目的 Idea 版本、审批、MLflow Run、PNG/PLY 下载和 Git commit。未经目标路径和 volume 名称复核，不要向现有 volume 原位解压覆盖。

建议周期：活跃开发期间每日数据库和 `projects/` 增量备份，每周完整 volume 备份；重大升级、Owner 重置和数据库结构变化前额外做一次完整快照。MVP 尚未自动实现备份轮换和恢复演练，这是 `P2-HA-021` 的范围。

## 升级与回滚

1. 阅读 `TODO.md`、需求审计和镜像变更说明，确认是否涉及数据库或 n8n 凭据格式。
2. 完成上述全量备份并记录当前 `docker compose images`、`.env` 配置版本和最新验收 JSON。
3. 修改固定镜像版本、依赖或工作流后，运行 Compose/Python/JSON/文档同步检查。
4. 使用 `docker compose up --build -d` 重建；检查日志后运行容器测试与低成本验收。
5. 回滚时恢复旧代码/镜像和匹配的数据库/volume 快照。不要只回滚容器镜像而继续使用已迁移的数据。

## 文档同步交接

重大更新必须同步英文 `README.md`、中文 `README.zh-CN.md`、`.env.example`、相关 `docs/`、`TODO.md`，并在原始需求覆盖变化时更新需求审计。两份 README 顶部的 `DOCS_SYNC_VERSION` 和 `ACCEPTANCE_PROJECT` 必须一致。

```powershell
python scripts/check_docs_sync.py
```

界面或可视化变化时，使用真实项目重新生成 `docs/assets/` 截图，确认无 Secret、非空、无元素重叠且浏览器控制台无错误。合成实验截图只能表述为系统链路证据，不能充当科学结果。

## 验收证据

`docker compose exec -T api pytest -q` 覆盖主题专属计划的严格结构、全文证据引用、Idea/策略/预算校验和无关 demo 拒绝；复杂路由使用配置的 `gpt-5.6-sol/high`。它不会运行真实模型、其他 Idea 或与当前 Idea 无关的基线实验；测试结果不记录认证 token。当前 Runner 尚无主题专属执行模板，不能把批准计划表述为已执行实验或科学结论。
