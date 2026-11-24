#!/usr/bin/env python3
"""eb-conntrack-shim: feeds conntrack flow data to the Experience Budget agent.

This kernel (7.0) has CONFIG_NF_CONNTRACK_PROCFS unset, so /proc/net/nf_conntrack
does not exist. The agent reads conntrack-format lines from /run/eb-conntrack/conntrack
(added to its conntrack_paths). This shim polls `conntrack -L` via netlink and writes
the same format there.

For every forwarded flow whose source is a LAN client, it emits two entries so the
agent sees upload and download separately (both attributed to the client device):
  entry 1: original direction  -> src=client dst=remote bytes=<orig bytes>
  entry 2: reply direction     -> src=client dst=remote (ports swapped) bytes=<reply bytes>
Flows sourced by this host itself are skipped (the agent already counts those
via local sockets, and double counting would inflate the host device).
"""
import os
import re
import subprocess
import time

OUT_DIR = "/run/eb-conntrack"
OUT_FILE = os.path.join(OUT_DIR, "conntrack")
SELF_IPS = {"192.168.1.6", "127.0.0.1"}


def parse_line(line: str):
    parts = line.split()
    if len(parts) < 7:
        return None
    # `conntrack -L` (short format) starts with the protocol, while the
    # extended/procfs format has "ipv4 2 <proto>".  UDP entries have no
    # ESTABLISHED/TIME_WAIT state at all, so state must not be a filter.
    proto = parts[0] if parts[0] in ("tcp", "udp", "icmp", "sctp") else (
        parts[2] if len(parts) > 2 and parts[2] in ("tcp", "udp", "icmp", "sctp") else "tcp"
    )
    src = re.search(r"src=(\S+)", line)
    dst = re.search(r"dst=(\S+)", line)
    sport = re.search(r"sport=(\d+)", line)
    dport = re.search(r"dport=(\d+)", line)
    if not (src and dst and sport and dport):
        return None
    bytes_all = [int(b) for b in re.findall(r"bytes=(\d+)", line)]
    pkts_all = [int(p) for p in re.findall(r"packets=(\d+)", line)]
    up_b = bytes_all[0] if bytes_all else 0
    up_p = pkts_all[0] if pkts_all else 0
    down_b = bytes_all[1] if len(bytes_all) > 1 else 0
    down_p = pkts_all[1] if len(pkts_all) > 1 else 0
    return {
        "proto": proto,
        "src": src.group(1),
        "dst": dst.group(1),
        "sport": int(sport.group(1)),
        "dport": int(dport.group(1)),
        "up_b": up_b, "up_p": up_p,
        "down_b": down_b, "down_p": down_p,
    }


def render(tag, f, sport, dport, pkts, bytes_, dirratio):
    return (
        f"ipv4 2 {f['proto']} 6 431999 ESTABLISHED "
        f"src={f['src']} dst={f['dst']} sport={sport} dport={dport} "
        f"packets={pkts} bytes={bytes_} dirratio={dirratio:.3f} shim={tag}\n"
    )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.chmod(OUT_DIR, 0o755)
    while True:
        out = []
        try:
            res = subprocess.run(
                ["conntrack", "-L"], capture_output=True, text=True, timeout=5
            )
            if res.returncode != 0:
                print(f"conntrack -L failed: {res.stderr.strip()}", flush=True)
            for line in res.stdout.splitlines():
                f = parse_line(line)
                if not f:
                    continue
                if f["src"] in SELF_IPS or f["src"].startswith("127."):
                    continue  # local traffic is already counted via ss
                if ":" in f["src"] or ":" in f["dst"]:
                    continue  # IPv6 is not redirected/forwarded by this setup
                total = f["up_b"] + f["down_b"]
                up_ratio = (f["up_b"] / total) if total else 0.5
                out.append(
                    render("up", f, f["sport"], f["dport"], f["up_p"], f["up_b"], up_ratio)
                )
                if f["down_b"] > 0:
                    out.append(
                        render(
                            "down", f, f["dport"], f["sport"], f["down_p"], f["down_b"],
                            1.0 - up_ratio,
                        )
                    )
        except Exception:
            pass
        tmp = OUT_FILE + ".tmp"
        try:
            with open(tmp, "w") as fh:
                fh.writelines(out)
            os.chmod(tmp, 0o644)
            os.replace(tmp, OUT_FILE)
        except Exception:
            pass
        time.sleep(1)


if __name__ == "__main__":
    main()
