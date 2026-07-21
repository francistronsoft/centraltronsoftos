import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = join(rootDir, "data");
const dataFile = join(dataDir, "central-db.json");

const emptyDb = {
  resellers: [],
  clients: [],
  users: [],
  sessions: [],
  pairingTokens: [],
  installations: [],
  alerts: [],
  events: [],
  oauthStates: [],
  oauthCredentials: [],
  oauthEvents: []
};

const maxEvents = Number(process.env.CENTRAL_MAX_EVENTS || 300);
const maxAlerts = Number(process.env.CENTRAL_MAX_ALERTS || 500);
const maxMetricSeries = Number(process.env.CENTRAL_MAX_METRIC_SERIES || 96);
const maxBackupFiles = Number(process.env.CENTRAL_MAX_BACKUP_FILES || 20);

let pgPool = null;
let pgReady = false;

function usePostgres() {
  return Boolean(process.env.DATABASE_URL);
}

function withDefaults(db) {
  return { ...emptyDb, ...(db || {}) };
}

function compactMetricSeries(metrics = {}) {
  if (!metrics || typeof metrics !== "object") return {};
  const next = { ...metrics };
  const systemMetrics = next.systemMetrics && typeof next.systemMetrics === "object" ? { ...next.systemMetrics } : null;
  if (systemMetrics) {
    if (Array.isArray(systemMetrics.series)) {
      systemMetrics.series = systemMetrics.series.slice(-maxMetricSeries);
    }
    next.systemMetrics = systemMetrics;
  }
  if (Array.isArray(next.series)) {
    next.series = next.series.slice(-maxMetricSeries);
  }
  return next;
}

function compactBackups(backups = {}) {
  if (!backups || typeof backups !== "object") return {};
  const next = { ...backups };
  if (Array.isArray(next.recentFiles)) {
    next.recentFiles = next.recentFiles.slice(0, maxBackupFiles);
  }
  return next;
}

function compactDatabase(database = {}) {
  if (!database || typeof database !== "object") return {};
  const next = { ...database };
  if (next.indexHealth && typeof next.indexHealth === "object") {
    const health = next.indexHealth;
    next.indexHealth = {
      severity: health.severity,
      status: health.status,
      checkedAt: health.checkedAt,
      databaseName: health.databaseName,
      databaseAlias: health.databaseAlias,
      totalIndexes: health.totalIndexes,
      activeIndexes: health.activeIndexes,
      inactiveIndexes: health.inactiveIndexes,
      userIndexes: health.userIndexes,
      activeUserIndexes: health.activeUserIndexes,
      inactiveUserIndexes: health.inactiveUserIndexes,
      activeRatio: health.activeRatio,
      userActiveRatio: health.userActiveRatio,
      currentSizeBytes: health.currentSizeBytes,
      previousMaxSizeBytes: health.previousMaxSizeBytes,
      previousMaxCollectedAt: health.previousMaxCollectedAt,
      sizeDropPercent: health.sizeDropPercent,
      error: health.error,
      missingActiveTables: Array.isArray(health.missingActiveTables) ? health.missingActiveTables.slice(0, 50) : []
    };
  }
  return next;
}

function compactEvent(event = {}) {
  const payload = event.payload || {};
  return {
    id: event.id,
    installationId: event.installationId,
    type: event.type,
    receivedAt: event.receivedAt,
    payload: {
      status: payload.status,
      installationId: payload.installationId,
      tronsoftos: payload.tronsoftos,
      database: payload.database ? compactDatabase(payload.database) : undefined,
      host: payload.host,
      backups: payload.backups ? compactBackups(payload.backups) : undefined
    }
  };
}

function compactDb(db) {
  const next = withDefaults(db);
  next.installations = next.installations.map((installation) => ({
    ...installation,
    database: compactDatabase(installation.database),
    backups: compactBackups(installation.backups),
    metrics: compactMetricSeries(installation.metrics)
  }));
  next.events = next.events.slice(-maxEvents).map(compactEvent);
  next.alerts = next.alerts.slice(-maxAlerts);
  next.oauthEvents = next.oauthEvents.slice(-maxEvents);
  return next;
}

async function postgresPool() {
  if (pgPool) return pgPool;
  const { Pool } = await import("pg");
  pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pgPool;
}

async function ensurePostgresDb() {
  if (pgReady) return;
  const pool = await postgresPool();
  await pool.query(`
    create table if not exists central_state (
      id integer primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(
    `insert into central_state (id, data)
     values (1, $1::jsonb)
     on conflict (id) do nothing`,
    [JSON.stringify(emptyDb)]
  );
  pgReady = true;
}

async function readPostgresDb() {
  await ensurePostgresDb();
  const pool = await postgresPool();
  const result = await pool.query("select data from central_state where id = 1");
  return compactDb(result.rows[0]?.data);
}

async function writePostgresDb(db) {
  await ensurePostgresDb();
  const pool = await postgresPool();
  await pool.query(
    `insert into central_state (id, data, updated_at)
     values (1, $1::jsonb, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [JSON.stringify(compactDb(db))]
  );
}

async function ensureFileDb() {
  await mkdir(dataDir, { recursive: true });

  try {
    await stat(dataFile);
  } catch {
    await writeFileDb(emptyDb);
  }
}

async function readFileDb() {
  await ensureFileDb();
  const raw = await readFile(dataFile, "utf8");
  return compactDb(JSON.parse(raw));
}

async function writeFileDb(db) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, `${JSON.stringify(compactDb(db), null, 2)}\n`, "utf8");
}

export async function readDb() {
  return usePostgres() ? readPostgresDb() : readFileDb();
}

export async function writeDb(db) {
  return usePostgres() ? writePostgresDb(db) : writeFileDb(db);
}

export function storageInfo() {
  return {
    driver: usePostgres() ? "postgres" : "json",
    databaseUrlConfigured: usePostgres()
  };
}
