// GET /api/auth-callback
// Google redirects here with a one-time code. We exchange it for an access
// token + refresh token, then keep ONLY the refresh token, server-side, in
// KV — never sent to the browser. The browser just gets a random session id
// in an HttpOnly cookie, which is useless on its own without the KV entry.
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`Google returned an error: ${error}`, { status: 400 });
  }
  if (!code) {
    return new Response("Missing authorization code.", { status: 400 });
  }
  if (!env.AUTH_KV) {
    return new Response("Missing AUTH_KV binding in Pages settings (Settings → Functions → KV namespace bindings).", { status: 500 });
  }

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
  // 180 days; SameSite=Lax is fine since this is a first-party, same-domain
  // cookie — there's no cross-site context here at all.
  headers.append("Set-Cookie", `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=15552000`);
  headers.append("Location", "/");
  return new Response(null, { status: 302, headers });
}
