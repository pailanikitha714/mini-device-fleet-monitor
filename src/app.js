/**
 * Express application: HTTP routes only.
 * Business logic lives in DeviceStore, validation lives in validation.js.
 *
 * createApp() receives the store as a parameter so tests can inject
 * a store with a fake clock.
 */

const express = require('express');
const { DeviceStore, STATUS } = require('./deviceStore');
const { validateRegistration, validateHeartbeat } = require('./validation');

function createApp({ store = new DeviceStore() } = {}) {
  const app = express();

  app.use(express.json());

  // 1. Register a device
  app.post('/devices', (req, res) => {
    const { error, value } = validateRegistration(req.body);
    if (error) {
      return res.status(400).json({ error });
    }

    if (store.has(value.id)) {
      return res.status(409).json({ error: `Device '${value.id}' is already registered` });
    }

    const device = store.register(value.id, value.name);
    return res.status(201).json(device);
  });

  // 2. Receive a heartbeat
  app.post('/devices/:id/heartbeat', (req, res) => {
    const { id } = req.params;

    if (!store.has(id)) {
      return res.status(404).json({ error: `Device '${id}' not found` });
    }

    const { error, value } = validateHeartbeat(req.body);
    if (error) {
      return res.status(400).json({ error });
    }

    const device = store.recordHeartbeat(id, value);
    return res.status(200).json(device);
  });

  // 3. List devices (optional filter: ?status=ONLINE or ?status=OFFLINE)
  app.get('/devices', (req, res) => {
    const { status } = req.query;

    if (status === undefined) {
      return res.json(store.list());
    }

    const normalized = String(status).toUpperCase();
    if (!Object.values(STATUS).includes(normalized)) {
      return res.status(400).json({ error: "'status' filter must be ONLINE or OFFLINE" });
    }

    return res.json(store.list(normalized));
  });

  // 4. Device details
  app.get('/devices/:id', (req, res) => {
    const device = store.get(req.params.id);
    if (!device) {
      return res.status(404).json({ error: `Device '${req.params.id}' not found` });
    }
    return res.json(device);
  });

  // 5. Fleet summary
  app.get('/summary', (req, res) => {
    res.json(store.summary());
  });

  // Unknown routes
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  });

  // Error handler (e.g. malformed JSON body)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };