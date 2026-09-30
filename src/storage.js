import { readFile, writeFile, mkdir, stat, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = resolve(process.env.CENTRAL_DATA_DIR || join(rootDir, "data"));
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
  auditLogs: [],
  loginAttempts: [],
  oauthStates: [],
  oauthCredentials: [],
  oauthEvents: []
};

const maxEvents = Number(process.env.CENTRAL_MAX_EVENTS || 300);
const maxAuditLogs = Number(process.env.CENTRAL_MAX_AUDIT_LOGS || 1000);
const maxAlerts = Number(process.env.CENTRAL_MAX_ALERTS || 500);
const maxMetricSeries = Number(process.env.CENTRAL_MAX_METRIC_SERIES || 96);
const maxBackupFiles = Number(process.env.CENTRAL_MAX_BACKUP_FILES || 20);

let pgPool = null;
let pgReady = false;
let fileMutationTail = Promise.resolve();
const mutationStorage = new AsyncLocalStorage();

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
  const firebirdMetrics = next.firebird && typeof next.firebird === "object" ? { ...next.firebird } : null;
  const networkMetrics = next.network && typeof next.network === "object" ? { ...next.network } : null;
  if (systemMetrics) {
    if (Array.isArray(systemMetrics.series)) {
      systemMetrics.series = systemMetrics.series.slice(-maxMetricSeries);
    }
    next.systemMetrics = systemMetrics;
  }
  if (firebirdMetrics) {
    if (Array.isArray(firebirdMetrics.series)) {
      firebirdMetrics.series = firebirdMetrics.series.slice(-maxMetricSeries);
    }
    next.firebird = firebirdMetrics;
  }
  if (networkMetrics) {
    if (Array.isArray(networkMetrics.series)) {
      networkMetrics.series = networkMetrics.series.slice(-maxMetricSeries);
    }
    next.network = networkMetrics;
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
  if (Array.isArray(next.firebirdSessions)) {
    next.firebirdSessions = next.firebirdSessions.slice(0, 50);
  }
  if (Array.isArray(next.databases)) {
    next.databases = next.databases.map((item) => compactDatabase(item));
  }
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
      transactionHealth: health.transactionHealth,
      transactionGap: health.transactionGap,
      oldestTransaction: health.oldestTransaction,
      oldestActive: health.oldestActive,
      oldestSnapshot: health.oldestSnapshot,
      nextTransaction: health.nextTransaction,
      sweepInterval: health.sweepInterval,
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
  next.auditLogs = (next.auditLogs || []).slice(-maxAuditLogs);
  next.loginAttempts = (next.loginAttempts || []).slice(-500);
  next.alerts = next.alerts.slice(-maxAlerts);
  next.oauthEvents = next.oauthEvents.slice(-maxEvents);
  return next;
}

function persistedDb(db) {
  return JSON.parse(JSON.stringify(compactDb(db)));
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
      version bigint not null default 0,
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query("alter table central_state add column if not exists version bigint not null default 0");
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
  const temporaryFile = `${dataFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(compactDb(db), null, 2)}\n`, "utf8");
  await rename(temporaryFile, dataFile);
}

export async function readDb() {
  const mutation = mutationStorage.getStore();
  if (mutation) {
    if (!mutation.db) await mutation.initialize();
    return mutation.db;
  }
  return usePostgres() ? readPostgresDb() : readFileDb();
}

export async function writeDb(db) {
  const mutation = mutationStorage.getStore();
  if (mutation) {
    if (mutation.committed) {
      throw new Error(`A operacao ${mutation.operation} tentou persistir o estado mais de uma vez.`);
    }
    const persisted = persistedDb(db);
    const serialized = JSON.stringify(persisted);
    if (mutation.driver === "postgres") {
      const update = await mutation.client.query(
        `update central_state
         set data = $1::jsonb, version = version + 1, updated_at = now()
         where id = 1
         returning version`,
        [serialized]
      );
      if (update.rowCount !== 1) {
        throw new Error(`A linha de estado nao foi encontrada durante a operacao ${mutation.operation}.`);
      }
      const committedVersion = Number(update.rows[0]?.version);
      await mutation.client.query("commit");
      mutation.committed = true;
      const confirmation = await mutation.client.query("select data, version from central_state where id = 1");
      const confirmedVersion = Number(confirmation.rows[0]?.version);
      if (!Number.isFinite(committedVersion) || confirmedVersion < committedVersion) {
        throw new Error(`Falha ao confirmar a persistencia da operacao ${mutation.operation}.`);
      }
      mutation.db = compactDb(confirmation.rows[0]?.data);
      if (confirmedVersion === committedVersion && !isDeepStrictEqual(persistedDb(mutation.db), persisted)) {
        throw new Error(`O estado confirmado diverge da operacao ${mutation.operation}.`);
      }
      return;
    }
    await writeFileDb(persisted);
    mutation.committed = true;
    mutation.db = await readFileDb();
    if (!isDeepStrictEqual(persistedDb(mutation.db), persisted)) {
      throw new Error(`O estado confirmado diverge da operacao ${mutation.operation}.`);
    }
    return;
  }
  throw new Error("writeDb exige um contexto criado por runDbMutation.");
}

function mutationLog(level, mutation, error = null) {
  const record = {
    level,
    event: "central_state_mutation",
    operation: mutation.operation,
    operationId: mutation.operationId,
    driver: mutation.driver,
    committed: mutation.committed,
    ...(error ? { error: String(error.message || error) } : {})
  };
  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else console.warn(output);
}

async function runPostgresMutation(operation, callback) {
  await ensurePostgresDb();
  const pool = await postgresPool();
  const client = await pool.connect();
  const mutation = {
    operation,
    operationId: randomUUID(),
    driver: "postgres",
    client,
    db: null,
    committed: false,
    started: false,
    async initialize() {
      if (this.started) return;
      await client.query("begin");
      const result = await client.query("select data from central_state where id = 1 for update");
      this.db = compactDb(result.rows[0]?.data);
      this.started = true;
    }
  };
  try {
    const value = await mutationStorage.run(mutation, callback);
    if (mutation.started && !mutation.committed) await client.query("rollback");
    return value;
  } catch (error) {
    if (mutation.started && !mutation.committed) await client.query("rollback").catch(() => {});
    mutationLog("error", mutation, error);
    throw error;
  } finally {
    client.release();
  }
}

async function runFileMutation(operation, callback) {
  const previous = fileMutationTail;
  let release;
  fileMutationTail = new Promise((resolveTail) => {
    release = resolveTail;
  });
  await previous.catch(() => {});
  const mutation = {
    operation,
    operationId: randomUUID(),
    driver: "json",
    db: null,
    committed: false,
    async initialize() {
      if (!this.db) this.db = await readFileDb();
    }
  };
  try {
    return await mutationStorage.run(mutation, callback);
  } catch (error) {
    mutationLog("error", mutation, error);
    throw error;
  } finally {
    release();
  }
}

export async function runDbMutation(operation, callback) {
  if (mutationStorage.getStore()) return callback();
  return usePostgres()
    ? runPostgresMutation(operation, callback)
    : runFileMutation(operation, callback);
}

export function dbMutationActive() {
  return Boolean(mutationStorage.getStore());
}

export function storageInfo() {
  return {
    driver: usePostgres() ? "postgres" : "json",
    databaseUrlConfigured: usePostgres()
  };
}
