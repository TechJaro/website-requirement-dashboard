# Jaro Education Web Pages Command Center — Project Handoff

## What this is

A single-file HTML/CSS/JS dashboard ("Jaro Education Web Pages Command Center") for tracking and managing jaroeducation.com web page requests, backed by Google Sheets, plus a companion Google Apps Script backend that handles authentication and email. Two files make up the whole system:

- **`Unified Dashboard.txt`** (deployed to the live site as `index.html`) — the entire front-end. One HTML file with inline `<style>` and `<script>`. Hosted on Vercel at `https://jaro-projects.vercel.app`.
- **`Code.gs`** — the Apps Script backend, deployed as a Web App at a **domain-restricted URL** (`https://script.google.com/a/macros/jaro.in/s/AKfycbwEgl09bxJyEKHDchtgIZMYxeYzOiMmutPJngx-sq-iDAi9obgE4AiLbpf17feN2HocDA/exec`, access level "Anyone within Jaro Institute of Technology, Management & Research" — this restriction is intentional, all users are jaro.in Workspace accounts). Backs a full login/OTP/session system, and sends all real emails (requests raised, status updates) via Gmail so end users never see a Google OAuth consent prompt themselves.

**⚠️ Where to actually find/edit this script:** the Apps Script project is opened from the **"Jaro Dashboard — Requirements & Insights"** spreadsheet (Extensions → Apps Script) — **not** "Web Pages<>JARO". Confirmed by `Code.gs`'s own `SPREADSHEET_ID` constant, which equals `CONFIG.sheets.requirementsLog.sheetId` in the dashboard file (`1JGsWhpTOalVOPoO0CwlAaCCgPMVv0ExSYTxrRErCVV0`) — a different spreadsheet from `programPages`/`landingPages`/etc. (those live in "Web Pages<>JARO", sheetId `1eSY2RSo5QoT1kmUniA2_xISxwejX7veHyuAEMvASKSI`). Any instruction to "open the Apps Script editor" (to run `authorizeGmailAccess`, redeploy, etc.) means opening it from **Jaro Dashboard — Requirements & Insights**.

**Deployment/version control (as of 2026-08-19):** the front-end lives in a private GitHub repo, `lalitrade-jaro/website-requirement-dashboard`, which Vercel deploys automatically on every push to `main` (git-based CD — no more manual paste into the Vercel dashboard). The deployed file in that repo is `index.html` — **that is the single source of truth for what's actually live.** `Unified Dashboard.txt` is a local-only editing copy (gitignored, not tracked in the repo at all as of 2026-08-19) that should be kept in sync with `index.html` by copying content over before/after each edit session. `Code.gs` is *not* deployed from this repo either — Apps Script only runs code pasted directly into its own editor, so `Code.gs` is committed here purely as a version-controlled backup/history; **any change to `Code.gs` still has to be manually copied into the Apps Script editor and redeployed (Deploy → Manage deployments → New version) before it takes effect.** (Google's `clasp` CLI can automate that copy step if it's ever worth setting up — not done yet.)

