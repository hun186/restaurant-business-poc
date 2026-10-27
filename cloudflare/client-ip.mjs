// Strict, portable canonicalization for Cloudflare's single CF-Connecting-IP value.
// This validates only the syntax/equivalence of an IP literal; it CANNOT prove
// the header was supplied by Cloudflare. Live proxy provenance is a separate gate.
const normalizedV4 = raw => {
  if (typeof raw !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(raw)) return null;
  const bytes = raw.split('.');
  if (bytes.some(s => (s.length > 1 && s[0] === '0') || Number(s) > 255)) return null;
  return bytes.join('.');
};

export function canonicalCloudflareClientIp(raw) {
  if (typeof raw !== 'string' || raw.length < 3 || raw.length > 45 ||
      raw !== raw.trim()) return null;
  if (!raw.includes(':')) {
    const v4 = normalizedV4(raw);
    return v4 === null ? null : '4:' + v4;
  }

  // Reject mixed dotted IPv6 forms except explicitly IPv4-mapped addresses.
  // Prevent implicit URL host parsing of unusual/octal IPv4 spellings.
  if (raw.includes('.')) {
    const mapped = /^::ffff:(.+)$/i.exec(raw);
    if (!mapped) return null;
    const v4 = normalizedV4(mapped[1]);
    return v4 === null ? null : '4:' + v4;
  }
  if (!/^[a-fA-F0-9:]+$/.test(raw)) return null;
  try {
    // WHATWG URL canonicalizes equivalent compressed/expanded IPv6 spellings.
    // Square brackets are added ONLY after the original literal is validated.
    const host = new URL('http://[' + raw + ']/').hostname;
    if (!/^\[[0-9a-f:]+\]$/.test(host)) return null;
    const canon = host.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canon);
    if (mapped) {
      const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
      return '4:' + [hi >>> 8, hi & 255, lo >>> 8, lo & 255].join('.');
    }
    return '6:' + canon;
  } catch {
    return null;
  }
}
