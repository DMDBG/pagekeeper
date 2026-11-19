/* Pagekeeper — offline-first reader with Supabase sync.
   Everything is saved on the device first (IndexedDB) and synced when there's a connection. */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_FILE = 50 * 1024 * 1024;          // Supabase free plan's per-file limit
const CHARS_PER_PAGE = 1500;                // fixed page length: same page numbers on every device
const CFG = window.PK_CONFIG || {};
const BUILD = window.PK_BUILD || { version: "dev", sha: "", date: "" };
const WHATS_NEW = { id: "page-1", items: [
  "<b>Pop out the whole page:</b> under <b>Aa → Pop-out shows</b>, pick <b>The whole page</b> and a size (Phone, Tablet, Book page or Wide). Words are gray until they're read, then come into color. Double-click a word (double-tap on iPhone) to move the audiobook or read-aloud to it. Its top bar has play, skip, page turns and text size.",
  "<b>Choose the AI for recaps</b> in Settings → AI recaps: Claude, or free options (Google Gemini, Groq, OpenRouter, Mistral), or Ollama running on your PC with no key at all.",
  "<b>Highlights, notes and bookmarks:</b> select text to highlight it, add a note or look a word up. The bookmark button marks a page. Everything is under <b>Contents → Notes</b>, syncs to your other devices, and can be copied or saved as a file.",
  "<b>Search, People and Recap</b> are under Contents too. Search plays the audiobook from a result; People lists the names so far, never past your page; Recap (with your Anthropic API key) tells you what's happened in the series up to your page.",
  "<b>Listening:</b> a sleep timer (15, 30 or 60 minutes, or the end of the chapter, with a fade-out), smart rewind after a pause, and a chapter list once the audiobook is synced.",
  "<b>Collections:</b> group books from their … menu (and number them in a series); filter the shelf by collection.",
  "<b>Reading time:</b> each book shows how long you have spent with it (reading, listening, or both), on the shelf and in its … menu. Time on your phone and PC adds up.",
  "<b>Updates:</b> new versions come from GitHub. The Windows app updates itself (Settings → About). On iPhone, Pagekeeper tells you when there is a new version, and AltStore or SideStore can install it for you.",
  "<b>The welcome guide can be removed</b> from its … menu, and brought back from Settings.",
  "<b>Follow-along locks on within a minute</b> on the PC, starting right where you are, even when the book has an intro the audiobook skips. Then every sentence start is double-checked by listening, so the highlight changes right as each sentence is read.",
  "<b>Exact follow-along on the PC:</b> open a book with its audiobook and Pagekeeper listens to the whole thing once (about 20 minutes for a long book), then lights up each sentence right as it's read. No Line up needed, and it syncs to your iPhone.",
  "<b>M4B audiobooks split too:</b> big M4B and M4A files are now cut into smaller parts without changing the sound, so they can go to your iPhone. Sending over Wi-Fi does this for you.",
  "<b>Send audiobooks to your iPhone over Wi-Fi:</b> in the PC player, tap <b>Send to iPhone over Wi-Fi</b>, then on the iPhone tap <b>Get from PC</b>. No account storage and no size limit.",
  "<b>Split big audiobook files:</b> MP3s over 50 MB are cut into smaller parts (same sound, nothing re-encoded), so they copy to your account and your phone. For parts you already added, tap <b>Split big parts</b> in the player.",
  "<b>Pop-out extras:</b> lock it in place so clicks go through, hide it while paused, and show the chapter and time left. Right-click the pop-out, or find them under Aa.",
  "<b>Pop-out text menu:</b> right-click the pop-out (press and hold on iPhone) to close it, change the text size, switch the background, or play and pause.",
  "<b>Automatic sync is much faster:</b> a long audiobook now takes minutes instead of hours, and the player shows about how long is left.",
  "<b>Exact follow-along (Windows app):</b> in the full player, tap <b>Sync automatically</b>. Your PC listens to the audiobook once and matches it to the text, then the iPhone follows along exactly too.",
  "<b>Pop-out text</b> now shows one sentence at a time and moves along with the audiobook.",
  "<b>Dark mode</b> is now on everywhere. Change it in Settings under Look.",
  "<b>Audiobooks follow along:</b> as your own audiobook plays, the pages turn and the sentence is highlighted. If it drifts, tap <b>Line up</b> in the player, then the sentence you're hearing.",
  "<b>Play/pause key:</b> pick any key in Settings. On Windows it can work even while you're in another app.",
  "<b>Player for every book:</b> tap the headphones in any book. Without an audiobook it reads aloud: pause, skip a sentence, drag to any sentence, and change speed, volume and voice.",
  "<b>Audiobooks:</b> the same player with a scrubber, skip back and ahead, speed from 0.5× to 3×, and volume. Switch between Audiobook and Read aloud at the top.",
  "<b>Pop-out text:</b> tap the window button at the top of a book. \"Just text\" floats the words on your screen with no box; use Invert to swap the colors. Settings are under <b>Aa</b>.",
  "<b>Follow along:</b> Read aloud can highlight the sentence or the exact word. Choose under <b>Aa</b>.",
  "<b>Discover:</b> search Project Gutenberg and LibriVox, or add your own repos, without leaving the app."
] };
const ICON = {
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  next:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  type:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19l5-14 5 14M6 14h6M15 19l3-8 3 8M16 17h4"/></svg>',
  head:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1v-6h3zM3 19a2 2 0 002 2h1v-6H3z"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  bm:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  bmOn:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  dots:'<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  rw:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/></svg>',
  ff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-9-9 9 9 0 016.4 2.6L21 8"/><path d="M21 3v5h-5"/></svg>',
  speak:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg>',
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  book:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5z"/><path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5"/></svg>'
};

/* ---------- per-device preferences ---------- */
const prefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem("pk-prefs") || "{}"); } catch {}
  const isPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  p.device ||= isPhone ? "Phone" : "PC";
  // Dark is the default look. Older installs switch over once; after that it's your choice in Settings.
  if (!p.themeV) { p.themeV = 1; p.theme = "dark"; if (!p.paper || p.paper === "paper") p.paper = "night"; try { localStorage.setItem("pk-prefs", JSON.stringify(p)); } catch {} }
  p.paper ||= "night";
  p.fs ||= isPhone ? 18 : 20;
  return { get: k => p[k], set(k, v){ if (v === undefined) delete p[k]; else p[k] = v; try { localStorage.setItem("pk-prefs", JSON.stringify(p)); } catch {} } };
})();

function applyTheme(){
  const t = prefs.get("theme") || "dark";
  if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? "#0E1218" : "#F3F5F8";
  document.documentElement.style.background = dark ? "#0E1218" : "#F3F5F8";
  // iPhone app: match the status bar and system screens to the look.
  try { const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pk; if (h) Promise.resolve(h.postMessage({ op: "theme", mode: t })).catch(() => {}); } catch {}
}
applyTheme();
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch {}

