import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Knowledge } from '../shared/types.ts';
import {
  TencentKnowledgeClient,
  TencentKnowledgeError,
  knowledgeDigest,
  renderKnowledge,
  signCosPut,
  signTencentRequest,
} from '../server/tencent-knowledge.ts';

const now = 1_800_000_000_000;
const config = {
  secretId: 'AKID-test-only',
  secretKey: 'test-secret-not-a-real-credential',
  appBizId: '12345',
  sessionToken: 'test-session-token',
};
const item: Knowledge = {
  id: 'knowledge-1',
  title: 'Wireless product checks',
  content: 'Verify the device model and retain the supporting IMDA registration evidence.',
  category: 'Electronics',
  jurisdiction: 'Singapore',
  skillId: 'skill-electronics',
  sourceType: 'Document',
  sourceName: 'Internal SOP.md',
  status: 'Approved',
  createdAt: '2026-10-15T01:00:00.000Z',
  author: 'Sarah Tan',
  tags: ['wireless', 'IMDA'],
};

const apiResponse = (value: Record<string, unknown>) =>
  Response.json({ Response: { RequestId: 'test-request-id', ...value } });
const storage = (overrides: Record<string, unknown> = {}) =>
  apiResponse({
    Credentials: { TmpSecretId: 'TMPID', TmpSecretKey: 'TMPSECRET', Token: 'TMP-TOKEN' },
    StartTime: now / 1000 - 10,
    ExpiredTime: now / 1000 + 600,
    Bucket: 'lke-intl-1251316161',
    Region: 'ap-jakarta',
    UploadPath: '/corp/100/12345/doc/document.md',
    Type: 'cos',
    ...overrides,
  });
const upload = () =>
  new Response(null, {
    status: 200,
    headers: { etag: '"etag"', 'x-cos-hash-crc64ecma': '123456789' },
  });
type Call = { url: string; init: RequestInit; headers: Headers; body: unknown };
function mock(responses: (Response | ((call: Call) => Response | Promise<Response>))[]) {
  const calls: Call[] = [];
  const fetcher: typeof globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init, headers: new Headers(init.headers), body: init.body };
    calls.push(call);
    const next = responses.shift();
    assert.ok(next, `Unexpected remote request ${call.url}`);
    return typeof next === 'function' ? next(call) : next;
  };
  return { client: new TencentKnowledgeClient(config, { fetch: fetcher, now: () => now }), calls };
}

test('TC3 and COS signatures match independently calculated protocol fixtures', () => {
  // Frozen outputs independently computed with Python hashlib/hmac from Tencent's
  // published algorithms; dummy credentials, not the implementation under test.
  // TC3: https://www.tencentcloud.com/document/product/1155/48996
  // COS: https://www.tencentcloud.com/document/product/436/7778
  assert.equal(
    signTencentRequest({
      host: 'cvm.tencentcloudapi.com',
      service: 'cvm',
      secretId: 'AKIDEXAMPLE',
      secretKey: 'example-secret-key',
      timestamp: 1551113065,
      body: '{"Limit": 1, "Filters": [{"Values": ["unnamed"], "Name": "instance-name"}]}',
    }),
    'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2019-02-25/cvm/tc3_request, SignedHeaders=content-type;host, Signature=8c9d051555197f718b0662ac4081c7afad70c551c1cee82c70e1f02be5c84878',
  );
  assert.equal(
    signCosPut({
      path: '/exampleobject(Tencent Cloud)',
      secretId: 'AKIDEXAMPLE',
      secretKey: 'example-secret-key',
      startTime: 1557989151,
      endTime: 1557996351,
      headers: {
        host: 'examplebucket-1250000000.cos.ap-beijing.myqcloud.com',
        'content-md5': 'mQ/fVh815F3k6TAUm8m0eg==',
        'content-type': 'text/plain',
        'x-cos-security-token': 'example-token',
      },
    }),
    'q-sign-algorithm=sha1&q-ak=AKIDEXAMPLE&q-sign-time=1557989151;1557996351&q-key-time=1557989151;1557996351&q-header-list=content-md5;content-type;host;x-cos-security-token&q-url-param-list=&q-signature=a03e2072ad4c43506967604cec767456979d1dea',
  );
});

test('approved snapshots preserve provenance and rejected decisions without mutable sync state', () => {
  const rejected = {
    ...item,
    sourceType: 'Decision' as const,
    decision: 'rejected' as const,
    caseId: 'case-1',
  };
  assert.match(renderKnowledge(rejected), /Management REJECTED/);
  assert.match(
    renderKnowledge(rejected),
    /Do not present that rejected advice as an approved requirement/,
  );
  assert.match(renderKnowledge(rejected), /"instillKnowledgeId": "knowledge-1"/);
  assert.match(renderKnowledge(rejected), /"caseId": "case-1"/);
  assert.match(renderKnowledge(rejected), /"skillId": "skill-electronics"/);
  assert.equal(knowledgeDigest(item), knowledgeDigest({ ...item, adpStatus: 'synced' }));
  assert.notEqual(knowledgeDigest(item), knowledgeDigest({ ...item, content: 'Changed content' }));
  assert.throws(() => renderKnowledge({ ...item, status: 'Pending' }), /Only approved/);
  assert.throws(
    () => renderKnowledge({ ...item, jurisdiction: 'Taiwan' } as unknown as Knowledge),
    /Singapore/,
  );
});

