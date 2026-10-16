import type { Request, Response, NextFunction } from 'express';

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const clip = (value: string, maximum: number) =>
  value.length > maximum ? `${value.slice(0, maximum)}…` : value;

// One line per finished request, e.g.
// 2026-01-01T00:00:00.000Z 172.18.0.1 "GET /api/state" 200 1432 3.2ms "Mozilla/5.0 …"
// The query string is omitted, and request-controlled text is JSON-quoted so it cannot forge lines.
export function accessLog(write: (line: string) => void, now: () => Date = () => new Date()) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = performance.now();
    const remote = req.socket.remoteAddress ?? '-';
    const path = req.originalUrl.split('?')[0];
    // The image healthcheck polls this from inside the container every 30 seconds.
    const healthcheck = path === '/api/health' && loopback.has(remote);
    res.once('close', () => {
      if (healthcheck) return;
      const forwarded = req.headers['x-forwarded-for'];
      const line = [
        now().toISOString(),
        remote,
        JSON.stringify(clip(`${req.method} ${path}`, 300)),
        res.writableFinished ? res.statusCode : 'aborted',
        res.getHeader('content-length') ?? '-',
        `${(performance.now() - started).toFixed(1)}ms`,
        JSON.stringify(clip(req.headers['user-agent'] ?? '-', 200)),
        // Supplied by the client or the reverse proxy, so shown separately from the socket address.
        ...(forwarded ? [`xff=${JSON.stringify(clip(String(forwarded), 100))}`] : []),
      ].join(' ');
      try {
        write(line);
      } catch {
        /* Logging must never take the server down. */
      }
    });
    next();
  };
}