/* ---------- IndexedDB: library, sync queues, book files and audio ---------- */
const idb = (() => {
  let opening;
  const open = () => opening ||= new Promise((res, rej) => {
    try { const r = indexedDB.open("pagekeeper", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => {
    const t = d.transaction("files", mode); const req = fn(t.objectStore("files"));
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return {
    get: k => tx("readonly", s => s.get(k)).catch(() => null),
    put: (k, v) => tx("readwrite", s => s.put(v, k)).catch(e => { console.warn("storage", e); return null; }),
    del: k => tx("readwrite", s => s.delete(k)).catch(() => null)
  };
})();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- app state ---------- */
const S = {
  net: "local",            // local | syncing | ok | offline | error
  netMsg: "",
  books: {},               // id -> doc
  dirty: new Map(),        // id -> revision waiting to be pushed
  uploads: [],             // files waiting to go to the cloud
  view: "library",
  cur: null, content: {}, page: 1, sheet: null, dock: false,
  reading: false, haveLocal: {}, showTracks: false, busy: null, findQ: ""
};
let rev = 0;

const GUIDE = {
  title: "Welcome to Pagekeeper", author: "A two-minute guide",
  chapters: [
    { title: "Your shelf, everywhere", blocks: [
      ["h","Your shelf, everywhere"],
      ["p","Pagekeeper remembers where you stopped reading. Turn to page 10 on your iPhone, open Pagekeeper on your PC, and it opens on page 10."],
      ["p","Page numbers are the same on every screen. EPUB and text books are cut into pages of a fixed length, so a bigger font doesn't change which page you're on. PDFs keep their own printed pages."],
      ["p","Everything is saved on the device first, so Pagekeeper works with no signal at all. When you're back online it syncs on its own."]]},
    { title: "Adding a book", blocks: [
      ["h","Adding a book"],
      ["p","Tap Add book and choose an EPUB, PDF or plain-text file. Files up to 50 MB are copied to your account, so they appear on your other devices automatically."],
      ["p","Bigger files stay on the device where you added them. Pagekeeper remembers the exact file, and your other devices show a button to download the same one and check that it matches."],
      ["p","The Find books tab lists free, legal sources such as Project Gutenberg and Standard Ebooks."]]},
    { title: "Listening while you read", blocks: [
      ["h","Listening while you read"],
      ["p","Tap the headphones in the reader to open the audio player. Add MP3, M4A or M4B files, or the zip that LibriVox gives you. They play under the text while you turn pages, and keep playing with the screen locked."],
      ["p","Your listening spot syncs too. Tap Download for offline before a flight so every part is on the phone."],
      ["p","No audiobook? Read aloud speaks the page with the device's own voice and turns the page when it finishes."]]},
    { title: "Little things", blocks: [
      ["h","Little things"],
      ["p","Swipe, use the arrow keys, or tap the edges of the page to turn. The Aa button changes the text size and the paper: white, sepia or night."],
      ["p","If you read ahead on another device while a book is open here, Pagekeeper asks before jumping to that page."],
      ["p","That's the guide. Go back to the shelf and add your first book."]]}
  ]
};

/* ---------- Supabase (REST, no SDK) ---------- */
class AuthError extends Error {}
const Cloud = {
  get url(){ return String(prefs.get("sbUrl") || CFG.supabaseUrl || "").trim().replace(/\/+$/, "").replace(/\/(rest|auth|storage)\/v1$/i, ""); },
  get key(){ return String(prefs.get("sbKey") || CFG.supabaseAnonKey || "").trim(); },
  session: (() => { try { return JSON.parse(localStorage.getItem("pk-session") || "null"); } catch { return null; } })(),
  configured(){ return !!(this.url && this.key); },
  signedIn(){ return !!(this.configured() && this.session); },
  uid(){ return this.session && this.session.user && this.session.user.id; },
  email(){ return this.session && this.session.user && this.session.user.email; },
  keep(){ try { if (this.session) localStorage.setItem("pk-session", JSON.stringify(this.session)); else localStorage.removeItem("pk-session"); } catch {} },
  async auth(path, body){
    const r = await fetch(this.url + "/auth/v1/" + path, { method: "POST", headers: { apikey: this.key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new AuthError(j.error_description || j.msg || j.message || `Sign-in failed (${r.status}).`);
    return j;
  },
  take(j){
    if (!j || !j.access_token) return false;
    this.session = { access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at ? j.expires_at * 1000 : Date.now() + (j.expires_in || 3600) * 1000,
      user: { id: j.user.id, email: j.user.email } };
    this.keep(); return true;
  },
  async signIn(email, password){ this.take(await this.auth("token?grant_type=password", { email, password })); },
  async signUp(email, password){ const j = await this.auth("signup", { email, password }); return this.take(j) ? "ok" : "confirm"; },
  signOut(){ this.session = null; this.keep(); },
  async token(){
    if (!this.session) throw new AuthError("Not signed in.");
    if (Date.now() > this.session.expires_at - 60000) {
      try { this.take(await this.auth("token?grant_type=refresh_token", { refresh_token: this.session.refresh_token })); }
      catch (e) { if (e instanceof AuthError) { this.signOut(); S.net = "local"; render(); toast("You've been signed out. Sign in again in Settings to keep syncing."); } throw e; }
    }
    return this.session.access_token;
  },
  async req(path, opts = {}){
    const t = await this.token();
    const r = await fetch(this.url + path, { ...opts, headers: { apikey: this.key, Authorization: "Bearer " + t, ...(opts.headers || {}) } });
    if (!r.ok) { const txt = await r.text().catch(() => ""); const e = new Error(`Server said ${r.status}: ${txt.slice(0, 160)}`); e.status = r.status; throw e; }
    return r;
  }
};
const encPath = p => p.split("/").map(encodeURIComponent).join("/");
const Files = {
  path: (id, name) => `${Cloud.uid()}/${id}/${name}`,
  up: (path, blob, type) => Cloud.req("/storage/v1/object/files/" + encPath(path), { method: "POST", headers: { "Content-Type": type || blob.type || "application/octet-stream", "x-upsert": "true", "cache-control": "3600" }, body: blob }),
  down: async path => (await Cloud.req("/storage/v1/object/files/" + encPath(path))).blob(),
  del: path => Cloud.req("/storage/v1/object/files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [path] }) })
};

/* ---------- local library + merge rules ---------- */
function deepMerge(a, b){
  const o = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) o[k] = (v && typeof v === "object" && !Array.isArray(v) && a && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) ? deepMerge(a[k], v) : v;
  return o;
}
/* Each part of a book has its own clock, so reading on one device and adding audio on another never undo each other. */
const PROGRESS = ["page", "pages", "updatedAt", "device"];
function merge(l, r){
  if (!l) return r; if (!r) return l;
  const meta = (r.metaAt || 0) >= (l.metaAt || 0) ? r : l;
  const prog = (r.updatedAt || 0) >= (l.updatedAt || 0) ? r : l;
  const la = l.audio || {}, ra = r.audio || {};
  const trk = (ra.tracksAt || 0) >= (la.tracksAt || 0) ? ra : la;
  const pos = (ra.updatedAt || 0) >= (la.updatedAt || 0) ? ra : la;
  const out = { ...meta };
  for (const k of PROGRESS) if (prog[k] !== undefined) out[k] = prog[k];
  out.audio = { tracks: trk.tracks || [], url: trk.url || "", tracksAt: trk.tracksAt || 0, track: pos.track || 0, time: pos.time || 0, updatedAt: pos.updatedAt || 0 };
  out.deleted = !!(l.deleted || r.deleted);
  // notes, highlights, bookmarks and saved words: keep every one, the newest version of each
  for (const k of ["marks", "vocab"]) { const u = { ...(l[k] || {}) }; for (const [id, v] of Object.entries(r[k] || {})) if (!u[id] || (v.at || 0) >= (u[id].at || 0)) u[id] = v; if (Object.keys(u).length) out[k] = u; }
  // reading time: each device's own count, so keep the larger of each
  const rd = { ...(l.read || {}) }; for (const [k, v] of Object.entries(r.read || {})) rd[k] = Math.max(rd[k] || 0, +v || 0);
  if (Object.keys(rd).length) out.read = rd;
  return out;
}
let persistTimer;
function persist(){ clearTimeout(persistTimer); persistTimer = setTimeout(() => {
  idb.put("__library", S.books); idb.put("__dirty", [...S.dirty.keys()]); idb.put("__uploads", S.uploads);
}, 300); }
/* save(): stamp the parts that changed, keep it on the device, then sync. */
function save(id, patch, opts = {}){
  const now = Date.now(); const p = { ...patch };
  const keys = Object.keys(p);
  if (keys.some(k => PROGRESS.includes(k))) { p.updatedAt = p.updatedAt || now; p.device = p.device || prefs.get("device"); }
  if (keys.some(k => !PROGRESS.includes(k) && k !== "audio")) p.metaAt = now;
  if (p.audio) { p.audio = { ...p.audio };
    if ("tracks" in p.audio || "url" in p.audio) p.audio.tracksAt = now;
    if ("track" in p.audio || "time" in p.audio) p.audio.updatedAt = now; }
  S.books[id] = deepMerge(S.books[id] || {}, p);
  S.dirty.set(id, ++rev);
  persist();
  scheduleSync(opts.now ? 50 : 1500);
}
const stripLocal = d => { const o = { ...d }; delete o._content; return o; };
/* Key-order-independent JSON, so "same data" never looks like a change. */
const canon = v => v === undefined ? "null" : v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";

/* ---------- sync engine ---------- */
let syncTimer, syncing = false, again = false;
function scheduleSync(ms){ clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); }
function setNet(n, msg){ const changed = S.net !== n || S.netMsg !== (msg || ""); S.net = n; S.netMsg = msg || ""; if (changed && S.view !== "reader") renderHeaderStatus(); }
async function syncNow(){
  if (!Cloud.signedIn()) { setNet("local"); return; }
  if (syncing) { again = true; return; }
  syncing = true; again = false;
  try {
    if (navigator.onLine === false) throw Object.assign(new Error("offline"), { offline: true });
    setNet("syncing");
    await processUploads();
    await push();
    await pull();
    setNet("ok");
  } catch (e) {
    if (e.offline || e instanceof TypeError) setNet("offline");
    else if (e instanceof AuthError) setNet("local");
    else { console.warn("sync", e); setNet("error", e.message); }
  } finally {
    syncing = false;
    if (again) scheduleSync(200);
  }
}
async function push(){
  if (!S.dirty.size) return;
  const batch = [...S.dirty.entries()];
  const uid = Cloud.uid();
  const rows = batch.filter(([id]) => S.books[id]).map(([id]) => ({ user_id: uid, id, data: stripLocal(S.books[id]) }));
  for (let i = 0; i < rows.length; i += 50) {
    await Cloud.req("/rest/v1/books?on_conflict=user_id,id", { method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 50)) });
  }
  for (const [id, r] of batch) if (S.dirty.get(id) === r) S.dirty.delete(id);
  persist();
}
async function pull(){
  const uid = Cloud.uid(); const key = "lastPull:" + uid;
  let since = prefs.get(key), changed = false;
  for (let guard = 0; guard < 20; guard++) {
    let q = "/rest/v1/books?select=id,data,updated_at&order=updated_at.asc&limit=500";
    if (since) q += "&updated_at=gt." + encodeURIComponent(since);
    const rows = await (await Cloud.req(q)).json();
    for (const row of rows) {
      const before = S.books[row.id];
      const merged = merge(before, row.data);
      if (canon(merged) !== canon(row.data)) S.dirty.set(row.id, ++rev);
      S.books[row.id] = merged; changed = true;
      if (row.id === S.cur && before) noticeRemote(before, merged);
      since = row.updated_at;
    }
    if (rows.length < 500) break;
  }
  if (since) prefs.set(key, since);
  if (changed) { ensureGuide(); persist(); if (S.view === "library") renderLibraryBody(); else updateReaderChrome(); }
  if (S.dirty.size) scheduleSync(300);
}
async function processUploads(){
  while (S.uploads.length) {
    const u = S.uploads[0]; const b = S.books[u.id];
    if (!b || b.deleted) { S.uploads.shift(); persist(); continue; }
    let data = await idb.get(u.key);
    if (!data) { S.uploads.shift(); persist(); continue; }
    if (!(data instanceof Blob)) data = new Blob([JSON.stringify(data)], { type: "application/json" });
    const path = Files.path(u.id, u.name);
    try { await Files.up(path, data, u.type); }
    catch (e) { if (e.status === 413 || e.status === 400) { S.uploads.shift(); persist(); toast("A file was too big to copy to your account. It stays on this device."); continue; } throw e; }
    S.uploads.shift();
    if (u.kind === "book") save(u.id, { asset: path });
    else { const tracks = (b.audio?.tracks || []).map(t => t.key === u.key ? { ...t, asset: path } : t); save(u.id, { audio: { tracks } }); }
    persist();
    if (S.view === "reader" && S.cur === u.id) updateDock();
  }
}
function queueUpload(item){ S.uploads.push(item); persist(); scheduleSync(200); }
addEventListener("online", () => scheduleSync(100));
addEventListener("offline", () => setNet(Cloud.signedIn() ? "offline" : "local"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleSync(100);
  else { saveAudioPos(true); clearTimeout(persistTimer); idb.put("__library", S.books); idb.put("__dirty", [...S.dirty.keys()]); idb.put("__uploads", S.uploads); syncNow(); }
});
setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 20000);

/* ---------- updates ----------
   New versions are published as releases on GitHub. The Windows app downloads the new installer from
   there and installs it when you say so. An iPhone can't update a sideloaded app by itself, so it says
   when there's a new version and links to it; AltStore or SideStore can also update it from the source. */
const REPO = "DMDBG/pagekeeper";   // where releases are published (the repository moved here from tatekemper56-lab)
const REPO_OLD = "tatekemper56-lab/pagekeeper";
const ALTSTORE_SRC = `https://github.com/${REPO}/releases/latest/download/altstore.json`;
const UPD = { latest: "", page: "", exe: "", busy: false };
function newer(a, b){ const x = String(a).split(".").map(n => +n || 0), y = String(b).split(".").map(n => +n || 0); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
function updateNote(){
  if (IOS) return `<p class="note">${UPD.latest ? `<b>Pagekeeper ${esc(UPD.latest)} is out.</b> ` : ""}To get updates automatically, sideload with AltStore or SideStore and add this source: <code style="word-break:break-all">${esc(ALTSTORE_SRC)}</code></p>
      <div class="row-btns">${UPD.latest ? `<button class="btn primary" id="updGet">Get ${esc(UPD.latest)}</button>` : ""}<button class="btn" id="updSrc">Copy the source link</button></div>`;
  if (TAURI && UPD.latest) return `<p class="note"><b>Pagekeeper ${esc(UPD.latest)} is ready.</b> Installing takes a few seconds; Pagekeeper reopens by itself.</p><div class="row-btns"><button class="btn primary" id="updNow" ${UPD.busy ? "disabled" : ""}>${UPD.busy ? "Updating…" : "Update now"}</button></div>`;
  return "";
}
async function checkUpdate(manual){
  if (!(TAURI || IOS) || !Native.ok) return;
  try {
    const r = await Native.text(`https://api.github.com/repos/${REPO}/releases/latest`);
    const j = JSON.parse(r.text), v = String(j.tag_name || "").replace(/^v/, "");
    const asset = n => ((j.assets || []).find(a => a.name === n) || {}).browser_download_url || "";
    if (v && newer(v, BUILD.version) && (TAURI ? asset("Pagekeeper-Setup.exe") : asset("Pagekeeper.ipa"))) {
      const first = UPD.latest !== v;
      Object.assign(UPD, { latest: v, page: j.html_url || `https://github.com/${REPO}/releases/latest`, exe: asset("Pagekeeper-Setup.exe") });
      if (first || manual) toast(`Pagekeeper ${esc(v)} is out.`, TAURI ? { label: "Update now", fn: installUpdate } : { label: "Get it", fn: () => Native.open(UPD.page) }, 12000);
    } else if (manual) toast(`You have the newest version (${esc(BUILD.version)}).`);
    if (S.view === "settings") render();
  } catch (e) { if (manual) toast("Couldn't check for updates: " + esc(friendlyNetError(e))); }
}
async function installUpdate(){
  if (!TAURI || UPD.busy || !UPD.exe) return;
  // only ever from this app's own releases
  if (![REPO, REPO_OLD].some(r => UPD.exe.startsWith(`https://github.com/${r}/releases/download/`))) { toast("That update link doesn't look right, so it wasn't used."); return; }
  UPD.busy = true; if (S.view === "settings") render();
  try {
    readFlush(); saveAudioPos(true); await idb.put("__library", S.books);
    progressToast("Downloading the update…");
    const f = await Native.file(UPD.exe, p => progressToast(`Downloading the update… ${Math.round(p * 100)}%`));
    progressToast("Installing… Pagekeeper reopens in a few seconds.");
    await tauriInvoke("pk_install_update", new Uint8Array(await f.arrayBuffer()));
  } catch (e) { clearToasts(); toast("The update didn't install: " + esc(String((e && e.message) || e)), null, 9000); UPD.busy = false; if (S.view === "settings") render(); }
}

/* ---------- reading time ----------
   Counts time while a book is open on screen and you're using it (a tap, scroll or key in the last two
   minutes), or while its audiobook or read-aloud is playing. Each device keeps its own count and they
   add up, so time on your phone and PC both show. Today's time is kept per device too. */
if (!prefs.get("devId")) prefs.set("devId", Math.random().toString(36).slice(2, 10));
const RT = { last: Date.now(), act: Date.now(), pend: {}, flushed: Date.now() };
["pointerdown", "keydown", "wheel", "touchstart"].forEach(ev => document.addEventListener(ev, () => { RT.act = Date.now(); }, { passive: true, capture: true }));
const dayKey = () => { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
const readTotal = b => Object.values((b && b.read) || {}).reduce((a, v) => a + (+v || 0), 0) + (RT.pend[Object.keys(S.books).find(k => S.books[k] === b)] || 0);
const readToday = b => { const id = Object.keys(S.books).find(k => S.books[k] === b); const t = (b && b.readDay) || {}; return (t.day === dayKey() ? +t.ms || 0 : 0) + (RT.pend[id] || 0); };
function fmtDur(ms){ const m = Math.round(ms / 60000); if (m < 1) return "under a minute"; if (m < 60) return m + " min"; return Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : ""); }
function readFlush(){
  const me = prefs.get("devId"), today = dayKey();
  for (const [id, ms] of Object.entries(RT.pend)) {
    const b = S.books[id]; if (!b || ms < 1000) continue;
    const d = b.readDay && b.readDay.day === today ? +b.readDay.ms || 0 : 0;
    save(id, { read: { ...(b.read || {}), [me]: ((b.read && b.read[me]) || 0) + Math.round(ms) }, readDay: { day: today, ms: d + Math.round(ms) } });
  }
  RT.pend = {}; RT.flushed = Date.now();
}
setInterval(() => {
  const now = Date.now(), dt = Math.min(now - RT.last, 20000); RT.last = now;
  const audioId = auBook && !au.paused ? auBook.id : null;
  const ttsId = S.reading && !TTS.paused ? S.cur : null;
  const looking = document.visibilityState === "visible" && S.view === "reader" && S.cur && now - RT.act < 120000 ? S.cur : null;
  const id = audioId || ttsId || looking;
  if (id && S.books[id]) RT.pend[id] = (RT.pend[id] || 0) + dt;
  if (now - RT.flushed > 60000) readFlush();
}, 5000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") readFlush(); });
function ensureGuide(){
  // Made once. If you remove it, it stays removed (on every device); Settings can bring it back.
  if (!S.books.guide) S.books.guide = { kind:"book", builtin:true, title:GUIDE.title, author:GUIDE.author, format:"text", page:1, pages:0, addedAt:0 };
  Object.assign(S.books.guide, { builtin:true, title:GUIDE.title, author:GUIDE.author, format:"text" });
}
function noticeRemote(before, now){
  if (now.device && now.device !== prefs.get("device") && now.page && now.page !== S.page && (now.updatedAt || 0) > (before.updatedAt || 0)) {
    const pg = now.page;
    toast(`You reached page ${pg} on ${esc(now.device)}.`, { label: "Go there", fn: () => goto(pg, true) }, 9000);
  }
}

/* ---------- helpers ---------- */
function hue(s){ let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function coverHTML(b){
  if (b.cover) return `<div class="cover"><img src="${esc(b.cover)}" alt=""></div>`;
  const h = hue(b.title || "");
  const bg = b.builtin ? "linear-gradient(160deg,#2F55C4,#1b2f6e)" : `linear-gradient(160deg,hsl(${h} 42% 38%),hsl(${(h+40)%360} 48% 22%))`;
  return `<div class="cover"><div class="gen" style="background:${bg}"><b>${esc(b.title)}</b><span>${esc(b.author || "")}</span></div></div>`;
}
function ago(ms){
  if (!ms) return ""; const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s/60) + " min ago";
  if (s < 86400) return Math.floor(s/3600) + " h ago"; const d = Math.floor(s/86400);
  return d === 1 ? "yesterday" : d + " days ago";
}
function pct(b){ return b.pages ? Math.min(100, Math.round(((b.page || 1) - 1) / Math.max(1, b.pages - 1) * 100)) : 0; }
const fmtSize = n => !n ? "" : n >= 1e9 ? (n / 1e9).toFixed(2) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
let toastTimer;
function toast(msg, action, ms = 4500){
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status");
  t.innerHTML = `<span>${msg}</span>`;
  if (action) { const b = document.createElement("button"); b.textContent = action.label; b.onclick = () => { t.remove(); action.fn(); }; t.append(b); }
  document.body.append(t); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), ms);
}
const clearToasts = () => document.querySelectorAll(".toast").forEach(t => t.remove());
function confirmBox(title, body, okLabel, fn){
  const m = document.createElement("div"); m.className = "modal-back";
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${body}</p><div class="row"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div></div>`;
  m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); if (e.target.closest("[data-ok]")) { m.remove(); fn(); } });
  document.body.append(m); m.querySelector("[data-ok]").focus();
}
const scripts = {};
function loadScript(src){ return scripts[src] ||= new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error("A part of the app is missing (" + src + "). Reinstall or reload.")); }; document.head.append(s); }); }
const JSZIP = "vendor/jszip.min.js", PDFJS = "vendor/pdf.min.js", PDFW = "vendor/pdf.worker.min.js";
/* pdf.js runs on the main thread (worker script loaded as a plain script), which works in the iPhone app too. */
async function pdfjs(){ await loadScript(PDFJS); await loadScript(PDFW); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFW; return window.pdfjsLib; }
const newId = () => "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
async function fingerprint(file){
  try {
    const C = 2 * 1024 * 1024;
    const parts = file.size <= 2 * C ? [file] : [file.slice(0, C), file.slice(file.size - C)];
    const bufs = await Promise.all(parts.map(p => p.arrayBuffer()));
    const meta = new TextEncoder().encode("|" + file.size);
    const all = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength, 0) + meta.length);
    let o = 0; for (const b of bufs) { all.set(new Uint8Array(b), o); o += b.byteLength; } all.set(meta, o);
    const h = await crypto.subtle.digest("SHA-256", all);
    return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
  } catch { return null; }
}
const safeUrl = u => { try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
function linkBox(title, body, current, onSave){
  const m = document.createElement("div"); m.className = "modal-back";
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${body}</p>
    <input id="linkIn" type="url" inputmode="url" autocapitalize="off" placeholder="https://…" value="${esc(current || "")}" aria-label="Download link">
    <p class="err" id="linkErr" hidden>That doesn't look like a web link. It should start with https://</p>
    <div class="row"><button class="btn" data-x>${current ? "Cancel" : "Skip"}</button><button class="btn primary" data-ok>Save link</button></div></div>`;
  m.addEventListener("click", e => {
    if (e.target === m || e.target.closest("[data-x]")) m.remove();
    if (e.target.closest("[data-ok]")) { const raw = $("#linkIn", m).value; const u = safeUrl(raw);
      if (raw.trim() && !u) { $("#linkErr", m).hidden = false; return; } m.remove(); onSave(u); }
  });
  document.body.append(m); $("#linkIn", m).focus();
}

/* ---------- paging ---------- */
function paginate(chapters){
  const pages = [], toc = []; let cur = [], len = 0;
  const flush = () => { if (cur.length) { pages.push(cur); cur = []; len = 0; } };
  chapters.forEach(ch => {
    if (!ch.blocks.length) return;
    flush(); toc.push({ title: ch.title, page: pages.length + 1 });
    ch.blocks.forEach(([t, x]) => {
      const parts = x.length > CHARS_PER_PAGE ? splitLong(x) : [x];
      parts.forEach(p => {
        if (len > 0 && (len + p.length > CHARS_PER_PAGE || (t === "h" && len > CHARS_PER_PAGE * .55))) flush();
        cur.push([t, p]); len += p.length;
      });
    });
  });
  flush();
  if (!pages.length) pages.push([["p", "This file has no readable text."]]);
  return { pages, toc };
}
function splitLong(x){
  const out = []; const sents = x.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [x]; let buf = "";
  for (const s of sents) { if (buf.length + s.length > CHARS_PER_PAGE * .9 && buf) { out.push(buf.trim()); buf = ""; } buf += s; }
  if (buf.trim()) out.push(buf.trim());
  return out.flatMap(p => p.length > CHARS_PER_PAGE * 1.3 ? p.match(new RegExp(`[\\s\\S]{1,${CHARS_PER_PAGE}}`, "g")) : [p]);
}

/* ---------- importing ---------- */
const clean = s => (s || "").replace(/\s+/g, " ").trim();
function parseXML(str){
  let d = new DOMParser().parseFromString(str, "application/xhtml+xml");
  if (d.getElementsByTagName("parsererror").length) d = new DOMParser().parseFromString(str, "text/html");
  return d;
}
function resolvePath(base, href){
  const parts = (base + decodeURIComponent(href.split("#")[0])).split("/"); const out = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p !== "." && p !== "") out.push(p); }
  return out.join("/");
}
async function thumb(blob){
  try {
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w = 200, h = Math.round(img.naturalHeight * w / img.naturalWidth);
    const c = document.createElement("canvas"); c.width = w; c.height = Math.min(h, 320);
    c.getContext("2d").drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
    return c.toDataURL("image/jpeg", .72);
  } catch { return null; }
}
async function parseEpub(file){
  await loadScript(JSZIP);
  const zip = await window.JSZip.loadAsync(file);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("This EPUB is damaged (no container file).");
  const enc = zip.file("META-INF/encryption.xml");
  if (enc) { const x = await enc.async("string"); if (/EncryptedData/.test(x) && !/obfuscation/i.test(x)) throw new Error("This EPUB is DRM-protected, so it can't be opened here."); }
  const cont = new DOMParser().parseFromString(await containerFile.async("string"), "application/xml");
  const opfPath = cont.getElementsByTagNameNS("*", "rootfile")[0]?.getAttribute("full-path");
  const opfFile = opfPath && zip.file(opfPath);
  if (!opfFile) throw new Error("This EPUB is damaged (no package file).");
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const opf = new DOMParser().parseFromString(await opfFile.async("string"), "application/xml");
  const meta = tag => clean(opf.getElementsByTagNameNS("*", tag)[0]?.textContent);
  const items = {};
  for (const it of opf.getElementsByTagNameNS("*", "item")) items[it.getAttribute("id")] = { href: it.getAttribute("href"), type: it.getAttribute("media-type") || "", props: it.getAttribute("properties") || "" };
  const spine = [...opf.getElementsByTagNameNS("*", "itemref")].map(r => items[r.getAttribute("idref")]).filter(Boolean);
  const SEL = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dt,dd";
  const chapters = [];
  for (const it of spine) {
    const f = zip.file(resolvePath(base, it.href)); if (!f) continue;
    const doc = parseXML(await f.async("string"));
    const body = doc.body || doc.getElementsByTagName("body")[0]; if (!body) continue;
    const blocks = [];
    const els = body.querySelectorAll(SEL);
    if (els.length) {
      for (const el of els) {
        if (el.querySelector(SEL)) continue;
        const x = clean(el.textContent); if (!x) continue;
        blocks.push([/^h[1-6]$/i.test(el.localName) ? "h" : "p", x]);
      }
    } else (body.textContent || "").split(/\n\s*\n/).map(clean).filter(Boolean).forEach(x => blocks.push(["p", x]));
    if (!blocks.length) continue;
    const h = blocks.find(b => b[0] === "h");
    chapters.push({ title: h ? h[1].slice(0, 80) : `Section ${chapters.length + 1}`, blocks });
  }
  if (!chapters.length) throw new Error("No readable text found in this EPUB.");
  let coverItem = Object.values(items).find(x => /cover-image/.test(x.props));
  if (!coverItem) { const m = [...opf.getElementsByTagNameNS("*", "meta")].find(m => m.getAttribute("name") === "cover"); if (m) coverItem = items[m.getAttribute("content")]; }
  if (!coverItem) coverItem = Object.entries(items).find(([k, v]) => /^image\//.test(v.type) && /cover/i.test(k + v.href))?.[1];
  let cover = null;
  if (coverItem) { const cf = zip.file(resolvePath(base, coverItem.href)); if (cf) cover = await thumb(new Blob([await cf.async("uint8array")], { type: coverItem.type || "image/jpeg" })); }
  return { title: meta("title") || file.name.replace(/\.[^.]+$/, ""), author: meta("creator"), chapters, cover };
}
async function parseTxt(file){
  const buf = await file.arrayBuffer(); let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("windows-1252").decode(buf); }
  text = text.replace(/\r\n?/g, "\n");
  const tm = text.match(/^Title:\s*(.+)$/m), am = text.match(/^Author:\s*(.+)$/m);
  const st = text.search(/^\*{3}\s*START OF.*$/m); if (st >= 0) text = text.slice(text.indexOf("\n", st) + 1);
  const en = text.search(/^\*{3}\s*END OF/m); if (en >= 0) text = text.slice(0, en);
  let paras = text.split(/\n\s*\n/);
  if (paras.length < 4) paras = text.split("\n");
  paras = paras.map(clean).filter(Boolean);
  const chapters = []; let ch = { title: "Beginning", blocks: [] };
  for (const p of paras) {
    if (p.length < 80 && /^(chapter|book|part|prologue|epilogue|act|section)\b/i.test(p)) { if (ch.blocks.length) chapters.push(ch); ch = { title: p, blocks: [["h", p]] }; }
    else ch.blocks.push(["p", p]);
  }
  if (ch.blocks.length) chapters.push(ch);
  return { title: tm ? clean(tm[1]) : file.name.replace(/\.[^.]+$/, ""), author: am ? clean(am[1]) : "", chapters, cover: null };
}
async function importBook(file, opts = {}){
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (["mobi","azw","azw3","kfx"].includes(ext)) { toast("Kindle files can't be opened. Convert a DRM-free copy to EPUB with Calibre, then add it."); return; }
  if (!["epub","pdf","txt"].includes(ext)) { toast("Choose an EPUB, PDF or TXT file."); return; }
  const id = newId();
  S.busy = `Adding “${esc(file.name)}”…`; render();
  try {
    let doc, payload, size, type, name;
    if (ext === "pdf") {
      const lib = await pdfjs(); const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await lib.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
      let title = ""; try { title = clean((await pdf.getMetadata()).info?.Title); } catch {}
      let cover = null;
      try { const pg = await pdf.getPage(1); const vp = pg.getViewport({ scale: 1 }); const v2 = pg.getViewport({ scale: 200 / vp.width });
        const c = document.createElement("canvas"); c.width = v2.width; c.height = Math.min(v2.height, 320); await pg.render({ canvasContext: c.getContext("2d"), viewport: v2 }).promise; cover = c.toDataURL("image/jpeg", .72); } catch {}
      doc = { title: title || file.name.replace(/\.pdf$/i, ""), author: "", format: "pdf", pages: pdf.numPages, cover };
      payload = new Blob([data], { type: "application/pdf" }); size = payload.size; type = "application/pdf"; name = "book.pdf";
      S.content[id] = { kind: "pdf", pdf, total: pdf.numPages };
    } else {
      const parsed = ext === "epub" ? await parseEpub(file) : await parseTxt(file);
      const json = { v: 1, chapters: parsed.chapters };
      const pg = paginate(parsed.chapters);
      doc = { title: parsed.title, author: parsed.author, format: "text", pages: pg.pages.length, cover: parsed.cover };
      payload = json; size = new Blob([JSON.stringify(json)]).size; type = "application/json"; name = "book.json";
      S.content[id] = { kind: "text", ...pg };
    }
    await idb.put(id + ":book", payload);
    const src = { name: file.name, size: file.size, fp: await fingerprint(file), url: safeUrl(opts.sourceUrl || "") };
    const fits = size <= MAX_FILE;
    save(id, { kind: "book", ...doc, asset: null, src, page: 1, pages: doc.pages, addedAt: Date.now(), audio: { tracks: [], track: 0, time: 0 } }, { now: true });
    if (fits && Cloud.signedIn()) queueUpload({ id, kind: "book", key: id + ":book", name, type });
    S.busy = null; render();
    const note = !Cloud.signedIn() ? "" : fits ? (navigator.onLine === false ? " It'll copy to your account when you're back online." : "") : " It's over 50 MB, so it stays on this device.";
    toast(`Added “${esc(doc.title)}”.${note}`, { label: "Read now", fn: () => openBook(id) });
    if (!fits && Cloud.signedIn() && !src.url) askBookLink(id);
  } catch (e) {
    console.warn(e); S.busy = null; render();
    toast(esc(e.message || "That file couldn't be read."));
  }
}
async function loadContent(id){
  if (S.content[id]) return S.content[id];
  const b = S.books[id];
  if (b.builtin) { const pg = paginate(GUIDE.chapters); b.pages = pg.pages.length; return S.content[id] = { kind: "text", ...pg }; }
  let data = await idb.get(id + ":book");
  if (!data && b.asset && Cloud.signedIn()) {
    const blob = await Files.down(b.asset);
    data = b.format === "pdf" ? blob : JSON.parse(await blob.text());
    await idb.put(id + ":book", data);
  }
  if (!data) return null;
  if (b.format === "pdf") {
    const lib = await pdfjs(); const buf = new Uint8Array(await data.arrayBuffer());
    const pdf = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
    return S.content[id] = { kind: "pdf", pdf, total: pdf.numPages };
  }
  return S.content[id] = { kind: "text", ...paginate(data.chapters || []) };
}

/* ---------- library screens ---------- */
const app = $("#app");
function statusInfo(){
  if (!Cloud.signedIn()) return { cls: "", text: "On this device only" };
  return ({ syncing: { cls: "ok", text: "Syncing…" }, ok: { cls: "ok", text: `Synced · this is “${esc(prefs.get("device"))}”` },
    offline: { cls: "warn", text: "Offline · changes sync later" }, error: { cls: "err", text: "Sync problem" } })[S.net] || { cls: "", text: "Connecting…" };
}
function renderHeaderStatus(){ const el = $("#syncBtn"); if (!el) return; const s = statusInfo(); el.innerHTML = `<span class="dot ${s.cls}"></span>${s.text}`; }
function render(){
  if (S.view === "reader") return renderReader();
  if (!au.paused) au.pause();
  const s = statusInfo();
  app.innerHTML = `<div class="wrap">
    <header class="top">
      <div class="brand"><div class="mark">${ICON.book}</div><h1>Pagekeeper</h1></div>
      <button class="sync" id="syncBtn" title="Sync settings"><span class="dot ${s.cls}"></span>${s.text}</button>
      <button class="btn primary" id="addBtn" ${S.busy ? "disabled" : ""}>${ICON.plus} Add book</button>
    </header>
    ${!Cloud.signedIn() && S.view === "library" ? `<div class="banner"><span>Sign in to keep your iPhone and PC on the same page. Until then, everything stays on this device.</span><button class="btn" id="goSet">Set up sync</button></div>` : ""}
    ${S.busy ? `<div class="banner"><span>${S.busy}</span></div>` : ""}
    ${S.view === "library" && prefs.get("seenNew") !== WHATS_NEW.id ? `<div class="banner whatsnew"><div><b>New in Pagekeeper ${esc(BUILD.version)}</b><ul>${WHATS_NEW.items.map(x => `<li>${x}</li>`).join("")}</ul></div><button class="btn" id="gotNew">Got it</button></div>` : ""}
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="library" aria-selected="${S.view === "library"}">Library</button>
      <button role="tab" data-tab="find" aria-selected="${S.view === "find"}">Discover</button>
      <button role="tab" data-tab="settings" aria-selected="${S.view === "settings"}">Settings</button>
    </div>
    <div id="body"></div></div>`;
  $("#addBtn").onclick = () => $("#bookFile").click();
  $("#syncBtn").onclick = () => { S.view = "settings"; render(); };
  const gs = $("#goSet"); if (gs) gs.onclick = () => { S.view = "settings"; render(); };
  const gn = $("#gotNew"); if (gn) gn.onclick = () => { prefs.set("seenNew", WHATS_NEW.id); render(); };
  app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { S.view = b.dataset.tab; render(); });
  if (S.view === "find") renderFind($("#body")); else if (S.view === "settings") renderSettings($("#body")); else renderLibraryBody();
}
function renderLibraryBody(){
  const el = $("#body"); if (!el || S.view !== "library") return;
  const shelves = allShelves(); if (S.shelf && !shelves.includes(S.shelf)) S.shelf = null;
  let list = Object.entries(S.books).filter(([, b]) => !b.deleted && b.kind === "book").sort((a, b) => (b[1].updatedAt || b[1].addedAt || 0) - (a[1].updatedAt || a[1].addedAt || 0));
  const recent = list.find(([, b]) => !b.builtin && b.updatedAt && b.page > 1) || list.find(([, b]) => b.updatedAt && (b.page || 1) > 1);
  let html = "";
  if (recent) {
    const [id, b] = recent;
    const where = b.device && b.updatedAt ? ` · ${esc(b.device)}, ${ago(b.updatedAt)}` : "";
    html += `<div class="continue">${coverHTML(b)}<div class="c-body"><span class="eyebrow">Continue reading</span><h2>${esc(b.title)}</h2>
      <div class="meta">Page ${b.page || 1}${b.pages ? ` of ${b.pages}` : ""}${where}${readTotal(b) >= 60000 ? ` · read for ${fmtDur(readTotal(b))}${readToday(b) >= 60000 ? ` (${fmtDur(readToday(b))} today)` : ""}` : ""}</div><div class="bar"><i style="width:${pct(b)}%"></i></div></div>
      <button class="btn primary" data-open="${id}">Resume</button></div>`;
  }
  if (shelves.length) html += `<div class="shelves" role="tablist"><button class="chip" data-shelf="" aria-pressed="${!S.shelf}">All books</button>${shelves.map(n => `<button class="chip" data-shelf="${esc(n)}" aria-pressed="${S.shelf === n}">${esc(n)}</button>`).join("")}</div>`;
  if (S.shelf) list = list.filter(([, b]) => shelvesOf(b).includes(S.shelf)).sort((a, z) => (a[1].seriesNo ?? 1e9) - (z[1].seriesNo ?? 1e9) || natural(a[1].title || "", z[1].title || ""));
  html += `<div class="grid">`;
  for (const [id, b] of list) {
    html += `<div class="book">
      <button class="open" data-open="${id}" aria-label="Open ${esc(b.title)}">${coverHTML(b)}
        <span class="btitle">${b.seriesNo != null && S.shelf ? `<span class="sno">#${esc(String(b.seriesNo))}</span> ` : ""}${esc(b.title)}</span><span class="bauthor">${esc(b.author || (b.format === "pdf" ? "PDF" : ""))}</span>
        <span class="bar"><i style="width:${pct(b)}%"></i></span><span class="meta">${b.pages ? `${pct(b)}% · p. ${b.page || 1} / ${b.pages}` : "Not started"}${b.audio?.tracks?.length ? " · audio" : ""}</span>${readTotal(b) >= 60000 ? `<span class="meta">Read for ${fmtDur(readTotal(b))}</span>` : ""}
      </button>
      <button class="more" data-more="${id}" aria-label="Options for ${esc(b.title)}">${ICON.dots}</button>
    </div>`;
  }
  html += `<button class="add-tile" id="addTile">${ICON.plus}<span>Add an EPUB, PDF or TXT</span></button></div>`;
  el.innerHTML = html;
  $("#addTile").onclick = () => $("#bookFile").click();
  el.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openBook(b.dataset.open));
  el.querySelectorAll("[data-more]").forEach(b => b.onclick = () => bookMenu(b.dataset.more));
  el.querySelectorAll("[data-shelf]").forEach(b => b.onclick = () => { S.shelf = b.dataset.shelf || null; renderLibraryBody(); });
}
function bookMenu(id){
  const bk = S.books[id];
  const m = document.createElement("div"); m.className = "modal-back";
  const where = bk.builtin ? "The built-in guide. You can bring it back later from Settings." : bk.asset ? "Saved in your account, so every device gets it." : (bk.src && bk.src.size > MAX_FILE) ? `On this device only (${esc(fmtSize(bk.src.size))}). Other devices download the same file.` : Cloud.signedIn() ? "Copying to your account when online." : "On this device.";
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(bk.title)}</h3>
    <p>${bk.src ? esc(bk.src.name) + " · " : ""}${where}</p>
    ${readTotal(bk) >= 60000 ? `<p>You've spent <b>${fmtDur(readTotal(bk))}</b> with this book${readToday(bk) >= 60000 ? `, ${fmtDur(readToday(bk))} of it today` : ""}.</p>` : ""}
    ${bk.src?.url ? `<p style="word-break:break-all">Download link: ${esc(bk.src.url)}</p>` : ""}
    <div class="row" style="justify-content:flex-start">
      ${bk.builtin ? "" : `<button class="btn" data-shelves>Collections${bk.seriesNo != null ? ` · #${esc(String(bk.seriesNo))}` : ""}</button>`}
      ${bk.asset || bk.builtin ? "" : `<button class="btn" data-link>${bk.src?.url ? "Change download link" : "Add download link"}</button>`}
      <button class="btn danger" data-del>Remove book</button><button class="btn" data-x>Close</button></div></div>`;
  m.addEventListener("click", e => {
    if (e.target === m || e.target.closest("[data-x]")) m.remove();
    if (e.target.closest("[data-link]")) { m.remove(); askBookLink(id); }
    if (e.target.closest("[data-shelves]")) { m.remove(); shelfBox(id); }
    if (e.target.closest("[data-del]")) { m.remove(); removeBook(id); }
  });
  document.body.append(m);
}
function askBookLink(id){
  const bk = S.books[id];
  linkBox("Where did you download it?", `“${esc(bk.title)}” is ${esc(fmtSize(bk.src?.size))}, too big to copy to your account. Paste the page or link you got it from, and your other devices get a button to download the same file.`,
    bk.src?.url, u => { save(id, { src: { ...(bk.src || {}), url: u } }); if (u) toast("Download link saved."); render(); });
}
function removeBook(id){
  const bk = S.books[id];
  confirmBox(bk.builtin ? "Remove the welcome guide?" : "Remove this book?", bk.builtin ? "It's removed from every device. You can bring it back any time from Settings." : `“${esc(bk.title)}”, its saved place and any audio will be removed from every device. This can't be undone.`, "Remove", async () => {
    const paths = [bk.asset, ...(bk.audio?.tracks || []).map(t => t.asset)].filter(Boolean);
    await idb.del(id + ":book"); (bk.audio?.tracks || []).forEach(t => idb.del(t.key));
    S.uploads = S.uploads.filter(u => u.id !== id);
    save(id, { deleted: true, cover: null, asset: null, audio: { tracks: [] } }, { now: true });
    delete S.content[id]; render(); toast("Book removed.");
    if (Cloud.signedIn()) for (const p of paths) Files.del(p).catch(() => {});
  });
}
function renderSites(el){
  const q = S.findQ, enc = encodeURIComponent(q);
  const books = [
    ["Project Gutenberg", "More than 70,000 free classics whose copyright has expired. Pick “EPUB3” on a book's page.", `https://www.gutenberg.org/ebooks/search/?query=${enc}`],
    ["Standard Ebooks", "Carefully formatted public-domain EPUBs. Choose the “compatible epub” download.", `https://standardebooks.org/ebooks?query=${enc}`],
    ["Open Library", "Search millions of titles. Many public-domain books have a free EPUB or PDF download.", `https://openlibrary.org/search?q=${enc}&has_fulltext=true`],
    ["Internet Archive texts", "Old and out-of-copyright books, often as PDF or EPUB.", `https://archive.org/search?query=${enc}&and%5B%5D=mediatype%3A%22texts%22`]
  ];
  const audio = [
    ["LibriVox", "Free public-domain audiobooks read by volunteers. Download the whole-book zip and add it in the player.", `https://archive.org/search?query=${enc}+AND+collection%3Alibrivoxaudio`],
    ["Lit2Go", "Free classic stories and poems with matching MP3 audio.", `https://etc.usf.edu/lit2go/search/?q=${enc}`],
    ["Your own purchases", "DRM-free audiobooks you've bought (for example from Libro.fm) can be added as MP3 or M4B files.", "https://libro.fm/"]
  ];
  const card = ([t, d, u]) => `<div class="src"><h3>${t}</h3><p>${d}</p><div class="row"><a href="${esc(u)}" target="_blank" rel="noopener">${q ? `Search for “${esc(q)}”` : "Open"} ${Native.ok ? "" : "↗"}</a></div></div>`;
  el.innerHTML = `
    <h2 class="sec">Websites</h2>
    <p class="note" style="margin:-4px 0 12px;max-width:65ch">${Native.ok ? "These open inside Pagekeeper. Anything you download there goes straight into your library." : "These open in a new tab. Download the file, then tap Add book."}</p>
    <div class="srcs">${books.map(card).join("")}${audio.map(card).join("")}</div>
    <p class="note" style="max-width:65ch">For newer books, try your public library's free Libby app or buy a DRM-free copy, then add the file here.</p>`;
}
function renderSettings(el){
  const signed = Cloud.signedIn();
  const cfgFromFile = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  const s = statusInfo();
  el.innerHTML = `
    <div class="panel">
      <h3>Sync</h3>
      ${signed ? `
        <p class="note" style="margin:0"><span class="dot ${s.cls}" style="display:inline-block;margin-right:6px"></span>${s.text}${S.netMsg ? ` (${esc(S.netMsg)})` : ""}</p>
        <p style="margin:0">Signed in as <b>${esc(Cloud.email())}</b>. Sign in with the same account on your iPhone and PC.</p>
        <p class="note" style="margin:0">${S.dirty.size ? `${S.dirty.size} change${S.dirty.size > 1 ? "s" : ""} waiting to sync. ` : ""}${S.uploads.length ? `${S.uploads.length} file${S.uploads.length > 1 ? "s" : ""} waiting to upload.` : ""}</p>
        <div class="row-btns"><button class="btn primary" id="syncNow">Sync now</button><button class="btn" id="signOut">Sign out</button></div>`
      : `
        <form class="form" id="authForm" autocomplete="on">
          ${cfgFromFile ? "" : `
            <label for="sbUrl">Supabase project URL</label><input id="sbUrl" type="url" autocapitalize="off" placeholder="https://abcd1234.supabase.co" value="${esc(prefs.get("sbUrl") || "")}">
            <label for="sbKey">Supabase publishable key</label><input id="sbKey" type="text" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="sb_publishable_…" value="${esc(prefs.get("sbKey") || "")}">
            <p class="note" style="margin:0">Find both in Supabase under Project Settings. Use the publishable key, never the secret one. Put them in <code>config.js</code> to skip this step.</p>`}
          <label for="em">Email</label><input id="em" type="email" autocomplete="username" autocapitalize="off" required>
          <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" minlength="6" required>
          <p class="err" id="authErr" hidden></p>
          <div class="row-btns"><button class="btn primary" id="signIn" type="submit">Sign in</button><button class="btn" id="signUp" type="button">Create account</button></div>
        </form>`}
    </div>
    <div class="panel">
      <h3>Look</h3>
      <div class="seg">${[["dark","Dark"],["light","Light"],["system","Match device"]].map(([k, l]) => `<button data-theme-pick="${k}" aria-pressed="${(prefs.get("theme") || "dark") === k}">${l}</button>`).join("")}</div>
      <p class="note" style="margin:0">The page color while reading (white, sepia or night) is under <b>Aa</b> in a book.</p>
    </div>
    <div class="panel">
      <h3>Play / pause key</h3>
      <div class="row-btns" style="align-items:center"><kbd class="keycap" id="keyShow">${esc(keyLabel(keyPlay()))}</kbd>
        <button class="btn" id="keySet">${S.keyRecording ? "Press a key… (Esc cancels)" : "Change"}</button>
        ${prefs.get("keyPlay") ? `<button class="btn ghost" id="keyReset">Use Space</button>` : ""}</div>
      <p class="note" style="margin:0">Starts and pauses the audiobook or Read aloud${IOS ? " (with a keyboard connected to your iPhone)" : ""}.</p>
      ${TAURI ? `<label class="check"><input type="checkbox" id="keyGlobal" ${prefs.get("keyGlobal") ? "checked" : ""}> Also works when you're in another app</label>
      <p class="note" style="margin:0">For that, the key needs Ctrl, Alt or Shift with it (like Ctrl + Shift + Space), or use an F key, so it doesn't get in the way of typing elsewhere.</p>` : ""}
    </div>
    <div class="panel">
      <h3>This device</h3>
      <div class="form"><label for="devName">Name</label><input id="devName" type="text" maxlength="24" value="${esc(prefs.get("device"))}">
      <p class="note" style="margin:0">Shown on your other devices, like “page 12 on iPhone”.</p></div>
    </div>
    <div class="panel">
      <h3>AI recaps</h3>
      <p class="note" style="margin:0 0 8px">In a book, <b>Contents → Recap</b> tells you what's happened so far, in the book and the earlier books of its series, never past your page. Choose which AI writes it:</p>
      ${aiSettingsHTML()}
    </div>
    <div class="panel">
      <h3>Listening</h3>
      <label class="check"><input type="checkbox" id="smartRw" ${prefs.get("smartRewind") === false ? "" : "checked"}> Smart rewind: after a pause, back up a few seconds (longer pauses, a bit more)</label>
    </div>
    <div class="panel">
      <h3>Pop-out text</h3>
      <p class="note" style="margin:0">${TAURI ? "A borderless window that stays on top of everything else on your screen." : "A floating panel you can drag around inside Pagekeeper."} It shows the sentence being read aloud, or the page you're on. Change its colors and size from <b>Aa</b> while reading.</p>
      <div class="row-btns"><button class="btn ${prefs.get("capOn") ? "" : "primary"}" id="setCap">${prefs.get("capOn") ? "Hide pop-out" : "Show pop-out"}</button></div>
    </div>
    <div class="panel">
      <h3>About</h3>
      <p class="note" style="margin:0">Pagekeeper ${esc(BUILD.version)}${BUILD.sha ? ` · build ${esc(BUILD.sha)}` : ""}${BUILD.date ? ` · ${esc(BUILD.date)}` : ""} · ${TAURI ? "Windows app" : IOS ? "iPhone app" : "web version"}</p>
      <div class="row-btns"><button class="btn" id="showNew">What's new</button>${(TAURI || IOS) ? `<button class="btn" id="checkUpd">Check for updates</button>` : ""}${Object.values(S.books).some(b => b.builtin && !b.deleted) ? "" : `<button class="btn" id="guideBack">Show the welcome guide again</button>`}</div>
      ${updateNote()}
    </div>`;
  el.querySelectorAll("[data-theme-pick]").forEach(b => b.onclick = () => { prefs.set("theme", b.dataset.themePick); applyTheme(); renderSettings(el); });
  bindAiSettings(el);
  const sr = $("#smartRw"); if (sr) sr.onchange = () => prefs.set("smartRewind", sr.checked ? undefined : false);
  const gb = $("#guideBack"); if (gb) gb.onclick = () => {
    // a fresh copy (a removed book stays removed everywhere, so this one gets a new name)
    const id = "guide-" + Date.now().toString(36);
    S.books[id] = { kind: "book", builtin: true, title: GUIDE.title, author: GUIDE.author, format: "text", page: 1, pages: 0, addedAt: Date.now() };
    save(id, { title: GUIDE.title }, { now: true }); toast("The welcome guide is back on your shelf."); renderSettings(el);
  };
  const cu = $("#checkUpd"); if (cu) cu.onclick = () => checkUpdate(true);
  const ui = $("#updNow"); if (ui) ui.onclick = () => installUpdate();
  const ug = $("#updGet"); if (ug) ug.onclick = () => Native.open(UPD.page);
  const us = $("#updSrc"); if (us) us.onclick = async () => { try { await navigator.clipboard.writeText(ALTSTORE_SRC); toast("Copied. In AltStore or SideStore, go to Sources, tap +, and paste it."); } catch { toast(ALTSTORE_SRC); } };
  $("#keySet").onclick = () => {
    S.keyRecording = !S.keyRecording; renderSettings(el);
    if (!S.keyRecording) { document.removeEventListener("keydown", S.keyGrab, true); return; }
    const grab = e => {
      if (["Shift","Control","Alt","Meta"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); document.removeEventListener("keydown", grab, true);
      S.keyRecording = false;
      if (e.key !== "Escape") {
        const k = { code: e.code, key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
        if (TAURI && prefs.get("keyGlobal") && !globalOk(k)) { prefs.set("keyGlobal", false); toast("Saved. It works inside Pagekeeper; add Ctrl, Alt or Shift (or use an F key) to use it in other apps too.", null, 7000); }
        prefs.set("keyPlay", k); setGlobalKey();
      }
      renderSettings(el);
    };
    S.keyGrab = grab;
    document.addEventListener("keydown", grab, true);
  };
  const kr = $("#keyReset"); if (kr) kr.onclick = () => { prefs.set("keyPlay", undefined); if (prefs.get("keyGlobal")) prefs.set("keyGlobal", false); setGlobalKey(); renderSettings(el); };
  const kg = $("#keyGlobal"); if (kg) kg.onchange = () => {
    if (kg.checked && !globalOk(keyPlay())) { kg.checked = false; toast("Pick a key with Ctrl, Alt or Shift first (or an F key), then turn this on.", null, 6000); return; }
    prefs.set("keyGlobal", kg.checked); setGlobalKey();
  };
  $("#devName").onchange = e => { const v = e.target.value.trim(); if (v) prefs.set("device", v); };
  $("#setCap").onclick = () => { setCaption(!prefs.get("capOn")); renderSettings(el); };
  $("#showNew").onclick = () => { prefs.set("seenNew", undefined); S.view = "library"; render(); };
  if (signed) {
    $("#syncNow").onclick = async () => { await syncNow(); renderSettings(el); toast(S.net === "ok" ? "Up to date." : S.net === "offline" ? "You're offline. Changes will sync later." : "Couldn't sync: " + esc(S.netMsg)); };
    $("#signOut").onclick = () => confirmBox("Sign out?", "Your books stay on this device, but stop syncing until you sign in again.", "Sign out", () => { Cloud.signOut(); setNet("local"); render(); });
    return;
  }
  const errEl = $("#authErr");
  const go = async mode => {
    errEl.hidden = true;
    if (!cfgFromFile) { prefs.set("sbUrl", $("#sbUrl").value.trim() || undefined); prefs.set("sbKey", $("#sbKey").value.trim() || undefined); }
    if (!Cloud.configured()) { errEl.textContent = "Enter your Supabase project URL and publishable key first."; errEl.hidden = false; return; }
    if (/^sb_secret_/.test(Cloud.key)) { errEl.textContent = "That's the secret key. Use the publishable key (it starts with sb_publishable_) and keep the secret one private."; errEl.hidden = false; return; }
    if (!/^https:\/\/[^/]+$/.test(Cloud.url)) { errEl.textContent = "The project URL should look like https://abcd1234.supabase.co"; errEl.hidden = false; return; }
    const email = $("#em").value.trim(), pw = $("#pw").value;
    if (!email || pw.length < 6) { errEl.textContent = "Enter your email and a password of at least 6 characters."; errEl.hidden = false; return; }
    try {
      if (mode === "up") { const r = await Cloud.signUp(email, pw); if (r === "confirm") { errEl.textContent = "Check your email and tap the confirmation link, then sign in here."; errEl.hidden = false; return; } }
      else await Cloud.signIn(email, pw);
      for (const [id, b] of Object.entries(S.books)) if (!b.builtin || b.updatedAt) S.dirty.set(id, ++rev);
      for (const [id, b] of Object.entries(S.books)) if (b.kind === "book" && !b.deleted && !b.asset && !b.builtin &&!S.uploads.some(u => u.id === id && u.kind === "book")) {
        if (!b.src || b.src.size <= MAX_FILE) S.uploads.push({ id, kind: "book", key: id + ":book", name: b.format === "pdf" ? "book.pdf" : "book.json", type: b.format === "pdf" ? "application/pdf" : "application/json" });
      }
      persist(); toast("Signed in. Syncing your library…"); render(); syncNow();
    } catch (e) {
      errEl.textContent = e instanceof TypeError ? "Couldn't reach Supabase. Check the project URL and your connection." : e.message; errEl.hidden = false;
    }
  };
  $("#authForm").onsubmit = e => { e.preventDefault(); go("in"); };
  $("#signUp").onclick = () => go("up");
}

/* ---------- native bridge (iPhone app): downloads without leaving the app ---------- */
const progressFns = {};
window.pkProgress = (id, frac) => { const f = progressFns[id]; if (f) f(Math.max(0, Math.min(1, +frac || 0))); };
const IOS = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pk);
const TAURI = window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__ : null;   // the Windows app
const Native = {
  ok: IOS || !!TAURI,
  call(msg){
    if (IOS) return window.webkit.messageHandlers.pk.postMessage(msg);
    const cmd = { text: "pk_text", file: "pk_file", done: "pk_done", browse: "pk_browse" }[msg.op];
    const args = msg.op === "done" ? { token: msg.token } : msg.op === "file" ? { url: msg.url, id: msg.id || null } : { url: msg.url };
    return TAURI.core.invoke(cmd, args).catch(e => { throw new Error(typeof e === "string" ? e : (e && e.message) || "That didn't work."); });
  },
  async text(url){
    if (this.ok) { const r = await this.call({ op: "text", url }); if (r.status >= 400) throw new Error(`The catalog answered ${r.status}.`); return r; }
    const res = await fetch(url); if (!res.ok) throw new Error(`The catalog answered ${res.status}.`);
    return { text: await res.text(), url: res.url || url };
  },
  async file(url, onProgress){
    if (this.ok) {
      const id = "p" + Math.random().toString(36).slice(2); if (onProgress) progressFns[id] = onProgress;
      try { return await this.take(await this.call({ op: "file", url, id })); } finally { delete progressFns[id]; }
    }
    const res = await fetch(url); if (!res.ok) throw new Error(`The site answered ${res.status}.`);
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || ""; const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    const name = m ? decodeURIComponent(m[1]) : decodeURIComponent((res.url || url).split("?")[0].split("/").pop() || "download");
    return Object.assign(new File([blob], name, { type: blob.type }), { sourceUrl: url });
  },
  async take(info){
    let blob;
    if (TAURI) {
      const bytes = await TAURI.core.invoke("pk_read", { token: info.token }).catch(e => { throw new Error(typeof e === "string" ? e : "The download went missing. Try again."); });
      blob = new Blob([bytes], { type: info.type || "" });
    } else {
      const r = await fetch("__dl/" + info.token); if (!r.ok) throw new Error("The download went missing. Try again.");
      blob = await r.blob();
    }
    this.call({ op: "done", token: info.token }).catch(() => {});
    return Object.assign(new File([blob], info.name, { type: info.type || blob.type }), { sourceUrl: info.url });
  },
  open(url){ if (this.ok) this.call({ op: "browse", url }).catch(() => {}); else window.open(url, "_blank", "noopener"); }
};
if (TAURI && TAURI.event) {
  TAURI.event.listen("pk-progress", e => window.pkProgress(e.payload.id, e.payload.frac));
  TAURI.event.listen("pk-received", e => window.pkReceived(e.payload));
}
/* In the apps, website links open in Pagekeeper's own browser instead of leaving the app. */
document.addEventListener("click", e => {
  const a = e.target.closest && e.target.closest("a[href]");
  if (!a || !Native.ok || e.defaultPrevented) return;
  if (!/^https?:/i.test(a.href)) return;
  e.preventDefault();
  Native.open(a.href);
});
const BOOK_EXT = /\.(epub|pdf|txt)$/i;
function withExt(file, typeHint){
  if (BOOK_EXT.test(file.name)) return file;
  const ext = { "application/epub+zip": "epub", "application/pdf": "pdf", "text/plain": "txt" }[String(typeHint || file.type || "").split(";")[0].trim()];
  if (!ext) return file;
  return Object.assign(new File([file], file.name.replace(/\.[^.]*$/, "") + "." + ext, { type: file.type }), { sourceUrl: file.sourceUrl });
}
function progressToast(msg){
  const t = document.querySelector(".toast[data-p] span");
  if (t) t.innerHTML = msg; else { toast(msg, null, 600000); const n = document.querySelector(".toast"); if (n) n.dataset.p = "1"; }
}
/* Pick which book an audiobook belongs to. */
function pickBook(title, note, onPick){
  const books = Object.entries(S.books).filter(([, b]) => b.kind === "book" && !b.deleted && !b.builtin)
    .sort((a, b) => (b[1].updatedAt || b[1].addedAt || 0) - (a[1].updatedAt || a[1].addedAt || 0));
  const m = document.createElement("div"); m.className = "modal-back";
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${note}</p>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto">
      ${books.length ? books.map(([id, b]) => `<button class="btn" data-pick="${id}" style="justify-content:flex-start;text-align:left">${esc(b.title)}${b.author ? `<span class="note" style="font-weight:400"> · ${esc(b.author)}</span>` : ""}</button>`).join("")
        : `<p>Your library has no books yet. Add the ebook first (Project Gutenberg has most LibriVox titles), then add the audio to it.</p>`}
    </div><div class="row"><button class="btn" data-x>Cancel</button></div></div>`;
  m.addEventListener("click", e => {
    if (e.target === m || e.target.closest("[data-x]")) m.remove();
    const p = e.target.closest("[data-pick]"); if (p) { m.remove(); onPick(p.dataset.pick); }
  });
  document.body.append(m);
}
/* Files downloaded in the in-app browser arrive here. */
window.pkReceived = async info => {
  let file;
  try { file = await Native.take(info); } catch (e) { toast(esc(e.message)); return; }
  file = withExt(file, info.type);
  const ext = extOf(file.name);
  if (S.awaitingRelink && S.books[S.awaitingRelink] && BOOK_EXT.test(file.name)) { const id = S.awaitingRelink; S.awaitingRelink = null; return relinkWith(id, file); }
  if (BOOK_EXT.test(file.name) || ["mobi", "azw", "azw3"].includes(ext)) return importBook(file, { sourceUrl: info.url });
  if (AUDIO_EXT.test(file.name) || ext === "zip") {
    const target = S.awaitingAudio && S.books[S.awaitingAudio] ? S.awaitingAudio : null;
    if (target && notHere(target).some(t => !t.asset)) return matchAudio([file], target);
    return pickBook("Which book is this audio for?", esc(file.name), id => addAudio([file], id).catch(() => toast("Those files couldn't be added.")));
  }
  toast("Pagekeeper can't open that kind of file. Look for EPUB, PDF, TXT or MP3.");
};

/* ---------- Discover: repos (OPDS catalogs), LibriVox, websites ---------- */
const BUILTIN_REPOS = [
  { id: "gutenberg", name: "Project Gutenberg", desc: "More than 70,000 free classics whose copyright has expired.", url: "https://www.gutenberg.org/ebooks.opds/", search: "https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}", builtin: true },
  { id: "librivox", name: "LibriVox audiobooks", desc: "Free public-domain audiobooks read by volunteers. Adds the MP3s straight to a book.", type: "librivox", builtin: true }
];
const allRepos = () => [...BUILTIN_REPOS, ...((S.books.__repos && S.books.__repos.list) || [])];
const rerenderFind = () => { if (S.view === "find") renderFind($("#body")); };
function renderFind(el){
  if (!el) return;
  if (S.disc) return renderCatalog(el);
  const repos = allRepos();
  el.innerHTML = `
    <h2 class="sec">Repos</h2>
    <div class="srcs">
      ${repos.map(r => `<div class="src"><h3>${esc(r.name)}</h3><p style="word-break:break-word">${esc(r.desc || r.url)}</p>
        <div class="row"><button class="btn primary" data-repo="${esc(r.id)}">Browse</button>${r.builtin ? "" : `<button class="btn" data-rm="${esc(r.id)}">Remove</button>`}</div></div>`).join("")}
      <div class="src"><h3>Add a repo</h3><p>Paste the address of an OPDS catalog, the format libraries and ebook stores use to share their shelves. Your own Calibre library works too. Repos you add show up on all your devices.</p>
        <div class="row"><button class="btn" id="addRepo">${ICON.plus} Add repo</button></div></div>
    </div>
    ${Native.ok ? "" : `<p class="note" style="margin:-12px 0 22px;max-width:65ch">Some repos block browsing from a PC browser. They all work in the iPhone app.</p>`}
    <div id="sites"></div>`;
  renderSites($("#sites", el));
  el.querySelectorAll("[data-repo]").forEach(b => b.onclick = () => openRepo(b.dataset.repo));
  el.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    const list = (S.books.__repos?.list || []).filter(r => r.id !== b.dataset.rm);
    save("__repos", { kind: "repos", list }); rerenderFind();
  });
  $("#addRepo").onclick = () => linkBox("Add a repo", "Paste the OPDS catalog address. It usually ends in <code>/opds</code> or <code>.xml</code>.", "", async u => {
    if (!u) return;
    progressToast("Checking the repo…");
    try {
      const r = await Native.text(u); const f = parseOPDS(r.text, r.url);
      const list = [...(S.books.__repos?.list || []), { id: "r" + Date.now().toString(36), name: f.title || new URL(u).host, url: u, desc: u }];
      save("__repos", { kind: "repos", list }); clearToasts(); toast(`Added “${esc(f.title || "repo")}”.`); rerenderFind();
    } catch (e) { clearToasts(); toast(esc(friendlyNetError(e))); }
  });
}
function friendlyNetError(e){
  if (e instanceof TypeError && !Native.ok) return "Your browser blocked this site. Try it in the iPhone app.";
  if (e instanceof TypeError || /offline|internet|network/i.test(e.message)) return "Couldn't connect. Check your internet connection.";
  return e.message || "Something went wrong.";
}
function openRepo(id){
  const repo = allRepos().find(r => r.id === id); if (!repo) return;
  S.disc = { repo, stack: [], entries: [], next: null, loading: false, error: "", q: "" };
  if (repo.type === "librivox") { rerenderFind(); return; }
  S.disc.stack.push({ url: repo.url, title: repo.name });
  loadFeed();
}
async function loadFeed(append){
  const d = S.disc; if (!d) return; const top = d.stack[d.stack.length - 1];
  d.loading = true; d.error = ""; if (!append) { d.entries = []; d.next = null; }
  rerenderFind();
  try {
    const r = await Native.text(append ? d.next : top.url);
    const f = parseOPDS(r.text, r.url);
    if (S.disc !== d) return;
    d.entries = append ? d.entries.concat(f.entries) : f.entries;
    d.next = f.next || null;
    if (!append) { d.title = f.title || top.title; if (f.search && !d.searchLink) d.searchLink = f.search; }
  } catch (e) { d.error = friendlyNetError(e); }
  d.loading = false; rerenderFind();
}
function parseOPDS(xml, base){
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const feed = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length || !feed || feed.localName !== "feed") throw new Error("That address isn't an OPDS catalog.");
  const abs = h => { try { return h ? new URL(h, base).href : null; } catch { return null; } };
  const kids = (el, name) => [...el.children].filter(c => c.localName === name);
  const txt = (el, name) => clean(kids(el, name)[0]?.textContent);
  const links = el => kids(el, "link").map(l => ({ rel: l.getAttribute("rel") || "", type: (l.getAttribute("type") || "").toLowerCase(), href: abs(l.getAttribute("href")), title: l.getAttribute("title") || "" })).filter(l => l.href);
  const fl = links(feed);
  const entries = kids(feed, "entry").map(e => {
    const L = links(e);
    const acq = L.filter(l => /opds-spec\.org\/acquisition(\/open-access)?$/.test(l.rel) || l.rel === "http://opds-spec.org/acquisition");
    const formats = [];
    for (const [type, label] of [["application/epub+zip", "EPUB"], ["application/pdf", "PDF"], ["text/plain", "TXT"]]) {
      const all = acq.filter(a => a.type.startsWith(type));
      // Prefer the newest, illustrated edition when a catalog offers several (e.g. Gutenberg's EPUB3 with images).
      const l = all.find(a => /epub3/i.test(a.href + a.title) && !/no ?images/i.test(a.href + a.title)) || all.find(a => !/no ?images/i.test(a.href + a.title)) || all[0];
      if (l) formats.push({ label, type, href: l.href });
    }
    const nav = !acq.length ? (L.find(l => /atom\+xml/.test(l.type) && !/acquisition|image|alternate/.test(l.rel)) || L.find(l => /atom\+xml/.test(l.type))) : null;
    const img = L.find(l => /opds-spec\.org\/image\/thumbnail/.test(l.rel)) || L.find(l => /opds-spec\.org\/image$/.test(l.rel));
    const authors = kids(e, "author").map(a => txt(a, "name")).filter(Boolean).join(", ");
    return { title: txt(e, "title") || "Untitled", authors, summary: (txt(e, "summary") || txt(e, "content")).slice(0, 220), formats, nav: nav && nav.href, img: img && img.href, otherOnly: !!acq.length && !formats.length };
  });
  const search = fl.find(l => l.rel === "search");
  return { title: txt(feed, "title"), entries, next: fl.find(l => l.rel === "next")?.href, search };
}
async function searchUrl(d, q){
  let t = d.repo.search;
  if (!t && d.searchLink) {
    if (/opensearchdescription/.test(d.searchLink.type)) {
      const r = await Native.text(d.searchLink.href);
      const x = new DOMParser().parseFromString(r.text, "application/xml");
      const urls = [...x.getElementsByTagNameNS("*", "Url")];
      const u = urls.find(u => /atom/.test(u.getAttribute("type") || "")) || urls[0];
      t = u ? new URL(u.getAttribute("template"), r.url).href : null;
    } else t = d.searchLink.href;
  }
  if (!t) return null;
  return t.replace(/\{searchTerms\}|%7BsearchTerms%7D/gi, encodeURIComponent(q)).replace(/\{[^}]*\?\}|%7B[^%]*%3F%7D/gi, "");
}
function renderCatalog(el){
  const d = S.disc, lv = d.repo.type === "librivox";
  const canSearch = lv || d.repo.search || d.searchLink;
  const depth = d.stack.length;
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn" id="dBack">${ICON.back} ${depth > 1 ? "Back" : "Repos"}</button>
      <h2 style="margin:0;font-size:18px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lv ? d.repo.name : (d.title || d.repo.name))}</h2>
    </div>
    ${canSearch ? `<form class="find-search" id="dSearch"><input id="dQ" type="search" placeholder="${lv ? "Title or author, e.g. Frankenstein" : "Search this repo"}" value="${esc(d.q)}" aria-label="Search"><button class="btn primary">Search</button></form>` : ""}
    <div id="dList">${
      d.error ? `<div class="banner"><span>${esc(d.error)}</span><button class="btn" id="dRetry">Try again</button></div>`
      : d.loading && !d.entries.length ? `<p class="note">Loading…</p>`
      : !d.entries.length ? `<p class="note">${lv ? "Search for a book to find its free audiobook." : "Nothing here."}</p>`
      : d.entries.map((x, i) => entryHTML(x, i, lv)).join("")}
    </div>
    ${(lv || d.repo.id === "gutenberg") && d.q && !d.loading ? `<p class="note" style="max-width:65ch;margin:14px 0">${lv ? "LibriVox" : "Project Gutenberg"} only has books whose copyright has expired, mostly published before 1930. Newer books like <i>Dune</i> won't be here. For those, try your public library's free Libby app, or buy a DRM-free copy and tap Add book.</p>` : ""}
    ${d.next && !d.error ? `<button class="btn" id="dMore" ${d.loading ? "disabled" : ""}>${d.loading ? "Loading…" : "More"}</button>` : ""}`;
  $("#dBack").onclick = () => { if (d.stack.length > 1) { d.stack.pop(); d.searchMode = false; loadFeed(); } else { S.disc = null; rerenderFind(); } };
  const form = $("#dSearch");
  if (form) form.onsubmit = async e => {
    e.preventDefault(); const q = $("#dQ").value.trim(); if (!q) return; d.q = q;
    if (lv) return librivoxSearch(q);
    try { const u = await searchUrl(d, q); if (!u) { toast("This repo doesn't support search."); return; }
      d.stack = [d.stack[0], { url: u, title: `“${q}”` }]; loadFeed(); }
    catch (err) { toast(esc(friendlyNetError(err))); }
  };
  const rt = $("#dRetry"); if (rt) rt.onclick = () => lv ? librivoxSearch(d.q) : loadFeed();
  const more = $("#dMore"); if (more) more.onclick = () => loadFeed(true);
  el.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => { const x = d.entries[+b.dataset.nav]; d.stack.push({ url: x.nav, title: x.title }); loadFeed(); });
  el.querySelectorAll("[data-get]").forEach(b => b.onclick = () => { const [i, f] = b.dataset.get.split(":").map(Number); const x = d.entries[i]; getBook(x.formats[f], x); });
  el.querySelectorAll("[data-lv]").forEach(b => b.onclick = () => librivoxAdd(d.entries[+b.dataset.lv]));
}
function entryHTML(x, i, lv){
  const img = x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="ph" style="background:hsl(${hue(x.title)} 40% 40%)"></div>`;
  const actions = lv ? `<button class="btn primary" data-lv="${i}">${ICON.head} Add audio to a book</button>`
    : x.formats.length ? x.formats.map((f, k) => `<button class="btn ${k ? "" : "primary"}" data-get="${i}:${k}">${ICON.down} ${f.label}</button>`).join("")
    : x.nav ? `<button class="btn" data-nav="${i}">Open ${ICON.next}</button>`
    : x.otherOnly ? `<span class="note">Only in formats Pagekeeper can't open.</span>` : "";
  return `<div class="entry">${img}<div class="e-body"><b>${esc(x.title)}</b>${x.authors ? `<span class="note">${esc(x.authors)}</span>` : ""}${x.summary ? `<span class="e-sum">${esc(x.summary)}</span>` : ""}<div class="row-btns">${actions}</div></div></div>`;
}
async function getBook(fmt, entry){
  progressToast(`Downloading “${esc(entry.title)}”…`);
  try {
    let f = await Native.file(fmt.href, p => progressToast(`Downloading “${esc(entry.title)}”… ${Math.round(p * 100)}%`));
    f = withExt(f, fmt.type); clearToasts();
    await importBook(f, { sourceUrl: fmt.href });
  } catch (e) {
    clearToasts();
    if (!Native.ok) { toast("Your browser blocked the download, so its page is opening instead. Download it there, then tap Add book.", null, 8000); window.open(fmt.href, "_blank", "noopener"); }
    else toast(esc(friendlyNetError(e)));
  }
}
/* LibriVox recordings live on the Internet Archive, which has open search and file APIs. */
async function librivoxSearch(q){
  const d = S.disc; d.loading = true; d.error = ""; d.entries = []; rerenderFind();
  const term = q.replace(/[():"]/g, " ").trim();
  const query = `collection:(librivoxaudio) AND (title:(${term}) OR creator:(${term}))`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=30&sort[]=downloads+desc&output=json`;
  try {
    const r = await Native.text(url); const j = JSON.parse(r.text);
    if (S.disc !== d) return;
    d.entries = (j.response?.docs || []).map(x => ({ id: x.identifier, title: clean(String(x.title || x.identifier)), authors: [].concat(x.creator || []).join(", "), img: `https://archive.org/services/img/${encodeURIComponent(x.identifier)}` }));
  } catch (e) { d.error = friendlyNetError(e); }
  d.loading = false; rerenderFind();
}
async function librivoxAdd(x){
  progressToast("Looking up the recording…");
  let files;
  try {
    const r = await Native.text(`https://archive.org/metadata/${encodeURIComponent(x.id)}/files`);
    const all = JSON.parse(r.text).result || [];
    let mp3 = all.filter(f => f.format === "64Kbps MP3");
    if (!mp3.length) mp3 = all.filter(f => /MP3/.test(f.format || "") && !/_64kb\.mp3$/.test(f.name));
    files = mp3.sort((a, b) => (parseInt(a.track) || 0) - (parseInt(b.track) || 0) || natural(a.name, b.name));
  } catch (e) { clearToasts(); toast(esc(friendlyNetError(e))); return; }
  clearToasts();
  if (!files.length) { toast("This recording has no MP3 files."); return; }
  const size = files.reduce((n, f) => n + (+f.size || 0), 0);
  pickBook("Add this audiobook to which book?", `${esc(x.title)} · ${files.length} part${files.length > 1 ? "s" : ""}${size ? `, ${esc(fmtSize(size))}` : ""}. It downloads once and then plays offline.`, async id => {
    const book = S.books[id];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const url = `https://archive.org/download/${encodeURIComponent(x.id)}/${f.name.split("/").map(encodeURIComponent).join("/")}`;
      const label = `Downloading part ${i + 1} of ${files.length} for “${esc(book.title)}”`;
      progressToast(label + "…");
      try {
        let file = await Native.file(url, p => progressToast(`${label}… ${Math.round(p * 100)}%`));
        if (!AUDIO_EXT.test(file.name)) file = new File([file], f.name.split("/").pop(), { type: "audio/mpeg" });
        await addAudio([file], id, true);
      } catch (e) {
        clearToasts(); toast(`Stopped at part ${i + 1}: ${esc(friendlyNetError(e))}`, null, 8000); return;
      }
    }
    if (S.books[id].audio && !S.books[id].audio.url) save(id, { audio: { url: `https://archive.org/details/${x.id}` } });
    clearToasts();
    toast(`Audiobook added to “${esc(book.title)}”.`, { label: "Open book", fn: () => { openBook(id); S.dock = true; updateDock(); } }, 8000);
  });
}

/* ---------- reader ---------- */
async function openBook(id){
  S.cur = id; S.view = "reader"; S.sheet = null; S.page = Math.max(1, S.books[id].page || 1);
  stopReadAloud();
  S.dock = false; S.reading = false; S.playerMode = null; TTS.idx = 0; TTS.count = 0;
  S.followHold = false; S.syncPick = false; fLast.page = 0; fLast.el = null;
  renderReader(); await showPage();
  if (TAURI) setTimeout(() => { if (S.cur === id) maybeAutoSync(id); }, 1500);
}
function closeReader(){
  saveAudioPos(true); stopReadAloud();
  S.view = "library"; S.cur = null; render(); syncNow();
  if (TAURI) capSend(); else { const f = $("#floatcap"); if (f) f.remove(); }
}
function renderReader(){
  const b = S.books[S.cur];
  app.innerHTML = `<div class="reader" data-paper="${prefs.get("paper")}" style="--fs:${prefs.get("fs")}px">
    <div class="rbar">
      <button class="ib" id="rBack" aria-label="Back to library">${ICON.back}</button>
      <div class="rt"><b>${esc(b.title)}</b><span id="rPos"></span></div>
      <button class="ib" id="rPop" aria-label="${prefs.get("capOn") ? "Hide" : "Show"} pop-out text" title="Pop-out text" aria-pressed="${!!prefs.get("capOn")}">${ICON.pop}</button>
      <button class="ib" id="rMark" aria-label="Bookmark this page" aria-pressed="false">${ICON.bm}</button>
      <button class="ib" id="rToc" aria-label="Contents, search, notes and more">${ICON.list}</button>
      <button class="ib" id="rType" aria-label="Text settings">${ICON.type}</button>
      <button class="ib" id="rAudio" aria-label="Audio" aria-pressed="${S.dock}">${ICON.head}</button>
    </div>
    <div class="rmain" id="rMain"><div class="state"><p>Opening…</p></div></div>
    <div id="dock"></div>
    <div class="rfoot">
      <button class="ib" id="rPrev" aria-label="Previous page">${ICON.back}</button>
      <input type="range" id="rSlide" min="1" max="1" value="1" aria-label="Page">
      <span class="pnum" id="rNum"></span>
      <button class="ib" id="rNext" aria-label="Next page">${ICON.next}</button>
    </div>
    <div id="sheet"></div>
  </div>`;
  setTimeout(updateFollowPill, 0);
  $("#rBack").onclick = closeReader;
  $("#rPrev").onclick = () => goto(S.page - 1);
  $("#rNext").onclick = () => goto(S.page + 1);
  $("#rSlide").oninput = e => { $("#rNum").textContent = `${e.target.value} / ${total()}`; };
  $("#rSlide").onchange = e => goto(+e.target.value);
  $("#rToc").onclick = () => toggleSheet("toc");
  $("#rMark").onclick = toggleBookmark;
  $("#rType").onclick = () => toggleSheet("type");
  $("#rAudio").onclick = () => {
    S.dock = !S.dock;
    // The headphones open the full player: audiobook if the book has one, otherwise Read aloud.
    if (S.dock) S.bigPlayer = true;
    $("#rAudio").setAttribute("aria-pressed", S.dock); updateDock();
  };
  $("#rPop").onclick = () => {
    setCaption(!prefs.get("capOn"));
    const on = !!prefs.get("capOn");
    $("#rPop").setAttribute("aria-pressed", on); $("#rPop").setAttribute("aria-label", (on ? "Hide" : "Show") + " pop-out text");
    toast(on ? (TAURI ? "Pop-out text is on. Drag it anywhere; change its colors under Aa." : "Pop-out text is on. Drag it around; change its colors under Aa.") : "Pop-out text is off.");
    if (S.sheet === "type") renderSheet();
  };
  const main = $("#rMain");
  let sx = 0, sy = 0;
  main.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  main.addEventListener("touchend", e => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) goto(S.page + (dx < 0 ? 1 : -1)); });
  main.addEventListener("click", e => {
    if (S.syncPick && !e.target.closest("button,a,input")) { followPick(e); return; }
    if (e.target.closest("button,a,input")) return;
    if (window.getSelection && String(window.getSelection())) return;
    // tapped a highlight: show it, with its note
    const cp = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
    const cr = !cp && document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    const node = cp ? cp.offsetNode : cr && cr.startContainer, off = cp ? cp.offset : cr && cr.startOffset;
    const hit = node && domToPos(node, off); const mk = hit != null && markAt(hit);
    if (mk) { markPopup(mk); return; }
    const r = main.getBoundingClientRect(); const x = e.clientX - r.left;
    if (x > r.width * .8) goto(S.page + 1); else if (x < r.width * .2) goto(S.page - 1);
  });
  updateDock();
}
const total = () => { const c = S.content[S.cur]; return c ? (c.kind === "pdf" ? c.total : c.pages.length) : (S.books[S.cur]?.pages || 1); };
async function showPage(){
  const id = S.cur; const main = $("#rMain"); if (!main) return;
  let c, failed = false;
  try { c = await loadContent(id); } catch (e) { console.warn(e); c = null; failed = true; }
  if (id !== S.cur) return;
  if (!c) { renderMissing(main, id, failed); updateReaderChrome(); return; }
  const T = total();
  if (S.books[id].pages !== T) S.books[id].pages = T;
  S.page = Math.min(Math.max(1, S.page), T);
  if (c.kind === "text") {
    const blocks = c.pages[S.page - 1];
    // Each sentence is its own span so read-aloud can highlight it.
    const sentences = x => splitS(x).map(s => `<span data-s>${esc(s)}</span>`).join("");
    main.innerHTML = `<article class="page">${blocks.map(([t, x]) => t === "h" ? `<h2><span data-s>${esc(x)}</span></h2>` : `<p>${sentences(x)}</p>`).join("")}<div class="pno">${S.page}</div></article>`;
  } else {
    main.innerHTML = `<div class="pdfwrap"><canvas id="pdfc"></canvas></div>`;
    const pg = await c.pdf.getPage(S.page); if (id !== S.cur) return;
    const w = Math.min(main.clientWidth - 20, 900); const vp1 = pg.getViewport({ scale: 1 });
    const dpr = Math.min(devicePixelRatio || 1, 2.5);
    const vp = pg.getViewport({ scale: (w / vp1.width) * dpr }); const cv = $("#pdfc"); if (!cv) return;
    cv.width = vp.width; cv.height = vp.height; cv.style.width = (vp.width / dpr) + "px";
    await pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
  }
  main.scrollTop = 0;
  updateReaderChrome();
  paintMarks(); paintBookmarkBtn(); closeSelBar();
  if (!capNow.speaking) capSend();
}
function renderMissing(main, id, failed){
  const b = S.books[id], src = b.src || {};
  if (b.asset) {
    main.innerHTML = `<div class="state"><h3 style="margin:0">${navigator.onLine === false ? "Connect once to get this book" : "Couldn't download this book"}</h3>
      <p>${navigator.onLine === false ? "It's in your account but hasn't been downloaded to this device yet. Open it once while online and it stays here for offline reading." : "Check your connection and try again."}</p>
      <button class="btn primary" id="retry">Try again</button></div>`;
    $("#retry").onclick = () => showPage();
    return;
  }
  const big = src.size > MAX_FILE;
  main.innerHTML = `<div class="state"><h3 style="margin:0">Get the same file on this device</h3>
    <p>This book was added on ${esc(b.device || "another device")}${big ? ` and is too big to copy to your account (${esc(fmtSize(src.size))})` : " and hasn't finished uploading yet"}. ${big ? "Download the exact same file, then choose it. Your page stays the same." : "Wait for it to sync, or choose the same file here."}</p>
    ${src.name ? `<div class="filebox">File: <b>${esc(src.name)}</b>${src.size ? `<br>Size: ${esc(fmtSize(src.size))} (${src.size.toLocaleString()} bytes)` : ""}</div>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
      ${src.url && Native.ok ? `<button class="btn primary" id="dlHere">${ICON.down} Download it here</button><a class="btn" href="${esc(src.url)}" target="_blank" rel="noopener" data-await-book>Open the download page</a>`
        : src.url ? `<a class="btn primary" href="${esc(src.url)}" target="_blank" rel="noopener" data-await-book>1. Download the same file ↗</a>` : ""}
      <button class="btn ${src.url ? "" : "primary"}" id="relink">${src.url && !Native.ok ? "2. " : ""}Choose the downloaded file</button>
    </div>
    ${src.url ? `<p style="font-size:12.5px">On iPhone, downloads go to the Files app, in Downloads.</p>`
      : `<p style="font-size:12.5px">No download link was saved for this book. <button class="btn ghost" id="addLink" style="padding:4px 6px;color:var(--accent)">Add the link</button></p>`}
  </div>`;
  $("#relink").onclick = () => $("#relinkFile").click();
  main.querySelectorAll("[data-await-book]").forEach(a => a.addEventListener("click", () => { S.awaitingRelink = id; }));
  const dh = $("#dlHere"); if (dh) dh.onclick = async () => {
    progressToast("Downloading…");
    try { const f = withExt(await Native.file(src.url, p => progressToast(`Downloading… ${Math.round(p * 100)}%`))); clearToasts(); relinkWith(id, f); }
    catch (e) { clearToasts(); toast(esc(friendlyNetError(e)) + " You can also open the download page and download it there.", null, 8000); }
  };
  const al = $("#addLink"); if (al) al.onclick = () => linkBox("Where can this book be downloaded?", "Paste the page or link where you got it. Every device then shows a download button for this file.", "", u => { save(id, { src: { ...src, url: u } }); showPage(); });
}
function updateReaderChrome(){
  if (S.view !== "reader" || !$("#rPos")) return;
  const T = total();
  $("#rPos").textContent = `Page ${S.page} of ${T}`;
  const sl = $("#rSlide"); sl.max = T; sl.value = S.page;
  $("#rNum").textContent = `${S.page} / ${T}`;
  $("#rPrev").disabled = S.page <= 1; $("#rNext").disabled = S.page >= T;
}
async function goto(n, fromRemote, fromTts){
  const T = total(); n = Math.min(Math.max(1, n), T);
  if (n === S.page && !fromRemote) return;
  S.page = n;
  save(S.cur, { page: n, pages: T });
  if (S.sheet === "toc") renderSheet();
  if (!fromTts) TTS.idx = 0;
  if (!fromRemote && !fromTts && followActive()) S.followHold = true;
  await showPage();
  updateFollowPill();
  // Turning the page yourself while it reads aloud: keep reading from the top of the new page.
  if (!fromTts && S.reading && !TTS.paused) ttsStart(0);
  else if (S.dock && playerMode() === "tts") updateTtsUI();
}
document.addEventListener("keydown", e => {
  if (S.view !== "reader" && !S.keyRecording && !e.target.closest("input,select,textarea,button") && auBook && keyMatch(e, keyPlay())) { e.preventDefault(); playPauseAny(); return; }
  if (S.view !== "reader" || e.target.closest("input,select,textarea")) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goto(S.page + 1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goto(S.page - 1); }
  else if (keyMatch(e, keyPlay()) && !(e.code === "Space" && e.target.closest("button"))) { e.preventDefault(); playPauseAny(); }
  else if (e.key === "Escape") { if (S.sheet) toggleSheet(S.sheet); else if (S.bigPlayer) { S.bigPlayer = false; updateDock(); } else closeReader(); }
});
function toggleSheet(name){ S.sheet = S.sheet === name ? null : name; renderSheet(); }
function renderSheet(){
  const el = $("#sheet"); if (!el) return;
  if (!S.sheet) { el.innerHTML = ""; return; }
  const c = S.content[S.cur];
  if (S.sheet === "toc") { renderBookSheet(el); return; }
  if (false) {
    let items = "";
    if (c && c.kind === "text") {
      const curIdx = c.toc.reduce((acc, t, i) => t.page <= S.page ? i : acc, 0);
      items = c.toc.map((t, i) => `<li><button data-p="${t.page}" class="${i === curIdx ? "cur" : ""}"><span>${esc(t.title)}</span><span>${t.page}</span></button></li>`).join("");
    } else if (c) {
      const T = c.total, step = Math.max(1, Math.ceil(T / 30));
      for (let p = 1; p <= T; p += step) items += `<li><button data-p="${p}"><span>Page ${p}</span><span>${Math.round((p-1)/Math.max(1,T-1)*100)}%</span></button></li>`;
    }
    el.innerHTML = `<div class="sheet"><h3>Contents <button class="ib" data-close aria-label="Close">${ICON.close}</button></h3><ul class="toc">${items || "<li class='note'>Nothing here yet.</li>"}</ul></div>`;
    el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { S.sheet = null; renderSheet(); goto(+b.dataset.p); });
  } else {
    const paper = prefs.get("paper"), fs = prefs.get("fs");
    el.innerHTML = `<div class="sheet"><h3>Reading settings <button class="ib" data-close aria-label="Close">${ICON.close}</button></h3>
      <div class="field"><label>Paper</label><div class="seg">${[["paper","White"],["sepia","Sepia"],["night","Night"]].map(([k,l]) => `<button data-paper="${k}" aria-pressed="${paper === k}">${l}</button>`).join("")}</div></div>
      <div class="field"><label>Text size · ${fs}px</label><div class="seg"><button data-fs="-1" aria-label="Smaller text">A−</button><button data-fs="1" aria-label="Larger text">A+</button></div>
        <span class="note">Page numbers don't change with text size, so they match your other devices.</span></div>
      <div class="field"><label>Highlight while reading aloud</label><div class="seg">${[["sentence","Sentence"],["word","Word"],["off","Off"]].map(([k,l]) => `<button data-hl="${k}" aria-pressed="${(prefs.get("hl") || "sentence") === k}">${l}</button>`).join("")}</div>
        <span class="note">Follows along when you use Read aloud on EPUB and text books. Audiobook files can't be matched to the text word by word.</span></div>
      <div class="field"><label>Read-aloud speed · ${rateTxt(prefs.get("ttsRate") || 1)}</label><div class="seg">${[0.8, 1, 1.2, 1.5].map(r => `<button data-tts="${r}" aria-pressed="${(prefs.get("ttsRate") || 1) === r}">${rateTxt(r)}</button>`).join("")}</div></div></div>`;
    const cap = capCfg(), capOn = !!prefs.get("capOn"), clear = cap.style === "clear";
    el.querySelector(".sheet").insertAdjacentHTML("beforeend", `
      <div class="field"><label>Pop-out text</label>
        <div class="seg"><button id="capToggle" aria-pressed="${capOn}">${capOn ? "Hide pop-out" : "Show pop-out"}</button></div>
        <span class="note">${TAURI ? "Floats on top of everything on your screen. Drag it anywhere; drag its edges to resize." : "Floats over Pagekeeper. Drag it around; drag its corner to resize."} It shows the sentence being read aloud, or the page you're on.</span></div>
      <div class="field"><label>Pop-out shows</label>
        <div class="seg"><button data-capmode="line" aria-pressed="${capMode() === "line"}">One sentence</button><button data-capmode="page" aria-pressed="${capMode() === "page"}">The whole page</button></div>
        ${capMode() === "page" ? `<div class="seg" style="margin-top:8px">${Object.entries(CAP_SIZES).map(([k, [, , l]]) => `<button data-capsize="${k}" aria-pressed="${(prefs.get("capPSz") || "tablet") === k}">${l}</button>`).join("")}</div>
        <div class="seg" style="margin-top:8px"><button data-capx="gray" aria-pressed="${prefs.get("capGray") !== false}">Gray until it's read</button><button data-capx="pclear" aria-pressed="${prefs.get("capPClear") === true}">No background</button></div>` : ""}
        <span class="note">The whole page: words are gray until they're read, then come into color. ${TAURI ? "Double-click" : "Double-tap"} a word to move the audiobook or read-aloud to it. Drag it by its top bar${TAURI ? ", and drag its edges to resize" : ""}. For audiobooks, turn on Follow in the player.</span></div>
      <div class="field"><label>Pop-out style</label>
        <div class="seg">
          <button data-capstyle="clear" aria-pressed="${clear}">Just text</button>
          <button data-capstyle="solid" aria-pressed="${!clear}">Text on a box</button>
          ${TAURI ? "" : `<button id="capAuto" aria-pressed="${!!cap.auto}">Auto-invert</button>`}
        </div>
        <span class="note">${clear ? "No background. Each letter gets a thin outline so it stays readable on light and dark." : "Text on a solid box in the background color."}
          ${TAURI ? "" : " Auto-invert makes the text white over dark parts and black over light parts."}</span></div>
      <div class="field"><label>Pop-out colors</label>
        <div class="capcolors">
          <label class="cc">Text <input type="color" id="capFg" value="${esc(cap.fg)}" ${cap.auto && !TAURI ? "disabled" : ""}></label>
          <label class="cc">${clear ? "Outline" : "Background"} <input type="color" id="capBg" value="${esc(cap.bg)}" ${cap.auto && !TAURI ? "disabled" : ""}></label>
          <span class="cap-sample ${clear ? "clear" : ""}" style="color:${esc(cap.fg)};--o:${esc(cap.bg)};${clear ? "" : `background:${esc(cap.bg)}`}">Sample text</span>
        </div>
        <div class="seg" style="margin-top:8px">
          <button id="capInvert">Invert colors</button>
          <button data-capsz="-1" aria-label="Smaller pop-out text">A−</button><button data-capsz="1" aria-label="Larger pop-out text">A+</button>
          <button id="capReset">Reset</button>
        </div></div>
      <div class="field"><label>Pop-out extras</label>
        <div class="seg">
          <button data-capx="lock" aria-pressed="${!!prefs.get("capLock")}">${prefs.get("capLock") ? "Unlock pop-out" : "Lock in place"}</button>
          <button data-capx="autohide" aria-pressed="${!!prefs.get("capHide")}">Hide when paused</button>
          <button data-capx="info" aria-pressed="${prefs.get("capInfo") !== false}">Chapter and time left</button>
        </div>
        <span class="note">Locked, ${TAURI ? "clicks" : "taps"} go straight through the pop-out to whatever is under it. Hide when paused shows it only while the audiobook or read-aloud is playing. You can also ${TAURI ? "right-click" : "press and hold"} the pop-out for these.</span></div>`);
    el.querySelectorAll("[data-capx]").forEach(b => b.onclick = () => { capCmd(b.dataset.capx); renderSheet(); });
    el.querySelectorAll("[data-capmode]").forEach(b => b.onclick = () => { if (!prefs.get("capOn")) setCaption(true); setCapMode(b.dataset.capmode); });
    el.querySelectorAll("[data-capsize]").forEach(b => b.onclick = () => { if (!prefs.get("capOn")) setCaption(true); capCmd("size-" + b.dataset.capsize); });
    $("#capToggle").onclick = () => { setCaption(!prefs.get("capOn")); const rp = $("#rPop"); if (rp) rp.setAttribute("aria-pressed", !!prefs.get("capOn")); renderSheet(); };
    el.querySelectorAll("[data-capstyle]").forEach(b => b.onclick = () => { prefs.set("capStyle", b.dataset.capstyle); capSend(); renderSheet(); });
    const ca = $("#capAuto"); if (ca) ca.onclick = () => { prefs.set("capAuto", !capCfg().auto); capSend(); renderSheet(); };
    const colorChange = () => { prefs.set("capFg", $("#capFg").value); prefs.set("capBg", $("#capBg").value);
      const s = el.querySelector(".cap-sample"); s.style.color = $("#capFg").value; s.style.setProperty("--o", $("#capBg").value);
      if (capCfg().style !== "clear") s.style.background = $("#capBg").value; capSend(); };
    $("#capFg").oninput = colorChange; $("#capBg").oninput = colorChange;
    $("#capInvert").onclick = () => { const c = capCfg(); prefs.set("capFg", c.bg); prefs.set("capBg", c.fg); capSend(); renderSheet(); };
    el.querySelectorAll("[data-capsz]").forEach(b => b.onclick = () => { prefs.set("capSize", Math.min(48, Math.max(12, capCfg().size + 2 * +b.dataset.capsz))); capSend(); });
    $("#capReset").onclick = () => { ["capFg", "capBg", "capSize", "capStyle", "capAuto"].forEach(k => prefs.set(k, undefined)); capSend(); renderSheet(); };
    el.querySelectorAll("[data-hl]").forEach(b => b.onclick = () => { prefs.set("hl", b.dataset.hl); if (b.dataset.hl === "off") clearHighlights(); renderSheet(); });
    el.querySelectorAll("[data-tts]").forEach(b => b.onclick = () => { prefs.set("ttsRate", +b.dataset.tts); renderSheet(); });
    el.querySelectorAll("[data-paper]").forEach(b => b.onclick = () => { prefs.set("paper", b.dataset.paper); $(".reader").dataset.paper = b.dataset.paper; renderSheet(); });
    el.querySelectorAll("[data-fs]").forEach(b => b.onclick = () => { const v = Math.min(30, Math.max(14, prefs.get("fs") + 2 * +b.dataset.fs)); prefs.set("fs", v); $(".reader").style.setProperty("--fs", v + "px"); renderSheet(); });
  }
  el.querySelector("[data-close]").onclick = () => toggleSheet(S.sheet);
}

/* ---------- audio ---------- */
const au = $("#au");
let auBook = null, auSaveAt = 0, auObjURL = null;
const fmt = s => { if (!isFinite(s)) return "–:––"; s = Math.floor(s); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return (h ? h + ":" + String(m).padStart(2,"0") : m) + ":" + String(x).padStart(2,"0"); };
const AUDIO_EXT = /\.(mp3|m4a|m4b|mp4|aac|ogg|opus|oga|wav|webm|flac)$/i;
const extOf = n => (n.split(".").pop() || "").toLowerCase();
const mimeFor = n => ({ mp3:"audio/mpeg", m4a:"audio/mp4", m4b:"audio/mp4", mp4:"audio/mp4", aac:"audio/aac", ogg:"audio/ogg", oga:"audio/ogg", opus:"audio/ogg", wav:"audio/wav", webm:"audio/webm", flac:"audio/flac" }[extOf(n)] || "audio/mpeg");
async function expandZips(files){
  const list = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      await loadScript(JSZIP); const zip = await window.JSZip.loadAsync(f);
      for (const z of Object.values(zip.files).filter(z => !z.dir && AUDIO_EXT.test(z.name) && !/__MACOSX/.test(z.name))) { const name = z.name.split("/").pop(); list.push(new File([await z.async("blob")], name, { type: mimeFor(name) })); }
    } else if (AUDIO_EXT.test(f.name) || /^audio\//.test(f.type)) list.push(f);
  }
  return list.sort((a, c) => natural(a.name, c.name));
}
async function addAudio(files, id = S.cur, quiet = false){
  const b = S.books[id]; if (!b) return;
  if (!quiet) toast("Getting the audio ready…", null, 60000);
  const list = await expandZips(files);
  if (!list.length) { toast("No audio files found. Use MP3, M4A, M4B or a zip of them."); return; }
  const tracks = [...(b.audio?.tracks || [])];
  let big = 0, split = 0;
  for (const f of list) {
    // MP3s over the upload limit are cut into smaller parts, so they can copy to your account and your phone.
    let pieces = null;
    if (f.size > MAX_FILE && canSplit(f)) { if (!quiet) toast(`Splitting “${esc(f.name)}” into smaller parts…`, null, 120000); pieces = await splitAudio(f).catch(() => null); }
    if (pieces && pieces.length > 1) {
      split++;
      const base = f.name.replace(/\.[^.]+$/, "");
      for (let k = 0; k < pieces.length; k++) {
        const pf = new File([pieces[k].blob], `${base} (${k + 1} of ${pieces.length}).${pieceExt(f)}`, { type: isMp3(f) ? "audio/mpeg" : "audio/mp4" });
        tracks.push(await storeTrack(id, pf, `${base} (${k + 1} of ${pieces.length})`, pieces[k].secs));
      }
      continue;
    }
    if (f.size > MAX_FILE) big++;
    tracks.push(await storeTrack(id, f, f.name.replace(/\.[^.]+$/, "")));
  }
  const fresh = !(b.audio?.tracks || []).length;
  save(id, { audio: fresh ? { tracks, track: 0, time: 0 } : { tracks } }, { now: true });
  if (quiet) { if (S.cur === id) updateDock(); return; }
  clearToasts();
  if (split) toast(`Big audio files were split into parts under 50 MB, so they can copy to your account and your phone.`, null, 7000);
  else toast(big && Cloud.signedIn() ? `Added. ${big} file${big > 1 ? "s are" : " is"} over 50 MB and stay${big > 1 ? "" : "s"} on this device; your listening spot still syncs.` : Cloud.signedIn() ? "Audio added. It's copying to your account." : "Audio added.");
  auBook = null; updateDock();
  if (TAURI && S.cur === id) setTimeout(() => maybeAutoSync(id), 1500);
  if (big && Cloud.signedIn() && !b.audio?.url) askAudioLink(id);
}
// Store one audio file for a book (and queue it for your account if it fits).
async function storeTrack(id, f, name, secs){
  const key = `${id}:a:${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
  await idb.put(key, f); S.haveLocal[key] = true;
  const t = { name, file: f.name, key, asset: null, size: f.size, fp: await fingerprint(f) };
  if (secs) { t.dur = Math.round(secs * 10) / 10; t.durExact = true; setDur(key, secs); }
  if (f.size <= MAX_FILE && Cloud.signedIn()) S.uploads.push({ id, kind: "track", key, name: "audio-" + key.split(":").pop() + "." + extOf(f.name), type: f.type || mimeFor(f.name) });
  return t;
}
const isMp3 = f => /\.mp3$/i.test(f.file || f.name || "") || f.type === "audio/mpeg";
const isM4 = f => /\.(m4b|m4a|mp4|aac)$/i.test(f.file || f.name || "") || /audio\/(mp4|x-m4b|x-m4a|aac)/.test(f.type || "");
const canSplit = f => isMp3(f) || isM4(f);
// Pieces of an MP3 stay MP3; pieces of an M4B are M4A files.
const splitAudio = f => isMp3(f) ? splitMp3(f) : splitM4a(f);
const pieceExt = f => isMp3(f) ? "mp3" : "m4a";
/* Cut an M4B / M4A audiobook into pieces under the upload limit, without re-encoding.
   An M4B is a list of small compressed audio packets plus a table saying where each one is. Each
   piece gets the packets for its stretch of the book and a new table, so the sound is unchanged.
   Chapter markers aren't carried over. */
async function splitM4a(file, target = 45 * 1024 * 1024){
  const rd = async (a, n) => new DataView(await file.slice(a, a + n).arrayBuffer());
  // find the "moov" box (the tables) at the top level of the file
  let pos = 0, moov = null;
  while (pos + 8 <= file.size) {
    const h = await rd(pos, 16); let size = h.getUint32(0); const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7)); let hl = 8;
    if (size === 1) { size = h.getUint32(8) * 2 ** 32 + h.getUint32(12); hl = 16; } else if (size === 0) size = file.size - pos;
    if (size < hl) return null;
    if (type === "moov") { moov = new Uint8Array(await file.slice(pos, pos + size).arrayBuffer()); break; }
    pos += size;
  }
  if (!moov) return null;
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const kids = (a, b) => { const out = []; let p = a; while (p + 8 <= b) { let s = dv.getUint32(p); const t = String.fromCharCode(moov[p + 4], moov[p + 5], moov[p + 6], moov[p + 7]); let hl = 8; if (s === 1) { s = dv.getUint32(p + 8) * 2 ** 32 + dv.getUint32(p + 12); hl = 16; } if (s < hl || p + s > b) break; out.push({ t, a: p, d: p + hl, b: p + s }); p += s; } return out; };
  const find = (list, t) => list.find(x => x.t === t);
  let st = null, ts = 0;
  for (const trak of kids(8, moov.length).filter(x => x.t === "trak")) {
    const mdia = find(kids(trak.d, trak.b), "mdia"); if (!mdia) continue;
    const mk = kids(mdia.d, mdia.b), hdlr = find(mk, "hdlr"), mdhd = find(mk, "mdhd"), minf = find(mk, "minf");
    if (!hdlr || !mdhd || !minf || String.fromCharCode(...moov.subarray(hdlr.d + 8, hdlr.d + 12)) !== "soun") continue;
    ts = moov[mdhd.d] === 1 ? dv.getUint32(mdhd.d + 20) : dv.getUint32(mdhd.d + 12);
    const stbl = find(kids(minf.d, minf.b), "stbl"); if (!stbl) continue;
    st = {}; for (const k of kids(stbl.d, stbl.b)) st[k.t] = k;
    break;
  }
  if (!st || !st.stsd || !st.stts || !st.stsc || !st.stsz || !(st.stco || st.co64) || !ts) return null;
  // sample sizes
  const fixed = dv.getUint32(st.stsz.d + 4), n = dv.getUint32(st.stsz.d + 8);
  const size = new Uint32Array(n); for (let i = 0; i < n; i++) size[i] = fixed || dv.getUint32(st.stsz.d + 12 + 4 * i);
  // sample durations
  const delta = new Uint32Array(n); { let k = 0; const c = dv.getUint32(st.stts.d + 4); for (let e = 0; e < c; e++) { const cnt = dv.getUint32(st.stts.d + 8 + 8 * e), d = dv.getUint32(st.stts.d + 12 + 8 * e); for (let j = 0; j < cnt && k < n; j++) delta[k++] = d; } }
  // where each sample is in the file: walk the chunks
  const co = st.co64 || st.stco, wide = !!st.co64, nc = dv.getUint32(co.d + 4);
  const chunkAt = c => wide ? dv.getUint32(co.d + 8 + 8 * c) * 2 ** 32 + dv.getUint32(co.d + 12 + 8 * c) : dv.getUint32(co.d + 8 + 4 * c);
  const sc = dv.getUint32(st.stsc.d + 4), runs = []; for (let e = 0; e < sc; e++) runs.push([dv.getUint32(st.stsc.d + 8 + 12 * e) - 1, dv.getUint32(st.stsc.d + 12 + 12 * e)]);
  const off = new Float64Array(n); { let s = 0; for (let c = 0, r = 0; c < nc && s < n; c++) { while (r + 1 < runs.length && runs[r + 1][0] <= c) r++; let o = chunkAt(c); for (let j = 0; j < runs[r][1] && s < n; j++) { off[s] = o; o += size[s]; s++; } } }
  const stsd = moov.slice(st.stsd.a, st.stsd.b);
  // pick the pieces
  const cuts = []; { let a = 0, bytes = 0; for (let i = 0; i < n; i++) { if (bytes + size[i] > target && i > a) { cuts.push([a, i]); a = i; bytes = 0; } bytes += size[i]; } cuts.push([a, n]); }
  if (cuts.length < 2) return null;
  // build each piece: ftyp, moov (tables for just these samples), mdat (the samples)
  const u32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255], u16 = v => [(v >>> 8) & 255, v & 255];
  const str = s => [...s].map(c => c.charCodeAt(0));
  const cat = parts => { let L = 0; for (const p of parts) L += p.length; const o = new Uint8Array(L); let q = 0; for (const p of parts) { o.set(p, q); q += p.length; } return o; };
  const box = (t, ...parts) => { const body = cat(parts.map(p => p instanceof Uint8Array ? p : Uint8Array.from(p))); return cat([Uint8Array.from([...u32(body.length + 8), ...str(t)]), body]); };
  const matrix = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
  return cuts.map(([a, b]) => {
    const cnt = b - a; let dur = 0, bytes = 0; for (let i = a; i < b; i++) { dur += delta[i]; bytes += size[i]; }
    const sttsE = []; for (let i = a; i < b;) { let j = i; while (j < b && delta[j] === delta[i]) j++; sttsE.push(...u32(j - i), ...u32(delta[i])); i = j; }
    const szs = new Uint8Array(cnt * 4); const sdv = new DataView(szs.buffer); for (let i = a; i < b; i++) sdv.setUint32((i - a) * 4, size[i]);
    const ftyp = box("ftyp", str("M4A "), u32(0), str("M4A mp42isom"));
    const build = mdatAt => box("moov",
      box("mvhd", u32(0), u32(0), u32(0), u32(ts), u32(dur), u32(0x10000), u16(0x100), new Array(10).fill(0), matrix, new Array(24).fill(0), u32(2)),
      box("trak",
        box("tkhd", u32(7), u32(0), u32(0), u32(1), u32(0), u32(dur), new Array(8).fill(0), u16(0), u16(0), u16(0x100), u16(0), matrix, u32(0), u32(0)),
        box("mdia",
          box("mdhd", u32(0), u32(0), u32(0), u32(ts), u32(dur), u16(0x55c4), u16(0)),
          box("hdlr", u32(0), u32(0), str("soun"), new Array(12).fill(0), str("SoundHandler"), [0]),
          box("minf",
            box("smhd", u32(0), u16(0), u16(0)),
            box("dinf", box("dref", u32(0), u32(1), box("url ", u32(1)))),
            box("stbl", stsd,
              box("stts", u32(0), u32(sttsE.length / 8), sttsE),
              box("stsc", u32(0), u32(1), u32(1), u32(cnt), u32(1)),
              box("stsz", u32(0), u32(0), u32(cnt), szs),
              box("stco", u32(0), u32(1), u32(mdatAt)))))));
    const moovLen = build(0).length, mdatAt = ftyp.length + moovLen + 8;
    // the sample data, as slices of the original file (nothing is copied until it's saved)
    const parts = [ftyp, build(mdatAt), Uint8Array.from([...u32(bytes + 8), ...str("mdat")])];
    for (let i = a; i < b;) { const s0 = off[i]; let e = off[i] + size[i], j = i + 1; while (j < b && off[j] === e) { e += size[j]; j++; } parts.push(file.slice(s0, e)); i = j; }
    return { blob: new Blob(parts, { type: "audio/mp4" }), secs: dur / ts };
  });
}