test('imports private Markdown using issued temporary credentials and content-based retry deduplication', async () => {
  const { client, calls } = mock([
    storage(),
    upload(),
    apiResponse({ DocBizId: 'doc-100', ErrorMsg: '' }),
    storage(),
    upload(),
    apiResponse({ DocBizId: 'doc-100', DuplicateFileCheckType: 1 }),
  ]);
  assert.deepEqual(await client.putDocument(item), {
    docId: 'doc-100',
    requestId: 'test-request-id',
  });
  assert.deepEqual(await client.putDocument(item), {
    docId: 'doc-100',
    requestId: 'test-request-id',
  });
  const [credentials, put, save] = calls;
  assert.equal(credentials.url, 'https://lke.intl.tencentcloudapi.com/');
  assert.deepEqual(JSON.parse(String(credentials.body)), {
    BotBizId: '12345',
    FileType: 'md',
    TypeKey: 'offline',
    IsPublic: false,
  });
  assert.equal(credentials.headers.get('X-TC-Action'), 'DescribeStorageCredential');
  assert.equal(credentials.headers.get('X-TC-Version'), '2023-11-30');
  assert.equal(credentials.headers.get('X-TC-Region'), 'ap-jakarta');
  assert.equal(credentials.headers.get('X-TC-Token'), config.sessionToken);
  assert.match(
    credentials.headers.get('Authorization')!,
    /^TC3-HMAC-SHA256 Credential=AKID-test-only\//,
  );
  assert.equal(
    put.url,
    'https://lke-intl-1251316161.cos.ap-jakarta.myqcloud.com/corp/100/12345/doc/document.md',
  );
  assert.equal(put.init.method, 'PUT');
  assert.equal(put.init.redirect, 'error');
  assert.equal(put.headers.get('x-cos-security-token'), 'TMP-TOKEN');
  assert.match(put.headers.get('Authorization')!, /q-ak=TMPID&/);
  assert.ok(!put.headers.get('Authorization')!.includes(config.secretId));
  assert.equal(String(put.body), renderKnowledge(item));
  assert.equal(
    put.headers.get('content-md5'),
    createHash('md5').update(renderKnowledge(item)).digest('base64'),
  );
  const params = JSON.parse(String(save.body));
  assert.equal(save.headers.get('X-TC-Action'), 'SaveDoc');
  assert.equal(params.FileType, 'md');
  assert.equal(params.Opt, 2);
  assert.equal(params.IsRefer, true);
  assert.equal(params.IsDownload, false);
  assert.equal(params.CosHash, '123456789');
  assert.equal(params.ETag, '"etag"');
  assert.equal(params.CosUrl, '/corp/100/12345/doc/document.md');
  assert.equal(params.Size, String(Buffer.byteLength(renderKnowledge(item))));
  assert.deepEqual(params.DuplicateFileHandles, [{ CheckType: 1, HandleType: 2 }]);
  assert.equal(save.body, calls[5].body);
  assert.ok(calls.every((call) => call.headers.get('X-TC-Action') !== 'CreateRelease'));
});

test('document and release polling never treats parsing, review, paused, or failed stages as published', async () => {
  const docStates = new Map<number, string>([
    [1, 'processing'],
    [2, 'processing'],
    [3, 'processing'],
    [4, 'failed'],
    [5, 'failed'],
    [6, 'failed'],
    [7, 'processing'],
    [8, 'failed'],
    [9, 'processing'],
    [10, 'ready'],
    [11, 'processing'],
    [12, 'published'],
    [13, 'processing'],
    [14, 'failed'],
    [15, 'processing'],
    [16, 'failed'],
    [17, 'processing'],
    [18, 'failed'],
    [19, 'failed'],
    [20, 'failed'],
    [21, 'failed'],
    [22, 'processing'],
  ]);
  const releaseStates = new Map<number, string>([
    [1, 'processing'],
    [2, 'processing'],
    [3, 'published'],
    [4, 'failed'],
    [5, 'processing'],
    [6, 'processing'],
    [7, 'failed'],
    [9, 'failed'],
  ]);
  const { client, calls } = mock([
    ...[...docStates.keys()].map((Status) => apiResponse({ DocBizId: 'doc-100', Status })),
    apiResponse({ ReleaseBizId: 'release-100' }),
    ...[...releaseStates.keys()].map((Status) => apiResponse({ Status })),
  ]);
  for (const [remoteStatus, status] of docStates) {
    assert.deepEqual(await client.getDocument('doc-100'), {
      docId: 'doc-100',
      remoteStatus,
      status,
      reason: undefined,
      requestId: 'test-request-id',
    });
  }
  assert.deepEqual(await client.createRelease('Instill approved knowledge'), {
    releaseId: 'release-100',
    requestId: 'test-request-id',
  });
  // The documented operation is explicitly app-wide: no invented document scope.
  assert.deepEqual(JSON.parse(String(calls[22].body)), {
    BotBizId: '12345',
    Desc: 'Instill approved knowledge',
  });
  for (const [remoteStatus, status] of releaseStates) {
    assert.deepEqual(await client.getRelease('release-100'), {
      remoteStatus,
      status,
      reason: undefined,
      requestId: 'test-request-id',
    });
  }
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.body)), {
    BotBizId: '12345',
    ReleaseBizId: 'release-100',
  });
});

