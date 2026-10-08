/* AF TOURNAMENTS — Part 6: server-side validation (canonical rules).
   Mirrors the Part 3/4 client rules but enforced here: unknown tournament IDs,
   closed lobbies, bad contacts/counts/methods/references are rejected, and
   totals are ALWAYS recomputed from count × tournament fee. Anything the
   browser sends for total/fee/status/actor is ignored. */

"use strict";

const LIMITS = { feeFallbackPerHead: 100, minPlayers: 1, maxPlayers: 25, proofMaxMB: 5 };
const REG_STATUSES = ["submitted", "pending", "approved", "rejected", "cancelled"];
const PAY_STATUSES = ["pending", "submitted", "verified", "rejected"];
const REG_FLOW = {
  submitted: ["pending", "cancelled"],
  pending: ["approved", "rejected", "cancelled"],
  approved: [], rejected: [], cancelled: []
};
const PAY_FLOW = {
  pending: ["submitted"],
  submitted: ["verified", "rejected"],
  verified: [], rejected: []
};
const T_STATUSES = ["open", "upcoming", "full", "closed"];
const MATCH_STATUSES = ["scheduled", "live", "completed", "cancelled"];
const MATCH_FLOW = {
  scheduled: ["live", "cancelled"],
  live: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};
const ANN_TYPES = ["general", "tournament", "match", "important"];

function normContact(v) {
  const d = String(v == null ? "" : v).replace(/[\s\-()]/g, "");
  if (/^\+923\d{9}$/.test(d)) return "0" + d.slice(3);
  if (/^923\d{9}$/.test(d)) return "0" + d.slice(2);
  return d;
}

function findScrim(tournaments, id) {
  return (tournaments || []).filter((t) => t.id === id)[0] || null;
}

function feePerHead(scrim) {
  const f = scrim && Number(scrim.entryFeePerHead);
  return f > 0 ? f : LIMITS.feeFallbackPerHead;
}

function str(v) { return String(v == null ? "" : v); }

function validateRegistration(d, tournaments) {
  const errs = {};
  const scrim = findScrim(tournaments, d.scrimId);
  if (!scrim) errs.scrimId = "Unknown tournament.";
  else if (!scrim.registrationOpen || scrim.status !== "open") errs.scrimId = "Registration is not open for this lobby.";
  const team = str(d.teamName).trim();
  if (team.length < 2 || team.length > 60) errs.teamName = "Team name must be 2–60 characters.";
  const cap = str(d.captain).trim();
  if (cap.length < 2 || cap.length > 60) errs.captain = "Captain name must be 2–60 characters.";
  const contact = normContact(d.contact);
  if (!/^03\d{9}$/.test(contact)) errs.contact = "Invalid contact number.";
  const n = Number(d.playerCount);
  const countOk = /^\d+$/.test(str(d.playerCount)) && n >= LIMITS.minPlayers && n <= LIMITS.maxPlayers;
  if (!countOk) errs.playerCount = "Player count out of bounds.";
  const seen = {};
  (Array.isArray(d.players) ? d.players : []).forEach((p, i) => {
    const nm = str(p.name).trim(), gid = str(p.gameId).trim();
    if (nm.length < 2 || nm.length > 30) errs["pname" + i] = "Bad player name.";
    if (gid.length < 2 || gid.length > 40) errs["pgame" + i] = "Bad player ID.";
    const k = gid.toLowerCase();
    if (gid && seen[k] !== undefined) errs["pgame" + i] = "Duplicate player ID.";
    else if (gid) seen[k] = i;
  });
  if ((Array.isArray(d.players) ? d.players : []).length !== n) errs.playerCount = errs.playerCount || "Player details do not match count.";
  if (d.payMethod !== "easypaisa" && d.payMethod !== "ubl") errs.payMethod = "Bad payment method.";
  if (!/^[A-Za-z0-9][A-Za-z0-9 \-.]{3,39}$/.test(str(d.payRef).trim())) errs.payRef = "Bad payment reference.";
  const fee = feePerHead(scrim);
  return { valid: Object.keys(errs).length === 0, errors: errs, contact, count: n, fee, total: n * fee, scrim };
}

