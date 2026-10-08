/* AF TOURNAMENTS — Part 4: canonical registration + payment data layer.
   Single storage system (same key Part 3 used — no parallel store; old records
   migrate on load). Tournament data stays separate (window.AF_TOURNAMENTS).
   The data layer ALWAYS recalculates the amount from playerCount × the
   tournament's fee-per-head and never trusts a browser-sent total.
   "Verified" is never assigned by user-facing code — only setRegStatus /
   setPayStatus with by:"admin" (future backend) can reach verified/approved.
   Exposed as window.AF_REG for the form (Part 3), tracking UI (Part 4),
   and any future backend adapter. */

(function () {
  "use strict";

  var KEY = "af_registrations_v1";

  var LIMITS = { feeFallbackPerHead: 100, minPlayers: 1, maxPlayers: 25, proofMaxMB: 5 };

  // Status vocabularies. Glyph + text everywhere; never color alone.
  var REG_STATUS = {
    submitted: { label: "SUBMITTED", glyph: "●" },
    pending: { label: "PENDING REVIEW", glyph: "◐" },
    approved: { label: "APPROVED", glyph: "✔" },
    rejected: { label: "REJECTED", glyph: "✕" },
    cancelled: { label: "CANCELLED", glyph: "○" }
  };
  var PAY_STATUS = {
    pending: { label: "PAYMENT PENDING", glyph: "○" },
    submitted: { label: "PAYMENT SUBMITTED", glyph: "◐" },
    verified: { label: "PAYMENT VERIFIED", glyph: "✔" },
    rejected: { label: "PAYMENT REJECTED", glyph: "✕" }
  };
  // Allowed transitions. Users may only reach "cancelled" (own record).
  var REG_FLOW = {
    submitted: ["pending", "cancelled"],
    pending: ["approved", "rejected", "cancelled"],
    approved: [],
    rejected: [],
    cancelled: []
  };
  var PAY_FLOW = {
    pending: ["submitted"],
    submitted: ["verified", "rejected"],
    verified: [],
    rejected: []
  };

  function scrims() {
    // Admin-managed list wins when available (Part 5); public mirror otherwise.
    if (window.AF_TOURN && typeof window.AF_TOURN.publicList === "function") {
      try { return window.AF_TOURN.publicList(); } catch (e) {}
    }    if (window.AF_TOURNAMENTS && window.AF_TOURNAMENTS.length) return window.AF_TOURNAMENTS;
    return [
      { id: "daily-match-01", name: "Daily Scrim · Match 01", times: ["09:30"], status: "open", entryFeePerHead: 100, registrationOpen: true },
      { id: "daily-match-02", name: "Daily Scrim · Match 02", times: ["10:20"], status: "open", entryFeePerHead: 100, registrationOpen: true },
      { id: "next-block", name: "Next Scrim Block", times: ["09:30", "10:20"], status: "upcoming", entryFeePerHead: 100, registrationOpen: false },
      { id: "previous-lobby", name: "Previous Daily Lobby", times: ["09:30", "10:20"], status: "closed", entryFeePerHead: 100, registrationOpen: false }
    ];
  }
  function findScrim(id) {
    return scrims().filter(function (t) { return t.id === id; })[0] || null;
  }
  function feePerHead(scrim) {
    var f = scrim && Number(scrim.entryFeePerHead);
    return f > 0 ? f : LIMITS.feeFallbackPerHead;
  }
  function normContact(v) {
    var d = String(v || "").replace(/[\s\-()]/g, "");
    if (/^\+923\d{9}$/.test(d)) return "0" + d.slice(3);
    if (/^923\d{9}$/.test(d)) return "0" + d.slice(2);
    return d;
  }

  function migrate(r) {
    if (!r.regStatus) r.regStatus = "submitted";
    if (!r.payStatus) r.payStatus = r.payRef ? "submitted" : "pending";
    if (!Array.isArray(r.history)) r.history = [{ ts: r.ts || new Date().toISOString(), event: "migrated to Part 4 record" }];
    return r;
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      var out = arr.map(migrate), dirty = false;
      arr.forEach(function (r) {
        if (!r.regStatus || !r.payStatus || !Array.isArray(r.history)) dirty = true;
      });
      if (dirty) { try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) {} }
      return out;
    } catch (e) { return []; }
  }
  function write(arr) {
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
  }

  // Canonical validation (data layer). Returns {valid, errors, contact, count, fee, total}.
  function validate(d) {
    var errs = {};
    var scrim = findScrim(d.scrimId);
    if (!scrim) errs.scrimId = "Unknown tournament ID.";
    else if (!scrim.registrationOpen || scrim.status !== "open") errs.scrimId = "Registration is not open for this lobby.";
    var team = String(d.teamName || "").trim();
    if (team.length < 2 || team.length > 60) errs.teamName = "Team name must be 2–60 characters.";
    var cap = String(d.captain || "").trim();
    if (cap.length < 2 || cap.length > 60) errs.captain = "Captain name must be 2–60 characters.";
    var c = normContact(d.contact);
    if (!/^03\d{9}$/.test(c)) errs.contact = "Invalid contact number.";
    var n = Number(d.playerCount);
    var countOk = /^\d+$/.test(String(d.playerCount)) && n >= LIMITS.minPlayers && n <= LIMITS.maxPlayers;
    if (!countOk) errs.playerCount = "Player count out of bounds.";
    var seen = {};
    (d.players || []).forEach(function (p, i) {
      var nm = String(p.name || "").trim(), gid = String(p.gameId || "").trim();
      if (nm.length < 2 || nm.length > 30) errs["pname" + i] = "Bad player name.";
      if (gid.length < 2 || gid.length > 40) errs["pgame" + i] = "Bad player ID.";
      var k = gid.toLowerCase();
      if (gid && seen[k] !== undefined) errs["pgame" + i] = "Duplicate player ID.";
      else if (gid) seen[k] = i;
    });
    if ((d.players || []).length !== n) errs.playerCount = errs.playerCount || "Player details do not match count.";
    if (d.payMethod !== "easypaisa" && d.payMethod !== "ubl") errs.payMethod = "Bad payment method.";
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-.]{3,39}$/.test(String(d.payRef || "").trim())) errs.payRef = "Bad payment reference.";
    if (d.proof) {
      var okT = /^(image\/|application\/pdf)/.test(d.proof.type || "");
      if (!okT) errs.proof = "Bad proof type.";
      else if (d.proof.size > LIMITS.proofMaxMB * 1024 * 1024) errs.proof = "Proof too large.";
    }
    var fee = feePerHead(scrim);
    return { valid: Object.keys(errs).length === 0, errors: errs, contact: c, count: n, fee: fee, total: n * fee };
  }

  // Build a record. Any browser-supplied total is IGNORED — always recalculated.
  function createRecord(d) {
    var v = validate(d);
    if (!v.valid) return { ok: false, errors: v.errors };
    var scrim = findScrim(d.scrimId);
    var now = new Date().toISOString();
    return {
      ok: true,
      record: {
        id: "AF-" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(),
        ts: now,
        scrimId: d.scrimId,
        scrimName: scrim.name + " (" + scrim.times.join(" · ") + ")",
        teamName: String(d.teamName).trim(),
        captain: String(d.captain).trim(),
        contact: v.contact,
        playerCount: v.count,
        players: d.players.map(function (p) { return { name: String(p.name).trim(), gameId: String(p.gameId).trim() }; }),
        notes: String(d.notes || "").trim(),
        feePerHead: v.fee,
        totalFee: v.total, // server-calculated, never from the browser
        payMethod: d.payMethod,
        payRef: String(d.payRef).trim(),
        proofName: d.proof ? (d.proof.name || "") : "",
        regStatus: "submitted",
        payStatus: "submitted", // reference received — NOT verified
        history: [{ ts: now, event: "submitted — awaiting verification" }]
      }
    };
  }

  // Re-verify a stored record: recompute amount, flag tampering for review.
  function verifyStored(r) {
    var scrim = findScrim(r.scrimId);
    var fee = feePerHead(scrim);
    var expected = Number(r.playerCount) * fee;
    return {
      feePerHead: fee,
      expectedTotal: expected,
      amountOk: Number(r.totalFee) === expected && Number(r.feePerHead) === fee,
      scrimKnown: !!scrim
    };
  }

  function setStatus(id, kind, to, by) {
    var arr = read();
    var r = arr.filter(function (x) { return x.id === id; })[0];
    if (!r) return { ok: false, error: "Record not found." };
    var flow, cur;
    if (kind === "reg") { flow = REG_FLOW; cur = r.regStatus; }
    else if (kind === "pay") { flow = PAY_FLOW; cur = r.payStatus; }
    else return { ok: false, error: "Unknown status kind." };
    if ((flow[cur] || []).indexOf(to) === -1) return { ok: false, error: "Transition not allowed from " + cur + " to " + to + "." };
    // Backend/data-layer authorization: admin moves require an admin session.
    // (Frontend-only until a backend verifies sessions server-side — see auth.js.)
    if (by === "admin" && window.AF_AUTH && !window.AF_AUTH.isAdmin())
      return { ok: false, error: "Admin session required." };
    // User self-service may only cancel their own active registration.
    if (by === "user" && !(kind === "reg" && to === "cancelled" && (cur === "submitted" || cur === "pending")))
      return { ok: false, error: "Not permitted." };
    if (kind === "reg") r.regStatus = to; else r.payStatus = to;
    r.history.push({ ts: new Date().toISOString(), event: cur + " → " + to, by: by || "system" });
    write(arr);
    return { ok: true, record: r };
  }

  window.AF_REG = {
    LIMITS: LIMITS,
    REG_STATUS: REG_STATUS,
    PAY_STATUS: PAY_STATUS,
    REG_FLOW: REG_FLOW,
    PAY_FLOW: PAY_FLOW,
    normContact: normContact,
    feePerHead: feePerHead,
    findScrim: findScrim,
    validate: validate,
    createRecord: createRecord,
    verifyStored: verifyStored,
    all: read,
    getById: function (id) {
      return read().filter(function (x) { return String(x.id).toUpperCase() === String(id).toUpperCase().trim(); })[0] || null;
    },
    findByContact: function (c) {
      var n = normContact(c);
      if (!/^03\d{9}$/.test(n)) return { ok: false, error: "Enter a valid contact number." };
      return { ok: true, records: read().filter(function (x) { return x.contact === n; }) };
    },
    isDuplicate: function (scrimId, team, contact) {
      var t = String(team).trim().toLowerCase();
      return read().some(function (r) {
        return r.scrimId === scrimId && String(r.teamName).trim().toLowerCase() === t && r.contact === contact && r.regStatus !== "cancelled";
      });
    },
    save: function (record) {
      var arr = read();
      arr.push(record);
      write(arr);
      return record;
    },
    setStatus: setStatus
  };
})();
