/* ================================================================================================
   JARO WEB PAGES DASHBOARD — BACKEND (Apps Script)
   ================================================================================================
   This replaces/extends whatever Code.gs you already had deployed at the Web App URL that's
   currently pasted into CONFIG.requestForm.webAppUrl / CONFIG.authApiUrl in the dashboard file.
   It now handles FOUR things, all under one roof so real emails always send from Jaro's own
   authorized Gmail account — nobody using the dashboard ever has to grant their own Google OAuth
   consent just to log in, submit a request, or have a status update emailed back to them:

     1. LOGIN — email + password, then a 6-digit code emailed to that address (OTP).
     2. USERS — an Admin account (seeded once, see setupAdmin() at the bottom — RUN THIS ONCE)
        and any number of Support accounts, which an Admin adds by email and which then set their
        own password the first time they log in.
     3. REQUEST SUBMISSION — writes a row to the Requirements Log sheet and emails the fixed
        recipients (+ CC), exactly like before, but from here instead of the browser.
     4. STATUS UPDATES — replies in the SAME Gmail thread as the original request (using
        GmailApp's own thread/reply handling, which is far more reliable than hand-built
        In-Reply-To/References headers), with a body styled to match the original request email.

   ------------------------------------------------------------------------------------------------
   SETUP (one time):
     1. Open the Apps Script project behind your existing Web App deployment (or create a new
        script bound to the "Web Pages<>JARO" / Requirements Log spreadsheet — either works, this
        script only needs the Spreadsheet ID below, not a bound relationship).
     2. Paste this entire file in as Code.gs (replacing what's there, or adding alongside your
        existing audit-relay code — the `doPost` router below only handles the actions listed
        above; if your old Code.gs had a `doGet` for the on-page-audit relay, leave that function
        exactly as-is, it isn't touched by anything here).
     3. Set SPREADSHEET_ID below to your Requirements Log spreadsheet's ID (same one already in
        CONFIG.sheets.requirementsLog.sheetId in the dashboard file).
     4. Run the `setupAdmin` function once from the Apps Script editor (select it from the function
        dropdown, click Run — you'll be asked to authorize the script the first time). This creates
        the "Dashboard Users" tab and seeds the Admin row.
        >>> IMPORTANT: the password below is the one you shared in chat — since it was typed in
        plain text in a conversation, please change it (Admin can change their own password from
        the dashboard once logged in, or just re-run setupAdmin with a new PASSWORD value and any
        already-active Admin session keeps working until it naturally expires) as soon as you've
        confirmed login works. <<<
     5. Deploy > Manage deployments > Edit (pencil icon) > New version > Deploy. Keep "Execute as:
        Me" and "Who has access: Anyone within [your domain]" (or "Anyone" if you want it reachable
        outside your Workspace — Anyone-within-domain is the safer default for an internal tool).
        The Web App URL stays the same across versions, so CONFIG.authApiUrl / webAppUrl in the
        dashboard file don't need to change.
   ================================================================================================ */

const SPREADSHEET_ID = "1JGsWhpTOalVOPoO0CwlAaCCgPMVv0ExSYTxrRErCVV0"; // same as CONFIG.sheets.requirementsLog.sheetId
const SESSION_TTL_HOURS = 12;
const OTP_TTL_MINUTES = 2.5; // 2 minutes 30 seconds
const REQUEST_LOG_HEADER = ["Timestamp","University","Program","Request Type","Priority","Requested By","Email",
  "Team","Section","Related Link","Subject","Description","To","Cc","Status","Thread Key","Gmail Message ID","Gmail Thread ID"];
const USERS_HEADER = ["Email","Role","PasswordHash","Salt","Status","CreatedAt","LastLogin"];
const SESSIONS_HEADER = ["Token","Email","Role","Name","ExpiresAt"];
const OTPS_HEADER = ["Email","Purpose","Code","ExpiresAt","SetupToken"];

/* ---- One-time setup: run this once from the Apps Script editor ---- */
function setupAdmin(){
  const PASSWORD = "Luds_1707"; // ⚠️ change this right after your first successful login
  const sheet = getOrCreateSheet_("Dashboard Users", USERS_HEADER);
  const rows = sheet.getDataRange().getValues();
  const emailCol = 0;
  for(let i = 1; i < rows.length; i++){
    if((rows[i][emailCol]||"").toString().toLowerCase() === "lalit.rade@jaro.in"){
      Logger.log("Admin row already exists — delete it first if you want to reseed the password.");
      return;
    }
  }
  const salt = Utilities.getUuid();
  sheet.appendRow(["lalit.rade@jaro.in", "Admin", hashPassword_(PASSWORD, salt), salt, "Active", new Date().toISOString(), ""]);
  Logger.log("Admin seeded. Log in with lalit.rade@jaro.in and the password you set above, then change it.");
}

/* ---- One-time setup, step 2: RUN THIS ONCE TOO, right after setupAdmin ----
   setupAdmin() only touches SpreadsheetApp/Utilities, and the login OTP email only needs the
   lighter MailApp scope — neither of those triggers Google's consent screen for the broader Gmail
   scopes (gmail.compose / gmail.modify / gmail.addons...) that GmailApp.createDraft/.reply need for
   submitting requests and replying in-thread on status updates. A Web App running as "Execute as:
   Me" can't show an interactive consent prompt when called over HTTP — it just fails with
   "Specified permissions are not sufficient..." until the OWNER (you) has authorized those scopes
   at least once from inside the Apps Script editor. Select this function from the dropdown next to
   the Run button, click Run, and click through the "Authorize access" / "Allow" prompts that
   appear (you may see an "unverified app" warning since this is your own personal project — click
   "Advanced" > "Go to (project name) (unsafe)" > Allow, that's expected for scripts you own that
   haven't gone through Google's public app review, which isn't needed for a private internal tool
   like this one). Once this succeeds without an error, Submit Request / status updates will start
   working from the dashboard without needing this step again. */
