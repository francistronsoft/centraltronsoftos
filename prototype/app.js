const statusLabels = {
  online: "Online",
  warning: "Atencao",
  offline: "Offline",
  unknown: "Desconhecido"
};

let currentUser = null;
let currentClients = [];
let currentAuthEvents = [];
let currentResellers = [];
let currentOAuthSummary = null;
let activeView = "dashboard";

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
  activeView = !tronsoft && view === "resellers" ? "clients" : view;

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
      database: [
        installation.database?.engine,
        installation.database?.version,
        installation.database?.schemaVersion
      ]
        .filter(Boolean)
        .join(" / ") || "-",
      status: installation.status,
      lastSeen: installation.lastSeenAt ? new Date(installation.lastSeenAt).toLocaleString("pt-BR") : "-",
      pairingToken: ""
    }));
  });

  currentAuthEvents = alerts.slice(-4).reverse().map((alert) => ({
    title: alert.title,
    detail: `${alert.severity} - ${alert.message || alert.code || "Sem detalhes"}`
  }));

  renderMetrics(dashboard);
  renderClients(document.querySelector("#client-filter").value);
  renderGeoMap();
  renderAuthEvents();
  renderOAuthSummary();
}

function renderMetrics(dashboard) {
  document.querySelector("#metric-resellers").textContent = dashboard.resellers;
  document.querySelector("#metric-clients").textContent = dashboard.clients;
  document.querySelector("#metric-online").textContent = dashboard.online;
  document.querySelector("#metric-alerts").textContent = dashboard.criticalAlerts;
}

function renderClients(filter = "") {
  const table = document.querySelector("#clients-table");
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleClients = currentClients.filter((client) => {
    const searchable = `${client.name} ${client.reseller} ${client.environment} ${client.database || ""}`.toLowerCase();
    return searchable.includes(normalizedFilter);
  });

  table.innerHTML = visibleClients
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
document.querySelector("#reseller-filter").addEventListener("change", loadCentralData);
document.querySelector("#client-filter").addEventListener("input", (event) => {
  renderClients(event.target.value);
});
document.querySelector("#client-form").addEventListener("submit", createClient);
document.querySelector("#reseller-form").addEventListener("submit", createReseller);
document.querySelector("#maintenance-update-button").addEventListener("click", requestMaintenanceUpdate);

loadSession();
