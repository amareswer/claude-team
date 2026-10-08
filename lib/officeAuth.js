import crypto from "crypto";

// Access control for the office server, which can spawn processes and feed
// keystrokes to live terminals. Binding to 127.0.0.1 is not enough: any web
// page open in the user's browser can fire requests/WebSockets at localhost
// (CSRF, DNS rebinding). So every request must:
//   1. carry an allowed Host header (defeats DNS rebinding),
//   2. if it carries an Origin, match the server's own origin (defeats
//      cross-site requests and cross-site WebSockets),
//   3. present the per-run secret — handed to the browser once through the
//      launch URL (?key=...) and then kept in a SameSite=Strict HttpOnly cookie.

export function createOfficeAuth(port) {
  const secret = crypto.randomBytes(24).toString("hex");
  const cookieName = `office_key_${port}`;
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  const safeEqual = (a, b) => {
    const x = Buffer.from(String(a ?? ""));
    const y = Buffer.from(String(b ?? ""));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  function parseCookies(header = "") {
    const out = {};
    for (const part of header.split(";")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  return {
    secret,
    launchUrl: (base) => `${base}/?key=${secret}`,
    hostOk: (req) => hosts.has(String(req.headers.host || "").toLowerCase()),
    // Browsers send Origin on cross-site requests and all WebSocket
    // handshakes; a mismatch is always rejected. Absent Origin (same-origin
    // GET, curl) is allowed here — the secret still gates it.
    originOk: (req) => !req.headers.origin || origins.has(String(req.headers.origin).toLowerCase()),
    isAuthed: (req) => safeEqual(parseCookies(req.headers.cookie)[cookieName], secret),
    keyMatches: (candidate) => safeEqual(candidate, secret),
    setCookieHeader: () => `${cookieName}=${secret}; Path=/; HttpOnly; SameSite=Strict`,
  };
}