function authorizeGmailAccess(){
  const aliases = GmailApp.getAliases();
  Logger.log("Gmail access authorized. Aliases: " + JSON.stringify(aliases));
}

/* ---- HTTP entry point ----
   Two transports are supported, because the Web App is deployed at a domain-restricted URL
   (.../a/macros/jaro.in/s/.../exec). A plain cross-origin fetch() from a site hosted elsewhere
   (e.g. Vercel) cannot carry the caller's Google session cookie to that URL, and even with
   credentials:"include" the browser follows Google's own auth redirect in a way fetch can't
   read across origins — that shows up in DevTools as "TypeError: Failed to fetch". A hidden
   <iframe> + real <form> POST is a genuine browser navigation instead of an XHR/fetch, so it is
   not subject to CORS at all and follows the auth redirect exactly like a normal page load.

   - Form-POST callers (the dashboard's iframe/form transport) send one field named "payload"
     (a JSON string) via application/x-www-form-urlencoded — that lands in e.parameter.payload.
     Because the caller can't read the iframe's response body across origins either, the response
     here is a tiny HTML page whose only job is to postMessage() the result back to the parent
     window, tagged with the same reqId the caller sent in payload.
   - Legacy/JSON callers (anything still POSTing a raw JSON body, e.g. text/plain to dodge
     preflight) keep getting a plain JSON response, unchanged from before.
*/
function doPost(e){
  let body, viaForm = false;
  try{
    if(e.parameter && e.parameter.payload){
      body = JSON.parse(e.parameter.payload);
      viaForm = true;
    } else {
      body = JSON.parse(e.postData.contents);
    }
  }catch(err){
    return respond_({ ok:false, error:"Bad request" }, viaForm, null);
  }
  const reqId = body.reqId || null;
  let result;
  try{
    result = dispatch_(body);
  }catch(err){
    result = { ok:false, error: err.message || "Server error" };
  }
  // Form-POST callers (see authApiCallLarge_ in the dashboard — used for submitRequest, whose
  // description can carry pasted screenshots too large for a GET URL) can't read this response
  // directly: the postMessage page below gets blocked by Apps Script's own CSP once framed
  // cross-origin. So the result is also stashed here, keyed by reqId, for the caller to retrieve
  // with a small, fast "checkResult" JSONP poll instead.
  if(viaForm && reqId) storePendingResult_(reqId, result);
  return respond_(result, viaForm, reqId);
}
/* ---- HTTP entry point (GET / JSONP) ----
   The iframe+form+postMessage transport (still supported above via doPost, for compatibility)
   turned out to hit a second wall beyond the X-Frame-Options issue: Apps Script's own response
   page carries a Content-Security-Policy that blocks the inline <script> (the one that calls
   postMessage) from running when that page is loaded inside a frame on another domain. The
   postMessage never fires, so the caller just times out even though doPost already ran fine
   server-side (as proven by the OTP email actually arriving).

   JSONP sidesteps all of that: a <script src="...exec?..."> tag is not a framed navigation or a
   fetch/XHR — the browser just downloads the response body and executes it as JS directly in the
   CALLING page's own context. Neither CORS, X-Frame-Options, nor Apps Script's CSP on its own
   response apply to that. Script tags still carry the browser's cookies for script.google.com by
   default, so the domain-restricted deployment's auth gate still passes exactly as it did for the
   direct-navigation test. This is the same technique the web used for cross-origin calls long
   before CORS existed, and it's the most reliable option for a domain-restricted deployment like
   this one.

   Request shape: GET .../exec?callback=<jsCallbackName>&payload=<url-encoded JSON string>
   Response shape: `<callback>(<json result>);` served as application/javascript.
*/
function doGet(e){
  const params = (e && e.parameter) || {};
  const callback = (params.callback || "").toString();
  let body = {};
  try{ body = params.payload ? JSON.parse(params.payload) : {}; }
  catch(err){ body = {}; }
  let result;
  try{ result = dispatch_(body); }
  catch(err){ result = { ok:false, error: err.message || "Server error" }; }
  // Only allow safe JS-identifier callback names — this string is spliced directly into the
  // response as executable code, so it must be constrained before that happens.
  if(callback && /^[A-Za-z0-9_$]+$/.test(callback)){
    const js = callback + "(" + JSON.stringify(result) + ");";
    return ContentService.createTextOutput(js).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonOut_(result);
}
/* Idempotency guard: the dashboard's JSONP transport auto-retries a call once if the browser never
   got the response back (a dropped/blocked script load, or a slow Apps Script cold start past the
   client's timeout) — but the server-side work behind that first attempt may well have already
   completed. For actions like submitRequest/updateStatus that means a real email already sent and/
   or a sheet row already appended. Without this guard, retrying an action that actually succeeded
   the first time duplicates those side effects (duplicate emails, duplicate rows) instead of
   harmlessly repeating a read. The dashboard sends a per-call idemKey that's identical across a
   call and its retry (but different for every new call the person makes); the first execution's
   result is cached under that key for a few minutes, and a retry with the same key just replays
   the cached result instead of re-running the handler. Every action goes through this same guard so
   nothing has to be reasoned about per-action as "safe" or "unsafe" to retry. */
function dispatch_(body){
  const idemKey = (body && body.idemKey) ? String(body.idemKey) : "";
  if(!idemKey) return dispatchAction_(body);
  const cache = CacheService.getScriptCache();
  const cacheKey = "idem_" + idemKey;
  const cached = cache.get(cacheKey);
  if(cached){
    try{ return JSON.parse(cached); }catch(e){ /* corrupt cache entry — fall through and recompute */ }
  }
  const result = dispatchAction_(body);
  try{ cache.put(cacheKey, JSON.stringify(result), 300); }
  catch(e){ /* result too large to cache (e.g. a big listRequirements/listUsers payload) — that's
               fine, those reads are naturally safe to just recompute on a retry anyway */ }
  return result;
}
function dispatchAction_(body){
  switch(body.action){
    case "login": return handleLogin_(body);
    case "verifyOtp": return handleVerifyOtp_(body);
    case "resendLoginOtp": return handleResendLoginOtp_(body);
    case "requestPasswordSetup": return handleRequestPasswordSetup_(body);
    case "setPassword": return handleSetPassword_(body);
    case "changePassword": return handleChangePassword_(body);
    case "checkSession": return handleCheckSession_(body);
    case "logout": return handleLogout_(body);
    case "listUsers": return handleListUsers_(body);
    case "addUser": return handleAddUser_(body);
    case "resetUserPassword": return handleResetUserPassword_(body);
    case "submitRequest": return handleSubmitRequest_(body);
    case "updateStatus": return handleUpdateStatus_(body);
    case "listRequirements": return handleListRequirements_(body);
    case "checkResult": return handleCheckResult_(body);
    default: return { ok:false, error:"Unknown action" };
  }
}
/* ---- Pending results: a tiny scratch sheet used only by the form-POST + poll transport (see
   authApiCallLarge_ in the dashboard). Entries are one-shot (deleted as soon as they're read) and
   opportunistically swept for anything older than 10 minutes so this never grows unbounded even if
   a caller gives up before polling for its result. ---- */
const PENDING_RESULTS_HEADER = ["ReqId","Result","CreatedAt"];
function storePendingResult_(reqId, result){
  const sheet = getOrCreateSheet_("PendingResults", PENDING_RESULTS_HEADER);
  sheet.appendRow([reqId, JSON.stringify(result), new Date().toISOString()]);
  const values = sheet.getDataRange().getValues();
  const cutoff = Date.now() - 10*60000;
  for(let i = values.length - 1; i >= 1; i--){
    if(new Date(values[i][2]).getTime() < cutoff) sheet.deleteRow(i + 1);
  }
}
function handleCheckResult_(body){
  const reqId = body.reqId;
  if(!reqId) throw new Error("Missing reqId");
  const sheet = getOrCreateSheet_("PendingResults", PENDING_RESULTS_HEADER);
  const values = sheet.getDataRange().getValues();
  for(let i = 1; i < values.length; i++){
    if(values[i][0] === reqId){
      let result;
      try{ result = JSON.parse(values[i][1]); }catch(err){ result = { ok:false, error:"Corrupt pending result" }; }
      sheet.deleteRow(i + 1);
      return Object.assign({ ready:true }, result);
    }
  }
  return { ok:true, ready:false };
}
function respond_(result, viaForm, reqId){
  if(viaForm){
    const message = JSON.stringify(Object.assign({}, result, { reqId: reqId }));
    const html = `<!DOCTYPE html><html><body><script>
      parent.postMessage(${message}, "*");
    <\/script></body></html>`;
    // Without this, Apps Script serves HtmlService output with X-Frame-Options: SAMEORIGIN,
    // which makes the browser refuse to load it inside our hidden <iframe> on a different
    // domain (the dashboard's site) — the postMessage script never runs and the caller just
    // times out waiting. ALLOWALL lets this specific response page be framed from anywhere,
    // which is safe here since the page contains no sensitive UI, only a postMessage call.
    return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return jsonOut_(result);
}
function jsonOut_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---- Sheet helpers ---- */
function getOrCreateSheet_(name, header){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if(!sheet){
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
  } else if(sheet.getLastRow() === 0){
    sheet.appendRow(header);
  }
  return sheet;
}
function getRequestsSheet_(){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // Try the conventional name first, else fall back to the first tab — either way, if the header
  // row is missing/empty it gets written so old sheets keep working without manual setup.
  let sheet = ss.getSheetByName("Requirements Log") || ss.getSheets()[0];
  if(sheet.getLastRow() === 0) sheet.appendRow(REQUEST_LOG_HEADER);
  return sheet;
}
function sheetRowsAsObjects_(sheet){
  const values = sheet.getDataRange().getValues();
  if(values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((r,i)=>{
    const obj = {}; headers.forEach((h,idx)=> obj[h] = r[idx]);
    obj._row = i + 2;
    return obj;
  });
}
function findRowByColumn_(sheet, colName, value){
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const col = headers.indexOf(colName);
  if(col === -1) return null;
  for(let i = 1; i < values.length; i++){
    if((values[i][col]||"").toString().toLowerCase() === value.toString().toLowerCase()){
      return { row: i + 1, data: values[i], headers };
    }
  }
  return null;
}

/* ---- Password hashing (salted SHA-256 — no plaintext password is ever stored) ---- */
function hashPassword_(password, salt){
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + "::" + salt);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2,"0")).join("");
}
function randomCode6_(){
  return Math.floor(100000 + Math.random() * 900000).toString();
}
function randomToken_(){
  return Utilities.getUuid() + Utilities.getUuid();
}

/* ---- OTP: one pending code per (email, purpose) at a time ---- */
function issueOtp_(email, purpose){
  const sheet = getOrCreateSheet_("OTPs", OTPS_HEADER);
  const existing = findRowByColumn_(sheet, "Email", email);
  const code = randomCode6_();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60000).toISOString();
  // One row per email — purpose+code get overwritten on every new request instead of piling up.
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  let rowIdx = -1;
  for(let i = 1; i < values.length; i++){
    if((values[i][headers.indexOf("Email")]||"").toString().toLowerCase() === email.toLowerCase() &&
       values[i][headers.indexOf("Purpose")] === purpose){ rowIdx = i + 1; break; }
  }
  const row = [email, purpose, code, expiresAt, ""];
  if(rowIdx === -1) sheet.appendRow(row); else sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  return code;
}
function verifyOtp_(email, purpose, code){
  const sheet = getOrCreateSheet_("OTPs", OTPS_HEADER);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  for(let i = 1; i < values.length; i++){
    const r = values[i];
    if((r[headers.indexOf("Email")]||"").toString().toLowerCase() === email.toLowerCase() && r[headers.indexOf("Purpose")] === purpose){
      if(new Date(r[headers.indexOf("ExpiresAt")]).getTime() < Date.now()) throw new Error("That code has expired — request a new one.");
      if((r[headers.indexOf("Code")]||"").toString() !== code.toString()) throw new Error("Incorrect code.");
      return { row: i + 1, headers };
    }
  }
  throw new Error("No code was requested for this email — request one first.");
}
function sendOtpEmail_(email, code, purpose){
  const heading = purpose === "setup" ? "Verify your email to set up your password" : "Your login code";
  const html = `<div style="font-family:Verdana,Geneva,sans-serif;max-width:420px;margin:0 auto">
    <div style="background:#0029A6;padding:18px 24px;border-radius:12px 12px 0 0">
      <div style="color:#FFCF24;font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase">Jaro Dashboard</div>
      <div style="color:#fff;font-weight:700;font-size:17px;margin-top:6px">${heading}</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;text-align:center">
      <div style="font-size:32px;font-weight:800;letter-spacing:.2em;color:#0029A6;font-family:Verdana,Geneva,sans-serif">${code}</div>
      <p style="font-size:12.5px;color:#666;margin-top:14px">This code expires in 2 minutes 30 seconds. If you didn't request this, you can ignore this email.</p>
    </div>
  </div>`;
  MailApp.sendEmail({ to: email, subject: "Jaro Dashboard - One Time Password", htmlBody: html });
}

/* ---- Users ---- */
function getUser_(email){
  const sheet = getOrCreateSheet_("Dashboard Users", USERS_HEADER);
  const found = findRowByColumn_(sheet, "Email", email);
  if(!found) return null;
  const obj = {}; found.headers.forEach((h,i)=> obj[h] = found.data[i]);
  obj._row = found.row;
  return obj;
}
function requireSession_(token){
  if(!token) throw new Error("You're not logged in.");
  const sheet = getOrCreateSheet_("Sessions", SESSIONS_HEADER);
  const found = findRowByColumn_(sheet, "Token", token);
  if(!found) throw new Error("Your session has expired — please log in again.");
  const obj = {}; found.headers.forEach((h,i)=> obj[h] = found.data[i]);
  if(new Date(obj.ExpiresAt).getTime() < Date.now()) throw new Error("Your session has expired — please log in again.");
  return obj;
}
function requireAdmin_(token){
  const session = requireSession_(token);
  if(session.Role !== "Admin") throw new Error("Admins only.");
  return session;
}

/* ---- Action handlers ---- */
function handleLogin_(body){
  const email = (body.email||"").trim().toLowerCase();
  const password = body.password || "";
  if(!email || !password) throw new Error("Enter both email and password.");
  const user = getUser_(email);
  if(!user) throw new Error("No account found for that email.");
  if(user.Status === "Pending" || !user.PasswordHash) return { ok:true, needsSetup:true };
  if(hashPassword_(password, user.Salt) !== user.PasswordHash) throw new Error("Incorrect password.");
  const code = issueOtp_(email, "login");
  sendOtpEmail_(email, code, "login");
  return { ok:true, otpSent:true };
}
function handleResendLoginOtp_(body){
  const email = (body.email||"").trim().toLowerCase();
  const user = getUser_(email);
  if(!user) throw new Error("No account found for that email.");
  const code = issueOtp_(email, "login");
  sendOtpEmail_(email, code, "login");
  return { ok:true };
}
function handleVerifyOtp_(body){
  const email = (body.email||"").trim().toLowerCase();
  const purpose = body.purpose === "setup" ? "setup" : "login";
  verifyOtp_(email, purpose, body.otp||"");
  if(purpose === "setup"){
    const setupToken = randomToken_();
    const sheet = getOrCreateSheet_("OTPs", OTPS_HEADER);
    const found = findRowByColumn_(sheet, "Email", email);
    if(found) sheet.getRange(found.row, found.headers.indexOf("SetupToken") + 1).setValue(setupToken);
    return { ok:true, setupToken };
  }
  const user = getUser_(email);
  if(!user) throw new Error("Account not found.");
  const token = randomToken_();
  const sheet = getOrCreateSheet_("Sessions", SESSIONS_HEADER);
  sheet.appendRow([token, email, user.Role, user.Email, new Date(Date.now() + SESSION_TTL_HOURS*3600000).toISOString()]);
  const usersSheet = getOrCreateSheet_("Dashboard Users", USERS_HEADER);
  usersSheet.getRange(user._row, USERS_HEADER.indexOf("LastLogin") + 1).setValue(new Date().toISOString());
  return { ok:true, token, role:user.Role, email:user.Email, name:user.Email };
}
function handleRequestPasswordSetup_(body){
  const email = (body.email||"").trim().toLowerCase();
  const user = getUser_(email);
  if(!user) throw new Error("That email hasn't been added by an Admin yet.");
  const code = issueOtp_(email, "setup");
  sendOtpEmail_(email, code, "setup");
  return { ok:true };
}
function handleSetPassword_(body){
  const email = (body.email||"").trim().toLowerCase();
  const setupToken = body.setupToken || "";
  const newPassword = body.newPassword || "";
  if(newPassword.length < 8) throw new Error("Password must be at least 8 characters.");
  const otpSheet = getOrCreateSheet_("OTPs", OTPS_HEADER);
  const found = findRowByColumn_(otpSheet, "Email", email);
  if(!found || (found.data[found.headers.indexOf("SetupToken")]||"") !== setupToken || !setupToken){
    throw new Error("Verification expired — start the setup again.");
  }
  const user = getUser_(email);
  if(!user) throw new Error("Account not found.");
  const salt = Utilities.getUuid();
  const usersSheet = getOrCreateSheet_("Dashboard Users", USERS_HEADER);
  usersSheet.getRange(user._row, USERS_HEADER.indexOf("PasswordHash") + 1).setValue(hashPassword_(newPassword, salt));
  usersSheet.getRange(user._row, USERS_HEADER.indexOf("Salt") + 1).setValue(salt);
  usersSheet.getRange(user._row, USERS_HEADER.indexOf("Status") + 1).setValue("Active");
  usersSheet.getRange(user._row, USERS_HEADER.indexOf("LastLogin") + 1).setValue(new Date().toISOString());
  const token = randomToken_();
  const sessSheet = getOrCreateSheet_("Sessions", SESSIONS_HEADER);
  sessSheet.appendRow([token, email, user.Role, email, new Date(Date.now() + SESSION_TTL_HOURS*3600000).toISOString()]);
  return { ok:true, token, role:user.Role, email, name:email };
}
function handleChangePassword_(body){
  const session = requireSession_(body.token);
  const user = getUser_(session.Email);
  if(hashPassword_(body.oldPassword||"", user.Salt) !== user.PasswordHash) throw new Error("Current password is incorrect.");
  if((body.newPassword||"").length < 8) throw new Error("New password must be at least 8 characters.");
  const salt = Utilities.getUuid();
  const usersSheet = getOrCreateSheet_("Dashboard Users", USERS_HEADER);
  usersSheet.getRange(user._row, USERS_HEADER.indexOf("PasswordHash") + 1).setValue(hashPassword_(body.newPassword, salt));
  usersSheet.getRange(user._row, USERS_HEADER.indexOf("Salt") + 1).setValue(salt);
  return { ok:true };
}
function handleCheckSession_(body){
  const session = requireSession_(body.token);
  return { ok:true, email:session.Email, role:session.Role };
}
function handleLogout_(body){
  const sheet = getOrCreateSheet_("Sessions", SESSIONS_HEADER);
  const found = findRowByColumn_(sheet, "Token", body.token||"");
  if(found) sheet.deleteRow(found.row);
  return { ok:true };
}
function handleListUsers_(body){
  requireAdmin_(body.token);
  const sheet = getOrCreateSheet_("Dashboard Users", USERS_HEADER);
  const rows = sheetRowsAsObjects_(sheet);
  return { ok:true, users: rows.map(r => ({ email:r.Email, role:r.Role, status:r.Status, lastLogin:r.LastLogin })) };
}
function handleAddUser_(body){
  requireAdmin_(body.token);
  const email = (body.email||"").trim().toLowerCase();
  if(!email) throw new Error("Enter an email.");
  if(getUser_(email)) throw new Error("That email already has an account.");
  const sheet = getOrCreateSheet_("Dashboard Users", USERS_HEADER);
  sheet.appendRow([email, body.role === "Admin" ? "Admin" : "Support", "", "", "Pending", new Date().toISOString(), ""]);
  return { ok:true };
}
/* Admin-only "Regenerate Password" — clears the stored hash/salt and flips Status back to
   "Pending", which routes that person back through the existing "Set up your password" (email OTP
   verified) flow the next time they try to log in, instead of an Admin ever seeing or setting a
   password on someone else's behalf. */
