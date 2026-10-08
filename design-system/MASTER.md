# AF TOURNAMENTS — PART 1
Premium Light Esports / Black + Gold

## Design System (MASTER)

Product: eSports Scrims & Tournament Registration Platform
Theme: Premium Light Esports
Background: #F5F5F2 / White #FFFFFF / Black #080808 / Dark #141414
Gold: #C9A227 / Bright Gold: #F2C94C
Text: #111111 / Muted: #666666

Typography:
- Display: system stack, weight 800, line-height 1.1, tracking -0.02em
- Heading: 1.2–1.3, Body: 1.5–1.6 unitless
- Measure capped 60–75ch for long-form
- Inputs 16px minimum (iOS zoom guard)

Rules applied (ui-ux-pro-max + better-typography + design-system + ui-styling):
- 3-layer tokens: primitive → semantic → component (tokens.css)
- 4/8dp spacing rhythm, section spacing 16/24/32/48/80
- No emoji as icons (inline SVG only)
- Touch targets ≥44px, focus-visible gold ring
- Reduced-motion supported, subtle entrance only
- Semantic HTML, skip-link, ARIA labels

## Skills used for PART 1
- ui-ux-pro-max: layout, hierarchy, product pattern, pre-delivery checklist
- ui-styling: component structure, utility approach, responsive mobile-first
- design-system: token architecture (this file + tokens.css)
- better-typography: scale, line-height, measure, truncation, punctuation
- brand: voice (competitive, clean, trustworthy), no PUBG affiliation
- web-performance: budgets (CSS <100KB, JS <30KB, total <500KB above fold), eager hero, lazy below, dimensions set
- technical-seo / seo-geo: semantic, meta, OG, canonical, robots.txt, sitemap.xml
- code-architecture-tailwind-v4-best-practices: variant thinking (btn primary/secondary/ghost), semantic token names
- playwright-expert / react-testing / vitest-testing: QA checklist mapping (manual verification in PART 1, automated in later phase if framework added)

Links (centralized, see assets/js/links.js):
- TikTok, YouTube, WhatsApp group as per brief

## PART 2 — Scrims & Tournament Experience
- Data: assets/data/tournaments.json (source of truth) mirrored in assets/js/tournaments.js for zero-build file:// support. Same shape — backend swaps in without UI rebuild.
- Styles: assets/css/tournaments.css extends tokens via var(--*) only, no hex duplication.
- Cards: status badge (glyph + text, never color alone) / title / times / meta dl (fee, teams, prize, date) / Details + Register CTA.
- Statuses: open/upcoming/full/closed implemented. Live data uses open×2, upcoming×1, closed×1. FULL has no live claimant (honest states) but is styled, filterable, and handled in CTA + dialog.
- Prize: null → "Coming soon" everywhere. No amounts invented. No dates invented (all "Via WhatsApp group").
- Filters: status pills with honest counts, format select, search (name/time), "registration open only" checkbox, aria-live result count, empty state with WhatsApp CTA.
- Details: native <dialog> with Overview / Schedule / Entry·Format·Teams / Important announcement / CTA row. Backdrop click + Esc close.
- Registration: open → "Register Now" (WhatsApp link); otherwise disabled button (Coming Soon / Lobby Full / Registration Closed) with aria-disabled.

## PART 3 — Scrim Registration
- UI: assets/css/registration.css (tokens only) + #register section (4 fieldset steps) + sticky fee card + success panel.
- Logic: assets/js/registration.js. Scrim select populated from window.AF_TOURNAMENTS (Part 2 data) with fallback; only OPEN enabled.
- Players: dynamic fieldsets follow count input (1–25 configurable bound; teams policy stays "Not Fixed"). Values preserved across count changes and validation failures.
- Fee: per-head from selected tournament (fallback PKR 100); total = count × fee, live aria-polite summary. Never hard-coded.
- Payment: EasyPaisa 03410106061 / UBL PK57UNIL0109000309936394, Faisal Nawaz. Reference required; proof optional (image/PDF ≤5MB, metadata only — no credentials anywhere).
- Data layer: REG_STORE (localStorage af_registrations_v1, structured records with id/ts/status). validateRecord() runs at submit AND pre-storage; duplicate guard on scrim+team+contact; submitToBackend() stub = swap point for real POST.
- Success: "Registration submitted — awaiting verification" + ID/scrim/team/count/amount/ref + WhatsApp next steps. Never claims payment verified.

## PART 4 — Registration & Payment Tracking
- Canonical data layer: assets/js/regstore.js → window.AF_REG (same localStorage key as Part 3 — migrated, never a parallel store). Tournaments stay separate (window.AF_TOURNAMENTS).
- Record: id/ts/scrimId/scrimName/team/captain/contact/playerCount/players/notes/feePerHead/totalFee/payMethod/payRef/proofName/regStatus/payStatus/history.
- Amounts ALWAYS recalculated (count × tournament fee); browser totals ignored; verifyStored() flags mismatches for manual review.
- Statuses data-driven, glyph+text: reg submitted/pending/approved/rejected/cancelled; pay pending/submitted/verified/rejected. Transition map enforced; users may only self-cancel (two-click). Verified/approved unreachable from user code.
- Tracking UI: assets/js/tracking.js + #tracking section — ID/contact lookup, on-device list, timeline, cancel, WhatsApp CTA, full status legend. Success panel (Part 3) now shows both status badges via shared .rq-badge styles in assets/css/tracking.css.

