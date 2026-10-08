# AF TOURNAMENTS — Backend (Part 6)

Zero-dependency Node.js (`node >= 18`, stdlib only — no `npm install` needed).
Serves this whole folder as the site and exposes the `/api/*` JSON API.
Data lives in `server/data/` (created on boot; never served over HTTP).

## Run

```bash
cd /path/to/af-tournaments
PORT=8080 ADMIN_USER="Your Name" ADMIN_PASS="a-long-secret-passphrase" node server/server.js
```

Or copy `server/.env.example` to `server/.env` and set the values there.
`ADMIN_PASS` needs 10+ characters. Without `ADMIN_USER` + `ADMIN_PASS`,
**admin login stays disabled** (fail-closed — there is no default password).

Open: `http://localhost:8080/` (public) · `http://localhost:8080/admin.html`

## Verify (real request tests)

```bash
B=http://localhost:8080
H="X-Requested-With: XMLHttpRequest"

# 1. health + public tournaments (same source admin edits)
curl -s $B/api/health
curl -s $B/api/tournaments | head -c 300

# 2. tampered total is ignored (server recalculates 4 × 100 = 400)
curl -s -H "$H" -H 'Content-Type: application/json' -d '{
  "scrimId":"daily-match-01","teamName":"QA Falcons","captain":"QA",
  "contact":"03410106061","playerCount":4,
  "players":[{"name":"P1","gameId":"ID1"},{"name":"P2","gameId":"ID2"},{"name":"P3","gameId":"ID3"},{"name":"P4","gameId":"ID4"}],
  "payMethod":"easypaisa","payRef":"QAREF123","totalFee":1,"feePerHead":1}' \
  $B/api/registrations

# 3. duplicate is rejected (409)
#    (repeat the exact request above)

# 4. closed tournament rejected (400)
#    same body with "scrimId":"previous-lobby"

# 5. lookup needs ID + contact (wrong contact → 404)
curl -s -H "$H" -H 'Content-Type: application/json' \
  -d '{"id":"<ID-from-step-2>","contact":"03000000000"}' \
  $B/api/registrations/lookup

# 6. unauthenticated admin calls rejected (401)
curl -s $B/api/admin/registrations
curl -s -H "$H" -H 'Content-Type: application/json' \
  -d '{"to":"approved"}' $B/api/admin/registrations/<ID>/reg-status

# 7. login → admin list → approve → verify payment (cookie jar keeps session)
curl -s -c jar -H "$H" -H 'Content-Type: application/json' \
  -d '{"actor":"Your Name","password":"..."}' $B/api/admin/login
curl -s -b jar "$B/api/admin/registrations?q=falcons"
curl -s -b jar -H "$H" -H 'Content-Type: application/json' \
  -d '{"to":"pending"}'  $B/api/admin/registrations/<ID>/reg-status
curl -s -b jar -H "$H" -H 'Content-Type: application/json' \
  -d '{"to":"approved"}' $B/api/admin/registrations/<ID>/reg-status
curl -s -b jar -H "$H" -H 'Content-Type: application/json' \
  -d '{"to":"verified"}' $B/api/admin/registrations/<ID>/pay-status

# 8. invalid transition refused (409): submitted → approved directly is impossible
#    via the UI chain, but direct POST proves the server enforces the map.

# 9. logout + expired session → 401 again
curl -s -b jar -c jar -H "$H" -X POST $B/api/admin/logout
curl -s -b jar $B/api/admin/registrations

# 10. self-cancel with contact (no admin needed), wrong contact → 404
curl -s -H "$H" -H 'Content-Type: application/json' \
  -d '{"contact":"03410106061"}' $B/api/registrations/<ID>/cancel
```

## Security notes

- Passwords: scrypt + timing-safe compare, `auth.json` mode 0600, never logged.
- Sessions: 256-bit tokens, server-side store, httpOnly + SameSite=Lax cookies.
- Mutations require the `X-Requested-With` header (same-origin CSRF mitigation).
- Uploads: magic-byte typed (PNG/JPEG/PDF), 5 MB cap, stored outside the web
  root under random refs, admin-download only.
- `server/*.js`, `server/data/`, dotfiles: never served (404).
- `admin.html` markup itself is static: real protection is API-level (all data
  and mutations 401 without a session). Put the Node process behind HTTPS
  (reverse proxy) in production.
