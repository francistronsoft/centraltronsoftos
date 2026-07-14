import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { extname, join, normalize, resolve } from "node:path";
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readDb, storageInfo, writeDb } from "./storage.js";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const prototypeDir = join(rootDir, "prototype");
const port = Number(process.env.PORT || 3080);
const sessionCookie = "central_session";
const sessionMaxAgeSeconds = 12 * 60 * 60;
const tronsoftRole = "tronsoft_admin";
const resellerRole = "reseller_user";
const googleDriveScope = "https://www.googleapis.com/auth/drive.file";
const updateCommand = process.env.CENTRAL_UPDATE_COMMAND || "/usr/local/sbin/central-tronsoftos-update";
const updateTimeoutMs = Number(process.env.CENTRAL_UPDATE_TIMEOUT_MS || 15 * 60 * 1000);
const maxJobLogLength = 80_000;
const offlineAfterMinutes = Number(process.env.CENTRAL_OFFLINE_AFTER_MINUTES || 15);
const maintenanceJobs = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function nowIso() {
  return new Date().toISOString();
}

function appendJobLog(job, stream, chunk) {
  job[stream] += chunk.toString();
  if (job[stream].length > maxJobLogLength) {
    job[stream] = job[stream].slice(job[stream].length - maxJobLogLength);
  }
}

function publicMaintenanceJob(job) {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    error: job.error,
    stdout: job.stdout,
    stderr: job.stderr
  };
}

function startMaintenanceUpdateJob() {
  const runningJob = [...maintenanceJobs.values()].reverse().find((job) => job.status === "running");
  if (runningJob) return publicMaintenanceJob(runningJob);

  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const useSudo = typeof process.getuid === "function" && process.getuid() !== 0;
  const command = useSudo ? "sudo" : updateCommand;
  const args = useSudo ? [updateCommand] : [];
  const job = {
    id,
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    exitCode: null,
    error: null,
    stdout: "",
    stderr: ""
  };
  maintenanceJobs.set(id, job);
  appendJobLog(job, "stdout", `$ ${command} ${args.join(" ")}\n`);

  const child = spawn(command, args, {
    cwd: rootDir,
    env: process.env,
    windowsHide: true
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    job.status = "failed";
    job.error = `tempo limite excedido apos ${Math.round(updateTimeoutMs / 60000)} minuto(s)`;
    job.finishedAt = nowIso();
    appendJobLog(job, "stderr", `\n[central] ${job.error}; encerrando atualizacao.\n`);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 5000).unref?.();
  }, Math.max(updateTimeoutMs, 60_000));
  timer.unref?.();

  child.stdout.on("data", (chunk) => appendJobLog(job, "stdout", chunk));
  child.stderr.on("data", (chunk) => appendJobLog(job, "stderr", chunk));
  child.on("error", (error) => {
    clearTimeout(timer);
    job.status = "failed";
    job.error = error.message;
    job.finishedAt = nowIso();
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    job.exitCode = code;
    if (!timedOut) {
      job.status = code === 0 ? "success" : "failed";
      job.finishedAt = nowIso();
    }
  });

  return publicMaintenanceJob(job);
}

function normalizeStatus(status) {
  const allowed = new Set(["online", "warning", "offline", "unknown"]);
  return allowed.has(status) ? status : "unknown";
}

function minutesSince(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((Date.now() - time) / 60000));
}

function effectiveInstallationStatus(installation = {}) {
  const age = minutesSince(installation.lastSeenAt);
  if (age !== null && age > offlineAfterMinutes) return "offline";
  return normalizeStatus(installation.status || "unknown");
}

function normalizeSeverity(severity) {
  const allowed = new Set(["info", "warning", "critical"]);
  return allowed.has(severity) ? severity : "info";
}

function toSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function clientKey(customer) {
  return customer?.document || toSlug(customer?.name);
}

function generatePairingToken() {
  return `cts_${randomUUID().replace(/-/g, "")}`;
}

function generateTemporaryPassword() {
  return randomBytes(9).toString("base64url");
}

function directTronsoftResellerPayload() {
  return {
    name: "TronSoft",
    document: "TRONSOFT-DIRETO",
    accessEmail: process.env.CENTRAL_ADMIN_EMAIL || "suporte@tronsoft.com.br"
  };
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "JSON invalido.");
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-installation-token",
    "access-control-allow-credentials": "true"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function parseCookies(request) {
  return String(request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf("=");
      if (separator > 0) {
        cookies[part.slice(0, separator)] = decodeURIComponent(part.slice(separator + 1));
      }
      return cookies;
    }, {});
}

function sessionCookieHeader(request, token, maxAge = sessionMaxAgeSeconds) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  const secure = forwardedProto === "https";
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [algorithm, salt, hash] = String(stored || "").split("$");
  if (algorithm !== "pbkdf2_sha256" || !salt || !hash) return false;
  const candidate = hashPassword(password, salt).split("$")[2];
  const left = Buffer.from(candidate, "hex");
  const right = Buffer.from(hash, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    resellerId: user.resellerId || null,
    status: user.status
  };
}

function publicReseller(reseller, db) {
  if (!reseller) return null;
  const accessUser = db?.users?.find((user) => user.resellerId === reseller.id && user.role === resellerRole) || null;
  return {
    ...reseller,
    accessEmail: accessUser?.email || reseller.accessEmail || "",
    accessUser: accessUser ? publicUser(accessUser) : null
  };
}

