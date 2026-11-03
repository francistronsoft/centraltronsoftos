import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../prototype/app.js', import.meta.url), 'utf8');
const transactionView = source.slice(source.indexOf('function transactionHealthForDatabase('), source.indexOf('function firebirdSessionsForDatabase('));
const haView = source.slice(source.indexOf('function renderHaNodeOperationalCards('), source.indexOf('function renderHaOperationalPanel('));

function context() {
  const helpers = {
    storageInfo: () => ({}), gaugeValue: () => null, quotaGaugeValue: () => null,
    metricSeriesValues: () => [], bytesLabel: String, escapeHtml: String,
    monitoredDatabases: database => database.databases || [],
    databaseDisplayName: database => database.name,
    databaseDisplayAlias: database => database.alias,
    integerLabel: String, formatDateTime: String
  };
  for (const name of ['detailGauge', 'quotaGaugeCaption', 'detailItem', 'serverTimeCaption',
    'databaseGrowthChart', 'performanceLineChart', 'networkLineChart', 'localNetworkLineChart',
    'detailTemperaturePanel', 'renderDatabaseSummary', 'renderFirebirdSessions', 'firebirdMetricsPanel']) {
    helpers[name] = () => `<div data-existing-panel="${name}"></div>`;
  }
  const result = vm.createContext(helpers);
  vm.runInContext(transactionView + haView, result);
  return result;
}

test('HA primary and standby render their own transaction gap without losing existing panels', () => {
  const view = context();
  for (const [hostname, gap] of [['primary', 2], ['standby', 532100]]) {
    const html = view.renderHaNodeOperationalCards({
      host: { hostname },
      databaseInfo: { databases: [{ name: hostname, alias: 'erp_tronsoft',
        transactionHealth: { oldestTransaction: 4137437, oldestActive: 4137438, nextTransaction: 4137437 + gap },
        transactionGap: { gap }, indexHealth: { checkedAt: '2026-11-03T00:16:04Z' }
      }] }
    });
    assert.match(html, /Transacoes Firebird/);
    assert.ok(html.includes(`<span>Gap OIT/Next</span><strong>${gap}</strong>`));
    assert.ok(html.includes('<span>Oldest transaction</span><strong>4137437</strong>'));
    assert.equal((html.match(/transaction-health-panel/g) || []).length, 1);
    for (const name of ['renderDatabaseSummary', 'renderFirebirdSessions', 'firebirdMetricsPanel']) {
      assert.ok(html.includes(`data-existing-panel="${name}"`));
    }
  }
});

test('HA nodes without database readings keep the empty state and other panels', () => {
  const html = context().renderHaNodeOperationalCards({});
  assert.match(html, /Nenhuma leitura transacional recebida ainda/);
  assert.match(html, /data-existing-panel="renderFirebirdSessions"/);
});
