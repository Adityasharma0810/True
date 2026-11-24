#!/usr/bin/env python3
"""eb-arp-redirect: makes hotspot/LAN clients route their internet traffic
through this VM so the Experience Budget agent can measure per-device flows.

Answers ARP "who-has <GATEWAY_IP>" only from the target client with this VM's
MAC (and refreshes with unicast gratuitous ARPs), so the client sends its
internet packets to the VM. The VM forwards + MASQUERADES them out enp0s3.
Everything else on the LAN is untouched. Restore = stop this process and the
client re-resolves the real gateway MAC within seconds.
"""
import sys
import threading
import time

from scapy.all import ARP, Ether, conf, get_if_hwaddr, sendp, sniff

IFACE = "enp0s3"
GATEWAY_IP = "192.168.1.1"
TARGET_IP = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.2"
TARGET_MAC = sys.argv[2] if len(sys.argv) > 2 else "bc:a8:a6:c4:76:c9"


def main():
    vm_mac = get_if_hwaddr(IFACE)
    print(f"arp-redirect: iface={IFACE} gateway={GATEWAY_IP} "
          f"target={TARGET_IP} claiming mac={vm_mac}", flush=True)

    def poison(_=None):
        # unicast gratuitous ARP to the target only: gateway IP is at VM's MAC
        pkt = (
            Ether(dst=TARGET_MAC, src=vm_mac)
            / ARP(op=2, pdst=TARGET_IP, psrc=GATEWAY_IP, hwdst=TARGET_MAC, hwsrc=vm_mac)
        )
        sendp(pkt, iface=IFACE, verbose=False)

    def handle(pkt):
        if ARP not in pkt:
            return
        arp = pkt[ARP]
        if arp.op != 1:  # who-has only
            return
        if arp.pdst != GATEWAY_IP:
            return
        requester_ip = arp.psrc
        if requester_ip != TARGET_IP:
            return
        reply = (
            Ether(dst=arp.hwsrc, src=vm_mac)
            / ARP(op=2, pdst=GATEWAY_IP, psrc=GATEWAY_IP, hwdst=arp.hwsrc, hwsrc=vm_mac)
        )
        sendp(reply, iface=IFACE, verbose=False)

    stop = threading.Event()

    def refresh_loop():
        while not stop.is_set():
            poison()
            time.sleep(3)

    threading.Thread(target=refresh_loop, daemon=True).start()
    sniff(iface=IFACE, filter="arp", prn=handle, store=False)


if __name__ == "__main__":
    main()
