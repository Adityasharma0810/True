import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Search,
  LayoutGrid,
  List,
  Pencil,
  ArrowUpRight,
  Check,
  Laptop,
  Wifi,
  Users,
  ShieldAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import { dateTime, classLabel } from "../../lib/format";
import { useConsole } from "../../app/Layout";
import { useApi } from "../../lib/api";
import {
  SectionHeading,
  CardHeader,
  Button,
  Badge,
  DeviceIcon,
  QoEBadge,
  TrafficIcon,
  Modal,
  useTask,
  EmptyState,
  ErrorState,
} from "../../components/ui";
import { Sparkline } from "../../components/Chart";
import type { Device, MetricPoint } from "../../types";
function DeviceSparkline({ deviceId }: { deviceId: string }) {
  // Real per-device history: the agent records each device's own measured
  // throughput every tick, so this chart is that device, not a share of WAN.
  const { data: points = [] } = useApi<MetricPoint[]>(
    `/metrics?range=1h&device=${encodeURIComponent(deviceId)}`,
    { refetchInterval: 5000 },
  );
  const active = points.some((p) => p.throughput > 0);
  return (
    <Sparkline
      points={points.slice(-40).map((p) => p.throughput)}
      color={active ? "#8aa7e5" : "#c3ccdc"}
    />
  );
}

