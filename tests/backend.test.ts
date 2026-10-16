import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { createApp } from '../server/app.ts';
import type { AppState, CaseInput, CaseRecord, Knowledge, ChatMessage } from '../shared/types.ts';

const input: CaseInput = {
  title: 'Wireless sensor import',
  customer: 'Demo importer',
  category: 'Electronics',
  jurisdiction: 'Singapore',
  documentType: 'Customs declaration',
  content:
    'Import 50 wireless sensors with Bluetooth transmitters. The invoice and packing list are attached.',
  permitNumber: 'DEMO-PERMIT',
  permitExpiry: '2026-10-13',
  shipmentDate: '2026-10-16',
  warehouseConfirmed: false,
};

test('persistent approval loop, permissions, import isolation, and decision retrieval', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'instill-api-'));
  const dbPath = join(folder, 'test.db');
  const service = createApp({
    dbPath,
    demoMode: true,
    now: () => new Date('2026-10-13T16:30:00Z'),
  });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = '';
  const call = async <T>(
    path: string,
    method = 'GET',
    body?: unknown,
    expected = 200,
  ): Promise<T> => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Cookie: cookie,
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie')!.split(';')[0];
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value as T;
  };
  try {
    let state = await call<AppState>('/state');
    assert.equal(state.user.role, 'manager');
    assert.ok(state.cases.length >= 5);
    const employee = state.users.find((user) => user.role === 'employee')!;
    const manager = state.users.find((user) => user.role === 'manager')!;
    await call('/session', 'POST', { userId: employee.id });
    const item = await call<CaseRecord>('/cases', 'POST', input, 201);
    await call(`/cases/${item.id}/submit`, 'POST', {}, 409);
    const reviewed = await call<CaseRecord>(`/cases/${item.id}/review`, 'POST', {});
    assert.ok(
      reviewed.review!.suggestions.some((suggestion) =>
        suggestion.title.toLowerCase().includes('expir'),
      ),
    );
    assert.ok(
      reviewed.review!.suggestions.some((suggestion) =>
        suggestion.detail.includes('today (2026-10-14 in Singapore)'),
      ),
    );
    assert.ok(reviewed.review!.suggestions.every((suggestion) => suggestion.citations.length > 0));
    await call(`/cases/${item.id}/decision`, 'POST', { decision: 'approved' }, 403);
    const upload = new FormData();
    upload.set('title', 'Project ORCHID internal precedent');
    upload.set('skillId', 'electronics');
    upload.set(
      'file',
      new Blob([
        'ORCHID sensors must use an amber carton label. Internal customer-specific instruction.',
      ]),
      'orchid.txt',
    );
    const imported = await call<Knowledge>('/knowledge/import', 'POST', upload, 201);
    assert.equal(imported.status, 'Pending');
    await call(`/knowledge/${imported.id}/publish`, 'POST', {}, 403);
    let chat = await call<ChatMessage[]>('/chat', 'POST', {
      message: 'ORCHID wireless sensors amber carton label',
    });
    assert.ok(!chat.at(-1)!.citations.some((citation) => citation.id === imported.id));
    await call(`/cases/${item.id}`, 'PUT', {
      ...input,
      content: `${input.content} Revised quantity 55.`,
    });
    state = await call<AppState>('/state');
    assert.equal(state.cases.find((entry) => entry.id === item.id)!.review, null);
    await call(`/cases/${item.id}/submit`, 'POST', {}, 409);
    const fresh = await call<CaseRecord>(`/cases/${item.id}/review`, 'POST', {});
    await call(`/cases/${item.id}/submit`, 'POST', {});
    await call('/session', 'POST', { userId: manager.id });
    await call(`/knowledge/${imported.id}/publish`, 'POST', {});
    await call(`/cases/${item.id}/decision`, 'POST', { decision: 'approved' }, 409);
    const first = fresh.review!.suggestions[0];
    await call(
      `/cases/${item.id}/suggestions/${first.id}`,
      'POST',
      { decision: 'rejected', comment: '' },
      400,
    );
    await call(`/cases/${item.id}/suggestions/${first.id}`, 'POST', {
      decision: 'rejected',
      comment: 'ORCHID exemption is case specific; verify the corrected permit before release.',
    });
    for (const suggestion of fresh.review!.suggestions.slice(1)) {
      await call(`/cases/${item.id}/suggestions/${suggestion.id}`, 'POST', {
        decision: 'accepted',
        comment: 'Check completed with source evidence.',
      });
    }
    const approved = await call<CaseRecord>(`/cases/${item.id}/decision`, 'POST', {
      decision: 'approved',
      comment: 'All corrections independently checked.',
    });
    assert.equal(approved.status, 'Approved');
    state = await call<AppState>('/state');
    const precedent = state.knowledge.find(
      (entry) => entry.caseId === item.id && entry.decision === 'rejected',
    )!;
    assert.ok(precedent.content.includes('Rejected suggestion'));
    assert.equal(
      precedent.status,
      'Pending',
      'A recorded decision is a candidate, not yet guidance.',
    );
    chat = await call<ChatMessage[]>('/chat', 'POST', {
      message: 'ORCHID wireless sensors corrected permit exemption',
      skillId: 'electronics',
    });
    assert.ok(!chat.at(-1)!.citations.some((citation) => citation.id === precedent.id));
    await call(`/knowledge/${precedent.id}/publish`, 'POST', {}, 403);
    await call('/session', 'POST', { userId: 'manager-daniel' });
    await call(`/knowledge/${precedent.id}/publish`, 'POST', {});
    await call('/session', 'POST', { userId: manager.id });
    chat = await call<ChatMessage[]>('/chat', 'POST', {
      message: 'ORCHID wireless sensors corrected permit exemption',
      skillId: 'electronics',
    });
    assert.ok(chat.at(-1)!.citations.some((citation) => citation.id === precedent.id));
    assert.match(chat.at(-1)!.content, /rejected|rejection/i);
    assert.ok(chat.at(-1)!.citations.some((citation) => citation.id === imported.id));
    const self = await call<CaseRecord>(
      '/cases',
      'POST',
      {
        ...input,
        title: 'ORCHID wireless sensor permit exemption',
        content: `${input.content} ORCHID exemption corrected permit evidence.`,
      },
      201,
    );
    const laterReview = await call<CaseRecord>(`/cases/${self.id}/review`, 'POST', {});
    assert.ok(
      laterReview.review!.suggestions.some((suggestion) =>
        suggestion.citations.some((ref) => ref.id === precedent.id),
      ),
    );
    await call(`/cases/${self.id}/submit`, 'POST', {});
    await call(`/cases/${self.id}/decision`, 'POST', { decision: 'approved' }, 403);
    await call('/cases', 'POST', { ...input, jurisdiction: 'Taiwan' }, 400);
    await call('/cases', 'POST', { ...input, permitExpiry: '2026-02-31' }, 400);
    const persistedCount = state.knowledge.length;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    service.close();
    const restarted = createApp({ dbPath, demoMode: true });
    assert.equal(
      restarted.store.read().cases.find((entry) => entry.id === item.id)!.status,
      'Approved',
    );
    assert.ok(restarted.store.read().knowledge.length >= persistedCount);
    restarted.close();
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    service.close();
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(folder.includes('instill-api-'));
    rmSync(folder, { recursive: true, force: true });
  }
});