function bootstrapUsers(db) {
  const email = process.env.CENTRAL_ADMIN_EMAIL || "suporte@tronsoft.com.br";
  const password = process.env.CENTRAL_ADMIN_PASSWORD || "admin123";
  const existing = db.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    let changed = false;
    if (existing.role !== tronsoftRole) {
      existing.role = tronsoftRole;
      changed = true;
    }
    if (existing.resellerId !== null) {
      existing.resellerId = null;
      changed = true;
    }
    if (existing.status !== "active") {
      existing.status = "active";
      changed = true;
    }
    if (changed) {
      existing.updatedAt = nowIso();
    }
    return changed;
  }
  db.users.push({
    id: randomUUID(),
    name: "Administrador TronSoft",
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    role: tronsoftRole,
    resellerId: null,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  return true;
}

async function readDbWithBootstrap() {
  const db = await readDb();
  const now = Date.now();
  db.sessions = db.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
  db.oauthStates = db.oauthStates.filter((state) => state.status !== "pending" || new Date(state.expiresAt).getTime() > now);
  if (bootstrapUsers(db)) {
    await writeDb(db);
  }
  return db;
}

function sessionUser(db, request) {
  const token = parseCookies(request)[sessionCookie];
  if (!token) return null;
  const session = db.sessions.find((item) => item.token === token && new Date(item.expiresAt).getTime() > Date.now());
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId && item.status === "active");
  return user || null;
}

function requireUser(db, request) {
  const user = sessionUser(db, request);
  if (!user) {
    throw httpError(401, "UNAUTHORIZED");
  }
  return user;
}

function requireTronsoft(user) {
  if (user.role !== tronsoftRole) {
    throw httpError(403, "Acesso restrito a TronSoft.");
  }
}

function scopedClients(db, user, resellerId = "") {
  if (user.role === resellerRole) {
    return db.clients.filter((client) => client.resellerId === user.resellerId);
  }
  if (resellerId) {
    return db.clients.filter((client) => client.resellerId === resellerId);
  }
  return db.clients;
}

function scopedInstallations(db, user, resellerId = "") {
  const allowedClientIds = new Set(scopedClients(db, user, resellerId).map((client) => client.id));
  return db.installations.filter((installation) => allowedClientIds.has(installation.clientId));
}

function scopedAlerts(db, user, resellerId = "") {
  const allowedInstallationIds = new Set(scopedInstallations(db, user, resellerId).map((installation) => installation.installationId));
  return db.alerts.filter((alert) => allowedInstallationIds.has(alert.installationId));
}

function requireText(value, field) {
  if (!value || typeof value !== "string" || value.trim() === "") {
    throw httpError(400, `Campo obrigatorio ausente: ${field}.`);
  }

  return value.trim();
}