**⚠️ Local project folder location (as of 2026-08-20):** this project's working copy was moved from `C:\Users\user\Downloads\Website Requirement Dashboard` to **`D:\JARO EDUCATION - LALIT\Website Requirement Dashboard`** — verified as a complete, working copy (git history, remote, `.vercel` link, and untracked local files all intact). Point any new Claude Code / editor session at the **D:** path going forward. The old Downloads copy may still exist as a leftover — safe to delete once confirmed the D: copy is the one being used. Unrelated to this: there's also a separate, independent local clone of this same GitHub repo at `D:\JARO EDUCATION - LALIT\Jaro Unified Requirement Dashboard\JARO-PROJECTS` (its `index.html`/`.git` looked like the likely source of the frequent pre-existing "update" commits from before this dashboard's current feature work began) — left untouched, not part of this move.

**⚠️ Incident (2026-08-19): local `Unified Dashboard.txt` was silently corrupted, now fixed.** Early in the repo's history, before this dashboard existed in its current form, a file also named `Unified Dashboard.txt` was committed to the repo as an unrelated, much older/simpler build (no login system, no Users page) — a leftover duplicate, never the file Vercel actually deploys. Running `git checkout main` in the local working directory (done as part of an unrelated `Code.gs` fix) silently overwrote the local `Unified Dashboard.txt` with that stale duplicate, since git treated it as a normal tracked file. **The live site was never affected** — `index.html` was never touched by this. Fixed by restoring the local file from `index.html`'s real content and removing the stale duplicate from git tracking entirely (`git rm --cached`, now gitignored) — so a branch switch can never silently clobber it again. If a future session's local `Unified Dashboard.txt` ever looks suspiciously short or missing features, compare its line count / `grep` for `drawAuthLogin_` against `git show origin/main:index.html` before trusting it.

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

**Status-update threading — root cause found, fixed, and confirmed working live (2026-08-19).** `GmailApp`'s own `reply()`/`replyAll()` proved unreliable here — testing showed status-update emails were landing as brand-new threads (confirmed via "Show Original" — no `In-Reply-To`/`References` headers at all), and `GmailApp` also has no way to let the Admin customize To/Cc on a reply. The fix moved to building a raw MIME message by hand and sending it via the Gmail Advanced API (`Gmail.Users.Messages.send()`) with an explicit `threadId` and `In-Reply-To`/`References` headers — but the user then reported it was *still* creating a new email every time instead of replying in-thread. Root cause: Gmail's API only honors `threadId`/`In-Reply-To`/`References` for real threading if the `Subject` header is an **exact** match to the original thread's subject (aside from stripping a leading "Re:"). The original "New Request Raised" email was sent via `GmailApp.createDraft().send()`, which encodes its Subject header internally with no visibility into exactly how; the reply's Subject was re-encoded independently by this file's own `mimeEncodeHeaderValue_` (needed because auto-built subjects contain a non-ASCII em dash "—"). Any byte-level divergence between those two independent encodings was enough for Gmail to treat the reply's Subject as non-matching and silently start a new thread — no error, `ok:true` came back regardless, which is exactly why it looked "fixed" but wasn't.

The fix: **one single function, `sendGmailMessage_()`** (renamed from `sendThreadedGmailReply_`, in `Code.gs`), now sends *both* the original request email and every status-update reply — `threadId`/`inReplyTo`/`references` are simply omitted for the original send. Because one function authors both Subject headers with the same encoding call, they're guaranteed byte-identical (as `"<exact original subject>"` vs `"Re: <exact original subject>"`), so Gmail's exact-match requirement is always satisfied. `handleSubmitRequest_` no longer touches `GmailApp` at all for sending. `getOriginalThreadingHeaders_` and `mimeEncodeHeaderValue_` are unchanged. Google Cloud Logging/Apps Script Executions has proven unreliable for this user (showing "No logs available" for completed executions), so diagnostics stay in the JSON response (`{ok:true, debug: "..."}`), surfaced directly in a toast after a status update — that debug line already compares the intended `threadId` to the `sentThreadId` Gmail actually used, which is the fastest way to confirm threading is genuinely working now. Confirmed by the user in Gmail: a fresh request + status update landed as one threaded conversation, with `path=gmail-api-threaded` and matching `sentThreadId` in the debug toast.

## Full feature list delivered so far (all in current file state, some pending final verification)

- Login + 6-digit email OTP, 12-hour session (`localStorage` key `jaroDash_authSession_v1`), three-tier roles (Support / Admin / Super Admin — see below) with `applyRoleGating_()`, a view-mode cycle toggle for previewing lower-privilege views, logout.
- Users nav: list, count, empty state; Super Admin only sees "Regenerate Password" and a role-toggle ("Make Admin"/"Make Support") per row, and can add a new user as either role — a regular Admin can only add new Support users and has no password/role controls at all.
- Request form ("Raise a Request"): rich text description (bold/italic/link/pasted or attached screenshots), Related Section/University/Program Name auto-locked when raised contextually from Program Pages, editable Send To/CC via chip pickers (Send To fixed by section + free CC), subject auto-suggest/history matching, double-submit guard with loading spinner state, oversized-pasted-screenshot stripping for the JSONP URL-length ceiling.
- Requirements Log: reads via the Apps Script backend (no separate Google OAuth prompt), status dropdown per row opens a modal (not an instant change) letting the Admin add a rich-text note (links/images) and edit To/CC before sending — threading confirmed working, see above.
- Status-update email: mirrors the full context table from the original "New Request Raised" email (University/Program/Section/Request Type/Priority/Related Link/Description), plus the optional note, in Verdana font like every other email in the system.
- OTP email: Verdana font, subject "Jaro Dashboard - One Time Password", 2 minute 30 second expiry (`OTP_TTL_MINUTES = 2.5`).
- Sidebar layout: view-mode toggle, Raise a Request (red CTA), then a secondary row with the Admin identity pill and Log Out — redesigned 2026-08-19 as translucent "glass" chips matching the dark sidebar (see below), replacing the earlier solid-white cards.
- Page Insights, SEO Insights, Core Web Vitals, and On-Page Audit are four independent nav items under "Insights" (Admin/Super Admin only) — none are password-gated (an earlier per-section password gate was removed per the user's request; access control is just login + role now). On-Page Audit was split out of SEO Insights into its own nav item on 2026-08-19, following the same pattern Core Web Vitals already used for being split out of Page Insights.

## Super Admin role tier (added 2026-08-19)

A third tier above Admin/Support, identified by **email, not a stored Role value** — `Code.gs`'s `SUPER_ADMIN_EMAIL` constant (`lalit.rade@jaro.in`) and `isSuperAdmin_(email)`/`requireSuperAdmin_(token)`. This means it can't be granted or revoked by editing the "Dashboard Users" sheet — only by changing that constant and redeploying. The Dashboard Users sheet still only ever stores "Admin" or "Support" in the Role column; Super Admin is an overlay on top of the one Admin account matching that email.

- **Super Admin only:** `handleResetUserPassword_` (Regenerate Password, works on any account) and the new `handleSetUserRole_` action (promote a Support user to Admin, or demote an Admin back to Support — blocked for the Super Admin's own account). Front-end: these controls only render in the Users table (`loadUsersTable_`) when `isSuperAdminView_()` is true, and never on the viewer's own row.
- **Regular Admin:** can still view the Users list and add a new user via `handleAddUser_` — but the role is force-set to `"Support"` server-side regardless of what the client sends, unless the caller is the Super Admin. The add-user role dropdown only renders client-side for a Super Admin view; a regular Admin's form has no role choice at all.
- **View-mode cycle:** the old two-state "View as Support" toggle (`VIEW_AS_SUPPORT`/`toggleViewAsSupport_`) is now `VIEW_OVERRIDE`/`cycleViewMode_` — a regular Admin still gets the same two states (their own view ↔ Support), while the Super Admin cycles through three (Super Admin → Admin → Support → back). `isSuperAdminReal_()` checks true identity; `isSuperAdminView_()` checks the *currently displayed* view (false while previewing as Admin or Support) — the Users-page Super-Admin-only controls gate on the latter.
- Session responses (`handleVerifyOtp_`, `handleSetPassword_`, `handleCheckSession_`) now include `isSuperAdmin`, stored on `AUTH_SESSION` at login.

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

## Gmail permission error — root cause found, fixed, and confirmed (2026-08-19)

After the threading fix above, submitting a new request started failing with "Gmail access hasn't been authorized for this script yet." Deployment URL, manifest scopes, and the Gmail Advanced Service were all checked and ruled out as the cause. The temporary raw-error diagnostic added to `friendlyGmailError_` (see below) surfaced the real error:

```
Specified permissions are not sufficient to call Session.getEffectiveUser.
Required permissions: https://www.googleapis.com/auth/userinfo.email
```

This was never actually a Gmail-*sending* permission problem — `sendGmailMessage_` only used `Session.getEffectiveUser().getEmail()` to build the "From" header's display address, and that lookup needs a scope (`userinfo.email`) that isn't in the manifest's `oauthScopes`. Rather than add yet another scope (which would mean another authorize + redeploy round trip), the fix removes the dependency entirely: `fromEmail` in `sendGmailMessage_` is now hardcoded to `"lalit.rade@jaro.in"` — the same address already hardcoded elsewhere in this file (`setupAdmin()`, the `handleSubmitRequest_` fallback recipient), since this script only ever runs as that one account anyway.

Confirmed working by the user; the temporary `[raw: ...]` diagnostic in `friendlyGmailError_` has since been removed.

## "What's Trending" — manually curated via a card toggle, not a sheet (added 2026-08-20)

Previously a hardcoded `TRENDING_COURSES` array in the dashboard file that had to be hand-edited (and code-redeployed) every time the list changed. Replaced with a real toggle: every Program Pages card now has a 👑 crown icon (`trendBtn()`, Admin-only, in `renderGroupedSection`) that flips that program in a **new Code.gs-owned sheet, "TrendingPrograms"** (`TRENDING_HEADER`) — explicitly *not* a sheet the user has to maintain by hand, the same way "Dashboard Users"/"Sessions"/"OTPs" are Code.gs-managed and invisible to daily use. New actions: `listTrending` (any logged-in role — Support sees Home too) and `setTrending` (Admin-only). The Home page's "What's Trending" strip (`renderTrendingCourses`) now fetches this list live instead of reading the old hardcoded array; if nothing's marked yet, it shows an empty-state hint (different wording for Admins vs. everyone else) instead of an empty marquee.

- **Matching key:** client computes `"<university>|||<program>"` (lowercased/trimmed, `trendingKeyFor_()`) and sends it as an opaque string — Code.gs just stores/matches by that string, no parsing needed server-side.
- **Toggle UX:** clicking the crown updates just that button + its card's highlight locally (`is-trending` class) and reverts on failure, rather than re-drawing the whole Program Pages section — preserves scroll position and which university cards are expanded.
- **Card highlight:** `.prog-row.is-trending` (yellow tint, matches the crown's active-state color) — CSS lives right next to `.raise-mini-btn`'s block since they're visually paired.

## Auto-collapsing university cards — fixed (2026-08-20)

Program Pages / Landing Pages / Location Pages cards were silently collapsing back to closed a
while after being expanded. Root cause: `init()`'s background auto-refresh (`setInterval`, was
every 60s) calls `navigate(currentRoute)` to keep sheet data fresh, which rebuilds the whole
section's HTML from scratch — "open" was only ever a runtime CSS class on the old DOM node, so a
fresh render always came back closed. Fixed by capturing which `.uni-title` texts were open (and
the scroll position) before the refresh's `navigate()` call, then re-applying `.open` to the
matching cards afterward — titles are stable across a redraw even though the DOM nodes aren't.
Same interval also widened from 60s to 3 minutes as a response-time fix (see below).

## Login error placement — fixed (2026-08-20)

Login-screen errors (incorrect password, missing fields, no account found) now show in a
dedicated `#authPasswordError` div directly under the Password field (`drawAuthLogin_`), instead
of the generic `#authError` at the bottom of the auth card. Clears automatically as soon as the
person edits either field. `#authError` is unchanged and still used by the other auth screens
(OTP, password setup) — this change only touches the login screen.

## Response-time / scaling for ~20-30 concurrent users (2026-08-20)

User is inviting many more people (from ~5 total, ~2 active, to ~20-30) and reports slow loading
across sections. Root cause: every category page (Program/Landing/Blog/etc.) fetches its sheet
directly from the browser via the Sheets API/gviz (`getData`/`loadSheet`), cached only **in that
one browser tab's memory** for `LIVE_CACHE_TTL_MS` — there is no cache shared across users, so N
concurrent people each independently re-fetch the same large sheets (Blogs alone is 2500+ rows)
against the same shared `CONFIG.googleApiKey`, and the 60s background auto-refresh (see above)
multiplied that further. Two tiers of fix:

- **Done now (low-risk tuning, no architecture change):** `LIVE_CACHE_TTL_MS` widened from 5 to
  10 minutes; the background auto-refresh interval widened from 60s to 3 minutes. Cuts a large
  fraction of redundant Sheets API traffic immediately, at the cost of data feeling "live" within
  a slightly larger window (sheet content here doesn't change minute-to-minute anyway).
- **Proposed, not yet built — needs the user's go-ahead:** a shared server-side cache in front of
  the Sheets reads (a small Vercel serverless function proxying + caching each sheet's response
  for ~1-2 minutes, since this repo is already on Vercel) so N concurrent users produce roughly
  ONE real Google Sheets request per cache window instead of N — faster for everyone and far
  safer against Sheets API quota limits as the user base grows. This is a genuine new moving part
  (first serverless code in an otherwise-static site) so it wasn't built without asking first.

Separately, Apps Script (login, requests, Trending, Users) all execute under one shared identity
("Execute as: Me") — Google's simultaneous-execution quota is shared across every concurrent user
hitting it, not per-user. Not urgent at 20-30 users, but worth knowing if slowness concentrates
around login/submit/status-update specifically rather than category browsing.

## Insights not visible to Admins — under investigation, needs more detail from the user (2026-08-20)

User reports Page Insights/SEO Insights/Core Web Vitals/On-Page Audit "not visible" to Admin
users. Checked `applyRoleGating_`/`SUPPORT_HIDDEN_NAV` directly — the nav-item visibility logic
looks correct (`admin = role === "Admin"` correctly shows all four for any Admin, Super Admin
included). Two real candidate causes that don't require a code bug: (1) Page/SEO Insights need
each person's own Google sign-in with GA4/Search Console **view access already granted on those
specific properties** — a newly-invited Admin's Jaro account may not have that access yet, which
would fail silently-ish per-person even though the nav item itself shows fine; (2) general
connectivity/cold-start flakiness already documented elsewhere in this file. Core Web Vitals and
On-Page Audit don't depend on personal Google access at all (PageSpeed API key / Apps Script
relay respectively), so if literally all four are failing identically for someone, that argues
against cause (1) and toward something more fundamial — **next session should ask the user
exactly what "not visible" looks like** (nav item missing vs. blank page vs. an error message vs.
stuck on "Loading…") and whether it's specific to newly-added Admins or affects existing ones too,
before changing any code here.

## Request Type options + email subject fix + [Jaro Dashboard] prefix (2026-08-20)

- Added **"Open Admissions"** / **"Close Admissions"** to the Request Type dropdown (`rf_type`),
  right before "Other".
- **Email subject for every category except Program/Landing Pages** used to be just the bare
  Request Type ("[Dashboard] Content / Meta Change") because `raiseBtn()` calls in
  `renderFlatCards` (University/B2B/Pillar), `renderLocations`, `renderFreeCourses`,
  `renderBlogCards`, and `renderUnique` never passed a `program` field at all — there was no title
  for `buildRequestSubject()` to include. Now each of those passes that card's own title (e.g. the
  blog's `Title`, the location's `Area Name`, the pillar/university/B2B card's `title` var) through
  as `program`. `buildRequestSubject()` now branches: Program/Landing Pages (has `payload.university`)
  keep the original unchanged format; everything else now reads `"<title> - <Request Type>"`
  instead of just the type. Note this still only fires for a request raised from a specific card's
  "+" button — a request raised generically from the sidebar CTA with no card selected still has no
  title to include, which is correct (there genuinely isn't one).
- `[Dashboard]` → **`[Jaro Dashboard]`** in that same subject builder (the only place this literal
  string existed).

## "Requests by Requester" — Home insight for Admins/Super Admin (2026-08-20)

Per the user noticing the dashboard has no way to tell if one person is raising an unusual number
of requests, added a `renderRequesterActivity()` panel to Home ("Request Activity" section, gated
identically to "Live Insights" — `admin`-only via `applyRoleGating_`, toggling the new
`#requestActivityWrap`). Reuses the existing Quick-Insights segmented-bar-plus-legend pattern
(`.status-bar`/`.status-legend`, new `data-req` attribute added to the shared CSS selector lists
alongside `data-type`/`data-status`/etc.) rather than introducing a new charting approach — no new
library, consistent look. Fetches the Requirements Log via the already-existing `listRequirements`
action (no new backend action needed), groups by Email, sorts descending, shows the top 8
individually and folds the rest into one "N others" slice, and — since a disproportionately wide
bar is the whole point — clicking any slice opens the existing `openInsightListModal` drill-down
listing that person's actual requests (subject/status/date, linking to `Related Link`).

## Insights not visible to Admins — under investigation, needs more detail from the user (2026-08-20)

User reports Page Insights/SEO Insights/Core Web Vitals/On-Page Audit "not visible" to Admin
users. Checked `applyRoleGating_`/`SUPPORT_HIDDEN_NAV` directly — the nav-item visibility logic
looks correct (`admin = role === "Admin"` correctly shows all four for any Admin, Super Admin
included). Two real candidate causes that don't require a code bug: (1) Page/SEO Insights need
each person's own Google sign-in with GA4/Search Console **view access already granted on those
specific properties** — a newly-invited Admin's Jaro account may not have that access yet, which
would fail silently-ish per-person even though the nav item itself shows fine; (2) general
connectivity/cold-start flakiness already documented elsewhere in this file. Core Web Vitals and
On-Page Audit don't depend on personal Google access at all (PageSpeed API key / Apps Script
relay respectively), so if literally all four are failing identically for someone, that argues
against cause (1) and toward something more fundamental — **next session should ask the user
exactly what "not visible" looks like** (nav item missing vs. blank page vs. an error message vs.
stuck on "Loading…") and whether it's specific to newly-added Admins or affects existing ones too,
before changing any code here. Still unresolved as of this update.

## Combined "Page + SEO Insights" table (2026-08-20)

New nav item (`combinedInsights` in `SECTIONS`, Admin/Super Admin only, same seam as `onPageAudit`
— static `.navitem`, `SUPPORT_HIDDEN_NAV`, `navigate()` dispatch) merging GA4 and Search Console
data into one table, plus real table ergonomics this dashboard didn't have anywhere before:
sortable columns (click a `<th>`, click again to reverse), a page-size-selectable pager (10/20/50/
100, modeled on `renderBlogCards`'s pagination), a URL-path-segment filter (dropdown populated
dynamically from whatever first-path-segments actually occur — e.g. `/blog`, not hardcoded), a
day-based time range (Today/7/28/90/Custom — see below for why not sub-day), and CSV export
(`exportRowsAsCsv_`, client-side Blob + temporary `<a download>`, exports the filtered+sorted set,
not just the visible page). `fetchGa4Live_`/`fetchGscLive_` gained optional `(startDate, endDate)`
params — omitted by the standalone Page Insights/SEO Insights pages, which keep their original
hardcoded 28-day behavior exactly as before. Rows are merged by normalized path
(`mergeInsightRows_`, reusing `normUrlForMatch_`) as a full outer join — a page present in only one
source shows blanks for the other source's columns rather than being dropped.

**Time filter is day-based only (Today/7/28/90/Custom), not sub-day** — this was a real technical
finding, not a simplification of convenience: Search Console's API only ever reports in whole days
(and the data is itself 2-3 days delayed) — it cannot do 5-minute/hourly windows at all. GA4 has a
separate Realtime API for that, but it only covers the last ~30-60 minutes and doesn't extend
further back — there's a hard wall between "realtime" and "historical" data, not a smooth dial
from 1 minute to 90 days. If sub-day GA4-only data is wanted later, it would need a genuinely
separate "Realtime" mode (different API, different available metrics) rather than an extension of
this time-range control.

## "Applies To" on status updates for combined Program/Landing requests (2026-08-20)

When a request's Related Section is the merged `"Program Pages/Landing Pages"` value (see
`normalizeSectionLabel_`), marking its status used to imply one Status covered both, even though
in practice often only one of the two actually got done. `openStatusNoteModal_` now shows a
required "This update applies to" selector (Program Page / Landing Page / Both) — shown *only*
when the row's Section is exactly that merged value, hidden for every other section. Stored in a
new `Code.gs`-side sheet column, `"Status Applies To"` (appended to `REQUEST_LOG_HEADER`), written
by `handleUpdateStatus_` and shown next to the Status badge in the Requirements Log
(`appliesToTagHtml_`) and as an extra row in the status-update email (`statusEmailHtml_`).

**Note on scope (my clarifying question about this went unanswered, so I went with the simpler,
lower-risk option — flag it if you actually wanted the fuller version):** this only *labels* which
target a status update covers — the underlying Status column is still one shared value, not two
independently-tracked statuses. You cannot currently mark Program Page "Completed" while Landing
Page stays "Not Started" as two distinct, separately-progressing states — the row's Status is
still singular, just now annotated with which target the latest update was about. If you want true
independent per-target statuses (two separate status badges progressing separately over time),
that's a bigger, schema-changing follow-up — say so and it can be built.

**New robustness fix that also applies to old columns:** added `ensureColumn_(sheet, headers,
colName)` in `Code.gs` — self-heals a sheet's header row by appending a missing column name
automatically the first time it's needed, instead of silently writing/reading a column that was
never actually labeled in row 1 (exactly the bug that caused the very first Gmail-threading
mystery a few rounds ago, where `Gmail Message ID`/`Gmail Thread ID` had data but no header text).
`"Status Applies To"` is the first column that uses this — no manual sheet edit needed for it.

## Real bug fixed: request Subject went stale mid-typing (2026-08-20)

User reported the email subject for a Program/Landing request came out as just
`[Jaro Dashboard] Requirement — IIM Mumbai` — missing the program name entirely — and thought this
was a regression in the subject-content change from the round before. It wasn't category-specific;
root cause was in the auto-suggest wiring itself (`wireRequestFormDependencies`,
`maybeSuggestSubject`): the guard was "only suggest while the Subject field is empty". Typing
University fires an `input` event on *every keystroke* — the very first keystroke (before Program
had been typed at all) locked in a suggestion with no program name, and because the field was no
longer "empty" after that, it silently never recalculated again as the rest of the form got filled
in. Fixed by tracking the module-level `LAST_SUBJECT_SUGGESTION` and only skipping regeneration
when the field's current value diverges from our own last suggestion (i.e. the user actually typed
something themselves) — reset on every form open/reset. Verified in the browser: typing University
then Program character-by-character now correctly ends with both in the subject.

**"Related Link" showing "—" — investigated, no code bug found.** Checked how `payload.link` is
read (`submitRequest`, straight from the `#rf_link` input's live value at submit time) and whether
anything clears that field on Section change (`updateUniProgVisibility` — it doesn't touch
`rf_link`). Nothing in the code path loses or clears a typed link. Most likely explanation: that
specific request (raised generically, not from a card, per the same missing-Related-Link
screenshot) genuinely had the optional link field left blank. If there's a reproducible case where
a link *was* typed and still didn't show up, that needs a fresh screenshot — not enough evidence
yet to change any code here.

## File attachments now go through Google Drive, not inline base64 (2026-08-20)

Old approach embedded pasted images as `<img src="data:...">` directly in the request/note HTML,
which is why they were capped at a few KB — the whole request/note rides through a URL-length-
limited request to Apps Script (JSONP GET is the *only* transport that's ever reliably worked for
this domain-restricted deployment; a previous session already tried a plain POST specifically to
dodge this limit and found the login cookie gets silently dropped on cross-site POSTs here). Per
the user's decision (35MB cap, using the person's own Google sign-in — same trade-off already
accepted for Page/SEO Insights), `wireRichTextEditor` (shared by both the request form's
description and the status-update note — this fix applies to both automatically) now uploads any
attached/pasted file straight to Google Drive via `uploadFileToDrive_()` (multipart upload using
the existing `ensureGoogleAuth_` token — `CONFIG.oauth.scopes` gained `drive.file`), sets it
"anyone with the link can view", and inserts a plain link (`🖼️`/`📎` + filename + size) instead of
the file's actual bytes. Only a short link now ever rides through the size-limited request,
regardless of the original file's size. `RTE_MAX_FILE_BYTES` (35MB) is enforced client-side before
upload even starts. File type is no longer restricted to images — the `accept="image/*"` attribute
was removed from both file inputs; paste-from-clipboard still only works for images (a browser
limitation, not this app's), but the attach button now takes anything.

**Trade-off worth remembering:** this reintroduces a personal Google sign-in popup — specifically
the one thing request submission was originally re-architected *away* from needing. It only
appears when someone actually attaches/pastes a file (not on every submission), and reuses the
same cached token Page/SEO Insights already establish within the same browser session.

## Combined Insights: full URL + standalone Page/SEO Insights removed (2026-08-20)

Per the user, now that Combined Insights exists: removed the standalone `pageInsights`/
`seoInsights` `SECTIONS` entries, their sidebar nav items, click-wiring, `navigate()` dispatch
branches, and their two individual Home "Live Insights" cards (grid now 3 cards: Core Web Vitals,
On-Page Audit, Page + SEO Insights). `renderPageInsights`/`renderSeoInsights` themselves are left
in place as dead code (same precedent as `authApiCallLarge_`) since nothing routes to them anymore
but `fetchGa4Live_`/`fetchGscLive_` — which they're built on — are still very much alive, used by
Combined Insights. Also fixed: the "Page" column was showing GA4's relative path (e.g.
`/thankyou`) instead of a full URL — `mergeInsightRows_` now keeps `page` (full URL, used for
display/CSV/the column being a clickable link) separate from `path` (relative, used only for the
URL-segment filter's "first path segment" logic, which would otherwise have parsed a full URL's
`https:` as if it were a path segment).

## Requirements Log: Support sees only their own requests (2026-08-20)

`requirements` removed from `SUPPORT_HIDDEN_NAV` — Support can now reach the Requirements Log nav
item at all (previously hidden entirely). What they see is filtered **server-side**, not just in
the UI: `Code.gs`'s `handleListRequirements_` now checks `session.Role` and returns every row for
Admin/Super Admin, or only rows whose `Email` matches the requester's own session email for
Support — so a Support session's own API responses never contain anyone else's request data,
regardless of what the client does with it. Also: Support sees a read-only status badge
(`requestStatusBadgeHtml_`, new) instead of the editable dropdown (`requestStatusSelectHtml_`) —
changing status was already Admin-only server-side (`handleUpdateStatus_`'s `requireAdmin_`), but
showing Support an interactive control that would just fail was pointless and confusing.

## Mapping info restricted to Admin/Super Admin except Program/Landing Pages (2026-08-20)

Per the user, Support should only ever see "University Mapped"/"Product Mapped" info on Program
Pages and Landing Pages — University Pages, Free Course Pages, and Pillar Pages' mapping
popups/badges are now Admin/Super Admin only. Gated at the data-loading level (`urlMappings_ =
isAdmin_() ? await loadUrlMappings_() : null`, in `renderFlatCards` and `renderFreeCourses`) rather
than just hiding the badge, so Support never even fetches that data. Program Pages
(`renderGroupedSection`) is unchanged — still shown to everyone, as before. (Landing Pages has no
mapping-badge integration at all currently — `categoryBucketFor_` has no "landing" bucket — so
there was nothing to restrict there; if that gets built later, it should stay visible to Support
per this same rule.) Also: Home's "Form Mappings Coverage" Quick Insight panel
(`formMappingsCoveragePanel`) is now Admin/Super Admin only (`applyRoleGating_`), and
`loadUrlMappingCoverage_()` is no longer even called for a Support session.

## Request Activity: dropdowns instead of a bar chart, plus a "same page" view (2026-08-20)

`renderRequesterActivity` no longer draws the bar-and-legend visual — replaced with two toggleable
`<select>` dropdowns ("By Requester" / "By Page"), each option showing a count and, on selection,
opening the existing drill-down modal (`openInsightListModal`) for that slice. "By Page" is new:
groups by University+Program (skipping requests with no page context, e.g. Blogs) so a page that
keeps getting re-requested — regardless of who by — is just as visible as a person raising an
unusual number of requests.

## Trending crown — reconfirmed already Admin/Super Admin only, no change needed (2026-08-20)

User asked to restrict the 👑 toggle to Admin/Super Admin. Checked both layers: client
(`trendBtn` only renders when `isAdmin_()`, in `renderGroupedSection`) and server
(`handleSetTrending_` calls `requireAdmin_`) were already correctly gated from when this feature
was first built — nothing to change here.

## Real bug fixed: attachment upload could lose the race with Submit (2026-08-20)

User reported attaching a file showed "Uploading X…" but the file never actually made it into the
sent email — reproduced with a 187KB image, which ruled out it being a slow-upload/size issue.
Root cause: `insertAttachedFile` (in `wireRichTextEditor`) is async (Drive round-trip, sometimes a
Google sign-in popup) but nothing stopped `submitRequest`/the status modal's `onConfirm` from
reading the description/note HTML and submitting *before* that finished — the request went out
with whatever was in the field at that instant, silently missing the not-yet-inserted attachment
link. Fixed two ways: (1) every in-flight upload is now tracked (`pendingUploads` inside
`wireRichTextEditor`, exposed via a returned `{hasPendingUploads, waitForUploads}` handle —
`REQUEST_DESC_RTE` for the request form, `statusNoteRTE` for the status modal); both submit
handlers now await any pending uploads first, showing "Waiting for attachment…" on the button
rather than proceeding early. (2) The old fire-and-forget toast is replaced with a persistent
in-body placeholder (`⏳ Uploading filename…`, `contenteditable="false"`) that gets swapped in
place for either the final link or a visible red error message — so a failure is no longer only a
transient toast that's easy to miss, it's sitting right there in the description/note text.
Verified the wait-for-upload mechanism directly in the browser (mocked a slow upload — button
correctly disables/re-enables and the link lands in the right place once the upload resolves).
**Could not verify the actual Google Drive upload call itself succeeding** — that needs a real
Google sign-in popup, which can't complete in this environment. If it still fails after this fix,
the in-body error text (now persistent, not a fading toast) will have the exact reason — get that
exact text if it happens again.

## Request Activity: back to bar-and-legend, both breakdowns shown at once (2026-08-20)

The dropdown-based version from last round didn't land well ("no use of it"). Reverted to the
original bar-chart-and-legend visual (`renderBreakdownBars_`, a new shared helper extracted from
the old inline code) — but now as **two side-by-side panels** ("Requests by Requester" and
"Requests by Page") instead of one panel with a toggle, so both are visible at once with no
switching needed. "By Page" (new) groups by University+Program, exactly surfacing "the same page
keeps getting requested" regardless of who by. Both use the same click-a-slice-to-drill-down
behavior as before (`openInsightListModal`).

## CEO Dashboard — built (2026-08-20), briefly deployed, then removed entirely (2026-08-21)

Built local-only per the user's original instruction, deployed live once they gave the go-ahead,
then removed completely a short time later in the same day per a follow-up message ("Remove the
CEO Dashboard from the dashboard. nothing special in it."). Taken as a decision to drop the feature
outright, not to re-hide it — removed every trace from both `index.html` and `Unified Dashboard.txt`
(sidebar nav item, `SECTIONS.ceoDashboard`, the `navigate()` dispatch branch, `SUPPORT_HIDDEN_NAV`
entry, click-wiring, and the `renderCeoDashboardGateOrTable`/`renderCeoDashboard`/`renderSimpleBars_`
functions themselves), verified nothing else referenced any of it, and confirmed the two files are
byte-identical again. `SUPER_ADMIN_EMAILS` in `Code.gs` still has `rr@jaro.in` — that's a separate,
unrelated permission grant the user never asked to undo, and no Dashboard Users row exists for her
regardless, so it stays inert either way.

## File attachments: Google Drive approach dropped, replaced with chunked upload (2026-08-21)

**The Drive-based attachment approach (2026-08-20, section above) did not work in the user's real
usage** — "I'm literally not able to upload anything directly, nor status is shown that it is
uploaded or not." The user also explicitly rejected the other technically-sound fix (opening the
Apps Script Web App's access setting from "Anyone within Jaro" to "Anyone" so a real upload POST
could work) — "this removes the specific Google restriction is not possible here." Explicit final
instruction: *"I just want to add the media to be uploaded from the local computer here. Please
make it happen anyhow."* No Drive, no OAuth popup, no deployment-access change.

**New approach: split the file into many small pieces and send each one through the transport that
already reliably works.** JSONP GET is the only transport confirmed to carry the login session's
cookie through this domain-restricted deployment (a real POST silently drops it — see
`submitRequestDirect_`'s own comment, and `authApiCallLarge_`, which is dead code left in place as
a record that the POST+iframe route was already tried and found not to work here). So instead of
one large request, an attached file is base64url-encoded client-side and cut into ~3500-character
pieces, each sent as its own tiny `uploadChunk` action (well under the ~6000-char practical URL
length already established elsewhere in this file), 6 at a time in parallel
(`uploadFileChunked_`/`runWithConcurrency_` in the dashboard file). `Code.gs`'s new
`handleUploadChunk_` appends each piece as one row in a scratch "UploadChunks" sheet
(`UPLOAD_CHUNKS_HEADER`), keyed by a client-generated `uploadId`; rows older than 30 minutes are
swept opportunistically on every new chunk upload (same pattern as the existing `PendingResults`
scratch sheet). Once every piece for a file has landed, `handleSubmitRequest_`/`handleUpdateStatus_`
call `assembleAttachments_`/`assembleUploadedFile_`, which sorts the rows by `ChunkIndex`,
concatenates them back into the full base64url string, converts it to standard base64
(`base64UrlToStandard_` — chunks travel as base64url purely to avoid percent-encoding overhead over
the GET transport; a real MIME attachment needs the standard alphabet), and enforces
`MAX_ATTACHMENT_BYTES` (10MB raw per file) on the fully-reassembled size. `sendGmailMessage_` now
accepts an optional `attachments` array and builds a genuine `multipart/mixed` MIME message
(boundary-separated HTML body + one `Content-Disposition: attachment` part per file,
`wrapBase64Lines_` wrapping each at 76 chars) instead of the old plain `text/html` message — this
is a real email attachment, opens directly in Gmail/Outlook/etc., no link, no separate Drive
permission, no popup. Chunks are deleted (`deleteUploadChunks_`) only after the email actually
sends, so a failed send can be retried without re-uploading the file.

**Front end:** `wireRichTextEditor` (shared by both the request form and the status-update note)
no longer touches Drive or `ensureGoogleAuth_` for this — `drive.file` was removed from
`CONFIG.oauth.scopes` entirely, it's not needed for anything else. The in-body placeholder now
shows live percentage (`⏳ Uploading file.png… 43%`) instead of a static "Uploading…", and on
success becomes a plain (non-clickable) chip — `📎 file.png (1.2 MB) — will be attached to the
email` — tagged `data-upload-id="…"` rather than a Drive link, since the file has nowhere to link
to until the email actually sends. `getAttachmentIds()` (new on the handle `wireRichTextEditor`
returns) reads these tags straight from the live DOM rather than keeping a separate tracked list —
so if someone backspaces a chip out of the message body, it stops counting as attached with no
extra bookkeeping. `RTE_MAX_FILE_BYTES` dropped from 35MB to 10MB to match the new
`MAX_ATTACHMENT_BYTES` ceiling (the 35MB number was specific to routing through Drive, which no
longer applies). `submitRequest`'s payload and `updateRequestStatus_`'s call both now include
`attachmentUploadIds` (from `getAttachmentIds()`), which `handleSubmitRequest_`/`handleUpdateStatus_`
assemble and attach before sending.

**Verified in the browser** (mocking `authApiCall_` — a real Gmail send can't be exercised outside
the actual deployment): chunk splitting, the 6-way concurrency cap, and progress reporting all
behave correctly; the full client-encode → chunk → reassemble → server-decode round trip reproduces
the original file bytes exactly (byte-for-byte, tested with two different random buffers of
different sizes, one a plain multiple-of-3 length and one not, so base64 padding was exercised);
driving a real `<input type=file>` `change` event through `wireRichTextEditor` end-to-end correctly
swaps the placeholder to the final chip and `getAttachmentIds()` returns exactly that upload's id;
clearing the message body and re-checking `getAttachmentIds()` correctly returns empty; a file over
10MB is rejected client-side with a toast and never attempts an upload. **What's still unverified is
the one thing that can't be tested outside the real deployment: an actual Gmail send with a real
`multipart/mixed` attachment landing correctly in a real inbox.** If the attachment doesn't show up
or the email looks malformed after redeploying, the exact symptom (attachment missing vs. email
broken vs. error toast, and any error text shown) is what's needed to diagnose further.

## Real bug fixed: uploadChunk calls were missing the session token (2026-08-21)

First live test after deploying the above showed `"certificate.png" failed to attach — You're not
logged in."` — `uploadFileChunked_`'s `authApiCall_("uploadChunk", {...})` call never included
`token: AUTH_SESSION.token` (every other action in this file does), so `Code.gs`'s
`requireSession_` correctly rejected every chunk as unauthenticated. Fixed by adding the token to
that payload. Verified in the browser with a mock `authApiCall_` that every chunk now actually
carries the session token before this was re-shipped.

## Real bug fixed: uploadChunk's cleanup sweep made later uploads in a session crawl (2026-08-21)

User reported attaching files was "taking a long time... even the media file is in KB" — screenshot
showed two small images finishing fine, then a PDF stuck at 1% for a long stretch. Root cause:
`handleUploadChunk_` ran its stale-chunk sweep (`sheet.getDataRange().getValues()` + a full scan)
on **every single chunk**, not once per upload. That sweep re-reads and rescans the *entire*
`UploadChunks` sheet — which keeps growing as chunks land, from every file attached in the same
session, since rows aren't deleted until the whole email actually sends. So a file's 2nd chunk
rescans what its 1st chunk wrote, its 50th chunk rescans 49 rows-worth of scanning-so-far, and if
two earlier files (say ~110 chunks combined) are still sitting there un-sent, chunk 1 of a third
file already has 110+ rows to read and scan before it's even added its own — quadratic work per
file, worse the more files/chunks have piled up in the session. Fixed by only running the sweep on
a file's first chunk (`chunkIndex === 0`) instead of every one — cuts sweep frequency by roughly the
chunk count of a file (50-100x for a typical attachment). Also bumped `UPLOAD_CHUNK_CHARS` from
3500 to 5000 and `UPLOAD_CONCURRENCY` from 6 to 8 (still comfortably under the ~6000-char URL
budget with the 72-char token included) to cut the raw number of round trips per file — each chunk
is still an unavoidable full Apps Script execution (opens the spreadsheet fresh every time, no way
to keep a connection warm across separate JSONP requests), so some per-chunk latency is inherent to
this transport, but the sweep fix removes the part that was making it actively worse over a
session rather than just "as slow as one round trip per chunk should be."

## Real bug fixed: deleteUploadChunks_ ran one deleteRow() per chunk (2026-08-21)

User's follow-up complaint after the sweep fix above ("last time now... please understand only
this is the obstacle before going live") meant there had to be a second real cost still hiding
somewhere. Found it: `deleteUploadChunks_` (called from `handleSubmitRequest_`/`handleUpdateStatus_`
right after the email successfully sends) looped over every matching row and called
`sheet.deleteRow()` on each one individually — for a 50-chunk file that's 50 separate structural
spreadsheet mutations, run one after another, *synchronously, inside the same request the user's
Submit/Send Update button is waiting on*. The email had already gone out by that point, but the UI
stayed on "Submitting…"/"Sending…" until all of that finished. Fixed by extracting a
`keepRowsWhere_(sheet, predicate)` helper that does the removal as one read + one `clearContent()` +
one bulk `setValues()` of only the surviving rows — three operations total regardless of how many
rows are being removed, instead of N. Reused for both `deleteUploadChunks_` (keep rows whose
UploadId doesn't match) and the `handleUploadChunk_` stale-upload sweep (keep rows newer than the
30-minute cutoff), replacing their old delete-loops too.

## New: client-side image compression before chunking (2026-08-21)

The single biggest lever on upload time for the most common attachment type — a screenshot or
phone photo — isn't the transport, it's just how many bytes have to cross it. Images over 400KB
(`IMAGE_COMPRESS_MIN_BYTES`) are now downscaled to at most 1920px on the long edge and re-encoded
as JPEG at 0.82 quality (`maybeCompressImage_`, via `createImageBitmap` + a `<canvas>`) before
`uploadFileChunked_` ever sees them — cutting typical screenshot/certificate/photo sizes by 70-95%,
which cuts the number of chunks (and therefore round trips) by the same proportion. Falls back to
the untouched original if compression fails, doesn't actually shrink the file, or the type is
GIF (re-encoding would drop the animation) or already small. Non-image attachments (PDFs, docs,
zips) aren't touched — there's no general-purpose compression available client-side for those, so
their upload time still scales with their real size; the sweep and bulk-delete fixes above are what
help them.

**A real bug caught by testing this, before it shipped:** the first version called
`await maybeCompressImage_(file)` in `insertAttachedFile` *before* the upload got added to
`pendingUploads`. `insertAttachedFile` is invoked fire-and-forget (from the file input's `change`
handler and the paste handler, neither of which await it), so the very first `await` inside it is
also the point where control returns to that caller — if `pendingUploads.add(task)` hasn't run by
then, `submitRequest`/the status modal's `onConfirm` calling `waitForUploads()` right after can see
an empty set and resolve instantly, before compression (let alone the actual upload) has even
started. That's the exact race this whole tracking mechanism was built to prevent, reintroduced by
the compression feature. Caught in the browser (a mock upload counted zero chunk calls and the
placeholder never left "0%") before it ever reached `index.html`. Fixed by moving compression
*inside* the already-tracked async task, so the synchronous prefix up to `pendingUploads.add(task)`
has no `await` in it again, exactly like before this feature existed. Non-image files are still
gated against the 10MB limit synchronously up front (unchanged); images are gated *after*
compression, inside the task, so an oversized original still gets a fair chance to shrink under the
limit first. Re-verified after the fix: the task is provably in `pendingUploads` the instant the
file-input's `change` event is dispatched, not just eventually.

## Attachments v3: real Google Form upload replaces chunking as the active path (2026-08-21)

Even after the sweep fix and the bulk-delete fix, the user did the actual math with them on a call:
an 8MB PDF becomes ~10.7MB of base64, split into ~2,140 pieces at 5000 chars each — at 8-way
concurrency and ~1.2s per Apps Script round trip, that's genuinely ~5 minutes, matching exactly what
they reported. That's not a bug to fix, it's the structural cost of "many small Apps Script
executions" for a file that size — no further tuning within that architecture closes a gap that
large. Explained this plainly to the user (Gmail's own attach is one continuous stream at real
network speed; this dashboard can't do that directly because the browser drops the login cookie on
a real cross-site POST — the actual root cause established earlier this session). They asked
whether a custom domain would help (no — the cookie restriction is about registrable-domain
matching with google.com, unrelated to which domain hosts the dashboard itself; the round-trip cost
is entirely in the browser <-> Apps Script leg, which a custom domain doesn't touch either) and then
asked for the Google Form idea to actually be built.

**What changed:** the user created a real Google Form ("Jaro Unified Requirement Dashboard Form")
with a File Upload question ("Please upload the file you want") and a short-answer "Request
Reference" question, restricted to sign-in (Google enforces this automatically for any form with a
File Upload question), and linked its responses to the *same* spreadsheet Code.gs already uses (new
tab: "Form Responses 1" — Timestamp / Please upload the file you want / Request Reference columns,
confirmed via screenshot). The attach button (in both the request form and the status-update modal)
now opens this Form embedded in a modal (`ensureFormAttachModal_`/`openFormAttachModal_`,
`FORM_ATTACH_URL`/`FORM_ATTACH_REF_ENTRY` = the exact form + entry ID the user provided), pre-filled
with a fresh per-attempt "Request Reference" via a pre-filled-link URL parameter. The dashboard
polls `checkFormUpload` every 2.5s while the modal is open; `Code.gs`'s `handleCheckFormUpload_`
finds the response row by that reference (searching every sheet in the spreadsheet for one with a
"Request Reference" header, so it doesn't matter what Google names the tab), extracts the Drive file
ID out of whichever column holds a Drive-link-shaped string (matched by pattern, not by the Form
question's own label text, so a later label edit can't silently break it), and returns the file's
real name/type/size straight from `DriveApp` once found. `assembleAttachments_` (used by both
`handleSubmitRequest_` and `handleUpdateStatus_`, unchanged at that call-site level) now resolves
each id through `assembleFormFile_` (fetch bytes from Drive, base64-encode, attach exactly as
before) instead of `assembleUploadedFile_`; cleanup after a successful send calls `deleteFormFile_`
(trash the Drive file) instead of `deleteUploadChunks_`.

**Why this should actually be fast:** the browser hands the file to Google's own upload
infrastructure as one real stream — the same mechanism as attaching a file to any Google Form on
the web — instead of cutting it into hundreds of pieces. No chunking, no per-piece Apps Script tax.

**What's deliberately kept, unused, as a fallback:** the entire chunked-upload system
(`uploadFileChunked_`, `maybeCompressImage_`, `handleUploadChunk_`, `assembleUploadedFile_`,
`deleteUploadChunks_`, `keepRowsWhere_`, the `uploadChunk` dispatch case) is still there, just not
wired to the attach button anymore — same precedent as `authApiCallLarge_` elsewhere in this file
(already tried, worked, superseded, kept in case of a revert). **Pasting a screenshot directly
(Ctrl/Cmd+V) still uses the old chunked path** (`insertAttachedFile`, unchanged) rather than the new
Form modal — deliberate, not an oversight: a pasted clipboard image is always small and already fast
post-compression, and there's no sane way to pre-fill a clipboard paste into an embedded Form, so
there was nothing to gain and a worse experience (a modal popping up over a paste) to lose. Only the
explicit "attach a file" button switched to the Form-based flow (`insertAttachedFileViaForm`,
new) — the two mechanisms share the same `pendingUploads`/`uploadCounter`/`getAttachmentIds()` state
inside `wireRichTextEditor`, so `submitRequest`/the status modal's `onConfirm` don't need to know or
care which path a given attachment came from.

**A real design constraint worth remembering:** the embedded Form is a genuine cross-origin page —
there is no callback, event, or postMessage from it when the person hits its own internal Submit
button. Polling `checkFormUpload` is the only way the dashboard can find out a file has actually
arrived, which is why this needs the person to notice their own Google Form said "response
recorded" and the dashboard to catch up within one poll interval after that (up to ~2.5s lag, not
noticeable in practice).

**Verified in the browser** (mocking `authApiCall_`, since a real Google sign-in and Drive round
trip can't be exercised here): the iframe's `src` is built with the exact correct `embedded=true` +
pre-filled-reference URL; polling continues with the same reference on every tick, and correctly
stops the moment `checkFormUpload` reports `found:true` *and* stops equally cleanly on Cancel (no
zombie timers still firing after cancel, confirmed by waiting past several more poll intervals with
a call counter); the full button-click -> modal-open -> poll -> resolve -> chip-insertion path
works end to end with `getAttachmentIds()` returning the right Drive file id and the button's own
`pendingUploads` tracking having zero race window (confirmed the task registers synchronously,
before any await, exactly like the existing paste-path already did). **What's still unverified is
the one thing that genuinely can't be tested outside a real Google session:** whether the embedded
Form's own file-upload widget behaves smoothly inside the iframe (versus, say, needing a separate
popup window for the actual Drive/upload picker) — that needs the user's real first attempt.

## Real bug fixed: the embedded Form iframe refused to render (2026-08-21)

First live test of the iframe-embedded modal (previous section) showed a Google Drive error page
inside it: *"We're sorry. This document is not published."* Root cause: the Form has a File Upload
question, which forces Google to require sign-in from respondents — and Google blocks framing any
sign-in-required page inside a third-party site's iframe (a clickjacking protection on Google's
side, not a bug in this project and not something fixable by any setting on the Form itself). So
embedding could never have worked once the Form needed sign-in, no matter how the iframe was
configured.

**Fixed by opening the Form as a real new browser tab instead of an iframe** — `window.open(url,
"_blank", "noopener")`, called synchronously from the button's click handler (calling it after any
`await` risks the browser treating it as an unrequested pop-up and blocking it, since pop-up
allowance is tied to being inside a genuine user-gesture call stack). A full top-level tab
navigation has no framing involved at all, so Google's restriction doesn't apply. The trade-off:
still no direct callback when the person submits the Form in that other tab (a plain new tab is
just as cross-origin as an iframe was, from a JS-observability standpoint) — polling
`checkFormUpload` remains the only way to know, same as before, just without the modal/iframe UI
around it. `ensureFormAttachModal_`/`openFormAttachModal_` (the iframe-modal code) were replaced
entirely rather than kept as a fallback — unlike the chunked-upload system, there's no scenario
where reverting to a known-broken iframe would ever be the right call.

