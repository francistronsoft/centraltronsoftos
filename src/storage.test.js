import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("serializa mutacoes concorrentes sem perder atualizacoes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "central-storage-test-"));
  process.env.CENTRAL_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;

  const storage = await import(`./storage.js?test=${Date.now()}`);
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      storage.runDbMutation(`test-${index}`, async () => {
        const db = await storage.readDb();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, index % 3));
        db.events.push({ id: `event-${index}`, installationId: "test", type: "test", receivedAt: new Date().toISOString(), payload: {} });
        await storage.writeDb(db);
      })
    )));

    const db = await storage.readDb();
    assert.equal(db.events.length, 20);
    assert.deepEqual(new Set(db.events.map((event) => event.id)), new Set(Array.from({ length: 20 }, (_, index) => `event-${index}`)));

    await assert.rejects(storage.writeDb(db), /runDbMutation/);
    await assert.rejects(
      storage.runDbMutation("rollback-test", async () => {
        const current = await storage.readDb();
        current.events.push({ id: "nao-deve-persistir", installationId: "test", type: "test", receivedAt: new Date().toISOString(), payload: {} });
        throw new Error("falha simulada");
      }),
      /falha simulada/
    );
    assert.equal((await storage.readDb()).events.length, 20);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.CENTRAL_DATA_DIR;
  }
});
