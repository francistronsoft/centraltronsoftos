const statusLabels = {
  online: "Online",
  warning: "Atencao",
  offline: "Offline",
  unknown: "Desconhecido"
};

let currentUser = null;
let currentClients = [];
let currentInstallations = [];
let currentAlerts = [];
let currentAuthEvents = [];
let currentResellers = [];
let currentOAuthSummary = null;
let activeView = "dashboard";
let monitorFilter = "all";
let clientPage = 1;
const clientsPageSize = 10;

const viewTitles = {
  dashboard: "Monitoramento geral",
  resellers: "Revendas",
  clients: "Clientes",
  installations: "Ambientes",
  alerts: "Alertas",
  oauth: "0auth",
  maintenance: "Manutencao"
};

const directTronsoftOption = {
  id: "__tronsoft_direct",
  name: "TronSoft",
  document: "TRONSOFT-DIRETO",
  directTronsoft: true
};

const severityLabels = {
  critical: "Critico",
  warning: "Atencao",
  info: "Info"
};

function initials(value) {
  return String(value || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatRelativeTime(value) {
  if (!value) return "-";
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return "-";
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `ha ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `ha ${hours} h`;
  return new Date(value).toLocaleDateString("pt-BR");
}

function numberFromPaths(source, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((acc, key) => acc?.[key], source);
    const number = Number(value);
    if (Number.isFinite(number)) return Math.round(number);
  }
  return null;
}

function latestOpenAlertForClient(clientId) {
  return currentAlerts.find((alert) => alert.clientId === clientId && alert.status !== "resolved");
}

function databaseVersion(installation) {
  return installation?.database?.versaoBanco
    || installation?.database?.versao_banco
    || installation?.database?.schemaVersion
    || installation?.database?.version
    || "-";
}

const ufCoordinates = {
  AC: [18, 45],
  AL: [77, 61],
  AP: [49, 16],
  AM: [33, 31],
  BA: [66, 58],
  CE: [71, 43],
  DF: [57, 61],
  ES: [70, 72],
  GO: [55, 62],
  MA: [61, 39],
  MG: [63, 69],
  MS: [48, 73],
  MT: [45, 58],
  PA: [52, 31],
  PB: [76, 48],
  PE: [76, 52],
  PI: [65, 45],
  PR: [56, 83],
  RJ: [67, 76],
  RN: [76, 44],
  RO: [32, 50],
  RR: [38, 15],
  RS: [55, 92],
  SC: [58, 87],
  SE: [76, 58],
  SP: [59, 77],
  TO: [57, 48]
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeState(value) {
  return String(value || "").trim().toUpperCase().slice(0, 2);
}

function clientLocation(client) {
  const city = client.city || client.customer?.city || "";
  const state = normalizeState(client.state || client.customer?.state || "");
  return { city, state };
}

function selectedResellerId() {
  return document.querySelector("#reseller-filter").value || "";
}

function querySuffix() {
  const resellerId = selectedResellerId();
  return resellerId ? `?resellerId=${encodeURIComponent(resellerId)}` : "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function showLogin() {
  document.querySelector("#login-view").hidden = false;
  document.querySelector("#app-shell").hidden = true;
}

function showApp() {
  document.querySelector("#login-view").hidden = true;
  document.querySelector("#app-shell").hidden = false;
  showView(activeView);
}

function showView(view) {
  const tronsoft = currentUser?.role === "tronsoft_admin";
  const restrictedViews = new Set(["resellers", "maintenance"]);
  activeView = !tronsoft && restrictedViews.has(view) ? "clients" : view;

  document.querySelectorAll("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== activeView;
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    const isActive = button.dataset.viewTarget === activeView;
    button.classList.toggle("active", isActive);
  });
  document.querySelector("#page-title").textContent = viewTitles[activeView] || "Central";
}

async function loadSession() {
  try {
    const payload = await api("/api/auth/me");
    currentUser = payload.user;
    showApp();
    await configureScopeControls();
    await loadCentralData();
  } catch {
    showLogin();
  }
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const error = document.querySelector("#login-error");
  error.textContent = "";

  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: data.get("email"),
        password: data.get("password")
      })
    });
    currentUser = payload.user;
    showApp();
    await configureScopeControls();
    await loadCentralData();
  } catch (err) {
    error.textContent = err.message;
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
  currentUser = null;
  showLogin();
}

async function configureScopeControls() {
  document.querySelector("#user-badge").textContent = `${currentUser.name} (${currentUser.role === "tronsoft_admin" ? "TronSoft" : "Revenda"})`;
  document.querySelector("#scope-label").textContent = currentUser.role === "tronsoft_admin"
    ? "Painel TronSoft com todos os clientes e filtro por revenda."
    : "Painel da revenda com apenas seus clientes TronSoftOS.";

  currentResellers = await api("/api/resellers");
  const filter = document.querySelector("#reseller-filter");
  const clientResellerSelect = document.querySelector("#client-reseller-select");
  const resellerNameInput = document.querySelector("#reseller-name-input");
  const resellerDocumentInput = document.querySelector("#reseller-document-input");
  const resellerPanel = document.querySelector("#reseller-panel");
  const resellersNav = document.querySelector('[data-view-target="resellers"]');
  const maintenanceNav = document.querySelector('[data-view-target="maintenance"]');

  filter.innerHTML = `<option value="">Todas as revendas</option>${currentResellers
    .map((reseller) => `<option value="${reseller.id}">${escapeHtml(reseller.name)}</option>`)
    .join("")}`;
  const clientResellerOptions = [
    directTronsoftOption,
    ...currentResellers.filter((reseller) => {
      return reseller.document !== directTronsoftOption.document && reseller.name.toLowerCase() !== "tronsoft";
    })
  ];
  clientResellerSelect.innerHTML = clientResellerOptions
    .map((reseller) => `<option value="${reseller.id}">${escapeHtml(reseller.name)}</option>`)
    .join("");

  const tronsoft = currentUser.role === "tronsoft_admin";
  filter.hidden = !tronsoft;
  resellerPanel.hidden = !tronsoft;
  resellersNav.hidden = !tronsoft;
  maintenanceNav.hidden = !tronsoft;
  clientResellerSelect.hidden = !tronsoft;
  resellerNameInput.hidden = tronsoft;
  resellerDocumentInput.hidden = tronsoft;
  resellerNameInput.required = !tronsoft;
  clientResellerSelect.required = tronsoft;

  if (!tronsoft && currentResellers[0]) {
    resellerNameInput.value = currentResellers[0].name;
    resellerDocumentInput.value = currentResellers[0].document || "";
  }

  renderResellers();
  showView(activeView);
}

async function loadCentralData() {
  const [dashboard, registeredClients, installations, alerts, oauthSummary] = await Promise.all([
    api(`/api/dashboard${querySuffix()}`),
    api(`/api/clients${querySuffix()}`),
    api(`/api/installations${querySuffix()}`),
    api(`/api/alerts${querySuffix()}`),
    api(`/api/oauth/google/summary${querySuffix()}`)
  ]);
  currentOAuthSummary = oauthSummary;
  currentInstallations = installations;
  currentAlerts = alerts;

  const installationsByClient = new Map();
  installations.forEach((installation) => {
    const items = installationsByClient.get(installation.client?.id) || [];
    items.push(installation);
    installationsByClient.set(installation.client?.id, items);
  });

  currentClients = registeredClients.flatMap((client) => {
    const clientInstallations = installationsByClient.get(client.id) || [];
    if (clientInstallations.length === 0) {
      const latestToken = [...(client.pairingTokens || [])].reverse().find((token) => token.status === "active");
      return [{
        id: client.id,
        name: client.name,
        reseller: client.reseller?.name || "Sem revenda",
        city: client.city || "",
        state: normalizeState(client.state),
        environment: latestToken ? "Token gerado" : "Aguardando token",
        version: "Aguardando pareamento",
        database: "-",
        status: "unknown",
        lastSeen: "-",
        lastSeenAt: null,
        diskPercent: null,
        backup: { label: "--", tone: "unknown", detail: "sem dados" },
        alert: latestOpenAlertForClient(client.id),
        pairingToken: latestToken?.token || ""
      }];
    }

    return clientInstallations.map((installation) => ({
      id: client.id,
      name: client.name,
      reseller: client.reseller?.name || installation.reseller?.name || "Sem revenda",
      city: client.city || "",
      state: normalizeState(client.state),
      environment: installation.name,
      version: installation.tronsoftos?.version || "-",
      database: databaseVersion(installation),
      status: installation.status,
      lastSeen: installation.lastSeenAt ? new Date(installation.lastSeenAt).toLocaleString("pt-BR") : "-",
      lastSeenAt: installation.lastSeenAt || null,
      diskPercent: diskPercent(installation),
      backup: backupSummary(installation),
      alert: latestOpenAlertForClient(client.id),
      pairingToken: ""
    }));
  });

  currentAuthEvents = alerts.slice(-4).reverse().map((alert) => ({
    title: alert.title,
    detail: `${alert.severity} - ${alert.message || alert.code || "Sem detalhes"}`
  }));

  renderMetrics(dashboard);
  renderClients(document.querySelector("#client-filter").value);
  renderDashboardClients();
  renderGeoMap();
  renderAuthEvents();
  renderAlerts();
  renderOAuthSummary();
}

function renderMetrics(dashboard) {
  document.querySelector("#metric-resellers").textContent = dashboard.resellers;
  document.querySelector("#metric-clients").textContent = dashboard.clients;
  document.querySelector("#metric-online").textContent = dashboard.online;
  document.querySelector("#metric-alerts").textContent = dashboard.criticalAlerts;
}

function diskPercent(installation) {
  return numberFromPaths(installation, [
    "backups.disk.percentUsed",
    "backups.disk.usedPercent",
    "metrics.systemMetrics.diskUsedPercent",
    "metrics.systemMetrics.latest.diskUsedPercent",
    "metrics.systemMetrics.host.diskUsedPercent",
    "metrics.systemMetrics.disk.percentUsed",
    "metrics.diskUsedPercent",
    "metrics.host.diskUsedPercent",
    "host.diskUsedPercent",
    "database.diskPercent"
  ]);
}

function backupSummary(installation) {
  const backups = installation?.backups || {};
  const latest = backups.latestBackupAt
    || backups.latestUploadedAt
    || backups.latestFile?.modifiedAt
    || backups.recentFiles?.[0]?.modifiedAt
    || backups.receiver?.latestBackup?.modifiedAt
    || null;
  if (!latest) {
    return { label: "--", tone: "unknown", detail: "sem dados" };
  }

  const minutes = Math.max(0, Math.round((Date.now() - new Date(latest).getTime()) / 60000));
  if (!Number.isFinite(minutes)) return { label: "--", tone: "unknown", detail: "sem dados" };
  if (minutes <= 360) return { label: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} OK`, tone: "online", detail: formatRelativeTime(latest) };
  return { label: "Atrasado", tone: "warning", detail: formatRelativeTime(latest) };
}

function monitorStatus(client) {
  if (client.status === "offline") return "offline";
  const alert = latestOpenAlertForClient(client.id);
  if (alert?.severity === "critical") return "offline";
  if (alert || client.status === "warning") return "warning";
  if (client.status === "online") return "online";
  return "unknown";
}

function renderClients(filter = "") {
  const table = document.querySelector("#clients-table");
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleClients = currentClients.filter((client) => {
    const searchable = `${client.name} ${client.reseller} ${client.environment} ${client.database || ""}`.toLowerCase();
    return searchable.includes(normalizedFilter);
  });
  const totalPages = Math.max(1, Math.ceil(visibleClients.length / clientsPageSize));
  clientPage = Math.min(clientPage, totalPages);
  const pageClients = visibleClients.slice((clientPage - 1) * clientsPageSize, clientPage * clientsPageSize);

  table.innerHTML = pageClients
    .map((client) => {
      const location = [client.city, client.state].filter(Boolean).join(" / ") || "-";
      return `
        <tr>
          <td>${escapeHtml(client.name)}<br><span class="muted-cell">${escapeHtml(location)}</span></td>
          <td>${escapeHtml(client.reseller)}</td>
          <td>${escapeHtml(client.environment)}${client.pairingToken ? `<br><span class="token-cell">${escapeHtml(client.pairingToken)}</span>` : ""}</td>
          <td>${escapeHtml(client.version)}<br><span class="muted-cell">${escapeHtml(client.database || "-")}</span></td>
          <td><span class="status ${escapeHtml(client.status)}">${escapeHtml(statusLabels[client.status] || client.status)}</span></td>
          <td>${escapeHtml(client.lastSeen)}</td>
        </tr>
      `;
    })
    .join("") || `
      <tr>
        <td colspan="6" class="empty-cell">Nenhum cliente encontrado neste escopo.</td>
      </tr>
    `;
  renderClientPagination(visibleClients.length, totalPages);
}

function renderClientPagination(total, totalPages) {
  const pagination = document.querySelector("#client-pagination");
  if (!pagination) return;
  if (total <= clientsPageSize) {
    pagination.innerHTML = "";
    return;
  }
  const start = (clientPage - 1) * clientsPageSize + 1;
  const end = Math.min(total, clientPage * clientsPageSize);
  pagination.innerHTML = `
    <span>${start}-${end} de ${total}</span>
    <button type="button" data-client-page="prev" ${clientPage <= 1 ? "disabled" : ""}>Anterior</button>
    <button type="button" data-client-page="next" ${clientPage >= totalPages ? "disabled" : ""}>Proxima</button>
  `;
  pagination.querySelectorAll("[data-client-page]").forEach((button) => {
    button.addEventListener("click", () => {
      clientPage += button.dataset.clientPage === "next" ? 1 : -1;
      renderClients(document.querySelector("#client-filter").value);
    });
  });
}

function renderDashboardClients() {
  const list = document.querySelector("#dashboard-clients-list");
  if (!list) return;
  const visibleClients = currentClients.filter((client) => {
    const status = monitorStatus(client);
    if (monitorFilter === "warning") return status === "warning";
    if (monitorFilter === "offline") return status === "offline";
    return true;
  }).slice(0, 5);

  list.innerHTML = visibleClients
    .map((client) => {
      const status = monitorStatus(client);
      const disk = client.diskPercent;
      const diskTone = disk === null ? "unknown" : disk >= 90 ? "offline" : disk >= 75 ? "warning" : "online";
      const detail = client.alert?.message || client.alert?.title || (client.lastSeenAt ? `Ultimo heartbeat ${formatRelativeTime(client.lastSeenAt)}` : "Aguardando heartbeat");
      return `
        <article class="monitor-row">
          <div class="monitor-client">
            <span class="client-avatar">${escapeHtml(initials(client.name))}</span>
            <div>
              <strong>${escapeHtml(client.name)}</strong>
              <span>${escapeHtml(detail)}</span>
            </div>
          </div>
          <div>${escapeHtml(client.reseller)}</div>
          <div><span class="status ${escapeHtml(status)}">${escapeHtml(statusLabels[status] || status)}</span></div>
          <div class="disk-cell">
            <strong>${disk === null ? "--" : `${disk}%`}</strong>
            <span class="disk-bar"><span class="${escapeHtml(diskTone)}" style="width:${disk === null ? 0 : Math.min(100, disk)}%"></span></span>
            ${disk === null ? `<small>sem dados</small>` : ""}
          </div>
          <div><span class="backup-pill ${escapeHtml(client.backup.tone)}">${escapeHtml(client.backup.label)}</span></div>
        </article>
      `;
    })
    .join("") || `<div class="empty-monitor">Nenhum cliente neste filtro.</div>`;
}

function alertContext(alert) {
  const installation = currentInstallations.find((item) => item.installationId === alert.installationId);
  const client = currentClients.find((item) => item.id === alert.clientId);
  return {
    clientName: client?.name || installation?.client?.name || "Cliente nao identificado",
    resellerName: client?.reseller || installation?.reseller?.name || "Sem revenda",
    environment: installation?.name || alert.installationId || "-"
  };
}

function renderAlerts() {
  const list = document.querySelector("#alerts-list");
  const filter = document.querySelector("#alert-filter")?.value || "";
  if (!list) return;
  const visibleAlerts = currentAlerts
    .filter((alert) => {
      if (filter === "resolved") return alert.status === "resolved";
      if (alert.status === "resolved") return false;
      return !filter || alert.severity === filter;
    })
    .slice()
    .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0));

  list.innerHTML = visibleAlerts
    .map((alert) => {
      const context = alertContext(alert);
      return `
        <article class="alert-row ${escapeHtml(alert.severity)} ${alert.status === "resolved" ? "resolved" : ""}">
          <div>
            <span class="alert-severity ${escapeHtml(alert.severity)}">${escapeHtml(severityLabels[alert.severity] || alert.severity)}</span>
            <strong>${escapeHtml(alert.title || alert.code || "Alerta")}</strong>
            <p>${escapeHtml(alert.message || "Sem detalhes")}</p>
          </div>
          <div>
            <span>${escapeHtml(context.clientName)}</span>
            <small>${escapeHtml(context.resellerName)} / ${escapeHtml(context.environment)}</small>
          </div>
          <div>
            <span>${escapeHtml(alert.status === "resolved" ? "Resolvido" : "Aberto")}</span>
            <small>${escapeHtml(formatRelativeTime(alert.openedAt))}</small>
          </div>
        </article>
      `;
    })
    .join("") || `<div class="empty-monitor">Nenhum alerta encontrado.</div>`;
}

