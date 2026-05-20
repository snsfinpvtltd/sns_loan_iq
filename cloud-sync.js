/* SNS LoanIQ — Cloud Sync layer
 * Wraps the Apps Script webhook so the front-end can:
 *   - Sign in with Google (ID token)
 *   - Load the full DB on first boot
 *   - Push per-record upserts as the user edits
 *   - Poll for deltas from other users every POLL_MS
 *
 * The HTML page provides:
 *   window.CLOUD_CONFIG = { webhook, clientId, pollMs }
 * and listens for:
 *   window.addEventListener('cloud-remote-change', e => ...)
 *
 * Public API:  window.CloudSync.{init, signIn, signOut, load, upsertCustomer,
 *                                upsertCallers, replaceCustomers, deleteCaller,
 *                                startPolling, stopPolling, user, isAuthed}
 */
(function () {
  const CFG = Object.assign({ pollMs: 8000, webhook: '', clientId: '' }, window.CLOUD_CONFIG || {});
  const state = {
    idToken: null,
    tokenExp: 0,
    user: null,        // {email, name, picture}
    lastSync: 0,
    pollTimer: null,
    pushQueue: Promise.resolve(),
    onlineSince: Date.now(),
    lastError: null,
  };

  // ─── HTTP ────────────────────────────────────────────────────────
  async function call(action, body = {}) {
    if (!CFG.webhook) throw new Error('Cloud webhook not configured');
    const payload = Object.assign({ action, idToken: state.idToken }, body);
    const resp = await fetch(CFG.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Bad response from server: ' + text.slice(0, 120)); }
    if (!data.ok) {
      state.lastError = data.error || 'Unknown error';
      throw new Error(data.error || 'Server rejected request');
    }
    state.lastError = null;
    return data;
  }

  // ─── Auth (Google Identity Services) ─────────────────────────────
  function _parseJwt(tok) {
    const part = tok.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  }

  function _handleCredentialResponse(response) {
    if (!response || !response.credential) return;
    state.idToken = response.credential;
    const payload = _parseJwt(response.credential);
    state.tokenExp = (payload.exp || 0) * 1000;
    state.user = {
      email: (payload.email || '').toLowerCase(),
      name: payload.name || payload.email,
      picture: payload.picture || '',
      given_name: payload.given_name || ''
    };
    try { sessionStorage.setItem('liq_idtoken', response.credential); } catch (e) {}
    window.dispatchEvent(new CustomEvent('cloud-signin', { detail: { user: state.user } }));
  }

  function _restoreFromSession() {
    try {
      const tok = sessionStorage.getItem('liq_idtoken');
      if (!tok) return false;
      const payload = _parseJwt(tok);
      if ((payload.exp || 0) * 1000 < Date.now() + 30000) return false;
      state.idToken = tok;
      state.tokenExp = payload.exp * 1000;
      state.user = {
        email: (payload.email || '').toLowerCase(),
        name: payload.name || payload.email,
        picture: payload.picture || '',
        given_name: payload.given_name || ''
      };
      return true;
    } catch (e) { return false; }
  }

  function init() {
    // Make callback global for GSI
    window._cloudGoogleCallback = _handleCredentialResponse;
    return _restoreFromSession();
  }

  function renderSignInButton(containerId) {
    if (!window.google || !window.google.accounts) {
      // GSI hasn't loaded yet, try again shortly
      setTimeout(() => renderSignInButton(containerId), 250);
      return;
    }
    if (!CFG.clientId) {
      const el = document.getElementById(containerId);
      if (el) el.innerHTML = '<div style="color:#A32D2D;font-size:12px;text-align:center;padding:12px">Google client ID missing in CLOUD_CONFIG.</div>';
      return;
    }
    window.google.accounts.id.initialize({
      client_id: CFG.clientId,
      callback: _handleCredentialResponse,
      auto_select: false,
      ux_mode: 'popup',
    });
    const el = document.getElementById(containerId);
    if (el) {
      el.innerHTML = '';
      window.google.accounts.id.renderButton(el, {
        theme: 'filled_blue',
        size: 'large',
        type: 'standard',
        shape: 'pill',
        text: 'signin_with',
        logo_alignment: 'left',
        width: 300,
      });
      window.google.accounts.id.prompt(); // One Tap
    }
  }

  function signOut() {
    state.idToken = null;
    state.user = null;
    state.tokenExp = 0;
    state.lastSync = 0;
    try { sessionStorage.removeItem('liq_idtoken'); } catch (e) {}
    if (window.google && window.google.accounts && window.google.accounts.id) {
      try { window.google.accounts.id.disableAutoSelect(); } catch (e) {}
    }
    stopPolling();
  }

  // ─── Data ops ────────────────────────────────────────────────────
  async function load() {
    const data = await call('load');
    state.lastSync = data.ts;
    return { customers: data.customers || [], callers: data.callers || [] };
  }

  async function pull() {
    if (!state.lastSync) return null;
    const data = await call('changes', { since: state.lastSync });
    state.lastSync = data.ts;
    const hasChanges = (data.customers && data.customers.length) ||
                       (data.callers && data.callers.length) ||
                       (data.deletedCustomers && data.deletedCustomers.length) ||
                       (data.deletedCallers && data.deletedCallers.length);
    if (hasChanges) {
      return {
        customers: data.customers || [],
        callers: data.callers || [],
        deletedCustomers: data.deletedCustomers || [],
        deletedCallers: data.deletedCallers || [],
      };
    }
    return null;
  }

  function _queue(fn) {
    state.pushQueue = state.pushQueue.then(fn, fn);
    return state.pushQueue;
  }

  function upsertCustomer(c) {
    return _queue(() => call('upsertCustomer', { customer: c }));
  }
  function upsertCustomers(list) {
    return _queue(() => call('upsertCustomers', { customers: list }));
  }
  function replaceCustomers(list) {
    return _queue(() => call('replaceCustomers', { customers: list }));
  }
  function upsertCaller(c) {
    return _queue(() => call('upsertCaller', { caller: c }));
  }
  function upsertCallers(list) {
    return _queue(() => call('upsertCallers', { callers: list }));
  }
  function deleteCaller(id) {
    return _queue(() => call('deleteCaller', { id }));
  }

  function setSetting(key, value) {
    return _queue(() => call('setSetting', { key, value }));
  }
  function setSettings(map) {
    return _queue(() => call('setSettings', { settings: map }));
  }
  async function fetchSettings() {
    const data = await call('load');
    state.lastSync = data.ts;
    return data.settings || {};
  }

  // ─── Polling for remote changes ──────────────────────────────────
  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(async () => {
      if (document.hidden) return; // pause when tab not visible
      try {
        const delta = await pull();
        if (delta) {
          window.dispatchEvent(new CustomEvent('cloud-remote-change', { detail: delta }));
        }
      } catch (e) {
        console.warn('[CloudSync] poll error:', e.message);
        window.dispatchEvent(new CustomEvent('cloud-sync-error', { detail: { error: e.message }}));
      }
    }, CFG.pollMs);
  }

  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  // ─── Health ──────────────────────────────────────────────────────
  async function ping() {
    if (!CFG.webhook) throw new Error('No webhook configured');
    const url = CFG.webhook + (CFG.webhook.includes('?') ? '&' : '?') + 'action=ping';
    const r = await fetch(url, { method: 'GET' });
    return r.json();
  }

  // ─── Public ──────────────────────────────────────────────────────
  window.CloudSync = {
    init,
    renderSignInButton,
    signOut,
    ping,
    load, pull,
    upsertCustomer, upsertCustomers, replaceCustomers,
    upsertCaller, upsertCallers, deleteCaller,
    setSetting, setSettings, fetchSettings,
    startPolling, stopPolling,
    get user()       { return state.user; },
    get isAuthed()   { return !!state.idToken && state.tokenExp > Date.now(); },
    get lastError()  { return state.lastError; },
    get lastSync()   { return state.lastSync; },
    get hasWebhook() { return !!CFG.webhook; },
    get config()     { return Object.assign({}, CFG); },
  };
})();
