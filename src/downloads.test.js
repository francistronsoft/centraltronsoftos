import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { downloadStore, downloadMetadata } from "./downloads.js";

const fields = { filename: "TronSoftAgentWindowsSetup.exe", title: "Agente Windows", version: "0.1.7" };
test("downloads rejeitam caminhos, cabecalhos injetados e extensoes indevidas", () => {
  for (const filename of ["../agent.exe", "C:\\agent.exe", "a.exe\r\nx: y", "script.html", "agent.ps1"]) {
    assert.throws(() => downloadMetadata({ ...fields, filename }), { status: 400 });
  }
  assert.throws(() => downloadMetadata({ ...fields, version: "" }), { status: 400 });
});
test("publicacao atomica, hash real, persistencia e exclusao isolada", async () => {
  const dir = await mkdtemp(join(tmpdir(), "central-downloads-"));
  try {
    const store = downloadStore(dir);
    const bytes = Buffer.from("installer-test-only");
    const item = await store.publish(Readable.from([bytes]), fields);
    assert.equal(item.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(await readFile((await store.get(item.id)).path), bytes);
    const other = await store.publish(Readable.from([Buffer.from("other")]), fields);
    assert.equal((await downloadStore(dir).list()).length, 2);
    await store.remove(item.id);
    assert.deepEqual((await store.list()).map(x => x.id), [other.id]);
    await assert.rejects(store.get("../metadata.json"), { status: 404 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("upload excedido, vazio ou interrompido nao publica nem deixa arquivo parcial", async () => {
  const dir = await mkdtemp(join(tmpdir(), "central-download-failure-"));
  try {
    const store = downloadStore(dir);
    await assert.rejects(store.publish(Readable.from([Buffer.from("12345")]), fields, 4), { status: 413 });
    await assert.rejects(store.publish(Readable.from([]), fields), { status: 400 });
    const broken = Readable.from((async function* () { yield Buffer.from("part"); throw new Error("disconnected"); })());
    await assert.rejects(store.publish(broken, fields), /disconnected/);
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