function findOrCreateReseller(db, resellerPayload) {
  const name = resellerPayload?.name?.trim() || "TronSoftOS Direto";
  const document = resellerPayload?.document?.trim() || "";
  const accessEmail = resellerPayload?.accessEmail?.trim().toLowerCase() || resellerPayload?.email?.trim().toLowerCase() || "";
  const existing = db.resellers.find((reseller) => {
    return document ? reseller.document === document : reseller.name.toLowerCase() === name.toLowerCase();
  });

  if (existing) {
    existing.name = name;
    existing.document = document;
    existing.accessEmail = accessEmail || existing.accessEmail || "";
    existing.updatedAt = nowIso();
    return existing;
  }

  const reseller = {
    id: randomUUID(),
    name,
    document,
    accessEmail,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.resellers.push(reseller);
  return reseller;
}

function ensureResellerAccessUser(db, reseller, payload) {
  const email = payload?.accessEmail?.trim().toLowerCase() || payload?.email?.trim().toLowerCase() || reseller.accessEmail;
  if (!email) {
    throw httpError(400, "Campo obrigatorio ausente: accessEmail.");
  }
  const providedPassword = payload?.password?.trim();
  const password = providedPassword || generateTemporaryPassword();
  const existing = db.users.find((user) => user.email.toLowerCase() === email);

  if (existing && existing.role !== resellerRole) {
    throw httpError(409, "Email ja utilizado por um usuario administrativo.");
  }
  if (existing && existing.resellerId && existing.resellerId !== reseller.id) {
    throw httpError(409, "Email ja vinculado a outra revenda.");
  }

  if (existing) {
    existing.name = payload?.accessName?.trim() || existing.name || reseller.name;
    existing.role = resellerRole;
    existing.resellerId = reseller.id;
    existing.status = "active";
    if (payload?.password?.trim()) {
      existing.passwordHash = hashPassword(password);
    }
    existing.updatedAt = nowIso();
    reseller.accessEmail = email;
    return { user: existing, temporaryPassword: null };
  }

  const user = {
    id: randomUUID(),
    name: payload?.accessName?.trim() || reseller.name,
    email,
    passwordHash: hashPassword(password),
    role: resellerRole,
    resellerId: reseller.id,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.users.push(user);
  reseller.accessEmail = email;
  return { user, temporaryPassword: providedPassword ? null : password };
}

function userPasswordEmail(user, password) {
  const subject = encodeURIComponent("Acesso Central TronSoftOS");
  const body = encodeURIComponent([
    `Ola ${user.name || user.email},`,
    "",
    "Seu acesso a Central TronSoftOS foi criado/atualizado.",
    `Usuario: ${user.email}`,
    `Senha temporaria: ${password}`,
    "",
    "Recomendamos alterar a senha no primeiro acesso."
  ].join("\n"));
  return {
    to: user.email,
    mailto: `mailto:${encodeURIComponent(user.email)}?subject=${subject}&body=${body}`
  };
}

function findOrCreateClient(db, reseller, customerPayload) {
  const customerName = requireText(customerPayload?.name, "customer.name");
  const key = clientKey(customerPayload);
  const existing = db.clients.find((client) => {
    return client.resellerId === reseller.id && (client.document === customerPayload?.document || client.key === key);
  });

  if (existing) {
    existing.name = customerName;
    existing.document = customerPayload?.document || "";
    existing.city = customerPayload?.city || "";
    existing.state = customerPayload?.state || "";
    existing.status = "active";
    existing.updatedAt = nowIso();
    return existing;
  }

  const client = {
    id: randomUUID(),
    resellerId: reseller.id,
    key,
    name: customerName,
    document: customerPayload?.document || "",
    city: customerPayload?.city || "",
    state: customerPayload?.state || "",
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.clients.push(client);
  return client;
}

function upsertInstallation(db, client, payload) {
  const installationId = payload.installationId?.trim() || randomUUID();
  const existing = db.installations.find((installation) => installation.installationId === installationId);
  const token = existing?.token || randomUUID();

  const installation = {
    id: existing?.id || randomUUID(),
    clientId: client.id,
    installationId,
    token,
    name: payload.environment?.name || payload.host?.hostname || "Ambiente principal",
    status: normalizeStatus(payload.status || "online"),
    tronsoftos: {
      version: payload.tronsoftos?.version || "",
      build: payload.tronsoftos?.build || "",
      channel: payload.tronsoftos?.channel || ""
    },
    database: {
      engine: payload.database?.engine || "",
      version: payload.database?.version || "",
      schemaVersion: payload.database?.schemaVersion || "",
      versaoBanco: payload.database?.versaoBanco || payload.database?.versao_banco || payload.database?.schemaVersion || "",
      sizeMb: payload.database?.sizeMb ?? null,
      fileSizeBytes: payload.database?.fileSizeBytes ?? null,
      databaseName: payload.database?.databaseName || "",
      databaseAlias: payload.database?.databaseAlias || payload.database?.alias || "",
      indexHealth: payload.database?.indexHealth ?? null,
      history: existing?.database?.history || []
    },
    host: {
      hostname: payload.host?.hostname || "",
      os: payload.host?.os || "",
      ip: payload.host?.ip || ""
    },
    cluster: payload.cluster || {},
    backups: payload.backups || {},
    metrics: incomingMetrics(payload),
    lastSeenAt: nowIso(),
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  if (existing) {
    Object.assign(existing, installation);
    appendDatabaseHistory(existing);
    return existing;
  }

  db.installations.push(installation);
  appendDatabaseHistory(installation);
  return installation;
}

function upsertInstallationForClient(db, client, payload) {
  const installationId = payload.installationId?.trim() || randomUUID();
  const existing = db.installations.find((installation) => installation.installationId === installationId);
  const token = existing?.token || randomUUID();

  const installation = {
    id: existing?.id || randomUUID(),
    clientId: client.id,
    installationId,
    token,
    name: payload.environment?.name || payload.host?.hostname || "Ambiente principal",
    status: normalizeStatus(payload.status || "online"),
    tronsoftos: {
      version: payload.tronsoftos?.version || "",
      build: payload.tronsoftos?.build || "",
      channel: payload.tronsoftos?.channel || ""
    },
    database: {
      engine: payload.database?.engine || "",
      version: payload.database?.version || "",
      schemaVersion: payload.database?.schemaVersion || "",
      versaoBanco: payload.database?.versaoBanco || payload.database?.versao_banco || payload.database?.schemaVersion || "",
      sizeMb: payload.database?.sizeMb ?? null,
      fileSizeBytes: payload.database?.fileSizeBytes ?? null,
      databaseName: payload.database?.databaseName || "",
      databaseAlias: payload.database?.databaseAlias || payload.database?.alias || "",
      indexHealth: payload.database?.indexHealth ?? null,
      history: existing?.database?.history || []
    },
    host: {
      hostname: payload.host?.hostname || "",
      os: payload.host?.os || "",
      ip: payload.host?.ip || ""
    },
    cluster: payload.cluster || {},
    backups: payload.backups || {},
    metrics: incomingMetrics(payload),
    lastSeenAt: nowIso(),
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  if (existing) {
    Object.assign(existing, installation);
    appendDatabaseHistory(existing);
    return existing;
  }

  db.installations.push(installation);
  appendDatabaseHistory(installation);
  return installation;
}

function databaseSizeMb(database = {}) {
  const sizeMb = Number(database.sizeMb);
  if (Number.isFinite(sizeMb) && sizeMb > 0) return Number(sizeMb.toFixed(2));
  const bytes = Number(database.fileSizeBytes);
  if (Number.isFinite(bytes) && bytes > 0) return Number((bytes / 1024 / 1024).toFixed(2));
  return null;
}

function appendDatabaseHistory(installation) {
  const sizeMb = databaseSizeMb(installation.database);
  if (!Number.isFinite(sizeMb)) return;

  const sampledAt = nowIso();
  const day = sampledAt.slice(0, 10);
  const history = Array.isArray(installation.database.history)
    ? installation.database.history.filter((item) => item && item.date && Number.isFinite(Number(item.sizeMb)))
    : [];
  const existing = history.find((item) => item.date === day);
  if (existing) {
    existing.sizeMb = sizeMb;
    existing.sampledAt = sampledAt;
  } else {
    history.push({ date: day, sizeMb, sampledAt });
  }
  history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  installation.database.history = history.slice(-370);
}

function incomingMetrics(payload = {}) {
  const metrics = payload.metrics && typeof payload.metrics === "object" ? payload.metrics : {};
  const systemMetrics = payload.systemMetrics && typeof payload.systemMetrics === "object" ? payload.systemMetrics : {};
  return {
    ...metrics,
    ...(Object.keys(systemMetrics).length ? { systemMetrics } : {})
  };
}

function isIndexAlert(alert) {
  const text = `${alert.code || ""} ${alert.title || ""} ${alert.message || ""} ${alert.details?.kind || ""}`.toLowerCase();
  return text.includes("indice") || text.includes("index");
}

function indexHealthIsHealthy(database = {}) {
  const health = database.indexHealth;
  if (!health) return false;
  const severity = String(health.severity || health.status || "").toUpperCase();
  if (severity === "OK" || severity === "INFO") return true;
  const inactive = Number(health.inactiveIndexes ?? health.inactive ?? health.disabledIndexes ?? 0);
  const missing = Number(health.missingIndexes ?? health.withoutIndexes ?? health.semIndice ?? 0);
  const active = Number(health.activeIndexes ?? health.active ?? 0);
  const total = Number(health.totalIndexes ?? health.total ?? 0);
  return total > 0 && active > 0 && inactive === 0 && missing === 0;
}

function resolveIndexAlertsIfHealthy(db, installation) {
  if (!indexHealthIsHealthy(installation.database)) return;
  db.alerts.forEach((alert) => {
    if (alert.installationId !== installation.installationId || alert.status !== "open") return;
    if (!isIndexAlert(alert)) return;
    alert.status = "resolved";
    alert.resolvedAt = nowIso();
  });
}

function findInstallationByRequest(db, payload, request) {
  const token = request.headers["x-installation-token"];
  const installationId = payload.installationId;

  const installation = db.installations.find((item) => {
    return (token && item.token === token) || (installationId && item.installationId === installationId);
  });

  if (!installation) {
    throw httpError(404, "Instalacao TronSoftOS nao encontrada. Envie primeiro /api/tronsoftos/identify.");
  }

  return installation;
}

function addEvent(db, type, installation, payload) {
  const event = {
    id: randomUUID(),
    installationId: installation.installationId,
    type,
    payload,
    receivedAt: nowIso()
  };
  db.events.push(event);
  return event;
}

function publicPairingToken(token) {
  return {
    id: token.id,
    clientId: token.clientId,
    token: token.token,
    status: token.status,
    installationId: token.installationId || null,
    createdAt: token.createdAt,
    usedAt: token.usedAt || null,
    revokedAt: token.revokedAt || null
  };
}

function publicInstallation(db, installation) {
  const client = db.clients.find((item) => item.id === installation.clientId);
  const reseller = db.resellers.find((item) => item.id === client?.resellerId);
  const status = effectiveInstallationStatus(installation);

  return {
    id: installation.id,
    installationId: installation.installationId,
    name: installation.name,
    status,
    lastSeenAt: installation.lastSeenAt,
    tronsoftos: installation.tronsoftos,
    database: installation.database,
    host: installation.host,
    cluster: installation.cluster || {},
    backups: installation.backups || {},
    metrics: installation.metrics || {},
    client,
    reseller
  };
}

function centralPublicUrl(request) {
  return (process.env.CENTRAL_PUBLIC_URL || `${String(request.headers["x-forwarded-proto"] || "http")}://${request.headers.host}`).replace(/\/+$/, "");
}

function googleOAuthConfig(request) {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || `${centralPublicUrl(request)}/api/oauth/google/callback`
  };
}

function requireGoogleOAuthConfig(request) {
  const config = googleOAuthConfig(request);
  if (!config.clientId || !config.clientSecret) {
    throw httpError(503, "0auth Google Drive nao configurado na Central.");
  }
  return config;
}

function findInstallationByToken(db, request) {
  const token = request.headers["x-installation-token"];
  if (!token) {
    throw httpError(401, "Token da instalacao ausente.");
  }
  const installation = db.installations.find((item) => item.token === token);
  if (!installation) {
    throw httpError(404, "Instalacao TronSoftOS nao encontrada.");
  }
  return installation;
}

function latestOAuthCredential(db, installation, provider = "google") {
  return [...db.oauthCredentials]
    .reverse()
    .find((credential) => credential.installationId === installation.installationId && credential.provider === provider && credential.status === "connected") || null;
}

function googleDriveRcloneConfig({ remote = "gdrive", clientId, clientSecret, token }) {
  return [
    `[${remote}]`,
    "type = drive",
    "scope = drive",
    `client_id = ${clientId}`,
    `client_secret = ${clientSecret}`,
    `token = ${JSON.stringify(token)}`
  ].join("\n") + "\n";
}

function publicOAuthStatus(db, installation, request) {
  const credential = latestOAuthCredential(db, installation);
  const config = googleOAuthConfig(request);
  return {
    installationId: installation.installationId,
    provider: "google",
    purpose: "database_backup_drive",
    configured: Boolean(config.clientId && config.clientSecret),
    connected: Boolean(credential),
    accountEmail: credential?.accountEmail || "",
    account: credential ? {
      provider: "google",
      accountEmail: credential.accountEmail || "",
      remote: credential.remote || "gdrive",
      path: credential.path || "tronsoftos/backups"
    } : null,
    scopes: credential?.scopes || [],
    connectedAt: credential?.connectedAt || null,
    updatedAt: credential?.updatedAt || null
  };
}

async function exchangeGoogleCode(config, code) {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(502, payload.error_description || payload.error || "Falha ao trocar codigo Google.");
  }
  return payload;
}

async function refreshGoogleToken(credential, request) {
  const config = requireGoogleOAuthConfig(request);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: credential.refreshToken,
    grant_type: "refresh_token"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(502, payload.error_description || payload.error || "Falha ao renovar token Google.");
  }
  return payload;
}

async function fetchGoogleUserInfo(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return {};
  return response.json().catch(() => ({}));
}

function dashboard(db) {
  const criticalAlerts = db.alerts.filter((alert) => alert.status === "open" && alert.severity === "critical").length;
  const online = db.installations.filter((installation) => effectiveInstallationStatus(installation) === "online").length;
  const warning = db.installations.filter((installation) => effectiveInstallationStatus(installation) === "warning").length;
  const offline = db.installations.filter((installation) => effectiveInstallationStatus(installation) === "offline").length;

  return {
    resellers: db.resellers.length,
    clients: db.clients.length,
    installations: db.installations.length,
    online,
    warning,
    offline,
    criticalAlerts,
    updatedAt: nowIso()
  };
}

async function handleLogin(request, response) {
  const payload = await readJson(request);
  const email = requireText(payload.email, "email").toLowerCase();
  const password = requireText(payload.password, "password");
  const db = await readDbWithBootstrap();
  const user = db.users.find((item) => item.email.toLowerCase() === email && item.status === "active");
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw httpError(401, "Usuario ou senha invalidos.");
  }
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000).toISOString();
  db.sessions.push({ token, userId: user.id, expiresAt, createdAt: nowIso() });
  await writeDb(db);
  response.setHeader("set-cookie", sessionCookieHeader(request, token));
  sendJson(response, 200, { user: publicUser(user) });
}

