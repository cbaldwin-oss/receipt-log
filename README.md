# Receipt Capturer — deploy with persistent Google sign-in

This version moves Google auth to a small backend, so once someone
authorizes Drive access, they stay signed in — including in the iOS
"Add to Home Screen" app, where a client-only approach can't survive
Safari's cross-site cookie blocking.

## What's here

```
index.html                     the app itself
functions/api/auth-start.js    step 1: sends the browser to Google's consent screen
functions/api/auth-callback.js step 2: Google redirects back here; stores a refresh token
functions/api/auth-token.js    step 3: exchanges the refresh token for a fresh access token, on demand
functions/api/auth-logout.js   optional: clears a stored session
```

Deploying all of this together, on one domain, is what makes the silent
reconnect actually work — the auth cookie stays first-party the whole time.

## Good news: you already have an OAuth client

Your previous version had a Client ID already set up
(`658720978828-hqbtvqgacp4elh18al77sc4245d18bol.apps.googleusercontent.com`).
You can reuse that same client — you just need its **Client Secret** too now
(the old client-only flow never needed it; this backend flow does). Get it
from Google Cloud Console → **APIs & Services → Credentials** → click that
OAuth client → the secret is right there (or generate a new one if it's
been lost). The separate "API key" from the old config isn't needed anymore
— it was only ever used for the Drive folder picker, which this version
doesn't use.

## One-time setup (about 15 minutes)

### 1. Google Cloud Console
1. Go to console.cloud.google.com, open the project with your existing OAuth client.
2. **APIs & Services → OAuth consent screen** — confirm the `.../auth/drive` scope is added, and that test users are added if it's still in Testing mode.
3. **APIs & Services → Credentials** → open your existing Web application client, copy the **Client Secret**.
4. Leave the tab open — you'll add a redirect URI here in step 5.

### 2. Deploy to Cloudflare Pages
1. Free Cloudflare account if you don't have one.
2. **Workers & Pages → Create → Pages → Upload assets** (or connect a git repo containing this folder — either works).
3. Upload this whole folder (`index.html` and `functions/`) — Cloudflare Pages automatically turns `functions/api/*.js` into live endpoints on your Pages domain.
4. You'll get a domain like `https://receipt-capturer.pages.dev` (or attach a custom domain under **Custom domains**).

### 3. Create the KV namespace (stores refresh tokens)
1. **Workers & Pages → KV → Create namespace** — name it anything, e.g. `receipt-auth`.
2. Pages project → **Settings → Functions → KV namespace bindings** → add:
   - Variable name: `AUTH_KV`
   - KV namespace: the one you just created

### 4. Add environment variables
Pages project → **Settings → Environment variables**, add (mark as **Encrypted/secret** where offered):
- `GOOGLE_CLIENT_ID` — your existing Client ID
- `GOOGLE_CLIENT_SECRET` — the secret you copied in step 1

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
