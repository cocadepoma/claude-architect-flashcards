// Sync section: moves exam and assessment results and Mistakes between devices as a text code, with no server.
// Export copies a code; import on the other device merges it into what is already there, so nothing is lost.
// The access code, open attempts and view preferences are device-local and never travel.
window.Sync = (() => {
  'use strict';

  const CODE_PREFIX = 'CCAF1.';
  const FORMAT_VERSION = 1;
  const HISTORY_KEY = /^cca-f:[\w-]+:history$/;
  const MISTAKES_KEY = 'cca-f:mistakes';
  const MAX_TRACKED_ATTEMPTS = 500;

  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isResult = (r) => isObject(r) && [r.correct, r.total, r.date].every(Number.isFinite);
  const syncedKey = (key) => key === MISTAKES_KEY || HISTORY_KEY.test(key);

  // Base64 over UTF-8 so the code survives copy and paste between apps.
  function encode(text) {
    let binary = '';
    new TextEncoder().encode(text).forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

  function createCode(data) {
    return CODE_PREFIX + encode(JSON.stringify({ v: FORMAT_VERSION, exportedAt: Date.now(), data }));
  }

  // Returns the synced data in a code, or throws an Error whose message can be shown to the user.
  function parseCode(code) {
    const compact = String(code || '').replace(/\s+/g, '');
    if (!compact) throw new Error('Paste a sync code first.');
    if (!compact.startsWith(CODE_PREFIX)) throw new Error('This is not a sync code from this app.');
    let payload;
    try {
      payload = JSON.parse(decode(compact.slice(CODE_PREFIX.length)));
    } catch {
      throw new Error('The sync code is incomplete or damaged. Copy it again.');
    }
    if (!isObject(payload) || payload.v !== FORMAT_VERSION || !isObject(payload.data)) {
      throw new Error('This sync code comes from a different version of the app.');
    }
    return Object.fromEntries(Object.entries(payload.data).filter(([key]) => syncedKey(key)));
  }

  // Per exam: `last` is the most recent result, `best` the highest score, as the exam engine records them.
  function mergeHistory(local, incoming) {
    const merged = isObject(local) ? { ...local } : {};
    let updated = 0;
    if (!isObject(incoming)) return { merged, updated };
    for (const [examId, entry] of Object.entries(incoming)) {
      if (!isObject(entry)) continue;
      const current = isObject(merged[examId]) ? merged[examId] : {};
      const pick = (a, b, wins) => (!isResult(b) ? a : !isResult(a) || wins(b, a) ? b : a);
      const last = pick(current.last, entry.last, (b, a) => b.date > a.date);
      const best = pick(current.best, entry.best, (b, a) => b.correct > a.correct);
      if (!last && !best) continue;
      if (last !== current.last || best !== current.best) updated += 1;
      merged[examId] = { last, best };
    }
    return { merged, updated };
  }

  function normalizeMistakes(store) {
    const s = isObject(store) ? store : {};
    return {
      items: isObject(s.items) ? s.items : {},
      attempts: Array.isArray(s.attempts) ? s.attempts : [],
      removed: isObject(s.removed) ? s.removed : {},
    };
  }

  // Union of both stores. A question removed on either device stays removed unless it was failed again later.
  // The same question on both sides keeps the latest answer and the higher failure count.
  function mergeMistakes(localStore, incomingStore) {
    const local = normalizeMistakes(localStore);
    const incoming = normalizeMistakes(incomingStore);

    const removed = { ...local.removed };
    for (const [key, at] of Object.entries(incoming.removed)) {
      if (Number.isFinite(at) && !(removed[key] >= at)) removed[key] = at;
    }

    const items = {};
    for (const key of new Set([...Object.keys(local.items), ...Object.keys(incoming.items)])) {
      const a = isObject(local.items[key]) ? local.items[key] : null;
      const b = isObject(incoming.items[key]) ? incoming.items[key] : null;
      const latest = !a || (b && (b.lastAt || 0) > (a.lastAt || 0)) ? b : a;
      const count = Math.max(a ? a.count || 0 : 0, b ? b.count || 0 : 0);
      const item = { ...latest, count };
      if (removed[key] >= (item.lastAt || 0)) continue;
      items[key] = item;
    }

    const attempts = [...new Set([...local.attempts, ...incoming.attempts])].slice(-MAX_TRACKED_ATTEMPTS);
    const added = Object.keys(items).filter((key) => !local.items[key]).length;
    const dropped = Object.keys(local.items).filter((key) => !items[key]).length;
    return { merged: { items, attempts, removed }, added, dropped };
  }

  // ---------- Storage ----------
  function readAll(storage) {
    const data = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (syncedKey(key)) data[key] = storage.get(key, null);
    }
    return data;
  }

  function importData(storage, data) {
    const summary = { results: 0, added: 0, dropped: 0 };
    for (const [key, value] of Object.entries(data)) {
      if (key === MISTAKES_KEY) {
        const { merged, added, dropped } = mergeMistakes(storage.get(key, null), value);
        storage.set(key, merged);
        summary.added += added;
        summary.dropped += dropped;
      } else {
        const { merged, updated } = mergeHistory(storage.get(key, null), value);
        storage.set(key, merged);
        summary.results += updated;
      }
    }
    return summary;
  }

  // ---------- View ----------
  function mount(root) {
    const { h, storage } = window.DOM;
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    const exportStatus = h('p', { class: 'sync-status', role: 'status' });
    const exportBox = h('textarea', { class: 'sync-code', readonly: true, rows: 4, hidden: true, 'aria-label': 'Sync code' });
    const importBox = h('textarea', {
      class: 'sync-code', rows: 4, placeholder: 'Paste the sync code from your other device',
      autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Sync code to import',
    });
    const importStatus = h('p', { class: 'sync-status', role: 'alert' });

    async function copyCode() {
      exportBox.value = createCode(readAll(storage));
      exportBox.hidden = false;
      try {
        await navigator.clipboard.writeText(exportBox.value);
        exportStatus.textContent = 'Copied. Paste it in Sync on your other device.';
      } catch {
        exportBox.focus();
        exportBox.select();
        exportStatus.textContent = 'Copying is blocked here. Select the code above and copy it.';
      }
    }

    function runImport() {
      importStatus.classList.remove('is-error');
      let data;
      try {
        data = parseCode(importBox.value);
      } catch (error) {
        importStatus.classList.add('is-error');
        importStatus.textContent = error.message;
        return;
      }
      const { results, added, dropped } = importData(storage, data);
      const parts = [`${plural(results, 'exam result')} updated`, `${plural(added, 'new mistake')}`];
      if (dropped) parts.push(`${plural(dropped, 'mistake')} removed on the other device`);
      window.alert(`Sync complete: ${parts.join(', ')}.`);
      // Exam lists and Mistakes read storage when they render, so reload to show the merged data.
      location.reload();
    }

    root.replaceChildren(
      h('header', { class: 'doc-head' },
        h('h2', { class: 'doc-title', text: 'Sync' }),
        h('p', { class: 'lead', text: 'Move your exam and assessment results and your mistakes to another device, with no account or server. Copy the code here, then paste it in Sync on the other device. Importing merges both: nothing already on that device is lost.' })),
      h('section', { class: 'sync-block' },
        h('h3', { text: '1. On this device' }),
        h('button', { class: 'btn primary', type: 'button', text: 'Copy sync code', onclick: copyCode }),
        exportBox,
        exportStatus),
      h('section', { class: 'sync-block' },
        h('h3', { text: '2. On the other device' }),
        importBox,
        h('button', { class: 'btn', type: 'button', text: 'Import', onclick: runImport }),
        importStatus),
      h('p', { class: 'fine', text: 'Not synced: cards progress, open exams, the section you were on and the access code. Sync again whenever you switch devices.' }),
    );
  }

  const root = typeof document !== 'undefined' && document.getElementById('view-sync');
  if (root && window.DOM) mount(root);

  return { createCode, parseCode, mergeHistory, mergeMistakes };
})();