export default function Devices() {
  const { snapshot } = useConsole();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [view, setView] = useState("cards");
  const [edit, setEdit] = useState<Device | null>(null);
  const [detail, setDetail] = useState<Device | null>(null);
  const [name, setName] = useState("");
  const [person, setPerson] = useState("");
  const task = useTask("Device details updated.");
  const onlineCount = snapshot.devices.filter((d) => d.online !== false).length;
  const devices = snapshot.devices
    .filter(
      (d) =>
        (filter === "all" || (filter === "active" ? d.flows.length > 0 : d.flows.length === 0)) &&
        `${d.name} ${d.person}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => (sort === "qoe" ? (b.qoe ?? 0) - (a.qoe ?? 0) : a.name.localeCompare(b.name)));
  function openEdit(d: Device) {
    setEdit(d);
    setName(d.name);
    setPerson(d.person ?? "");
  }
  return (
    <>
      <SectionHeading
        title="The people behind the packets."
        description="Familiar devices. Different needs. One thoughtful connection."
      >
        <Badge tone="blue">
          <Wifi size={11} />
          {onlineCount} online · {snapshot.devices.length} known
        </Badge>
      </SectionHeading>
      {snapshot.scope && (
        <div className="info-banner">
          {snapshot.scope.mode === "host-only" ? (
            <ShieldAlert size={20} />
          ) : (
            <Wifi size={20} />
          )}
          <p>
            {snapshot.scope.mode === "host-only" ? (
              <>
                <strong>Only this host is visible.</strong> No hotspot or LAN
                interface was detected on this machine, so unrelated devices on
                the shared network are deliberately hidden. Start the agent on
                the laptop whose hotspot your phone uses (or set{" "}
                <code>EB_LAN_INTERFACES</code>) to see the phone and its live
                metrics.
              </>
            ) : (
              <>
                <strong>
                  {snapshot.scope.mode === "hotspot"
                    ? "Hotspot discovery"
                    : snapshot.scope.mode === "shared"
                      ? "Hotspot / shared LAN discovery"
                      : "LAN discovery"}
                  {snapshot.scope.householdInterfaces.length
                    ? ` · ${snapshot.scope.householdInterfaces.join(", ")}`
                    : ""}
                  .
                </strong>{" "}
                Showing only clients connected to this machine
                {snapshot.scope.mode === "hotspot"
                  ? "’s hotspot"
                  : snapshot.scope.mode === "shared"
                    ? " on the shared hotspot LAN (the gateway itself is excluded)"
                    : "’s household side"}
                , with live ICMP latency, jitter and loss per device.
              </>
            )}
          </p>
        </div>
      )}
      <div className="filter-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Search devices"
            placeholder="Find a device or person…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Device status filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All devices</option>
          <option value="active">Active</option>
          <option value="idle">Idle</option>
        </select>
        <select aria-label="Sort devices" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">Sort by name</option>
          <option value="qoe">Sort by QoE</option>
        </select>
        <span className="toolbar-spacer" />
        <div className="segmented-control">
          <button
            aria-label="Card view"
            className={view === "cards" ? "active" : ""}
            onClick={() => setView("cards")}
          >
            <LayoutGrid size={13} />
          </button>
          <button
            aria-label="Table view"
            className={view === "table" ? "active" : ""}
            onClick={() => setView("table")}
          >
            <List size={13} />
          </button>
        </div>
      </div>
      {!devices.length ? (
        <div className="card">
          <EmptyState
            title="No devices found"
            description="Try another name, person or status filter."
          />
        </div>
      ) : view === "cards" ? (
        <motion.div className="devices-grid" layout>
          <AnimatePresence>
            {devices.map((d) => (
              <motion.article
                className="card device-card clickable"
                key={d.id}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                onClick={() => setDetail(d)}
                role="button"
                tabIndex={0}
                aria-label={`Show details for ${d.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetail(d);
                  }
                }}
              >
                <div className="row-between">
                  <span className="device-card-icon">
                    <DeviceIcon device={d} size={27} />
                  </span>
                  <QoEBadge band={d.band} score={d.qoe} small />
                </div>
                {d.qoeWarn && (
                  <div
                    className="qoe-warn-line"
                    title={`Trained QoE early warning (LightGBM, ${d.qoeWarn.horizonS ?? 10}s horizon, source: ${d.qoeWarn.source})`}
                  >
                    <ShieldAlert
                      size={12}
                      color={d.qoeWarn.alert ? "var(--red, #d64545)" : "var(--muted-fg, #8a8f98)"}
                    />
                    <span>
                      {d.qoeWarn.state === "red"
                        ? "Degraded now"
                        : d.qoeWarn.alert
                          ? `At risk · p(red in ${d.qoeWarn.horizonS ?? 10}s) ${Math.round((d.qoeWarn.pRed ?? 0) * 100)}%`
                          : `Stable · p(red) ${Math.round((d.qoeWarn.pRed ?? 0) * 100)}%`}
                    </span>
                  </div>
                )}
                <h2>{d.name}</h2>
                <p>
                  <Users size={12} />
                  {d.person || "Unassigned"} <span>·</span> {d.type}
                </p>
                <div className="device-card-metrics">
                  <div>
                    <strong>
                      {d.flows.reduce((n, f) => n + f.throughputMbps, 0).toFixed(1)}
                      <span>Mbps</span>
                    </strong>
                    <small>{d.flows.length} active experiences</small>
                  </div>
                  <DeviceSparkline deviceId={d.id} />
                </div>
                <div className="device-card-classes">
                  {Object.entries(
                    d.flows.reduce<Record<string, number>>((acc, f) => {
                      acc[f.cls] = (acc[f.cls] ?? 0) + 1;
                      return acc;
                    }, {}),
                  ).map(([cls, count]) => (
                    <span
                      className={`traffic-class class-${cls}`}
                      title={`${classLabel(cls)} · ${count} flow${count > 1 ? "s" : ""}`}
                      key={cls}
                    >
                      <TrafficIcon cls={cls} />
                      {classLabel(cls)}
                      {count > 1 ? ` ×${count}` : ""}
                    </span>
                  ))}
                  {!d.flows.length && (
                    <span className="muted">
                      {d.online === false ? "Offline · last seen recently" : "Resting, not disconnected."}
                    </span>
                  )}
                </div>
                {(d.latencyMs != null ||
                  d.jitterMs != null ||
                  d.lossPct != null ||
                  d.signalDbm != null) && (
                  <div className="device-live-metrics">
                    {d.latencyMs != null && (
                      <span title="ICMP round-trip latency">
                        RTT <strong>{d.latencyMs.toFixed(1)} ms</strong>
                      </span>
                    )}
                    {d.jitterMs != null && (
                      <span title="ICMP jitter (max − avg)">
                        Jitter <strong>{d.jitterMs.toFixed(1)} ms</strong>
                      </span>
                    )}
                    {d.lossPct != null && (
                      <span title="ICMP packet loss">
                        Loss <strong>{d.lossPct.toFixed(0)}%</strong>
                      </span>
                    )}
                    {d.signalDbm != null && d.signalDbm !== 0 && (
                      <span title="Wi-Fi signal reported by the AP">
                        Signal <strong>{d.signalDbm.toFixed(0)} dBm</strong>
                      </span>
                    )}
                  </div>
                )}
                <footer>
                  <code>{d.ip?.replace(/\.\d+$/, ".•••")}</code>
                  <button
                    className="text-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(d);
                    }}
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <Link
                    to={`/app/tree?device=${d.id}`}
                    className="text-link"
                    aria-label={`Inspect ${d.name}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ArrowUpRight size={14} />
                  </Link>
                </footer>
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="card table-scroll">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Person</th>
                <th>Throughput</th>
                <th>RTT</th>
                <th>Loss</th>
                <th>QoE proxy</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>
                    <button
                      className="table-device"
                      onClick={() => setDetail(d)}
                      aria-label={`Show details for ${d.name}`}
                    >
                      <span className="table-device-icon">
                        <DeviceIcon device={d} size={17} />
                      </span>
                      <div>
                        <strong>{d.name}</strong>
                        <small>{d.ip?.replace(/\.\d+$/, ".•••")}</small>
                      </div>
                    </button>
                  </td>
                  <td>{d.person || "Unassigned"}</td>
                  <td className="mono">
                    {d.flows.reduce((n, f) => n + f.throughputMbps, 0).toFixed(1)} Mbps
                  </td>
                  <td className="mono">
                    {d.latencyMs == null ? "—" : `${d.latencyMs.toFixed(1)} ms`}
                  </td>
                  <td className="mono">
                    {d.lossPct == null ? "—" : `${d.lossPct.toFixed(0)}%`}
                  </td>
                  <td>
                    <QoEBadge band={d.band} score={d.qoe} />
                  </td>
                  <td>
                    <Button variant="ghost" onClick={() => openEdit(d)}>
                      <Pencil size={12} /> Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.name ?? "Device"}
      >
        {detail && (
          <div className="device-detail">
            <div className="detail-head">
              <span className="device-card-icon">
                <DeviceIcon device={detail} size={30} />
              </span>
              <div className="detail-head-text">
                <h3>{detail.name}</h3>
                <p className="muted">
                  {detail.person || "Unassigned"} · {detail.type || "LAN device"} ·{" "}
                  {detail.online === false ? "Offline" : "Online"}
                </p>
              </div>
              <QoEBadge band={detail.band} score={detail.qoe} />
            </div>
            {detail.qoeWarn && (
              <div className="qoe-warn-line">
                <ShieldAlert
                  size={12}
                  color={
                    detail.qoeWarn.alert ? "var(--red, #d64545)" : "var(--muted-fg, #8a8f98)"
                  }
                />
                <span>
                  {detail.qoeWarn.state === "red"
                    ? "Degraded now"
                    : detail.qoeWarn.alert
                      ? `At risk · p(red in ${detail.qoeWarn.horizonS ?? 10}s) ${Math.round((detail.qoeWarn.pRed ?? 0) * 100)}%`
                      : `Stable · p(red) ${Math.round((detail.qoeWarn.pRed ?? 0) * 100)}%`}
                </span>
              </div>
            )}
            <div className="detail-stats">
              <div>
                <strong>
                  {detail.flows.reduce((n, f) => n + f.throughputMbps, 0).toFixed(2)}
                  <span>Mbps</span>
                </strong>
                <small>Throughput now</small>
              </div>
              <div>
                <strong>{detail.flows.length}</strong>
                <small>Active flows</small>
              </div>
              <div>
                <strong>{detail.qoe == null ? "—" : (detail.qoe * 100).toFixed(0)}</strong>
                <small>
                  QoE score /100
                  {detail.qoeSource === "icmp_probe" ? " · ICMP proxy" : ""}
                </small>
              </div>
              <div>
                <strong>
                  {detail.latencyMs == null ? "—" : detail.latencyMs.toFixed(1)}
                  <span>ms</span>
                </strong>
                <small>Latency (ICMP)</small>
              </div>
              <div>
                <strong>
                  {detail.jitterMs == null ? "—" : detail.jitterMs.toFixed(1)}
                  <span>ms</span>
                </strong>
                <small>Jitter</small>
              </div>
              <div>
                <strong>
                  {detail.lossPct == null ? "—" : detail.lossPct.toFixed(0)}
                  <span>%</span>
                </strong>
                <small>Packet loss</small>
              </div>
            </div>
            <dl className="detail-meta">
              <div>
                <dt>Address</dt>
                <dd>
                  <code>{detail.ip?.replace(/\.\d+$/, ".•••") || "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Discovered via</dt>
                <dd>{detail.source || "network"}</dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd>{detail.lastSeen ? dateTime(detail.lastSeen) : "—"}</dd>
              </div>
            </dl>
            <h4>Live flows</h4>
            {detail.flows.length ? (
              <div className="table-scroll detail-flows">
                <table>
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Conf.</th>
                      <th>Rate</th>
                      <th>RTT</th>
                      <th>Jitter</th>
                      <th>Loss</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.flows.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <span className={`traffic-class class-${f.cls}`}>
                            <TrafficIcon cls={f.cls} />
                            {classLabel(f.cls)}
                          </span>
                        </td>
                        <td className="mono">{Math.round(f.confidence * 100)}%</td>
                        <td className="mono">{f.throughputMbps.toFixed(2)} Mbps</td>
                        <td className="mono">
                          {f.features.rtt_ms != null ? `${f.features.rtt_ms.toFixed(1)} ms` : "—"}
                        </td>
                        <td className="mono">
                          {f.features.jitter_ms != null
                            ? `${f.features.jitter_ms.toFixed(1)} ms`
                            : "—"}
                        </td>
                        <td className="mono">
                          {f.features.loss_pct != null ? `${f.features.loss_pct.toFixed(1)}%` : "—"}
                        </td>
                        <td>{f.method === "ml" ? "ML model" : "Rules"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">
                No active flows right now. The chart and metrics fill in as soon as this device
                sends or receives traffic through the agent.
              </p>
            )}
            <h4>Other connected devices ({Math.max(0, snapshot.devices.length - 1)})</h4>
            <ul className="detail-others">
              {snapshot.devices
                .filter((o) => o.id !== detail.id)
                .map((o) => (
                  <li key={o.id}>
                    <button
                      className="detail-other-device"
                      onClick={() => setDetail(o)}
                      aria-label={`Show details for ${o.name}`}
                    >
                      <DeviceIcon device={o} size={15} />
                      <span>{o.name}</span>
                      <small className="mono">
                        {o.flows.reduce((n, f) => n + f.throughputMbps, 0).toFixed(1)} Mbps
                      </small>
                      <QoEBadge band={o.band} score={o.qoe} small />
                    </button>
                  </li>
                ))}
              {!snapshot.devices.filter((o) => o.id !== detail.id).length && (
                <li className="muted">No other devices known yet.</li>
              )}
            </ul>
            <div className="modal-footer">
              <Button
                variant="secondary"
                onClick={() => {
                  setDetail(null);
                  openEdit(detail);
                }}
              >
                <Pencil size={12} /> Rename
              </Button>
              <Link
                to={`/app/tree?device=${detail.id}`}
                className="text-link"
                onClick={() => setDetail(null)}
              >
                Inspect in topology <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="A familiar name helps.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!edit) return;
            task.mutate(
              {
                path: `/devices/${encodeURIComponent(edit.id)}`,
                method: "PATCH",
                body: { name, person },
              },
              { onSuccess: () => setEdit(null) },
            );
          }}
        >
          <label className="field-label">
            Device name
            <input value={name} required maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field-label">
            Person
            <input value={person} maxLength={40} onChange={(e) => setPerson(e.target.value)} />
          </label>
          <p className="field-hint">
            Names are stored locally by the agent. Network addresses stay masked in the console.
          </p>
          <div className="modal-footer">
            <Button variant="secondary" type="button" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button type="submit" pending={task.isPending}>
              <Check size={13} /> Save device
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
