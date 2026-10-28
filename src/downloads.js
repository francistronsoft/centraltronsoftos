import { mkdir, readdir, readFile, writeFile, rename, rm, stat, open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

export const maxDownloadBytes = 90 * 1024 * 1024;
const validId = /^[a-f0-9-]{36}$/;
function fail(status, message) { return Object.assign(new Error(message), { status }); }
export function downloadMetadata(input) {
  const filename = String(input.filename || "");
  const title = String(input.title || "").trim();
  const version = String(input.version || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,149}\.(exe|msi|zip)$/i.test(filename)) {
    throw fail(400, "Use um arquivo .exe, .msi ou .zip com nome simples, sem diretorios.");
  }
  if (!title || title.length > 120 || !version || version.length > 40) {
    throw fail(400, "Informe nome (ate 120 caracteres) e versao (ate 40 caracteres).");
  }
  return { filename, title, version };
}

export function downloadStore(directory) {
  async function get(id) {
    if (!validId.test(id)) throw fail(404, "Download nao encontrado.");
    try {
      const metadata = JSON.parse(await readFile(join(directory, id, "metadata.json"), "utf8"));
      const path = join(directory, id, "payload");
      const info = await stat(path);
      return { metadata, path, size: info.size };
    } catch (error) {
      if (error.code === "ENOENT") throw fail(404, "Download nao encontrado.");
      throw error;
    }
  }
  return {
    get,
    async list() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const result = [];
      for (const name of await readdir(directory)) {
        if (!validId.test(name)) continue;
        try { result.push((await get(name)).metadata); }
        catch (error) { if (error.status !== 404) throw error; }
      }
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async publish(source, input, limit = maxDownloadBytes) {
      const fields = downloadMetadata(input);
      const declared = Number(source.headers?.["content-length"]);
      if (declared > limit) throw fail(413, "Arquivo excede o limite de 90 MiB.");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      const staging = join(directory, `.upload-${id}`);
      await mkdir(staging, { mode: 0o700 });
      let handle;
      try {
        handle = await open(join(staging, "payload"), "wx", 0o600);
        let size = 0;
        const hash = createHash("sha256");
        for await (const chunk of source) {
          size += chunk.length;
          if (size > limit) throw fail(413, "Arquivo excede o limite de 90 MiB.");
          hash.update(chunk);
          await handle.writeFile(chunk);
        }
        if (!size || (Number.isFinite(declared) && declared !== size)) throw fail(400, "Upload vazio ou incompleto.");
        await handle.close(); handle = null;
        const metadata = { id, ...fields, size, sha256: hash.digest("hex"), createdAt: new Date().toISOString() };
        await writeFile(join(staging, "metadata.json"), JSON.stringify(metadata), { mode: 0o600 });
        await rename(staging, join(directory, id));
        return metadata;
      } finally {
        await handle?.close();
        await rm(staging, { recursive: true, force: true });
      }
    },
    async remove(id) {
      await get(id);
      await rm(join(directory, id), { recursive: true });
    }
  };
}