function validateTournament(t, existingIds, isNew) {
  const errs = {};
  if (isNew) {
    if (!/^[a-z0-9-]{3,40}$/.test(str(t.id))) errs.id = "ID: 3–40 chars, lowercase, numbers, hyphens.";
    else if (existingIds.indexOf(t.id) !== -1) errs.id = "That ID already exists.";
  }
  if (str(t.name).trim().length < 3 || str(t.name).trim().length > 60) errs.name = "Name: 3–60 characters.";
  if (str(t.format).trim().length < 2 || str(t.format).trim().length > 40) errs.format = "Format: 2–40 characters.";
  const fee = Number(t.entryFeePerHead);
  if (!Number.isInteger(fee) || fee < 0 || fee > 100000) errs.entryFeePerHead = "Entry fee: whole PKR 0–100000.";
  const mc = Number(t.matchCount);
  if (!Number.isInteger(mc) || mc < 1 || mc > 10) errs.matchCount = "Matches: 1–10.";
  const times = Array.isArray(t.times) ? t.times : str(t.times).split(/[,\s]+/).filter(Boolean);
  if (!times.length || times.length > 4) errs.times = "Give 1–4 match times.";
  else if (!times.every((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x))) errs.times = "Times must be HH:MM (24-hour).";
  if (str(t.teams).trim().length < 2 || str(t.teams).trim().length > 40) errs.teams = "Teams: 2–40 characters.";
  if (T_STATUSES.indexOf(t.status) === -1) errs.status = "Invalid tournament status.";
  // Part 7: configurable scoring — points awarded per kill. Never a hard-coded
  // publisher rule set; default 1 so older tournaments keep working.
  let pointsPerKill = 1;
  if (t.scoringPointsPerKill !== undefined && t.scoringPointsPerKill !== null && String(t.scoringPointsPerKill).trim() !== "") {
    pointsPerKill = Number(t.scoringPointsPerKill);
    if (!Number.isInteger(pointsPerKill) || pointsPerKill < 0 || pointsPerKill > 10)
      errs.scoringPointsPerKill = "Points per kill: whole number 0–10.";
  }
  return { valid: Object.keys(errs).length === 0, errors: errs, times, pointsPerKill };
}

function pointsPerKillOf(tournament) {
  const v = tournament && Number(tournament.scoringPointsPerKill);
  if (Number.isInteger(v) && v >= 0 && v <= 10) return v;
  return 1;
}

function validateMatch(body, tournaments, matches, isNew, selfId) {
  const errs = {};
  const tournamentId = str(body.tournamentId).trim();
  const tournament = findScrim(tournaments, tournamentId);
  if (!tournamentId) errs.tournamentId = "Choose a tournament.";
  else if (!tournament) errs.tournamentId = "Unknown tournament.";
  const matchNumber = Number(body.matchNumber);
  if (!Number.isInteger(matchNumber) || matchNumber < 1 || matchNumber > 20)
    errs.matchNumber = "Match number: whole number 1–20.";
  else if (tournament) {
    const clash = (matches || []).some((m) =>
      m.tournamentId === tournamentId && Number(m.matchNumber) === matchNumber &&
      String(m.id) !== String(selfId || ""));
    if (clash) errs.matchNumber = "That match number already exists for this tournament.";
  }
  const scheduledTime = str(body.scheduledTime).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime))
    errs.scheduledTime = "Scheduled time must be HH:MM (24-hour).";
  if (isNew) {
    const st = body.status === undefined || body.status === null || body.status === "" ? "scheduled" : String(body.status);
    if (st !== "scheduled") errs.status = "New matches always start as Scheduled.";
  } else if (body.status !== undefined && MATCH_STATUSES.indexOf(String(body.status)) === -1) {
    errs.status = "Invalid match status.";
  }
  const roomInfo = str(body.roomInfo == null ? "" : body.roomInfo);
  if (roomInfo.length > 200) errs.roomInfo = "Room info: at most 200 characters.";
  const notes = str(body.notes == null ? "" : body.notes);
  if (notes.length > 300) errs.notes = "Notes: at most 300 characters.";
  return {
    valid: Object.keys(errs).length === 0,
    errors: errs,
    tournament,
    matchNumber,
    scheduledTime,
    roomInfo: roomInfo.trim(),
    notes: notes.trim()
  };
}

function computeResultTotal(entry, ppk) {
  const kills = Number(entry.kills) || 0;
  const points = Number(entry.points) || 0;
  return kills * ppk + points;
}

