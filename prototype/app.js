const statusLabels = {
  online: "Online",
  warning: "Atencao",
  offline: "Offline",
  unknown: "Desconhecido",
  inactive: "Inativo"
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
let environmentPage = 1;
let environmentQuickFilter = "";
let maintenanceJobId = null;
let maintenancePollTimer = null;
let backupJobId = null;
let backupPollTimer = null;
let geoLeafletMap = null;
let geoLeafletLayer = null;
let selectedClientId = "";
let previousDetailView = "clients";
let lastDataRefreshAt = null;
let dashboardRefreshTimer = null;
let refreshLabelTimer = null;
let dataLoadInFlight = false;
const clientsPageSize = 10;
const environmentPageSize = 10;
const dashboardRefreshIntervalMs = 30_000;
const themeKey = "central-theme";
const sidebarCollapsedKey = "central-sidebar-collapsed";
const permissions = {
  viewMonitor: "view_monitor",
  viewAllClients: "view_all_clients",
  manageClients: "manage_clients",
  generateTokens: "generate_tokens",
  manageResellers: "manage_resellers",
  manageUsers: "manage_users",
  manageOAuth: "manage_oauth",
  maintenance: "maintenance"
};

const permissionLabels = {
  [permissions.viewMonitor]: "Monitorar ambientes",
  [permissions.viewAllClients]: "Ver todas as revendas",
  [permissions.manageClients]: "Cadastrar e editar clientes",
  [permissions.generateTokens]: "Gerar tokens e desvincular ambientes",
  [permissions.manageResellers]: "Cadastrar revendas",
  [permissions.manageUsers]: "Cadastrar usuarios",
  [permissions.manageOAuth]: "0auth Google Drive",
  [permissions.maintenance]: "Manutencao da Central"
};

const viewTitles = {
  dashboard: "Monitoramento geral",
  resellers: "Revendas",
  users: "Usuarios",
  clients: "Clientes",
  environments: "Ambientes",
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

function effectivePermissionSet() {
  return new Set(currentUser?.effectivePermissions || currentUser?.permissions || []);
}

function can(permission) {
  return currentUser?.role === "tronsoft_admin" || effectivePermissionSet().has(permission);
}

function hasGlobalClientScope() {
  return currentUser?.role === "tronsoft_admin" || can(permissions.viewAllClients);
}

function roleLabel(role) {
  if (role === "tronsoft_admin") return "TronSoft admin";
  if (role === "tronsoft_user") return "TronSoft tecnico";
  return "Revenda";
}

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

function iconMenu() {
  return svgIcon('<path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path>');
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

function compactText(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function renderTokenCopy(token) {
  if (!token) return "";
  return `<span class="token-copy-wrap"><span class="token-cell" title="${escapeHtml(token)}">${escapeHtml(token)}</span><button class="token-copy-button" type="button" data-copy-token="${escapeHtml(token)}" title="Copiar token">Copiar</button></span>`;
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

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
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
  const allowedViews = {
    dashboard: can(permissions.viewMonitor),
    environments: can(permissions.viewMonitor),
    alerts: can(permissions.viewMonitor),
    oauth: can(permissions.manageOAuth),
    clients: can(permissions.manageClients),
    resellers: can(permissions.manageResellers),
    users: can(permissions.manageUsers),
    maintenance: can(permissions.maintenance),
    account: true,
    "client-detail": can(permissions.viewMonitor)
  };
  activeView = allowedViews[view] ? view : (can(permissions.viewMonitor) ? "dashboard" : "account");

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
  if (activeView === "oauth" && can(permissions.manageOAuth)) await loadOAuthSummaryIfNeeded();
  if (activeView === "environments") renderEnvironments();
  if (activeView === "maintenance") await loadBackupStatus();
}

async function loadSession() {
  try {
    const payload = await api("/api/auth/me");
    currentUser = payload.user;
    showApp();
    await configureScopeControls();
    if (can(permissions.viewMonitor)) await loadCentralData();
    else await ensureActiveViewData();
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
    if (can(permissions.viewMonitor)) await loadCentralData();
    else await ensureActiveViewData();
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
  document.querySelector("#user-badge").textContent = `${currentUser.name} (${roleLabel(currentUser.role)})`;
  document.querySelector("#scope-label").textContent = hasGlobalClientScope()
    ? "Painel com clientes autorizados e filtro por revenda."
    : "Painel com apenas as revendas liberadas para este usuario.";

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
  const userAllowedResellers = document.querySelector("#user-allowed-resellers");
  const refreshButton = document.querySelector("#refresh-button");
  const adminRoleOption = document.querySelector('#user-role-select option[value="tronsoft_admin"]');

  filter.innerHTML = `<option value="">Todas as revendas</option>${currentResellers
    .map((reseller) => `<option value="${reseller.id}">${escapeHtml(reseller.name)}</option>`)
    .join("")}`;
  const clientResellerOptions = [
    ...(can(permissions.manageResellers) ? [directTronsoftOption] : []),
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
  userAllowedResellers.innerHTML = currentResellers
    .filter((reseller) => reseller.document !== directTronsoftOption.document && reseller.name.toLowerCase() !== "tronsoft")
    .map((reseller) => `<option value="${reseller.id}">${escapeHtml(reseller.name)}</option>`)
    .join("");
  renderPermissionOptions();

  const canManageClients = can(permissions.manageClients);
  filter.hidden = !hasGlobalClientScope() && currentResellers.length <= 1;
  resellerPanel.hidden = !can(permissions.manageResellers);
  resellersNav.hidden = !can(permissions.manageResellers);
  usersNav.hidden = !can(permissions.manageUsers);
  registrationsGroup.hidden = !(canManageClients || can(permissions.manageResellers) || can(permissions.manageUsers));
  maintenanceNav.hidden = !can(permissions.maintenance);
  document.querySelector('[data-view-target="clients"]').hidden = !canManageClients;
  document.querySelector('[data-view-target="dashboard"]').hidden = !can(permissions.viewMonitor);
  document.querySelector('[data-view-target="environments"]').hidden = !can(permissions.viewMonitor);
  document.querySelector('[data-view-target="alerts"]').hidden = !can(permissions.viewMonitor);
  document.querySelector('[data-view-target="oauth"]').hidden = !can(permissions.manageOAuth);
  refreshButton.hidden = !can(permissions.viewMonitor);
  if (adminRoleOption) adminRoleOption.hidden = currentUser.role !== "tronsoft_admin";
  clientResellerSelect.hidden = !hasGlobalClientScope();
  resellerNameInput.hidden = hasGlobalClientScope();
  resellerDocumentInput.hidden = hasGlobalClientScope();
  resellerNameInput.required = canManageClients && !hasGlobalClientScope();
  clientResellerSelect.required = canManageClients && hasGlobalClientScope();

  if (!hasGlobalClientScope() && currentResellers[0]) {
    resellerNameInput.value = currentResellers[0].name;
    resellerDocumentInput.value = currentResellers[0].document || "";
  }

  renderResellers();
  updateUserRoleFields();
  showView(activeView);
}

async function loadCentralData() {
  if (!can(permissions.viewMonitor)) return;
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
          services: {},
          status: client.status === "inactive" ? "inactive" : "unknown",
          lastSeen: "-",
          lastSeenAt: null,
          diskPercent: null,
          backup: { label: "--", tone: "unknown", detail: "sem dados" },
          alert: latestOpenAlertForClient(client.id),
          pairingToken: latestToken?.token || "",
          pairingTokenInfo: latestToken || null
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
        googleDrive: installation.googleDrive || null,
        metrics: installation.metrics || {},
        cluster: installation.cluster || {},
        services: installation.services || {},
        status: client.status === "inactive" ? "inactive" : installation.status,
        lastSeen: formatDateTime(installation.lastSeenAt),
        lastSeenAt: installation.lastSeenAt || null,
        diskPercent: diskPercent(installation),
        backup: backupSummary(installation),
        alert: latestOpenAlertForClient(client.id),
        pairingToken: "",
        pairingTokenInfo: null
      }));
    });

    currentAuthEvents = alerts.slice(-5).reverse().map((alert) => {
      const detail = `${alert.severity} - ${alert.message || alert.code || "Sem detalhes"}`;
      return {
        title: alert.title,
        detail,
        summary: compactText(detail, 120),
        occurredAt: alert.openedAt || alert.receivedAt || alert.createdAt || alert.resolvedAt || null,
        clientId: alert.clientId || "",
        installationId: alert.installationId || "",
        alert
      };
    });

    renderMetrics(dashboard);
    renderOperationalDashboard();
    renderClients(document.querySelector("#client-filter")?.value || "");
    renderDashboardClients();
    renderEnvironments();
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
    if (currentUser && can(permissions.viewMonitor)) loadCentralData().catch(showError);
  }, dashboardRefreshIntervalMs);
  refreshLabelTimer = setInterval(updateRefreshLabel, 30_000);
}

async function loadUsersIfNeeded(force = false) {
  if (!can(permissions.manageUsers)) return;
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
  const resellers = document.querySelector("#metric-resellers");
  const clients = document.querySelector("#metric-clients");
  const online = document.querySelector("#metric-online");
  const alerts = document.querySelector("#metric-alerts");
  if (resellers) resellers.textContent = dashboard.resellers;
  if (clients) clients.textContent = currentClients.filter((client) => client.installation).length || dashboard.clients;
  if (online) online.textContent = dashboard.online;
  if (alerts) alerts.textContent = dashboard.criticalAlerts;
}

function dashboardIcon(name) {
  const icons = {
    windows: '<path d="M3 5.5l7-1v7H3z"></path><path d="M12 4.2l9-1.2v8.5h-9z"></path><path d="M3 13h7v7l-7-1z"></path><path d="M12 13h9v8.2l-9-1.2z"></path>',
    linux: '<path d="M12 3c-2.5 0-4 2-4 5v2.5L5.7 15a3 3 0 0 0 2.7 4.4h7.2a3 3 0 0 0 2.7-4.4L16 10.5V8c0-3-1.5-5-4-5z"></path><path d="M9.5 9h.01"></path><path d="M14.5 9h.01"></path><path d="M10 13h4"></path>',
    database: '<ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"></path><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>',
    backup: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path>',
    alert: '<path d="M10.3 3.8L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    offline: '<path d="M18.4 5.6a9 9 0 1 1-12.8 0"></path><path d="M12 2v10"></path>'
  };
  return svgIcon(icons[name] || icons.alert);
}

function environmentPlatform(client) {
  const source = [
    client.host?.os,
    client.tronsoftos?.channel,
    client.installation?.tronsoftos?.channel,
    client.installation?.agent?.type,
    client.version,
    client.environment
  ].filter(Boolean).join(" ").toLowerCase();
  if (source.includes("windows")) return "windows";
  return "linux";
}

function dashboardSummary() {
  const monitored = currentClients.filter((client) => client.installation && client.rawClient?.status !== "inactive");
  const activeInstallationIds = new Set(monitored.map((client) => client.installation?.installationId).filter(Boolean));
  const openAlerts = currentAlerts.filter((alert) => activeInstallationIds.has(alert.installationId) && alert.status !== "resolved");
  const criticalAlerts = openAlerts.filter((alert) => alert.severity === "critical");
  const windows = monitored.filter((client) => environmentPlatform(client) === "windows").length;
  const linux = monitored.filter((client) => environmentPlatform(client) === "linux").length;
  const offline = monitored.filter((client) => client.status === "offline").length;
  const warning = monitored.filter((client) => client.status === "warning").length;
  const online = monitored.filter((client) => client.status === "online").length;
  const backupLate = monitored.filter((client) => client.backup?.tone === "warning").length;
  const indexProblems = monitored.filter((client) => ["offline", "warning"].includes(indexHealthStatus(client).tone)).length;
  const health = monitored.length > 0
    ? Math.max(0, Math.round(((online + warning * 0.45) / monitored.length) * 100))
    : 0;
  return { monitored, openAlerts, criticalAlerts, windows, linux, offline, warning, online, backupLate, indexProblems, health };
}

function renderOperationalDashboard() {
  const summary = dashboardSummary();
  const ring = document.querySelector("#dashboard-health-ring");
  const score = document.querySelector("#dashboard-health-score");
  if (ring) ring.style.setProperty("--health", summary.health);
  if (score) score.textContent = `${summary.health}%`;
  renderIncidents24h();
  renderServerGroups(summary);
  renderTopIncidents(summary);
}

function renderIncidents24h() {
  const container = document.querySelector("#incidents-24h-chart");
  if (!container) return;
  const now = new Date();
  const buckets = Array.from({ length: 24 }, (_, index) => {
    const date = new Date(now.getTime() - (23 - index) * 60 * 60 * 1000);
    return { hour: date.getHours().toString().padStart(2, "0"), count: 0 };
  });
  const start = now.getTime() - 24 * 60 * 60 * 1000;
  currentAlerts.forEach((alert) => {
    const time = new Date(alert.openedAt || alert.receivedAt || alert.createdAt || 0).getTime();
    if (!Number.isFinite(time) || time < start) return;
    const hoursAgo = Math.floor((now.getTime() - time) / (60 * 60 * 1000));
    const index = 23 - Math.max(0, Math.min(23, hoursAgo));
    buckets[index].count += 1;
  });
  const max = Math.max(1, ...buckets.map((item) => item.count));
  container.innerHTML = buckets.map((item) => `
    <span class="hour-bar" title="${item.count} incidente(s) as ${item.hour}h">
      <i style="height:${Math.max(6, Math.round((item.count / max) * 100))}%"></i>
      <small>${escapeHtml(item.hour)}</small>
    </span>
  `).join("");
}

