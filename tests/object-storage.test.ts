import test from 'node:test';
import assert from 'node:assert/strict';
import { OriginalStorage } from '../server/object-storage.ts';

const config = {
  bucket: 'clearport-test-1250000000',
  secretId: 'fixture-secret-id',
  secretKey: 'fixture-secret-key',
  sessionToken: 'fixture-token',
};

test('COS archives exact original bytes in Singapore with a signed request and no public URL', async () => {
  const bytes = Buffer.from('Private original document bytes.');
  let calls = 0;
  const client = new OriginalStorage(config, async (url, options) => {
    calls++;
    assert.match(
      String(url),
      /^https:\/\/clearport-test-1250000000\.cos\.ap-singapore\.myqcloud\.com\/originals\/case-1\/[a-f0-9]{64}\.pdf$/,
    );
    assert.equal(options?.method, 'PUT');
    assert.equal(options?.redirect, 'error');
    assert.deepEqual(Buffer.from(options?.body as Uint8Array), bytes);
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('x-cos-security-token'), 'fixture-token');
    assert.match(headers.get('authorization')!, /q-sign-algorithm=sha1/);
    assert.ok(!headers.get('authorization')!.includes(config.secretKey));
    assert.ok(headers.has('content-md5'));
    assert.equal(headers.get('x-cos-acl'), null);
    return new Response(null, { status: 200, headers: { ETag: '"fixture-etag"' } });
  });
  const saved = await client.put('case-1', '.pdf', bytes);
  assert.equal(calls, 1);
  assert.equal(saved.storage, 'cos');
  assert.equal(saved.size, bytes.length);
  assert.ok(!('url' in saved));
  await assert.rejects(client.put('../escape', '.pdf', bytes), /Invalid/);
  await assert.rejects(client.put('case-1', '.exe', bytes), /Invalid/);
  assert.equal(calls, 1);
});

test('COS fails closed for another region, invalid configuration and upload failures', async () => {
  assert.throws(() => new OriginalStorage({ ...config, region: 'ap-jakarta' }), /Singapore/);
  assert.throws(() => new OriginalStorage({ ...config, bucket: 'not-a-bucket' }), /COS_BUCKET/);
  const client = new OriginalStorage(config, async () => {
    throw new Error(config.secretKey);
  });
  await assert.rejects(client.put('case-1', '.txt', Buffer.from('Original')), (error: Error) => {
    assert.match(error.message, /storage is unavailable/);
    assert.ok(!error.message.includes(config.secretKey));
    return true;
  });
});
