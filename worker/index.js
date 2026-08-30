// Cloudflare Worker entry point.
//
// Cloudflare's dashboard now provisions "Workers" even from a Git-connected
// static-site-style setup, and Workers don't use the old Pages Functions
// convention of auto-routing a /functions folder. Instead, every request
// comes through this one script, and we explicitly decide what to do with
// it: handle the /api/* auth routes ourselves, or fall through to serving
// the static site (index.html etc.) from the `public` folder via the
// ASSETS binding configured in wrangler.jsonc.

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

function getSessionId(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

// GET /api/auth-start — redirects to Google's consent screen.
async function handleAuthStart(request, env) {
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response("Missing GOOGLE_CLIENT_ID environment variable.", { status: 500 });
  }
  const redirectUri = new URL("/api/auth-callback", request.url).toString();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true"
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}

// GET /api/auth-callback — Google redirects here with a one-time code.
async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) return new Response(`Google returned an error: ${error}`, { status: 400 });
  if (!code) return new Response("Missing authorization code.", { status: 400 });
  if (!env.AUTH_KV) return new Response("Missing AUTH_KV binding (Settings → Bindings).", { status: 500 });

  const redirectUri = new URL("/api/auth-callback", request.url).toString();

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  const tokens = await tokenRes.json();

  if (!tokenRes.ok || !tokens.refresh_token) {
    const detail = tokens.error_description || tokens.error || "no refresh_token in response";
    return new Response(
      `Couldn't complete Google sign-in (${detail}). If you've authorized this app before, revoke it at ` +
      `https://myaccount.google.com/permissions and try again — Google only issues a refresh token on a fresh consent.`,
      { status: 400 }
    );
  }

  const sessionId = crypto.randomUUID();
  await env.AUTH_KV.put(
    `session:${sessionId}`,
    JSON.stringify({ refresh_token: tokens.refresh_token, created: Date.now() })
  );

  const headers = new Headers();
  headers.append("Set-Cookie", `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=15552000`);
  headers.append("Location", "/");
  return new Response(null, { status: 302, headers });
}

// GET /api/auth-token — exchanges the stored refresh token for a fresh access token.
async function handleAuthToken(request, env) {
  const sessionId = getSessionId(request);
  if (!sessionId) return json({ error: "no_session" }, 401);

  const raw = env.AUTH_KV ? await env.AUTH_KV.get(`session:${sessionId}`) : null;
  if (!raw) return json({ error: "no_session" }, 401);

  const { refresh_token } = JSON.parse(raw);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token"
    })
  });

  const data = await tokenRes.json();
  if (!tokenRes.ok) {
    await env.AUTH_KV.delete(`session:${sessionId}`);
    return json({ error: "refresh_failed", detail: data.error || "unknown" }, 401);
  }

  return json({ access_token: data.access_token, expires_in: data.expires_in });
}

// POST /api/auth-logout — clears the stored session.
async function handleAuthLogout(request, env) {
  const sessionId = getSessionId(request);
  if (sessionId && env.AUTH_KV) {
    await env.AUTH_KV.delete(`session:${sessionId}`);
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  return new Response(JSON.stringify({ ok: true }), { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/auth-start") return handleAuthStart(request, env);
    if (url.pathname === "/api/auth-callback") return handleAuthCallback(request, env);
    if (url.pathname === "/api/auth-token") return handleAuthToken(request, env);
    if (url.pathname === "/api/auth-logout" && request.method === "POST") return handleAuthLogout(request, env);

    // Anything else: serve the static site (index.html, etc.) from `public/`.
    return env.ASSETS.fetch(request);
  }
};
