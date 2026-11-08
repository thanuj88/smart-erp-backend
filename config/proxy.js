/**
 * Express "trust proxy" setting from TRUST_PROXY.
 *
 * Unset: trust nothing. req.ip is the socket address and X-Forwarded-For is ignored, so a caller
 * cannot choose the IP that audit logs and rate limits see.
 * Number (hops): trust that many proxies in front of the app, e.g. 1 for one load balancer.
 * Name or address list: "loopback", "uniquelocal", "10.0.0.0/8, 192.168.1.5".
 * "true" is refused. It trusts every hop, which lets any client spoof its address.
 */
const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const ADDRESS = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f]*:[0-9a-f:.]*)(\/\d{1,3})?$/i;

function resolveTrustProxy(env = process.env) {
  const raw = String(env.TRUST_PROXY ?? '').trim();
  if (!raw) return { value: false };

  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    return hops === 0 ? { value: false } : { value: hops };
  }

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const valid = parts.length > 0 && parts.every((p) => KEYWORDS.has(p.toLowerCase()) || ADDRESS.test(p));
  if (!valid) {
    return {
      value: false,
      warning: `TRUST_PROXY="${raw}" is not a hop count, keyword or address list. Ignoring it; client IPs are not taken from proxy headers.`,
    };
  }
  return { value: parts.map((p) => (KEYWORDS.has(p.toLowerCase()) ? p.toLowerCase() : p)) };
}

module.exports = { resolveTrustProxy };
