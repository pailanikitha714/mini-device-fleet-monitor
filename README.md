# Mini Device Fleet Monitor

A small Node.js/Express service that monitors a fleet of devices. Devices register themselves, then send periodic **heartbeats**. The service tracks the latest heartbeat per device and reports each device as **ONLINE** (heartbeat received within the last 30 seconds) or **OFFLINE**. A simulator is included that runs 5 devices, and lets you stop one to watch it go OFFLINE.

## 1. What the project does

- Register devices (`POST /devices`)
- Receive heartbeats (`POST /devices/{id}/heartbeat`)
- List devices with live status (`GET /devices`, optional `?status=ONLINE|OFFLINE`)
- Get a single device (`GET /devices/{id}`)
- Fleet summary (`GET /summary`)
- ONLINE/OFFLINE is derived automatically from a 30-second heartbeat timeout

## 2. Design / architecture

```
simulator/simulator.js  --HTTP-->  src/server.js   (starts HTTP server, reads env config)
                                        |
                                   src/app.js       (Express routes, HTTP status codes, error handling)
                                    |        |
                     src/validation.js    src/deviceStore.js
                     (request body checks) (in-memory Map + status calculation)
```

Key design decisions:

- **Status is computed on read, not stored.** Each device stores the server time of its last heartbeat. Whenever a device is returned, status is calculated as `now - lastHeartbeatAt <= 30s ? ONLINE : OFFLINE`. There is no background timer, so status can never be stale.
- **Injectable clock.** `DeviceStore` takes a `now()` function. Tests pass a fake clock and advance time instantly, so the 30-second rule is tested without real waiting.
- **`createApp({ store })`** builds the Express app without starting a server. Supertest can test routes directly.
- **In-memory storage** (`Map`). Node.js runs request handlers on a single thread and all store operations are synchronous, so concurrent requests cannot interleave in the middle of an update.

## 3. Prerequisites

- Node.js **18 or newer** (the simulator uses built-in `fetch`)
- npm

## 4. Build

No build/compile step is needed. Install dependencies:

```bash
npm install
```

## 5. Run the application

```bash
npm start
```

The server listens on `http://localhost:3000`.

Optional environment variables:

| Variable               | Default | Description                                |
|------------------------|---------|--------------------------------------------|
| `PORT`                 | `3000`  | HTTP port                                  |
| `HEARTBEAT_TIMEOUT_MS` | `30000` | Time without heartbeat before OFFLINE (ms) |

## 6. Run the simulator

In a **second terminal**, with the server running:

```bash
npm run simulate
```

This registers `device-01` … `device-05`, sends a heartbeat for each every 5 seconds, and prints the fleet status every 10 seconds.

**Stop a device to watch it go OFFLINE.** Type into the simulator terminal and press Enter:

```
stop device-03
```

About 30 seconds later, the fleet line shows `device-03:OFFLINE`. Type `start device-03` to bring it back. Other commands are `status` and `quit`.

Or stop a device automatically:

```bash
npm run simulate -- --stop device-03 --stop-after 20
```

Other options: `--count <n>` (number of devices, default 5), `--interval <seconds>` (default 5). Point the simulator at another server with `BASE_URL=http://host:port npm run simulate`.

## 7. Run the tests

```bash
npm test
```

Tests (Jest + Supertest):

- `tests/deviceStore.test.js`: unit tests for registration, heartbeats, status calculation, summary, filtering, and the timeout boundary.
- `tests/api.test.js`: HTTP tests for every endpoint, covering validation errors (400), unknown devices (404), duplicates (409), malformed JSON, and the 30-second ONLINE/OFFLINE behaviour using a fake clock.

## 8. Example API requests

```bash
# Register
curl -X POST http://localhost:3000/devices \
  -H "Content-Type: application/json" \
  -d '{"id":"device-01","name":"Lab Device 01"}'

# Heartbeat
curl -X POST http://localhost:3000/devices/device-01/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"timestamp":"2026-09-21T10:30:00Z","status":"OK","cpu_usage":42,"signal_strength":-71}'

# List all devices / only offline devices
curl http://localhost:3000/devices
curl "http://localhost:3000/devices?status=OFFLINE"

# Device details
curl http://localhost:3000/devices/device-01

# Fleet summary
curl http://localhost:3000/summary
```

Example device response:

```json
{
  "id": "device-01",
  "name": "Lab Device 01",
  "status": "ONLINE",
  "last_heartbeat": "2026-09-24T09:15:02.123Z",
  "reported_timestamp": "2026-09-21T10:30:00Z",
  "reported_status": "OK",
  "cpu_usage": 42,
  "signal_strength": -71,
  "registered_at": "2026-09-24T09:14:58.001Z"
}
```

Example summary response:

```json
{ "total": 5, "online": 4, "offline": 1 }
```

Error responses are JSON, e.g. `{ "error": "Device 'x' not found" }`.

| Situation                                   | Status |
|---------------------------------------------|--------|
| Device registered                           | 201    |
| Invalid body / invalid JSON / bad filter    | 400    |
| Unknown device or route                     | 404    |
| Device id already registered                | 409    |

## 9. Assumptions

- **ONLINE/OFFLINE is based on when the server received the heartbeat**, not on the device-supplied `timestamp`. Device clocks may be wrong or skewed, and the requirement talks about heartbeats *received*. The device's timestamp is kept and returned as `reported_timestamp`.
- `last_heartbeat` is the server receive time (ISO 8601, UTC).
- A heartbeat exactly 30 s old is still ONLINE. More than 30 s is OFFLINE.
- A registered device that has never sent a heartbeat is OFFLINE.
- All heartbeat fields are optional. `timestamp` defaults to the receive time and `status` defaults to `"OK"`. The reported `status` (e.g. `"ERROR"`) is stored but does not affect ONLINE/OFFLINE.
- Registering an existing id returns `409` rather than overwriting it.
- Device ids may only contain letters, numbers, `-` and `_` (max 64 chars), so they are always URL-safe.

## 10. Known limitations

- Data is in memory only and is lost when the server restarts.
- Single instance only; state is not shared between multiple server processes.
- No authentication: any client can register devices or send heartbeats.
- Only the latest heartbeat is kept (no history).
- No endpoints to update or delete devices, and no pagination for large fleets.

## 11. What I would improve with one more day

- Persistent storage (SQLite or Redis), keeping heartbeat history
- API keys per device so only a device can send its own heartbeats
- OpenAPI/Swagger documentation
- Dockerfile and docker-compose (server + simulator)
- Structured logging (e.g. pino) and a `/health` endpoint
- Delete/update device endpoints and pagination
- A small web dashboard that auto-refreshes fleet status
- Notifications/webhooks when a device changes between ONLINE and OFFLINE

## AI Usage

- **Tools used:** Claude (Anthropic).
- **What for:** generating the initial project structure, Express routes, the in-memory store, the simulator, the Jest/Supertest tests, and a first draft of this README.
- **Changed / rejected:** I did not base ONLINE/OFFLINE on the `timestamp` field sent by the device, because a device with a wrong clock would be reported incorrectly. The status uses the server's receive time instead, and the device timestamp is stored separately as `reported_timestamp`. I also avoided tests that `sleep` for 30 real seconds. Instead, the store takes an injectable clock, so the timeout is tested instantly and deterministically.
- **Personally verified:** I ran `npm test` and confirmed all tests pass. I ran the server and the simulator, stopped `device-03`, and saw it change to OFFLINE in `/devices` and `/summary` about 30 seconds after its last heartbeat. I then restarted it and saw it return to ONLINE.