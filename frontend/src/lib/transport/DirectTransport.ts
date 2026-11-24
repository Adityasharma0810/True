import { RelayTransport, defaultAgentHttpUrl } from "./RelayTransport";

/**
 * Direct LAN transport: connects to the agent's HTTP(S) endpoint with a
 * bearer session token.  The pairing-link TLS fingerprint is pinned when the
 * agent serves HTTPS; browsers still enforce HTTPS/mixed-content rules, so a
 * plain-HTTP page can only talk to a loopback agent.
 */
export class DirectTransport extends RelayTransport {
  constructor(fingerprint?: string, agentHost?: string) {
    let raw =
      agentHost ||
      import.meta.env?.VITE_AGENT_HTTP_URL ||
      defaultAgentHttpUrl();
    // A loopback agent address can only work when the page itself is on
    // loopback: "localhost" inside a phone or laptop browser resolves to that
    // device, where no agent exists.  Saved agents can carry a stale loopback
    // URL (e.g. paired while the console ran inside the VM), so sanitise every
    // path — explicit host, env override, or default — before use.
    let host = raw.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    try {
      host = new URL(raw).hostname;
    } catch {
      /* keep the raw string; the scheme normalisation below handles it */
    }
    const pageLoopback =
      typeof location !== "undefined" &&
      ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(location.hostname);
    if (
      !pageLoopback &&
      ["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"].includes(host)
    ) {
      raw = defaultAgentHttpUrl();
    }
    // The pairing form collects a bare ``host:port``; browsers need an
    // explicit scheme, so default it to http unless one was provided.
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const httpUrl = withScheme.replace(/\/$/, "");
    super({ mode: "direct", httpUrl, fingerprint });
  }

  async connect(key: string): Promise<unknown> {
    const url = new URL(this.agentHttpUrl);
    const page = typeof location !== "undefined" ? location : null;
    const loopback = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(
      url.hostname,
    );
    if (url.protocol === "https:" && page && page.protocol !== "https:" && !loopback) {
      throw new Error("Direct LAN requires a secure (HTTPS) page context.");
    }
    return super.connect(key);
  }

  get isDirect(): boolean {
    return true;
  }
}
