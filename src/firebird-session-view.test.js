import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../prototype/firebird-session-view.js';

const view = globalThis.centralFirebirdSessions;
const now = Date.now();
const session = (extra = {}) => ({
  id: 'a', databaseAlias: 'erp', sourceNode: 'primary',
  remoteAddress: '192.168.0.11/4000', remoteProcess: 'app.exe',
  connectedAt: new Date(now - 60000).toISOString(),
  lastSeenAt: new Date(now).toISOString(), ...extra
});

test('groups connections from the same equipment without losing members', () => {
  const rows = view.group([session(), session({ id: 'b', remoteAddress: '192.168.0.11/5000' })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].remoteAddress, '192.168.0.11');
  assert.equal(rows[0].sessionCount, 2);
  assert.equal(rows[0].activeCount, 2);
  assert.deepEqual(rows[0].members.map(s => s.id), ['a', 'b']);
});

test('separates different equipment, databases and source nodes', () => {
  const rows = view.group([
    session(), session({ remoteAddress: '192.168.0.12' }),
    session({ databaseAlias: 'other' }), session({ sourceNode: 'standby' })
  ]);
  assert.equal(rows.length, 4);
});

test('does not merge unknown equipment', () => {
  assert.equal(view.group([session({ remoteAddress: '' }), session({ id: 'b', remoteAddress: '' })]).length, 2);
});

test('long-running active sessions remain in both active and suspicious filters', () => {
  const [row] = view.group([session({ durationSeconds: 20000 })]);
  assert.equal(view.matches(row, 'active'), true);
  assert.equal(view.matches(row, 'suspicious'), true);
  assert.equal(view.matches(row, 'closed'), false);
});

test('prioritizes active sessions over closed backup history in equipment summary', () => {
  const [row] = view.group([
    session({ id: 'backup', remoteProcess: 'GBAK.exe', disconnectedAt: new Date(now).toISOString() }),
    session({ id: 'active', connectedAt: new Date(now - 20000000).toISOString(), durationSeconds: null })
  ]);
  assert.equal(row.id, 'active');
  assert.equal(row.activeCount, 1);
  assert.equal(row.sessionCount, 2);
  assert.ok(view.durationMs(row) >= 20000000);
});

test('closed-only equipment and maintenance processes remain available in filters', () => {
  const [row] = view.group([session({ remoteProcess: 'GBAK.exe', disconnectedAt: new Date(now).toISOString() })]);
  assert.equal(view.matches(row, 'closed'), true);
  assert.equal(view.matches(row, 'active'), false);
  assert.equal(view.matches(row, 'suspicious'), true);
});

test('renders one expandable summary per equipment, preserves details and expansion', () => {
  const source = readFileSync(new URL('../prototype/app.js', import.meta.url), 'utf8');
  const renderer = source.slice(source.indexOf('function toggleFirebirdEquipment('), source.indexOf('function databaseDisplayName('));
  const context = vm.createContext({
    centralFirebirdSessions: view, expandedFirebirdEquipment: new Set(), firebirdSessionFilter: 'active',
    monitoredDatabases: d => d.databases, databaseDisplayName: d => d.name, databaseDisplayAlias: d => d.alias,
    firebirdSessionsForDatabase: d => d.firebirdSessions, integerLabel: String,
    escapeHtml: v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    firebirdSessionTone: () => 'online', firebirdSessionDuration: () => '1m',
    firebirdSessionIsSuspicious: view.suspicious, formatDateTime: String,
    firebirdSessionFilterLabel: String
  });
  vm.runInContext(renderer, context);
  const payload = { databases: [{ name: 'ERP', alias: 'erp', firebirdSessions: [
    session({ remoteProcess: '<script>bad</script>', attachmentId: 758, user: 'SYSDBA' }),
    session({ id: 'b', remoteAddress: '192.168.0.11/5000', remotePid: 4084 })
  ] }] };
  const html = context.renderFirebirdSessions(payload);
  assert.equal((html.match(/<details /g) || []).length, 1);
  assert.equal((html.match(/class="firebird-session-detail"/g) || []).length, 2);
  assert.ok(html.includes('SYSDBA'));
  assert.ok(html.includes('&lt;script>bad&lt;/script>'));
  const key = view.group(payload.databases[0].firebirdSessions)[0].equipmentKey;
  context.toggleFirebirdEquipment({ dataset: { equipmentKey: key }, open: true });
  assert.match(context.renderFirebirdSessions(payload), /ontoggle="toggleFirebirdEquipment\(this\)" open/);
  context.toggleFirebirdEquipment({ dataset: { equipmentKey: key }, open: false });
  assert.doesNotMatch(context.renderFirebirdSessions(payload), /ontoggle="toggleFirebirdEquipment\(this\)" open/);
});
