import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/ensure-node-runtime.sh', import.meta.url));
const bash = process.platform !== 'win32';

test('installer enforces patched Node before configuring systemd', () => {
  const installer = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  assert.match(installer, /node_runtime_supported/);
  assert.match(installer, /as_root bash "\$SOURCE_DIR\/scripts\/ensure-node-runtime.sh"/);
  assert.match(installer, /NODE_BIN="\$\(command -v node\)"/);
  assert.doesNotMatch(installer, /if \[\[ "\$major" -ge 20 \]\]/);
  const server = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  assert.match(server, /runtime: \{ node: process.version \}/);
});

test('runtime version policy retains patched releases and rejects vulnerable versions', { skip: !bash }, () => {
  for (const [version, accepted] of [['v22.23.1', false], ['v22.23.3', false], ['v20.19.2', false], ['v22.23.4', true], ['v24.22.1', true], ['v26.12.1', true], ['', false]]) {
    const result = spawnSync('bash', ['-c', 'source "$1"; node_runtime_supported "$2"', 'test', script, version]);
    assert.equal(result.status === 0, accepted, version);
  }
});

test('patched runtime requires no downloads or mutations', { skip: !bash }, () => {
  const result = spawnSync('bash', ['-c', 'source "$1"; node() { echo v22.23.4; }; curl() { exit 99; }; ensure_node_runtime', 'test', script]);
  assert.equal(result.status, 0);
});

test('corrupt runtime archive is rejected before activation', { skip: !bash }, () => {
  const result = spawnSync('bash', ['-c', `
    export LC_ALL=C
    source "$1"
    node() { echo v22.23.1; }
    dpkg() { echo amd64; }
    mktemp() { command mktemp -d; }
    curl() { printf bad > "\${@: -1}"; }
    tar() { echo UNSAFE >&2; exit 99; }
    mv() { echo UNSAFE >&2; exit 99; }
    ensure_node_runtime
  `, 'test', script]);
  assert.equal(result.status, 1);
  assert.match(result.stderr.toString(), /checksum did NOT match/);
  assert.doesNotMatch(result.stderr.toString(), /UNSAFE/);
});
