# Experience Budget

Experience Budget is an intent-aware QoS/QoE controller for home broadband. It
consists of a **Python Linux agent** (real-time traffic classification, capacity
estimation, QoE scoring, max-min policy, and live gateway enforcement) and a
**React web console** that connects to the agent's local HTTP + WebSocket API in
real time.

---

## ▶️ START EVERYTHING — one command (this VM)

```sh
cd /home/vboxuser/Desktop/truebudget-feat-push-ready
echo '12345' | sudo -S bash scripts/start_stack.sh
```

This single idempotent command starts the **complete stack**. It is safe to
re-run at any time (already-running components are skipped, not duplicated).

### What it starts

| # | Component | Port / path | Log | PID file |
|---|-----------|-------------|-----|----------|
| 1 | Kernel setup (nf_conntrack, IP forwarding, MASQUERADE for the phone) | — | — | — |
| 2 | Relay broker | `:7444` | `/tmp/eb-relay.log` | `/tmp/eb-pids/relay` |
| 3 | Enforcer daemon (root, gateway mode) | `/run/eb-enforcerd.sock` | `/tmp/eb-enforcerd.log` | `/tmp/eb-pids/enforcerd` |
| 4 | Conntrack shim (kernel 7.x has no nf_conntrack procfs) | `/run/eb-conntrack/conntrack` | `/tmp/eb-shim.log` | `/tmp/eb-pids/shim` |
| 5 | ARP redirect (routes the phone 192.168.1.2 through the VM) | — | `/tmp/eb-arp.log` | `/tmp/eb-pids/arp` |
| 6 | Agent daemon (root, gateway mode) | `:7443` | `/tmp/eb-agent-gw.log` | `/tmp/eb-pids/agent` |
| 7 | Web console (Vite dev server, as `vboxuser`) | `:8443` | `/tmp/eb-frontend.log` | `/tmp/eb-pids/frontend` |

### Verify the stack is healthy

```sh
curl -s http://localhost:7444/api/v1/health        # relay  -> {"status":"ok",...}
curl -s http://localhost:7443/api/v1/capabilities  # agent  -> mode + flags
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8443/   # frontend -> 200
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.1.6:8443/ # frontend from LAN -> 200

# Live enforcement (should show ok=True verdict=applied every ~30s):
grep "enforcer apply" /tmp/eb-agent-gw.log | tail -3
```

### Open the console

- From this VM:  <http://localhost:8443>
- From phone / laptop on the hotspot:  <http://192.168.1.6:8443>

### Stop everything

```sh
for f in /tmp/eb-pids/*; do kill "$(cat "$f")" 2>/dev/null; done
sudo rm -f /run/eb-enforcerd.sock
```

---

## ▶️ Start components individually (debugging)

Run from the repo root `/home/vboxuser/Desktop/truebudget-feat-push-ready`.
The enforcer token is shared by the enforcer daemon and the agent — it lives in
`/tmp/eb_enforcer_token` and the stack script creates it if missing.

```sh
# 1. Relay broker (:7444)
PYTHONPATH=agent nohup .venv/bin/python -m eb_agent.relay 0.0.0.0 7444 \
  > /tmp/eb-relay.log 2>&1 &

# 2. Enforcer daemon (must be root)
sudo env EB_ENFORCERD_SOCKET=/run/eb-enforcerd.sock \
  EB_ENFORCERD_TOKEN=$(cat /tmp/eb_enforcer_token) \
  EB_ENFORCERD_MODE=gateway \
  EB_ENFORCERD_SAFE_STATE=/tmp/eb-enforcer-safe-state.json \
  nohup .venv/bin/python -m eb_agent.enforcer.daemon > /tmp/eb-enforcerd.log 2>&1 &

# 3. Conntrack shim (root; kernel 7.x replacement for /proc/net/nf_conntrack)
sudo mkdir -p /run/eb-conntrack
sudo nohup python3 scripts/eb_conntrack_shim.py > /tmp/eb-shim.log 2>&1 &

# 4. ARP redirect for the phone (root; edit IP/MAC if the phone changed)
sudo nohup .venv/bin/python scripts/eb_arp_redirect.py 192.168.1.2 bc:a8:a6:c4:76:c9 \
  > /tmp/eb-arp.log 2>&1 &

# 5. Agent daemon (root, gateway mode, :7443)
sudo env EB_DATA_DIR=/tmp/eb-data EB_MODE=gateway \
  EB_RELAY_URL=ws://127.0.0.1:7444 EB_MDNS=1 \
  EB_SOCKET_PATH=/run/eb-enforcerd.sock \
  EB_ENFORCER_TOKEN=$(cat /tmp/eb_enforcer_token) \
  EB_CORS_ORIGINS="http://localhost:8443,http://127.0.0.1:8443,http://192.168.1.6:8443,http://10.0.2.15:8443" \
  PYTHONPATH=$PWD/agent \
  nohup .venv/bin/python -m eb_agent.api serve > /tmp/eb-agent-gw.log 2>&1 &

# 6. Frontend (Vite dev server, :8443, as vboxuser)
sudo -u vboxuser bash -c 'cd /home/vboxuser/Desktop/truebudget-feat-push-ready/frontend && \
  setsid nohup /home/vboxuser/.nvm/versions/node/v24.22.2/bin/node \
  node_modules/vite/bin/vite.js --port 8443 --host > /tmp/eb-frontend.log 2>&1 < /dev/null &'
```

