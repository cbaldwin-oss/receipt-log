// GET /api/auth-start
// Redirects the browser to Google's consent screen. This is a normal
// top-level page navigation (not a popup, not an iframe), so it works the
// same everywhere, including inside an iOS "Add to Home Screen" app.
export async function onRequestGet(context) {
  const { env, request } = context;

  if (!env.GOOGLE_CLIENT_ID) {
    return new Response("Missing GOOGLE_CLIENT_ID environment variable in Pages settings.", { status: 500 });
  }

  const redirectUri = new URL("/api/auth-callback", request.url).toString();

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive",
    access_type: "offline",   // required to get a refresh token
    prompt: "consent",        // required to force a refresh token every time it's needed
    include_granted_scopes: "true"
  });

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}
