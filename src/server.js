/**
 * Entry point: creates the app and starts the HTTP server.
 *
 * Environment variables (optional):
 *   PORT                  - HTTP port (default 3000)
 *   HEARTBEAT_TIMEOUT_MS  - ONLINE timeout in ms (default 30000)
 */

const { createApp } = require('./app');
const { DeviceStore, DEFAULT_TIMEOUT_MS } = require('./deviceStore');

const PORT = Number(process.env.PORT) || 3000;
const TIMEOUT_MS = Number(process.env.HEARTBEAT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

const store = new DeviceStore({ timeoutMs: TIMEOUT_MS });
const app = createApp({ store });

const server = app.listen(PORT, () => {
  console.log(`Fleet monitor listening on http://localhost:${PORT}`);
  console.log(`Devices go OFFLINE after ${TIMEOUT_MS / 1000}s without a heartbeat`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));