function handleResetUserPassword_(body){
  requireAdmin_(body.token);
  const email = (body.email||"").trim().toLowerCase();
  const user = getUser_(email);
  if(!user) throw new Error("That account doesn't exist.");
  const sheet = getOrCreateSheet_("Dashboard Users", USERS_HEADER);
  sheet.getRange(user._row, USERS_HEADER.indexOf("PasswordHash") + 1).setValue("");
  sheet.getRange(user._row, USERS_HEADER.indexOf("Salt") + 1).setValue("");
  sheet.getRange(user._row, USERS_HEADER.indexOf("Status") + 1).setValue("Pending");
  // Also invalidate any of their existing sessions so a reset actually forces re-authentication.
  const sessSheet = getOrCreateSheet_("Sessions", SESSIONS_HEADER);
  const values = sessSheet.getDataRange().getValues();
  const headers = values[0];
  const emailCol = headers.indexOf("Email");
  for(let i = values.length - 1; i >= 1; i--){
    if((values[i][emailCol]||"").toString().toLowerCase() === email) sessSheet.deleteRow(i + 1);
  }
  try{
    MailApp.sendEmail({
      to: email,
      subject: "Your Jaro Dashboard password was reset",
      htmlBody: `<div style="font-family:Verdana,Geneva,sans-serif;max-width:420px;margin:0 auto">
        <div style="background:#0029A6;padding:18px 24px;border-radius:12px 12px 0 0">
          <div style="color:#FFCF24;font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase">Jaro Dashboard</div>
          <div style="color:#fff;font-weight:700;font-size:17px;margin-top:6px">Your password was reset</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
          <p style="font-size:13px;color:#333">An Admin reset your Jaro Dashboard password. Go to the dashboard and choose
          "Set up your password" with this email address to set a new one — you'll verify with a code sent to this inbox.</p>
        </div>
      </div>`
    });
  }catch(err){ /* password is already reset even if this notification email fails */ }
  return { ok:true };
}

