/**
 * SNS LoanIQ CRM — Cloud Sync Backend (Google Apps Script)
 * ─────────────────────────────────────────────────────────
 * READ + WRITE webhook for the SNS LoanIQ CRM front-end.
 * Stores customers + callers in this spreadsheet as a database
 * and exposes an auth-gated JSON API. Designed for 2–5 concurrent
 * users with last-write-wins per record (single-record upserts).
 *
 * DEPLOY:
 *   1. Extensions → Apps Script (from your sheet)
 *   2. Paste this file as Code.gs (replace any existing code)
 *   3. Open Project Settings → Script properties:
 *        ALLOWED_EMAILS    = comma-separated list (e.g. you@gmail.com,team@gmail.com)
 *        GOOGLE_CLIENT_ID  = your OAuth client ID (ends in .apps.googleusercontent.com)
 *        ADMIN_EMAILS      = optional, comma-separated; if set, only these can write
 *   4. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *      → Copy the /exec URL into the front-end Cloud Config.
 *   5. Each time you change this file: Deploy → Manage deployments → ✎ Edit → New version → Deploy.
 */

const SHEET_CUSTOMERS = 'Customers';
const SHEET_CALLERS   = 'Callers';
const SHEET_SETTINGS  = 'Settings';
const SHEET_META      = 'Meta';

const CUSTOMER_COLS = [
  'id','name','company','designation','email','phone','pin','city',
  'score','eligibility','loan','callerId','status','comments',
  'callHistory','enriched','aiInsight',
  'lastCalledAt','callCount','lastWaAt','waCount',
  'updatedAt','updatedBy','deleted'
];
const CALLER_COLS = ['id','name','active','color','updatedAt','updatedBy','deleted'];
const SETTING_COLS = ['key','value','updatedAt','updatedBy'];

// ─── HTTP entry points ─────────────────────────────────────────────
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  if (action === 'ping') {
    return _json({
      ok: true,
      msg: 'SNS LoanIQ archive webhook is live',
      version: 'v5-cloudsync',
      capabilities: ['load','changes','upsertCustomer','upsertCustomers','replaceCustomers','upsertCaller','deleteCaller','archive']
    });
  }
  return _json({ ok:false, error: 'Use POST for data actions' });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return _json({ ok:false, error:'Invalid JSON body' }); }

  const action = body.action || (body.sheet && body.rows ? 'archive' : 'ping');

  try {
    // Public endpoints (no auth) -- legacy archive support
    if (action === 'archive') return _legacyArchive(body);
    if (action === 'ping')    return doGet({ parameter: { action:'ping' }});

    // All other endpoints require auth
    const email = _verifyAuth(body);
    if (!email) return _json({ ok:false, error:'Auth required — sign in with Google.' });
    if (!_isAllowed(email)) return _json({ ok:false, error:'Not authorized: ' + email });

    switch (action) {
      case 'load':              return _json(_load(email));
      case 'changes':           return _json(_changes(body.since || 0, email));
      case 'upsertCustomer':    return _json(_upsertCustomer(body.customer, email));
      case 'upsertCustomers':   return _json(_upsertCustomers(body.customers || [], email));
      case 'replaceCustomers':  return _json(_replaceCustomers(body.customers || [], email));
      case 'upsertCaller':      return _json(_upsertCaller(body.caller, email));
      case 'upsertCallers':     return _json(_upsertCallers(body.callers || [], email));
      case 'deleteCaller':      return _json(_deleteCaller(body.id, email));
      case 'setSetting':        return _json(_setSetting(body.key, body.value, email));
      case 'setSettings':       return _json(_setSettings(body.settings || {}, email));
      case 'whoami':            return _json({ ok:true, email, ts: Date.now() });
      default: return _json({ ok:false, error:'Unknown action: '+action });
    }
  } catch (err) {
    return _json({ ok:false, error: String(err && err.message || err) });
  }
}

// ─── Auth ──────────────────────────────────────────────────────────
function _verifyAuth(body) {
  if (!body.idToken) return null;
  try {
    // tokeninfo endpoint validates signature, expiry and audience
    const resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(body.idToken),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return null;
    const info = JSON.parse(resp.getContentText());
    if (!info.email || !info.email_verified) return null;

    const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
    if (clientId && info.aud !== clientId) return null;

    // Expiry check (tokeninfo already does this, but belt-and-braces)
    if (info.exp && Number(info.exp) * 1000 < Date.now()) return null;

    return String(info.email).toLowerCase();
  } catch (e) {
    return null;
  }
}

