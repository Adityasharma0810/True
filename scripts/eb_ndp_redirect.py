#!/usr/bin/env python3
"""eb-ndp-redirect: routes a LAN client's IPv6 traffic through this VM.

Sends unicast Neighbor Advertisements to the target client, claiming the
IPv6 default router's link-local address is at this VM's MAC.  The VM
forwards the client's IPv6 traffic to the real router and MASQUERADEs it,
so the client's flows appear in conntrack and can be measured.

It also records the client's global IPv6 source addresses in
/run/eb-conntrack/phone_ipv6 (and its link-local in phone_ipv6_ll) so the
conntrack shim can attribute those flows to the client's known address.

Restore = stop this process; the client re-resolves the real router's
link-layer address within seconds.  IPv4 handling is in eb_arp_redirect.py.
"""
import os
import re
import subprocess
import sys
import threading
import time

from scapy.all import (
    Ether,
    ICMPv6ND_NA,
    ICMPv6ND_NS,
    ICMPv6NDOptDstLLAddr,
    IPv6,
    get_if_hwaddr,
    sendp,
    sniff,
)

IFACE = "enp0s3"
TARGET_IP = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.2"
TARGET_MAC = (sys.argv[2] if len(sys.argv) > 2 else "bc:a8:a6:c4:76:c9").lower()
OUT_DIR = "/run/eb-conntrack"
GLOBAL_FILE = os.path.join(OUT_DIR, "phone_ipv6")
LL_FILE = os.path.join(OUT_DIR, "phone_ipv6_ll")


def _run(cmd: list[str]) -> str:
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=5, check=False
        )
        return result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def _router_ll() -> str | None:
    out = _run(["ip", "-6", "route", "show", "default"])
    match = re.search(r"via\s+(fe80:[0-9a-f:]+)", out)
    if match:
        return match.group(1)
    out = _run(["ip", "-6", "neigh", "show", "dev", IFACE])
    for line in out.splitlines():
        if line.startswith("fe80:") and "router" in line:
            return line.split()[0]
    return None


def _target_ll() -> str | None:
    out = _run(["ip", "-6", "neigh", "show", "dev", IFACE])
    for line in out.splitlines():
        if line.startswith("fe80:") and TARGET_MAC in line.lower():
            return line.split()[0]
    return None


def _write(path: str, text: str) -> None:
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except OSError:
        pass


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    os.chmod(OUT_DIR, 0o755)
    vm_mac = get_if_hwaddr(IFACE)
    state = {"router_ll": _router_ll(), "target_ll": _target_ll()}
    print(
        f"ndp-redirect: iface={IFACE} router_ll={state['router_ll']} "
        f"target={TARGET_IP} target_mac={TARGET_MAC} "
        f"target_ll={state['target_ll']} vm_mac={vm_mac}",
        flush=True,
    )
    if state["target_ll"]:
        _write(LL_FILE, state["target_ll"] + "\n")

    lock = threading.Lock()
    seen_global: list[str] = []

    def refresh() -> None:
        while True:
            with lock:
                router = _router_ll() or state["router_ll"]
                target = _target_ll() or state["target_ll"]
                if router:
                    state["router_ll"] = router
                if target:
                    state["target_ll"] = target
                    _write(LL_FILE, target + "\n")
            time.sleep(3)

    def poison() -> None:
        while True:
            with lock:
                router = state["router_ll"]
                target = state["target_ll"]
            if router and target:
                packet = (
                    Ether(dst=TARGET_MAC, src=vm_mac)
                    / IPv6(src=router, dst=target)
                    / ICMPv6ND_NA(tgt=router, R=0, S=0, O=1)
                    / ICMPv6NDOptDstLLAddr(lladdr=vm_mac)
                )
                sendp(packet, iface=IFACE, verbose=False)
            time.sleep(2)

    def handle(packet) -> None:
        if IPv6 not in packet or packet[Ether].src.lower() != TARGET_MAC:
            return
        ip6 = packet[IPv6]
        # Record the client's global (non-link-local) source addresses so
        # the shim can attribute its forwarded flows to the phone.
        if ip6.src and not ip6.src.startswith("fe80:") and ip6.src != "::":
            with lock:
                if ip6.src not in seen_global:
                    seen_global.append(ip6.src)
                    del seen_global[:-16]
                    _write(GLOBAL_FILE, "\n".join(seen_global) + "\n")
        if ICMPv6ND_NS in packet:
            ns = packet[ICMPv6ND_NS]
            with lock:
                router = state["router_ll"]
            if router and ns.tgt == router:
                reply = (
                    Ether(dst=packet[Ether].src, src=vm_mac)
                    / IPv6(src=router, dst=ip6.src)
                    / ICMPv6ND_NA(tgt=router, R=0, S=1, O=1)
                    / ICMPv6NDOptDstLLAddr(lladdr=vm_mac)
                )
                sendp(reply, iface=IFACE, verbose=False)

    threading.Thread(target=refresh, daemon=True).start()
    threading.Thread(target=poison, daemon=True).start()
    sniff(iface=IFACE, filter="arp or ip6", prn=handle, store=False)


if __name__ == "__main__":
    main()
