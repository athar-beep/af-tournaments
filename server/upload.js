/* AF TOURNAMENTS — Part 6: payment-proof upload boundary.
   Minimal multipart parser (single file + text fields, stdlib only).
   - Hard caps: 6.5 MB request, 5 MB file.
   - Type is decided by MAGIC BYTES (PNG/JPEG/PDF), never the client MIME.
   - Stored under server/data/proofs/<recordId>-<rand>.bin — the ref handed to
     the client maps to a path server-side only (no filesystem paths leak,
     no traversal possible). Served to admins only, as attachment. */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const V = require("./validate");

const MAX_BODY = 6500000;

function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > cap) { reject(new Error("too-large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readJson(req) {
  return readBody(req, 1000000).then((buf) => {
    if (!buf.length) return {};
    return JSON.parse(buf.toString("utf8"));
  });
}

function detectType(buf) {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
    return "application/pdf";
  return null;
}

// Returns {fields, file} where file = {name, data} or null. Throws on abuse.
function parseMultipart(req) {
  const ct = String(req.headers["content-type"] || "");
  const m = ct.match(/boundary=(.+)$/);
  if (!m) return Promise.resolve(null);
  let boundary = "--" + m[1].trim().replace(/^"|"$/g, "");
  return readBody(req, MAX_BODY).then((buf) => {
    const bnd = Buffer.from(boundary, "utf8");
    const fields = {};
    let file = null;
    let start = 0;
    for (;;) {
      const bi = buf.indexOf(bnd, start);
      if (bi === -1) break;
      const headEnd = buf.indexOf("\r\n\r\n", bi);
      if (headEnd === -1) break;
      const head = buf.slice(bi, headEnd).toString("latin1");
      let next = buf.indexOf(bnd, headEnd + 4);
      if (next === -1) break;
      let data = buf.slice(headEnd + 4, next - 2); // strip trailing CRLF
      const nm = head.match(/name="([^"]*)"/);
      const fn = head.match(/filename="([^"]*)"/);
      if (nm && fn && fn[1]) {
        if (!file) file = { name: fn[1].slice(0, 120), data };
        // extra files ignored — one proof per registration
      } else if (nm) {
        fields[nm[1]] = data.toString("utf8");
      }
      start = next;
      if (buf.slice(next, next + bnd.length + 2).toString() === bnd.toString() + "--") break;
    }
    return { fields, file };
  });
}

function storeProof(recordId, file) {
  if (!file) return { ok: true, ref: "" };
  if (file.data.length > V.LIMITS.proofMaxMB * 1024 * 1024)
    return { ok: false, error: "Payment proof must be " + V.LIMITS.proofMaxMB + " MB or smaller." };
  const mime = detectType(file.data);
  if (!mime) return { ok: false, error: "Payment proof must be a PNG, JPEG or PDF file." };
  const ref = "pf_" + crypto.randomBytes(12).toString("hex");
  const ext = mime === "image/png" ? ".png" : mime === "image/jpeg" ? ".jpg" : ".pdf";
  const fname = String(recordId).replace(/[^A-Za-z0-9-]/g, "") + "-" + ref + ext;
  fs.writeFileSync(path.join(db.PROOF_DIR, fname), file.data, { mode: 0o600 });
  const meta = { ref, recordId: String(recordId), file: fname, mime, size: file.data.length, ts: new Date().toISOString() };
  try {
    const mf = path.join(db.PROOF_DIR, "index.json");
    let idx = {};
    try { idx = JSON.parse(fs.readFileSync(mf, "utf8")); } catch (e) {}
    idx[ref] = meta;
    fs.writeFileSync(mf, JSON.stringify(idx, null, 2), "utf8");
  } catch (e) {}
  return { ok: true, ref, mime, name: file.name };
}

function proofMeta(ref) {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(db.PROOF_DIR, "index.json"), "utf8"));
    return idx[String(ref)] || null;
  } catch (e) { return null; }
}

function proofPath(meta) {
  const p = path.join(db.PROOF_DIR, meta.file);
  const rel = path.relative(db.PROOF_DIR, p);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // traversal guard
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return p;
  } catch (e) { return null; }
}

module.exports = { readBody, readJson, parseMultipart, storeProof, proofMeta, proofPath, MAX_BODY };
