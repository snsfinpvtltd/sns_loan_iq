# SNS LoanIQ CRM — Azure + Google Sheets Deployment

Cloud-synced CRM that **lives in Google Sheets** (zero-cost backend) and **runs as a static site on Azure Static Web Apps** (free tier).

```
┌────────────────────────┐    HTTPS     ┌─────────────────────────┐    R/W    ┌──────────────────┐
│  Azure Static Web Apps │ ───────────► │  Google Apps Script     │ ───────► │  Google Sheet    │
│  (HTML + JS, free)     │ ◄─────────── │  Web App (/exec)        │ ◄─────── │  (your DB)       │
│                        │   ID token   │  · auth · LockService   │   rows    │                  │
└────────────────────────┘              └─────────────────────────┘           └──────────────────┘
        ▲                                                                        ▲
        │  Google sign-in (Identity Services)                                    │
        │                                                                        │
        └─────────  shared by 2–5 callers + admin  ──────────────────────────────┘
```

Every caller's edits push to the sheet within seconds. Every 8 seconds, each browser polls for what other callers changed. Concurrent edits are safe — the Apps Script serialises writes with `LockService`.

---

## 1. Files in this project

| File | Purpose |
|---|---|
| `index.html` | The CRM app (your original, with cloud sync added) |
| `cloud-sync.js` | Thin client that talks to the Apps Script webhook |
| `apps-script/Code.gs` | **Backend.** Paste into Apps Script (read + write + auth). |
| `apps-script/appsscript.json` | Apps Script manifest (optional — paste under "Project Settings → Show appsscript.json") |
| `staticwebapp.config.json` | Azure SWA routing + headers |
| `.github/workflows/azure-static-web-apps.yml` | GitHub Actions deploy (Azure creates one too) |
| `README.md` | This file |

---

## 2. One-time setup (≈ 15 minutes)

### Step A — Create the Google Sheet (your database)

1. Go to <https://sheets.new>. Name it **"SNS LoanIQ CRM DB"**.
2. Note the URL — looks like `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`.
   You don't need to add any tabs; the script creates them automatically.

### Step B — Deploy the Apps Script backend

1. In your sheet: **Extensions → Apps Script**.
2. Delete the default `Code.gs` content and paste **everything from `apps-script/Code.gs`** in this project.
3. (Optional but recommended) Open `appsscript.json` in this project, then in the Apps Script editor click **⚙ Project Settings** and tick **"Show 'appsscript.json' manifest file in editor"**. Paste the contents into the new tab.
4. In the editor, run the function **`setup`** once. Approve permissions when prompted.
   This creates the `Customers`, `Callers`, and `Meta` tabs.
5. Click **Deploy → New deployment** (⚙ next to it → **Web app**):
   - **Execute as:** *Me*
   - **Who has access:** *Anyone*
   - Click **Deploy** → authorise → **copy the Web app URL** (ends in `/exec`).
6. Each time you edit `Code.gs`, you must **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy** — otherwise the old code keeps serving.

### Step C — Create a Google OAuth Client ID (for sign-in)

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Create (or pick) a project, e.g. **"SNS LoanIQ"**.
3. **APIs & Services → OAuth consent screen**:
   - User Type: **External**
   - App name: *SNS LoanIQ CRM*, support email: *yours*
   - Scopes: just leave default
   - **Test users**: add every caller's Google email *while in "Testing" mode*. To allow anyone, publish the app — but for an internal team, keep it Testing.
4. **Credentials → + Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins:
     - `https://YOUR-SITE.azurestaticapps.net`  *(your Azure URL — Step E)*
     - `http://localhost:8000`  *(for local dev, optional)*
   - **Create** → copy the **Client ID** (ends in `.apps.googleusercontent.com`).

### Step D — Configure the front-end

Open `index.html`. Find the `CLOUD_CONFIG` block near the top of `<head>`:

```js
window.CLOUD_CONFIG = {
  webhook:  '',   // ← paste Step B's /exec URL
  clientId: '',   // ← paste Step C's client ID
  pollMs: 8000
};
```

Save.

### Step E — Add Script Properties (auth allow-list)

Back in Apps Script: **⚙ Project Settings → Script properties → Add script property**:

| Property | Value |
|---|---|
| `ALLOWED_EMAILS` | `you@gmail.com,caller1@gmail.com,caller2@gmail.com` *(comma-separated; emails the script accepts)* |
| `GOOGLE_CLIENT_ID` | the OAuth Client ID from Step C |
| `ADMIN_EMAILS` | *(optional)* subset of `ALLOWED_EMAILS` allowed to write |

> Leave `ALLOWED_EMAILS` empty to allow any verified Google account (not recommended).

After adding properties: **Deploy → Manage deployments → ✎ → New version → Deploy** to publish the change.

### Step F — Deploy to Azure Static Web Apps (free tier)

**Option F1 — GitHub-based (recommended, auto-redeploy on push):**

1. Push this folder to a GitHub repo.
2. Go to <https://portal.azure.com> → **Create a resource → Static Web App**.
3. Plan type: **Free**.
4. Source: **GitHub** → authorise → select your repo and branch.
5. Build presets: **Custom**
   - App location: `/`
   - API location: *(leave blank)*
   - Output location: *(leave blank)*
