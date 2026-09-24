const { DeviceStore, STATUS } = require('../src/deviceStore');
const { createFakeClock } = require('./helpers/fakeClock');

describe('DeviceStore', () => {
  let clock;
  let store;

  beforeEach(() => {
    clock = createFakeClock();
    store = new DeviceStore({ timeoutMs: 30000, now: clock.now });
  });

  test('registers a device that starts OFFLINE with no heartbeat', () => {
    const device = store.register('device-01', 'Lab Device 01');

    expect(device).toMatchObject({
      id: 'device-01',
      name: 'Lab Device 01',
      status: STATUS.OFFLINE,
      last_heartbeat: null,
    });
    expect(store.has('device-01')).toBe(true);
  });

  test('register returns null for a duplicate id', () => {
    store.register('device-01', 'Lab Device 01');
    expect(store.register('device-01', 'Another name')).toBeNull();
    expect(store.get('device-01').name).toBe('Lab Device 01');
  });

  test('recordHeartbeat returns null for an unknown device', () => {
    expect(store.recordHeartbeat('missing', { status: 'OK' })).toBeNull();
  });

  test('device is ONLINE right after a heartbeat', () => {
    store.register('device-01', 'Lab Device 01');
    const device = store.recordHeartbeat('device-01', { timestamp: null, status: 'OK' });

    expect(device.status).toBe(STATUS.ONLINE);
    expect(device.last_heartbeat).toBe(clock.iso());
  });

  test('device is ONLINE at exactly 30s and OFFLINE after 30s', () => {
    store.register('device-01', 'Lab Device 01');
    store.recordHeartbeat('device-01', { status: 'OK' });

    clock.advance(30000);
    expect(store.get('device-01').status).toBe(STATUS.ONLINE);

    clock.advance(1);
    expect(store.get('device-01').status).toBe(STATUS.OFFLINE);
  });

  test('an OFFLINE device becomes ONLINE again after a new heartbeat', () => {
    store.register('device-01', 'Lab Device 01');
    store.recordHeartbeat('device-01', { status: 'OK' });
    clock.advance(60000);
    expect(store.get('device-01').status).toBe(STATUS.OFFLINE);

    store.recordHeartbeat('device-01', { status: 'OK' });
    expect(store.get('device-01').status).toBe(STATUS.ONLINE);
  });

  test('summary counts online and offline devices', () => {
    store.register('device-01', 'A');
    store.register('device-02', 'B');
    store.register('device-03', 'C');
    store.recordHeartbeat('device-01', { status: 'OK' });
    store.recordHeartbeat('device-02', { status: 'OK' });

    expect(store.summary()).toEqual({ total: 3, online: 2, offline: 1 });
  });

  test('list can filter by status', () => {
    store.register('device-01', 'A');
    store.register('device-02', 'B');
    store.recordHeartbeat('device-01', { status: 'OK' });

    expect(store.list(STATUS.ONLINE).map((d) => d.id)).toEqual(['device-01']);
    expect(store.list(STATUS.OFFLINE).map((d) => d.id)).toEqual(['device-02']);
  });

  test('respects a custom timeout', () => {
    const shortStore = new DeviceStore({ timeoutMs: 5000, now: clock.now });
    shortStore.register('device-01', 'A');
    shortStore.recordHeartbeat('device-01', { status: 'OK' });

    clock.advance(5001);
    expect(shortStore.get('device-01').status).toBe(STATUS.OFFLINE);
  });
});