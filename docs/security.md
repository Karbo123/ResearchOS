# Security

## Trust Model

Research OS is a single-user local MVP. It listens only on loopback inside WSL2 and assumes the WSL2 Linux account (with Windows account access to the host filesystem) controls access. It is not a multi-tenant service and does not claim virtual-machine isolation.

## Model Boundary

Agents receive validated, bounded business objects. They do not receive process, SQL, arbitrary path, credential, or unrestricted network tools. Model output is never interpreted as a command. Model failure returns a structured error and no assistant message is persisted.

Luna, Terra, and Sol credentials are independent. Public settings expose only `key_configured`. Runtime code does not read Codex configuration or authentication files. Logs, audits, workflow inputs, and reports must not contain model keys.

## Experiment Boundary

Only approved, allowlisted experiment types run. Project paths are derived from UUIDs and validated beneath `projects/`; artifact paths remain beneath `artifacts/`. Python runs use a per-project `.venv`. Children receive a minimal environment without application credentials.

The supervisor provides fixed launch arguments, timeout, process-tree termination, bounded logs, required structured outputs, SHA-256 registration, and audit records. Untrusted high-risk code requires a separately managed virtual machine because native process controls cannot guarantee kernel isolation or resource hard limits.

## Lineage and Recovery Gates

Experiment outputs are bound to the Idea version, Git commit, configuration fingerprint, source records, Artifact hashes, and Checkpoint. Fingerprint reconciliation and approved revisions recursively invalidate dependent material and record an audit event. Recovery checks project ownership, source-run success, current Idea and Git baselines, Artifact validity, path containment, symlink rejection, file existence, and SHA-256 equality before creating an `experiment_rerun` Proposal. Approval is required before queueing; invalidated or changed dependencies fail closed and cannot be treated as successful output.

## Uploads and Evidence

Uploads are size- and extension-limited and scanned with Windows Defender. On WSL2/Linux hosts the scanner is reached through the interop mount (`/mnt/c/ProgramData/.../MpCmdRun.exe`) with `wslpath -w` path conversion. Scanner absence, threat detection, timeout, or scan failure rejects the upload (fail closed). Uploaded material remains untrusted context and is not executed.

PDF evidence is downloaded only from a fixed HTTPS host allowlist, limited to 25 MB, checked for a PDF signature, hashed, parsed without evaluation, and stored with page locators. Extracted passages are candidates for claim-level review, not automatic proof.

Claim Review endpoints accept only evidence IDs owned by the current project, allow exactly one terminal decision, preserve the `page_quote_requires_claim_review` status, and write creation/decision audit events. Acceptance records human review of the selected quote; it does not establish a scientific conclusion.

## Files and Secrets

`.env`, `runtime/`, local databases, backup archives, model keys, cookies, and authentication material are ignored and must never be committed. Project patches cannot target `.git`, `.env`, credentials, or paths outside the project. Approved patches bind a Git commit and content hash; conflicts fail before commit and modified files are restored.

## Repository Acquisition

Repository candidates accept only GitHub or GitLab HTTPS URLs without credentials, query strings, fragments, or custom ports. Verification must record a paper DOI or exact title match in repository citation files, a known SPDX license, and a 40-character commit. Download is blocked until the candidate is verified and a human approves the `dependency_install` Proposal.

Archives are fetched only from the approved provider hosts, bounded by byte, entry, and uncompressed-size limits, and extracted with traversal, absolute-path, symbolic-link, and hard-link rejection. The original archive is SHA-256 hashed and stored as a controlled Artifact; the extracted path is constrained beneath the project Git workspace. No model output supplies a URL, path, commit, or Git command.

## Network

Only fixed academic providers, approved repository providers, configured model endpoints, and local loopback services are valid network destinations. External requests use timeouts and a project User-Agent. Do not bind API or Studio to a LAN or public interface.

## Supermemory Boundary

Supermemory is a remote, optional semantic-memory processor. The API sends only bounded, project-scoped content and metadata; the local Artifact remains the source of the original PDF/image bytes and SHA-256. Every request includes the deterministic project container tag and the local `memory_links` ledger records source IDs, Artifact IDs, hashes, evidence status, remote IDs, and failure state.

Uploaded PDF/text indexing performs bounded extraction and overlapping chunks; each chunk carries the uploaded-file ID, source SHA-256, chunk hash, page or text locator, and untrusted-material evidence status. Images and PDFs without extractable text remain controlled file uploads. The material search API uses the same project-scoped remote search boundary and does not expose a local semantic substitute.

The browser receives only `key_configured`, never the key or unrestricted remote URLs. Search and Graph responses are labeled semantic candidates and cannot be promoted to evidence or experiment conclusions. Missing configuration, timeout, authentication failure, invalid response, or remote mutation failure is a direct structured error. There is no local semantic fallback, provider switch, or silent SQL copy of the failed content. Forget/delete is an external side effect and requires a project Proposal approval.

## Dependency Risk

Mastra `@mastra/core@1.55.0` currently pins `@ai-sdk/provider-utils@3.0.30`, for which the production audit reports an upstream advisory and no newer compatible 3.x release is published. The application does not force an unsupported transitive override. Model input is bounded, requests have a fixed timeout, retries are disabled, and concurrency is constrained while the upstream packages are monitored for a compatible patch.