/* ---- Requests ---- */
function requestEmailHtml_(payload, headingText){
  const rows = [
    ["University", payload.university], ["Program", payload.program], ["Section", payload.section],
    ["Request Type", payload.type], ["Priority", payload.priority],
    ["Related Link", payload.link ? `<a href="${escHtml_(payload.link)}" style="color:#0029A6">${escHtml_(payload.link)}</a>` : "—"]
  ].map(([label,val])=>`<tr>
      <td style="padding:7px 14px;color:#5b6472;font-size:12.5px;font-weight:600;white-space:nowrap;border-bottom:1px solid #eef0f3">${escHtml_(label)}</td>
      <td style="padding:7px 14px;font-size:13px;color:#111;border-bottom:1px solid #eef0f3">${val || "—"}</td>
    </tr>`).join("");
  return `
<div style="font-family:Verdana,Geneva,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#0029A6;padding:20px 26px;border-radius:12px 12px 0 0">
    <div style="color:#FFCF24;font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase">Jaro Dashboard</div>
    <div style="color:#fff;font-weight:700;font-size:19px;margin-top:6px">${headingText}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:22px 26px">
    <p style="font-size:13px;color:#333;margin:0 0 16px">Raised by <b>${escHtml_(payload.name)}</b> (${escHtml_(payload.email)})</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">${rows}</table>
    <div style="font-size:13px;color:#333">
      <div style="font-weight:700;margin-bottom:8px">Description</div>
      <div style="line-height:1.5">${payload.descriptionHtml && payload.descriptionHtml.trim() ? payload.descriptionHtml : escHtml_(payload.descriptionText||"").replace(/\\n/g,"<br>")}</div>
    </div>
  </div>
  <p style="font-size:11px;color:#9aa1ab;margin:14px 4px 0">Subject: ${escHtml_(payload.subject)} · Sent from the Jaro Web Pages Dashboard</p>
</div>`;
}
/* Same branded shell, used for the status-update reply — same table of context fields, but with a
   highlighted "Status" row instead of the description block, so a status update reads as clearly
   as the original "New Request Raised" email rather than the old plain one-liner. */
/* Status-update email now carries the same full context table as the original "New Request
   Raised" email (University/Program/Section/Request Type/Priority/Related Link/Description), not
   just a thin University/Program/Section/Subject slice — so a status update reads as a complete,
   self-contained record even if someone hasn't scrolled back to the original message.
   noteHtml/noteText: noteHtml is the rich-text (links/bold/pasted screenshots) note typed into the
   status modal's editor; noteText is its plain-text fallback used only if noteHtml is empty. */
function statusEmailHtml_(payload, status, noteHtml, noteText){
  const rows = [
    ["University", payload.university], ["Program", payload.program], ["Section", payload.section],
    ["Request Type", payload.type], ["Priority", payload.priority],
    ["Related Link", payload.link ? `<a href="${escHtml_(payload.link)}" style="color:#0029A6">${escHtml_(payload.link)}</a>` : "—"],
    ["Subject", payload.subject],
  ].map(([label,val])=>`<tr>
      <td style="padding:7px 14px;color:#5b6472;font-size:12.5px;font-weight:600;white-space:nowrap;border-bottom:1px solid #eef0f3">${escHtml_(label)}</td>
      <td style="padding:7px 14px;font-size:13px;color:#111;border-bottom:1px solid #eef0f3">${val || "—"}</td>
    </tr>`).join("");
  const descriptionBlock = payload.description ? `
    <div style="font-size:13px;color:#333;margin-top:16px">
      <div style="font-weight:700;margin-bottom:8px">Original Description</div>
      <div style="line-height:1.5">${escHtml_(payload.description).replace(/\n/g,"<br>")}</div>
    </div>` : "";
  const noteInner = (noteHtml && noteHtml.trim()) ? noteHtml
    : (noteText && noteText.trim()) ? escHtml_(noteText).replace(/\n/g,"<br>") : "";
  const noteBlock = noteInner ? `
    <div style="font-size:13px;color:#333;margin-top:16px">
      <div style="font-weight:700;margin-bottom:8px">Note</div>
      <div style="line-height:1.5">${noteInner}</div>
    </div>` : "";
  return `
<div style="font-family:Verdana,Geneva,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#0029A6;padding:20px 26px;border-radius:12px 12px 0 0">
    <div style="color:#FFCF24;font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase">Jaro Dashboard</div>
    <div style="color:#fff;font-weight:700;font-size:19px;margin-top:6px">Request Status Updated</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:22px 26px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">${rows}</table>
    <div style="text-align:center;padding:14px;background:#f5f7fb;border-radius:10px">
      <div style="font-size:11px;color:#5b6472;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">New Status</div>
      <div style="font-size:20px;font-weight:800;color:#0029A6">${escHtml_(status)}</div>
    </div>
    ${descriptionBlock}
    ${noteBlock}
  </div>
  <p style="font-size:11px;color:#9aa1ab;margin:14px 4px 0">Sent from the Jaro Web Pages Dashboard</p>
</div>`;
}
function escHtml_(s){ return (s||"").toString().replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }

