/* AF TOURNAMENTS — Part 8: announcement offline store (demo fallback).
   Remote server (Part 8 API) is canonical when reachable: admin mutations go
   through AF_SVC and public reads come from /api/announcements. This store
   keeps the page honest offline (same validation shapes, zero seeded items)
   and caches the last server snapshot. Unpublished rows never render
   publicly — toPublic() callers filter first, mirroring the server. */

(function () {
  "use strict";

  var KEY = "af_announcements_v1";
  var REMOTE_KEY = "af_announcements_remote_v1";
  var TYPES = ["general", "tournament", "match", "important"];

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
  function tournName(id) {
    if (!id) return "";
    if (window.AF_TOURN && typeof window.AF_TOURN.publicList === "function") {
      try {
        var t = window.AF_TOURN.publicList().filter(function (x) { return x.id === id; })[0];
        return t ? t.name : "";
      } catch (e) {}
    }
    return "";
  }

  // Published-only public view (mirrors server publicAnn — no authors/history).
  function toPublic(a) {
    return {
      id: a.id, title: a.title, message: a.message, details: a.details || "",
      tournamentId: a.tournamentId || "", tournamentName: tournName(a.tournamentId),
      type: a.type || "general",
      publishedAt: a.publishedAt || null, updatedAt: a.updatedAt || null, createdAt: a.createdAt || null
    };
  }

  function publicList(tournamentId, type) {
    var src = remoteMode() ? (readRemoteCache() || []) : readLocal();
    var list = src.filter(function (a) { return !!a.published; });
    if (tournamentId && tournamentId !== "all") {
      list = list.filter(function (a) { return !a.tournamentId || a.tournamentId === tournamentId; });
    }
    if (type && type !== "all") list = list.filter(function (a) { return (a.type || "general") === type; });
    return list
      .map(toPublic)
      .sort(function (a, b) { return String(b.publishedAt || b.updatedAt || "").localeCompare(String(a.publishedAt || a.updatedAt || "")); });
  }

  function validate(a) {
    var errs = {};
    var title = String(a.title == null ? "" : a.title).trim();
    if (title.length < 3 || title.length > 80) errs.title = "Title: 3–80 characters.";
    var message = String(a.message == null ? "" : a.message).trim();
    if (message.length < 1 || message.length > 280) errs.message = "Short message: 1–280 characters.";
    var details = String(a.details == null ? "" : a.details);
    if (details.length > 2000) errs.details = "Detailed message: at most 2000 characters.";
    var tid = String(a.tournamentId == null ? "" : a.tournamentId).trim();
    if (tid && window.AF_TOURN && typeof window.AF_TOURN.publicList === "function") {
      try {
        var known = window.AF_TOURN.publicList().some(function (t) { return t.id === tid; });
        if (!known) errs.tournamentId = "Unknown tournament.";
      } catch (e) {}
    }
    var type = String(a.type == null || a.type === "" ? "general" : a.type).trim();
    if (TYPES.indexOf(type) === -1) errs.type = "Invalid announcement type.";
    return { valid: Object.keys(errs).length === 0, errors: errs };
  }

  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
    } catch (e) { return ""; }
  }

  window.AF_ANNS = {
    TYPES: TYPES,
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
    allAdmin: function () {
      var src = remoteMode() ? (readRemoteCacheFull() || readLocal()) : readLocal();
      return src.slice().sort(function (a, b) {
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      });
    },
    publicList: publicList,
    toPublic: toPublic,
    validate: validate,
    fmtDate: fmtDate,
    // Offline demo mutations only (remote path uses AF_SVC in announcements-admin.js).
    saveLocal: function (body, actorName, selfId) {
      var v = validate(body);
      if (!v.valid) return { ok: false, errors: v.errors };
      var all = readLocal();
      var now = new Date().toISOString();
      if (selfId) {
        var a = all.filter(function (x) { return String(x.id) === String(selfId); })[0];
        if (!a) return { ok: false, errors: { id: "Unknown announcement." } };
        a.title = String(body.title).trim();
        a.message = String(body.message).trim();
        a.details = String(body.details || "").trim();
        a.tournamentId = String(body.tournamentId || "").trim();
        a.type = String(body.type || "general").trim() || "general";
        a.updatedBy = actorName || "admin";
        a.updatedAt = now;
        a.history = a.history || [];
        a.history.push({ ts: now, event: "edited (demo)", by: actorName || "admin" });
      } else {
        all.push({
          id: "A-DEMO-" + Date.now().toString(36).toUpperCase(),
          title: String(body.title).trim(), message: String(body.message).trim(),
          details: String(body.details || "").trim(),
          tournamentId: String(body.tournamentId || "").trim(),
          type: String(body.type || "general").trim() || "general",
          published: !!body.published,
          createdBy: actorName || "admin", createdAt: now,
          updatedBy: actorName || "admin", updatedAt: now,
          publishedAt: body.published ? now : null,
          history: [{ ts: now, event: body.published ? "created + published (demo)" : "created as draft (demo)", by: actorName || "admin" }]
        });
      }
      writeLocal(all);
      return { ok: true };
    }
  };

  // Full-row remote cache (admin view incl. drafts) — separate from the
  // published-only public cache so drafts can never leak into public reads.
  var FULL_KEY = "af_announcements_remote_full_v1";
  function readRemoteCacheFull() {
    try {
      var raw = localStorage.getItem(FULL_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (o && Array.isArray(o.list)) return o.list;
    } catch (e) {}
    return null;
  }
  window.AF_ANNS.setRemoteFull = function (list) {
    try { localStorage.setItem(FULL_KEY, JSON.stringify({ ts: Date.now(), list: list || [] })); } catch (e) {}
  };
})();