function renderServerGroups(summary) {
  const container = document.querySelector("#server-groups");
  if (!container) return;
  const items = [
    { label: "Windows", value: summary.windows, detail: "Agent Windows", icon: "windows", tone: "danger", filter: "windows" },
    { label: "Linux", value: summary.linux, detail: "TronSoftOS", icon: "linux", tone: "ok", filter: "linux" },
    { label: "Banco", value: summary.monitored.length, detail: "Firebird monitorado", icon: "database", tone: "neutral", filter: "database" },
    { label: "Backup", value: summary.backupLate, detail: "atrasados", icon: "backup", tone: summary.backupLate ? "warning" : "ok", filter: "backup" },
    { label: "Indices", value: summary.indexProblems, detail: "atencao/sem leitura", icon: "alert", tone: summary.indexProblems ? "danger" : "ok", filter: "indexes" },
    { label: "Offline", value: summary.offline, detail: "sem heartbeat", icon: "offline", tone: summary.offline ? "danger" : "ok", filter: "offline" }
  ];
  container.innerHTML = items.map((item) => `
    <article class="server-group-card clickable-row ${escapeHtml(item.tone)}" data-environment-group="${escapeHtml(item.filter)}" title="Filtrar ambientes: ${escapeHtml(item.label)}">
      <span class="server-group-icon">${dashboardIcon(item.icon)}</span>
      <div>
        <strong>${item.value}</strong>
        <span>${escapeHtml(item.label)}</span>
        <small>${escapeHtml(item.detail)}</small>
      </div>
    </article>
  `).join("");
  container.querySelectorAll("[data-environment-group]").forEach((card) => {
    card.addEventListener("click", () => applyEnvironmentQuickFilter(card.dataset.environmentGroup || ""));
  });
}

function renderTopIncidents(summary) {
  const container = document.querySelector("#top-incidents");
  if (!container) return;
  const severityWeight = { critical: 0, warning: 1, info: 2 };
  const incidents = summary.openAlerts
    .map((alert) => {
      const client = currentClients.find((item) => item.id === alert.clientId || item.detailId === alert.installationId);
      return { alert, client };
    })
    .sort((left, right) => {
      const severity = (severityWeight[left.alert.severity] ?? 9) - (severityWeight[right.alert.severity] ?? 9);
      if (severity !== 0) return severity;
      return String(left.alert.openedAt || "").localeCompare(String(right.alert.openedAt || ""));
    })
    .slice(0, 10);

  container.innerHTML = incidents.map(({ alert, client }) => {
    const status = alert.severity === "critical" ? "offline" : alert.severity === "warning" ? "warning" : "unknown";
    return `
      <article class="incident-row ${client ? "clickable-row" : ""}" ${client ? `data-client-detail="${escapeHtml(client.detailId || client.id)}"` : ""}>
        <span class="incident-kind ${escapeHtml(status)}">${escapeHtml(alert.severity === "critical" ? "Critico" : alert.severity === "warning" ? "Atencao" : "Info")}</span>
        <div>
          <strong>${escapeHtml(client?.name || alert.clientName || "Cliente")}</strong>
          <small>${escapeHtml(alert.title || alert.code || "Incidente")}</small>
        </div>
        <span>${escapeHtml(formatRelativeTime(alert.openedAt || alert.receivedAt || alert.createdAt))}</span>
      </article>
    `;
  }).join("") || `<p class="empty-note">Nenhum incidente aberto no escopo atual.</p>`;
  container.querySelectorAll("[data-client-detail]").forEach((row) => {
    row.addEventListener("click", () => openClientDetail(row.dataset.clientDetail, "dashboard"));
  });
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

function storageInfo(client) {
  const metrics = client?.metrics || {};
  const systemMetrics = metrics.systemMetrics || {};
  const latest = Array.isArray(systemMetrics.latest) ? systemMetrics.latest[0] : systemMetrics.latest || {};
  const latestSeries = Array.isArray(systemMetrics.series) ? systemMetrics.series.at(-1) || {} : {};
  const source = { ...client, metrics, systemMetrics, latest, latestSeries };
  const total = numberFromPaths(source, [
    "host.diskTotalBytes",
    "host.storageTotalBytes",
    "metrics.systemMetrics.diskTotalBytes",
    "metrics.systemMetrics.disk.totalBytes",
    "metrics.systemMetrics.disk.total",
    "metrics.diskTotalBytes",
    "backups.disk.total",
    "backups.disk.totalBytes",
    "latest.diskTotalBytes",
    "latestSeries.diskTotalBytes"
  ]);
  const used = numberFromPaths(source, [
    "host.diskUsedBytes",
    "host.storageUsedBytes",
    "metrics.systemMetrics.diskUsedBytes",
    "metrics.systemMetrics.disk.usedBytes",
    "metrics.systemMetrics.disk.used",
    "metrics.diskUsedBytes",
    "backups.disk.used",
    "backups.disk.usedBytes",
    "latest.diskUsedBytes",
    "latestSeries.diskUsedBytes"
  ]);
  const free = numberFromPaths(source, [
    "host.diskFreeBytes",
    "host.storageFreeBytes",
    "metrics.systemMetrics.diskFreeBytes",
    "metrics.systemMetrics.disk.freeBytes",
    "metrics.systemMetrics.disk.free",
    "metrics.diskFreeBytes",
    "backups.disk.free",
    "backups.disk.freeBytes",
    "latest.diskFreeBytes",
    "latestSeries.diskFreeBytes"
  ]);
  const percent = gaugeValue(client?.diskPercent ?? metrics.diskUsedPercent ?? latest.diskUsedPercent ?? latestSeries.diskUsedPercent ?? client?.backups?.disk?.percentUsed);
  const inferredUsed = used ?? (total !== null && free !== null ? Math.max(0, total - free) : null);
  const inferredFree = free ?? (total !== null && inferredUsed !== null ? Math.max(0, total - inferredUsed) : null);
  return { total, used: inferredUsed, free: inferredFree, percent };
}

function temperatureValue(client) {
  const metrics = client?.metrics || {};
  const system = metrics.systemMetrics || {};
  const latest = Array.isArray(system.latest) ? system.latest[0] : system.latest;
  const latestSeries = Array.isArray(system.series) ? system.series.at(-1) : null;
  const value = latest?.temperatureCelsius
    ?? latest?.temperature
    ?? latest?.temperatureC
    ?? latest?.tempCelsius
    ?? latest?.cpuTemperature
    ?? latest?.cpuTempCelsius
    ?? latestSeries?.temperatureCelsius
    ?? latestSeries?.temperature
    ?? latestSeries?.temperatureC
    ?? latestSeries?.tempCelsius
    ?? latestSeries?.cpuTemperature
    ?? latestSeries?.cpuTempCelsius
    ?? system.temperatureCelsius
    ?? system.temperature
    ?? system.temperatureC
    ?? system.tempCelsius
    ?? system.cpuTemperature
    ?? system.cpuTempCelsius
    ?? system.host?.temperature
    ?? metrics.temperatureCelsius
    ?? metrics.temperature
    ?? metrics.temperatureC
    ?? metrics.tempCelsius
    ?? metrics.cpuTemperature
    ?? metrics.cpuTempCelsius
    ?? metrics.host?.temperatureCelsius
    ?? metrics.host?.temperature
    ?? metrics.host?.temperatureC
    ?? metrics.host?.tempCelsius
    ?? client?.host?.temperatureCelsius
    ?? client?.host?.temperature
    ?? client?.host?.temperatureC
    ?? client?.host?.tempCelsius
    ?? null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function temperatureStatus(client) {
  const value = temperatureValue(client);
  if (value === null || value <= 0) return { label: "-", tone: "unknown", detail: "sem sensor" };
  const label = `${value.toFixed(1)} C`;
  if (value >= 85) return { label, tone: "offline", detail: "critica" };
  if (value >= 70) return { label, tone: "warning", detail: "atencao" };
  return { label, tone: "online", detail: "ok" };
}

function temperatureSeriesValues(metrics = {}) {
  return metricSeriesValues(metrics, [
    "temperatureCelsius",
    "temperature",
    "temperatureC",
    "tempCelsius",
    "cpuTemperature",
    "cpuTempCelsius"
  ]).filter((point) => point.value > 0 && point.value < 130);
}

function parseBackupTimestamp(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function collectBackupTimestamps(value, output = [], depth = 0) {
  if (!value || depth > 4) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectBackupTimestamps(item, output, depth + 1));
    return output;
  }
  if (typeof value !== "object") return output;

  [
    "latestValidatedBackupAt",
    "latestBackupAt",
    "latestUploadedAt",
    "modifiedAt",
    "backupFinishedAt",
    "uploadedAt",
    "finishedAt",
    "completedAt",
    "validatedAt"
  ].forEach((key) => {
    const time = parseBackupTimestamp(value[key]);
    if (time) output.push(time);
  });

  Object.entries(value).forEach(([key, item]) => {
    if (["quota", "backupDir", "errors", "error", "message"].includes(key)) return;
    if (item && typeof item === "object") collectBackupTimestamps(item, output, depth + 1);
  });
  return output;
}

function latestBackupTimestamp(backups = {}) {
  const timestamps = collectBackupTimestamps(backups);
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function backupSummary(installation) {
  const backups = installation?.backups || {};
  const latest = latestBackupTimestamp(backups);
  if (!latest) {
    return { label: "--", tone: "unknown", detail: "sem dados" };
  }

  const minutes = Math.max(0, Math.round((Date.now() - new Date(latest).getTime()) / 60000));
  if (!Number.isFinite(minutes)) return { label: "--", tone: "unknown", detail: "sem dados" };
  if (minutes <= 360) return { label: `Ultimo backup ${backupAgeLabel(minutes)}`, tone: "online", detail: formatDateTime(latest) };
  return { label: `Backup atrasado ${backupAgeLabel(minutes)}`, tone: "warning", detail: formatDateTime(latest) };
}

function backupFileTimestamp(file) {
  return parseBackupTimestamp(file?.modifiedAt)
    || parseBackupTimestamp(file?.backupFinishedAt)
    || parseBackupTimestamp(file?.uploadedAt)
    || parseBackupTimestamp(file?.createdAt)
    || parseBackupTimestamp(file?.manifest?.backupFinishedAt)
    || parseBackupTimestamp(file?.manifest?.modifiedAt);
}

function isBackupPayloadFile(file) {
  return /\.(gbk|fbk|gbk\.gz|fbk\.gz)$/i.test(file?.name || file?.path || "");
}

function isBackupManifestFile(file) {
  return /\.manifest\.json$/i.test(file?.name || file?.path || "");
}

function backupFileKey(file) {
  return String(file?.path || file?.name || "").replace(/^.*\//, "").replace(/\.manifest\.json$/i, "");
}

function latestRawBackupFile(backups = {}) {
  const files = Array.isArray(backups.recentFiles) ? backups.recentFiles : [];
  const candidates = [
    backups.latestFile,
    backups.receiver?.latestBackup,
    ...files
  ].filter(isBackupPayloadFile);
  const latest = candidates.sort((a, b) => backupFileTimestamp(b) - backupFileTimestamp(a))[0];
  return latest || null;
}

function latestValidatedBackupTime(backups = {}) {
  const files = Array.isArray(backups.recentFiles) ? backups.recentFiles : [];
  const candidates = [
    backups.latestValidatedBackupAt,
    backups.latestManifest?.backupFinishedAt,
    backups.latestManifest?.modifiedAt,
    ...files
      .filter((file) => isBackupManifestFile(file) || file?.manifest?.validationOk === true)
      .flatMap((file) => [
        file.modifiedAt,
        file.backupFinishedAt,
        file.manifest?.backupFinishedAt,
        file.manifest?.modifiedAt,
        file.manifest?.validatedAt
      ])
  ].map(parseBackupTimestamp).filter(Boolean);
  return candidates.length ? Math.max(...candidates) : 0;
}

function backupPanelLabel(client, backups = {}) {
  const label = client?.backup?.label || "--";
  if (environmentPlatform(client) === "windows") return label;
  const latestRaw = latestRawBackupFile(backups);
  const rawTime = backupFileTimestamp(latestRaw);
  const validatedTime = latestValidatedBackupTime(backups);
  if (rawTime && (!validatedTime || rawTime > validatedTime + 60_000)) {
    return `${label} | arquivo recente sem validacao ${formatRelativeTime(new Date(rawTime).toISOString())}`;
  }
  return label;
}

function normalizedBackupDatabaseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.(gbk|fbk|gz|zip|manifest|json)$/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function backupDatabaseLabel(file = {}, client = null) {
  const explicit = file.databaseAlias
    || file.alias
    || file.databaseName
    || file.database
    || file.dbAlias
    || file.dbName
    || file.manifest?.databaseAlias
    || file.manifest?.databaseName;
  if (explicit) return String(explicit);

  const databases = monitoredDatabases(client?.databaseInfo || {});
  if (!databases.length) return "";
  if (databases.length === 1) return databaseDisplayAlias(databases[0]) || databaseDisplayName(databases[0]);

  const fileText = normalizedBackupDatabaseText(`${file.name || ""} ${file.path || ""}`);
  const match = databases.find((database) => {
    const candidates = [
      database.databaseAlias,
      database.alias,
      database.id,
      database.databaseName,
      database.name
    ].map(normalizedBackupDatabaseText).filter((item) => item.length >= 3);
    return candidates.some((candidate) => fileText.includes(candidate));
  });
  return match ? databaseDisplayAlias(match) || databaseDisplayName(match) : "banco nao identificado";
}

function monitorStatus(client) {
  if (client.status === "offline") return "offline";
  const alert = latestOpenAlertForClient(client.id);
  if (alert || client.status === "warning") return "warning";
  if (client.status === "online") return "online";
  return "unknown";
}

function attachTokenCopyButtons(root) {
  root.querySelectorAll("[data-copy-token]").forEach((button) => {
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

function environmentHaStatus(client) {
  const cluster = client.installation?.cluster || client.cluster || {};
  const mode = String(cluster.mode || cluster.status?.mode || "").toLowerCase();
  const enabled = cluster.enabled === true || cluster.haEnabled === true || cluster.keepalived?.enabled === true;
  const hasStandby = Boolean(cluster.standby || cluster.peer || cluster.nodes?.length > 1);
  return mode === "ha" || enabled || hasStandby;
}

function renderClients(filter = "") {
  const table = document.querySelector("#clients-table");
  if (!table) return;
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
        ? `<br>${renderTokenCopy(client.pairingToken)}`
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
  attachTokenCopyButtons(table);
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
      renderClients(document.querySelector("#client-filter")?.value || "");
    });
  });
}

function renderDashboardClients() {
  const list = document.querySelector("#dashboard-clients-list");
  if (!list) return;
  const visibleClients = currentClients
    .filter((client) => !client.installation && client.rawClient?.status !== "inactive")
    .filter((client) => {
      const hasToken = Boolean(client.pairingToken);
      if (monitorFilter === "token") return hasToken;
      if (monitorFilter === "notoken") return !hasToken;
      return true;
    })
    .sort((left, right) => String(right.pairingTokenInfo?.createdAt || right.rawClient?.createdAt || "").localeCompare(String(left.pairingTokenInfo?.createdAt || left.rawClient?.createdAt || "")))
    .slice(0, 5);

  list.innerHTML = visibleClients
    .map((client) => {
      const location = [client.city, client.state].filter(Boolean).join(" / ") || "-";
      const document = client.rawClient?.document || "-";
      const createdAt = client.pairingTokenInfo?.createdAt || client.rawClient?.createdAt || null;
      const token = client.pairingToken
        ? renderTokenCopy(client.pairingToken)
        : `<span class="muted-cell">sem token</span>`;
      return `
        <article class="monitor-row clickable-row" data-client-detail="${escapeHtml(client.detailId)}">
          <div class="monitor-client" data-label="Cliente">
            <span class="client-avatar">${escapeHtml(initials(client.name))}</span>
            <div>
              <strong>${escapeHtml(client.name)}</strong>
              <span>${escapeHtml(client.environment)}</span>
            </div>
          </div>
          <div data-label="Revenda">${escapeHtml(client.reseller)}</div>
          <div data-label="Documento">${escapeHtml(document)}</div>
          <div data-label="Localizacao">${escapeHtml(location)}</div>
          <div data-label="Status"><span class="status unknown">Pendente</span></div>
          <div data-label="Token">${token}</div>
          <div data-label="Criado">${escapeHtml(formatDateTime(createdAt))}</div>
        </article>
      `;
    })
    .join("") || `<div class="empty-monitor">Nenhum cliente pendente de pareamento neste filtro.</div>`;
  list.querySelectorAll("[data-client-detail]").forEach((row) => {
    row.addEventListener("click", () => openClientDetail(row.dataset.clientDetail, "dashboard"));
  });
  attachTokenCopyButtons(list);
}

function renderEnvironments() {
  const table = document.querySelector("#environments-table");
  if (!table) return;
  const textFilter = (document.querySelector("#environment-filter")?.value || "").trim().toLowerCase();
  const pairingFilter = document.querySelector("#environment-pairing-filter")?.value || "";
  const haFilter = document.querySelector("#environment-ha-filter")?.value || "";

  const visible = currentClients
    .filter((client) => {
      const paired = Boolean(client.installation);
      const hasHa = environmentHaStatus(client);
      const platform = environmentPlatform(client);
      const status = client.rawClient?.status === "inactive" ? "inactive" : (paired ? monitorStatus(client) : "unknown");
      const indexTone = indexHealthStatus(client).tone;
      const documentValue = client.rawClient?.document || "";
      const installationId = client.installation?.installationId || "";
      const searchable = [
        client.name,
        documentValue,
        client.reseller,
        client.city,
        client.state,
        client.environment,
        client.database,
        client.host?.hostname,
        client.host?.ip,
        platform,
        installationId
      ].filter(Boolean).join(" ").toLowerCase();
      if (textFilter && !searchable.includes(textFilter)) return false;
      if (pairingFilter === "pending" && paired) return false;
      if (pairingFilter === "paired" && !paired) return false;
      if (haFilter === "ha" && !hasHa) return false;
      if (haFilter === "simple" && hasHa) return false;
      if (environmentQuickFilter === "windows" && platform !== "windows") return false;
      if (environmentQuickFilter === "linux" && platform !== "linux") return false;
      if (environmentQuickFilter === "database" && !paired) return false;
      if (environmentQuickFilter === "backup" && client.backup?.tone !== "warning") return false;
      if (environmentQuickFilter === "indexes" && !["warning", "offline"].includes(indexTone)) return false;
      if (environmentQuickFilter === "offline" && status !== "offline") return false;
      return true;
    })
    .sort((left, right) => {
      const leftDate = left.lastSeenAt || left.pairingTokenInfo?.createdAt || left.rawClient?.createdAt || "";
      const rightDate = right.lastSeenAt || right.pairingTokenInfo?.createdAt || right.rawClient?.createdAt || "";
      return String(rightDate).localeCompare(String(leftDate));
    });

  const totalPages = Math.max(1, Math.ceil(visible.length / environmentPageSize));
  environmentPage = Math.min(environmentPage, totalPages);
  const pageItems = visible.slice((environmentPage - 1) * environmentPageSize, environmentPage * environmentPageSize);

  table.innerHTML = pageItems
    .map((client) => {
      const paired = Boolean(client.installation);
      const supportsHa = environmentPlatform(client) !== "windows";
      const hasHa = supportsHa && environmentHaStatus(client);
      const status = client.rawClient?.status === "inactive" ? "inactive" : (paired ? monitorStatus(client) : "unknown");
      const documentValue = client.rawClient?.document || "-";
      const pairing = paired
        ? `<span class="status online">Pareado</span><br><span class="muted-cell">${escapeHtml(client.installation?.installationId || "")}</span>`
        : `<span class="status unknown">Pendente</span>${client.pairingToken ? `<br>${renderTokenCopy(client.pairingToken)}` : ""}`;
      const database = paired ? databaseVersion(client.installation) : "-";
      const lastSeen = paired ? formatDateTime(client.lastSeenAt) : formatDateTime(client.pairingTokenInfo?.createdAt || client.rawClient?.createdAt);
      return `
        <tr class="clickable-row" data-client-detail="${escapeHtml(client.detailId)}">
          <td>${escapeHtml(client.name)}<br><span class="muted-cell">${escapeHtml([client.city, client.state].filter(Boolean).join(" / ") || "-")}</span></td>
          <td>${escapeHtml(documentValue)}</td>
          <td>${escapeHtml(client.reseller)}</td>
          <td>${pairing}</td>
          <td><span class="index-pill ${supportsHa ? (hasHa ? "online" : "unknown") : "neutral"}">${supportsHa ? (hasHa ? "Com HA" : "Sem HA") : "N/A"}</span></td>
          <td>${escapeHtml(client.environment || "Ambiente principal")}</td>
          <td><span class="status ${escapeHtml(status)}">${escapeHtml(status === "inactive" ? "Inativo" : (paired ? (statusLabels[status] || status) : "Pendente"))}</span></td>
          <td>${escapeHtml(database || "-")}</td>
          <td>${escapeHtml(lastSeen)}</td>
          <td>${can(permissions.manageClients) || can(permissions.generateTokens)
            ? `<button class="secondary-button compact-action" type="button" data-edit-environment-client="${escapeHtml(client.id)}">Editar</button>`
            : ""}</td>
        </tr>
      `;
    })
    .join("") || `
      <tr>
        <td colspan="10" class="empty-cell">Nenhum ambiente encontrado neste filtro.</td>
      </tr>
    `;

  renderEnvironmentPagination(visible.length, totalPages);
  table.querySelectorAll("[data-edit-environment-client]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      editEnvironmentClient(button.dataset.editEnvironmentClient);
    });
  });
  table.querySelectorAll("[data-client-detail]").forEach((row) => {
    row.addEventListener("click", () => openClientDetail(row.dataset.clientDetail, "environments"));
  });
  attachTokenCopyButtons(table);
}