function _isAllowed(email) {
  const raw = PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '';
  if (!raw.trim()) return true; // open mode — set ALLOWED_EMAILS to restrict
  return raw.toLowerCase().split(',').map(s => s.trim()).includes(email);
}

function _isAdmin(email) {
  const raw = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '';
  if (!raw.trim()) return true;
  return raw.toLowerCase().split(',').map(s => s.trim()).includes(email);
}

// ─── DB layer ──────────────────────────────────────────────────────
function _ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function _ensureSheet(name, cols) {
  const ss = _ss();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // Ensure all expected columns exist (append missing at the end)
    const headers = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0];
    const missing = cols.filter(c => headers.indexOf(c) < 0);
    if (missing.length) {
      const start = headers.length + 1;
      sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  }
  return sh;
}

function _readAll(name, cols) {
  const sh = _ensureSheet(name, cols);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();
  return data.map(row => _rowToObj(row, headers));
}

function _rowToObj(row, headers) {
  const o = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]; if (!h) continue;
    let v = row[i];
    if (h === 'callHistory') {
      if (typeof v === 'string' && v.trim()) {
        try { v = JSON.parse(v); } catch(e) { v = []; }
      } else v = [];
    }
    if (h === 'enriched' || h === 'active' || h === 'deleted') v = v === true || v === 'TRUE' || v === 'true' || v === 1;
    if (h === 'score' || h === 'color' || h === 'callCount' || h === 'waCount' ||
        h === 'lastCalledAt' || h === 'lastWaAt' || h === 'updatedAt') {
      v = (v === '' || v == null) ? (h === 'score' ? 0 : 0) : Number(v);
      if (isNaN(v)) v = 0;
    }
    o[h] = v;
  }
  return o;
}

function _objToRow(obj, headers) {
  return headers.map(h => {
    let v = obj[h];
    if (v === undefined || v === null) return '';
    if (h === 'callHistory') return JSON.stringify(v || []);
    return v;
  });
}

function _findRowIndex(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2,1,last-1,1).getValues(); // assumes id in col A
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // 1-indexed + header
  }
  return -1;
}

function _withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

// ─── Customers ─────────────────────────────────────────────────────
function _load(email) {
  const customers = _readAll(SHEET_CUSTOMERS, CUSTOMER_COLS).filter(c => !c.deleted);
  const callers   = _readAll(SHEET_CALLERS, CALLER_COLS).filter(c => !c.deleted);
  const settings  = _readSettings();
  return { ok:true, customers, callers, settings, ts: Date.now(), me: email };
}

function _changes(since, email) {
  since = Number(since) || 0;
  const allC = _readAll(SHEET_CUSTOMERS, CUSTOMER_COLS);
  const allK = _readAll(SHEET_CALLERS, CALLER_COLS);
  const allS = _readAll(SHEET_SETTINGS, SETTING_COLS);
  const customers = allC.filter(c => (c.updatedAt || 0) > since && !c.deleted);
  const deletedCustomers = allC.filter(c => (c.updatedAt || 0) > since && c.deleted).map(c => c.id);
  const callers = allK.filter(c => (c.updatedAt || 0) > since && !c.deleted);
  const deletedCallers = allK.filter(c => (c.updatedAt || 0) > since && c.deleted).map(c => c.id);
  const changedSettings = {};
  allS.filter(s => (s.updatedAt || 0) > since).forEach(s => {
    changedSettings[s.key] = _parseSettingValue(s.value);
  });
  return {
    ok:true,
    customers, deletedCustomers,
    callers, deletedCallers,
    settings: changedSettings,
    ts: Date.now()
  };
}

function _upsertCustomer(c, email) {
  if (!c || !c.id) return { ok:false, error:'Customer must have id' };
  return _withLock(() => {
    const sh = _ensureSheet(SHEET_CUSTOMERS, CUSTOMER_COLS);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    c.updatedAt = Date.now();
    c.updatedBy = email;
    const row = _objToRow(c, headers);
    const idx = _findRowIndex(sh, c.id);
    if (idx > 0) {
      sh.getRange(idx,1,1,headers.length).setValues([row]);
    } else {
      sh.appendRow(row);
    }
    return { ok:true, ts: c.updatedAt };
  });
}

