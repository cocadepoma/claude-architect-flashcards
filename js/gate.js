// Access gate. All course content ships encrypted in vault/ (see tools/seal.mjs); nothing readable reaches
// the page until the visitor enters the access code. The code unwraps the content key, which decrypts the
// data bundle and, on demand, each slide image. The app scripts only load after a successful unlock.
(() => {
  'use strict';

  const REMEMBER_KEY = 'cca-f:access';
  const APP_SCRIPTS = [
    'js/dom.js', 'js/cards.js', 'js/plan.js', 'js/companion.js', 'js/lessons.js',
    'js/glossary.js', 'js/exam-engine.js', 'js/exams.js', 'js/app.js',
  ];
  const IMAGE_CACHE_LIMIT = 24;

  const gate = document.getElementById('gate');
  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-code');
  const error = document.getElementById('gate-error');
  const submit = document.getElementById('gate-submit');
  const app = document.getElementById('app');

  const { subtle } = window.crypto;
  const enc = new TextEncoder();
  const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
  // Must match normalizeCode in tools/seal.mjs.
  const normalizeCode = (code) => code.normalize('NFKC').toLowerCase().replace(/[\s-]+/g, '');

  const remembered = {
    get() { try { return localStorage.getItem(REMEMBER_KEY); } catch { return null; } },
    set(value) { try { localStorage.setItem(REMEMBER_KEY, value); } catch { /* storage unavailable */ } },
    clear() { try { localStorage.removeItem(REMEMBER_KEY); } catch { /* storage unavailable */ } },
  };

  async function fetchBytes(path) {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  // Sealed layout: 12-byte IV, then AES-GCM ciphertext + tag, with `label` bound as AAD.
  const open = (key, sealed, label) => subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: enc.encode(label) }, key, sealed.subarray(12));

  // Returns the raw content key, or throws (AES-GCM authentication fails) when the code is wrong.
  async function contentKeyFromCode(code) {
    const meta = await (await fetch('vault/key.json', { cache: 'no-cache' })).json();
    const base = await subtle.importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey']);
    const kek = await subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(meta.salt), iterations: meta.iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(meta.iv), additionalData: enc.encode('key') }, kek, fromB64(meta.key)));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.body.append(script);
    });
  }

  // Decrypted slide images as blob URLs, least recently used first out.
  function imageVault(key) {
    const cache = new Map();
    return {
      image(src) {
        let url = cache.get(src);
        if (url) {
          cache.delete(src);
        } else {
          url = fetchBytes(`vault/slides/${src}.bin`)
            .then((sealed) => open(key, sealed, `slides/${src}`))
            .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: 'image/webp' })));
          url.catch(() => { if (cache.get(src) === url) cache.delete(src); });
        }
        cache.set(src, url);
        while (cache.size > IMAGE_CACHE_LIMIT) {
          const [oldest, oldUrl] = cache.entries().next().value;
          cache.delete(oldest);
          oldUrl.then(URL.revokeObjectURL, () => {});
        }
        return url;
      },
    };
  }

  // Decrypts the data bundle with the raw content key; throws if the key is wrong.
  async function unlock(rawKey) {
    const key = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const data = await open(key, await fetchBytes('vault/data.bin'), 'data.js');
    window.VAULT = imageVault(key);
    const bundle = URL.createObjectURL(new Blob([data], { type: 'text/javascript' }));
    try {
      await loadScript(bundle);
    } finally {
      URL.revokeObjectURL(bundle);
    }
    gate.hidden = true;
    app.hidden = false;
    for (const src of APP_SCRIPTS) await loadScript(src);
  }

  function setBusy(busy, label) {
    submit.disabled = busy;
    input.disabled = busy;
    submit.textContent = busy ? label : 'Unlock';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    setBusy(true, 'Checking…');
    let rawKey;
    try {
      rawKey = await contentKeyFromCode(input.value);
    } catch {
      setBusy(false);
      error.textContent = 'Wrong code.';
      input.select();
      return;
    }
    try {
      await unlock(rawKey);
      remembered.set(toB64(rawKey));
    } catch (err) {
      setBusy(false);
      error.textContent = `Could not open the content: ${err.message}`;
    }
  });

  // Returning visitor on this device: reuse the stored content key; if it no longer works, ask again.
  const saved = remembered.get();
  if (saved) {
    setBusy(true, 'Unlocking…');
    unlock(fromB64(saved)).catch(() => {
      remembered.clear();
      setBusy(false);
      input.focus();
    });
  } else {
    input.focus();
  }
})();
