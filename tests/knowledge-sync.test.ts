import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { Knowledge } from '../shared/types.ts';
import { KnowledgeSync, type KnowledgeClient } from '../server/knowledge-sync.ts';
import { Store } from '../server/store.ts';

const approved: Knowledge = {
  id: 'knowledge-approved',
  title: 'Wireless checks',
  content: 'Retain supporting IMDA evidence.',
  category: 'Electronics',
  jurisdiction: 'Singapore',
  skillId: 'electronics',
  sourceType: 'Document',
  sourceName: 'Internal SOP.md',
  status: 'Approved',
  createdAt: '2026-10-15T00:00:00.000Z',
  author: 'Sarah Tan',
  tags: ['IMDA'],
};
const target = 'ap-jakarta:app-123';
class FakeClient implements KnowledgeClient {
  calls: string[] = [];
  documents = new Map<string, 'processing' | 'ready' | 'published' | 'failed'>();
  releaseStatus: 'processing' | 'published' | 'failed' = 'processing';
  upload?: (item: Knowledge) => Promise<{ docId: string }>;
  async putDocument(item: Knowledge) {
    this.calls.push(`put:${item.id}`);
    return this.upload ? this.upload(item) : { docId: `remote-${item.id}` };
  }
  async getDocument(id: string) {
    this.calls.push(`document:${id}`);
    return { status: this.documents.get(id) ?? ('ready' as const) };
  }
  async createRelease() {
    this.calls.push('release:create');
    return { releaseId: 'release-123' };
  }
  async getRelease(id: string) {
    this.calls.push(`release:${id}`);
    return { status: this.releaseStatus };
  }
}
function fixture(t: TestContext, items: Knowledge[] = [approved], autoPublish = false) {
  const directory = mkdtempSync(join(tmpdir(), 'clearport-sync-'));
  const path = join(directory, 'workspace.db');
  let time = new Date('2026-10-15T01:00:00.000Z');
  let store = new Store(path, time);
  store.mutate((workspace) => {
    workspace.knowledge = structuredClone(items);
    workspace.knowledgeSync = {};
  });
  const client = new FakeClient();
  let worker = new KnowledgeSync(store, client, target, autoPublish, () => time);
  const enqueue = () => store.mutate((workspace) => worker.enqueue(workspace));
  enqueue();
  t.after(() => {
    worker.stop();
    store.close();
    const child = relative(resolve(tmpdir()), resolve(directory));
    assert.ok(
      !isAbsolute(child) && !child.startsWith('..') && /^clearport-sync-[^\\/]+$/.test(child),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    get worker() {
      return worker;
    },
    client,
    enqueue,
    job: (id = approved.id) => store.read().knowledgeSync![id],
    advance: (ms = 5000) => {
      time = new Date(time.getTime() + ms);
    },
    setTime: (iso: string) => {
      time = new Date(iso);
    },
    restart: () => {
      worker.stop();
      store.close();
      store = new Store(path, time);
      worker = new KnowledgeSync(store, client, target, autoPublish, () => time);
      enqueue();
    },
  };
}

test('queues only approved knowledge, including rejected advice as a recorded management decision', async (t) => {
  const rejected: Knowledge = {
    ...approved,
    id: 'decision-rejected',
    sourceType: 'Decision',
    decision: 'rejected',
    caseId: 'case-1',
  };
  const pending = { ...approved, id: 'knowledge-pending', status: 'Pending' as const };
  const h = fixture(t, [approved, rejected, pending]);
  const before = h.store.read().knowledgeSync;
  h.enqueue();
  assert.deepEqual(h.store.read().knowledgeSync, before);
  assert.deepEqual(Object.keys(before!).sort(), ['decision-rejected', 'knowledge-approved']);
  for (let i = 0; i < 4; i++) await h.worker.tick();
  assert.equal(h.client.calls.filter((call) => call.startsWith('put:')).length, 2);
  assert.ok(!h.client.calls.some((call) => call.includes('knowledge-pending')));
  assert.equal(h.worker.summary().ready, 2);
});

test('resumes an imported document from SQLite after restart without uploading it again', async (t) => {
  const h = fixture(t);
  await h.worker.tick();
  assert.equal(h.job().status, 'indexing');
  assert.equal(h.job().documentId, 'remote-knowledge-approved');
  h.restart();
  h.client.documents.set('remote-knowledge-approved', 'published');
  await h.worker.tick();
  assert.equal(h.job().status, 'synced');
  assert.deepEqual(h.worker.documentMap(), { 'remote-knowledge-approved': approved.id });
  assert.deepEqual(h.client.calls, [
    'put:knowledge-approved',
    'document:remote-knowledge-approved',
  ]);
});

test('manual publication is the default and publication is detected without creating an app release', async (t) => {
  const h = fixture(t);
  await h.worker.tick();
  await h.worker.tick();
  assert.equal(h.job().status, 'ready');
  assert.deepEqual(h.worker.documentMap(), {});
  h.advance();
  await h.worker.tick();
  assert.equal(h.job().status, 'ready');
  assert.equal(h.worker.summary().autoPublish, false);
  h.client.documents.set('remote-knowledge-approved', 'published');
  h.advance(30_000);
  await h.worker.tick();
  assert.equal(h.job().status, 'synced');
  assert.ok(!h.client.calls.includes('release:create'));
});

test('manual polling returns a ready document to indexing when Tencent resumes processing', async (t) => {
  const h = fixture(t);
  await h.worker.tick();
  await h.worker.tick();
  assert.equal(h.job().status, 'ready');
  h.client.documents.set('remote-knowledge-approved', 'processing');
  h.advance();
  await h.worker.tick();
  assert.equal(h.job().status, 'indexing');
  assert.equal(h.worker.summary().ready, 0);
  assert.deepEqual(h.worker.documentMap(), {});
  assert.ok(!h.client.calls.includes('release:create'));
  h.client.documents.set('remote-knowledge-approved', 'published');
  h.advance(30_000);
  await h.worker.tick();
  assert.equal(h.job().status, 'synced');
  assert.equal(h.client.calls.filter((call) => call.startsWith('put:')).length, 1);
});

test('explicit auto-publish persists a shared release and verifies every document after release success', async (t) => {
  const second = { ...approved, id: 'knowledge-second', title: 'Second approved source' };
  const h = fixture(t, [approved, second], true);
  for (let i = 0; i < 4; i++) await h.worker.tick();
  assert.equal(h.worker.summary().ready, 2);
  await h.worker.tick();
  assert.equal(h.job().status, 'publishing');
  assert.equal(h.job().releaseId, 'release-123');
  assert.equal(h.job(second.id).releaseId, 'release-123');
  h.restart();
  h.client.releaseStatus = 'published';
  h.advance();
  await h.worker.tick();
  assert.deepEqual(h.worker.documentMap(), {});
  assert.equal(h.job().status, 'indexing');
  h.client.documents.set('remote-knowledge-approved', 'processing');
  h.client.documents.set('remote-knowledge-second', 'published');
  h.advance();
  await h.worker.tick();
  await h.worker.tick();
  assert.deepEqual(h.worker.documentMap(), { 'remote-knowledge-second': second.id });
  h.client.documents.set('remote-knowledge-approved', 'published');
  h.advance();
  await h.worker.tick();
  assert.equal(h.worker.summary().synced, 2);
  assert.equal(h.client.calls.filter((call) => call === 'release:create').length, 1);
  assert.equal(h.client.calls.filter((call) => call.startsWith('put:')).length, 2);
});

test('failed requests use bounded retries and persist sanitized errors before an explicit retry', async (t) => {
  const h = fixture(t);
  h.client.upload = async () => {
    throw new Error('SecretId=AKIDPRIVATE SecretKey=PRIVATE customer email body');
  };
  await h.worker.tick();
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.equal(h.job().attempts, attempt);
    assert.equal(h.job().status, 'failed');
    assert.ok(!JSON.stringify(h.job()).includes('PRIVATE'));
    assert.ok(!JSON.stringify(h.job()).includes('customer email body'));
    const count = h.client.calls.length;
    await h.worker.tick();
    assert.equal(h.client.calls.length, count, 'backoff prevents immediate retries');
    if (attempt < 5) {
      h.setTime(h.job().nextAttemptAt!);
      await h.worker.tick();
    }
  }
  h.advance(1_000_000);
  await h.worker.tick();
  assert.equal(h.client.calls.length, 5, 'automatic retries stop after five failures');
  h.client.upload = undefined;
  h.worker.retry();
  assert.equal(h.job().attempts, 0);
  assert.equal(h.job().error, undefined);
  await h.worker.tick();
  assert.equal(h.job().status, 'indexing');
  h.worker.stop();
});

test('application release failures stop after five attempts despite intervening ready-document polls', async (t) => {
  for (const failure of ['request rejected', 'release failed'] as const) {
    await t.test(failure, async (child) => {
      const h = fixture(child, [approved], true);
      if (failure === 'request rejected') {
        h.client.createRelease = async () => {
          h.client.calls.push('release:create');
          throw new Error('Provider release permission denied');
        };
      } else {
        h.client.releaseStatus = 'failed';
      }
      for (let i = 0; i < 35; i++) {
        await h.worker.tick();
        h.advance(301_000);
      }
      assert.equal(h.client.calls.filter((call) => call === 'release:create').length, 5);
      assert.equal(h.job().status, 'failed');
      assert.equal(h.job().attempts, 5);
      assert.equal(h.client.calls.filter((call) => call.startsWith('put:')).length, 1);
      assert.deepEqual(h.worker.documentMap(), {});
      assert.equal(h.worker.summary().synced, 0);
    });
  }
});

test('stopping an in-flight upload prevents late SQLite writes and further remote calls', async (t) => {
  const h = fixture(t);
  let finish!: (value: { docId: string }) => void;
  h.client.upload = () =>
    new Promise((resolveUpload) => {
      finish = resolveUpload;
    });
  const running = h.worker.tick();
  assert.equal(h.client.calls.length, 1);
  h.worker.stop();
  h.store.close();
  finish({ docId: 'late-document' });
  await assert.doesNotReject(running);
  await h.worker.tick();
  assert.equal(h.client.calls.length, 1);
  h.restart();
  assert.equal(h.job().status, 'pending');
  assert.equal(h.job().documentId, undefined);
});

test('a delayed upload cannot replace a newly queued revision with the old remote document ID', async (t) => {
  const h = fixture(t);
  let finish!: (value: { docId: string }) => void;
  h.client.upload = () =>
    new Promise((resolveUpload) => {
      finish = resolveUpload;
    });
  const oldFingerprint = h.job().fingerprint;
  const running = h.worker.tick();
  h.store.mutate((workspace) => {
    workspace.knowledge[0].content = 'A newly approved version with different evidence.';
    h.worker.enqueue(workspace);
  });
  assert.notEqual(h.job().fingerprint, oldFingerprint);
  finish({ docId: 'old-document' });
  await running;
  assert.equal(
    h.job().documentId,
    undefined,
    'new revision must not inherit old document identity',
  );
  assert.equal(h.job().status, 'pending');
});

test('changes to approved provenance create a new snapshot instead of reusing a stale published record', async (t) => {
  const h = fixture(t);
  h.client.documents.set('remote-knowledge-approved', 'published');
  await h.worker.tick();
  await h.worker.tick();
  const before = h.job().fingerprint;
  h.store.mutate((workspace) => {
    workspace.knowledge[0].author = 'Daniel Wong';
    workspace.knowledge[0].tags = ['IMDA', 'updated provenance'];
    h.worker.enqueue(workspace);
  });
  assert.notEqual(h.job().fingerprint, before, 'remote snapshot includes author and tags');
  assert.equal(h.job().status, 'pending');
  assert.equal(h.job().documentId, undefined);
  assert.deepEqual(h.worker.documentMap(), {});
});

test('auto-publication revalidates approval rather than publishing a ready record that lost approval', async (t) => {
  const h = fixture(t, [approved], true);
  await h.worker.tick();
  await h.worker.tick();
  assert.equal(h.job().status, 'ready');
  h.store.mutate((workspace) => {
    workspace.knowledge[0].status = 'Pending';
  });
  await h.worker.tick();
  assert.ok(
    !h.client.calls.includes('release:create'),
    'unapproved record must not trigger app-wide publication',
  );
  assert.equal(h.job().status, 'failed');
  assert.deepEqual(h.worker.documentMap(), {});
});