/* Cut an MP3 into pieces under the upload limit. MP3 is a chain of small independent frames, so the
   cuts fall between frames: nothing is re-encoded, nothing is lost, and it's quick. Each piece's exact
   length comes from counting its frames. */
async function splitMp3(file, target = 45 * 1024 * 1024){
  const BR1 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320], BR2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  const SRS = { 3: [44100,48000,32000], 2: [22050,24000,16000], 0: [11025,12000,8000] };
  const WIN = 4 << 20; let buf = new Uint8Array(0), at0 = 0;
  const need = async (p, n) => { if (p < at0 || p + n > at0 + buf.length) { buf = new Uint8Array(await file.slice(p, p + WIN).arrayBuffer()); at0 = p; } return p + n <= at0 + buf.length; };
  const head = p => {
    const i = p - at0, b1 = buf[i + 1], b2 = buf[i + 2];
    if (buf[i] !== 0xFF || (b1 & 0xE0) !== 0xE0) return null;
    const ver = (b1 >> 3) & 3, layer = (b1 >> 1) & 3; if (ver === 1 || layer !== 1) return null;
    const bri = b2 >> 4, sri = (b2 >> 2) & 3; if (!bri || bri === 15 || sri === 3) return null;
    const sr = SRS[ver][sri], spf = ver === 3 ? 1152 : 576, br = (ver === 3 ? BR1 : BR2)[bri] * 1000;
    return { len: Math.floor(spf / 8 * br / sr) + ((b2 >> 1) & 1), secs: spf / sr };
  };
  let pos = 0;
  await need(0, 10);
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) pos = 10 + (((buf[6] & 127) << 21) | ((buf[7] & 127) << 14) | ((buf[8] & 127) << 7) | (buf[9] & 127)) + (buf[5] & 0x10 ? 10 : 0);
  const out = []; let start = -1, secs = 0, frames = 0, first = true;
  while (await need(pos, 4)) {
    const h = head(pos);
    // Not a frame here (a tag or damage): step forward until frames start again, checking the next one lines up.
    let ok = !!h;
    if (ok && pos + h.len + 4 <= file.size) { const save = pos; if (await need(pos, h.len + 4)) ok = !!head(pos + h.len); await need(save, 4); }
    if (!ok) { pos++; continue; }
    if (pos + h.len > file.size) break;
    if (first) {
      first = false;
      // A "Xing"/"Info" header frame states the whole file's length; leave it out of the pieces.
      await need(pos, Math.min(h.len, 64));
      const txt = String.fromCharCode(...buf.subarray(pos - at0, pos - at0 + Math.min(h.len, 64)));
      if (/Xing|Info|VBRI/.test(txt)) { pos += h.len; continue; }
    }
    if (start < 0) start = pos;
    if (pos + h.len - start > target && pos > start) { out.push({ a: start, b: pos, secs }); start = pos; secs = 0; }
    secs += h.secs; frames++; pos += h.len;
  }
  if (start >= 0 && pos > start) out.push({ a: start, b: pos, secs });
  if (frames < 100) return null;
  return out.map(x => ({ blob: file.slice(x.a, x.b, "audio/mpeg"), secs: x.secs }));
}
// Parts already added that are too big to copy: split them, keeping your place, line-ups and sync timing.
async function splitBigParts(id, quiet){
  const b = S.books[id]; const old = b?.audio?.tracks || []; if (!old.length) return;
  await checkLocal(id);
  const todo = old.map((t, i) => t.size > MAX_FILE && canSplit(t) && S.haveLocal[t.key] ? i : -1).filter(i => i >= 0);
  if (!todo.length) { if (!quiet) toast("No big MP3 or M4B parts on this device to split."); return false; }
  if (auBook && auBook.id === id) { au.pause(); saveAudioPos(true); }
  const tracks = [], map = [], drop = [];
  for (let i = 0; i < old.length; i++) {
    const t = old[i];
    if (!todo.includes(i)) { map.push([[tracks.length, 0, Infinity]]); tracks.push(t); continue; }
    toast(`Splitting ${old.length > 1 ? `part ${i + 1} of ${old.length}` : "the audiobook"} into smaller parts…`, null, 300000);
    const blob = await idb.get(t.key);
    const pieces = blob ? await (isMp3(t) ? splitMp3(blob) : splitM4a(blob)).catch(() => null) : null;
    if (!pieces || pieces.length < 2) { map.push([[tracks.length, 0, Infinity]]); tracks.push(t); continue; }
    const m = []; let at = 0;
    for (let k = 0; k < pieces.length; k++) {
      const pf = new File([pieces[k].blob], `${t.name} (${k + 1} of ${pieces.length}).${pieceExt(t)}`, { type: isMp3(t) ? "audio/mpeg" : "audio/mp4" });
      m.push([tracks.length, at, at + pieces[k].secs]); at += pieces[k].secs;
      tracks.push(await storeTrack(id, pf, `${t.name} (${k + 1} of ${pieces.length})`, pieces[k].secs));
    }
    map.push(m); drop.push(t.key);
  }
  if (!drop.length) { clearToasts(); toast("Couldn't split these files. They may not be standard MP3 or M4B files."); return false; }
  // Move every saved time (your place, line-ups, sync points) to the new part it now falls in.
  const re = (ti, sec) => { const m = map[ti] || map[map.length - 1]; const e = m.find(x => sec < x[2]) || m[m.length - 1]; return [e[0], Math.max(0, sec - e[1])]; };
  const [nt, ns] = re(b.audio.track || 0, b.audio.time || 0);
  const patch = { audio: { tracks, track: nt, time: Math.round(ns) } };
  if (b.follow && b.follow.pts) patch.follow = { ...b.follow, pts: b.follow.pts.map(([ti, t, f]) => { const [a, x] = re(ti, t); return [a, Math.round(x * 10) / 10, f]; }) };
  if (b.sync && b.sync.d) patch.sync = { ...b.sync, parts: tracks.length, d: encodeSync(decodeSync(b.sync).map(([ti, ms, o]) => { const [a, x] = re(ti, ms / 1000); return [a, x * 1000, o]; }), b.sync.u || 100) };
  save(id, patch, { now: true });
  for (const k of drop) { idb.del(k); delete S.haveLocal[k]; }
  if (auBook && auBook.id === id) auBook = null;
  clearToasts();
  if (quiet) { updateDock(); return true; }
  toast(Cloud.signedIn() ? "Split into parts under 50 MB. They're copying to your account, then your phone can download them." : "Split into parts under 50 MB. Turn on sync to copy them to your account and your phone.", null, 8000);
  updateDock();
}
function askAudioLink(id){
  const b = S.books[id];
  linkBox("Where did you get this audiobook?", "Some files are over 50 MB, too big to copy to your account. Paste the page you downloaded them from, and your other devices get a button to download the same files.",
    b.audio?.url, u => { save(id, { audio: { url: u } }); if (u) toast("Download link saved."); updateDock(); });
}
async function checkLocal(id){
  const tracks = S.books[id]?.audio?.tracks || [];
  await Promise.all(tracks.map(async t => { if (S.haveLocal[t.key] === undefined) S.haveLocal[t.key] = !!(await idb.get(t.key)); }));
}
const notHere = id => (S.books[id]?.audio?.tracks || []).filter(t => S.haveLocal[t.key] === false);
async function matchAudio(files, id = S.cur){
  if (!S.books[id]) return;
  toast("Checking the files…", null, 60000);
  const list = await expandZips(files);
  const missing = notHere(id).filter(t => !t.asset); let matched = 0;
  for (const f of list) {
    const fp = await fingerprint(f);
    const t = missing.find(t => !S.haveLocal[t.key] && (t.fp ? t.fp === fp : t.size === f.size && (t.file || "") === f.name));
    if (t) { await idb.put(t.key, f); S.haveLocal[t.key] = true; matched++; }
  }
  const left = notHere(id).filter(t => !t.asset).length;
  clearToasts();
  if (!matched) toast("None of those files are an exact match for this audiobook. Download the same files from the original source.", null, 7000);
  else toast(left ? `Matched ${matched}. ${left} still missing on this device.` : `All ${matched} matched. The whole audiobook is on this device now.`, null, 6000);
  auBook = null; updateDock();
}
async function fetchTrack(t){
  const blob = await Files.down(t.asset);
  await idb.put(t.key, blob); S.haveLocal[t.key] = true; return blob;
}
async function downloadAll(){
  const id = S.cur; const list = notHere(id).filter(t => t.asset);
  if (!list.length) return;
  if (navigator.onLine === false) { toast("Connect to the internet to download the audio."); return; }
  let n = 0;
  for (const t of list) {
    toast(`Downloading part ${++n} of ${list.length}…`, null, 120000);
    try { await fetchTrack(t); } catch (e) { clearToasts(); toast("Download stopped. Check your connection and try again."); updateDock(); return; }
    if (S.cur === id) updateDock();
  }
  clearToasts(); toast("All audio is on this device. It plays offline now.");
}
async function trackSrc(t){
  let blob = await idb.get(t.key);
  if (!blob && t.asset && Cloud.signedIn() && navigator.onLine !== false) { toast("Downloading this part…", null, 60000); try { blob = await fetchTrack(t); } catch { blob = null; } clearToasts(); }
  if (!blob) return null;
  if (auObjURL) URL.revokeObjectURL(auObjURL);
  auObjURL = URL.createObjectURL(blob); return auObjURL;
}
async function loadTrack(i, seek){
  const b = S.books[S.cur]; const t = b?.audio?.tracks?.[i]; if (!t) return false;
  const src = await trackSrc(t);
  if (!src) {
    S.haveLocal[t.key] = false; S.dock = true; S.showTracks = true; updateDock();
    toast(t.asset ? `“${esc(t.name)}” needs a connection to download once.` : `“${esc(t.name)}” isn't on this device. Download the same file, then tap Add matching files.`, null, 7000);
    return false;
  }
  auBook = { id: S.cur, track: i };
  au.src = src; au.defaultPlaybackRate = prefs.get("rate") || 1; au.playbackRate = prefs.get("rate") || 1;
  if (seek) { await new Promise(r => { au.addEventListener("loadedmetadata", r, { once: true }); au.addEventListener("error", r, { once: true }); }); try { au.currentTime = seek; } catch {} }
  setMediaSession();
  return true;
}
function setMediaSession(){
  if (!("mediaSession" in navigator) || !auBook) return;
  const b = S.books[auBook.id], t = b?.audio?.tracks?.[auBook.track]; if (!t) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.name, artist: b.author || "", album: b.title, artwork: b.cover ? [{ src: b.cover, sizes: "200x300", type: "image/jpeg" }] : [] });
    navigator.mediaSession.setActionHandler("play", () => au.play());
    navigator.mediaSession.setActionHandler("pause", () => au.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => skipBy(-skipSec()));
    navigator.mediaSession.setActionHandler("seekforward", () => skipBy(skipSec()));
  } catch {}
  try {
    navigator.mediaSession.setActionHandler("previoustrack", () => goPart(-1));
    navigator.mediaSession.setActionHandler("nexttrack", () => goPart(1));
    navigator.mediaSession.setActionHandler("seekto", d => { if (d && isFinite(d.seekTime)) { au.currentTime = d.seekTime; saveAudioPos(true); updateTimes(); } });
  } catch {}
}
async function togglePlay(){
  stopReadAloud();
  const b = S.books[S.cur]; if (!b?.audio?.tracks?.length) return;
  if (!auBook || auBook.id !== S.cur) { const ok = await loadTrack(b.audio.track || 0, b.audio.time || 0); if (!ok) return; }
  if (au.paused) { try { await au.play(); } catch { toast("This audio file can't be played here."); } } else au.pause();
}
function saveAudioPos(force){
  if (!auBook || !S.books[auBook.id]) return;
  const now = Date.now(); if (!force && now - auSaveAt < 15000) return;
  const b = S.books[auBook.id]; const t = Math.floor(au.currentTime || 0);
  if (b.audio && b.audio.track === auBook.track && Math.abs((b.audio.time || 0) - t) < 3) return;
  auSaveAt = now;
  save(auBook.id, { audio: { track: auBook.track, time: t } });
}
au.addEventListener("timeupdate", () => { saveAudioPos(false); updateTimes(); followTick(false); });
au.addEventListener("loadedmetadata", () => { updateTimes(); const b = auBook && S.books[auBook.id], t = b && b.audio.tracks[auBook.track]; if (t) setDur(t.key, au.duration); });
au.addEventListener("seeked", () => { if (S.followHold) { S.followHold = false; updateFollowPill(); } followTick(true); });
au.addEventListener("play", () => { if (S.followHold) { S.followHold = false; updateFollowPill(); } updateDock(); followTick(true); capSend(); });
au.addEventListener("pause", () => { saveAudioPos(true); updateDock(); followStopCap(); updateFollowPill(); capSend(); });
au.addEventListener("ended", async () => {
  const b = auBook && S.books[auBook.id]; if (!b) return;
  const nxt = auBook.track + 1;
  if (nxt < b.audio.tracks.length) { if (await loadTrack(nxt, 0)) { save(auBook.id, { audio: { track: nxt, time: 0 } }); au.play().catch(() => {}); } }
  updateDock();
});

/* ---------- read aloud: the device's built-in voice, works offline ----------
   Reads sentence by sentence so you can pause, skip a sentence, drag to any sentence,
   and change speed, volume or voice while it reads. */
const synth = window.speechSynthesis;
const TTS = { run: 0, idx: 0, jump: null, paused: false, count: 0 };
const SENT_RE = /[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g;
const ttsRate = () => prefs.get("ttsRate") || 1;
const ttsVolume = () => prefs.get("ttsVol") ?? 1;
function pageText(){
  const c = S.content[S.cur]; if (!c) return Promise.resolve("");
  if (c.kind === "text") return Promise.resolve(c.pages[S.page - 1].map(b => b[1]).join("\n\n"));
  return c.pdf.getPage(S.page).then(p => p.getTextContent()).then(tc => tc.items.map(i => i.str).join(" ").replace(/\s+/g, " ").trim());
}
function ttsVoice(){
  const want = prefs.get("ttsVoice"); if (!want || !synth) return null;
  return synth.getVoices().find(v => v.voiceURI === want) || null;
}
function makeUtterance(text){
  const u = new SpeechSynthesisUtterance(text);
  u.rate = ttsRate(); u.volume = IOS ? 1 : ttsVolume();
  const v = ttsVoice(); if (v) { u.voice = v; u.lang = v.lang; }
  return u;
}
function clearHighlight(el){
  if (!el) return;
  el.classList.remove("hl", "soft");
  if (el.dataset.w) { el.textContent = el.dataset.t; delete el.dataset.w; }
}
function clearHighlights(){ document.querySelectorAll(".page [data-s]").forEach(clearHighlight); }
async function ttsItems(){
  const spans = [...document.querySelectorAll(".page [data-s]")].filter(s => s.textContent.trim());
  if (spans.length) return spans.map(el => ({ text: el.textContent, el }));
  // PDFs: read the page's text sentence by sentence, without highlighting.
  const t = await pageText();
  return (t.match(SENT_RE) || []).map(s => s.trim()).filter(Boolean).map(text => ({ text, el: null }));
}
function ttsSpeakPage(run, items){
  TTS.count = items.length;
  return new Promise(resolve => {
    const mode = prefs.get("hl") || "sentence";
    let prev = null;
    const next = () => {
      if (prev) clearHighlight(prev.el);
      if (run !== TTS.run) return resolve("stopped");
      if (TTS.idx >= items.length) return resolve("done");
      const it = items[TTS.idx]; prev = it;
      const text = it.text, el = it.el;
      if (el) el.dataset.t = text;
      updateTtsUI();
      if (el && mode !== "off") {
        el.classList.add("hl"); if (mode === "word") el.classList.add("soft");
        el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
      const lead = text.length - text.trimStart().length;
      capNow.speaking = true; capNow.text = text.trim(); capNow.book = S.cur; capNow.page = S.page; capNow.word = null; capNow.ttsEl = el; capNow.lead = lead; capSend();
      const u = makeUtterance(text.trim());
      let finished = false;
      const after = advance => {
        if (finished) return; finished = true;
        if (TTS.jump !== null) { TTS.idx = TTS.jump; TTS.jump = null; }
        else if (advance) TTS.idx++;
        next();
      };
      u.onboundary = ev => {
        if (ev.name && ev.name !== "word") return;
        const start = ev.charIndex + lead;
        let len = ev.charLength || 0;
        if (!len) { const m = text.slice(start).match(/^[^\s]+/); len = m ? m[0].length : 0; }
        if (!len) return;
        capNow.word = [ev.charIndex, len]; capSend();
        if (mode !== "word" || !el) return;
        el.dataset.w = "1";
        el.innerHTML = esc(text.slice(0, start)) + `<mark class="w">${esc(text.slice(start, start + len))}</mark>` + esc(text.slice(start + len));
      };
      u.onend = () => after(true);
      u.onerror = e => {
        if (e.error === "interrupted" || e.error === "canceled") {
          if (TTS.jump !== null) after(false);
          else { finished = true; clearHighlight(el); resolve("stopped"); }
        } else after(true);
      };
      synth.speak(u);
    };
    next();
  });
}
async function ttsStart(fromIdx = 0){
  if (!synth) { toast("This device has no built-in voice for reading aloud."); return; }
  if (!au.paused) au.pause();
  try { synth.cancel(); } catch {}
  const run = ++TTS.run;
  S.reading = true; TTS.paused = false; TTS.idx = Math.max(0, fromIdx); TTS.jump = null;
  updateDock();
  while (run === TTS.run && S.view === "reader") {
    const items = await ttsItems();
    if (!items.length) { if (S.page >= total()) break; TTS.idx = 0; await goto(S.page + 1, false, true); continue; }
    const r = await ttsSpeakPage(run, items);
    if (r !== "done" || run !== TTS.run) break;
    if (S.page >= total()) break;
    TTS.idx = 0; await goto(S.page + 1, false, true);
  }
  if (run === TTS.run) { S.reading = false; TTS.paused = false; clearHighlights(); capNow.speaking = false; capSend(); updateDock(); }
}
function stopReadAloud(){
  if (!S.reading) return;
  TTS.run++; S.reading = false; TTS.paused = false;
  try { synth.cancel(); } catch {}
  clearHighlights(); capNow.speaking = false; capSend(); updateDock();
}
function readAloud(){ if (S.reading) stopReadAloud(); else ttsStart(TTS.idx || 0); }
function ttsPlayPause(){
  if (!S.reading) { ttsStart(TTS.idx || 0); return; }
  try { if (TTS.paused) { synth.resume(); TTS.paused = false; } else { synth.pause(); TTS.paused = true; } } catch {}
  updateTtsUI();
}
function ttsJumpTo(i){
  const n = TTS.count || document.querySelectorAll(".page [data-s]").length;
  if (i < 0) { if (S.page > 1) ttsGotoPage(-1); return; }
  if (n && i >= n) { if (S.page < total()) ttsGotoPage(1); return; }
  if (!S.reading) { ttsStart(i); return; }
  if (TTS.paused) { try { synth.resume(); } catch {} TTS.paused = false; }
  TTS.jump = i; try { synth.cancel(); } catch {}
  // Some voices don't report the interruption; restart from the chosen sentence if nothing happens.
  setTimeout(() => { if (TTS.jump === i) { TTS.jump = null; ttsStart(i); } }, 700);
}
async function ttsGotoPage(delta){
  const was = S.reading && !TTS.paused;
  stopReadAloud(); TTS.idx = 0;
  await goto(S.page + delta, false, true);
  if (was) ttsStart(0); else updateDock();
}
function ttsRestartSentence(){ if (S.reading && !TTS.paused) ttsJumpTo(TTS.idx); }
function updateTtsUI(){
  const s = $("#ttsSeek"); const n = TTS.count || document.querySelectorAll(".page [data-s]").length || 1;
  if (s && !S.scrubbing) { s.max = Math.max(0, n - 1); s.value = Math.min(TTS.idx, n - 1); paintRange(s); }
  const pos = $("#ttsPos"); if (pos) pos.textContent = `Sentence ${Math.min(TTS.idx + 1, n)} of ${n}`;
  const pg = $("#ttsPage"); if (pg) pg.textContent = `Page ${S.page} of ${total()}`;
  const pb = $("#ttsPlay");
  if (pb) { const on = S.reading && !TTS.paused; pb.innerHTML = on ? ICON.pause : ICON.play; pb.setAttribute("aria-label", on ? "Pause reading" : "Read aloud"); }
}

/* ---------- player (Libby-style: scrubber, skip, speed, volume) for audiobooks and Read aloud ---------- */
Object.assign(ICON, {
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
  downChev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  prev:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  nextp:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  sback:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 6v12L2.5 12zM21 6v12l-8.5-6z"/></svg>',
  sfwd:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 6v12l8.5-6zM3 6v12l8.5-6z"/></svg>',
  vol:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg>',
  mute:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"/></svg>',
  pop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="11" y="11" width="9" height="7" rx="1" fill="currentColor" stroke="none"/></svg>'
});
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIPS = [10, 15, 30, 60];
const skipSec = () => prefs.get("skip") || 15;
const curRate = () => prefs.get("rate") || 1;
const rateTxt = r => (+(+r).toFixed(2)) + "×";
const curTi = b => auBook && auBook.id === S.cur ? auBook.track : ((b && b.audio && b.audio.track) || 0);
try { au.preservesPitch = true; au.webkitPreservesPitch = true; } catch {}
const playerMode = () => S.playerMode || ((((S.books[S.cur] || {}).audio || {}).tracks || []).length ? "book" : "tts");

function setRate(r){
  r = Math.min(3, Math.max(0.5, Math.round(r * 20) / 20));
  prefs.set("rate", r); au.defaultPlaybackRate = r; au.playbackRate = r;
  paintRates(r); updateTimes();
}
function setTtsRate(r){
  r = Math.min(2.5, Math.max(0.5, Math.round(r * 20) / 20));
  prefs.set("ttsRate", r); paintRates(r); ttsRestartSentence();
}
function paintRates(r){
  document.querySelectorAll("[data-rate-label]").forEach(x => { x.textContent = rateTxt(r); });
  document.querySelectorAll("[data-rate]").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.rate === r)));
}
async function ensureLoaded(){
  const b = S.books[S.cur]; if (!b || !(b.audio && b.audio.tracks && b.audio.tracks.length)) return false;
  if (auBook && auBook.id === S.cur) return true;
  return loadTrack(curTi(b), b.audio.time || 0);
}
async function skipBy(sec){
  if (!(await ensureLoaded())) return;
  const end = isFinite(au.duration) ? au.duration - 0.5 : Infinity;
  au.currentTime = Math.max(0, Math.min(end, au.currentTime + sec));
  saveAudioPos(true); updateTimes();
}
async function goPart(delta){
  const b = S.books[S.cur]; if (!b) return; const tracks = b.audio.tracks || [];
  if (delta < 0 && auBook && auBook.id === S.cur && au.currentTime > 5) { au.currentTime = 0; saveAudioPos(true); updateTimes(); return; }
  const n = curTi(b) + delta; if (n < 0 || n >= tracks.length) return;
  const was = !au.paused;
  if (await loadTrack(n, 0)) { save(S.cur, { audio: { track: n, time: 0 } }); if (was) au.play().catch(() => {}); }
  updateDock();
}
function paintRange(s){ const max = +s.max || 0; s.style.setProperty("--p", (max > 0 ? Math.min(100, (+s.value / max) * 100) : 0) + "%"); }
function updateTimes(){
  if (S.scrubbing) return;
  const b = S.books[S.cur]; if (!b) return;
  const own = auBook && auBook.id === S.cur;
  const cur = own ? au.currentTime : ((b.audio && b.audio.time) || 0);
  const dur = own ? au.duration : NaN;
  const s = $("#auSeek");
  if (s) { s.max = isFinite(dur) ? Math.floor(dur) : Math.max(1, Math.ceil(cur)); s.value = Math.floor(cur); paintRange(s); }
  const c = $("#auCur"); if (c) c.textContent = fmt(cur);
  const l = $("#auLeft"); if (l) l.textContent = isFinite(dur) ? "-" + fmt(Math.max(0, dur - cur)) : "–:––";
  const sp = $("#auLeftSpeed");
  if (sp) sp.textContent = isFinite(dur) && curRate() !== 1 ? `${fmt(Math.max(0, dur - cur) / curRate())} left at ${rateTxt(curRate())}` : "";
}

/* Volume: the audio element on PC; the phone's own media volume on iPhone (iOS ignores page volume).
   Read aloud keeps its own volume on PC. */
let vol = IOS ? null : (prefs.get("vol") ?? 1), lastVol = 0.7;
if (!IOS) au.volume = vol;
window.pkVolume = v => { vol = +v; paintVol(); };
const shownVol = () => IOS ? vol : (playerMode() === "tts" ? ttsVolume() : vol);
function paintVol(){
  const v = shownVol();
  const s = $("#auVol");
  if (s && v != null && !s.matches(":active")) { s.value = v; paintRange(s); }
  const m = $("#auMute"); if (m) { m.innerHTML = v === 0 ? ICON.mute : ICON.vol; m.setAttribute("aria-label", v === 0 ? "Unmute" : "Mute"); }
}
function setVol(v){
  v = Math.min(1, Math.max(0, v));
  if (IOS) { vol = v; Native.call({ op: "volume", value: v }).catch(() => {}); }
  else if (playerMode() === "tts") { prefs.set("ttsVol", v); clearTimeout(setVol.t); setVol.t = setTimeout(ttsRestartSentence, 250); }
  else { vol = v; au.volume = v; prefs.set("vol", v); }
  paintVol();
}

/* ---------- Wi-Fi transfer (PC → iPhone) ----------
   The Windows app shares a book's audio files on your home network (see share.rs); the iPhone app
   downloads them straight from the PC. No account storage, no size limit. Every request needs the
   6-digit code shown on the PC. */
