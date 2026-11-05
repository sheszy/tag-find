# Tag & Find

Tag & Find is a mobile-first lost-and-found prototype for item owners and finders. The original standalone UI has been restored at `public/tag-find-prototype.html` and is served through the Next.js app so desktop and mobile wrappers can share it.

## Run locally

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://localhost:3000`.

The welcome screen offers guest mode. Items, photos, and settings are stored in this browser. Supabase is optional and enables cloud-backed QR reports for newly registered items. Without the Supabase setup below, the app continues to work locally and QR tags are limited to this browser.

## Enable cross-phone QR reports with Supabase

1. Create a Supabase project and open its SQL Editor.
2. Run [`supabase/migrations/20261105000000_cross_device_reports.sql`](./supabase/migrations/20261105000000_cross_device_reports.sql), then [`supabase/migrations/20261106000000_recovery_partners_push.sql`](./supabase/migrations/20261106000000_recovery_partners_push.sql).
3. In the Supabase project API settings, copy the project URL and the `service_role` secret key.
4. Add these server-only variables to `.env.local` (never use a `NEXT_PUBLIC_` prefix):

   ```dotenv
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret
   ```

5. Restart the Next.js server. Register a new item to create a cloud-backed QR tag; items already in local storage need to be registered again to receive one.

The service-role key is used only by Next.js API routes and must never be exposed to the browser or committed. Public QR pages expose the item name, category, owner display name, message, and reward; owner contact details are returned only while the item is marked lost. Finder reports are anonymous. GPS coordinates are optional and are sent to Supabase only when a finder explicitly attaches a location. Item photos remain on the owner device and are not uploaded.

## Recovery and community features

- Finder instructions can be switched between English, Spanish, Simplified Chinese, Japanese, and Korean. The language defaults from the browser and can be changed on the finder page or with `?lang=es` (also `zh`, `ja`, or `ko`).
- Finder photo suggestions use simple on-device color and filename/name clues against lost items saved in that same browser. This is not an AI model and cannot search other owners' private reports.
- Partner Desk records can track an item's description, checkpoint, and pickup status. They are currently stored only in the current browser; the app has no user accounts or organization access controls, so this is not yet a shared institutional portal.
- Cloud-backed item returns require a one-time 4-digit handoff code. The owner generates it from the lost-item card, shares it directly with the finder, and the finder enters it on the QR page. Codes expire after 30 minutes, allow at most five attempts, and are one-use. Successful and failed verification attempts are appended to the handoff audit table; a cloud item cannot be marked returned without a successful code. Local/demo items do not have secure handoff verification.
- Nearby web push is opt-in. Users enable it in Settings, grant browser notification and location permission, and store their location rounded to about 1 km. When an owner marks a cloud-backed item lost, the app may share the owner's approximate location (rounded to about 1 km) after a separate confirmation; opted-in subscriptions within about 10 km are notified. HTTPS, a configured Supabase project, and VAPID keys are required. The server stores push endpoints and coarse subscriber locations until a user turns alerts off or a push provider expires the subscription.

To configure push, copy `.env.example` to `.env.local`, set the Supabase values, and generate VAPID keys with `npx web-push generate-vapid-keys`. Set the public key as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the private key as server-only `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` to a `mailto:` contact or HTTPS URL. Never commit `.env.local` or expose the private key. Apply the migration above before enabling subscriptions or handoff verification.

The owner dashboard polls for new reports while open (about every 30 seconds). Public tag creation is limited to five per IP per hour, and finder reports to ten per IP per hour. Reports are not live chat. Reports remain in Supabase until the owner deletes the item. Handoff audit rows are append-only through the app and retained independently of item deletion. Guest owners' cloud access token is stored in that browser's local storage; clearing browser data can remove their access. Configure a deployed HTTPS app and Supabase project before printing QR tags for use on other phones.

## Restored and updated prototype features

- Item registration, QR tags, printable sticker sheets and lost flyers, scanner simulation, and an app-less finder preview.
- Finder reports with optional GPS/photo, anonymous finder identity, and a local secure-chat demonstration.
- Manual retrace stops, scan checkpoints, nearby-location helpers, and a camera-direction preview when supported by the device.
- A calm owner focus banner when an item is lost, a five-step recovery tracker, and reduced-motion-aware return celebrations.
- Item photos compressed in the browser to WebP/JPEG, with a 1280px dimension limit and 400 KB per image. The combined owner-photo budget is 2 MB per browser.
- A thumb-friendly finder action bar, 48px minimum controls, native dark-mode styling, and reduced-motion support.
- Light, dark, and system-following appearance modes, saved per browser in Settings.

Google/email sign-in and account-based multi-device item sync are not connected. The QR flow supports cross-phone reports only for new items registered after Supabase is configured; older demo/local items remain local. The welcome screen is honest about guest-only sign-in and does not simulate a successful Google/email sign-in.

## Desktop and mobile wrappers

The Electron and Capacitor scripts load a deployed HTTPS instance of this app.

- Set `TAG_FIND_URL` to a public HTTPS deployment before creating Windows/macOS installers or mobile builds.
- Android builds additionally require Android Studio, its SDK, and Java 21+. `npm run mobile:android:apk` creates a debug APK for device testing.
- macOS and iOS builds require a Mac with Xcode. iOS distribution also requires Apple signing credentials.
- A LAN HTTP URL is permitted only for Android development tests with `TAG_FIND_ALLOW_HTTP=1`.

Do not expose secrets through `NEXT_PUBLIC_*` variables or commit `.env.local`.
