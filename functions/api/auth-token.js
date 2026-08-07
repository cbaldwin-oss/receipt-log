// GET /api/auth-token
// Called by the app on load (and whenever its access token is about to
// expire). Looks up the session cookie, pulls the refresh token out of KV,
// and asks Google for a fresh access token. Nothing here needs a popup or
// any user interaction — that's the whole point.
export async function onRequestGet(context) {
  const { env, request } = context;
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });

  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return json({ error: "no_session" }, 401);

  const sessionId = match[1];
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
    // Refresh token itself is dead (revoked, expired from disuse, etc).
    // Clear the session so the app knows to show Authorize again.
    await env.AUTH_KV.delete(`session:${sessionId}`);
    return json({ error: "refresh_failed", detail: data.error || "unknown" }, 401);
  }

  return json({ access_token: data.access_token, expires_in: data.expires_in });
}
