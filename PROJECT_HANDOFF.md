# Jaro Education Web Pages Command Center — Project Handoff

## What this is

A single-file HTML/CSS/JS dashboard ("Jaro Education Web Pages Command Center") for tracking and managing jaroeducation.com web page requests, backed by Google Sheets, plus a companion Google Apps Script backend that handles authentication and email. Two files make up the whole system:

- **`Unified Dashboard.txt`** (deployed to the live site as `index.html`) — the entire front-end. One HTML file with inline `<style>` and `<script>`. Hosted on Vercel at `https://jaro-projects.vercel.app`.
- **`Code.gs`** — the Apps Script backend, deployed as a Web App at a **domain-restricted URL** (`https://script.google.com/a/macros/jaro.in/s/AKfycbwEgl09bxJyEKHDchtgIZMYxeYzOiMmutPJngx-sq-iDAi9obgE4AiLbpf17feN2HocDA/exec`, access level "Anyone within Jaro Institute of Technology, Management & Research" — this restriction is intentional, all users are jaro.in Workspace accounts). Backs a full login/OTP/session system, and sends all real emails (requests raised, status updates) via Gmail so end users never see a Google OAuth consent prompt themselves.

**⚠️ Where to actually find/edit this script:** the Apps Script project is opened from the **"Jaro Dashboard — Requirements & Insights"** spreadsheet (Extensions → Apps Script) — **not** "Web Pages<>JARO". Confirmed by `Code.gs`'s own `SPREADSHEET_ID` constant, which equals `CONFIG.sheets.requirementsLog.sheetId` in the dashboard file (`1JGsWhpTOalVOPoO0CwlAaCCgPMVv0ExSYTxrRErCVV0`) — a different spreadsheet from `programPages`/`landingPages`/etc. (those live in "Web Pages<>JARO", sheetId `1eSY2RSo5QoT1kmUniA2_xISxwejX7veHyuAEMvASKSI`). Any instruction to "open the Apps Script editor" (to run `authorizeGmailAccess`, redeploy, etc.) means opening it from **Jaro Dashboard — Requirements & Insights**.

**Deployment/version control (as of 2026-08-19):** the front-end lives in a private GitHub repo, `lalitrade-jaro/website-requirement-dashboard`, which Vercel deploys automatically on every push to `main` (git-based CD — no more manual paste into the Vercel dashboard). `Code.gs` is *not* deployed from this repo — Apps Script only runs code pasted directly into its own editor, so `Code.gs` is committed here purely as a version-controlled backup/history; **any change to `Code.gs` still has to be manually copied into the Apps Script editor and redeployed (Deploy → Manage deployments → New version) before it takes effect.** (Google's `clasp` CLI can automate that copy step if it's ever worth setting up — not done yet.)

Both files should be attached/pasted into whatever new environment continues this work — this document is context, not a replacement for the actual source.

## ⚠️ Critical security constraint — do not violate this

The user (Lalit, lalit.rade@jaro.in) shared a real plaintext password ("Luds_1707") for the Admin seed account in chat once, early in this project. That password:

- Exists **only** inside the one-time `setupAdmin()` function in **`Code.gs`** (server-side only), with an explicit in-code comment warning it was exposed in plaintext chat and should be changed after first login.
- Must **never** be hardcoded anywhere in the client-visible dashboard file, and never appear in any other file, log, or output.
- All passwords are stored server-side only as salted SHA-256 hashes (`hashPassword_(password, salt)` via `Utilities.computeDigest`) — never in plaintext, never client-side.

Any future work must preserve this. Do not print, log, or move this password anywhere else.

## Architecture essentials a new session needs to know

