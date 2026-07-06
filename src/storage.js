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

let pgPool = null;
let pgReady = false;

function usePostgres() {
  return Boolean(process.env.DATABASE_URL);
}

function withDefaults(db) {
  return { ...emptyDb, ...(db || {}) };
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
  return withDefaults(result.rows[0]?.data);
}

async function writePostgresDb(db) {
  await ensurePostgresDb();
  const pool = await postgresPool();
  await pool.query(
    `insert into central_state (id, data, updated_at)
     values (1, $1::jsonb, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [JSON.stringify(withDefaults(db))]
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
  return withDefaults(JSON.parse(raw));
}

async function writeFileDb(db) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, `${JSON.stringify(withDefaults(db), null, 2)}\n`, "utf8");
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
