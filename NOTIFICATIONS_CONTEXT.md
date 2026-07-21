# SnapSnag — Notifications Work: Context File

Covers everything done across this conversation. Project: **SnapSnag** (construction
snag tracker). Supabase project: **Snapy** (`ychataqdegycjdsgicxx`, region eu-west-1).

---

## Timeline of decisions

1. You asked about a dead "SMS" settings button. Investigation found: there was
   **no SMS button or Twilio code at all** — the actual dead switch was "Push Alerts,"
   which saved to a DB column nothing ever read.
2. First pass: I built full **Twilio SMS** support (Critical-priority snags only),
   including a live migration + edge function deploy against your real Supabase project.
3. You said Twilio is too expensive. **Twilio/SMS work was fully reverted** (migration
   dropped, edge function code removed) in favor of:
   - **Web Push** (free, no third-party account) for all priorities, to both the
     assigned subcontractor and the manager
   - **WhatsApp as a fallback** if a push notification isn't interacted with within
     30 minutes (deferred — see "Not built" below)
4. Final scope confirmed: push fires for **every snag priority**, notifies **both**
   the assigned subcontractor (on snag creation) and the manager (on any status
   change to their snags). WhatsApp fallback is **on hold** until you set up a Meta
   Business account.

---

## What's actually live right now (verified against your Supabase project)

### Database (all applied via migration tool directly to `ychataqdegycjdsgicxx`)

- **`push_subscriptions`** table — one row per subcontractor device.
  Columns: `id, subcontractor_id, endpoint, p256dh, auth, created_at`.
  RLS: subcontractors manage their own rows, matched via
  `subcontractor_id IN (SELECT id FROM subcontractors WHERE email = auth.email())`
  — this mirrors the existing `subs_select` policy pattern already in your schema.

- **`manager_push_subscriptions`** table — one row per manager device.
  Columns: `id, user_id, endpoint, p256dh, auth, created_at`.
  RLS: `auth.uid() = user_id` (managers have direct auth, unlike subcontractors).

- **Trigger `"notify-status-change"`** on `public.snags`, `AFTER UPDATE`,
  condition `OLD.status IS DISTINCT FROM NEW.status` (same condition your existing
  `log_snag_activity()` function already uses for its "status_changed" audit rows,
  so this fires on exactly the events already visible in `snag_activity`).
  Calls the new `notify-status-change` edge function via
  `supabase_functions.http_request`, the same trigger helper your existing
  `notify-subcontractor` / `send-reminders` triggers use on this table.

- **Reverted:** `company_settings.sms_notifications` column was added then dropped.
  No SMS-related schema remains.

### Edge functions (deployed to project `ychataqdegycjdsgicxx`)

- **`notify-subcontractor`** (v5) — existing email-on-assignment function,
  now also sends a Web Push notification after the email succeeds. Gated on
  `company_settings.push_notifications` (the pre-existing toggle) being true, and
  fires for **every priority level**, not just Critical (there is no
  priority-based push logic remaining — that was specific to the abandoned
  SMS plan). Push failures never block the email send. Expired/invalid
  subscriptions (HTTP 404/410 from the push service) are auto-deleted.

