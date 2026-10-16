import { randomUUID } from 'node:crypto';

// International ADP v2 HTTP SSE contract:
// https://intl.cloud.tencent.com/zh/document/product/1254/81449
export const ADP_ENDPOINT = 'https://wss.lke.tencentcloud.com/adp/v2/chat';
/** ADP agents think and call tools before replying, so they need longer than a plain completion. */
export const ADP_TIMEOUT_MS = 40_000;

/**
 * A failure whose message is safe to show to a user and to write to the container log: it never
 * contains the application key, request text or raw provider output.
 */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}
/** A short, safe explanation for any error raised while calling or validating a provider. */
export function failureReason(error: unknown): string {
  if (error instanceof AiError) return error.message;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    return 'The provider did not answer in time.';
  return 'Unexpected provider error.';
}
function networkFailure(error: unknown, timeout: number): AiError {
  if (error instanceof AiError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError')
    return new AiError(`ADP did not answer within ${Math.round(timeout / 1000)} seconds.`);
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  const code =
    typeof cause?.code === 'string' && /^[A-Z0-9_]{3,40}$/.test(cause.code) ? cause.code : '';
  return new AiError(
    `Could not reach ADP${code ? ` (${code})` : ''}. Check the host's outbound HTTPS access.`,
  );
}
export interface AdpConfig {
  adpAppKey?: string;
  adpEndpoint?: string;
  timeoutMs?: number;
}
export interface AdpContext {
  visitorId?: string;
  conversationId?: string;
  /** Only mappings established by the server's approved-document synchronization. */
  documentMap?: Record<string, string>;
}
export interface AdpReference {
  messageId: string;
  index: number;
  documentId?: string;
  quoted: boolean;
}
export interface AdpResult {
  text: string;
  references: AdpReference[];
}
type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ANSWER_CHARS = 32_000;

export async function runAdpChat(
  config: AdpConfig,
  input: AdpContext & { system: string; content: string },
): Promise<AdpResult> {
  if (!config.adpAppKey) throw new AiError('ADP application key is not configured.');
  const endpoint = new URL(config.adpEndpoint || ADP_ENDPOINT);
  if (
    endpoint.username ||
    endpoint.password ||
    (endpoint.protocol !== 'https:' &&
      !(
        endpoint.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
      ))
  ) {
    throw new AiError('ADP endpoint must use HTTPS (HTTP is allowed only for loopback testing).');
  }
  const conversationId = input.conversationId ?? randomUUID();
  if (!/^[a-zA-Z0-9_-]{32,64}$/.test(conversationId))
    throw new AiError('Invalid ADP conversation identifier.');
  const visitorId = input.visitorId ?? `instill-${randomUUID()}`;
  if (!visitorId || visitorId.length > 255 || /[\r\n\0]/.test(visitorId))
    throw new AiError('Invalid ADP visitor identifier.');
  const timeout = Math.max(1, Math.min(config.timeoutMs ?? ADP_TIMEOUT_MS, 60_000));
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        AppKey: config.adpAppKey,
        RequestId: randomUUID(),
        ConversationId: conversationId,
        VisitorId: visitorId,
        Contents: [{ Type: 'text', Text: input.content }],
        SystemRole: input.system,
        Incremental: true,
        Stream: 'enable',
        SearchNetwork: 'disable',
      }),
    });
  } catch (error) {
    throw networkFailure(error, timeout);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AiError(
      response.status === 401 || response.status === 403
        ? `ADP rejected the application key (HTTP ${response.status}). Check ADP_APP_KEY and that the application is published.`
        : `ADP request failed (HTTP ${response.status}).`,
    );
  }
  if (
    !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new AiError('ADP returned an unsupported response format.');
  }
  const messages = new Map<string, { type: string; parts: Map<number, string> }>();
  const references = new Map<string, AdpReference>();
  const quotes = new Set<string>();
  const clearQuotes = (messageId: string, contentIndex: number) => {
    const prefix = `${messageId}:${contentIndex}:`;
    for (const key of quotes) if (key.startsWith(prefix)) quotes.delete(key);
    for (const [key, ref] of references) if (key.startsWith(prefix)) ref.quoted = false;
  };
  let completed = false;
  let done = false;
  let bytes = 0;
  let buffer = '';
  const reference = (value: unknown, messageId: string, contentIndex: number) => {
    const ref = object(value);
    if (!Number.isInteger(ref.Index) || Number(ref.Index) < 0) return;
    const key = `${messageId}:${contentIndex}:${ref.Index}`;
    const documentId = object(ref.DocRefer).DocId;
    references.set(key, {
      messageId,
      index: Number(ref.Index),
      ...(typeof documentId === 'string' ? { documentId } : {}),
      quoted: quotes.has(key),
    });
  };
  const quote = (value: unknown, messageId: string, contentIndex: number) => {
    const index = object(value).Index;
    if (!Number.isInteger(index)) return;
    const key = `${messageId}:${contentIndex}:${index}`;
    quotes.add(key);
    const existing = references.get(key);
    if (existing) existing.quoted = true;
  };
  const snapshot = (value: unknown) => {
    const message = object(value);
    if (typeof message.MessageId !== 'string' || typeof message.Type !== 'string') return;
    if (message.Type === 'reply' && ['failed', 'stop'].includes(String(message.Status)))
      throw new AiError('ADP reply did not complete successfully.');
    const stored = messages.get(message.MessageId) ?? {
      type: message.Type,
      parts: new Map<number, string>(),
    };
    stored.type = message.Type;
    if (Array.isArray(message.Contents)) {
      stored.parts.clear();
      message.Contents.forEach((raw, index) => {
        const part = object(raw);
        if (part.Type === 'text' && typeof part.Text === 'string')
          stored.parts.set(index, part.Text);
        if (Array.isArray(part.QuoteInfos)) clearQuotes(message.MessageId as string, index);
        if (Array.isArray(part.References))
          part.References.forEach((ref) => reference(ref, message.MessageId as string, index));
        if (Array.isArray(part.QuoteInfos))
          part.QuoteInfos.forEach((ref) => quote(ref, message.MessageId as string, index));
      });
    }
    messages.set(message.MessageId, stored);
  };
  const event = (frame: string) => {
    const lines = frame.split('\n');
    const eventName = (
      lines
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trim() ?? ''
    ).replace(/^"|"$/g, '');
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      done = true;
      return;
    }
    let value: Json;
    try {
      value = object(JSON.parse(data));
    } catch {
      throw new AiError('ADP returned malformed stream data.');
    }
    const type = typeof value.Type === 'string' ? value.Type : eventName;
    if (type === 'error') throw new AiError('ADP reported a provider error.');
    if (
      type === 'request_ack' &&
      ['failed', 'stop'].includes(String(object(value.RequestAck).Status))
    )
      throw new AiError('ADP rejected the request.');
    if (type.startsWith('message.')) snapshot(value.Message);
    if (type === 'text.delta' || type === 'text.replace') {
      if (
        typeof value.MessageId !== 'string' ||
        typeof value.Text !== 'string' ||
        !Number.isInteger(value.ContentIndex) ||
        Number(value.ContentIndex) < 0
      )
        throw new AiError('ADP returned an invalid text event.');
      const stored = messages.get(value.MessageId) ?? {
        type: 'unknown',
        parts: new Map<number, string>(),
      };
      const index = Number(value.ContentIndex);
      if (type === 'text.replace') clearQuotes(value.MessageId, index);
      const text =
        type === 'text.replace' ? value.Text : (stored.parts.get(index) ?? '') + value.Text;
      if (text.length > MAX_ANSWER_CHARS)
        throw new AiError('ADP answer exceeds the supported size.');
      stored.parts.set(index, text);
      messages.set(value.MessageId, stored);
    }
    if (
      (type === 'reference.added' || type === 'quote_info.added') &&
      typeof value.MessageId === 'string' &&
      Number.isInteger(value.ContentIndex)
    ) {
      if (type === 'reference.added')
        reference(value.Reference, value.MessageId, Number(value.ContentIndex));
      else quote(value.QuoteInfo, value.MessageId, Number(value.ContentIndex));
    }
    if (type === 'response.completed') {
      const result = object(value.Response);
      if (result.Status !== 'success' || (result.Role !== undefined && result.Role !== 'assistant'))
        throw new AiError('ADP response did not complete successfully.');
      if (Array.isArray(result.Messages)) {
        messages.clear(); // The completed response is authoritative, not another delta.
        result.Messages.forEach(snapshot);
      }
      completed = true;
    }
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (!done) {
      const next = await reader.read();
      if (next.done) {
        buffer += decoder.decode();
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new AiError('ADP stream exceeds the supported size.');
      buffer += decoder.decode(next.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        event(frame);
        if (done) break;
      }
    }
    if (!done && buffer.trim()) event(buffer);
    if (!completed) throw new AiError('ADP stream ended before a successful completion.');
    const replyIds = new Set(
      [...messages].filter(([, value]) => value.type === 'reply').map(([id]) => id),
    );
    const text = [...messages]
      .filter(([id]) => replyIds.has(id))
      .map(([, value]) =>
        [...value.parts]
          .sort(([a], [b]) => a - b)
          .map(([, part]) => part)
          .join(''),
      )
      .join('\n\n')
      .trim();
    if (!text || text.length > MAX_ANSWER_CHARS)
      throw new AiError('ADP returned an empty or oversized answer.');
    return {
      text,
      references: [...references.values()].filter((ref) => replyIds.has(ref.messageId)),
    };
  } catch (error) {
    if (error instanceof AiError) throw error;
    const name = error instanceof Error ? error.name : '';
    throw name === 'TimeoutError' || name === 'AbortError'
      ? networkFailure(error, timeout)
      : new AiError('ADP stream was interrupted or unreadable.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