async function handleLogout(request, response) {
  const db = await readDbWithBootstrap();
  const token = parseCookies(request)[sessionCookie];
  db.sessions = db.sessions.filter((session) => session.token !== token);
  await writeDb(db);
  response.setHeader("set-cookie", sessionCookieHeader(request, "", 0));
  sendJson(response, 200, { ok: true });
}

async function handleMe(request, response) {
  const db = await readDbWithBootstrap();
  const user = sessionUser(db, request);
  if (!user) {
    sendJson(response, 401, { error: "UNAUTHORIZED" });
    return;
  }
  sendJson(response, 200, { user: publicUser(user) });
}

async function handleIdentify(request, response) {
  const payload = await readJson(request);
  const db = await readDb();
  const reseller = findOrCreateReseller(db, payload.reseller);
  const client = findOrCreateClient(db, reseller, payload.customer);
  const installation = upsertInstallation(db, client, payload);
  addEvent(db, "identify", installation, payload);
  await writeDb(db);

  sendJson(response, 201, {
    installationId: installation.installationId,
    installationToken: installation.token,
    clientId: client.id,
    resellerId: reseller.id,
    status: installation.status
  });
}

async function handleCreateClient(request, response) {
  const payload = await readJson(request);
  const db = await readDbWithBootstrap();
  const user = requireUser(db, request);
  const reseller = user.role === resellerRole
    ? db.resellers.find((item) => item.id === user.resellerId)
    : findOrCreateReseller(db, payload.reseller?.directTronsoft ? directTronsoftResellerPayload() : payload.reseller);
  if (!reseller) {
    throw httpError(400, "Revenda do usuario nao encontrada.");
  }
  const client = findOrCreateClient(db, reseller, payload.customer);
  const token = {
    id: randomUUID(),
    clientId: client.id,
    token: generatePairingToken(),
    status: "active",
    createdAt: nowIso(),
    usedAt: null,
    revokedAt: null,
    installationId: null
  };

  db.pairingTokens.push(token);
  await writeDb(db);

  sendJson(response, 201, {
    reseller,
    client,
    pairingToken: publicPairingToken(token)
  });
}

