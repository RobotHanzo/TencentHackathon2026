import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createApp, type AppOptions } from '../server/app.ts';
import type { KnowledgeClient } from '../server/knowledge-sync.ts';
import type {
  AppState,
  CaseRecord,
  ChatMessage,
  IntegrationState,
  Knowledge,
} from '../shared/types.ts';

type AdpRequest = {
  AppKey: string;
  VisitorId: string;
  ConversationId: string;
  Contents: { Type: string; Text: string }[];
};
const now = () => new Date('2026-10-15T03:00:00Z');
const closeServer = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
};
const sse = (text: string, documentId?: string) => {
  const content = {
    Type: 'text',
    Text: text,
    ...(documentId
      ? {
          References: [{ Index: 1, DocRefer: { DocId: documentId } }],
          QuoteInfos: [{ Index: 1, Position: text.length }],
        }
      : {}),
  };
  return `event: response.completed\ndata: ${JSON.stringify({
    Type: 'response.completed',
    Response: {
      Role: 'assistant',
      Status: 'success',
      Messages: [{ MessageId: 'answer', Type: 'reply', Status: 'success', Contents: [content] }],
    },
  })}\n\nevent: done\ndata: [DONE]\n\n`;
};

async function fakeAdp() {
  const requests: AdpRequest[] = [];
  const control = { failure: false, documentId: '', invalidCitation: false };
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    const sent = JSON.parse(body) as AdpRequest;
    requests.push(sent);
    response.setHeader('Content-Type', 'text/event-stream');
    if (control.failure) {
      response.end(
        'event: error\ndata: {"Type":"error","Error":{"Message":"fictional-private-app-key upstream failure"}}\n\n',
      );
      return;
    }
    const context = JSON.parse(sent.Contents[0].Text) as { approvedKnowledge?: Knowledge[] };
    const sourceId = control.invalidCitation
      ? 'invented-source'
      : context.approvedKnowledge?.[0]?.id;
    response.end(
      control.documentId
        ? sse('Confirm the approved import handling guidance [1].', control.documentId)
        : sse(`Confirm the relevant Singapore requirements [${sourceId ?? 'missing-source'}].`),
    );
  }).listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  return {
    requests,
    control,
    ai: {
      provider: 'adp' as const,
      adpAppKey: 'fictional-private-app-key',
      adpEndpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/adp/v2/chat`,
    },
    close: () => closeServer(server),
  };
}

async function application(options: AppOptions = {}) {
  const service = createApp({
    dbPath: ':memory:',
    demoMode: true,
    ai: { provider: 'local' },
    now,
    ...options,
  });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = '';
  let setCookie = '';
  return {
    ...service,
    get setCookie() {
      return setCookie;
    },
    async call<T>(path: string, body?: unknown, expected = 200): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Cookie: cookie,
          ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        },
        body:
          body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie')) {
        setCookie = response.headers.get('set-cookie')!;
        cookie = setCookie.split(';')[0];
      }
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      return result as T;
    },
    close: async () => {
      await closeServer(server);
      service.close();
    },
  };
}

test('ADP connection is configured until an actual grounded request, with manager-only integration controls and Secure cookies', async () => {
  const adp = await fakeAdp();
  const app = await application({ ai: adp.ai, cookieSecure: true });
  try {
    const initial = await app.call<AppState>('/state');
    assert.equal(initial.integrations?.connection, 'configured');
    assert.equal(initial.integrations?.checkedAt, undefined);
    assert.equal(adp.requests.length, 0);
    assert.match(app.setCookie, /; Secure(?:;|$)/);
    assert.match(app.setCookie, /; HttpOnly(?:;|$)/);
    assert.match(app.setCookie, /; SameSite=Strict(?:;|$)/);
    await app.call('/session', { userId: 'employee-amir' });
    await app.call('/integrations/check', {}, 403);
    await app.call('/integrations/knowledge', undefined, 403);
    await app.call('/integrations/knowledge/retry', {}, 403);
    assert.equal(adp.requests.length, 0, 'Denied requests must not invoke the provider.');
    await app.call('/session', { userId: 'manager-sarah' });
    const checked = await app.call<IntegrationState>('/integrations/check', {});
    assert.equal(checked.connection, 'verified');
    assert.equal(checked.checkedAt, now().toISOString());
    assert.equal(adp.requests.length, 1);
    assert.equal(
      (await app.call<AppState>('/state')).chats.length,
      initial.chats.length,
      'Connection checks do not create employee chat messages.',
    );
    const chat = await app.call<ChatMessage[]>('/chat', {
      message: 'Wireless sensor IMDA import checks',
      skillId: 'electronics',
    });
    assert.equal(chat[1].mode, 'live');
    assert.ok(chat[1].citations.length > 0);
    assert.ok(
      chat[1].citations.every((ref) =>
        initial.knowledge.some((item) => item.id === ref.id && item.status === 'Approved'),
      ),
    );
    adp.control.failure = true;
    const fallback = await app.call<ChatMessage[]>('/chat', {
      message: 'Wireless sensor IMDA import checks',
      skillId: 'electronics',
    });
    assert.equal(fallback[1].mode, 'local');
    assert.match(fallback[1].content, /unavailable|local approved-knowledge/);
    const failedState = await app.call<AppState>('/state');
    assert.equal(failedState.integrations?.connection, 'error');
    assert.ok(!JSON.stringify(failedState).includes('fictional-private-app-key'));
    const failedCheck = await app.call<IntegrationState & { error: string }>(
      '/integrations/check',
      {},
      502,
    );
    assert.equal(failedCheck.connection, 'error');
    assert.ok(!failedCheck.error.includes('fictional-private-app-key'));
    adp.control.failure = false;
    adp.control.invalidCitation = true;
    await app.call('/integrations/check', {}, 502);
    adp.control.invalidCitation = false;
    assert.equal(
      (await app.call<IntegrationState>('/integrations/check', {})).connection,
      'verified',
    );
  } finally {
    await app.close();
    await adp.close();
  }
});

test('ADP conversations persist while remaining isolated by user and skill and absent from public state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'instill-adp-context-'));
  const dbPath = join(directory, 'context.db');
  const adp = await fakeAdp();
  let app: Awaited<ReturnType<typeof application>> | undefined;
  try {
    app = await application({ dbPath, ai: adp.ai });
    await app.call('/session', { userId: 'employee-amir' });
    const first = await app.call<ChatMessage[]>('/chat', {
      message: 'Wireless sensor scope AMIR PRIVATE',
      skillId: 'electronics',
    });
    await app.call('/chat', {
      message: 'Wireless sensor specifications follow-up',
      skillId: 'electronics',
    });
    await app.call('/chat', {
      message: 'Wireless car remote control import',
      skillId: 'automotive',
    });
    assert.equal(adp.requests[0].ConversationId, adp.requests[1].ConversationId);
    assert.notEqual(adp.requests[0].ConversationId, adp.requests[2].ConversationId);
    assert.equal(adp.requests[0].VisitorId, adp.requests[2].VisitorId);
    await app.call('/session', { userId: 'employee-chloe' });
    await app.call('/chat', {
      message: 'Wireless sensor scope CHLOE PRIVATE',
      skillId: 'electronics',
    });
    assert.notEqual(adp.requests[0].ConversationId, adp.requests[3].ConversationId);
    assert.notEqual(adp.requests[0].VisitorId, adp.requests[3].VisitorId);
    const state = await app.call<AppState>('/state');
    assert.ok(!state.chats.some((entry) => entry.id === first[0].id));
    for (const key of ['agentConversations', 'chatOwners', 'knowledgeSync'])
      assert.ok(!(key in state));
    assert.ok(!JSON.stringify(state).includes(adp.requests[0].ConversationId));
    assert.ok(!JSON.stringify(state).includes(adp.requests[0].VisitorId));
    assert.ok(Object.keys(app.store.read().agentConversations ?? {}).length >= 3);
    await app.close();
    app = undefined;
    app = await application({ dbPath, ai: adp.ai });
    await app.call('/session', { userId: 'employee-amir' });
    await app.call('/chat', {
      message: 'Wireless sensor import after restart',
      skillId: 'electronics',
    });
    assert.equal(adp.requests[4].ConversationId, adp.requests[0].ConversationId);
    assert.equal(adp.requests[4].VisitorId, adp.requests[0].VisitorId);
    assert.ok((await app.call<AppState>('/state')).chats.some((entry) => entry.id === first[0].id));
  } finally {
    await app?.close();
    await adp.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes('instill-adp-context-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Knowledge API queues only manager-approved documents and decision rationale, then maps synchronized ADP citations', async () => {
  const uploaded: Knowledge[] = [];
  const client: KnowledgeClient = {
    putDocument: async (item) => {
      uploaded.push(structuredClone(item));
      return { docId: `remote-${item.id}` };
    },
    getDocument: async () => ({ status: 'published' }),
    createRelease: async () => {
      assert.fail('Automatic publication was not enabled.');
    },
    getRelease: async () => {
      assert.fail('No release should be created.');
    },
  };
  const adp = await fakeAdp();
  const app = await application({
    ai: adp.ai,
    knowledge: { client, target: 'test-app', start: false },
  });
  try {
    await app.call('/session', { userId: 'employee-amir' });
    const form = new FormData();
    form.set('title', 'ZEPHYR handling note');
    form.set('skillId', 'electronics');
    form.set(
      'content',
      'Confirm ZEPHYR sensor radio specifications with the importer before selecting a Singapore IMDA route.',
    );
    const imported = await app.call<Knowledge>('/knowledge/import', form, 201);
    assert.equal(imported.status, 'Pending');
    assert.equal(app.store.read().knowledgeSync?.[imported.id], undefined);
    assert.equal(uploaded.length, 0, 'start:false prevents automatic remote calls.');
    await app.call(`/knowledge/${imported.id}/publish`, {}, 403);
    assert.equal(app.store.read().knowledgeSync?.[imported.id], undefined);
    await app.call('/session', { userId: 'manager-sarah' });
    await app.call(`/knowledge/${imported.id}/publish`, {});
    assert.equal(app.store.read().knowledgeSync?.[imported.id].status, 'pending');
    const state = await app.call<AppState>('/state');
    assert.equal(state.knowledge.find((item) => item.id === imported.id)?.adpStatus, 'pending');
    const review = state.cases.find(
      (item) =>
        item.status === 'In review' &&
        item.review?.suggestions.some((suggestion) => suggestion.decision === 'pending'),
    )!;
    const suggestion = review.review!.suggestions.find((item) => item.decision === 'pending')!;
    await app.call(
      `/cases/${review.id}/suggestions/${suggestion.id}`,
      { decision: 'rejected', comment: '' },
      400,
    );
    const rationale =
      'ZEPHYR exemption requires case-specific evidence; the suggested automatic waiver is not approved.';
    await app.call<CaseRecord>(`/cases/${review.id}/suggestions/${suggestion.id}`, {
      decision: 'rejected',
      comment: rationale,
    });
    const decision = app.store
      .read()
      .knowledge.find(
        (item) =>
          item.caseId === review.id &&
          item.decision === 'rejected' &&
          item.content.includes(rationale),
      )!;
    assert.ok(decision);
    assert.equal(app.store.read().knowledgeSync?.[decision.id].status, 'pending');
    const jobs = Object.keys(app.store.read().knowledgeSync ?? {}).length;
    for (let i = 0; i < jobs * 2; i++) await app.knowledgeSync!.tick();
    assert.equal(app.knowledgeSync!.summary().synced, jobs);
    assert.equal(uploaded.filter((item) => item.id === imported.id).length, 1);
    const publishedDecision = uploaded.find((item) => item.id === decision.id)!;
    assert.equal(publishedDecision.decision, 'rejected');
    assert.match(publishedDecision.content, /do not treat this as an approved requirement/);
    assert.ok(publishedDecision.content.includes(rationale));
    adp.control.documentId = `remote-${imported.id}`;
    const answer = await app.call<ChatMessage[]>('/chat', {
      message: 'Unrecognized ZXQVM product',
    });
    assert.equal(answer[1].mode, 'live');
    assert.deepEqual(
      answer[1].citations.map((ref) => ref.id),
      [imported.id],
    );
    assert.match(answer[1].content, new RegExp(`\\[${imported.id}\\]`));
  } finally {
    await app.close();
    await adp.close();
  }
});

test('Original uploads reach storage before pending knowledge is persisted; storage failures are atomic and sanitized', async () => {
  let fail = false;
  let calls = 0;
  let app: Awaited<ReturnType<typeof application>>;
  app = await application({
    originals: {
      put: async (id, extension, bytes) => {
        calls++;
        assert.ok(!app.store.read().knowledge.some((item) => item.id === id));
        assert.equal(extension, '.txt');
        assert.equal(
          bytes.toString(),
          'Confirm the Singapore importer and shipment evidence before release.',
        );
        if (fail) throw new Error('fictional-storage-secret and private provider details');
        return { storage: 'cos' as const, key: `originals/${id}/source.txt`, size: bytes.length };
      },
    },
  });
  const form = () => {
    const body = new FormData();
    body.set('title', 'Original document');
    body.set('skillId', 'general');
    body.set(
      'file',
      new Blob(['Confirm the Singapore importer and shipment evidence before release.'], {
        type: 'text/plain',
      }),
      'source.TXT',
    );
    return body;
  };
  try {
    const imported = await app.call<Knowledge>('/knowledge/import', form(), 201);
    assert.equal(imported.status, 'Pending');
    assert.equal(imported.original?.storage, 'cos');
    assert.equal(calls, 1);
    const before = app.store.read();
    fail = true;
    const rejected = await app.call<{ error: string }>('/knowledge/import', form(), 503);
    assert.match(rejected.error, /storage is unavailable/);
    assert.ok(!rejected.error.includes('fictional-storage-secret'));
    assert.equal(calls, 2);
    const after = app.store.read();
    assert.equal(after.knowledge.length, before.knowledge.length);
    assert.equal(after.activity.length, before.activity.length);
    assert.ok(!JSON.stringify(after).includes('fictional-storage-secret'));
  } finally {
    await app.close();
  }
});
