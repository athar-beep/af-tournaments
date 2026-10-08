/* AF TOURNAMENTS — Part 8: public announcements.
   Reads published rows only (/api/announcements when reachable, on-device
   cache otherwise). Drafts, authors and audit history never reach this layer
   (the server strips them; the offline cache stores published rows only).
   Tournament dialogs gain an "Official notices" block so the journey
   Tournament → Announcements stays one tap away. */

(function () {
  "use strict";

  var tournSel = document.getElementById("pub-ann-tourn");
  var typeSel = document.getElementById("pub-ann-type");
  var grid = document.getElementById("pub-anns");
  if (!tournSel || !grid || !window.AF_ANNS) return;

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
  function tournName(id) {
    if (!id) return "All tournaments";
    var t = tournList().filter(function (x) { return x.id === id; })[0];
    return t ? t.name : "";
  }

  var META = {
    general: { label: "GENERAL", glyph: "○" },
    tournament: { label: "TOURNAMENT", glyph: "◐" },
    match: { label: "MATCH", glyph: "●" },
    important: { label: "IMPORTANT", glyph: "◆" }
  };
  function fmtDate(iso) {
    if (window.AF_ANNS && typeof window.AF_ANNS.fmtDate === "function") return window.AF_ANNS.fmtDate(iso);
    try { return new Date(iso).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return ""; }
  }

  function card(a) {
    var m = META[a.type] || META.general;
    var when = fmtDate(a.publishedAt || a.updatedAt || a.createdAt);
    return (
      '<article class="a-card" data-type="' + esc(a.type || "general") + '" id="ann-' + esc(a.id) + '" aria-label="Announcement: ' + esc(a.title) + '">' +
      '<div class="a-card-body">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<span class="a-badge a-' + esc(a.type || "general") + '"><span class="glyph" aria-hidden="true">' + m.glyph + "</span> " + m.label + "</span>" +
      '<span class="a-meta">' + esc(tournName(a.tournamentId)) + (when ? " · " + esc(when) : "") + "</span></div>" +
      "<h3>" + esc(a.title) + "</h3>" +
      '<p class="a-msg">' + esc(a.message) + "</p>" +
      (a.details
        ? "<details><summary>Read more</summary><p class='a-details'>" + esc(a.details) + "</p></details>"
        : "") +
      "</div></article>"
    );
  }

  function fillTourns() {
    var list = tournList();
    var keep = tournSel.value || "all";
    tournSel.innerHTML = '<option value="all">All tournaments</option>' + list.map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>";
    }).join("");
    if (keep === "all" || list.some(function (t) { return t.id === keep; })) tournSel.value = keep;
  }

  function render(list) {
    grid.innerHTML = list.map(card).join("");
    var empty = document.getElementById("pub-ann-empty");
    var count = document.getElementById("pub-ann-count");
    document.getElementById("pub-ann-error").hidden = true;
    var ty = typeSel.value || "all";
    if (!list.length && (tournSel.value !== "all" || ty !== "all")) {
      empty.hidden = false;
      empty.querySelector("h3").textContent = "Nothing matches these filters";
      empty.querySelectorAll("p")[0].textContent = "Try a different tournament or type.";
      empty.querySelectorAll("p")[1].hidden = true;
    } else {
      empty.hidden = list.length !== 0;
      if (!list.length) {
        empty.querySelector("h3").textContent = "No announcements yet";
        empty.querySelectorAll("p")[0].textContent = "Official notices will appear here once published. For the fastest updates, join the WhatsApp group.";
        empty.querySelectorAll("p")[1].hidden = false;
      }
    }
    count.textContent = list.length
      ? (list.length === 1 ? "1 announcement" : list.length + " announcements") + (remote() ? " · live server" : " · offline demo")
      : (remote() ? "No announcements for this filter." : "Offline demo — connect the server for live notices.");
    deepLink();
  }

  // ?announcement=<id> deep link: highlight + scroll to the card.
  function deepLink() {
    var id = null;
    try { id = new URLSearchParams(location.search).get("announcement"); } catch (e) {}
    if (!id) return;
    var el = document.getElementById("ann-" + id);
    if (!el) return;
    try {
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    } catch (e) {}
  }

  function load() {
    var tid = tournSel.value || "all";
    var ty = typeSel.value || "all";
    document.getElementById("pub-ann-loading").hidden = false;
    document.getElementById("pub-ann-error").hidden = true;
    document.getElementById("pub-ann-empty").hidden = true;
    if (!remote()) {
      try {
        render(window.AF_ANNS.publicList(tid === "all" ? null : tid, ty === "all" ? null : ty));
      } catch (e) {
        document.getElementById("pub-ann-error").hidden = false;
      }
      document.getElementById("pub-ann-loading").hidden = true;
      return;
    }
    window.AF_SVC.announcements(tid === "all" ? null : tid, ty === "all" ? null : ty).then(function (out) {
      document.getElementById("pub-ann-loading").hidden = true;
      if (out.ok && Array.isArray(out.data)) {
        try {
          // Cache published rows only — drafts can never enter this cache.
          if (!tid || tid === "all") window.AF_ANNS.setRemote(out.data);
        } catch (e) {}
        render(out.data);
      } else {
        document.getElementById("pub-ann-error").hidden = false;
      }
    });
  }

  tournSel.addEventListener("change", load);
  typeSel.addEventListener("change", load);
  document.getElementById("pub-ann-retry").addEventListener("click", load);

  // Tournament → Announcements: official notices inside the details dialog.
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-details]");
    if (!b) return;
    setTimeout(function () {
      var dlg = document.getElementById("t-dialog");
      if (!dlg || !dlg.open || dlg.querySelector("[data-ann-block]")) return;
      var body = dlg.querySelector(".t-dialog-body");
      if (!body) return;
      var id = b.getAttribute("data-details");
      var box = document.createElement("section");
      box.className = "t-sec";
      box.setAttribute("data-ann-block", id);
      box.setAttribute("aria-label", "Official notices");
      box.innerHTML = "<h4>OFFICIAL NOTICES</h4><p class='muted' style='font-size:.88rem'>Loading…</p>";
      body.appendChild(box);
      var done = function (list) {
        var rows = (list || []).filter(function (a) { return !a.tournamentId || a.tournamentId === id; }).slice(0, 3);
        if (!rows.length) {
          box.innerHTML = "<h4>OFFICIAL NOTICES</h4><p class='muted' style='font-size:.88rem'>No notices for this tournament yet. Dates drop first in the WhatsApp group.</p>";
          return;
        }
        box.innerHTML = "<h4>OFFICIAL NOTICES</h4><ul class='a-notice-list'>" + rows.map(function (a) {
          return "<li><strong>" + esc(a.title) + "</strong><small>" + esc(tournName(a.tournamentId)) + " · " + esc(fmtDate(a.publishedAt || a.updatedAt)) + "</small><div><a href='#announcements' data-ann-goto='" + esc(a.id) + "'>Read notice</a></div></li>";
        }).join("") + "</ul>";
      };
      if (remote()) {
        window.AF_SVC.announcements(id).then(function (out) { done(out.ok ? out.data : []); });
      } else {
        try { done(window.AF_ANNS.publicList(id)); } catch (x) { done([]); }
      }
    }, 0);
  });

  // "Read notice" inside the dialog: close, filter to the tournament, scroll.
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-ann-goto]");
    if (!a) return;
    var dlg = document.getElementById("t-dialog");
    try { if (dlg && dlg.open) dlg.close(); } catch (x) {}
  });

  fillTourns();
  window.addEventListener("af-api-ready", function () { fillTourns(); load(); });
  window.addEventListener("af-tournaments-synced", function () { fillTourns(); load(); });
  setTimeout(function () { if (!grid.innerHTML) load(); }, 3600);
  if (document.readyState !== "loading") load();
  else document.addEventListener("DOMContentLoaded", load);
})();