const WIFI = { info: null, busy: false };
const shareName = t => t.key.replace(/[^A-Za-z0-9_-]/g, "_") + "." + (extOf(t.file || t.name || "") || "mp3");
const shareList = () => { try { return JSON.parse(localStorage.getItem("pk-share") || '{"books":{}}'); } catch { return { books: {} }; } };
function wifiRow(b){
  const tracks = b?.audio?.tracks || [];
  if (TAURI) {
    if (!tracks.length) return "";
    const shared = !!(WIFI.info && shareList().books[S.cur]);
    const how = shared ? `Ready. On your iPhone, open this book's player and tap <b>Get from PC</b>. If it asks, type <b>${esc(WIFI.info.ip)}:${WIFI.info.port}</b> and code <b>${esc(WIFI.info.code)}</b>.` : "Copies the audio straight to Pagekeeper on your iPhone over your home Wi-Fi. No account storage, no size limit.";
    return `<div class="pl-row"><label>iPhone</label>${WIFI.busy ? "" : `<button class="btn ${shared ? "" : "primary"}" id="wifiShare">${shared ? "Share again" : "Send to iPhone over Wi-Fi"}</button>`}${WIFI.info && !WIFI.busy ? `<button class="btn ghost" id="wifiStop">Stop sharing</button>` : ""}<span class="note">${WIFI.busy ? "Getting the files ready…" : how}</span></div>`;
  }
  if (!IOS) return "";
  const missing = !tracks.length || tracks.some(t => !S.haveLocal[t.key]);
  if (!missing && !prefs.get("pcAddr")) return "";
  return `<div class="pl-row"><label>From PC</label>${missing ? `<button class="btn primary" id="wifiGet">Get ${tracks.length ? "audio" : "the audiobook"} from PC</button>` : ""}${prefs.get("pcAddr") ? `<button class="btn ghost" id="wifiChange">Change PC</button>` : ""}<span class="note">Over your home Wi-Fi, from Pagekeeper on your PC. On the PC, open this book's player and tap <b>Send to iPhone over Wi-Fi</b> first.</span></div>`;
}
async function shareToPhone(id){
  if (!TAURI || WIFI.busy) return;
  await checkLocal(id);
  if (!(S.books[id]?.audio?.tracks || []).some(t => S.haveLocal[t.key])) { toast("This book's audio isn't on this PC."); return; }
  WIFI.busy = true; updateDock();
  try {
    // Big files are cut into parts first: an iPhone can't take in a file of a gigabyte or more in one go.
    if ((S.books[id].audio.tracks || []).some(t => t.size > MAX_FILE && canSplit(t) && S.haveLocal[t.key])) await splitBigParts(id, true);
    const b = S.books[id], tracks = b?.audio?.tracks || [];
    await checkLocal(id);
    const here = tracks.filter(t => S.haveLocal[t.key]);
    WIFI.info = await tauriInvoke("pk_share_start"); prefs.set("wifiOn", true);
    for (let i = 0; i < here.length; i++) {
      const t = here[i], name = shareName(t), blob = await idb.get(t.key); if (!blob) continue;
      if (await tauriInvoke("pk_share_has", { name, size: blob.size })) continue;   // already shared
      toast(`Getting part ${i + 1} of ${here.length} ready for your iPhone…`, null, 120000);
      await tauriInvoke("pk_share_begin", { name });
      const STEP = 8 << 20;
      for (let o = 0; o < blob.size; o += STEP) await tauriInvoke("pk_share_chunk", new Uint8Array(await blob.slice(o, o + STEP).arrayBuffer()), { headers: { "x-file": name } });
    }
    const list = shareList();
    list.books[id] = { title: b.title || "", author: b.author || "", tracks: tracks.map(t => ({ key: t.key, name: t.name, file: t.file || "", size: t.size || 0, dur: t.dur || durCache[t.key] || 0, f: S.haveLocal[t.key] ? shareName(t) : null })) };
    localStorage.setItem("pk-share", JSON.stringify(list));
    await tauriInvoke("pk_share_list", { json: JSON.stringify(list) });
    clearToasts();
    toast(`Ready. On your iPhone, open this book and tap <b>Get from PC</b>. Address ${esc(WIFI.info.ip)}:${WIFI.info.port}, code ${esc(WIFI.info.code)}. If Windows asks about the firewall, allow private networks.`, null, 15000);
  } catch (e) { clearToasts(); toast("Couldn't share over Wi-Fi: " + esc(String((e && e.message) || e)), null, 9000); }
  finally { WIFI.busy = false; updateDock(); }
}
async function stopSharing(){
  try { await tauriInvoke("pk_share_stop"); } catch {}
  WIFI.info = null; prefs.set("wifiOn", false); localStorage.removeItem("pk-share");
  toast("Stopped sharing. The shared copies on this PC were removed.");
  updateDock();
}
function askPC(addr, code){
  return new Promise(done => {
    const m = document.createElement("div"); m.className = "modal-back";
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>Connect to your PC</h3>
      <p>On your PC, open this book in Pagekeeper, open the player, and tap <b>Send to iPhone over Wi-Fi</b>. Then type what it shows. Both need to be on the same Wi-Fi.</p>
      <input id="pcAddr" inputmode="decimal" autocapitalize="off" autocorrect="off" placeholder="Address, like 192.168.1.20:47811" value="${esc(addr || "")}" aria-label="PC address">
      <input id="pcCode" inputmode="numeric" maxlength="6" placeholder="6-digit code" value="${esc(code || "")}" aria-label="Code" style="margin-top:8px">
      <p class="err" id="pcErr" hidden>Type the address (numbers and dots, then : and the port) and the 6-digit code.</p>
      <div class="row"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Connect</button></div></div>`;
    m.addEventListener("click", e => {
      if (e.target === m || e.target.closest("[data-x]")) { m.remove(); done(null); }
      if (e.target.closest("[data-ok]")) {
        let a = $("#pcAddr", m).value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, ""); const c = $("#pcCode", m).value.replace(/\D/g, "");
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) a += ":47811";
        if (!/^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(a) || c.length !== 6) { $("#pcErr", m).hidden = false; return; }
        m.remove(); done([a, c]);
      }
    });
    document.body.append(m); $("#pcAddr", m).focus();
  });
}
async function getFromPC(id, ask){
  if (!Native.ok || WIFI.busy) return;
  let addr = prefs.get("pcAddr"), code = prefs.get("pcCode");
  if (ask || !addr || !code) { const r = await askPC(addr, code); if (!r) return; [addr, code] = r; }
  const base = `http://${addr}`;
  WIFI.busy = true;
  try {
    toast("Connecting to your PC…", null, 30000);
    let list;
    try {
      const r = await Native.text(`${base}/pk/list?c=${code}`);
      if (r.status === 403) throw new Error("That code didn't work. Check the 6-digit code shown on your PC.");
      list = JSON.parse(r.text);
    } catch (e) {
      const msg = /code|403/.test(String(e && e.message)) ? "That code didn't work. Check the 6-digit code shown on your PC." : "Couldn't reach your PC. Check that Pagekeeper is open there with sharing on, and that both are on the same Wi-Fi. If iPhone asked about finding devices on your network, allow it and try again.";
      throw Object.assign(new Error(msg), { again: true });
    }
    prefs.set("pcAddr", addr); prefs.set("pcCode", code);
    const b = S.books[id];
    const entry = list.books[id] || Object.values(list.books).find(x => x.title && x.title === b.title);
    if (!entry) throw new Error("Your PC isn't sharing this book yet. On the PC, open it, open the player, and tap Send to iPhone over Wi-Fi.");
    let tracks = b.audio?.tracks || [];
    if (!tracks.length) {
      tracks = entry.tracks.map(t => ({ name: t.name, file: t.file, key: t.key, asset: null, size: t.size, ...(t.dur ? { dur: t.dur } : {}) }));
      save(id, { audio: { tracks, track: 0, time: 0 } }, { now: true });
    }
    await checkLocal(id);
    const src = t => entry.tracks.find(x => x.key === t.key) || entry.tracks.find(x => x.name === t.name && x.size === t.size);
    const huge = tracks.filter(t => !S.haveLocal[t.key] && src(t) && src(t).f && (src(t).size || 0) > 400 * 1024 * 1024);
    if (huge.length) throw new Error("A part on your PC is too big for the iPhone to take in one go. On the PC, open the player and tap Send to iPhone over Wi-Fi again: it splits big files into smaller parts first.");
    const todo = tracks.filter(t => !S.haveLocal[t.key] && src(t) && src(t).f);
    if (!todo.length) { clearToasts(); toast(tracks.every(t => S.haveLocal[t.key]) ? "All the audio is already on this iPhone." : "Your PC doesn't have the missing parts either."); return; }
    for (let i = 0; i < todo.length; i++) {
      const t = todo[i]; let last = -1;
      const show = f => { const p = Math.floor(f * 20) * 5; if (p !== last) { last = p; toast(`Getting part ${i + 1} of ${todo.length} from your PC… ${p}%`, null, 120000); } };
      show(0);
      const file = await Native.file(`${base}/pk/f/${src(t).f}?c=${code}`, show);
      await idb.put(t.key, file); S.haveLocal[t.key] = true;
      if (S.cur === id) updateDock();
    }
    clearToasts(); toast("Done. The audiobook is on this iPhone and plays offline.", null, 7000);
  } catch (e) {
    clearToasts();
    toast(esc(String((e && e.message) || e)) + (e && e.again ? "" : " Parts already done are kept."), e && e.again ? { label: "Change PC", fn: () => getFromPC(id, true) } : { label: "Try again", fn: () => getFromPC(id) }, 15000);
  } finally { WIFI.busy = false; if (S.cur === id) updateDock(); }
}
function bigRow(b){
  const big = (b.audio?.tracks || []).filter(t => t.size > MAX_FILE);
  if (!big.length) return "";
  const can = big.filter(t => canSplit(t) && S.haveLocal[t.key]).length;
  return `<div class="pl-row"><label>Phone</label>${can ? `<button class="btn primary" id="auSplit">Split big parts</button>` : ""}<span class="note">${big.length} part${big.length > 1 ? "s are" : " is"} over 50 MB, too big to copy to your account or phone. ${can ? `Splitting cuts ${big.length > 1 ? "them" : "it"} into smaller parts without changing the sound. Your place and line-ups are kept.` : "Open this book on your PC (or the device that has the files) to split them, or send them over Wi-Fi from the PC."}</span></div>`;
}
function updateDock(){
  const el = $("#dock"); if (!el) return;
  if (!S.dock) { el.innerHTML = ""; return; }
  const b = S.books[S.cur]; const tracks = (b.audio && b.audio.tracks) || [];
  const mode = playerMode(), big = !!S.bigPlayer;
  const modeSwitch = `<div class="seg pl-mode" role="group" aria-label="What to play">
      <button data-pmode="book" aria-pressed="${mode === "book"}">Audiobook${tracks.length ? "" : " (none yet)"}</button>
      <button data-pmode="tts" aria-pressed="${mode === "tts"}">Read aloud</button></div>`;
  const head = big ? `<div class="pl-head"><button class="ib" id="auExpand" aria-label="Make the player smaller">${ICON.downChev}</button>${modeSwitch}<span class="pl-spacer"></span></div>` : "";
  const expandBtn = big ? "" : `<button class="ib" id="auExpand" aria-label="Open the full player">${ICON.up}</button>`;
  const speedRow = (r, label) => `<div class="pl-row"><label>Speed</label>
      <div class="ratebox"><button class="ib" id="auSlower" aria-label="Slower">−</button><b data-rate-label>${rateTxt(r)}</b><button class="ib" id="auFaster" aria-label="Faster">+</button></div>
      <div class="chips">${SPEEDS.map(x => `<button class="chip" data-rate="${x}" aria-pressed="${x === r}">${rateTxt(x)}</button>`).join("")}</div>${label ? `<span class="note">${label}</span>` : ""}</div>`;
  const volRow = `<div class="pl-row"><label>Volume</label><button class="ib" id="auMute" aria-label="Mute">${ICON.vol}</button>
      <input type="range" class="scrub vol" id="auVol" min="0" max="1" step="0.01" value="${shownVol() == null ? 1 : shownVol()}" aria-label="Volume"></div>`;
  const popRow = `<div class="pl-row"><label>Pop-out</label><button class="btn" id="plPop">${prefs.get("capOn") ? "Hide pop-out text" : "Show pop-out text"}</button>${prefs.get("capOn") && prefs.get("capLock") ? `<button class="btn primary" id="plUnlock">Unlock pop-out</button>` : ""}<span class="note">Right-click it for more. Colors and style under Aa.</span></div>`;

  if (mode === "tts") {
    const n = TTS.count || document.querySelectorAll(".page [data-s]").length || 1;
    const on = S.reading && !TTS.paused;
    const hlMode = prefs.get("hl") || "sentence";
    const voices = synth ? synth.getVoices() : [];
    const want = prefs.get("ttsVoice") || "";
    const voiceName = (ttsVoice() || {}).name || "Device voice";
    const r = ttsRate();
    const scrub = `<input type="range" class="scrub" id="ttsSeek" min="0" max="${Math.max(0, n - 1)}" step="1" value="${Math.min(TTS.idx, n - 1)}" aria-label="Sentence on this page">
      <div class="pl-time"><span id="ttsPos">Sentence ${Math.min(TTS.idx + 1, n)} of ${n}</span><span id="ttsPage">Page ${S.page} of ${total()}</span></div>`;
    const ctrls = `<button class="ib skipbtn" id="ttsBack" aria-label="Previous sentence">${ICON.sback}</button>
      <button class="play" id="ttsPlay" aria-label="${on ? "Pause reading" : "Read aloud"}">${on ? ICON.pause : ICON.play}</button>
      <button class="ib skipbtn" id="ttsFwd" aria-label="Next sentence">${ICON.sfwd}</button>`;
    if (!synth) {
      el.innerHTML = `<div class="dock${big ? " big" : ""}">${head}<p class="note">This device has no built-in voice for reading aloud.</p></div>`;
    } else if (!big) {
      el.innerHTML = `<div class="dock"><div class="row1">${ctrls}
          <div class="trk"><b>Read aloud</b><span>${esc(voiceName)}</span></div>
          <button class="chip" id="auRateBtn" aria-label="Reading speed, tap to change"><span data-rate-label>${rateTxt(r)}</span></button>${expandBtn}
        </div>${scrub}</div>`;
    } else {
      el.innerHTML = `<div class="dock big">${head}
        <div class="pl-top">${coverHTML(b).replace('class="cover"', 'class="cover pl-cover"')}
          <div class="trk"><b>Read aloud · ${esc(voiceName)}</b><span>${esc(b.title)}</span></div></div>
        ${scrub}
        <div class="pl-ctrls"><button class="ib" id="ttsPrevPage" aria-label="Previous page" ${S.page > 1 ? "" : "disabled"}>${ICON.prev}</button>${ctrls}
          <button class="ib" id="ttsNextPage" aria-label="Next page" ${S.page < total() ? "" : "disabled"}>${ICON.nextp}</button></div>
        ${speedRow(r)}
        ${volRow}
        <div class="pl-row"><label>Voice</label><select id="ttsVoiceSel" aria-label="Voice"><option value="">Device default</option>${voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === want ? "selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("")}</select></div>
        <div class="pl-row"><label>Highlight</label><div class="chips">${[["sentence","Sentence"],["word","Word"],["off","Off"]].map(([k, l]) => `<button class="chip" data-hl="${k}" aria-pressed="${hlMode === k}">${l}</button>`).join("")}</div></div>
        ${sleepRow()}
        ${wifiRow(b)}
        ${popRow}
      </div>`;
    }
    if (synth) {
      $("#ttsPlay").onclick = ttsPlayPause;
      $("#ttsBack").onclick = () => ttsJumpTo(TTS.idx - 1);
      $("#ttsFwd").onclick = () => ttsJumpTo(TTS.idx + 1);
      const pp = $("#ttsPrevPage"); if (pp) pp.onclick = () => ttsGotoPage(-1);
      const np = $("#ttsNextPage"); if (np) np.onclick = () => ttsGotoPage(1);
      const seek = $("#ttsSeek");
      seek.oninput = () => { S.scrubbing = true; paintRange(seek); $("#ttsPos").textContent = `Sentence ${+seek.value + 1} of ${n}`; };
      seek.onchange = () => { S.scrubbing = false; ttsJumpTo(+seek.value); };
      paintRange(seek);
      const rb = $("#auRateBtn"); if (rb) rb.onclick = () => { const i = SPEEDS.indexOf(ttsRate()); setTtsRate(SPEEDS[(i + 1) % SPEEDS.length]); };
      const sl = $("#auSlower"); if (sl) sl.onclick = () => setTtsRate(ttsRate() - 0.05);
      const fa = $("#auFaster"); if (fa) fa.onclick = () => setTtsRate(ttsRate() + 0.05);
      el.querySelectorAll("[data-rate]").forEach(x => x.onclick = () => setTtsRate(+x.dataset.rate));
      const vs = $("#ttsVoiceSel"); if (vs) vs.onchange = () => { prefs.set("ttsVoice", vs.value || undefined); ttsRestartSentence(); updateDock(); };
      el.querySelectorAll("[data-hl]").forEach(x => x.onclick = () => { prefs.set("hl", x.dataset.hl); if (x.dataset.hl === "off") clearHighlights(); updateDock(); ttsRestartSentence(); });
      if (synth && !voices.length && !updateDock.waitingVoices) { updateDock.waitingVoices = true; synth.addEventListener("voiceschanged", () => { if (S.dock && playerMode() === "tts") updateDock(); }, { once: true }); }
    }
  } else if (!tracks.length) {
    el.innerHTML = `<div class="dock${big ? " big" : ""}">${head}
      <div class="row1" style="flex-wrap:wrap;gap:10px">
        <div class="trk" style="min-width:200px"><b>No audiobook for this book yet</b><span>Add MP3, M4A or M4B files or a LibriVox zip, or find a free one in Discover. Read aloud works right now.</span></div>
        <button class="btn primary" id="auAdd">${ICON.plus} Add audio</button><button class="btn" id="goDisc">Find in Discover</button>${big ? "" : expandBtn}</div></div>`;
    const gd = $("#goDisc"); if (gd) gd.onclick = () => { closeReader(); S.view = "find"; S.disc = null; render(); setTimeout(() => openRepo("librivox"), 0); };
  } else {
    if (tracks.some(x => S.haveLocal[x.key] === undefined)) checkLocal(S.cur).then(() => S.dock && updateDock());
    const own = auBook && auBook.id === S.cur, playing = own && !au.paused;
    const ti = curTi(b); const t = tracks[ti] || tracks[0];
    const rate = curRate(), sk = skipSec();
    if (!own && S.haveLocal[t.key] && (au.paused || !auBook) && !S.preloading) {
      S.preloading = true;
      loadTrack(ti, (b.audio && b.audio.time) || 0).finally(() => { S.preloading = false; updateTimes(); });
    }
    const away = notHere(S.cur);
    const cloudOnly = away.filter(x => x.asset), gone = away.filter(x => !x.asset);
    const aurl = b.audio && b.audio.url;
    let note = "";
    if (gone.length) note += `<div class="missbox"><span><b>${gone.length} of ${tracks.length} part${tracks.length > 1 ? "s" : ""} aren't on this device</b> (${esc(fmtSize(gone.reduce((n, x) => n + (x.size || 0), 0)))}). Download the exact same files, then add them here. Your listening spot is kept.</span>
        <span style="color:var(--pmuted);word-break:break-all">${gone.slice(0, 4).map(x => esc(x.file || x.name) + " · " + esc(fmtSize(x.size))).join("<br>")}${gone.length > 4 ? `<br>…and ${gone.length - 4} more` : ""}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${aurl ? `<a class="btn primary" href="${esc(aurl)}" target="_blank" rel="noopener" data-await-audio>1. Download the same files${Native.ok ? "" : " ↗"}</a>` : `<button class="btn" id="auLink">Add download link</button>`}
          <button class="btn ${aurl ? "" : "primary"}" id="auMatch">${aurl ? "2. " : ""}Add matching files</button></div></div>`;
    if (cloudOnly.length) note += `<div class="missbox"><span>${cloudOnly.length} part${cloudOnly.length > 1 ? "s are" : " is"} in your account but not downloaded here (${esc(fmtSize(cloudOnly.reduce((n, x) => n + (x.size || 0), 0)))}).</span>
        <div><button class="btn" id="auDl">${ICON.down} Download for offline</button></div></div>`;
    const scrub = `<input type="range" class="scrub" id="auSeek" min="0" max="1" step="1" value="0" aria-label="Position in this part">
      <div class="pl-time"><span id="auCur">0:00</span><span id="auLeftSpeed"></span><span id="auLeft">–:––</span></div>`;
    const skipBtn = dir => `<button class="ib skipbtn" id="${dir < 0 ? "auBack" : "auFwd"}" aria-label="${dir < 0 ? "Back" : "Forward"} ${sk} seconds">${dir < 0 ? ICON.rw : ICON.ff}<span>${sk}</span></button>`;
    const playBtn = `<button class="play" id="auPlay" aria-label="${playing ? "Pause" : "Play"}">${playing ? ICON.pause : ICON.play}</button>`;
    if (!big) {
      el.innerHTML = `<div class="dock">${note}
        <div class="row1">${skipBtn(-1)}${playBtn}${skipBtn(1)}
          <div class="trk"><b>${esc(t.name)}</b><span>${tracks.length > 1 ? `Part ${ti + 1} of ${tracks.length}` : esc(b.title)}</span></div>
          <button class="chip" id="auRateBtn" aria-label="Playback speed, tap to change"><span data-rate-label>${rateTxt(rate)}</span></button>${expandBtn}
        </div>${scrub}</div>`;
    } else {
      const list = S.showTracks ? `<ul class="tracks">${tracks.map((x, i) => `<li><button data-t="${i}" class="${i === ti ? "cur" : ""}"><span>${i + 1}. ${esc(x.name)}</span><span class="where">${S.haveLocal[x.key] ? "on this device" : x.asset ? "in your account" : S.haveLocal[x.key] === false ? "not on this device" : ""}</span></button></li>`).join("")}</ul>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" id="auAdd">${ICON.plus} Add more</button>${aurl || tracks.some(x => x.size > MAX_FILE) ? `<button class="btn" id="auLink2">${aurl ? "Change" : "Add"} download link</button>` : ""}<button class="btn danger" id="auClear">Remove audio</button></div>` : "";
      el.innerHTML = `<div class="dock big">${head}${note}
        <div class="pl-top">${coverHTML(b).replace('class="cover"', 'class="cover pl-cover"')}
          <div class="trk"><b>${esc(t.name)}</b><span>${esc(b.title)}${tracks.length > 1 ? ` · part ${ti + 1} of ${tracks.length}` : ""}</span></div></div>
        ${scrub}
        <div class="pl-ctrls">
          <button class="ib" id="auPrev" aria-label="Previous part or start of this part">${ICON.prev}</button>
          ${skipBtn(-1)}${playBtn}${skipBtn(1)}
          <button class="ib" id="auNext" aria-label="Next part" ${ti < tracks.length - 1 ? "" : "disabled"}>${ICON.nextp}</button>
        </div>
        ${speedRow(rate)}
        ${volRow}
        <div class="pl-row"><label>Skip</label><div class="chips">${SKIPS.map(s => `<button class="chip" data-skip="${s}" aria-pressed="${s === sk}">${s} sec</button>`).join("")}</div></div>
        ${chapterRow(b)}
        ${sleepRow()}
        ${followRow(b)}
        ${bigRow(b)}
        <div class="pl-row"><label>Parts</label><button class="btn" id="auList">${S.showTracks ? "Hide parts" : `Show all ${tracks.length}`}</button></div>
        ${list}
        ${wifiRow(b)}
        ${popRow}
      </div>`;
    }
    $("#auPlay").onclick = togglePlay;
    $("#auBack").onclick = () => skipBy(-sk);
    $("#auFwd").onclick = () => skipBy(sk);
    const seek = $("#auSeek");
    seek.oninput = () => {
      S.scrubbing = true; paintRange(seek);
      $("#auCur").textContent = fmt(+seek.value);
      if (auBook && auBook.id === S.cur && isFinite(au.duration)) $("#auLeft").textContent = "-" + fmt(Math.max(0, au.duration - seek.value));
    };
    seek.onchange = async () => {
      const v = +seek.value; S.scrubbing = false;
      if (!(await ensureLoaded())) return;
      au.currentTime = v; saveAudioPos(true); updateTimes();
    };
    const rb = $("#auRateBtn"); if (rb) rb.onclick = () => { const i = SPEEDS.indexOf(curRate()); setRate(SPEEDS[(i + 1) % SPEEDS.length]); };
    const sl = $("#auSlower"); if (sl) sl.onclick = () => setRate(curRate() - 0.05);
    const fa = $("#auFaster"); if (fa) fa.onclick = () => setRate(curRate() + 0.05);
    el.querySelectorAll("[data-rate]").forEach(x => x.onclick = () => setRate(+x.dataset.rate));
    el.querySelectorAll("[data-skip]").forEach(x => x.onclick = () => { prefs.set("skip", +x.dataset.skip); updateDock(); });
    const pv = $("#auPrev"); if (pv) pv.onclick = () => goPart(-1);
    const nx = $("#auNext"); if (nx) nx.onclick = () => goPart(1);
    const ls = $("#auList"); if (ls) ls.onclick = () => { S.showTracks = !S.showTracks; updateDock(); };
    const am = $("#auMatch"); if (am) am.onclick = () => $("#matchFile").click();
    el.querySelectorAll("[data-await-audio]").forEach(a => a.addEventListener("click", () => { S.awaitingAudio = S.cur; }));
    const dl = $("#auDl"); if (dl) dl.onclick = downloadAll;
    ["#auLink", "#auLink2"].forEach(s => { const x = $(s); if (x) x.onclick = () => askAudioLink(S.cur); });
    el.querySelectorAll("[data-t]").forEach(x => x.onclick = async () => { const i = +x.dataset.t; if (await loadTrack(i, 0)) { save(S.cur, { audio: { track: i, time: 0 } }); au.play().catch(() => {}); } updateDock(); });
    el.querySelectorAll("[data-follow]").forEach(x => x.onclick = () => {
      prefs.set("follow", x.dataset.follow === "1");
      if (!followOn()) { clearHighlights(); fLast.el = null; followStopCap(); S.followHold = false; updateFollowPill(); } else followTick(true);
      updateDock();
    });
    const sa = $("#syncAuto"); if (sa) sa.onclick = () => autoSync(S.cur);
    const ss = $("#syncStop"); if (ss) ss.onclick = () => { stopAutoSync(); ss.disabled = true; ss.textContent = "Stopping…"; };
    const fl = $("#fLine"); if (fl) fl.onclick = async () => {
      if (!(await ensureLoaded())) return;
      S.syncPick = true; S.bigPlayer = false; updateDock(); updateFollowPill();
    };
    const fr = $("#fReset"); if (fr) fr.onclick = () => confirmBox("Reset the line-ups?", "Follow along goes back to its first estimate for this book, on every device.", "Reset", () => { save(S.cur, { follow: { pts: [] } }); updateDock(); followTick(true); });
    const clr = $("#auClear"); if (clr) clr.onclick = () => confirmBox("Remove the audiobook?", "The audio files for this book will be removed from every device. The book itself stays.", "Remove audio", async () => {
      au.pause(); au.removeAttribute("src"); auBook = null;
      const id = S.cur; S.uploads = S.uploads.filter(u => !(u.id === id && u.kind === "track"));
      for (const x of tracks) { idb.del(x.key); if (x.asset && Cloud.signedIn()) Files.del(x.asset).catch(() => {}); }
      save(id, { audio: { tracks: [], track: 0, time: 0, url: "" } }, { now: true }); S.showTracks = false; updateDock();
    });
    updateTimes();
  }
  // shared controls
  const ex = $("#auExpand"); if (ex) ex.onclick = () => { S.bigPlayer = !S.bigPlayer; updateDock(); };
  el.querySelectorAll("[data-pmode]").forEach(x => x.onclick = () => {
    const m = x.dataset.pmode; if (m === playerMode()) return;
    if (m === "book") stopReadAloud(); else if (!au.paused) au.pause();
    S.playerMode = m; updateDock();
  });
  const vs = $("#auVol"); if (vs) vs.oninput = () => { paintRange(vs); setVol(+vs.value); };
  const mu = $("#auMute"); if (mu) mu.onclick = () => { const v = shownVol(); if (v > 0) { lastVol = v; setVol(0); } else setVol(lastVol || 0.7); };
  if (big && IOS && vol == null) Native.call({ op: "volumeGet" }).then(v => { vol = +v; paintVol(); }).catch(() => {});
  bindExtrasDock();
  const ws = $("#wifiShare"); if (ws) ws.onclick = () => shareToPhone(S.cur);
  const wx = $("#wifiStop"); if (wx) wx.onclick = stopSharing;
  const wg = $("#wifiGet"); if (wg) wg.onclick = () => getFromPC(S.cur);
  const wc = $("#wifiChange"); if (wc) wc.onclick = () => getFromPC(S.cur, true);
  const sp = $("#auSplit"); if (sp) sp.onclick = () => { sp.disabled = true; sp.textContent = "Splitting…"; splitBigParts(S.cur); };
  const ul = $("#plUnlock"); if (ul) ul.onclick = () => capCmd("lock");
  const pp = $("#plPop"); if (pp) pp.onclick = () => { setCaption(!prefs.get("capOn")); const rp = $("#rPop"); if (rp) rp.setAttribute("aria-pressed", !!prefs.get("capOn")); updateDock(); };
  const add = $("#auAdd"); if (add) add.onclick = () => $("#audioFile").click();
  paintVol();
}

/* ---------- follow along with an audiobook ----------
   An MP3 or M4B has no text inside it, so Pagekeeper estimates: how far you are through all the audio
   is matched to how far you are through the book's text. Each "line up" (you tap the sentence you're
   hearing) pins that moment exactly, and the stretch between line-ups is spread evenly.
   Line-ups are saved with the book, so they sync to your other devices. */
const splitS = x => x.match(SENT_RE) || [x];   // the same sentences the page shows
const followOn = () => prefs.get("follow") !== false;
const followActive = () => !!(followOn() && auBook && auBook.id === S.cur && !au.paused && S.books[S.cur]?.audio?.tracks?.length);
const durCache = (() => { try { return JSON.parse(localStorage.getItem("pk-durs") || "{}"); } catch { return {}; } })();
function setDur(key, d){
  if (!key || !isFinite(d) || d <= 0 || durCache[key] === d) return;
  durCache[key] = d; try { localStorage.setItem("pk-durs", JSON.stringify(durCache)); } catch {}
}
const durTried = new Set();
const durOf = t => durCache[t.key] || t.dur || 0;
async function measureDurs(b){
  for (const t of b.audio.tracks) {
    if (durOf(t) || durTried.has(t.key)) continue;
    durTried.add(t.key);
    const blob = await idb.get(t.key); if (!blob) continue;
    const u = URL.createObjectURL(blob); const a = new Audio(); a.preload = "metadata";
    await new Promise(r => { a.onloadedmetadata = r; a.onerror = r; setTimeout(r, 8000); a.src = u; });
    setDur(t.key, a.duration); a.removeAttribute("src"); URL.revokeObjectURL(u);
  }
  keepDurs(b);
}
// The part that's playing always knows its own length, even where the ones that aren't playing
// can't be measured (iPhone doesn't load audio in the background).
function notePlayingDur(b){
  const t = b.audio.tracks[auBook.track], d = au.duration;
  if (t && !t.durExact && isFinite(d) && d > 0 && Math.abs((durCache[t.key] || 0) - d) > 0.5) { setDur(t.key, d); keepDurs(b); }
}
// Save the lengths with the book, so your other devices know them without measuring.
function keepDurs(b){
  const id = Object.keys(S.books).find(k => S.books[k] === b); if (!id) return;
  let changed = false;
  const tracks = b.audio.tracks.map(t => { const d = durCache[t.key]; if (d && Math.abs((t.dur || 0) - d) > 0.5) { changed = true; return { ...t, dur: Math.round(d * 10) / 10 }; } return t; });
  if (changed) save(id, { audio: { tracks } });
}
// Lengths of every part. Parts not measured yet are estimated from their file size, at the
// bitrate of the parts that are known.
function trackDurs(b){
  const tr = b.audio.tracks; let kd = 0, ks = 0;
  for (const t of tr) if (durOf(t) && t.size) { kd += durOf(t); ks += t.size; }
  const perByte = ks ? kd / ks : 1 / 8000;   // about 64 kbps, typical for audiobooks, until we know better
  return tr.map(t => durOf(t) || (t.size ? t.size * perByte : 0) || 1800);
}
function textIndex(c){
  if (c._fi) return c._fi;
  if (c.kind !== "text") return (c._fi = { starts: null, total: c.total || 1 });
  const starts = []; let n = 0;
  for (const blocks of c.pages) { starts.push(n); for (const [t, x] of blocks) n += t === "h" ? x.length : splitS(x).reduce((a, q) => a + q.length, 0); }
  return (c._fi = { starts, total: n || 1 });
}
function audioClock(b){
  const D = trackDurs(b); const off = [0]; for (const d of D) off.push(off[off.length - 1] + d);
  return { off, total: off[D.length] };
}
// pts: [audio seconds, place in the text 0–1], sorted. Between points the place moves evenly.
// With automatic sync ("ext"), before the first point and after the last it keeps the narrator's pace
// (for a minute at most) instead of stretching to the ends of the book: the audiobook may be only part of it.
function mapFrac(pts, at, totalA, ext){
  let P = pts;
  if (ext && P.length >= 2) {
    const [a0, f0] = P[0], [a1, f1] = P[P.length - 1], rate = (f1 - f0) / Math.max(1, a1 - a0);
    if (at <= a0) return Math.max(0, f0 - Math.min(60, a0 - at) * rate);
    if (at >= a1) return Math.min(1, f1 + Math.min(60, at - a1) * rate);
  } else P = [[0, 0], ...P.filter(p => p[0] > 0 && p[0] < totalA), [totalA, 1]];
  let lo = 1, hi = P.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (P[mid][0] < at) lo = mid + 1; else hi = mid; }
  const [a0, f0] = P[lo - 1], [a1, f1] = P[lo];
  return Math.min(1, Math.max(0, f0 + (f1 - f0) * (a1 > a0 ? Math.min(1, Math.max(0, (at - a0) / (a1 - a0))) : 0)));
}
const fPts = { key: "", P: [], ext: false };
const fLast = { page: 0, el: null, busy: false };
async function followTick(force){
  if (S.view !== "reader" || !followOn() || S.followHold || S.syncPick || fLast.busy) return;
  const b = S.books[S.cur];
  if (!auBook || auBook.id !== S.cur || !b?.audio?.tracks?.length) return;
  if (au.paused && !force) return;
  const now = Date.now(); if (!force && now - (followTick.t || 0) < 100) return; followTick.t = now;
  const c = S.content[S.cur]; if (!c) return;
  notePlayingDur(b);
  measureDurs(b);
  const { off, total: totalA } = audioClock(b);
  const at = off[auBook.track] + (au.currentTime || 0);
  // While the full sync runs, use what's been matched so far (it's exact where it has heard).
  const sb = AS.interim && AS.interim.id === S.cur && !(b.sync && b.sync.v === 2 && !needsSync(b, c)) ? { sync: AS.interim.sync } : b;
  const key = S.cur + "|" + ((sb.sync && sb.sync.d && sb.sync.d.length) || 0) + "|" + ((sb.sync && sb.sync.at) || 0) + "|" + off.join(",") + "|" + JSON.stringify((b.follow && b.follow.pts) || []);
  if (fPts.key !== key) {
    const g = (ti, t) => (off[ti] ?? off[off.length - 1]) + t;
    const manual = ((b.follow && b.follow.pts) || []).map(([ti, t, f]) => [g(ti, t), f]);
    // Timing from automatic sync, with your own line-ups taking over near where you made them.
    const auto = syncPoints(sb, textIndex(c)).map(([ti, t, f]) => [g(ti, t), f])
      .filter(([a, f]) => manual.every(([ma, mf]) => Math.abs(a - ma) > 30 && (a < ma ? f <= mf : f >= mf)));
    fPts.key = key; fPts.ext = auto.length > 1; fPts.P = (auto.length ? auto.concat(manual) : manual).sort((x, y) => x[0] - y[0]);
  }
  const frac = mapFrac(fPts.P, at, totalA, fPts.ext);
  const ix = textIndex(c);
  let page, inPage = 0;
  if (!ix.starts) page = Math.min(ix.total, Math.floor(frac * ix.total) + 1);
  else {
    const pos = frac * ix.total + 0.5; let lo = 0, hi = ix.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ix.starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    page = lo + 1; inPage = pos - ix.starts[lo];
  }
  if (page !== S.page) { fLast.busy = true; try { await goto(page, false, "follow"); } finally { fLast.busy = false; } }
  if (!ix.starts) return;
  if (fLast.page !== S.page) { fLast.page = S.page; fLast.el = null; }
  capNow.abook = S.cur; capNow.apage = S.page; capNow.apos = Math.max(0, Math.round(inPage));
  let n = 0, hit = null;
  for (const sp of document.querySelectorAll(".page [data-s]")) { n += sp.textContent.length; hit = sp; if (n > inPage) break; }
  if (!hit || hit === fLast.el) { if (capMode() === "page") capSend(); return; }
  if (fLast.el) clearHighlight(fLast.el);
  fLast.el = hit;
  if ((prefs.get("hl") || "sentence") !== "off") {
    hit.classList.add("hl");
    const m = $("#rMain"), r = hit.getBoundingClientRect(), mr = m && m.getBoundingClientRect();
    if (mr && (r.top < mr.top + 40 || r.bottom > mr.bottom - 40)) hit.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  // The pop-out shows just this sentence, and keeps showing it while the audio is paused.
  capNow.follow = true; capNow.speaking = !au.paused; capNow.text = hit.textContent.trim(); capNow.book = S.cur; capNow.page = S.page; capNow.word = null; capSend();
}
// Check several times a second while playing, so the sentence changes right as it's spoken.
setInterval(() => { if (!au.paused && auBook) followTick(); }, 120);
function followStopCap(){ if (capNow.follow) { capNow.follow = false; capNow.speaking = false; capSend(); } }   // the last sentence stays up
function followPick(e){
  const b = S.books[S.cur], c = S.content[S.cur];
  if (!auBook || auBook.id !== S.cur || !c) { S.syncPick = false; updateFollowPill(); return; }
  const ix = textIndex(c); let frac;
  if (ix.starts) {
    const sp = e.target.closest("[data-s]");
    if (!sp) { toast("Tap the sentence you're hearing."); return; }
    let n = 0; for (const x of document.querySelectorAll(".page [data-s]")) { if (x === sp) break; n += x.textContent.length; }
    frac = (ix.starts[S.page - 1] + n) / ix.total;
  } else frac = (S.page - 1) / ix.total;
  const { off } = audioClock(b);
  const g = (ti, t) => (off[ti] ?? 0) + t;
  const nt = au.currentTime || 0, na = g(auBook.track, nt);
  // Keep the other line-ups that still agree with this one (earlier audio = earlier text), and drop any within 20 seconds.
  const kept = ((b.follow && b.follow.pts) || []).filter(([ti, t, f]) => { const a = g(ti, t); return Math.abs(a - na) > 20 && (a < na ? f <= frac : f >= frac); });
  const pts = [...kept, [auBook.track, Math.round(nt * 10) / 10, Math.round(frac * 1e6) / 1e6]].sort((x, y) => g(x[0], x[1]) - g(y[0], y[1]));
  save(S.cur, { follow: { pts } });
  S.syncPick = false; S.followHold = false; fLast.el = null; updateFollowPill();
  toast(pts.length > 1 ? `Lined up. ${pts.length} line-ups in this book.` : "Lined up. Do it again later in the book if it drifts.");
  followTick(true);
}
function followRow(b){
  const on = followOn(), n = ((b.follow && b.follow.pts) || []).length;
  const synced = !!(b.sync && b.sync.d && b.sync.v === 2), mine = !!(AS.run && AS.run.id === S.cur);
  let auto = "";
  if (on && TAURI) auto = mine
    ? `<div class="pl-row"><label>Sync</label><span class="note" id="syncStatus" style="flex:1;min-width:180px">${esc(syncText())}</span><button class="btn ghost" id="syncStop">Stop</button></div>`
    : `<div class="pl-row"><label>Sync</label><button class="btn ${synced ? "" : "primary"}" id="syncAuto" ${AS.run ? "disabled" : ""}>${AS.run ? "Syncing another book…" : synced ? "Sync again" : "Sync automatically"}</button><span class="note">${synced ? "Each sentence is matched to the moment it's read." : "Listens to the whole audiobook once on this PC and matches every sentence. Starts by itself when you open the book; about 20 minutes for a long audiobook."}</span></div>`;
  else if (on) auto = `<p class="note fnote">${synced ? "Synced on your PC, so it follows the audio exactly." : "For exact timing, open this book in Pagekeeper on your PC and tap <b>Sync automatically</b>. It shows up here when it's done."}</p>`;
  return `<div class="pl-row"><label>Follow</label><div class="chips"><button class="chip" data-follow="1" aria-pressed="${on}">On</button><button class="chip" data-follow="0" aria-pressed="${!on}">Off</button></div>
    ${on ? `<button class="btn" id="fLine">Line up</button>${n ? `<button class="btn ghost" id="fReset">Reset ${n} line-up${n > 1 ? "s" : ""}</button>` : ""}` : ""}</div>
    ${on ? `<p class="note fnote">${synced ? "Turns the pages and highlights the sentence using the timing from automatic sync. If a spot is off, tap <b>Line up</b> while it plays, then the sentence you're hearing." : "Turns the pages and highlights the sentence as the audiobook plays. Until it's synced, it's an estimate. If it's off, tap <b>Line up</b> while it plays, then tap the sentence you're hearing."}</p>` : ""}${auto}`;
}
function updateFollowPill(){
  const r = $(".reader"); let el = $("#followPill");
  let html = "";
  if (r && S.syncPick) html = `<span>Tap the sentence you're hearing now</span><button class="btn ghost" id="fpCancel">Cancel</button>`;
  else if (r && S.followHold && followActive()) html = `<span>The audio is somewhere else</span><button class="btn primary" id="fpBack">Back to the audio</button>`;
  if (!html) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "followPill"; el.className = "fpill"; r.appendChild(el); }
  el.innerHTML = html;
  const cx = $("#fpCancel"); if (cx) cx.onclick = () => { S.syncPick = false; updateFollowPill(); followTick(true); };
  const bk = $("#fpBack"); if (bk) bk.onclick = () => { S.followHold = false; updateFollowPill(); followTick(true); };
}

/* ---------- automatic sync (Windows app) ----------
   The PC listens to the whole audiobook once with a speech recognizer that runs on this computer
   (whisper.cpp), then lines the words it heard up with the book's words:
   1. Runs of four words that appear only once in the book and once in the audio are sure matches;
      the longest chain of them that moves forward through both is the backbone.
   2. Between those, every other word is lined up one by one (allowing for misheard words).
   3. Each sentence then gets the moment its first word is spoken.
   The result (a timing point per sentence) is saved with the book, so the iPhone follows exactly too. */
const normW = w => w.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
function bookWords(c){
  const w = [], o = [], ss = []; let n = 0;
  for (const blocks of c.pages) for (const [t, x] of blocks) for (const q of (t === "h" ? [x] : splitS(x))) {
    ss.push([n, w.length]);   // where each sentence starts, and its first word
    const ms = [...q.matchAll(WORD_RE)];
    for (let i = 0; i < ms.length; i++) {
      let m = ms[i], word = m[0];
      // a chapter's decorative first letter set apart from the rest of its word ("T hufir")
      if (/^[B-HJ-NP-Z]$/.test(word) && ms[i + 1] && ms[i + 1].index === m.index + 2 && /^[a-z]/.test(ms[i + 1][0])) { word += ms[i + 1][0]; i++; }
      const k = normW(word); if (k) { w.push(k); o.push(n + m.index); }
    }
    n += q.length;
  }
  return { w, o, ss };
}
const SYNC_LEAD = 150;   // the recognizer marks words about a tenth of a second late; switch sentences just before
// tx: one list per part of [milliseconds, text] from the recognizer; gp: the pauses in each part.
// fx: per part, sentence starts already double-checked by listening: [[place in text, ms], ...]
function alignBook(c, tx, gp, fx){
  const ix = textIndex(c), B = bookWords(c);
  const tw = [], tt = [], tm = [];
  tx.forEach((list, ti) => { for (const [ms, text] of list) for (const piece of String(text).split(/\s+/)) { const k = normW(piece); if (k) { tw.push(k); tt.push(ti); tm.push(ms); } } });
  if (B.w.length < 50 || tw.length < 50) return { ok: false, msg: "There wasn't enough speech or text to match." };
  // 1. sure matches: four-word runs found once in each
  const K = 4;
  const grams = arr => { const m = new Map(); for (let i = 0; i + K <= arr.length; i++) { const g = arr[i] + " " + arr[i + 1] + " " + arr[i + 2] + " " + arr[i + 3]; m.set(g, m.has(g) ? -1 : i); } return m; };
  const bm = grams(B.w), tmap = grams(tw);
  const pairs = [];
  for (let j = 0; j + K <= tw.length; j++) {
    const g = tw[j] + " " + tw[j + 1] + " " + tw[j + 2] + " " + tw[j + 3];
    if (tmap.get(g) !== j) continue;
    const i = bm.get(g); if (i >= 0) pairs.push([i, j]);
  }
  const tails = [], prev = new Int32Array(pairs.length).fill(-1);
  pairs.forEach(([i], p) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][0] < i) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[p] = tails[lo - 1];
    tails[lo] = p;
  });
  const chain = []; for (let p = tails.length ? tails[tails.length - 1] : -1; p >= 0; p = prev[p]) chain.push(pairs[p]);
  chain.reverse();
  if (chain.length < 20) return { ok: false, msg: "The audio didn't match this book's text. Check it's the same book, in English." };
  // 2. line up every word between the sure matches
  const mi = new Int32Array(B.w.length).fill(-1);
  const same = (a, b) => a === b || (a.length > 3 && b.length > 3 && Math.abs(a.length - b.length) < 3 && a.slice(0, 3) === b.slice(0, 3) && a.slice(-2) === b.slice(-2));
  const fill = (i0, i1, j0, j1) => {   // longest run of matching words between book[i0,i1) and audio[j0,j1)
    const n = i1 - i0, m = j1 - j0; if (n <= 0 || m <= 0) return;
    if (n * m > 600000) return;   // a long stretch with nothing in common (text that isn't read aloud)
    const W = m + 1, L = new Uint16Array((n + 1) * W);
    for (let a = n - 1; a >= 0; a--) for (let b = m - 1; b >= 0; b--)
      L[a * W + b] = same(B.w[i0 + a], tw[j0 + b]) ? L[(a + 1) * W + b + 1] + 1 : Math.max(L[(a + 1) * W + b], L[a * W + b + 1]);
    for (let a = 0, b = 0; a < n && b < m;) {
      if (same(B.w[i0 + a], tw[j0 + b]) && L[a * W + b] === L[(a + 1) * W + b + 1] + 1) { mi[i0 + a] = j0 + b; a++; b++; }
      else if (L[(a + 1) * W + b] >= L[a * W + b + 1]) a++; else b++;
    }
  };
  let pi = 0, pj = 0;
  const head = chain[0];
  fill(Math.max(0, head[0] - 400), head[0], Math.max(0, head[1] - 400), head[1]);
  for (let k = 0; k < chain.length; k++) {
    const [i, j] = chain[k];
    if (k > 0) fill(pi, i, pj, j);
    for (let q = 0; q < K; q++) if (i + q >= pi && j + q >= pj) { mi[i + q] = j + q; }
    pi = Math.max(pi, i + K); pj = Math.max(pj, j + K);
  }
  fill(pi, Math.min(B.w.length, pi + 400), pj, Math.min(tw.length, pj + 400));
  // A lone short word ("the", "your") matched with nothing around it may be the same word a few
  // words away; trust a match only if a neighbor lines up too, or the word is long enough to be telling.
  const keep = new Uint8Array(mi.length);
  for (let i = 0; i < mi.length; i++) {
    const j = mi[i]; if (j < 0) continue;
    keep[i] = (i > 0 && mi[i - 1] === j - 1) || (i + 1 < mi.length && mi[i + 1] === j + 1) || B.w[i].length >= 7 ? 1 : 0;
  }
  for (let i = 0; i < mi.length; i++) if (!keep[i]) mi[i] = -1;
  // keep matches moving forward in time
  let lastT = -1, lastM = -1, first = -1, last = -1, matched = 0;
  for (let i = 0; i < mi.length; i++) {
    const j = mi[i]; if (j < 0) continue;
    if (tt[j] < lastT || (tt[j] === lastT && tm[j] < lastM)) { mi[i] = -1; continue; }
    lastT = tt[j]; lastM = tm[j]; if (first < 0) first = i; last = i; matched++;
  }
  // 3. when each sentence starts
  const at = i => [tt[mi[i]], tm[mi[i]]];
  const near = (i, dir, lim) => { for (let k = i, n = 0; k >= first && k <= last && n <= lim; k += dir, n++) if (mi[k] >= 0) return k; return -1; };
  // how long a word takes around here, from the matched words that follow i
  const pace = i => { const a = near(i, 1, 10), b = a >= 0 ? near(a + 1, 1, 20) : -1;
    if (a < 0 || b < 0 || tt[mi[a]] !== tt[mi[b]]) return 330;
    return Math.min(600, Math.max(200, (tm[mi[b]] - tm[mi[a]]) / (b - a))); };
  // The recognizer's times can be a second or so out. Narrators pause between sentences, so move each
  // sentence start to the end of the best nearby pause: where the voice actually starts again.
  const snap = (ti, ms) => {
    const g = (gp && gp[ti]) || []; if (!g.length) return Math.max(0, ms - SYNC_LEAD);
    let lo = 0, hi = g.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (g[mid][1] < ms - 2500) lo = mid + 1; else hi = mid; }
    let best = -1, bs = -1e9;
    for (let k = lo; k < g.length && g[k][1] <= ms + 2000; k++) { const s = Math.min(g[k][1] - g[k][0], 800) / 800 - Math.abs(g[k][1] - ms) / 2000; if (s > bs) { bs = s; best = g[k][1]; } }
    return best < 0 ? Math.max(0, ms - SYNC_LEAD) : Math.max(0, best - 30);
  };
  const pts = [], suspect = [];
  // Where the recognizer's timing looks wrong around a sentence start (it skipped words, or crammed
  // or stretched them), note a few seconds to listen to again on their own.
  const check = fw => {
    const q = near(fw, 1, 8), p = near(fw - 1, -1, 12); if (q < 0) return;
    const [tq, mq] = at(q);
    let bad = mi[fw] < 0 && q - fw > 2;
    if (p >= 0 && tt[mi[p]] === tq) { const dt = mq - at(p)[1], n = q - p; if (dt < 150 * n || dt > 900 * n + 3000) bad = true; }
    const q2 = near(q + 1, 1, 6); if (q2 >= 0 && tt[mi[q2]] === tq && at(q2)[1] - mq < 110 * (q2 - q)) bad = true;
    if (bad) suspect.push([tq, Math.max(0, (p >= 0 && tt[mi[p]] === tq ? at(p)[1] : mq - 3000) - 1500), mq + 5000]);
  };
  const R = [];   // each sentence: [part, the recognizer's time for its start, where it starts in the text]
  for (const [off, fw] of B.ss) {
    if (fw < first || fw > last) continue;
    check(fw);
    let ti, ms;
    if (mi[fw] >= 0) [ti, ms] = at(fw);
    else {
      // the first words weren't heard clearly: go from the matched words just around them
      const q = near(fw, 1, 8), p = near(fw, -1, 8);
      if (p >= 0 && q >= 0 && tt[mi[p]] === tt[mi[q]]) { const m0 = at(p)[1], m1 = at(q)[1]; ti = tt[mi[p]]; ms = m0 + (m1 - m0) * (fw - p) / (q - p); }
      else if (q >= 0) { [ti, ms] = at(q); ms -= (q - fw) * pace(q); }
      else if (p >= 0) { [ti, ms] = at(p); ms += (fw - p) * pace(p); }
      else continue;
    }
    R.push([ti, ms, off]);
  }
  const T = R.map(([ti, ms]) => snap(ti, ms));
  const sure = new Map(); (fx || []).forEach((list, ti) => { for (const [off, ms] of list || []) sure.set(ti + ":" + off, ms); });
  R.forEach(([ti, , off], k) => { const v = sure.get(ti + ":" + off); if (v !== undefined) T[k] = v; });
  for (let k = 0; k < R.length; k++) {
    const [ti, ms, off] = R[k], p = pts[pts.length - 1], after = x => !p || ti > p[0] || (ti === p[0] && x > p[1] + 200);
    // two short sentences can land on the same pause: the second keeps the recognizer's time
    let t = T[k]; if (!after(t)) t = Math.max(0, ms - SYNC_LEAD);
    if (!after(t)) continue;
    pts.push([ti, t, off]);
  }
  const span = last - first + 1;
  // join overlapping stretches to listen again
  suspect.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const again = [];
  for (const w of suspect) { const l = again[again.length - 1]; if (l && l[0] === w[0] && w[1] <= l[2] + 1000) l[2] = Math.max(l[2], w[2]); else again.push(w.slice()); }
  return { ok: true, coverage: (B.o[last] - B.o[first]) / ix.total, heard: matched / span, again,
    sync: { v: 2, u: 10, total: ix.total, n: pts.length, parts: tx.length, d: encodeSync(pts, 10), at: Date.now() } };
}

