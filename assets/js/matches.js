/* AF TOURNAMENTS — Part 7: public matches, results, leaderboard.
   Reads the canonical backend (/api/matches + /api/leaderboard) when reachable;
   falls back to the on-device cache with an honest offline label. Never
   invents standings: empty states stay until published results exist. Room
   credentials and audit history are never rendered here (server strips them). */

(function () {
  "use strict";

  var tournSel = document.getElementById("pub-tourn");
  var statusSel = document.getElementById("pub-status");
  var grid = document.getElementById("pub-matches");
  if (!tournSel || !grid || !window.AF_MATCHES) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function remote() { return !!(window.AF_API && window.AF_API.mode === "remote" && window.AF_SVC); }
  function tournList() {
    if (window.AF_TOURN && typeof window.AF_TOURN.publicList === "function") {
      try { return window.AF_TOURN.publicList(); } catch (e) {}
    }
    return [];
  }

  var META = {
    scheduled: { label: "SCHEDULED", glyph: "○" },
    live: { label: "LIVE", glyph: "●" },
    completed: { label: "COMPLETED", glyph: "✔" },
    cancelled: { label: "CANCELLED", glyph: "✕" }
  };
  function badge(s) {
    var m = META[s] || META.scheduled;
    return '<span class="m-badge m-' + esc(s) + '"><span class="glyph" aria-hidden="true">' + m.glyph + "</span> " + m.label + "</span>";
  }

  function fillTourns() {
    var list = tournList();
    var keep = tournSel.value || (list[0] && list[0].id) || "";
    tournSel.innerHTML = list.map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>";
    }).join("");
    if (list.some(function (t) { return t.id === keep; })) tournSel.value = keep;
  }

  function setLoading(on) {
    document.getElementById("pub-matches-loading").hidden = !on;
    document.getElementById("pub-lb-loading").hidden = !on;
  }
  function showError(where) {
    document.getElementById("pub-matches-error").hidden = where !== "matches";
    document.getElementById("pub-lb-error").hidden = where !== "board";
  }

  function matchCard(m) {
    var res = Array.isArray(m.results) ? m.results : [];
    var top = res.slice(0, 3).map(function (r) {
      return "<li><span>#" + esc(r.placement) + " " + esc(r.teamName) + "</span><b>" + esc(r.totalPoints) + " pts</b></li>";
    }).join("");
    var full = res.map(function (r) {
      return "<tr><td data-label=\"PLACE\">" + esc(r.placement) + "</td><td data-label=\"TEAM\">" + esc(r.teamName) + "</td>" +
        "<td data-label=\"KILLS\" class=\"num\">" + esc(r.kills) + "</td><td data-label=\"POINTS\" class=\"num\">" + esc(r.points) + "</td>" +
        "<td data-label=\"TOTAL\" class=\"num\"><strong>" + esc(r.totalPoints) + "</strong></td></tr>";
    }).join("");
    return (
      '<article class="m-card" data-status="' + esc(m.status) + '" aria-label="Match ' + esc(m.matchNumber) + ", " + esc(m.status) + '">' +
      '<div class="m-card-body">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">' + badge(m.status) +
      '<span class="m-meta">MATCH #' + esc(m.matchNumber) + " · " + esc(m.scheduledTime) + "</span></div>" +
      (m.notes ? '<p class="m-note">' + esc(m.notes) + "</p>" : "") +
      (res.length
        ? '<ul class="m-mini-results" aria-label="Top finishers">' + top + "</ul>" +
          '<details><summary style="min-height:44px;display:inline-flex;align-items:center;font-weight:700;cursor:pointer">Full results (' + res.length + ")</summary>" +
          '<div class="table-wrap" style="margin-top:8px"><table class="lb-table"><caption class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Match ' + esc(m.matchNumber) + ' results</caption>' +
          "<thead><tr><th scope=\"col\">PLACE</th><th scope=\"col\">TEAM</th><th scope=\"col\" class=\"num\">KILLS</th><th scope=\"col\" class=\"num\">POINTS</th><th scope=\"col\" class=\"num\">TOTAL</th></tr></thead><tbody>" + full + "</tbody></table></div></details>"
        : (m.status === "completed"
          ? '<p class="m-meta">Completed — results pending publication.</p>'
          : m.status === "cancelled"
            ? '<p class="m-meta">This match was cancelled.</p>'
            : '<p class="m-meta">Results appear here once the match is completed and published.</p>')) +
      "</div></article>"
    );
  }

  function renderMatches(list, tid) {
    var fs = statusSel.value || "all";
    var rows = list.filter(function (m) { return fs === "all" || m.status === fs; });
    grid.innerHTML = rows.map(matchCard).join("");
    var count = document.getElementById("pub-matches-count");
    var empty = document.getElementById("pub-matches-empty");
    empty.hidden = rows.length !== 0;
    document.getElementById("pub-matches-error").hidden = true;
    if (!rows.length && list.length) {
      empty.querySelector("h3").textContent = "Nothing matches this status filter";
      empty.querySelector("p").textContent = "Try a different status, or view the leaderboard below.";
      empty.querySelector("p + p").hidden = true;
    } else {
      empty.querySelector("h3").textContent = "No matches yet";
      var ep = empty.querySelectorAll("p");
      if (ep[0]) ep[0].textContent = "Matches for this tournament will appear here once organizers create them. Dates drop first in the WhatsApp group.";
      if (ep[1]) ep[1].hidden = false;
    }
    count.textContent = rows.length
      ? (rows.length === 1 ? "1 match" : rows.length + " matches") + (remote() ? " · live server" : " · offline demo")
      : (remote() ? "No matches for this filter." : "Offline demo — connect the server for live matches.");
  }

  function renderBoard(data, tid) {
    var wrap = document.getElementById("pub-lb-wrap");
    var empty = document.getElementById("pub-lb-empty");
    var count = document.getElementById("pub-lb-count");
    var note = document.getElementById("pub-lb-note");
    document.getElementById("pub-lb-error").hidden = true;
    var entries = (data && data.entries) || [];
    var ppk = data && data.scoring ? data.scoring.pointsPerKill : (data && data.pointsPerKill != null ? data.pointsPerKill : 1);
    var counted = data && (data.matchesCounted != null ? data.matchesCounted : data.matchesCounted);
    note.textContent = "Cumulative standings from published results. Total = kills × " + ppk + " + points. Configured per tournament — never a publisher rule set.";
    if (!entries.length) {
      wrap.innerHTML = "";
      empty.hidden = false;
      count.textContent = remote() ? "No published results yet." : "Offline demo — no published results on this device yet.";
      return;
    }
    empty.hidden = true;
    var rows = entries.map(function (r) {
      var top = r.rank <= 3 ? ' data-top="1"' : "";
      return "<tr" + top + "><td data-rank=\"" + esc(r.rank) + "\" data-label=\"RANK\">" + esc(r.rank) + "</td>" +
        "<td data-label=\"TEAM\"><strong>" + esc(r.teamName) + "</strong></td>" +
        "<td data-label=\"PLAYED\" class=\"num\">" + esc(r.played) + "</td>" +
        "<td data-label=\"KILLS\" class=\"num\">" + esc(r.totalKills) + "</td>" +
        "<td data-label=\"BEST\" class=\"num\">" + (r.bestPlacement == null ? "—" : "#" + esc(r.bestPlacement)) + "</td>" +
        "<td data-label=\"TOTAL\" class=\"num\"><strong>" + esc(r.totalPoints) + "</strong></td></tr>";
    }).join("");
    wrap.innerHTML =
      '<table class="lb-table"><caption>Standings · ' + esc(entries.length) + (entries.length === 1 ? " team" : " teams") + "</caption>" +
      "<thead><tr><th scope=\"col\">RANK</th><th scope=\"col\">TEAM</th><th scope=\"col\" class=\"num\">PLAYED</th><th scope=\"col\" class=\"num\">KILLS</th><th scope=\"col\" class=\"num\">BEST</th><th scope=\"col\" class=\"num\">TOTAL</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>" +
      '<p class="table-note">' + esc(counted != null ? counted : "?") + " completed match" + (Number(counted) === 1 ? "" : "es") + " counted" + (remote() ? " · live server" : " · offline demo") + ".</p>";
    count.textContent = entries.length + (entries.length === 1 ? " team" : " teams") + " on the board.";
  }

  function load() {
    var tid = tournSel.value;
    if (!tid) { fillTourns(); tid = tournSel.value; if (!tid) return; }
    setLoading(true);
    showError("");
    document.getElementById("pub-matches-empty").hidden = true;
    document.getElementById("pub-lb-empty").hidden = true;
    if (!remote()) {
      try {
        var ms = window.AF_MATCHES.publicList(tid).map(window.AF_MATCHES.toPublic);
        renderMatches(ms, tid);
        var lb = window.AF_MATCHES.leaderboard(tid);
        renderBoard(lb, tid);
      } catch (e) {
        showError("matches");
      }
      setLoading(false);
      return;
    }
    var done = 0;
    function fin() { if (++done === 2) setLoading(false); }
    window.AF_SVC.matches(tid).then(function (out) {
      if (out.ok) {
        try { window.AF_MATCHES.setRemote(out.data); } catch (e) {}
        renderMatches(out.data, tid);
      } else {
        showError("matches");
      }
      fin();
    });
    window.AF_SVC.leaderboard(tid).then(function (out) {
      if (out.ok) renderBoard(out.data, tid);
      else showError("board");
      fin();
    });
  }

  tournSel.addEventListener("change", load);
  statusSel.addEventListener("change", function () {
    // Status is a client filter over the last fetch — refetch cheaply to stay canonical.
    load();
  });
  document.getElementById("pub-matches-retry").addEventListener("click", load);
  document.getElementById("pub-lb-retry").addEventListener("click", load);

  // Tournament detail dialogs link here: honor ?tournament=<id> deep links.
  try {
    var q = new URLSearchParams(location.search).get("tournament");
    if (q) {
      fillTourns();
      if (Array.prototype.some.call(tournSel.options, function (o) { return o.value === q; })) tournSel.value = q;
    }
  } catch (e) {}

  fillTourns();
  window.addEventListener("af-api-ready", function () { fillTourns(); load(); });
  window.addEventListener("af-tournaments-synced", function () { fillTourns(); load(); });
  setTimeout(function () { if (!grid.innerHTML) load(); }, 3600);
  if (document.readyState !== "loading") load();
  else document.addEventListener("DOMContentLoaded", load);

  // Keep the tournament cards connected: add a Matches link per card.
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-details]");
    if (!b) return;
    // After the details dialog opens (tournaments.js), append a matches shortcut once.
    setTimeout(function () {
      var dlg = document.getElementById("t-dialog");
      if (!dlg || !dlg.open) return;
      if (dlg.querySelector("[data-goto-matches]")) return;
      var cta = dlg.querySelector(".t-dialog-cta");
      if (!cta) return;
      var id = b.getAttribute("data-details");
      var a = document.createElement("a");
      a.className = "btn btn-outline btn-sm";
      a.href = "#matches";
      a.setAttribute("data-goto-matches", id);
      a.textContent = "View Matches & Standings";
      a.addEventListener("click", function () {
        try { dlg.close(); } catch (x) {}
        if (tournSel) {
          fillTourns();
          tournSel.value = id;
          load();
        }
      });
      cta.appendChild(a);
    }, 0);
  });
})();
