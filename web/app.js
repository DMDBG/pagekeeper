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
const ICON = {
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  next:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  type:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19l5-14 5 14M6 14h6M15 19l3-8 3 8M16 17h4"/></svg>',
  head:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1v-6h3zM3 19a2 2 0 002 2h1v-6H3z"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
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
  p.paper ||= "paper";
  p.fs ||= isPhone ? 18 : 20;
  return { get: k => p[k], set(k, v){ if (v === undefined) delete p[k]; else p[k] = v; try { localStorage.setItem("pk-prefs", JSON.stringify(p)); } catch {} } };
})();

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

function ensureGuide(){
  if (!S.books.guide) S.books.guide = { kind:"book", builtin:true, title:GUIDE.title, author:GUIDE.author, format:"text", page:1, pages:0, addedAt:0 };
  Object.assign(S.books.guide, { builtin:true, title:GUIDE.title, author:GUIDE.author, format:"text", deleted:false });
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
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="library" aria-selected="${S.view === "library"}">Library</button>
      <button role="tab" data-tab="find" aria-selected="${S.view === "find"}">Discover</button>
      <button role="tab" data-tab="settings" aria-selected="${S.view === "settings"}">Settings</button>
    </div>
    <div id="body"></div></div>`;
  $("#addBtn").onclick = () => $("#bookFile").click();
  $("#syncBtn").onclick = () => { S.view = "settings"; render(); };
  const gs = $("#goSet"); if (gs) gs.onclick = () => { S.view = "settings"; render(); };
  app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { S.view = b.dataset.tab; render(); });
  if (S.view === "find") renderFind($("#body")); else if (S.view === "settings") renderSettings($("#body")); else renderLibraryBody();
}
function renderLibraryBody(){
  const el = $("#body"); if (!el || S.view !== "library") return;
  const list = Object.entries(S.books).filter(([, b]) => !b.deleted && b.kind === "book").sort((a, b) => (b[1].updatedAt || b[1].addedAt || 0) - (a[1].updatedAt || a[1].addedAt || 0));
  const recent = list.find(([, b]) => !b.builtin && b.updatedAt && b.page > 1) || list.find(([, b]) => b.updatedAt && (b.page || 1) > 1);
  let html = "";
  if (recent) {
    const [id, b] = recent;
    const where = b.device && b.updatedAt ? ` · ${esc(b.device)}, ${ago(b.updatedAt)}` : "";
    html += `<div class="continue">${coverHTML(b)}<div class="c-body"><span class="eyebrow">Continue reading</span><h2>${esc(b.title)}</h2>
      <div class="meta">Page ${b.page || 1}${b.pages ? ` of ${b.pages}` : ""}${where}</div><div class="bar"><i style="width:${pct(b)}%"></i></div></div>
      <button class="btn primary" data-open="${id}">Resume</button></div>`;
  }
  html += `<div class="grid">`;
  for (const [id, b] of list) {
    html += `<div class="book">
      <button class="open" data-open="${id}" aria-label="Open ${esc(b.title)}">${coverHTML(b)}
        <span class="btitle">${esc(b.title)}</span><span class="bauthor">${esc(b.author || (b.format === "pdf" ? "PDF" : ""))}</span>
        <span class="bar"><i style="width:${pct(b)}%"></i></span><span class="meta">${b.pages ? `${pct(b)}% · p. ${b.page || 1} / ${b.pages}` : "Not started"}${b.audio?.tracks?.length ? " · audio" : ""}</span>
      </button>
      ${b.builtin ? "" : `<button class="more" data-more="${id}" aria-label="Options for ${esc(b.title)}">${ICON.dots}</button>`}
    </div>`;
  }
  html += `<button class="add-tile" id="addTile">${ICON.plus}<span>Add an EPUB, PDF or TXT</span></button></div>`;
  el.innerHTML = html;
  $("#addTile").onclick = () => $("#bookFile").click();
  el.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openBook(b.dataset.open));
  el.querySelectorAll("[data-more]").forEach(b => b.onclick = () => bookMenu(b.dataset.more));
}
function bookMenu(id){
  const bk = S.books[id];
  const m = document.createElement("div"); m.className = "modal-back";
  const where = bk.asset ? "Saved in your account, so every device gets it." : (bk.src && bk.src.size > MAX_FILE) ? `On this device only (${esc(fmtSize(bk.src.size))}). Other devices download the same file.` : Cloud.signedIn() ? "Copying to your account when online." : "On this device.";
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(bk.title)}</h3>
    <p>${bk.src ? esc(bk.src.name) + " · " : ""}${where}</p>
    ${bk.src?.url ? `<p style="word-break:break-all">Download link: ${esc(bk.src.url)}</p>` : ""}
    <div class="row" style="justify-content:flex-start">
      ${bk.asset ? "" : `<button class="btn" data-link>${bk.src?.url ? "Change download link" : "Add download link"}</button>`}
      <button class="btn danger" data-del>Remove book</button><button class="btn" data-x>Close</button></div></div>`;
  m.addEventListener("click", e => {
    if (e.target === m || e.target.closest("[data-x]")) m.remove();
    if (e.target.closest("[data-link]")) { m.remove(); askBookLink(id); }
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
  confirmBox("Remove this book?", `“${esc(bk.title)}”, its saved place and any audio will be removed from every device. This can't be undone.`, "Remove", async () => {
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
      <h3>This device</h3>
      <div class="form"><label for="devName">Name</label><input id="devName" type="text" maxlength="24" value="${esc(prefs.get("device"))}">
      <p class="note" style="margin:0">Shown on your other devices, like “page 12 on iPhone”.</p></div>
    </div>`;
  $("#devName").onchange = e => { const v = e.target.value.trim(); if (v) prefs.set("device", v); };
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
window.pkProgress = (id, frac) => { const f = progressFns[id]; if (f) f(frac); };
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
  S.dock = false; S.reading = false;
  renderReader(); await showPage();
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
      <button class="ib" id="rToc" aria-label="Contents">${ICON.list}</button>
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
  $("#rBack").onclick = closeReader;
  $("#rPrev").onclick = () => goto(S.page - 1);
  $("#rNext").onclick = () => goto(S.page + 1);
  $("#rSlide").oninput = e => { $("#rNum").textContent = `${e.target.value} / ${total()}`; };
  $("#rSlide").onchange = e => goto(+e.target.value);
  $("#rToc").onclick = () => toggleSheet("toc");
  $("#rType").onclick = () => toggleSheet("type");
  $("#rAudio").onclick = () => { S.dock = !S.dock; $("#rAudio").setAttribute("aria-pressed", S.dock); updateDock(); };
  const main = $("#rMain");
  let sx = 0, sy = 0;
  main.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  main.addEventListener("touchend", e => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) goto(S.page + (dx < 0 ? 1 : -1)); });
  main.addEventListener("click", e => {
    if (e.target.closest("button,a,input")) return;
    if (window.getSelection && String(window.getSelection())) return;
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
    const sentences = x => (x.match(/[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g) || [x]).map(s => `<span data-s>${esc(s)}</span>`).join("");
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
async function goto(n, fromRemote){
  const T = total(); n = Math.min(Math.max(1, n), T);
  if (n === S.page && !fromRemote) return;
  S.page = n;
  save(S.cur, { page: n, pages: T });
  if (S.sheet === "toc") renderSheet();
  await showPage();
}
document.addEventListener("keydown", e => {
  if (S.view !== "reader" || e.target.closest("input,select,textarea")) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goto(S.page + 1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goto(S.page - 1); }
  else if (e.key === " " && S.dock && !e.target.closest("button")) { e.preventDefault(); togglePlay(); }
  else if (e.key === "Escape") { if (S.sheet) toggleSheet(S.sheet); else if (S.bigPlayer) { S.bigPlayer = false; updateDock(); } else closeReader(); }
});
function toggleSheet(name){ S.sheet = S.sheet === name ? null : name; renderSheet(); }
function renderSheet(){
  const el = $("#sheet"); if (!el) return;
  if (!S.sheet) { el.innerHTML = ""; return; }
  const c = S.content[S.cur];
  if (S.sheet === "toc") {
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
    const cap = capCfg(), capOn = !!prefs.get("capOn");
    el.querySelector(".sheet").insertAdjacentHTML("beforeend", `
      <div class="field"><label>Pop-out text</label>
        <div class="seg"><button id="capToggle" aria-pressed="${capOn}">${capOn ? "Hide pop-out" : "Show pop-out"}</button></div>
        <span class="note">${TAURI ? "A borderless window that stays on top of everything. Drag it anywhere; drag its edges to resize." : "A floating panel you can drag around. Drag its corner to resize."} It shows the sentence being read aloud, or the page you're on.</span></div>
      <div class="field"><label>Pop-out colors</label>
        <div class="capcolors">
          <label class="cc">Text <input type="color" id="capFg" value="${esc(cap.fg)}"></label>
          <label class="cc">Background <input type="color" id="capBg" value="${esc(cap.bg)}"></label>
          <span class="cap-sample" style="color:${esc(cap.fg)};background:${esc(cap.bg)}">Sample text</span>
        </div>
        <div class="seg" style="margin-top:8px">
          <button data-capsz="-1" aria-label="Smaller pop-out text">A−</button><button data-capsz="1" aria-label="Larger pop-out text">A+</button>
          <button id="capReset">Reset to dark</button>
        </div></div>`);
    $("#capToggle").onclick = () => { setCaption(!prefs.get("capOn")); renderSheet(); };
    const colorChange = () => { prefs.set("capFg", $("#capFg").value); prefs.set("capBg", $("#capBg").value);
      const s = el.querySelector(".cap-sample"); s.style.color = $("#capFg").value; s.style.background = $("#capBg").value; capSend(); };
    $("#capFg").oninput = colorChange; $("#capBg").oninput = colorChange;
    el.querySelectorAll("[data-capsz]").forEach(b => b.onclick = () => { prefs.set("capSize", Math.min(48, Math.max(12, capCfg().size + 2 * +b.dataset.capsz))); capSend(); });
    $("#capReset").onclick = () => { prefs.set("capFg", undefined); prefs.set("capBg", undefined); prefs.set("capSize", undefined); capSend(); renderSheet(); };
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
  let big = 0;
  for (const f of list) {
    const key = `${id}:a:${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
    await idb.put(key, f); S.haveLocal[key] = true;
    const fits = f.size <= MAX_FILE;
    if (!fits) big++;
    tracks.push({ name: f.name.replace(/\.[^.]+$/, ""), file: f.name, key, asset: null, size: f.size, fp: await fingerprint(f) });
    if (fits && Cloud.signedIn()) S.uploads.push({ id, kind: "track", key, name: "audio-" + key.split(":").pop() + "." + extOf(f.name), type: f.type || mimeFor(f.name) });
  }
  const fresh = !(b.audio?.tracks || []).length;
  save(id, { audio: fresh ? { tracks, track: 0, time: 0 } : { tracks } }, { now: true });
  if (quiet) { if (S.cur === id) updateDock(); return; }
  clearToasts();
  toast(big && Cloud.signedIn() ? `Added. ${big} file${big > 1 ? "s are" : " is"} over 50 MB and stay${big > 1 ? "" : "s"} on this device; your listening spot still syncs.` : Cloud.signedIn() ? "Audio added. It's copying to your account." : "Audio added.");
  auBook = null; updateDock();
  if (big && Cloud.signedIn() && !b.audio?.url) askAudioLink(id);
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
au.addEventListener("timeupdate", () => { saveAudioPos(false); updateTimes(); });
au.addEventListener("loadedmetadata", () => updateTimes());
au.addEventListener("play", updateDock); au.addEventListener("pause", () => { saveAudioPos(true); updateDock(); });
au.addEventListener("ended", async () => {
  const b = auBook && S.books[auBook.id]; if (!b) return;
  const nxt = auBook.track + 1;
  if (nxt < b.audio.tracks.length) { if (await loadTrack(nxt, 0)) { save(auBook.id, { audio: { track: nxt, time: 0 } }); au.play().catch(() => {}); } }
  updateDock();
});

/* read aloud: the device's built-in voice, works offline */
const synth = window.speechSynthesis;
function pageText(){
  const c = S.content[S.cur]; if (!c) return Promise.resolve("");
  if (c.kind === "text") return Promise.resolve(c.pages[S.page - 1].map(b => b[1]).join("\n\n"));
  return c.pdf.getPage(S.page).then(p => p.getTextContent()).then(tc => tc.items.map(i => i.str).join(" ").replace(/\s+/g, " ").trim());
}
function speak(text){
  return new Promise((res, rej) => {
    const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text]; let i = 0;
    const next = () => {
      if (!S.reading) return rej(new Error("stopped"));
      if (i >= parts.length) return res();
      const u = new SpeechSynthesisUtterance(parts[i++].trim()); u.rate = prefs.get("ttsRate") || 1;
      u.onend = next; u.onerror = e => (e.error === "interrupted" || e.error === "canceled") ? rej(new Error("stopped")) : next();
      synth.speak(u);
    };
    next();
  });
}
async function readAloud(){
  if (!synth) return;
  if (S.reading) { stopReadAloud(); return; }
  if (!au.paused) au.pause();
  S.reading = true; updateDock();
  while (S.reading && S.view === "reader") {
    try { await speakPage(); } catch { break; }
    if (!S.reading) break;
    if (S.page >= total()) break;
    await goto(S.page + 1);
  }
  S.reading = false; capNow.speaking = false; capSend(); updateDock();
}
function stopReadAloud(){ if (S.reading) { S.reading = false; try { synth && synth.cancel(); } catch {} clearHighlights(); capNow.speaking = false; capSend(); updateDock(); } }

/* Speak the page sentence by sentence, highlighting as it goes (setting: sentence, word or off). */
function clearHighlight(el){
  el.classList.remove("hl", "soft");
  if (el.dataset.w) { el.textContent = el.dataset.t; delete el.dataset.w; }
}
function clearHighlights(){ document.querySelectorAll(".page [data-s]").forEach(clearHighlight); }
function speakPage(){
  const spans = [...document.querySelectorAll(".page [data-s]")];
  if (!spans.length) return pageText().then(t => t ? speak(t) : null);   // PDFs: read without highlighting
  return new Promise((res, rej) => {
    const mode = prefs.get("hl") || "sentence";
    let i = 0, prev = null;
    const next = () => {
      if (prev) clearHighlight(prev);
      if (!S.reading) return rej(new Error("stopped"));
      if (i >= spans.length) return res();
      const el = spans[i++]; prev = el;
      const text = el.textContent; el.dataset.t = text;
      if (!text.trim()) return next();
      if (mode !== "off") {
        el.classList.add("hl"); if (mode === "word") el.classList.add("soft");
        el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
      const lead = text.length - text.trimStart().length;
      capNow.speaking = true; capNow.text = text.trim(); capNow.word = null; capSend();
      const u = new SpeechSynthesisUtterance(text.trim());
      u.rate = prefs.get("ttsRate") || 1;
      u.onboundary = ev => {
        if (ev.name && ev.name !== "word") return;
        const start = ev.charIndex + lead;
        let len = ev.charLength || 0;
        if (!len) { const m = text.slice(start).match(/^[^\s]+/); len = m ? m[0].length : 0; }
        if (!len) return;
        capNow.word = [ev.charIndex, len]; capSend();
        if (mode !== "word") return;
        el.dataset.w = "1";
        el.innerHTML = esc(text.slice(0, start)) + `<mark class="w">${esc(text.slice(start, start + len))}</mark>` + esc(text.slice(start + len));
      };
      u.onend = next;
      u.onerror = e => (e.error === "interrupted" || e.error === "canceled") ? (clearHighlight(el), rej(new Error("stopped"))) : next();
      synth.speak(u);
    };
    next();
  });
}

/* ---------- audio player (Libby-style: scrubber, skip, speed, volume) ---------- */
Object.assign(ICON, {
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
  downChev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  prev:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  nextp:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  vol:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg>',
  mute:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"/></svg>'
});
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIPS = [10, 15, 30, 60];
const skipSec = () => prefs.get("skip") || 15;
const curRate = () => prefs.get("rate") || 1;
const rateTxt = r => (+(+r).toFixed(2)) + "×";
const curTi = b => auBook && auBook.id === S.cur ? auBook.track : ((b && b.audio && b.audio.track) || 0);
try { au.preservesPitch = true; au.webkitPreservesPitch = true; } catch {}

function setRate(r){
  r = Math.min(3, Math.max(0.5, Math.round(r * 20) / 20));
  prefs.set("rate", r); au.defaultPlaybackRate = r; au.playbackRate = r;
  document.querySelectorAll("[data-rate-label]").forEach(x => { x.textContent = rateTxt(r); });
  document.querySelectorAll("[data-rate]").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.rate === r)));
  updateTimes();
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

/* Volume: the audio element on PC; the phone's own media volume on iPhone (iOS ignores page volume). */
let vol = IOS ? null : (prefs.get("vol") ?? 1), lastVol = 0.7;
if (!IOS) au.volume = vol;
window.pkVolume = v => { vol = +v; paintVol(); };
function paintVol(){
  const s = $("#auVol");
  if (s && vol != null && !s.matches(":active")) { s.value = vol; paintRange(s); }
  const m = $("#auMute"); if (m) { m.innerHTML = vol === 0 ? ICON.mute : ICON.vol; m.setAttribute("aria-label", vol === 0 ? "Unmute" : "Mute"); }
}
function setVol(v){
  v = Math.min(1, Math.max(0, v)); vol = v;
  if (IOS) Native.call({ op: "volume", value: v }).catch(() => {});
  else { au.volume = v; prefs.set("vol", v); }
  paintVol();
}

function updateDock(){
  const el = $("#dock"); if (!el) return;
  if (!S.dock) { el.innerHTML = ""; return; }
  const b = S.books[S.cur]; const tracks = (b.audio && b.audio.tracks) || [];
  const own = auBook && auBook.id === S.cur;
  const playing = own && !au.paused;
  const ttsBtn = synth ? `<button class="btn" id="tts">${ICON.speak} ${S.reading ? "Stop reading" : "Read aloud"}</button>` : "";
  if (!tracks.length) {
    el.innerHTML = `<div class="dock"><div class="row1" style="flex-wrap:wrap;gap:10px">
      <div class="trk" style="min-width:200px"><b>No audiobook yet</b><span>Add MP3, M4A or M4B files or a LibriVox zip, or get one in Discover.</span></div>
      <button class="btn primary" id="auAdd">${ICON.plus} Add audio</button>${ttsBtn}</div></div>`;
  } else {
    if (tracks.some(x => S.haveLocal[x.key] === undefined)) checkLocal(S.cur).then(() => S.dock && updateDock());
    const ti = curTi(b); const t = tracks[ti] || tracks[0];
    const rate = curRate(), sk = skipSec(), big = !!S.bigPlayer;
    // Load the current part (paused) so the scrubber knows its length.
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
        <div class="row1">
          ${skipBtn(-1)}${playBtn}${skipBtn(1)}
          <div class="trk"><b>${esc(t.name)}</b><span>${tracks.length > 1 ? `Part ${ti + 1} of ${tracks.length}` : esc(b.title)}</span></div>
          <button class="chip" id="auRateBtn" aria-label="Playback speed, tap to change"><span data-rate-label>${rateTxt(rate)}</span></button>
          <button class="ib" id="auExpand" aria-label="Open the full player">${ICON.up}</button>
        </div>${scrub}</div>`;
    } else {
      const list = S.showTracks ? `<ul class="tracks">${tracks.map((x, i) => `<li><button data-t="${i}" class="${i === ti ? "cur" : ""}"><span>${i + 1}. ${esc(x.name)}</span><span class="where">${S.haveLocal[x.key] ? "on this device" : x.asset ? "in your account" : S.haveLocal[x.key] === false ? "not on this device" : ""}</span></button></li>`).join("")}</ul>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" id="auAdd">${ICON.plus} Add more</button>${ttsBtn}${aurl || tracks.some(x => x.size > MAX_FILE) ? `<button class="btn" id="auLink2">${aurl ? "Change" : "Add"} download link</button>` : ""}<button class="btn danger" id="auClear">Remove audio</button></div>` : "";
      el.innerHTML = `<div class="dock big">
        <div class="pl-head"><button class="ib" id="auExpand" aria-label="Close the full player">${ICON.downChev}</button><span>Now playing</span><span class="pl-spacer"></span></div>
        ${note}
        <div class="pl-top">${coverHTML(b).replace('class="cover"', 'class="cover pl-cover"')}
          <div class="trk"><b>${esc(t.name)}</b><span>${esc(b.title)}${tracks.length > 1 ? ` · part ${ti + 1} of ${tracks.length}` : ""}</span></div></div>
        ${scrub}
        <div class="pl-ctrls">
          <button class="ib" id="auPrev" aria-label="Previous part or start of this part">${ICON.prev}</button>
          ${skipBtn(-1)}${playBtn}${skipBtn(1)}
          <button class="ib" id="auNext" aria-label="Next part" ${ti < tracks.length - 1 ? "" : "disabled"}>${ICON.nextp}</button>
        </div>
        <div class="pl-row"><label>Speed</label>
          <div class="ratebox"><button class="ib" id="auSlower" aria-label="Slower">−</button><b data-rate-label>${rateTxt(rate)}</b><button class="ib" id="auFaster" aria-label="Faster">+</button></div>
          <div class="chips">${SPEEDS.map(r => `<button class="chip" data-rate="${r}" aria-pressed="${r === rate}">${rateTxt(r)}</button>`).join("")}</div></div>
        <div class="pl-row"><label>Volume</label><button class="ib" id="auMute" aria-label="Mute">${ICON.vol}</button>
          <input type="range" class="scrub vol" id="auVol" min="0" max="1" step="0.01" value="${vol == null ? 1 : vol}" aria-label="Volume"></div>
        <div class="pl-row"><label>Skip</label><div class="chips">${SKIPS.map(s => `<button class="chip" data-skip="${s}" aria-pressed="${s === sk}">${s} sec</button>`).join("")}</div></div>
        <div class="pl-row"><label>Parts</label><button class="btn" id="auList">${S.showTracks ? "Hide parts" : `Show all ${tracks.length}`}</button></div>
        ${list}
      </div>`;
    }

    $("#auPlay").onclick = togglePlay;
    $("#auBack").onclick = () => skipBy(-sk);
    $("#auFwd").onclick = () => skipBy(sk);
    $("#auExpand").onclick = () => { S.bigPlayer = !S.bigPlayer; updateDock(); };
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
    const vs = $("#auVol"); if (vs) { vs.oninput = () => { paintRange(vs); setVol(+vs.value); }; }
    const mu = $("#auMute"); if (mu) mu.onclick = () => { if (vol > 0) { lastVol = vol; setVol(0); } else setVol(lastVol || 0.7); };
    if (big && IOS && vol == null) Native.call({ op: "volumeGet" }).then(v => { vol = +v; paintVol(); }).catch(() => {});
    const ls = $("#auList"); if (ls) ls.onclick = () => { S.showTracks = !S.showTracks; updateDock(); };
    const am = $("#auMatch"); if (am) am.onclick = () => $("#matchFile").click();
    el.querySelectorAll("[data-await-audio]").forEach(a => a.addEventListener("click", () => { S.awaitingAudio = S.cur; }));
    const dl = $("#auDl"); if (dl) dl.onclick = downloadAll;
    ["#auLink", "#auLink2"].forEach(s => { const x = $(s); if (x) x.onclick = () => askAudioLink(S.cur); });
    el.querySelectorAll("[data-t]").forEach(x => x.onclick = async () => { const i = +x.dataset.t; if (await loadTrack(i, 0)) { save(S.cur, { audio: { track: i, time: 0 } }); au.play().catch(() => {}); } updateDock(); });
    const clr = $("#auClear"); if (clr) clr.onclick = () => confirmBox("Remove the audiobook?", "The audio files for this book will be removed from every device. The book itself stays.", "Remove audio", async () => {
      au.pause(); au.removeAttribute("src"); auBook = null;
      const id = S.cur; S.uploads = S.uploads.filter(u => !(u.id === id && u.kind === "track"));
      for (const x of tracks) { idb.del(x.key); if (x.asset && Cloud.signedIn()) Files.del(x.asset).catch(() => {}); }
      save(id, { audio: { tracks: [], track: 0, time: 0, url: "" } }, { now: true }); S.showTracks = false; updateDock();
    });
    updateTimes(); paintVol();
  }
  const add = $("#auAdd"); if (add) add.onclick = () => $("#audioFile").click();
  const tb = $("#tts"); if (tb) tb.onclick = readAloud;
}

/* ---------- pop-out text ----------
   Windows app: a borderless, always-on-top window you drag anywhere on screen.
   iPhone and browser: a borderless panel you drag around inside Pagekeeper.
   Shows the sentence being read aloud (with the word, in Word mode), otherwise the page you're on. */
const CAP_DEFAULT = { fg: "#E8E6E1", bg: "#111318", size: 22 };
const capCfg = () => ({ fg: prefs.get("capFg") || CAP_DEFAULT.fg, bg: prefs.get("capBg") || CAP_DEFAULT.bg, size: prefs.get("capSize") || CAP_DEFAULT.size });
const capNow = { speaking: false, text: "", word: null };
function capPayload(){
  let text = "", hint = "";
  if (capNow.speaking) text = capNow.text;
  else if (S.view === "reader" && S.cur) {
    const c = S.content[S.cur];
    if (c && c.kind === "text") text = c.pages[S.page - 1].map(b => b[1]).join("\n\n");
    else if (c && c.kind === "pdf") hint = "Pop-out text works with EPUB and text books, or while a PDF is read aloud.";
  } else hint = "Open a book in Pagekeeper.";
  return { ...capCfg(), text, hint, word: capNow.speaking && (prefs.get("hl") === "word") ? capNow.word : null, speaking: capNow.speaking };
}
function capSend(){
  if (!prefs.get("capOn")) return;
  const p = capPayload();
  if (TAURI) TAURI.event.emitTo("caption", "pk-caption", p).catch(() => {});
  else renderFloatCap(p);
}
function setCaption(on){
  prefs.set("capOn", !!on);
  if (TAURI) TAURI.core.invoke("pk_caption", { show: !!on }).catch(e => toast("Couldn't open the pop-out: " + esc(String(e))));
  else if (!on) { const f = $("#floatcap"); if (f) f.remove(); }
  capSend();
}
if (TAURI && TAURI.event) {
  TAURI.event.listen("pk-caption-ready", () => capSend());
  TAURI.event.listen("pk-caption-closed", () => { if (prefs.get("capOn")) { prefs.set("capOn", false); if (S.sheet === "type") renderSheet(); } });
}
/* In-app floating panel (iPhone and browser). */
function renderFloatCap(p){
  let f = $("#floatcap");
  if (!f) {
    f = document.createElement("div"); f.id = "floatcap"; f.setAttribute("role", "status"); f.setAttribute("aria-live", "polite");
    const pos = prefs.get("capPos") || { x: 16, y: 90 };
    f.style.left = pos.x + "px"; f.style.top = pos.y + "px";
    const sz = prefs.get("capBox"); if (sz) { f.style.width = sz.w + "px"; f.style.height = sz.h + "px"; }
    f.innerHTML = `<div class="fc-text"></div><span class="fc-grip" aria-hidden="true"></span>`;
    document.body.append(f);
    // drag anywhere on the panel; drag the corner to resize
    let drag = null;
    f.addEventListener("pointerdown", e => {
      const r = f.getBoundingClientRect();
      const resize = e.target.classList.contains("fc-grip");
      drag = { resize, sx: e.clientX, sy: e.clientY, x: r.left, y: r.top, w: r.width, h: r.height };
      f.setPointerCapture(e.pointerId); e.preventDefault();
    });
    f.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (drag.resize) { f.style.width = Math.max(160, drag.w + dx) + "px"; f.style.height = Math.max(54, drag.h + dy) + "px"; }
      else {
        f.style.left = Math.min(innerWidth - 60, Math.max(-f.offsetWidth + 60, drag.x + dx)) + "px";
        f.style.top = Math.min(innerHeight - 40, Math.max(0, drag.y + dy)) + "px";
      }
    });
    const end = () => {
      if (!drag) return; drag = null;
      prefs.set("capPos", { x: parseInt(f.style.left), y: parseInt(f.style.top) });
      prefs.set("capBox", { w: f.offsetWidth, h: f.offsetHeight });
    };
    f.addEventListener("pointerup", end); f.addEventListener("pointercancel", end);
  }
  f.style.setProperty("--fg", p.fg); f.style.setProperty("--bg", p.bg); f.style.setProperty("--size", p.size + "px");
  f.classList.toggle("speaking", !!p.speaking);
  const box = f.querySelector(".fc-text");
  if (!p.text) box.innerHTML = `<span class="fc-hint">${esc(p.hint || "")}</span>`;
  else if (p.word) { const [s, n] = p.word; box.innerHTML = esc(p.text.slice(0, s)) + `<mark>${esc(p.text.slice(s, s + n))}</mark>` + esc(p.text.slice(s + n)); }
  else box.textContent = p.text;
  const m = box.querySelector("mark"); if (m) m.scrollIntoView({ block: "nearest" }); else if (!p.speaking) box.scrollTop = 0;
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
  if (prefs.get("capOn") && TAURI) setCaption(true);   // the Windows pop-out comes back where you left it on
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
})();
