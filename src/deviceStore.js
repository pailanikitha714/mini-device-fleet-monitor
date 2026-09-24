/**
 * In-memory storage for devices and their latest heartbeat.
 *
 * ONLINE/OFFLINE is NOT stored. It is calculated every time a device is read,
 * by comparing "now" with the time the server last received a heartbeat.
 * Because of that, the status is always up to date and no background job is needed.
 *
 * The clock ("now") is injectable so tests can move time forward instantly
 * instead of waiting 30 real seconds.
 */

const DEFAULT_TIMEOUT_MS = 30 * 1000;

const STATUS = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
});

class DeviceStore {
  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs=30000] - max time since last heartbeat to still be ONLINE
   * @param {() => number} [options.now=Date.now] - returns current time in milliseconds
   */
  constructor({ timeoutMs = DEFAULT_TIMEOUT_MS, now = () => Date.now() } = {}) {
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.devices = new Map(); // Map keeps insertion order, so lists are stable
  }

  has(id) {
    return this.devices.has(id);
  }

  /**
   * Registers a new device. Returns the device view, or null if the id already exists.
   */
  register(id, name) {
    if (this.devices.has(id)) {
      return null;
    }

    const device = {
      id,
      name,
      registeredAt: this.now(),
      lastHeartbeatAt: null, // server time (ms) of the last heartbeat received
      lastHeartbeat: null, // payload of the last heartbeat
    };

    this.devices.set(id, device);
    return this.toView(device);
  }

  /**
   * Records a heartbeat for a device. Returns the updated device view,
   * or null if the device is not registered.
   */
  recordHeartbeat(id, heartbeat) {
    const device = this.devices.get(id);
    if (!device) {
      return null;
    }

    const receivedAt = this.now();
    device.lastHeartbeatAt = receivedAt;
    device.lastHeartbeat = {
      ...heartbeat,
      timestamp: heartbeat.timestamp || new Date(receivedAt).toISOString(),
    };

    return this.toView(device);
  }

  /**
   * Returns a single device view, or null if not found.
   */
  get(id) {
    const device = this.devices.get(id);
    return device ? this.toView(device) : null;
  }

  /**
   * Returns all devices, optionally filtered by status (ONLINE / OFFLINE).
   */
  list(statusFilter) {
    const now = this.now();
    const views = [...this.devices.values()].map((device) => this.toView(device, now));
    return statusFilter ? views.filter((view) => view.status === statusFilter) : views;
  }

  summary() {
    const views = this.list();
    const online = views.filter((view) => view.status === STATUS.ONLINE).length;
    return {
      total: views.length,
      online,
      offline: views.length - online,
    };
  }

  computeStatus(device, now = this.now()) {
    if (device.lastHeartbeatAt === null) {
      return STATUS.OFFLINE;
    }
    // Exactly 30s is still ONLINE; "more than 30 seconds" is OFFLINE.
    return now - device.lastHeartbeatAt <= this.timeoutMs ? STATUS.ONLINE : STATUS.OFFLINE;
  }

  /**
   * Converts the internal device record into the JSON shape returned by the API.
   */
  toView(device, now = this.now()) {
    const heartbeat = device.lastHeartbeat;

    return {
      id: device.id,
      name: device.name,
      status: this.computeStatus(device, now),
      last_heartbeat: device.lastHeartbeatAt === null
        ? null
        : new Date(device.lastHeartbeatAt).toISOString(),
      reported_timestamp: heartbeat ? heartbeat.timestamp : null,
      reported_status: heartbeat ? heartbeat.status : null,
      cpu_usage: heartbeat ? heartbeat.cpu_usage : null,
      signal_strength: heartbeat ? heartbeat.signal_strength : null,
      registered_at: new Date(device.registeredAt).toISOString(),
    };
  }
}

module.exports = { DeviceStore, STATUS, DEFAULT_TIMEOUT_MS };