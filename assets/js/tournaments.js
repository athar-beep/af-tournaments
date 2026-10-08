/* AF TOURNAMENTS — Part 2: data-driven tournament discovery.
   Source of truth: assets/data/tournaments.json (embedded mirror below so the
   page works from file:// with zero build step; replace TOURNAMENTS with a
   fetch() of that JSON when a backend exists — same shape, no UI rebuild).
   Prize: null = configurable "Coming soon", never invented.
   FULL state is fully implemented (badge/filter/CTA/dialog) but no live card
   claims it — statuses stay honest per data. */

(function () {
  "use strict";

  const WA_URL = "https://chat.whatsapp.com/GM9tP4702TY8xyZme6KltE?s=cl&p=i&ilr=4&iam=2";

  /** @type {Array} Mirror of assets/data/tournaments.json */
  var DEFAULT_TOURNAMENTS = [
    { id: "daily-match-01", name: "Daily Scrim · Match 01", tagline: "Morning lobby — be ready for check-in via WhatsApp.", status: "open", entryFeePerHead: 100, format: "All Formats", matchCount: 1, matchNote: "1 of 2 daily matches", times: ["09:30"], teams: "Not Fixed", prize: null, registrationOpen: true },
    { id: "daily-match-02", name: "Daily Scrim · Match 02", tagline: "Second lobby of the day — same rules, new lobby.", status: "open", entryFeePerHead: 100, format: "All Formats", matchCount: 1, matchNote: "1 of 2 daily matches", times: ["10:20"], teams: "Not Fixed", prize: null, registrationOpen: true },
    { id: "next-block", name: "Next Scrim Block", tagline: "Upcoming block — date drops first in the WhatsApp group.", status: "upcoming", entryFeePerHead: 100, format: "All Formats", matchCount: 2, matchNote: "2 matches per day", times: ["09:30", "10:20"], teams: "Not Fixed", prize: null, registrationOpen: false },
    { id: "previous-lobby", name: "Previous Daily Lobby", tagline: "Lobby closed — watch the group for the next announcement.", status: "closed", entryFeePerHead: 100, format: "All Formats", matchCount: 2, matchNote: "2 matches per day", times: ["09:30", "10:20"], teams: "Not Fixed", prize: null, registrationOpen: false }
  ];

  const STATUS = {
    open: { label: "OPEN", glyph: "●", cta: "Register Now" },
    upcoming: { label: "UPCOMING", glyph: "◐", cta: "Coming Soon" },
    full: { label: "FULL", glyph: "■", cta: "Lobby Full" },
    closed: { label: "CLOSED", glyph: "○", cta: "Registration Closed" }
  };

  // Admin overlay (Part 5) wins when present; otherwise the static mirror.
  // Exposed for Part 3 registration (scrim select + fee). Same shape as JSON.
  var TOURNAMENTS = DEFAULT_TOURNAMENTS;
  if (window.AF_TOURN && typeof window.AF_TOURN.publicList === "function") {
    try { TOURNAMENTS = window.AF_TOURN.publicList(); } catch (e) {}
  }
  window.AF_TOURNAMENTS = TOURNAMENTS;

  const grid = document.getElementById("t-grid");
  const count = document.getElementById("t-count");
  const empty = document.getElementById("t-empty");
  const search = document.getElementById("t-search");
  const formatSel = document.getElementById("t-format");
  const openOnly = document.getElementById("t-open-only");
  const pills = Array.from(document.querySelectorAll(".pill-btn[data-status-filter]"));
  const dialog = document.getElementById("t-dialog");
  if (!grid) return; // Part 2 section not present

  // Admin-entered tournament text is escaped on render (defense in depth —
  // names/taglines are trusted input, but markup must never execute).
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  let activeStatus = "all";

  function prizeText(t) {
    return t.prize == null ? "Coming soon" : String(t.prize);
  }

  function ctaHTML(t) {
    if (t.registrationOpen && t.status === "open") {
      return `<a class="btn btn-accent btn-sm" href="${WA_URL}" target="_blank" rel="noopener" aria-label="Register now for ${esc(t.name)} via WhatsApp">Register Now</a>`;
    }
    const label = STATUS[t.status] ? STATUS[t.status].cta : "Unavailable";
    return `<button class="btn btn-muted btn-sm" type="button" disabled aria-disabled="true" title="Registration is not open for this lobby">${label}</button>`;
  }

  function cardHTML(t) {
    const s = STATUS[t.status] || STATUS.upcoming;
    const times = t.times.map((x) => `<span class="time">${esc(x)}</span>`).join("");
    return `
    <article class="t-card reveal visible" data-status="${esc(t.status)}" data-id="${esc(t.id)}" aria-labelledby="t-${esc(t.id)}">
      <div class="t-card-body">
        <div class="t-top">
          <span class="status status-${esc(t.status)}"><span class="glyph" aria-hidden="true">${s.glyph}</span> ${s.label}</span>
          <span class="format-tag">${esc(t.format)}</span>
        </div>
        <h3 id="t-${esc(t.id)}">${esc(t.name)}</h3>
        <p class="tagline">${esc(t.tagline)}</p>
        <div class="t-times" aria-label="Match times">${times}<span class="per">${esc(t.matchNote)}</span></div>
        <dl class="t-meta">
          <div><dt>ENTRY FEE</dt><dd>PKR ${esc(t.entryFeePerHead)} / head</dd></div>
          <div><dt>TEAMS</dt><dd>${esc(t.teams)}</dd></div>
          <div><dt>PRIZE POOL</dt><dd class="prize-coming">${esc(prizeText(t))}</dd></div>
          <div><dt>DATE</dt><dd>Via WhatsApp group</dd></div>
        </dl>
        <div class="t-actions">
          <button class="btn btn-outline btn-sm" type="button" data-details="${esc(t.id)}" aria-haspopup="dialog">View Details</button>
          ${ctaHTML(t)}
        </div>
      </div>
    </article>`;
  }

  function currentFilters() {
    return {
      q: (search && search.value || "").trim().toLowerCase(),
      format: formatSel ? formatSel.value : "all",
      openOnly: !!(openOnly && openOnly.checked)
    };
  }

  function render() {
    const f = currentFilters();
    const list = TOURNAMENTS.filter((t) => {
      if (activeStatus !== "all" && t.status !== activeStatus) return false;
      if (f.format !== "all" && t.format !== f.format) return false;
      if (f.openOnly && !t.registrationOpen) return false;
      if (f.q) {
        const hay = (t.name + " " + t.times.join(" ") + " " + t.format).toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    });
    grid.innerHTML = list.map(cardHTML).join("");
    const n = list.length;
    if (count) count.textContent = n === 1 ? "1 scrim shown" : `${n} scrims shown`;
    if (empty) empty.hidden = n !== 0;
    // Update pill counts (honest counts from data)
    pills.forEach((p) => {
      const k = p.getAttribute("data-status-filter");
      const c = k === "all" ? TOURNAMENTS.length : TOURNAMENTS.filter((t) => t.status === k).length;
      const slot = p.querySelector(".count");
      if (slot) slot.textContent = String(c);
    });
  }

  pills.forEach((p) => {
    p.addEventListener("click", () => {
      activeStatus = p.getAttribute("data-status-filter") || "all";
      pills.forEach((x) => x.setAttribute("aria-pressed", String(x === p)));
      render();
    });
  });
  [search, formatSel, openOnly].forEach((el) => {
    if (!el) return;
    el.addEventListener(el.tagName === "INPUT" && el.type !== "checkbox" ? "input" : "change", render);
  });

  // Details dialog — structured sections, not one giant card
  function openDetails(id) {
    const t = TOURNAMENTS.find((x) => x.id === id);
    if (!t || !dialog) return;
    const s = STATUS[t.status] || STATUS.upcoming;
    const sched = t.times.map((tm, i) => `
      <div class="t-sched-row"><span>Match ${String(i + 1).padStart(2, "0")}</span><strong>${esc(tm)}</strong></div>`).join("");
    dialog.innerHTML = `
      <div class="t-dialog-head">
        <div>
          <span class="status status-${esc(t.status)}"><span class="glyph" aria-hidden="true">${s.glyph}</span> ${s.label}</span>
          <h3 id="t-dialog-title">${esc(t.name)}</h3>
        </div>
        <button class="t-dialog-close" type="button" data-close aria-label="Close details" autofocus>✕</button>
      </div>
      <div class="t-dialog-body">
        <section class="t-sec" aria-label="Overview"><h4>OVERVIEW</h4><p>${esc(t.tagline)} ${esc(t.matchNote)} · Teams: ${esc(t.teams)}.</p></section>
        <section class="t-sec" aria-label="Schedule"><h4>SCHEDULE</h4><div class="t-sched">${sched}</div>
          <p style="margin-top:8px;color:var(--color-muted);font-size:.88rem">Date: announced through the official WhatsApp group. No dates are listed until confirmed.</p></section>
        <section class="t-sec" aria-label="Entry and format"><h4>ENTRY · FORMAT · TEAMS</h4>
          <dl class="t-meta">
            <div><dt>ENTRY FEE</dt><dd>PKR ${esc(t.entryFeePerHead)} per head</dd></div>
            <div><dt>FORMAT</dt><dd>${esc(t.format)}</dd></div>
            <div><dt>TEAMS</dt><dd>${esc(t.teams)}</dd></div>
            <div><dt>PRIZE POOL</dt><dd class="prize-coming">${esc(prizeText(t))}</dd></div>
          </dl></section>
        <section class="t-sec" aria-label="Important announcement"><h4>IMPORTANT</h4>
          <p class="t-note">Tournament dates are announced through our official WhatsApp group. Join it to get slots, lobby codes and timing updates first.</p></section>
      </div>
      <div class="t-dialog-cta">
        ${ctaHTML(t)}
        <a class="btn btn-outline btn-sm" href="${WA_URL}" target="_blank" rel="noopener">Join WhatsApp Group</a>
      </div>`;
    const closeBtn = dialog.querySelector("[data-close]");
    if (closeBtn) closeBtn.addEventListener("click", () => dialog.close());
    if (typeof dialog.showModal === "function") dialog.showModal();
    if (closeBtn) closeBtn.focus();
  }

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-details]");
    if (btn) openDetails(btn.getAttribute("data-details"));
  });
  if (dialog) {
    dialog.addEventListener("click", (e) => {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
  }

  render();

  // Part 6: re-render from the live server snapshot when it arrives.
  window.addEventListener("af-tournaments-synced", () => {
    if (window.AF_TOURN && typeof window.AF_TOURN.publicList === "function") {
      try {
        TOURNAMENTS = window.AF_TOURN.publicList();
        window.AF_TOURNAMENTS = TOURNAMENTS;
        render();
      } catch (e) {}
    }
  });
})();