// The timing map as [part, milliseconds, character position], and back.
function decodeSync(s){
  let ti = 0, d = 0, o = 0; const out = [];
  for (const part of s.d.split(";")) { const [a, x, y] = part.split(",").map(v => parseInt(v, 36)); if (a) { ti += a; d = x; } else d += x; o += y; out.push([ti, d * (s.u || 100), o]); }
  return out;
}
// u: the time unit in milliseconds (100 in older maps, 10 now)
function encodeSync(pts, u = 100){
  let pt = 0, pd = 0, po = 0; const enc = [];
  for (const [ti, ms, o] of pts) { const d = Math.round(ms / u); enc.push([ti - pt, ti !== pt ? d : d - pd, o - po].map(v => v.toString(36)).join(",")); pt = ti; pd = d; po = o; }
  return enc.join(";");
}
function syncPoints(b, ix){
  const s = b.sync; if (!s || (s.v !== 1 && s.v !== 2) || !s.d || s.total !== ix.total) return [];
  if (syncPoints.cache && syncPoints.cache.d === s.d) return syncPoints.cache.pts;
  let ti = 0, d = 0, o = 0; const pts = [];
  for (const part of s.d.split(";")) {
    const [a, x, y] = part.split(",").map(v => parseInt(v, 36));
    if (a) { ti += a; d = x; } else d += x;
    o += y; pts.push([ti, d * (s.u || 100) / 1000, o / ix.total]);
  }
  syncPoints.cache = { d: s.d, pts };
  return pts;
}

const AS = { run: null, interim: null };
/* The matching runs in a background worker built from the same functions, so the page never stalls. */
let alignW = null, alignWBook = null, alignWN = 0; const alignWait = {};
function alignInWorker(id, c, tx, gp, fx){
  try {
    if (!alignW) {
      const src = [`const SENT_RE = ${SENT_RE};`, `const splitS = ${splitS};`, `const normW = ${normW};`, `const WORD_RE = ${WORD_RE};`, `const SYNC_LEAD = ${SYNC_LEAD};`,
        textIndex, bookWords, alignBook, encodeSync, decodeSync,
        "let C = null; onmessage = e => { const m = e.data; if (m.c) C = m.c; let res; try { res = alignBook(C, m.tx, m.gp, m.fx); } catch (err) { res = { ok: false, msg: String(err && err.message || err) }; } postMessage({ n: m.n, res }); };"].map(String).join("\n");
      alignW = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      alignW.onmessage = e => { const f = alignWait[e.data.n]; delete alignWait[e.data.n]; if (f) f(e.data.res); };
    }
    const n = ++alignWN, msg = { n, tx, gp, fx };
    if (alignWBook !== id) { msg.c = { kind: c.kind, pages: c.pages }; alignWBook = id; }
    return new Promise(r => { alignWait[n] = r; alignW.postMessage(msg); });
  } catch { return Promise.resolve(alignBook(c, tx, gp, fx)); }   // no workers: do it here
}
/* The double-check. For every sentence start in a part, listen to a couple of seconds starting right
   there: if the first words heard are the sentence's own first words, it's right. If not, try the
   nearby pauses and word starts until one passes (or keep the first guess). */
const ckSame = (a, b) => a === b || (a.length > 3 && b.length > 3 && a.slice(0, 3) === b.slice(0, 3)) || (a.length > 4 && b.length > 4 && a.slice(-3) === b.slice(-3));
function ckPass(heard, want){
  const h = heard.map(normW).filter(Boolean);
  if (!h.length || !want.length || !ckSame(h[0], want[0])) return false;
  return want[0].length > 3 || want.length < 2 || (h[1] !== undefined && ckSame(h[1], want[1]));   // a short first word needs the next one too
}
async function checkPart(r, i){
  const h = r.heard[i]; if (!h || !h.job) return;
  try {
    const tx = r.heard.map((x, k) => x ? x.words : []), gp = r.heard.map(x => x ? x.gaps || [] : []), fx = r.heard.map(x => x ? x.fix || [] : []);
    const res = await alignInWorker(r.id, r.c, tx, gp, fx); if (!res || !res.ok) return;
    if (!r.B) r.B = bookWords(r.c);
    const firstAt = new Map(); for (const [off, fw] of r.B.ss) firstAt.set(off, r.B.w.slice(fw, fw + 3));
    const items = [];
    for (const [ti, ms, off] of decodeSync(res.sync)) {
      if (ti !== i) continue;
      const want = firstAt.get(off); if (!want || !want.length) continue;
      const near = (h.gaps || []).filter(g => g[1] > ms - 3000 && g[1] < ms + 6000).map(g => g[1] - 30)
        .concat(h.words.filter(w => w[0] > ms - 3000 && w[0] < ms + 6000).map(w => w[0]));
      near.sort((a, b) => Math.abs(a - ms) - Math.abs(b - ms));
      const cands = [Math.round(ms)]; for (const c of near) if (cands.length < 13 && cands.every(x => Math.abs(x - c) > 200)) cands.push(Math.max(0, Math.round(c)));
      items.push({ off, want, cands, k: 0, done: null });
    }
    r.stage = "check"; r.frac = 0; paintSync();
    const total = items.length;
    for (let round = 0, per = 1; round < 6; round++, per = 3) {
      const open = items.filter(x => x.done === null && x.k < x.cands.length); if (!open.length) break;
      const asks = []; for (const x of open) for (let j = 0; j < per && x.k + j < x.cands.length; j++) asks.push([x, x.cands[x.k + j]]);
      const heard = await tauriInvoke("pk_check", { job: h.job, starts: asks.map(a => a[1]) });
      if (AS.stop) throw new Error("Stopped.");
      asks.forEach(([x, c], n) => { if (x.done === null && ckPass(heard[n] || [], x.want)) x.done = c; });
      for (const x of open) x.k += per;
      r.frac = Math.min(0.99, items.filter(x => x.done !== null || x.k >= x.cands.length).length / Math.max(1, total)); paintSync();
    }
    // A passing clip can start in the quiet just before the sentence: the voice begins where that pause ends.
    const g = h.gaps || [];
    const settle = c => { const p = g.find(x => x[0] <= c + 250 && x[1] >= c - 100 && x[1] <= c + 900); return p ? Math.max(c, p[1] - 30) : c; };
    h.fix = items.filter(x => x.done !== null).map(x => [x.off, settle(x.done)]);
  } finally {
    tauriInvoke("pk_sync_release", { job: h.job }).catch(() => {});
    delete h.job;
  }
}
/* While the whole book is being heard, line up what's been heard so far every little while.
   The part you're listening to goes first, starting where you are, so it locks on within a minute. */
function scheduleInterim(){
  const r = AS.run; if (!r || r.interimTimer) return;
  r.interimTimer = setTimeout(async () => {
    r.interimTimer = null;
    if (AS.run !== r || !r.c || r.busy) return;
    const live = r.live.slice().sort((a, b) => a[0] - b[0]), lg = r.liveGaps.slice().sort((a, b) => a[0] - b[0]);
    const tx = r.heard.map((h, k) => h ? h.words : k === r.liveTi ? live : []), gp = r.heard.map((h, k) => h ? h.gaps : k === r.liveTi ? lg : []);
    const fx = r.heard.map(h => h ? h.fix || [] : []);
    r.busy = true;
    const res = await alignInWorker(r.id, r.c, tx, gp, fx);
    r.busy = false;
    if (AS.run !== r || !res || !res.ok) return;
    AS.interim = { id: r.id, sync: res.sync };
    fPts.key = "";
    if (S.cur === r.id) { fLast.el = null; followTick(true); }
    if (!r.locked) { r.locked = true; if (S.cur === r.id) toast("Found your place. Each sentence lights up as it's read; the rest of the book keeps matching in the background.", null, 6000); }
  }, AS.interim && AS.interim.id === r.id ? 12000 : 1500);
}
if (TAURI) TAURI.event.listen("pk-sync-chunk", e => {
  const r = AS.run, p = e.payload; if (!r || !p || p.tag !== r.tag) return;
  for (const w of p.words || []) r.live.push(w);
  for (const g of p.gaps || []) r.liveGaps.push(g);
  scheduleInterim();
});
const tauriInvoke = (...a) => TAURI.core.invoke(...a);
function syncText(){
  const r = AS.run; if (!r) return "";
  const lock = r.locked ? "Following along exactly where it's matched. " : "";
  if (r.stage === "model") return `Getting the speech model (one time, about 75 MB)… ${Math.round(r.frac * 100)}%`;
  if (r.stage === "send") return `Preparing part ${r.part + 1} of ${r.parts}…`;
  if (r.stage === "listen") return `${lock}Listening to ${r.parts > 1 ? `part ${r.part + 1} of ${r.parts}` : "the audiobook"}… ${Math.round(((r.part + r.frac) / r.parts) * 100)}% overall${syncLeft(r)}`;
  if (r.stage === "check") return `${lock}Double-checking each sentence in ${r.parts > 1 ? `part ${r.part + 1} of ${r.parts}` : "the audiobook"}… ${Math.round(r.frac * 100)}%`;
  if (r.stage === "match") return "Matching the words to the book…";
  return "Starting…";
}
// Time left, from how fast the parts heard so far went (parts heard on an earlier run don't count).
function syncLeft(r){
  if (!r.t0) return "";
  const done = (r.part + r.frac) / r.parts - r.o0, spent = (Date.now() - r.t0) / 1000;
  if (done < 0.01 || spent < 20) return "";
  const m = Math.max(1, Math.round(spent / done * (1 - (r.part + r.frac) / r.parts) / 60));
  return m < 60 ? ` · about ${m} min left` : ` · about ${Math.floor(m / 60)} h ${m % 60} min left`;
}
function paintSync(){ const el = $("#syncStatus"); if (el) el.textContent = syncText(); }
if (TAURI) TAURI.event.listen("pk-sync-progress", e => { if (AS.run && e.payload) { AS.run.stage = e.payload.stage; AS.run.frac = +e.payload.frac || 0; paintSync(); } });

// Does this book need syncing (never synced, synced the old quick way, or the text or parts changed)?
function needsSync(b, c){
  const s = b.sync, tr = b.audio?.tracks || [];
  return !s || s.v !== 2 || !s.u || !s.d || (c && s.total !== textIndex(c).total) || (s.parts && s.parts !== tr.length);   // no u: made before every sentence was double-checked
}
// On the PC, a book with its audiobook syncs by itself the first time it's opened. No buttons, no line-ups.
async function maybeAutoSync(id){
  if (!TAURI || AS.run || prefs.get("autoSync") === false || (AS.skip && AS.skip.has(id))) return;
  const b = S.books[id]; if (!b?.audio?.tracks?.length) return;
  let c; try { c = S.content[id] || await loadContent(id); } catch { return; }
  if (!c || c.kind !== "text" || !needsSync(b, c)) return;
  await checkLocal(id);
  if (b.audio.tracks.some(t => !S.haveLocal[t.key])) return;
  autoSync(id, true);
}
async function autoSync(id, auto){
  if (!TAURI || AS.run) return;
  const b = S.books[id]; const tracks = (b && b.audio && b.audio.tracks) || [];
  if (!tracks.length) return;
  let c; try { c = await loadContent(id); } catch { c = null; }
  if (!c || c.kind !== "text") { toast("Automatic sync works with EPUB and text books."); return; }
  await checkLocal(id);
  const away = tracks.filter(t => !S.haveLocal[t.key] && !t.asset);
  if (away.length) { toast(`${away.length} part${away.length > 1 ? "s aren't" : " isn't"} on this PC yet. Add the matching files first.`, null, 7000); return; }
  AS.run = { id, stage: "start", frac: 0, part: 0, parts: tracks.length };
  if (S.dock) updateDock();
  const mins = Math.max(1, Math.round(trackDurs(b).reduce((a, d) => a + d, 0) / 45 / 60));   // listening (~70x) plus double-checking each sentence
  toast(`Finding your place in the audiobook. It locks on in about a minute, then matches and double-checks every sentence of the book in the background (about ${mins} min). You can keep listening.`, null, 8000);
  try {
    await tauriInvoke("pk_sync_stop", { stop: false });
    const st = await tauriInvoke("pk_sync_status");
    if (!st.engine) throw new Error("The speech engine is missing from this install. Reinstall Pagekeeper.");
    if (!st.model) { AS.run.stage = "model"; AS.run.frac = 0; paintSync(); await tauriInvoke("pk_sync_model"); }
    const run = AS.run; run.c = c; run.heard = tracks.map(() => null); run.live = []; run.liveGaps = []; run.liveTi = -1;
    // The part you're on goes first, starting a little before where you are.
    const curTi = Math.min(tracks.length - 1, (auBook && auBook.id === id ? auBook.track : b.audio.track) || 0);
    const curT = auBook && auBook.id === id ? (au.currentTime || 0) : (b.audio.time || 0);
    const order = [curTi, ...tracks.map((_, i) => i).filter(i => i !== curTi)];
    for (let oi = 0; oi < order.length; oi++) {
      const i = order[oi], t = tracks[i]; AS.run.part = oi; AS.run.frac = 0;
      let heard = await idb.get("__tx2_" + t.key);   // parts already heard are kept, so a stopped sync picks up where it left off
      // heard and checked before (parts heard by an older version, without the check, get heard again)
      if (heard && heard.words && heard.fix) { run.heard[i] = heard; if (oi === 0 || run.heard.filter(Boolean).length === 1) scheduleInterim(); continue; }
      {
        if (!AS.run.t0) { AS.run.t0 = Date.now(); AS.run.o0 = oi / tracks.length; }
        AS.run.stage = "send"; paintSync();
        let blob = await idb.get(t.key);
        if (!blob && t.asset) blob = await fetchTrack(t);
        if (!blob) throw new Error(`Part ${i + 1} isn't on this PC.`);
        const name = await tauriInvoke("pk_put_begin", { ext: extOf(t.file || t.name || "") || "mp3" });
        const STEP = 8 << 20;
        for (let o = 0; o < blob.size; o += STEP) {
          if (AS.stop) throw new Error("Stopped.");
          const buf = new Uint8Array(await blob.slice(o, o + STEP).arrayBuffer());
          await tauriInvoke("pk_put_chunk", buf, { headers: { "x-file": name } });
        }
        AS.run.stage = "listen"; paintSync();
        run.tag = name; run.liveTi = i; run.live = []; run.liveGaps = [];
        heard = await tauriInvoke("pk_transcribe", { file: name, first: i === curTi ? Math.max(0, curT - 20) : 0 });
        run.liveTi = -1;
        run.heard[i] = heard; scheduleInterim();
        await checkPart(run, i);   // double-check every sentence start in this part
        AS.run.stage = "listen";
        await idb.put("__tx2_" + t.key, { words: heard.words, gaps: heard.gaps, fix: heard.fix || [] });
        idb.del("__tx_" + t.key);   // what the older, quicker sync heard
        scheduleInterim();
      }
    }
    const tx = run.heard.map(h => h.words), gp = run.heard.map(h => h.gaps || []), fx = run.heard.map(h => h.fix || []);
    AS.run.stage = "match"; paintSync();
    await new Promise(r => setTimeout(r, 50));
    const res = await alignInWorker(id, c, tx, gp, fx);
    if (!res.ok) throw new Error(res.msg);
    save(id, { sync: res.sync }, { now: true });
    AS.interim = null; fPts.key = "";
    if (S.cur === id) { fLast.el = null; followTick(true); }
    toast(`Synced. Each sentence now lights up as it's read${res.coverage < 0.8 ? ` (the audiobook covers about ${Math.max(1, Math.round(res.coverage * 100))}% of this book's text; the rest isn't read in it)` : ""}. It syncs to your iPhone too.`, null, 9000);
  } catch (e) {
    const msg = String((e && e.message) || e);
    (AS.skip = AS.skip || new Set()).add(id);   // don't start again by itself until Pagekeeper restarts
    if (/stopped/i.test(msg)) toast("Stopped. Parts already done are kept, so it picks up where it left off when you tap Sync again.", null, 6000);
    else toast("Couldn't sync: " + esc(msg), null, 9000);
  } finally {
    if (AS.run && AS.run.interimTimer) clearTimeout(AS.run.interimTimer);
    AS.run = null; AS.stop = false;   // any partial timing (AS.interim) stays in use until a full sync finishes
    if (S.dock) updateDock();
  }
}
function stopAutoSync(){ if (!AS.run) return; AS.stop = true; tauriInvoke("pk_sync_stop", { stop: true }).catch(() => {}); }

/* ---------- play / pause key ---------- */
const keyPlay = () => prefs.get("keyPlay") || { code: "Space", key: " " };
function keyLabel(k){
  const name = k.code === "Space" ? "Space" : /^Key[A-Z]$/.test(k.code) ? k.code.slice(3) : /^Digit\d$/.test(k.code) ? k.code.slice(5) : k.code.replace(/^Arrow/, "Arrow ");
  return [k.ctrl && "Ctrl", k.alt && "Alt", k.shift && "Shift", k.meta && (IOS ? "Cmd" : "Win"), name].filter(Boolean).join(" + ");
}
const keyMatch = (e, k) => e.code === k.code && !!e.ctrlKey === !!k.ctrl && !!e.altKey === !!k.alt && !!e.shiftKey === !!k.shift && !!e.metaKey === !!k.meta;
const globalOk = k => !!(k.ctrl || k.alt || k.shift || k.meta) || /^F\d+$/.test(k.code) || /^Media/.test(k.code);
function setGlobalKey(){
  if (!TAURI) return;
  const k = keyPlay();
  const accel = prefs.get("keyGlobal") && globalOk(k) ? [k.ctrl && "Ctrl", k.alt && "Alt", k.shift && "Shift", k.meta && "Super", k.code].filter(Boolean).join("+") : null;
  TAURI.core.invoke("pk_hotkey", { keys: accel }).catch(e => { console.warn(e); if (accel) toast("Windows wouldn't let Pagekeeper use that key in other apps. Another program may already use it; try a different one.", null, 7000); });
}
function playPauseAny(){
  if (S.view === "reader" && S.cur) {
    if (playerMode() === "tts") ttsPlayPause(); else togglePlay();
  } else if (auBook) { if (au.paused) au.play().catch(() => {}); else au.pause(); }
}
if (TAURI) { TAURI.event.listen("pk-hotkey", () => playPauseAny()); setTimeout(setGlobalKey, 0); }

/* ---------- pop-out text ----------
   Windows app: a borderless, always-on-top window you drag anywhere on screen.
   iPhone and browser: a borderless panel you drag around inside Pagekeeper.
   Shows the sentence being read aloud (with the word, in Word mode), otherwise the page you're on. */
// Default: just the text, white with a dark outline (readable on light and dark).
const CAP_DEFAULT = { fg: "#FFFFFF", bg: "#111318", size: 24, style: "clear" };
const capCfg = () => ({ fg: prefs.get("capFg") || CAP_DEFAULT.fg, bg: prefs.get("capBg") || CAP_DEFAULT.bg, size: prefs.get("capSize") || CAP_DEFAULT.size,
  style: prefs.get("capStyle") || CAP_DEFAULT.style, auto: !TAURI && !!prefs.get("capAuto") });
const capNow = { speaking: false, text: "", word: null };
function capPayload(){
  let text = "", hint = "";
  if (capNow.speaking) text = capNow.text;
  else if (S.view === "reader" && S.cur) {
    const c = S.content[S.cur];
    // One sentence at a time: the last one heard on this page, or else the first sentence of the page.
    if (capNow.text && capNow.book === S.cur && capNow.page === S.page) text = capNow.text;
    else if (c && c.kind === "text") { const first = document.querySelector(".page [data-s]"); text = first ? first.textContent.trim() : ""; }
    else if (c && c.kind === "pdf") hint = "Pop-out text works with EPUB and text books, or while a PDF is read aloud.";
  } else hint = "Open a book in Pagekeeper.";
  const playing = capNow.speaking || !!(auBook && !au.paused);
  const page = capMode() === "page";
  return { ...capCfg(), ...(page ? { size: prefs.get("capPSize") || 19, mode: "page", pg: capPage(), gray: prefs.get("capGray") !== false, pclear: prefs.get("capPClear") === true, canRead: S.view === "reader" && !!S.cur } : { mode: "line" }), text, hint, info: capInfo(), locked: !!prefs.get("capLock"), autohide: !!prefs.get("capHide"), hidden: !!prefs.get("capHide") && !playing, showInfo: prefs.get("capInfo") !== false, word: capNow.speaking && (prefs.get("hl") === "word") ? capNow.word : null, speaking: capNow.speaking, playing, audio: !!auBook };
}
/* The whole page in the pop-out: its sentences, and how far into the page the audio or read-aloud is
   (-1: not known, so it's all in color). */
