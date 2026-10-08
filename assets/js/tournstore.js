/* AF TOURNAMENTS — Part 5: tournament store (admin-managed).
   Canonical tournament data for admin + public. Defaults mirror
   assets/data/tournaments.json; admin edits/new tournaments persist as
   overrides in localStorage (key below). Public pages read publicList()
   (defaults overlaid with admin patches + additions) — registration records
   keep only scrimId/scrimName snapshots, so tournaments stay separate.
   No dates are invented: there is no date field — datePolicy text is fixed.
   Prize stays null ("Coming soon") unless an admin enters a real value. */

(function () {
  "use strict";

  var KEY = "af_tournaments_admin_v1";
  var REMOTE_KEY = "af_tournaments_remote_v1"; // last server snapshot (cache only)
  var STATUSES = ["open", "upcoming", "full", "closed"];

  function defaults() {
    return [
      { id: "daily-match-01", name: "Daily Scrim · Match 01", tagline: "Morning lobby — be ready for check-in via WhatsApp.", status: "open", entryFeePerHead: 100, format: "All Formats", matchCount: 1, matchNote: "1 of 2 daily matches", times: ["09:30"], teams: "Not Fixed", prize: null, registrationOpen: true },
      { id: "daily-match-02", name: "Daily Scrim · Match 02", tagline: "Second lobby of the day — same rules, new lobby.", status: "open", entryFeePerHead: 100, format: "All Formats", matchCount: 1, matchNote: "1 of 2 daily matches", times: ["10:20"], teams: "Not Fixed", prize: null, registrationOpen: true },
      { id: "next-block", name: "Next Scrim Block", tagline: "Upcoming block — date drops first in the WhatsApp group.", status: "upcoming", entryFeePerHead: 100, format: "All Formats", matchCount: 2, matchNote: "2 matches per day", times: ["09:30", "10:20"], teams: "Not Fixed", prize: null, registrationOpen: false },
      { id: "previous-lobby", name: "Previous Daily Lobby", tagline: "Lobby closed — watch the group for the next announcement.", status: "closed", entryFeePerHead: 100, format: "All Formats", matchCount: 2, matchNote: "2 matches per day", times: ["09:30", "10:20"], teams: "Not Fixed", prize: null, registrationOpen: false }
    ];
  }

  function readOverrides() {
    try {
      var raw = localStorage.getItem(KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (!o || typeof o !== "object") return { edited: {}, added: [] };
      if (!o.edited || typeof o.edited !== "object") o.edited = {};
      if (!Array.isArray(o.added)) o.added = [];
      return o;
    } catch (e) { return { edited: {}, added: [] }; }
  }
  function writeOverrides(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }

  function publicList() {
    // Live server snapshot wins when the backend is reachable (Part 6);
    // otherwise admin overrides on top of the static defaults (Parts 2–5).
    try {
      if (window.AF_API && window.AF_API.mode === "remote") {
        var raw = localStorage.getItem(REMOTE_KEY);
        var snap = raw ? JSON.parse(raw) : null;
        if (snap && Array.isArray(snap.list) && snap.list.length) return snap.list;
      }
    } catch (e) {}
    var o = readOverrides();
    var list = defaults().map(function (t) {
      var patch = o.edited[t.id];
      if (!patch) return t;
      var merged = {};
      Object.keys(t).forEach(function (k) { merged[k] = t[k]; });
      Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
      merged.id = t.id; // ids are immutable
      return merged;
    });
    o.added.forEach(function (t) { list.push(t); });
    return list;
  }

  function validateTournament(t, isNew) {
    var errs = {};
    if (isNew) {
      if (!/^[a-z0-9-]{3,40}$/.test(String(t.id || ""))) errs.id = "ID: 3–40 chars, lowercase letters, numbers, hyphens.";
      else if (publicList().some(function (x) { return x.id === t.id; })) errs.id = "That ID already exists.";
    }
    var name = String(t.name || "").trim();
    if (name.length < 3 || name.length > 60) errs.name = "Name: 3–60 characters.";
    var format = String(t.format || "").trim();
    if (format.length < 2 || format.length > 40) errs.format = "Format: 2–40 characters.";
    var fee = Number(t.entryFeePerHead);
    if (!Number.isInteger(fee) || fee < 0 || fee > 100000) errs.entryFeePerHead = "Entry fee: whole PKR 0–100000.";
    var mc = Number(t.matchCount);
    if (!Number.isInteger(mc) || mc < 1 || mc > 10) errs.matchCount = "Matches: 1–10.";
    var times = Array.isArray(t.times) ? t.times : String(t.times || "").split(/[,\s]+/).filter(Boolean);
    if (!times.length || times.length > 4) errs.times = "Give 1–4 match times.";
    else if (!times.every(function (x) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(x); }))
      errs.times = "Times must look like 09:30 (24-hour HH:MM).";
    var teams = String(t.teams || "").trim();
    if (teams.length < 2 || teams.length > 40) errs.teams = "Teams: 2–40 characters (e.g. Not Fixed).";
    if (STATUSES.indexOf(t.status) === -1) errs.status = "Invalid tournament status.";
    return { valid: Object.keys(errs).length === 0, errors: errs, times: times };
  }

  window.AF_TOURN = {
    STATUSES: STATUSES,
    defaults: defaults,
    publicList: publicList,
    setRemote: function (list) {
      try { localStorage.setItem(REMOTE_KEY, JSON.stringify({ ts: Date.now(), list: list })); } catch (e) {}
    },
    validate: validateTournament,
    get: function (id) {
      return publicList().filter(function (t) { return t.id === id; })[0] || null;
    },
    saveTournament: function (t, actor) {
      // t: full tournament object (new) or {id + patch fields} (edit)
      var isNew = !defaults().some(function (d) { return d.id === t.id; }) &&
        !readOverrides().added.some(function (a) { return a.id === t.id; });
      var v = validateTournament(t, isNew);
      if (!v.valid) return { ok: false, errors: v.errors };
      var o = readOverrides();
      if (isNew) {
        o.added.push({
          id: t.id, name: String(t.name).trim(), tagline: String(t.tagline || "").trim() || "Announced via WhatsApp.",
          status: t.status, entryFeePerHead: Number(t.entryFeePerHead), format: String(t.format).trim(),
          matchCount: Number(t.matchCount), matchNote: Number(t.matchCount) + (Number(t.matchCount) === 1 ? " match" : " matches") + " per day",
          times: v.times, teams: String(t.teams).trim(), prize: t.prize === "" || t.prize == null ? null : String(t.prize).trim(),
          registrationOpen: !!t.registrationOpen, updatedBy: actor || "admin", updatedAt: new Date().toISOString()
        });
      } else {
        var base = publicList().filter(function (x) { return x.id === t.id; })[0];
        if (!base) return { ok: false, errors: { id: "Unknown tournament." } };
        var patch = o.edited[t.id] || {};
        ["name", "tagline", "status", "format", "teams"].forEach(function (k) {
          if (t[k] !== undefined) patch[k] = typeof t[k] === "string" ? t[k].trim() : t[k];
        });
        if (t.entryFeePerHead !== undefined) patch.entryFeePerHead = Number(t.entryFeePerHead);
        if (t.matchCount !== undefined) {
          patch.matchCount = Number(t.matchCount);
          patch.matchNote = patch.matchCount + (patch.matchCount === 1 ? " match" : " matches") + " per day";
        }
        if (t.times !== undefined) patch.times = v.times;
        if (t.prize !== undefined) patch.prize = (t.prize === "" || t.prize == null) ? null : String(t.prize).trim();
        if (t.registrationOpen !== undefined) patch.registrationOpen = !!t.registrationOpen;
        patch.updatedBy = actor || "admin";
        patch.updatedAt = new Date().toISOString();
        o.edited[t.id] = patch;
      }
      writeOverrides(o);
      return { ok: true };
    }
  };
})();