function _upsertCustomers(list, email) {
  if (!Array.isArray(list) || !list.length) return { ok:false, error:'Empty list' };
  return _withLock(() => {
    const sh = _ensureSheet(SHEET_CUSTOMERS, CUSTOMER_COLS);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const last = sh.getLastRow();
    const idMap = {};
    if (last >= 2) {
      const ids = sh.getRange(2,1,last-1,1).getValues();
      for (let i = 0; i < ids.length; i++) idMap[String(ids[i][0])] = i + 2;
    }
    const now = Date.now();
    const appendBuffer = [];
    list.forEach(c => {
      if (!c.id) c.id = 'cust_' + now + '_' + Math.random().toString(36).slice(2,7);
      c.updatedAt = now;
      c.updatedBy = email;
      const row = _objToRow(c, headers);
      const idx = idMap[String(c.id)];
      if (idx) sh.getRange(idx,1,1,headers.length).setValues([row]);
      else appendBuffer.push(row);
    });
    if (appendBuffer.length) {
      const start = sh.getLastRow() + 1;
      sh.getRange(start,1,appendBuffer.length,headers.length).setValues(appendBuffer);
    }
    return { ok:true, ts: now, count: list.length };
  });
}

function _replaceCustomers(list, email) {
  return _withLock(() => {
    const sh = _ensureSheet(SHEET_CUSTOMERS, CUSTOMER_COLS);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    // tombstone existing rows so deltas propagate
    const last = sh.getLastRow();
    const now = Date.now();
    if (last >= 2) {
      const upd = headers.indexOf('updatedAt') + 1;
      const dl  = headers.indexOf('deleted') + 1;
      for (let r = 2; r <= last; r++) {
        sh.getRange(r, dl).setValue(true);
        sh.getRange(r, upd).setValue(now);
      }
    }
    // append new rows
    const rows = list.map(c => {
      if (!c.id) c.id = 'cust_' + now + '_' + Math.random().toString(36).slice(2,7);
      c.updatedAt = now;
      c.updatedBy = email;
      c.deleted = false;
      return _objToRow(c, headers);
    });
    if (rows.length) {
      const start = sh.getLastRow() + 1;
      sh.getRange(start,1,rows.length,headers.length).setValues(rows);
    }
    return { ok:true, ts: now, count: rows.length };
  });
}

// ─── Callers ───────────────────────────────────────────────────────
function _upsertCaller(c, email) {
  if (!c || !c.id) return { ok:false, error:'Caller must have id' };
  return _withLock(() => {
    const sh = _ensureSheet(SHEET_CALLERS, CALLER_COLS);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    c.updatedAt = Date.now();
    c.updatedBy = email;
    const row = _objToRow(c, headers);
    const idx = _findRowIndex(sh, c.id);
    if (idx > 0) sh.getRange(idx,1,1,headers.length).setValues([row]);
    else sh.appendRow(row);
    return { ok:true, ts: c.updatedAt };
  });
}

function _upsertCallers(list, email) {
  if (!Array.isArray(list)) return { ok:false, error:'Bad list' };
  return _withLock(() => {
    const sh = _ensureSheet(SHEET_CALLERS, CALLER_COLS);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const last = sh.getLastRow();
    const idMap = {};
    if (last >= 2) {
      const ids = sh.getRange(2,1,last-1,1).getValues();
      for (let i = 0; i < ids.length; i++) idMap[String(ids[i][0])] = i + 2;
    }
    const now = Date.now();
    const appendBuf = [];
    list.forEach(c => {
      c.updatedAt = now; c.updatedBy = email;
      const row = _objToRow(c, headers);
      const idx = idMap[String(c.id)];
      if (idx) sh.getRange(idx,1,1,headers.length).setValues([row]);
      else appendBuf.push(row);
    });
    if (appendBuf.length) {
      const start = sh.getLastRow() + 1;
      sh.getRange(start,1,appendBuf.length,headers.length).setValues(appendBuf);
    }
    return { ok:true, ts: now, count: list.length };
  });
}

