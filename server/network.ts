import { lookup } from 'node:dns/promises';
import { connect } from 'node:tls';

export interface NetworkProbe {
  ok: boolean;
  host: string;
  /** Where it stopped, when it did not succeed. */
  stage?: 'dns' | 'tls';
  /** A safe sentence for a user and the container log. */
  reason?: string;
  dnsMs?: number;
  tlsMs?: number;
}

const codeOf = (error: unknown) => {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{3,40}$/.test(code) ? code : '';
};

/**
 * Can this host reach the endpoint at all? Resolves the name and completes a TLS handshake, which
 * separates a broken network path (DNS, firewall, proxy, clock) from a rejected key or a bad
 * answer. It sends no request, so it costs no provider allowance.
 */
export async function probeEndpoint(endpoint: string, timeoutMs = 6000): Promise<NetworkProbe> {
  const url = new URL(endpoint);
  const host = url.hostname;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      lookup(host, { all: true }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    const code = codeOf(error);
    return {
      ok: false,
      host,
      stage: 'dns',
      reason: `This host cannot look up ${host}${code ? ` (${code})` : ''}. Check the container's DNS and outbound network.`,
    };
  } finally {
    clearTimeout(timer);
  }
  const dnsMs = Date.now() - started;
  if (url.protocol !== 'https:') return { ok: true, host, dnsMs };
  const tlsStarted = Date.now();
  return new Promise<NetworkProbe>((resolve) => {
    const socket = connect({
      host,
      port: Number(url.port || 443),
      servername: host,
      timeout: timeoutMs,
    });
    const fail = (error?: unknown) => {
      socket.destroy();
      const code = codeOf(error) || (error === undefined ? 'ETIMEDOUT' : '');
      resolve({
        ok: false,
        host,
        stage: 'tls',
        dnsMs,
        reason: `Could not connect to ${host} over HTTPS${code ? ` (${code})` : ''}. Check the host's outbound HTTPS access, proxy and clock.`,
      });
    };
    socket.once('secureConnect', () => {
      socket.end();
      resolve({ ok: true, host, dnsMs, tlsMs: Date.now() - tlsStarted });
    });
    socket.once('timeout', () => fail());
    socket.once('error', fail);
  });
}