Or simply start everything with the one command at the top — it runs all six in
the right order with the same environment.

---

## First-time setup (fresh machine)

```sh
cd /home/vboxuser/Desktop/truebudget-feat-push-ready

# Python agent
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e "agent[dev]"

# Frontend
cd frontend && pnpm install && cd ..
```

---

## Pairing (owner session)

Reads and the Intent boost / Conflicts pages work without pairing. For full
owner features (settings, ML training, scenarios, device rename):

```sh
echo '12345' | sudo -S bash -c 'cd /home/vboxuser/Desktop/truebudget-feat-push-ready && \
  EB_DATA_DIR=/tmp/eb-data .venv/bin/python -m eb_agent.cli pair'
```

This prints a single-use key `EB-XXXX-XXXX-XXXX` (valid 15 minutes). Open
`http://<console-host>:8443/connect?key=EB-XXXX-XXXX-XXXX`, choose **Direct
LAN**, and connect. Keys expire — run the command again for a fresh one.

---

## Architecture

| Component | Language | What it does |
|-----------|----------|--------------|
| Agent daemon (`eb_agent.api serve`) | Python + FastAPI | Reads live traffic (conntrack shim, `ss`, `/proc/net/dev`, ping), classifies flows, estimates WAN capacity (Kalman + CUSUM), scores per-device QoE, runs max-min policy, applies HTB/nft enforcement via enforcerd, serves `/api/v1` |
| Relay broker | Python + websockets | E2E-encrypted bridge between browsers and the agent (used by `RelayTransport`) |
| Enforcer daemon (`enforcerd`) | Python, root | Validates and applies tc HTB classes + nft mark rules; refuses unsafe plans |
| Conntrack shim | Python, root | Emits `/run/eb-conntrack/conntrack` from `conntrack -L` (kernel 7.x removed procfs); adds `dirratio` up/down split |
| ARP redirect | Python, root | Answers the gateway's ARP for the phone so its traffic transits the VM and can be classified/shaped |
| Web console | React + Vite | Real-time dashboard: devices, flows, QoE, intents, decisions, conflicts, settings, ML, topology |
| CLI (`eb-agent`) | Node.js | `init`, `pair`, `start`, `stop`, `status`, `doctor`, `config`, `mode`, `sessions`, `rotate-keys`, `update`, `safe-reset`, `export-diagnostics`, `uninstall`, `lab`, `logs` |

## Network facts (this VM)

| Item | Value |
|------|-------|
| VM interface | `enp0s3` = 192.168.1.6/24 (MAC 08:00:27:e9:4d:65) |
| Hotspot gateway | 192.168.1.1 (f4:27:56:46:4a:87) |
| Phone (Device 3) | 192.168.1.2 (bc:a8:a6:c4:76:c9) — ARP-redirected through the VM |
| Other devices | 192.168.1.4, 192.168.1.5 |

---

## CLI commands

```sh
# Pairing & identity
node cli/bin/eb-agent.js init --site-url https://localhost:8443
node cli/bin/eb-agent.js pair --site-url https://localhost:8443

# Agent lifecycle
node cli/bin/eb-agent.js start            # start API daemon on :7443
node cli/bin/eb-agent.js stop             # stop the daemon
node cli/bin/eb-agent.js status           # show daemon status
node cli/bin/eb-agent.js doctor           # verify CAP_NET_ADMIN, modules, binaries
node cli/bin/eb-agent.js safe-reset       # enter safe state (cancel intents, conservative shaping)

# Configuration
node cli/bin/eb-agent.js config get mode
node cli/bin/eb-agent.js mode set lab     # gateway | bridge | lab | monitor

# Security & maintenance
node cli/bin/eb-agent.js sessions         # list active sessions
node cli/bin/eb-agent.js rotate-keys      # rotate agent agreement keys
node cli/bin/eb-agent.js update           # check for updates
node cli/bin/eb-agent.js export-diagnostics
node cli/bin/eb-agent.js uninstall --purge

# Diagnostics
node cli/bin/eb-agent.js lab              # run reproducible netns lab
node cli/bin/eb-agent.js logs             # show agent logs
```

## API endpoints (real-time data)