function renderResellers() {
  const list = document.querySelector("#resellers-list");
  if (!list) return;

  list.innerHTML = currentResellers
    .map(
      (reseller) => `
        <article class="compact-item">
          <strong>${escapeHtml(reseller.name)}</strong>
          <span>CNPJ: ${escapeHtml(reseller.document || "Sem CNPJ")}</span>
          <span>Acesso: ${escapeHtml(reseller.accessEmail || "Sem email")}</span>
        </article>
      `
    )
    .join("") || `<p class="empty-note">Nenhuma revenda cadastrada.</p>`;
}

function renderGeoMap() {
  const map = document.querySelector("#geo-map");
  const list = document.querySelector("#geo-list");
  const groups = new Map();

  currentClients.forEach((client) => {
    const { city, state } = clientLocation(client);
    if (!state || !ufCoordinates[state]) return;
    const key = `${state}|${city || "Sem cidade"}`;
    const current = groups.get(key) || { state, city: city || "Sem cidade", count: 0, online: 0, warning: 0 };
    current.count += 1;
    if (client.status === "online") current.online += 1;
    if (client.status === "warning") current.warning += 1;
    groups.set(key, current);
  });

  const points = [...groups.values()].sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
  map.innerHTML = `
    <div class="map-shape"></div>
    ${points.map((point, index) => {
      const [baseX, baseY] = ufCoordinates[point.state];
      const offset = (index % 5) - 2;
      const x = Math.max(8, Math.min(92, baseX + offset * 1.5));
      const y = Math.max(8, Math.min(92, baseY + offset));
      return `<button class="map-pin" type="button" style="left:${x}%;top:${y}%;" title="${escapeHtml(point.city)} / ${escapeHtml(point.state)} - ${point.count} cliente(s)">${point.count}</button>`;
    }).join("")}
  `;

  list.innerHTML = points
    .map((point) => `
      <article class="geo-item">
        <strong>${escapeHtml(point.city)} / ${escapeHtml(point.state)}</strong>
        <span>${point.count} cliente(s), ${point.online} online, ${point.warning} em atencao</span>
      </article>
    `)
    .join("") || `<p class="empty-note">Cadastre clientes com cidade e UF para popular o mapa.</p>`;
}

