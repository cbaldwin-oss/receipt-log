// POST /api/auth-logout
// Deletes the server-side session (and its refresh token) and clears the
// cookie. Not wired to a button by default — see the README if you want to
// add a "Disconnect Drive" control.
export async function onRequestPost(context) {
  const { env, request } = context;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (match && env.AUTH_KV) {
    await env.AUTH_KV.delete(`session:${match[1]}`);
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  return new Response(JSON.stringify({ ok: true }), { headers });
}
