import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

test("HTTP: autenticacao, publicacao admin, download e exclusao sem afetar cadastros", { timeout: 30000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "central-download-http-"));
  const child = spawn(process.execPath, ["src/server.js"], {
    env: { ...process.env, PORT: "0", CENTRAL_DATA_DIR: dataDir, DATABASE_URL: "", CENTRAL_ADMIN_EMAIL: "test@local.test", CENTRAL_ADMIN_PASSWORD: randomUUID() },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let errors = "";
  child.stderr.on("data", chunk => { errors += chunk; });
  try {
    const base = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", chunk => {
        output += chunk;
        const match = output.match(/http:\/\/localhost:(\d+)/);
        if (match) resolve(`http://127.0.0.1:${match[1]}`);
      });
      child.once("error", reject);
      child.once("exit", code => reject(new Error(`server exited ${code}: ${errors}`)));
    });
    assert.equal((await fetch(`${base}/api/downloads`)).status, 401);
    // Seed isolated test sessions through the same serialized storage used by production.
    const savedDir = process.env.CENTRAL_DATA_DIR;
    const savedDatabaseUrl = process.env.DATABASE_URL;
    process.env.CENTRAL_DATA_DIR = dataDir;
    delete process.env.DATABASE_URL;
    const storage = await import(`./storage.js?downloads-http=${randomUUID()}`);
    if (savedDir === undefined) delete process.env.CENTRAL_DATA_DIR; else process.env.CENTRAL_DATA_DIR = savedDir;
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedDatabaseUrl;
    const adminToken = randomUUID(); const userToken = randomUUID();
    // The application's session token is stored verbatim (not a password).
    await storage.runDbMutation("seed download test", async () => {
      const db = await storage.readDb();
      const admin = db.users.find(user => user.email === "test@local.test");
      db.users.push({ id: "download-reader", email: "reader@local.test", role: "tronsoft_user", status: "active", permissions: [] });
      for (const [token, userId] of [[adminToken, admin.id], [userToken, "download-reader"]]) {
        db.sessions.push({ token, userId, expiresAt: new Date(Date.now() + 60000).toISOString() });
      }
      await storage.writeDb(db);
    });
    const adminHeaders = { cookie: `central_session=${adminToken}`, "content-type": "application/octet-stream" };
    const userHeaders = { cookie: `central_session=${userToken}` };
    const query = new URLSearchParams({ filename: "Agent.exe", title: "Windows", version: "1" });
    const endpoint = `${base}/api/downloads?${query}`;
    assert.equal((await fetch(endpoint, { method: "POST", headers: userHeaders, body: "binary" })).status, 403);
    const before = JSON.parse(await readFile(join(dataDir, "central-db.json"), "utf8"));
    const upload = await fetch(endpoint, { method: "POST", headers: adminHeaders, body: "binary-test" });
    assert.equal(upload.status, 201, await upload.clone().text());
    const item = await upload.json();
    const list = await fetch(`${base}/api/downloads`, { headers: userHeaders });
    assert.equal((await list.json()).length, 1);
    const path = `${base}/api/downloads/${item.id}`;
    assert.equal((await fetch(path)).status, 401);
    const download = await fetch(path, { headers: userHeaders });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /attachment/);
    assert.equal(await download.text(), "binary-test");
    assert.equal((await fetch(path, { method: "DELETE", headers: userHeaders })).status, 403);
    assert.equal((await fetch(path, { method: "DELETE", headers: adminHeaders })).status, 200);
    assert.equal((await fetch(path, { headers: userHeaders })).status, 404);
    const after = JSON.parse(await readFile(join(dataDir, "central-db.json"), "utf8"));
    assert.deepEqual(after, before);
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    await rm(dataDir, { recursive: true, force: true });
  }
});