function renderOAuthSummary() {
  const container = document.querySelector("#oauth-summary");
  if (!container || !currentOAuthSummary) return;

  const accounts = currentOAuthSummary.accounts || [];
  container.innerHTML = `
    <div class="oauth-grid">
      <article class="metric">
        <span>Google configurado</span>
        <strong>${currentOAuthSummary.configured ? "Sim" : "Nao"}</strong>
      </article>
      <article class="metric">
        <span>Ambientes</span>
        <strong>${currentOAuthSummary.installations}</strong>
      </article>
      <article class="metric">
        <span>Conectados</span>
        <strong>${currentOAuthSummary.connected}</strong>
      </article>
    </div>
    <div class="oauth-contract">
      <strong>Endpoints do TronSoftOS</strong>
      <code>GET /api/tronsoftos/oauth/google/status</code>
      <code>POST /api/tronsoftos/oauth/google/start</code>
      <code>POST /api/tronsoftos/oauth/google/token</code>
      <span>Enviar sempre o header <b>x-installation-token</b> recebido no pareamento.</span>
      <span>Redirect URI Google: ${escapeHtml(currentOAuthSummary.redirectUri)}</span>
    </div>
    <div class="compact-list oauth-accounts">
      ${accounts.map((account) => `
        <article class="compact-item">
          <strong>${escapeHtml(account.accountEmail || "Conta Google")}</strong>
          <span>${escapeHtml(account.installationId)}</span>
        </article>
      `).join("") || `<p class="empty-note">Nenhuma instalacao conectou Google Drive ainda.</p>`}
    </div>
  `;
}