function renderEnvironmentPagination(total, totalPages) {
  const pagination = document.querySelector("#environment-pagination");
  if (!pagination) return;
  if (total <= environmentPageSize) {
    pagination.innerHTML = "";
    return;
  }
  const start = (environmentPage - 1) * environmentPageSize + 1;
  const end = Math.min(total, environmentPage * environmentPageSize);
  pagination.innerHTML = `
    <span>${start}-${end} de ${total}</span>
    <button type="button" data-environment-page="prev" ${environmentPage <= 1 ? "disabled" : ""}>Anterior</button>
    <button type="button" data-environment-page="next" ${environmentPage >= totalPages ? "disabled" : ""}>Proxima</button>
  `;
  pagination.querySelectorAll("[data-environment-page]").forEach((button) => {
    button.addEventListener("click", () => {
      environmentPage += button.dataset.environmentPage === "next" ? 1 : -1;
      renderEnvironments();
    });
  });
}

async function editEnvironmentClient(clientId) {
  const client = currentClients.find((item) => item.id === clientId);
  if (!client?.rawClient) {
    alert("Cliente nao encontrado na lista atual.");
    return;
  }

  openClientEditModal(client);
}

function resellerOptionsForEdit() {
  return [...currentResellers];
}

function openClientEditModal(client) {
  const modal = document.querySelector("#client-edit-modal");
  const form = document.querySelector("#client-edit-form");
  const resellerSelect = document.querySelector("#client-edit-reseller");
  const error = document.querySelector("#client-edit-error");
  if (!modal || !form || !resellerSelect) return;

  const rawClient = client.rawClient;
  const isInactive = rawClient.status === "inactive";
  const options = resellerOptionsForEdit();
  resellerSelect.innerHTML = options
    .map((reseller) => `<option value="${escapeHtml(reseller.id)}">${escapeHtml(reseller.name)}</option>`)
    .join("");

  form.elements.clientId.value = rawClient.id;
  form.elements.installationId.value = client.installation?.installationId || "";
  form.elements.name.value = rawClient.name || client.name || "";
  form.elements.document.value = rawClient.document || "";
  form.elements.name.disabled = !can(permissions.manageClients);
  form.elements.document.disabled = !can(permissions.manageClients);
  resellerSelect.value = rawClient.resellerId || client.installation?.reseller?.id || "";
  resellerSelect.disabled = !can(permissions.manageClients) || (!hasGlobalClientScope() && currentResellers.length <= 1);
  if (!hasGlobalClientScope() && !resellerSelect.value && currentResellers[0]) {
    resellerSelect.value = currentResellers[0].id;
  }
  const statusButton = document.querySelector("#client-edit-status");
  const tokenButton = document.querySelector("#client-edit-token");
  const unpairButton = document.querySelector("#client-edit-unpair");
  const deleteButton = document.querySelector("#client-edit-delete");
  const saveButton = document.querySelector("#client-edit-save");
  if (statusButton) {
    statusButton.textContent = isInactive ? "Ativar cliente" : "Desativar cliente";
    statusButton.dataset.nextStatus = isInactive ? "active" : "inactive";
    statusButton.hidden = !can(permissions.manageClients);
  }
  if (tokenButton) {
    tokenButton.hidden = !can(permissions.generateTokens);
  }
  if (unpairButton) {
    unpairButton.hidden = !can(permissions.generateTokens);
    unpairButton.disabled = !form.elements.installationId.value;
    unpairButton.title = form.elements.installationId.value ? "" : "Cliente sem ambiente pareado.";
  }
  if (deleteButton) {
    deleteButton.hidden = currentUser?.role !== "tronsoft_admin";
  }
  if (saveButton) {
    saveButton.hidden = !can(permissions.manageClients);
  }
  if (error) error.textContent = "";
  modal.hidden = false;
  form.elements.name.focus();
}

function closeClientEditModal() {
  const modal = document.querySelector("#client-edit-modal");
  const form = document.querySelector("#client-edit-form");
  const error = document.querySelector("#client-edit-error");
  if (form) form.reset();
  if (error) error.textContent = "";
  if (modal) modal.hidden = true;
}

async function saveClientEdit(event) {
  event.preventDefault();
  if (!can(permissions.manageClients)) return;
  const form = event.currentTarget;
  const error = document.querySelector("#client-edit-error");
  const clientId = form.elements.clientId.value;
  const name = form.elements.name.value.trim();
  const documentValue = form.elements.document.value.trim();
  const resellerId = form.elements.resellerId.value;

  if (error) error.textContent = "";
  if (!name) {
    if (error) error.textContent = "Informe o nome do cliente.";
    return;
  }
  if (documentValue && documentValue !== digitsOnly(documentValue)) {
    if (error) error.textContent = "O documento deve conter apenas numeros.";
    return;
  }

  try {
    await api(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        document: documentValue,
        resellerId
      })
    });
    closeClientEditModal();
    await loadCentralData();
  } catch (err) {
    const message = err.message || "Nao foi possivel atualizar o cliente.";
    const target = document.querySelector("#client-edit-error");
    if (target) target.textContent = message;
    else alert(message);
  }
}

function currentEditingClient() {
  const form = document.querySelector("#client-edit-form");
  const clientId = form?.elements.clientId.value || "";
  return currentClients.find((client) => client.rawClient?.id === clientId) || null;
}

