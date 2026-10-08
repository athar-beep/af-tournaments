/* AF TOURNAMENTS — Part 7: admin match management.
   Remote-first: every mutation goes through the Part 7 API (admin session +
   XHR header required server-side; transition maps + result validation +
   audit enforced there). Offline: the local demo store applies the same
   shapes so the UI stays testable with zero fake data seeded. Room info is
   rendered in the admin surface only — never copied to public markup. */

(function () {
  "use strict";

  if (!window.AF_MATCHES || !window.AF_TOURN || !window.AF_AUTH) return;
  var panel = document.getElementById("panel-matches");
  if (!panel) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function remote() { return !!(window.AF_API && window.AF_API.mode === "remote" && window.AF_SVC); }
  function authed() { return window.AF_AUTH.isAdmin(); }
  function actor() { return window.AF_AUTH.actor() || "admin"; }

  var cache = []; // last admin match list (full rows incl. room/history)
  var editingId = null;

  var tournFilter = document.getElementById("m-tourn");
  var statusFilter = document.getElementById("m-status");
  var listEl = document.getElementById("matches-list");
  var emptyEl = document.getElementById("matches-empty");
  var countEl = document.getElementById("matches-count");
  var form = document.getElementById("match-form");
  var dialog = document.getElementById("match-dialog");

  var STATUS_META = {
    scheduled: { label: "SCHEDULED", glyph: "○" },
    live: { label: "LIVE", glyph: "●" },
    completed: { label: "COMPLETED", glyph: "✔" },
    cancelled: { label: "CANCELLED", glyph: "✕" }
  };

  function tournName(id) {
    var t = window.AF_TOURN.publicList().filter(function (x) { return x.id === id; })[0];
    return t ? t.name : id;
  }

  function sync() {
    fillTourns();
    if (!authed()) return;
    if (!remote()) {
      cache = window.AF_MATCHES.all();
      render();
      return;
    }
    window.AF_SVC.adminMatches({}).then(function (out) {
      if (out.ok && Array.isArray(out.data)) {
        cache = out.data;
        try { window.AF_MATCHES.setRemote(out.data.map(window.AF_MATCHES.toPublic)); } catch (e) {}
        render();
      } else {
        render();
      }
    });
  }

  function fillTourns() {
    var list = window.AF_TOURN.publicList();
    var keepF = tournFilter.value || "all";
    tournFilter.innerHTML = '<option value="all">All tournaments</option>' + list.map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>";
    }).join("");
    if (list.some(function (t) { return t.id === keepF; }) || keepF === "all") tournFilter.value = keepF;
    var mm = document.getElementById("mm-tourn");
    if (mm && !mm.options.length) {
      mm.innerHTML = list.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>";
      }).join("");
    } else if (mm) {
      var cur = mm.value;
      mm.innerHTML = list.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>";
      }).join("");
      if (cur) mm.value = cur;
    }
    var st = document.getElementById("score-tourn");
    if (st) {
      var keepS = st.value || (list[0] && list[0].id) || "";
      st.innerHTML = list.map(function (t) {
        var ppk = (t.scoringPointsPerKill !== undefined && t.scoringPointsPerKill !== null) ? t.scoringPointsPerKill : 1;
        return '<option value="' + esc(t.id) + '">' + esc(t.name) + " (+" + esc(ppk) + "/kill)</option>";
      }).join("");
      if (keepS) st.value = keepS;
      var sel = list.filter(function (t) { return t.id === st.value; })[0];
      var inp = document.getElementById("score-ppk");
      if (sel && inp && document.activeElement !== inp) inp.value = sel.scoringPointsPerKill != null ? sel.scoringPointsPerKill : 1;
    }
  }

  function filtered() {
    var ft = tournFilter.value || "all";
    var fs = statusFilter.value || "all";
    return cache.filter(function (m) {
      if (ft !== "all" && m.tournamentId !== ft) return false;
      if (fs !== "all" && m.status !== fs) return false;
      return true;
    }).sort(function (a, b) {
      return String(a.tournamentId).localeCompare(String(b.tournamentId)) || Number(a.matchNumber) - Number(b.matchNumber);
    });
  }

  function statusBadge(s) {
    var m = STATUS_META[s] || STATUS_META.scheduled;
    return '<span class="m-badge m-' + esc(s) + '"><span class="glyph" aria-hidden="true">' + m.glyph + "</span> " + m.label + "</span>";
  }
  function row(k, v) { return '<div class="s-row"><dt>' + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>"; }

  function nextActions(m) {
    var flow = window.AF_MATCHES.FLOW[m.status] || [];
    return flow.map(function (to) {
      var label = to === "live" ? "Go Live" : to === "completed" ? "Mark Completed" : "Cancel Match";
      var cls = to === "cancelled" ? "btn-danger" : "btn-ok";
      return '<button class="btn ' + cls + ' btn-sm" type="button" data-mact="status:' + to + '" data-id="' + esc(m.id) + '">' + label + "</button>";
    }).join("");
  }

  function card(m) {
    var res = Array.isArray(m.results) ? m.results : [];
    var vis = m.resultsPublished ? "Published" : "Unpublished";
    return (
      '<article class="adm-card" aria-label="Match ' + esc(m.id) + '">' +
      '<span class="adm-id">' + esc(m.id) + " · " + esc(tournName(m.tournamentId)) + "</span>" +
      "<h3>Match #" + esc(m.matchNumber) + " · " + esc(m.scheduledTime) + "</h3>" +
      '<div class="rq-status-row">' + statusBadge(m.status) +
      '<span class="m-badge m-vis">' + esc(res.length) + " RESULTS · " + esc(vis) + "</span></div>" +
      '<dl class="adm-rows">' +
      row("Tournament", m.tournamentId) +
      (m.notes ? row("Notes", m.notes) : "") +
      (m.roomInfo ? row("Room (admin-only)", m.roomInfo) : row("Room", "—")) +
      row("Results", res.length ? res.length + " rows (" + vis.toLowerCase() + ")" : "No results yet") +
      "</dl>" +
      '<div class="adm-actions">' +
      '<button class="btn btn-outline btn-sm" type="button" data-mact="details" data-id="' + esc(m.id) + '">Details</button>' +
      '<button class="btn btn-outline btn-sm" type="button" data-mact="edit" data-id="' + esc(m.id) + '">Edit</button>' +
      nextActions(m) +
      '<button class="btn btn-outline btn-sm" type="button" data-mact="results" data-id="' + esc(m.id) + '">Results</button>' +
      (res.length || m.resultsPublished
        ? '<button class="btn btn-outline btn-sm" type="button" data-mact="publish" data-id="' + esc(m.id) + '">' + (m.resultsPublished ? "Unpublish" : "Publish") + "</button>"
        : "") +
      (res.length
        ? '<button class="btn btn-danger btn-sm" type="button" data-mact="clear" data-id="' + esc(m.id) + '">Clear Results</button>'
        : "") +
      "</div></article>"
    );
  }

  function render() {
    fillTourns();
    var list = filtered();
    listEl.innerHTML = list.map(card).join("");
    emptyEl.hidden = list.length !== 0;
    if (cache.length && !list.length) {
      emptyEl.querySelector("h3").textContent = "Nothing matches these filters";
      emptyEl.querySelector("p").textContent = "Adjust the tournament or status filter.";
    } else {
      emptyEl.querySelector("h3").textContent = remote() ? "No matches yet" : "No matches yet (offline demo)";
      emptyEl.querySelector("p").textContent = "Create the first match for a tournament. Nothing is shown publicly until results are published.";
    }
    countEl.textContent = !cache.length
      ? (remote() ? "No matches in the system yet." : "Offline demo — matches stay on this device only.")
      : (list.length === 1 ? "1 match" : list.length + " matches") + (remote() ? " · live server" : " · offline demo");
  }

  // ---------- match form ----------
  function setFerr(k, m) {
    var el = form.querySelector('[data-mf="' + k + '"]');
    if (el) { el.textContent = m || ""; el.classList.toggle("show", !!m); }
  }
  function openForm(id) {
    editingId = id || null;
    ["tournamentId", "matchNumber", "scheduledTime", "roomInfo", "notes"].forEach(function (k) { setFerr(k, ""); });
    document.getElementById("match-form-err").textContent = "";
    document.getElementById("match-form-title").textContent = id ? "Edit match" : "New match";
    var m = id ? cache.filter(function (x) { return String(x.id) === String(id); })[0] : null;
    fillTourns();
    document.getElementById("mm-tourn").value = m ? m.tournamentId : (tournFilter.value !== "all" ? tournFilter.value : (window.AF_TOURN.publicList()[0] || {}).id || "");
    document.getElementById("mm-tourn").disabled = false;
    document.getElementById("mm-num").value = m ? m.matchNumber : nextNumber(document.getElementById("mm-tourn").value);
    document.getElementById("mm-time").value = m ? m.scheduledTime : "";
    document.getElementById("mm-room").value = m ? (m.roomInfo || "") : "";
    document.getElementById("mm-notes").value = m ? (m.notes || "") : "";
    refreshTeamsView();
    form.hidden = false;
    form.scrollIntoView({ block: "start", behavior: "smooth" });
    document.getElementById("mm-num").focus();
  }
  function nextNumber(tid) {
    var nums = cache.filter(function (m) { return m.tournamentId === tid; }).map(function (m) { return Number(m.matchNumber); });
    var n = nums.length ? Math.max.apply(null, nums) + 1 : 1;
    return n > 20 ? 1 : n;
  }
  function refreshTeamsView() {
    var tid = document.getElementById("mm-tourn").value;
    var box = document.getElementById("mm-teams-view");
    if (!tid) { box.textContent = "Select a tournament to see registered teams."; return; }
    if (!remote()) {
      var regs = [];
      try {
        if (window.AF_REG) regs = window.AF_REG.all().filter(function (r) { return r.scrimId === tid && r.regStatus !== "cancelled"; });
      } catch (e) {}
      box.textContent = regs.length ? regs.map(function (r) { return r.teamName + " (" + r.playerCount + "p, " + r.regStatus + ")"; }).join(" · ") : "No active registrations for this tournament on this device.";
      return;
    }
    box.textContent = "Loading registered teams…";
    window.AF_SVC.tournamentTeams(tid).then(function (out) {
      if (!out.ok) { box.textContent = "Could not load registered teams."; return; }
      var teams = (out.data && out.data.teams) || [];
      box.textContent = teams.length ? teams.map(function (t) { return t.teamName + " (" + t.playerCount + "p, " + t.regStatus + ")"; }).join(" · ") : "No active registrations for this tournament yet.";
    });
  }

  document.getElementById("match-new").addEventListener("click", function () { openForm(null); });
  document.getElementById("match-cancel").addEventListener("click", function () { form.hidden = true; });
  document.getElementById("mm-tourn").addEventListener("change", function () {
    document.getElementById("mm-num").value = nextNumber(document.getElementById("mm-tourn").value);
    refreshTeamsView();
  });
  tournFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!authed()) return;
    var payload = {
      tournamentId: document.getElementById("mm-tourn").value,
      matchNumber: document.getElementById("mm-num").value,
      scheduledTime: document.getElementById("mm-time").value.trim(),
      roomInfo: document.getElementById("mm-room").value,
      notes: document.getElementById("mm-notes").value
    };
    if (!remote()) {
      var res = window.AF_MATCHES.saveLocal(payload, actor(), editingId);
      ["tournamentId", "matchNumber", "scheduledTime", "roomInfo", "notes"].forEach(function (k) {
        setFerr(k, res.ok ? "" : (res.errors[k] || ""));
      });
      if (!res.ok) { document.getElementById("match-form-err").textContent = "Please fix the highlighted fields (offline demo validation)."; return; }
      form.hidden = true;
      cache = window.AF_MATCHES.all();
      render();
      return;
    }
    var done = function (out) {
      ["tournamentId", "matchNumber", "scheduledTime", "roomInfo", "notes"].forEach(function (k) {
        setFerr(k, out.ok ? "" : ((out.errors && out.errors[k]) || ""));
      });
      if (!out.ok && out.code === 401) return;
      if (!out.ok) {
        document.getElementById("match-form-err").textContent = out.error || "Please fix the highlighted fields.";
        return;
      }
      form.hidden = true;
      sync();
    };
    if (editingId) window.AF_SVC.updateMatch(editingId, payload).then(done);
    else window.AF_SVC.createMatch(payload).then(done);
  });

  // ---------- scoring ----------
  document.getElementById("scoring-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!authed()) return;
    var tid = document.getElementById("score-tourn").value;
    var ppk = Number(document.getElementById("score-ppk").value);
    var err = document.getElementById("scoring-err");
    var msg = document.getElementById("scoring-msg");
    err.textContent = "";
    msg.textContent = "";
    if (!Number.isInteger(ppk) || ppk < 0 || ppk > 10) { err.textContent = "Points per kill: whole number 0–10."; return; }
    if (!remote()) { err.textContent = "Scoring is stored on the server — connect the backend to save it."; return; }
    window.AF_SVC.updateTournament(tid, { scoringPointsPerKill: ppk }).then(function (out) {
      if (!out.ok) { err.textContent = out.error || "Could not save scoring."; return; }
      msg.textContent = "Scoring saved: +" + ppk + " per kill for " + tournName(tid) + ". New results use it; past snapshots stay untouched.";
      if (window.AF_TOURN && window.AF_SVC) {
        window.AF_SVC.tournaments().then(function (t) {
          if (t.ok && window.AF_TOURN.setRemote) window.AF_TOURN.setRemote(t.data);
          fillTourns();
        });
      }
    });
  });

  // ---------- card actions ----------
  var DESTRUCTIVE = { clear: 1 };
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-mact]");
    if (!btn || panel.hidden) return;
    var id = btn.getAttribute("data-id");
    var act = btn.getAttribute("data-mact");
    if (act === "details") { openDetails(id); return; }
    if (act === "edit") { openForm(id); return; }
    if (act === "results") { openResults(id); return; }
    if (!authed()) return;
    if (DESTRUCTIVE[act] && !btn.hasAttribute("data-armed")) {
      btn.setAttribute("data-armed", "1");
      btn.textContent = "Confirm clear?";
      btn.focus();
      return;
    }
    if (act.indexOf("status:") === 0) {
      var to = act.slice("status:".length);
      if (!remote()) {
        // Offline demo: enforce the flow map locally.
        var all = window.AF_MATCHES.all();
        var m = all.filter(function (x) { return String(x.id) === String(id); })[0];
        if (m) {
          if ((window.AF_MATCHES.FLOW[m.status] || []).indexOf(to) === -1) return;
          m.status = to;
          m.updatedAt = new Date().toISOString();
          m.history = m.history || [];
          m.history.push({ ts: m.updatedAt, event: to + " (demo)", by: actor() });
          try { localStorage.setItem("af_matches_v1", JSON.stringify(all)); } catch (ex) {}
          cache = all;
          render();
          if (dialog.open) openDetails(id);
        }
        return;
      }
      window.AF_SVC.setMatchStatus(id, to).then(function () { sync(); if (dialog.open) openDetails(id); });
      return;
    }
    if (act === "publish") {
      var cur = cache.filter(function (x) { return String(x.id) === String(id); })[0];
      var want = cur ? !cur.resultsPublished : true;
      if (!remote()) {
        var list = window.AF_MATCHES.all();
        var lm = list.filter(function (x) { return String(x.id) === String(id); })[0];
        if (lm) {
          if (want && (lm.status !== "completed" || !(lm.results || []).length)) return;
          lm.resultsPublished = want;
          try { localStorage.setItem("af_matches_v1", JSON.stringify(list)); } catch (ex) {}
          cache = list;
          render();
          if (dialog.open) openDetails(id);
        }
        return;
      }
      window.AF_SVC.publishResults(id, want).then(function () { sync(); if (dialog.open) openDetails(id); });
      return;
    }
    if (act === "clear") {
      if (!remote()) {
        var l2 = window.AF_MATCHES.all();
        var cm = l2.filter(function (x) { return String(x.id) === String(id); })[0];
        if (cm) {
          cm.results = [];
          cm.resultsPublished = false;
          try { localStorage.setItem("af_matches_v1", JSON.stringify(l2)); } catch (ex) {}
          cache = l2;
          render();
          if (dialog.open) openDetails(id);
        }
        return;
      }
      window.AF_SVC.clearResults(id).then(function () { sync(); if (dialog.open) openDetails(id); });
    }
  });

  // ---------- details dialog ----------
  function openDetails(id) {
    var m = cache.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!m || !dialog) return;
    var res = Array.isArray(m.results) ? m.results : [];
    var rows = res.map(function (r, i) {
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(r.teamName) + "</td><td>" + esc(r.placement) + "</td><td>" + esc(r.kills) + "</td><td>" + esc(r.points) + "</td><td><strong>" + esc(r.totalPoints) + "</strong></td></tr>";
    }).join("");
    var hist = (m.history || []).slice().reverse().map(function (h) {
      return "<li>" + esc(h.event) + (h.by ? " · " + esc(h.by) : "") + "</li>";
    }).join("");
    dialog.innerHTML =
      '<div class="t-dialog-head" style="display:flex;justify-content:space-between;gap:12px;background:var(--color-surface-dark);color:#fff;padding:20px 22px;align-items:flex-start">' +
      "<div><span class='adm-id' style='color:#9a9a9a'>" + esc(m.id) + " · " + esc(tournName(m.tournamentId)) + "</span><h3 id='match-dialog-title' style='color:#fff;margin:4px 0 0'>Match #" + esc(m.matchNumber) + " · " + esc(m.scheduledTime) + "</h3></div>" +
      '<button class="t-dialog-close" type="button" data-close aria-label="Close details" autofocus style="flex:0 0 44px;width:44px;height:44px;border-radius:10px;border:1px solid #3a3a3a;background:transparent;color:#fff;font-size:1.2rem;cursor:pointer">✕</button></div>' +
      '<div class="adm-dialog-body">' +
      '<div><h4>STATUS</h4><div class="rq-status-row" style="margin:0">' + statusBadge(m.status) + "</div></div>" +
      "<div><h4>MATCH</h4><dl class='adm-rows' style='margin:0'>" +
      row("Tournament", m.tournamentId) + row("Scheduled", m.scheduledTime) +
      (m.notes ? row("Notes (public)", m.notes) : "") +
      row("Room (admin-only)", m.roomInfo || "—") +
      row("Results", res.length ? res.length + " rows · " + (m.resultsPublished ? "published" : "unpublished") : "No results yet") +
      "</dl></div>" +
      (res.length ? "<div><h4>RESULTS (SERVER TOTALS)</h4><div class='table-wrap'><table class='player-table'><thead><tr><th>#</th><th>Team</th><th>Plc</th><th>Kills</th><th>Pts</th><th>Total</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>" : "") +
      "<div><h4>AUDIT HISTORY</h4>" + (hist ? "<ul class='trk-timeline' style='margin:0'>" + hist + "</ul>" : "<p class='muted' style='font-size:.88rem'>No history yet.</p>") + "</div>" +
      '<div class="adm-actions" style="margin-top:0"><button class="btn btn-outline btn-sm" type="button" data-mact="results" data-id="' + esc(m.id) + '">Edit Results</button></div>' +
      "</div>";
    dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.close(); });
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  // ---------- results editor ----------
  function openResults(id) {
    var m = cache.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!m || !dialog) return;
    if (m.status !== "completed") {
      dialog.innerHTML =
        '<div class="t-dialog-head" style="display:flex;justify-content:space-between;gap:12px;background:var(--color-surface-dark);color:#fff;padding:20px 22px;align-items:flex-start">' +
        "<div><h3 id='match-dialog-title' style='color:#fff;margin:0'>Results locked</h3></div>" +
        '<button class="t-dialog-close" type="button" data-close aria-label="Close" autofocus style="flex:0 0 44px;width:44px;height:44px;border-radius:10px;border:1px solid #3a3a3a;background:transparent;color:#fff;font-size:1.2rem;cursor:pointer">✕</button></div>' +
        '<div class="adm-dialog-body"><p>Results can only be recorded for <strong>Completed</strong> matches. Current status: <strong>' + esc(m.status) + '</strong>. Move the match to Completed first.</p></div>';
      dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.close(); });
      if (typeof dialog.showModal === "function") dialog.showModal();
      return;
    }
    var existing = Array.isArray(m.results) ? m.results : [];
    var rowsHtml = existing.map(function (r, i) {
      return resultRow(i, r.teamName, r.placement, r.kills, r.points);
    }).join("") || resultRow(0, "", 1, "", "");
    dialog.innerHTML =
      '<div class="t-dialog-head" style="display:flex;justify-content:space-between;gap:12px;background:var(--color-surface-dark);color:#fff;padding:20px 22px;align-items:flex-start">' +
      "<div><span class='adm-id' style='color:#9a9a9a'>" + esc(m.id) + "</span><h3 id='match-dialog-title' style='color:#fff;margin:4px 0 0'>Results · Match #" + esc(m.matchNumber) + "</h3></div>" +
      '<button class="t-dialog-close" type="button" data-close aria-label="Close results" style="flex:0 0 44px;width:44px;height:44px;border-radius:10px;border:1px solid #3a3a3a;background:transparent;color:#fff;font-size:1.2rem;cursor:pointer">✕</button></div>' +
      '<div class="adm-dialog-body">' +
      "<p class='muted' style='font-size:.88rem;margin:0'>Placements must be exactly 1–N with no gaps or duplicates. Totals are recomputed on the server. Saving unpublishes until you publish.</p>" +
      '<div id="res-rows" style="display:grid;gap:10px">' + rowsHtml + "</div>" +
      '<p class="f-error" id="res-err" role="alert"></p>' +
      '<div class="adm-actions" style="margin-top:0">' +
      '<button class="btn btn-outline btn-sm" type="button" id="res-add">+ Add Row</button>' +
      '<button class="btn btn-accent btn-sm" type="button" id="res-save">Save Results</button>' +
      "</div></div>";
    dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.close(); });
    dialog.querySelector("#res-add").addEventListener("click", function () {
      var box = dialog.querySelector("#res-rows");
      var n = box.children.length;
      box.insertAdjacentHTML("beforeend", resultRow(n, "", n + 1, "", ""));
      var last = box.lastElementChild.querySelector("input");
      if (last) last.focus();
    });
    dialog.querySelector("#res-save").addEventListener("click", function () {
      var rows = collectRows();
      var err = dialog.querySelector("#res-err");
      err.textContent = "";
      if (!remote()) {
        var v = window.AF_MATCHES.validateResults(rows);
        if (!v.valid) { err.textContent = firstErr(v.errors); return; }
        var all = window.AF_MATCHES.all();
        var lm = all.filter(function (x) { return String(x.id) === String(id); })[0];
        if (lm) {
          var ppk = window.AF_MATCHES.ppkOf(lm.tournamentId);
          lm.results = rows.map(function (r) {
            return { teamName: String(r.teamName).trim(), placement: Number(r.placement), kills: Number(r.kills) || 0, points: Number(r.points) || 0, totalPoints: (Number(r.kills) || 0) * ppk + (Number(r.points) || 0) };
          }).sort(function (a, b) { return a.placement - b.placement; });
          lm.resultsPublished = false;
          lm.pointsPerKillSnapshot = ppk;
          lm.updatedAt = new Date().toISOString();
          try { localStorage.setItem("af_matches_v1", JSON.stringify(all)); } catch (e) {}
          cache = all;
          render();
          dialog.close();
        }
        return;
      }
      window.AF_SVC.saveResults(id, rows).then(function (out) {
        if (!out.ok) { err.textContent = out.error || "Please fix the highlighted rows."; return; }
        dialog.close();
        sync();
      });
    });
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function resultRow(i, team, placement, kills, points) {
    return '<fieldset class="res-row" style="border:1px solid var(--color-line);border-radius:10px;padding:12px;display:grid;gap:8px;margin:0">' +
      '<legend style="font-family:var(--font-mono);font-size:.7rem;letter-spacing:.1em;color:var(--color-muted)">ROW ' + (i + 1) + "</legend>" +
      '<div style="display:grid;gap:8px;grid-template-columns:1fr 70px"><div><label for="res-team-' + i + '" style="font-size:.8rem;font-weight:700">Team</label>' +
      '<input id="res-team-' + i + '" data-f="teamName" value="' + esc(team) + '" maxlength="60" list="res-teams" style="width:100%;min-height:44px;border:1px solid var(--color-line);border-radius:8px;padding:8px 10px" /></div>' +
      '<div><label for="res-plc-' + i + '" style="font-size:.8rem;font-weight:700">Plc</label>' +
      '<input id="res-plc-' + i + '" data-f="placement" type="number" min="1" max="100" value="' + esc(placement) + '" style="width:100%;min-height:44px;border:1px solid var(--color-line);border-radius:8px;padding:8px 10px" /></div></div>' +
      '<div style="display:grid;gap:8px;grid-template-columns:1fr 1fr auto"><div><label for="res-k-' + i + '" style="font-size:.8rem;font-weight:700">Kills</label>' +
      '<input id="res-k-' + i + '" data-f="kills" type="number" min="0" max="300" value="' + esc(kills) + '" style="width:100%;min-height:44px;border:1px solid var(--color-line);border-radius:8px;padding:8px 10px" /></div>' +
      '<div><label for="res-p-' + i + '" style="font-size:.8rem;font-weight:700">Points</label>' +
      '<input id="res-p-' + i + '" data-f="points" type="number" min="0" max="5000" value="' + esc(points) + '" style="width:100%;min-height:44px;border:1px solid var(--color-line);border-radius:8px;padding:8px 10px" /></div>' +
      '<div style="display:flex;align-items:end"><button class="btn btn-outline btn-sm" type="button" data-rm="' + i + '" aria-label="Remove row ' + (i + 1) + '">✕</button></div></div>' +
      "<datalist id='res-teams'></datalist></fieldset>";
  }

  function collectRows() {
    var box = dialog.querySelector("#res-rows");
    if (!box) return [];
    return Array.prototype.map.call(box.children, function (rowEl) {
      return {
        teamName: rowEl.querySelector("[data-f='teamName']").value,
        placement: rowEl.querySelector("[data-f='placement']").value,
        kills: rowEl.querySelector("[data-f='kills']").value,
        points: rowEl.querySelector("[data-f='points']").value
      };
    });
  }
  function firstErr(errs) {
    var k = Object.keys(errs)[0];
    return k ? errs[k] : "Invalid results.";
  }

  if (dialog) dialog.addEventListener("close", function () { render(); });
  // Single delegated row-removal handler (registered once — never per-dialog-open).
  if (dialog) dialog.addEventListener("click", function (e) {
    var b = e.target.closest("[data-rm]");
    if (!b || !dialog.open) return;
    var box = dialog.querySelector("#res-rows");
    if (!box || box.children.length <= 1) return;
    var idx = Number(b.getAttribute("data-rm"));
    if (box.children[idx]) box.children[idx].remove();
    Array.prototype.forEach.call(box.children, function (rowEl, i) {
      var plc = rowEl.querySelector("[data-f='placement']");
      if (plc) plc.value = i + 1;
      var rb = rowEl.querySelector("[data-rm]");
      if (rb) rb.setAttribute("data-rm", String(i));
      var lg = rowEl.querySelector("legend");
      if (lg) lg.textContent = "ROW " + (i + 1);
    });
  });
  window.addEventListener("af-api-ready", sync);
  window.addEventListener("af-tournaments-synced", function () { fillTourns(); render(); });
  setTimeout(sync, 3600);
  sync();
})();