All endpoints serve live data from the agent core + SQLite store:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/capabilities` | GET | Supported classes, scenarios, formulas |
| `/api/v1/state/snapshot` | GET | Full real-time snapshot (capacity, QoE, devices, flows) |
| `/api/v1/stream` | WS | Live tick/state stream |
| `/api/v1/devices` | GET | Known devices |
| `/api/v1/devices/{id}` | PATCH | Update device name/mac/IP |
| `/api/v1/flows` | GET | Active flows (conntrack + sockets) |
| `/api/v1/flows/{id}/correct` | POST | Label a flow's traffic class |
| `/api/v1/intents` | GET/POST | List/create intents (QoE boosts with floors) — **works unpaired** |
| `/api/v1/intents/{id}` | DELETE | Cancel an intent — **works unpaired** |
| `/api/v1/decisions` | GET | Hash-chained decision log |
| `/api/v1/decisions/verify` | GET | Verify the SHA-256 hash chain |
| `/api/v1/conflicts` | GET | Capacity conflicts with trade-off options |
| `/api/v1/conflicts/{id}/accept\|adjust\|cancel` | POST | Resolve a conflict — **works unpaired** |
| `/api/v1/settings` | GET/PUT | Agent mode, shaping factor, intervals (owner) |
| `/api/v1/ml/*` | GET/POST | Model status, retrain, rollback, corrections |
| `/api/v1/demand/forecast` | GET | Per-class demand forecasts |
| `/api/v1/demand/schedules` | GET/POST/DELETE | Demand forecast schedules |
| `/api/v1/scenarios/{id}` | POST | Start a scenario (owner) |
| `/api/v1/scenarios/stop` | POST | Stop all scenarios (owner) |
| `/api/v1/experiments` | GET/POST | A/B experiment runner (unmanaged vs CAKE vs EB) |
| `/api/v1/federated/status` | GET | Federated learning status |
| `/api/v1/ask` | POST | Local knowledge Q&A (owner) |
| `/api/v1/dev/control` | GET/PATCH | Dev fault simulation (owner) |
| `/api/v1/dev/reset` | DELETE | Reset dev control flags (owner) |

## Tests

```sh
# Agent (fast unit tests, no netns) — 224 tests
cd agent && ../.venv/bin/python -m pytest -q -m "not netns"

# Agent (netns integration, via unshare)
cd agent && unshare -Urn env PYTHONPATH=agent ../.venv/bin/python -m pytest -m netns

# Frontend
cd frontend && pnpm typecheck && pnpm test && pnpm build
```

## Lab (reproducible, no root required)

```sh
make agent-install
make lab-demo          # 4 devices x 2 controllers -> reports/lab/baseline.csv
make reset-lab
make test-agent
make test-netns
```

The lab runs inside an unprivileged user+network namespace (`unshare -Urn`) —
no `sudo` or `CAP_NET_ADMIN` on the host is required.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EB_DATA_DIR` | `/var/lib/eb-agent` | Agent SQLite data directory (`/tmp/eb-data` in this VM — **wiped on reboot**) |
| `EB_MODE` | `monitor` | `gateway` in this VM (enforcement enabled) |
| `EB_RELAY_URL` | `ws://127.0.0.1:7444` | Relay WebSocket for the bridge |
| `EB_ENFORCER_TOKEN` | generated | Shared secret between agent and enforcerd (`/tmp/eb_enforcer_token`) |
| `EB_SOCKET_PATH` | `/run/eb-enforcerd.sock` | Enforcer daemon Unix socket |
| `EB_CORS_ORIGINS` | `*` | Allowed browser origins (bearer-token auth, no cookies) |
| `VITE_TRANSPORT` | `relay` | Frontend transport: `relay` or `direct` |
| `VITE_RELAY_URL` | `ws://localhost:7443/stream` | Relay WebSocket URL |
| `VITE_AGENT_HTTP_URL` | `http://localhost:7443` | Agent HTTP API URL |

## Troubleshooting

**After a VM reboot:** `/tmp` is wiped (data dir, token, PID files, logs). Just
re-run the one-command start. History restarts empty and rebuilds from live
traffic; the agent gets a new identity, so old pairing keys/links are invalid.

**`unauthorized: invalid token` in the enforcer log:** the agent and enforcerd
hold different tokens (can happen after partial restarts). Kill both, then
re-run `scripts/start_stack.sh` — it reuses one token for both.

```sh
sudo pkill -f "eb_agent.api serve"
sudo pkill -f "enforcer.daemon"
echo '12345' | sudo -S bash scripts/start_stack.sh
```

**Frontend port busy / stale build:** the Vite dev server hot-reloads from
`frontend/src` — no rebuild needed. If :8443 is stuck, kill the PID in
`/tmp/eb-pids/frontend` and re-run the stack script.

## Data integrity

Production telemetry is **measured live** — metrics come from the conntrack
shim, `ss`, `/proc/net/dev`, and ping. No mock transport ships in the console.
Synthetic data is confined to the lab: scenario targets, the deterministic
classifier training set, and seeded A/B experiment results are labelled in the
UI. The dev control panel simulates fault conditions against the live backend
for testing; it does not fabricate metrics.
