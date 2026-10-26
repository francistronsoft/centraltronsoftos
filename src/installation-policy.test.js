import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClientCanBeDeleted, rebindInstallation, resetTarget } from './installation-policy.js';

function fixture() {
  return {
    installations: [{ id: 'stable', clientId: 'client', installationId: 'windows', token: 'old', history: [1] },
      { clientId: 'client', installationId: 'standby', token: 'keep' }],
    pairingTokens: [{ installationId: 'windows' }],
    alerts: [{ installationId: 'windows' }, { installationId: 'standby' }],
    events: [{ installationId: 'windows' }], oauthEvents: [],
    oauthCredentials: [{ installationId: 'windows' }, { installationId: 'standby' }], oauthStates: []
  };
}

test('reset requires explicit selection when multiple environments exist', () => {
  const db = fixture();
  assert.throws(() => resetTarget(db, 'client'), { status: 409 });
  assert.equal(resetTarget(db, 'client', 'windows'), 'windows');
  assert.throws(() => resetTarget(db, 'other', 'windows'), { status: 409 });
  assert.equal(resetTarget(db, 'empty'), null);
  db.installations.pop();
  assert.equal(resetTarget(db, 'client'), 'windows');
});

test('client deletion cannot cascade through any existing environment', () => {
  const db = fixture();
  assert.throws(() => assertClientCanBeDeleted(db, 'client'), { status: 409 });
  assert.equal(db.installations.length, 2);
  assert.doesNotThrow(() => assertClientCanBeDeleted(db, 'empty'));
});

test('Windows migration preserves history and sibling environment, without duplicate', () => {
  const db = fixture();
  const sibling = structuredClone(db.installations[1]);
  const target = rebindInstallation(db, 'client', 'windows', 'linux', 'new');
  assert.equal(target.id, 'stable');
  assert.deepEqual(target.history, [1]);
  assert.equal(target.token, 'new');
  assert.equal(db.installations.length, 2);
  assert.deepEqual(db.installations[1], sibling);
  assert.equal(db.events[0].installationId, 'linux');
  assert.deepEqual(db.alerts.map(item => item.installationId), ['linux', 'standby']);
  assert.deepEqual(db.oauthCredentials, [{ installationId: 'standby' }]);
});

test('migration rejects missing, foreign or occupied destination without changes', () => {
  for (const args of [['other', 'windows', 'linux'], ['client', 'missing', 'linux'],
    ['client', 'windows', 'standby'], ['client', 'windows', '']]) {
    const db = fixture();
    const before = structuredClone(db);
    assert.throws(() => rebindInstallation(db, ...args, 'new'), { status: 409 });
    assert.deepEqual(db, before);
  }
});
