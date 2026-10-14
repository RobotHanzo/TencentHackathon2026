import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Uses only resources bearing this run's unique ownership label. No pruning.
const image = process.argv[2];
const runId = randomUUID();
const prefix = `clearport-smoke-${runId}`;
const volume = `${prefix}-data`;
const ownershipLabel = 'clearport.smoke-run';
const password = randomBytes(32).toString('hex');
const basicToken = Buffer.from(`clearport:${password}`).toString('base64');
const containers = new Set();
const deadline = Date.now() + 50_000;
let volumeCreated = false;
let interrupted = false;
let cleanupFailed = false;

process.once('SIGINT', () => {
  interrupted = true;
});
process.once('SIGTERM', () => {
  interrupted = true;
});

function sanitize(value) {
  return String(value)
    .replaceAll(password, '[redacted]')
    .replaceAll(basicToken, '[redacted]')
    .replace(
      /\b(Authorization|APP_ACCESS_PASSWORD|AI_API_KEY)(\s*[:=]\s*)[^\s]+/gi,
      '$1$2[redacted]',
    );
}

function remaining() {
  if (interrupted) throw new Error('Smoke check interrupted.');
  const milliseconds = deadline - Date.now();
  if (milliseconds <= 0)
    throw new Error('Container smoke check exceeded its 50-second run budget.');
  return milliseconds;
}

function docker(args, { optional = false, cleanup = false } = {}) {
  const result = spawnSync('docker', args, {
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: cleanup ? 3000 : Math.min(15_000, remaining()),
    maxBuffer: 1024 * 1024,
    // Pass the generated password through the environment, never command arguments.
    env: { ...process.env, APP_ACCESS_PASSWORD: password },
  });
  if ((result.error || result.status !== 0) && !optional) {
    const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`Docker ${args[0]} failed: ${sanitize(detail).slice(0, 1500)}`);
  }
  return result;
}

function inspectContainer(name, options = {}) {
  const result = docker(['inspect', '--type', 'container', name], { ...options, optional: true });
  if (result.status !== 0) {
    if (!options.cleanup || /No such (?:object|container)/i.test(result.stderr ?? '')) return null;
    throw new Error(
      `Could not inspect smoke container during cleanup: ${sanitize(result.error?.message || result.stderr || 'Docker unavailable')}`,
    );
  }
  return JSON.parse(result.stdout)[0];
}

function startContainer(name, { authenticate = true, persist = true } = {}) {
  if (inspectContainer(name)) throw new Error('A smoke resource name is already in use.');
  containers.add(name); // A failed docker run can still leave a created container.
  const args = [
    'run',
    '--detach',
    '--pull=never',
    '--init',
    '--name',
    name,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--label',
    `${ownershipLabel}=${runId}`,
    '--env',
    'NODE_ENV=production',
    '--env',
    'DEMO_MODE=false',
    '--env',
    'HOST=0.0.0.0',
    '--env',
    'PORT=3001',
    '--env',
    'DATA_PATH=/app/data/clearport.db',
    '--env',
    'APP_USER_ID=manager-sarah',
    '--env',
    authenticate ? 'APP_ACCESS_PASSWORD' : 'APP_ACCESS_PASSWORD=',
  ];
  if (authenticate) args.push('--publish', '127.0.0.1::3001');
  if (persist) args.push('--mount', `type=volume,source=${volume},target=/app/data`);
  args.push(image);
  docker(args);
  if (!authenticate) return;
  const binding = docker(['port', name, '3001/tcp']).stdout.trim();
  assert.match(binding, /^127\.0\.0\.1:\d+$/, 'Smoke container must publish only on loopback.');
  return `http://${binding}`;
}

async function request(base, path, { auth = false, method = 'GET', body, timeout = 2000 } = {}) {
  const multipart = body instanceof FormData;
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(auth ? { Authorization: `Basic ${basicToken}` } : {}),
      ...(body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(Math.min(timeout, remaining())),
  });
}