const capMode = () => prefs.get("capMode") === "page" ? "page" : "line";
const CAP_SIZES = { phone: [390, 720, "Phone"], tablet: [640, 860, "Tablet"], book: [540, 760, "Book page"], wide: [940, 560, "Wide"] };
function capPage(){
  if (S.view !== "reader" || !S.cur) return null;
  const c = S.content[S.cur]; if (!c || c.kind !== "text") return null;
  const blocks = (c.pages[S.page - 1] || []).map(([t, x]) => [t === "h" ? 1 : 0, t === "h" ? [x] : splitS(x)]);
  const total = blocks.reduce((a, [, ss]) => a + ss.reduce((n, q) => n + q.length, 0), 0);
  let pos = -1;
  const audioHere = capNow.abook === S.cur && capNow.apage && auBook && auBook.id === S.cur;
  if (audioHere && (!au.paused || !capNow.speaking)) pos = capNow.apage === S.page ? Math.min(total, capNow.apos) : capNow.apage > S.page ? total : 0;
  else if (capNow.speaking && capNow.ttsEl && capNow.ttsEl.isConnected && capNow.book === S.cur && capNow.page === S.page) {
    let n = 0; for (const sp of pageSpans()) { if (sp === capNow.ttsEl) break; n += sp.textContent.length; }
    pos = n + (capNow.lead || 0) + (capNow.word ? capNow.word[0] + capNow.word[1] : 0);
  }
  return { key: S.cur + "|" + S.page, blocks, pos, total, page: S.page, pages: c.pages.length };
}
function capResize(w, h){
  if (TAURI) { TAURI.core.invoke("pk_caption_size", { w, h }).catch(() => {}); return; }
  const f = $("#floatcap"); if (!f) return;
  w = Math.min(w, innerWidth - 16); h = Math.min(h, innerHeight - 24);
  f.style.width = w + "px"; f.style.height = h + "px";
  const r = f.getBoundingClientRect();
  f.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + "px"; f.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top)) + "px";
  prefs.set("capPos", { x: parseInt(f.style.left), y: parseInt(f.style.top) }); prefs.set("capBox", { w, h });
}
function setCapMode(m){
  prefs.set("capMode", m); capSend();
  if (m === "page") capResize(...CAP_SIZES[prefs.get("capPSz") || "tablet"]); else capResize(TAURI ? 560 : 520, TAURI ? 150 : 130);
  if (S.sheet === "type") renderSheet();
}
// Turn the page from the pop-out (the audio keeps going where it is).
async function capTurn(d){
  if (S.view !== "reader" || !S.cur) return;
  if (S.reading && playerMode() === "tts") { ttsGotoPage(d); return; }
  if (followActive()) { S.followHold = true; updateFollowPill(); }
  await goto(S.page + d);
}
// Where in the audiobook a place in the text is read: the exact reverse of how follow-along maps the audio to the text.
function audioAtPos(b, c, pos){
  const ix = textIndex(c), f = pos / ix.total;
  const { off, total } = audioClock(b); if (!total) return null;
  const g = (ti, t) => (off[ti] ?? off[off.length - 1]) + t;
  const manual = ((b.follow && b.follow.pts) || []).map(([ti, t, fr]) => [g(ti, t), fr]);
  const auto = syncPoints(b, ix).map(([ti, t, fr]) => [g(ti, t), fr]).filter(([a, fr]) => manual.every(([ma, mf]) => Math.abs(a - ma) > 30 && (a < ma ? fr <= mf : fr >= mf)));
  let P = (auto.length ? auto.concat(manual) : manual).sort((x, y) => x[0] - y[0]);
  if (auto.length < 2) P = [[0, 0], ...P.filter(p => p[0] > 0 && p[0] < total), [total, 1]];
  const A = P[0], Z = P[P.length - 1], rate = (Z[0] - A[0]) / Math.max(1e-9, Z[1] - A[1]);
  let at;
  if (f <= A[1]) at = A[0] - (A[1] - f) * rate;
  else if (f >= Z[1]) at = Z[0] + (f - Z[1]) * rate;
  else { let i = 0; while (i < P.length - 2 && P[i + 1][1] <= f) i++; const [a0, f0] = P[i], [a1, f1] = P[i + 1]; at = a0 + (f1 > f0 ? (f - f0) / (f1 - f0) : 0) * (a1 - a0); }
  at = Math.max(0, Math.min(total - 0.5, at - 0.15));
  let ti = 0; while (ti < off.length - 2 && off[ti + 1] <= at) ti++;
  return { ti, t: at - off[ti] };
}
// Double-clicked a word in the whole-page pop-out: move the audiobook (or read-aloud) there.
async function capSeek(a){
  const c = S.content[S.cur], b = S.books[S.cur];
  if (S.view !== "reader" || !c || c.kind !== "text" || a.key !== S.cur + "|" + S.page) return;
  const off = Math.max(0, +a.off || 0), pos = textIndex(c).starts[S.page - 1] + off;
  if (b?.audio?.tracks?.length && playerMode() !== "tts") {
    const at = audioAtPos(b, c, pos); if (!at) return;
    S.followHold = false; updateFollowPill();
    if (await loadTrack(at.ti, at.t)) {
      capNow.abook = S.cur; capNow.apage = S.page; capNow.apos = off;
      au.play().catch(() => {}); S.dock = true; updateDock(); followTick(true); capSend();
      if (!followOn()) toast("Turn on Follow in the player so the page colors in as it plays.");
    }
    return;
  }
  // Read aloud: start from the sentence with that word.
  let n = 0, i = -1;
  for (const sp of pageSpans()) { const t = sp.textContent; if (t.trim()) i++; if (n + t.length > off) break; n += t.length; }
  ttsJumpTo(Math.max(0, i));
}
// "Chapter 12 · 3 h 10 min left" under the pop-out text.
function chapterAt(c, page){
  if (!c || c.kind !== "text") return "";
  if (!c._heads) { c._heads = []; c.pages.forEach((blocks, i) => { for (const [t, x] of blocks) if (t === "h" && String(x).trim()) c._heads.push([i + 1, String(x).trim()]); }); }
  let h = ""; for (const [p, x] of c._heads) { if (p > page) break; h = x; }
  return h.length > 48 ? h.slice(0, 46) + "…" : h;
}
function capInfo(){
  if (prefs.get("capInfo") === false || S.view !== "reader" || !S.cur) return "";
  const bits = [], b = S.books[S.cur], ch = chapterAt(S.content[S.cur], S.page);
  if (ch) bits.push(ch);
  if (auBook && auBook.id === S.cur && b?.audio?.tracks?.length) {
    const { off, total } = audioClock(b);
    const m = Math.round(Math.max(0, total - (off[auBook.track] + (au.currentTime || 0))) / (au.playbackRate || 1) / 60);
    bits.push(m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`);
  }
  return bits.join(" · ");
}
function capSend(){
  if (!prefs.get("capOn")) return;
  const p = capPayload();
  if (TAURI) TAURI.event.emitTo("caption", "pk-caption", p).catch(() => {});
  else renderFloatCap(p);
}
function setCaption(on){
  prefs.set("capOn", !!on);
  if (TAURI) TAURI.core.invoke("pk_caption", { show: !!on }).then(() => { if (on && capMode() === "page") capResize(...CAP_SIZES[prefs.get("capPSz") || "tablet"]); }).catch(e => toast("Couldn't open the pop-out: " + esc(String(e))));
  else if (!on) { const f = $("#floatcap"); if (f) f.remove(); }
  capSend();
}
if (TAURI && TAURI.event) {
  TAURI.event.listen("pk-caption-ready", () => capSend());
  TAURI.event.listen("pk-caption-closed", () => { if (prefs.get("capOn")) { prefs.set("capOn", false); if (S.sheet === "type") renderSheet(); } });
  TAURI.event.listen("pk-caption-cmd", e => capCmd(e.payload && e.payload.cmd, e.payload || {}));
}
// The pop-out's right-click menu (on iPhone, press and hold the panel).
function capCmd(cmd, a = {}){
    if (!cmd) return;
    if (cmd === "close") { setCaption(false); if (S.sheet === "type") renderSheet(); return; }
    if (cmd === "play") { playPauseAny(); return; }
    if (cmd === "back") { if (auBook) skipBy(-skipSec()); else if (S.reading) ttsJumpTo(TTS.idx - 1); return; }
    if (cmd === "fwd") { if (auBook) skipBy(skipSec()); else if (S.reading) ttsJumpTo(TTS.idx + 1); return; }
    if (cmd === "seek") { capSeek(a); return; }
    if (cmd === "prevpage" || cmd === "nextpage") { capTurn(cmd === "nextpage" ? 1 : -1); return; }
    if (cmd === "mode") { setCapMode(capMode() === "page" ? "line" : "page"); return; }
    if (cmd.startsWith("size-")) {
      const k = cmd.slice(5); if (!CAP_SIZES[k]) return;
      prefs.set("capPSz", k);
      if (capMode() !== "page") setCapMode("page"); else { capResize(...CAP_SIZES[k]); if (S.sheet === "type") renderSheet(); }
      return;
    }
    if (cmd === "pclear") { prefs.set("capPClear", !prefs.get("capPClear")); capSend(); if (S.sheet === "type") renderSheet(); return; }
    if (cmd === "gray") { prefs.set("capGray", prefs.get("capGray") === false); capSend(); if (S.sheet === "type") renderSheet(); return; }
    if ((cmd === "bigger" || cmd === "smaller") && capMode() === "page") {
      prefs.set("capPSize", Math.max(12, Math.min(40, (prefs.get("capPSize") || 19) + (cmd === "bigger" ? 2 : -2)))); capSend(); return;
    }
    if (cmd === "lock") {
      const on = !prefs.get("capLock"); prefs.set("capLock", on);
      if (on) toast(TAURI ? "Pop-out locked. Clicks go through it now. To unlock, open the player or Aa in Pagekeeper and tap Unlock pop-out." : "Pop-out locked. Taps go through it now. To unlock, tap Unlock pop-out in the player or under Aa.", null, 8000);
      capSend(); if (S.sheet === "type") renderSheet(); if (S.dock) updateDock(); return;
    }
    if (cmd === "autohide") prefs.set("capHide", !prefs.get("capHide"));
    else if (cmd === "info") prefs.set("capInfo", prefs.get("capInfo") === false);
    else if (cmd === "bigger" || cmd === "smaller") prefs.set("capSize", Math.max(12, Math.min(72, capCfg().size + (cmd === "bigger" ? 4 : -4))));
    else if (cmd === "style") prefs.set("capStyle", capCfg().style === "clear" ? "solid" : "clear");
    else if (cmd === "main") { const w = TAURI.window && TAURI.window.getCurrentWindow && TAURI.window.getCurrentWindow(); if (w) (async () => { try { await w.unminimize(); await w.show(); await w.setFocus(); } catch {} })(); return; }
    else return;
    capSend(); if (S.sheet === "type") renderSheet();
}
const capMenuItems = () => {
  const p = capPayload();
  return [p.audio || p.speaking ? ["play", p.playing ? "Pause" : "Play"] : null, p.audio ? ["back", "Back a few seconds"] : null,
    ["mode", p.mode === "page" ? "Show one sentence" : "Show the whole page"],
    ...(p.mode === "page" ? [...Object.entries(CAP_SIZES).map(([k, [, , l]]) => ["size-" + k, (prefs.get("capPSz") || "tablet") === k ? "✓ " + l + " size" : l + " size"]), ["gray", (p.gray ? "✓ " : "") + "Gray until it's read"], ["pclear", (p.pclear ? "✓ " : "") + "No background"]] : []),
    ["bigger", "Bigger text"], ["smaller", "Smaller text"], p.mode === "page" ? null : ["style", p.style === "clear" ? "Show a background" : "Just the text"],
    ["lock", (p.locked ? "✓ " : "") + "Lock in place (taps go through)"], ["autohide", (p.autohide ? "✓ " : "") + "Hide when paused"], ["info", (p.showInfo ? "✓ " : "") + "Show chapter and time left"],
    ["close", "Close pop-out"]].filter(Boolean);
};
function floatCapMenu(x, y){
  closeFloatCapMenu();
  const m = document.createElement("div"); m.id = "fcMenu"; m.setAttribute("role", "menu");
  m.innerHTML = capMenuItems().map(([c, l]) => `<button role="menuitem" data-c="${c}">${esc(l)}</button>`).join("");
  document.body.append(m);
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, x)) + "px";
  m.style.top = Math.max(8, Math.min(innerHeight - m.offsetHeight - 8, y)) + "px";
  m.onclick = e => { const b = e.target.closest("button"); if (!b) return; closeFloatCapMenu(); capCmd(b.dataset.c); };
  setTimeout(() => document.addEventListener("pointerdown", capMenuAway, true), 0);
  m.querySelector("button").focus();
}
function capMenuAway(e){ const m = $("#fcMenu"); if (m && !m.contains(e.target)) closeFloatCapMenu(); }
function closeFloatCapMenu(){ const m = $("#fcMenu"); if (m) m.remove(); document.removeEventListener("pointerdown", capMenuAway, true); }
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#fcMenu")) closeFloatCapMenu(); });
/* In-app floating panel (iPhone and browser). */
function renderFloatCap(p){
  let f = $("#floatcap");
  const pageMode = p.mode === "page" && !!window.PKPage;
  if (f && f.classList.contains("page") !== pageMode) { f.remove(); f = null; }
  if (!f) {
    f = document.createElement("div"); f.id = "floatcap";
    const pos = prefs.get("capPos") || { x: 16, y: 90 };
    f.style.left = pos.x + "px"; f.style.top = pos.y + "px";
    const sz = prefs.get("capBox"); if (sz) { f.style.width = Math.min(sz.w, innerWidth - 16) + "px"; f.style.height = Math.min(sz.h, innerHeight - 24) + "px"; }
    if (pageMode) {
      f.classList.add("page");
      f.innerHTML = `<span class="fc-grip" aria-hidden="true"></span>`;
      f._pp = PKPage.mount(f, { onCmd: (c, a) => capCmd(c, a) });
    } else {
      f.setAttribute("role", "status"); f.setAttribute("aria-live", "polite");
      f.innerHTML = `<div class="fc-text"></div><div class="fc-info"></div><span class="fc-grip" aria-hidden="true"></span>`;
    }
    document.body.append(f);
    // drag anywhere on the panel; drag the corner to resize
    let drag = null, hold = 0;
    f.addEventListener("contextmenu", e => { e.preventDefault(); drag = null; floatCapMenu(e.clientX, e.clientY); });
    f.addEventListener("pointerdown", e => {
      if (e.button === 2) return;
      // the whole page: drag by its top bar (or resize by the corner); the text scrolls and takes double-taps
      if (f.classList.contains("page") && (!e.target.closest(".pp-bar, .fc-grip") || e.target.closest("button"))) return;
      clearTimeout(hold);
      if (e.pointerType !== "mouse") hold = setTimeout(() => { drag = null; floatCapMenu(e.clientX, e.clientY); }, 600);
      const r = f.getBoundingClientRect();
      const resize = e.target.classList.contains("fc-grip");
      drag = { resize, sx: e.clientX, sy: e.clientY, x: r.left, y: r.top, w: r.width, h: r.height };
      f.setPointerCapture(e.pointerId); e.preventDefault();
    });
    f.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 8) clearTimeout(hold);
      if (drag.resize) { f.style.width = Math.max(160, drag.w + dx) + "px"; f.style.height = Math.max(54, drag.h + dy) + "px"; }
      else {
        f.style.left = Math.min(innerWidth - 60, Math.max(-f.offsetWidth + 60, drag.x + dx)) + "px";
        f.style.top = Math.min(innerHeight - 40, Math.max(0, drag.y + dy)) + "px";
      }
    });
    const end = () => {
      clearTimeout(hold);
      if (!drag) return; drag = null;
      prefs.set("capPos", { x: parseInt(f.style.left), y: parseInt(f.style.top) });
      prefs.set("capBox", { w: f.offsetWidth, h: f.offsetHeight });
    };
    f.addEventListener("pointerup", end); f.addEventListener("pointercancel", end);
  }
  f.style.setProperty("--fg", p.fg); f.style.setProperty("--bg", p.bg); f.style.setProperty("--size", p.size + "px");
  f.classList.toggle("speaking", !!p.speaking);
  f.classList.toggle("clear", !pageMode && p.style === "clear");
  f.classList.toggle("auto", !pageMode && !!p.auto);
  f.classList.toggle("locked", !!p.locked);
  f.classList.toggle("gone", !!p.hidden);
  f.classList.toggle("pclear", pageMode && p.pclear === true);
  if (pageMode) { f._pp.update(p); return; }
  const inf = f.querySelector(".fc-info"); inf.textContent = p.info || ""; inf.hidden = !p.info;
  const box = f.querySelector(".fc-text");
  if (!p.text) box.innerHTML = `<span class="fc-hint">${esc(p.hint || "")}</span>`;
  else if (p.word) { const [s, n] = p.word; box.innerHTML = esc(p.text.slice(0, s)) + `<mark>${esc(p.text.slice(s, s + n))}</mark>` + esc(p.text.slice(s + n)); }
  else box.textContent = p.text;
  const m = box.querySelector("mark"); if (m) m.scrollIntoView({ block: "nearest" }); else if (!p.speaking) box.scrollTop = 0;
}

/* ======================================================================================
   Notes & highlights, bookmarks, search, words, people & places, collections, the sleep
   timer, smart rewind, chapters in the player, and AI recaps.
   ====================================================================================== */

/* ---------- where things are in the text ----------
   A place in a book is a character position in its whole text (the same count follow-along uses).
   The page shows each sentence as a <span data-s>; these turn screen selections into positions and back. */
function pageSpans(){ return [...document.querySelectorAll(".page [data-s]")]; }
function pageBase(){ const c = S.content[S.cur]; const ix = c && textIndex(c); return ix && ix.starts ? ix.starts[S.page - 1] : 0; }
function offsetIn(span, node, off){   // characters before (node, off) inside this sentence span
  let n = 0; const w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) { if (t === node) return n + off; n += t.length; }
  return n;
}
function domToPos(node, off){
  const el = (node.nodeType === 3 ? node.parentElement : node)?.closest?.("[data-s]"); if (!el) return null;
  let n = 0; for (const sp of pageSpans()) { if (sp === el) return pageBase() + n + (node.nodeType === 3 ? offsetIn(sp, node, off) : 0); n += sp.textContent.length; }
  return null;
}
function rangeFor(s, e){   // a DOM range for text positions [s, e) on this page, clipped to it
  const base = pageBase(); let n = 0; const r = document.createRange(); let started = false;
  for (const sp of pageSpans()) {
    const len = sp.textContent.length, a = base + n, b = a + len; n += len;
    if (b <= s || a >= e) continue;
    const w = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT); let m = a;
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const ta = m, tb = m + t.length; m = tb;
      if (!started && s < tb) { r.setStart(t, Math.max(0, s - ta)); started = true; }
      if (started && e <= tb) { r.setEnd(t, Math.max(0, e - ta)); return r; }
    }
    if (started) { const last = sp.lastChild; if (last && last.nodeType === 3) r.setEnd(last, last.length); }
  }
  return started ? r : null;
}
function pageTexts(c){   // each page's text, exactly as the page shows it
  if (c._ptext) return c._ptext;
  return (c._ptext = c.pages.map(blocks => blocks.map(([t, x]) => t === "h" ? x : splitS(x).join("")).join("")));
}
function pageOfPos(c, pos){ const st = textIndex(c).starts; let lo = 0, hi = st.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; }

/* ---------- marks: highlights, notes, bookmarks (they sync) ---------- */
const HL_COLORS = { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink" };
const markId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const liveMarks = b => Object.entries((b && b.marks) || {}).filter(([, m]) => !m.del).map(([id, m]) => ({ id, ...m }));
function putMark(bookId, id, m){
  const b = S.books[bookId]; const marks = { ...(b.marks || {}) };
  marks[id] = { ...(marks[id] || {}), ...m, at: Date.now() };
  save(bookId, { marks }); paintMarks();
  if (S.sheet === "toc" && S.bookTab === "notes") renderSheet();
}
const delMark = (bookId, id) => putMark(bookId, id, { del: 1 });
// Draw this page's highlights (CSS highlights leave the text itself untouched).
function paintMarks(){
  if (!window.CSS || !CSS.highlights || !window.Highlight) return;
  for (const k of [...Object.keys(HL_COLORS), "note", "find"]) CSS.highlights.delete("pk-" + k);
  const c = S.content[S.cur]; if (S.view !== "reader" || !c || c.kind !== "text") return;
  const base = pageBase(), end = base + (pageTexts(c)[S.page - 1] || "").length;
  const sets = {};
  for (const m of liveMarks(S.books[S.cur])) {
    if (m.k !== "hl" || m.e <= base || m.s >= end) continue;
    const r = rangeFor(m.s, m.e); if (!r) continue;
    (sets[m.c || "yellow"] ||= []).push(r); if (m.n) (sets.note ||= []).push(r);
  }
  if (S.find && S.find.book === S.cur && S.find.e > base && S.find.s < end) { const r = rangeFor(S.find.s, S.find.e); if (r) sets.find = [r]; }
  for (const [k, rs] of Object.entries(sets)) CSS.highlights.set("pk-" + k, new Highlight(...rs));
}
function markAt(pos){ return liveMarks(S.books[S.cur]).find(m => m.k === "hl" && pos >= m.s && pos < m.e); }
function isBookmarked(){ const c = S.content[S.cur]; if (!c || c.kind !== "text") return liveMarks(S.books[S.cur]).find(m => m.k === "bm" && m.p === S.page); return liveMarks(S.books[S.cur]).find(m => m.k === "bm" && m.p === S.page); }
function toggleBookmark(){
  const b = S.books[S.cur], c = S.content[S.cur]; if (!b) return;
  const on = isBookmarked();
  if (on) { delMark(S.cur, on.id); toast("Bookmark removed."); }
  else {
    const text = c && c.kind === "text" ? (pageTexts(c)[S.page - 1] || "").trim().slice(0, 140) : "";
    putMark(S.cur, markId(), { k: "bm", p: S.page, s: c && c.kind === "text" ? pageBase() : 0, t: text });
    toast("Page bookmarked. Find it under Contents → Notes.");
  }
  paintBookmarkBtn();
}
function paintBookmarkBtn(){ const btn = $("#rMark"); if (!btn) return; const on = !!isBookmarked(); btn.setAttribute("aria-pressed", on); btn.innerHTML = on ? ICON.bmOn : ICON.bm; btn.setAttribute("aria-label", on ? "Remove bookmark" : "Bookmark this page"); }

/* ---------- the selection bar: highlight, note, define, copy, search ---------- */
function selInfo(){
  const sel = window.getSelection && window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0); if (!$("#rMain") || !$("#rMain").contains(r.commonAncestorContainer)) return null;
  let s = domToPos(r.startContainer, r.startOffset), e = domToPos(r.endContainer, r.endOffset); if (s === null || e === null || e <= s) return null;
  const text = r.toString().trim(); if (!text) return null;
  return { s, e, text, rect: r.getBoundingClientRect() };
}
function closeSelBar(){ const x = $("#selbar"); if (x) x.remove(); }
function showSelBar(){
  closeSelBar();
  const info = selInfo(); if (!info) return;
  const one = /^[\p{L}’'-]+(?: [\p{L}’'-]+){0,2}$/u.test(info.text) && info.text.length < 40;
  const bar = document.createElement("div"); bar.id = "selbar"; bar.setAttribute("role", "toolbar");
  bar.innerHTML = `${Object.keys(HL_COLORS).map(k => `<button class="sw sw-${k}" data-hl="${k}" aria-label="Highlight ${HL_COLORS[k].toLowerCase()}"></button>`).join("")}
    <button data-act="note">Note</button>${one ? `<button data-act="define">Define</button>` : ""}<button data-act="copy">Copy</button><button data-act="find">Search</button>`;
  document.body.append(bar);
  const top = info.rect.top - bar.offsetHeight - 10;
  bar.style.top = Math.max(8, top < 8 ? info.rect.bottom + 10 : top) + "px";
  bar.style.left = Math.max(8, Math.min(innerWidth - bar.offsetWidth - 8, info.rect.left + info.rect.width / 2 - bar.offsetWidth / 2)) + "px";
  bar.addEventListener("pointerdown", e => e.preventDefault());   // keep the selection
  bar.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    const sel = window.getSelection(); const page = S.page;
    if (b.dataset.hl) putMark(S.cur, markId(), { k: "hl", s: info.s, e: info.e, p: page, t: info.text.slice(0, 600), c: b.dataset.hl });
    else if (b.dataset.act === "note") noteBox(null, { k: "hl", s: info.s, e: info.e, p: page, t: info.text.slice(0, 600), c: "yellow" });
    else if (b.dataset.act === "define") defineWord(info.text);
    else if (b.dataset.act === "copy") { navigator.clipboard && navigator.clipboard.writeText(info.text).then(() => toast("Copied."), () => {}); }
    else if (b.dataset.act === "find") { S.bookTab = "search"; S.findQ = info.text.slice(0, 80); S.sheet = "toc"; renderSheet(); }
    sel && sel.removeAllRanges(); closeSelBar();
  };
}
document.addEventListener("selectionchange", () => { clearTimeout(showSelBar.t); showSelBar.t = setTimeout(() => { if (S.view === "reader" && selInfo()) showSelBar(); else closeSelBar(); }, 350); });
// Tapping a highlight shows it (and its note), with Edit and Delete.
function markPopup(m){
  const box = document.createElement("div"); box.className = "modal-back";
  box.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${m.n ? "Note" : "Highlight"}</h3>
    <blockquote class="mq hl-${esc(m.c || "yellow")}">${esc(m.t || "")}</blockquote>${m.n ? `<p>${esc(m.n)}</p>` : ""}
    <div class="row" style="justify-content:flex-start;flex-wrap:wrap">${Object.keys(HL_COLORS).map(k => `<button class="sw sw-${k}" data-c="${k}" aria-label="${HL_COLORS[k]}" aria-pressed="${(m.c || "yellow") === k}"></button>`).join("")}
      <button class="btn" data-note>${m.n ? "Edit note" : "Add note"}</button><button class="btn danger" data-del>Delete</button><button class="btn" data-x>Close</button></div></div>`;
  box.addEventListener("click", e => {
    if (e.target === box || e.target.closest("[data-x]")) box.remove();
    const c = e.target.closest("[data-c]"); if (c) { putMark(S.cur, m.id, { c: c.dataset.c }); box.remove(); }
    if (e.target.closest("[data-note]")) { box.remove(); noteBox(m.id, m); }
    if (e.target.closest("[data-del]")) { box.remove(); delMark(S.cur, m.id); toast("Deleted."); }
  });
  document.body.append(box);
}
function noteBox(id, m){
  const box = document.createElement("div"); box.className = "modal-back";
  box.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>Note</h3><blockquote class="mq">${esc(m.t || "")}</blockquote>
    <textarea id="noteIn" rows="4" style="width:100%;box-sizing:border-box" placeholder="Your note">${esc(m.n || "")}</textarea>
    <div class="row"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div></div>`;
  box.addEventListener("click", e => {
    if (e.target === box || e.target.closest("[data-x]")) box.remove();
    if (e.target.closest("[data-ok]")) { const n = $("#noteIn", box).value.trim(); box.remove(); putMark(S.cur, id || markId(), { ...m, n }); toast("Note saved."); }
  });
  document.body.append(box); $("#noteIn", box).focus();
}
function exportNotes(bookId){
  const b = S.books[bookId], ms = liveMarks(b).sort((x, y) => (x.s || 0) - (y.s || 0));
  const lines = [`${b.title}${b.author ? " — " + b.author : ""}`, `Notes and highlights from Pagekeeper, ${new Date().toLocaleDateString()}`, ""];
  for (const m of ms) {
    if (m.k === "bm") lines.push(`[Bookmark] page ${m.p}`);
    else lines.push(`Page ${m.p}: “${m.t}”` + (m.n ? `\n  Note: ${m.n}` : ""));
    lines.push("");
  }
  const vs = Object.values(b.vocab || {}).filter(v => !v.del);
  if (vs.length) { lines.push("Words looked up:"); for (const v of vs) lines.push(`- ${v.w}: ${v.d}`); }
  return lines.join("\n");
}

/* ---------- search inside the book ---------- */
function searchBook(c, q){
  const out = []; if (!q || q.trim().length < 2) return out;
  const needle = q.trim().toLowerCase(), pt = pageTexts(c), st = textIndex(c).starts;
  for (let p = 0; p < pt.length && out.length < 300; p++) {
    const low = pt[p].toLowerCase(); let i = low.indexOf(needle);
    while (i >= 0 && out.length < 300) {
      out.push({ page: p + 1, s: st[p] + i, e: st[p] + i + needle.length, snip: pt[p].slice(Math.max(0, i - 50), i + needle.length + 70) });
      i = low.indexOf(needle, i + needle.length);
    }
  }
  return out;
}
async function jumpTo(pos, len = 0){
  const c = S.content[S.cur]; if (!c) return;
  S.find = { book: S.cur, s: pos, e: pos + Math.max(1, len) };
  S.sheet = null; renderSheet();
  if (followActive()) S.followHold = true;
  await goto(pageOfPos(c, pos), true);
  paintMarks();
  const r = rangeFor(pos, pos + Math.max(1, len)); if (r) { const el = r.startContainer.parentElement; el && el.scrollIntoView({ block: "center" }); }
  setTimeout(() => { if (S.find && S.find.s === pos) { S.find = null; paintMarks(); } }, 6000);
}
// Where in the audiobook a place in the text is read (needs automatic sync).
function audioForPos(b, c, pos){
  const ix = textIndex(c), pts = syncPoints(b, ix); if (!pts.length) return null;
  const f = pos / ix.total; let best = null;
  for (const p of pts) { if (p[2] <= f) best = p; else break; }
  return best ? { ti: best[0], t: best[1] } : { ti: pts[0][0], t: pts[0][1] };
}
async function playFromPos(pos){
  const b = S.books[S.cur], c = S.content[S.cur]; const a = b && c && audioForPos(b, c, pos); if (!a) return false;
  S.followHold = false;
  if (await loadTrack(a.ti, a.t)) { au.play().catch(() => {}); S.dock = true; updateDock(); followTick(true); }
  return true;
}

/* ---------- words: definitions and a word list ---------- */
async function defineWord(word){
  const w = word.toLowerCase().replace(/[’']s$/, "");
  const box = document.createElement("div"); box.className = "modal-back";
  box.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(w)}</h3><div id="defBody"><p class="note">Looking it up…</p></div>
    <div class="row"><button class="btn" data-x>Close</button><button class="btn primary" data-save disabled>Save to my words</button></div></div>`;
  box.addEventListener("click", e => { if (e.target === box || e.target.closest("[data-x]")) box.remove(); });
  document.body.append(box);
  let first = "";
  try {
    const r = await Native.text(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
    const j = JSON.parse(r.text);
    if (!Array.isArray(j) || !j.length) throw new Error("none");
    const e0 = j[0], ph = (e0.phonetics || []).map(p => p.text).find(Boolean) || e0.phonetic || "";
    const means = j.flatMap(e => e.meanings || []).slice(0, 4);
    first = (means[0] && means[0].definitions && means[0].definitions[0] && means[0].definitions[0].definition) || "";
    $("#defBody", box).innerHTML = `${ph ? `<p class="note">${esc(ph)}</p>` : ""}${means.map(m => `<p><i>${esc(m.partOfSpeech || "")}</i> ${esc(((m.definitions || [])[0] || {}).definition || "")}</p>`).join("")}`;
    $("[data-save]", box).disabled = false;
  } catch {
    $("#defBody", box).innerHTML = `<p class="note">Not in the dictionary${navigator.onLine === false ? " (you're offline)" : ""}, so here's what this book says.</p>`;
  }
  // The book itself: its own glossary entry if it has one, then where the word has come up so far.
  const c = S.content[S.cur];
  if (c && c.kind === "text") {
    const inBook = document.createElement("div"); inBook.className = "inbook"; $("#defBody", box).after(inBook);
    const g = glossaryEntry(c, word), hits = mentionsSoFar(c, word);
    if (!first && g) first = g.slice(0, 300);
    inBook.innerHTML = `${g ? `<h4>In the book's glossary</h4><p>${esc(g.slice(0, 700))}</p>` : ""}
      <h4>In this book so far</h4>${hits.length ? `<ul class="toc">${hits.map((h, i) => `<li><button data-hit="${i}"><span class="snip">${esc(h.snip)}</span><span>${h.page}</span></button></li>`).join("")}</ul>` : `<p class="note">It hasn't come up yet before this point.</p>`}
      ${hits.length && aiReady(aiPick()) ? `<div class="row-btns"><button class="btn" data-explain>Explain from the book (${esc(AI[aiPick()].name)})</button></div><div class="explain"></div>` : ""}`;
    inBook.querySelectorAll("[data-hit]").forEach(x => x.onclick = () => { const h = hits[+x.dataset.hit]; box.remove(); jumpTo(h.s, h.e - h.s); });
    const ex = inBook.querySelector("[data-explain]"); if (ex) ex.onclick = async () => {
      ex.disabled = true; ex.textContent = "Asking…"; const out = inBook.querySelector(".explain");
      try {
        const passages = hits.map(h => h.wide).join("\n---\n");
        const ans = await aiAsk(aiPick(), { maxTokens: 400, effort: "low",
          system: "Explain what a word or term means in this book, using only the passages given (they come from the part the reader has already read). Answer in one to three plain sentences. If the passages don't make it clear, say what they suggest. Never add anything from later in the book or from outside knowledge of the plot.",
          user: `Book: ${S.books[S.cur].title}\nTerm: ${word}\n\nPassages:\n${passages}` });
        out.innerHTML = `<p>${esc(ans)}</p>`; if (!first) first = ans.slice(0, 300); $("[data-save]", box).disabled = false;
      } catch (e) { out.innerHTML = `<p class="note">${esc(String(e.message || e))}</p>`; }
      ex.hidden = true;
    };
    if (g || hits.length) $("[data-save]", box).disabled = false;
  }
  $("[data-save]", box).onclick = () => {
    const b = S.books[S.cur]; const vocab = { ...(b.vocab || {}) };
    vocab[w] = { w, d: first.slice(0, 300), p: S.page, at: Date.now() };
    save(S.cur, { vocab }); box.remove(); toast(`Saved “${esc(w)}” to your words (Contents → Words).`);
  };
}

// A book's own glossary entry for a term: a paragraph that starts with it ("FREMEN: the free tribes…").
function glossaryEntry(c, word){
  const w = word.trim(); if (w.length < 3) return "";
  // the term itself, then maybe a pronunciation in brackets, then a colon or dash: "FREMEN: the free tribes…"
  const re = new RegExp("^" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "\\s*(\\([^)]{0,40}\\))?\\s*[:—–]\\s*\\S", "i");
  let best = "";
  for (const blocks of c.pages) for (const [t, x] of blocks) {
    if (t === "h" || x.length > 1500 || !re.test(x)) continue;
    if (x.slice(0, w.length) === w.toUpperCase()) return x.trim();   // a glossary written in capitals: the best match
    if (!best) best = x.trim();
  }
  return best;
}
// Where a word comes up, only up to the end of the page you're on: the first time and the latest few.
function mentionsSoFar(c, word){
  const all = searchBook(c, word).filter(h => h.page <= S.page);
  const pick = all.length > 7 ? [all[0], ...all.slice(-6)] : all;
  const pt = pageTexts(c), st = textIndex(c).starts;
  return pick.map(h => { const i = h.s - st[h.page - 1], t = pt[h.page - 1]; return { ...h, wide: t.slice(Math.max(0, i - 400), i + 400) }; });
}
/* ---------- people & places: names that have come up so far (never further than you've read) ---------- */
const NAME_STOP = new Set(("I A An The He She It They We You Your My Our His Her Its Their This That These Those There Here Then When Where What Who Why How " +
  "But And Or Nor For So Yet If Not No Yes Oh Ah Well Now Still Even Just Only All Some Any Each Every One Two Three Mr Mrs Ms Dr Sir Lady Lord " +
  "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December " +
  "Chapter Part Book Prologue Epilogue After Before As At By In On Of To From With Without Into Upon Through Then Again Perhaps Maybe Let Do Did Does Is Was Are Were Be Been Have Had Has Can Could Would Should Will Shall Must Might").split(" "));
function namesSoFar(c, upto){
  const key = S.cur + ":" + upto; if (namesSoFar.cache && namesSoFar.cache.key === key) return namesSoFar.cache.list;
  const pt = pageTexts(c), st = textIndex(c).starts, found = new Map();
  // a capitalized word (up to three in a row); an apostrophe only inside a name like Muad’Dib,
  // so “I’m” and “It’s” don't count and “Duke’s” counts as “Duke”
  const RE = /(^|[^\p{L}’'])(\p{Lu}\p{Ll}+(?:[’']\p{Lu}\p{Ll}+)?(?:[ -]\p{Lu}\p{Ll}+(?:[’']\p{Lu}\p{Ll}+)?){0,2})(?!\p{Ll}|[’']\p{Ll}{2}|[’'][md]\b)/gu;
  for (let p = 0; p < Math.min(upto, pt.length); p++) {
    for (const m of pt[p].matchAll(RE)) {
      const name = m[2], at = m.index + m[1].length;
      const before = pt[p].slice(Math.max(0, at - 3), at);
      if (/^$|[.!?…]["'”’)\]]?\s*$|^\s*$/.test(before) && !/\p{L}/u.test(before)) continue;   // first word of a sentence: could be any word
      if (/[.!?…]["'”’)\]]?\s+$/.test(before)) continue;
      const words = name.split(/[ -]/); if (words.every(w => NAME_STOP.has(w))) continue;
      const clean = NAME_STOP.has(words[0]) && words.length > 1 ? words.slice(1).join(" ") : name;
      const e = found.get(clean) || { name: clean, n: 0, first: p + 1, hits: [] };
      e.n++; if (e.hits.length < 600) e.hits.push(st[p] + at);
      found.set(clean, e);
    }
  }
  const list = [...found.values()].filter(e => e.n >= 3).sort((a, b) => b.n - a.n).slice(0, 80);
  namesSoFar.cache = { key, list };
  return list;
}

/* ---------- collections (and a book's number in its series) ---------- */
const shelvesOf = b => (b && b.shelves) || [];
const allShelves = () => [...new Set(Object.values(S.books).filter(b => !b.deleted && b.kind === "book").flatMap(shelvesOf))].sort(natural);
function shelfBox(id){
  const b = S.books[id]; const mine = new Set(shelvesOf(b));
  const box = document.createElement("div"); box.className = "modal-back";
  const draw = () => {
    box.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>Collections</h3>
      <p class="note">Group books into collections, like a series or “To read”. A book can be in several.</p>
      <div class="shelflist">${[...new Set([...allShelves(), ...mine])].map(n => `<label class="check"><input type="checkbox" data-sh="${esc(n)}" ${mine.has(n) ? "checked" : ""}> ${esc(n)}</label>`).join("") || `<p class="note">No collections yet.</p>`}</div>
      <div class="row" style="justify-content:flex-start"><input id="shNew" placeholder="New collection, e.g. Dune series" style="flex:1;min-width:0"><button class="btn" data-add>Add</button></div>
      <label class="field" style="display:block;margin-top:10px">Number in its series <input id="shNo" type="number" min="0" step="0.5" value="${b.seriesNo ?? ""}" placeholder="e.g. 3" style="width:90px"></label>
      <p class="note">With a number, the recap includes the earlier books of the series.</p>
      <div class="row"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div></div>`;
  };
  draw();
  box.addEventListener("click", e => {
    if (e.target === box || e.target.closest("[data-x]")) box.remove();
    const cb = e.target.closest("[data-sh]"); if (cb) { if (cb.checked) mine.add(cb.dataset.sh); else mine.delete(cb.dataset.sh); }
    if (e.target.closest("[data-add]")) { const n = $("#shNew", box).value.trim().slice(0, 60); if (n) { mine.add(n); const no = $("#shNo", box).value; draw(); $("#shNo", box).value = no; } }
    if (e.target.closest("[data-ok]")) {
      const no = $("#shNo", box).value.trim();
      save(id, { shelves: [...mine].sort(natural), seriesNo: no === "" ? null : +no }); box.remove(); render();
    }
  });
  document.body.append(box);
}

/* ---------- sleep timer and smart rewind ---------- */
const SLEEP = { end: 0, chapter: false, fade: null };
function sleepLeft(){ return SLEEP.end ? Math.max(0, SLEEP.end - Date.now()) : 0; }
function setSleep(v){
  clearInterval(SLEEP.fade); SLEEP.fade = null;
  if (v === "off") { SLEEP.end = 0; SLEEP.chapter = false; toast("Sleep timer off."); }
  else if (v === "chapter") { SLEEP.end = 0; SLEEP.chapter = true; SLEEP.chapAt = nextChapterStop(); toast("Stops at the end of this chapter."); }
  else { SLEEP.chapter = false; SLEEP.end = Date.now() + (+v) * 60000; toast(`Stops in ${v} minutes.`); }
  if (S.dock) updateDock();
}
// The text position where the current chapter ends (for "end of chapter").
function nextChapterStop(){
  const c = S.content[S.cur]; if (!c || c.kind !== "text" || !c.toc) return null;
  const nxt = c.toc.find(t => t.page > S.page); if (!nxt) return null;
  return { page: nxt.page, pos: textIndex(c).starts[nxt.page - 1] };
}
function sleepNow(){
  const playing = (auBook && !au.paused) || (S.reading && !TTS.paused);
  SLEEP.end = 0; SLEEP.chapter = false;
  if (!playing) { if (S.dock) updateDock(); return; }
  if (auBook && !au.paused) {
    // fade out over about 8 seconds, then pause
    const vol = au.volume; let k = 0;
    SLEEP.fade = setInterval(() => { k++; au.volume = Math.max(0, vol * (1 - k / 16)); if (k >= 16) { clearInterval(SLEEP.fade); SLEEP.fade = null; au.pause(); au.volume = vol; if (S.dock) updateDock(); } }, 500);
  } else if (S.reading && !TTS.paused) ttsPlayPause();
  toast("Sleep timer: stopped.", null, 6000);
}
setInterval(() => {
  if (SLEEP.end && Date.now() >= SLEEP.end) sleepNow();
  if (SLEEP.chapter && SLEEP.chapAt) {
    const c = S.content[S.cur];
    let past = S.page >= SLEEP.chapAt.page;
    if (auBook && auBook.id === S.cur && c && c.kind === "text" && S.books[S.cur].sync) past = S.page >= SLEEP.chapAt.page;
    if (past) sleepNow();
  }
  const el = $("#sleepLeft"); if (el) el.textContent = SLEEP.end ? fmtClock(sleepLeft()) : SLEEP.chapter ? "end of chapter" : "";
}, 1000);
const fmtClock = ms => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
function sleepRow(){
  const cur = SLEEP.end ? "time" : SLEEP.chapter ? "chapter" : "off";
  return `<div class="pl-row"><label>Sleep</label><div class="chips">${[["off", "Off"], ["15", "15 min"], ["30", "30 min"], ["60", "1 h"], ["chapter", "End of chapter"]].map(([v, l]) => `<button class="chip" data-sleep="${v}" aria-pressed="${(v === "off" && cur === "off") || (v === "chapter" && cur === "chapter")}">${l}</button>`).join("")}</div><span class="note" id="sleepLeft">${SLEEP.end ? fmtClock(sleepLeft()) : SLEEP.chapter ? "end of chapter" : ""}</span></div>`;
}
// Smart rewind: after a pause, back up a little so you catch the end of the last sentence.
let pausedAt = 0;
au.addEventListener("pause", () => { if (!au.seeking && !au.ended) pausedAt = Date.now(); });
au.addEventListener("play", () => {
  if (!pausedAt || prefs.get("smartRewind") === false) return;
  const gap = (Date.now() - pausedAt) / 1000; pausedAt = 0;
  const back = gap < 5 ? 0 : gap < 60 ? 2 : gap < 600 ? 5 : gap < 3600 ? 10 : 20;
  if (back && au.currentTime > back) au.currentTime -= back;
});
// Chapters in the player: the book's own chapters, placed in the audio by automatic sync.
function chapterRow(b){
  const c = S.content[S.cur]; if (!c || c.kind !== "text" || !c.toc || !c.toc.length || !syncPoints(b, textIndex(c)).length) return "";
  const st = textIndex(c).starts, cur = c.toc.reduce((acc, t, i) => t.page <= S.page ? i : acc, 0);
  return `<div class="pl-row"><label>Chapter</label><select id="chapSel" aria-label="Jump to a chapter">${c.toc.map((t, i) => `<option value="${st[t.page - 1]}" ${i === cur ? "selected" : ""}>${esc(t.title.slice(0, 60))}</option>`).join("")}</select></div>`;
}
function bindExtrasDock(){
  document.querySelectorAll("[data-sleep]").forEach(b => b.onclick = () => setSleep(b.dataset.sleep));
  const cs = $("#chapSel"); if (cs) cs.onchange = () => { const pos = +cs.value; jumpTo(pos); playFromPos(pos); };
}

/* ---------- AI recap: what's happened in the series so far, never past where you are ----------
   Each chapter you've read is summarized once (and kept on this device); the recap is then written from
   those summaries plus the text of the chapter you're in, up to the end of your page. Earlier books in the
   series come from their own chapter summaries if they're in your library.
   You choose the AI in Settings: Claude (through Anthropic's official SDK), or Google Gemini, Groq,
   OpenRouter, Mistral (their OpenAI-style chat endpoint), or Ollama running on this PC. Requests go straight
   from this device to the service you chose, with your key. */
const AI = {
  claude:     { name: "Claude (Anthropic)", free: false, keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…",
                models: [["claude-opus-5-5", "Claude Opus 5.5 (best)"], ["claude-sonnet-5-5", "Claude Sonnet 5.5 (half the price)"], ["claude-haiku-5-5", "Claude Haiku 5.5 (about 1/40 the price)"]],
                def: "claude-opus-5-5", chunk: 60000, together: 3,
                note: "Pay as you go, billed to your Anthropic account. Anthropic doesn't train on API data by default." },
  gemini:     { name: "Google Gemini", free: true, keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza…",
                base: "https://generativelanguage.googleapis.com/v1beta/openai", def: "gemini-flash-latest", chunk: 120000, together: 1,
                note: "Free with daily limits (the Flash models). Google may use free-tier requests to improve its products." },
  groq:       { name: "Groq", free: true, keyUrl: "https://console.groq.com/keys", keyHint: "gsk_…",
                base: "https://api.groq.com/openai/v1", def: "llama-3.3-70b-versatile", chunk: 14000, together: 1,
                note: "Free with per-minute and daily limits, so a first recap of a long book takes a while." },
  openrouter: { name: "OpenRouter", free: true, keyUrl: "https://openrouter.ai/settings/keys", keyHint: "sk-or-…",
                base: "https://openrouter.ai/api/v1", def: "", chunk: 60000, together: 1, freeOnly: true,
                note: "Free models (their names end in :free) have about 50 requests a day. Pick a model below. Some free models' providers may keep or train on what you send." },
  mistral:    { name: "Mistral", free: true, keyUrl: "https://console.mistral.ai/api-keys", keyHint: "",
                base: "https://api.mistral.ai/v1", def: "mistral-small-latest", chunk: 60000, together: 1,
                note: "Free mode with rate limits. Mistral may use free-mode requests for training unless you opt out in its admin settings." },
  ollama:     { name: "Ollama (on this PC)", free: true, local: true, keyUrl: "https://ollama.com/download", keyHint: "",
                base: "http://localhost:11434", def: "", chunk: 24000, together: 1,
                note: "Free and private: the book never leaves your PC. Needs Ollama running with a model pulled (for example: ollama pull llama3.1). Slower, and Windows only." },
};
const aiPick = () => AI[prefs.get("aiProvider")] ? prefs.get("aiProvider") : "claude";
const aiKey = p => p === "claude" ? prefs.get("claudeKey") : prefs.get("aiKey_" + p);
const aiModel = p => prefs.get("aiModel_" + p) || AI[p].def;
const aiReady = p => (AI[p].local || !!aiKey(p)) && !!aiModel(p) && !(AI[p].local && !TAURI);
let ClaudeSDK = null;
async function claudeClient(){
  const key = aiKey("claude"); if (!key) throw new Error("Add your Anthropic API key in Settings first.");
  if (!ClaudeSDK) ClaudeSDK = (await import("./vendor/anthropic-sdk.js")).default;
  return new ClaudeSDK({ apiKey: key, dangerouslyAllowBrowser: true });
}
// A web request through the app (so services that refuse requests from web pages still work).
async function aiHttp(method, url, headers, body){
  if (TAURI) return tauriInvoke("pk_http", { method, url, headers, body: body == null ? null : body }).catch(e => { throw new Error(typeof e === "string" ? e : (e && e.message) || "The request failed."); });
  if (IOS) return Native.call({ op: "http", method, url, headers, body: body == null ? undefined : body });
  const r = await fetch(url, { method, headers: Object.fromEntries(headers), body: body == null ? undefined : body });
  return { status: r.status, text: await r.text() };
}
const aiWait = ms => new Promise(r => setTimeout(r, ms));
// One question to the chosen AI: system + user text in, the answer's text out. Waits and retries on a rate limit.
async function aiAsk(p, { system, user, maxTokens, effort, onWait }){
  if (p === "claude") {
    const client = await claudeClient(), model = aiModel("claude"), haiku = /haiku/.test(model);
    const res = await client.beta.messages.create({
      model, max_tokens: maxTokens,
      ...(haiku ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),   // a refused request is retried on another model
      output_config: { effort }, system, messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude declined this text.");
    return res.content.filter(x => x.type === "text").map(x => x.text).join("").trim();
  }
  const A = AI[p], key = aiKey(p), model = aiModel(p);
  const local = A.local;
  const url = local ? `${A.base}/api/chat` : `${A.base}/chat/completions`;
  const payload = local
    ? { model, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }], options: { num_ctx: 16384 } }
    : { model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }],
        // Gemini's Flash models think before answering; for summaries a little thinking is plenty, and much quicker
        ...(p === "gemini" ? { reasoning_effort: effort === "low" ? "low" : "medium" } : {}) };
  const headers = [["Content-Type", "application/json"], ...(key ? [["Authorization", "Bearer " + key]] : [])];
  for (let attempt = 0; ; attempt++) {
    const r = await aiHttp("POST", url, headers, JSON.stringify(payload));
    let j = null; try { j = JSON.parse(r.text); } catch {}
    if (Array.isArray(j)) j = j[0];   // Google's OpenAI-style errors come wrapped in a list
    // the service's own explanation, whatever shape it comes in
    const said = String((j && (j.error && (j.error.message || (typeof j.error === "string" ? j.error : "")) || j.message || j.detail)) || r.text || "").replace(/\s+/g, " ").trim().slice(0, 280);
    if (r.status === 429 || r.status === 503) {
      if (attempt >= 5) throw new Error(`${A.name} says you've reached its free limit for now. Try again later (daily limits reset overnight).${said ? ` (${said})` : ""}`);
      const wait = 20000 * (attempt + 1); onWait && onWait(Math.round(wait / 1000)); await aiWait(wait); continue;
    }
    if (r.status === 400 && payload.reasoning_effort && /reasoning/i.test(said)) { delete payload.reasoning_effort; continue; }   // a model that doesn't think: ask again without it
    if (r.status === 402) throw new Error(p === "gemini"
      ? `Google says payment is needed (402). This usually means the Google project your key belongs to has billing turned on with no credit, so Google charges every request instead of using the free tier. Fix: in AI Studio (aistudio.google.com/apikey), choose Create API key → in a new project (one without billing), paste that key here, and use a Flash model.${said ? ` Google said: ${said}` : ""}`
      : `${A.name} says payment is needed (402): this model or your account isn't free.${said ? ` It said: ${said}` : ""}`);
    if (r.status === 401 || r.status === 403) throw new Error(`${A.name} didn't accept the key (${r.status}). Check it in Settings.${said ? ` It said: ${said}` : ""}`);
    if (r.status === 404) throw new Error(`${A.name} doesn't know the model “${model}”. Load the list in Settings and pick another.${said ? ` (${said})` : ""}`);
    if (r.status >= 400) throw new Error(`${A.name} (error ${r.status}): ${said || "no details"}`);
    const text = local ? j && j.message && j.message.content : j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (typeof text !== "string") throw new Error(`${A.name} sent back an answer Pagekeeper couldn't read.`);
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();   // some local models write their reasoning first
  }
}
// The models a service offers (for the dropdown in Settings).
async function aiModels(p){
  if (p === "claude") return AI.claude.models.map(m => m[0]);
  const A = AI[p], key = aiKey(p);
  const r = await aiHttp("GET", A.local ? `${A.base}/api/tags` : `${A.base}/models`, key ? [["Authorization", "Bearer " + key]] : [], null);
  if (r.status === 401 || r.status === 403) throw new Error(`${A.name} didn't accept the key.`);
  if (r.status >= 400) throw new Error(`${A.name} answered ${r.status}.`);
  const j = JSON.parse(r.text);
  let ids = A.local ? (j.models || []).map(m => m.name) : (j.data || []).map(m => String(m.id || "").replace(/^models\//, ""));
  if (A.freeOnly) ids = ids.filter(id => /:free$/.test(id));
  if (p === "gemini") ids = ids.filter(id => /gemini/.test(id) && !/embedding|image|tts|audio|live/.test(id));
  return ids.sort();
}
const textOfPages = (c, a, b) => c.pages.slice(a - 1, b).map(blocks => blocks.map(([t, x]) => t === "h" ? "\n## " + x + "\n" : x).join("\n\n")).join("\n\n");
// The book in chapters (long ones split to suit the service), up to and including page `upto`.
function recapUnits(c, upto, chunk = 60000){
  const toc = c.toc && c.toc.length ? c.toc : [{ title: "Start", page: 1 }], pt = pageTexts(c), units = [];
  toc.forEach((t, i) => {
    if (t.page > upto) return;
    const chapEnd = toc[i + 1] ? toc[i + 1].page - 1 : c.pages.length;
    const whole = chapEnd <= upto;   // a finished chapter is summarized; the one you are in is read as it is
    const end = Math.min(upto, chapEnd);
    for (let a = t.page; a <= end;) {
      let b = a, len = 0; while (b <= end && len < chunk) { len += (pt[b - 1] || "").length; b++; }
      units.push({ title: t.title, a, b: b - 1, whole }); a = b;
    }
  });
  // A service that takes in a lot at once (Gemini) gets neighbouring finished chapters together: fewer requests.
  if (chunk > 100000) {
    const merged = [];
    for (const u of units) { const l = merged[merged.length - 1];
      if (l && l.whole && u.whole && textOfPages(c, l.a, u.b).length < chunk) { l.b = u.b; l.title = l.title.split(" – ")[0] + " – " + u.title; } else merged.push({ ...u }); }
    return merged;
  }
  return units;
}
const sumKey = (bookId, u, c) => `__sum_${bookId}_${u.a}_${u.b}_${(textIndex(c).total)}`;
const SUM_SYS = "You write chapter summaries that a reader will use to remember a book. Cover what happens, who is involved, what changes, and any reveals, in plain prose of 120 to 220 words (longer if the text covers several chapters: about 150 words per chapter). Use only this text; don't add anything from outside it. If the text is front matter (copyright, praise, contents, dedication), reply with exactly: FRONT MATTER";
async function summarizeUnit(p, book, c, u, onWait){
  const text = textOfPages(c, u.a, u.b);
  if (text.length < 1500) return text.trim();   // short enough to use as it is
  return aiAsk(p, { system: SUM_SYS, user: `Book: ${book.title}${book.author ? " by " + book.author : ""}\nSection: ${u.title} (pages ${u.a}–${u.b})\n\n<text>\n${text}\n</text>`, maxTokens: 3000, effort: "low", onWait });
}
// Earlier books of the same series in the library (same collection, lower number).
function seriesBefore(b){
  if (b.seriesNo == null || !shelvesOf(b).length) return [];
  return Object.entries(S.books).filter(([id, x]) => x !== b && !x.deleted && x.kind === "book" && x.seriesNo != null && x.seriesNo < b.seriesNo && shelvesOf(x).some(s => shelvesOf(b).includes(s)))
    .sort((a, z) => a[1].seriesNo - z[1].seriesNo);
}
const CLAUDE_PRICE = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
async function recapPlan(id){
  const b = S.books[id], c = await loadContent(id), p = aiPick(), chunk = AI[p].chunk;
  if (!c || c.kind !== "text") return { err: "Recaps work with EPUB and text books." };
  const parts = [];
  for (const [pid, pb] of seriesBefore(b)) {
    let pc = null; try { pc = await loadContent(pid); } catch {}
    if (pc && pc.kind === "text") parts.push({ id: pid, book: pb, c: pc, units: recapUnits(pc, pc.pages.length, chunk), prev: true });
  }
  const units = recapUnits(c, S.page, chunk);
  parts.push({ id, book: b, c, units: units.filter(u => u.whole), live: units.filter(u => !u.whole), prev: false });
  let newChars = 0, cached = 0, total = 0, asks = 0;
  for (const q of parts) for (const u of q.units) { total++; if (await idb.get(sumKey(q.id, u, q.c))) cached++; else { const n = textOfPages(q.c, u.a, u.b).length; newChars += n; if (n >= 1500) asks++; } }
  const missing = b.seriesNo != null ? Math.max(0, Math.ceil(b.seriesNo) - 1 - parts.filter(q => q.prev).length) : 0;
  const price = CLAUDE_PRICE[aiModel("claude")] || [4, 20];
  const cost = p === "claude" ? newChars / 4 / 1e6 * price[0] + asks * 300 / 1e6 * price[1] + 0.01 + 15000 / 1e6 * price[0] : 0;
  return { parts, newChars, cached, total, asks: asks + 1, missing, cost, p };
}
const RECAP = { busy: false, text: "", page: 0, status: "" };
const AI_LISTS = {};
function aiSettingsHTML(){
  const p = aiPick(), A = AI[p], host = A.keyUrl.replace(/^https?:\/\//, "").split("/")[0], key = aiKey(p), list = AI_LISTS[p], model = aiModel(p);
  return `<div class="aipick">${Object.entries(AI).map(([k, x]) => `<label class="check"><input type="radio" name="aiProv" value="${k}" ${p === k ? "checked" : ""} ${x.local && !TAURI ? "disabled" : ""}> ${esc(x.name)}${x.free ? ` <span class="tag">free</span>` : ""}${x.local && !TAURI ? ` <span class="note">(Windows app only)</span>` : ""}</label>`).join("")}</div>
    <p class="note">${esc(A.note)} ${A.local ? `Get it at <a href="${A.keyUrl}" target="_blank" rel="noopener">${host}</a>.` : `Get a key at <a href="${A.keyUrl}" target="_blank" rel="noopener">${host}</a>. The key stays on this device.`}</p>
    ${A.local ? "" : `<div class="row-btns"><input id="aiKeyIn" type="password" autocomplete="off" placeholder="${key ? "Key saved · paste a new one to replace it" : esc(A.keyHint || "API key")}" style="flex:1;min-width:200px"><button class="btn primary" id="aiKeySave">Save key</button>${key ? `<button class="btn" id="aiKeyDel">Remove</button>` : ""}</div>`}
    <div class="row-btns"><label style="align-self:center">Model</label>
      ${p === "claude" ? `<select id="aiModelSel">${AI.claude.models.map(([id, l]) => `<option value="${id}" ${model === id ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`
        : list ? `<select id="aiModelSel">${list.includes(model) ? "" : `<option value="">Choose a model</option>`}${list.map(id => `<option value="${esc(id)}" ${model === id ? "selected" : ""}>${esc(id)}</option>`).join("")}</select>`
        : `<input id="aiModelIn" value="${esc(model)}" placeholder="${A.freeOnly ? "load the list and pick a :free model" : "model name"}" style="flex:1;min-width:160px"><button class="btn" id="aiList">Load the list</button>`}
      <button class="btn" id="aiTest">Test it</button></div>`;
}
function bindAiSettings(el){
  el.querySelectorAll('[name="aiProv"]').forEach(r => r.onchange = () => { prefs.set("aiProvider", r.value); renderSettings(el); });
  const p = aiPick();
  const ks = $("#aiKeySave"); if (ks) ks.onclick = () => {
    const v = $("#aiKeyIn").value.trim(); if (!v) return;
    if (p === "claude" && !/^sk-ant-/.test(v)) { toast("That doesn't look like an Anthropic API key (it starts with sk-ant-)."); return; }
    prefs.set(p === "claude" ? "claudeKey" : "aiKey_" + p, v); toast("Key saved on this device."); renderSettings(el);
  };
  const kd = $("#aiKeyDel"); if (kd) kd.onclick = () => { prefs.set(p === "claude" ? "claudeKey" : "aiKey_" + p, undefined); toast("Key removed."); renderSettings(el); };
  const ms = $("#aiModelSel"); if (ms) ms.onchange = () => prefs.set("aiModel_" + p, ms.value || undefined);
  const mi = $("#aiModelIn"); if (mi) mi.onchange = () => prefs.set("aiModel_" + p, mi.value.trim() || undefined);
  const li = $("#aiList"); if (li) li.onclick = async () => {
    li.disabled = true; li.textContent = "Loading…";
    try { const ids = await aiModels(p); if (!ids.length) throw new Error(AI[p].local ? "No models yet. In a terminal, run: ollama pull llama3.1" : "No models came back."); AI_LISTS[p] = ids; renderSettings(el); }
    catch (e) { toast(esc(String(e.message || e))); li.disabled = false; li.textContent = "Load the list"; }
  };
  const te = $("#aiTest"); if (te) te.onclick = async () => {
    te.disabled = true; te.textContent = "Testing…";
    try { const a = await aiAsk(p, { system: "Reply with one short friendly sentence.", user: "Say hello to a reader in under 12 words.", maxTokens: 60, effort: "low" }); toast(`${esc(AI[p].name)} works: “${esc(a.slice(0, 120))}”`, null, 7000); }
    catch (e) { toast(esc(String(e.message || e)), null, 20000); }
    te.disabled = false; te.textContent = "Test it";
  };
}
const fmtTimer = ms => { const t = Math.floor(ms / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
setInterval(() => { if (RECAP.busy && RECAP.stepAt) paintRecap(); }, 1000);   // keep the timer moving
function stopRecap(){
  if (!RECAP.busy) return;
  RECAP.run = null; RECAP.busy = false; RECAP.step = ""; RECAP.stepAt = 0;
  RECAP.status = "Stopped. What was already read is kept, so the next recap picks up from there.";
  paintRecap();
}
async function makeRecap(id){
  if (RECAP.busy) return;
  const run = {}; RECAP.run = run;
  const live = () => RECAP.run === run;   // false once you tap Stop (an answer still on its way is then ignored)
  RECAP.busy = true; RECAP.text = ""; RECAP.status = ""; RECAP.step = "Getting ready"; RECAP.stepAt = Date.now(); RECAP.done = 0; RECAP.total = 0; paintRecap();
  try {
    const plan = await recapPlan(id); if (plan.err) throw new Error(plan.err);
    const p = plan.p, A = AI[p];
    if (!aiReady(p)) throw new Error(A.local && !TAURI ? "Ollama works in the Windows app." : `Set up ${A.name} in Settings → AI recaps first.`);
    // 1. summaries of every chapter read so far (kept for next time, whichever AI you use)
    const jobs = []; for (const q of plan.parts) for (const u of q.units) jobs.push({ q, u });
    let done = 0; const sums = new Map(); RECAP.total = plan.total;
    const work = async () => { for (;;) { if (!live()) throw new Error("Stopped."); const j = jobs.shift(); if (!j) return;
      const key = sumKey(j.q.id, j.u, j.q.c); let s = await idb.get(key);
      if (s == null) {
        RECAP.step = `Reading ${j.q.prev ? j.q.book.title + ", " : ""}pages ${j.u.a}–${j.u.b}`; RECAP.stepAt = Date.now(); RECAP.status = ""; paintRecap();
        s = await summarizeUnit(p, j.q.book, j.q.c, j.u, sec => { if (live()) { RECAP.status = `${A.name}'s free limit: waiting ${sec} seconds, then carrying on…`; paintRecap(); } });
        if (!live()) throw new Error("Stopped.");
        await idb.put(key, s);   // kept even if you stop later
      }
      sums.set(key, s); done++; RECAP.done = done; paintRecap();
    } };
    await Promise.all(Array.from({ length: A.together }, work));
    // 2. the recap itself
    const cur = plan.parts[plan.parts.length - 1];
    let material = "";
    for (const q of plan.parts) {
      material += `\n\n# ${q.prev ? `Earlier book #${q.book.seriesNo}: ` : "The book being read now: "}${q.book.title}\n`;
      for (const u of q.units) { const s = sums.get(sumKey(q.id, u, q.c)); if (s && s !== "FRONT MATTER") material += `\n### ${u.title}\n${s}\n`; }
    }
    const liveText = cur.live.map(u => textOfPages(cur.c, u.a, u.b)).join("\n\n").slice(-Math.min(60000, A.chunk));
    material += `\n\n# The chapter the reader is in now, up to the end of their current page\n<text>\n${liveText}\n</text>`;
    const missingNote = plan.missing ? `This is book ${cur.book.seriesNo} of its series, and ${plan.missing} earlier book${plan.missing > 1 ? "s aren't" : " isn't"} in the material. Only if you reliably know this series, add a short recap of ${plan.missing > 1 ? "those books" : "that book"} from general knowledge, clearly labeled as such. Never use outside knowledge about this book or anything after it.` : "Use only the material given.";
    const system = `You write a "previously on" recap for someone returning to a book. Strict rule: the reader must not learn anything that happens after their current position. Use only the material provided; ${missingNote}
Write it so it's easy to pick the story back up: a short section per earlier book (if any), then "So far in this book", then "Where you left off", which covers the last few pages in a bit more detail. Use ## headings and short paragraphs or bullets. Mention who people are when they come up. About 400 to 900 words.`;
    const user = `Reader's position: ${cur.book.title}, page ${S.page} of ${cur.c.pages.length}.\n${material}`;
    RECAP.step = `Writing your recap with ${A.name}`; RECAP.stepAt = Date.now(); RECAP.status = ""; paintRecap();
    if (p === "claude") {
      // Claude: streamed, so it appears as it's written
      const client = await claudeClient(), model = aiModel("claude"), haiku = /haiku/.test(model);
      const stream = client.beta.messages.stream({ model, max_tokens: 8000, ...(haiku ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }), output_config: { effort: "medium" }, system, messages: [{ role: "user", content: user }] });
      for await (const ev of stream) { if (!live()) { stream.abort && stream.abort(); throw new Error("Stopped."); } if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { RECAP.step = ""; RECAP.text += ev.delta.text; paintRecap(); } }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") throw new Error("The recap couldn't be written for this book.");
    } else {
      const text = await aiAsk(p, { system, user, maxTokens: 4000, effort: "medium", onWait: sec => { if (live()) { RECAP.status = `${A.name}'s free limit: waiting ${sec} seconds…`; paintRecap(); } } });
      if (!live()) throw new Error("Stopped.");
      RECAP.text = text;
    }
    RECAP.page = S.page; RECAP.status = ""; RECAP.step = "";
    await idb.put("__recap_" + id, { text: RECAP.text, page: S.page, at: Date.now(), by: A.name });
  } catch (e) {
    if (!live()) return;   // stopped: the Stop button already said so
    const msg = String((e && e.message) || e);
    // the services' own messages are kept (they say what's wrong); Claude's SDK errors get a plain version
    RECAP.status = aiPick() === "claude" && /401|authentication|x-api-key|invalid api key/i.test(msg) ? "That API key didn't work. Check it in Settings."
      : aiPick() === "claude" && /credit|billing|402/i.test(msg) ? "Your Anthropic account needs credit for this."
      : "Couldn't make the recap: " + msg.slice(0, 700);
  } finally { if (live()) { RECAP.busy = false; RECAP.step = ""; RECAP.stepAt = 0; RECAP.run = null; paintRecap(); } }
}
function mdLite(s){   // headings, bullets and bold, safely
  return esc(s).split(/\n{2,}/).map(par => {
    if (/^##\s/.test(par)) return `<h4>${par.replace(/^##+\s*/, "")}</h4>`;
    if (/^[-*]\s/m.test(par)) return `<ul>${par.split(/\n/).filter(l => l.trim()).map(l => `<li>${l.replace(/^[-*]\s*/, "")}</li>`).join("")}</ul>`;
    return `<p>${par.replace(/\n/g, "<br>")}</p>`;
  }).join("").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
function paintRecap(){
  const el = $("#recapOut");
  const step = RECAP.busy && RECAP.step ? `${RECAP.step}… ${fmtTimer(Date.now() - RECAP.stepAt)}${RECAP.total ? ` · ${RECAP.done} of ${RECAP.total} sections done` : ""}` : "";
  if (el) el.innerHTML = (step ? `<p class="note">${esc(step)}</p>` : "") + (RECAP.status ? `<p class="note">${esc(RECAP.status)}</p>` : "") + mdLite(RECAP.text);
  const b = $("#recapGo"); if (b) b.disabled = RECAP.busy;
  const st = $("#recapStop"); if (st) st.hidden = !RECAP.busy;
}

/* ---------- the book sheet: Contents · Search · Notes · Words · People · Recap ---------- */
async function renderBookSheet(el){
  const c = S.content[S.cur], b = S.books[S.cur], tab = S.bookTab || "toc", text = c && c.kind === "text";
  const tabs = [["toc", "Contents"], ...(text ? [["search", "Search"]] : []), ["notes", "Notes"], ["words", "Words"], ...(text ? [["people", "People"], ["recap", "Recap"]] : [])];
  let body = "";
  if (tab === "toc") {
    let items = "";
    if (text) { const curIdx = c.toc.reduce((acc, t, i) => t.page <= S.page ? i : acc, 0); items = c.toc.map((t, i) => `<li><button data-p="${t.page}" class="${i === curIdx ? "cur" : ""}"><span>${esc(t.title)}</span><span>${t.page}</span></button></li>`).join(""); }
    else if (c) { const T = c.total, step = Math.max(1, Math.ceil(T / 30)); for (let p = 1; p <= T; p += step) items += `<li><button data-p="${p}"><span>Page ${p}</span><span>${Math.round((p - 1) / Math.max(1, T - 1) * 100)}%</span></button></li>`; }
    body = `<ul class="toc">${items || "<li class='note'>Nothing here yet.</li>"}</ul>`;
  } else if (tab === "search") {
    const res = searchBook(c, S.findQ || ""), synced = syncPoints(b, textIndex(c)).length > 0;
    body = `<input id="findIn" type="search" placeholder="Search this book" value="${esc(S.findQ || "")}" style="width:100%;box-sizing:border-box">
      <p class="note">${S.findQ && S.findQ.trim().length > 1 ? `${res.length >= 300 ? "300+" : res.length} result${res.length === 1 ? "" : "s"}${synced && res.length ? " · ▶ plays the audiobook from there" : ""}` : "Type a word or name."}</p>
      <ul class="toc">${res.slice(0, 200).map((r, i) => `<li><button data-hit="${i}"><span class="snip">${esc(r.snip)}</span><span>${r.page}</span></button>${synced ? `<button class="ib" data-play="${i}" aria-label="Play from here">${ICON.play}</button>` : ""}</li>`).join("")}</ul>`;
    S._hits = res;
  } else if (tab === "notes") {
    const ms = liveMarks(b).sort((x, y) => (x.s || 0) - (y.s || 0) || x.p - y.p);
    body = ms.length ? `<div class="row-btns" style="margin:0 0 8px"><button class="btn" id="nCopy">Copy all</button><button class="btn" id="nSave">Save as text file</button></div>
      <ul class="marks">${ms.map(m => `<li><button data-m="${esc(m.id)}"><span class="mk mk-${m.k === "bm" ? "bm" : esc(m.c || "yellow")}"></span><span class="mt">${m.k === "bm" ? `<b>Bookmark</b> ${esc((m.t || "").slice(0, 90))}` : esc((m.t || "").slice(0, 220))}${m.n ? `<br><i>${esc(m.n)}</i>` : ""}</span><span>${m.p}</span></button><button class="ib" data-mdel="${esc(m.id)}" aria-label="Delete">${ICON.close}</button></li>`).join("")}</ul>`
      : `<p class="note">Select text to highlight it or add a note. Tap the bookmark at the top to mark a page.</p>`;
  } else if (tab === "words") {
    const vs = Object.values(b.vocab || {}).filter(v => !v.del).sort((x, y) => y.at - x.at);
    body = vs.length ? `<ul class="marks">${vs.map(v => `<li><button data-vw="${esc(v.w)}"><span class="mt"><b>${esc(v.w)}</b> — ${esc(v.d || "")}</span><span>${v.p || ""}</span></button><button class="ib" data-vdel="${esc(v.w)}" aria-label="Remove">${ICON.close}</button></li>`).join("")}</ul>`
      : `<p class="note">Select a word and tap <b>Define</b>. Words you save show up here.</p>`;
  } else if (tab === "people") {
    const list = namesSoFar(c, S.page), open = S.personOpen && list.find(x => x.name === S.personOpen);
    body = open ? `<button class="btn ghost" id="pBack">← All names</button><h4 style="margin:8px 0">${esc(open.name)} · ${open.n} mention${open.n > 1 ? "s" : ""} so far</h4>
      <p class="note">Most recent first.</p><ul class="toc">${open.hits.slice(-40).reverse().map(pos => { const pg = pageOfPos(c, pos), t = pageTexts(c)[pg - 1], i = pos - textIndex(c).starts[pg - 1]; return `<li><button data-pos="${pos}" data-len="${open.name.length}"><span class="snip">${esc(t.slice(Math.max(0, i - 50), i + 80))}</span><span>${pg}</span></button></li>`; }).join("")}</ul>`
      : `<p class="note">Names that have come up so far, most mentioned first. Nothing past your page, so no spoilers.</p><div class="people">${list.map(x => `<button class="chip" data-person="${esc(x.name)}">${esc(x.name)} <span class="note">${x.n}</span></button>`).join("") || `<p class="note">None yet.</p>`}</div>`;
  } else if (tab === "recap") {
    const saved = await idb.get("__recap_" + S.cur);
    if (!RECAP.busy && saved && !RECAP.text) { RECAP.text = saved.text; RECAP.page = saved.page; }
    if (!aiReady(aiPick())) body = `<p>A recap of everything that's happened so far, in this book and the earlier books of its series, without anything past your page.</p><p class="note">Choose the AI that writes it (some are free) in <b>Settings → AI recaps</b>${AI[aiPick()].local && !TAURI ? ". Ollama works in the Windows app only; pick another one here." : ", and add its key."}</p><button class="btn primary" id="toKey">Open Settings</button>`;
    else {
      const plan = await recapPlan(S.cur);
      const before = plan.parts ? plan.parts.filter(p => p.prev).map(p => `#${p.book.seriesNo} ${p.book.title}`) : [];
      body = plan.err ? `<p class="note">${esc(plan.err)}</p>` : `<p class="note">Covers ${before.length ? `${esc(before.join(", "))}, and ` : ""}this book up to page ${S.page}.${plan.missing ? ` ${plan.missing} earlier book${plan.missing > 1 ? "s aren't" : " isn't"} in your library, so ${plan.missing > 1 ? "they're" : "it's"} recapped from Claude's general knowledge.` : ""}${b.seriesNo == null ? " For a series, set its collection and number from the book's … menu." : ""}
        <br>Written by ${esc(plan.p === "claude" ? (AI.claude.models.find(m => m[0] === aiModel("claude")) || [0, aiModel("claude")])[1].split(" (")[0] : AI[plan.p].name)}${plan.newChars > 20000 ? (plan.p === "claude" ? `. First time reads ${Math.round(plan.newChars / 1800)} pages (about $${Math.max(0.01, plan.cost).toFixed(2)} on your Anthropic account); later recaps reuse that and cost much less.` : AI[plan.p].local ? `. First time reads ${Math.round(plan.newChars / 1800)} pages on your PC, which can take a while.` : `. Free; first time reads ${Math.round(plan.newChars / 1800)} pages in about ${plan.asks} requests to its free limit.`) : "."}</p>
        <button class="btn" id="recapStop" ${RECAP.busy ? "" : "hidden"}>Stop</button>
        <button class="btn primary" id="recapGo" ${RECAP.busy ? "disabled" : ""}>${RECAP.text && !RECAP.busy ? `Update recap${RECAP.page && RECAP.page !== S.page ? ` (last: page ${RECAP.page})` : ""}` : "Make recap"}</button>
        <div class="recap" id="recapOut"></div>`;
    }
  }
  el.innerHTML = `<div class="sheet"><h3><span class="btabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-btab="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</span><button class="ib" data-close aria-label="Close">${ICON.close}</button></h3>${body}</div>`;
  el.querySelectorAll("[data-btab]").forEach(x => x.onclick = () => { S.bookTab = x.dataset.btab; S.personOpen = null; renderSheet(); });
  el.querySelectorAll("[data-p]").forEach(x => x.onclick = () => { S.sheet = null; renderSheet(); goto(+x.dataset.p); });
  const fi = $("#findIn"); if (fi) { fi.oninput = () => { clearTimeout(fi.t); fi.t = setTimeout(() => { S.findQ = fi.value; renderSheet(); const n = $("#findIn"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); }; if (!S.findQ) fi.focus(); }
  el.querySelectorAll("[data-hit]").forEach(x => x.onclick = () => { const r = S._hits[+x.dataset.hit]; jumpTo(r.s, r.e - r.s); });
  el.querySelectorAll("[data-play]").forEach(x => x.onclick = async () => { const r = S._hits[+x.dataset.play]; await jumpTo(r.s, r.e - r.s); playFromPos(r.s); });
  el.querySelectorAll("[data-m]").forEach(x => x.onclick = () => { const m = liveMarks(b).find(y => y.id === x.dataset.m); if (!m) return; if (m.k === "bm" && !text) { S.sheet = null; renderSheet(); goto(m.p); } else jumpTo(m.s, m.k === "bm" ? 0 : m.e - m.s); });
  el.querySelectorAll("[data-mdel]").forEach(x => x.onclick = () => delMark(S.cur, x.dataset.mdel));
  const nc = $("#nCopy"); if (nc) nc.onclick = () => navigator.clipboard.writeText(exportNotes(S.cur)).then(() => toast("Copied all notes."), () => toast("Couldn't copy."));
  const ns = $("#nSave"); if (ns) ns.onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([exportNotes(S.cur)], { type: "text/plain" })); a.download = (b.title || "notes").replace(/[\\/:*?"<>|]/g, "") + " - notes.txt"; document.body.append(a); a.click(); a.remove(); };
  el.querySelectorAll("[data-vw]").forEach(x => x.onclick = () => defineWord(x.dataset.vw));
  el.querySelectorAll("[data-vdel]").forEach(x => x.onclick = () => { const vocab = { ...(b.vocab || {}) }; vocab[x.dataset.vdel] = { ...(vocab[x.dataset.vdel] || {}), del: 1, at: Date.now() }; save(S.cur, { vocab }); renderSheet(); });
  el.querySelectorAll("[data-person]").forEach(x => x.onclick = () => { S.personOpen = x.dataset.person; renderSheet(); });
  const pb = $("#pBack"); if (pb) pb.onclick = () => { S.personOpen = null; renderSheet(); };
  el.querySelectorAll("[data-pos]").forEach(x => x.onclick = () => jumpTo(+x.dataset.pos, +x.dataset.len));
  const tk = $("#toKey"); if (tk) tk.onclick = () => { closeReader(); S.view = "settings"; render(); };
  const rg = $("#recapGo"); if (rg) rg.onclick = () => makeRecap(S.cur);
  const rs = $("#recapStop"); if (rs) rs.onclick = stopRecap;
  if (tab === "recap") paintRecap();
  el.querySelector("[data-close]").onclick = () => toggleSheet(S.sheet);
}

/* ---------- file inputs ---------- */
$("#bookFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) importBook(f); };
$("#audioFile").onchange = e => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) addAudio(fs).catch(err => { console.warn(err); clearToasts(); toast("Those files couldn't be added."); }); };
$("#matchFile").onchange = e => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) matchAudio(fs).catch(err => { console.warn(err); clearToasts(); toast("Those files couldn't be checked."); }); };
$("#relinkFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f && S.cur) relinkWith(S.cur, f); };
async function relinkWith(id, f){
  const b = S.books[id]; if (!b) return;
  const want = b.src?.fp;
  if (want) {
    toast("Checking the file…", null, 20000);
    const got = await fingerprint(f); clearToasts();
    if (got && got !== want) {
      confirmBox("This isn't the same file", `You chose <b>${esc(f.name)}</b> (${esc(fmtSize(f.size))}), but the book was added from <b>${esc(b.src.name)}</b> (${esc(fmtSize(b.src.size))}). Their contents differ, so it may be a different edition and page numbers might not match.`,
        "Use it anyway", () => attachFile(id, f, false));
      return;
    }
  }
  attachFile(id, f, !!want);
}
async function attachFile(id, f, verified){
  const b = S.books[id];
  try {
    if (b.format === "pdf") { if (!/\.pdf$/i.test(f.name)) throw new Error("Choose the PDF version of this book."); await idb.put(id + ":book", new Blob([await f.arrayBuffer()], { type: "application/pdf" })); }
    else { const p = extOf(f.name) === "epub" ? await parseEpub(f) : await parseTxt(f); await idb.put(id + ":book", { v: 1, chapters: p.chapters }); }
    delete S.content[id]; await showPage();
    toast(verified ? "Exact match. The book is on this device now." : "File added on this device.");
  } catch (err) { toast(esc(err.message || "That file couldn't be read.")); }
}

/* ---------- start ---------- */
async function boot(){
  const [lib, dirty, ups] = await Promise.all([idb.get("__library"), idb.get("__dirty"), idb.get("__uploads")]);
  if (lib) S.books = lib;
  (dirty || []).forEach(id => S.dirty.set(id, ++rev));
  S.uploads = ups || [];
  ensureGuide();
  S.net = Cloud.signedIn() ? (navigator.onLine === false ? "offline" : "syncing") : "local";
  render();
  syncNow();
  if (prefs.get("capOn") && TAURI) setCaption(true);
  if (TAURI || IOS) { setTimeout(() => checkUpdate(false), 8000); setInterval(() => checkUpdate(false), 6 * 3600 * 1000); }   // look for a new version now and then
  if (TAURI && prefs.get("wifiOn")) tauriInvoke("pk_share_start").then(i => { WIFI.info = i; if (S.dock) updateDock(); }).catch(() => {});   // keep sharing what you shared before   // the Windows pop-out comes back where you left it on
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
})();