**New design:** `pollForFormUpload_(reference)` runs the poll loop standalone (no modal), returning
`{promise, cancel()}`. The in-body placeholder that used to say "Uploading…" now says "Waiting for
the file — submit it in the new tab…" with an inline "cancel" link (a real anchor tag inside the
`contenteditable="false"` placeholder span — clicking it calls `poller.cancel()`), so the person can
back out without leaving a stuck placeholder if they close the other tab without submitting. Polling
gives up and surfaces an error after either 3 *consecutive identical* error responses (distinguishing
a genuinely stuck problem, like a too-large file, from an ordinary one-off JSONP network hiccup that
just gets silently retried — same tolerance this file already extends to every other JSONP call) or
20 minutes elapsed (a human filling in a form in another tab needs a much longer allowance than a
server call would). A toast confirms success too, since the person's attention may still be on the
other tab when it lands.

**Verified in the browser** (mocking `authApiCall_`/`window.open`, since the real cross-tab
Google sign-in flow can't be exercised outside a live browser session): the success path, the
3-strikes permanent-error path, a flaky-then-recovers transient-error sequence (confirms it does
*not* false-positive on ordinary network blips), the cancel link (removes the placeholder, stops
polling immediately — confirmed via a call counter that stops incrementing), and the pop-up-blocked
path (clear toast, no orphaned pending upload) — all behave correctly. The full button-click ->
new-tab-opens -> poll -> resolve -> chip-insertion chain works end to end with zero race window on
`pendingUploads` (confirmed synchronous registration, same pattern as everywhere else in this file).

## Root cause of "This document is not published": the Form itself, not the code (2026-08-21)

The new-tab fix (previous section) didn't resolve it either — the exact same error appeared on a
genuine top-level navigation to the bare `viewform` URL with zero query parameters, which
conclusively ruled out anything on the dashboard's side (framing, the pre-filled reference
parameter, JS logic — none of it was ever involved). Walked the user through diagnosing their own
Form: Settings had no obvious toggle for it, but the **Responses tab** (a sibling of Questions/
Settings, not a section within Settings) showed *"No responses. Publish your form..."* — Google
Forms has an explicit **Publish** step (a button in the editor's top-right, separate from "Send"),
and this Form had never been published, despite already accepting a live test response earlier via
the owner's own authenticated preview (which bypasses the publish gate entirely, which is exactly
why the earlier "Get pre-filled link" preview rendered fine while every real respondent-facing open
failed). The user clicked Publish, confirmed the bare URL then worked, and confirmed "Accepting
responses" was on and "Responders: Anyone with the link" in the resulting "Published options"
dialog. **Nothing on the dashboard or in Code.gs ever needed to change for this** — worth
remembering if this Form is ever recreated or a second one is added: it must be explicitly
Published, once, from the editor, or every real attempt to open it will fail this exact way
regardless of any other setting.

