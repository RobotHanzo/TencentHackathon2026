import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';

async function startApp(t: TestContext, lines: string[]) {
  const staticDir = mkdtempSync(join(tmpdir(), 'instill-access-log-'));
  writeFileSync(join(staticDir, 'index.html'), '<title>Instill</title>');
  const service = createApp({
    dbPath: ':memory:',
    demoMode: true,
    ai: { provider: 'local' },
    staticDir,
    now: () => new Date('2026-01-02T03:04:05.678Z'),
    accessLog: (line) => lines.push(line),
  });
  const server = service.app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    service.close();
    rmSync(staticDir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The line is written when the connection finishes, just after the client has the response.
  const logged = async (count: number) => {
    for (let attempt = 0; lines.length < count && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
  };
  return { base, logged };
}

test('logs each page, asset, API and unknown request with status and timing', async (t) => {
  const lines: string[] = [];
  const { base, logged } = await startApp(t, lines);
  assert.equal(
    (await fetch(`${base}/`, { headers: { 'User-Agent': 'test-agent/1.0' } })).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
  assert.equal((await fetch(`${base}/api/missing`)).status, 404);
  await logged(3);
  assert.equal(lines.length, 3);
  assert.match(
    lines[0],
    /^2026-01-02T03:04:05\.678Z (?:::ffff:)?127\.0\.0\.1 "GET \/" 200 22 \d+\.\dms "test-agent\/1\.0"$/,
  );
  assert.match(lines[1], / "GET \/api\/state" 200 \d+ \d+\.\dms /);
  assert.match(lines[2], / "GET \/api\/missing" 404 \d+ \d+\.\dms /);
});

test('omits query strings and quotes request text so it cannot forge log lines', async (t) => {
  const lines: string[] = [];
  const { base, logged } = await startApp(t, lines);
  await fetch(`${base}/api/state?token=secret`, {
    headers: { 'User-Agent': 'agent" 200 forged', 'X-Forwarded-For': '203.0.113.9' },
  });
  await logged(1);
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /secret|token/);
  assert.match(lines[0], / "agent\\" 200 forged" xff="203\.0\.113\.9"$/);
  assert.equal(lines[0].split('\n').length, 1);
});

test('skips the loopback healthcheck but logs other health requests', async (t) => {
  const lines: string[] = [];
  const { base, logged } = await startApp(t, lines);
  await fetch(`${base}/api/health`);
  await fetch(`${base}/api/state`);
  await logged(1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /"GET \/api\/state"/);
});

test('request handling is unchanged when the log sink throws', async (t) => {
  const lines: string[] = [];
  const staticDir = mkdtempSync(join(tmpdir(), 'instill-access-log-'));
  const service = createApp({
    dbPath: ':memory:',
    demoMode: true,
    ai: { provider: 'local' },
    staticDir,
    accessLog: (line) => {
      lines.push(line);
      throw new Error('stdout closed');
    },
  });
  const server = service.app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    service.close();
    rmSync(staticDir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
  for (let attempt = 0; lines.length < 2 && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(lines.length, 2);
});