async function handleCreateReseller(request, response) {
  const payload = await readJson(request);
  const db = await readDbWithBootstrap();
  const user = requireUser(db, request);
  requireTronsoft(user);
  const resellerPayload = payload.reseller || payload;
  const reseller = findOrCreateReseller(db, resellerPayload);
  if (!reseller.document) {
    throw httpError(400, "Campo obrigatorio ausente: document.");
  }
  await writeDb(db);
  sendJson(response, 201, {
    reseller: publicReseller(reseller, db)
  });
}

async function handleOAuthStatus(request, response) {
  const db = await readDb();
  const installation = findInstallationByToken(db, request);
  sendJson(response, 200, publicOAuthStatus(db, installation, request));
}

async function handleOAuthStart(request, response) {
  const config = requireGoogleOAuthConfig(request);
  const payload = await readJson(request);
  const db = await readDb();
  const installation = findInstallationByToken(db, request);
  const state = randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const authState = {
    id: randomUUID(),
    state,
    provider: "google",
    installationId: installation.installationId,
    clientId: installation.clientId,
    status: "pending",
    requestedBy: payload.requestedBy || "tronsoftos",
    remote: String(payload.remote || "gdrive").trim() || "gdrive",
    path: String(payload.path || "tronsoftos/backups").trim() || "tronsoftos/backups",
    createdAt: nowIso(),
    expiresAt
  };
  db.oauthStates.push(authState);
  db.oauthEvents.push({ id: randomUUID(), type: "google_start", installationId: installation.installationId, createdAt: nowIso() });
  await writeDb(db);

  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", googleDriveScope);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("state", state);

  sendJson(response, 201, {
    provider: "google",
    purpose: "database_backup_drive",
    authUrl: authorizationUrl.toString(),
    authorizationUrl: authorizationUrl.toString(),
    state,
    expiresAt
  });
}

