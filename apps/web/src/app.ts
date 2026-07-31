import { createIcons, icons } from 'lucide'

const chatUX: any = (window as any).ResearchChatUX;
const CHAT_REQUEST_TIMEOUT_MS = 300000;
const chatGate = chatUX.createBusyGate();
const projectChatGate = chatUX.createBusyGate();
const state: any = { sessionId: null, projectId: null, project: null, searchCandidates: [], queuedFiles: [], activeTab: "overview", chatBusy: false, projectChatBusy: false, clarificationMode: "automatic", settingsDirty: false };
const $ = (id: string): any => document.getElementById(id);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(path, options: any = {}) {
  const {timeoutMs = CHAT_REQUEST_TIMEOUT_MS, headers: optionHeaders, ...fetchOptions} = options;
  const response = await chatUX.fetchWithTimeout(window.fetch.bind(window), path, {
    ...fetchOptions,
    headers: {"Content-Type": "application/json", ...(optionHeaders || {})},
  }, timeoutMs);
  if (!response.ok) { const body = await response.json().catch(() => ({})); const detail=body.detail; const message=body.message || (detail && typeof detail === "object" ? detail.message : detail); throw new Error(typeof message === "string" ? message : `${response.status} ${response.statusText}`); }
  return response.json();
}
function toast(message) { const el = $("toast"); el.textContent = message; el.classList.remove("hidden"); setTimeout(() => el.classList.add("hidden"), 3200); }
const MODEL_TIERS = [
  ["simple", "Luna", "low"],
  ["medium", "Terra", "medium"],
  ["complex", "Sol", "high"],
];
function renderModelSettings(tiers) {
  $("modelSettingsTiers").innerHTML = MODEL_TIERS.map(([tier, label, defaultEffort]) => {
    const item = tiers[tier] || {};
    const source = item.sources || {};
    const keyState = item.key_configured ? "已配置 key" : "待配置 key";
    const urlState = item.url ? "URL 已就绪" : "待配置 URL";
    const sourceLabel = value => value === "runtime_override" ? "运行时覆盖" : "项目 .env 默认";
    return `<section class="model-tier"><div class="model-tier-heading"><div><h3>${label}<span class="badge neutral">${tier}</span></h3><div class="tier-status"><span class="status-dot ${item.key_configured && item.url ? "ready" : "pending"}"></span>${keyState} · ${urlState}</div><div class="tier-sources"><span>URL：${sourceLabel(source.url)}</span><span>key：${sourceLabel(source.key)}</span></div></div><span class="tier-default">默认 ${defaultEffort}</span></div><div class="model-tier-grid">
      <label>模型名称<input name="${tier}.model" value="${escapeHtml(item.model || "")}" required maxlength="200"></label>
      <label>推理强度<select name="${tier}.reasoning_effort"><option value="low" ${item.reasoning_effort === "low" ? "selected" : ""}>low</option><option value="medium" ${item.reasoning_effort === "medium" ? "selected" : ""}>medium</option><option value="high" ${item.reasoning_effort === "high" ? "selected" : ""}>high</option></select></label>
      <label>模型 URL<input name="${tier}.url" type="url" value="${escapeHtml(item.url || "")}" placeholder="https://.../v1" required maxlength="500"></label>
      <label>API key<input name="${tier}.key" type="password" value="" placeholder="${item.key_configured ? "已配置，留空保持不变" : "输入 API key"}" autocomplete="new-password" maxlength="1000"></label>
    </div></section>`;
  }).join("");
  iconRefresh();
}
async function openModelSettings() {
  try {
    const result = await api("/api/settings/models");
    renderModelSettings(result.tiers); state.settingsDirty = false;
    $("modelSettingsError").classList.add("hidden");
    $("modelSettingsModal").classList.remove("hidden");
    window.setTimeout(() => $("modelSettingsTiers").querySelector("input")?.focus(), 0);
  } catch (error) { toast(error.message); }
}
function closeModelSettings() {
  if (state.settingsDirty && !window.confirm("配置尚未保存，确定关闭吗？")) return;
  state.settingsDirty = false;
  $("modelSettingsModal").classList.add("hidden"); $("openModelSettings").focus();
}
async function saveModelSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget), payload = {};
  for (const [tier] of MODEL_TIERS) payload[tier] = {
    model: String(form.get(`${tier}.model`) || "").trim(), url: String(form.get(`${tier}.url`) || "").trim(),
    key: String(form.get(`${tier}.key`) || ""), reasoning_effort: String(form.get(`${tier}.reasoning_effort`) || "medium"),
  };
  const saveButton = $("saveModelSettings"), errorBox = $("modelSettingsError");
  saveButton.disabled = true; errorBox.classList.add("hidden");
  try { const result = await api("/api/settings/models", {method:"PUT", body:JSON.stringify(payload)}); renderModelSettings(result.tiers); state.settingsDirty = false; toast("模型配置已保存"); closeModelSettings(); }
  catch (error) { errorBox.textContent = `保存失败：${error.message}。已配置的 key 留空即可保留；模型调用失败不会切换或降级。`; errorBox.classList.remove("hidden"); }
  finally { saveButton.disabled = false; iconRefresh(); }
}
function iconRefresh() { createIcons({ icons }); }
function addMessage(container, role, text, meta = "") {
  const el = document.createElement("div"); el.className = `message ${role}`;
  el.innerHTML = `<div class="avatar">${role === "user" ? "YOU" : "AI"}</div><div class="message-content"><div class="bubble">${escapeHtml(text)}</div>${meta ? `<div class="message-meta">${escapeHtml(meta)}</div>` : ""}</div>`;
  container.appendChild(el); container.scrollTop = container.scrollHeight;
}
function addRequestError(container, text) {
  const el = document.createElement("div");
  el.className = "request-error";
  el.setAttribute("role", "alert");
  el.innerHTML = `<strong>请求失败</strong><span>${escapeHtml(text)}</span>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function syncClarificationMode(reset = false) {
  const toggle = $("clarificationMode");
  if (reset) toggle.checked = true;
  state.clarificationMode = toggle.checked ? "automatic" : "detailed";
  $("clarificationModeLabel").textContent = toggle.checked ? "全自动模式" : "详细模式";
  $("clarificationModeHint").textContent = toggle.checked ? "少量关键追问" : "全面了解需求";
  toggle.setAttribute("aria-label", toggle.checked ? "全自动模式已开启" : "详细模式已开启");
}

function startAiProgress({progressId, formId, elapsedId, stageId, project = false}) {
  const progress = $(progressId), form = $(formId), textarea = form.querySelector("textarea"), button = form.querySelector("button[type='submit'], button.send-btn");
  const stages = project
    ? ["正在识别解释、建议或变更意图…", "正在检查项目状态与审批边界…", "正在组织可审阅的回复…", "模型仍在处理，请稍候…"]
    : ["正在理解研究目标与已有线索…", "正在选择成本合适的模型层级…", "正在更新 ResearchIdea 草稿…", "正在检查风险、假设与待确认事项…", "模型仍在处理，请稍候…"];
  const started = Date.now(); let stageIndex = 0;
  progress.classList.remove("hidden"); textarea.disabled = true; button.disabled = true; form.setAttribute("aria-busy", "true");
  if (!project) $("clarificationMode").disabled = true;
  $(stageId).textContent = stages[0]; $(elapsedId).textContent = "0 秒";
  const timer = window.setInterval(() => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    $(elapsedId).textContent = `${seconds} 秒`;
    const next = Math.min(Math.floor(seconds / 4), stages.length - 1);
    if (next !== stageIndex) { stageIndex = next; $(stageId).textContent = stages[stageIndex]; }
  }, 500);
  return () => { window.clearInterval(timer); progress.classList.add("hidden"); textarea.disabled = false; button.disabled = false; if (!project) $("clarificationMode").disabled = false; form.removeAttribute("aria-busy"); textarea.focus(); };
}

function modelMeta(result) {
  if (!result.model) return "";
  return `${result.model_tier || "adaptive"} · ${result.model} · reasoning ${result.reasoning_effort || "default"}`;
}

function startAiThinking() {
  const pane = $("aiThinkingPane"); pane.classList.remove("hidden");
  const container = $("aiThinkingSessions");

  // collapse all previous sessions
  container.querySelectorAll(".thinking-session").forEach(s => s.classList.add("collapsed"));

  const now = new Date();
  const timeStr = now.toLocaleTimeString("zh-CN", {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  const sessionId = "ts-" + Date.now();

  const session = document.createElement("div");
  session.className = "thinking-session";
  session.id = sessionId;
  session.innerHTML = `
    <div class="thinking-session-header" onclick="toggleThinkingSession('${sessionId}')">
      <span class="toggle-icon" data-lucide="chevron-down" style="width:16px;height:16px"></span>
      <span class="session-model">模型路由</span>
      <span class="session-status running">处理中</span>
      <span class="session-time">${timeStr}</span>
    </div>
    <div class="thinking-session-body">
      <div class="thinking-stages">
        <div class="thinking-stage" data-stage="analyzing_input">
          <span class="stage-icon"></span>
          <div><span class="stage-label">读取对话</span><span class="stage-detail">等待中…</span></div>
        </div>
        <div class="thinking-stage" data-stage="selecting_route">
          <span class="stage-icon"></span>
          <div><span class="stage-label">选择模型</span><span class="stage-detail">等待中…</span></div>
        </div>
        <div class="thinking-stage" data-stage="calling_llm">
          <span class="stage-icon"></span>
          <div><span class="stage-label">调用模型</span><span class="stage-detail">等待中…</span></div>
        </div>
        <div class="thinking-stage" data-stage="parsing">
          <span class="stage-icon"></span>
          <div><span class="stage-label">保存结果</span><span class="stage-detail">等待中…</span></div>
        </div>
      </div>
    </div>`;
  container.appendChild(session);
  container.scrollTop = container.scrollHeight;

  // set active stages
  setThinkingStageIn(sessionId, "analyzing_input", "active", "读取对话", "等待中…");

  // store current session id
  state.currentThinkingSession = sessionId;

  // try icon refresh
  setTimeout(iconRefresh, 10);

  return sessionId;
}

function toggleThinkingSession(sessionId) {
  const el = document.getElementById(sessionId);
  if (el) el.classList.toggle("collapsed");
}

function getThinkingSession(sessionId) {
  return document.getElementById(sessionId);
}

function setThinkingStageIn(sessionId, stage, state, label = "", detail = "") {
  const session = document.getElementById(sessionId);
  if (!session) return;
  const el = session.querySelector(`.thinking-stage[data-stage="${stage}"]`);
  if (!el) return;
  // never downgrade from done to active
  if (state === "active" && el.classList.contains("done")) return;
  el.className = `thinking-stage ${state}`;
  if (label) el.querySelector(".stage-label").textContent = label;
  const detailEl = el.querySelector(".stage-detail");
  if (detail !== undefined) detailEl.textContent = detail;
}

function updateThinkingSessionHeader(sessionId, modelLabel, statusText, statusClass) {
  const session = document.getElementById(sessionId);
  if (!session) return;
  const header = session.querySelector(".thinking-session-header");
  const modelEl = header.querySelector(".session-model");
  const statusEl = header.querySelector(".session-status");
  if (modelLabel) modelEl.textContent = modelLabel;
  if (statusText) statusEl.textContent = statusText;
  if (statusClass) { statusEl.className = "session-status " + statusClass; }
}

async function sendChat(event) {
  event.preventDefault(); const input = $("chatInput"); const message = input.value.trim(); if (!message || state.chatBusy || !chatGate.tryStart()) return;
  addMessage($("messages"), "user", message); input.value = "";
  state.chatBusy = true;

  const stopProgress = startAiProgress({progressId:"aiProgress", formId:"chatForm", elapsedId:"aiProgressElapsed", stageId:"aiProgressStage"});
  const sessionId = startAiThinking();
  setThinkingStageIn(sessionId, "analyzing_input", "active", "读取对话", `消息长度 ${message.length} 字符`);

  try {
    const clarificationMode = state.clarificationMode;
    if (state.queuedFiles.length) {
      if (!state.sessionId) state.sessionId = crypto.randomUUID();
      setThinkingStageIn(sessionId, "analyzing_input", "active", "上传材料", `${state.queuedFiles.length} 个文件`);
      await uploadQueuedFiles();
    }
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({session_id: state.sessionId, message, attachments: [], clarification_mode: clarificationMode}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = null;
    let streamError = null;

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let currentEvent = "";
      let currentData = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) { currentEvent = line.slice(7); currentData = ""; }
        else if (line.startsWith("data: ")) { currentData = line.slice(6); }
        else if (line === "" && currentEvent) {
          try { const parsed = JSON.parse(currentData); handleSSEEventIn(sessionId, currentEvent, parsed, clarificationMode); if (currentEvent === "result") result = parsed; if (currentEvent === "error") streamError = parsed; } catch(e) {}
          currentEvent = ""; currentData = "";
        }
      }
    }

    if (streamError) throw new Error(streamError.message || "模型请求失败");
    if (result) {
      state.sessionId = result.session_id || state.sessionId;
      const routeMeta = modelMeta(result);
      addMessage($("messages"), "assistant", result.reply, `${clarificationMode === "automatic" ? "全自动模式" : "详细模式"}${routeMeta ? ` · ${routeMeta}` : ""}`);
      if (result.spec) {
        renderSpec(result.spec);
      }
    }
  } catch (error) {
    const message = chatUX.formatRequestError(error);
    addRequestError($("messages"), message); toast(message);
  }
  finally { stopProgress(); chatGate.finish(); state.chatBusy = false; }
}

function handleSSEEventIn(sessionId, event, data, clarificationMode) {
  switch (event) {
    case "model_route":
      const modelLabel = `${data.tier} · ${data.model} · reasoning ${data.reasoning_effort}`;
      updateThinkingSessionHeader(sessionId, modelLabel, "处理中", "running");
      setThinkingStageIn(sessionId, "selecting_route", "done", "选择模型", `${data.tier} → ${data.model}`);
      setThinkingStageIn(sessionId, "analyzing_input", "done");
      setThinkingStageIn(sessionId, "calling_llm", "active", "调用模型", "等待模型响应…");
      break;
    case "progress":
      const stageMap = {
        "preparing_request": {id: "analyzing_input", label: "准备请求"},
        "calling_model": {id: "calling_llm", label: "调用模型"},
        "saving_result": {id: "parsing", label: "保存结果"},
      };
      const s = stageMap[data.stage] || {id: "parsing", label: data.stage};
      setThinkingStageIn(sessionId, s.id, "active", s.label, data.detail || "");
      break;
    case "result":
      setThinkingStageIn(sessionId, "calling_llm", "done");
      setThinkingStageIn(sessionId, "parsing", "done", "保存完成", `${(data.assumptions || []).length} 个已记录假设`);
      updateThinkingSessionHeader(sessionId, null, "已完成", "done");
      break;
    case "error":
      setThinkingStageIn(sessionId, "calling_llm", "done", "请求失败", data.message);
      updateThinkingSessionHeader(sessionId, null, "失败", "done");
      break;
  }
}

function renderSpec(spec) {
  if (!spec) return;
  const idea = spec.idea;
  const list = items => `<ul>${(items || []).map(x => `<li>${escapeHtml(x)}</li>`).join("") || "<li>未指定</li>"}</ul>`;
  $("specContent").innerHTML = `
    <div class="spec-group"><label>Title</label><div>${escapeHtml(idea.title)}</div></div>
    <div class="spec-group"><label>Research question</label><div>${escapeHtml(idea.research_question)}</div></div>
    <div class="spec-group"><label>Domain</label><div>${escapeHtml(idea.domain)}</div></div>
    <div class="spec-group"><label>Hypotheses</label>${list(idea.hypotheses)}</div>
    <div class="spec-group"><label>Contributions</label>${list(idea.expected_contributions)}</div>
    <div class="spec-group"><label>Success criteria</label>${list(idea.success_criteria)}</div>
    <div class="spec-group"><label>Target venues</label>${list(idea.target_venues)}</div>
    <div class="spec-group"><label>Risks</label>${list(idea.risks)}</div>
    <div class="spec-group"><label>Open questions</label>${list(idea.open_questions)}</div>
    <div class="spec-group"><label>Feasibility</label><div>${escapeHtml(spec.feasibility)}</div>${list(spec.feasibility_notes)}</div>
    <div class="spec-group"><label>Candidate modifications</label>${list(spec.candidate_modifications)}</div>
    <div class="spec-group"><label>Approvals</label>${list(spec.required_approvals)}</div>`;
  $("specStatus").textContent = "待确认";
  $("specStatus").className = "badge pending";
  $("confirmProject").classList.remove("hidden");
  // collapse current thinking session but keep history visible
  if (state.currentThinkingSession) toggleThinkingSession(state.currentThinkingSession);
  // scroll right spec pane to top to show the spec
  const pane = $("specContent").closest(".spec-pane") || document.querySelector(".spec-pane");
  if (pane) pane.scrollTop = 0;
}

async function uploadQueuedFiles() {
  const files = [...state.queuedFiles];
  await chatUX.uploadSequentially(files, async file => {
    const form = new FormData(); form.append("session_id", state.sessionId); form.append("file", file);
    const response = await chatUX.fetchWithTimeout(window.fetch.bind(window), "/api/uploads", {method:"POST", body:form}, CHAT_REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = body.detail;
      const reason = detail && typeof detail === "object" ? detail.message : detail;
      throw new Error(`${file.name}: ${reason || `HTTP ${response.status}`}`);
    }
    const completedIndex = state.queuedFiles.indexOf(file);
    if (completedIndex >= 0) state.queuedFiles.splice(completedIndex, 1);
    $("fileQueue").textContent = state.queuedFiles.map(item => item.name).join(" · ");
  });
  toast(`已保存 ${files.length} 个附件`);
}

async function confirmProject() {
  try {
    const result = await api("/api/projects", {method:"POST", body:JSON.stringify({session_id:state.sessionId, confirmed:true})});
    state.projectId = result.project.id; toast("项目已创建"); await loadProjects(); await openProject(state.projectId);
  } catch (error) { toast(error.message); }
}
async function loadProjects() {
  try {
    const projects = await api("/api/projects");
    $("projectList").innerHTML = projects.map(p => `<button data-project="${p.id}" class="${p.id === state.projectId ? "active" : ""}">${escapeHtml(p.title)}</button>`).join("") || `<div class="muted">暂无项目</div>`;
    $("projectList").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => openProject(btn.dataset.project)));
  } catch (error) { toast(error.message); }
}
async function openProject(id) {
  if (state.projectId !== id) state.searchCandidates = [];
  state.projectId = id; state.project = await api(`/api/projects/${id}`);
  $("newView").classList.add("hidden"); $("projectView").classList.remove("hidden");
  $("pageTitle").textContent = state.project.project.title; $("projectMeta").textContent = `${state.project.project.stage} · v${state.project.project.idea_version} · ${id.slice(0,8)}`;
  state.sessionId = state.project.session_id || state.sessionId || null;
  renderProject(); loadProjects();
}
function newProject() {
  state.sessionId = null; state.projectId = null; state.project = null;
  $("projectView").classList.add("hidden"); $("newView").classList.remove("hidden"); $("pageTitle").textContent = "新研究项目"; $("projectMeta").textContent = "Idea clarification";
  $("messages").innerHTML = `<div class="message assistant"><div class="avatar">AI</div><div class="bubble">请直接描述你的研究 Idea。我会自适应分析目标与已有线索，说明推断和风险，只追问真正影响方案的未知信息。</div></div>`;
  syncClarificationMode(true);
  $("specContent").innerHTML = "规格将在澄清完成后生成。"; $("confirmProject").classList.add("hidden"); loadProjects();
}
function statusBadge(status) { const kind = status === "approved" || status === "succeeded" ? "live" : status === "failed" || status === "rejected" ? "failed" : "pending"; return `<span class="badge ${kind}">${escapeHtml(status)}</span>`; }
function artifactPreviewMarkup(artifact) {
  const previewUrl = escapeHtml(artifact.preview_url || "");
  const downloadUrl = escapeHtml(artifact.url || "");
  if (artifact.mime_type.startsWith("image/")) return `<img class="artifact-image" src="${downloadUrl}" alt="${escapeHtml(artifact.name)}">`;
  return `<div class="artifact-preview" data-preview-url="${previewUrl}"><div class="preview-loading">加载预览…</div></div>`;
}
function formatPreviewValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function renderPointCloudPreview(container, preview) {
  const points = Array.isArray(preview.points) ? preview.points : [];
  container.innerHTML = `<div class="point-cloud-tools"><span class="muted">${escapeHtml(preview.format.toUpperCase())} · ${points.length}/${Number(preview.source_point_count || points.length)} 点${preview.sampled ? " · 已降采样" : ""}</span><button class="icon-btn point-reset" type="button" title="重置视图"><i data-lucide="rotate-ccw"></i></button></div><canvas class="point-cloud-canvas" width="640" height="420" aria-label="点云预览"></canvas>${preview.faces?.length ? `<div class="preview-footnote">已加载 ${preview.faces.length} 个面片，使用线框显示。</div>` : ""}`;
  const canvas = container.querySelector("canvas"), context = canvas.getContext("2d");
  const state3d = {yaw: 0.55, pitch: 0.25, zoom: 1, dragging: false, x: 0, y: 0};
  const draw = () => {
    const width = canvas.width, height = canvas.height;
    context.clearRect(0, 0, width, height); context.fillStyle = "#17201d"; context.fillRect(0, 0, width, height);
    if (!points.length) { context.fillStyle = "#aab6b1"; context.font = "14px sans-serif"; context.textAlign = "center"; context.fillText("没有可显示的有效点", width / 2, height / 2); return; }
    const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
    points.forEach(point => point.forEach((value, index) => { mins[index] = Math.min(mins[index], value); maxs[index] = Math.max(maxs[index], value); }));
    const center = mins.map((min, index) => (min + maxs[index]) / 2), scale = Math.max(...maxs.map((max, index) => max - mins[index]), 1);
    const projected = points.map((point, index) => {
      const p = point.map((value, axis) => (value - center[axis]) / scale);
      const cy = Math.cos(state3d.yaw), sy = Math.sin(state3d.yaw), cp = Math.cos(state3d.pitch), sp = Math.sin(state3d.pitch);
      const x = p[0] * cy - p[2] * sy, depth = p[0] * sy + p[2] * cy, y = p[1] * cp - depth * sp, z = p[1] * sp + depth * cp;
      return {x: width / 2 + x * width * .82 * state3d.zoom, y: height / 2 - y * height * .82 * state3d.zoom, z, index};
    }).sort((a, b) => a.z - b.z);
    if (preview.faces?.length && points.length < 2000) {
      context.strokeStyle = "#56b89555"; context.lineWidth = 1;
      preview.faces.forEach(face => { const vertices = face.map(index => projected.find(point => point.index === index)).filter(Boolean); if (vertices.length >= 3) { context.beginPath(); context.moveTo(vertices[0].x, vertices[0].y); vertices.slice(1).forEach(point => context.lineTo(point.x, point.y)); context.closePath(); context.stroke(); } });
    }
    projected.forEach(point => { const alpha = Math.max(.25, Math.min(1, .58 + point.z)); context.fillStyle = `rgba(86,184,149,${alpha})`; context.fillRect(point.x - 1.5, point.y - 1.5, 3, 3); });
  };
  canvas.addEventListener("pointerdown", event => { state3d.dragging = true; state3d.x = event.clientX; state3d.y = event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener("pointermove", event => { if (!state3d.dragging) return; state3d.yaw += (event.clientX - state3d.x) * .01; state3d.pitch = Math.max(-1.4, Math.min(1.4, state3d.pitch + (event.clientY - state3d.y) * .01)); state3d.x = event.clientX; state3d.y = event.clientY; draw(); });
  canvas.addEventListener("pointerup", () => { state3d.dragging = false; });
  canvas.addEventListener("wheel", event => { event.preventDefault(); state3d.zoom = Math.max(.35, Math.min(4, state3d.zoom * (event.deltaY > 0 ? .9 : 1.1))); draw(); }, {passive: false});
  container.querySelector(".point-reset").addEventListener("click", () => { state3d.yaw = .55; state3d.pitch = .25; state3d.zoom = 1; draw(); });
  draw(); iconRefresh();
}
function renderArtifactPreview(container, preview) {
  if (preview.type === "point_cloud") return renderPointCloudPreview(container, preview);
  if (preview.type === "image") { container.innerHTML = `<div class="preview-footnote">图片直接使用下载接口展示。</div>`; return; }
  const value = preview.type === "json" ? formatPreviewValue(preview.value) : preview.text || "";
  const label = preview.type === "pdf" ? `PDF · ${Number(preview.page_count || 0)} 页，仅展示前 3 页可提取文本` : preview.type === "table" ? `${String(preview.format || "table").toUpperCase()} · 最多展示 200 行` : preview.type === "html_text" ? "HTML 原文（未执行脚本）" : "文本预览";
  if (preview.type === "table") {
    const rows = preview.rows || [];
    container.innerHTML = `<div class="preview-label">${escapeHtml(label)}</div><div class="table-preview"><table><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  } else container.innerHTML = `<div class="preview-label">${escapeHtml(label)}${preview.truncated ? " · 已截断" : ""}</div><pre class="preview-text">${escapeHtml(value)}</pre>`;
}
async function hydrateArtifactPreviews() {
  document.querySelectorAll(".artifact-preview[data-preview-url]").forEach(async container => {
    try { const response = await api((container as HTMLElement).dataset.previewUrl); renderArtifactPreview(container, await response); }
    catch (error) { container.innerHTML = `<div class="preview-error">预览失败：${escapeHtml(error.message)}</div>`; }
  });
}
function checkpointForExperiment(experiment, checkpoints) {
  const stage = experiment.status === "succeeded" ? "experiment_succeeded" : experiment.status === "failed" ? "experiment_failed" : null;
  if (!stage) return null;
  return (checkpoints || []).find(item => item.stage === stage && item.state?.run_id === experiment.id) || null;
}
function renderCheckpointActions(projectData, executionDisabled) {
  const rows = $("tab-experiments").querySelectorAll(".data-row");
  projectData.experiments.forEach((experiment, index) => {
    const checkpoint = checkpointForExperiment(experiment, projectData.checkpoints);
    const row = rows[index];
    const actions = row?.querySelector(".button-row");
    if (!checkpoint || !actions || actions.querySelector(`[data-rerun-checkpoint="${checkpoint.id}"]`)) return;
    const button = document.createElement("button");
    button.className = "secondary";
    button.dataset.rerunCheckpoint = checkpoint.id;
    button.disabled = Boolean(executionDisabled);
    button.title = "提出检查点局部重跑 Proposal";
    button.innerHTML = '<i data-lucide="rotate-ccw"></i>提出局部重跑';
    button.addEventListener("click", () => proposeCheckpointRerun(checkpoint.id));
    actions.appendChild(button);
  });
}
function renderRerunProposalActions(projectData, executionDisabled) {
  const rows = $("tab-approvals").querySelectorAll(".data-row");
  projectData.proposals.forEach((proposal, index) => {
    if (proposal.kind !== "experiment_rerun" || proposal.status !== "approved") return;
    const actions = rows[index]?.querySelector(".button-row");
    if (!actions || actions.querySelector(`[data-rerun-proposal="${proposal.id}"]`)) return;
    const execution = proposal.impact?.automatic_execution || {};
    const label = document.createElement("span");
    label.className = "muted";
    label.dataset.rerunProposal = proposal.id;
    label.textContent = execution.status === "failed"
      ? "自动局部重跑失败，请查看审计记录"
      : execution.run_id
        ? `已自动提交局部重跑 ${execution.run_id.slice(0, 8)}`
        : "已批准，正在自动提交局部重跑";
    actions.appendChild(label);
  });
}
function renderRepositoryCandidates(repositories, disabled = false) {
  const old = $("repositoryCandidates"); if (old) old.remove();
  if (!repositories?.length) return;
  const section = document.createElement("section"); section.id = "repositoryCandidates"; section.className = "section";
  const rows = repositories.map(repository => {
    const verification = repository.metadata?.verification || {};
    const download = repository.metadata?.download;
    const license = repository.license_spdx || "未知许可证";
    const status = repository.verified_official ? (verification.license_status === "known_spdx" ? "verified" : "license-review-required") : "candidate-only";
    const actions = repository.verified_official && verification.license_status === "known_spdx"
      ? download ? `<span class="muted">已下载到 ${escapeHtml(download.relative_path || "项目代码目录")}</span>` : `<button class="secondary" onclick="proposeRepositoryDownload('${repository.id}')" ${disabled ? "disabled" : ""}><i data-lucide="download"></i>提出下载</button>`
      : `<button class="secondary" onclick="verifyRepository('${repository.id}')" ${disabled ? "disabled" : ""}><i data-lucide="shield-check"></i>交叉验证</button>`;
    return `<div class="data-row"><div><h3>${escapeHtml(repository.source_url)}</h3><p>${escapeHtml(license)} · commit ${escapeHtml((repository.commit_or_tag || "未固定").slice(0, 12))} · ${escapeHtml(verification.match?.method || "未验证")}</p></div><div class="button-row">${statusBadge(status)}${actions}</div></div>`;
  }).join("");
  section.innerHTML = `<div class="section-head"><h2>代码仓库候选</h2><p class="muted">只有论文记录与仓库引用形成双源匹配、许可证可识别且 commit 已固定后，才可提出下载。</p></div><div class="data-list">${rows}</div>`;
  $("tab-literature").appendChild(section); iconRefresh();
}
async function verifyRepository(id) { try { await api(`/api/projects/${state.projectId}/repositories/${id}/verify`, {method:"POST"}); await refreshProject(); toast("仓库双源验证完成"); } catch (error) { toast(error.message); } }
async function proposeRepositoryDownload(id) { try { const result = await api(`/api/projects/${state.projectId}/repositories/${id}/download`, {method:"POST"}); await refreshProject(); switchTab("approvals"); toast(`下载 Proposal ${result.proposal_id.slice(0, 8)} 已创建`); } catch (error) { toast(error.message); } }
async function proposeCheckpointRerun(checkpointId) {
  const reason = window.prompt("请说明局部重跑原因", "复核该实验在当前项目快照下的结果");
  if (!reason || reason.trim().length < 5) return;
  try {
    const result = await api(`/api/projects/${state.projectId}/checkpoints/${checkpointId}/rerun`, {method:"POST", body:JSON.stringify({reason: reason.trim()})});
    await refreshProject();
    switchTab("approvals");
    toast(`局部重跑 Proposal ${result.proposal_id.slice(0, 8)} 已创建，等待审批`);
  } catch (error) { toast(error.message); }
}
function renderDiagnostics(report) {
  const metricRows = Object.entries(report.metrics || {}).map(([name, rawValue]) => { const value: any = rawValue; return `<div class="data-row"><div><h3>${escapeHtml(name)}</h3><p>n=${value.count} · mean=${Number(value.mean).toPrecision(6)} · std=${Number(value.population_std ?? value.std).toPrecision(6)} · range ${Number(value.min).toPrecision(6)}–${Number(value.max).toPrecision(6)}</p></div><span class="badge live">已计算</span></div>`; }).join("");
  const suggestions = (report.suggestions || []).map(item => `<div class="data-row"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.reason)}</p><p class="muted">证据运行: ${escapeHtml((item.evidence_experiment_ids || []).map(id => id.slice(0, 8)).join(", "))}</p></div><span class="badge pending">待审批</span></div>`).join("");
  const failures = (report.failures || []).map(item => `<div class="data-row"><div><h3>${escapeHtml(item.experiment_id.slice(0, 8))}</h3><p>${escapeHtml(item.status)} · ${escapeHtml(item.error_code)}</p></div>${statusBadge("failed")}</div>`).join("");
  $("diagnosticsOutput").innerHTML = `<div class="section"><div class="section-head"><h3>数值摘要</h3><span class="muted">${report.run_count ?? 0} 次运行 · TypeScript 确定性计算</span></div><div class="data-list">${metricRows || `<div class="empty">没有可比较的数值指标。</div>`}</div></div>${failures ? `<div class="section"><div class="section-head"><h3>失败诊断</h3></div><div class="data-list">${failures}</div></div>` : ""}${suggestions ? `<div class="section"><div class="section-head"><h3>后续建议</h3><span class="badge pending">Proposal ${escapeHtml((report.proposal_id || "").slice(0, 8))}</span></div><div class="data-list">${suggestions}</div></div>` : `<div class="empty">当前没有需要审批的后续建议。</div>`}`;
}
async function runDiagnostics() {
  try { const report = await api(`/api/projects/${state.projectId}/diagnostics`, {method: "POST"}); renderDiagnostics(report); toast("诊断完成，建议需审批后才能执行"); }
  catch (error) { toast(error.message); }
}
function renderProject() {
  const d = state.project, c = d.counts;
  const pe = d.policy_enforcement || {}, cr = pe.citation_readiness || {};
  const isActive = d.project.status === "active";
  const executionDisabled = isActive ? "" : "disabled";
  const stateControls = d.project.status === "active"
    ? `<button class="secondary" onclick="changeProjectState('pause')"><i data-lucide="pause"></i>暂停</button><button class="reject" onclick="changeProjectState('cancel')"><i data-lucide="square"></i>取消项目</button>`
    : d.project.status === "paused"
      ? `<button class="approve" onclick="changeProjectState('resume')"><i data-lucide="play"></i>恢复</button><button class="reject" onclick="changeProjectState('cancel')"><i data-lucide="square"></i>取消项目</button>`
      : "";
  $("tab-overview").innerHTML = `<div class="metric-grid"><div class="metric"><span>论文</span><strong>${c.papers}</strong></div><div class="metric"><span>实验</span><strong>${c.experiments}</strong></div><div class="metric"><span>产物</span><strong>${c.artifacts}</strong></div><div class="metric"><span>待审批</span><strong>${d.proposals.filter(p=>p.status==='pending').length}</strong></div></div>
    <div class="section"><div class="section-head"><h2>研究规格</h2><div class="button-row"><button class="secondary" onclick="runSearch()" ${executionDisabled}><i data-lucide="search"></i>检索文献</button><button class="secondary" onclick="createPaperDraft()" ${executionDisabled}><i data-lucide="file-pen-line"></i>生成证据论文草稿</button><button class="secondary" onclick="createCompilePlan()" ${executionDisabled}><i data-lucide="file-check"></i>编译论文</button></div></div><div class="data-list"><div class="data-row"><div><h3>${escapeHtml(d.spec.idea.research_question)}</h3><p>${escapeHtml(d.spec.idea.domain)} · ${escapeHtml((d.spec.idea.keywords||[]).join(', '))}</p></div>${statusBadge(d.spec.feasibility)}</div></div></div>
    <div class="section"><div class="section-head"><h2>项目状态</h2><div class="button-row">${stateControls}</div></div><div class="data-list"><div class="data-row"><div><h3>${escapeHtml(d.project.stage)}</h3><p>Idea version ${d.project.idea_version} · ${escapeHtml(d.project.status)}</p></div>${statusBadge(d.project.status)}</div></div></div>`;
  $("tab-literature").innerHTML = `<div class="section-head"><h2>可验证文献记录</h2><div class="button-row"><button class="secondary" onclick="runSearch()"><i data-lucide="search"></i>更新检索</button><button class="secondary" onclick="ingestEvidence()" ${executionDisabled}><i data-lucide="scan-text"></i>提取全文证据</button></div></div>${d.papers.length ? `<div class="data-list">${d.papers.map(p=>`<div class="data-row"><div><h3><a href="${escapeHtml(p.source_url)}" target="_blank">${escapeHtml(p.title)}</a></h3><p>${p.year||''} ${escapeHtml(p.venue||'')} · ${escapeHtml(p.source_provider||'unknown')} · DOI ${escapeHtml(p.doi||'未提供')} · ${p.verified?'元数据已验证':'待验证'} · 页码原文证据 ${Number(p.fulltext_evidence_count||0)} · 代码候选 ${(p.code_repositories||[]).length}</p>${p.pdf_url?`<p><a href="${escapeHtml(p.pdf_url)}" target="_blank">打开来源 PDF</a></p>`:''}${p.bibtex?`<details><summary>BibTeX</summary><pre class="code-block">${escapeHtml(p.bibtex)}</pre></details>`:''}</div>${statusBadge((p.fulltext_evidence_count||0)>0?'fulltext-evidence':'metadata-only')}</div>`).join('')}</div>` : `<div class="empty">尚无文献记录。</div>`}`;
  $("tab-experiments").innerHTML = `<div class="section-head"><h2>实验规划与运行</h2><div class="button-row"><button class="secondary" onclick="createExperimentPlan()" ${executionDisabled}><i data-lucide="list-checks"></i>生成主题专属计划</button><button class="secondary" onclick="runDiagnostics()"><i data-lucide="activity"></i>数值诊断</button></div></div>${d.experiments.length ? `<div class="data-list">${d.experiments.map(e=>`<div class="data-row"><div><h3>${escapeHtml(e.experiment_type)}</h3><p>${escapeHtml(JSON.stringify(e.metrics))}${e.run_id?` · Run ${escapeHtml(e.run_id)}`:''}</p></div><div class="button-row">${statusBadge(e.status)}<button class="secondary" onclick="syncRun('${e.id}')"><i data-lucide="refresh-cw"></i>同步</button>${['queued','running'].includes(e.status)?`<button class="reject" onclick="cancelRun('${e.id}')"><i data-lucide="square"></i>取消</button>`:''}</div></div>`).join('')}</div>` : `<div class="empty">生成计划后会先进入审批；系统不会自动创建无关实验。</div>`}<div id="diagnosticsOutput" class="section"><div class="empty">运行数值诊断以计算指标并检查失败日志。</div></div>`;
  const artifactCards = d.artifacts.map(a => `<article class="artifact-card">${artifactPreviewMarkup(a)}<div class="artifact-body"><h3>${escapeHtml(a.name)}</h3><p class="muted">${escapeHtml(a.kind)} · ${a.valid ? "有效" : "已失效"}</p><a href="${escapeHtml(a.url)}" download>下载产物</a></div></article>`).join("");
  $("tab-artifacts").innerHTML = `<div class="section-head"><h2>可视化与大文件产物</h2></div>${d.artifacts.length ? `<div class="artifact-grid">${artifactCards}</div>` : `<div class="empty">实验完成并同步后显示 PNG、PLY、JSON 和 PDF。</div>`}`;
  hydrateArtifactPreviews();
  $("tab-approvals").innerHTML = `<div class="section-head"><h2>变更与执行审批</h2></div>${d.proposals.length ? `<div class="data-list">${d.proposals.map(p=>`<div class="data-row"><div><h3>${escapeHtml(p.summary)}</h3><p>${escapeHtml(p.reason)} · 预计 $${Number(p.estimated_cost_usd).toFixed(2)}</p>${p.diff?`<pre class="code-block">${escapeHtml(p.diff)}</pre>`:''}<p>影响: ${escapeHtml(JSON.stringify(p.impact))}</p></div><div class="button-row">${statusBadge(p.status)}${p.status==='pending'?`<button class="approve" onclick="decide('${p.id}','approved')"><i data-lucide="check"></i>批准</button><button class="reject" onclick="decide('${p.id}','rejected')"><i data-lucide="x"></i>驳回</button>`:''}${p.status==='approved'&&p.kind==='experiment_plan'?`<button class="secondary" onclick='launch(${JSON.stringify(JSON.stringify(p))})' ${executionDisabled}><i data-lucide="play"></i>${p.payload?.plan_type==='topic_specific'?'执行主题计划':'执行'}</button>`:''}</div></div>`).join('')}</div>` : `<div class="empty">没有待处理提案。</div>`}`;
  $("tab-policies").innerHTML = `<form class="policy-form" onsubmit="addPolicy(event)"><input id="policyInput" placeholder="新增长期项目策略" required><button class="primary">提出策略</button></form>
    <div class="section"><div class="section-head"><h2>执行状态</h2>${statusBadge(pe.status||'unknown')}</div><div class="data-list">
      <div class="data-row"><div><h3>随机种子下限</h3><p>随机实验至少 ${Number(pe.minimum_random_seed_count||1)} 个不同种子；计划生成和 Runner 提交双重校验</p></div>${statusBadge(pe.runner_compatible===false?'unsupported':'enforced')}</div>
      <div class="data-row"><div><h3>引用来源与原文证据</h3><p>DOI/来源 ${Number(cr.records_with_doi_or_source_url||0)}/${Number(cr.paper_records||0)} · 页码/章节原文证据 ${Number(cr.page_or_section_quoted_evidence||0)} · 元数据标题不计为全文证据</p></div>${statusBadge(cr.quoted_evidence_requirement_satisfied?'ready':'evidence-required')}</div>
      <div class="data-row"><div><h3>人工审批</h3><p>高成本操作 ${pe.approval?.high_cost_actions?'强制':'未配置'} · 对外操作 ${pe.approval?.external_actions?'强制':'未配置'}</p></div>${statusBadge('enforced')}</div>
    </div></div><div class="section"><div class="section-head"><h2>生效策略</h2></div><div class="data-list">${d.policies.map(p=>`<div class="data-row"><div><h3>${escapeHtml(p.rule)}</h3><p>${escapeHtml((p.enforced_requirements||[]).join(' · ')||'未识别为可执行约束；保留为人工规则')} · ${escapeHtml(p.rationale||'项目级持久策略')}</p></div>${statusBadge(p.recognized?'enforced':'manual')}</div>`).join('')}</div></div>`;
  $("tab-reports").innerHTML = `<div class="section-head"><h2>科研报告</h2><div class="button-row"><button class="secondary" onclick="generateReport('daily')">日报</button><button class="secondary" onclick="generateReport('weekly')">周报</button></div></div><div id="reportOutput" class="${d.reports.length?'report':'empty'}">${d.reports.length?escapeHtml(d.reports[0].content):'选择报告周期。'}</div>${d.reports.length>1?`<div class="section"><h3>历史报告</h3><div class="data-list">${d.reports.slice(1).map(r=>`<div class="data-row"><div><h3>${escapeHtml(r.period)}</h3><p>${escapeHtml(r.created_at)}</p></div></div>`).join('')}</div></div>`:''}`;
  iconRefresh();
  renderCheckpointActions(d, executionDisabled);
  renderRerunProposalActions(d, executionDisabled);
  renderRepositoryCandidates(d.repositories, !isActive);
  renderMaterialSearchPanel();
  renderSearchCandidates();
  loadNovelty();
}
function renderMaterialSearchPanel() {
  const old = $("materialSearchPanel");
  if (old) old.remove();
  if (!state.projectId || !$("tab-literature")) return;
  const panel = document.createElement("section");
  panel.id = "materialSearchPanel";
  panel.className = "section material-search-panel";
  panel.innerHTML = `<div class="section-head"><div><h2>项目材料库</h2><p class="muted">只检索已扫描的材料元数据和摘要；结果是未核验上下文候选，不是论文证据。</p></div></div><form class="material-search-form"><label class="sr-only" for="materialSearchQuery">检索材料</label><input id="materialSearchQuery" maxlength="200" placeholder="检索文件名、文本或 OCR 内容" required><button class="secondary" type="submit"><i data-lucide="search"></i>检索材料</button></form><div class="material-search-results"><div class="empty">输入关键词检索当前项目的材料。</div></div>`;
  const form = panel.querySelector("form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const input = panel.querySelector("#materialSearchQuery") as HTMLInputElement;
    try {
      await queryProjectMaterials(panel, input.value.trim(), 0, false);
    } catch (error) {
      toast(error.message);
    }
  });
  $("tab-literature").prepend(panel);
  iconRefresh();
}
async function queryProjectMaterials(panel, query, offset, append) {
  if (!query) return;
  const results = panel.querySelector(".material-search-results");
  const previousRows = append ? (results.querySelector(".data-list")?.innerHTML || "") : "";
  results.innerHTML = '<div class="empty">正在检索材料…</div>';
  const encoded = encodeURIComponent(query);
  const response = await api(`/api/projects/${state.projectId}/materials/search?q=${encoded}&limit=20&offset=${Number(offset) || 0}`);
  const rows = (response.results || []).map(item => `<div class="data-row"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.kind || "material")} · ${escapeHtml(item.parse_status || "unknown")} · SHA-256 ${escapeHtml(String(item.sha256 || "").slice(0, 12))}…</p><p class="muted">${escapeHtml(item.snippet || "无可展示摘要")}</p></div><span class="badge pending">词法候选 · 未核验</span></div>`).join("");
  const combinedRows = previousRows + rows;
  results.innerHTML = `<p class="muted">${Number(response.total_matches || 0)} 个匹配 · 确定性词法检索 · 不升级为全文证据</p>${combinedRows ? `<div class="data-list">${combinedRows}</div>` : '<div class="empty">没有匹配的材料。</div>'}`;
  if (response.next_offset !== null && response.next_offset !== undefined) {
    const more = document.createElement("button");
    more.className = "secondary material-search-more";
    more.type = "button";
    more.innerHTML = '<i data-lucide="chevrons-down"></i>加载更多';
    more.addEventListener("click", () => queryProjectMaterials(panel, query, response.next_offset, true));
    results.appendChild(more);
  }
  iconRefresh();
}
function renderSearchCandidates() {
  const old = $("searchCandidatesPanel");
  if (old) old.remove();
  const candidates = state.searchCandidates || [];
  if (!candidates.length || !$("tab-literature")) return;
  const panel = document.createElement("section");
  panel.id = "searchCandidatesPanel";
  panel.className = "section search-candidates";
  const heading = document.createElement("div");
  heading.className = "section-head";
  heading.innerHTML = '<div><h2>外部资源候选</h2><p class="muted">仅供发现，尚未核验来源、许可、所有权或全文证据。</p></div>';
  const count = document.createElement("span");
  count.className = "badge neutral";
  count.textContent = String(candidates.length) + " 条";
  heading.appendChild(count);
  panel.appendChild(heading);
  const list = document.createElement("div");
  list.className = "data-list";
  candidates.forEach(item => {
    const row = document.createElement("div");
    row.className = "data-row";
    const body = document.createElement("div");
    const link = document.createElement("a");
    link.href = item.url || "#";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.name || item.title || item.url || "候选资源";
    const title = document.createElement("h3");
    title.appendChild(link);
    const compliance = item.compliance || {};
    const metadata = document.createElement("p");
    metadata.textContent = String(item.resource_type || "resource") + " · " + String(item.provider || "unknown") + " · robots " + String(compliance.robots_status || "unknown");
    if (compliance.terms_url) {
      const terms = document.createElement("a");
      terms.href = compliance.terms_url;
      terms.target = "_blank";
      terms.rel = "noreferrer";
      terms.textContent = "查看条款";
      metadata.append(" · 条款 ", terms);
    }
    body.append(title, metadata);
    if (item.snippet) {
      const snippet = document.createElement("p");
      snippet.className = "muted";
      snippet.textContent = item.snippet;
      body.appendChild(snippet);
    }
    const badge = document.createElement("span");
    badge.className = "badge pending";
    badge.textContent = "待核验";
    row.append(body, badge);
    list.appendChild(row);
  });
  panel.appendChild(list);
  $("tab-literature").prepend(panel);
}
async function loadNovelty() {
  if (!state.projectId || !$("tab-literature")) return;
  try {
    const analysis = await api(`/api/projects/${state.projectId}/novelty`);
    const old = $("relatedWorkPanel"); if (old) old.remove();
    const list = (items, empty) => items && items.length ? `<div class="data-list">${items.map(item => `<div class="data-row"><div><h3>${escapeHtml(item.title || item.target || item.statement || "候选")}</h3><p>${escapeHtml(item.note || item.basis || item.statement || "")}</p></div>${statusBadge(item.status || "candidate_only")}</div>`).join("")}</div>` : `<div class="empty">${empty}</div>`;
    const panel = document.createElement("section"); panel.id = "relatedWorkPanel"; panel.className = "section related-work-panel";
    panel.innerHTML = `<div class="section-head"><h2>Related Work 与证据覆盖</h2>${statusBadge(analysis.assessment || "review-required")}</div><p class="muted">${escapeHtml(analysis.summary || "")}</p><h3>证据覆盖缺口</h3>${list(analysis.research_gap_candidates, "当前没有已标记的覆盖候选。")}${analysis.duplicate_candidates?.length ? `<h3>重复研究候选</h3>${list(analysis.duplicate_candidates, "")}` : ""}<p class="muted">${escapeHtml(analysis.claim_gate || "")}</p>`;
    $("tab-literature").prepend(panel);
  } catch (error) { toast(error.message); }
}
async function refreshProject() { if (state.projectId) await openProject(state.projectId); else await loadProjects(); }
async function runSearch() { try { toast("正在并行检索多个学术来源与资源注册表…"); const result=await api("/api/search",{method:"POST",body:JSON.stringify({project_id:state.projectId,limit:8})}); state.searchCandidates=result.resource_candidates || []; await refreshProject(); toast("检索完成；"+result.provider_errors.length+" 个来源暂时失败，"+state.searchCandidates.length+" 条候选待核验"); } catch(e){ toast(e.message); } }
async function ingestEvidence() { try { toast("正在下载开放 PDF 并提取页码原文证据…"); const r=await api(`/api/projects/${state.projectId}/evidence/ingest`,{method:"POST",body:JSON.stringify({limit:3})}); await refreshProject(); toast(`已保存 ${r.stored_count} 条全文证据；${r.errors.length} 条失败`); } catch(e){toast(e.message);} }
async function createCompilePlan() { try { const r=await api(`/api/projects/${state.projectId}/compile-plan`,{method:"POST"}); await refreshProject(); switchTab("approvals"); toast(`编译计划 ${r.proposal_id.slice(0,8)} 待审批`); } catch(e){toast(e.message);} }
async function createPaperDraft() { try { const r=await api(`/api/projects/${state.projectId}/paper-draft`,{method:"POST"}); await refreshProject(); switchTab("approvals"); toast(`证据论文草稿 Proposal ${r.proposal_id.slice(0,8)} 待审批`); } catch(e){toast(e.message);} }
async function createExperimentPlan() { try { const r=await api(`/api/projects/${state.projectId}/experiment-plan`,{method:"POST"}); await refreshProject(); switchTab("approvals"); toast(`主题专属计划 ${r.proposal_id.slice(0,8)} 待审批`); } catch(e){toast(e.message);} }
async function decide(id, decision) { try { await api(`/api/proposals/${id}/decision`,{method:"POST",body:JSON.stringify({decision,actor:"local-user"})}); await refreshProject(); } catch(e){toast(e.message);} }
async function launch(serialized) { try { const p=JSON.parse(serialized), payload=p.payload; const r=await api("/api/experiments",{method:"POST",body:JSON.stringify({project_id:state.projectId,proposal_id:p.id,experiment_type:payload.experiment_type,config:payload.config,random_seeds:payload.random_seeds,topic_plan:payload.topic_plan,topic_resume:payload.topic_resume})}); await refreshProject(); switchTab("experiments"); toast(`运行 ${r.run_id.slice(0,8)} 已提交`); } catch(e){toast(e.message);} }
async function syncRun(id) { try { await api(`/api/experiments/${id}/sync`,{method:"POST"}); await refreshProject(); } catch(e){toast(e.message);} }
async function cancelRun(id) { try { await api(`/api/experiments/${id}/cancel`,{method:"POST"}); await refreshProject(); toast("运行已取消"); } catch(e){toast(e.message);} }
async function changeProjectState(action) { if(action==="cancel"&&!window.confirm("取消项目后不能恢复，确定继续吗？"))return;try{const reason=action==="pause"?"User paused the project from the Web UI":action==="resume"?"User resumed the project from the Web UI":"User cancelled the project from the Web UI";await api(`/api/projects/${state.projectId}/state`,{method:"POST",body:JSON.stringify({action,reason})});await refreshProject();toast(action==="pause"?"项目已暂停":action==="resume"?"项目已恢复":"项目已取消");}catch(e){toast(e.message);} }
async function addPolicy(event) { event.preventDefault(); const input=$("policyInput"); try{const r=await api("/api/policies",{method:"POST",body:JSON.stringify({project_id:state.projectId,rule:input.value})});await refreshProject();switchTab("approvals");toast(`策略提案 ${r.proposal_id.slice(0,8)} 待审批`);}catch(e){toast(e.message);} }
async function generateReport(period) { try { const r=await api("/api/reports",{method:"POST",body:JSON.stringify({project_id:state.projectId,period})}); $("reportOutput").className="report"; $("reportOutput").textContent=r.content; }catch(e){toast(e.message);} }
function switchTab(name) { state.activeTab=name; document.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("active",(x as HTMLElement).dataset.tab===name)); document.querySelectorAll(".tab-panel").forEach(x=>x.classList.add("hidden")); $(`tab-${name}`).classList.remove("hidden"); }
function toggleMobileProjectChat(open) { $("projectChatPane").classList.toggle("mobile-open", open); if (open) $("projectChatInput").focus(); }
async function sendProjectChat(event){event.preventDefault();const input=$("projectChatInput"),message=input.value.trim();if(!message||state.projectChatBusy||!projectChatGate.tryStart())return;addMessage($("projectMessages"),"user",message);input.value="";state.projectChatBusy=true;const stopProgress=startAiProgress({progressId:"projectAiProgress",formId:"projectChatForm",elapsedId:"projectAiProgressElapsed",stageId:"projectAiProgressStage",project:true});try{const r=await api("/api/chat",{method:"POST",body:JSON.stringify({session_id:state.sessionId,project_id:state.projectId,message})});addMessage($("projectMessages"),"assistant",r.reply,modelMeta(r));if(r.action_required){await refreshProject();switchTab("approvals");}}catch(e){const message=chatUX.formatRequestError(e);addMessage($("projectMessages"),"assistant",`请求失败：${message}`);toast(message);}finally{stopProgress();projectChatGate.finish();state.projectChatBusy=false;}}

