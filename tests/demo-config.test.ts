import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';

function productionEnvironment(t: TestContext, demoMode?: string) {
  const keys = ['NODE_ENV', 'DEMO_MODE', 'APP_ACCESS_PASSWORD', 'APP_USER_ID'] as const;
  const previous = keys.map((key) => [key, process.env[key]] as const);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.NODE_ENV = 'production';
  if (demoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = demoMode;
  delete process.env.APP_ACCESS_PASSWORD;
  process.env.APP_USER_ID = 'manager-sarah';
}

async function startApp(t: TestContext) {
  const service = createApp({ dbPath: ':memory:', ai: { provider: 'local' } });
  const server = service.app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    service.close();
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('DEMO_MODE=true enables password-free production demo sessions and persona switching', async (t) => {
  productionEnvironment(t, 'true');
  const base = await startApp(t);
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.demoMode, true);
  const response = await fetch(`${base}/api/state`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal((await response.json()).user.id, 'manager-sarah');
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const switched = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'employee-amir' }),
  });
  assert.equal(switched.status, 200);
  const state = await fetch(`${base}/api/state`, { headers: { Cookie: cookie } });
  assert.equal((await state.json()).user.id, 'employee-amir');
  const fresh = await fetch(`${base}/api/state`);
  assert.equal((await fresh.json()).user.id, 'manager-sarah');
});

for (const value of [undefined, 'false', '', 'TRUE', '1']) {
  test(`production DEMO_MODE=${value ?? '(unset)'} keeps authentication required`, async (t) => {
    productionEnvironment(t, value);
    assert.throws(() => createApp({ dbPath: ':memory:' }), /APP_ACCESS_PASSWORD/);
    process.env.APP_ACCESS_PASSWORD = 'test-password-for-demo-config';
    const base = await startApp(t);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).demoMode, false);
    const unauthorized = await fetch(`${base}/api/state`);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get('www-authenticate')!, /^Basic /);
    const authorization = `Basic ${Buffer.from(`instill:${process.env.APP_ACCESS_PASSWORD}`).toString('base64')}`;
    assert.equal(
      (await fetch(`${base}/api/state`, { headers: { Authorization: authorization } })).status,
      200,
    );
    const switched = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'employee-amir' }),
    });
    assert.equal(switched.status, 403);
  });
}
