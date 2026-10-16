import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';
import type { AppState, CaseInput, CaseRecord, Comment, CommentAnchor } from '../shared/types.ts';

const input: CaseInput = {
  title: 'Singapore shipment text annotations',
  customer: 'Fictional importer',
  category: 'General cargo',
  jurisdiction: 'Singapore',
  documentType: 'Customer email',
  content: 'Start\n  repeated clause  \nUnicode: 📦 新加坡\n  repeated clause  \nEnd',
  permitNumber: '',
  permitExpiry: '',
  shipmentDate: '2026-10-20',
  warehouseConfirmed: false,
};

async function application(dbPath = ':memory:') {
  const service = createApp({ dbPath, demoMode: true, ai: { provider: 'local' } });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = '';
  return {
    async call<T>(
      path: string,
      body?: unknown,
      expected = 200,
      method = body === undefined ? 'GET' : 'POST',
    ): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const token = response.headers.get('set-cookie');
      if (token) cookie = token.split(';')[0];
      const value = await response.json();
      assert.equal(response.status, expected, JSON.stringify(value));
      return value as T;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      service.close();
    },
  };
}

test('Anchored comments preserve exact repeated-text offsets and Unicode selections across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'instill-comment-anchors-'));
  let app: Awaited<ReturnType<typeof application>> | undefined;
  try {
    const dbPath = join(directory, 'comments.db');
    app = await application(dbPath);
    const record = await app.call<CaseRecord>('/cases', { ...input, contentRevision: 999 }, 201);
    assert.equal(record.contentRevision, 0, 'The server assigns the initial revision.');
    const quote = '  repeated clause  ';
    const anchor: CommentAnchor = {
      start: record.content.lastIndexOf(quote),
      end: record.content.lastIndexOf(quote) + quote.length,
      quote,
      revision: 0,
    };
    const comment = await app.call<Comment>(
      `/cases/${record.id}/comments`,
      {
        content: 'Please qualify this second occurrence.',
        anchor: { ...anchor, untrusted: 'discard' },
      },
      201,
    );
    assert.deepEqual(comment.anchor, anchor);
    assert.equal(
      comment.anchor!.quote,
      quote,
      'Leading and trailing quote whitespace is meaningful.',
    );
    assert.ok(comment.anchor!.start > record.content.indexOf(quote));
    const unicodeQuote = '📦 新加坡';
    const unicode: CommentAnchor = {
      start: record.content.indexOf(unicodeQuote),
      end: record.content.indexOf(unicodeQuote) + 6,
      quote: unicodeQuote,
      revision: 0,
    };
    const unicodeComment = await app.call<Comment>(
      `/cases/${record.id}/comments`,
      { content: 'Check this destination wording.', anchor: unicode },
      201,
    );
    assert.deepEqual(
      unicodeComment.anchor,
      unicode,
      'Offsets use UTF-16 code units, including the surrogate pair.',
    );
    const general = await app.call<Comment>(
      `/cases/${record.id}/comments`,
      { content: 'General review note.' },
      201,
    );
    assert.ok(!('anchor' in general));
    await app.close();
    app = undefined;
    app = await application(dbPath);
    const state = await app.call<AppState>('/state');
    assert.deepEqual(state.comments.find((entry) => entry.id === comment.id)?.anchor, anchor);
    assert.deepEqual(
      state.comments.find((entry) => entry.id === unicodeComment.id)?.anchor,
      unicode,
    );
    assert.equal(state.cases.find((entry) => entry.id === record.id)?.contentRevision, 0);
    assert.ok(state.comments.some((entry) => entry.id === general.id && !entry.anchor));
  } finally {
    await app?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes('instill-comment-anchors-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Malformed or stale anchors never persist comments or activity', async () => {
  const app = await application();
  try {
    const record = await app.call<CaseRecord>('/cases', input, 201);
    const anchor: CommentAnchor = { start: 0, end: 5, quote: 'Start', revision: 0 };
    const invalid: unknown[] = [
      null,
      [],
      'Start',
      {},
      { ...anchor, start: '0' },
      { ...anchor, start: -1 },
      { ...anchor, start: 0.5 },
      { ...anchor, end: Number.MAX_SAFE_INTEGER + 1 },
      { ...anchor, end: 0 },
      { ...anchor, end: record.content.length + 1 },
      { ...anchor, quote: 'start' },
      { ...anchor, quote: 123 },
      { ...anchor, quote: '' },
      { start: 5, end: 8, quote: '\n  ', revision: 0 },
      { ...anchor, revision: -1 },
      { ...anchor, revision: 0.5 },
      { ...anchor, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...anchor, revision: '0' },
    ];
    const before = await app.call<AppState>('/state');
    for (const malformed of invalid)
      await app.call(
        `/cases/${record.id}/comments`,
        { content: 'Invalid selection.', anchor: malformed },
        400,
      );
    await app.call(
      `/cases/${record.id}/comments`,
      { content: 'Future revision.', anchor: { ...anchor, revision: 1 } },
      409,
    );
    const after = await app.call<AppState>('/state');
    assert.equal(after.comments.length, before.comments.length);
    assert.equal(after.activity.length, before.activity.length);
    const changed = await app.call<CaseRecord>(
      `/cases/${record.id}`,
      { ...input, content: 'A shorter updated document.' },
      200,
      'PUT',
    );
    assert.equal(changed.contentRevision, 1);
    const edited = await app.call<AppState>('/state');
    await app.call(
      `/cases/${record.id}/comments`,
      { content: 'Selection from before the edit.', anchor },
      409,
    );
    await app.call(
      `/cases/${record.id}/comments`,
      {
        content: 'Old selection beyond the updated document.',
        anchor: { start: 40, end: 55, quote: record.content.slice(40, 55), revision: 0 },
      },
      409,
    );
    const rejected = await app.call<AppState>('/state');
    assert.equal(rejected.comments.length, edited.comments.length);
    assert.equal(rejected.activity.length, edited.activity.length);
  } finally {
    await app.close();
  }
});

test('Content revision changes only with document text; old anchors and legacy general comments remain usable', async () => {
  const app = await application();
  try {
    await app.call('/session', { userId: 'employee-amir' });
    const record = await app.call<CaseRecord>('/cases', input, 201);
    const anchor: CommentAnchor = { start: 0, end: 5, quote: 'Start', revision: 0 };
    const comment = await app.call<Comment>(
      `/cases/${record.id}/comments`,
      { content: 'Retain this original wording.', anchor },
      201,
    );
    const metadata = await app.call<CaseRecord>(
      `/cases/${record.id}`,
      { ...input, title: 'Revised title only', shipmentDate: '2026-10-21', contentRevision: 800 },
      200,
      'PUT',
    );
    assert.equal(metadata.contentRevision, 0);
    await app.call(
      `/cases/${record.id}/comments`,
      { content: 'The selection remains current.', anchor },
      201,
    );
    const reviewed = await app.call<CaseRecord>(`/cases/${record.id}/review`, {});
    assert.equal(reviewed.contentRevision, 0);
    const submitted = await app.call<CaseRecord>(`/cases/${record.id}/submit`, {});
    assert.equal(submitted.contentRevision, 0);
    const changed = await app.call<CaseRecord>(
      `/cases/${record.id}`,
      { ...input, content: `${input.content}\nChanged paragraph.`, contentRevision: 0 },
      200,
      'PUT',
    );
    assert.equal(changed.contentRevision, 1);
    const reverted = await app.call<CaseRecord>(`/cases/${record.id}`, input, 200, 'PUT');
    assert.equal(reverted.contentRevision, 2, 'Reverting text is another revision.');
    const state = await app.call<AppState>('/state');
    assert.deepEqual(
      state.comments.find((entry) => entry.id === comment.id)?.anchor,
      anchor,
      'Historical anchors are retained with their original revision.',
    );
    await app.call(
      `/cases/${record.id}/comments`,
      { content: 'Same text but stale revision.', anchor },
      409,
    );
    await app.call(
      `/cases/${record.id}/comments`,
      { content: 'Current revision.', anchor: { ...anchor, revision: 2 } },
      201,
    );
    const legacy = state.cases.find((item) => item.contentRevision === undefined)!;
    assert.ok(legacy, 'Seeded existing records exercise the legacy revision-zero contract.');
    const legacyAnchor: CommentAnchor = {
      start: 0,
      end: legacy.content.length,
      quote: legacy.content,
      revision: 0,
    };
    await app.call(
      `/cases/${legacy.id}/comments`,
      { content: 'Comment on a shared legacy case.', anchor: legacyAnchor },
      201,
    );
    await app.call(
      `/cases/${record.id}/comments`,
      { content: 'General comments remain available after document edits.' },
      201,
    );
    await app.call('/session', { userId: 'employee-chloe' });
    await app.call(`/cases/${record.id}`, input, 403, 'PUT');
    await app.call(
      `/cases/${record.id}/comments`,
      { content: 'Existing team comment permissions are preserved.' },
      201,
    );
  } finally {
    await app.close();
  }
});
