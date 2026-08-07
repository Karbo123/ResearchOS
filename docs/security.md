# Security

## Trust Model

Research OS is a single-user local MVP. It listens only on loopback inside WSL2 and assumes the WSL2 Linux account (with Windows account access to the host filesystem) controls access. It is not a multi-tenant service and does not claim virtual-machine isolation.

## Model Boundary

Agents receive validated, bounded business objects. They do not receive process, SQL, arbitrary path, credential, or unrestricted network tools. Research OS uses the OpenAI Responses provider with operation-free base URL validation; structured calls use strict JSON Schema and do not fall back to legacy JSON mode. Model output is never interpreted as a command. Model failure returns a structured error and no assistant message is persisted.

Luna, Terra, and Sol credentials are independent. Public settings expose only `key_configured`. Runtime code does not read Codex configuration or authentication files. Logs, audits, workflow inputs, and reports must not contain model keys.

## Experiment Boundary

Only approved, allowlisted experiment types run. Project paths are derived from semantic slugs and validated beneath `projects/`; project artifact paths resolve beneath `projects/<project-id>/artifacts/`. The root `artifacts/` directory is reserved for shared backups, acceptance/test/operations material, and legacy migration sources. Python runs use a per-project `.venv`. Children receive a minimal environment without application credentials.

The supervisor provides fixed launch arguments, timeout, process-tree termination, bounded logs, required structured outputs, SHA-256 registration, and audit records. Untrusted high-risk code requires a separately managed virtual machine because native process controls cannot guarantee kernel isolation or resource hard limits.

## Lineage and Recovery Gates

Experiment outputs are bound to the Idea version, Git commit, configuration fingerprint, source records, Artifact hashes, and Checkpoint. Fingerprint reconciliation and approved revisions recursively invalidate dependent material and record an audit event. Recovery checks project ownership, source-run success, current Idea and Git baselines, Artifact validity, path containment, symlink rejection, file existence, and SHA-256 equality before creating an `experiment_rerun` Proposal. Approval is required before queueing; invalidated or changed dependencies fail closed and cannot be treated as successful output.

Reports have an additional read-time lineage gate. Each new report stores its project ID and source IDs in `source_snapshot`; the API rechecks ownership and source validity before returning it. Missing snapshots are visibly marked `legacy_unverified`, while scope mismatches, cross-project IDs, missing rows, and invalid Artifacts become `blocked` and their Markdown is withheld. A report is not an authority that can preserve deleted experiment results or bypass evidence and approval gates.

## Uploads and Evidence

Uploads are size- and extension-limited. Uploaded material remains untrusted context and is not executed; no Windows Defender scan is enforced.

Memory v2 knowledge documents are also untrusted input. The registry accepts only Markdown below the current project's `research/` directory, validates strict YAML front matter and semantic kind/path pairs, rejects traversal and symlink paths, verifies the immutable project slug, and fails the entire reconciliation on duplicate IDs or malformed documents. PGlite stores hashes, source metadata, status, and dependency/index bookkeeping rather than a second full-text copy. A future index adapter must use the local active-generation allowlist; a stale or failed remote index must never be allowed to leak old content into a model context.

PDF evidence is downloaded only from a fixed HTTPS host allowlist, limited to 25 MB, checked for a PDF signature, hashed, parsed without evaluation, and stored with page locators. Extracted passages are candidates for claim-level review, not automatic proof.

Claim Review endpoints accept only evidence IDs owned by the current project, allow exactly one terminal decision, preserve the `page_quote_requires_claim_review` status, and write creation/decision audit events. Acceptance records human review of the selected quote; it does not establish a scientific conclusion.

Reproduction output is also untrusted integration evidence. It remains bound to the paper, fixed commit, data/configuration/seed, raw metrics, and Artifact hashes; only deterministic TypeScript comparison may calculate differences. Agent-generated novelty or research-gap language remains a candidate until the user reviews the source-bound comparison, and no model output can promote it to a conclusion or write it into a paper without the applicable gate.

## Files and Secrets

`.env`, `runtime/`, local databases, backup archives, model keys, cookies, and authentication material are ignored and must never be committed. Project patches cannot target `.git`, `.env`, credentials, or paths outside the project. Approved patches bind a Git commit and content hash; conflicts fail before commit and modified files are restored.

Project workflow source is trusted only after the normal approval chain. The workflow edit Agent emits a diff, the API applies it in a temporary workspace, previews it through the native v2 loader, and only an approved `code_patch` writes `workflow.ts` and commits it in the project Git. The loader rejects filesystem, process, network, dynamic import, eval, URL, and credential patterns and allows only `@research-os/workflow-kit` and `zod` imports. Approved workflow code is a declarative definition executed by the native server capability registry, so it is treated as trusted local project code; a dedicated sandbox remains future work and must not be presented as VM isolation.

## Repository Acquisition

Repository candidates accept only GitHub or GitLab HTTPS URLs without credentials, query strings, fragments, or custom ports. Verification must record a paper DOI or exact title match in repository citation files, a known SPDX license, and a 40-character commit. Download is blocked until the candidate is verified and a human approves the `repository_download` Proposal.

Archives are fetched only from the approved provider hosts, bounded by byte, entry, and uncompressed-size limits, and extracted with traversal, absolute-path, symbolic-link, and hard-link rejection. The original archive is SHA-256 hashed and stored as a controlled source Artifact; the extracted path is constrained beneath `projects/<id>/experiment/reproductions/<reproduction-id>/source`, outside the method Git workspace. Dependency installation, execution, and result registration require separate `repository_dependency_install`, `repository_reproduction_run`, and `repository_artifact_write` approvals. Dependency files reject indexes, URLs, VCS, and local path installation; run requests reject shell, cwd, arbitrary paths, executables, and network fields. No model output supplies a URL, path, commit, or Git command.

## Network

Only fixed academic providers, approved repository providers, configured model endpoints, and local loopback services are valid network destinations. External requests use timeouts and a project User-Agent. Do not bind API or Studio to a LAN or public interface.

## Supermemory Boundary

Supermemory is a remote, optional semantic-memory processor. The API sends only bounded, project-scoped content and metadata; the local Artifact remains the source of the original PDF/image bytes and SHA-256. Every request includes the deterministic project container tag and the local `memory_links` ledger records source IDs, Artifact IDs, hashes, evidence status, remote IDs, and failure state.

Uploaded PDF/text indexing performs bounded extraction and overlapping chunks; each chunk carries the uploaded-file ID, source SHA-256, chunk hash, page or text locator, and untrusted-material evidence status. Images and PDFs without extractable text remain controlled file uploads. The material search API uses the same project-scoped remote search boundary and does not expose a local semantic substitute.

The browser receives only `key_configured`, never the key or unrestricted remote URLs. Search and Graph responses are labeled semantic candidates and cannot be promoted to evidence or experiment conclusions. Missing configuration, timeout, authentication failure, invalid response, or remote mutation failure is a direct structured error. There is no local semantic fallback, provider switch, or silent SQL copy of the failed content. Forget/delete is an external side effect and requires a project Proposal approval.

## Dependency Risk

Mastra `@mastra/core@1.55.0` currently pins `@ai-sdk/provider-utils@3.0.30`, for which the production audit reports an upstream advisory and no newer compatible 3.x release is published. The application does not force an unsupported transitive override. Model input is bounded, requests have a fixed timeout, retries are disabled, and concurrency is constrained while the upstream packages are monitored for a compatible patch.
