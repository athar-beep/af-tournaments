/* AF TOURNAMENTS — Part 6: API + static server (zero dependencies).
   Run:  PORT=8080 ADMIN_USER=... ADMIN_PASS=... node server/server.js
   Serves the public site + admin.html and the /api/* JSON API.
   Security posture: sessions are httpOnly cookies verified server-side on
   every admin call; mutations need the X-Requested-With header (same-origin
   CSRF mitigation); totals/statuses/actors are computed server-side;
   /server/* and data files are never served; errors never leak stacks. */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const db = require("./db");
const V = require("./validate");
const AUTH = require("./auth");
const UPL = require("./upload");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml"
};

// ---- tiny rate limiter (per-IP, in-memory) ----
const buckets = {};
function throttled(ip, key, max, ms) {
  const now = Date.now();
  const k = ip + "|" + key;
  let b = buckets[k];
  if (!b || b.reset <= now) b = buckets[k] = { n: 0, reset: now + ms };
  b.n += 1;
  return b.n > max;
}
function ipOf(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}

// ---- helpers ----
function send(res, code, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body)
  }, extra || {}));
  res.end(body);
}
const ok = (res, data) => send(res, 200, { ok: true, data });
const fail = (res, code, error, errors) => send(res, code, { ok: false, error, errors });
function needXhr(req, res) {
  if (String(req.headers["x-requested-with"] || "") !== "XMLHttpRequest") {
    fail(res, 403, "Missing request header.");
    return false;
  }
  return true;
}
function needAdmin(req, res) {
  const s = AUTH.sessionFromReq(req);
  if (!s) { fail(res, 401, "Admin session required."); return null; }
  return s;
}
function newId() {
  return "AF-" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase();
}
function newMatchId() {
  return "M-" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase();
}
function publicMatch(m) {
  // Public surface: never room credentials, never audit history, never contacts.
  // Results are included ONLY when the match is completed AND published.
  const showResults = m.status === "completed" && m.resultsPublished && Array.isArray(m.results);
  return {
    id: m.id,
    tournamentId: m.tournamentId,
    matchNumber: m.matchNumber,
    scheduledTime: m.scheduledTime,
    status: m.status,
    notes: m.notes || "",
    resultsPublished: !!m.resultsPublished,
    results: showResults ? m.results : [],
    resultsCount: Array.isArray(m.results) ? m.results.length : 0,
    pointsPerKill: Number.isInteger(Number(m.pointsPerKillSnapshot)) ? Number(m.pointsPerKillSnapshot) : null,
    updatedAt: m.updatedAt || null,
    completedAt: m.completedAt || null
  };
}
function auditMatch(m, event, actor) {
  if (!Array.isArray(m.history)) m.history = [];
  m.history.push({ ts: new Date().toISOString(), event, by: actor });
}
function newAnnId() {
  return "A-" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase();
}
function publicAnn(a, tournaments) {
  // Public surface: no author identity, no audit history, no internal notes.
  // Only published rows ever reach this mapper (callers filter first).
  const t = a.tournamentId ? V.findScrim(tournaments, a.tournamentId) : null;
  return {
    id: a.id,
    title: a.title,
    message: a.message,
    details: a.details || "",
    tournamentId: a.tournamentId || "",
    tournamentName: t ? t.name : "",
    type: a.type || "general",
    publishedAt: a.publishedAt || null,
    updatedAt: a.updatedAt || null,
    createdAt: a.createdAt || null
  };
}
function publicRecord(r) {
  // Records hold no secrets; proof FILE contents are never inlined.
  return r;
}

// ---- static ----
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath.startsWith("/server/") || urlPath === "/server") return fail(res, 404, "Not found.");
  if (urlPath === "/server.log" || urlPath.endsWith(".log")) return fail(res, 404, "Not found.");
  const abs = path.resolve(ROOT, "." + urlPath);
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return fail(res, 404, "Not found.");
  if (path.basename(abs).startsWith(".")) return fail(res, 404, "Not found.");
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return fail(res, 404, "Not found.");
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type, "Content-Length": st.size,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    fs.createReadStream(abs).pipe(res);
  });
}

