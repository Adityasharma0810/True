"""Device discovery scope: hotspot/LAN only, never a wide shared network.

These tests exercise the interface-selection and neighbour-filtering helpers
directly.  They never inject synthetic device rows into production state.
"""

from __future__ import annotations

import subprocess
from types import SimpleNamespace

import pytest

from eb_agent import core as core_module
from eb_agent.config import AgentConfig
from eb_agent.core import _household_scope, _read_neighbors


def test_shared_private_lan_is_discovered(monkeypatch: pytest.MonkeyPatch) -> None:
    """The agent may itself be a client on a laptop/phone hotspot /24."""

    monkeypatch.setattr(core_module, "_hotspot_interfaces", lambda: [])
    monkeypatch.setattr(core_module, "_ipv4_forwarding_enabled", lambda: False)
    monkeypatch.setattr(core_module, "_interface_ipv4", lambda ifname: "192.168.1.6")
    monkeypatch.setattr(
        core_module, "_local_subnets", lambda ifnames=None: [("192.168.1.6", 24)]
    )
    household, hotspot, lan, mode = _household_scope(AgentConfig(), "enp0s3")
    assert household == ["enp0s3"]
    assert hotspot == []
    assert lan == []
    assert mode == "shared"


def test_wide_shared_network_stays_out_of_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A /16 lab NAT must not turn every unrelated host into a device."""

    monkeypatch.setattr(core_module, "_hotspot_interfaces", lambda: [])
    monkeypatch.setattr(core_module, "_ipv4_forwarding_enabled", lambda: False)
    monkeypatch.setattr(core_module, "_interface_ipv4", lambda ifname: "10.80.93.151")
    monkeypatch.setattr(
        core_module, "_local_subnets", lambda ifnames=None: [("10.80.93.151", 16)]
    )
    household, hotspot, lan, mode = _household_scope(AgentConfig(), "enp0s3")
    assert household == []
    assert hotspot == []
    assert lan == []
    assert mode == "host-only"


def test_neighbours_are_filtered_by_interface(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_run(cmd, **kwargs):
        assert cmd[:3] == ["ip", "-j", "neigh"]
        return SimpleNamespace(
            returncode=0,
            stdout=(
                '[{"dst":"192.168.1.2","lladdr":"bc:a8:a6:c4:76:c9",'
                '"state":["REACHABLE"],"dev":"enp0s3"},'
                '{"dst":"10.80.0.11","lladdr":"00:00:5e:00:01:02",'
                '"state":["REACHABLE"],"dev":"enp0s8"}]'
            ),
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    only_hotspot = _read_neighbors({"enp0s3"})
    assert [n["ip"] for n in only_hotspot] == ["192.168.1.2"]
    assert _read_neighbors({"enp0s8"})[0]["ip"] == "10.80.0.11"
    assert len(_read_neighbors()) == 2
