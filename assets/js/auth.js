/* AF TOURNAMENTS — Part 6: server-side sessions (the real auth boundary).
   - Passwords: scrypt hashes, timing-safe compare. No plaintext anywhere.
   - Sessions: 32-byte random tokens, server-side store with expiry, httpOnly
     SameSite=Lax cookies. The browser never sees or decides admin status.
   - Seed: ADMIN_USER + ADMIN_PASS env on first boot only. If unset and no
     admin exists, login stays DISABLED (fail-closed — never a default
     password). */

"use strict";

const crypto = require("crypto");
const db = require("./db");

const COOKIE = "af_sid";

function loadEnv() {
  try {
    const fs = require("fs");
    const path = require("path");
    const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    raw.split("\n").forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
  } catch (e) { /* no .env — env vars or disabled login */ }
}

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const dk = crypto.scryptSync(String(password), Buffer.from(salt, "hex"), 64);
  return { salt, hash: dk.toString("hex") };
}

function verifyPassword(password, salt, hash) {
  try {
    const dk = crypto.scryptSync(String(password), Buffer.from(String(salt), "hex"), 64);
    const a = Buffer.from(dk.toString("hex"), "hex");
    const b = Buffer.from(String(hash), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

// Admin credentials live OUTSIDE the DB file, in auth.json (never served).
function authFile() {
  const path = require("path");
  return path.join(db.DATA_DIR, "auth.json");
}

function loadAuth() {
  const fs = require("fs");
  try {
    const raw = fs.readFileSync(authFile(), "utf8");
    const o = JSON.parse(raw);
    if (o && o.user && o.salt && o.hash) return o;
  } catch (e) {}
  return null;
}

function seedAdmin() {
  loadEnv();
  if (loadAuth()) return { seeded: false, reason: "exists" };
  const user = (process.env.ADMIN_USER || "").trim();
  const pass = process.env.ADMIN_PASS || "";
  if (!user || !pass || pass.length < 10) return { seeded: false, reason: "disabled" };
  const h = hashPassword(pass);
  const fs = require("fs");
  fs.writeFileSync(authFile(), JSON.stringify({ user, salt: h.salt, hash: h.hash }, null, 2), { mode: 0o600 });
  return { seeded: true };
}

function loginEnabled() { return !!loadAuth(); }

function checkLogin(username, password) {
  const a = loadAuth();
  if (!a) return { ok: false, error: "Admin login is not configured on this server." };
  if (String(username).trim() !== a.user) return { ok: false, error: "Invalid credentials." };
  if (!verifyPassword(password, a.salt, a.hash)) return { ok: false, error: "Invalid credentials." };
  return { ok: true, actor: a.user };
}

function ttlMs() {
  const h = Number(process.env.SESSION_TTL_H || 8);
  return (h > 0 && h <= 72 ? h : 8) * 60 * 60 * 1000;
}

function createSession(actor) {
  const token = crypto.randomBytes(32).toString("hex");
  const sessions = db.loadSessions();
  sessions[token] = { actor: String(actor), exp: Date.now() + ttlMs() };
  db.saveSessions(sessions);
  return token;
}

function getSession(token) {
  if (!token || typeof token !== "string") return null;
  const sessions = db.loadSessions();
  const s = sessions[token];
  if (!s || Number(s.exp) <= Date.now()) {
    if (s) { delete sessions[token]; db.saveSessions(sessions); }
    return null;
  }
  return s;
}

function destroySession(token) {
  if (!token) return;
  const sessions = db.loadSessions();
  if (sessions[token]) { delete sessions[token]; db.saveSessions(sessions); }
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  h.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i === -1) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function sessionFromReq(req) {
  return getSession(parseCookies(req)[COOKIE]);
}

function setCookie(res, token) {
  const maxAge = Math.floor(ttlMs() / 1000);
  res.setHeader("Set-Cookie", COOKIE + "=" + token + "; HttpOnly; Path=/; SameSite=Lax; Max-Age=" + maxAge);
}

function clearCookie(res) {
  res.setHeader("Set-Cookie", COOKIE + "=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

module.exports = {
  COOKIE, seedAdmin, loginEnabled, checkLogin,
  createSession, getSession, destroySession,
  sessionFromReq, setCookie, clearCookie, parseCookies
};