function renderAuthEvents() {
  const list = document.querySelector("#auth-events");
  const events = currentAuthEvents.length > 0
    ? currentAuthEvents
    : [{ title: "Sem eventos", detail: "Nenhum alerta recente no escopo atual" }];

  list.innerHTML = events
    .map(
      (event) => `
        <article class="event">
          <strong>${event.title}</strong>
          <span>${event.detail}</span>
        </article>
      `
    )
    .join("");
}

async function createClient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const result = document.querySelector("#pairing-result");
  const tronsoft = currentUser.role === "tronsoft_admin";
  const selectedReseller = data.get("resellerId") === directTronsoftOption.id
    ? directTronsoftOption
    : currentResellers.find((reseller) => reseller.id === data.get("resellerId"));

  result.hidden = false;
  result.textContent = "Gerando token...";

  if (tronsoft && !selectedReseller) {
    result.textContent = "Cadastre ou selecione uma revenda antes de cadastrar o cliente.";
    return;
  }

  try {
    const payload = await api("/api/admin/clients", {
      method: "POST",
      body: JSON.stringify({
        reseller: tronsoft && selectedReseller
          ? {
              name: selectedReseller.name,
              document: selectedReseller.document,
              directTronsoft: Boolean(selectedReseller.directTronsoft)
            }
          : {
              name: data.get("resellerName"),
              document: data.get("resellerDocument")
            },
        customer: {
          name: data.get("customerName"),
          document: data.get("customerDocument"),
          city: data.get("customerCity"),
          state: data.get("customerState")
        }
      })
    });

    result.innerHTML = `
      <strong>Token gerado para ${escapeHtml(payload.client.name)}</strong><br>
      <code>${escapeHtml(payload.pairingToken.token)}</code>
    `;
    form.reset();
    await configureScopeControls();
    await loadCentralData();
  } catch (error) {
    result.textContent = error.message || "Nao foi possivel gerar o token.";
  }
}