6. **Review + create**. Azure will create the workflow in `.github/workflows/` and run the first deploy (~2 min).
7. When deploy is green, open the URL shown in the Azure portal — that's your live site.
8. **Go back to Step C** and update the Authorized JavaScript origins with the real Azure URL, then save.

**Option F2 — Direct upload (no GitHub):**

1. Install the SWA CLI: `npm install -g @azure/static-web-apps-cli`
2. Create the SWA via portal as in F1 but pick "Other" for source.
3. From the project folder:
   ```bash
   swa deploy . --env production --deployment-token=YOUR_DEPLOY_TOKEN
   ```
4. Same step: update OAuth origins with the live URL.

---

## 3. First load

1. Open your Azure URL.
2. The Google sign-in screen appears. Click **Sign in with Google**, pick an allowed account.
3. The app loads the customer + caller data from the sheet.
4. On first ever sign-in, the front-end pushes the 11 demo customers + 4 default callers up to the sheet (so others see something). Reset them later from **Settings → Reset all statuses** or by uploading a real Excel.
5. Sign in from a second device/browser with another allowed account — both update each other within ~8 seconds.

You'll see a **cloud status pill** in the top bar:

- ☁ **Cloud** — idle, all in sync
- ⬆ **Saving…** — your last edit is pushing
- ✓ **Synced** — saved successfully
- ⬇ **Syncing…** — pulling fresh data
- ☁✕ **Offline** — push failed (hover for error; local change kept)
- 💾 **Local only** — Cloud not configured or you clicked "Continue offline"

---

## 4. How concurrent edits work

- Every status change, comment, AI insight, or caller rename runs through `save()`, which **diffs** the in-memory state against the last known cloud snapshot and pushes only the records that actually changed.
- The Apps Script uses `LockService.waitLock(15s)` so two simultaneous writes never trample each other.
- Every 8 seconds (and only while the tab is visible), each browser asks `/exec?action=changes&since=…` for everything updated since its last sync. Updates merge in and the visible page re-renders.
- Last-write-wins per record. Two callers editing **the same customer at the same second** — the later write wins. For 2–5 callers each working their own assigned subset, this is fine.
- All data is also mirrored to `localStorage` so the app keeps working if cloud is unreachable for a moment; pushes resume automatically.

---

## 5. Day-to-day

- **Admin uploads Excel** → archives previous data to a sheet tab → pushes new customers to cloud → all callers see them within 8 s.
- **Caller marks a status** → push within ~1 s → other browsers pick it up next poll.
- **Add/rename/disable a caller** → live to everyone.
- **Reset all statuses** in Settings → pushes deletions for every customer (tombstoned in the sheet).

---

## 6. Security notes

- The API key for the AI provider is **never** stored in the sheet — it stays AES-256-GCM-encrypted in each browser's localStorage (this is unchanged from your original app).
- The Google ID token is sent with every request and verified server-side via Google's `tokeninfo` endpoint, against `GOOGLE_CLIENT_ID` and `ALLOWED_EMAILS`.
- The Apps Script web app must be deployed as **"Execute as: Me"** so it can write to the sheet — the auth check above is what gates access.
- `Cross-Origin-Opener-Policy: same-origin-allow-popups` (in `staticwebapp.config.json`) is required for the Google Sign-In popup.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| **Pill shows "Offline" right after sign-in** | Open DevTools → Network → click last failing request → response will say what the script returned. Most common: forgot to **Deploy → new version** after pasting `Code.gs`, or `ALLOWED_EMAILS` doesn't include your address. |
| **Google sign-in button never renders** | OAuth origin doesn't match the Azure URL. Add `https://YOUR-SITE.azurestaticapps.net` exactly (no trailing slash) to Authorized JavaScript origins, wait 30s, hard-refresh. |
| **"Not authorized: x@gmail.com"** | Add that email to `ALLOWED_EMAILS` Script Property and redeploy the web app. |
| **Two callers edit same customer; one change disappears** | Expected (last-write-wins). Tell callers to refresh after long idle, or split assignments so they don't overlap. |
| **App stuck on "Loading data from Google Sheet…"** | Open the `/exec` URL in a browser — should return JSON `{ok:true, msg:'…'}`. If it returns HTML (Google sign-in page), the deploy is mis-configured: **Execute as = Me**, **Access = Anyone**. |
| **Want to start fresh** | In the sheet, delete the `Customers` and `Callers` tabs. Reload the app — it'll recreate them and seed with whatever the first caller has locally. Or use **Settings → Reset all statuses**. |

---

## 8. Local development

```bash
# any static server, e.g.
python3 -m http.server 8000
# or
npx serve .
```

Visit <http://localhost:8000>. Add `http://localhost:8000` to the OAuth origins in Step C if you want Google sign-in to work locally too.

---

## 9. Costs

| Component | Tier | Cost |
|---|---|---|
| Azure Static Web Apps | Free | ₹0 / month (100 GB bandwidth, 0.5 GB storage) |
| Google Apps Script | Free quota | ₹0 / month (90 min/day script runtime, 20k URL fetches/day) |
| Google Sheets | Free | ₹0 |
| Google OAuth | Free | ₹0 |

Total: **₹0 / month** for 2–5 callers and reasonable usage.
