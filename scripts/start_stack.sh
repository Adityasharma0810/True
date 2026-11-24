#!/usr/bin/env bash
# Brings up the complete Experience Budget stack in the VM.
# Idempotent: safe to re-run. Saves PIDs to /tmp/eb-pids.
set -u
ROOT=/home/vboxuser/Desktop/truebudget-feat-push-ready
VENV=$ROOT/.venv
TOKEN=${EB_ENFORCER_TOKEN:-}
if [ -z "$TOKEN" ] && [ -s /tmp/eb_enforcer_token ]; then
  TOKEN=$(cat /tmp/eb_enforcer_token)
fi
if [ -z "$TOKEN" ]; then
  TOKEN=$(openssl rand -hex 32)
fi
echo "$TOKEN" > /tmp/eb_enforcer_token && chmod 600 /tmp/eb_enforcer_token
if [ "$(id -u)" = "0" ]; then SUDO=""; else SUDO="sudo -n"; fi

echo "== 1. kernel / firewall setup =="
$SUDO modprobe nf_conntrack
$SUDO sysctl -w net.ipv4.ip_forward=1 >/dev/null
$SUDO sysctl -w net.netfilter.nf_conntrack_acct=1 >/dev/null
$SUDO sysctl -w net.ipv4.conf.all.send_redirects=0 >/dev/null
$SUDO iptables -t nat -C POSTROUTING -s 192.168.1.2 -o enp0s3 -j MASQUERADE 2>/dev/null \
  || $SUDO iptables -t nat -A POSTROUTING -s 192.168.1.2 -o enp0s3 -j MASQUERADE

echo "== 2. relay :7444 =="
if ! ss -tln | grep -q ":7444 "; then
  cd $ROOT && PYTHONPATH=agent nohup $VENV/bin/python -m eb_agent.relay 0.0.0.0 7444 > /tmp/eb-relay.log 2>&1 &
  echo $! > /tmp/eb-pids/relay
fi

echo "== 3. enforcerd (root, gateway) =="
if [ ! -S /run/eb-enforcerd.sock ]; then
  $SUDO env EB_ENFORCERD_SOCKET=/run/eb-enforcerd.sock EB_ENFORCERD_TOKEN=$TOKEN \
    EB_ENFORCERD_MODE=gateway EB_ENFORCERD_SAFE_STATE=/tmp/eb-enforcer-safe-state.json \
    nohup $VENV/bin/python -m eb_agent.enforcer.daemon > /tmp/eb-enforcerd.log 2>&1 &
  echo $! > /tmp/eb-pids/enforcerd
fi

echo "== 4. conntrack shim =="
if ! pgrep -f "conntrack_shim.py" > /dev/null 2>&1; then
  $SUDO mkdir -p /run/eb-conntrack
  $SUDO nohup python3 $ROOT/scripts/eb_conntrack_shim.py > /tmp/eb-shim.log 2>&1 &
  echo $! > /tmp/eb-pids/shim
fi

echo "== 5. ARP redirect -> phone (192.168.1.2) =="
if ! pgrep -f "eb_arp_redirect.py" > /dev/null 2>&1; then
  $SUDO nohup $VENV/bin/python $ROOT/scripts/eb_arp_redirect.py 192.168.1.2 bc:a8:a6:c4:76:c9 \
    > /tmp/eb-arp.log 2>&1 &
  echo $! > /tmp/eb-pids/arp
fi

echo "== 6. agent daemon :7443 (root, gateway) =="
if ! ss -tln | grep -q ":7443 "; then
  $SUDO env EB_DATA_DIR=/tmp/eb-data EB_MODE=gateway \
    EB_RELAY_URL=ws://127.0.0.1:7444 EB_MDNS=1 \
    EB_SOCKET_PATH=/run/eb-enforcerd.sock EB_ENFORCER_TOKEN=$TOKEN \
    EB_CORS_ORIGINS="http://localhost:8443,http://127.0.0.1:8443,http://192.168.1.6:8443,http://10.0.2.15:8443" \
    PYTHONPATH=$ROOT/agent \
    nohup $VENV/bin/python -m eb_agent.api serve > /tmp/eb-agent-gw.log 2>&1 &
  echo $! > /tmp/eb-pids/agent
fi

echo "== 7. frontend :8443 =="
if ! ss -tln | grep -q ":8443 "; then
  NODEBIN=/home/vboxuser/.nvm/versions/node/v24.22.2/bin
  RUNUSER=""
  [ "$(id -u)" = "0" ] && RUNUSER="sudo -u vboxuser"
  $RUNUSER bash -c "cd $ROOT/frontend && setsid nohup $NODEBIN/node node_modules/vite/bin/vite.js --port 8443 --host > /tmp/eb-frontend.log 2>&1 < /dev/null & echo \$! > /tmp/eb-pids/frontend"
fi

echo "== done =="