function pdfFixture(text: string): Uint8Array {
  const stream = text ? `BT /F1 12 Tf 50 700 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(body));
}

test('PDF import extracts text, unreadable files are rejected, and new skills require publication', async () => {
  const service = createApp({ dbPath: ':memory:', demoMode: true });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const skillResponse = await fetch(`${base}/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cold-chain handoff',
        category: 'Food & produce',
        description: 'Internal receiving requirements.',
      }),
    });
    assert.equal(skillResponse.status, 201);
    const skill = (await skillResponse.json()) as { id: string; status: string };
    assert.equal(skill.status, 'Draft');
    const upload = async (name: string, content: Uint8Array | string, expected: number) => {
      const form = new FormData();
      form.set('title', name);
      form.set('skillId', skill.id);
      form.set('file', new Blob([content as BlobPart]), name);
      const response = await fetch(`${base}/knowledge/import`, { method: 'POST', body: form });
      const body = await response.json();
      assert.equal(response.status, expected, JSON.stringify(body));
      return body as Knowledge & { error?: string };
    };
    const imported = await upload(
      'receiving.pdf',
      pdfFixture('Confirm cold-chain receiving contact before promising delivery.'),
      201,
    );
    assert.match(imported.content, /cold-chain receiving contact/);
    assert.equal(imported.status, 'Pending');
    // Minimal independent Office Open XML fixture: one paragraph, no executable content.
    const docx = Buffer.from(
      'UEsDBAoAAAAIAJRzTl1Rl+gEsQAAABQBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvQ7CMAyEX6XKilpXDAyo7QKswMALWInbRjQ/StxS3p4UUAcGRvu7O59c3Z6eYjabwcZa9Mx+DxBlTwZj4TzZRFoXDHIaQwce5R07gm1Z7kA6y2Q55yVDNNWRWhwHzk5zWkftbC2SXWSHj245VQv0ftASOWFYKDTVZaIQtKLsioHPaJIKHi4oUE6OJjmL/zGTVT9dc9e2WtLqX9J8cJJi1LYzQ7ESg9puvj3g/YzmBVBLAwQKAAAAAACUc05dAAAAAAAAAAAAAAAABgAAAF9yZWxzL1BLAwQKAAAACACUc05dYXsvQ4kAAADyAAAACwAAAF9yZWxzLy5yZWxzjc87DgIhEAbgqxAOsLNaWBigstnWeAECwyMujwwY9fZSWKzGwnLmn3x/Rpxx1T2W3EKsjT3Smpvkofd6BGgmYNJtKhXzSFyhpPsYyUPV5qo9wn6eD0BbgyuxNdliJafF7ji7PCv+YxfnosFTMbeEuf+o+LoYsiaPXfJ7IQv2vZ4Gy0EJ+HhRvQBQSwMECgAAAAAAlHNOXQAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACACUc05dltfB25kAAADTAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1sRY8xDsMgDEWvgnKAUHXogNIsPUJPQMBJkGKMjBOa2xfSocuz/rf9LQ/FeHI7QhT1wS1mU57dKpKM1tmtgDb3lCDW3kyMVqrkRRdin5gc5Bzigpu+324PjTbEbhyKmcifraYGbpDxRXEOjIrBQTjqlnIUxTpRE9RoUB62cACfqir1rgM2NdvtWQiB+0G3mEa+mC7+Tun/G+MXUEsBAhQACgAAAAgAlHNOXVGX6ASxAAAAFAEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAAAACUc05dAAAAAAAAAAAAAAAABgAAAAAAAAAAABAAAADiAAAAX3JlbHMvUEsBAhQACgAAAAgAlHNOXWF7L0OJAAAA8gAAAAsAAAAAAAAAAAAAAAAABgEAAF9yZWxzLy5yZWxzUEsBAhQACgAAAAAAlHNOXQAAAAAAAAAAAAAAAAUAAAAAAAAAAAAQAAAAuAEAAHdvcmQvUEsBAhQACgAAAAgAlHNOXZbXwduZAAAA0wAAABEAAAAAAAAAAAAAAAAA2wEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAAFAAUAIAEAAKMCAAAAAA==',
      'base64',
    );
    const docxImport = await upload('receiving.docx', new Uint8Array(docx), 201);
    assert.match(docxImport.content, /Singapore customer/);
    const unreadable = await upload('scanned.pdf', pdfFixture(''), 400);
    assert.match(unreadable.error!, /OCR/);
    await upload('broken.docx', 'This is not a valid DOCX file.', 400);
    await upload('script.exe', 'This is executable input.', 400);
    const tooLarge = await upload('large.txt', new Uint8Array(10 * 1024 * 1024 + 1), 400);
    assert.match(tooLarge.error!, /10 MB/);
    const own = await fetch(`${base}/knowledge/${imported.id}/publish`, { method: 'POST' });
    assert.equal(own.status, 403, 'The person who imported a document cannot approve it.');
    const session = await fetch(`${base}/state`);
    const cookie = session.headers.get('set-cookie')!.split(';')[0];
    await fetch(`${base}/session`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'manager-daniel' }),
    });
    const published = await fetch(`${base}/knowledge/${imported.id}/publish`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(published.status, 200);
    const state = (await (await fetch(`${base}/state`)).json()) as AppState;
    assert.equal(state.skills.find((entry) => entry.id === skill.id)!.status, 'Active');
    const response = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: JSON.stringify({ message: 'Read my internal documents.' }),
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    service.close();
  }
});