- **`notify-status-change`** (v1, new) — fires on the new DB trigger above.
  Sends a push to every device the *manager* (snag's `user_id`) has subscribed,
  titled like `Snag updated: Open -> In Progress`, body `{category} at {location}`.
  Same best-effort/cleanup behavior as above.

### Frontend code (in the zip, needs deploying to Vercel)

- `public/manifest.json` — PWA manifest (name, icons, theme colors).
- `public/sw.js` — service worker: receives `push` events, shows the
  notification, and on click focuses/opens the relevant snag page.
- `public/icon-192.png`, `public/icon-512.png` — **placeholder** generated
  icons (orange camera glyph). Swap for real branding whenever you have one.
- `src/main.tsx` — registers the service worker on load.
- `index.html` — links the manifest + icons.
- `src/hooks/usePushSubscription.ts` — reusable hook that handles requesting
  Notification permission, subscribing via the browser's PushManager, and
  saving the subscription row. Works for both subcontractors
  (`push_subscriptions` table) and managers (`manager_push_subscriptions`
  table) via a `target` parameter.
- `src/components/SubcontractorShell.tsx` — shows an "Enable notifications"
  banner to subcontractors when not yet subscribed (hidden if unsupported,
  already subscribed, or the browser permission was explicitly denied).
- `src/components/AppShell.tsx` — same banner, manager-facing copy, shown to
  managers in the main app shell.
- `src/locales/en.json` / `de.json` — added a `push` namespace with the
  banner strings in both languages.
- `src/integrations/supabase/types.ts` — added types for both new tables.

---

## Required manual steps (not automatable from here)

1. **Set two secrets** in Supabase (Project Settings -> Edge Functions ->
   Secrets), used by both `notify-subcontractor` and `notify-status-change`:
   ```
   VAPID_PUBLIC_KEY=BGYVJOrjiZenkFaLCKcM8xuzViWcZeoTcL_OKqw6nzOL5oxRnIH2OXqzf2D7Pu2U6ynyRTrn1C3PRal9v_BxwsI
   VAPID_PRIVATE_KEY=olJsEMLeJfdlXh0cF1LoQwPr33QaRvqsR91uP5qx590
   ```
   These are free, self-generated VAPID keys — no third-party account needed.
   The public key is also hardcoded client-side in `usePushSubscription.ts`
   (safe — that's the point of a public/private key pair). If you ever
   rotate these, update both places.

2. **Deploy the frontend zip to Vercel.** The edge functions and migrations
   are already live on Supabase; only the frontend needs shipping.

3. **iOS caveat to tell your subcontractors:** push only works on iPhone if
   the site is added to the home screen first (Share -> Add to Home Screen).
   Regular Safari tabs cannot receive push on iOS.

---

## Known rough edges / things worth revisiting

- **The DB trigger has a service-role JWT literal embedded directly in its
  definition.** This isn't something I introduced — your existing
  `notify-subcontractor` and `send-reminders` triggers already do this, and
  I matched the pattern for consistency (Postgres trigger arguments must be
  static literals, so a Vault-lookup subquery isn't possible here). Worth
  knowing this key is visible to anyone who can read `pg_trigger` in your
  database; it's low risk since it requires already having DB access, but
  flagging it since it's not something typically expected to be sitting in
  a table definition.
- **Push has no true read receipt.** The only signal available is whether
  the person clicked the notification, not whether their phone displayed it.
  This matters for the WhatsApp fallback below.
- **Placeholder app icon.** Swap `public/icon-192.png` / `icon-512.png` for
  real branding when ready.
- **No offline caching in the service worker**, by design — it exists only
  to receive push and handle install-ability, not to cache pages. Adding
  offline support later is a separate, deliberate decision (stale cached
  snag data would be worse than no offline support).

---

## Not built yet: WhatsApp fallback (30 min unread -> WhatsApp)

Deliberately deferred at your request until you set up a Meta Business
account. Scoping notes for when you're ready:

- "Unread after 30 min" can only realistically mean **"not clicked within
  30 minutes"** — there's no browser API for true read receipts on web push.
- Needs, in order:
  1. A `push_notification_log` table (snag id, recipient id, sent_at,
     clicked_at) — populated by the edge functions above, stamped by the
     service worker's `notificationclick` handler pinging a small new
     endpoint.
  2. A cron job (same mechanism as your existing `send-reminders`) running
     every ~5 minutes, finding sends older than 30 minutes with
     `clicked_at IS NULL` and no WhatsApp sent yet.
  3. A WhatsApp send via **Meta's Cloud API** — needs a Meta Business
     account, a WhatsApp Business phone number, and a **pre-approved
     message template** (Meta requires an approved template for the first
     business-initiated message in a 24-hour window; approval can take
     anywhere from minutes to a couple of days).
  4. Access token + Phone Number ID stored as edge function secrets, same
     pattern as `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` above.
- Nothing here can be tested end-to-end until the Meta template is approved,
  which is why this was put on hold rather than half-built.

When you're ready, come back with "I've got the Meta Business account set
up" and this can be picked up from step 1.