// Validates a full result set for one match. Totals/ranks are recomputed
// server-side — any client-sent totalPoints/rank is ignored.
function validateResultSet(list, ppk) {
  const errs = {};
  if (!Array.isArray(list)) return { valid: false, errors: { results: "Results must be a list." }, rows: [] };
  if (list.length > 50) return { valid: false, errors: { results: "At most 50 result rows per match." }, rows: [] };
  const seenTeam = {};
  const seenPlace = {};
  const rows = [];
  list.forEach((r, i) => {
    const team = str(r.teamName).trim();
    const placement = Number(r.placement);
    const kills = Number(r.kills);
    const points = Number(r.points);
    if (team.length < 2 || team.length > 60) errs["team" + i] = "Team name must be 2–60 characters.";
    const tk = team.toLowerCase();
    if (team && seenTeam[tk] !== undefined) errs["team" + i] = errs["team" + i] || "Duplicate team in this match.";
    else if (team) seenTeam[tk] = i;
    if (!Number.isInteger(placement) || placement < 1 || placement > 100)
      errs["placement" + i] = "Placement: whole number 1–100.";
    else if (seenPlace[placement] !== undefined) errs["placement" + i] = "Duplicate placement in this match.";
    else seenPlace[placement] = i;
    if (r.kills !== undefined && r.kills !== null && r.kills !== "" && (!Number.isInteger(kills) || kills < 0 || kills > 300))
      errs["kills" + i] = "Kills: whole number 0–300.";
    if (r.points !== undefined && r.points !== null && r.points !== "" && (!Number.isInteger(points) || points < 0 || points > 5000))
      errs["points" + i] = "Points: whole number 0–5000.";
    rows.push({
      teamName: team,
      placement: Number.isInteger(placement) ? placement : 0,
      kills: Number.isInteger(kills) && kills >= 0 ? kills : 0,
      points: Number.isInteger(points) && points >= 0 ? points : 0,
      totalPoints: 0
    });
  });
  // Placements must be contiguous 1..N so ranks are never invented/skipped.
  if (!Object.keys(errs).length && rows.length) {
    const sorted = rows.map((x) => x.placement).sort((a, b) => a - b);
    const contiguous = sorted.every((p, idx) => p === idx + 1);
    if (!contiguous) errs.results = "Placements must be exactly 1–" + rows.length + " with no gaps or duplicates.";
  }
  rows.forEach((x) => { x.totalPoints = computeResultTotal(x, ppk); });
  // Stable order: placement asc. Server is authoritative for rank.
  rows.sort((a, b) => a.placement - b.placement);
  return { valid: Object.keys(errs).length === 0, errors: errs, rows };
}

function buildLeaderboard(matches, ppkFallback) {
  // Canonical aggregation: only completed matches with published results.
  const table = {};
  (matches || []).forEach((m) => {
    if (m.status !== "completed" || !m.resultsPublished || !Array.isArray(m.results)) return;
    const ppk = Number.isInteger(Number(m.pointsPerKillSnapshot)) ? Number(m.pointsPerKillSnapshot) : ppkFallback;
    m.results.forEach((r) => {
      const key = String(r.teamName).trim().toLowerCase();
      if (!key) return;
      if (!table[key]) table[key] = {
        teamName: String(r.teamName).trim(),
        played: 0, totalPoints: 0, totalKills: 0, totalPlacementPoints: 0,
        bestPlacement: null, wins: 0
      };
      const row = table[key];
      row.played += 1;
      // Recompute from canonical kills/points so stored totals can never drift.
      const kills = Number(r.kills) || 0;
      const pts = Number(r.points) || 0;
      row.totalKills += kills;
      row.totalPlacementPoints += pts;
      row.totalPoints += kills * (Number.isInteger(ppk) ? ppk : 1) + pts;
      const pl = Number(r.placement);
      if (Number.isInteger(pl) && pl >= 1) {
        if (row.bestPlacement == null || pl < row.bestPlacement) row.bestPlacement = pl;
        if (pl === 1) row.wins += 1;
      }
    });
  });
  const list = Object.keys(table).map((k) => table[k]);
  list.sort((a, b) =>
    b.totalPoints - a.totalPoints ||
    b.totalKills - a.totalKills ||
    (a.bestPlacement == null ? 999 : a.bestPlacement) - (b.bestPlacement == null ? 999 : b.bestPlacement) ||
    String(a.teamName).localeCompare(String(b.teamName)));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

// Part 8: announcements. Nothing is invented server-side — empty until an
// admin creates content. Timestamps/authors are stamped from the session.
function validateAnnouncement(body, tournaments) {
  const errs = {};
  const title = str(body.title).trim();
  if (title.length < 3 || title.length > 80) errs.title = "Title: 3–80 characters.";
  const message = str(body.message).trim();
  if (message.length < 1 || message.length > 280) errs.message = "Short message: 1–280 characters.";
  const details = str(body.details == null ? "" : body.details);
  if (details.length > 2000) errs.details = "Detailed message: at most 2000 characters.";
  const tournamentId = str(body.tournamentId == null ? "" : body.tournamentId).trim();
  let tournament = null;
  if (tournamentId) {
    tournament = findScrim(tournaments, tournamentId);
    if (!tournament) errs.tournamentId = "Unknown tournament.";
  }
  const type = str(body.type == null || body.type === "" ? "general" : body.type).trim();
  if (ANN_TYPES.indexOf(type) === -1) errs.type = "Invalid announcement type.";
  return {
    valid: Object.keys(errs).length === 0,
    errors: errs,
    title, message,
    details: details.trim(),
    tournamentId,
    tournament,
    type
  };
}

module.exports = {
  LIMITS, REG_STATUSES, PAY_STATUSES, REG_FLOW, PAY_FLOW, T_STATUSES,
  MATCH_STATUSES, MATCH_FLOW, ANN_TYPES,
  normContact, findScrim, feePerHead, validateRegistration, validateTournament,
  validateMatch, validateResultSet, computeResultTotal, pointsPerKillOf, buildLeaderboard,
  validateAnnouncement
};