## PART 5 — Admin Portal & Tournament Management
- Separate surface: admin.html (noindex) reusing tokens/styles; dashboard never renders without a session (login view only).
- Auth BOUNDARY (honest demo): assets/js/auth.js → window.AF_AUTH (login/logout/isAdmin/actor, 8h sessionStorage session). Demo code shown on the card, marked non-secret. Backend plugs into auth.js without touching callers. Data layer refuses by:"admin" transitions without a session.
- Dashboard: real on-device numbers (total/submitted/approved/payment-to-verify/open/upcoming) + recent list + empty states. No fabricated stats.
- Registrations: search + tournament/reg-status/pay-status filters, details dialog (team, players table, ref, proof filename, audit history), approve/reject/cancel via Part 4 transition map, destructive = two-click confirm.
- Payments: dedicated verify/reject queue (submitted only); verification is manual, timestamped, actor-attributed.
- Tournaments: assets/js/tournstore.js → window.AF_TOURN (defaults + localStorage overrides; ids immutable; no date field; prize null unless real value entered). Public pages overlay via publicList(); records keep scrim snapshots. No delete in this phase.
- Audit: every transition appends {event, by, ts}; user self-service limited to own cancel.

## PART 7 — Match Management, Results & Leaderboard (THIS PHASE ONLY)
- Skills applied (read-only inspection, token/component discipline): ui-ux-pro-max (cards-first responsive, labelled-card tables, focus/reduced-motion), design-system (3-layer tokens only, no hex duplication), ui-styling (accessible dialogs/forms/tables, mobile-first), brand (restrained black/gold, no publisher affiliation), web-performance (zero-dep, no framework), vitest/playwright mapping (API-level tests below, live browser unavailable).
- Data: server/data/db.json gains `matches[]`. Match = {id, tournamentId, matchNumber 1–20 unique/tournament, scheduledTime HH:MM, status, roomInfo admin-only ≤200, notes public ≤300, results[], resultsPublished, pointsPerKillSnapshot, history[], timestamps}. No dates/rooms/results invented — empty until admin creates.
- Scoring configurable per tournament: `scoringPointsPerKill` 0–10 (default 1). Total = kills × ppk + points, recomputed server-side (and in offline mirrors). Never a hard-coded publisher rule set.
- Backend (server/validate.js + server.js + server/db.js): public GET /api/matches + /api/leaderboard (sanitized — no room/history/contacts; results only when completed+published); admin GET /api/admin/matches + /api/admin/tournament-teams; POST /api/admin/matches (always Scheduled); PUT details; POST status (MATCH_FLOW enforced); PUT results (completed-only, contiguous 1–N placements, unique teams/placements, totals recomputed, auto-unpublish); DELETE results (safe clear, audit kept); POST publish (completed + non-empty to publish). All mutations need admin session + XHR header, 401/409 on violation, audit appended.
- Admin UI (admin.html Matches tab + assets/js/matches-admin.js + matchstore.js offline mirror): filters, scoring editor, match cards, editor form with registered-teams reference, details dialog with audit, results editor with add/remove rows, publish/unpublish, two-click destructive. Room shown admin-only.
- Public UI (index.html #matches + assets/js/matches.js + matches.css): tournament selector, status filter, match cards with top-3 + <details> full results, cumulative leaderboard table (rank/team/played/kills/best/total) with data-label card transformation under 640px, loading/error/empty states, deep-link ?tournament=, Matches shortcut injected into tournament dialogs. Black/gold restraint preserved.
- Parts 1–6 preserved: no visual system rebuild, no framework, existing auth/audit/tournament/registration flows untouched (tournament edit only gains optional scoring field).

## PART 8 — Announcements, Community & Share (THIS PHASE ONLY)
- Skills applied (read-only inspection): ui-ux-pro-max (cards-first, labelled hierarchy, focus/reduced-motion), design-system (token-only announcements.css), ui-styling (accessible dialogs/forms, mobile-first), brand (restrained black/gold voice, no invented claims), technical-seo (one canonical per content, crawlable anchor sections with ids, honest empty states), web-performance (zero-dep, no polling, single fetch per filter change, cached snapshots).
- Data: server/data/db.json gains `announcements[]` (migration, empty until admin writes). Row = {id, title 3–80, message 1–280, details ≤2000, tournamentId optional+must-exist, type general/tournament/match/important, published, publishedAt, timestamps, history[]}. No dates/prizes/rules invented.
- Backend (validate.js + server.js + db.js): public GET /api/announcements?tournamentId=&type= (published only, newest first, author/history stripped); admin GET /api/admin/announcements (full rows), POST create (validated, published flag explicit, audit), PUT edit (content only), POST :id/publish (explicit visibility flip, publishedAt stamped), DELETE :id (permanent, two-click UI confirm — unpublish to archive). All mutations need admin session + XHR header.
- Admin UI (admin.html Announcements tab + announcements-admin.js + announcestore.js offline mirror): filters (tournament/type/visibility), cards, editor with live 280-char counter, Preview rendering the exact public card, details dialog with admin-only audit, publish/unpublish, safe delete.
- Public UI (index.html #announcements + announcements.js): tournament/type filters, cards with type badges + readable timestamps + <details> long text, loading/error/empty states, ?announcement=<id> deep-link scroll, per-card anchors #ann-<id>. Tournament dialogs gain an Official notices block (Tournament → Announcements in one tap).
- Community/share: official links unchanged (links.js single source, _blank+noopener); footer gains Announcements link; head gains Twitter/X card tags mirroring OG; canonical/robots/sitemap left deployment-configurable with a head comment (no fake absolute URLs generated).
- Parts 1–7 preserved: no redesign, no framework, no decoration effects.
