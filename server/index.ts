import 'dotenv/config';
import { createApp } from './app.ts';

// Access logs go to stdout, so `docker logs` shows them. Set ACCESS_LOG=false to turn them off.
const service = createApp({
  accessLog: process.env.ACCESS_LOG === 'false' ? undefined : (line) => console.log(line),
});
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const server = service.app.listen(port, host, () => {
  const displayHost = host.includes(':') ? `[${host}]` : host;
  console.log(`Instill API running at http://${displayHost}:${port}`);
  console.log(
    'Singapore workspace · internal approval only · no external declarations or messages are sent',
  );
});
function shutdown() {
  server.close(() => {
    service.close();
    process.exit(0);
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
