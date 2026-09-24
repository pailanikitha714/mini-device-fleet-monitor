/**
 * Device simulator.
 *
 * Registers N devices (default 5) and sends a heartbeat for each one
 * every few seconds (default 5). Every 10 seconds it prints the fleet status
 * so you can watch devices go ONLINE / OFFLINE.
 *
 * Usage:
 *   npm run simulate
 *   npm run simulate -- --count 5 --interval 5
 *   npm run simulate -- --stop device-03 --stop-after 20
 *
 * While running, type commands and press Enter:
 *   stop device-03    stop sending heartbeats for a device
 *   start device-03   resume heartbeats for a device
 *   status            print fleet status now
 *   quit              exit the simulator
 *
 * Environment:
 *   BASE_URL  - server URL (default http://localhost:3000)
 */

const readline = require('readline');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FLEET_PRINT_INTERVAL_MS = 10 * 1000;

function log(message) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] ${message}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { count: 5, intervalMs: 5000, stopId: null, stopAfterMs: 20000 };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--count') {
      options.count = Number(next);
      i += 1;
    } else if (arg === '--interval') {
      options.intervalMs = Number(next) * 1000;
      i += 1;
    } else if (arg === '--stop') {
      options.stopId = next;
      i += 1;
    } else if (arg === '--stop-after') {
      options.stopAfterMs = Number(next) * 1000;
      i += 1;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 99) {
    fail('--count must be an integer between 1 and 99');
  }
  if (!(options.intervalMs > 0)) {
    fail('--interval must be a positive number of seconds');
  }
  if (!(options.stopAfterMs >= 0)) {
    fail('--stop-after must be a non-negative number of seconds');
  }

  return options;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function postJson(path, body) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function registerDevice(device) {
  const response = await postJson('/devices', { id: device.id, name: device.name });

  if (response.status === 201) {
    log(`registered ${device.id}`);
  } else if (response.status === 409) {
    log(`${device.id} already registered, reusing it`);
  } else {
    throw new Error(`Failed to register ${device.id}: HTTP ${response.status}`);
  }
}

async function sendHeartbeat(device) {
  try {
    const response = await postJson(`/devices/${device.id}/heartbeat`, {
      timestamp: new Date().toISOString(),
      status: 'OK',
      cpu_usage: randomInt(5, 95),
      signal_strength: randomInt(-90, -50),
    });
    if (!response.ok) {
      log(`${device.id} heartbeat rejected: HTTP ${response.status}`);
    }
  } catch (err) {
    log(`${device.id} heartbeat failed: ${err.message}`);
  }
}

function startDevice(device, intervalMs) {
  if (device.timer) {
    return false;
  }
  sendHeartbeat(device);
  device.timer = setInterval(() => sendHeartbeat(device), intervalMs);
  return true;
}

function stopDevice(device) {
  if (!device.timer) {
    return false;
  }
  clearInterval(device.timer);
  device.timer = null;
  return true;
}

async function printFleet() {
  try {
    const [summaryRes, devicesRes] = await Promise.all([
      fetch(`${BASE_URL}/summary`),
      fetch(`${BASE_URL}/devices`),
    ]);
    const summary = await summaryRes.json();
    const devices = await devicesRes.json();
    const states = devices.map((d) => `${d.id}:${d.status}`).join('  ');
    log(`FLEET total=${summary.total} online=${summary.online} offline=${summary.offline} | ${states}`);
  } catch (err) {
    log(`could not fetch fleet status: ${err.message}`);
  }
}

function printHelp() {
  console.log('Commands: stop <device-id> | start <device-id> | status | quit');
}

async function main() {
  if (typeof fetch !== 'function') {
    fail('This simulator needs Node.js 18 or newer (built-in fetch).');
  }

  const options = parseArgs(process.argv.slice(2));

  const devices = [];
  for (let i = 1; i <= options.count; i += 1) {
    const number = String(i).padStart(2, '0');
    devices.push({ id: `device-${number}`, name: `Simulated Device ${number}`, timer: null });
  }
  const devicesById = new Map(devices.map((device) => [device.id, device]));

  log(`Simulator targeting ${BASE_URL} with ${devices.length} devices, heartbeat every ${options.intervalMs / 1000}s`);

  try {
    for (const device of devices) {
      // Sequential registration keeps the output readable.
      // eslint-disable-next-line no-await-in-loop
      await registerDevice(device);
    }
  } catch (err) {
    fail(`Could not register devices. Is the server running at ${BASE_URL}?\n${err.message}`);
  }

  devices.forEach((device) => startDevice(device, options.intervalMs));
  log('all devices sending heartbeats');
  printHelp();

  setTimeout(printFleet, 1000);
  const fleetTimer = setInterval(printFleet, FLEET_PRINT_INTERVAL_MS);

  if (options.stopId) {
    const target = devicesById.get(options.stopId);
    if (!target) {
      log(`--stop: unknown device '${options.stopId}', ignoring`);
    } else {
      log(`${options.stopId} will stop sending heartbeats in ${options.stopAfterMs / 1000}s`);
      setTimeout(() => {
        stopDevice(target);
        log(`STOPPED ${options.stopId} - it should become OFFLINE about 30s after its last heartbeat`);
      }, options.stopAfterMs);
    }
  }

  const rl = readline.createInterface({ input: process.stdin });

  function shutdown() {
    devices.forEach(stopDevice);
    clearInterval(fleetTimer);
    rl.close();
    log('simulator stopped');
    process.exit(0);
  }

  rl.on('line', (line) => {
    const [command, id] = line.trim().split(/\s+/);
    const device = id ? devicesById.get(id) : null;

    if (command === 'stop' || command === 'start') {
      if (!device) {
        log(`unknown device '${id}'`);
      } else if (command === 'stop') {
        log(stopDevice(device) ? `STOPPED ${id}` : `${id} is already stopped`);
      } else {
        log(startDevice(device, options.intervalMs) ? `STARTED ${id}` : `${id} is already running`);
      }
    } else if (command === 'status') {
      printFleet();
    } else if (command === 'quit' || command === 'exit') {
      shutdown();
    } else if (command) {
      printHelp();
    }
  });

  process.on('SIGINT', shutdown);
}

main();