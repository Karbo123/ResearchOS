# 运维与交接说明

## 首次部署检查

1. 从 `.env.example` 复制 `.env`，为 PostgreSQL、MinIO、n8n、Runner 和 Codex Bridge 分别生成不同的随机 Secret；不得保留示例占位值。若宿主 Codex CLI 需要环境认证，只将 `auth.json` 中的 `OPENAI_API_KEY` 值迁移到 `.env`，不要复制整个认证文件。
2. Docker Desktop 必须运行 Linux containers（`desktop-linux` engine）。这只是 Docker Desktop 的 Linux 容器后端，不要求另装 Linux 操作系统。
3. 在 Windows 宿主机启动 `scripts/codex_llm_bridge.py`。Bridge 只从仓库根目录未跟踪的 `.env` 读取允许的 Bridge/provider/模型配置和 `OPENAI_API_KEY`；运行时代码不读取宿主机 Codex 配置目录或 `auth.json`，也不把整个认证文件、token 或 Cookie 复制到 `.env` 或挂载进 Docker。
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

## 自适应模型路由

默认层级为 `gpt-5.6-luna`/low、`gpt-5.6-terra`/medium、`gpt-5.6-sol`/high。分别通过 `RESEARCH_MODEL_SIMPLE`、`RESEARCH_MODEL_MEDIUM`、`RESEARCH_MODEL_COMPLEX` 和对应 `RESEARCH_REASONING_*` 配置。`RESEARCH_ROUTER_SIMPLE_MAX=2`、`RESEARCH_ROUTER_MEDIUM_MAX=7` 是 API 侧确定性复杂度评分边界；中等上限必须大于简单上限。

修改模型配置后必须同时重启宿主 Bridge 和 API：

```powershell
# 先在 Bridge 窗口停止旧进程，再重新运行
python scripts/codex_llm_bridge.py
docker compose up -d api
Invoke-RestMethod http://127.0.0.1:8092/health
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

成功聊天响应中的 `model_tier`、`model`、`reasoning_effort` 是本轮实际路由证据。模型调用失败时 `/api/chat` 返回结构化 `502/503/504` 错误，不生成规则回复，也不写入助手消息；检查错误中的 `code` 和 Bridge/API 日志后再重试。

## Windows 单 EXE 安装器

`installer/windows/ResearchOS.iss`、`bootstrap.ps1` 与 `build-installer.ps1` 构成在线引导安装器源。它内置应用、Compose/n8n 工作流和由 PyInstaller 打包的 Bridge；Docker 缺失时只在用户勾选后下载官方安装器并验证 Authenticode 签名。构建输出和 EXE 被 Git 忽略。

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
docker compose up -d --build api runner mlflow
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
- 文献部分失败：`/api/search` 会返回 `provider_errors`，其他提供方继续落库；外部 API 限流不应伪造结果。
- Runner 状态不同步：调用 `/api/experiments/{run_id}/sync`。Runner 状态保存在 `artifacts/.runner-state`；重启时未完成任务会标记为中断失败。
- Runner 在快照门禁被拒：检查结构化错误 `project_worktree_dirty`、`git_policy_violation`、`project_source_missing`、`snapshot_manifest_missing` 或 `runner_image_changed`；提交项目源代码/配置、移除被禁止的大文件，并保持项目 Git 工作树干净后重试。
- 产物下载 404：检查 `valid` 和文件是否仍在 `artifacts/`。Idea 变更会使受影响结果失效。
- Codex Bridge 不通：检查 8092 健康端点、`RESEARCH_LLM_PROVIDER`、Bridge Secret、三级模型白名单、`.env` 中的 `CODEX_MODEL_*`/`CODEX_CUSTOM_*` 配置、`OPENAI_API_KEY` 是否已按需迁移和 Codex CLI；API 会返回结构化模型错误，不会切换 provider 或生成本地回复。

## 项目状态控制

Web UI 概览页提供暂停、恢复和取消。暂停会立即阻止新的检索、创新性评估、实验/编译计划和 Runner 提交，并尝试取消 queued/running 实验与任务；响应中的 `runner_outcomes` 和 `cancellation_errors` 用于判断 Runner 是否真正停止。恢复只允许 paused 项目，并使用 `project_paused` 检查点恢复稳定阶段。cancelled 项目不能恢复。

API 示例：

```powershell
Invoke-RestMethod -Method Post -ContentType application/json -Body '{"action":"pause","reason":"maintenance"}' http://127.0.0.1:8080/api/projects/<project_id>/state
Invoke-RestMethod -Method Post -ContentType application/json -Body '{"action":"resume","reason":"maintenance completed"}' http://127.0.0.1:8080/api/projects/<project_id>/state
```

项目状态变更与 Runner 取消结果都会写入 `audit_events` 和 `checkpoints`。若 `cancellation_errors` 非空，先恢复 Runner 连通性，再次调用暂停/取消以重试仍处于活动状态的 run。

## 修改配置

1. 修改 `.env` 或版本化 Schema/工作流。
2. 执行 Compose、Python、JSON 和测试校验。
3. 仅修改 `.env`、挂载目录或工作流时运行 `docker compose up -d`；修改镜像输入时运行 `docker compose up -d --build api runner mlflow`，再检查服务日志和健康端点。
4. 高成本实验、依赖安装、覆盖/删除、发布和代码变更必须通过 Proposal 审批。

推荐校验：

```powershell
docker compose config --quiet
python scripts/check_idea_case_sources.py
python scripts/check_docs_sync.py
python -m py_compile apps/api/app/main.py apps/runner/app/main.py scripts/codex_llm_bridge.py
node --test scripts/test_chat_ux.mjs
docker compose exec -T api pytest -q
python scripts/acceptance_test.py
```

完整验收会调用真实模型、外部学术 API 和 Runner；按本次任务明确的 case、轮数和成本范围运行，未纳入范围的公开用例不得发送给模型。`py_compile` 在部分 Windows 工作区可能因历史容器生成的 root-owned `__pycache__` 失败，此时应在 API/Runner 容器内执行语法检查，并把权限原因记录到 TODO。

## 数据恢复

- 项目代码与 Idea：`projects/<slug>/.git`。
- 业务/n8n/MLflow 元数据：PostgreSQL volume 或 `pg_dump`。
- MLflow 大文件：MinIO volume；Runner 文件：`artifacts/`。
- 恢复后启动服务，并执行低成本 `demo_classification` 与一次 LaTeX 编译验证。

数据库备份可能包含密码哈希或凭据密文，Bridge 日志和 `.env` 也属于敏感本地文件，不应提交或外发。

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

`python scripts/acceptance_test.py` 使用真实 Codex Bridge 和配置的 Luna/Terra/Sol 路由（复杂路由为 `gpt-5.6-sol/high`），运行时间受模型和外部 API 延迟影响。JSON 结果只记录项目 ID、指标、产物类型、PDF 哈希、MLflow Run ID 和依赖计数，不记录认证 token。最近一次完整结果位于 `artifacts/acceptance/acceptance-20260730-015132.json`，脱敏副本位于 `docs/evidence/acceptance-20260730-015132.json`，包含 3 篇开放 PDF 页码证据、5 种子策略计划、结构化违规拒绝、Runner 二次校验、12 个检查点和 416 条依赖；该结果已包含可复现快照门禁的实时验收。当前仍不能把本地 MVP 验收表述为生产级科研结论或完整自动化能力。