**Transport is JSONP, not fetch(), and this was hard-won — don't "simplify" it back to fetch.** The dashboard's domain-restricted Apps Script deployment cannot be called with `fetch()` (even `credentials:"include"` fails — Google's auth redirect breaks it), and a hidden iframe+form POST doesn't reliably carry the Google session cookie cross-site (`SameSite=Lax` withholds cookies on POST navigations, though it allows them on GET). The one transport proven to work end-to-end is a `<script src="...">` tag (classic JSONP): GET navigations do carry the cookie, and CORS/CSP don't apply to script tags. This lives in `authApiCall_()` / `authApiCallOnce_()` in the dashboard file, and every backend action (login, OTP, submit request, update status, list users, etc.) goes through it.

**Idempotency matters — retries are live and must stay safe.** `authApiCall_()` auto-retries once (silently) on a transient failure, because the JSONP script tag occasionally fails to load even when the server-side call actually succeeded (confirmed: OTP emails have arrived even when the browser reported "couldn't reach the login service"). This used to cause duplicate status-update emails on retry until it was fixed: every call now carries an `idemKey` that stays identical across a call and its retry, and `Code.gs`'s `dispatch_()` caches the first execution's result under that key (via `CacheService`, 5 min TTL) so a retry replays the cached result instead of re-running side effects. **If you touch `dispatch_()` or `authApiCall_()`, preserve this idempotency wrapping** — removing it reintroduces duplicate-email risk.

**Gmail sending requires two one-time manual authorizations in the Apps Script project**, already done as of this handoff:
1. `authorizeGmailAccess()` was run once in the Apps Script editor to grant Gmail scopes (`appsscript.json`'s `oauthScopes` includes `https://mail.google.com/` — a broad scope was needed because `GmailApp.createDraft/.send()` requires more than just `gmail.send`).
2. The **Gmail API advanced service** was just added via Services (+) in the Apps Script editor (confirmed by the user, identifier "Gmail") — this is required for the status-update threaded-reply code (see below), which uses `Gmail.Users.Messages.send()` directly rather than `GmailApp`.

**Status-update threading — root cause found and fixed (2026-08-19), pending live re-verification.** `GmailApp`'s own `reply()`/`replyAll()` proved unreliable here — testing showed status-update emails were landing as brand-new threads (confirmed via "Show Original" — no `In-Reply-To`/`References` headers at all), and `GmailApp` also has no way to let the Admin customize To/Cc on a reply. The fix moved to building a raw MIME message by hand and sending it via the Gmail Advanced API (`Gmail.Users.Messages.send()`) with an explicit `threadId` and `In-Reply-To`/`References` headers — but the user then reported it was *still* creating a new email every time instead of replying in-thread. Root cause: Gmail's API only honors `threadId`/`In-Reply-To`/`References` for real threading if the `Subject` header is an **exact** match to the original thread's subject (aside from stripping a leading "Re:"). The original "New Request Raised" email was sent via `GmailApp.createDraft().send()`, which encodes its Subject header internally with no visibility into exactly how; the reply's Subject was re-encoded independently by this file's own `mimeEncodeHeaderValue_` (needed because auto-built subjects contain a non-ASCII em dash "—"). Any byte-level divergence between those two independent encodings was enough for Gmail to treat the reply's Subject as non-matching and silently start a new thread — no error, `ok:true` came back regardless, which is exactly why it looked "fixed" but wasn't.

The fix: **one single function, `sendGmailMessage_()`** (renamed from `sendThreadedGmailReply_`, in `Code.gs`), now sends *both* the original request email and every status-update reply — `threadId`/`inReplyTo`/`references` are simply omitted for the original send. Because one function authors both Subject headers with the same encoding call, they're guaranteed byte-identical (as `"<exact original subject>"` vs `"Re: <exact original subject>"`), so Gmail's exact-match requirement is always satisfied. `handleSubmitRequest_` no longer touches `GmailApp` at all for sending. `getOriginalThreadingHeaders_` and `mimeEncodeHeaderValue_` are unchanged. Google Cloud Logging/Apps Script Executions has proven unreliable for this user (showing "No logs available" for completed executions), so diagnostics stay in the JSON response (`{ok:true, debug: "..."}`), surfaced directly in a toast after a status update — that debug line already compares the intended `threadId` to the `sentThreadId` Gmail actually used, which is the fastest way to confirm threading is genuinely working now. **Next step: redeploy, submit one fresh test request (rows created before this fix don't retroactively benefit), change its status, and confirm in Gmail it lands in the same thread.**

## Full feature list delivered so far (all in current file state, some pending final verification)

- Login + 6-digit email OTP, 12-hour session (`localStorage` key `jaroDash_authSession_v1`), Admin vs Support roles with `applyRoleGating_()`, "View as Support" toggle for real Admins, logout.
- Users nav: list, count, empty state, "Regenerate Password" per Support user.
- Request form ("Raise a Request"): rich text description (bold/italic/link/pasted or attached screenshots), Related Section/University/Program Name auto-locked when raised contextually from Program Pages, editable Send To/CC via chip pickers (Send To fixed by section + free CC), subject auto-suggest/history matching, double-submit guard with loading spinner state, oversized-pasted-screenshot stripping for the JSONP URL-length ceiling.
- Requirements Log: reads via the Apps Script backend (no separate Google OAuth prompt), status dropdown per row now opens a modal (not an instant change) letting the Admin add a rich-text note (links/images) and edit To/CC before sending — see threading caveat above.
- Status-update email: mirrors the full context table from the original "New Request Raised" email (University/Program/Section/Request Type/Priority/Related Link/Description), plus the optional note, in Verdana font like every other email in the system.
- OTP email: Verdana font, subject "Jaro Dashboard - One Time Password", 2 minute 30 second expiry (`OTP_TTL_MINUTES = 2.5`).
- Sidebar layout: Support View toggle, Raise a Request (red CTA), then a secondary row with the Admin identity pill and Log Out styled identically (both white/bordered).
- Core Web Vitals / Page Insights / SEO Insights nav items no longer password-gated for Admins.

## Known rough edges / things to watch

- `authApiCallLarge_()` (an abandoned POST+hidden-iframe+poll transport, plus its backend counterpart `handleCheckResult_`/`PendingResults` sheet in `Code.gs`) is dead code left in place intentionally to minimize edit risk — safe to remove in a future cleanup but not currently wired to anything.
- Apps Script cold starts can add a few seconds of latency to any call; the dashboard shows a "Still working — this can take a few extra seconds…" toast after 7s on a call's final attempt rather than looking frozen.
- The user has been testing primarily in Chrome DevTools with Console/Network tabs; when asking them to debug, request specific things (Network tab status code on the `script.google.com/.../exec` request, or now — preferably — the debug toast text) rather than generic "check the console," since generic asks have repeatedly returned noise (browser extension logs, no real signal).
- The user's tone has been frustrated at points in this project (duplicate emails, repeated redeploy misses) — they are a legitimate stakeholder debugging a real production tool for their team, not being unreasonable; prior fixes that seemed complete were sometimes undermined by a genuine regression (e.g., the retry-duplicate-email bug was a real bug this assistant introduced, not user error). Take reported bugs seriously and verify before assuming user error (e.g. "did you redeploy?").

## Login system — reviewed 2026-08-19, no changes made

Core design holds up: email+password → 6-digit email OTP → 12-hour session token, salted-SHA-256 password hashes (never plaintext, never client-side), and Admin/Support role checks enforced **server-side** (`requireAdmin_`/`requireSession_` in `Code.gs`) in addition to the client-side nav hiding (`applyRoleGating_`) — so a Support user can't just inspect/bypass the front-end to reach Admin-only actions. Gaps noted but intentionally **not** fixed this round (reviewed for awareness only, per the user):
- No lockout/rate-limit on repeated wrong-password or wrong-OTP attempts in `handleLogin_`/`verifyOtp_`.
- The session's expiry is only checked client-side (`localStorage`, on page load) — a session revoked server-side (e.g. an Admin's "Regenerate Password" on someone) isn't detected client-side until the next API call fails with an error; the backend itself is unaffected (still correctly rejects it).
- The plaintext seed password in `setupAdmin()` (see the security constraint above) is now unnecessary dead weight since the Admin account already exists — could be blanked out, but left as-is since the repo is private and no changes were requested here.

## Program Pages ↔ Landing Pages — how they actually relate (informational, 2026-08-19)

They are **not** linked/joined in any backend sense. `CONFIG.sheets.programPages` lives in the "Web Pages<>JARO" spreadsheet; `CONFIG.sheets.landingPages`/`landingPagesChannel` live in a completely separate "Landing Pages Tracker" spreadsheet — different spreadsheet IDs, no shared key. They're grouped/searched the same way in the UI (`renderGroupedSection` / `renderLandingTabs`) only because both sheets happen to use the same column names, "University/Institute" and "Program Name" — a naming convention, not an enforced relationship. The one genuine cross-referencing feature in the dashboard, the "Website URL Form Mappings" tab (`CONFIG.sheets.urlMappings`, matched by exact URL via `loadUrlMappings_`/`urlMappingFor_` to overlay "University Mapped"/"Product Mapped" badges), explicitly covers only Program/University/Free Course/Pillar Pages — `categoryBucketFor_` has no bucket for Landing Pages at all.

## Google Sheets connected — full data flow (documented 2026-08-19)

Three separate Google Spreadsheet **files**, 18 tabs total.

**1. "Web Pages<>JARO"** (`1eSY2RSo5QoT1kmUniA2_xISxwejX7veHyuAEMvASKSI`) — 11 tabs: `programPages`, `b2bPages`, `locationPages`, `blogPages`, `universityPages`, `freeCoursePages`, `pillarPages`, `uniquePages`, `newsItems`, `awardsItems`, `urlMappings` ("Website URL Form Mappings"). **Flow:** read-only, straight from the browser — no Apps Script involved. Uses the Sheets API v4 directly if `CONFIG.googleApiKey` works (ignores filters), else falls back to the public gviz/CSV export (respects filters). The dashboard never writes to any of these; the team maintains them manually. `urlMappings` is the one cross-referencing layer that exists (matches by exact URL to overlay "University Mapped"/"Product Mapped" badges and feed the Home page's "URL Mapping Coverage" insight) — covers Program/University/Free Course/Pillar Pages only, not Landing Pages.

**2. "Landing Pages Tracker"** (`1nIZ_qZmugMslTFxS2QosDYNZzjNzoYKPNxxApQsBkiA`) — 2 tabs: `landingPages` (Domain Tracker), `landingPagesChannel` (Channel PR). Same read-only browser-direct flow as above.

**3. "Jaro Dashboard — Requirements & Insights"** (`1JGsWhpTOalVOPoO0CwlAaCCgPMVv0ExSYTxrRErCVV0`) — 5 tabs, entirely owned by `Code.gs` (this is the only spreadsheet the backend writes to; the front-end never touches it via the Sheets API — always through session-authenticated Apps Script actions):
  - **Requirements Log** — written by `handleSubmitRequest_` (new row per request) / `handleUpdateStatus_` (status changes); read by `handleListRequirements_`.
  - **Dashboard Users** — Email/Role/PasswordHash/Salt/Status/CreatedAt/LastLogin; written by `handleAddUser_`/`handleSetPassword_`/`handleResetUserPassword_`/`setupAdmin()`; read by `handleLogin_`/`handleListUsers_`.
  - **Sessions** — Token/Email/Role/Name/ExpiresAt; written by `handleVerifyOtp_`/`handleSetPassword_` (create) and `handleLogout_`/`handleResetUserPassword_` (delete); read by `requireSession_`/`requireAdmin_`.
  - **OTPs** — written by `issueOtp_`, read by `verifyOtp_`.
  - **PendingResults** — dead code, belongs to the unused `authApiCallLarge_` transport (see "Known rough edges").

Not backed by any sheet: Page Insights and SEO Insights pull live from GA4/Search Console via the visitor's own Google sign-in.

## Immediate next action — Gmail permission error mid-diagnosis (started 2026-08-19)

After the threading fix above, submitting a new request started failing with "Gmail access hasn't been authorized for this script yet." The user has already: run `authorizeGmailAccess()` successfully, redeployed a **new version of the same deployment** (URL confirmed matching `CONFIG.authApiUrl` exactly — ruled out a stale/different deployment), and shared the `appsscript.json` manifest, which looks correct (`https://mail.google.com/` scope present, Gmail Advanced Service correctly enabled as `gmail` v1) — so the obvious causes are ruled out.

Current step: `friendlyGmailError_` in `Code.gs` has been temporarily changed to append the **raw** underlying Google error text in `[raw: ...]` at the end of the friendly message, instead of hiding it — waiting on the user to paste this version in, redeploy, retest, and report back that bracketed raw text so the exact missing permission can be identified instead of guessed at. **Once root-caused and fixed, remove this temporary `[raw: ...]` diagnostic append** (marked with a comment in the code) so end users don't see raw Google error text again.
