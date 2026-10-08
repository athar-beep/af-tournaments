/* AF TOURNAMENTS — Part 6: admin authentication boundary (remote-capable).
   Two modes, both honest:
   - remote (backend reachable): login POSTs credentials; the SESSION lives in
     an httpOnly cookie the browser JS cannot read. isAdmin() reflects the last
     server verification (boot + every admin call re-verifies via 401s).
     Passwords are never stored anywhere client-side.
   - offline (no backend): the Part 5 demo gate, clearly labeled in the UI.
   Callers (admin UI, data layer) are unchanged: login/logout/isAdmin/actor. */

(function () {
  "use strict";

  // Displayed openly on the login card. NOT a secret — demo convenience only.
  var DEMO_CODE = "AF-DEMO-2026";
  var SESSION_KEY = "af_admin_session_v1";
  var SESSION_MS = 8 * 60 * 60 * 1000;

  var remoteAuthed = false;
  var remoteActor = "";

  function remote() {
    return !!(window.AF_API && window.AF_API.mode === "remote" && window.AF_SVC);
  }

  function readDemoSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.actor || !s.ts) return null;
      if (Date.now() - Number(s.ts) > SESSION_MS) { sessionStorage.removeItem(SESSION_KEY); return null; }
      return s;
    } catch (e) { return null; }
  }

  window.AF_AUTH = {
    DEMO_CODE: DEMO_CODE, // intentionally public
    isDemo: true, // false once a remote session verifies
    mode: function () { return remote() ? "remote" : "offline-demo"; },
    // Verify any existing server session (httpOnly cookie) at boot.
    boot: function () {
      if (!remote()) return Promise.resolve(false);
      return window.AF_SVC.me().then(function (out) {
        remoteAuthed = !!(out.ok && out.data && out.data.actor);
        remoteActor = remoteAuthed ? out.data.actor : "";
        window.AF_AUTH.isDemo = !remoteAuthed;
        return remoteAuthed;
      });
    },
    login: function (code, actorName) {
      var actor = String(actorName || "").trim();
      if (actor.length < 2 || actor.length > 40)
        return Promise.resolve({ ok: false, error: "Enter your admin display name (2–40 characters)." });
      if (remote()) {
        // Server checks the password; only the actor name comes back.
        return window.AF_SVC.login(actor, code).then(function (out) {
          if (!out.ok) return out;
          remoteAuthed = true;
          remoteActor = (out.data && out.data.actor) || actor;
          window.AF_AUTH.isDemo = false;
          return { ok: true };
        });
      }
      if (String(code || "").trim().toUpperCase() !== DEMO_CODE)
        return Promise.resolve({ ok: false, error: "Unknown access code. Hint: the demo code is printed on this card." });
      var s = { actor: actor, ts: Date.now() };
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
      return Promise.resolve({ ok: true, session: s });
    },
    logout: function () {
      var done = function () {
        remoteAuthed = false;
        remoteActor = "";
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
      };
      if (remote()) {
        return window.AF_SVC.logout().then(function () { done(); }, function () { done(); });
      }
      done();
      return Promise.resolve({});
    },
    // Server is authoritative: a 401 anywhere clears the remote flag.
    remoteLogout: function () {
      remoteAuthed = false;
      remoteActor = "";
      window.AF_AUTH.isDemo = true;
    },
    isAdmin: function () {
      if (remoteAuthed) return true;
      if (remote()) return false; // backend reachable: demo sessions don't count
      return !!readDemoSession();
    },
    actor: function () {
      if (remoteAuthed) return remoteActor;
      var s = readDemoSession();
      return s ? s.actor : "";
    },
    session: function () {
      if (remoteAuthed) return { actor: remoteActor, remote: true };
      return readDemoSession();
    }
  };

  window.addEventListener("af-session-expired", function () {
    if (window.AF_AUTH) window.AF_AUTH.remoteLogout();
  });
})();