/* Rewrites Google's raw "Specified permissions (https://www.googleapis.com/auth/gmail.compose,
   ...) are not sufficient..." error — which is genuinely just a wall of scope URLs to anyone who
   isn't debugging Apps Script internals — into the one actionable sentence that actually explains
   what to do: the script owner needs to run authorizeGmailAccess() once from the Apps Script
   editor (see the big comment above that function), then redeploy. No dashboard code change can
   substitute for that manual, one-time consent — it's Google requiring a human to click "Allow"
   for a script that sends mail on someone's behalf, and that can't be scripted around. */
function friendlyGmailError_(err){
  const msg = (err && err.message) || String(err);
  if(/specified permissions/i.test(msg) || /not sufficient/i.test(msg)){
    // TEMPORARY DIAGNOSTIC: the raw Google error is appended in [brackets] below (normally hidden
    // behind the friendly sentence) — this exact scope list is what's pinpointing the real gap
    // while this authorization issue is still being tracked down. Safe to remove once resolved.
    return new Error("Gmail access hasn't been authorized for this script yet. In the Apps Script editor, " +
      "select authorizeGmailAccess from the function dropdown, click Run, approve the prompts, then " +
      "redeploy (Deploy > Manage deployments > New version). This is a one-time step. [raw: " + msg + "]");
  }
  return err;
}
function handleSubmitRequest_(body){
  const session = requireSession_(body.token);
  const payload = body.payload || {};
  payload.email = session.Email; // identity always comes from the session, never the client
  payload.name = payload.name || session.Email;
  // The exact string stored here is reused verbatim (prefixed "Re: ") for every status-update
  // reply on this request — see sendGmailMessage_ below. That's what guarantees Gmail's own
  // exact-Subject-match requirement for threading is met, instead of two independently-encoded
  // Subject headers silently drifting apart and Gmail starting a new thread instead of replying.
  const subject = payload.subject || "New Request";
  payload.subject = subject;
  const to = (payload.to && payload.to.length) ? payload.to.join(",") : "lalit.rade@jaro.in";
  const cc = (payload.cc||[]).join(",");
  const html = requestEmailHtml_(payload, "New Request Raised");
  let sent;
  try{
    sent = sendGmailMessage_({ to, cc, subject, htmlBody: html });
  }catch(err){
    throw friendlyGmailApiError_(err);
  }
  const sheet = getRequestsSheet_();
  sheet.appendRow([
    new Date().toISOString(), payload.university||"", payload.program||"", payload.type||"", payload.priority||"",
    payload.name||"", payload.email||"", payload.team||"", payload.section||"", payload.link||"", subject,
    payload.descriptionText||"", (payload.to||[]).join(", "), (payload.cc||[]).join(", "), "Not Started", payload.threadKey||"",
    sent.id, sent.threadId
  ]);
  return { ok:true };
}
/* ---- Threaded status-update replies with fully custom recipients ----
   GmailApp's own reply()/replyAll() (used previously) turned out to be a dead end for this: it
   never reliably threaded in testing here (Gmail's own "Show original" on the sent reply showed
   no In-Reply-To/References headers at all), AND it has no way to override who the "To" is — you
   can only add extra Cc, never set custom To or drop someone. That's fundamentally incompatible
   with "let the Admin edit To/Cc for this update, but still land in the exact original thread".
   The Advanced Gmail Service (Gmail API) fixes both at once: it lets us build the raw email
   ourselves with EXACT To/Cc, and set threadId + In-Reply-To/References headers explicitly, which
   is what actually and reliably threads a message in Gmail (rather than relying on GmailApp's own
   opaque "figure out the right thread" heuristic).
   sendGmailMessage_ is now used for BOTH the original "New Request Raised" email (threadId/
   inReplyTo/references all omitted — there's no thread yet) and every "Request Status Updated"
   reply (all three supplied). Previously the original send went through GmailApp.createDraft()
   instead, which encodes its own Subject header internally with no visibility into exactly how —
   any tiny difference between that and this file's own RFC 2047 encoding of "Re: " + the same
   text (needed because auto-built subjects contain a non-ASCII em dash "—") was enough for Gmail
   to treat a reply's Subject as non-matching and silently start a brand-new thread instead of
   threading it, even though threadId/In-Reply-To/References were all correct. Routing both sends
   through this one function means the exact same Subject string (down to the byte) is guaranteed
   for both, so that failure mode can no longer happen.
   ONE-TIME SETUP REQUIRED: in the Apps Script editor, click "Services" (+ icon) in the left
   sidebar, find "Gmail API", click Add. That's it — no new OAuth consent needed beyond what's
   already authorized via authorizeGmailAccess(). Then redeploy (Deploy > Manage deployments >
   New version) same as always. */
