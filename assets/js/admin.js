/* AF TOURNAMENTS — Part 5: admin portal logic.
   Every mutation goes through the data layer (AF_REG.setStatus /
   AF_TOURN.saveTournament) with the signed-in actor — the transition maps
   there reject invalid moves, and by:"admin" moves additionally require
   AF_AUTH.isAdmin(). Destructive actions use two-click confirm. */

(function () {
  "use strict";

  var REG = window.AF_REG, TOURN = window.AF_TOURN, AUTH = window.AF_AUTH;
  var loginView = document.getElementById("view-login");
  var adminView = document.getElementById("view-admin");
  var who = document.getElementById("admin-who");
  var actorEl = document.getElementById("admin-actor");
  if (!REG || !TOURN || !AUTH || !loginView) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function authed() { return AUTH.isAdmin(); }
  function actor() { return AUTH.actor(); }
  function remoteMode() { return !!(window.AF_API && window.AF_API.mode === "remote" && window.AF_SVC); }

  // ---------- Auth views (unauthorized users never see the dashboard) ----------
  function showLogin() {
    loginView.hidden = false;
    adminView.hidden = true;
    who.hidden = true;
  }
  function showAdmin() {
    loginView.hidden = true;
    adminView.hidden = false;
    who.hidden = false;
    actorEl.textContent = actor() + (AUTH.mode && AUTH.mode() === "remote" ? "" : " (demo)");
    syncAndRender();
  }
  // Pull server truth into the local cache, then render from one place.
  // Reads stay identical offline; mutations below choose remote vs local.
  function syncAndRender() {
    stampMode();
    if (!remoteMode()) { renderAll(); return; }
    window.AF_SVC.adminRegs({}).then(function (out) {
      if (out.ok && Array.isArray(out.data)) {
        try { localStorage.setItem("af_registrations_v1", JSON.stringify(out.data)); } catch (e) {}
        renderAll();
      } else if (out.code === 401) {
        showLogin();
      } else {
        renderAll(); // cache still renders; banner explains staleness
      }
    });
  }
  function stampMode() {
    var sub = document.getElementById("dash-sub");
    if (!sub) return;
    if (remoteMode()) {
      sub.innerHTML = "Live numbers from the server. Admin actions are verified server-side.";
      var note = document.querySelector(".demo-note");
      if (note) note.innerHTML = "<strong>Connected to backend.</strong> Sign in with your admin password — sessions are httpOnly cookies, verified on every request.";
    } else {
      sub.textContent = "Demo data on this device — backend unreachable. Connect the server for shared persistence.";
    }
  }
  var loginForm = document.getElementById("login-form");
  var loginErr = document.getElementById("login-err");
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = loginForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    AUTH.login(document.getElementById("login-code").value, document.getElementById("login-actor").value).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok) {
        loginErr.textContent = res.error || "Sign in failed.";
        loginErr.style.display = "block";
        return;
      }
      loginErr.style.display = "none";
      loginForm.reset();
      showAdmin();
    });
  });
  document.getElementById("admin-logout").addEventListener("click", function () {
    AUTH.logout().then(function () { showLogin(); });
  });
  window.addEventListener("af-session-expired", function () {
    if (!adminView.hidden) {
      showLogin();
      loginErr.textContent = "Session expired — please sign in again.";
      loginErr.style.display = "block";
    }
  });
  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  // ---------- Tabs ----------
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab-btn"));
  function selectTab(name) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-tab") === name;
      t.setAttribute("aria-selected", String(on));
      document.getElementById("panel-" + t.getAttribute("data-tab")).hidden = !on;
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { selectTab(t.getAttribute("data-tab")); });
    t.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var n = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[n].focus();
      selectTab(tabs[n].getAttribute("data-tab"));
    });
  });

  // ---------- Badges / rows ----------
  function regBadge(s) {
    var m = REG.REG_STATUS[s] || REG.REG_STATUS.submitted;
    return '<span class="rq-badge rq-reg-' + esc(s) + '"><span class="glyph" aria-hidden="true">' + m.glyph + "</span> " + m.label + "</span>";
  }
  function payBadge(s) {
    var m = REG.PAY_STATUS[s] || REG.PAY_STATUS.submitted;
    return '<span class="rq-badge rq-pay-' + esc(s) + '"><span class="glyph" aria-hidden="true">' + m.glyph + "</span> " + m.label + "</span>";
  }
  function row(k, v) { return '<div class="s-row"><dt>' + k + "</dt><dd>" + esc(v) + "</dd></div>"; }
  function proofRow(r) {
    if (r.proofRef && remoteMode() && window.AF_SVC) {
      var url = window.AF_SVC.proofUrl(r.proofRef);
      return '<div class="s-row"><dt>Proof file</dt><dd><a href="' + esc(url) + '" download>Download ' + esc(r.proofName || "proof") + "</a></dd></div>";
    }
    if (r.proofName) return row("Proof file", r.proofName + " (stored on this device only)");
    return row("Proof file", "No file attached");
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return String(ts); }
  }

  // ---------- Dashboard stats (real data only) ----------
  function renderStats() {
    var all = REG.all();
    var openScrims = TOURN.publicList().filter(function (t) { return t.registrationOpen && t.status === "open"; }).length;
    var upcoming = TOURN.publicList().filter(function (t) { return t.status === "upcoming"; }).length;
    var cells = [
      ["TOTAL REGISTRATIONS", all.length, "all time, this device"],
      ["SUBMITTED", all.filter(function (r) { return r.regStatus === "submitted"; }).length, "awaiting review"],
      ["APPROVED", all.filter(function (r) { return r.regStatus === "approved"; }).length, "slots confirmed"],
      ["PAYMENT TO VERIFY", all.filter(function (r) { return r.payStatus === "submitted"; }).length, "references waiting"],
      ["OPEN SCRIMS", openScrims, "accepting registration"],
      ["UPCOMING", upcoming, "date via WhatsApp"]
    ];
    document.getElementById("stat-grid").innerHTML = cells.map(function (c) {
      return '<div class="stat-card"><b>' + c[0] + "</b><strong>" + c[1] + "</strong><small>" + c[2] + "</small></div>";
    }).join("");
  }

  // ---------- Registration cards ----------
  function admCard(r, showTourn) {
    var v = REG.verifyStored(r);
    var flag = (!v.scrimKnown || !v.amountOk)
      ? '<p class="trk-flag" role="alert">Amount mismatch: stored PKR ' + esc(r.totalFee) + " vs expected PKR " + v.expectedTotal + " — review before approving.</p>"
      : "";
    return (
      '<article class="adm-card" aria-label="Registration ' + esc(r.id) + '">' +
      '<span class="adm-id">' + esc(r.id) + " · " + esc(fmtDate(r.ts)) + "</span>" +
      "<h3>" + esc(r.teamName) + "</h3>" +
      '<div class="rq-status-row">' + regBadge(r.regStatus) + payBadge(r.payStatus) + "</div>" +
      '<dl class="adm-rows">' +
      (showTourn ? row("Scrim", r.scrimName) : "") +
      row("Contact", r.contact) +
      row("Players", r.playerCount + " × PKR " + v.feePerHead + " = PKR " + Number(r.totalFee).toLocaleString("en-PK")) +
      row("Paid via", r.payMethod === "easypaisa" ? "EasyPaisa" : "UBL Bank") +
      row("Reference", r.payRef) +
      "</dl>" + flag +
      '<div class="adm-actions">' +
      '<button class="btn btn-outline btn-sm" type="button" data-act="details" data-id="' + esc(r.id) + '">Details</button>' +
      actionButtons(r) +
      "</div></article>"
    );
  }

  function actionButtons(r) {
    var b = "";
    if (r.regStatus === "submitted" || r.regStatus === "pending") {
      if (r.regStatus === "submitted") b += '<button class="btn btn-outline btn-sm" type="button" data-act="reg-pending" data-id="' + esc(r.id) + '">Mark Pending</button>';
      b += '<button class="btn btn-ok btn-sm" type="button" data-act="reg-approve" data-id="' + esc(r.id) + '">Approve</button>';
      b += '<button class="btn btn-danger btn-sm" type="button" data-act="reg-reject" data-id="' + esc(r.id) + '">Reject</button>';
    }
    if (r.payStatus === "submitted") {
      b += '<button class="btn btn-ok btn-sm" type="button" data-act="pay-verify" data-id="' + esc(r.id) + '">Verify Payment</button>';
      b += '<button class="btn btn-danger btn-sm" type="button" data-act="pay-reject" data-id="' + esc(r.id) + '">Reject Payment</button>';
    }
    if (r.regStatus === "submitted" || r.regStatus === "pending") {
      b += '<button class="btn btn-outline btn-sm" type="button" data-act="reg-cancel" data-id="' + esc(r.id) + '">Cancel</button>';
    }
    return b;
  }

  // ---------- Actions (all through the data layer; destructive = two-click) ----------
  var DESTRUCTIVE = { "reg-reject": 1, "reg-cancel": 1, "pay-reject": 1 };
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn || adminView.hidden) return;
    var id = btn.getAttribute("data-id");
    var act = btn.getAttribute("data-act");
    if (act === "details") { openDetails(id); return; }
    if (!authed()) { showLogin(); return; }
    if (DESTRUCTIVE[act] && !btn.hasAttribute("data-armed")) {
      btn.setAttribute("data-armed", "1");
      btn.textContent = "Confirm?";
      btn.focus();
      return;
    }
    var map = {
      "reg-pending": ["reg", "pending"], "reg-approve": ["reg", "approved"],
      "reg-reject": ["reg", "rejected"], "reg-cancel": ["reg", "cancelled"],
      "pay-verify": ["pay", "verified"], "pay-reject": ["pay", "rejected"]
    };
    var m = map[act];
    if (!m) return;
    applyStatus(id, m[0], m[1], btn);
  });

  // Remote-first mutation: server enforces transitions + authorization.
  // Offline: the local data layer enforces the same maps (demo only).
  function applyStatus(id, kind, to, btn) {
    if (!remoteMode()) {
      applyLocalStatus(id, kind, to);
      return;
    }
    var steps = [to];
    var cur = REG.all().filter(function (x) { return x.id === id; })[0];
    if (cur && kind === "reg" && cur.regStatus === "submitted" && (to === "approved" || to === "rejected")) {
      steps = ["pending", to]; // flow rule: submitted passes through pending
    }
    var chain = Promise.resolve({ ok: true });
    steps.forEach(function (step) {
      chain = chain.then(function (prev) {
        if (!prev.ok) return prev;
        return (kind === "reg" ? window.AF_SVC.setReg(id, step) : window.AF_SVC.setPay(id, step));
      });
    });
    chain.then(function (res) {
      if (!res.ok && res.code === 401) { showLogin(); return; }
      if (!res.ok && window.console) console.warn("[admin] transition refused:", res.error);
      syncAndRender();
      var dlg = document.getElementById("adm-dialog");
      if (dlg && dlg.open) openDetails(id);
    });
  }
  function applyLocalStatus(id, kind, to) {
    // Submitted records must pass through pending first (flow rule) —
    // chain it transparently so one admin click still works; both steps
    // are recorded in history.
    var cur = REG.all().filter(function (x) { return x.id === id; })[0];
    var res;
    if (cur && cur.regStatus === "submitted" && (to === "approved" || to === "rejected")) {
      res = REG.setStatus(id, kind, "pending", actor());
      if (res.ok) res = REG.setStatus(id, kind, to, actor());
    } else {
      res = REG.setStatus(id, kind, to, actor());
    }
    if (!res.ok && window.console) console.warn("[admin] transition refused:", res.error);
    renderAll();
    var dlg = document.getElementById("adm-dialog");
    if (dlg && dlg.open) openDetails(id); // keep an open details view consistent
  }

  // ---------- Details dialog ----------
  var dialog = document.getElementById("adm-dialog");
  function openDetails(id) {
    var r = REG.all().filter(function (x) { return x.id === id; })[0];
    if (!r || !dialog) return;
    var v = REG.verifyStored(r);
    var players = (r.players || []).map(function (p, i) {
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(p.name) + "</td><td>" + esc(p.gameId) + "</td></tr>";
    }).join("");
    var hist = (r.history || []).slice().reverse().map(function (h) {
      return "<li>" + esc(h.event) + (h.by ? " · " + esc(h.by) : "") + " · " + esc(fmtDate(h.ts)) + "</li>";
    }).join("");
    dialog.innerHTML =
      '<div class="t-dialog-head" style="display:flex;justify-content:space-between;gap:12px;background:var(--color-surface-dark);color:#fff;padding:20px 22px;align-items:flex-start">' +
      "<div><span class='adm-id' style='color:#9a9a9a'>" + esc(r.id) + "</span><h3 id='adm-dialog-title' style='color:#fff;margin:4px 0 0'>" + esc(r.teamName) + "</h3></div>" +
      '<button class="t-dialog-close" type="button" data-close aria-label="Close details" autofocus style="flex:0 0 44px;width:44px;height:44px;border-radius:10px;border:1px solid #3a3a3a;background:transparent;color:#fff;font-size:1.2rem;cursor:pointer">✕</button></div>' +
      '<div class="adm-dialog-body">' +
      '<div><h4>STATUS</h4><div class="rq-status-row" style="margin:0">' + regBadge(r.regStatus) + payBadge(r.payStatus) + "</div></div>" +
      "<div><h4>TEAM &amp; CONTACT</h4><dl class='adm-rows' style='margin:0'>" +
      row("Scrim", r.scrimName) + row("Captain", r.captain) + row("Contact", r.contact) +
      (r.notes ? row("Notes", r.notes) : "") + "</dl></div>" +
      "<div><h4>PLAYERS (" + r.playerCount + ")</h4><table class='player-table'><thead><tr><th>#</th><th>In-game name</th><th>Player ID</th></tr></thead><tbody>" + players + "</tbody></table></div>" +
      "<div><h4>PAYMENT</h4><dl class='adm-rows' style='margin:0'>" +
      row("Amount", "PKR " + Number(r.totalFee).toLocaleString("en-PK") + " (" + r.playerCount + " × PKR " + v.feePerHead + ")") +
      row("Method", r.payMethod === "easypaisa" ? "EasyPaisa" : "UBL Bank") +
      row("Reference", r.payRef) +
      proofRow(r) +
      "</dl></div>" +
      "<div><h4>AUDIT HISTORY</h4><ul class='trk-timeline' style='margin:0'>" + hist + "</ul></div>" +
      '<div class="adm-actions" style="margin-top:0">' + actionButtons(r) + "</div>" +
      "</div>";
    dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.close(); });
    if (typeof dialog.showModal === "function") dialog.showModal();
  }
  if (dialog) dialog.addEventListener("close", function () { syncAndRender(); });

  // ---------- Boot: wait for backend detection, verify any server session,
  // then decide. The dashboard never renders without a valid session. ----------
  var booted = false;
  function bootAdmin() {
    if (booted) return;
    booted = true;
    AUTH.boot().then(function () {
      if (authed()) showAdmin();
      else showLogin();
      stampMode();
    });
  }
  window.addEventListener("af-api-ready", bootAdmin);
  setTimeout(bootAdmin, 3500); // offline fallback: API detection may never fire
  stampMode();

  // ---------- Filtered lists ----------
  function filteredRegs() {
    var q = (document.getElementById("f-q").value || "").toLowerCase().trim();
    var ft = document.getElementById("f-tourn").value;
    var fr = document.getElementById("f-reg").value;
    var fp = document.getElementById("f-pay").value;
    return REG.all().filter(function (r) {
      if (ft !== "all" && r.scrimId !== ft) return false;
      if (fr !== "all" && r.regStatus !== fr) return false;
      if (fp !== "all" && r.payStatus !== fp) return false;
      if (q && (r.teamName + " " + r.id + " " + r.contact + " " + r.captain).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
  }

  function renderAll() {
    if (!authed()) { showLogin(); return; }
    renderStats();
    var all = REG.all().slice().sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
    var recent = document.getElementById("recent-list");
    recent.innerHTML = all.slice(0, 4).map(function (r) { return admCard(r, true); }).join("");
    document.getElementById("recent-empty").hidden = all.length !== 0;

    var sel = document.getElementById("f-tourn");
    var cur = sel.value;
    sel.innerHTML = '<option value="all">All tournaments</option>' + TOURN.publicList().map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>";
    }).join("");
    sel.value = cur || "all";

    var list = filteredRegs();
    document.getElementById("regs-list").innerHTML = list.map(function (r) { return admCard(r, true); }).join("");
    document.getElementById("regs-empty").hidden = list.length !== 0;
    var rc = document.getElementById("regs-count");
    rc.textContent = list.length === 1 ? "1 registration" : list.length + " registrations";

    var queue = all.filter(function (r) { return r.payStatus === "submitted"; });
    document.getElementById("pays-list").innerHTML = queue.map(function (r) { return admCard(r, true); }).join("");
    document.getElementById("pays-empty").hidden = queue.length !== 0;
    document.getElementById("pays-count").textContent = queue.length ? queue.length + " awaiting verification" : "";

    renderTourns();
  }
  ["f-q", "f-tourn", "f-reg", "f-pay"].forEach(function (id) {
    document.getElementById(id).addEventListener(id === "f-q" ? "input" : "change", function () {
      if (authed()) renderAll();
    });
  });

  // ---------- Tournaments ----------
  var tform = document.getElementById("tourn-form");
  var editingId = null;

  function renderTourns() {
    var box = document.getElementById("tourns-list");
    box.innerHTML = TOURN.publicList().map(function (t) {
      var regs = REG.all().filter(function (r) { return r.scrimId === t.id && r.regStatus !== "cancelled"; }).length;
      return (
        '<article class="adm-card"><span class="adm-id">' + esc(t.id) + "</span><h3>" + esc(t.name) + "</h3>" +
        '<div class="rq-status-row"><span class="status status-' + esc(t.status) + '" style="display:inline-flex;align-items:center;gap:7px;font-family:var(--font-mono);font-size:.72rem;font-weight:700;letter-spacing:.12em;border-radius:999px;padding:5px 12px;border:1px solid var(--color-line)">' + esc(t.status.toUpperCase()) + "</span>" +
        "<span class='adm-id'>" + (t.registrationOpen ? "REG OPEN" : "REG CLOSED") + " · PKR " + esc(t.entryFeePerHead) + "/head · " + esc(t.times.join(" · ")) + "</span></div>" +
        '<dl class="adm-rows">' + row("Format", t.format) + row("Matches", t.matchCount + " (" + t.matchNote + ")") +
        row("Prize", t.prize == null ? "Coming soon" : t.prize) + row("Registrations", regs + " active") + "</dl>" +
        '<div class="adm-actions"><button class="btn btn-outline btn-sm" type="button" data-tedit="' + esc(t.id) + '">Edit</button></div></article>'
      );
    }).join("");
  }

  document.getElementById("tourns-list").addEventListener("click", function (e) {
    var b = e.target.closest("[data-tedit]");
    if (!b) return;
    openTournForm(b.getAttribute("data-tedit"));
  });
  document.getElementById("tourn-new").addEventListener("click", function () { openTournForm(null); });
  document.getElementById("tourn-cancel").addEventListener("click", function () { tform.hidden = true; });

  function setTferr(key, m) {
    var el = tform.querySelector('[data-tf="' + key + '"]');
    if (el) { el.textContent = m || ""; el.classList.toggle("show", !!m); }
  }

  function openTournForm(id) {
    editingId = id;
    ["id", "name", "format", "teams", "entryFeePerHead", "matchCount", "times", "status"].forEach(function (k) { setTferr(k, ""); });
    document.getElementById("tourn-form-err").textContent = "";
    document.getElementById("tourn-form-title").textContent = id ? "Edit tournament" : "New tournament";
    var t = id ? TOURN.get(id) : null;
    document.getElementById("t-id").value = t ? t.id : "";
    document.getElementById("t-id").disabled = !!t;
    document.getElementById("t-name").value = t ? t.name : "";
    document.getElementById("t-tagline").value = t ? (t.tagline || "") : "";
    document.getElementById("t-format").value = t ? t.format : "All Formats";
    document.getElementById("t-teams").value = t ? t.teams : "Not Fixed";
    document.getElementById("t-fee").value = t ? t.entryFeePerHead : 100;
    document.getElementById("t-count").value = t ? t.matchCount : 2;
    document.getElementById("t-times").value = t ? t.times.join(", ") : "";
    document.getElementById("t-prize").value = t && t.prize != null ? t.prize : "";
    document.getElementById("t-status").value = t ? t.status : "upcoming";
    document.getElementById("t-open").checked = t ? !!t.registrationOpen : false;
    document.getElementById("t-announce").value = "";
    tform.hidden = false;
    tform.scrollIntoView({ block: "start", behavior: "smooth" });
    document.getElementById(id ? "t-name" : "t-id").focus();
  }

  tform.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!authed()) { showLogin(); return; }
    var payload = {
      id: editingId || document.getElementById("t-id").value.trim().toLowerCase(),
      name: document.getElementById("t-name").value,
      tagline: document.getElementById("t-tagline").value,
      format: document.getElementById("t-format").value,
      teams: document.getElementById("t-teams").value,
      entryFeePerHead: document.getElementById("t-fee").value,
      matchCount: document.getElementById("t-count").value,
      times: document.getElementById("t-times").value,
      prize: document.getElementById("t-prize").value,
      status: document.getElementById("t-status").value,
      registrationOpen: document.getElementById("t-open").checked
    };
    if (remoteMode()) {
      saveTournamentRemote(payload);
      return;
    }
    var res = TOURN.saveTournament(payload, actor());
    ["id", "name", "format", "teams", "entryFeePerHead", "matchCount", "times", "status"].forEach(function (k) {
      setTferr(k, res.ok ? "" : (res.errors[k] || ""));
    });
    if (!res.ok) {
      var ferr = document.getElementById("tourn-form-err");
      ferr.textContent = "Please fix the highlighted fields.";
      return;
    }
    tform.hidden = true;
    renderAll();
  });

  function saveTournamentRemote(payload) {
    var done = function (res) {
      ["id", "name", "format", "teams", "entryFeePerHead", "matchCount", "times", "status"].forEach(function (k) {
        setTferr(k, res.ok ? "" : ((res.errors && res.errors[k]) || ""));
      });
      var ferr = document.getElementById("tourn-form-err");
      if (!res.ok && res.code === 401) { showLogin(); return; }
      if (!res.ok) {
        ferr.textContent = res.error || "Please fix the highlighted fields.";
        return;
      }
      ferr.textContent = "";
      tform.hidden = true;
      // Refresh the server snapshot so public + admin read the same source.
      window.AF_SVC.tournaments().then(function (t) {
        if (t.ok && window.AF_TOURN.setRemote) window.AF_TOURN.setRemote(t.data);
        syncAndRender();
      });
    };
    if (editingId) {
      var patch = {};
      Object.keys(payload).forEach(function (k) { if (k !== "id") patch[k] = payload[k]; });
      window.AF_SVC.updateTournament(editingId, patch).then(done);
    } else {
      window.AF_SVC.createTournament(payload).then(done);
    }
  }

  // (Boot lives near the dialog-close hook above: waits for backend
  // detection, verifies any server session, then shows login or dashboard.)
})();
