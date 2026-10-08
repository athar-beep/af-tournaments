/* AF TOURNAMENTS — Part 3: Scrim Registration.
   No backend exists yet, so the data layer is a structured localStorage store
   (REG_STORE) with its own validation — swap submitToBackend() for a real POST
   later without touching the form UI. Frontend validation is never trusted
   alone: every record passes validateRecord() again before storage.
   Fee: per-head fee comes from the selected tournament (fallback PKR 100).
   Player-count cap (MAX_PLAYERS) is a form practicality bound, configurable —
   teams themselves are "Not Fixed" per tournament policy. */

(function () {
  "use strict";

  var WA_URL = "https://chat.whatsapp.com/GM9tP4702TY8xyZme6KltE?s=cl&p=i&ilr=4&iam=2";
  var REG_CONFIG = {
    feeFallbackPerHead: 100,
    minPlayers: 1,
    maxPlayers: 25, // configurable form bound; NOT a tournament rule
    proofMaxMB: 5,
    storageKey: "af_registrations_v1"
  };

  var FALLBACK_SCRIMS = [
    { id: "daily-match-01", name: "Daily Scrim · Match 01", times: ["09:30"], status: "open", entryFeePerHead: 100, registrationOpen: true },
    { id: "daily-match-02", name: "Daily Scrim · Match 02", times: ["10:20"], status: "open", entryFeePerHead: 100, registrationOpen: true },
    { id: "next-block", name: "Next Scrim Block", times: ["09:30", "10:20"], status: "upcoming", entryFeePerHead: 100, registrationOpen: false },
    { id: "previous-lobby", name: "Previous Daily Lobby", times: ["09:30", "10:20"], status: "closed", entryFeePerHead: 100, registrationOpen: false }
  ];

  function getScrims() {
    if (window.AF_TOURNAMENTS && window.AF_TOURNAMENTS.length) return window.AF_TOURNAMENTS;
    return FALLBACK_SCRIMS;
  }
  function findScrim(id) {
    return getScrims().filter(function (t) { return t.id === id; })[0] || null;
  }
  function feePerHead(scrim) {
    var f = scrim && Number(scrim.entryFeePerHead);
    return f > 0 ? f : REG_CONFIG.feeFallbackPerHead;
  }

  // ---------- Store: canonical Part 4 data layer (window.AF_REG) when
  // loaded; local fallback keeps the form working standalone. Same key,
  // same shape — never a parallel system.
  var REG_STORE = {
    all: function () {
      if (window.AF_REG) return window.AF_REG.all();
      try {
        var raw = localStorage.getItem(REG_CONFIG.storageKey);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    },
    save: function (record) {
      if (window.AF_REG) return window.AF_REG.save(record);
      var arr = REG_STORE.all();
      arr.push(record);
      try { localStorage.setItem(REG_CONFIG.storageKey, JSON.stringify(arr)); }
      catch (e) { /* storage full/blocked: record still returned for success UI */ }
      return record;
    },
    isDuplicate: function (scrimId, team, contact) {
      if (window.AF_REG) return window.AF_REG.isDuplicate(scrimId, team, contact);
      var t = team.trim().toLowerCase();
      return REG_STORE.all().some(function (r) {
        return r.scrimId === scrimId && String(r.teamName).trim().toLowerCase() === t && r.contact === contact;
      });
    }
  };

  // ---------- Data-layer validation (also used pre-storage) ----------
  function normContact(v) {
    var d = String(v || "").replace(/[\s\-()]/g, "");
    if (/^\+923\d{9}$/.test(d)) return "0" + d.slice(3);
    if (/^923\d{9}$/.test(d)) return "0" + d.slice(2);
    return d;
  }

  function validateRecord(d) {
    var errs = {};
    var scrim = findScrim(d.scrimId);
    if (!scrim) errs.scrimId = "Please select a scrim.";
    else if (!scrim.registrationOpen || scrim.status !== "open") errs.scrimId = "Registration is not open for this lobby. Choose an OPEN scrim or join WhatsApp for announcements.";

    if (!d.teamName || d.teamName.trim().length < 2) errs.teamName = "Team name needs at least 2 characters.";
    else if (d.teamName.trim().length > 60) errs.teamName = "Team name must be 60 characters or fewer.";
    if (!d.captain || d.captain.trim().length < 2) errs.captain = "Captain / organizer name needs at least 2 characters.";
    else if (d.captain.trim().length > 60) errs.captain = "Keep the captain name to 60 characters or fewer.";

    var c = normContact(d.contact);
    if (!/^03\d{9}$/.test(c)) errs.contact = "Enter a valid Pakistani mobile, e.g. 0341 0106061 or +92 341 0106061.";

    var n = Number(d.playerCount);
    if (!/^\d+$/.test(String(d.playerCount)) || n < REG_CONFIG.minPlayers || n > REG_CONFIG.maxPlayers)
      errs.playerCount = "Player count must be between " + REG_CONFIG.minPlayers + " and " + REG_CONFIG.maxPlayers + ".";

    var seen = {};
    (d.players || []).forEach(function (p, i) {
      var nm = (p.name || "").trim(), gid = (p.gameId || "").trim();
      if (nm.length < 2 || nm.length > 30) errs["pname" + i] = "Player " + (i + 1) + ": in-game name needs 2–30 characters.";
      if (gid.length < 2 || gid.length > 40) errs["pgame" + i] = "Player " + (i + 1) + ": player / game ID needs 2–40 characters.";
      var key = gid.toLowerCase();
      if (gid && seen[key]) errs["pgame" + i] = "Player " + (i + 1) + ": this ID is already used for player " + (seen[key] + 1) + ".";
      else if (gid) seen[key] = i;
    });
    if ((d.players || []).length !== n) errs.playerCount = errs.playerCount || "Player details do not match the player count.";

    if (d.payMethod !== "easypaisa" && d.payMethod !== "ubl") errs.payMethod = "Choose a payment method.";
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-.]{3,39}$/.test(String(d.payRef || "").trim()))
      errs.payRef = "Enter the transaction / reference ID from your payment (4–40 characters).";
    if (!d.confirmPaid) errs.confirmPaid = "Please confirm you completed the payment per the instructions.";

    if (d.proof) {
      var okType = /^(image\/|application\/pdf)/.test(d.proof.type || "");
      if (!okType) errs.proof = "Payment proof must be an image or PDF.";
      else if (d.proof.size > REG_CONFIG.proofMaxMB * 1024 * 1024)
        errs.proof = "Payment proof must be " + REG_CONFIG.proofMaxMB + " MB or smaller.";
    }
    return { valid: Object.keys(errs).length === 0, errors: errs, contact: c };
  }

  // ---------- Form wiring ----------
  var form = document.getElementById("reg-form");
  if (!form) return;

  var scrimSel = document.getElementById("reg-scrim");
  var teamEl = document.getElementById("reg-team");
  var capEl = document.getElementById("reg-captain");
  var contactEl = document.getElementById("reg-contact");
  var countEl = document.getElementById("reg-count");
  var playersBox = document.getElementById("reg-players");
  var notesEl = document.getElementById("reg-notes");
  var payRefEl = document.getElementById("reg-payref");
  var proofEl = document.getElementById("reg-proof");
  var confirmEl = document.getElementById("reg-confirm");
  var submitBtn = document.getElementById("reg-submit");
  var statusBox = document.getElementById("reg-status");
  var feeLine = document.getElementById("fee-line");
  var feeTotal = document.getElementById("fee-total");
  var feePerEl = document.getElementById("fee-per");
  var successBox = document.getElementById("reg-success");
  var submitting = false;

  // Populate scrim select: open lobbies enabled, others disabled with reason
  function buildScrims() {
    scrimSel.innerHTML = '<option value="">Choose a scrim…</option>' +
      getScrims().map(function (t) {
        var open = t.registrationOpen && t.status === "open";
        var label = t.name + " (" + t.times.join(" · ") + ") — " + (open ? "OPEN" : t.status.toUpperCase());
        return '<option value="' + t.id + '"' + (open ? "" : " disabled") + ">" + label + "</option>";
      }).join("");
  }
  buildScrims();

  function setErr(input, key, msg) {
    var errEl = form.querySelector('[data-err-for="' + key + '"]');
    if (msg) {
      if (input) input.setAttribute("aria-invalid", "true");
      if (errEl) { errEl.textContent = msg; errEl.classList.add("show"); }
    } else {
      if (input) input.removeAttribute("aria-invalid");
      if (errEl) { errEl.textContent = ""; errEl.classList.remove("show"); }
    }
  }

  function readPlayers() {
    var rows = Array.prototype.slice.call(playersBox.querySelectorAll(".player-card"));
    return rows.map(function (row) {
      return {
        name: row.querySelector('[data-pname]').value,
        gameId: row.querySelector('[data-pgame]').value
      };
    });
  }

  function buildPlayerFields(n, keep) {
    var prev = keep ? readPlayers() : [];
    playersBox.innerHTML = "";
    for (var i = 0; i < n; i++) {
      var card = document.createElement("div");
      card.className = "player-card";
      card.innerHTML =
        "<h4><span class='p-badge'>" + (i + 1) + "</span>Player " + (i + 1) + "</h4>" +
        "<div class='f-row f-2'>" +
        "<div class='field'><label for='pname" + i + "'>In-game name</label>" +
        "<input type='text' id='pname" + i + "' data-pname maxlength='30' autocomplete='off' />" +
        "<p class='f-error' data-err-for='pname" + i + "'></p></div>" +
        "<div class='field'><label for='pgame" + i + "'>Player / game ID</label>" +
        "<input type='text' id='pgame" + i + "' data-pgame maxlength='40' autocomplete='off' />" +
        "<p class='f-error' data-err-for='pgame" + i + "'></p></div></div>";
      playersBox.appendChild(card);
      if (prev[i]) {
        card.querySelector("[data-pname]").value = prev[i].name || "";
        card.querySelector("[data-pgame]").value = prev[i].gameId || "";
      }
    }
  }

  function clampCount() {
    var n = parseInt(countEl.value, 10);
    if (isNaN(n)) return 0;
    return Math.min(Math.max(n, REG_CONFIG.minPlayers), REG_CONFIG.maxPlayers);
  }

  function refreshFee() {
    var scrim = findScrim(scrimSel.value);
    var fee = feePerHead(scrim);
    var n = parseInt(countEl.value, 10);
    if (isNaN(n) || n < 1) n = 0;
    if (feePerEl) feePerEl.textContent = "PKR " + fee;
    if (feeLine) feeLine.textContent = n + (n === 1 ? " player" : " players") + " × PKR " + fee;
    if (feeTotal) feeTotal.textContent = "PKR " + (n * fee).toLocaleString("en-PK");
  }

  var lastCount = 4;
  countEl.value = "4";
  buildPlayerFields(4, false);
  refreshFee();

  countEl.addEventListener("change", function () {
    var n = clampCount();
    if (String(n) !== countEl.value) countEl.value = n > 0 ? String(n) : countEl.value;
    if (n >= REG_CONFIG.minPlayers) { buildPlayerFields(n, true); lastCount = n; setErr(countEl, "playerCount", ""); }
    refreshFee();
  });
  scrimSel.addEventListener("change", function () { setErr(scrimSel, "scrimId", ""); refreshFee(); });
  form.addEventListener("input", refreshFee, true);

  function collect() {
    var payChecked = form.querySelector('input[name="paymethod"]:checked');
    var proof = proofEl && proofEl.files && proofEl.files[0] ? { type: proofEl.files[0].type, size: proofEl.files[0].size, name: proofEl.files[0].name } : null;
    return {
      scrimId: scrimSel.value,
      teamName: teamEl.value,
      captain: capEl.value,
      contact: contactEl.value,
      playerCount: countEl.value,
      players: readPlayers(),
      notes: notesEl.value,
      payMethod: payChecked ? payChecked.value : "",
      payRef: payRefEl.value,
      proof: proof,
      confirmPaid: !!(confirmEl && confirmEl.checked)
    };
  }

  function showErrors(errors) {
    setErr(scrimSel, "scrimId", errors.scrimId || "");
    setErr(teamEl, "teamName", errors.teamName || "");
    setErr(capEl, "captain", errors.captain || "");
    setErr(contactEl, "contact", errors.contact || "");
    setErr(countEl, "playerCount", errors.playerCount || "");
    var n = readPlayers().length;
    for (var i = 0; i < n; i++) {
      setErr(playersBox.querySelector("#pname" + i), "pname" + i, errors["pname" + i] || "");
      setErr(playersBox.querySelector("#pgame" + i), "pgame" + i, errors["pgame" + i] || "");
    }
    var payFirst = form.querySelector('input[name="paymethod"]');
    setErr(payFirst, "payMethod", errors.payMethod || "");
    setErr(payRefEl, "payRef", errors.payRef || "");
    setErr(proofEl, "proof", errors.proof || "");
    setErr(confirmEl, "confirmPaid", errors.confirmPaid || "");
  }

  function focusFirstError(errors) {
    var order = ["scrimId", "teamName", "captain", "contact", "playerCount", "pname0", "pgame0", "payMethod", "payRef", "proof", "confirmPaid"];
    var firstKey = null;
    Object.keys(errors).forEach(function (k) {
      if (!firstKey && order.indexOf(k) !== -1) firstKey = k;
      if (!firstKey) firstKey = k;
    });
    var map = { scrimId: scrimSel, teamName: teamEl, captain: capEl, contact: contactEl, playerCount: countEl, payRef: payRefEl, proof: proofEl, confirmPaid: confirmEl };
    var t = map[firstKey] || (/^p(name|game)\d+$/.test(firstKey || "") ?
      playersBox.querySelector("#" + firstKey.replace("pname", "pname").replace("pgame", "pgame")) : null);
    if (t && t.focus) { t.focus({ preventScroll: false }); t.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }

  // Part 6: real backend when reachable (server validates, calculates and
  // stores; proof file uploads with the request). Offline: explicit
  // on-device-only path — the success panel says so, never fake-shared.
  function remoteMode() {
    return !!(window.AF_API && window.AF_API.mode === "remote" && window.AF_SVC);
  }
  function submitToBackend(record, d) {
    if (!remoteMode()) return Promise.resolve({ record: record, offline: true });
    var fd = new FormData();
    ["scrimId", "teamName", "captain", "contact", "playerCount", "notes", "payMethod", "payRef"].forEach(function (k) {
      fd.append(k, d[k] == null ? "" : d[k]);
    });
    fd.append("players", JSON.stringify(d.players || []));
    if (proofEl && proofEl.files && proofEl.files[0]) fd.append("proof", proofEl.files[0]);
    return window.AF_SVC.createRegistration(fd).then(function (out) {
      if (!out.ok) throw out;
      return { record: out.data, offline: false };
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitting) return; // duplicate-submit guard
    var d = collect();
    var res = validateRecord(d);
    showErrors(res.errors);
    if (statusBox) { statusBox.classList.remove("show", "error"); statusBox.textContent = ""; }
    if (!res.valid) {
      if (statusBox) { statusBox.textContent = "Please fix the highlighted fields — your entries are kept."; statusBox.classList.add("show", "error"); }
      focusFirstError(res.errors);
      return;
    }
    d.contact = res.contact;
    if (REG_STORE.isDuplicate(d.scrimId, d.teamName, d.contact)) {
      if (statusBox) { statusBox.textContent = "This team + contact looks already registered for this scrim. For changes, message us in the WhatsApp group."; statusBox.classList.add("show", "error"); }
      statusBox.focus && statusBox.focus();
      return;
    }
    submitting = true;
    submitBtn.classList.add("loading");
    submitBtn.disabled = true;
    submitBtn.querySelector(".btn-label").textContent = "Submitting…";

    // Build via the canonical data layer when present: it recalculates the
    // amount (never trusts a browser total) and assigns initial statuses.
    var record;
    if (window.AF_REG) {
      var built = window.AF_REG.createRecord({
        scrimId: d.scrimId, teamName: d.teamName, captain: d.captain,
        contact: d.contact, playerCount: d.playerCount, players: d.players,
        notes: d.notes, payMethod: d.payMethod, payRef: d.payRef, proof: d.proof
      });
      if (!built.ok) {
        submitting = false;
        submitBtn.classList.remove("loading");
        submitBtn.disabled = false;
        submitBtn.querySelector(".btn-label").textContent = "Submit Registration";
        showErrors(built.errors);
        focusFirstError(built.errors);
        return;
      }
      record = built.record;
    } else {
    var scrim = findScrim(d.scrimId);
    var fee = feePerHead(scrim);
    var record = {
      id: "AF-" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(),
      ts: new Date().toISOString(),
      scrimId: d.scrimId,
      scrimName: scrim.name + " (" + scrim.times.join(" · ") + ")",
      teamName: d.teamName.trim(),
      captain: d.captain.trim(),
      contact: d.contact,
      playerCount: Number(d.playerCount),
      players: d.players.map(function (p) { return { name: p.name.trim(), gameId: p.gameId.trim() }; }),
      notes: (d.notes || "").trim(),
      feePerHead: fee,
      totalFee: Number(d.playerCount) * fee,
      payMethod: d.payMethod,
      payRef: d.payRef.trim(),
      proofName: d.proof ? d.proof.name : "",
      status: "submitted — awaiting verification"
    };

    // Never trust frontend validation alone: re-validate the final record.
    var recheck = validateRecord({
      scrimId: record.scrimId, teamName: record.teamName, captain: record.captain,
      contact: record.contact, playerCount: String(record.playerCount), players: record.players,
      payMethod: record.payMethod, payRef: record.payRef,
      proof: d.proof, confirmPaid: true
    });
    if (!recheck.valid) {
      submitting = false;
      submitBtn.classList.remove("loading");
      submitBtn.disabled = false;
      submitBtn.querySelector(".btn-label").textContent = "Submit Registration";
      showErrors(recheck.errors);
      return;
    }
    } // end no-AF_REG fallback (record built locally above)

    submitToBackend(record, d).then(function (res) {
      var saved = res.record;
      REG_STORE.save(saved); // local cache copy (tracking + offline reads)
      submitting = false;
      try { window.dispatchEvent(new CustomEvent("af-registration-saved", { detail: { id: saved.id } })); } catch (e) {}
      form.hidden = true;
      var feeBox = document.getElementById("fee-card");
      if (feeBox) feeBox.hidden = true;
      renderSuccess(saved, res.offline);
      successBox.hidden = false;
      successBox.scrollIntoView({ block: "start", behavior: "smooth" });
      var h = successBox.querySelector("h2");
      if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    }, function (err) {
      submitting = false;
      submitBtn.classList.remove("loading");
      submitBtn.disabled = false;
      submitBtn.querySelector(".btn-label").textContent = "Submit Registration";
      if (err && err.errors && Object.keys(err.errors).length) {
        showErrors(err.errors);
        focusFirstError(err.errors);
        if (statusBox) { statusBox.textContent = "The server rejected some fields — your entries are kept."; statusBox.classList.add("show", "error"); }
      } else if (err && err.code === 409) {
        if (statusBox) { statusBox.textContent = "This team + contact is already registered for this scrim. For changes, message us in the WhatsApp group."; statusBox.classList.add("show", "error"); }
      } else {
        if (statusBox) { statusBox.textContent = "Could not reach the server — nothing was submitted. Check your connection, or register via the WhatsApp group."; statusBox.classList.add("show", "error"); }
      }
      if (statusBox) statusBox.focus && statusBox.focus();
    });
  });

  function renderSuccess(r, offlineDemo) {
    var payLabel = r.payMethod === "easypaisa" ? "EasyPaisa" : "UBL Bank";
    successBox.innerHTML =
      '<div class="ok-mark" aria-hidden="true">✓</div>' +
      "<h2>Registration submitted — awaiting verification</h2>" +
      "<p class='muted'>Thanks, <strong>" + escapeHTML(r.teamName) + "</strong>. Your slot request is received. Payment is <strong>not verified yet</strong> — our team confirms it manually and announces lobbies in WhatsApp.</p>" +
      "<dl>" +
      srow("Registration ID", r.id) +
      srow("Scrim", r.scrimName) +
      srow("Team", r.teamName) +
      srow("Players", String(r.playerCount)) +
      srow("Amount", "PKR " + r.totalFee.toLocaleString("en-PK") + " (" + r.playerCount + " × PKR " + r.feePerHead + ")") +
      srow("Paid via", payLabel) +
      srow("Reference", r.payRef) +
      "</dl>" +
      '<div class="rq-status-row">' +
      '<span class="rq-badge rq-reg-' + escapeAttr(r.regStatus || "submitted") + '"><span class="glyph" aria-hidden="true">●</span> ' + escapeHTML(regLabel(r.regStatus)) + "</span>" +
      '<span class="rq-badge rq-pay-' + escapeAttr(r.payStatus || "submitted") + '"><span class="glyph" aria-hidden="true">◐</span> ' + escapeHTML(payLabel2(r.payStatus)) + "</span>" +
      "</div>" +
      '<p class="await">Next step: join the official WhatsApp group — dates, slots and lobby codes are announced there first.</p>' +
      (offlineDemo ? '<p class="await" role="note">Saved on <strong>this device only</strong> — the backend is unreachable, so organizers cannot see it yet. Confirm your slot in the WhatsApp group.</p>' : "") +
      '<div class="t-actions" style="margin-top:14px">' +
      '<a class="btn btn-accent btn-sm" href="' + WA_URL + '" target="_blank" rel="noopener">Join WhatsApp Group</a>' +
      '<button class="btn btn-outline btn-sm" type="button" id="reg-again">New Registration</button>' +
      "</div>";
    var again = successBox.querySelector("#reg-again");
    if (again) again.addEventListener("click", function () {
      form.reset();
      countEl.value = "4";
      buildPlayerFields(4, false);
      refreshFee();
      showErrors({});
      form.hidden = false;
      var feeBox = document.getElementById("fee-card");
      if (feeBox) feeBox.hidden = false;
      successBox.hidden = true;
      submitBtn.classList.remove("loading");
      submitBtn.disabled = false;
      submitBtn.querySelector(".btn-label").textContent = "Submit Registration";
      buildScrims();
      form.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
  function srow(k, v) {
    return '<div class="s-row"><dt>' + k + "</dt><dd>" + escapeHTML(v) + "</dd></div>";
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(s) {
    return String(s || "").replace(/[^a-z-]/g, "");
  }
  function regLabel(s) {
    var m = { submitted: "SUBMITTED", pending: "PENDING REVIEW", approved: "APPROVED", rejected: "REJECTED", cancelled: "CANCELLED" };
    return m[s] || "SUBMITTED";
  }
  function payLabel2(s) {
    var m = { pending: "PAYMENT PENDING", submitted: "PAYMENT SUBMITTED", verified: "PAYMENT VERIFIED", rejected: "PAYMENT REJECTED" };
    return m[s] || "PAYMENT SUBMITTED";
  }
})();