function requestMaintenanceUpdate() {
  const result = document.querySelector("#maintenance-result");
  result.textContent = "Atualizacao automatica por botao ainda precisa de autorizacao explicita para executar script privilegiado no Debian.";
}

async function createReseller(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const result = document.querySelector("#reseller-result");

  result.hidden = false;
  result.textContent = "Salvando revenda...";

  try {
    const reseller = await api("/api/admin/resellers", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        document: data.get("document"),
        accessEmail: data.get("accessEmail"),
        password: data.get("password")
      })
    });

    result.innerHTML = `
      <strong>Revenda salva: ${escapeHtml(reseller.reseller.name)}</strong><br>
      <span>Acesso: ${escapeHtml(reseller.accessUser.email)}</span>
      ${reseller.temporaryPassword ? `<br><code>Senha temporaria: ${escapeHtml(reseller.temporaryPassword)}</code>` : ""}
    `;
    form.reset();
    await configureScopeControls();
    await loadCentralData();
  } catch (error) {
    result.textContent = error.message || "Nao foi possivel salvar a revenda.";
  }
}

document.querySelector("#login-form").addEventListener("submit", login);
document.querySelector("#logout-button").addEventListener("click", logout);
document.querySelector("#refresh-button").addEventListener("click", loadCentralData);
document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.viewTarget);
  });
});
document.querySelectorAll("[data-monitor-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    monitorFilter = button.dataset.monitorFilter;
    document.querySelectorAll("[data-monitor-filter]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    renderDashboardClients();
  });
});
document.querySelector("#reseller-filter").addEventListener("change", loadCentralData);
document.querySelector("#alert-filter").addEventListener("change", renderAlerts);
document.querySelector("#client-filter").addEventListener("input", (event) => {
  clientPage = 1;
  renderClients(event.target.value);
});
document.querySelector("#client-form").addEventListener("submit", createClient);
document.querySelector("#reseller-form").addEventListener("submit", createReseller);
document.querySelector("#maintenance-update-button").addEventListener("click", requestMaintenanceUpdate);

loadSession();