function _deleteCaller(id, email) {
  if (!id) return { ok:false, error:'Need id' };
  return _withLock(() => {
    const sh = _ensureSheet(SHEET_CALLERS, CALLER_COLS);
    const idx = _findRowIndex(sh, id);
    if (idx < 0) return { ok:true, ts: Date.now() };
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const dl = headers.indexOf('deleted') + 1;
    const upd = headers.indexOf('updatedAt') + 1;
    const ub  = headers.indexOf('updatedBy') + 1;
    const now = Date.now();
    sh.getRange(idx, dl).setValue(true);
    sh.getRange(idx, upd).setValue(now);
    sh.getRange(idx, ub).setValue(email);
    return { ok:true, ts: now };
  });
}

// ─── Settings (shared key/value config) ────────────────────────────
function _parseSettingValue(v) {
  if (typeof v !== 'string') return v;
  if (!v) return '';
  try { return JSON.parse(v); } catch (e) { return v; }
}
function _stringifySettingValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function _readSettings() {
  const rows = _readAll(SHEET_SETTINGS, SETTING_COLS);
  const out = {};
  rows.forEach(r => { if (r.key) out[r.key] = _parseSettingValue(r.value); });
  return out;
}

function _setSetting(key, value, email) {
  if (!key) return { ok:false, error:'Setting key required' };
  return _withLock(() => {
    const sh = _ensureSheet(SHEET_SETTINGS, SETTING_COLS);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const now = Date.now();
    const stored = _stringifySettingValue(value);
    const last = sh.getLastRow();
    let foundRow = -1;
    if (last >= 2) {
      const keys = sh.getRange(2,1,last-1,1).getValues();
      for (let i = 0; i < keys.length; i++) {
        if (String(keys[i][0]) === String(key)) { foundRow = i + 2; break; }
      }
    }
    const row = [key, stored, now, email];
    if (foundRow > 0) {
      sh.getRange(foundRow,1,1,headers.length).setValues([row]);
    } else {
      sh.appendRow(row);
    }
    return { ok:true, ts: now };
  });
}

function _setSettings(map, email) {
  if (!map || typeof map !== 'object') return { ok:false, error:'Bad settings map' };
  return _withLock(() => {
    const sh = _ensureSheet(SHEET_SETTINGS, SETTING_COLS);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const last = sh.getLastRow();
    const idx = {};
    if (last >= 2) {
      const keys = sh.getRange(2,1,last-1,1).getValues();
      for (let i = 0; i < keys.length; i++) idx[String(keys[i][0])] = i + 2;
    }
    const now = Date.now();
    const appendBuf = [];
    Object.keys(map).forEach(k => {
      const row = [k, _stringifySettingValue(map[k]), now, email];
      const r = idx[k];
      if (r) sh.getRange(r,1,1,headers.length).setValues([row]);
      else appendBuf.push(row);
    });
    if (appendBuf.length) {
      const start = sh.getLastRow() + 1;
      sh.getRange(start,1,appendBuf.length,headers.length).setValues(appendBuf);
    }
    return { ok:true, ts: now, count: Object.keys(map).length };
  });
}

// ─── Legacy archive (unchanged, backward-compat) ───────────────────
function _legacyArchive(body) {
  const sheetName = body.sheet || ('Archive ' + new Date().toISOString().slice(0,16).replace('T',' '));
  const rows = body.rows || [];
  if (!rows.length) return _json({ ok:false, error:'No rows' });
  return _withLock(() => {
    const ss = _ss();
    let sh = ss.getSheetByName(sheetName);
    if (!sh || body.replace) {
      if (sh && body.replace) ss.deleteSheet(sh);
      sh = ss.insertSheet(sheetName);
    }
    sh.getRange(sh.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);
    return _json({ ok:true, sheet: sheetName, added: rows.length, url: ss.getUrl() + '#gid=' + sh.getSheetId() });
  });
}

// ─── Utils ─────────────────────────────────────────────────────────
function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── First-time setup helper (run manually from the editor) ────────
function setup() {
  _ensureSheet(SHEET_CUSTOMERS, CUSTOMER_COLS);
  _ensureSheet(SHEET_CALLERS, CALLER_COLS);
  _ensureSheet(SHEET_SETTINGS, SETTING_COLS);
  _ensureSheet(SHEET_META, ['key','value']);
  Logger.log('✓ Sheets created. Now set Script Properties and deploy as Web app.');
}