async function handleOAuthCallback(request, response, url) {
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const db = await readDb();
  const oauthState = db.oauthStates.find((item) => item.state === state && item.provider === "google");

  if (error) {
    throw httpError(400, `Google recusou autorizacao: ${error}`);
  }
  if (!oauthState || oauthState.status !== "pending" || new Date(oauthState.expiresAt).getTime() < Date.now()) {
    throw httpError(400, "Solicitacao 0auth invalida ou expirada.");
  }
  if (!code) {
    throw httpError(400, "Codigo Google ausente.");
  }

  const tokenPayload = await exchangeGoogleCode(requireGoogleOAuthConfig(request), code);
  const userInfo = await fetchGoogleUserInfo(tokenPayload.access_token);
  const installation = db.installations.find((item) => item.installationId === oauthState.installationId);
  if (!installation) {
    throw httpError(404, "Instalacao TronSoftOS nao encontrada.");
  }
  const existing = latestOAuthCredential(db, installation);
  const credential = existing || {
    id: randomUUID(),
    provider: "google",
    purpose: "database_backup_drive",
    installationId: installation.installationId,
    clientId: installation.clientId,
    createdAt: nowIso()
  };

  credential.status = "connected";
  credential.accountEmail = userInfo.email || "";
  credential.scopes = String(tokenPayload.scope || googleDriveScope).split(/\s+/).filter(Boolean);
  credential.accessToken = tokenPayload.access_token;
  credential.refreshToken = tokenPayload.refresh_token || credential.refreshToken;
  credential.tokenType = tokenPayload.token_type || "Bearer";
  credential.remote = oauthState.remote || credential.remote || "gdrive";
  credential.path = oauthState.path || credential.path || "tronsoftos/backups";
  credential.expiresAt = new Date(Date.now() + Number(tokenPayload.expires_in || 3600) * 1000).toISOString();
  credential.connectedAt = credential.connectedAt || nowIso();
  credential.updatedAt = nowIso();

  if (!existing) db.oauthCredentials.push(credential);
  oauthState.status = "completed";
  oauthState.completedAt = nowIso();
  db.oauthEvents.push({ id: randomUUID(), type: "google_connected", installationId: installation.installationId, accountEmail: credential.accountEmail, createdAt: nowIso() });
  await writeDb(db);

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>0auth concluido</title><body style="font-family:Arial;padding:32px"><h1>Google Drive conectado</h1><p>Conta autorizada para backups do TronSoftOS.</p><p>Voce ja pode fechar esta janela.</p></body></html>`);
}

async function handleOAuthAccessToken(request, response) {
  const db = await readDb();
  const installation = findInstallationByToken(db, request);
  const credential = latestOAuthCredential(db, installation);
  if (!credential) {
    throw httpError(404, "Google Drive ainda nao conectado para esta instalacao.");
  }

  if (new Date(credential.expiresAt).getTime() < Date.now() + 60 * 1000) {
    const refreshed = await refreshGoogleToken(credential, request);
    credential.accessToken = refreshed.access_token;
    credential.expiresAt = new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString();
    credential.scopes = String(refreshed.scope || credential.scopes.join(" ")).split(/\s+/).filter(Boolean);
    credential.updatedAt = nowIso();
    await writeDb(db);
  }

  const token = {
    access_token: credential.accessToken,
    refresh_token: credential.refreshToken,
    token_type: credential.tokenType || "Bearer",
    expiry: credential.expiresAt
  };

  sendJson(response, 200, {
    connected: true,
    provider: "google",
    tokenType: credential.tokenType || "Bearer",
    accessToken: credential.accessToken,
    expiresAt: credential.expiresAt,
    scopes: credential.scopes || [],
    account: {
      provider: "google",
      accountEmail: credential.accountEmail || "",
      remote: credential.remote || "gdrive",
      path: credential.path || "tronsoftos/backups"
    },
    token,
    rclone: {
      remote: credential.remote || "gdrive",
      path: credential.path || "tronsoftos/backups",
      configContent: googleDriveRcloneConfig({
        remote: credential.remote || "gdrive",
        clientId: googleOAuthConfig(request).clientId,
        clientSecret: googleOAuthConfig(request).clientSecret,
        token
      })
    }
  });
}

async function handleCreateUser(request, response) {
  const payload = await readJson(request);
  const db = await readDbWithBootstrap();
  const currentUser = requireUser(db, request);
  requireTronsoft(currentUser);
  const role = payload.role === resellerRole ? resellerRole : tronsoftRole;
  const resellerId = role === resellerRole ? requireText(payload.resellerId, "resellerId") : null;
  if (resellerId && !db.resellers.some((reseller) => reseller.id === resellerId)) {
    throw httpError(400, "Revenda nao encontrada.");
  }
  const email = requireText(payload.email, "email").toLowerCase();
  if (db.users.some((user) => user.email.toLowerCase() === email)) {
    throw httpError(409, "Usuario ja cadastrado.");
  }
  const providedPassword = payload.password?.trim();
  const password = providedPassword || generateTemporaryPassword();
  const user = {
    id: randomUUID(),
    name: requireText(payload.name, "name"),
    email,
    passwordHash: hashPassword(password),
    role,
    resellerId,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.users.push(user);
  if (resellerId) {
    const reseller = db.resellers.find((item) => item.id === resellerId);
    if (reseller && role === resellerRole && !reseller.accessEmail) {
      reseller.accessEmail = email;
      reseller.updatedAt = nowIso();
    }
  }
  await writeDb(db);
  sendJson(response, 201, {
    user: publicUser(user),
    temporaryPassword: providedPassword ? null : password,
    email: payload.sendEmail ? userPasswordEmail(user, password) : null
  });
}

async function handleChangeOwnPassword(request, response) {
  const payload = await readJson(request);
  const db = await readDbWithBootstrap();
  const user = requireUser(db, request);
  const currentPassword = requireText(payload.currentPassword, "currentPassword");
  const newPassword = requireText(payload.newPassword, "newPassword");
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw httpError(401, "Senha atual invalida.");
  }
  if (newPassword.length < 6) {
    throw httpError(400, "A nova senha deve ter pelo menos 6 caracteres.");
  }
  user.passwordHash = hashPassword(newPassword);
  user.updatedAt = nowIso();
  db.sessions = db.sessions.filter((session) => session.userId !== user.id || session.token === parseCookies(request)[sessionCookie]);
  await writeDb(db);
  sendJson(response, 200, { ok: true, user: publicUser(user) });
}

async function handleSetUserPassword(request, response, userId) {
  const payload = await readJson(request);
  const db = await readDbWithBootstrap();
  const currentUser = requireUser(db, request);
  requireTronsoft(currentUser);
  const user = db.users.find((item) => item.id === userId);
  if (!user) throw httpError(404, "Usuario nao encontrado.");
  const providedPassword = payload.password?.trim();
  const password = providedPassword || generateTemporaryPassword();
  if (password.length < 6) {
    throw httpError(400, "A nova senha deve ter pelo menos 6 caracteres.");
  }
  user.passwordHash = hashPassword(password);
  user.status = "active";
  user.updatedAt = nowIso();
  db.sessions = db.sessions.filter((session) => session.userId !== user.id);
  await writeDb(db);
  sendJson(response, 200, {
    ok: true,
    user: publicUser(user),
    temporaryPassword: providedPassword ? null : password,
    email: payload.sendEmail ? userPasswordEmail(user, password) : null
  });
}

async function handlePairTronsoftos(request, response) {
  const payload = await readJson(request);
  const pairingToken = requireText(payload.pairingToken, "pairingToken");
  const db = await readDb();
  const token = db.pairingTokens.find((item) => item.token === pairingToken);

  if (!token || token.status !== "active") {
    throw httpError(401, "Token da Central invalido ou inativo.");
  }

  const client = db.clients.find((item) => item.id === token.clientId);
  if (!client) {
    throw httpError(404, "Cliente vinculado ao token nao encontrado.");
  }

  const installation = upsertInstallationForClient(db, client, payload);
  token.usedAt = token.usedAt || nowIso();
  token.installationId = installation.installationId;
  addEvent(db, "pair", installation, { ...payload, pairingToken: "***" });
  await writeDb(db);

  sendJson(response, 200, {
    ok: true,
    installationId: installation.installationId,
    installationToken: installation.token,
    clientId: client.id,
    status: installation.status,
    message: "TronSoftOS vinculado com sucesso."
  });
}

async function handleHeartbeat(request, response) {
  const payload = await readJson(request);
  const db = await readDb();
  const installation = findInstallationByRequest(db, payload, request);

  installation.status = normalizeStatus(payload.status || "online");
  installation.tronsoftos = { ...installation.tronsoftos, ...payload.tronsoftos };
  installation.database = { ...installation.database, ...payload.database };
  installation.database.versaoBanco = payload.database?.versaoBanco
    || payload.database?.versao_banco
    || payload.database?.schemaVersion
    || installation.database.versaoBanco
    || "";
  appendDatabaseHistory(installation);
  resolveIndexAlertsIfHealthy(db, installation);
  installation.host = { ...installation.host, ...payload.host };
  installation.cluster = { ...(installation.cluster || {}), ...(payload.cluster || {}) };
  installation.backups = { ...(installation.backups || {}), ...(payload.backups || {}) };
  installation.metrics = { ...(installation.metrics || {}), ...incomingMetrics(payload) };
  installation.lastSeenAt = nowIso();
  installation.updatedAt = nowIso();

  if (Array.isArray(payload.alerts)) {
    const activeCodes = new Set(payload.alerts.map((alert) => alert.code).filter(Boolean));
    db.alerts.forEach((alert) => {
      if (alert.installationId !== installation.installationId || alert.status !== "open") return;
      if (alert.code && activeCodes.has(alert.code)) return;
      alert.status = "resolved";
      alert.resolvedAt = nowIso();
    });
  }

  addEvent(db, "heartbeat", installation, payload);
  await writeDb(db);

  sendJson(response, 200, {
    ok: true,
    installationId: installation.installationId,
    status: installation.status,
    lastSeenAt: installation.lastSeenAt
  });
}

async function handleAlert(request, response) {
  const payload = await readJson(request);
  const db = await readDb();
  const installation = findInstallationByRequest(db, payload, request);
  const title = requireText(payload.title, "title");
  const severity = normalizeSeverity(payload.severity || "info");

  const alert = {
    id: randomUUID(),
    installationId: installation.installationId,
    clientId: installation.clientId,
    title,
    message: payload.message || "",
    code: payload.code || "",
    severity,
    status: "open",
    details: payload.details || {},
    openedAt: nowIso(),
    resolvedAt: null
  };

  db.alerts.push(alert);
  addEvent(db, "alert", installation, payload);

  if (severity === "critical") {
    installation.status = "warning";
    installation.updatedAt = nowIso();
  }

  await writeDb(db);
  sendJson(response, 201, alert);
}

async function handleApi(request, response, pathname) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "central-tronsoftos", storage: storageInfo(), checkedAt: nowIso() });
    return;
  }

  if (request.method === "GET" && pathname === "/api/oauth/google/callback") {
    await handleOAuthCallback(request, response, url);
    return;
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    await handleLogin(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    await handleLogout(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/auth/me") {
    await handleMe(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/account/password") {
    await handleChangeOwnPassword(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tronsoftos/identify") {
    await handleIdentify(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tronsoftos/pair") {
    await handlePairTronsoftos(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/clients") {
    await handleCreateClient(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/resellers") {
    await handleCreateReseller(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/users") {
    await handleCreateUser(request, response);
    return;
  }

  const userPasswordMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (request.method === "POST" && userPasswordMatch) {
    await handleSetUserPassword(request, response, userPasswordMatch[1]);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tronsoftos/heartbeat") {
    await handleHeartbeat(request, response);
    return;
  }

  if (request.method === "POST" && ["/api/tronsoftos/alerts", "/api/tronsoftos/notifications"].includes(pathname)) {
    await handleAlert(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/tronsoftos/oauth/google/status") {
    await handleOAuthStatus(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tronsoftos/oauth/google/start") {
    await handleOAuthStart(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tronsoftos/oauth/google/token") {
    await handleOAuthAccessToken(request, response);
    return;
  }

  const db = await readDbWithBootstrap();
  const user = requireUser(db, request);
  const resellerId = user.role === tronsoftRole ? url.searchParams.get("resellerId") || "" : "";

  if (request.method === "GET" && pathname === "/api/dashboard") {
    const clients = scopedClients(db, user, resellerId);
    const installations = scopedInstallations(db, user, resellerId);
    const alerts = scopedAlerts(db, user, resellerId);
    const resellers = user.role === tronsoftRole
      ? (resellerId ? db.resellers.filter((reseller) => reseller.id === resellerId) : db.resellers)
      : db.resellers.filter((reseller) => reseller.id === user.resellerId);
    sendJson(response, 200, dashboard({ ...db, resellers, clients, installations, alerts }));
    return;
  }

  if (request.method === "GET" && pathname === "/api/resellers") {
    const resellers = user.role === tronsoftRole
      ? db.resellers
      : db.resellers.filter((reseller) => reseller.id === user.resellerId);
    sendJson(response, 200, resellers.map((reseller) => publicReseller(reseller, db)));
    return;
  }

  if (request.method === "GET" && pathname === "/api/users") {
    requireTronsoft(user);
    sendJson(response, 200, db.users.map(publicUser));
    return;
  }

  if (request.method === "GET" && pathname === "/api/oauth/google/summary") {
    const installations = scopedInstallations(db, user, resellerId);
    const installationIds = new Set(installations.map((installation) => installation.installationId));
    const credentials = db.oauthCredentials.filter((credential) => {
      return credential.provider === "google" && installationIds.has(credential.installationId);
    });
    const config = googleOAuthConfig(request);
    sendJson(response, 200, {
      provider: "google",
      purpose: "database_backup_drive",
      configured: Boolean(config.clientId && config.clientSecret),
      redirectUri: config.redirectUri,
      connected: credentials.filter((credential) => credential.status === "connected").length,
      installations: installations.length,
      accounts: credentials
        .filter((credential) => credential.status === "connected")
        .map((credential) => ({
          installationId: credential.installationId,
          accountEmail: credential.accountEmail || "",
          connectedAt: credential.connectedAt,
          updatedAt: credential.updatedAt
        }))
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/maintenance/update") {
    requireTronsoft(user);
    sendJson(response, 202, {
      ok: true,
      job: startMaintenanceUpdateJob()
    });
    return;
  }

  const maintenanceJobMatch = pathname.match(/^\/api\/maintenance\/jobs\/([^/]+)$/);
  if (request.method === "GET" && maintenanceJobMatch) {
    requireTronsoft(user);
    const job = maintenanceJobs.get(maintenanceJobMatch[1]);
    if (!job) throw httpError(404, "Execucao de manutencao nao encontrada.");
    sendJson(response, 200, publicMaintenanceJob(job));
    return;
  }

  if (request.method === "GET" && pathname === "/api/clients") {
    sendJson(response, 200, scopedClients(db, user, resellerId).map((client) => ({
      ...client,
      reseller: db.resellers.find((reseller) => reseller.id === client.resellerId) || null,
      pairingTokens: db.pairingTokens.filter((token) => token.clientId === client.id).map(publicPairingToken)
    })));
    return;
  }

  if (request.method === "GET" && pathname === "/api/installations") {
    sendJson(response, 200, scopedInstallations(db, user, resellerId).map((installation) => publicInstallation(db, installation)));
    return;
  }

  if (request.method === "GET" && pathname === "/api/alerts") {
    sendJson(response, 200, scopedAlerts(db, user, resellerId));
    return;
  }

  throw httpError(404, "Rota nao encontrada.");
}

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = normalize(join(prototypeDir, relativePath));

  if (!filePath.startsWith(prototypeDir)) {
    throw httpError(403, "Acesso negado.");
  }

  try {
    await stat(filePath);
  } catch {
    throw httpError(404, "Arquivo nao encontrado.");
  }

  const extension = extname(filePath);
  const noStore = extension === ".html" || relativePath === "index.html";
  response.writeHead(200, {
    "content-type": contentTypes[extension] || "application/octet-stream",
    "cache-control": noStore ? "no-store, max-age=0" : "no-cache, max-age=0, must-revalidate",
    "cdn-cache-control": "no-store",
    "cloudflare-cdn-cache-control": "no-store",
    "pragma": "no-cache",
    "expires": "0"
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  try {
    if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }

    await serveStatic(request, response, decodeURIComponent(url.pathname));
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.message || "Erro interno."
    });
  }
});

server.listen(port, () => {
  console.log(`Central TronSoftOS rodando em http://localhost:${port}`);
});
