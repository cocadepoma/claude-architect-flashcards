#!/usr/bin/env node
// Seals the plaintext course content in private/ into vault/, so the public site and repo only hold ciphertext.
//
//   FLASHCARDS_CODE='the access code' node tools/seal.mjs
//
// Envelope encryption:
// - A random content key (private/content.key, never committed) encrypts every file with AES-256-GCM.
// - The access code, stretched with PBKDF2-SHA256, wraps that content key into vault/key.json.
// Changing the code therefore only rewrites vault/key.json. IVs are derived from the content (HMAC), so
// re-sealing unchanged files produces identical bytes and no git churn.
// The code is normalised (NFKC, lower case, spaces and dashes removed); js/gate.js must do the same.

import { webcrypto as crypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE = join(ROOT, 'private');
const VAULT = join(ROOT, 'vault');
const CONTENT_KEY_FILE = join(PRIVATE, 'content.key');
// Same order the site used to load them as plain <script> tags.
const DATA_FILES = ['cards', 'plan', 'companion', 'lessons', 'glossary', 'exams', 'assessments'];
const ITERATIONS = 600_000;
const MIN_CODE_LENGTH = 8;

const { subtle } = crypto;
const enc = new TextEncoder();
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const fromB64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));

export const normalizeCode = (code) => code.normalize('NFKC').toLowerCase().replace(/[\s-]+/g, '');

async function readCode() {
  if (process.env.FLASHCARDS_CODE) return process.env.FLASHCARDS_CODE;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question('Access code: ');
  } finally {
    rl.close();
  }
}

async function loadMasterKey() {
  if (existsSync(CONTENT_KEY_FILE)) return fromB64((await readFile(CONTENT_KEY_FILE, 'utf8')).trim());
  const master = crypto.getRandomValues(new Uint8Array(32));
  await writeFile(CONTENT_KEY_FILE, `${b64(master)}\n`, { mode: 0o600 });
  console.log('Created private/content.key (keep it: losing it means re-sealing everything).');
  return master;
}

async function deriveKeys(master) {
  const base = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const derive = (info) => subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, base, 256);
  const contentRaw = new Uint8Array(await derive('cca-f/content'));
  const ivRaw = new Uint8Array(await derive('cca-f/iv'));
  return {
    contentRaw,
    content: await subtle.importKey('raw', contentRaw, 'AES-GCM', false, ['encrypt']),
    iv: await subtle.importKey('raw', ivRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  };
}

// Sealed file layout: 12-byte IV followed by the AES-GCM ciphertext and tag. `label` is bound as AAD.
async function seal(keys, label, plaintext) {
  const aad = enc.encode(label);
  const mac = new Uint8Array(await subtle.sign('HMAC', keys.iv, Buffer.concat([aad, Buffer.from([0]), plaintext])));
  const iv = mac.slice(0, 12);
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, keys.content, plaintext));
  return Buffer.concat([iv, ciphertext]);
}

async function writeIfChanged(file, bytes) {
  if (existsSync(file) && Buffer.compare(await readFile(file), bytes) === 0) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return true;
}

async function kekFromCode(code, salt, usages) {
  const base = await subtle.importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, usages);
}

// Keeps vault/key.json when the code already unwraps the current content key; otherwise re-wraps it.
async function sealKeyFile(code, contentRaw) {
  const file = join(VAULT, 'key.json');
  if (existsSync(file)) {
    try {
      const meta = JSON.parse(await readFile(file, 'utf8'));
      if (meta.iterations === ITERATIONS) {
        const kek = await kekFromCode(code, fromB64(meta.salt), ['decrypt']);
        const raw = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(meta.iv), additionalData: enc.encode('key') }, kek, fromB64(meta.key)));
        if (Buffer.compare(raw, contentRaw) === 0) return false;
      }
    } catch {
      // Different code or content key: fall through and re-wrap.
    }
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await kekFromCode(code, salt, ['encrypt']);
  const wrapped = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('key') }, kek, contentRaw);
  const meta = { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), key: b64(new Uint8Array(wrapped)) };
  await mkdir(VAULT, { recursive: true });
  await writeFile(file, `${JSON.stringify(meta, null, 1)}\n`);
  return true;
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => join(e.parentPath, e.name));
}

async function main() {
  const code = await readCode();
  if (normalizeCode(code).length < MIN_CODE_LENGTH) {
    console.error(`The code needs at least ${MIN_CODE_LENGTH} characters (ignoring spaces and dashes); short codes can be brute-forced offline.`);
    process.exit(1);
  }

  const keys = await deriveKeys(await loadMasterKey());
  const keyChanged = await sealKeyFile(code, keys.contentRaw);

  const data = Buffer.concat(await Promise.all(DATA_FILES.map(async (name) =>
    Buffer.concat([await readFile(join(PRIVATE, 'data', `${name}.js`)), Buffer.from(';\n')]))));
  const dataChanged = await writeIfChanged(join(VAULT, 'data.bin'), await seal(keys, 'data.js', data));

  // Slides: private/slides/<deck>/<n>.webp -> vault/slides/<deck>/<n>.webp.bin
  const slidesDir = join(PRIVATE, 'slides');
  const sealedDir = join(VAULT, 'slides');
  const expected = new Set();
  let slidesChanged = 0;
  for (const file of await listFiles(slidesDir)) {
    const rel = relative(slidesDir, file).split('\\').join('/');
    const target = join(sealedDir, `${rel}.bin`);
    expected.add(target);
    if (await writeIfChanged(target, await seal(keys, `slides/${rel}`, await readFile(file)))) slidesChanged += 1;
  }
  let removed = 0;
  if (existsSync(sealedDir)) {
    for (const file of await listFiles(sealedDir)) {
      if (!expected.has(file)) { await rm(file); removed += 1; }
    }
  }

  console.log(`key.json ${keyChanged ? 'updated' : 'unchanged'}, data.bin ${dataChanged ? 'updated' : 'unchanged'}, ` +
    `slides: ${expected.size} sealed (${slidesChanged} changed, ${removed} removed).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