function bindComposerKeyboard(formId, inputId) {
  const input = $(inputId);
  const form = $(formId);
  input.addEventListener("keydown", event => {
    if (!chatUX.shouldSubmitOnKeyboard(event)) return;
    event.preventDefault();
    if (typeof form.requestSubmit === "function") form.requestSubmit();
  });
}

$("chatForm").addEventListener("submit", sendChat); $("confirmProject").addEventListener("click", confirmProject); $("newProject").addEventListener("click",newProject); $("refresh").addEventListener("click",refreshProject); $("projectChatForm").addEventListener("submit",sendProjectChat);
$("openModelSettings").addEventListener("click", openModelSettings); $("closeModelSettings").addEventListener("click", closeModelSettings); $("cancelModelSettings").addEventListener("click", closeModelSettings); $("modelSettingsForm").addEventListener("submit", saveModelSettings);
$("modelSettingsForm").addEventListener("input", () => { state.settingsDirty = true; });
$("modelSettingsModal").addEventListener("click", event => { if (event.target === $("modelSettingsModal")) closeModelSettings(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("modelSettingsModal").classList.contains("hidden")) closeModelSettings(); });
bindComposerKeyboard("chatForm", "chatInput"); bindComposerKeyboard("projectChatForm", "projectChatInput");
$("fileInput").addEventListener("change", e => { state.queuedFiles=[...e.target.files]; $("fileQueue").textContent=state.queuedFiles.map(f=>f.name).join(" · "); });
$("clarificationMode").addEventListener("change", () => syncClarificationMode());
$("tabs").querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>switchTab(btn.dataset.tab)));
$("mobileChatToggle").addEventListener("click", () => toggleMobileProjectChat(true)); $("mobileChatClose").addEventListener("click", () => toggleMobileProjectChat(false));
api("/api/health").then(()=>{$("health").classList.add("ok");$("health").lastChild.textContent="已连接";}).catch(()=>{$("health").lastChild.textContent="离线";});
syncClarificationMode(); loadProjects(); iconRefresh();