## Attachments v4: chunked-by-default again, Form flow only for large non-images, images now inline (2026-08-21)

With the Form actually working, the user tested it for real and reported two problems with the
*design*, not bugs: (1) a single image attached this way didn't show up in the email body — it only
ever produced a downloadable attachment, never a real inline picture; (2) the whole new-tab/pick-
again/wait dance was excessive friction for something as simple as one image, when the old chunked
path (already fast for images thanks to compression) needed none of it. Both fair, and both fixed:

**Routing (front end, `wireRichTextEditor`):** the attach button is a native file picker again
(`imgInput.click()`), not a Form-tab launcher. Once a file is picked, `CHUNKED_UPLOAD_SIZE_THRESHOLD`
(1.5MB) decides the path: **images always go through the chunked system regardless of size**
(compression already handles them, so in practice almost none are ever slow), and **only a non-image
over the threshold** gets redirected to `insertAttachedFileViaForm()` (a toast explains why, then the
Form tab opens automatically — the person re-picks the same file there). Pasting a screenshot
(Ctrl/Cmd+V) is unaffected either way, already going through the fast chunked path as before.

**Inline images (front end + back end):** `insertAttachedFile`'s success handler now inserts a real
`<img data-upload-id="...">` tag (with a `data:` URL compose-time preview generated via the new
`fileToDataUrlForPreview_`) instead of a text chip, for image attachments specifically — non-images
keep the existing chip. `Code.gs`'s new `rewireInlineImages_(html, attachments)` (called in both
`handleSubmitRequest_` and `handleUpdateStatus_`, right after `assembleAttachments_` and right before
`sendGmailMessage_`) scans the final composed HTML for those tags, matches each one's
`data-upload-id` back to its assembled attachment by a new `_id` field both `assembleUploadedFile_`
and `assembleFormFile_` now include, rewrites the tag's `src` to a `cid:` reference, and marks that
attachment `{inline: true, contentId}`. `sendGmailMessage_`'s MIME builder uses `Content-Disposition:
inline` + a `Content-ID` header for those parts instead of `Content-Disposition: attachment` — Gmail
(and every client that matters here, since recipients are all Workspace users) renders this
correctly even flattened into the existing `multipart/mixed` structure, without needing a nested
`multipart/related`. A pasted/attached image now shows up as a real picture directly in the email,
the same as attaching one in Gmail itself, while still being a genuine attachment underneath (not
capped at a few KB the way the very first, pre-this-whole-saga approach was).

**Id-space disambiguation:** since images/small files (chunked ids, prefixed `"up_"`) and large
non-images (raw Drive file ids, no fixed prefix) can now both appear in the same
`attachmentUploadIds` list for one request, `assembleAttachments_` routes each id to
`assembleUploadedFile_` or `assembleFormFile_` by checking for that prefix — no other change needed
to `handleSubmitRequest_`/`handleUpdateStatus_`, which already just pass the whole list through.

**Verified in the browser** (mocking `authApiCall_`/`window.open`): a small image goes through the
chunked path, produces zero Form-tab opens, and inserts a real `<img>` tag with a valid `data:`
preview; a large (2MB) non-image correctly opens the Form tab with zero chunk calls and the right
toast; a *large* image (tested at ~29MB of incompressible random noise, a deliberately worst-case
input) still goes through chunking and never opens the Form tab, confirming images are never
misrouted regardless of size. `rewireInlineImages_`'s regex logic and the id-prefix routing were
both unit-tested standalone in Node (can't run real Apps Script here): attribute-order variations,
non-image attachments correctly left un-inlined, unrelated `<img>` tags with no matching id left
untouched, and multiple images in one body each getting distinct `cid:`s — all pass.

## Inline images now consistent across both attachment paths (2026-08-21)

User asked for a Form-attached image ("when the user adds any media through Forms also na") to show
up inline in the email body too, not just a chunked one. `rewireInlineImages_` in `Code.gs` was
already fully generic (it only checks an attachment's `mimeType`, not which mechanism produced it),
so the gap was purely front-end: `insertAttachedFileViaForm`'s success handler always built a text
chip regardless of file type, never the `<img data-upload-id>` tag the backend actually looks for.
Fixed to branch the same way `insertAttachedFile` already does — an image gets a real `<img>` tag
(now consistent with the chunked path, no Code.gs change needed at all this round), anything else
keeps the text chip. The one real difference from the chunked path: there's no live compose-time
preview, since this path's bytes live in Drive rather than this page's own memory — a generic
placeholder graphic (`FORM_IMAGE_PLACEHOLDER_SRC`, an inline SVG data URI, no network request) shows
in its place until the email is actually sent, at which point the real picture appears exactly like
any other inline image. Practically this only matters for a large image if one ever gets routed to
the Form path — today's routing keeps all images on the chunked path regardless of size (see
Attachments v4 above) — but this closes a real correctness gap rather than leaving one path
silently behind the other. Verified in the browser: a Form result that resolves to an image mimeType
produces the `<img>` tag with the placeholder loading successfully (not a broken-image icon) and the
correct `data-upload-id`; a Form result that resolves to a non-image still produces the original
text chip, confirming no regression there.

## Back to an embedded modal — no new tab at all (2026-08-21)

User explicitly asked to remove the new-tab requirement entirely ("I dont want that thing in it").
This prompted revisiting whether the iframe embedding really was blocked by framing rules, as first
assumed — or whether that diagnosis had simply never been re-tested after the *actual* fix (the Form
needing to be Published, discovered afterward) landed. Since the "not published" error was proven to
happen identically on a bare, non-embedded URL, framing was never actually confirmed to be the
problem — only suspected, based on a symptom that turned out to have an unrelated cause. So embedding
was rebuilt: `ensureFormAttachModal_`/`openFormAttachModal_` are back (a modal containing an
`<iframe src=".../viewform?embedded=true&...">`), and `pollForFormUpload_` (built for the new-tab
version) is reused completely unchanged underneath it — only the "how the person sees the Form"
layer differs, so all of that function's existing behavior (3-strikes permanent-error detection, the
20-minute generous timeout, clean cancellation) carries over with zero risk of regression there.
`insertAttachedFileViaForm` simplified accordingly: no more `window.open`/popup-blocked handling
(a modal can't be blocked by a popup blocker, since it's just DOM) and no more inline "cancel" link
in the placeholder text (the modal has its own Cancel button and backdrop-click-to-close now).

**This is explicitly a retry, not a confirmed fix** — verified in the browser that the modal
mechanics themselves are correct (opens with the right pre-filled `embedded=true` iframe src, closes
cleanly on success/Cancel-button/backdrop-click/X-button, `window.open` is never called, the full
button-click → modal → poll → resolve → chip-insertion chain works with mocked responses), but
**whether Google actually renders the published Form correctly inside that iframe** can only be
confirmed with a real Google-authenticated browser session, which isn't available here. If it still
fails now, that would be new, actually-confirmed information (framing really is blocked, independent
of publish state) rather than the untested assumption the first embedding attempt was built on — and
the fully-intact new-tab version (git history, commit range `b7db1f9`..`8bab02a`) is the fallback.

## Ownership migration: lalit.rade@jaro.in → tech@jaro.in (2026-08-21/22)

Full infrastructure migration, driven by two things: management wanting emails sent from an
approved address (lalit.rade@jaro.in's use for this wasn't approved), and tech@jaro.in specifically
being able to get IT approval for "Anyone" Web App access, which lalit.rade@jaro.in's account
couldn't. Completed:
- **Google**: spreadsheet ownership (and the Apps Script bound to it) transferred to tech@jaro.in;
  redeployed as a brand-new deployment under that identity — confirmed via the actual deployment
  settings screen: "Execute as: Me (tech@jaro.in)", "Who has access: Anyone". New exec URL:
  `https://script.google.com/macros/s/AKfycbwGYDwIzRQAcPNs2HqU6kf9ev1CjUMTPKfkE4mSas6fAO85txk9GALY0L6j6J9slex8Dg/exec`.
  The Google Form (Attachments v2-v4) was *not* migrated — moot once Attachments v5 (below) replaced
  it entirely.