test('failed imports, malformed responses, unsafe upload locations, and unpublished records fail closed', async (t) => {
  await t.test('pending local knowledge never makes a network request', async () => {
    const { client, calls } = mock([]);
    await assert.rejects(client.putDocument({ ...item, status: 'Pending' }), /Only approved/);
    assert.equal(calls.length, 0);
  });
  for (const [label, credential] of [
    ['unsafe bucket', storage({ Bucket: 'attacker.example/path' })],
    ['unsafe path', storage({ UploadPath: '/corp/../secret' })],
    ['public path', storage({ UploadPath: '/public/document.md' })],
    ['expired credentials', storage({ ExpiredTime: now / 1000 - 1 })],
  ] as const) {
    await t.test(label, async () => {
      const { client, calls } = mock([credential]);
      await assert.rejects(client.putDocument(item), TencentKnowledgeError);
      assert.equal(calls.length, 1);
    });
  }
  await t.test('COS failure prevents SaveDoc', async () => {
    const { client, calls } = mock([storage(), new Response('forbidden', { status: 403 })]);
    await assert.rejects(client.putDocument(item), /upload failed/);
    assert.equal(calls.length, 2);
  });
  await t.test('missing COS CRC64 prevents SaveDoc', async () => {
    const { client, calls } = mock([storage(), new Response(null, { headers: { etag: 'etag' } })]);
    await assert.rejects(client.putDocument(item), /CRC64/);
    assert.equal(calls.length, 2);
  });
  await t.test('SaveDoc business failure is not successful sync', async () => {
    const { client } = mock([
      storage(),
      upload(),
      apiResponse({ DocBizId: 'doc-100', ErrorMsg: 'Import failed' }),
    ]);
    await assert.rejects(client.putDocument(item), /could not import/);
  });
  await t.test(
    'Tencent API errors do not expose credentials or raw upstream messages',
    async () => {
      const { client } = mock([
        apiResponse({ Error: { Code: 'AuthFailure.SignatureFailure', Message: config.secretKey } }),
      ]);
      await assert.rejects(client.getDocument('doc-100'), (error: unknown) => {
        assert.ok(error instanceof TencentKnowledgeError);
        assert.equal(error.code, 'AuthFailure.SignatureFailure');
        assert.equal(error.requestId, 'test-request-id');
        assert.ok(!error.message.includes(config.secretKey));
        return true;
      });
    },
  );
  await t.test('invalid JSON and unknown statuses are errors', async () => {
    const { client } = mock([
      new Response('<html>'),
      apiResponse({ DocBizId: 'doc-100', Status: 99 }),
      apiResponse({ Status: 99 }),
      apiResponse({ DocBizId: 'other-doc', Status: 12 }),
      apiResponse({ DocBizId: 'doc-100', Status: 12, IsDeleted: true }),
    ]);
    await assert.rejects(client.getDocument('doc-100'), /invalid JSON/);
    await assert.rejects(client.getDocument('doc-100'), /unknown document status/);
    await assert.rejects(client.getRelease('release-100'), /unknown release status/);
    await assert.rejects(client.getDocument('doc-100'), /different document/);
    assert.equal((await client.getDocument('doc-100')).status, 'failed');
  });
  await t.test('oversized response is bounded', async () => {
    const { client } = mock([new Response('x'.repeat(1024 * 1024 + 1))]);
    await assert.rejects(client.getDocument('doc-100'), /size limit/);
  });
});

test('requests honor cancellation and have a bounded timeout without returning fake success', async () => {
  const fetcher: typeof globalThis.fetch = async (_input, init) => {
    assert.equal(init?.redirect, 'error');
    return await new Promise<Response>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout was not enforced')), 500);
      const abort = () => {
        clearTimeout(timer);
        reject(init!.signal!.reason);
      };
      if (init!.signal!.aborted) abort();
      else init!.signal!.addEventListener('abort', abort, { once: true });
    });
  };
  const timed = new TencentKnowledgeClient(config, { fetch: fetcher, timeoutMs: 10 });
  await assert.rejects(
    timed.getDocument('doc-100'),
    (error: unknown) => error instanceof TencentKnowledgeError && error.code === 'NetworkError',
  );
  const controller = new AbortController();
  controller.abort();
  const cancelled = new TencentKnowledgeClient(config, {
    fetch: fetcher,
    signal: controller.signal,
  });
  await assert.rejects(cancelled.getDocument('doc-100'), /could not be completed/);
});
