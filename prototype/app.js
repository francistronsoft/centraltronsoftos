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
let currentUsers = [];
let currentOAuthSummary = null;
let usersLoaded = false;
let oauthSummaryScope = "";
let activeView = "dashboard";
let monitorFilter = "all";
let clientPage = 1;
let maintenanceJobId = null;
let maintenancePollTimer = null;
let geoLeafletMap = null;
let geoLeafletLayer = null;
let selectedClientId = "";
let previousDetailView = "clients";
let lastDataRefreshAt = null;
let dashboardRefreshTimer = null;
let refreshLabelTimer = null;
let dataLoadInFlight = false;
const clientsPageSize = 10;
const dashboardRefreshIntervalMs = 30_000;
const themeKey = "central-theme";

const viewTitles = {
  dashboard: "Monitoramento geral",
  resellers: "Revendas",
  users: "Usuarios",
  clients: "Clientes",
  installations: "Ambientes",
  alerts: "Alertas",
  oauth: "0auth",
  account: "Minha conta",
  "client-detail": "Detalhes do cliente",
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

const cityOptions = [
  ["Mafra", "SC"],
  ["Rio Negro", "PR"],
  ["Curitiba", "PR"],
  ["Joinville", "SC"],
  ["Florianopolis", "SC"],
  ["Sao Paulo", "SP"],
  ["Rio de Janeiro", "RJ"],
  ["Belo Horizonte", "MG"],
  ["Porto Alegre", "RS"],
  ["Brasilia", "DF"],
  ["Goiania", "GO"],
  ["Cuiaba", "MT"],
  ["Campo Grande", "MS"],
  ["Salvador", "BA"],
  ["Recife", "PE"],
  ["Fortaleza", "CE"],
  ["Natal", "RN"],
  ["Joao Pessoa", "PB"],
  ["Maceio", "AL"],
  ["Aracaju", "SE"],
  ["Teresina", "PI"],
  ["Sao Luis", "MA"],
  ["Belem", "PA"],
  ["Macapa", "AP"],
  ["Palmas", "TO"],
  ["Manaus", "AM"],
  ["Boa Vista", "RR"],
  ["Porto Velho", "RO"],
  ["Rio Branco", "AC"],
  ["Vitoria", "ES"]
];

function initials(value) {
  return String(value || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function svgIcon(path) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function iconRefresh() {
  return svgIcon('<path d="M21 12a9 9 0 0 0-15-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 15 6.7L21 16"></path><path d="M16 16h5v5"></path>');
}

function iconLogout() {
  return svgIcon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path>');
}

function iconMoon() {
  return svgIcon('<path d="M12 3a6 6 0 0 0 9 7.4A9 9 0 1 1 12 3z"></path>');
}

function iconSun() {
  return svgIcon('<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M6.34 17.66l-1.41 1.41"></path><path d="M19.07 4.93l-1.41 1.41"></path>');
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
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function backupAgeLabel(minutes) {
  if (minutes < 60) return `ha ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `ha ${hours} h`;
  return `ha ${hours} h ${rest} min`;
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
  const database = installation?.database || {};
  return database.versaoBanco
    || database.versao_banco
    || database.schemaVersion
    || database.schema_version
    || "-";
}

const stateCoordinates = {
  AC: [-9.97, -67.82],
  AL: [-9.65, -35.74],
  AP: [0.03, -51.05],
  AM: [-3.1, -60.02],
  BA: [-12.97, -38.5],
  CE: [-3.73, -38.53],
  DF: [-15.78, -47.93],
  ES: [-20.32, -40.34],
  GO: [-16.68, -49.25],
  MA: [-2.53, -44.3],
  MG: [-19.92, -43.94],
  MS: [-20.47, -54.62],
  MT: [-15.6, -56.1],
  PA: [-1.45, -48.5],
  PB: [-7.12, -34.86],
  PE: [-8.05, -34.9],
  PI: [-5.09, -42.8],
  PR: [-25.43, -49.27],
  RJ: [-22.91, -43.17],
  RN: [-5.79, -35.21],
  RO: [-8.76, -63.9],
  RR: [2.82, -60.67],
  RS: [-30.03, -51.23],
  SC: [-27.59, -48.55],
  SE: [-10.91, -37.07],
  SP: [-23.55, -46.63],
  TO: [-10.18, -48.33]
};

const cityCoordinates = {
  "serra|ES": [-20.13, -40.31],
  "mafra|SC": [-26.11, -49.8],
  "rio negro|PR": [-26.1, -49.8],
  "curitiba|PR": [-25.43, -49.27],
  "joinville|SC": [-26.3, -48.85],
  "florianopolis|SC": [-27.59, -48.55],
  "sao paulo|SP": [-23.55, -46.63],
  "rio de janeiro|RJ": [-22.91, -43.17],
  "belo horizonte|MG": [-19.92, -43.94],
  "porto alegre|RS": [-30.03, -51.23],
  "brasilia|DF": [-15.78, -47.93],
  "goiania|GO": [-16.68, -49.25],
  "cuiaba|MT": [-15.6, -56.1],
  "campo grande|MS": [-20.47, -54.62],
  "salvador|BA": [-12.97, -38.5],
  "recife|PE": [-8.05, -34.9],
  "fortaleza|CE": [-3.73, -38.53],
  "natal|RN": [-5.79, -35.21],
  "joao pessoa|PB": [-7.12, -34.86],
  "maceio|AL": [-9.65, -35.74],
  "aracaju|SE": [-10.91, -37.07],
  "teresina|PI": [-5.09, -42.8],
  "sao luis|MA": [-2.53, -44.3],
  "belem|PA": [-1.45, -48.5],
  "macapa|AP": [0.03, -51.05],
  "palmas|TO": [-10.18, -48.33],
  "manaus|AM": [-3.1, -60.02],
  "boa vista|RR": [2.82, -60.67],
  "porto velho|RO": [-8.76, -63.9],
  "rio branco|AC": [-9.97, -67.82],
  "vitoria|ES": [-20.32, -40.34]
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function copyTextToClipboard(value) {
  const text = String(value || "");
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

function normalizeState(value) {
  return String(value || "").trim().toUpperCase().slice(0, 2);
}

function normalizeLocationKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function clientLocation(client) {
  const city = client.city || client.customer?.city || "";
  const state = normalizeState(client.state || client.customer?.state || "");
  return { city, state };
}

function locationCoordinates(point) {
  const cityKey = `${normalizeLocationKey(point.city)}|${point.state}`;
  return cityCoordinates[cityKey] || stateCoordinates[point.state] || null;
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
  const restrictedViews = new Set(["resellers", "users", "maintenance"]);
  activeView = !tronsoft && restrictedViews.has(view) ? "clients" : view;

  document.querySelectorAll("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== activeView;
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    const isActive = button.dataset.viewTarget === activeView;
    button.classList.toggle("active", isActive);
  });
  document.querySelector("#page-title").textContent = viewTitles[activeView] || "Central";
  if (activeView === "dashboard" && geoLeafletMap) {
    setTimeout(() => geoLeafletMap.invalidateSize(), 80);
  }
  ensureActiveViewData();
}

async function ensureActiveViewData() {
  if (activeView === "users") await loadUsersIfNeeded();
  if (activeView === "oauth") await loadOAuthSummaryIfNeeded();
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
  const usersNav = document.querySelector('[data-view-target="users"]');
  const registrationsGroup = document.querySelector('[data-nav-group="registrations"]');
  const maintenanceNav = document.querySelector('[data-view-target="maintenance"]');
  const userResellerSelect = document.querySelector("#user-reseller-select");

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
  userResellerSelect.innerHTML = currentResellers
    .filter((reseller) => reseller.document !== directTronsoftOption.document && reseller.name.toLowerCase() !== "tronsoft")
    .map((reseller) => `<option value="${reseller.id}">${escapeHtml(reseller.name)}</option>`)
    .join("");

  const tronsoft = currentUser.role === "tronsoft_admin";
  filter.hidden = !tronsoft;
  resellerPanel.hidden = !tronsoft;
  resellersNav.hidden = !tronsoft;
  usersNav.hidden = !tronsoft;
  registrationsGroup.hidden = false;
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
  if (dataLoadInFlight) return;
  dataLoadInFlight = true;
  try {
    const [dashboard, registeredClients, installations, alerts] = await Promise.all([
      api(`/api/dashboard${querySuffix()}`),
      api(`/api/clients${querySuffix()}`),
      api(`/api/installations${querySuffix()}`),
      api(`/api/alerts${querySuffix()}`)
    ]);
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
          detailId: client.id,
          name: client.name,
          reseller: client.reseller?.name || "Sem revenda",
          rawClient: client,
          installation: null,
          city: client.city || "",
          state: normalizeState(client.state),
          environment: latestToken ? "Token gerado" : "Aguardando token",
          version: "Aguardando pareamento",
          database: "-",
          databaseInfo: {},
          host: {},
          backups: {},
          metrics: {},
          cluster: {},
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
        detailId: installation.installationId,
        name: client.name,
        reseller: client.reseller?.name || installation.reseller?.name || "Sem revenda",
        rawClient: client,
        installation,
        city: client.city || "",
        state: normalizeState(client.state),
        environment: installation.name,
        version: installation.tronsoftos?.version || "-",
        database: databaseVersion(installation),
        databaseInfo: installation.database || {},
        host: installation.host || {},
        backups: installation.backups || {},
        metrics: installation.metrics || {},
        cluster: installation.cluster || {},
        status: installation.status,
        lastSeen: formatDateTime(installation.lastSeenAt),
        lastSeenAt: installation.lastSeenAt || null,
        diskPercent: diskPercent(installation),
        backup: backupSummary(installation),
        alert: latestOpenAlertForClient(client.id),
        pairingToken: ""
      }));
    });

    currentAuthEvents = alerts.slice(-4).reverse().map((alert) => ({
      title: alert.title,
      detail: `${alert.severity} - ${alert.message || alert.code || "Sem detalhes"}`,
      occurredAt: alert.openedAt || alert.receivedAt || alert.createdAt || alert.resolvedAt || null
    }));

    renderMetrics(dashboard);
    renderClients(document.querySelector("#client-filter").value);
    renderDashboardClients();
    renderGeoMap();
    renderAuthEvents();
    renderAlerts();
    await ensureActiveViewData();
    if (activeView === "client-detail" && selectedClientId) {
      const selected = currentClients.find((client) => client.detailId === selectedClientId || client.id === selectedClientId);
      if (selected) renderClientDetail(selected);
    }
    lastDataRefreshAt = new Date();
    updateRefreshLabel();
  } finally {
    dataLoadInFlight = false;
  }
}

function updateRefreshLabel() {
  const label = document.querySelector("#last-refresh-label");
  if (!label) return;
  label.textContent = lastDataRefreshAt
    ? `Ultima atualizacao ${formatRelativeTime(lastDataRefreshAt.toISOString())}`
    : "Aguardando atualizacao";
}

function startDashboardAutoRefresh() {
  if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
  if (refreshLabelTimer) clearInterval(refreshLabelTimer);
  dashboardRefreshTimer = setInterval(() => {
    if (currentUser) loadCentralData().catch(showError);
  }, dashboardRefreshIntervalMs);
  refreshLabelTimer = setInterval(updateRefreshLabel, 30_000);
}

async function loadUsersIfNeeded(force = false) {
  if (currentUser?.role !== "tronsoft_admin") return;
  if (usersLoaded && !force) {
    renderUsers();
    return;
  }
  currentUsers = await api("/api/users");
  usersLoaded = true;
  renderUsers();
}

async function loadOAuthSummaryIfNeeded(force = false) {
  const scope = querySuffix();
  if (currentOAuthSummary && oauthSummaryScope === scope && !force) {
    renderOAuthSummary();
    return;
  }
  currentOAuthSummary = await api(`/api/oauth/google/summary${scope}`);
  oauthSummaryScope = scope;
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
  if (minutes <= 360) return { label: `Backup ${backupAgeLabel(minutes)}`, tone: "online", detail: formatRelativeTime(latest) };
  return { label: `Atrasado ${backupAgeLabel(minutes)}`, tone: "warning", detail: formatRelativeTime(latest) };
}

function monitorStatus(client) {
  if (client.status === "offline") return "offline";
  const alert = latestOpenAlertForClient(client.id);
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
      const indexStatus = indexHealthStatus(client);
      const pairingToken = client.pairingToken
        ? `<br><span class="token-copy-wrap"><span class="token-cell">${escapeHtml(client.pairingToken)}</span><button class="token-copy-button" type="button" data-copy-token="${escapeHtml(client.pairingToken)}" title="Copiar token">Copiar</button></span>`
        : "";
      return `
        <tr class="clickable-row" data-client-detail="${escapeHtml(client.detailId)}">
          <td>${escapeHtml(client.name)}<br><span class="muted-cell">${escapeHtml(location)}</span></td>
          <td>${escapeHtml(client.reseller)}</td>
          <td>${escapeHtml(client.environment)}${pairingToken}</td>
          <td>${escapeHtml(client.version)}<br><span class="muted-cell">${escapeHtml(client.database || "-")}</span></td>
          <td><span class="index-pill ${escapeHtml(indexStatus.tone)}">${escapeHtml(indexStatus.shortLabel || indexStatus.label)}</span></td>
          <td><span class="status ${escapeHtml(client.status)}">${escapeHtml(statusLabels[client.status] || client.status)}</span></td>
          <td>${escapeHtml(client.lastSeen)}</td>
        </tr>
      `;
    })
    .join("") || `
      <tr>
        <td colspan="7" class="empty-cell">Nenhum cliente encontrado neste escopo.</td>
      </tr>
    `;
  renderClientPagination(visibleClients.length, totalPages);
  table.querySelectorAll("[data-client-detail]").forEach((row) => {
    row.addEventListener("click", () => openClientDetail(row.dataset.clientDetail, "clients"));
  });
  table.querySelectorAll("[data-copy-token]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const label = button.textContent;
      try {
        const copied = await copyTextToClipboard(button.dataset.copyToken);
        button.textContent = copied ? "Copiado" : "Falhou";
      } catch {
        button.textContent = "Falhou";
      }
      setTimeout(() => {
        button.textContent = label;
      }, 1400);
    });
  });
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
      const detail = client.alert?.message || client.alert?.title || "";
      const indexStatus = indexHealthStatus(client);
      return `
        <article class="monitor-row clickable-row" data-client-detail="${escapeHtml(client.detailId)}">
          <div class="monitor-client" data-label="Cliente">
            <span class="client-avatar">${escapeHtml(initials(client.name))}</span>
            <div>
              <strong>${escapeHtml(client.name)}</strong>
              ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
            </div>
          </div>
          <div data-label="Revenda">${escapeHtml(client.reseller)}</div>
          <div class="database-cell" data-label="Banco">
            <strong>${escapeHtml(client.database || "-")}</strong>
            <small>versao_banco</small>
          </div>
          <div data-label="Indices"><span class="index-pill ${escapeHtml(indexStatus.tone)}">${escapeHtml(indexStatus.shortLabel || indexStatus.label)}</span></div>
          <div class="status-cell" data-label="Status">
            <span class="status ${escapeHtml(status)}">${escapeHtml(statusLabels[status] || status)}</span>
            <small>${escapeHtml(client.lastSeenAt ? `Ultima atualizacao ${formatRelativeTime(client.lastSeenAt)}` : "sem atualizacao")}</small>
          </div>
          <div class="disk-cell" data-label="Disco">
            <strong>${disk === null ? "--" : `${disk}%`}</strong>
            <span class="disk-bar"><span class="${escapeHtml(diskTone)}" style="width:${disk === null ? 0 : Math.min(100, disk)}%"></span></span>
            ${disk === null ? `<small>sem dados</small>` : ""}
          </div>
          <div data-label="Backup"><span class="backup-pill ${escapeHtml(client.backup.tone)}">${escapeHtml(client.backup.label)}</span></div>
        </article>
      `;
    })
    .join("") || `<div class="empty-monitor">Nenhum cliente neste filtro.</div>`;
  list.querySelectorAll("[data-client-detail]").forEach((row) => {
    row.addEventListener("click", () => openClientDetail(row.dataset.clientDetail, "dashboard"));
  });
}

function valueOrDash(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function bytesLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = number;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function databaseSizeLabel(database = {}) {
  if (database.fileSizeBytes) return bytesLabel(database.fileSizeBytes);
  if (database.sizeMb) return `${database.sizeMb} MB`;
  return "-";
}

function isRcloneAlert(alert = {}) {
  const text = `${alert.code || ""} ${alert.title || ""} ${alert.message || ""}`.toLowerCase();
  return text.includes("rclone");
}

function isCommonIndexAlert(alert = {}) {
  const text = `${alert.code || ""} ${alert.title || ""} ${alert.message || ""}`.toLowerCase();
  return text.includes("indices comuns") || text.includes("indices inativo") || text.includes("indice(s) inativo");
}

function isVisibleAlert(alert = {}) {
  return !isRcloneAlert(alert) && !isCommonIndexAlert(alert);
}

function indexHealthStatus(client) {
  const health = client.databaseInfo?.indexHealth;
  const alert = currentAlerts.find((item) => {
    const text = `${item.code || ""} ${item.title || ""} ${item.message || ""}`.toLowerCase();
    return item.clientId === client.id
      && item.status !== "resolved"
      && isVisibleAlert(item)
      && (text.includes("indice") || text.includes("index"));
  });
  const severity = String(health?.severity || health?.status || "").toLowerCase();
  const inactive = Number(health?.inactiveIndexes ?? health?.inactive ?? health?.disabledIndexes ?? 0);
  const missing = Number(health?.missingIndexes ?? health?.withoutIndexes ?? health?.semIndice ?? 0);
  const missingCriticalTables = Array.isArray(health?.missingActiveTables) ? health.missingActiveTables : [];
  const active = health?.activeIndexes ?? health?.active ?? "-";
  const total = health?.totalIndexes ?? health?.total ?? "-";
  const hasSummary = health && (
    health.checkedAt
    || health.collectedAt
    || Number.isFinite(Number(total))
    || Number.isFinite(Number(active))
    || Number.isFinite(inactive)
    || severity
  );
  if (missingCriticalTables.length > 0 || missing > 0) {
    return {
      label: "Banco sem indice",
      shortLabel: "Sem indice",
      tone: "offline",
      detail: missingCriticalTables.length > 0
        ? `${missingCriticalTables.length} tabela(s) critica(s): ${missingCriticalTables.slice(0, 4).join(", ")}`
        : `${missing} indice(s) ausente(s)`
    };
  }
  if (hasSummary && alert) {
    return {
      label: "Indice em atencao",
      shortLabel: "Atencao",
      tone: "warning",
      detail: alert?.message || `${active} / ${total} ativos`
    };
  }
  if (hasSummary && (severity === "ok" || severity === "info" || Number.isFinite(Number(total)))) {
    return { label: "Indices OK", shortLabel: "OK", tone: "online", detail: `${active} / ${total} ativos` };
  }
  if (hasSummary) {
    return { label: "Indices OK", shortLabel: "OK", tone: "online", detail: `${active} ativo(s)` };
  }
  return { label: "Nao informado", shortLabel: "Sem leitura", tone: "unknown", detail: "sem leitura do TronFire" };
}

function detailItem(label, value) {
  return `
    <div class="detail-kv">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(valueOrDash(value))}</strong>
    </div>
  `;
}

function gaugeValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

function detailGauge(label, value, tone = "online", caption = "") {
  const percent = gaugeValue(value);
  const display = percent === null ? "--" : `${percent}%`;
  return `
    <article class="ops-gauge ${escapeHtml(tone)}" style="--value:${percent ?? 0}">
      <div class="gauge-ring"><strong>${escapeHtml(display)}</strong></div>
      <div>
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml(caption || "sem leitura historica")}</small>
      </div>
    </article>
  `;
}

function detailMetric(title, value, tone = "neutral", caption = "") {
  return `
    <article class="ops-metric ${escapeHtml(tone)}">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(valueOrDash(value))}</strong>
      <small>${escapeHtml(caption)}</small>
    </article>
  `;
}

function miniBars(seed, tone = "online") {
  const base = Number.isFinite(Number(seed)) ? Number(seed) : 42;
  const bars = Array.from({ length: 18 }, (_, index) => {
    const value = Math.max(12, Math.min(92, Math.round((Math.sin(index * 1.7 + base) + 1) * 26 + (base % 35))));
    return `<span style="height:${value}%"></span>`;
  }).join("");
  return `<div class="mini-bars ${escapeHtml(tone)}">${bars}</div>`;
}

function weekKey(date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
  return `${copy.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function databaseGrowthSeries(database = {}) {
  const history = Array.isArray(database.history) ? database.history : [];
  const points = history
    .map((item) => {
      const rawDate = String(item.date || item.sampledAt || "");
      const date = rawDate.includes("T") ? new Date(rawDate) : new Date(`${rawDate}T00:00:00Z`);
      return {
        date,
        sizeMb: Number(item.sizeMb)
      };
    })
    .filter((item) => Number.isFinite(item.date.getTime()) && Number.isFinite(item.sizeMb) && item.sizeMb > 0)
    .sort((a, b) => a.date - b.date);

  if (points.length < 2) {
    return { mode: "historico", points: [], currentSize: databaseSizeLabel(database), deltaMb: null };
  }

  const spanDays = Math.max(1, Math.round((points.at(-1).date - points[0].date) / 86400000));
  const mode = spanDays > 120 ? "mes" : "semana";
  const buckets = new Map();
  points.forEach((point) => {
    const key = mode === "mes" ? monthKey(point.date) : weekKey(point.date);
    buckets.set(key, point);
  });
  const grouped = [...buckets.entries()].map(([label, point]) => ({ label, sizeMb: point.sizeMb }));
  const visible = grouped.slice(-12);
  return {
    mode,
    points: visible,
    currentSize: databaseSizeLabel(database),
    deltaMb: visible.length >= 2 ? visible.at(-1).sizeMb - visible[0].sizeMb : null
  };
}

function databaseGrowthChart(database = {}) {
  const series = databaseGrowthSeries(database);
  if (series.points.length < 2) {
    return `
      <div class="metric-empty growth-empty">
        <strong>${escapeHtml(series.currentSize)}</strong>
        <span>aguardando historico semanal/mensal</span>
      </div>
    `;
  }
  const max = Math.max(...series.points.map((point) => point.sizeMb));
  const min = Math.min(...series.points.map((point) => point.sizeMb));
  const range = Math.max(1, max - min);
  const bars = series.points.map((point) => {
    const height = Math.max(12, Math.round(((point.sizeMb - min) / range) * 72) + 20);
    return `<span title="${escapeHtml(point.label)} - ${escapeHtml(point.sizeMb.toFixed(1))} MB" style="height:${height}%"><small>${escapeHtml(point.label.replace("-", "/"))}</small></span>`;
  }).join("");
  const delta = series.deltaMb;
  const deltaText = Number.isFinite(delta)
    ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} MB no periodo`
    : "sem variacao calculada";
  return `
    <div class="mini-bars growth-bars">${bars}</div>
    <div class="trend-caption">
      <strong>${escapeHtml(series.currentSize)}</strong>
      <span>${escapeHtml(series.mode === "mes" ? "progressao mensal" : "progressao semanal")} - ${escapeHtml(deltaText)}</span>
    </div>
  `;
}

function metricSeriesValues(metrics = {}, valueKeys = [], patterns = []) {
  const systemMetrics = metrics.systemMetrics || metrics;
  const latestRows = Array.isArray(systemMetrics.latest) ? systemMetrics.latest : systemMetrics.latest ? [systemMetrics.latest] : [];
  const fallbackRows = Array.isArray(metrics.series) ? metrics.series : [];
  const rows = Array.isArray(systemMetrics.series) && systemMetrics.series.length ? systemMetrics.series : [...latestRows, ...fallbackRows];
  const values = rows.filter((metric) => {
    if (!patterns.length) return true;
    const text = `${metric.scope || ""} ${metric.target || ""} ${metric.name || ""} ${metric.key || ""}`.toLowerCase();
    return patterns.some((pattern) => text.includes(pattern));
  }).map((metric) => {
    const keyValue = valueKeys.map((key) => Number(metric[key])).find(Number.isFinite);
    const value = Number.isFinite(keyValue) ? keyValue : Number(metric.value ?? metric.percent ?? metric.valueNumber ?? metric.avg ?? metric.usedPercent);
    const dateValue = metric.createdAt || metric.collectedAt || metric.timestamp || metric.time || metric.readAt;
    const date = dateValue ? new Date(dateValue) : null;
    const label = date && Number.isFinite(date.getTime())
      ? date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "sem horario";
    return { value, label };
  }).filter((point) => Number.isFinite(point.value));
  return values.slice(-18);
}

function metricBars(values, tone = "online") {
  if (!values.length) return `<div class="metric-empty">sem serie historica</div>`;
  const points = values.map((point) => typeof point === "number" ? { value: point, label: "sem horario" } : point);
  const max = Math.max(100, ...points.map((point) => point.value));
  const peak = points.reduce((highest, point) => point.value > highest.value ? point : highest, points[0]);
  const latest = points[points.length - 1];
  const bars = points.map((point) => {
    const height = Math.max(8, Math.min(96, Math.round((point.value / max) * 96)));
    return `<span title="${escapeHtml(point.label)} - ${escapeHtml(point.value.toFixed(1))}%" style="height:${height}%"></span>`;
  }).join("");
  return `
    <div class="mini-bars ${escapeHtml(tone)}">${bars}</div>
    <div class="metric-chart-caption">
      <span>Pico ${escapeHtml(peak.value.toFixed(1))}% em ${escapeHtml(peak.label)}</span>
      <span>Ultima ${escapeHtml(latest.value.toFixed(1))}% em ${escapeHtml(latest.label)}</span>
    </div>
  `;
}

function renderBackupFiles(files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return `<p class="empty-note">Nenhum arquivo de backup recente informado.</p>`;
  }
  return files.slice(0, 6).map((file) => `
    <article class="detail-list-item">
      <strong>${escapeHtml(file.name || file.path || "Backup")}</strong>
      <span>${escapeHtml(file.modifiedAt ? formatRelativeTime(file.modifiedAt) : "-")} ${file.size ? `- ${escapeHtml(bytesLabel(file.size))}` : ""}</span>
    </article>
  `).join("");
}

function renderClientAlerts(client) {
  const alerts = currentAlerts.filter((alert) => alert.clientId === client.id && isVisibleAlert(alert)).slice(0, 8);
  if (alerts.length === 0) return `<p class="empty-note">Nenhum alerta recente para este cliente.</p>`;
  return alerts.map((alert) => `
    <article class="detail-list-item ${escapeHtml(alert.severity || "info")}">
      <strong>${escapeHtml(alert.title || alert.code || "Alerta")}</strong>
      <span>${escapeHtml(severityLabels[alert.severity] || alert.severity)} - ${escapeHtml(alert.status === "resolved" ? "Resolvido" : "Aberto")} - ${escapeHtml(formatRelativeTime(alert.openedAt))}</span>
      ${alert.message ? `<small>${escapeHtml(alert.message)}</small>` : ""}
    </article>
  `).join("");
}

function renderClientDetail(client) {
  const status = monitorStatus(client);
  const statusTone = status === "offline" ? "offline" : status === "warning" ? "warning" : status === "online" ? "online" : "unknown";
  const database = client.databaseInfo || {};
  const host = client.host || {};
  const backups = client.backups || {};
  const metrics = client.metrics || {};
  const cluster = client.cluster || {};
  const location = [client.city, client.state].filter(Boolean).join(" / ") || "-";
  const disk = gaugeValue(client.diskPercent);
  const diskTone = disk === null ? "unknown" : disk >= 90 ? "offline" : disk >= 75 ? "warning" : "online";
  const backupDisk = gaugeValue(backups.disk?.percentUsed);
  const drive = gaugeValue(backups.quota?.percentUsed);
  const heartbeatAge = client.lastSeenAt ? formatRelativeTime(client.lastSeenAt) : "sem heartbeat";
  const openAlerts = currentAlerts.filter((alert) => alert.clientId === client.id && alert.status !== "resolved").length;
  const indexStatus = indexHealthStatus(client);
  const databaseSize = databaseSizeLabel(database);
  const cpuSeries = metricSeriesValues(metrics, ["cpuPercent", "cpu", "cpu_percent", "processorPercent"]);
  const memorySeries = metricSeriesValues(metrics, ["memoryPercent", "memPercent", "memory", "memory_percent", "ramPercent"]);

  document.querySelector("#client-detail-title").textContent = client.name;
  document.querySelector("#client-detail-subtitle").textContent = `${client.reseller} - ${location}`;
  document.querySelector("#client-detail-content").innerHTML = `
    <section class="ops-hero ${escapeHtml(statusTone)}">
      <div>
        <span class="ops-eyebrow">Visao operacional</span>
        <h3>${escapeHtml(client.name)}</h3>
        <p>${escapeHtml(client.reseller)} - ${escapeHtml(location)} - ${escapeHtml(client.environment)}</p>
      </div>
      <div class="ops-hero-actions">
        <span class="ops-status ${escapeHtml(statusTone)}">${escapeHtml(statusLabels[status] || status)}</span>
        <button class="secondary-button" type="button" onclick="document.querySelector('#refresh-button').click()">Atualizar</button>
      </div>
    </section>

    <section class="ops-metrics">
      ${detailMetric("Heartbeat", heartbeatAge, statusTone, client.lastSeen)}
      ${detailMetric("Alertas abertos", openAlerts, openAlerts > 0 ? "warning" : "online", "eventos ativos")}
      ${detailMetric("Banco", client.database, "neutral", "versao_banco")}
      ${detailMetric("Backup", client.backup.label, client.backup.tone, client.backup.detail)}
    </section>

    <section class="ops-grid">
      <article class="ops-panel ops-panel-wide">
        <div class="ops-panel-head">
          <div>
            <h3>Saude do ambiente</h3>
            <span>${escapeHtml(host.hostname || "hostname nao informado")} - ${escapeHtml(host.ip || "ip nao informado")}</span>
          </div>
          <span class="ops-chip ${escapeHtml(statusTone)}">${escapeHtml(client.version)}</span>
        </div>
        <div class="gauge-grid">
          ${detailGauge("Disco servidor", disk, diskTone, "uso geral informado")}
          ${detailGauge("Disco backup", backupDisk, backupDisk >= 90 ? "offline" : backupDisk >= 75 ? "warning" : "online", backups.backupDir || "diretorio de backup")}
          ${detailGauge("Google Drive", drive, drive >= 90 ? "offline" : drive >= 75 ? "warning" : "online", backups.quota?.error || "quota remota")}
        </div>
      </article>

      <article class="ops-panel">
        <div class="ops-panel-head">
          <div>
            <h3>Crescimento do banco</h3>
            <span>progressao por semana ou mes</span>
          </div>
        </div>
        ${databaseGrowthChart(database)}
      </article>

      <article class="ops-panel">
        <div class="ops-panel-head">
          <div>
            <h3>CPU / Memoria</h3>
            <span>horarios de maior consumo</span>
          </div>
        </div>
        <div class="metric-chart-label">CPU</div>
        ${metricBars(cpuSeries, "warning")}
        <div class="metric-chart-label">Memoria</div>
        ${metricBars(memorySeries, "online")}
      </article>

      <article class="ops-panel">
        <div class="ops-panel-head">
          <div>
            <h3>Acoes de suporte</h3>
            <span>decisao rapida</span>
          </div>
        </div>
        <div class="support-actions">
          <button class="secondary-button" type="button" onclick="document.querySelector('[data-view-target=&quot;alerts&quot;]').click()">Ver alertas</button>
          <button class="secondary-button" type="button" onclick="document.querySelector('[data-view-target=&quot;clients&quot;]').click()">Lista clientes</button>
          <button class="secondary-button" type="button" onclick="document.querySelector('[data-view-target=&quot;oauth&quot;]').click()">0auth</button>
        </div>
      </article>
    </section>

    <section class="ops-grid">
      <article class="ops-panel">
        <div class="ops-panel-head"><h3>Servidor</h3></div>
        <div class="detail-grid compact">
          ${detailItem("Hostname", host.hostname)}
          ${detailItem("IP", host.ip)}
          ${detailItem("Sistema", host.os)}
          ${detailItem("Uptime", metrics.hostUptimeSeconds ? `${Math.round(Number(metrics.hostUptimeSeconds) / 3600)} h` : "-")}
        </div>
      </article>

      <article class="ops-panel">
        <div class="ops-panel-head"><h3>Banco de dados</h3></div>
        <div class="detail-grid compact">
          ${detailItem("Engine", database.engine || "Firebird")}
          ${detailItem("Firebird", database.version)}
          ${detailItem("versao_banco", client.database)}
          ${detailItem("Tamanho", databaseSize)}
          ${detailItem("Indices", indexStatus.label)}
          ${detailItem("Detalhe indice", indexStatus.detail)}
          ${detailItem("Alias", database.alias || database.databaseAlias)}
        </div>
      </article>
    </div>

    <section class="ops-grid">
      <article class="ops-panel">
        <div class="ops-panel-head"><h3>Backups recentes</h3><span>${escapeHtml(client.backup.label)}</span></div>
        <div class="detail-list">${renderBackupFiles(backups.recentFiles)}</div>
      </article>

      <article class="ops-panel">
        <div class="ops-panel-head"><h3>HA / Standby</h3><span>alta disponibilidade</span></div>
        <div class="detail-grid compact">
          ${detailItem("Modo", cluster.mode)}
          ${detailItem("No", cluster.identity?.nodeRole || cluster.nodeRole)}
          ${detailItem("Standby pronto", cluster.sync?.standbyReady === true ? "Sim" : cluster.sync?.standbyReady === false ? "Nao" : "-")}
          ${detailItem("Lag standby", cluster.sync?.standbyLagMinutes !== undefined ? `${cluster.sync.standbyLagMinutes} min` : "-")}
          ${detailItem("Failover", cluster.failover?.enabled === true ? "Ativo" : cluster.failover?.enabled === false ? "Manual/desativado" : "-")}
          ${detailItem("VIP", cluster.vipStatus?.ip || cluster.vip || "-")}
        </div>
      </article>
    </section>

    <section class="ops-panel">
      <div class="ops-panel-head"><h3>Alertas e eventos</h3></div>
      <div class="detail-list alerts-detail">${renderClientAlerts(client)}</div>
    </section>
  `;
}

function openClientDetail(clientId, fromView = activeView) {
  const client = currentClients.find((item) => item.detailId === clientId || item.id === clientId);
  if (!client) return;
  selectedClientId = clientId;
  previousDetailView = fromView === "client-detail" ? "clients" : fromView;
  renderClientDetail(client);
  showView("client-detail");
}

function closeClientDetail() {
  showView(previousDetailView || "clients");
}

function setupCityOptions() {
  const list = document.querySelector("#city-options");
  if (!list) return;
  list.innerHTML = cityOptions
    .map(([city, state]) => `<option value="${escapeHtml(city)} / ${escapeHtml(state)}"></option>`)
    .join("");
}

function normalizeCitySelection(formData) {
  const rawCity = String(formData.get("customerCity") || "").trim();
  const rawState = String(formData.get("customerState") || "").trim();
  const match = rawCity.match(/^(.+?)\s*\/\s*([A-Za-z]{2})$/);
  if (!match) {
    return { city: rawCity, state: rawState };
  }
  return {
    city: match[1].trim(),
    state: match[2].trim().toUpperCase()
  };
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
    .filter(isVisibleAlert)
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

function resellerNameById(id) {
  return currentResellers.find((reseller) => reseller.id === id)?.name || "TronSoft";
}

function renderUsers() {
  const list = document.querySelector("#users-list");
  if (!list) return;

  list.innerHTML = currentUsers
    .map((user) => `
      <article class="compact-item user-item">
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <span>${escapeHtml(user.email)}</span>
          <span>${user.role === "tronsoft_admin" ? "TronSoft" : `Revenda: ${escapeHtml(resellerNameById(user.resellerId))}`}</span>
        </div>
        <button class="secondary-button" type="button" data-password-user="${escapeHtml(user.id)}">Senha</button>
      </article>
    `)
    .join("") || `<p class="empty-note">Nenhum usuario cadastrado.</p>`;

  list.querySelectorAll("[data-password-user]").forEach((button) => {
    button.addEventListener("click", () => resetUserPassword(button.dataset.passwordUser));
  });
}

function renderGeoMap() {
  const map = document.querySelector("#geo-map");
  const list = document.querySelector("#geo-list");
  const groups = new Map();

  currentClients.forEach((client) => {
    const { city, state } = clientLocation(client);
    if (!state || !stateCoordinates[state]) return;
    const key = `${state}|${city || "Sem cidade"}`;
    const current = groups.get(key) || { state, city: city || "Sem cidade", count: 0, online: 0, warning: 0 };
    current.count += 1;
    if (client.status === "online") current.online += 1;
    if (client.status === "warning") current.warning += 1;
    groups.set(key, current);
  });

  const points = [...groups.values()].sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
  if (!window.L) {
    map.innerHTML = `<div class="map-unavailable">Mapa indisponivel. Verifique a conexao com o provedor de mapas.</div>`;
  } else {
    if (!geoLeafletMap) {
      map.innerHTML = `<div id="client-leaflet-map" class="leaflet-map" aria-label="Mapa de clientes"></div>`;
      geoLeafletMap = L.map("client-leaflet-map", {
        zoomControl: true,
        scrollWheelZoom: true
      }).setView([-14.24, -51.93], 4);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap"
      }).addTo(geoLeafletMap);
      geoLeafletLayer = L.layerGroup().addTo(geoLeafletMap);
    }

    geoLeafletLayer.clearLayers();

    const bounds = [];
    points.forEach((point) => {
      const coordinates = locationCoordinates(point);
      if (!coordinates) return;
      const tone = point.warning > 0 ? "warning" : "online";
      const icon = L.divIcon({
        className: `client-map-marker ${tone}`,
        html: `<span>${point.count}</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -30]
      });
      L.marker(coordinates, { icon })
        .bindPopup(`
          <strong>${escapeHtml(point.city)} / ${escapeHtml(point.state)}</strong><br>
          ${point.count} cliente(s)<br>
          ${point.online} online, ${point.warning} em atencao
        `)
        .addTo(geoLeafletLayer);
      bounds.push(coordinates);
    });

    if (bounds.length > 0) {
      geoLeafletMap.fitBounds(bounds, { padding: [44, 44], maxZoom: 11 });
    } else {
      geoLeafletMap.setView([-14.24, -51.93], 4);
    }
    setTimeout(() => geoLeafletMap.invalidateSize(), 80);
  }

  list.innerHTML = points
    .map((point) => `
      <article class="geo-item">
        <strong>${escapeHtml(point.city)} / ${escapeHtml(point.state)}</strong>
        <span>${point.count} cliente(s), ${point.online} online, ${point.warning} em atencao</span>
      </article>
    `)
    .join("") || `<p class="empty-note">Cadastre clientes com cidade e UF para popular o mapa.</p>`;
}

