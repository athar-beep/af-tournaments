/* AF TOURNAMENTS — Part 4: "Track registration" UI.
   Reads only through window.AF_REG (canonical data layer). Renders every
   record with recalculated amounts (tamper-flagged when the stored total
   differs), glyph+text status badges, history timeline, and user cancel
   (submitted/pending → cancelled, two-click confirm). No status is ever
   shown as verified/approved unless the record actually holds it. */

(function () {
  "use strict";

  var WA_URL = "https://chat.whatsapp.com/GM9tP4702TY8xyZme6KltE?s=cl&p=i&ilr=4&iam=2";
  var list = document.getElementById("trk-list");
  if (!list || !window.AF_REG) return;
  var REG = window.AF_REG;

  var idInput = document.getElementById("trk-id");
  var contactInput = document.getElementById("trk-contact");
  var findBtn = document.getElementById("trk-find");
  var resetBtn = document.getElementById("trk-reset");
  var msg = document.getElementById("trk-msg");
  var empty = document.getElementById("trk-empty");
  var view = "mine"; // 'mine' | results array

  function remoteMode() {
    return !!(window.AF_API && window.AF_API.mode === "remote" && window.AF_SVC);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function regBadge(s) {
    var m = REG.REG_STATUS[s] || REG.REG_STATUS.submitted;
    return '<span class="rq-badge rq-reg-' + esc(s) + '"><span class="glyph" aria-hidden="true">' + m.glyph + "</span> " + m.label + "</span>";
  }
  function payBadge(s) {
    var m = REG.PAY_STATUS[s] || REG.PAY_STATUS.submitted;
    return '<span class="rq-badge rq-pay-' + esc(s) + '"><span class="glyph" aria-hidden="true">' + m.glyph + "</span> " + m.label + "</span>";
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return String(ts); }
  }
  function payLabel(m) { return m === "easypaisa" ? "EasyPaisa" : "UBL Bank"; }

  function cardHTML(r) {
    var v = REG.verifyStored(r);
    var flag = (!v.scrimKnown || !v.amountOk)
      ? '<p class="trk-flag" role="alert">Amount flagged for manual review — our team will confirm the correct total in WhatsApp. Do not pay again yet.</p>'
      : "";
    var hist = (r.history || []).slice().reverse().map(function (h) {
      return "<li>" + esc(h.event) + (h.by ? " · " + esc(h.by) : "") + " · " + esc(fmtDate(h.ts)) + "</li>";
    }).join("");
    var cancelBtn = (r.regStatus === "submitted" || r.regStatus === "pending")
      ? '<button class="btn btn-outline btn-sm" type="button" data-cancel="' + esc(r.id) + '">Cancel Registration</button>'
      : "";
    return (
      '<article class="trk-card" aria-label="Registration ' + esc(r.id) + '">' +
      '<span class="trk-id">' + esc(r.id) + " · " + esc(fmtDate(r.ts)) + "</span>" +
      "<h3>" + esc(r.teamName) + "</h3>" +
      '<div class="rq-status-row">' + regBadge(r.regStatus) + payBadge(r.payStatus) + "</div>" +
      '<dl class="trk-rows">' +
      row("Scrim", r.scrimName) +
      row("Players", String(r.playerCount) + " × PKR " + v.feePerHead) +
      row("Total", "PKR " + Number(r.totalFee).toLocaleString("en-PK")) +
      row("Paid via", payLabel(r.payMethod)) +
      row("Reference", r.payRef) +
      "</dl>" + flag +
      '<ul class="trk-timeline" aria-label="Status history">' + hist + "</ul>" +
      '<div class="trk-actions">' +
      '<a class="btn btn-accent btn-sm" href="' + WA_URL + '" target="_blank" rel="noopener">WhatsApp Updates</a>' +
      cancelBtn +
      "</div></article>"
    );
  }
  function row(k, v) { return '<div class="s-row"><dt>' + k + "</dt><dd>" + esc(v) + "</dd></div>"; }

  function render(records, note) {
    if (!records.length) {
      list.innerHTML = "";
      empty.hidden = false;
      if (msg) { msg.textContent = note || ""; msg.hidden = !note; }
      return;
    }
    empty.hidden = true;
    if (msg) { msg.textContent = note || (records.length === 1 ? "1 registration found." : records.length + " registrations found."); msg.hidden = false; }
    list.innerHTML = records.map(cardHTML).join("");
  }

  function showMine() {
    view = "mine";
    var all = REG.all().slice().sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
    render(all, all.length ? "" : "");
    if (!all.length && msg) { msg.textContent = "No registrations on this device yet — submit one above."; msg.hidden = false; }
  }

  if (findBtn) findBtn.addEventListener("click", function () {
    var id = (idInput.value || "").trim();
    var contact = (contactInput.value || "").trim();
    if (remoteMode()) {
      // Server lookup needs BOTH id and contact (no public listings).
      if (!id || !contact) {
        render([], "Enter both the registration ID and the contact number to look it up on the server.");
        view = "results";
        return;
      }
      view = "results";
      if (msg) { msg.textContent = "Looking up…"; msg.hidden = false; }
      window.AF_SVC.lookup(id, contact).then(function (out) {
        if (out.ok) render([out.data], "");
        else render([], out.error || "Lookup failed.");
      });
      return;
    }
    if (id) {
      var r = REG.getById(id);
      render(r ? [r] : [], r ? "" : "No registration found for that ID. Check the ID from your confirmation.");
      return;
    }
    if (contact) {
      var res = REG.findByContact(contact);
      if (!res.ok) { render([], res.error); return; }
      render(res.records, res.records.length ? "" : "No registrations found for that number.");
      return;
    }
    showMine();
  });
  [idInput, contactInput].forEach(function (el) {
    if (el) el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); findBtn.click(); } });
  });
  if (resetBtn) resetBtn.addEventListener("click", function () {
    idInput.value = ""; contactInput.value = "";
    showMine();
  });

  // Two-click cancel: first click arms, second confirms.
  // Remote: server verifies the contact before cancelling (no admin needed).
  list.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-cancel]");
    if (!btn) return;
    if (!btn.hasAttribute("data-armed")) {
      btn.setAttribute("data-armed", "1");
      btn.textContent = "Confirm Cancel?";
      btn.focus();
      return;
    }
    var rid = btn.getAttribute("data-cancel");
    if (remoteMode()) {
      var card = btn.closest("article");
      var contact = "";
      if (card) {
        // Re-read contact from the local cache (never from card text).
        var cached = REG.all().filter(function (x) { return x.id === rid; })[0];
        if (cached) contact = cached.contact;
      }
      btn.disabled = true;
      window.AF_SVC.cancelOwn(rid, contact).then(function (out) {
        btn.disabled = false;
        if (!out.ok) {
          btn.textContent = "Cancel Registration";
          btn.removeAttribute("data-armed");
          if (msg) { msg.textContent = out.error || "Cancel failed."; msg.hidden = false; }
          return;
        }
        // Mirror the server truth into the local cache.
        var all = REG.all().map(function (x) { return x.id === out.data.id ? out.data : x; });
        try { localStorage.setItem("af_registrations_v1", JSON.stringify(all)); } catch (e2) {}
        refresh();
      });
      return;
    }
    var res = REG.setStatus(rid, "reg", "cancelled", "user");
    if (!res.ok) {
      btn.textContent = "Cancel Registration";
      btn.removeAttribute("data-armed");
      if (msg) { msg.textContent = res.error; msg.hidden = false; }
      return;
    }
    refresh();
  });

  function refresh() {
    if (view === "mine") showMine();
    else findBtn.click();
  }

  // Refresh when a new registration is submitted elsewhere on the page.
  window.addEventListener("af-registration-saved", refresh);

  showMine();
})();
