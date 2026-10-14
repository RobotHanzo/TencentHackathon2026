import { createHash } from 'node:crypto';
import { signCosPut } from './tencent-knowledge.ts';

export interface ObjectStorageConfig {
  bucket: string;
  region?: string;
  secretId: string;
  secretKey: string;
  sessionToken?: string;
}

/** Original documents only. Bucket access remains private; no public links are generated. */
export class OriginalStorage {
  constructor(
    private config: ObjectStorageConfig,
    private fetcher = globalThis.fetch,
  ) {
    if (!/^[a-z0-9][a-z0-9-]*-\d+$/.test(config.bucket))
      throw new Error('COS_BUCKET must include the Tencent APPID suffix.');
    if ((config.region || 'ap-singapore') !== 'ap-singapore')
      throw new Error('Original documents must use a Singapore COS bucket.');
    if (!config.secretId || !config.secretKey)
      throw new Error('COS requires TENCENT_SECRET_ID and TENCENT_SECRET_KEY.');
  }

  async put(id: string, extension: string, bytes: Buffer) {
    if (
      !/^[a-zA-Z0-9-]+$/.test(id) ||
      !['.pdf', '.docx', '.txt', '.md', '.eml', '.csv'].includes(extension)
    )
      throw new Error('Invalid original document identifier or format.');
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Original exceeds the upload limit.');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = `originals/${id}/${hash}${extension}`;
    const host = `${this.config.bucket}.cos.ap-singapore.myqcloud.com`;
    const timestamp = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      host,
      'content-type': 'application/octet-stream',
      'content-md5': createHash('md5').update(bytes).digest('base64'),
      ...(this.config.sessionToken ? { 'x-cos-security-token': this.config.sessionToken } : {}),
    };
    const authorization = signCosPut({
      path: `/${key}`,
      headers,
      secretId: this.config.secretId,
      secretKey: this.config.secretKey,
      startTime: timestamp - 60,
      endTime: timestamp + 600,
    });
    try {
      const response = await this.fetcher(`https://${host}/${key}`, {
        method: 'PUT',
        headers: { ...headers, Authorization: authorization },
        body: new Uint8Array(bytes),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      await response.body?.cancel();
      if (!response.ok || !response.headers.get('etag'))
        throw new Error('COS rejected the upload.');
      return { storage: 'cos' as const, key, size: bytes.byteLength };
    } catch {
      throw new Error('Original document storage is unavailable. Check COS access and retry.');
    }
  }
}