test('production identity is fixed, role switching disabled, and credentials required', async () => {
  assert.throws(
    () => createApp({ dbPath: ':memory:', demoMode: false, accessPassword: '' }),
    /password/i,
  );
  const service = createApp({
    dbPath: ':memory:',
    demoMode: false,
    accessPassword: 'test-password-for-runtime',
  });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    const auth = `Basic ${Buffer.from('instill:test-password-for-runtime').toString('base64')}`;
    const response = await fetch(`${base}/api/state`, { headers: { Authorization: auth } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    assert.equal(
      (
        await fetch(`${base}/api/session`, {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'employee-amir' }),
        })
      ).status,
      403,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    service.close();
  }
});

test('optional AI adapter preserves deterministic checks, grounds references and falls back honestly', async () => {
  let failProvider = false;
  let invalidCitation = false;
  const provider = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    if (failProvider) {
      response.writeHead(503);
      response.end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    assert.equal(payload.model, 'test-grounded-model');
    assert.match(payload.messages[0].content, /untrusted data/);
    const review = payload.messages[0].content.includes('Return JSON only');
    const content = review
      ? JSON.stringify({
          summary: 'Check the wireless equipment scope.',
          suggestions: [
            {
              title: 'Confirm radio specifications',
              detail: 'Wireless scope needs product evidence.',
              action: 'Obtain specifications.',
              severity: 'warning',
              sourceIds: ['kb-imda'],
            },
            {
              title: 'Uncited claim',
              detail: 'Invented requirement.',
              action: 'Invented action.',
              severity: 'critical',
              sourceIds: ['nonexistent-source'],
            },
          ],
        })
      : invalidCitation
        ? 'You must follow an invented rule [nonexistent-source].'
        : 'Check the applicable IMDA route for wireless equipment [kb-imda].';
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  }).listen(0, '127.0.0.1');
  await new Promise<void>((done) => provider.once('listening', done));
  const service = createApp({
    dbPath: ':memory:',
    demoMode: true,
    now: () => new Date('2026-10-14T03:00:00Z'),
    ai: {
      baseUrl: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`,
      apiKey: 'fictional-test-key',
      model: 'test-grounded-model',
    },
  });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok);
    return response.json();
  };
  try {
    const created = (await post('/cases', input)) as CaseRecord;
    const reviewed = (await post(`/cases/${created.id}/review`, {})) as CaseRecord;
    assert.equal(reviewed.review!.mode, 'live');
    assert.ok(
      reviewed.review!.suggestions.some(
        (suggestion) => suggestion.title === 'Confirm radio specifications',
      ),
    );
    assert.ok(
      reviewed.review!.suggestions.some((suggestion) => suggestion.title.includes('expired')),
    );
    assert.ok(
      !reviewed.review!.suggestions.some((suggestion) => suggestion.title === 'Uncited claim'),
    );
    const liveChat = (await post('/chat', {
      message: 'Wireless sensors IMDA route',
    })) as ChatMessage[];
    assert.equal(liveChat.at(-1)!.mode, 'live');
    assert.deepEqual(
      liveChat.at(-1)!.citations.map((reference) => reference.id),
      ['kb-imda'],
    );
    invalidCitation = true;
    const unsupported = (await post('/chat', {
      message: 'Wireless sensors IMDA route',
    })) as ChatMessage[];
    assert.equal(unsupported.at(-1)!.mode, 'local');
    assert.ok(!unsupported.at(-1)!.content.includes('invented rule'));
    assert.ok(
      !unsupported.at(-1)!.citations.some((reference) => reference.id === 'nonexistent-source'),
    );
    invalidCitation = false;
    failProvider = true;
    const localChat = (await post('/chat', {
      message: 'Wireless sensors IMDA route',
    })) as ChatMessage[];
    assert.equal(localChat.at(-1)!.mode, 'local');
    assert.match(localChat.at(-1)!.content, /unavailable/);
    const fallbackReview = (await post(`/cases/${created.id}/review`, {})) as CaseRecord;
    assert.equal(fallbackReview.review!.mode, 'local');
    assert.match(fallbackReview.review!.summary, /fallback/);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await new Promise<void>((done) => provider.close(() => done()));
    service.close();
  }
});

test('chat abstains outside scope and transcripts belong to the signed-in user', async () => {
  const service = createApp({ dbPath: ':memory:', demoMode: true });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = '';
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie')!.split(';')[0];
    assert.ok(response.ok);
    return response.json() as Promise<T>;
  };
  try {
    await call('/state');
    await call('/session', { userId: 'employee-amir' });
    const personal = await call<ChatMessage[]>('/chat', {
      message: 'My wireless sensor importer needs an IMDA scope check.',
    });
    const employeeState = await call<AppState>('/state');
    assert.ok(employeeState.chats.some((entry) => entry.id === personal[0].id));
    await call('/session', { userId: 'employee-chloe' });
    const otherState = await call<AppState>('/state');
    assert.ok(!otherState.chats.some((entry) => entry.id === personal[0].id));
    await call('/session', { userId: 'employee-amir' });
    assert.ok((await call<AppState>('/state')).chats.some((entry) => entry.id === personal[0].id));
    const unrelated = await call<ChatMessage[]>('/chat', {
      message: 'Explain quantum entanglement in a vacuum.',
    });
    assert.deepEqual(unrelated.at(-1)!.citations, []);
    assert.deepEqual(unrelated.at(-1)!.skillNames, []);
    const mismatched = await call<ChatMessage[]>('/chat', {
      message: 'How do I bake sourdough bread?',
      skillId: 'electronics',
    });
    assert.deepEqual(mismatched.at(-1)!.citations, []);
    const general = await call<ChatMessage[]>('/chat', {
      message: 'What documents do I need for Singapore import clearance?',
    });
    assert.ok(general.at(-1)!.citations.length > 0);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    service.close();
  }
});