- **GitHub**: repo transferred twice — first attempt went to the `techjaroeducation` **organization**,
  which hit "deploying from a private GitHub organization requires a Vercel Pro plan" on the Vercel
  side; transferred again to the **personal** `TechJaro` account instead (also tech@jaro.in-controlled,
  just not an org), which Vercel's free tier fully supports for private repos. Now at
  `github.com/TechJaro/website-requirement-dashboard`. Local git remotes (Downloads + D: copies)
  updated and verified (fetch + push) at each transfer.
- **Vercel**: new `TECHJARO` team, project imported from the repo above, deployed and confirmed
  rendering correctly. Stable URL: `website-requirement-dashboard.vercel.app` (not the per-deployment
  URL Vercel also shows, which changes on every future deploy).
- **Code.gs**: only `sendGmailMessage_`'s `fromEmail` changed, to `"tech@jaro.in"` — matches the new
  "Execute as" identity, and is what actually determines which account Gmail API sends as. Everything
  else referencing lalit.rade@jaro.in (`SUPER_ADMIN_EMAILS`, the submitRequest fallback recipient,
  `setupAdmin()`'s seeded account) deliberately left unchanged, per explicit instruction — those are
  about Lalit's own role *within* the dashboard's login system, unrelated to which Google account the
  script itself executes as.
- Frontend's `CONFIG.authApiUrl`/`CONFIG.requestForm.webAppUrl` updated to the new exec URL.

## Attachments v5: real direct upload, replacing the Form entirely (2026-08-22)

Once "Anyone" access was confirmed live, the user tested the embedded-Form flow (Attachments v4)
and rejected it outright — "I dont want this form now anymore... Make it similar to Google Gmail
itself." This is the culmination of the whole attachments saga this session: with the Web App now
set to "Anyone" instead of domain-restricted, the actual root blocker behind chunking *and* the
Form (Google's own cookie-based gate in front of the Web App, which a cross-site POST's cookie gets
dropped for) is gone entirely. There's no reason left to chunk a file or hand it to a separate
Google product — the browser can now just POST the whole thing directly, in one request, like any
normal website's upload.

**The backend transport already existed and needed zero changes** — `doPost` in Code.gs was built
during an earlier (at-the-time-unsuccessful) attempt to avoid the JSONP GET transport
(`authApiCallLarge_`'s hidden-iframe+form-POST idea), and its plain-JSON-body branch is exactly
"POST a JSON body, get JSON back." That attempt failed purely because of the domain-restricted
cookie gate — with that gate gone, the exact same doPost code just works via a normal `fetch()` now.

**What changed:**
- `authApiPostCall_`/`authApiPostCallOnce_` (new, dashboard file) — a plain `fetch()` POST with
  `Content-Type: text/plain` (deliberate: keeps it a CORS "simple request" with no preflight, which
  Apps Script can't answer correctly anyway; Code.gs's `e.postData.contents` is parsed as JSON
  regardless of the declared Content-Type). Same idemKey/one-retry shape as `authApiCall_`, reusing
  Code.gs's existing `dispatch_` idempotency cache. Used only for `submitRequest`/`updateStatus` —
  every other action stays on the proven JSONP GET transport, unchanged, since there's no reason to
  touch what already works.
- `wireRichTextEditor` rewritten to a single, unified mechanism: pick a file (or paste), it's read
  into memory as base64 (`fileToStandardBase64_`) — compressed first if it's an image
  (`maybeCompressImage_`, kept — still genuinely useful for real network transfer time, not chunking
  overhead) — and shown immediately in the compose body: a real `<img>` for images (the actual
  attachment bytes as the preview `src`, not a stand-in) or a text chip for anything else. No upload
  step at all until the person hits Submit/Send — the bytes travel inline, in the *same* POST as
  the rest of the payload. All the old size/type-based routing to a Form tab is gone — no threshold,
  no special-casing, just the flat 10MB cap for everything. `getAttachments()` (was
  `getAttachmentIds()`) returns full `{_id, filename, mimeType, base64}` objects now, DOM-driven
  exactly as before (delete the chip/image from the body, it stops being sent).
- `submitRequestDirect_`/`updateRequestStatus_` moved to `authApiPostCall_`, and the old
  URL-length-based "strip large pasted screenshots" safeguards were removed from both — no longer
  needed at all now that there's no URL-length ceiling to protect against.
- Code.gs: `validateDirectAttachment_` (new) — checks the same `MAX_ATTACHMENT_BYTES` cap against
  attachments that arrive already-assembled inline, rather than needing lookup/reassembly.
  `handleSubmitRequest_`/`handleUpdateStatus_` now concat these with whatever `assembleAttachments_`
  returns from the old id-based paths (which will be empty going forward, but cost nothing to keep).
  `rewireInlineImages_` needed *no changes* — it already worked generically off `mimeType`/`_id`
  regardless of source.
- The entire chunked-upload system (v1) and the Google Form system (v2-v4) — `uploadFileChunked_`,
  `maybeCompressImage_`'s call site inside it, `handleUploadChunk_`, `assembleUploadedFile_`,
  `deleteUploadChunks_`, `keepRowsWhere_`, `findFormResponsesSheet_`, `handleCheckFormUpload_`,
  `assembleFormFile_`, `deleteFormFile_`, `ensureFormAttachModal_`, `openFormAttachModal_`,
  `pollForFormUpload_` — all stay defined, entirely unused, same precedent as `authApiCallLarge_`:
  already tried, worked (to varying degrees), superseded, kept only in case of a revert.

**Verified in the browser** (mocking `fetch`, since a real Gmail send still can't be exercised
outside the live deployment): `authApiPostCall_` sends the exact right URL/method/Content-Type/body
shape and correctly retries once with the *same* idemKey on a network failure while surfacing a
server-returned error immediately; `insertAttachedFile`'s new direct-read mechanism has zero race
window (task registers in `pendingReads` before any await, confirmed the same way every prior
version of this mechanism was verified); an attached image produces a real `<img>` tag whose `src`
is provably the exact same base64 as what `getAttachments()` returns (not a placeholder); a
non-image produces the text chip; an over-the-limit file is rejected client-side with the right
toast and never gets attached; deleting the chip/image from the compose body correctly drops it
from `getAttachments()`; and the full chain from attaching a file through `submitRequestDirect_`
produces a well-formed POST body with the attachment's real filename/base64/id inside
`payload.attachments`, exactly what Code.gs's `validateDirectAttachment_` expects.

## Immediate next action

Paste the latest `Code.gs` into the Apps Script editor (the tech@jaro.in-owned project) and
redeploy — this round adds `validateDirectAttachment_` and the `payload.attachments`/`body.attachments`
handling in `handleSubmitRequest_`/`handleUpdateStatus_`, plus the updated `doPost` comment. After
redeploying: attach a real image and a real non-image file (a PDF, even a large one) via the
**single attach button** — no Form, no tab, no chunking indicator — confirm both show up
immediately while composing, and confirm the delivered email shows the image inline and the PDF as
a real attachment, and that this now feels close to instant regardless of file size (bounded mainly
by the sender's own upload bandwidth, same as Gmail itself, not by anything this dashboard does).
This is the actual, final resolution of the attachments saga that's run through most of this
session — if this works as verified locally, the "attach a file" feature is done. Other still-open
items, unchanged: (1) exact symptoms for the still-open Insights-visibility issue further above;
(2) decide whether to build the proposed shared-cache proxy for scaling; (3) confirm whether the old
`C:\Users\user\Downloads\Website Requirement Dashboard` folder can be deleted now that the D: copy
is confirmed working.

## Real bug fixed: Vercel Hobby plan blocked commits from a non-owner author (2026-08-22)

The two most recent deployments (`5d071d0`, `28098cf`) sat at **Blocked** in Vercel, never actually
going live — the dashboard kept showing pre-migration behavior no matter how hard the page was
refreshed, because the live Production deployment was still genuinely the older `a34272d` commit.
Vercel's own message: *"The deployment was blocked because the commit author did not have
contributing access to the project on Vercel. The Hobby Plan does not support collaboration for
private repositories."* Root cause: every commit in this repo is authored under the `lalitrade-jaro`
git identity (this environment's configured git user, which git-safety rules prohibit changing) —
but the GitHub repo and Vercel project are now owned by `TechJaro`. Vercel's free plan treats a
commit from any author other than the project owner as an unapproved collaborator on a private
repo and blocks the deployment outright — structural, not a one-off, so it would have blocked
*every* future push the same way. Fixed by making the GitHub repo public (confirmed via
`gh api repos/TechJaro/website-requirement-dashboard --jq '.private'` → `false`) — this specific
restriction is scoped to private repos, and per the user's choice, made after weighing it against
the other two options (upgrading to Pro, ruled out on cost; or having the user push future changes
under their own identity, workable but adds friction to every round of changes going forward).

## Six-item polish batch + independent per-target statuses (2026-08-27)

Requested together after confirming Attachments v5 worked in production: Requirements Log speed,
a Program Page vs. Landing Page status split, a cropped status modal, two email label renames, a
status-email reorder, and Requirements Log pagination/filters. Also answered: whether status
updates could be driven from the email chain itself (see that section below) — not built, an
assessment only, per what was actually asked.

**Program Page / Landing Page now track fully independent statuses**, superseding the older
single "Status Applies To" tag idea. A row whose Section is the merged `"Program Pages/Landing
Pages"` (`COMBINED_SECTION_LABEL`) gets **two** status controls instead of one
(`perTargetStatusHtml_`, called from `requestStatusSelectHtml_`/`requestStatusBadgeHtml_`), each
writing to its own self-healing sheet column (`"Program Page Status"` / `"Landing Page Status"`,
created on first write via `ensureColumn_` — same self-healing pattern as everything else in this
sheet, no migration script). `openStatusNoteModal_` no longer has an "Applies To" selector at all;
it now takes a `target` ("Program Page" / "Landing Page" / "" for every other section) straight
from which of the two dropdowns was changed, and the modal title reflects it (`Mark Program Page
as "..."`). `targetStatusFallback_` keeps pre-existing rows (which only ever had one shared Status
+ an optional "Status Applies To" tag from the earlier design) displaying sensibly under the new
two-badge UI without a migration: a target's dedicated column wins if present, else it falls back
to the row's old shared Status when "Status Applies To" says that update covered this target (or
wasn't recorded at all — showing it for both is the more honest default than showing neither).
Code.gs's `handleUpdateStatus_` mirrors this: writes to the target's dedicated column when
`body.target` is set, else the shared "Status" column exactly as before.

**Status-update email sender name**: `AUTH_SESSION.name` turned out to just be the login email
(Code.gs's login handlers never populate a real display name) — so `senderName` for the "Message
by {senderName}" heading is resolved client-side against the existing `CONTACTS` array (the same
one the To/CC chip pickers already use), falling back to the raw email if the current user isn't
in that list. Passed through to `updateRequestStatus_` → `handleUpdateStatus_` → `statusEmailHtml_`
as an explicit param; `requesterName` for the "Message by {requesterName}" heading comes straight
off the sheet row's "Requested By" column server-side, no client involvement needed there.

**Requirements Log pagination is server-side, not just client-side** — this is what actually
answers the "taking too much time to load" complaint, not merely the pagination ask. The tab was
re-fetching and re-transmitting *every column of every row* on every visit through the slower
JSONP/Apps-Script transport (unlike the other category tabs, which read their sheet directly via
the Google Sheets API and are fine to fetch in full); a growing log made that payload the actual
bottleneck, not rendering cost. `handleListRequirements_` now applies Support's own-rows
filtering, then optional `month`/`date`/`q` filters, then reverses to newest-first, then slices to
one `pageSize`-row page (default/max requested 20, capped at 100) — and returns `{rows, total}`
instead of the full set. `renderRequirementsTable` drives it with a small pager (`« First / ←
Prev / Page X of Y / Next → / Last »`, same `.pager` markup `renderBlogCards` already established)
and two new filter inputs (`<input type="month">`, `<input type="date">`) inserted into the
existing `.filterbar` alongside the free-text search box — all three re-trigger a fresh
server-side fetch and reset to page 1. The misleading "Sign in with Google if prompted…" loading
copy (never applicable here — this tab authenticates via the dashboard's own session token, not
Google OAuth) is gone, replaced with a plain "Loading…" that now shows on every page/filter
change, not just the first load. Side benefit: the idempotency cache in `dispatch_()` had a
standing comment noting `listRequirements`'s full-sheet payload was sometimes too large to cache
(`CacheService`'s ~100KB entry limit) — a per-page response comfortably fits, so retries on this
action are now actually cached instead of silently falling through to a recompute every time.

**Status modal CSS fix (SS3)** — `.modal` gained `max-height:90vh;display:flex;flex-direction:
column` and `.modal-body` gained `overflow-y:auto;flex:1 1 auto;min-height:0`, so a modal taller
than the viewport (the status modal, especially with the note editor open) keeps its header and
Cancel/Send Update footer pinned in view with only the body scrolling internally, instead of
relying on the whole overlay's own scroll and losing the footer off-screen on shorter windows.

**Email copy (SS4/SS5)** — `requestEmailHtml_`: "Related Link" → "Related Programme Page Link",
"Description" → "Message". `statusEmailHtml_`: "Original Description" → "Message by {requester
name}", "Note" → "Message by {sender name}", and the "New Status" block now renders *after* both
message blocks instead of before.

**Verification**: exercised in the browser preview with `authApiCall_`/`authApiPostCall_` mocked
(no real login/OTP needed for this) — confirmed pagination advances correctly, Month/Date filters
narrow results and reset to page 1, Clear resets all three filters, a non-combined row's modal
shows no target in its title and sends `target:""`, a combined row's Program/Landing dropdowns
open independently with the correct title and send the right `target`, and `senderName` resolves
to the real CONTACTS name ("Lalit Sanjiv Rade") rather than the raw email. The modal CSS fix was
confirmed visually (screenshot) — header and footer stayed pinned with the body scrolling, even at
a viewport far smaller than a real laptop screen. `Code.gs` was syntax-checked with `node --check`
(copied to a `.js` file first — Node refuses the `.gs` extension directly). Not tested against the
live Apps Script backend/real Gmail — that still needs a real redeploy + live click-through.

**Found in passing, not fixed here (flagged as a separate task instead, to keep this batch's diff
scoped to what was asked):** `requestEmailHtml_`'s description block uses `.replace(/\\n/g,
"<br>")` — a regex matching a literal backslash+n, not an actual newline — so multi-line request
descriptions likely lose their line breaks in the "New Request Raised" email. `statusEmailHtml_`'s
equivalent lines use the correct single-backslash `/\n/g`, so this is scoped to just that one line
and pre-dates this batch (not something introduced by today's changes).

**Status updates from the email chain itself — assessed, not built, per what was actually asked.**
Apps Script has no native "a reply arrived" trigger — the two realistic options: (1) a time-driven
trigger (e.g. every 5–15 min) running `GmailApp.search()` for new replies on tracked threads,
parsing out a recognized status keyword from the reply body — real latency (not instant), and
reply-text parsing is inherently a little fragile (typos, quoted-text noise, forwarding). (2)
Unique per-status action links embedded in the status-update email itself (e.g. "Mark Completed"
as a link to the Web App with a signed one-time token) — instant and unambiguous, no parsing, but
it's a click-a-link-that-opens-a-page flow, not "reply to the email" in the literal sense the
question asked. Recommended (2) if the goal is a fast, reliable one-click update, or (1) only if
replying with plain text in Gmail itself is a hard requirement — not started either way pending
the user's pick.

## One-click status updates from the "New Request Raised" email (2026-08-27)

Answers the feasibility question above — built, not just assessed, once the user confirmed they
wanted option (1) (action links) after seeing the write-up. Two small "Mark In Progress" / "Mark
Completed" buttons (four, in two labeled pairs, for a combined Program Pages/Landing Pages
request — one pair per target) now appear at the bottom of the "New Request Raised" email, letting
whoever receives it flip status without opening the dashboard at all. Every other status (At Risk/
Delayed/Terminated/back to Not Started) still requires the dashboard — only the two most common
next-actions get a link, to keep the email from turning into a wall of buttons.

**Mechanism**: a new `ActionTokens` sheet (`Token, Request ID, Status, Target, CreatedAt`) holds
one single-use, 30-day-expiring token per button, generated at request-submission time
(`buildQuickActionLinks_`) and swept opportunistically the same "once per batch" way upload-chunk
cleanup already works in this file. Clicking a link is a bare GET with no session — the token
itself is the only credential, handled by a new branch at the very top of `doGet` (`?quickStatus=
<token>`), entirely bypassing the JSONP/`dispatch_` action-routing path used by everything else.

**Deliberately two hops, not one**: the first GET only renders a branded confirm page ("Mark X as
Completed?") — nothing mutates yet. Only a second GET, from that page's own "Confirm" button
(`&confirm=1`), actually applies the change. A bare single-hop link would silently fire if an email
provider's link-scanner prefetches links straight out of the email body to check them for malware —
a well-known gotcha for any one-click email action — and a scanner has no reason to also crawl the
link found *on* the resulting page. The consume step (re-check-token-then-delete) runs inside
`LockService.getScriptLock()` so a double-click or a client retry on a slow response can't apply
the same update twice or race two concurrent deletes into removing the wrong row after Sheets
shifts everything up by one on the first delete.

**Requests are now looked up by a stable "Request ID" (new column, self-healing via
`ensureColumn_`, a fresh UUID generated at submission time)**, not by raw sheet row number — unlike
the dashboard's own status modal (which always re-fetches a fresh row number right before use),
these tokens can sit unused in an inbox for weeks, long enough for a manual sort/insert/delete in
Google Sheets to quietly invalidate a stored row number. `applyStatusUpdate_` was extracted out of
`handleUpdateStatus_` as the shared core (write the status column, build and send the notification
email) so both this new path and the dashboard's own modal call the exact same logic — they differ
only in *where* their status/target/recipients come from, not in what actually happens.

**Known, accepted trade-off — flagged to the user, not silently shipped**: today, being CC'd on a
request email grants zero capability (you'd still need an actual Admin login to change anything).
With this feature, being on the To/Cc list becomes *sufficient* to flip status via the buttons, no
login or Admin-role check at all — the token itself is the only gate. This matches the existing
design intent of that email (Send-To is already fixed to "whoever should act on this request" —
that's the whole point of the routing), and the blast radius per token is narrow (one specific
status, on one specific request, single-use, 30-day expiry) — but it's a real, if bounded, widening
of who can act compared to today, worth knowing rather than discovering later. Not enforced against
the "Dashboard Users" sheet's actual Admin list, since one shared email body goes to every To/Cc
recipient alike — restricting it per-recipient would need sending different bodies to different
people, a much bigger change than what was asked for here.

**Verification**: syntax-checked with `node --check` only (same limitation as the rest of this
batch — Apps Script itself can't be run outside the actual editor). Not yet exercised end-to-end
against a real deployment; needs a real "raise a request → click a quick-action link → confirm →
verify the sheet and the requester's notification email" pass after redeploying.

## Real bug fixed: Raise a Request modal silently clipped instead of scrolling (2026-08-27)

Caught by the user immediately after the batch above went live. Root cause: the SS3 modal-CSS fix
made `.modal-body`'s scroll depend on being a *direct flex child* of `.modal` (now `display:flex;
flex-direction:column`) — true for every modal in this file except the request form, whose
`.modal-body`/`.modal-foot` sit inside a `<form>`. That `<form>`, being a plain block element, isn't
a flex item's scrollable child of anything — it just rendered at its full natural height, and
`.modal`'s own `overflow:hidden` (there since before this session, for watermark clipping) silently
cut off whatever didn't fit, with no scrollbar at all. Fixed with one more scoped rule, `.modal >
form{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}`, making the
form part of the same flex chain so `.modal-body`'s existing scroll rules finally apply to it.
Verified in the browser (not just visually — scrollTop genuinely moves and sticks). Confirmed via
grep this is the only modal in the file with a `<form>` wrapping its body, so no other modal should
have been affected by the original fix. Lesson: a CSS change scoped to a shared class needs
checking against every structural variant that class is used in, not just the one modal it was
written for. Committed and pushed separately from the batch above (`ba35c71`).

## Quick Actions v2 — login-gated, richer confirm step, Assign to Someone, @mentions (2026-08-27)

The user tried the first Quick Actions build live and asked for real changes once they saw it
working: drop the "In Progress" button (Completed only), restrict who can act to six named people,
attribute the status to whoever actually acted, add an "Assign to Someone" action with a note +
attachments, and separately, let both rich-text editors (request form, status/revert note) @mention
a contact by typing "@Name". This round rebuilds Quick Actions around dashboard login instead of a
bare emailed link, which turned out to be the only way to genuinely satisfy the access-control ask.

**Access control — why the original bare-GET design had to change.** V1's design (a GET link →
confirm page → second GET) had *no way at all* to know who was clicking, by construction — that
was the whole point of it being link-based. The user's requirement ("only these 6 people, and they
should be an active dashboard user — no separate login step") can only be satisfied by a real
session check, and the only place with a real session is the *dashboard*, not this Apps Script Web
App. So Quick Action links now point at `DASHBOARD_URL` (a new Code.gs constant) instead of this
Web App directly; `doGet`'s old `quickStatus` handling is now just `redirectToDashboard_()`, a
one-line bounce carrying the same token to `?quickAction=<token>` on the dashboard. The dashboard
checks the token via two new authenticated actions — `quickActionInfo` (read-only, populates the
confirm modal) and `applyQuickAction` (consumes it) — both gated by `requireQuickActionAllowed_`
(`requireSession_` + a fixed `QUICK_ACTION_ALLOWED_EMAILS` Set: Jasmeet Kaur, Lalit Sanjiv Rade,
Sudesh Jadhav, Chirag Prajapati, Omkar Sharma, Ishaan — mirrored client-side too, for a fast
same-page rejection before the round trip even happens; the *server* copy is the one that actually
matters). No login step is injected into this flow anywhere — if `AUTH_SESSION` is already valid
and allowed, the confirm modal just opens; if not, a toast says so and nothing else happens (see
`maybeHandlePendingQuickAction_`, called once at boot from a `?quickAction=` URL param). This also
let the old two-hop-GET LockService dance be deleted entirely — replaced by the same
lock-then-consume pattern, just triggered from an authenticated POST instead of a bare link click,
which is simpler and was always the more natural fit.

**"Assign to Someone"** is a second kind of Quick Action token (`ASSIGN_ACTION_MARKER = "Assign"`,
a sentinel value in the same `Status` column real statuses use — distinguishable since it's never a
`REQUEST_STATUS_OPTIONS` value), one per request rather than per target. The assign confirm modal
swaps the note-only layout for a free-text "Assign to (email)" field per the user's explicit call
("the assignee will add the email id... not a Contacts dropdown") — deliberately not the CONTACTS
chip-picker used everywhere else. `applyAssignment_` (parallel to `applyStatusUpdate_`) writes a new
self-healing "Assigned To" column and emails the assignee directly (To), CC'ing whoever was already
on the request so the thread stays informed, using a new `assignmentEmailHtml_` template matching
the existing branded shell.

**Richer confirm step**: both Quick Action types (mark-completed and assign) now show a real modal
on the dashboard — not a static Apps-Script-rendered page — with the same rich-text note +
image/PDF attachment capability as the status modal (`openQuickActionModal_`, reusing
`wireRichTextEditor` verbatim). This was the natural consequence of routing through the dashboard
for login anyway: the existing note/attachment machinery was just sitting right there to reuse,
rather than needing a hand-rolled upload form inside a constrained `HtmlService` page.

**Attribution** ("New Status should mention who marked it via Quick Actions") falls out of the same
login requirement — `senderName` is resolved from `AUTH_SESSION.email` against the dashboard's own
`CONTACTS` list (same resolution `openStatusNoteModal_` already uses) and threaded through to
`statusEmailHtml_`'s existing "Message by {sender name}" heading — no separate mechanism needed.

**@mentions** — `wireRichTextEditor` gained inline `@Name` autocomplete (matching `CONTACTS`),
wired into both the request form's description and the status modal's note field via a new
`ccPicker` config option. It's a *getter function* (`ccPicker: ()=>ccPicker` /
`ccPicker: ()=>statusNoteCcPicker`), not the picker instance itself — at the point
`wireRichTextEditor` is actually called, neither module-level chip-picker variable has been created
yet (both are lazily created on that modal's first open, same as the RTE itself), so passing the
live value directly would capture `undefined` forever. Detection triggers on an "@" not immediately
preceded by a letter/digit (so typing a real email address inline, e.g. replying with someone's
address in the text, never falsely opens the dropdown), and picking a match inserts a styled
non-editable `<span class="rte-mention">` chip *and* adds that person to the editor's CC list —
mentioning someone in text they'd never otherwise see wouldn't actually reach them by itself.
`createChipPicker` gained an `add` method on its returned object (previously only `get`/`reset`)
for this to call. Not wired into the Quick Action modal's own note field — it has no associated CC
picker to add to, and wasn't part of what was asked ("for request and revert both").

**Real bug found and fixed during this round's testing, unrelated to the features above**: the
Requirements Log pagination buttons (`renderRequirementsTable`, from the SS6 batch this session)
called a `scrollToTop()` that doesn't exist in that function's scope — it's a *local* helper
private to `renderBlogCards`/the Combined Insights renderer, not a shared/global function, so every
Prev/Next/First/Last click threw `ReferenceError: scrollToTop is not defined`. Missed the first time
because that round's testing only checked pagination *state* by calling `draw()` directly, never
actually clicked the real buttons. Fixed by adding the same one-line local `scrollToTop()` inside
`renderRequirementsTable` too. Caught by clicking the actual buttons this round, not by re-reading
the code — a reminder to always exercise the real event-wired path, not just the state it produces.

**Verification**: all of the above tested end-to-end in the browser with `authApiCall_`/
`authApiPostCall_` mocked — pagination buttons (all four, via real clicks, confirming the fix
above), @mentions in both editors (dropdown appears on "@Name", stays hidden while typing a plain
email address, selecting a match inserts the chip and adds the CC), and all three Quick Action
paths (mark-completed modal, assign modal with its email-required/valid-format guards, and both the
"wrong person" and "not logged in" rejection paths) — zero console errors across the whole pass.
`Code.gs` syntax-checked with `node --check`. Not tested against the live backend/real email
delivery — needs a real click-through after redeploying.

## Assign-to suggestions, "Not Applicable" status, Admissions-type exclusion (2026-08-27)

Three follow-ups after the user tried Quick Actions v2 live: the OAuth `origin_mismatch` error on
Page + SEO Insights turned out to be unrelated to any of this (a stale Google Cloud OAuth client
still scoped to an old Vercel domain from before the tech@jaro.in migration — needs a Cloud Console
fix, not a code change, so not touched here). Three real changes:

- **Assign to Someone now suggests from Contacts** while typing (`<input list="qaAssigneeList">` +
  a `<datalist>`, same native-HTML pattern the request form's Subject field already uses) — still
  free text, not restricted to the list, per the earlier explicit call that this shouldn't be a
  Contacts-only picker.
- **New "Not Applicable" status**, added to `REQUEST_STATUS_OPTIONS`/`REQUEST_STATUS_COLORS`
  (muted gray, distinct from every real in-progress-style color) — selectable anywhere Status is,
  not tied to anything specific.
- **Open Admissions / Close Admissions never apply to Landing Pages.** These two request types only
  ever concern the Program Page (there's no such thing as a Landing Page "admissions" status) — a
  combined-section request of either type now locks its Landing Page slot to a read-only "Not
  Applicable" badge (`perTargetStatusHtml_`'s new `landingNotApplicable` branch) instead of an
  editable dropdown, and `buildQuickActionLinks_` (Code.gs) skips generating a Landing Page
  "Mark Completed" quick-action token/button entirely for these — mirrored via a matching
  `ADMISSIONS_ONLY_PROGRAM_TYPES` Set on both sides, same "must match" pattern already used for
  `COMBINED_SECTION_LABEL`. Every other request type is unaffected — both targets still get their
  own independent, fully editable status and quick-action button.

**Verification**: rendered `requestStatusSelectHtml_` directly against a mock combined-section row
for both an Open Admissions type (confirmed: Landing Page renders as a static "Not Applicable"
badge, not a `<select>`; Program Page still renders as a normal editable dropdown whose options
include the new "Not Applicable" choice) and a normal type (confirmed: both targets still render as
editable dropdowns, unaffected). `Code.gs` syntax-checked with `node --check`. The quick-action-link
side of this (buildQuickActionLinks_ skipping the Landing Page button) was reviewed but not
independently exercised in a live email — same "needs a real click-through after redeploying"
caveat as everything else Quick-Actions-related this session.

## "Notify" — an FYI action that isn't a request (2026-08-27)

New button in the request form, next to Submit Request: same form, same fields, same rich-text/
attachment/@mention capability, but submitting via "Notify" does *not* create a Requirements Log
row — no Status, no Quick Actions on the email (nothing to mark complete for an FYI). Admin/Super
Admin only: the button is hidden client-side for Support (`applyRoleGating_`) and `Code.gs`'s
`handleSubmitNotification_` requires `requireAdmin_` too, so it can't be reached by a raw API call
either. Always broadcasts to every current Admin/Super Admin account — resolved fresh from the
Dashboard Users sheet each send (`Role === "Admin" && Status === "Active"`), not the section-fixed
"Send To" the request form otherwise shows, per explicit instruction that this goes to the whole
admin team regardless of section. Still logged to its own new "Notifications" sheet (self-created
via `getOrCreateSheet_`) purely as an audit trail — never surfaced anywhere in the dashboard UI.
Reuses `requestEmailHtml_` as-is (just a different heading, "Program Notification") rather than a
new template, and reuses the exact same attachment/Gmail-send pipeline as a real request.

Also added `meghna.l@jaro.in` ("Meghna") to `CONTACTS` — she now shows up everywhere that list is
used (To/CC pickers, @mention autocomplete, Assign to Someone's suggestions).

**Verification**: confirmed in the browser that the button is hidden for a Support session and
visible for Admin, and that clicking it (with the full form filled in) builds the correct payload
with no `to` field (recipients are resolved server-side, not client-side) and the right `cc`/
message/attachments shape. Confirmed Meghna resolves correctly from `CONTACTS`. `Code.gs`
syntax-checked with `node --check`. Not tested against the live backend — needs a real send after
redeploying to confirm the "all current Active Admins" recipient resolution actually pulls the
right list from the real Dashboard Users sheet.

## Request email fixes for every category except Program Pages/Landing Pages (2026-08-31)

User caught these from a real delivered B2B Pages request email. All four fixes are scoped by the
same two lists (`SECTIONS_NO_UNI_PROGRAM`/`SECTIONS_UNI_ONLY`) the request form itself already used
to show/hide the University/Program fields — now mirrored into `Code.gs` too (same "must match"
comment pattern as `COMBINED_SECTION_LABEL`), so the email always matches what the form actually
collected instead of assuming every request looks like a Program/Landing Pages one.

1. **"Related Programme Page Link" → "Related Link"** for every section except the combined
   Program Pages/Landing Pages one (that's the one case where "programme page" is actually
   accurate). Applied to `requestEmailHtml_`, `statusEmailHtml_`, and `assignmentEmailHtml_` — all
   three had the same hardcoded label.
2. **University/Program rows are omitted from the email** for a section that doesn't show that
   field on the form (`SECTIONS_NO_UNI_PROGRAM` hides both; `SECTIONS_UNI_ONLY` hides just Program)
   — previously always rendered both rows, showing "—" for a field that was never collected. Same
   three functions.
3. **@mentions now render as blue text in the actual delivered email**, not just inside the
   dashboard's own editor. The mention span only had a CSS class (`.rte-mention`) — that's fine
   in-app (the dashboard's stylesheet is loaded), but an emailed message is a standalone HTML
   document with no access to that stylesheet, so the class silently did nothing once delivered.
   Fixed by giving the span an inline `style="color:#0029A6;font-weight:600"` too (same blue as
   every other email template), and simplified the look from a filled pill (background + padding)
   to plain colored bold text — closer to what was asked ("similar to our Gmail") and more
   consistently supported across email clients than a pill.
4. **Subject line now includes the section for every category except Program/Landing Pages**:
   `{Type} - {Section} - {Title}`, where Title is University for `SECTIONS_UNI_ONLY` or Program for
   everything else (`buildRequestSubject`, rewritten). Program/Landing Pages keeps its original,
   untouched University+Program format. Wired the section dropdown's own `change` handler to also
   call `maybeSuggestSubject()`, so picking a section updates the live subject suggestion the same
   way editing University/Program/Type already did.

**Real bug found and fixed while verifying #4**: a Program title passed through from a specific
page's own "Raise a Request" button (`raiseBtn()` → `openRequestModal({section, program})`, e.g.
opening it from a B2B page's own card) was being silently wiped by `updateUniProgVisibility()`
immediately after being set — that function unconditionally cleared University/Program whenever
the section hides them, with no distinction between "the user could have typed something here
before switching" (should clear) and "this value was locked in as part of why the modal opened at
all" (should survive, even though the row is hidden — it's still what the subject's Title needs).
Fixed by only clearing a field when it isn't `disabled` — a locked/prefilled field keeps its value
invisibly, an editable one gets cleared same as before. Without this, item 4 above could never
actually produce a title for a `SECTIONS_NO_UNI_PROGRAM` category no matter how the subject-builder
was written, since the value feeding it would already be gone by submit time.

**Verification**: `buildRequestSubject` tested directly against the user's own two examples — both
matched verbatim (`"[Jaro Dashboard] Update Existing Page - B2B Pages - IIFL"` and `"...Content /
Meta Change - University Pages - Amity University"`), Program/Landing Pages' format confirmed
unchanged, and a no-title fallback confirmed clean (no dangling separator). Confirmed in the
browser: a card-prefilled B2B request keeps its Program value (disabled, hidden, but present) and
produces the correct subject; a fully generic form switching to B2B correctly clears a manually-
typed Program value instead of leaking it through hidden. Confirmed the mention span carries the
inline style after insertion. `Code.gs` syntax-checked with `node --check`. The email-template
side (rows/label conditionals in Code.gs) was reviewed carefully but — same as everything else
Code.gs this session — not exercised against a real send; needs a real request raised against a
non-Program/Landing category after redeploying.

## Real bug fixed: status updates could silently leave the requester off the email (2026-08-31)

Caught by the user from a real Quick Action use: Nidhi raised a Program/Landing Pages request, it
went to Lalit+Jasmeet (the fixed admin recipients for that section — see `fixedRecipientsFor_` on
the dashboard), and when Lalit marked it Completed via Quick Actions, the status email went to
"me and Jasmeet" again — Nidhi, the actual requester, was never on it.

Root cause: `applyStatusUpdate_`'s recipient fallback was `explicit-to || row's-stored-To ||
requester`, in that priority order. For Program/Landing Pages the row's stored "To" is *always*
the fixed admin team (never the requester — she was never on the original request's To/Cc to begin
with, only the "Email"/"Requested By" columns), so the fallback chain never reached the requester
at all once a row's own To was non-empty, which is the normal case for every request in this
system. This wasn't new to Quick Actions — the dashboard's own status modal had the exact same gap
— just far less likely to surface there, since that modal's Send To field starts pre-filled with
the requester's email as one of its options (still overwritable, but visible and easy to leave in
place); Quick Actions has no such modal, so there was never a chance to notice or correct it.

Fixed by always including the requester in the final recipient list, appended if not already
present, regardless of which of explicit-to/row's-To/fallback-to-requester produced the rest of the
list — verified against four cases (Quick Action with the admin-team row To, a dashboard-modal
explicit To missing the requester, one already including her, and no row To at all) with a
standalone simulation of the merge logic; all four produced the expected list with no duplicates.

## CC field added to the Quick Action confirm modal (2026-08-31)

Companion request from the same conversation: "additionally" CC extra people when marking a status
or assigning from Quick Actions, matching the dashboard's own status modal (which already has this
— `statusNoteCc_picker`, unchanged). New `qaCc_picker` chip-picker in `openQuickActionModal_`
(same `createChipPicker` component, same markup, as every other CC field in this file), wired into
the note's rich-text editor for @mention-adds-to-CC too, same as the other two editors.

Threaded through as `body.cc` → `handleApplyQuickAction_`. Merged additively, not as a replacement,
on the *backend* rather than relying on the modal to pre-fill the row's existing Cc (it doesn't —
unlike the dashboard's own status modal, there's no "open a specific row" moment to pre-fill from):
`applyStatusUpdate_`'s own cc parameter still means "this is the final Cc list" as it always has
(the dashboard modal already sends the row's Cc pre-filled as chips, so that contract didn't need
to change), so `handleApplyQuickAction_` computes `row's Cc + typed extra` itself before calling
it. `applyAssignment_` already unconditionally included the row's To+Cc in its own Cc line, so it
just needed the extra list appended to that same join — genuinely a smaller change there.

**Verification**: confirmed in the browser that the CC field renders, that typing/adding an email
lands in the `cc` array of the `applyQuickAction` POST body, and that mentioning someone in the
note (`@Meghna`) also adds them as a CC chip, exactly like the request form and status modal
already do. The backend merge logic was reviewed carefully (not independently unit-tested — no
harness for that here) but not exercised against a real send. `Code.gs` syntax-checked with
`node --check`.

## Category column, "On Hold" status, and an admin-only send-email toggle (2026-08-31)

Three more from the same conversation:

- **Category column** in the Requirements Log table — shows `row["Section"]` (the same value
  already used for per-target routing/exclusions elsewhere), between Program and Type.
- **"On Hold"** added to `REQUEST_STATUS_OPTIONS`/`REQUEST_STATUS_COLORS` (purple, distinct from
  every other status color) — frontend-only, `Code.gs` has never had its own copy of this enum
  (statuses are just free-text values it writes as-is).
- **"Send email notification" checkbox**, Admin/Super-Admin-only, in both places a status gets
  marked: the dashboard's own status modal and the Quick Action confirm modal. Lets an Admin record
  a status (e.g. Not Applicable) without notifying anyone, when that's not actually needed. Not
  shown at all for Assign to Someone specifically — an assignment with no notification would never
  reach the person it's assigning, defeating the entire point of that action.

**Enforcement is asymmetric between the two entry points, deliberately**: `handleUpdateStatus_`
trusts `body.sendEmail` directly, since `requireAdmin_` already guarantees the session's Role is
"Admin" before that point is ever reached. `handleApplyQuickAction_` can't do the same —
`requireQuickActionAllowed_` only guarantees the session's email is on the fixed Quick Actions
allowlist, not that it's actually an Admin-role account — so it only honors `sendEmail:false` when
`session.Role === "Admin"` too, silently ignoring the request (email still sends) otherwise. Failing
open to *sending* the email is the deliberately safe default if this check is ever wrong, rather
than an update going out silently un-notified.

`applyStatusUpdate_` gained a `sendEmail` parameter — still writes the status regardless, only
skips building/sending the notification (returns `{ok:true, debug:"email skipped by request"}`).
The dashboard modal's own "Add at least one recipient" validation is skipped when the checkbox is
unchecked, since it's meaningless once nothing is going to be sent — and the modal's subtitle text
flips to "No email will be sent — only the status will be updated" so what's about to happen is
never ambiguous from what's already on screen.

**Verification**: confirmed in the browser — the Category column renders with the right value in
the right position; "On Hold" appears as a real dropdown option; unchecking "Send email
notification" in the status modal updates the subtitle live and doesn't block submission on an
empty Send To; the Quick Action modal shows the checkbox for a status mark and omits it entirely
for Assign to Someone; both modals correctly produce `sendEmail:false` in their POST payload when
unchecked. The Role-gate logic in `handleApplyQuickAction_` was checked with a standalone
simulation of all four cases (Admin skip honored, non-Admin skip ignored, omitted defaults to
send, explicit true sends) — all four behaved as intended. `Code.gs` syntax-checked with
`node --check`; not exercised against the live backend.

## Real bug fixed: a requester's rich-formatted message lost all formatting in status-update emails (2026-08-31)

Caught by the user from a real reply: Meghna's original request had a genuinely formatted message
(a table for the instalment plan, colored highlight spans, bold headers) that rendered perfectly in
the "New Request Raised" email — but the same content, re-shown under "Message by Meghna" in the
*status-update* email once Lalit marked it Completed, came out as flat, unstyled text with no table
and no highlights at all ("scattered").

Root cause: the Requests sheet's "Description" column only ever stores *plain text*
(`payload.descriptionText`, i.e. `.innerText` off the rich-text editor) — the rich HTML version
(`payload.descriptionHtml`) is built fresh at submission time and used once for the original email,
then thrown away, never written anywhere. `requestEmailHtml_` (the original email) never hit this,
since it uses `payload.descriptionHtml` directly while it's still fresh in memory. `statusEmailHtml_`
has no such luxury — by the time a status gets updated, possibly weeks later, all it has to work
with is whatever's in the sheet, which was always plain text only.

Fixed by also storing the rich HTML in a new self-healing "Description HTML" column (same
post-append `ensureColumn_` pattern already used for "Request ID"), and having `statusEmailHtml_`'s
`descriptionBlock` prefer it when present — the *exact* same "HTML if we have it, else escaped
plain text" fallback `requestEmailHtml_` already uses for the same content. Rows raised before this
existed simply don't have the column populated, so they fall back to plain text exactly as before —
no migration, no data loss, nothing silently breaks for old rows.

**Verification**: reviewed the full fallback chain carefully (matches `requestEmailHtml_`'s already-
proven pattern token-for-token) and confirmed `get("Description HTML")` returns `undefined` safely
(not a crash) for a row/sheet where that column doesn't exist yet, correctly falling through to the
plain-text path. `Code.gs` syntax-checked with `node --check`. This is backend-only — no frontend
change was needed (the frontend already sends `descriptionHtml` at submission time; it just wasn't
being kept). Not exercised against a real send — needs a real request with genuine rich formatting
(a table, a highlight) marked through a real status update after redeploying, to confirm the email
actually renders it now.

## Request form: stop showing yourself as a recipient, "Other" section/type, narrower required fields (2026-08-31)

Four request-form fixes, all frontend-only — `Code.gs` untouched this round, no redeploy needed.

**Send To no longer includes yourself.** `updateSendToForSection_` used to populate Send To purely
from `fixedRecipientsFor_(section)` with no awareness of who was actually logged in — so Lalit
raising a Program/Landing Pages request saw "Send To: Lalit Sanjiv Rade, Jasmeet Kaur", i.e.
himself. Now filters the current user's own email out of that list; if that would leave nobody at
all (true for every section except Program Pages/Landing Pages, where Lalit is the *sole* fixed
recipient), falls back to the other established admin (Jasmeet) rather than leaving Send To empty
and blocking submission. `resetRequestForm`'s own post-submit reset had the identical bug in
miniature — it hardcoded Send To back to Lalit's email regardless of who'd just submitted — now
resets to empty and lets the next `openRequestModal`/section pick repopulate it correctly.

**"Other" added to both Related Section and Request Type**, each revealing an optional free-text
field (`rf_section_other`/`rf_type_other`) when selected. The typed text becomes the actual stored
section/type if provided; left blank, it falls back to the literal word "Other" rather than
blocking submission — matches the same "optional elaboration" framing as this batch's other
"Other" field. `resetRequestForm` explicitly hides both on reset, since native `form.reset()` only
clears values, not the inline `display` state this file manages by hand for conditional fields.

**University/Program are only actually required for Program Pages/Landing Pages now** — every
other section that still shows them (University Pages' University field, "General / Not sure", or
"Other") can be submitted blank. The required-asterisk spans next to each label
(`rf_university_req`/`rf_program_req`) toggle alongside this in `updateUniProgVisibility` (already
the one place this file computes per-section field behavior), so the visible `*` never lies about
what's actually enforced.

**Verification**: all four checked directly in the browser — Send To correctly drops Lalit for
Program/Landing (leaving Jasmeet) and falls back to Jasmeet for a section where he's normally the
sole recipient; the same in reverse for Jasmeet; unaffected for a third party (Nidhi) raising the
same request, confirming the fix is scoped to "exclude yourself," not a broader behavior change.
"Other" reveals its text field for both Section and Type; a full submission with both left blank
correctly falls back to the literal word "Other" with University/Program submitted empty and
unblocked; a second submission with both filled in correctly used the typed custom text instead.
No `Code.gs` changes this round.

## Notifications Log — a real page for the Notify audit trail (2026-08-31)

"Notify" (added earlier this session) always wrote to its own "Notifications" sheet, but that was
deliberately audit-only at the time — nowhere in the dashboard actually showed it. The user asked
for that to be viewable, so it's now a real nav item and page, modeled closely on Requirements Log
(same server-side pagination/Month/Date-filter pattern, same reasoning: this goes through the
slower Apps Script/JSONP path, not a direct Sheets API fetch) but simpler — no Status column, no
per-target tracking, no Quick Actions, since a notification was never a trackable request to begin
with. Columns: Sent, University, Program, Category, Type, Priority, Sent By, Subject.

**New nav item** "Notifications Log" (`data-nav="notificationsLog"`, `id="notificationsNavItem"`),
sitting right under Requirements Log in the same "Requests" group, gated the same way as "Users":
hidden client-side for Support (`applyRoleGating_`), a redirect-home if `currentRoute` is
`notificationsLog` while gating re-applies for a non-Admin (same limited scope as the equivalent
"users" check — this only actually fires on a view-mode/login transition, not on every navigation;
see below), and — the check that actually matters regardless of how the route was reached —
`renderNotificationsLog` itself refuses to show real content for a non-Admin, same as
`renderUsersTable` already does. Added to `SECTIONS` (`type:"notifications-table"`) and routed
through the same generic `sec.type` switch in `navigate()` that Requirements Log already uses,
rather than a `route === "notificationsLog"` special case like "users" gets (that one predates
having its own `SECTIONS` entry at all — this one has one, so the generic path is the correct fit).

**Backend**: new `handleListNotifications_` (Code.gs), `requireAdmin_`-gated, reading/paginating/
filtering the "Notifications" sheet — token-for-token the same shape as `handleListRequirements_`,
minus the per-Support-account row filtering (a notification was never scoped to a particular
requester's own visibility in the first place, so there's nothing to filter by requester here).
New `listNotifications` dispatch case.

**Verification**: confirmed in the browser — nav item hidden for a Support session; navigating
there anyway as Support renders "Admins only" (not real data) via `renderNotificationsLog`'s own
defensive check, independent of whether the route-level redirect happened to fire; as Admin, the
page renders with the right headers and correct row/count data from a mocked `listNotifications`
response, and the Month/Date filters, Clear button, and pager are all present and wired the same
way Requirements Log's already-proven versions are. `Code.gs` syntax-checked with `node --check`.
Not exercised against the live backend/real Notifications data — needs a real "send a Notify, then
check it shows up in the new log" pass after redeploying.

## Real bug fixed: Blogs showed a raw date serial number instead of a real date (2026-09-04)

User caught this from the Blogs page — cards showed "46268" instead of a date. Root cause: the
Google Sheets API (`loadSheetViaApi`, `valueRenderOption=UNFORMATTED_VALUE`) returns a genuine Date
cell as its raw serial number (days since 1899-12-30), and `parseRowsToObjects` stringifies every
cell uniformly (`.toString().trim()`) when building row objects — so by the time
`row["Published Date"]` reaches anywhere else, it's already the literal text `"46268"`, not a
number and not a real date string. `renderBlogCards` was just `.slice(0,10)`-ing that text, which
for a 5-character string is a no-op — hence showing the serial verbatim.

This exact bug class already had a fix elsewhere in the file — `formatClosureDate_` (used for
"Application Closure Date" and the News banner's date) already detects a bare-integer string in a
plausible date-serial range and converts it back to a real date. `Published Date` in
`renderBlogCards` just wasn't using it. Now it does. Also fixed the sort: it was comparing
`Published Date` with `.localeCompare()`, which sorts a *formatted* date string like "13 Jul 2026"
as plain text — not chronological order (`"1 Jan 2027"` would sort before `"13 Jul 2026"` in "at
least it doesn't crash" terms once formatted, but never actually in real date order). New
`sheetDateSortValue_` — same serial-detection logic as `formatClosureDate_`, but returns a real
numeric timestamp instead of a display string, since the sort comparator needs something orderable,
not something readable.

**Verification**: `formatClosureDate_("46268")` confirmed to return `"3 Sept 2026"` (and `"46267"`
→ `"2 Sept 2026"`, one day earlier, correctly sequential); `sheetDateSortValue_` confirmed to order
those two correctly; a non-numeric value confirmed to pass through unchanged (no regression for a
column that's genuinely text); rendered `renderBlogCards` end-to-end against two mock rows with
serial-number "Published Date" values and confirmed both the displayed date *and* the sort order
(newest first) were correct together. Grepped the rest of the file for the same
`.toString().slice(0,10)` / raw `.localeCompare()` pattern against a sheet-API field — nothing else
turned up affected; every other `.slice(0,10)` site operates on a real JS `Date`/ISO-string value,
not a raw sheet cell. Frontend-only, no `Code.gs` changes.

## New feature: date/month/year filter for Blogs (2026-09-05)

User wanted to be able to search the Blogs page by date, not just free-text/category — "I should be
able to search via date, month and also by year. any of these filter should work." Added three
independent filter controls to `renderBlogCards`, each optional and freely combinable (all active
ones AND together): an exact-date `<input type="date">`, a `<input type="month">`, and a `<select>`
populated dynamically from every year actually present in the data (so it never offers a year that
couldn't match anything — a row with no usable "Published Date" is simply excluded from the list,
not shown as an empty/blank option). All three reuse the same `sheetDateSortValue_` serial-detection
helper added for the earlier raw-date-serial-number fix, so a real sheet Date cell (arriving as a
bare integer string like `"46268"`) is converted to a real timestamp before any comparison — the
filters work correctly against the actual sheet data shape, not just already-formatted strings.
Added a "Clear Dates" button that resets all three fields and re-draws in one click.

**Bug caught before shipping**: the "Clear Dates" button's element was created via
`document.createElement("button")` with `type`/`className`/`textContent` set, but — unlike the
three filter inputs, each of which got an explicit `.id` — the button itself never received one.
The click handler was still correctly attached directly to the in-memory element reference
(`clearDatesEl.addEventListener("click", ...)`), so a real mouse click in the actual rendered page
would have worked regardless; but anything looking the button up by ID (`getElementById`, browser
automation, a future test) would silently get `null` and no-op. Added `clearDatesEl.id =
"blogDateFilterClear"` to match the pattern already used for the other three controls.

**Verification**: tested end-to-end in the browser against the real live Blogs data (2,622 actual
articles from the Google Sheets API, not mocked) via the `static-preview` launch config. Confirmed:
Year dropdown lists real years present in the data (2026, 2025, 2024, 2023, …); selecting a Date
narrows to the exact matching articles; selecting a Year alone narrows correctly (2,622 → 501 for
one tested year); adding a Month on top of that Year narrows further (501 → 31), confirming the
three filters combine with AND logic rather than overriding each other; clicking "Clear Dates" (by
ID, post-fix) resets all three fields to empty and restores the full 2,622-article count in one
click. Frontend-only change — no `Code.gs` involvement, so no backend redeploy needed for this
feature specifically. `index.html` resynced from `Unified Dashboard.txt` (copied wholesale, diff
confirmed identical) — not yet committed/pushed as of this writing, pending the user's explicit
go-ahead per this session's standing safety rule.

## New feature: "Loop In" — add a missed CC recipient after the fact (2026-09-05)

User wanted a way to fix "I forgot to CC someone" *after* a request or notification was already
sent, from the Requirements Log / Notifications Log tables specifically — explicitly **not** from
the raise-a-request form itself (that already has its own Cc field at submit time). Added a small
person-add icon button in a new "Actions" column on both tables. Clicking it opens a focused modal
(chip-picker CC field + optional rich-text note, reusing the same `wireRichTextEditor`/
`createChipPicker` machinery as the status-update modal, including @mention support) that shows who
is already on the thread (read-only context, not editable/removable — the action only ever adds).

**Backend** (`Code.gs`): new `handleLoopInRecipients_` (dispatch action `loopInRecipients`) looks up
the row in either the Requests or Notifications sheet by `sheetRow`, merges the newly-picked emails
into the row's stored Cc (deduped, case-insensitive), and sends those new people an immediate email
— threaded into the existing Gmail thread when one's on record, same `sendGmailMessage_`/threading
path every other email in this system uses — carrying the original request/notification's full
context (new `loopInEmailHtml_`, modeled on `statusEmailHtml_`, minus a "Related Link" row for
Notifications since that source never had that field to begin with). Access control: Notifications
Log is Admin-only end to end already (page + `handleListNotifications_`), so looping in on a
notification requires `session.Role === "Admin"`; a request row additionally lets a non-Admin loop
someone in on **their own** request only, mirroring the exact same ownership check
`handleListRequirements_` already applies when deciding what a Support session can even see — so
this can't be used to reach into someone else's request by guessing a row number.

**Verification**: syntax-checked with `node --check`; tested in the browser against mocked
Requirements Log and Notifications Log rows (the real backend doesn't have this action yet, so a
live call would correctly fail until redeploy) — confirmed both tables render a 9th "Actions"
column with a working button carrying the right row/email/To/Cc data, the modal correctly shows
"Already on this thread: …" from that row's real To+Cc, empty-CC submission is blocked client-side
with a toast, and a real submission (CC picker + note) builds the exact expected
`loopInRecipients` payload (`source`, numeric `sheetRow`, `cc` array, `noteHtml`/`noteText`,
`senderName` resolved via `CONTACTS`) for both `source:"request"` and `source:"notification"`.

## Real bugs fixed: requester missing from their own request email; sender identity unclear (2026-09-05)

User raised a request from their own account (lalit.rade@jaro.in) and never received a copy of it,
even though everyone else on the request got it — and separately noted the email always shows as
being from tech@jaro.in regardless of who actually raised the request.

**Requester exclusion**: `handleSubmitRequest_` built its "To" list purely from `payload.to` (the
dashboard's fixed per-section recipients, e.g. the admin team) with no guarantee the requester's
own address was ever in it — and the dashboard's own "Send To" picker (`updateSendToForSection_`)
deliberately excludes whoever's currently logged in from those fixed recipients (fixed earlier this
project so people didn't see themselves listed oddly in their own "Send To" field). Combined, that
meant anyone who is *also* part of a section's fixed recipient team (as Lalit is) would never get a
copy of their own submission — the exact same bug class already fixed for the status-update email
(`applyStatusUpdate_`'s "always append the requester if missing" rule) had never been applied to
the *original* "New Request Raised" email. Now it is — same rule, same place it was missing.

**Sender identity**: every email this system sends is technically forced through tech@jaro.in — the
account the Apps Script project is deployed to run as (a 2026-08 ownership migration) — because
Gmail only lets a message truly originate from an address the sending account owns or has verified
as a "Send As" alias, which isn't configured for individual staff here. That's a Workspace-level
constraint, not something fixable in code. What *is* fixable: `sendGmailMessage_` (used by all four
outgoing email paths — new request, notification, status update, assignment) now accepts an
optional `fromName`/`replyTo`, so the display name shows the real person (e.g. "Lalit Rade" instead
of the generic "Jaro Web Pages Dashboard") and a `Reply-To` header routes a reply straight to them
instead of the shared tech@jaro.in inbox — even though the technical From: address is unchanged.
Applied consistently to all four send sites, not just the one that was reported, since they all
share the exact same tech@jaro.in characteristic.

**Verification**: syntax-checked with `node --check`. Traced `handleSubmitRequest_`'s new "To"-list
logic by hand against the reported scenario (Lalit raising a request against a section where he's
also a fixed recipient) — confirms his own address is now always appended if the picker excluded
it. Every `sendGmailMessage_`/`applyStatusUpdate_`/`applyAssignment_` call site updated to pass
`fromName`/`replyTo` (or `senderEmail`/`assignerEmail` through to it) — grepped for all call sites
of both functions to confirm no caller was missed. Not exercised against the live backend (needs
redeploy first) — the next real request Lalit raises after redeploying should confirm both: he
receives a copy, and the email's From name reads as his own name rather than just the dashboard's.

The above batch (Loop In + the two email fixes, plus the Blogs date filter before it) was committed
and pushed as `975359d` on 2026-09-05, after the user redeployed `Code.gs`. Confirmed live: hit the
Vercel-deployed `index.html` directly (the new Loop In functions/icon are present) and posted a real
`loopInRecipients` call straight to the Apps Script exec URL (got back a session error, not "Unknown
action" — confirms the backend redeploy picked up the new dispatch case).

## New feature: Notification Activity graphs on Home (2026-09-05)

User noticed the Home page's "Request Activity" section (Requests by Requester / Requests by Page)
only reflects the Requirements Log — Notify broadcasts weren't represented anywhere on Home. Added a
parallel "Notification Activity" section directly below it (same Admin-only gating, same
"live from the [X] Log" meta line), with its own two panels: "Notifications by Sender" and
"Notifications by Page" — same segmented-bar-plus-legend visual, same click-a-slice-to-drill-down
behavior, same search-any-page box, as the existing Requests panels. Deliberately a **separate**
section rather than merging notification counts into the existing Requests bars — Notify has been
kept a distinct, non-trackable concept from a real request everywhere else in this project (its own
sheet, its own "Notifications Log" nav page, its own audit trail), so folding its counts into
"Requests by Requester" would have quietly blurred that line instead of just surfacing the data that
was missing.

**Implementation**: new `renderNotificationActivity()` (Unified Dashboard.txt), a near-exact mirror
of the existing `renderRequesterActivity()` but reading `listNotifications` instead of
`listRequirements`, grouping by `Sent By`/`Email` and by University+Program same as before, and
reusing the same generic `renderBreakdownBars_`/`wirePageSearch_`/`openInsightListModal` helpers
that already power every other breakdown panel on Home — no new UI primitives needed. Wired into
`renderHome()` alongside the existing `renderRequesterActivity()` call (Admin-only), and into
`applyRoleGating_` so the new section hides for a Support session exactly like the Requests one does.

**Bug caught and fixed before shipping**: `wirePageSearch_` (the "search any of the N pages" box
under a "by Page" panel) hardcoded the word "request"/"requests" in both the per-option count label
and the drill-down modal's title — harmless while it only ever served the Requests panel, but wrong
once reused for Notifications (a searched Notifications page opened a modal titled "Requests — …").
Fixed by adding a `noun` parameter ("request" or "notification") that both the pluralized count label
and the modal-title prefix now derive from, with the original Requests-by-Page call site passing
"request" explicitly so its behavior is unchanged.

**Verification**: syntax-checked with `node --check`. Tested in the browser with mocked
`listNotifications` data (3 notifications, 2 senders, 2 pages) — confirmed the bar/legend counts
match, clicking a sender slice opens a correctly-titled drill-down modal listing that person's exact
notifications (subject + date), and — the specific bug above — searching a page in the Notifications
panel now opens a modal titled "Notifications — …" with a correctly-pluralized option label, while
re-testing the original Requests-by-Page search alongside it confirmed that one still reads
"Requests — …" exactly as before (no regression from the shared-helper change). Confirmed the new
section's `display` toggles correctly between an Admin and a Support session via `applyRoleGating_`.

## Immediate next action

This Notification Activity feature is frontend-only (no `Code.gs` changes) — built and verified but
**not yet committed or pushed**. Ask the user explicitly before running any git commands. `index.html`
was resynced from `Unified Dashboard.txt` (copied wholesale, diff confirmed identical). Both the
`C:\Users\user\Downloads\Website Requirement Dashboard` and `D:\JARO EDUCATION - LALIT\Website
Requirement Dashboard` copies need this same sync — only the Downloads copy was edited this round.