function mimeEncodeHeaderValue_(s){
  // RFC 2047 — only actually needed when a header has non-ASCII characters, which happens here
  // because this dashboard's auto-built subjects use an em dash ("—").
  s = (s || "").toString();
  if(/^[\x00-\x7F]*$/.test(s)) return s;
  return "=?UTF-8?B?" + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + "?=";
}
function getOriginalThreadingHeaders_(messageId){
  try{
    const msg = Gmail.Users.Messages.get("me", messageId, { format:"metadata", metadataHeaders:["Message-ID","References"] });
    const headers = (msg.payload && msg.payload.headers) || [];
    const findHeader = (name)=> (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || "";
    const messageIdHeader = findHeader("Message-ID");
    const referencesHeader = findHeader("References");
    return { inReplyTo: messageIdHeader, references: [referencesHeader, messageIdHeader].filter(Boolean).join(" ") };
  }catch(err){
    Logger.log("getOriginalThreadingHeaders_ couldn't read original headers: %s", err && err.message);
    return { inReplyTo:"", references:"" };
  }
}
function sendGmailMessage_({threadId, to, cc, subject, htmlBody, inReplyTo, references}){
  // Hardcoded rather than Session.getEffectiveUser().getEmail() — that call needs the
  // https://www.googleapis.com/auth/userinfo.email OAuth scope, which isn't in this project's
  // manifest, and adding it would mean yet another authorize-and-redeploy round trip for no real
  // benefit: this script only ever runs as this one account (same address already hardcoded
  // elsewhere in this file, e.g. setupAdmin() and the submitRequest fallback recipient).
  const fromEmail = "lalit.rade@jaro.in";
  const rawHeaders = [
    "MIME-Version: 1.0",
    "From: \"Jaro Web Pages Dashboard\" <" + fromEmail + ">",
    "To: " + to,
    cc ? ("Cc: " + cc) : null,
    "Subject: " + mimeEncodeHeaderValue_(subject),
    inReplyTo ? ("In-Reply-To: " + inReplyTo) : null,
    references ? ("References: " + references) : null,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ].filter(Boolean).join("\r\n");
  const raw = Utilities.base64EncodeWebSafe(rawHeaders + "\r\n\r\n" + htmlBody, Utilities.Charset.UTF_8);
  const resource = { raw: raw };
  if(threadId) resource.threadId = threadId;
  return Gmail.Users.Messages.send(resource, "me");
}
function friendlyGmailApiError_(err){
  const msg = (err && err.message) || String(err);
  if(/Gmail is not defined/i.test(msg)){
    return new Error("The Gmail API service needs to be added to this Apps Script project once. In the editor, " +
      "click the \"Services\" (+) icon in the left sidebar, find \"Gmail API\", click Add, then redeploy " +
      "(Deploy > Manage deployments > New version). This is a one-time step.");
  }
  return friendlyGmailError_(err);
}
function handleUpdateStatus_(body){
  requireAdmin_(body.token);
  const sheetRow = +body.sheetRow;
  const status = body.status;
  const noteHtml = (body.noteHtml || "").toString();
  const noteText = (body.noteText || "").toString();
  const sheet = getRequestsSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rowData = values[sheetRow - 1];
  if(!rowData) throw new Error("That request row couldn't be found.");
  const get = (name)=> rowData[headers.indexOf(name)];
  sheet.getRange(sheetRow, headers.indexOf("Status") + 1).setValue(status);
  const email = get("Email");
  const messageId = (get("Gmail Message ID") || "").toString().trim();
  const threadId = (get("Gmail Thread ID") || "").toString().trim();
  if(!email) return { ok:true }; // nothing to notify
  const payload = {
    university:get("University"), program:get("Program"), section:get("Section"), subject:get("Subject"),
    type:get("Request Type"), priority:get("Priority"), link:get("Related Link"), description:get("Description")
  };
  const html = statusEmailHtml_(payload, status, noteHtml, noteText);
  // Recipients: whatever the Admin picked in the status modal's own Send To/CC fields, editable
  // per update — falls back to the row's original To/Cc (or just the requester) if those come
  // through empty for any reason.
  const to = (Array.isArray(body.to) && body.to.length) ? body.to.join(", ") : ((get("To") || email || "").toString());
  const cc = (Array.isArray(body.cc) && body.cc.length) ? body.cc.join(", ") : (get("Cc") || "").toString();
  // Cloud Logging/Executions has proven unreliable to read in practice (empty "No logs available"
  // even for completed executions) — so instead of relying on that, the diagnostic trail is built
  // up here as plain text and handed straight back in the response, where the dashboard can show
  // it directly in a toast. No more hunting through Apps Script/Google Cloud Logging UI for this.
  const debugLines = [`row=${sheetRow}`, `threadId=${threadId || "(empty)"}`, `messageId=${messageId || "(empty)"}`];
  try{
    if(threadId){
      // Explicit threadId + In-Reply-To/References — the reliable way to actually land this in
      // the original thread, with full control over To/Cc that a plain GmailApp reply can't offer.
      const th = messageId ? getOriginalThreadingHeaders_(messageId) : { inReplyTo:"", references:"" };
      debugLines.push(`inReplyTo=${th.inReplyTo || "(empty — original Message-ID header lookup failed)"}`);
      const sent = sendGmailMessage_({
        threadId: threadId, to: to, cc: cc, subject: "Re: " + (payload.subject || "Your request"),
        htmlBody: html, inReplyTo: th.inReplyTo, references: th.references
      });
      debugLines.push("path=gmail-api-threaded", `sentThreadId=${(sent && sent.threadId) || "(unknown)"}`);
    } else {
      // No stored thread to reply into (an older row from before Gmail Thread ID was tracked) —
      // falls back to a fresh email; this one genuinely can't be placed in the original thread
      // since there's no thread on record for it.
      const options = { htmlBody: html, name: "Jaro Web Pages Dashboard" };
      if(cc) options.cc = cc;
      GmailApp.sendEmail(to, `Re: ${payload.subject||"Your request"}`, "This email requires HTML to view.", options);
      debugLines.push("path=fresh-email-fallback (no Gmail Thread ID stored on this row)");
    }
  }catch(err){
    // Status is already saved above even if the notification email fails for some reason (e.g.
    // the original message was deleted) — surface it, but don't roll back the status change.
    debugLines.push(`error=${(err && err.message) || err}`);
    const friendly = friendlyGmailApiError_(err);
    throw new Error("Status saved, but the notification email failed: " + friendly.message + " [" + debugLines.join(" | ") + "]");
  }
  return { ok:true, debug: debugLines.join(" | ") };
}
function handleListRequirements_(body){
  requireSession_(body.token);
  const sheet = getRequestsSheet_();
  return { ok:true, rows: sheetRowsAsObjects_(sheet) };
}