// ---- API ----
async function api(req, res) {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  const method = req.method;
  const database = db.load();

  if (method === "GET" && p === "/api/health") {
    return ok(res, { time: new Date().toISOString(), adminLogin: AUTH.loginEnabled() });
  }

  // Auth
  if (method === "POST" && p === "/api/admin/login") {
    if (!needXhr(req, res)) return;
    if (throttled(ipOf(req), "login", 10, 60000)) return fail(res, 429, "Too many attempts. Wait a minute.");
    let body = {};
    try { body = await UPL.readJson(req); } catch (e) { return fail(res, 400, "Invalid request."); }
    const actor = String(body.actor || "").trim();
    if (actor.length < 2 || actor.length > 40) return fail(res, 400, "Invalid display name.");
    const chk = AUTH.checkLogin(body.username !== undefined ? body.username : actor, body.password);
    if (!chk.ok) return fail(res, 401, chk.error);
    const token = AUTH.createSession(chk.actor);
    AUTH.setCookie(res, token);
    return ok(res, { actor: chk.actor });
  }
  if (method === "POST" && p === "/api/admin/logout") {
    const t = AUTH.parseCookies(req)[AUTH.COOKIE];
    AUTH.destroySession(t);
    AUTH.clearCookie(res);
    return ok(res, {});
  }
  if (method === "GET" && p === "/api/admin/me") {
    const s = AUTH.sessionFromReq(req);
    if (!s) return fail(res, 401, "Not signed in.");
    return ok(res, { actor: s.actor });
  }

  // Public tournaments — same canonical source the admin edits.
  if (method === "GET" && p === "/api/tournaments") {
    return ok(res, database.tournaments);
  }

  // Admin tournament create/edit
  if ((method === "POST" && p === "/api/tournaments") || (method === "PUT" && p.startsWith("/api/tournaments/"))) {
    const s = needAdmin(req, res);
    if (!s || !needXhr(req, res)) return;
    let body = {};
    try { body = await UPL.readJson(req); } catch (e) { return fail(res, 400, "Invalid request."); }
    if (method === "POST") {
      const ids = database.tournaments.map((t) => t.id);
      const v = V.validateTournament(body, ids, true);
      if (!v.valid) return fail(res, 400, "Invalid tournament.", v.errors);
      const t = {
        id: String(body.id), name: String(body.name).trim(),
        tagline: String(body.tagline || "").trim() || "Announced via WhatsApp.",
        status: body.status, entryFeePerHead: Number(body.entryFeePerHead),
        format: String(body.format).trim(), matchCount: Number(body.matchCount),
        matchNote: Number(body.matchCount) + (Number(body.matchCount) === 1 ? " match" : " matches") + " per day",
        times: v.times, teams: String(body.teams).trim(),
        prize: body.prize === "" || body.prize == null ? null : String(body.prize).trim(),
        registrationOpen: !!body.registrationOpen,
        scoringPointsPerKill: v.pointsPerKill,
        updatedBy: s.actor, updatedAt: new Date().toISOString()
      };
      database.tournaments.push(t);
      db.save();
      return ok(res, t);
    }
    const id = decodeURIComponent(p.slice("/api/tournaments/".length));
    const t = V.findScrim(database.tournaments, id);
    if (!t) return fail(res, 404, "Unknown tournament.");
    const merged = Object.assign({}, t, body, { id: t.id });
    const ids = database.tournaments.map((x) => x.id).filter((x) => x !== id);
    const v = V.validateTournament(merged, ids, false);
    if (!v.valid) return fail(res, 400, "Invalid tournament.", v.errors);
    ["name", "tagline", "status", "format", "teams"].forEach((k) => {
      if (body[k] !== undefined) t[k] = String(body[k]).trim();
    });
    if (body.entryFeePerHead !== undefined) t.entryFeePerHead = Number(body.entryFeePerHead);
    if (body.matchCount !== undefined) {
      t.matchCount = Number(body.matchCount);
      t.matchNote = t.matchCount + (t.matchCount === 1 ? " match" : " matches") + " per day";
    }
    if (body.times !== undefined) t.times = v.times;
    if (body.prize !== undefined) t.prize = (body.prize === "" || body.prize == null) ? null : String(body.prize).trim();
    if (body.registrationOpen !== undefined) t.registrationOpen = !!body.registrationOpen;
    if (body.scoringPointsPerKill !== undefined) t.scoringPointsPerKill = v.pointsPerKill;
    t.updatedBy = s.actor;
    t.updatedAt = new Date().toISOString();
    db.save();
    return ok(res, t);
  }

  // ---- Part 7: public matches + leaderboard (same canonical match store) ----
  // Public matches: room credentials + audit history are never included.
  if (method === "GET" && p === "/api/matches") {
    const tid = u.searchParams.get("tournamentId") || u.searchParams.get("tournament") || "";
    let list = database.matches.slice().sort((a, b) => Number(a.matchNumber) - Number(b.matchNumber));
    if (tid && tid !== "all") list = list.filter((m) => m.tournamentId === tid);
    return ok(res, list.map(publicMatch));
  }
  if (method === "GET" && p === "/api/leaderboard") {
    const tid = u.searchParams.get("tournamentId") || u.searchParams.get("tournament") || "";
    if (!tid) return fail(res, 400, "Choose a tournament.");
    const tourn = V.findScrim(database.tournaments, tid);
    if (!tourn) return fail(res, 404, "Unknown tournament.");
    const ppk = V.pointsPerKillOf(tourn);
    const ms = database.matches.filter((m) => m.tournamentId === tid);
    const entries = V.buildLeaderboard(ms, ppk);
    const counted = ms.filter((m) => m.status === "completed" && m.resultsPublished && Array.isArray(m.results) && m.results.length).length;
    return ok(res, {
      tournamentId: tid,
      tournamentName: tourn.name,
      scoring: { pointsPerKill: ppk, note: "Total = kills × pointsPerKill + points. Configured per tournament, never a publisher rule set." },
      matchesCounted: counted,
      matchesTotal: ms.length,
      entries
    });
  }

  // ---- Part 8: public announcements (published only, sanitized) ----
  if (method === "GET" && p === "/api/announcements") {
    const tid = u.searchParams.get("tournamentId") || u.searchParams.get("tournament") || "all";
    const type = u.searchParams.get("type") || "all";
    let list = database.announcements.filter((a) => !!a.published);
    if (tid !== "all") list = list.filter((a) => !a.tournamentId || a.tournamentId === tid);
    // Tournament-linked rows are visible on their tournament AND in the
    // unfiltered feed; general rows (no tournament) show everywhere.
    if (type !== "all") list = list.filter((a) => (a.type || "general") === type);
    list.sort((a, b) => String(b.publishedAt || b.updatedAt || "").localeCompare(String(a.publishedAt || a.updatedAt || "")));
    return ok(res, list.map((a) => publicAnn(a, database.tournaments)));
  }

  // Public registration create (JSON or multipart with proof file)
  if (method === "POST" && p === "/api/registrations") {
    if (!needXhr(req, res)) return;
    if (throttled(ipOf(req), "reg", 30, 60000)) return fail(res, 429, "Too many requests. Try again shortly.");
    let d = {}, file = null;
    const ct = String(req.headers["content-type"] || "");
    try {
      if (ct.indexOf("multipart/form-data") !== -1) {
        const mp = await UPL.parseMultipart(req);
        if (!mp) return fail(res, 400, "Invalid request.");
        d = mp.fields || {};
        try { d.players = JSON.parse(mp.fields.players || "[]"); } catch (e) { d.players = []; }
        file = mp.file;
      } else {
        d = await UPL.readJson(req);
      }
    } catch (e) { return fail(res, e.message === "too-large" ? 413 : 400, e.message === "too-large" ? "Request too large." : "Invalid request."); }
    const v = V.validateRegistration(d, database.tournaments);
    if (!v.valid) return fail(res, 400, "Please fix the highlighted fields.", v.errors);
    const dupe = database.registrations.some((r) =>
      r.scrimId === d.scrimId && String(r.teamName).trim().toLowerCase() === String(d.teamName).trim().toLowerCase() &&
      r.contact === v.contact && r.regStatus !== "cancelled");
    if (dupe) return fail(res, 409, "This team + contact is already registered for this scrim.");
    const now = new Date().toISOString();
    const rec = {
      id: newId(), ts: now, scrimId: d.scrimId,
      scrimName: v.scrim.name + " (" + v.scrim.times.join(" · ") + ")",
      teamName: String(d.teamName).trim(), captain: String(d.captain).trim(), contact: v.contact,
      playerCount: v.count,
      players: d.players.map((pl) => ({ name: String(pl.name).trim(), gameId: String(pl.gameId).trim() })),
      notes: String(d.notes || "").trim().slice(0, 500),
      feePerHead: v.fee, totalFee: v.total, // server-calculated
      payMethod: d.payMethod, payRef: String(d.payRef).trim(),
      proofName: file ? String(file.name).slice(0, 120) : "", proofRef: "",
      regStatus: "submitted", payStatus: "submitted",
      history: [{ ts: now, event: "submitted — awaiting verification", by: "user" }]
    };
    if (file) {
      const st = UPL.storeProof(rec.id, file);
      if (!st.ok) return fail(res, 400, st.error);
      rec.proofRef = st.ref;
    }
    database.registrations.push(rec);
    db.save();
    return send(res, 201, { ok: true, data: publicRecord(rec) });
  }

  // Public lookup: needs BOTH id and contact (knowledge factor, not a listing).
  if (method === "POST" && p === "/api/registrations/lookup") {
    if (!needXhr(req, res)) return;
    if (throttled(ipOf(req), "lookup", 60, 60000)) return fail(res, 429, "Too many requests.");
    let body = {};
    try { body = await UPL.readJson(req); } catch (e) { return fail(res, 400, "Invalid request."); }
    const contact = V.normContact(body.contact);
    const r = database.registrations.filter((x) =>
      String(x.id).toUpperCase() === String(body.id || "").toUpperCase().trim() && x.contact === contact)[0];
    if (!r) return fail(res, 404, "No registration matches that ID and number.");
    return ok(res, publicRecord(r));
  }

  // Public self-cancel: requires the record's contact number as proof of ownership.
  if (method === "POST" && p.startsWith("/api/registrations/") && p.endsWith("/cancel")) {
    if (!needXhr(req, res)) return;
    const id = decodeURIComponent(p.slice("/api/registrations/".length, -"/cancel".length));
    let body = {};
    try { body = await UPL.readJson(req); } catch (e) { return fail(res, 400, "Invalid request."); }
    const r = database.registrations.filter((x) => String(x.id).toUpperCase() === id.toUpperCase())[0];
    if (!r || r.contact !== V.normContact(body.contact)) return fail(res, 404, "No registration matches that ID and number.");
    if (V.REG_FLOW[r.regStatus].indexOf("cancelled") === -1)
      return fail(res, 409, "This registration can no longer be cancelled.");
    const from = r.regStatus;
    r.regStatus = "cancelled";
    r.history.push({ ts: new Date().toISOString(), event: from + " → cancelled", by: "user" });
    db.save();
    return ok(res, publicRecord(r));
  }

  // Admin registration list (server-side filters)
  if (method === "GET" && p === "/api/admin/registrations") {
    const s = needAdmin(req, res);
    if (!s) return;
    const q = (u.searchParams.get("q") || "").toLowerCase();
    const scrim = u.searchParams.get("scrim") || "all";
    const reg = u.searchParams.get("reg") || "all";
    const pay = u.searchParams.get("pay") || "all";
    const list = database.registrations.filter((r) => {
      if (scrim !== "all" && r.scrimId !== scrim) return false;
      if (reg !== "all" && r.regStatus !== reg) return false;
      if (pay !== "all" && r.payStatus !== pay) return false;
      if (q && (r.teamName + " " + r.id + " " + r.contact + " " + r.captain).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    return ok(res, list);
  }

  // Admin status mutations — transition maps enforced, actor from session.
  const regM = p.match(/^\/api\/admin\/registrations\/([^/]+)\/(reg-status|pay-status)$/);
  if (method === "POST" && regM) {
    const s = needAdmin(req, res);
    if (!s || !needXhr(req, res)) return;
    let body = {};
    try { body = await UPL.readJson(req); } catch (e) { return fail(res, 400, "Invalid request."); }
    const r = database.registrations.filter((x) => String(x.id).toUpperCase() === regM[1].toUpperCase())[0];
    if (!r) return fail(res, 404, "Record not found.");
    const to = String(body.to || "");
    if (regM[2] === "reg-status") {
      if (V.REG_STATUSES.indexOf(to) === -1 || V.REG_FLOW[r.regStatus].indexOf(to) === -1)
        return fail(res, 409, "Transition not allowed from " + r.regStatus + " to " + to + ".");
      const from = r.regStatus;
      r.regStatus = to;
      r.history.push({ ts: new Date().toISOString(), event: from + " → " + to, by: s.actor });
    } else {
      if (V.PAY_STATUSES.indexOf(to) === -1 || V.PAY_FLOW[r.payStatus].indexOf(to) === -1)
        return fail(res, 409, "Transition not allowed from " + r.payStatus + " to " + to + ".");
      const from = r.payStatus;
      r.payStatus = to;
      r.history.push({ ts: new Date().toISOString(), event: "payment " + from + " → " + to, by: s.actor });
    }
    db.save();
    return ok(res, publicRecord(r));
  }

  // ---- Part 7: admin match management (authenticated, validated, audited) ----
  if (method === "GET" && p === "/api/admin/matches") {
    const s = needAdmin(req, res);
    if (!s) return;
    const tid = u.searchParams.get("tournamentId") || "all";
    const st = u.searchParams.get("status") || "all";
    let list = database.matches.slice();
    if (tid !== "all") list = list.filter((m) => m.tournamentId === tid);
    if (st !== "all") list = list.filter((m) => m.status === st);
    list.sort((a, b) => String(a.tournamentId).localeCompare(String(b.tournamentId)) || Number(a.matchNumber) - Number(b.matchNumber));
    return ok(res, list);
  }
  // Registered teams/players for a tournament (admin only — may include contacts).
  if (method === "GET" && p === "/api/admin/tournament-teams") {
    const s = needAdmin(req, res);
    if (!s) return;
    const tid = u.searchParams.get("tournamentId") || "";
    if (!tid) return fail(res, 400, "Choose a tournament.");
    const tourn = V.findScrim(database.tournaments, tid);
    if (!tourn) return fail(res, 404, "Unknown tournament.");
    const rows = database.registrations
      .filter((r) => r.scrimId === tid && r.regStatus !== "cancelled")
      .map((r) => ({
        id: r.id, teamName: r.teamName, captain: r.captain,
        playerCount: r.playerCount, regStatus: r.regStatus, payStatus: r.payStatus,
        players: Array.isArray(r.players) ? r.players : []
      }))
      .sort((a, b) => String(a.teamName).localeCompare(String(b.teamName)));
    return ok(res, { tournamentId: tid, tournamentName: tourn.name, teams: rows });
  }
  if (method === "POST" && p === "/api/admin/matches") {
    const s = needAdmin(req, res);
    if (!s || !needXhr(req, res)) return;
    let body = {};
    try { body = await UPL.readJson(req); } catch (e) { return fail(res, 400, "Invalid request."); }
    const v = V.validateMatch(body, database.tournaments, database.matches, true, null);
    if (!v.valid) return fail(res, 400, "Invalid match.", v.errors);
    const now = new Date().toISOString();
    const m = {
      id: newMatchId(), tournamentId: String(body.tournamentId).trim(),
      tournamentName: v.tournament ? v.tournament.name : "",
      matchNumber: v.matchNumber, scheduledTime: v.scheduledTime,
      status: "scheduled", roomInfo: v.roomInfo, notes: v.notes,
      results: [], resultsPublished: false, pointsPerKillSnapshot: null,
      createdBy: s.actor, createdAt: now, updatedBy: s.actor, updatedAt: now,
      completedAt: null, completedBy: null,
      history: [{ ts: now, event: "created as Scheduled", by: s.actor }]
    };
    database.matches.push(m);
    db.save();
    return send(res, 201, { ok: true, data: m });
  }
  const matchIdM = p.match(/^\/api\/admin\/matches\/([^/]+)(\/(status|results|publish))?$/);
  if (matchIdM && (method === "PUT" || method === "POST" || method === "DELETE")) {
    const s = needAdmin(req, res);
    if (!s || !needXhr(req, res)) return;
    const mid = decodeURIComponent(matchIdM[1]);
    const sub = matchIdM[3] || "";
    const m = database.matches.filter((x) => String(x.id).toUpperCase() === String(mid).toUpperCase())[0];
    if (!m) return fail(res, 404, "Unknown match.");
    let body = {};
    if (method === "POST" || method === "PUT") {
      try { body = await UPL.readJson(req); } catch (e) { return fail(res, 400, "Invalid request."); }
    }
    // Edit core details (status + results + visibility have dedicated endpoints).
    if (!sub && method === "PUT") {
      const merged = {
        tournamentId: body.tournamentId !== undefined ? body.tournamentId : m.tournamentId,
        matchNumber: body.matchNumber !== undefined ? body.matchNumber : m.matchNumber,
        scheduledTime: body.scheduledTime !== undefined ? body.scheduledTime : m.scheduledTime,
        roomInfo: body.roomInfo !== undefined ? body.roomInfo : m.roomInfo,
        notes: body.notes !== undefined ? body.notes : m.notes,
        status: m.status
      };
      const v = V.validateMatch(merged, database.tournaments, database.matches, false, m.id);
      if (!v.valid) return fail(res, 400, "Invalid match.", v.errors);
      const changes = [];
      if (String(merged.tournamentId).trim() !== m.tournamentId) { changes.push("tournament " + m.tournamentId + " → " + String(merged.tournamentId).trim()); m.tournamentId = String(merged.tournamentId).trim(); }
      if (Number(merged.matchNumber) !== Number(m.matchNumber)) { changes.push("match #" + m.matchNumber + " → #" + Number(merged.matchNumber)); m.matchNumber = Number(merged.matchNumber); }
      if (v.scheduledTime !== m.scheduledTime) { changes.push("time " + m.scheduledTime + " → " + v.scheduledTime); m.scheduledTime = v.scheduledTime; }
      if (v.roomInfo !== (m.roomInfo || "")) { changes.push("room info updated"); m.roomInfo = v.roomInfo; }
      if (v.notes !== (m.notes || "")) { changes.push("notes updated"); m.notes = v.notes; }
      const tourn = V.findScrim(database.tournaments, m.tournamentId);
      m.tournamentName = tourn ? tourn.name : (m.tournamentName || "");
      m.updatedBy = s.actor;
      m.updatedAt = new Date().toISOString();
      auditMatch(m, changes.length ? "edited: " + changes.join("; ") : "edited (no changes)", s.actor);
      db.save();
      return ok(res, m);
    }
    // Status transition — map enforced server-side.
    if (sub === "status" && method === "POST") {
      const to = String(body.to || "");
      if (V.MATCH_STATUSES.indexOf(to) === -1 || V.MATCH_FLOW[m.status].indexOf(to) === -1)
        return fail(res, 409, "Transition not allowed from " + m.status + " to " + to + ".");
      const from = m.status;
      m.status = to;
      m.updatedBy = s.actor;
      m.updatedAt = new Date().toISOString();
      if (to === "completed") { m.completedAt = m.updatedAt; m.completedBy = s.actor; }
      auditMatch(m, from + " → " + to, s.actor);
      db.save();
      return ok(res, m);
    }
    // Replace the full result set (validated, totals recomputed server-side).
    if (sub === "results" && method === "PUT") {
      if (m.status !== "completed")
        return fail(res, 409, "Record results only for Completed matches. Current status: " + m.status + ".");
      if (body.results !== undefined && !Array.isArray(body.results))
        return fail(res, 400, "Invalid results.", { results: "Results must be a list." });
      // Client-sent totalPoints/rank are ignored — recomputed below.
      const list = Array.isArray(body.results) ? body.results : [];
      const tourn = V.findScrim(database.tournaments, m.tournamentId);
      const ppk = V.pointsPerKillOf(tourn);
      const v = V.validateResultSet(list.map((r) => ({
        teamName: r.teamName, placement: r.placement, kills: r.kills, points: r.points
      })), ppk);
      if (!v.valid) return fail(res, 400, "Invalid results.", v.errors);
      const before = Array.isArray(m.results) ? m.results.length : 0;
      m.results = v.rows;
      m.pointsPerKillSnapshot = ppk;
      // Replacing results always unpublishes until an admin explicitly republishes.
      if (m.resultsPublished) m.resultsPublished = false;
      m.updatedBy = s.actor;
      m.updatedAt = new Date().toISOString();
      auditMatch(m, "results saved (" + before + " → " + v.rows.length + " rows, unpublished pending review)", s.actor);
      db.save();
      return ok(res, m);
    }
    // Remove all result rows safely (keeps the match + audit trail).
    if (sub === "results" && method === "DELETE") {
      const before = Array.isArray(m.results) ? m.results.length : 0;
      if (!before) return fail(res, 404, "No results to remove.");
      m.results = [];
      m.resultsPublished = false;
      m.pointsPerKillSnapshot = null;
      m.updatedBy = s.actor;
      m.updatedAt = new Date().toISOString();
      auditMatch(m, "results removed (" + before + " rows cleared, unpublished)", s.actor);
      db.save();
      return ok(res, m);
    }
    // Publish / unpublish result visibility (completed + non-empty to publish).
    if (sub === "publish" && method === "POST") {
      const want = !!body.published;
      if (want) {
        if (m.status !== "completed") return fail(res, 409, "Only Completed matches can be published.");
        if (!Array.isArray(m.results) || !m.results.length)
          return fail(res, 409, "Add results before publishing.");
        m.resultsPublished = true;
        auditMatch(m, "results published (" + m.results.length + " rows)", s.actor);
      } else {
        m.resultsPublished = false;
        auditMatch(m, "results unpublished", s.actor);
      }
      m.updatedBy = s.actor;
      m.updatedAt = new Date().toISOString();
      db.save();
      return ok(res, m);
    }
    return fail(res, 404, "Not found.");
  }

  // ---- Part 8: admin announcements (authenticated, validated, audited) ----
  if (method === "GET" && p === "/api/admin/announcements") {
    const s = needAdmin(req, res);
    if (!s) return;
    const list = database.announcements.slice().sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return ok(res, list);
  }
  if (method === "POST" && p === "/api/admin/announcements") {
    const s = needAdmin(req, res);
    if (!s || !needXhr(req, res)) return;
    let body = {};
    try { body = await UPL.readJson(req); } catch (e) { return fail(res, 400, "Invalid request."); }
    const v = V.validateAnnouncement(body, database.tournaments);
    if (!v.valid) return fail(res, 400, "Invalid announcement.", v.errors);
    const now = new Date().toISOString();
    const published = !!body.published;
    const a = {
      id: newAnnId(), title: v.title, message: v.message, details: v.details,
      tournamentId: v.tournamentId, type: v.type, published,
      createdBy: s.actor, createdAt: now, updatedBy: s.actor, updatedAt: now,
      publishedAt: published ? now : null,
      history: [{ ts: now, event: published ? "created + published" : "created as draft", by: s.actor }]
    };
    database.announcements.push(a);
    db.save();
    return send(res, 201, { ok: true, data: a });
  }
  const annIdM = p.match(/^\/api\/admin\/announcements\/([^/]+)(\/(publish))?$/);
  if (annIdM && (method === "PUT" || method === "POST" || method === "DELETE")) {
    const s = needAdmin(req, res);
    if (!s || !needXhr(req, res)) return;
    const aid = decodeURIComponent(annIdM[1]);
    const sub = annIdM[3] || "";
    const idx = database.announcements.findIndex((x) => String(x.id).toUpperCase() === String(aid).toUpperCase());
    if (idx === -1) return fail(res, 404, "Unknown announcement.");
    const a = database.announcements[idx];
    let body = {};
    if (method === "POST" || method === "PUT") {
      try { body = await UPL.readJson(req); } catch (e) { return fail(res, 400, "Invalid request."); }
    }
    // Edit content (visibility has a dedicated endpoint).
    if (!sub && method === "PUT") {
      const merged = {
        title: body.title !== undefined ? body.title : a.title,
        message: body.message !== undefined ? body.message : a.message,
        details: body.details !== undefined ? body.details : a.details,
        tournamentId: body.tournamentId !== undefined ? body.tournamentId : a.tournamentId,
        type: body.type !== undefined ? body.type : a.type
      };
      const v = V.validateAnnouncement(merged, database.tournaments);
      if (!v.valid) return fail(res, 400, "Invalid announcement.", v.errors);
      const changes = [];
      if (v.title !== a.title) { changes.push("title updated"); a.title = v.title; }
      if (v.message !== a.message) { changes.push("message updated"); a.message = v.message; }
      if (v.details !== (a.details || "")) { changes.push("details updated"); a.details = v.details; }
      if (v.tournamentId !== (a.tournamentId || "")) { changes.push("tournament link updated"); a.tournamentId = v.tournamentId; }
      if (v.type !== a.type) { changes.push("type → " + v.type); a.type = v.type; }
      a.updatedBy = s.actor;
      a.updatedAt = new Date().toISOString();
      if (!Array.isArray(a.history)) a.history = [];
      a.history.push({ ts: a.updatedAt, event: changes.length ? "edited: " + changes.join("; ") : "edited (no changes)", by: s.actor });
      db.save();
      return ok(res, a);
    }
    // Publish / unpublish.
    if (sub === "publish" && method === "POST") {
      const want = !!body.published;
      const now = new Date().toISOString();
      if (want && !a.published) a.publishedAt = now;
      a.published = want;
      a.updatedBy = s.actor;
      a.updatedAt = now;
      if (!Array.isArray(a.history)) a.history = [];
      a.history.push({ ts: now, event: want ? "published" : "unpublished", by: s.actor });
      db.save();
      return ok(res, a);
    }
    // Safe delete: explicit id, admin-only, record + its history removed.
    // Unpublish first if the goal is archiving — delete is permanent.
    if (!sub && method === "DELETE") {
      database.announcements.splice(idx, 1);
      db.save();
      return ok(res, { id: a.id });
    }
    return fail(res, 404, "Not found.");
  }

  // Admin proof download — ref maps server-side; never a filesystem path.
  const upM = p.match(/^\/api\/admin\/uploads\/([^/]+)$/);
  if (method === "GET" && upM) {
    const s = needAdmin(req, res);
    if (!s) return;
    const meta = UPL.proofMeta(upM[1]);
    if (!meta) return fail(res, 404, "Not found.");
    const fp = UPL.proofPath(meta);
    if (!fp) return fail(res, 404, "Not found.");
    fs.stat(fp, (err, st) => {
      if (err) return fail(res, 404, "Not found.");
      res.writeHead(200, {
        "Content-Type": meta.mime, "Content-Length": st.size,
        "Content-Disposition": 'attachment; filename="proof-' + meta.recordId + '"',
        "X-Content-Type-Options": "nosniff"
      });
      fs.createReadStream(fp).pipe(res);
    });
    return;
  }

  return fail(res, 404, "Not found.");
}

const server = http.createServer((req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      api(req, res).catch((e) => {
        console.error("[api] error:", e && e.message);
        if (!res.headersSent) fail(res, 500, "Server error. Try again.");
      });
    } else {
      serveStatic(req, res);
    }
  } catch (e) {
    console.error("[server] error:", e && e.message);
    if (!res.headersSent) fail(res, 500, "Server error. Try again.");
  }
});

db.load();
const seed = AUTH.seedAdmin();
server.listen(PORT, () => {
  console.log("[af] listening on :" + PORT + " | admin login: " +
    (AUTH.loginEnabled() ? (seed.seeded ? "seeded from env" : "configured") : "DISABLED (set ADMIN_USER + ADMIN_PASS)"));
});
