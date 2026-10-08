/* AF TOURNAMENTS — Part 7: match/result offline store (demo fallback).
   Remote server (Part 7 API) is canonical when reachable: admin mutations go
   through AF_SVC and public reads come from /api/matches + /api/leaderboard.
   This store keeps the page honest offline (same validation shapes, no fake
   matches seeded) and caches the last server snapshot. Totals/ranks are
   always recomputed — never trusted from input. */

(function () {
  "use strict";

  var KEY = "af_matches_v1";
  var REMOTE_KEY = "af_matches_remote_v1";
  var STATUSES = ["scheduled", "live", "completed", "cancelled"];
  var FLOW = { scheduled: ["live", "cancelled"], live: ["completed", "cancelled"], completed: [], cancelled: [] };

  function readLocal() {
    try {
      var raw = localStorage.getItem(KEY);
      var a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function writeLocal(a) {
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
  }
  function remoteMode() {
    return !!(window.AF_API && window.AF_API.mode === "remote" && window.AF_SVC);
  }
  function readRemoteCache() {
    try {
      var raw = localStorage.getItem(REMOTE_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (o && Array.isArray(o.list)) return o.list;
    } catch (e) {}
    return null;
  }
  function tournList() {
    if (window.AF_TOURN && typeof window.AF_TOURN.publicList === "function") {
      try { return window.AF_TOURN.publicList(); } catch (e) {}
    }
    return [];
  }
  function ppkOf(tournamentId) {
    var t = tournList().filter(function (x) { return x.id === tournamentId; })[0];
    var v = t ? Number(t.scoringPointsPerKill) : 1;
    if (!Number.isInteger(v) || v < 0 || v > 10) v = 1;
    return v;
  }

  function publicList(tournamentId) {
    var list;
    if (remoteMode()) {
      var snap = readRemoteCache();
      list = snap || [];
    } else {
      list = readLocal();
    }
    if (tournamentId && tournamentId !== "all") {
      list = list.filter(function (m) { return m.tournamentId === tournamentId; });
    }
    return list.slice().sort(function (a, b) { return Number(a.matchNumber) - Number(b.matchNumber); });
  }

  // Strip private fields for public rendering (mirrors server publicMatch).
  function toPublic(m) {
    var show = m.status === "completed" && !!m.resultsPublished && Array.isArray(m.results);
    return {
      id: m.id, tournamentId: m.tournamentId, matchNumber: m.matchNumber,
      scheduledTime: m.scheduledTime, status: m.status, notes: m.notes || "",
      resultsPublished: !!m.resultsPublished,
      results: show ? m.results : [],
      resultsCount: Array.isArray(m.results) ? m.results.length : 0,
      pointsPerKill: Number.isInteger(Number(m.pointsPerKillSnapshot)) ? Number(m.pointsPerKillSnapshot) : null,
      updatedAt: m.updatedAt || null, completedAt: m.completedAt || null
    };
  }

  function validateMatch(body, selfId) {
    var errs = {};
    var tids = tournList().map(function (t) { return t.id; });
    var tid = String(body.tournamentId || "").trim();
    if (!tid) errs.tournamentId = "Choose a tournament.";
    else if (tids.length && tids.indexOf(tid) === -1) errs.tournamentId = "Unknown tournament.";
    var num = Number(body.matchNumber);
    if (!Number.isInteger(num) || num < 1 || num > 20) errs.matchNumber = "Match number: 1–20.";
    else {
      var clash = readLocal().some(function (m) {
        return m.tournamentId === tid && Number(m.matchNumber) === num && String(m.id) !== String(selfId || "");
      });
      if (clash) errs.matchNumber = "That match number already exists for this tournament.";
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.scheduledTime || "").trim()))
      errs.scheduledTime = "Scheduled time must be HH:MM.";
    if (String(body.roomInfo || "").length > 200) errs.roomInfo = "Room info: at most 200 characters.";
    if (String(body.notes || "").length > 300) errs.notes = "Notes: at most 300 characters.";
    return { valid: Object.keys(errs).length === 0, errors: errs };
  }

  function validateResults(list) {
    var errs = {};
    if (!Array.isArray(list)) return { valid: false, errors: { results: "Results must be a list." } };
    if (list.length > 50) return { valid: false, errors: { results: "At most 50 rows." } };
    var seenT = {}, seenP = {};
    list.forEach(function (r, i) {
      var team = String(r.teamName || "").trim();
      var pl = Number(r.placement), k = Number(r.kills), pts = Number(r.points);
      if (team.length < 2 || team.length > 60) errs["team" + i] = "Team name 2–60 chars.";
      var tk = team.toLowerCase();
      if (team && seenT[tk] !== undefined) errs["team" + i] = errs["team" + i] || "Duplicate team.";
      else if (team) seenT[tk] = i;
      if (!Number.isInteger(pl) || pl < 1 || pl > 100) errs["placement" + i] = "Placement 1–100.";
      else if (seenP[pl] !== undefined) errs["placement" + i] = "Duplicate placement.";
      else seenP[pl] = i;
      if (r.kills !== undefined && r.kills !== "" && (!Number.isInteger(k) || k < 0 || k > 300)) errs["kills" + i] = "Kills 0–300.";
      if (r.points !== undefined && r.points !== "" && (!Number.isInteger(pts) || pts < 0 || pts > 5000)) errs["points" + i] = "Points 0–5000.";
    });
    if (!Object.keys(errs).length && list.length) {
      var sorted = list.map(function (r) { return Number(r.placement); }).sort(function (a, b) { return a - b; });
      var ok = sorted.every(function (p, idx) { return p === idx + 1; });
      if (!ok) errs.results = "Placements must be exactly 1–" + list.length + " with no gaps.";
    }
    return { valid: Object.keys(errs).length === 0, errors: errs };
  }

  function totalOf(r, ppk) {
    return (Number(r.kills) || 0) * ppk + (Number(r.points) || 0);
  }

  function leaderboard(tournamentId) {
    var ppk = ppkOf(tournamentId);
    var ms = publicList(tournamentId).filter(function (m) {
      return m.status === "completed" && m.resultsPublished && Array.isArray(m.results) && m.results.length;
    });
    var table = {};
    ms.forEach(function (m) {
      var snap = Number.isInteger(Number(m.pointsPerKillSnapshot)) ? Number(m.pointsPerKillSnapshot) : ppk;
      m.results.forEach(function (r) {
        var key = String(r.teamName || "").trim().toLowerCase();
        if (!key) return;
        if (!table[key]) table[key] = { teamName: String(r.teamName).trim(), played: 0, totalPoints: 0, totalKills: 0, totalPlacementPoints: 0, bestPlacement: null, wins: 0 };
        var row = table[key];
        row.played += 1;
        row.totalKills += Number(r.kills) || 0;
        row.totalPlacementPoints += Number(r.points) || 0;
        row.totalPoints += totalOf(r, snap);
        var pl = Number(r.placement);
        if (Number.isInteger(pl) && pl >= 1) {
          if (row.bestPlacement == null || pl < row.bestPlacement) row.bestPlacement = pl;
          if (pl === 1) row.wins += 1;
        }
      });
    });
    var list = Object.keys(table).map(function (k) { return table[k]; });
    list.sort(function (a, b) {
      return b.totalPoints - a.totalPoints || b.totalKills - a.totalKills ||
        (a.bestPlacement == null ? 999 : a.bestPlacement) - (b.bestPlacement == null ? 999 : b.bestPlacement) ||
        String(a.teamName).localeCompare(String(b.teamName));
    });
    list.forEach(function (r, i) { r.rank = i + 1; });
    return { entries: list, matchesCounted: ms.length, pointsPerKill: ppk };
  }

  window.AF_MATCHES = {
    STATUSES: STATUSES, FLOW: FLOW,
    remoteMode: remoteMode,
    setRemote: function (list) {
      try { localStorage.setItem(REMOTE_KEY, JSON.stringify({ ts: Date.now(), list: list || [] })); } catch (e) {}
    },
    all: function () {
      if (remoteMode()) {
        var snap = readRemoteCache();
        if (snap) return snap.slice();
      }
      return readLocal();
    },
    publicList: publicList,
    toPublic: toPublic,
    ppkOf: ppkOf,
    validateMatch: validateMatch,
    validateResults: validateResults,
    totalOf: totalOf,
    leaderboard: leaderboard,
    // Offline demo mutations only (remote path uses AF_SVC in matches-admin.js).
    saveLocal: function (body, actor, selfId) {
      var v = validateMatch(body, selfId);
      if (!v.valid) return { ok: false, errors: v.errors };
      var all = readLocal();
      var now = new Date().toISOString();
      if (selfId) {
        var m = all.filter(function (x) { return String(x.id) === String(selfId); })[0];
        if (!m) return { ok: false, errors: { id: "Unknown match." } };
        m.tournamentId = String(body.tournamentId).trim();
        m.matchNumber = Number(body.matchNumber);
        m.scheduledTime = String(body.scheduledTime).trim();
        m.roomInfo = String(body.roomInfo || "").trim();
        m.notes = String(body.notes || "").trim();
        m.updatedAt = now;
        m.history = m.history || [];
        m.history.push({ ts: now, event: "edited (demo)", by: actor || "admin" });
      } else {
        all.push({
          id: "M-DEMO-" + Date.now().toString(36).toUpperCase(),
          tournamentId: String(body.tournamentId).trim(),
          matchNumber: Number(body.matchNumber),
          scheduledTime: String(body.scheduledTime).trim(),
          status: "scheduled", roomInfo: String(body.roomInfo || "").trim(),
          notes: String(body.notes || "").trim(),
          results: [], resultsPublished: false, pointsPerKillSnapshot: null,
          createdAt: now, updatedAt: now, history: [{ ts: now, event: "created as Scheduled (demo)", by: actor || "admin" }]
        });
      }
      writeLocal(all);
      return { ok: true };
    }
  };
})();
