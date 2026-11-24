/* Pagekeeper: the "whole page" pop-out.
   Used by the Windows pop-out window (caption.html) and by the floating panel on iPhone and in the browser.
   Shows the page you're on. Text that hasn't been read yet is gray and comes into color as it's read;
   double-click (double-tap) a word to move the audiobook or read-aloud to it. */
(() => {
  const CSS = `
.pp{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);--dim:color-mix(in srgb,var(--fg) 34%,var(--bg));--mid:color-mix(in srgb,var(--fg) 58%,var(--bg))}
.pp-bar{flex:none;display:flex;align-items:center;gap:2px;padding:4px 6px 4px 12px;font:12.5px system-ui,-apple-system,"Segoe UI",sans-serif;border-bottom:1px solid color-mix(in srgb,var(--fg) 12%,transparent);cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}
.pp-bar:active{cursor:grabbing}
.pp-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.75}
.pp-bar button{all:unset;flex:none;min-width:28px;height:28px;display:grid;place-items:center;border-radius:7px;cursor:pointer;font:600 14px system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);opacity:.85}
.pp-bar button:hover,.pp-bar button:focus-visible{background:color-mix(in srgb,var(--fg) 14%,transparent);opacity:1}
.pp-bar svg{width:16px;height:16px;fill:currentColor}
.pp-text{flex:1;min-height:0;overflow:auto;padding:14px 22px 40vh;font:var(--size)/1.6 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;cursor:text;user-select:none;-webkit-user-select:none;touch-action:pan-y;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--fg) 25%,transparent) transparent}
.pp-text p{margin:0 0 .8em}
.pp-text h3{font-size:1.15em;margin:.4em 0 .8em;font-weight:700}
.pp-text .s{transition:color .25s}
.pp.gray .pp-text .u{color:var(--dim)}
.pp.gray .pp-text .s.cur .u{color:var(--mid)}
/* No background: just the words on your screen, each letter outlined so it reads on light and dark */
.pp.clear{background:transparent}
.pp.clear .pp-bar{background:color-mix(in srgb,var(--bg) 70%,transparent);border:0;border-radius:10px;margin:2px}
.pp.clear .pp-text{font-weight:600;scrollbar-width:none;--o:var(--bg);text-shadow:0 0 1px var(--o),1.5px 1.5px 0 var(--o),-1.5px -1.5px 0 var(--o),1.5px -1.5px 0 var(--o),-1.5px 1.5px 0 var(--o),0 1.5px 0 var(--o),0 -1.5px 0 var(--o),1.5px 0 0 var(--o),-1.5px 0 0 var(--o)}
.pp.clear .pp-text::-webkit-scrollbar{display:none}
.pp.clear.gray .pp-text .u{color:color-mix(in srgb,var(--fg) 40%,transparent)}
.pp.clear.gray .pp-text .s.cur .u{color:color-mix(in srgb,var(--fg) 62%,transparent)}
.pp.clear .pp-prog{background:transparent}
.pp-bar button *{pointer-events:none}
.pp:not(.gray) .pp-text .s.cur{background:color-mix(in srgb,var(--fg) 12%,transparent);border-radius:4px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.pp-text .flash{background:color-mix(in srgb,var(--fg) 30%,transparent);border-radius:4px;transition:background .6s}
.pp-text .hint{font:14px system-ui,-apple-system,"Segoe UI",sans-serif;opacity:.7}
.pp-prog{flex:none;height:3px;background:color-mix(in srgb,var(--fg) 12%,transparent)}
.pp-prog i{display:block;height:100%;width:0;background:var(--fg);opacity:.7;transition:width .3s}
.pp-back{all:unset;position:absolute;left:50%;bottom:16px;transform:translateX(-50%);padding:7px 14px;border-radius:999px;background:var(--fg);color:var(--bg);font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3)}
.pp-back[hidden]{display:none}
`;
  const ICONS = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/></svg>',
  };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WORDCH = /[\p{L}\p{N}'’-]/u;

  function mount(host, { onCmd, drag = false }){
    if (!document.getElementById("pp-css")) { const st = document.createElement("style"); st.id = "pp-css"; st.textContent = CSS; document.head.append(st); }
    const D = drag ? " data-tauri-drag-region" : "";
    const root = document.createElement("div"); root.className = "pp gray";
    root.innerHTML = `<div class="pp-bar"${D}>
        <span class="pp-title"${D}></span>
        <button data-c="prevpage" title="Previous page" aria-label="Previous page">‹</button>
        <button data-c="back" title="Back" aria-label="Back">${ICONS.back}</button>
        <button data-c="play" title="Play or pause" aria-label="Play or pause">${ICONS.play}</button>
        <button data-c="fwd" title="Forward" aria-label="Forward">${ICONS.fwd}</button>
        <button data-c="nextpage" title="Next page" aria-label="Next page">›</button>
        <button data-c="smaller" title="Smaller text" aria-label="Smaller text">A−</button>
        <button data-c="bigger" title="Bigger text" aria-label="Bigger text">A+</button>
        <button data-c="close" title="Close" aria-label="Close pop-out">✕</button>
      </div>
      <div class="pp-text" tabindex="0"></div>
      <div class="pp-prog"><i></i></div>
      <button class="pp-back" hidden>Back to where it's reading</button>`;
    host.append(root);
    const bar = root.querySelector(".pp-bar"), text = root.querySelector(".pp-text"), prog = root.querySelector(".pp-prog i"), backBtn = root.querySelector(".pp-back");
    let key = null, sents = [], lastPos = null, cur = null, userAt = 0, last = {}, flash = null;

    bar.addEventListener("click", e => { const b = e.target.closest("button"); if (b) onCmd(b.dataset.c); });

    // You scrolled to look around: stop following for a bit, and offer the way back.
    const looked = () => { userAt = Date.now(); if (lastPos >= 0) backBtn.hidden = false; };
    text.addEventListener("wheel", looked, { passive: true });
    text.addEventListener("touchmove", looked, { passive: true });
    backBtn.onclick = () => { userAt = 0; backBtn.hidden = true; follow(true); };

    // Double-click (double-tap) a word: go there.
    function wordAt(x, y){
      let node, off;
      if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (!r) return null; node = r.startContainer; off = r.startOffset; }
      else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (!p) return null; node = p.offsetNode; off = p.offset; }
      else return null;
      const sp = (node.nodeType === 3 ? node.parentElement : node).closest(".s"); if (!sp) return null;
      const s = sents[+sp.dataset.i]; if (!s) return null;
      let k = 0; const w = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) { if (t === node) { k += off; break; } k += t.length; }
      k = Math.min(k, s.text.length);
      if (k < s.text.length && !WORDCH.test(s.text[k]) && k > 0 && WORDCH.test(s.text[k - 1])) k--;
      if (!WORDCH.test(s.text[k] || "")) { const m = s.text.slice(k).search(/[\p{L}\p{N}]/u); if (m < 0) return null; k += m; }
      while (k > 0 && WORDCH.test(s.text[k - 1])) k--;
      let e = k; while (e < s.text.length && WORDCH.test(s.text[e])) e++;
      return { s, k, e };
    }
    function go(x, y){
      const w = wordAt(x, y); if (!w) return;
      try { getSelection().removeAllRanges(); } catch {}
      userAt = 0; backBtn.hidden = true;
      // a quick flash on the word, so you can see what it heard
      if (cur && cur.el) { cur.el.textContent = cur.text; cur.el.classList.remove("cur"); cur = null; }
      if (flash) flash.s.el.textContent = flash.s.text;
      const t = w.s.text; flash = { s: w.s, until: Date.now() + 900 };
      w.s.el.innerHTML = esc(t.slice(0, w.k)) + `<span class="flash">${esc(t.slice(w.k, w.e))}</span>` + esc(t.slice(w.e));
      lastPos = null; setTimeout(() => paint(last.pos ?? -1, true), 950);
      onCmd("seek", { off: w.s.o + w.k, key });
    }
    let touchLast = null, lastGo = 0;
    text.addEventListener("dblclick", e => { if (Date.now() - lastGo < 600) return; lastGo = Date.now(); go(e.clientX, e.clientY); });
    text.addEventListener("pointerup", e => {
      if (e.pointerType === "mouse") return;
      const now = Date.now();
      if (touchLast && now - touchLast.t < 320 && Math.hypot(e.clientX - touchLast.x, e.clientY - touchLast.y) < 30) { touchLast = null; lastGo = now; go(e.clientX, e.clientY); }
      else touchLast = { t: now, x: e.clientX, y: e.clientY };
    });
    root.addEventListener("keydown", e => {
      const k = e.key;
      if (k === " " || k === "k") onCmd("play");
      else if (k === "ArrowLeft" || k === "j") onCmd("back");
      else if (k === "ArrowRight" || k === "l") onCmd("fwd");
      else if (k === "PageUp") onCmd("prevpage");
      else if (k === "PageDown") onCmd("nextpage");
      else if (k === "+" || k === "=") onCmd("bigger");
      else if (k === "-") onCmd("smaller");
      else return;
      e.preventDefault();
    });

    function build(pg){
      let o = 0, i = 0, html = "";
      sents = [];
      for (const [h, ss] of pg.blocks) {
        const inner = ss.map(t => { const s = { o, text: t, i }; sents.push(s); o += t.length; return `<span class="s u" data-i="${i++}">${esc(t)}</span>`; }).join("");
        html += h ? `<h3>${inner}</h3>` : `<p>${inner}</p>`;
      }
      text.innerHTML = html || `<p class="hint">This page has no text.</p>`;
      text.querySelectorAll(".s").forEach(el => { sents[+el.dataset.i].el = el; });
      cur = null; flash = null; lastPos = null; text.scrollTop = 0; userAt = 0; backBtn.hidden = true;
    }
    // Color in everything before pos; the sentence being read is split at pos.
    function paint(pos, again){
      if (pos === lastPos && !again) return;
      lastPos = pos;
      if (flash && Date.now() >= flash.until) { flash.s.el.textContent = flash.s.text; flash = null; }
      const all = pos < 0;
      if (cur && cur.el) { cur.el.textContent = cur.text; cur.el.classList.remove("cur"); cur = null; }
      for (const s of sents) {
        const read = all || s.o + s.text.length <= pos, before = !all && s.o >= pos;
        if (flash && flash.s === s) { s.el.classList.toggle("u", before); continue; }
        if (!read && !before) {   // the sentence being read
          cur = s; const k = pos - s.o;
          s.el.classList.remove("u"); s.el.classList.add("cur");
          s.el.innerHTML = esc(s.text.slice(0, k)) + `<span class="u">${esc(s.text.slice(k))}</span>`;
        } else s.el.classList.toggle("u", before);
      }
      const total = sents.length ? sents[sents.length - 1].o + sents[sents.length - 1].text.length : 0;
      prog.style.width = (all ? 0 : total ? Math.min(100, (pos / total) * 100) : 0) + "%";
      follow(false);
    }
    // Keep where it's reading in view (unless you scrolled away in the last few seconds).
    function follow(force){
      if (!force && Date.now() - userAt < 8000) return;
      if (!backBtn.hidden && !force) backBtn.hidden = true;
      const mark = cur && (cur.el.querySelector(".u") || cur.el); if (!mark) return;
      const r = mark.getBoundingClientRect(), tr = text.getBoundingClientRect();
      const y = r.top - tr.top;
      if (force || y < tr.height * 0.15 || y > tr.height * 0.6) text.scrollTo({ top: text.scrollTop + y - tr.height * 0.3, behavior: force ? "auto" : "smooth" });
    }

    return {
      root,
      update(p){
        last = p.pg || {};
        root.classList.toggle("gray", p.gray !== false);
        root.classList.toggle("clear", p.pclear === true);
        root.querySelector(".pp-title").textContent = [last.page ? `Page ${last.page}${last.pages ? " of " + last.pages : ""}` : "", p.info || ""].filter(Boolean).join(" · ");
        const pb = bar.querySelector('[data-c="play"]'); const pk = p.playing ? "pause" : "play"; if (pb.dataset.k !== pk) { pb.dataset.k = pk; pb.innerHTML = ICONS[pk]; pb.title = p.playing ? "Pause" : "Play"; } pb.hidden = !(p.audio || p.canRead);
        bar.querySelector('[data-c="back"]').hidden = bar.querySelector('[data-c="fwd"]').hidden = !(p.audio || p.speaking);
        if (!p.pg) { key = null; sents = []; text.innerHTML = `<p class="hint">${esc(p.hint || "Open an EPUB or text book in Pagekeeper to see its page here.")}</p>`; prog.style.width = "0"; return; }
        if (last.key !== key) { key = last.key; build(last); }
        paint(last.pos ?? -1);
      },
      focus(){ try { text.focus({ preventScroll: true }); } catch {} },
    };
  }
  window.PKPage = { mount };

  /* Focus: made for reading over a game or video. One sentence, big, on a see-through backing you set;
     the word being read has a bright marker so your eyes land on it straight away when you look back;
     the last sentence stays above for a moment (tap it to hear it again), the next one waits below. */
  const FCSS = `
.pf{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:.45em;padding:12px 18px 28px;box-sizing:border-box;overflow:hidden;color:var(--fg);border-radius:14px;
  background:color-mix(in srgb,var(--bg) calc(var(--plate,.7) * 100%),transparent);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;user-select:none;-webkit-user-select:none}
.pf-prev,.pf-next{font-size:calc(var(--fsize,30px) * .55);line-height:1.35;max-width:44ch;flex:none;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.pf-prev{opacity:.5;transition:opacity .8s;cursor:pointer}
.pf-prev:hover{opacity:.8}
.pf-prev.old{opacity:0;pointer-events:none}
.pf-next{opacity:.32}
.pf-cur{font-size:var(--fsize,30px);line-height:1.38;max-width:var(--measure,34ch);font-weight:var(--wt,650);flex:0 1 auto;min-height:0;overflow:hidden}
.pf.gray .pf-cur .u{opacity:.5}
.pf-cur mark{background:var(--hl,#FFD54A)!important;color:#141414!important;border-radius:.22em;padding:0 .14em;margin:0 -.14em;-webkit-box-decoration-break:clone;box-decoration-break:clone;text-shadow:none}
.pf.enter .pf-cur{animation:pfIn .22s ease-out}
@keyframes pfIn{from{opacity:0;transform:translateY(.25em)}to{opacity:1;transform:none}}
.pf.outline .pf-prev,.pf.outline .pf-cur,.pf.outline .pf-next{--o:var(--bg);text-shadow:0 0 3px var(--o),1.5px 1.5px 0 var(--o),-1.5px -1.5px 0 var(--o),1.5px -1.5px 0 var(--o),-1.5px 1.5px 0 var(--o)}
.pf-foot{position:absolute;left:14px;right:14px;bottom:6px;display:flex;align-items:center;gap:8px;font-size:11px;opacity:.65}
.pf-prog{flex:1;height:3px;border-radius:2px;background:color-mix(in srgb,var(--fg) 20%,transparent);overflow:hidden}
.pf-prog i{display:block;height:100%;background:var(--fg)}
.pf-paused{font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.pf .hint{font-size:15px;opacity:.75}`;
  let fstyled = false;
  function mountFocus(host, opts = {}){
    if (!fstyled) { const st = document.createElement("style"); st.textContent = FCSS; document.head.append(st); fstyled = true; }
    const onCmd = opts.onCmd || (() => {});
    const dr = opts.drag ? " data-tauri-drag-region" : "";
    const root = document.createElement("div"); root.className = "pf";
    if (opts.drag) root.setAttribute("data-tauri-drag-region", "");
    root.innerHTML = `<div class="pf-prev"${opts.drag ? "" : ""}></div><div class="pf-cur"${dr}></div><div class="pf-next"${dr}></div><div class="pf-foot"${dr}><span class="pf-paused"${dr}></span><span class="pf-info"${dr}></span><span class="pf-prog"${dr}><i${dr}></i></span></div>`;
    host.append(root);
    const prev = root.querySelector(".pf-prev"), cur = root.querySelector(".pf-cur"), next = root.querySelector(".pf-next");
    let key = null, oldTimer = 0, fo = null;
    // tap the last sentence: hear it again
    prev.addEventListener("click", e => { e.stopPropagation(); if (fo && fo.prevOff != null) onCmd("seek", { off: fo.prevOff, key: fo.pkey }); });
    return {
      root,
      update(p){
        fo = p.fo || null;
        const st = root.style;
        st.setProperty("--fsize", (p.size || 30) + "px");
        st.setProperty("--plate", String(p.plate ?? .7));
        st.setProperty("--wt", p.bold === false ? "450" : "650");
        root.classList.toggle("gray", p.gray !== false);
        root.classList.toggle("outline", (p.plate ?? .7) < .4);
        const foot = root.querySelector(".pf-foot");
        root.querySelector(".pf-paused").textContent = (p.audio || p.speaking || p.canRead) && !p.playing ? "Paused" : "";
        root.querySelector(".pf-info").textContent = p.showInfo === false ? "" : (p.info || "");
        if (!fo) { key = null; prev.textContent = next.textContent = ""; cur.innerHTML = `<span class="hint">${esc(p.hint || "Open a book in Pagekeeper.")}</span>`; foot.querySelector("i").style.width = "0"; return; }
        const changed = fo.key !== key;
        if (changed) {
          key = fo.key;
          prev.classList.remove("old"); clearTimeout(oldTimer);
          oldTimer = setTimeout(() => prev.classList.add("old"), 7000);   // the catch-up line fades after a while
          root.classList.remove("enter"); void root.offsetWidth; root.classList.add("enter");
        }
        prev.textContent = p.catchup === false ? "" : (fo.prev || "");
        prev.title = fo.prevOff != null ? "Tap to hear this again" : "";
        next.textContent = p.shownext === false ? "" : (fo.next || "");
        const t = fo.cur || "", at = fo.at ?? -1, w = p.hlWord === false ? null : fo.w;
        let html;
        if (at < 0) html = esc(t);
        else if (w) html = esc(t.slice(0, w[0])) + `<mark${dr}>${esc(t.slice(w[0], w[1]))}</mark><span class="u"${dr}>${esc(t.slice(w[1]))}</span>`;
        else html = esc(t.slice(0, at)) + `<span class="u"${dr}>${esc(t.slice(at))}</span>`;
        if (cur._h !== html) { cur._h = html; cur.innerHTML = html; }
        // not enough room: drop the next sentence first, then the catch-up line, so the main one fits
        next.style.display = prev.style.display = "";
        if (cur.scrollHeight > cur.clientHeight + 2) next.style.display = "none";
        if (cur.scrollHeight > cur.clientHeight + 2) prev.style.display = "none";
        // a long sentence: keep the word being read in view
        const m = cur.querySelector("mark");
        if (m && cur.scrollHeight > cur.clientHeight + 2) cur.scrollTop = Math.max(0, m.offsetTop - cur.offsetTop - cur.clientHeight / 3);
        else if (changed) cur.scrollTop = 0;
        foot.querySelector("i").style.width = Math.round(Math.max(0, Math.min(1, fo.pct || 0)) * 100) + "%";
      },
    };
  }
  window.PKFocus = { mount: mountFocus };
})();
