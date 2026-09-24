const request = require('supertest');
const { createApp } = require('../src/app');
const { DeviceStore } = require('../src/deviceStore');
const { createFakeClock } = require('./helpers/fakeClock');

const TIMEOUT_MS = 30 * 1000;

describe('Fleet Monitor API', () => {
  let clock;
  let app;

  beforeEach(() => {
    clock = createFakeClock();
    app = createApp({ store: new DeviceStore({ timeoutMs: TIMEOUT_MS, now: clock.now }) });
  });

  const register = (id = 'device-01', name = 'Lab Device 01') =>
    request(app).post('/devices').send({ id, name });

  const heartbeat = (id = 'device-01', body = { timestamp: '2026-09-21T10:30:00Z', status: 'OK' }) =>
    request(app).post(`/devices/${id}/heartbeat`).send(body);

  describe('POST /devices (registration)', () => {
    test('registers a new device and returns 201', async () => {
      const res = await register();

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: 'device-01',
        name: 'Lab Device 01',
        status: 'OFFLINE',
        last_heartbeat: null,
      });
    });

    test('returns 409 for a duplicate device id', async () => {
      await register();
      const res = await register('device-01', 'Duplicate');

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already registered/);
    });

    test.each([
      { name: 'Missing id' },
      { id: 'device-01' },
      { id: '', name: 'Empty id' },
      { id: 'bad id!', name: 'Invalid characters' },
      { id: 123, name: 'Numeric id' },
      { id: 'device-01', name: '   ' },
    ])('returns 400 for invalid body %p', async (body) => {
      const res = await request(app).post('/devices').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('returns 400 for malformed JSON', async () => {
      const res = await request(app)
        .post('/devices')
        .set('Content-Type', 'application/json')
        .send('{"id": "device-01",');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid json/i);
    });
  });

  describe('POST /devices/:id/heartbeat', () => {
    test('accepts a heartbeat and marks the device ONLINE', async () => {
      await register();
      const res = await heartbeat();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'device-01',
        status: 'ONLINE',
        last_heartbeat: clock.iso(),
        reported_timestamp: '2026-09-21T10:30:00Z',
        reported_status: 'OK',
      });
    });

    test('stores optional metrics', async () => {
      await register();
      const res = await heartbeat('device-01', {
        timestamp: '2026-09-21T10:30:00Z',
        status: 'OK',
        cpu_usage: 42,
        signal_strength: -71,
      });

      expect(res.body.cpu_usage).toBe(42);
      expect(res.body.signal_strength).toBe(-71);
    });

    test('defaults timestamp and status when omitted', async () => {
      await register();
      const res = await heartbeat('device-01', {});

      expect(res.status).toBe(200);
      expect(res.body.reported_timestamp).toBe(clock.iso());
      expect(res.body.reported_status).toBe('OK');
    });

    test('returns 404 for an unregistered device', async () => {
      const res = await heartbeat('unknown-device');

      expect(res.status).toBe(404);
    });

    test.each([
      { timestamp: 'not-a-date' },
      { status: 123 },
      { cpu_usage: 150 },
      { cpu_usage: 'high' },
      { signal_strength: 'weak' },
    ])('returns 400 for invalid heartbeat %p', async (body) => {
      await register();
      const res = await heartbeat('device-01', body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('GET /devices and GET /devices/:id', () => {
    test('lists all devices with their current status', async () => {
      await register('device-01', 'A');
      await register('device-02', 'B');
      await heartbeat('device-01');

      const res = await request(app).get('/devices');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({ id: 'device-01', status: 'ONLINE' });
      expect(res.body[1]).toMatchObject({ id: 'device-02', status: 'OFFLINE', last_heartbeat: null });
    });

    test('filters devices by status (case-insensitive)', async () => {
      await register('device-01', 'A');
      await register('device-02', 'B');
      await heartbeat('device-01');

      const online = await request(app).get('/devices?status=online');
      const offline = await request(app).get('/devices?status=OFFLINE');

      expect(online.body.map((d) => d.id)).toEqual(['device-01']);
      expect(offline.body.map((d) => d.id)).toEqual(['device-02']);
    });

    test('returns 400 for an invalid status filter', async () => {
      const res = await request(app).get('/devices?status=BROKEN');

      expect(res.status).toBe(400);
    });

    test('returns details for a single device', async () => {
      await register();
      await heartbeat();

      const res = await request(app).get('/devices/device-01');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'device-01', name: 'Lab Device 01', status: 'ONLINE' });
    });

    test('returns 404 for an unknown device', async () => {
      const res = await request(app).get('/devices/does-not-exist');

      expect(res.status).toBe(404);
    });
  });

  describe('30-second ONLINE/OFFLINE timeout', () => {
    test('device stays ONLINE up to 30s and goes OFFLINE after 30s', async () => {
      await register();
      await heartbeat();

      clock.advance(29999);
      expect((await request(app).get('/devices/device-01')).body.status).toBe('ONLINE');

      clock.advance(1); // exactly 30s
      expect((await request(app).get('/devices/device-01')).body.status).toBe('ONLINE');

      clock.advance(1); // 30.001s
      expect((await request(app).get('/devices/device-01')).body.status).toBe('OFFLINE');
    });

    test('an OFFLINE device comes back ONLINE after a new heartbeat', async () => {
      await register();
      await heartbeat();
      clock.advance(45000);
      expect((await request(app).get('/devices/device-01')).body.status).toBe('OFFLINE');

      await heartbeat();
      expect((await request(app).get('/devices/device-01')).body.status).toBe('ONLINE');
    });

    test('summary reflects the timeout automatically', async () => {
      await register('device-01', 'A');
      await register('device-02', 'B');
      await register('device-03', 'C');
      await heartbeat('device-01');
      await heartbeat('device-02');
      await heartbeat('device-03');

      clock.advance(20000);
      await heartbeat('device-01'); // only device-01 keeps reporting
      clock.advance(15000); // device-01: 15s ago, others: 35s ago

      const res = await request(app).get('/summary');
      expect(res.body).toEqual({ total: 3, online: 1, offline: 2 });
    });

    test('uses server receive time, not the device-reported timestamp', async () => {
      await register();
      await heartbeat('device-01', { timestamp: '2020-01-01T00:00:00Z', status: 'OK' });

      const res = await request(app).get('/devices/device-01');
      expect(res.body.status).toBe('ONLINE');
      expect(res.body.reported_timestamp).toBe('2020-01-01T00:00:00Z');
    });
  });

  describe('GET /summary', () => {
    test('returns zeros for an empty fleet', async () => {
      const res = await request(app).get('/summary');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 0, online: 0, offline: 0 });
    });
  });

  test('returns 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});