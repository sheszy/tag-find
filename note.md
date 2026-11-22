# Locatelly — project journey and setup note

This is the project handoff for how Locatelly started, what is in place, and the next steps for Supabase, Vercel, Chrome installation, and Android.

## How the app started

Locatelly began as **Tag & Find**, a lost-and-found app concept for item owners and finders. The project was rebranded and expanded into a mobile-first Next.js app with a shared browser, Android, and desktop experience.

The main UI is `public/Locatelly-prototype.html`. The Next.js route in `app/page.tsx` displays that UI inside `app/prototype-frame.tsx`; API routes under `app/api` provide server-side account, QR report, handoff, chat, and push features. Since those API routes need a Next.js server, this project must **not** use `output: "export"` for its normal deployment.

The app can run in local guest/demo mode without Supabase. Browser-local items and preferences stay on that device. Cross-device QR reports, account-backed coins and cosmetics, verified handoffs, and nearby push alerts need the configured cloud services described below.

## What is already in place

- Locatelly branding and a responsive, pixel-inspired UI.
- Guest/demo flows, QR tags, finder reports, and browser-local settings.
- Optional Supabase-backed accounts, claim chat, handoff verification, return rewards, and cosmetics.
- Three ordered Supabase migrations (see below).
- A web app manifest and Locatelly install icons. Settings now includes a Chrome install control; it uses Chrome's install prompt when available and explains the browser-menu fallback.
- Capacitor Android support. Android wrappers load the deployed Next.js site; they do not bundle the dynamic Next.js server.

Chrome's install button needs the app to be opened from a secure HTTPS deployment on the phone. A private-LAN `http://192.168...` URL is for temporary Android WebView testing, not Chrome PWA installation or production.

## Supabase setup

1. Create a Supabase project and open **SQL Editor**.
2. Run these files in timestamp order, one at a time:
   1. `supabase/migrations/20261105000000_cross_device_reports.sql`
   2. `supabase/migrations/20261106000000_recovery_partners_push.sql`
   3. `supabase/migrations/20261107000000_locatelly_accounts_rewards_cosmetics.sql`
3. In **Project Settings → API**, copy the project URL, anon/publishable key, and service-role/secret key.
4. In **Authentication → Providers**, enable email/password sign-up. Set the Supabase **Site URL** to the eventual HTTPS app domain and add the Vercel production and preview URLs to the allowed redirect URLs if email confirmation is enabled.
5. Test sign-up, create a new cloud-backed QR item, submit a finder report from a second device, verify a return, and confirm the signed-in finder receives 100 coins. Existing browser-only demo items do not automatically become cloud items; register them again after Supabase is configured.

### Google sign-in provider

1. Create a **Web application** OAuth client in Google Cloud Console.
2. Add the Locatelly HTTPS origin (and `http://localhost:3000` only for local testing) to the Google OAuth client's **Authorized JavaScript origins**.
3. In **Supabase → Authentication → Providers → Google**, enable the provider and copy its displayed callback URL (usually `https://<project-ref>.supabase.co/auth/v1/callback`).
4. Add that exact URL to the Google OAuth client's **Authorized redirect URIs**, then enter the Google client ID and secret in the Supabase Google provider settings. Keep the Google secret in Supabase; it is not a Vercel or browser variable.
5. In **Supabase → Authentication → URL Configuration**, set the Site URL to the Locatelly HTTPS domain and add `https://<your-app-domain>/auth/callback` to the allowed redirect URLs. Add `http://localhost:3000/auth/callback` only for local development.
6. The welcome screen and Settings offer **Continue with Google**. The app uses PKCE and returns through `/auth/callback`; test that route on the deployed HTTPS origin.

The account and cloud APIs require these server-side environment variables:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL, such as `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon key (the code also accepts `SUPABASE_PUBLISHABLE_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (the code also accepts `SUPABASE_SECRET_KEY`) |

Set `NEXT_PUBLIC_APP_URL` to the canonical app origin (`http://localhost:3000` locally or the exact HTTPS Vercel origin). This is a public URL used to validate the Google OAuth callback origin.

Never put the service-role key in a `NEXT_PUBLIC_` variable, source code, or a committed file. Keep `.env.local` private; use `.env.example` only as a list of variable names and placeholders.

### Optional nearby push notifications

Push alerts are optional. Generate a VAPID pair with `npx web-push generate-vapid-keys`, then configure:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Generated public VAPID key |
| `VAPID_PRIVATE_KEY` | Generated private VAPID key; server-only |
| `VAPID_SUBJECT` | Contact such as `mailto:admin@example.com` |

Push requires the migration above, HTTPS, browser notification/location permission, and those VAPID values. Never expose the private key to the browser.

## Vercel HTTPS test deployment

There is no Vercel project link or Vercel CLI configured in this workspace yet. To get the HTTPS URL needed for Chrome installation:

1. Sign in to Vercel and import the GitHub repository `sheszy/tag-find`.
2. Keep the project root at the repository root. Let Vercel detect **Next.js**; use `npm install` and `npm run build` if it asks for install/build commands. Do not select static export.
3. In **Project Settings → Environment Variables**, add the three required Supabase variables above and set `NEXT_PUBLIC_APP_URL` to the canonical deployment origin. Select **Preview** for a test deployment and **Production** when ready to launch. Add the three VAPID variables only if testing nearby push.
4. Deploy a Preview build. Vercel will provide an HTTPS URL; add that URL to Supabase Auth's allowed redirect URLs. Keep all Supabase secret values in Vercel's server environment, not in client-prefixed variables.
5. Open that HTTPS URL in Chrome on Android, go to **Settings → Install Locatelly**, then tap the install button. If Chrome does not present the prompt, use Chrome's **⋮ → Install app** or **Add to Home screen** menu. The installed shortcut can be removed from Android at any time.

The in-app install control is implemented, but no public deployment has been created from this workspace because no Vercel project/authentication is linked. A deployed HTTPS URL is still needed before the button can install the app on a phone.

## Local development and Android

For browser development, run `npm install`, then `npm run dev`, and open `http://localhost:3000`.

To build an Android wrapper that loads a deployed Vercel site, set the URL in the same PowerShell session before running the build:

```powershell
$env:LOCATELLY_URL = "https://<your-vercel-domain>"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
npm run mobile:android:apk
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. `LOCATELLY_URL` is read by the Capacitor build process from the shell environment; setting it only in `.env.local` is not sufficient. For temporary Android WebView testing on the same Wi-Fi, a private LAN URL may be used with `LOCATELLY_ALLOW_HTTP=1`, but it is not suitable for Chrome's HTTPS install flow or a production build.

## Suggested validation journey

1. Apply the migrations and configure Supabase Auth.
2. Deploy a Vercel Preview with the required Supabase server variables.
3. Verify account registration, a new QR item, cross-device finder report/chat, handoff verification, return-message cleanup, coins, and cosmetic purchases.
4. Test the Chrome install button and remove the temporary installed app when finished.
5. If push is configured, test opt-in/opt-out and a nearby alert with VAPID keys.
6. Only after the Preview checks are good, promote/deploy Production and build any wrapper against that HTTPS URL.

For implementation details and the current product limitations, see `README.md`.
