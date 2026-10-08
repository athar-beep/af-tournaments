/* AF TOURNAMENTS — Part 6+7+8: file-backed store (zero dependencies).
   db.json holds {tournaments, registrations, matches, announcements}. Writes are
   atomic (tmp + rename) so a crash cannot leave half-written JSON. Sessions live
   in sessions.json. Tournaments seed from the canonical Part 1–5 defaults. */

"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESS_FILE = path.join(DATA_DIR, "sessions.json");
const PROOF_DIR = path.join(DATA_DIR, "proofs");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PROOF_DIR, { recursive: true });
}

function defaultTournaments() {
  return [
    { id: "daily-match-01", name: "Daily Scrim · Match 01", tagline: "Morning lobby — be ready for check-in via WhatsApp.", status: "open", entryFeePerHead: 100, format: "All Formats", matchCount: 1, matchNote: "1 of 2 daily matches", times: ["09:30"], teams: "Not Fixed", prize: null, registrationOpen: true, scoringPointsPerKill: 1 },
    { id: "daily-match-02", name: "Daily Scrim · Match 02", tagline: "Second lobby of the day — same rules, new lobby.", status: "open", entryFeePerHead: 100, format: "All Formats", matchCount: 1, matchNote: "1 of 2 daily matches", times: ["10:20"], teams: "Not Fixed", prize: null, registrationOpen: true, scoringPointsPerKill: 1 },
    { id: "next-block", name: "Next Scrim Block", tagline: "Upcoming block — date drops first in the WhatsApp group.", status: "upcoming", entryFeePerHead: 100, format: "All Formats", matchCount: 2, matchNote: "2 matches per day", times: ["09:30", "10:20"], teams: "Not Fixed", prize: null, registrationOpen: false, scoringPointsPerKill: 1 },
    { id: "previous-lobby", name: "Previous Daily Lobby", tagline: "Lobby closed — watch the group for the next announcement.", status: "closed", entryFeePerHead: 100, format: "All Formats", matchCount: 2, matchNote: "2 matches per day", times: ["09:30", "10:20"], teams: "Not Fixed", prize: null, registrationOpen: false, scoringPointsPerKill: 1 }
  ];
}

function blankDb() {
  return { tournaments: defaultTournaments(), registrations: [], matches: [], announcements: [] };
}

function loadJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function atomicWrite(file, obj) {
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

let db = null;

function load() {
  ensureDir();
  db = loadJson(DB_FILE, null);
  if (!db || !Array.isArray(db.tournaments) || !Array.isArray(db.registrations)) {
    db = blankDb();
    atomicWrite(DB_FILE, db);
  }
  // Part 7 migration: matches collection + per-tournament scoring default.
  // Older db.json files predate matches — add them without touching existing rows.
  // Part 8 migration: announcements collection (empty until an admin writes one).
  let migrated = false;
  if (!Array.isArray(db.matches)) { db.matches = []; migrated = true; }
  if (!Array.isArray(db.announcements)) { db.announcements = []; migrated = true; }
  db.tournaments.forEach((t) => {
    if (t.scoringPointsPerKill === undefined || t.scoringPointsPerKill === null || t.scoringPointsPerKill === "") {
      t.scoringPointsPerKill = 1;
      migrated = true;
    }
  });
  // Normalize legacy match rows (never invent room/results).
  db.matches.forEach((m) => {
    if (!Array.isArray(m.results)) { m.results = []; migrated = true; }
    if (!Array.isArray(m.history)) { m.history = []; migrated = true; }
    if (typeof m.resultsPublished !== "boolean") { m.resultsPublished = false; migrated = true; }
  });
  if (migrated) atomicWrite(DB_FILE, db);
  return db;
}

function save() {
  if (db) atomicWrite(DB_FILE, db);
}

function loadSessions() {
  ensureDir();
  const s = loadJson(SESS_FILE, null);
  if (!s || typeof s !== "object") return {};
  const now = Date.now();
  let dirty = false;
  Object.keys(s).forEach((k) => {
    if (!s[k] || !s[k].exp || Number(s[k].exp) <= now) { delete s[k]; dirty = true; }
  });
  if (dirty) atomicWrite(SESS_FILE, s);
  return s;
}

function saveSessions(s) {
  ensureDir();
  atomicWrite(SESS_FILE, s);
}

module.exports = { load, save, loadSessions, saveSessions, PROOF_DIR, DATA_DIR };