function applyTheme(theme) {
  const resolved = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  localStorage.setItem(themeKey, resolved);
  const button = document.querySelector("#theme-toggle-button");
  if (button) {
    button.innerHTML = resolved === "dark" ? iconSun() : iconMoon();
    button.title = resolved === "dark" ? "Usar tema claro" : "Usar tema escuro";
    button.setAttribute("aria-label", button.title);
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
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
    : [{ title: "Sem eventos", detail: "Nenhum alerta recente no escopo atual", occurredAt: null }];

  list.innerHTML = events
    .map(
      (event) => `
        <article class="event">
          <strong>${event.title}</strong>
          ${event.occurredAt ? `<small>${escapeHtml(formatDateTime(event.occurredAt))}</small>` : ""}
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
  const location = normalizeCitySelection(data);
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
          city: location.city,
          state: location.state
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

function renderMaintenanceJob(job) {
  const result = document.querySelector("#maintenance-result");
  const button = document.querySelector("#maintenance-update-button");
  const output = [job.stdout, job.stderr].filter(Boolean).join("\n").trim();
  button.disabled = job.status === "running";
  result.className = `maintenance-result ${escapeHtml(job.status)}`;
  result.innerHTML = `
    <div class="maintenance-status">
      <strong>${job.status === "running" ? "Executando atualizacao" : job.status === "success" ? "Atualizacao concluida" : "Atualizacao falhou"}</strong>
      <span>${job.finishedAt ? formatDateTime(job.finishedAt) : "Aguardando conclusao..."}</span>
    </div>
    ${job.error ? `<p>${escapeHtml(job.error)}</p>` : ""}
    <pre>${escapeHtml(output || "Aguardando saida do comando...")}</pre>
  `;
}

async function pollMaintenanceJob() {
  if (!maintenanceJobId) return;
  try {
    const job = await api(`/api/maintenance/jobs/${maintenanceJobId}`);
    renderMaintenanceJob(job);
    if (job.status === "running") {
      maintenancePollTimer = setTimeout(pollMaintenanceJob, 2000);
      return;
    }
    maintenanceJobId = null;
  } catch (error) {
    const result = document.querySelector("#maintenance-result");
    result.className = "maintenance-result failed";
    result.textContent = error.message || "Nao foi possivel consultar a atualizacao.";
  }
}

async function requestMaintenanceUpdate() {
  const result = document.querySelector("#maintenance-result");
  const button = document.querySelector("#maintenance-update-button");
  if (!confirm("Atualizar a Central pelo Git agora? O servico pode reiniciar ao concluir.")) return;
  button.disabled = true;
  result.className = "maintenance-result running";
  result.innerHTML = "<strong>Iniciando atualizacao...</strong>";
  if (maintenancePollTimer) clearTimeout(maintenancePollTimer);

  try {
    const payload = await api("/api/maintenance/update", { method: "POST" });
    maintenanceJobId = payload.job.id;
    renderMaintenanceJob(payload.job);
    maintenancePollTimer = setTimeout(pollMaintenanceJob, 1500);
  } catch (error) {
    button.disabled = false;
    result.className = "maintenance-result failed";
    result.textContent = error.message || "Nao foi possivel iniciar a atualizacao.";
  }
}

function renderPasswordResult(container, payload, defaultMessage) {
  container.hidden = false;
  const mailLink = payload.email?.mailto
    ? `<br><a class="text-link" href="${escapeHtml(payload.email.mailto)}">Abrir email para ${escapeHtml(payload.email.to)}</a>`
    : "";
  container.innerHTML = `
    <strong>${escapeHtml(defaultMessage)}</strong>
    ${payload.temporaryPassword ? `<br><code>Senha temporaria: ${escapeHtml(payload.temporaryPassword)}</code>` : ""}
    ${mailLink}
  `;
}

async function createUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const result = document.querySelector("#user-result");
  const role = data.get("role");

  result.hidden = false;
  result.textContent = "Salvando usuario...";

  try {
    const payload = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        email: data.get("email"),
        role,
        resellerId: role === "reseller_user" ? data.get("resellerId") : "",
        password: data.get("password"),
        sendEmail: data.get("sendEmail") === "on"
      })
    });
    renderPasswordResult(result, payload, `Usuario salvo: ${payload.user.email}`);
    form.reset();
    updateUserRoleFields();
    usersLoaded = false;
    await configureScopeControls();
    await loadUsersIfNeeded(true);
  } catch (error) {
    result.textContent = error.message || "Nao foi possivel salvar o usuario.";
  }
}

async function resetUserPassword(userId) {
  const user = currentUsers.find((item) => item.id === userId);
  if (!user) return;
  const password = prompt(`Nova senha para ${user.email}. Deixe em branco para gerar automaticamente:`);
  if (password === null) return;
  const sendEmail = confirm("Preparar envio por email com a nova senha?");
  const result = document.querySelector("#user-result");
  result.hidden = false;
  result.textContent = "Atualizando senha...";

  try {
    const payload = await api(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
      method: "POST",
      body: JSON.stringify({ password, sendEmail })
    });
    renderPasswordResult(result, payload, `Senha atualizada: ${payload.user.email}`);
    await loadUsersIfNeeded(true);
  } catch (error) {
    result.textContent = error.message || "Nao foi possivel alterar a senha.";
  }
}

async function changeOwnPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const result = document.querySelector("#account-result");
  const newPassword = String(data.get("newPassword") || "");

  result.hidden = false;
  if (newPassword !== String(data.get("confirmPassword") || "")) {
    result.textContent = "A confirmacao nao confere com a nova senha.";
    return;
  }

  result.textContent = "Alterando senha...";
  try {
    await api("/api/account/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: data.get("currentPassword"),
        newPassword
      })
    });
    result.innerHTML = "<strong>Senha alterada com sucesso.</strong>";
    form.reset();
  } catch (error) {
    result.textContent = error.message || "Nao foi possivel alterar a senha.";
  }
}

function updateUserRoleFields() {
  const role = document.querySelector("#user-role-select").value;
  const resellerSelect = document.querySelector("#user-reseller-select");
  resellerSelect.hidden = role !== "reseller_user";
  resellerSelect.required = role === "reseller_user";
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
        document: data.get("document")
      })
    });

    result.innerHTML = `
      <strong>Revenda salva: ${escapeHtml(reseller.reseller.name)}</strong><br>
      <span>Cadastre o usuario da revenda no menu Usuarios.</span>
    `;
    form.reset();
    usersLoaded = false;
    currentOAuthSummary = null;
    oauthSummaryScope = "";
    await configureScopeControls();
    await loadCentralData();
  } catch (error) {
    result.textContent = error.message || "Nao foi possivel salvar a revenda.";
  }
}

document.querySelector("#login-form").addEventListener("submit", login);
document.querySelector("#logout-button").addEventListener("click", logout);
document.querySelector("#refresh-button").addEventListener("click", loadCentralData);
document.querySelector("#theme-toggle-button").addEventListener("click", toggleTheme);
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
document.querySelector("#reseller-filter").addEventListener("change", () => {
  currentOAuthSummary = null;
  oauthSummaryScope = "";
  loadCentralData();
});
document.querySelector("#alert-filter").addEventListener("change", renderAlerts);
document.querySelector("#client-filter").addEventListener("input", (event) => {
  clientPage = 1;
  renderClients(event.target.value);
});
document.querySelector("#client-form").addEventListener("submit", createClient);
document.querySelector("#reseller-form").addEventListener("submit", createReseller);
document.querySelector("#user-form").addEventListener("submit", createUser);
document.querySelector("#user-role-select").addEventListener("change", updateUserRoleFields);
document.querySelector("#account-password-form").addEventListener("submit", changeOwnPassword);
document.querySelector("#client-detail-back").addEventListener("click", closeClientDetail);
document.querySelector("#maintenance-update-button").addEventListener("click", requestMaintenanceUpdate);

document.querySelector("#refresh-button").innerHTML = iconRefresh();
document.querySelector("#logout-button").innerHTML = iconLogout();
applyTheme(localStorage.getItem(themeKey) || "light");
setupCityOptions();
updateUserRoleFields();
startDashboardAutoRefresh();
loadSession();