async function waitForHealth(name, base) {
  const readyDeadline = Math.min(deadline, Date.now() + 15_000);
  while (Date.now() < readyDeadline) {
    try {
      const response = await request(base, '/api/health');
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.ok, true);
        assert.equal(health.demoMode, false, 'Container must use protected, non-demo mode.');
        return;
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    const container = inspectContainer(name);
    if (!container?.State.Running)
      throw new Error('Production container exited before becoming healthy.');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Production container did not become healthy within 15 seconds.');
}

function removeOwnedContainer(name, cleanup = false) {
  const container = inspectContainer(name, { cleanup });
  if (!container) return;
  if (container.Config.Labels?.[ownershipLabel] !== runId) {
    throw new Error('Refusing to remove a container without this smoke run’s ownership label.');
  }
  docker(['rm', '--force', name], { cleanup });
  containers.delete(name);
}

function pdfFixture() {
  const stream = 'BT /F1 12 Tf 50 700 Td (Singapore container PDF import smoke check.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

async function main() {
  if (!image || process.argv.length !== 3)
    throw new Error('Usage: node scripts/smoke-container.mjs <built-image>');
  docker(['info', '--format', '{{.ServerVersion}}']);
  docker(['image', 'inspect', image]);
  if (docker(['volume', 'inspect', volume], { optional: true }).status === 0) {
    throw new Error('A smoke volume name is already in use.');
  }
  volumeCreated = true;
  docker(['volume', 'create', '--label', `${ownershipLabel}=${runId}`, volume]);

  const first = `${prefix}-first`;
  const base = startContainer(first);
  await waitForHealth(first, base);
  console.log('PASS production startup and health');
  const config = inspectContainer(first).Config;
  assert.ok(
    config.User && !['0', 'root'].includes(config.User.split(':')[0]),
    'Image must declare a non-root runtime user.',
  );
  const healthcheck = config.Healthcheck?.Test;
  assert.ok(
    Array.isArray(healthcheck) && healthcheck[0] === 'CMD',
    'Image must define an executable CMD healthcheck.',
  );
  docker(['exec', first, ...healthcheck.slice(1)]);
  console.log('PASS non-root image and image healthcheck under Compose security restrictions');

  const page = await request(base, '/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /clearport/i);
  const asset = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  assert.ok(asset, 'Built page must reference a JavaScript asset.');
  const assetUrl = new URL(asset, base);
  assert.equal(assetUrl.origin, base);
  assert.equal((await request(base, `${assetUrl.pathname}${assetUrl.search}`)).status, 200);
  console.log('PASS built page and JavaScript asset');

  assert.equal((await request(base, '/api/state')).status, 401);
  const stateResponse = await request(base, '/api/state', { auth: true });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.user.id, 'manager-sarah');
  assert.ok(
    state.cases.length > 0 && state.cases.every((item) => item.jurisdiction === 'Singapore'),
  );
  assert.equal(
    (
      await request(base, '/api/session', {
        auth: true,
        method: 'POST',
        body: { userId: 'employee-amir' },
      })
    ).status,
    403,
  );
  console.log('PASS authentication and disabled demo role switching');

  const upload = new FormData();
  upload.set('title', 'Container PDF smoke check');
  upload.set('skillId', 'general');
  upload.set('file', new Blob([pdfFixture()], { type: 'application/pdf' }), 'smoke.pdf');
  const importedResponse = await request(base, '/api/knowledge/import', {
    auth: true,
    method: 'POST',
    body: upload,
    timeout: 6000,
  });
  assert.equal(importedResponse.status, 201, 'Linux runtime must extract readable PDF text.');
  const imported = await importedResponse.json();
  assert.match(imported.content, /Singapore container PDF import/);
  assert.equal(imported.status, 'Pending');
  console.log('PASS PDF extraction in the hardened Linux runtime');

  const createdResponse = await request(base, '/api/cases', {
    auth: true,
    method: 'POST',
    body: {
      title: `Container persistence check ${runId.slice(0, 8)}`,
      customer: 'Container smoke test',
      category: 'General cargo',
      jurisdiction: 'Singapore',
      documentType: 'Customs declaration',
      content: 'Fictional container smoke check: invoice and packing list received.',
      permitNumber: '',
      permitExpiry: '',
      shipmentDate: '',
      warehouseConfirmed: false,
    },
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.ok(created.id);
  docker(['stop', '--time', '10', first]);
  assert.equal(
    inspectContainer(first)?.State.ExitCode,
    0,
    'Application should exit cleanly on SIGTERM.',
  );
  removeOwnedContainer(first);
  const second = `${prefix}-second`;
  const restartedBase = startContainer(second);
  await waitForHealth(second, restartedBase);
  const persistedResponse = await request(restartedBase, '/api/state', { auth: true });
  assert.equal(persistedResponse.status, 200);
  const persisted = await persistedResponse.json();
  assert.ok(
    persisted.cases.some((item) => item.id === created.id),
    'Case must survive container replacement using the same volume.',
  );
  assert.ok(
    persisted.knowledge.some((item) => item.id === imported.id),
    'Imported knowledge must also persist.',
  );
  console.log('PASS graceful shutdown and persisted case after container replacement');

  const noPassword = `${prefix}-no-password`;
  startContainer(noPassword, { authenticate: false, persist: false });
  const exitCode = Number(docker(['wait', noPassword]).stdout.trim());
  assert.ok(
    Number.isInteger(exitCode) && exitCode !== 0,
    'Missing production password must stop startup.',
  );
  const startupLogs = docker(['logs', '--tail', '30', noPassword]);
  assert.match(
    `${startupLogs.stdout}\n${startupLogs.stderr}`,
    /APP_ACCESS_PASSWORD|access password/i,
  );
  console.log('PASS fail-closed startup without password');
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL ${sanitize(error instanceof Error ? error.message : error)}`);
  for (const name of containers) {
    try {
      const container = inspectContainer(name, { cleanup: true });
      if (container?.Config.Labels?.[ownershipLabel] !== runId) continue;
      const logs = docker(['logs', '--tail', '20', name], { optional: true, cleanup: true });
      const output = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`.trim();
      if (output) console.error(sanitize(output).slice(-4000));
    } catch {
      /* Cleanup below still runs if diagnostics are unavailable. */
    }
  }
} finally {
  for (const name of containers) {
    try {
      removeOwnedContainer(name, true);
    } catch (error) {
      cleanupFailed = true;
      console.error(`Cleanup: ${sanitize(error.message)}`);
    }
  }
  if (volumeCreated) {
    try {
      const found = docker(['volume', 'inspect', volume], { cleanup: true });
      assert.equal(
        JSON.parse(found.stdout)[0].Labels?.[ownershipLabel],
        runId,
        'Volume ownership changed; refusing removal.',
      );
      docker(['volume', 'rm', volume], { cleanup: true });
    } catch (error) {
      cleanupFailed = true;
      console.error(`Cleanup: ${sanitize(error.message)}`);
    }
  }
  if (cleanupFailed) process.exitCode = 1;
  if (process.exitCode !== 1) console.log('PASS smoke resources removed');
}
