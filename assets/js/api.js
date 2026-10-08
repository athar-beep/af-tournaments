/* AF TOURNAMENTS — Part 6: backend service adapter (frontend side).
   AF_API detects the server (GET /api/health, short timeout) and exposes
   mode: 'remote' | 'offline'. AF_SVC wraps every endpoint with explicit
   {ok, ...} results — callers must handle failure; nothing here fakes
   success. 401s fire an 'af-session-expired' event the admin UI listens for.
   Reads keep working offline from the existing local caches (Parts 2–5). */

(function () {
  "use strict";

  var api = {
    mode: "unknown", // unknown → remote | offline
    adminLoginAvailable: false,
    _authHandlers: []
  };

  function timeoutFetch(url, opts, ms) {
    var ctrl = null, timer = null;
    try {
      ctrl = new AbortController();
      timer = setTimeout(function () { ctrl.abort(); }, ms || 2500);
      opts = opts || {};
      opts.signal = ctrl.signal;
    } catch (e) { /* very old browser: plain fetch */ }
    return fetch(url, opts).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  function parseJson(res) {
    return res.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { return null; }
    }).then(function (body) {
      return { status: res.status, body: body };
    });
  }

  api.init = function () {
    return timeoutFetch("/api/health", {}, 2500).then(function (r) {
      return parseJson(r);
    }).then(function (out) {
      if (out.status === 200 && out.body && out.body.ok) {
        api.mode = "remote";
        api.adminLoginAvailable = !!(out.body.data && out.body.data.adminLogin);
      } else {
        api.mode = "offline";
      }
      return api.mode;
    }, function () {
      api.mode = "offline";
      return api.mode;
    });
  };

  api.onAuthExpired = function (fn) { api._authHandlers.push(fn); };
  function authExpired() {
    api._authHandlers.forEach(function (fn) { try { fn(); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent("af-session-expired")); } catch (e) {}
  }

  function call(method, path, body, isForm) {
    var opts = { method: method, headers: { "X-Requested-With": "XMLHttpRequest" } };
    if (body !== undefined) {
      if (isForm) opts.body = body; // FormData: browser sets content-type
      else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    }
    return timeoutFetch(path, opts, 12000).then(parseJson).then(function (out) {
      if (out.status === 401) { authExpired(); return { ok: false, code: 401, error: (out.body && out.body.error) || "Session required." }; }
      if (!out.body) return { ok: false, code: out.status, error: "Backend unreachable. Try again." };
      if (!out.body.ok) return { ok: false, code: out.status, error: out.body.error || "Request failed.", errors: out.body.errors };
      return { ok: true, code: out.status, data: out.body.data };
    }, function () {
      return { ok: false, code: 0, error: "Backend unreachable. Check your connection." };
    });
  }

  window.AF_API = api;

  window.AF_SVC = {
    tournaments: function () { return call("GET", "/api/tournaments"); },
    matches: function (tournamentId) {
      var q = tournamentId ? "?tournamentId=" + encodeURIComponent(tournamentId) : "";
      return call("GET", "/api/matches" + q);
    },
    leaderboard: function (tournamentId) { return call("GET", "/api/leaderboard?tournamentId=" + encodeURIComponent(tournamentId)); },
    announcements: function (tournamentId, type) {
      var q = [];
      if (tournamentId) q.push("tournamentId=" + encodeURIComponent(tournamentId));
      if (type) q.push("type=" + encodeURIComponent(type));
      return call("GET", "/api/announcements" + (q.length ? "?" + q.join("&") : ""));
    },
    createRegistration: function (formData) { return call("POST", "/api/registrations", formData, true); },
    lookup: function (id, contact) { return call("POST", "/api/registrations/lookup", { id: id, contact: contact }); },
    cancelOwn: function (id, contact) { return call("POST", "/api/registrations/" + encodeURIComponent(id) + "/cancel", { contact: contact }); },
    adminRegs: function (params) {
      var q = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
      return call("GET", "/api/admin/registrations" + (q ? "?" + q : ""));
    },
    setReg: function (id, to) { return call("POST", "/api/admin/registrations/" + encodeURIComponent(id) + "/reg-status", { to: to }); },
    setPay: function (id, to) { return call("POST", "/api/admin/registrations/" + encodeURIComponent(id) + "/pay-status", { to: to }); },
    createTournament: function (t) { return call("POST", "/api/tournaments", t); },
    updateTournament: function (id, patch) { return call("PUT", "/api/tournaments/" + encodeURIComponent(id), patch); },
    adminMatches: function (params) {
      var q = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
      return call("GET", "/api/admin/matches" + (q ? "?" + q : ""));
    },
    tournamentTeams: function (tournamentId) { return call("GET", "/api/admin/tournament-teams?tournamentId=" + encodeURIComponent(tournamentId)); },
    createMatch: function (m) { return call("POST", "/api/admin/matches", m); },
    updateMatch: function (id, patch) { return call("PUT", "/api/admin/matches/" + encodeURIComponent(id), patch); },
    setMatchStatus: function (id, to) { return call("POST", "/api/admin/matches/" + encodeURIComponent(id) + "/status", { to: to }); },
    saveResults: function (id, results) { return call("PUT", "/api/admin/matches/" + encodeURIComponent(id) + "/results", { results: results }); },
    clearResults: function (id) { return call("DELETE", "/api/admin/matches/" + encodeURIComponent(id) + "/results"); },
    publishResults: function (id, published) { return call("POST", "/api/admin/matches/" + encodeURIComponent(id) + "/publish", { published: !!published }); },
    adminAnns: function () { return call("GET", "/api/admin/announcements"); },
    createAnn: function (a) { return call("POST", "/api/admin/announcements", a); },
    updateAnn: function (id, patch) { return call("PUT", "/api/admin/announcements/" + encodeURIComponent(id), patch); },
    publishAnn: function (id, published) { return call("POST", "/api/admin/announcements/" + encodeURIComponent(id) + "/publish", { published: !!published }); },
    deleteAnn: function (id) { return call("DELETE", "/api/admin/announcements/" + encodeURIComponent(id)); },
    proofUrl: function (ref) { return "/api/admin/uploads/" + encodeURIComponent(ref); },
    login: function (actor, password) { return call("POST", "/api/admin/login", { actor: actor, password: password }); },
    logout: function () { return call("POST", "/api/admin/logout", {}); },
    me: function () { return call("GET", "/api/admin/me"); }
  };

  // Honest connection state anywhere a [data-api-banner] slot exists.
  function stampBanners(mode) {
    var els = document.querySelectorAll("[data-api-banner]");
    for (var i = 0; i < els.length; i++) {
      if (mode === "remote") {
        els[i].className = "api-banner remote";
        els[i].innerHTML = '<span class="glyph" aria-hidden="true">●</span><span><strong>Live server connected.</strong> Data is shared and verified server-side.</span>';
      } else {
        els[i].className = "api-banner offline";
        els[i].innerHTML = '<span class="glyph" aria-hidden="true">○</span><span><strong>Offline demo data.</strong> Backend unreachable — registrations stay on this device only.</span>';
      }
    }
  }
  window.addEventListener("af-api-ready", function (e) {
    stampBanners((e && e.detail && e.detail.mode) || api.mode);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
  function boot() {
    api.init().then(function (mode) {
      stampBanners(mode);
      try { window.dispatchEvent(new CustomEvent("af-api-ready", { detail: { mode: mode } })); } catch (e) {}
      if (mode === "remote" && window.AF_TOURN && window.AF_SVC) {
        window.AF_SVC.tournaments().then(function (out) {
          if (out.ok && Array.isArray(out.data) && window.AF_TOURN.setRemote) {
            window.AF_TOURN.setRemote(out.data);
            try { window.dispatchEvent(new CustomEvent("af-tournaments-synced")); } catch (e) {}
          }
        });
      }
    });
  }
})();