async function runClientModalAction(action) {
  const form = document.querySelector("#client-edit-form");
  const error = document.querySelector("#client-edit-error");
  const clientId = form?.elements.clientId.value || "";
  const installationId = form?.elements.installationId.value || "";
  if (error) error.textContent = "";
  if (!clientId) return;

  try {
    if (action === "status") {
      const nextStatus = document.querySelector("#client-edit-status")?.dataset.nextStatus || "inactive";
      const label = nextStatus === "inactive" ? "desativar" : "ativar";
      if (!confirm(`Confirma ${label} este cliente?`)) return;
      await api(`/api/clients/${encodeURIComponent(clientId)}/status`, {
        method: "POST",
        body: JSON.stringify({ status: nextStatus })
      });
    } else if (action === "token") {
      if (!confirm("Gerar novo token e revogar tokens ativos anteriores deste cliente?")) return;
      const payload = await api(`/api/clients/${encodeURIComponent(clientId)}/token`, {
        method: "POST",
        body: "{}"
      });
      alert(`Novo token gerado: ${payload.pairingToken?.token || ""}`);
    } else if (action === "unpair") {
      if (!installationId) {
        if (error) error.textContent = "Este cliente nao possui ambiente pareado para desvincular.";
        return;
      }
      if (!confirm("Desvincular este ambiente do cliente? O ambiente, alertas e eventos ligados a ele serao removidos da Central.")) return;
      await api(`/api/installations/${encodeURIComponent(installationId)}/unpair`, {
        method: "POST",
        body: "{}"
      });
    } else if (action === "delete") {
      const client = currentEditingClient();
      if (!confirm(`Excluir permanentemente ${client?.name || "este cliente"} da Central? Esta acao remove ambientes, tokens, alertas e eventos vinculados.`)) return;
      await api(`/api/clients/${encodeURIComponent(clientId)}`, {
        method: "DELETE"
      });
    }
    closeClientEditModal();
    await loadCentralData();
  } catch (err) {
    const message = err.message || "Nao foi possivel executar a acao.";
    if (error) error.textContent = message;
    else alert(message);
  }
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

function monitoredDatabases(databaseInfo = {}) {
  const databases = Array.isArray(databaseInfo.databases) ? databaseInfo.databases.filter(Boolean) : [];
  return databases.length ? databases : [databaseInfo].filter((database) => database && Object.keys(database).length);
}

function indexHealthStatusForDatabase(databaseInfo = {}, client = {}) {
  const health = databaseInfo?.indexHealth;
  const audit = databaseInfo?.indexAudit;
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
  if (audit && Number.isFinite(Number(audit.inactiveIndexes))) {
    const auditActive = audit.activeIndexes ?? active;
    const auditTotal = audit.totalIndexes ?? total;
    const inactive = Number(audit.inactiveIndexes);
    const delta = Number(audit.inactiveDelta || 0);
    if (inactive > 0) {
      return {
        label: "Indice em atencao",
        shortLabel: "Atencao",
        tone: delta > 0 ? "offline" : "warning",
        detail: `${auditActive} / ${auditTotal} ativos, ${inactive} inativo(s)${delta > 0 ? `, +${delta} desde a ultima coleta` : ""}`
      };
    }
    return {
      label: "Indices OK",
      shortLabel: "OK",
      tone: "online",
      detail: `${auditActive} / ${auditTotal} ativos`
    };
  }
  if (health?.error || severity === "unknown" || severity === "erro" || severity === "error") {
    return {
      label: "Indices nao verificados",
      shortLabel: "Sem leitura",
      tone: "warning",
      detail: health?.error || "nao foi possivel consultar os indices"
    };
  }
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
    return { label: "Indices nao verificados", shortLabel: "Sem leitura", tone: "warning", detail: `${active} ativo(s)` };
  }
  return { label: "Nao informado", shortLabel: "Sem leitura", tone: "unknown", detail: "sem leitura do TronFire" };
}

function indexHealthStatus(client) {
  const databases = monitoredDatabases(client.databaseInfo);
  if (databases.length <= 1) return indexHealthStatusForDatabase(databases[0] || client.databaseInfo || {}, client);
  const statuses = databases.map((database) => indexHealthStatusForDatabase(database, client));
  const offline = statuses.filter((status) => status.tone === "offline").length;
  const warning = statuses.filter((status) => status.tone === "warning").length;
  const unknown = statuses.filter((status) => status.tone === "unknown").length;
  const ok = statuses.filter((status) => status.tone === "online").length;
  if (offline || warning) {
    return {
      label: "Banco em atencao",
      shortLabel: "Atencao",
      tone: offline ? "offline" : "warning",
      detail: `${databases.length} banco(s), ${offline + warning} com atencao`
    };
  }
  if (ok === databases.length) {
    return {
      label: "Bancos OK",
      shortLabel: "OK",
      tone: "online",
      detail: `${databases.length} banco(s) monitorado(s)`
    };
  }
  return {
    label: "Indices nao verificados",
    shortLabel: "Sem leitura",
    tone: "warning",
    detail: `${databases.length} banco(s), ${unknown} sem leitura`
  };
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

function quotaGaugeValue(quota = {}) {
  if (!quota || typeof quota !== "object" || quota.ok === false) return null;
  const total = Number(quota.total ?? quota.totalBytes ?? quota.raw?.total);
  const used = Number(quota.used ?? quota.usedBytes ?? quota.raw?.used);
  const free = Number(quota.free ?? quota.freeBytes ?? quota.raw?.free);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) {
    return gaugeValue((used / total) * 100);
  }
  if (Number.isFinite(total) && total > 0 && Number.isFinite(free)) {
    return gaugeValue(((total - free) / total) * 100);
  }
  return gaugeValue(quota.percentUsed ?? quota.usedPercent ?? quota.percent);
}

