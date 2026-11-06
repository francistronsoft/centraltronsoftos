import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const linux = process.platform === 'linux';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-runtime-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = {
    ...process.env,
    CENTRAL_TRONSOFTOS_SYSTEMD_DIR: path.join(dir, 'systemd'),
    CENTRAL_TRONSOFTOS_APP_DIR: path.join(dir, 'app'),
    TRACE_FILE: path.join(dir, 'trace')
  };
  return { dir, env };
}

test('runtime configuration preserves existing hardening and defers restart', { skip: !linux }, t => {
  const { dir, env } = fixture(t);
  const dropins = path.join(env.CENTRAL_TRONSOFTOS_SYSTEMD_DIR, 'central-tronsoftos.service.d');
  fs.mkdirSync(dropins, { recursive: true });
  const hardening = '[Service]\nPrivateTmp=true\nNoNewPrivileges=true\n';
  fs.writeFileSync(path.join(dropins, '10-hardening.conf'), hardening);
  const result = spawnSync('bash', ['-c', `
    systemctl() { printf '%s\\n' "$*" >> "$TRACE_FILE"; }
    export -f systemctl
    bash "$1"
  `, 'test', path.join(scripts, 'configure-node-service.sh')], { env });
  assert.equal(result.status, 0, result.stderr.toString());
  const unit = fs.readFileSync(path.join(dropins, '20-secure-node.conf'), 'utf8');
  assert.match(unit, /ExecStart=\nExecStart="\//);
  assert.ok(unit.includes(env.CENTRAL_TRONSOFTOS_APP_DIR + '/src/server.js'));
  assert.equal(fs.readFileSync(path.join(dropins, '10-hardening.conf'), 'utf8'), hardening);
  assert.equal(fs.readFileSync(path.join(dir, 'trace'), 'utf8'), 'daemon-reload\n');
});

test('invalid service/app values are rejected before writing unit files', { skip: !linux }, t => {
  const { dir, env } = fixture(t);
  for (const invalid of [{ CENTRAL_TRONSOFTOS_SERVICE_NAME: '../other' }, { CENTRAL_TRONSOFTOS_APP_DIR: '/tmp/app\nExecStart=/bin/false' }]) {
    const result = spawnSync('bash', [path.join(scripts, 'configure-node-service.sh')], { env: { ...env, ...invalid } });
    assert.equal(result.status, 64);
  }
  assert.equal(fs.existsSync(path.join(dir, 'systemd')), false);
});

test('button updater configures secure runtime and preserves data before scheduling restart', { skip: !linux }, t => {
  const { dir, env } = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: { ...env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' }, stdio: 'pipe' });
  const remote = path.join(dir, 'remote.git');
  const repo = path.join(dir, 'repo');
  git('init', '--bare', '--initial-branch=master', remote);
  git('clone', remote, repo);
  for (const name of ['src', 'prototype', 'scripts']) fs.mkdirSync(path.join(repo, name), { recursive: true });
  for (const name of ['configure-node-service.sh', 'ensure-node-runtime.sh']) fs.copyFileSync(path.join(scripts, name), path.join(repo, 'scripts', name));
  fs.writeFileSync(path.join(repo, 'src/server.js'), 'new application');
  fs.writeFileSync(path.join(repo, 'prototype/index.html'), 'new frontend');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"fixture","version":"0.1.16"}');
  git('-C', repo, 'add', '.');
  git('-C', repo, 'commit', '-m', 'fixture');
  git('-C', repo, 'push', 'origin', 'master');
  const app = env.CENTRAL_TRONSOFTOS_APP_DIR;
  fs.mkdirSync(path.join(app, 'data'), { recursive: true });
  fs.mkdirSync(path.join(app, 'src'));
  fs.writeFileSync(path.join(app, 'src/server.js'), 'old application');
  fs.writeFileSync(path.join(app, 'data/sentinel.json'), 'preserve data');
  fs.writeFileSync(path.join(app, '.env'), 'preserve configuration');
  const user = execFileSync('id', ['-un'], { encoding: 'utf8' }).trim();
  const group = execFileSync('id', ['-gn'], { encoding: 'utf8' }).trim();
  const result = spawnSync('bash', ['-c', `
    systemctl() { printf 'systemctl %s\\n' "$*" >> "$TRACE_FILE"; }
    systemd-run() { printf 'deferred %s\\n' "$*" >> "$TRACE_FILE"; }
    npm() { test -f "$CENTRAL_TRONSOFTOS_SYSTEMD_DIR/central-tronsoftos.service.d/20-secure-node.conf"; mkdir -p node_modules; printf '{}' > package-lock.json; }
    export -f systemctl systemd-run npm
    bash "$1"
  `, 'test', path.join(scripts, 'update-central.sh')], {
    env: { ...env, CENTRAL_TRONSOFTOS_REPO_DIR: repo, CENTRAL_TRONSOFTOS_USER: user, CENTRAL_TRONSOFTOS_GROUP: group, CENTRAL_TRONSOFTOS_BACKUP_DIR: path.join(dir, 'backups') }
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(fs.readFileSync(path.join(app, 'src/server.js'), 'utf8'), 'new application');
  assert.equal(fs.readFileSync(path.join(app, 'data/sentinel.json'), 'utf8'), 'preserve data');
  assert.equal(fs.readFileSync(path.join(app, '.env'), 'utf8'), 'preserve configuration');
  const trace = fs.readFileSync(env.TRACE_FILE, 'utf8');
  assert.match(trace, /systemctl daemon-reload/);
  assert.match(trace, /deferred .*--on-active=2s \/bin\/systemctl restart central-tronsoftos/);
  const backup = path.join(dir, 'backups', fs.readdirSync(path.join(dir, 'backups'))[0], 'application-before.tar.gz');
  assert.equal(execFileSync('tar', ['-xOzf', backup, './src/server.js'], { encoding: 'utf8' }), 'old application');
});
