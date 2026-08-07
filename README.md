# Receipt Capturer — deploy with persistent Google sign-in

This version moves Google auth to a small backend, so once someone
authorizes Drive access, they stay signed in — including in the iOS
"Add to Home Screen" app, where the previous in-browser-only approach
couldn't survive Safari's cross-site cookie blocking.

## What's here

```
index.html                    the app itself
functions/api/auth-start.js   step 1: sends the browser to Google's consent screen
functions/api/auth-callback.js step 2: Google redirects back here; stores a refresh token
functions/api/auth-token.js   step 3: exchanges the refresh token for a fresh access token, on demand
functions/api/auth-logout.js  optional: clears the stored session
```

Deploying all of this together, on one domain, is what makes the silent
reconnect actually work — the auth cookie stays first-party the whole time.

## One-time setup (about 15 minutes)

### 1. Google Cloud Console
1. Go to console.cloud.google.com, pick or create a project.
2. **APIs & Services → Library** → enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → set it up (External is fine),
   add the `.../auth/drive` scope, and add yourself (and anyone else who'll
   use this) as a test user if it's still in Testing mode.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → type **Web application**.
   - You'll fill in "Authorized redirect URIs" in step 3 below, once you know your domain.
5. Note the **Client ID** and **Client secret** — you'll need both.

### 2. Deploy to Cloudflare Pages
1. Create a free Cloudflare account if you don't have one.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Upload assets** (or connect a git repo containing this folder — either works).
3. Upload this whole folder (`index.html` and `functions/`) — Cloudflare Pages automatically turns `functions/api/*.js` into live endpoints on your Pages domain.
4. Once deployed, you'll get a domain like `https://receipt-capturer.pages.dev` (or attach your own custom domain under **Custom domains**).

### 3. Create the KV namespace (stores refresh tokens)
1. **Workers & Pages → KV → Create namespace** — name it anything, e.g. `receipt-auth`.
2. Go to your Pages project → **Settings → Functions → KV namespace bindings** → add a binding:
   - Variable name: `AUTH_KV`
   - KV namespace: the one you just created

### 4. Add environment variables
Still in your Pages project → **Settings → Environment variables**, add (as **Encrypted/secret** where offered):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Redeploy after adding these (Pages → Deployments → Retry deployment) so the functions pick them up.

### 5. Finish the Google Cloud redirect URI
Back in Google Cloud Console, on your OAuth client, add to **Authorized redirect URIs**:
```
https://YOUR-DOMAIN/api/auth-callback
```
(the exact domain Cloudflare gave you, or your custom domain).

### 6. Test it
Open your Pages URL, tap **Authorize Google Drive** once, sign in, grant access.
You'll be redirected back to the app, now connected. Reload the page — it
should reconnect silently, no click needed. Add it to your iOS home screen
and open it from there — same thing, no repeated sign-in.

## Notes
- The refresh token never reaches the browser — only short-lived access
  tokens do, held in memory (never in localStorage) and discarded on reload.
- Each person who authorizes gets their own session cookie and their own
  KV entry, so their receipts go to their own Drive.
- If someone wants to disconnect, `POST /api/auth-logout` clears their
  stored session — you can wire a button to it if you want one in the UI.
- If Google ever stops honoring a refresh token (revoked access, unused
  for 6+ months, etc.), the app will notice on its next silent check and
  simply show the Authorize button again.