function quotaGaugeCaption(quota = {}, googleDrive = {}) {
  if (quota?.ok === false) return quota.error || "falha ao consultar quota";
  const account = googleDrive?.accountEmail || "";
  if (Number.isFinite(Number(quota?.free)) && Number.isFinite(Number(quota?.total))) {
    const checkedAt = quota?.checkedAt ? ` | ${formatRelativeTime(quota.checkedAt)}` : "";
    return `${account ? `${account} | ` : ""}conta Google: ${bytesLabel(Number(quota.free))} livres de ${bytesLabel(Number(quota.total))}${checkedAt}`;
  }
  if (account) return `${account} | quota da conta Google`;
  return "quota remota";
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

function serverTimeLabel(host = {}) {
  return host.serverTime || host.time || host.now || host.collectedAt || "";
}

function serverTimeCaption(host = {}) {
  const time = serverTimeLabel(host);
  if (!time) return "hora do servidor nao informada";
  const timezone = host.timezone || host.tz || "";
  return `${formatDateTime(time)}${timezone ? ` | ${timezone}` : ""}`;
}

function indexAuditDetail(database = {}) {
  const audit = database.indexAudit;
  if (!audit) return "-";
  if (audit.error) return audit.error;
  if (!Number.isFinite(Number(audit.inactiveIndexes))) return "-";
  const inactive = Number(audit.inactiveIndexes);
  const delta = Number(audit.inactiveDelta || 0);
  const checkedAt = audit.checkedAt ? formatDateTime(audit.checkedAt) : "";
  if (inactive === 0) return checkedAt ? `OK em ${checkedAt}` : "OK";
  return `${inactive} inativo(s)${delta > 0 ? `, +${delta} novo(s)` : ""}${checkedAt ? ` em ${checkedAt}` : ""}`;
}

function databaseDisplayName(database = {}) {
  return database.databaseName || database.name || database.databaseAlias || database.alias || "Banco Firebird";
}

function databaseDisplayAlias(database = {}) {
  return database.databaseAlias || database.alias || database.id || "";
}

function databaseProblemMessage(database = {}) {
  const status = String(database.status || database.state || database.healthStatus || "").toLowerCase();
  const error = database.error || database.lastError || database.connectionError || database.health?.error || "";
  if (database.ok === false) return error || "banco informado com falha";
  if (error) return String(error);
  if (["error", "erro", "offline", "unavailable", "failed", "falha", "failure"].includes(status)) return `status ${status}`;
  return "";
}

function renderDatabaseSummary(databaseInfo = {}, client = {}) {
  const databases = monitoredDatabases(databaseInfo);
  if (databases.length <= 1) {
    const database = databases[0] || databaseInfo || {};
    const indexStatus = indexHealthStatusForDatabase(database, client);
    return `
      <div class="detail-grid compact">
        ${detailItem("Engine", database.engine || "Firebird")}
        ${detailItem("Firebird", database.version)}
        ${detailItem("versao_banco", database.versaoBanco || database.versao_banco || database.schemaVersion || client.database)}
        ${detailItem("Tamanho", databaseSizeLabel(database))}
        ${detailItem("Indices", indexStatus.label)}
        ${detailItem("Detalhe indice", indexStatus.detail)}
        ${detailItem("Auditoria indice", indexAuditDetail(database))}
        ${detailItem("Alias", databaseDisplayAlias(database))}
      </div>
    `;
  }

  return `
    <div class="database-list">
      ${databases.map((database) => {
        const indexStatus = indexHealthStatusForDatabase(database, client);
        const checkedAt = database.indexHealth?.checkedAt || database.indexAudit?.checkedAt || "";
        return `
          <article class="database-row ${escapeHtml(indexStatus.tone)}">
            <div>
              <strong>${escapeHtml(databaseDisplayName(database))}</strong>
              <span>${escapeHtml(databaseDisplayAlias(database) || "alias nao informado")}</span>
            </div>
            <div>
              <span>versao_banco</span>
              <strong>${escapeHtml(database.versaoBanco || database.versao_banco || database.schemaVersion || database.version || "-")}</strong>
            </div>
            <div>
              <span>Tamanho</span>
              <strong>${escapeHtml(databaseSizeLabel(database))}</strong>
            </div>
            <div>
              <span>Indices</span>
              <strong>${escapeHtml(indexStatus.shortLabel || indexStatus.label)}</strong>
              <small>${escapeHtml(indexStatus.detail)}</small>
            </div>
            <div>
              <span>Auditoria</span>
              <strong>${escapeHtml(indexAuditDetail(database))}</strong>
              <small>${escapeHtml(checkedAt ? formatDateTime(checkedAt) : "")}</small>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderIndexNames(names = [], emptyText = "sem itens") {
  if (!Array.isArray(names) || names.length === 0) {
    return `<span class="index-audit-empty">${escapeHtml(emptyText)}</span>`;
  }
  return names.slice(0, 8).map((name) => `<code>${escapeHtml(name)}</code>`).join("");
}

function renderIndexAuditHistory(database = {}) {
  const audit = database.indexAudit;
  const history = Array.isArray(database.indexAuditHistory) ? database.indexAuditHistory : [];
  const rows = history.length ? history.slice(-8).reverse() : (audit ? [audit] : []);
  if (!rows.length) {
    return `<p class="empty-note">Nenhum historico de indices recebido ainda.</p>`;
  }

  return `
    <div class="index-audit-summary">
      <span>Total <strong>${escapeHtml(audit?.totalIndexes ?? "-")}</strong></span>
      <span>Ativos <strong>${escapeHtml(audit?.activeIndexes ?? "-")}</strong></span>
      <span>Inativos <strong>${escapeHtml(audit?.inactiveIndexes ?? "-")}</strong></span>
      <span>Delta <strong>${escapeHtml(Number(audit?.inactiveDelta || 0) > 0 ? `+${audit.inactiveDelta}` : audit?.inactiveDelta ?? "0")}</strong></span>
    </div>
    <div class="index-audit-timeline">
      ${rows.map((row) => {
        const inactive = Number(row.inactiveIndexes ?? 0);
        const delta = Number(row.inactiveDelta ?? 0);
        const tone = inactive === 0 ? "online" : delta > 0 ? "critical" : "warning";
        return `
          <article class="index-audit-row ${escapeHtml(tone)}">
            <div class="index-audit-row-main">
              <strong>${escapeHtml(row.checkedAt ? formatDateTime(row.checkedAt) : "sem data")}</strong>
              <span>${escapeHtml(row.activeIndexes ?? "-")} / ${escapeHtml(row.totalIndexes ?? "-")} ativos - ${escapeHtml(row.inactiveIndexes ?? "-")} inativo(s)</span>
              <small>${escapeHtml(delta > 0 ? `+${delta} novo(s) inativo(s)` : delta < 0 ? `${delta} inativo(s)` : "sem mudanca na coleta")}</small>
            </div>
            <div class="index-audit-lists">
              <div>
                <span>Novos inativos</span>
                <div>${renderIndexNames(row.newInactiveIndexes, "nenhum novo")}</div>
              </div>
              <div>
                <span>Reativados</span>
                <div>${renderIndexNames(row.reactivatedIndexes, "nenhum reativado")}</div>
              </div>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderDatabasesIndexAuditHistory(databaseInfo = {}) {
  const databases = monitoredDatabases(databaseInfo);
  if (databases.length <= 1) return renderIndexAuditHistory(databases[0] || databaseInfo);
  return `
    <div class="database-history-list">
      ${databases.map((database) => `
        <article class="database-history-block">
          <div class="database-history-title">
            <strong>${escapeHtml(databaseDisplayName(database))}</strong>
            <span>${escapeHtml(databaseDisplayAlias(database) || "alias nao informado")}</span>
          </div>
          ${renderIndexAuditHistory(database)}
        </article>
      `).join("")}
    </div>
  `;
}

function detailTemperaturePanel(client) {
  const temperature = temperatureStatus(client);
  const series = temperatureSeriesValues(client?.metrics || {});
  const current = temperatureValue(client);
  return `
    <article class="ops-panel temperature-panel">
      <div class="ops-panel-head">
        <div>
          <h3>Temperatura</h3>
          <span>historico da leitura termica do servidor</span>
        </div>
        <span class="ops-chip ${escapeHtml(temperature.tone)}">${escapeHtml(temperature.label === "-" ? "sem sensor" : temperature.label)}</span>
      </div>
      <div class="temperature-detail ${escapeHtml(temperature.tone)}">
        <span>Sensor</span>
        <strong>${escapeHtml(temperature.label === "-" ? "Sem sensor" : temperature.label)}</strong>
        <small>${escapeHtml(temperature.detail)}</small>
      </div>
      ${temperatureLineChart(series, current)}
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
  return values.slice(-48);
}

function metricLinePath(points, width, height, padding) {
  if (!points.length) return "";
  const usableWidth = width - padding.left - padding.right;
  const usableHeight = height - padding.top - padding.bottom;
  return points.map((point, index) => {
    const x = padding.left + (points.length === 1 ? usableWidth / 2 : (index / (points.length - 1)) * usableWidth);
    const y = padding.top + usableHeight - (Math.max(0, Math.min(100, point.value)) / 100) * usableHeight;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function metricAreaPath(points, width, height, padding) {
  const line = metricLinePath(points, width, height, padding);
  if (!line) return "";
  const usableWidth = width - padding.left - padding.right;
  const baseY = height - padding.bottom;
  const firstX = padding.left;
  const lastX = padding.left + (points.length === 1 ? usableWidth / 2 : usableWidth);
  return `${line} L ${lastX.toFixed(1)} ${baseY} L ${firstX.toFixed(1)} ${baseY} Z`;
}

function metricSummary(points) {
  const normalizedPoints = points.map((point) => typeof point === "number" ? { value: point, label: "sem horario" } : point);
  const peak = normalizedPoints.reduce((highest, point) => point.value > highest.value ? point : highest, normalizedPoints[0]);
  const latest = normalizedPoints[normalizedPoints.length - 1];
  return { peak, latest };
}

function bytesPerSecondLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${bytesLabel(number)}/s`;
}

function networkMetricRows(metrics = {}) {
  const network = metrics.network && typeof metrics.network === "object" ? metrics.network : {};
  const latestRows = Array.isArray(network.latest) ? network.latest : network.latest ? [network.latest] : [];
  const rows = Array.isArray(network.series) && network.series.length ? network.series : latestRows;
  return rows.map((row) => {
    const dateValue = row.createdAt || row.collectedAt || row.timestamp || row.time || row.readAt;
    const date = dateValue ? new Date(dateValue) : null;
    const label = date && Number.isFinite(date.getTime())
      ? date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "sem horario";
    return { ...row, label };
  }).slice(-48);
}

function networkSeriesValues(rows = [], keys = []) {
  return rows.map((row) => {
    const value = keys.map((key) => Number(row[key])).find(Number.isFinite);
    return { value, label: row.label };
  }).filter((point) => Number.isFinite(point.value));
}

function scaledMetricLinePath(points, width, height, padding, maxValue) {
  const scale = Number(maxValue);
  const normalized = points.map((point) => ({
    ...point,
    value: scale > 0 ? (Number(point.value) / scale) * 100 : 0
  }));
  return metricLinePath(normalized, width, height, padding);
}

function temperatureLineChart(values = [], current = null) {
  let points = values.map((point) => typeof point === "number" ? { value: point, label: "sem horario" } : point);
  if (!points.length && current !== null && Number.isFinite(Number(current))) {
    points = [{ value: Number(current), label: "leitura atual" }, { value: Number(current), label: "leitura atual" }];
  }
  if (!points.length) {
    return `<div class="metric-empty performance-empty">sem serie historica de temperatura</div>`;
  }

  const width = 720;
  const height = 220;
  const padding = { top: 24, right: 22, bottom: 36, left: 42 };
  const yTicks = [100, 75, 50, 25, 0];
  const xTicks = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((value, index, array) => array.indexOf(value) === index);
  const path = scaledMetricLinePath(points, width, height, padding, 100);
  const summary = metricSummary(points);

  return `
    <div class="performance-chart temperature-chart">
      <div class="performance-legend">
        <span><i class="temperature"></i>Temperatura</span>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Historico de temperatura do servidor">
        ${yTicks.map((tick) => {
          const y = padding.top + ((100 - tick) / 100) * (height - padding.top - padding.bottom);
          return `<g class="chart-grid"><line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}"></line><text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}">${tick}C</text></g>`;
        }).join("")}
        ${xTicks.map((index) => {
          const x = padding.left + (points.length === 1 ? 0 : (index / (points.length - 1)) * (width - padding.left - padding.right));
          return `<g class="chart-x"><line x1="${x.toFixed(1)}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${height - padding.bottom}"></line><text x="${x.toFixed(1)}" y="${height - 12}">${escapeHtml(points[index]?.label || "")}</text></g>`;
        }).join("")}
        ${path ? `<path class="chart-line temperature" d="${path}"></path>` : ""}
      </svg>
    </div>
    <div class="performance-stats">
      <span>Atual <strong>${escapeHtml(`${summary.latest.value.toFixed(1)} C`)}</strong></span>
      <span>Pico <strong>${escapeHtml(`${summary.peak.value.toFixed(1)} C`)}</strong></span>
      <span>Amostras <strong>${escapeHtml(String(points.length))}</strong></span>
    </div>
  `;
}

function performanceLineChart(cpuValues, memoryValues, diskValues = [], storage = {}) {
  const cpuPoints = cpuValues.map((point) => typeof point === "number" ? { value: point, label: "sem horario" } : point);
  const memoryPoints = memoryValues.map((point) => typeof point === "number" ? { value: point, label: "sem horario" } : point);
  let diskPoints = diskValues.map((point) => typeof point === "number" ? { value: point, label: "sem horario" } : point);
  const basePoints = [cpuPoints, memoryPoints, diskPoints].sort((a, b) => b.length - a.length)[0] || [];
  if (!diskPoints.length && storage.percent !== null && Number.isFinite(Number(storage.percent))) {
    const fallbackPoints = basePoints.length ? basePoints : [{ label: "leitura atual" }, { label: "leitura atual" }];
    diskPoints = fallbackPoints.map((point) => ({ label: point.label || "leitura atual", value: Number(storage.percent) }));
  }
  const points = [cpuPoints, memoryPoints, diskPoints].sort((a, b) => b.length - a.length)[0] || [];
  if (!cpuPoints.length && !memoryPoints.length && !diskPoints.length) {
    return `<div class="metric-empty performance-empty">sem serie historica de CPU/memoria/disco</div>`;
  }

  const width = 720;
  const height = 260;
  const padding = { top: 24, right: 22, bottom: 36, left: 42 };
  const yTicks = [100, 75, 50, 25, 0];
  const xTicks = points.length
    ? [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((value, index, array) => array.indexOf(value) === index)
    : [];
  const cpuPath = metricLinePath(cpuPoints, width, height, padding);
  const memoryPath = metricLinePath(memoryPoints, width, height, padding);
  const diskPath = metricLinePath(diskPoints, width, height, padding);
  const memoryArea = metricAreaPath(memoryPoints, width, height, padding);
  const cpu = cpuPoints.length ? metricSummary(cpuPoints) : null;
  const memory = memoryPoints.length ? metricSummary(memoryPoints) : null;
  const disk = diskPoints.length ? metricSummary(diskPoints) : null;

  return `
    <div class="performance-chart">
      <div class="performance-legend">
        <span><i class="cpu"></i>CPU</span>
        <span><i class="memory"></i>Memoria</span>
        <span><i class="disk"></i>Disco</span>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Historico de CPU, memoria e disco">
        <defs>
          <linearGradient id="memory-area-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#39c87a" stop-opacity="0.28" />
            <stop offset="100%" stop-color="#39c87a" stop-opacity="0.04" />
          </linearGradient>
        </defs>
        ${yTicks.map((tick) => {
          const y = padding.top + ((100 - tick) / 100) * (height - padding.top - padding.bottom);
          return `<g class="chart-grid"><line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}"></line><text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}">${tick}</text></g>`;
        }).join("")}
        ${xTicks.map((index) => {
          const x = padding.left + (points.length === 1 ? 0 : (index / (points.length - 1)) * (width - padding.left - padding.right));
          return `<g class="chart-x"><line x1="${x.toFixed(1)}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${height - padding.bottom}"></line><text x="${x.toFixed(1)}" y="${height - 12}">${escapeHtml(points[index]?.label || "")}</text></g>`;
        }).join("")}
        ${memoryArea ? `<path class="chart-area memory" d="${memoryArea}"></path>` : ""}
        ${memoryPath ? `<path class="chart-line memory" d="${memoryPath}"></path>` : ""}
        ${diskPath ? `<path class="chart-line disk" d="${diskPath}"></path>` : ""}
        ${cpuPath ? `<path class="chart-line cpu" d="${cpuPath}"></path>` : ""}
      </svg>
    </div>
    <div class="performance-stats">
      <span>CPU atual <strong>${escapeHtml(cpu ? `${cpu.latest.value.toFixed(1)}%` : "-")}</strong></span>
      <span>Pico CPU <strong>${escapeHtml(cpu ? `${cpu.peak.value.toFixed(1)}%` : "-")}</strong></span>
      <span>Memoria atual <strong>${escapeHtml(memory ? `${memory.latest.value.toFixed(1)}%` : "-")}</strong></span>
      <span>Pico memoria <strong>${escapeHtml(memory ? `${memory.peak.value.toFixed(1)}%` : "-")}</strong></span>
      <span>Disco atual <strong>${escapeHtml(disk ? `${disk.latest.value.toFixed(1)}%` : storage.percent !== null ? `${storage.percent.toFixed(1)}%` : "-")}</strong></span>
      <span>Pico disco <strong>${escapeHtml(disk ? `${disk.peak.value.toFixed(1)}%` : "-")}</strong></span>
      <span>HD/SSD total <strong>${escapeHtml(bytesLabel(storage.total))}</strong></span>
      <span>Em uso <strong>${escapeHtml(storage.used !== null ? bytesLabel(storage.used) : storage.percent !== null ? `${storage.percent.toFixed(1)}%` : "-")}</strong></span>
      <span>Livre <strong>${escapeHtml(bytesLabel(storage.free))}</strong></span>
    </div>
  `;
}

function networkLineChart(metrics = {}) {
  const rows = networkMetricRows(metrics);
  const downloadPoints = networkSeriesValues(rows, ["rxBytesPerSecond", "downloadBytesPerSecond", "rxBps", "downloadBps"]);
  const uploadPoints = networkSeriesValues(rows, ["txBytesPerSecond", "uploadBytesPerSecond", "txBps", "uploadBps"]);
  const latencyPoints = networkSeriesValues(rows, ["latencyMs", "pingMs", "rttMs"]);
  const lossPoints = networkSeriesValues(rows, ["packetLossPercent", "lossPercent", "packetLoss"]);
  const points = [downloadPoints, uploadPoints, latencyPoints, lossPoints].sort((a, b) => b.length - a.length)[0] || [];
  if (!downloadPoints.length && !uploadPoints.length && !latencyPoints.length && !lossPoints.length) {
    return `<div class="metric-empty performance-empty">sem serie historica de rede</div>`;
  }

  const width = 720;
  const height = 260;
  const padding = { top: 24, right: 22, bottom: 36, left: 42 };
  const trafficMax = Math.max(1, ...downloadPoints.map((point) => point.value), ...uploadPoints.map((point) => point.value));
  const latencyMax = Math.max(1, ...latencyPoints.map((point) => point.value));
  const lossMax = Math.max(1, ...lossPoints.map((point) => point.value), 100);
  const yTicks = [100, 75, 50, 25, 0];
  const xTicks = points.length
    ? [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((value, index, array) => array.indexOf(value) === index)
    : [];
  const downloadPath = scaledMetricLinePath(downloadPoints, width, height, padding, trafficMax);
  const uploadPath = scaledMetricLinePath(uploadPoints, width, height, padding, trafficMax);
  const latencyPath = scaledMetricLinePath(latencyPoints, width, height, padding, latencyMax);
  const lossPath = scaledMetricLinePath(lossPoints, width, height, padding, lossMax);
  const download = downloadPoints.length ? metricSummary(downloadPoints) : null;
  const upload = uploadPoints.length ? metricSummary(uploadPoints) : null;
  const latency = latencyPoints.length ? metricSummary(latencyPoints) : null;
  const loss = lossPoints.length ? metricSummary(lossPoints) : null;
  const latest = rows[rows.length - 1] || {};
  const reachability = [
    latest.gatewayReachable === true ? "gateway ok" : latest.gatewayReachable === false ? "gateway falhou" : "",
    latest.internetReachable === true ? "internet ok" : latest.internetReachable === false ? "internet falhou" : ""
  ].filter(Boolean).join(" | ") || "-";

  return `
    <div class="performance-chart network-chart">
      <div class="performance-legend">
        <span><i class="download"></i>Download</span>
        <span><i class="upload"></i>Upload</span>
        <span><i class="latency"></i>Latencia</span>
        <span><i class="loss"></i>Perda</span>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Historico de desempenho da rede">
        ${yTicks.map((tick) => {
          const y = padding.top + ((100 - tick) / 100) * (height - padding.top - padding.bottom);
          return `<g class="chart-grid"><line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}"></line><text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}">${tick}</text></g>`;
        }).join("")}
        ${xTicks.map((index) => {
          const x = padding.left + (points.length === 1 ? 0 : (index / (points.length - 1)) * (width - padding.left - padding.right));
          return `<g class="chart-x"><line x1="${x.toFixed(1)}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${height - padding.bottom}"></line><text x="${x.toFixed(1)}" y="${height - 12}">${escapeHtml(points[index]?.label || "")}</text></g>`;
        }).join("")}
        ${downloadPath ? `<path class="chart-line download" d="${downloadPath}"></path>` : ""}
        ${uploadPath ? `<path class="chart-line upload" d="${uploadPath}"></path>` : ""}
        ${latencyPath ? `<path class="chart-line latency" d="${latencyPath}"></path>` : ""}
        ${lossPath ? `<path class="chart-line loss" d="${lossPath}"></path>` : ""}
      </svg>
    </div>
    <div class="performance-stats">
      <span>Download atual <strong>${escapeHtml(download ? bytesPerSecondLabel(download.latest.value) : "-")}</strong></span>
      <span>Pico download <strong>${escapeHtml(download ? bytesPerSecondLabel(download.peak.value) : "-")}</strong></span>
      <span>Upload atual <strong>${escapeHtml(upload ? bytesPerSecondLabel(upload.latest.value) : "-")}</strong></span>
      <span>Pico upload <strong>${escapeHtml(upload ? bytesPerSecondLabel(upload.peak.value) : "-")}</strong></span>
      <span>Latencia atual <strong>${escapeHtml(latency ? `${latency.latest.value.toFixed(0)} ms` : "-")}</strong></span>
      <span>Pico latencia <strong>${escapeHtml(latency ? `${latency.peak.value.toFixed(0)} ms` : "-")}</strong></span>
      <span>Perda atual <strong>${escapeHtml(loss ? `${loss.latest.value.toFixed(1)}%` : "-")}</strong></span>
      <span>Interface <strong>${escapeHtml(latest.interface || latest.interfaceName || "-")}</strong></span>
      <span>Alcance <strong>${escapeHtml(reachability)}</strong></span>
    </div>
  `;
}

function localNetworkLineChart(metrics = {}) {
  const rows = networkMetricRows(metrics);
  const gatewayLatencyPoints = networkSeriesValues(rows, ["gatewayLatencyMs", "gatewayPingMs", "lanLatencyMs", "localLatencyMs"]);
  const centralLatencyPoints = networkSeriesValues(rows, ["centralLatencyMs", "centralPingMs"]);
  const dnsLatencyPoints = networkSeriesValues(rows, ["dnsLatencyMs", "dnsLookupMs", "dnsMs"]);
  const localLossPoints = networkSeriesValues(rows, ["gatewayPacketLossPercent", "gatewayLossPercent", "lanPacketLossPercent", "localPacketLossPercent"]);
  const utilizationPoints = networkSeriesValues(rows, ["linkUtilizationPercent", "interfaceUtilizationPercent"]);
  const errorPoints = rows.map((row) => {
    const rxErrors = Number(row.rxErrorsPerSecond ?? row.receiveErrorsPerSecond ?? row.rxErrorRate ?? 0);
    const txErrors = Number(row.txErrorsPerSecond ?? row.transmitErrorsPerSecond ?? row.txErrorRate ?? 0);
    const rxDropped = Number(row.rxDroppedPerSecond ?? row.receiveDroppedPerSecond ?? row.rxDropRate ?? 0);
    const txDropped = Number(row.txDroppedPerSecond ?? row.transmitDroppedPerSecond ?? row.txDropRate ?? 0);
    const value = [rxErrors, txErrors, rxDropped, txDropped].filter(Number.isFinite).reduce((total, item) => total + item, 0);
    return { value, label: row.label };
  }).filter((point) => Number.isFinite(point.value) && point.value > 0);
  const points = [gatewayLatencyPoints, centralLatencyPoints, dnsLatencyPoints, localLossPoints, utilizationPoints, errorPoints].sort((a, b) => b.length - a.length)[0] || [];
  if (!gatewayLatencyPoints.length && !centralLatencyPoints.length && !dnsLatencyPoints.length && !localLossPoints.length && !utilizationPoints.length && !errorPoints.length) {
    return `<div class="metric-empty performance-empty">sem serie historica de rede local</div>`;
  }

  const width = 720;
  const height = 260;
  const padding = { top: 24, right: 22, bottom: 36, left: 42 };
  const latencyMax = Math.max(1, ...gatewayLatencyPoints.map((point) => point.value), ...centralLatencyPoints.map((point) => point.value), ...dnsLatencyPoints.map((point) => point.value));
  const lossMax = Math.max(1, ...localLossPoints.map((point) => point.value), 100);
  const utilizationMax = Math.max(1, ...utilizationPoints.map((point) => point.value), 100);
  const errorMax = Math.max(1, ...errorPoints.map((point) => point.value));
  const yTicks = [100, 75, 50, 25, 0];
  const xTicks = points.length
    ? [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((value, index, array) => array.indexOf(value) === index)
    : [];
  const gatewayPath = scaledMetricLinePath(gatewayLatencyPoints, width, height, padding, latencyMax);
  const centralPath = scaledMetricLinePath(centralLatencyPoints, width, height, padding, latencyMax);
  const dnsPath = scaledMetricLinePath(dnsLatencyPoints, width, height, padding, latencyMax);
  const lossPath = scaledMetricLinePath(localLossPoints, width, height, padding, lossMax);
  const utilizationPath = scaledMetricLinePath(utilizationPoints, width, height, padding, utilizationMax);
  const errorPath = scaledMetricLinePath(errorPoints, width, height, padding, errorMax);
  const gateway = gatewayLatencyPoints.length ? metricSummary(gatewayLatencyPoints) : null;
  const central = centralLatencyPoints.length ? metricSummary(centralLatencyPoints) : null;
  const dns = dnsLatencyPoints.length ? metricSummary(dnsLatencyPoints) : null;
  const loss = localLossPoints.length ? metricSummary(localLossPoints) : null;
  const utilization = utilizationPoints.length ? metricSummary(utilizationPoints) : null;
  const errors = errorPoints.length ? metricSummary(errorPoints) : null;
  const latest = rows[rows.length - 1] || {};

  return `
    <div class="performance-chart local-network-chart">
      <div class="performance-legend">
        <span><i class="gateway"></i>Gateway</span>
        <span><i class="central"></i>Central</span>
        <span><i class="dns"></i>DNS</span>
        <span><i class="loss"></i>Perda</span>
        <span><i class="utilization"></i>Uso link</span>
        <span><i class="errors"></i>Erros</span>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Historico de qualidade da rede local">
        ${yTicks.map((tick) => {
          const y = padding.top + ((100 - tick) / 100) * (height - padding.top - padding.bottom);
          return `<g class="chart-grid"><line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}"></line><text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}">${tick}</text></g>`;
        }).join("")}
        ${xTicks.map((index) => {
          const x = padding.left + (points.length === 1 ? 0 : (index / (points.length - 1)) * (width - padding.left - padding.right));
          return `<g class="chart-x"><line x1="${x.toFixed(1)}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${height - padding.bottom}"></line><text x="${x.toFixed(1)}" y="${height - 12}">${escapeHtml(points[index]?.label || "")}</text></g>`;
        }).join("")}
        ${gatewayPath ? `<path class="chart-line gateway" d="${gatewayPath}"></path>` : ""}
        ${centralPath ? `<path class="chart-line central" d="${centralPath}"></path>` : ""}
        ${dnsPath ? `<path class="chart-line dns" d="${dnsPath}"></path>` : ""}
        ${lossPath ? `<path class="chart-line loss" d="${lossPath}"></path>` : ""}
        ${utilizationPath ? `<path class="chart-line utilization" d="${utilizationPath}"></path>` : ""}
        ${errorPath ? `<path class="chart-line errors" d="${errorPath}"></path>` : ""}
      </svg>
    </div>
    <div class="performance-stats">
      <span>Gateway atual <strong>${escapeHtml(gateway ? `${gateway.latest.value.toFixed(0)} ms` : "-")}</strong></span>
      <span>Pico gateway <strong>${escapeHtml(gateway ? `${gateway.peak.value.toFixed(0)} ms` : "-")}</strong></span>
      <span>Central atual <strong>${escapeHtml(central ? `${central.latest.value.toFixed(0)} ms` : "-")}</strong></span>
      <span>DNS atual <strong>${escapeHtml(dns ? `${dns.latest.value.toFixed(0)} ms` : "-")}</strong></span>
      <span>Perda local <strong>${escapeHtml(loss ? `${loss.latest.value.toFixed(1)}%` : "-")}</strong></span>
      <span>Uso do link <strong>${escapeHtml(utilization ? `${utilization.latest.value.toFixed(1)}%` : "-")}</strong></span>
      <span>Erros/drops <strong>${escapeHtml(errors ? `${errors.latest.value.toFixed(1)}/s` : "-")}</strong></span>
      <span>Velocidade link <strong>${escapeHtml(Number.isFinite(Number(latest.linkSpeedMbps)) ? `${Number(latest.linkSpeedMbps).toFixed(0)} Mbps` : "-")}</strong></span>
      <span>Interface <strong>${escapeHtml(latest.interface || latest.interfaceName || "-")}</strong></span>
    </div>
  `;
}

function renderBackupFiles(files = [], client = null) {
  if (!Array.isArray(files) || files.length === 0) {
    return `<p class="empty-note">Nenhum arquivo de backup recente informado.</p>`;
  }
  const validateBackups = environmentPlatform(client) !== "windows";
  const orderedFiles = [...files].sort((a, b) => backupFileTimestamp(b) - backupFileTimestamp(a));
  const manifests = new Set(orderedFiles.filter(isBackupManifestFile).map(backupFileKey));
  return orderedFiles.slice(0, 8).map((file) => {
    const databaseLabel = backupDatabaseLabel(file, client);
    const fileName = file.name || file.path || "Backup";
    const status = !validateBackups
      ? "backup informado pelo agente"
      : isBackupManifestFile(file)
        ? "manifesto de validacao"
        : manifests.has(backupFileKey(file))
          ? "backup validado"
          : "aguardando validacao";
    return `
      <article class="detail-list-item ${validateBackups && isBackupPayloadFile(file) && !manifests.has(backupFileKey(file)) ? "warning" : ""}">
        <strong>${escapeHtml(databaseLabel ? `Banco: ${databaseLabel}` : "Banco nao identificado")}</strong>
        <span>${escapeHtml(file.modifiedAt ? formatRelativeTime(file.modifiedAt) : "-")} ${file.size ? `- ${escapeHtml(bytesLabel(file.size))}` : ""}</span>
        <small>${escapeHtml(`${status} | ${fileName}`)}</small>
      </article>
    `;
  }).join("");
}

function serviceStatusTone(status) {
  const value = String(status || "").toLowerCase();
  if (["running", "online", "healthy", "up"].includes(value)) return "online";
  if (["exited", "stopped", "dead", "missing", "offline"].includes(value)) return "offline";
  if (["degraded", "unhealthy", "restarting", "paused", "error"].includes(value)) return "warning";
  return "unknown";
}

function serviceStatusLabel(status) {
  const labels = {
    running: "Ativo",
    online: "Online",
    healthy: "Saudavel",
    up: "Ativo",
    exited: "Parado",
    stopped: "Parado",
    dead: "Parado",
    missing: "Ausente",
    offline: "Offline",
    degraded: "Degradado",
    unhealthy: "Com falha",
    restarting: "Reiniciando",
    paused: "Pausado",
    error: "Erro",
    unknown: "Desconhecido"
  };
  const value = String(status || "unknown").toLowerCase();
  return labels[value] || status || "Desconhecido";
}

function containerVersionLabel(container = {}) {
  return container.version
    || container.imageTag
    || container.revision
    || container.imageId
    || "-";
}

function renderServiceInventory(services = {}, platform = "") {
  const apps = Array.isArray(services.apps) ? services.apps : [];
  const looseContainers = Array.isArray(services.containers) ? services.containers : [];
  const hasInventory = apps.length > 0 || looseContainers.length > 0;
  if (!hasInventory) {
    const message = platform === "windows"
      ? "O Agent Windows ainda nao informou containers WSL/Docker neste ambiente."
      : "Nenhum inventario de containers recebido neste heartbeat.";
    const details = [
      services.platform ? `origem: ${services.platform}` : "",
      services.collectedAt ? `coleta: ${formatDateTime(services.collectedAt)}` : "",
      services.detail || ""
    ].filter(Boolean);
    return `
      <p class="empty-note">${escapeHtml(message)}</p>
      ${details.length ? `<p class="empty-note">${escapeHtml(details.join(" | "))}</p>` : ""}
    `;
  }

  const appContainerNames = new Set();
  const appRows = apps.flatMap((app) => {
    const containers = Array.isArray(app.containers) ? app.containers : [];
    if (!containers.length) {
      return [{
        app: app.title || app.name || "Aplicacao",
        name: app.name || app.title || "Aplicacao",
        status: app.status || "unknown",
        detail: app.health?.status ? `health ${app.health.status}` : "",
        image: "",
        version: app.version || app.branch || ""
      }];
    }
    return containers.map((container) => ({
      ...container,
      app: app.title || app.name || "Aplicacao"
    }));
  });
  appRows.forEach((container) => {
    if (container.name) appContainerNames.add(container.name);
  });
  const looseRows = looseContainers
    .filter((container) => !container.name || !appContainerNames.has(container.name))
    .map((container) => ({ ...container, app: services.platform || "WSL/Docker" }));
  const rows = [...appRows, ...looseRows];

  return `
    <div class="service-table">
      <div class="service-header" aria-hidden="true">
        <span>Servico</span>
        <span>Status</span>
        <span>Versao</span>
        <span>Imagem / detalhe</span>
      </div>
      ${rows.slice(0, 40).map((container) => {
        const tone = serviceStatusTone(container.status);
        return `
          <article class="service-row">
            <div class="service-name">
              <strong>${escapeHtml(container.name || "container")}</strong>
              <span>${escapeHtml(container.app || "-")}</span>
            </div>
            <span class="status ${escapeHtml(tone)}">${escapeHtml(serviceStatusLabel(container.status))}</span>
            <span class="service-version">${escapeHtml(containerVersionLabel(container))}</span>
            <small class="service-detail">${escapeHtml(container.image || container.detail || "-")}</small>
          </article>
        `;
      }).join("")}
      ${rows.length > 40 ? `<p class="empty-note">Exibindo 40 de ${rows.length} itens recebidos.</p>` : ""}
    </div>
  `;
}

function renderClientAlerts(client) {
  const alerts = currentAlerts.filter((alert) => alert.clientId === client.id && alert.status !== "resolved" && isVisibleAlert(alert));
  const existingDatabaseAlerts = new Set(alerts.map((alert) => String(alert.details?.databaseAlias || alert.details?.databaseName || "").toLowerCase()).filter(Boolean));
  const derivedDatabaseAlerts = monitoredDatabases(client.databaseInfo).map((database) => {
    const message = databaseProblemMessage(database);
    const alias = databaseDisplayAlias(database) || databaseDisplayName(database);
    if (!message || existingDatabaseAlerts.has(String(alias).toLowerCase())) return null;
    return {
      title: "Banco com problema",
      message,
      severity: "critical",
      status: "open",
      openedAt: database.checkedAt || database.updatedAt || client.updatedAt || client.lastSeenAt,
      details: {
        databaseAlias: databaseDisplayAlias(database),
        databaseName: databaseDisplayName(database)
      }
    };
  }).filter(Boolean);
  const visibleAlerts = [...derivedDatabaseAlerts, ...alerts].slice(0, 8);
  if (visibleAlerts.length === 0) return `<p class="empty-note">Nenhum alerta recente para este cliente.</p>`;
  return visibleAlerts.map((alert) => {
    const database = alert.details?.databaseAlias
      || alert.details?.alias
      || alert.details?.databaseName
      || alert.details?.name
      || "";
    return `
      <article class="detail-list-item ${escapeHtml(alert.severity || "info")}">
        <strong>${escapeHtml(database ? `${alert.title || alert.code || "Alerta"} | Banco: ${database}` : alert.title || alert.code || "Alerta")}</strong>
        <span>${escapeHtml(severityLabels[alert.severity] || alert.severity)} - ${escapeHtml(alert.status === "resolved" ? "Resolvido" : "Aberto")} - ${escapeHtml(formatRelativeTime(alert.openedAt))}</span>
        ${alert.message ? `<small>${escapeHtml(alert.message)}</small>` : ""}
      </article>
    `;
  }).join("");
}

function renderClientDetail(client) {
  const status = monitorStatus(client);
  const statusTone = status === "offline" ? "offline" : status === "warning" ? "warning" : status === "online" ? "online" : "unknown";
  const database = client.databaseInfo || {};
  const host = client.host || {};
  const backups = client.backups || {};
  const googleDrive = client.googleDrive || {};
  const metrics = client.metrics || {};
  const cluster = client.cluster || {};
  const services = client.services || {};
  const platform = environmentPlatform(client);
  const supportsHa = platform !== "windows";
  const location = [client.city, client.state].filter(Boolean).join(" / ") || "-";
  const disk = gaugeValue(client.diskPercent);
  const diskTone = disk === null ? "unknown" : disk >= 90 ? "offline" : disk >= 75 ? "warning" : "online";
  const backupDisk = gaugeValue(backups.disk?.percentUsed);
  const backupDiskTone = backupDisk === null ? "unknown" : backupDisk >= 90 ? "offline" : backupDisk >= 75 ? "warning" : "online";
  const drive = quotaGaugeValue(backups.quota);
  const driveTone = backups.quota?.ok === false ? "warning" : drive === null ? "unknown" : drive >= 90 ? "offline" : drive >= 75 ? "warning" : "online";
  const heartbeatAge = client.lastSeenAt ? formatRelativeTime(client.lastSeenAt) : "sem heartbeat";
  const openAlerts = currentAlerts.filter((alert) => alert.clientId === client.id && alert.status !== "resolved").length;
  const indexStatus = indexHealthStatus(client);
  const databaseSize = databaseSizeLabel(database);
  const cpuSeries = metricSeriesValues(metrics, ["cpuPercent", "cpu", "cpu_percent", "processorPercent"]);
  const memorySeries = metricSeriesValues(metrics, ["memoryPercent", "memPercent", "memory", "memory_percent", "ramPercent"]);
  const diskSeries = metricSeriesValues(metrics, ["diskUsedPercent", "diskPercent", "storagePercent", "disk", "disk_percent"]);
  const cpuModel = host.cpuModel || host.cpuName || host.processorName || "-";
  const cpuCores = host.cpuCores ?? host.processorCount ?? "-";
  const memoryTotal = host.memoryTotalBytes || host.ramTotalBytes || metrics.systemMetrics?.memoryTotalBytes || metrics.systemMetrics?.memory?.totalBytes;
  const memoryTotalLabel = Number.isFinite(Number(memoryTotal)) ? bytesLabel(Number(memoryTotal)) : "-";
  const storage = storageInfo(client);

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
      ${detailMetric("Hora servidor", serverTimeLabel(host) ? formatDateTime(serverTimeLabel(host)) : "-", "neutral", host.timezone || "timezone nao informado")}
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
          ${detailGauge("Disco backup", backupDisk, backupDiskTone, backups.backupDir || "diretorio de backup")}
          ${detailGauge("Google Drive", drive, driveTone, quotaGaugeCaption(backups.quota, googleDrive))}
        </div>
      </article>
    </section>

    <section class="ops-grid ops-detail-main">
      <div class="ops-stack">
        <article class="ops-panel">
          <div class="ops-panel-head"><h3>Servidor</h3></div>
          <div class="detail-grid compact">
            ${detailItem("Hostname", host.hostname)}
            ${detailItem("IP", host.ip)}
            ${detailItem("Hora servidor", serverTimeCaption(host))}
            ${detailItem("Sistema", host.os)}
            ${detailItem("CPU", cpuModel)}
            ${detailItem("Nucleos", cpuCores)}
            ${detailItem("Memoria RAM", memoryTotalLabel)}
            ${detailItem("Uptime", metrics.hostUptimeSeconds ? `${Math.round(Number(metrics.hostUptimeSeconds) / 3600)} h` : "-")}
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
              <h3>Servicos e containers</h3>
              <span>TronComanda, Retaguarda Web, gerente e WSL/Docker</span>
            </div>
          </div>
          ${renderServiceInventory(services, platform)}
        </article>
      </div>

      <div class="ops-stack">
        <article class="ops-panel">
          <div class="ops-panel-head">
            <div>
              <h3>CPU / Memoria / Disco</h3>
              <span>desempenho e armazenamento do servidor</span>
            </div>
          </div>
          ${performanceLineChart(cpuSeries, memorySeries, diskSeries, storage)}
        </article>
      </div>
    </section>

    <section class="ops-grid">
      <article class="ops-panel">
        <div class="ops-panel-head">
          <div>
            <h3>Rede / Internet</h3>
            <span>trafego, latencia e perda ate fora da loja</span>
          </div>
        </div>
        ${networkLineChart(metrics)}
      </article>
      <article class="ops-panel">
        <div class="ops-panel-head">
          <div>
            <h3>Rede local</h3>
            <span>gateway, DNS, link e erros da interface</span>
          </div>
        </div>
        ${localNetworkLineChart(metrics)}
      </article>
    </section>

    <section class="ops-grid">
      <div class="temperature-card-wrap ops-panel-wide">${detailTemperaturePanel(client)}</div>
    </section>

    <section class="ops-grid">
      <article class="ops-panel ops-panel-wide">
        <div class="ops-panel-head"><h3>Bancos Firebird</h3></div>
        ${renderDatabaseSummary(database, client)}
      </article>
    </section>

    <section class="ops-grid">
      <article class="ops-panel ops-panel-wide">
        <div class="ops-panel-head">
          <div>
            <h3>Historico de indices</h3>
            <span>mudancas detectadas pelo agente</span>
          </div>
        </div>
        ${renderDatabasesIndexAuditHistory(database)}
      </article>
    </section>

    <section class="ops-grid">
      <article class="ops-panel">
        <div class="ops-panel-head"><h3>Backups recentes</h3><span>${escapeHtml(backupPanelLabel(client, backups))}</span></div>
        <div class="detail-list">${renderBackupFiles(backups.recentFiles, client)}</div>
      </article>

      <article class="ops-panel">
        <div class="ops-panel-head"><h3>HA / Standby</h3><span>${supportsHa ? "alta disponibilidade" : "nao aplicavel ao Agent Windows"}</span></div>
        ${supportsHa ? `
          <div class="detail-grid compact">
            ${detailItem("Modo", cluster.mode)}
            ${detailItem("No", cluster.identity?.nodeRole || cluster.nodeRole)}
            ${detailItem("Standby pronto", cluster.sync?.standbyReady === true ? "Sim" : cluster.sync?.standbyReady === false ? "Nao" : "-")}
            ${detailItem("Lag standby", cluster.sync?.standbyLagMinutes !== undefined ? `${cluster.sync.standbyLagMinutes} min` : "-")}
            ${detailItem("Failover", cluster.failover?.enabled === true ? "Ativo" : cluster.failover?.enabled === false ? "Manual/desativado" : "-")}
            ${detailItem("VIP", cluster.vipStatus?.ip || cluster.vip || "-")}
          </div>
        ` : `<p class="empty-note">HA / standby e validacao local sao recursos do TronSoftOS em Linux.</p>`}
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
  const rawClient = client?.rawClient || installation?.client || {};
  return {
    client,
    installation,
    detailId: client?.detailId || installation?.installationId || alert.installationId || client?.id || "",
    clientName: client?.name || installation?.client?.name || "Cliente nao identificado",
    document: rawClient.document || rawClient.customerDocument || "",
    resellerName: client?.reseller || installation?.reseller?.name || "Sem revenda",
    environment: installation?.name || alert.installationId || "-"
  };
}

function eventContext(event) {
  const alert = event.alert || {};
  const installationId = event.installationId || alert.installationId || event.payload?.installationId || "";
  const clientId = event.clientId || alert.clientId || event.payload?.clientId || "";
  const installation = currentInstallations.find((item) => item.installationId === installationId);
  const client = currentClients.find((item) => (
    item.id === clientId ||
    item.detailId === installationId ||
    item.installation?.installationId === installationId
  ));
  const rawClient = client?.rawClient || installation?.client || {};
  return {
    client,
    installation,
    detailId: client?.detailId || installation?.installationId || installationId || client?.id || "",
    clientName: client?.name || installation?.client?.name || event.clientName || "",
    document: rawClient.document || rawClient.customerDocument || "",
    resellerName: client?.reseller || installation?.reseller?.name || "",
    environment: client?.environment || installation?.name || installationId || ""
  };
}

function renderAlerts() {
  const list = document.querySelector("#alerts-list");
  const severityFilter = document.querySelector("#alert-filter")?.value || "";
  const statusFilter = document.querySelector("#alert-status-filter")?.value || "";
  const textFilter = (document.querySelector("#alert-search")?.value || "").trim().toLowerCase();
  if (!list) return;
  const visibleAlerts = currentAlerts
    .filter(isVisibleAlert)
    .filter((alert) => {
      const context = alertContext(alert);
      const isResolved = alert.status === "resolved";
      const searchable = [
        context.clientName,
        context.document,
        context.resellerName,
        context.environment,
        alert.title,
        alert.message,
        alert.code
      ].filter(Boolean).join(" ").toLowerCase();
      if (textFilter && !searchable.includes(textFilter)) return false;
      if (statusFilter === "open" && isResolved) return false;
      if (statusFilter === "resolved" && !isResolved) return false;
      return !severityFilter || alert.severity === severityFilter;
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
            <small>${escapeHtml([context.document, context.resellerName, context.environment].filter(Boolean).join(" / "))}</small>
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

function userResellerScopeLabel(user) {
  const ids = user.allowedResellerIds || [];
  if (user.role === "tronsoft_admin" || (user.effectivePermissions?.includes(permissions.viewAllClients) && ids.length === 0)) {
    return "Todas as revendas";
  }
  if (ids.length === 0) return "Sem revenda vinculada";
  return ids.map(resellerNameById).join(", ");
}

function userPermissionLabel(user) {
  const items = user.effectivePermissions || user.permissions || [];
  if (user.role === "tronsoft_admin") return "Todas as permissoes";
  if (items.length === 0) return "Sem permissoes";
  return items.map((item) => permissionLabels[item] || item).join(", ");
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
          <span>${escapeHtml(roleLabel(user.role))}</span>
          <span>Revendas: ${escapeHtml(userResellerScopeLabel(user))}</span>
          <span>Permissoes: ${escapeHtml(userPermissionLabel(user))}</span>
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

  currentClients.filter((client) => client.installation).forEach((client) => {
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
          ${point.count} servidor(es)<br>
          ${point.online} online, ${point.warning} em atencao
        `)
        .on("click", () => filterEnvironmentsByLocation(point))
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
      <article class="geo-item clickable-row" data-city="${escapeHtml(point.city)}" data-state="${escapeHtml(point.state)}">
        <strong>${escapeHtml(point.city)} / ${escapeHtml(point.state)}</strong>
        <span>${point.count} servidor(es), ${point.online} online, ${point.warning} em atencao</span>
      </article>
    `)
    .join("") || `<p class="empty-note">Cadastre cidade/UF e pareie ambientes para popular o mapa.</p>`;
  list.querySelectorAll("[data-city][data-state]").forEach((item) => {
    item.addEventListener("click", () => filterEnvironmentsByLocation({
      city: item.dataset.city,
      state: item.dataset.state
    }));
  });
}

function filterEnvironmentsByLocation(point) {
  const input = document.querySelector("#environment-filter");
  if (input) input.value = `${point.city} ${point.state}`.trim();
  environmentQuickFilter = "";
  environmentPage = 1;
  showView("environments");
  renderEnvironments();
}

function applyEnvironmentQuickFilter(filter) {
  environmentQuickFilter = filter || "";
  const text = document.querySelector("#environment-filter");
  const pairing = document.querySelector("#environment-pairing-filter");
  const ha = document.querySelector("#environment-ha-filter");
  if (text) text.value = "";
  if (pairing) pairing.value = "";
  if (ha) ha.value = "";
  if (environmentQuickFilter === "database" && pairing) pairing.value = "paired";
  environmentPage = 1;
  showView("environments");
  renderEnvironments();
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

function applySidebarState(collapsed) {
  const shell = document.querySelector("#app-shell");
  const button = document.querySelector("#sidebar-toggle-button");
  if (!shell || !button) return;
  shell.classList.toggle("sidebar-collapsed", Boolean(collapsed));
  button.innerHTML = iconMenu();
  button.title = collapsed ? "Exibir menu" : "Ocultar menu";
  button.setAttribute("aria-label", button.title);
  localStorage.setItem(sidebarCollapsedKey, collapsed ? "1" : "0");
  if (geoLeafletMap) setTimeout(() => geoLeafletMap.invalidateSize(), 120);
}

function toggleSidebar() {
  applySidebarState(!document.querySelector("#app-shell")?.classList.contains("sidebar-collapsed"));
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
    : [{ title: "Sem eventos", detail: "Nenhum alerta recente no escopo atual", summary: "Nenhum alerta recente no escopo atual", occurredAt: null }];

  list.innerHTML = events
    .map(
      (event, index) => {
        const hasMore = String(event.detail || "").length > String(event.summary || event.detail || "").length;
        const fullTitle = String(event.title || "Evento");
        const shortTitle = compactText(fullTitle, 72);
        const context = eventContext(event);
        const contextLabel = [context.clientName, context.environment, context.resellerName].filter(Boolean).join(" / ");
        return `
        <article class="event ${context.detailId ? "clickable-row" : ""}" ${context.detailId ? `data-event-client-detail="${escapeHtml(context.detailId)}"` : ""}>
          <strong title="${escapeHtml(fullTitle)}">${escapeHtml(shortTitle)}</strong>
          ${contextLabel ? `<small class="event-context">${escapeHtml(contextLabel)}</small>` : ""}
          ${event.occurredAt ? `<small>${escapeHtml(formatDateTime(event.occurredAt))}</small>` : ""}
          <span class="event-summary">${escapeHtml(event.summary || event.detail)}</span>
          ${hasMore ? `<button class="event-more-button" type="button" data-event-more="${index}">Ver mais</button><span class="event-detail" hidden>${escapeHtml(event.detail)}</span>` : ""}
        </article>
      `;
      }
    )
    .join("");
  list.querySelectorAll("[data-event-client-detail]").forEach((row) => {
    row.addEventListener("click", () => openClientDetail(row.dataset.eventClientDetail, "dashboard"));
  });
  list.querySelectorAll("[data-event-more]").forEach((button) => {
    button.addEventListener("click", (clickEvent) => {
      clickEvent.stopPropagation();
      const detail = button.parentElement?.querySelector(".event-detail");
      if (!detail) return;
      const expanded = !detail.hidden;
      detail.hidden = expanded;
      button.textContent = expanded ? "Ver mais" : "Ver menos";
    });
  });
}

async function createClient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const result = document.querySelector("#pairing-result");
  const location = normalizeCitySelection(data);
  const scopedBySelect = hasGlobalClientScope();
  const selectedReseller = data.get("resellerId") === directTronsoftOption.id
    ? directTronsoftOption
    : currentResellers.find((reseller) => reseller.id === data.get("resellerId"));

  result.hidden = false;
  result.textContent = "Gerando token...";

  if (!can(permissions.manageClients)) {
    result.textContent = "Seu usuario nao possui permissao para cadastrar clientes.";
    return;
  }

  if (scopedBySelect && !selectedReseller) {
    result.textContent = "Cadastre ou selecione uma revenda antes de cadastrar o cliente.";
    return;
  }

  try {
    const payload = await api("/api/admin/clients", {
      method: "POST",
      body: JSON.stringify({
        resellerId: scopedBySelect && selectedReseller && !selectedReseller.directTronsoft ? selectedReseller.id : "",
        reseller: scopedBySelect && selectedReseller
          ? {
              name: selectedReseller.name,
              document: selectedReseller.document,
              directTronsoft: Boolean(selectedReseller.directTronsoft)
            }
          : {
              name: data.get("resellerName"),
              document: digitsOnly(data.get("resellerDocument"))
            },
        customer: {
          name: data.get("customerName"),
          document: digitsOnly(data.get("customerDocument")),
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

function renderBackupJob(job) {
  const result = document.querySelector("#maintenance-backup-result");
  const button = document.querySelector("#maintenance-backup-button");
  if (!result || !button) return;
  const output = [job.stdout, job.stderr].filter(Boolean).join("\n").trim();
  button.disabled = job.status === "running";
  result.hidden = false;
  result.className = `maintenance-result ${escapeHtml(job.status)}`;
  result.innerHTML = `
    <div class="maintenance-status">
      <strong>${job.status === "running" ? "Executando backup" : job.status === "success" ? "Backup concluido" : "Backup falhou"}</strong>
      <span>${job.finishedAt ? formatDateTime(job.finishedAt) : "Aguardando conclusao..."}</span>
    </div>
    ${job.error ? `<p>${escapeHtml(job.error)}</p>` : ""}
    <pre>${escapeHtml(output || "Aguardando saida do comando...")}</pre>
  `;
}

function renderBackupStatus(status) {
  const result = document.querySelector("#maintenance-backup-status");
  const downloadButton = document.querySelector("#maintenance-backup-download-button");
  if (!result) return;
  if (downloadButton) downloadButton.disabled = !status.ok || status.downloadable === false;
  result.className = `maintenance-result ${status.ok ? "success" : "failed"}`;
  if (!status.ok) {
    result.innerHTML = `
      <div class="maintenance-status">
        <strong>Sem backup registrado</strong>
        <span>${escapeHtml(status.backupDir || "")}</span>
      </div>
      <p>${escapeHtml(status.message || "Nenhum backup encontrado.")}</p>
    `;
    return;
  }
  const remoteLabel = status.remoteStatus === "success"
    ? "copia remota OK"
    : status.remoteStatus === "failed"
      ? `copia remota falhou: ${status.remoteError || "erro desconhecido"}`
      : "copia remota nao configurada";
  result.innerHTML = `
    <div class="maintenance-status">
      <strong>Ultimo backup: ${escapeHtml(status.fileName || "-")}</strong>
      <span>${escapeHtml(formatDateTime(status.createdAt))}</span>
    </div>
    ${status.message ? `<p>${escapeHtml(status.message)}</p>` : ""}
    <p>${escapeHtml(bytesLabel(status.sizeBytes))} - ${escapeHtml(status.storage || "storage")} - ${escapeHtml(remoteLabel)}</p>
    <p><code>${escapeHtml(status.file || "")}</code></p>
    <p>SHA256: <code>${escapeHtml(status.sha256 || "")}</code></p>
  `;
}

function downloadLatestBackup() {
  window.location.href = "/api/maintenance/backup/download";
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

async function pollBackupJob() {
  if (!backupJobId) return;
  try {
    const job = await api(`/api/maintenance/jobs/${backupJobId}`);
    renderBackupJob(job);
    if (job.status === "running") {
      backupPollTimer = setTimeout(pollBackupJob, 2000);
      return;
    }
    backupJobId = null;
    await loadBackupStatus();
  } catch (error) {
    const result = document.querySelector("#maintenance-backup-result");
    if (result) {
      result.hidden = false;
      result.className = "maintenance-result failed";
      result.textContent = error.message || "Nao foi possivel consultar o backup.";
    }
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

async function loadBackupStatus() {
  const result = document.querySelector("#maintenance-backup-status");
  if (!result || !can(permissions.maintenance)) return;
  try {
    const status = await api("/api/maintenance/backup/status");
    renderBackupStatus(status);
  } catch (error) {
    result.className = "maintenance-result failed";
    result.textContent = error.message || "Nao foi possivel consultar o status do backup.";
  }
}

async function requestMaintenanceBackup() {
  const result = document.querySelector("#maintenance-backup-result");
  const button = document.querySelector("#maintenance-backup-button");
  if (!confirm("Executar backup da Central agora?")) return;
  button.disabled = true;
  result.hidden = false;
  result.className = "maintenance-result running";
  result.innerHTML = "<strong>Iniciando backup...</strong>";
  if (backupPollTimer) clearTimeout(backupPollTimer);

  try {
    const payload = await api("/api/maintenance/backup", { method: "POST" });
    backupJobId = payload.job.id;
    renderBackupJob(payload.job);
    backupPollTimer = setTimeout(pollBackupJob, 1500);
  } catch (error) {
    button.disabled = false;
    result.className = "maintenance-result failed";
    result.textContent = error.message || "Nao foi possivel iniciar o backup.";
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

function defaultPermissionsForRole(role) {
  if (role === "tronsoft_admin") return Object.values(permissions);
  if (role === "tronsoft_user") return [permissions.viewMonitor, permissions.viewAllClients];
  return [permissions.viewMonitor, permissions.manageClients, permissions.generateTokens];
}

function renderPermissionOptions() {
  const grid = document.querySelector("#user-permissions-grid");
  if (!grid) return;
  grid.innerHTML = Object.entries(permissionLabels)
    .filter(([value]) => currentUser?.role === "tronsoft_admin" || can(value))
    .map(([value, label]) => `
      <label class="permission-check">
        <input type="checkbox" name="permissions" value="${escapeHtml(value)}">
        <span>${escapeHtml(label)}</span>
      </label>
    `)
    .join("");
}

function selectedValues(select) {
  return Array.from(select?.selectedOptions || []).map((option) => option.value);
}

async function createUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const result = document.querySelector("#user-result");
  const role = data.get("role");
  const allowedResellerIds = selectedValues(document.querySelector("#user-allowed-resellers"));
  const selectedPermissions = Array.from(document.querySelectorAll("#user-permissions-grid input:checked"))
    .map((input) => input.value);

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
        allowedResellerIds,
        permissions: role === "tronsoft_admin" ? [] : selectedPermissions,
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
  const accessPanel = document.querySelector("#user-access-panel");
  const allowedResellers = document.querySelector("#user-allowed-resellers");
  const permissionsPanel = document.querySelector("#user-permissions-panel");
  const defaults = new Set(defaultPermissionsForRole(role));
  resellerSelect.hidden = role !== "reseller_user";
  resellerSelect.required = role === "reseller_user";
  accessPanel.hidden = role === "tronsoft_admin";
  permissionsPanel.hidden = role === "tronsoft_admin";
  allowedResellers.disabled = role === "tronsoft_admin";
  document.querySelectorAll("#user-permissions-grid input").forEach((input) => {
    input.checked = defaults.has(input.value);
    input.disabled = role === "tronsoft_admin" || (currentUser?.role !== "tronsoft_admin" && !can(input.value));
  });
  if (role === "reseller_user" && resellerSelect.value) {
    Array.from(allowedResellers.options).forEach((option) => {
      option.selected = option.value === resellerSelect.value;
    });
  } else if (role === "tronsoft_user") {
    Array.from(allowedResellers.options).forEach((option) => {
      option.selected = false;
    });
  }
}

function syncPrimaryResellerScope() {
  const role = document.querySelector("#user-role-select").value;
  if (role !== "reseller_user") return;
  const resellerId = document.querySelector("#user-reseller-select").value;
  const allowedResellers = document.querySelector("#user-allowed-resellers");
  Array.from(allowedResellers.options).forEach((option) => {
    option.selected = option.value === resellerId;
  });
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
document.querySelector("#alert-status-filter").addEventListener("change", renderAlerts);
document.querySelector("#alert-search").addEventListener("input", renderAlerts);
document.querySelector("#client-filter")?.addEventListener("input", (event) => {
  clientPage = 1;
  renderClients(event.target.value);
});
["#environment-filter", "#environment-pairing-filter", "#environment-ha-filter"].forEach((selector) => {
  document.querySelector(selector)?.addEventListener("input", () => {
    environmentQuickFilter = "";
    environmentPage = 1;
    renderEnvironments();
  });
  document.querySelector(selector)?.addEventListener("change", () => {
    environmentQuickFilter = "";
    environmentPage = 1;
    renderEnvironments();
  });
});
document.querySelector("#client-form").addEventListener("submit", createClient);
document.querySelectorAll("#client-form input[name='customerDocument'], #client-form input[name='resellerDocument']").forEach((input) => {
  input.addEventListener("input", () => {
    input.value = digitsOnly(input.value);
  });
});
document.querySelector("#client-edit-form").addEventListener("submit", saveClientEdit);
document.querySelector("#client-edit-close").addEventListener("click", closeClientEditModal);
document.querySelector("#client-edit-cancel").addEventListener("click", closeClientEditModal);
document.querySelector("#client-edit-status").addEventListener("click", () => runClientModalAction("status"));
document.querySelector("#client-edit-token").addEventListener("click", () => runClientModalAction("token"));
document.querySelector("#client-edit-unpair").addEventListener("click", () => runClientModalAction("unpair"));
document.querySelector("#client-edit-delete").addEventListener("click", () => runClientModalAction("delete"));
document.querySelector("#client-edit-modal").addEventListener("click", (event) => {
  if (event.target.id === "client-edit-modal") closeClientEditModal();
});
document.querySelector("#client-edit-form input[name='document']").addEventListener("input", (event) => {
  event.target.value = digitsOnly(event.target.value);
});
document.querySelector("#reseller-form").addEventListener("submit", createReseller);
document.querySelector("#user-form").addEventListener("submit", createUser);
document.querySelector("#user-role-select").addEventListener("change", updateUserRoleFields);
document.querySelector("#user-reseller-select").addEventListener("change", syncPrimaryResellerScope);
document.querySelector("#account-password-form").addEventListener("submit", changeOwnPassword);
document.querySelector("#client-detail-back").addEventListener("click", closeClientDetail);
document.querySelector("#maintenance-update-button").addEventListener("click", requestMaintenanceUpdate);
document.querySelector("#maintenance-backup-button").addEventListener("click", requestMaintenanceBackup);
document.querySelector("#maintenance-backup-refresh-button").addEventListener("click", loadBackupStatus);
document.querySelector("#maintenance-backup-download-button").addEventListener("click", downloadLatestBackup);
document.querySelector("#sidebar-toggle-button").addEventListener("click", toggleSidebar);

document.querySelector("#refresh-button").innerHTML = iconRefresh();
document.querySelector("#logout-button").innerHTML = iconLogout();
applySidebarState(localStorage.getItem(sidebarCollapsedKey) === "1");
applyTheme(localStorage.getItem(themeKey) || "light");
setupCityOptions();
updateUserRoleFields();
startDashboardAutoRefresh();
loadSession();
