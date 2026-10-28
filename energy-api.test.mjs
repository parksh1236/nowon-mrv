import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
function client(fetch) {
  const source = html.slice(html.indexOf('async function callDataGoKr('), html.indexOf('// 시군구코드별 총괄표제부'));
  const context = vm.createContext({ fetch, AbortSignal, URL, DATA_GO_KR_KEY: 'test-only', BLDENGY_BASE: 'https://apis.data.go.kr/1613000/BldEngyHubService' });
  vm.runInContext(source, context);
  return context;
}
const response = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
const usage = (item, totalCount = 1) => ({ response: { header: { resultCode: '00' }, body: { totalCount, items: { item } } } });
test('network failure returns a safe connection error', async () => {
  const c = client(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal((await c.fetchBeUsage('getBeElctyUsgInfo', '11350', '10500', '0701', '0001', '202601')).error, '네트워크 연결 확인 필요');
});
test('API authentication error is not reported as no data', async () => {
  const c = client(async () => response({ response: { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } }));
  assert.equal((await c.callDataGoKr('https://example.test')).ok, false);
});
test('HTTP failure is not accepted as valid JSON data', async () => {
  const c = client(async () => response({}, 503));
  assert.equal((await c.callDataGoKr('https://example.test')).ok, false);
});
test('zero usage is valid data', async () => {
  const c = client(async () => response(usage([{ useQty: 0 }])));
  const r = await c.fetchBeUsage('getBeElctyUsgInfo', '11350', '10500', '0701', '0001', '202601');
  assert.equal(r.found, true);
  assert.equal(Number(r.useQty), 0);
});
test('empty data is distinct from an error', async () => {
  const c = client(async () => response(usage([], 0)));
  const r = await c.fetchBeUsage('getBeElctyUsgInfo', '11350', '10500', '0701', '0001', '202601');
  assert.equal(r.found, false);
  assert.equal(r.error, undefined);
});
test('malformed usage is not displayed as NaN', async () => {
  const c = client(async () => response(usage([{ useQty: 'invalid' }])));
  assert.equal((await c.fetchBeUsage('getBeElctyUsgInfo', '11350', '10500', '0701', '0001', '202601')).found, false);
});
test('month lookback works on the 31st without skipping February', () => {
  const source = html.slice(html.indexOf('function recentYearMonths('), html.indexOf('// 2026년 1월'));
  const c = vm.createContext({ Date: class extends Date { constructor() { super('2026-03-31T12:00:00Z'); } } });
  vm.runInContext(source, c);
  assert.equal(c.recentYearMonths(2).join(','), '202602,202601');
});
