/* AF TOURNAMENTS — Part 8: admin announcement management.
   Remote-first: every mutation goes through the Part 8 API (admin session +
   XHR header required server-side; validation + audit enforced there).
   Offline: the local demo store applies the same shapes with zero seeded
   items. Drafts never render publicly — the public cache holds published
   rows only. Delete is permanent (two-click); unpublish to archive. */

(function () {
  "use strict";

  if (!window.AF_ANNS || !window.AF_TOURN || !window.AF_AUTH) return;
  var panel = document.getElementById("panel-anns");
  if (!panel) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function remote() { return !!(window.AF_API && window.AF_API.mode === "remote" && window.AF_SVC); }
  function authed() { return window.AF_AUTH.isAdmin(); }
  function actor() { return window.AF_AUTH.actor() || "admin"; }

  var cache = []; // full admin rows (incl. drafts, history)
  var editingId = null;

  var tournFilter = document.getElementById("ann-tourn");
  var typeFilter = document.getElementById("ann-type");
  var statusFilter = document.getElementById("ann-status");
  var listEl = document.getElementById("anns-list");
  var emptyEl = document.getElementById("anns-empty");
  var countEl = document.getElementById("anns-count");
  var form = document.getElementById("ann-form");
  var dialog = document.getElementById("ann-dialog");

  var TYPE_META = {
    general: { label: "GENERAL", glyph: "○" },
    tournament: { label: "TOURNAMENT", glyph: "◐" },
    match: { label: "MATCH", glyph: "●" },
    important: { label: "IMPORTANT", glyph: "◆" }
  };

  function tournName(id) {
    if (!id) return "All tournaments";
    var t = window.AF_TOURN.publicList().filter(function (x) { return x.id === id; })[0];
    return t ? t.name : id;
  }
  function typeBadge(t) {
    var m = TYPE_META[t] || TYPE_META.general;
    return '<span class="a-badge a-' + esc(t) + '"><span class="glyph" aria-hidden="true">' + m.glyph + "</span> " + m.label + "</span>";
  }
  function visBadge(a) {
    return a.published
      ? '<span class="a-badge a-match"><span class="glyph" aria-hidden="true">●</span> PUBLISHED</span>'
      : '<span class="a-badge a-draft"><span class="glyph" aria-hidden="true">○</span> DRAFT</span>';
  }
  function row(k, v) { return '<div class="s-row"><dt>' + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>"; }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return String(ts || ""); }
  }

  function sync() {
    fillTourns();
    if (!authed()) return;
    if (!remote()) {
      cache = window.AF_ANNS.allAdmin();
      render();
      return;
    }
    window.AF_SVC.adminAnns().then(function (out) {
      if (out.ok && Array.isArray(out.data)) {
        cache = out.data;
        try {
          window.AF_ANNS.setRemoteFull(out.data);
          window.AF_ANNS.setRemote(out.data.filter(function (a) { return !!a.published; }));
        } catch (e) {}
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
    var sel = document.getElementById("an-tourn");
    if (sel) {
      var cur = sel.value;
      sel.innerHTML = '<option value="">All / general</option>' + list.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>";
      }).join("");
      if (cur) sel.value = cur;
    }
  }

  function filtered() {
    var ft = tournFilter.value || "all";
    var ty = typeFilter.value || "all";
    var st = statusFilter.value || "all";
    return cache.filter(function (a) {
      if (ft !== "all" && (a.tournamentId || "") !== ft) return false;
      if (ty !== "all" && (a.type || "general") !== ty) return false;
      if (st === "published" && !a.published) return false;
      if (st === "draft" && a.published) return false;
      return true;
    });
  }

  function card(a) {
    return (
      '<article class="adm-card" aria-label="Announcement ' + esc(a.id) + '">' +
      '<span class="adm-id">' + esc(a.id) + " · " + esc(fmtDate(a.updatedAt)) + "</span>" +
      "<h3>" + esc(a.title) + "</h3>" +
      '<div class="rq-status-row">' + typeBadge(a.type || "general") + visBadge(a) + "</div>" +
      '<dl class="adm-rows">' +
      row("Scope", tournName(a.tournamentId)) +
      row("Message", String(a.message).length > 90 ? String(a.message).slice(0, 90) + "…" : a.message) +
      "</dl>" +
      '<div class="adm-actions">' +
      '<button class="btn btn-outline btn-sm" type="button" data-aact="details" data-id="' + esc(a.id) + '">Details</button>' +
      '<button class="btn btn-outline btn-sm" type="button" data-aact="edit" data-id="' + esc(a.id) + '">Edit</button>' +
      '<button class="btn btn-outline btn-sm" type="button" data-aact="preview" data-id="' + esc(a.id) + '">Preview</button>' +
      '<button class="btn btn-outline btn-sm" type="button" data-aact="publish" data-id="' + esc(a.id) + '">' + (a.published ? "Unpublish" : "Publish") + "</button>" +
      '<button class="btn btn-danger btn-sm" type="button" data-aact="delete" data-id="' + esc(a.id) + '">Delete</button>' +
      "</div></article>"
    );
  }

  function render() {
    fillTourns();
    var list = filtered();
    listEl.innerHTML = list.map(card).join("");
    var anyFilters = (tournFilter.value || "all") !== "all" || (typeFilter.value || "all") !== "all" || (statusFilter.value || "all") !== "all";
    emptyEl.hidden = list.length !== 0;
    if (cache.length && !list.length) {
      emptyEl.querySelector("h3").textContent = "Nothing matches these filters";
      emptyEl.querySelector("p").textContent = "Adjust the filters to see announcements.";
    } else {
      emptyEl.querySelector("h3").textContent = remote() ? "No announcements yet" : "No announcements yet (offline demo)";
      emptyEl.querySelector("p").textContent = "Write the first notice. Nothing appears publicly until you publish it.";
    }
    countEl.textContent = !cache.length
      ? (remote() ? "No announcements in the system yet." : "Offline demo — announcements stay on this device only.")
      : (list.length === 1 ? "1 announcement" : list.length + " announcements") + (anyFilters ? " match these filters" : "") + (remote() ? " · live server" : " · offline demo");
  }

  // ---------- editor form ----------
  function setFerr(k, m) {
    var el = form.querySelector('[data-af="' + k + '"]');
    if (el) { el.textContent = m || ""; el.classList.toggle("show", !!m); }
  }
  function openForm(id) {
    editingId = id || null;
    ["title", "type", "tournamentId", "message", "details"].forEach(function (k) { setFerr(k, ""); });
    document.getElementById("ann-form-err").textContent = "";
    document.getElementById("ann-form-title").textContent = id ? "Edit announcement" : "New announcement";
    var a = id ? cache.filter(function (x) { return String(x.id) === String(id); })[0] : null;
    fillTourns();
    document.getElementById("an-title").value = a ? a.title : "";
    document.getElementById("an-type").value = a ? (a.type || "general") : "general";
    document.getElementById("an-tourn").value = a ? (a.tournamentId || "") : "";
    document.getElementById("an-msg").value = a ? a.message : "";
    document.getElementById("an-details").value = a ? (a.details || "") : "";
    document.getElementById("an-pub").checked = false;
    stampCount();
    form.hidden = false;
    form.scrollIntoView({ block: "start", behavior: "smooth" });
    document.getElementById("an-title").focus();
  }
  function stampCount() {
    var n = document.getElementById("an-msg").value.length;
    document.getElementById("an-msg-count").textContent = "(" + n + "/280)";
  }
  function collectForm() {
    return {
      title: document.getElementById("an-title").value,
      type: document.getElementById("an-type").value,
      tournamentId: document.getElementById("an-tourn").value,
      message: document.getElementById("an-msg").value,
      details: document.getElementById("an-details").value,
      published: document.getElementById("an-pub").checked
    };
  }

  document.getElementById("ann-new").addEventListener("click", function () { openForm(null); });
  document.getElementById("ann-cancel").addEventListener("click", function () { form.hidden = true; });
  document.getElementById("an-msg").addEventListener("input", stampCount);
  [tournFilter, typeFilter, statusFilter].forEach(function (el) {
    el.addEventListener("change", render);
  });
  document.getElementById("ann-preview").addEventListener("click", function () {
    openPreview(collectForm());
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!authed()) return;
    var payload = collectForm();
    if (!remote()) {
      var res = window.AF_ANNS.saveLocal(payload, actor(), editingId);
      ["title", "type", "tournamentId", "message", "details"].forEach(function (k) {
        setFerr(k, res.ok ? "" : (res.errors[k] || ""));
      });
      if (!res.ok) { document.getElementById("ann-form-err").textContent = "Please fix the highlighted fields (offline demo validation)."; return; }
      form.hidden = true;
      cache = window.AF_ANNS.allAdmin();
      render();
      return;
    }
    var done = function (out) {
      ["title", "type", "tournamentId", "message", "details"].forEach(function (k) {
        setFerr(k, out.ok ? "" : ((out.errors && out.errors[k]) || ""));
      });
      if (!out.ok && out.code === 401) return;
      if (!out.ok) {
        document.getElementById("ann-form-err").textContent = out.error || "Please fix the highlighted fields.";
        return;
      }
      form.hidden = true;
      sync();
    };
    if (editingId) {
      var patch = { title: payload.title, type: payload.type, tournamentId: payload.tournamentId, message: payload.message, details: payload.details };
      window.AF_SVC.updateAnn(editingId, patch).then(function (out) {
        if (!out.ok) { done(out); return; }
        // Publishing is a separate explicit step after a successful edit.
        if (payload.published) window.AF_SVC.publishAnn(editingId, true).then(function () { form.hidden = true; sync(); });
        else { form.hidden = true; sync(); }
      });
    } else {
      window.AF_SVC.createAnn(payload).then(done);
    }
  });

  // ---------- card actions ----------
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-aact]");
    if (!btn || panel.hidden) return;
    var id = btn.getAttribute("data-id");
    var act = btn.getAttribute("data-aact");
    if (act === "details") { openDetails(id); return; }
    if (act === "edit") { openForm(id); return; }
    if (act === "preview") {
      var a = cache.filter(function (x) { return String(x.id) === String(id); })[0];
      if (a) openPreview({ title: a.title, type: a.type, tournamentId: a.tournamentId, message: a.message, details: a.details });
      return;
    }
    if (!authed()) return;
    if (act === "delete" && !btn.hasAttribute("data-armed")) {
      btn.setAttribute("data-armed", "1");
      btn.textContent = "Confirm delete?";
      btn.focus();
      return;
    }
    if (act === "publish") {
      var cur = cache.filter(function (x) { return String(x.id) === String(id); })[0];
      var want = cur ? !cur.published : true;
      if (!remote()) {
        var list = JSON.parse(JSON.stringify(window.AF_ANNS.allAdmin()));
        var lm = list.filter(function (x) { return String(x.id) === String(id); })[0];
        if (lm) {
          lm.published = want;
          var now = new Date().toISOString();
          if (want && !lm.publishedAt) lm.publishedAt = now;
          lm.updatedAt = now;
          try { localStorage.setItem("af_announcements_v1", JSON.stringify(list)); } catch (ex) {}
          cache = window.AF_ANNS.allAdmin();
          render();
          if (dialog.open) openDetails(id);
        }
        return;
      }
      window.AF_SVC.publishAnn(id, want).then(function () { sync(); if (dialog.open) openDetails(id); });
      return;
    }
    if (act === "delete") {
      if (!remote()) {
        var l2 = window.AF_ANNS.allAdmin().filter(function (x) { return String(x.id) !== String(id); });
        try { localStorage.setItem("af_announcements_v1", JSON.stringify(l2)); } catch (ex) {}
        cache = window.AF_ANNS.allAdmin();
        render();
        if (dialog.open) dialog.close();
        return;
      }
      window.AF_SVC.deleteAnn(id).then(function () { sync(); if (dialog.open) dialog.close(); });
    }
  });

  // ---------- public-card preview (exactly what the public site renders) ----------
  function publicCardHtml(d) {
    var t = (d.type || "general");
    var m = TYPE_META[t] || TYPE_META.general;
    return '<article class="a-card" data-type="' + esc(t) + '"><div class="a-card-body">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<span class="a-badge a-' + esc(t) + '"><span class="glyph" aria-hidden="true">' + m.glyph + "</span> " + m.label + "</span>" +
      '<span class="a-meta">' + esc(tournName(d.tournamentId)) + "</span></div>" +
      "<h3>" + esc(d.title) + "</h3>" +
      '<p class="a-msg">' + esc(d.message) + "</p>" +
      (d.details ? "<details><summary>Read more</summary><p class='a-details'>" + esc(d.details) + "</p></details>" : "") +
      "</div></article>";
  }
  function openPreview(d) {
    dialog.innerHTML =
      '<div class="t-dialog-head" style="display:flex;justify-content:space-between;gap:12px;background:var(--color-surface-dark);color:#fff;padding:20px 22px;align-items:flex-start">' +
      "<div><span class='adm-id' style='color:#9a9a9a'>PREVIEW — NOT YET PUBLIC (unless published)</span><h3 id='ann-dialog-title' style='color:#fff;margin:4px 0 0'>Announcement preview</h3></div>" +
      '<button class="t-dialog-close" type="button" data-close aria-label="Close preview" autofocus style="flex:0 0 44px;width:44px;height:44px;border-radius:10px;border:1px solid #3a3a3a;background:transparent;color:#fff;font-size:1.2rem;cursor:pointer">✕</button></div>' +
      '<div class="adm-dialog-body">' + publicCardHtml(d) + "</div>";
    dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.close(); });
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  // ---------- details dialog (admin-only fields + audit) ----------
  function openDetails(id) {
    var a = cache.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!a || !dialog) return;
    var hist = (a.history || []).slice().reverse().map(function (h) {
      return "<li>" + esc(h.event) + (h.by ? " · " + esc(h.by) : "") + " · " + esc(fmtDate(h.ts)) + "</li>";
    }).join("");
    dialog.innerHTML =
      '<div class="t-dialog-head" style="display:flex;justify-content:space-between;gap:12px;background:var(--color-surface-dark);color:#fff;padding:20px 22px;align-items:flex-start">' +
      "<div><span class='adm-id' style='color:#9a9a9a'>" + esc(a.id) + "</span><h3 id='ann-dialog-title' style='color:#fff;margin:4px 0 0'>" + esc(a.title) + "</h3></div>" +
      '<button class="t-dialog-close" type="button" data-close aria-label="Close details" autofocus style="flex:0 0 44px;width:44px;height:44px;border-radius:10px;border:1px solid #3a3a3a;background:transparent;color:#fff;font-size:1.2rem;cursor:pointer">✕</button></div>' +
      '<div class="adm-dialog-body">' +
      '<div><h4>STATUS</h4><div class="rq-status-row" style="margin:0">' + typeBadge(a.type || "general") + visBadge(a) + "</div></div>" +
      "<div><h4>CONTENT (PUBLIC FIELDS)</h4><dl class='adm-rows' style='margin:0'>" +
      row("Scope", tournName(a.tournamentId)) + row("Message", a.message) +
      (a.details ? row("Details", String(a.details).length > 120 ? String(a.details).slice(0, 120) + "…" : a.details) : "") +
      "</dl></div>" +
      "<div><h4>AUDIT HISTORY (ADMIN-ONLY)</h4>" + (hist ? "<ul class='trk-timeline' style='margin:0'>" + hist + "</ul>" : "<p class='muted' style='font-size:.88rem'>No history yet.</p>") + "</div>" +
      '<div class="adm-actions" style="margin-top:0"><button class="btn btn-outline btn-sm" type="button" data-aact="preview" data-id="' + esc(a.id) + '">Preview</button></div>' +
      "</div>";
    dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.close(); });
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  if (dialog) dialog.addEventListener("close", function () { render(); });
  window.addEventListener("af-api-ready", sync);
  window.addEventListener("af-tournaments-synced", function () { fillTourns(); render(); });
  setTimeout(sync, 3600);
  sync();
})();
