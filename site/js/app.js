/* SkyBlink core: router, data loading, flipbook viewer.
 * Static site, no build step. All data comes from site/data/.
 * Person D listens for the "skyblink:change" event and fills the #sb-* containers.
 */
"use strict";

const DATA = "data";

const MODES = {
  fast:     { name: "Hidden movers",   short: "fast" },
  slow:     { name: "Slow movers",     short: "slow" },
  variable: { name: "Blinking stars",  short: "variable" },
  color:    { name: "Strange colours", short: "color" },
};
const MODE_ORDER = ["fast", "slow", "variable", "color"];

const state = {
  targets: [],          // from data/targets.json
  targetsMissing: false,
  target: null,         // {id, name, ra, dec, modes, mission}
  mode: null,
  manifest: null,       // manifest.json for target/mode (not fast)
  candidates: null,     // fast/candidates.json (only read for the intro; D renders it)
  frame: 0,
  playing: false,
  timer: null,
  speed: 1,
  images: [],           // preloaded Image objects for the current manifest
  layers: { highlights: true, gaia: true, flagged: true, diff: false },
};

const $ = (sel, root = document) => root.querySelector(sel);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Data loading ---------- */

const jsonCache = new Map();
// Returns parsed JSON, or null if the file is missing or broken (never throws).
function fetchJSON(url) {
  if (!jsonCache.has(url)) {
    jsonCache.set(url, fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return jsonCache.get(url);
}

const modeDir = (id, mode) => `${DATA}/${encodeURIComponent(id)}/${mode}`;

async function loadTargets() {
  const list = await fetchJSON(`${DATA}/targets.json`);
  state.targetsMissing = !Array.isArray(list);
  state.targets = Array.isArray(list) ? list : [];
}

// A target from targets.json, or (if the list isn't published yet) one built
// only from files that exist for it: no invented names or numbers.
async function resolveTarget(id) {
  const known = state.targets.find(t => t.id === id);
  if (known) return known;
  const cands = await fetchJSON(`${modeDir(id, "fast")}/candidates.json`);
  const manifests = await Promise.all(MODE_ORDER.map(m => fetchJSON(`${modeDir(id, m)}/manifest.json`)));
  const modes = MODE_ORDER.filter((m, i) => manifests[i] || (m === "fast" && cands));
  if (!modes.length) return null;
  const field = cands && cands.field;
  return {
    id, name: id, modes,
    ra: field && typeof field.ra === "number" ? field.ra : null,
    dec: field && typeof field.dec === "number" ? field.dec : null,
    mission: null, unlisted: true,
  };
}

/* ---------- Routing ---------- */

function params() {
  const p = new URLSearchParams(location.search);
  return { target: p.get("target"), mode: p.get("mode"), hunt: p.get("hunt") };
}

function viewerURL(id, mode) {
  return `index.html?target=${encodeURIComponent(id)}&mode=${encodeURIComponent(mode)}`;
}

function navigate(url, { replace = false } = {}) {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin) {
    location.href = url;
    return;
  }
  history[replace ? "replaceState" : "pushState"](null, "", u.pathname + u.search + u.hash);
  route();
}

async function route() {
  stopPlaying();
  clearInterval(heroTimer);
  const { target, mode } = params();
  if (!state.targets.length && !state.targetsMissing) await loadTargets();
  if (target) await showViewer(target, mode);
  else showHome();
}

// In-app links: anything marked data-nav that points at this page.
document.addEventListener("click", e => {
  const a = e.target.closest("a[data-nav]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});
window.addEventListener("popstate", route);

/* ---------- Event for Person D ---------- */

function announce() {
  const t = state.target;
  document.dispatchEvent(new CustomEvent("skyblink:change", { detail: {
    target: t ? t.id : null, mode: t ? state.mode : null,
    ra: t ? t.ra : null, dec: t ? t.dec : null } }));
}

function fmtCoord(v, digits = 3) {
  return typeof v === "number" ? v.toFixed(digits) : "–";
}

/* ---------- Spectral ruler ---------- */

// SPHEREx detectors D1–D6: wavelength ranges in µm; flex-grow ∝ range width.
const DETECTORS = [
  { id: "D1", lo: 0.75, hi: 1.09, grow: 34 },
  { id: "D2", lo: 1.10, hi: 1.62, grow: 52 },
  { id: "D3", lo: 1.63, hi: 2.41, grow: 78 },
  { id: "D4", lo: 2.42, hi: 3.82, grow: 140 },
  { id: "D5", lo: 3.83, hi: 4.41, grow: 58 },
  { id: "D6", lo: 4.42, hi: 5.00, grow: 58 },
];
const WL_MIN = 0.75, WL_MAX = 5.0;

function detectorFor(wl) {
  if (typeof wl !== "number") return null;
  return DETECTORS.find(d => wl >= d.lo && wl < d.hi + 0.01) || null;
}

// One reusable ruler. wl = wavelength in µm to mark (or null for no marker).
function spectralRuler(wl, { compact = false } = {}) {
  const has = typeof wl === "number" && wl >= WL_MIN && wl <= WL_MAX;
  const det = has ? detectorFor(wl) : null;
  const pos = has ? ((wl - WL_MIN) / (WL_MAX - WL_MIN)) * 100 : 0;
  const label = has
    ? `Spectral ruler from ${WL_MIN} to ${WL_MAX.toFixed(1)} µm, marker at ${wl} µm${det ? `, detector ${det.id}` : ""}`
    : `Spectral ruler from ${WL_MIN} to ${WL_MAX.toFixed(1)} µm`;
  return `
    <div class="ruler${compact ? " ruler-compact" : ""}" role="img" aria-label="${esc(label)}">
      <div class="ruler-bar">
        ${DETECTORS.map(d => `<span class="ruler-seg${det && det.id === d.id ? " is-current" : ""}"
          style="flex-grow:${d.grow};background:var(--${d.id.toLowerCase()})"><span class="ruler-seg-label">${d.id}</span></span>`).join("")}
        ${has ? `<span class="ruler-marker" style="left:${pos.toFixed(2)}%"></span>` : ""}
      </div>
      <div class="ruler-ends"><span>${WL_MIN} µm</span>${has ? `<span class="ruler-now">${wl} µm</span>` : ""}<span>${WL_MAX.toFixed(1)} µm</span></div>
    </div>`;
}

// Which highlights belong to frame i: those whose label names the frame's year;
// otherwise, if there's one highlight per frame, the one with the same index.
function highlightsForFrame(m, i) {
  const hl = Array.isArray(m.highlights) ? m.highlights : [];
  const f = m.frames[i];
  const year = f && f.date ? String(f.date).slice(0, 4) : "";
  const byYear = year ? hl.filter(h => String(h.label || "").includes(year)) : [];
  if (byYear.length) return byYear;
  if (hl.length === m.frames.length && hl.length > 1) return [hl[i]];
  return hl;
}

/* ---------- Home ---------- */

const MODE_INFO = {
  fast: {
    desc: "Faint objects drifting across the sky, too faint to see in a single photo until our software stacks them.",
    pill: "Our engine",
    icon: `<path d="M4 20 L20 4" stroke-dasharray="2 3"/><circle cx="20" cy="4" r="2.5"/><circle cx="6" cy="8" r="1"/><circle cx="16" cy="18" r="1"/>`,
  },
  slow: {
    desc: "Blink a 2010 WISE image against SPHEREx in the same colour and watch nearby stars crawl.",
    pill: "2010 → 2026",
    icon: `<circle cx="7" cy="14" r="3" stroke-dasharray="2 2"/><circle cx="17" cy="10" r="3"/><path d="M10 13 L14 11"/>`,
  },
  variable: {
    desc: "Follow one star's brightness over time, always with the same detector.",
    pill: "same detector only",
    icon: `<path d="M3 15 L7 15 L9 8 L12 18 L15 6 L17 15 L21 15"/>`,
  },
  color: {
    desc: "Step through SPHEREx's 6 detectors from blue to red and see how an object's colour changes.",
    pill: "experimental",
    icon: `<circle cx="12" cy="12" r="8"/><path d="M12 4 V20 M4 12 H20"/>`,
  },
};

const HOW = [
  { title: "Match the colour", text: "We only blink images taken in the same infrared colour, so a change you see is real, not a trick of the filter." },
  { title: "Stack the photos", text: "For hidden movers, our software adds up about 120 exposures along possible paths, so something too faint for one photo starts to show." },
  { title: "Check, then you decide", text: "Each find is checked against known Gaia stars and bad pixels. Then you look at it yourself and decide." },
];

const HERO_SOURCE = { target: "barnard", mode: "slow" };
let heroTimer = null;

function showHome() {
  state.target = null;
  state.mode = null;
  state.manifest = null;
  state.candidates = null;
  document.title = "SkyBlink · Watch the sky change";
  $("#viewer").hidden = true;
  setSlots(null);
  const home = $("#home");
  home.hidden = false;

  home.innerHTML = `
    <div class="wrap">
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="eyebrow">SPHEREx · 102 infrared colours · the whole sky every 6 months</p>
          <h1 id="hero-title" class="hero-title">Watch the sky change.</h1>
          <p class="hero-sub">Flip through NASA infrared images of the same patch of sky, years apart, and spot what moves, blinks or changes colour.</p>
          <form class="search" id="search" role="search">
            <label class="visually-hidden" for="search-input">Star name or coordinates</label>
            <input id="search-input" type="search" placeholder="Star name or coordinates" autocomplete="off" spellcheck="false">
            <button class="btn btn-primary" type="submit">Start exploring</button>
          </form>
          <p class="search-msg" id="search-msg" role="status"></p>
          <p class="hero-mission">Or start with a mission: <a href="${viewerURL("barnard", "slow")}" data-nav>find the fastest star in the sky</a></p>
        </div>
        <figure class="hero-preview" id="hero-preview"></figure>
      </section>

      <section class="section" id="hunt" aria-labelledby="hunt-title">
        <h2 class="section-title" id="hunt-title">What are you hunting?</h2>
        <div class="mode-grid" id="mode-grid"></div>
      </section>

      <section class="section" id="log" aria-labelledby="log-title">
        <h2 class="section-title" id="log-title">Observing log</h2>
        <div id="log-body"></div>
      </section>

      <section class="section" id="how" aria-labelledby="how-title">
        <h2 class="section-title" id="how-title">How it works, in 30 seconds</h2>
        <ol class="how-grid">
          ${HOW.map((h, i) => `<li class="card how-card">
            <span class="how-num">${String(i + 1).padStart(2, "0")}</span>
            <h3>${h.title}</h3><p>${h.text}</p></li>`).join("")}
        </ol>
      </section>
    </div>`;

  renderModeCards();
  renderLog();
  renderHeroPreview();
  $("#search").addEventListener("submit", onSearch);

  // Honour #log / #how after re-render.
  const el = location.hash && document.getElementById(location.hash.slice(1));
  if (el) el.scrollIntoView(); else window.scrollTo(0, 0);
  announce();
}

function currentHunt() {
  const { hunt } = params();
  return MODES[hunt] ? hunt : null;
}

function setHunt(mode) {
  const url = mode ? `index.html?hunt=${mode}#log` : "index.html#log";
  history.replaceState(null, "", url);
  renderModeCards();
  renderLog();
}

function renderModeCards() {
  const hunt = currentHunt();
  const grid = $("#mode-grid");
  grid.innerHTML = MODE_ORDER.map(m => {
    const info = MODE_INFO[m];
    const examples = state.targets.filter(t => (t.modes || []).includes(m)).map(t => t.name);
    return `<button type="button" class="card mode-card" data-mode="${m}" aria-pressed="${hunt === m}">
      <span class="mode-card-top">
        <svg class="mode-icon" viewBox="0 0 24 24" aria-hidden="true">${info.icon}</svg>
        <span class="chip chip-mono${m === "fast" ? " chip-accent" : ""}">${info.pill}</span>
      </span>
      <span class="mode-name">${MODES[m].name}</span>
      <span class="mode-desc">${info.desc}</span>
      <span class="mode-examples">${examples.length ? esc(examples.join(" · ")) : "Targets coming soon"}</span>
    </button>`;
  }).join("");
  grid.querySelectorAll(".mode-card").forEach(b => b.addEventListener("click", () => {
    const m = b.dataset.mode;
    setHunt(currentHunt() === m ? null : m);
  }));
}

function renderLog() {
  const hunt = currentHunt();
  $("#log-title").textContent = hunt ? `Observing log · ${MODES[hunt].name}` : "Observing log";
  const list = hunt ? state.targets.filter(t => (t.modes || []).includes(hunt)) : state.targets;
  const body = $("#log-body");

  if (state.targetsMissing) {
    body.innerHTML = `<div class="notice"><p>The target list (<code>data/targets.json</code>) hasn't been published yet.</p></div>`;
    return;
  }
  const clear = hunt ? `<p class="log-filter">Showing targets with ${MODES[hunt].name.toLowerCase()}. <button type="button" class="link-btn" id="clear-hunt">Show all targets</button></p>` : "";
  body.innerHTML = clear + (list.length ? `<ol class="log-list">${list.map((t, i) => `
      <li class="card log-row">
        <span class="log-num">${String(i + 1).padStart(2, "0")}</span>
        <div class="log-main">
          <h3 class="log-name"><a href="${viewerURL(t.id, hunt || (t.modes || [])[0] || "slow")}" data-nav>${esc(t.name)}</a></h3>
          ${t.mission ? `<p class="log-mission">${esc(t.mission)}</p>` : ""}
          <div class="mode-chips">${(t.modes || []).filter(m => MODES[m]).map(m =>
            `<a class="chip mode-chip${m === hunt ? " is-on" : ""}" href="${viewerURL(t.id, m)}" data-nav>${MODES[m].name}</a>`).join("")}</div>
        </div>
        <span class="log-coords">RA ${fmtCoord(t.ra)}°<br>Dec ${fmtCoord(t.dec)}°</span>
      </li>`).join("")}</ol>` : `<p>No targets for this mode yet.</p>`);
  const c = $("#clear-hunt");
  if (c) c.addEventListener("click", () => setHunt(null));
}

async function renderHeroPreview() {
  clearInterval(heroTimer);
  const fig = $("#hero-preview");
  const dir = modeDir(HERO_SOURCE.target, HERO_SOURCE.mode);
  const m = await fetchJSON(`${dir}/manifest.json`);
  if (!fig.isConnected) return;
  if (!m || !Array.isArray(m.frames) || !m.frames.length) {
    fig.innerHTML = `<div class="hero-stage reticle"></div>${spectralRuler(null)}`;
    return;
  }
  fig.innerHTML = `
    <div class="hero-stage reticle">
      ${m.frames.map((f, i) => `<img src="${dir}/${encodeURIComponent(f.file)}" alt="" data-i="${i}"${i ? " hidden" : ""}>`).join("")}
      <div class="hero-rings" id="hero-rings"></div>
      <div class="stage-chips" id="hero-chips"></div>
    </div>
    <figcaption id="hero-cap"></figcaption>`;

  const imgs = fig.querySelectorAll("img");
  const show = i => {
    const f = m.frames[i];
    imgs.forEach((im, j) => { im.hidden = j !== i; });
    // Rings sit at pixel positions; convert to % of the image's natural size.
    const im = imgs[i];
    const place = () => {
      const w = im.naturalWidth || 1, h = im.naturalHeight || 1;
      $("#hero-rings").innerHTML = highlightsForFrame(m, i).map(p =>
        `<span class="ring" style="left:${((p.x + 0.5) / w) * 100}%;top:${((p.y + 0.5) / h) * 100}%"></span>`).join("");
    };
    if (im.complete) place(); else im.onload = place;
    $("#hero-chips").innerHTML = m.frames.map((g, j) =>
      `<span class="chip chip-mono${j === i ? " is-on" : ""}">${esc(telescopeOf(g))} · ${esc(String(g.date || "").slice(0, 4))}</span>`).join("") +
      (m.fake ? `<span class="chip chip-mono chip-warn">Sample data</span>` : "");
    $("#hero-cap").innerHTML = spectralRuler(f.wavelength_um) +
      `<span class="hero-cap-text">Barnard's Star, ${esc(f.label || "")}</span>`;
    imgs.forEach(x => { x.alt = ""; });
    im.alt = `Infrared image of the sky around Barnard's Star: ${f.label || ""}, ${f.date || ""}`;
  };
  let i = 0;
  show(0);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (m.frames.length > 1 && !reduce) {
    heroTimer = setInterval(() => {
      if (!fig.isConnected) { clearInterval(heroTimer); return; }
      i = (i + 1) % m.frames.length;
      show(i);
    }, 1400);
  }
}

// "WISE" / "SPHEREx" from the frame label (e.g. "WISE W2 (4.6 µm)").
function telescopeOf(f) {
  const s = String(f.label || "");
  if (/wise/i.test(s)) return "WISE";
  if (/spherex/i.test(s)) return "SPHEREx";
  return s.split(" ")[0] || "Frame";
}

/* ---------- Search ---------- */

function angularSepDeg(ra1, dec1, ra2, dec2) {
  const r = Math.PI / 180;
  const c = Math.sin(dec1 * r) * Math.sin(dec2 * r) + Math.cos(dec1 * r) * Math.cos(dec2 * r) * Math.cos((ra1 - ra2) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
}

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function onSearch(e) {
  e.preventDefault();
  const q = $("#search-input").value.trim();
  const msg = $("#search-msg");
  msg.textContent = "";
  if (!q) { msg.textContent = "Type a star name, like Barnard's Star, or coordinates like 269.45 4.77."; return; }

  const nums = q.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const isCoords = nums.length === 2 && nums.every(n => !isNaN(parseFloat(n)) && isFinite(n));

  if (state.targetsMissing || !state.targets.length) {
    msg.textContent = "Our target list isn't published yet. Try the mission link below for now.";
    return;
  }

  let hit = null;
  if (isCoords) {
    const [ra, dec] = nums.map(parseFloat);
    if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) {
      msg.textContent = "Coordinates should be RA 0–360° and Dec −90–90°, in degrees.";
      return;
    }
    let best = null;
    for (const t of state.targets) {
      if (typeof t.ra !== "number" || typeof t.dec !== "number") continue;
      const d = angularSepDeg(ra, dec, t.ra, t.dec);
      if (!best || d < best.d) best = { t, d };
    }
    if (best && best.d <= 0.5) hit = best.t;
  } else {
    const nq = norm(q);
    hit = state.targets.find(t => norm(t.name) === nq || norm(t.id) === nq)
       || state.targets.find(t => norm(t.name).includes(nq) || norm(t.id).includes(nq) || nq.includes(norm(t.id)));
  }

  if (hit) {
    navigate(viewerURL(hit.id, (hit.modes || [])[0] || "slow"));
  } else {
    const names = state.targets.map(t => t.name).join(", ");
    msg.textContent = isCoords
      ? `Nothing in our observing log near those coordinates yet. Try one of: ${names}.`
      : `We couldn't find “${q}” yet. Try one of: ${names}.`;
  }
}

/* ---------- Viewer ---------- */

const D_SLOTS = {
  "sb-slow-result":     m => m === "slow",
  "sb-fast-candidates": m => m === "fast",
  "sb-fast-rejected":   m => m === "fast",
  "sb-target-aladin":   () => true,
};

function setSlots(mode) {
  for (const [id, show] of Object.entries(D_SLOTS)) {
    const el = document.getElementById(id);
    if (el) el.hidden = !mode || !show(mode);
  }
}

async function showViewer(targetId, modeParam) {
  $("#home").hidden = true;
  const viewer = $("#viewer");
  viewer.hidden = false;

  const t = await resolveTarget(targetId);
  if (!t) {
    state.target = null;
    state.mode = null;
    document.title = "Unknown target · SkyBlink";
    $("#viewer-head").innerHTML = `<div class="wrap viewer-head"><a class="back-link" href="index.html#log" data-nav>← Observing log</a></div>`;
    $("#viewer-body").innerHTML = `<div class="wrap"><div class="card coming-soon">
      <h1>Unknown target</h1><p>We don't have a target called “${esc(targetId)}”.</p>
      <a class="btn btn-primary" href="index.html#log" data-nav>Back to the observing log</a></div></div>`;
    setSlots(null);
    announce();
    return;
  }

  const modes = (t.modes || []).filter(m => MODES[m]);
  const mode = MODES[modeParam] ? modeParam : (modes[0] || "slow");
  // Fix up the URL so it's always shareable as target+mode.
  if (mode !== modeParam) history.replaceState(null, "", viewerURL(t.id, mode));

  state.target = t;
  state.mode = mode;
  state.manifest = null;
  state.candidates = null;
  state.frame = 0;
  state.fov = null;
  state.diffCache = {};
  document.title = `${t.name} · ${MODES[mode].name} · SkyBlink`;

  renderHead(t, mode, modes);

  const listed = modes.includes(mode);
  if (mode === "fast") {
    state.candidates = listed ? await fetchJSON(`${modeDir(t.id, "fast")}/candidates.json`) : null;
  } else {
    state.manifest = listed ? await fetchJSON(`${modeDir(t.id, mode)}/manifest.json`) : null;
  }

  // Guard against a newer navigation finishing first.
  if (state.target !== t || state.mode !== mode) return;

  renderBody(t, mode);
  setSlots(mode);
  announce();
}

function renderHead(t, mode, modes) {
  const url = new URL(viewerURL(t.id, mode), location.href).href;
  $("#viewer-head").innerHTML = `
    <div class="wrap viewer-head">
      <a class="back-link" href="index.html#log" data-nav>← Observing log</a>
      <h1 class="target-name">${esc(t.name)}</h1>
      ${t.mission ? `<p class="target-mission">Mission: ${esc(t.mission)}</p>` : ""}
      <div class="share">
        <output class="share-url" aria-label="Shareable link">${esc(url)}</output>
        <button class="btn" type="button" id="copy-link">Copy link</button>
      </div>
      <nav class="pills mode-tabs" aria-label="Modes">
        ${MODE_ORDER.map(m => modes.includes(m)
          ? `<a class="pill" href="${viewerURL(t.id, m)}" data-nav${m === mode ? ' aria-current="page"' : ""}>${MODES[m].name}</a>`
          : `<a class="pill" role="link" aria-disabled="true" title="Coming soon for this target">${MODES[m].name}</a>`
        ).join("")}
      </nav>
    </div>`;
  $("#copy-link").addEventListener("click", async e => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = "Copied!";
    } catch {
      btn.textContent = "Select the link above";
    }
    setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
  });
}

function comingSoon(t, mode) {
  return `<div class="wrap"><div class="card coming-soon">
    <h2>${MODES[mode].name}: coming soon</h2>
    <p>We haven't prepared ${MODES[mode].name.toLowerCase()} images for ${esc(t.name)} yet.</p>
  </div></div>`;
}

function renderBody(t, mode) {
  const body = $("#viewer-body");

  if (mode === "fast") {
    if (!state.candidates) { body.innerHTML = comingSoon(t, mode); return; }
    const n = state.candidates.field && state.candidates.field.exposures;
    body.innerHTML = `<div class="wrap"><div class="intro">
      <p>Our software stacked ${typeof n === "number" ? n : "~120"} exposures of this patch of sky,
      shifting them along many possible paths so that something faint and moving adds up while the stars stay put.
      Each find below was checked automatically. Look at it, then you decide.</p>
    </div></div>`;
    return;
  }

  const m = state.manifest;
  if (!m || !Array.isArray(m.frames) || !m.frames.length) { body.innerHTML = comingSoon(t, mode); return; }

  const n = m.frames.length;
  body.innerHTML = `
    <div class="wrap">
      <div class="viewer-grid">
        <div class="stage-col">
          <div class="stage reticle" id="stage">
            <canvas id="stage-canvas" role="img"></canvas>
            <div class="stage-chips" id="stage-chips"></div>
            <div class="stage-chips stage-chips-right" id="stage-chips-right"></div>
            <div class="scale-bar" id="scale-bar" hidden></div>
          </div>

          <div class="controls">
            <button class="btn btn-icon" type="button" id="prev" aria-label="Previous frame">◀</button>
            <button class="btn btn-primary play-btn" type="button" id="play" aria-label="Play">Play</button>
            <button class="btn btn-icon" type="button" id="next" aria-label="Next frame">▶</button>
            <span class="frame-count" id="frame-count" aria-live="polite"></span>
          </div>

          <div class="strip" id="strip" role="group" aria-label="Frames">
            ${m.frames.map((f, i) => `<button type="button" class="strip-bar" data-i="${i}"
              aria-label="Frame ${i + 1} of ${n}: ${esc(f.date || "")} ${esc(f.label || "")}" title="${esc(f.date || "")} · ${esc(f.label || "")}"><span></span></button>`).join("")}
          </div>

          <div class="control-row">
            <span class="control-label" id="speed-label">Speed</span>
            <div class="pills" role="group" aria-labelledby="speed-label">
              ${[0.5, 1, 2].map(s => `<button type="button" class="pill pill-sm" data-speed="${s}" aria-pressed="${s === state.speed}">${s}×</button>`).join("")}
            </div>
          </div>
          <div class="control-row" id="fov-row" hidden>
            <span class="control-label" id="fov-label">Field</span>
            <div class="pills" role="group" aria-labelledby="fov-label"></div>
          </div>
          <p class="kbd-hint">Keyboard: <kbd>Space</kbd> play/pause · <kbd>←</kbd> <kbd>→</kbd> step</p>
        </div>
        <div class="side" id="side">${sideStatic(m, mode)}</div>
      </div>
    </div>`;

  $("#prev").addEventListener("click", () => { stopPlaying(); step(-1); });
  $("#next").addEventListener("click", () => { stopPlaying(); step(1); });
  $("#play").addEventListener("click", togglePlay);
  $("#strip").addEventListener("click", e => {
    const b = e.target.closest(".strip-bar");
    if (b) { stopPlaying(); showFrame(+b.dataset.i); }
  });
  body.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => {
    state.speed = +b.dataset.speed;
    body.querySelectorAll("[data-speed]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    if (state.playing) { stopPlaying(); startPlaying(); }
  }));

  wireSide();
  $("#fov-row").addEventListener("click", e => {
    const b = e.target.closest("[data-fov]");
    if (!b) return;
    state.fov = b.dataset.fov ? +b.dataset.fov : null;
    renderFovPills();
    drawStage();
  });
  loadFrameImages(t, mode, m);
  if (stageObserver) stageObserver.disconnect();
  stageObserver = new ResizeObserver(() => { drawStage(); updateSide(); });
  stageObserver.observe($("#stage"));
  showFrame(0);
}

/* ---------- Right column ---------- */

// "2010" → 2010.5, "2026-08-22" → 2026.64. Year-only dates sit mid-year.
function decimalYear(s) {
  const str = String(s || "");
  const m = str.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
  if (!m) return null;
  const y = +m[1];
  if (!m[2]) return y + 0.5;
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  const t = Date.UTC(y, +m[2] - 1, m[3] ? +m[3] : 15);
  return y + (t - start) / (end - start);
}

function sideStatic(m, mode) {
  const anyFlag = m.frames.some(f => typeof f.flagged_fraction === "number" && f.flagged_fraction > 0);
  const hasHl = Array.isArray(m.highlights) && m.highlights.length > 0;
  const hasGaia = Array.isArray(m.gaia) && m.gaia.length > 0;
  const layer = (key, name, available, note, swatch) => `
    <label class="layer${available ? "" : " is-off"}">
      <input type="checkbox" data-layer="${key}"${state.layers[key] && available ? " checked" : ""}${available ? "" : " disabled"}>
      <span class="layer-swatch layer-${swatch}" aria-hidden="true"></span>
      <span>${name}${available ? "" : ` <span class="layer-note">(${note})</span>`}</span>
    </label>`;
  const lc = Array.isArray(m.lightcurve) && m.lightcurve.length ? m.lightcurve : null;

  return `
    <section class="card" aria-labelledby="tf-title">
      <h2 id="tf-title">This frame</h2>
      <div id="this-frame"></div>
    </section>
    <section class="card" aria-labelledby="tl-title">
      <h2 id="tl-title">Timeline</h2>
      <div class="chart" id="timeline"></div>
      <p class="legend"><span class="key key-wise"></span>WISE <span class="key key-spx"></span>SPHEREx <span class="key key-now"></span>this frame</p>
    </section>
    ${mode === "variable" && lc ? `
    <section class="card" aria-labelledby="bc-title">
      <h2 id="bc-title">Brightness over time</h2>
      <div class="chart" id="brightness"></div>
      <details class="table-view"><summary>Show as table</summary>
        <table><thead><tr><th scope="col">Date</th><th scope="col">Flux</th><th scope="col">Detector</th></tr></thead>
        <tbody>${lc.map(p => `<tr><td>${esc(p.date)}</td><td>${esc(p.flux)}</td><td>${esc(p.detector ?? "–")}</td></tr>`).join("")}</tbody></table>
      </details>
    </section>` : ""}
    ${mode === "color" ? `
    <section class="card" aria-labelledby="db-title">
      <h2 id="db-title">Detectors</h2>
      <div class="det-bars" id="det-bars"></div>
    </section>` : ""}
    <section class="card" aria-labelledby="ly-title">
      <h2 id="ly-title">Layers</h2>
      <div class="layers">
        ${layer("highlights", "Highlights", hasHl, "none for this target", "hl")}
        ${layer("gaia", "Known stars (Gaia DR3)", hasGaia, "none in this field", "gaia")}
        ${layer("flagged", "Flagged pixels", anyFlag, "none flagged", "flag")}
        ${layer("diff", "Difference view", m.frames.length > 1, "needs 2+ frames", "diff")}
      </div>
    </section>
    ${m.notes ? `<section class="card" aria-labelledby="nt-title"><h2 id="nt-title">Notes</h2><p class="notes">${esc(m.notes)}</p></section>` : ""}`;
}

function wireSide() {
  document.querySelectorAll("[data-layer]").forEach(cb => cb.addEventListener("change", () => {
    state.layers[cb.dataset.layer] = cb.checked;
    showFrame(state.frame);
  }));
  // Timeline dots, brightness points and detector bars jump to their frame.
  $("#side").addEventListener("click", e => {
    const b = e.target.closest("[data-frame]");
    if (b) { stopPlaying(); showFrame(+b.dataset.frame); }
  });
  $("#side").addEventListener("keydown", e => {
    const b = e.target.closest("svg [data-frame]");
    if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); stopPlaying(); showFrame(+b.dataset.frame); }
  });
}

function updateSide() {
  const m = state.manifest;
  if (!m || !$("#side")) return;
  const f = m.frames[state.frame];
  // Keep keyboard focus on the same chart element after re-render.
  const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest("#side [data-focus-key]");
  const focusKey = focused && focused.getAttribute("data-focus-key");

  const det = detectorFor(f.wavelength_um);
  const flagged = typeof f.flagged_fraction === "number" ? `${(f.flagged_fraction * 100).toFixed(1)} %` : "–";
  const sentence = state.mode === "color"
    ? "Each frame here is a different detector, from blue to red: the colour change IS the signal."
    : "Every frame here was taken in the same colour, so a star that changes is really changing.";
  $("#this-frame").innerHTML = `
    <dl class="facts">
      <div><dt>Date</dt><dd>${esc(f.date || "–")}</dd></div>
      <div><dt>Telescope</dt><dd>${esc(telescopeOf(f))}</dd></div>
      <div><dt>Colour</dt><dd>${typeof f.wavelength_um === "number" ? `${f.wavelength_um} µm${det && /spherex/i.test(f.label || "") ? ` · ${det.id}` : ""}` : "–"}</dd></div>
      <div><dt>Flagged</dt><dd>${flagged}</dd></div>
    </dl>
    ${spectralRuler(f.wavelength_um)}
    <p class="frame-sentence">${sentence}</p>`;

  const tl = $("#timeline");
  tl.innerHTML = timelineSVG(m, tl.clientWidth || 320);
  const bc = $("#brightness");
  if (bc) bc.innerHTML = brightnessSVG(m, bc.clientWidth || 320);
  const db = $("#det-bars");
  if (db) db.innerHTML = detectorBars(m);

  if (focusKey) {
    const el = document.querySelector(`#side [data-focus-key="${CSS.escape(focusKey)}"]`);
    if (el) el.focus();
  }
}

/* Timeline: 2010 → 2027, one dot per frame. */
function timelineSVG(m, W) {
  const H = 64, x0 = 12, x1 = W - 12, y = 26;
  const Y0 = 2010, Y1 = 2027;
  const X = yr => x0 + ((Math.min(Math.max(yr, Y0), Y1) - Y0) / (Y1 - Y0)) * (x1 - x0);
  const ticks = [2010, 2014, 2018, 2022, 2026];
  const dots = m.frames.map((f, i) => ({ f, i, yr: decimalYear(f.date) })).filter(d => d.yr !== null);
  // Current frame drawn last so it sits on top.
  dots.sort((a, b) => (a.i === state.frame) - (b.i === state.frame));
  return `<svg viewBox="0 0 ${W} ${H}" class="tl-svg" role="group" aria-label="Timeline of frame dates from 2010 to 2027">
    <line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" class="axis"/>
    ${ticks.map(t => `<line x1="${X(t)}" y1="${y - 4}" x2="${X(t)}" y2="${y + 4}" class="axis"/>
      <text x="${X(t)}" y="${y + 22}" class="tick" text-anchor="middle">${t}</text>`).join("")}
    ${dots.map(({ f, i, yr }) => {
      const cls = i === state.frame ? "dot-now" : /wise/i.test(f.label || "") ? "dot-wise" : "dot-spx";
      const label = `Frame ${i + 1}: ${f.date || ""} ${f.label || ""}`;
      return `<g class="hit" tabindex="0" role="button" data-frame="${i}" data-focus-key="tl-${i}" aria-label="${esc(label)}">
        <title>${esc(label)}</title>
        <circle cx="${X(yr)}" cy="${y}" r="12" class="hit-area"/>
        <circle cx="${X(yr)}" cy="${y}" r="${i === state.frame ? 6 : 5}" class="${cls}"/>
      </g>`;
    }).join("")}
  </svg>`;
}

/* Brightness chart (variable mode): flux over time from the manifest's lightcurve. */
function brightnessSVG(m, W) {
  const lc = m.lightcurve.map(p => ({ ...p, yr: decimalYear(p.date) })).filter(p => p.yr !== null && typeof p.flux === "number");
  if (!lc.length) return `<p class="muted">No brightness measurements yet.</p>`;
  const H = 180, L = 44, R = 12, T = 12, B = 30;
  let xmin = Math.min(...lc.map(p => p.yr)), xmax = Math.max(...lc.map(p => p.yr));
  if (xmax - xmin < 1e-6) { xmin -= 0.5; xmax += 0.5; }
  let ymin = Math.min(...lc.map(p => p.flux)), ymax = Math.max(...lc.map(p => p.flux));
  const pad = (ymax - ymin) * 0.12 || Math.abs(ymax) * 0.1 || 1;
  ymin -= pad; ymax += pad;
  const X = v => L + ((v - xmin) / (xmax - xmin)) * (W - L - R);
  const Y = v => T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B);
  const fmt = v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2);
  const grid = [0, 0.5, 1].map(k => ymin + pad + k * (ymax - ymin - 2 * pad));

  const curDate = m.frames[state.frame].date;
  const frameOf = p => m.frames.findIndex(f => f.date === p.date);
  const pts = lc.slice().sort((a, b) => a.yr - b.yr);

  return `<svg viewBox="0 0 ${W} ${H}" class="bc-svg" role="group" aria-label="Brightness over time, ${pts.length} measurements">
    ${grid.map(g => `<line x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}" class="grid"/>
      <text x="${L - 6}" y="${Y(g) + 4}" class="tick" text-anchor="end">${fmt(g)}</text>`).join("")}
    <text x="${L}" y="${H - 8}" class="tick">${esc(pts[0].date)}</text>
    <text x="${W - R}" y="${H - 8}" class="tick" text-anchor="end">${esc(pts[pts.length - 1].date)}</text>
    <polyline class="series" points="${pts.map(p => `${X(p.yr).toFixed(1)},${Y(p.flux).toFixed(1)}`).join(" ")}"/>
    ${pts.map((p, k) => {
      const fi = frameOf(p);
      const now = p.date === curDate;
      const label = `${p.date}: flux ${p.flux}${p.detector ? `, detector ${p.detector}` : ""}`;
      const attrs = fi >= 0 ? ` tabindex="0" role="button" data-frame="${fi}" data-focus-key="bc-${k}"` : "";
      return `<g class="hit"${attrs} aria-label="${esc(label)}"><title>${esc(label)}</title>
        <circle cx="${X(p.yr)}" cy="${Y(p.flux)}" r="12" class="hit-area"/>
        <circle cx="${X(p.yr)}" cy="${Y(p.flux)}" r="${now ? 5.5 : 4}" class="${now ? "pt-now" : "pt"}"/></g>`;
    }).join("")}
  </svg>`;
}

/* Detector bars (colour mode): D1–D6, the current frame's detector fully opaque. */
function detectorBars(m) {
  const cur = detectorFor(m.frames[state.frame].wavelength_um);
  return DETECTORS.map(d => {
    const fi = m.frames.findIndex(f => { const x = detectorFor(f.wavelength_um); return x && x.id === d.id; });
    const isCur = cur && cur.id === d.id;
    const range = `${d.lo.toFixed(2)}–${d.hi.toFixed(2)} µm`;
    return `<button type="button" class="det-bar${isCur ? " is-current" : ""}"${fi >= 0 ? ` data-frame="${fi}"` : " disabled"}
      data-focus-key="db-${d.id}" aria-pressed="${!!isCur}" aria-label="Detector ${d.id}, ${range}${fi >= 0 ? "" : ", no frame"}">
      <span class="det-fill" style="background:var(--${d.id.toLowerCase()})"></span>
      <span class="det-id">${d.id}</span><span class="det-range">${range}</span>
    </button>`;
  }).join("");
}

/* ---------- Stage (canvas) ---------- */

let stageObserver = null;

function loadFrameImages(t, mode, m) {
  const dir = modeDir(t.id, mode);
  state.images = m.frames.map((f, i) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (state.manifest !== m) return;
      if (i === 0) renderFovPills();
      if (state.frame === i || (i === 0 && state.layers.diff)) drawStage();
    };
    img.onerror = () => { img.failed = true; if (state.manifest === m && state.frame === i) drawStage(); };
    img.src = `${dir}/${encodeURIComponent(f.file)}`;
    return img;
  });
}

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Pixels the pipeline left blank (NaN → transparent in the PNG) count as flagged.
function flaggedPixels(img) {
  if (img._flagged) return img._flagged;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const out = [];
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) out.push([((i - 3) / 4) % c.width, Math.floor((i - 3) / 4 / c.width)]);
  img._flagged = out;
  return out;
}

// Pixel scale in arcsec/pixel, only if the data provides it.
function pixelScale(m, f) {
  const v = (f && f.pixel_scale_arcsec) ?? m.pixel_scale_arcsec;
  return typeof v === "number" && v > 0 ? v : null;
}

// Difference view: this frame minus the first frame, on a mid-grey background,
// so anything that stayed the same disappears. Blank (flagged) pixels stay grey.
function differenceCanvas(i) {
  state.diffCache = state.diffCache || {};
  if (state.diffCache[i]) return state.diffCache[i];
  const a = state.images[0], b = state.images[i];
  if (!a || !b || !a.naturalWidth || !b.naturalWidth || a.failed || b.failed) return null;
  if (a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight) return null;
  const w = a.naturalWidth, h = a.naturalHeight;
  const read = img => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    return x.getImageData(0, 0, w, h);
  };
  const A = read(a).data, B = read(b);
  const D = B.data;
  for (let k = 0; k < D.length; k += 4) {
    const ok = A[k + 3] >= 128 && D[k + 3] >= 128;
    const ga = (A[k] + A[k + 1] + A[k + 2]) / 3, gb = (D[k] + D[k + 1] + D[k + 2]) / 3;
    const v = ok ? Math.max(0, Math.min(255, Math.round(128 + gb - ga))) : 128;
    D[k] = D[k + 1] = D[k + 2] = v; D[k + 3] = 255;
  }
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  out.getContext("2d").putImageData(B, 0, 0);
  state.diffCache[i] = out;
  return out;
}

// Field of view: offered only when the data gives a pixel scale, and only sizes that fit.
const FOV_CHOICES = [3, 6, 12];
function fullFovArcmin(m) {
  const img = state.images && state.images[0];
  const ps = pixelScale(m, m.frames[0]);
  if (!ps || !img || !img.naturalWidth) return null;
  return (Math.min(img.naturalWidth, img.naturalHeight) * ps) / 60;
}

function viewRect(m, f, iw, ih) {
  const ps = pixelScale(m, f);
  if (!state.fov || !ps) return { x: 0, y: 0, w: iw, h: ih };
  const size = Math.min((state.fov * 60) / ps, iw, ih);
  return { x: (iw - size) / 2, y: (ih - size) / 2, w: size, h: size };
}

function renderFovPills() {
  const row = $("#fov-row");
  const m = state.manifest;
  if (!row || !m) return;
  const full = fullFovArcmin(m);
  if (!full) { row.hidden = true; return; }
  const fits = FOV_CHOICES.filter(v => v < full - 0.05);
  if (state.fov && !fits.includes(state.fov)) state.fov = null;
  row.hidden = false;
  row.querySelector(".pills").innerHTML =
    fits.map(v => `<button type="button" class="pill pill-sm" data-fov="${v}" aria-pressed="${state.fov === v}">${v}′</button>`).join("") +
    `<button type="button" class="pill pill-sm" data-fov="" aria-pressed="${!state.fov}">${full.toFixed(1)}′ full</button>`;
}

function drawStage() {
  const canvas = $("#stage-canvas");
  const m = state.manifest;
  if (!canvas || !m) return;
  const f = m.frames[state.frame];
  const img = state.images && state.images[state.frame];

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(rect.width * dpr));
  const H = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  if (!img || img.failed) {
    ctx.fillStyle = cssVar("--muted");
    ctx.font = `${14 * dpr}px ${cssVar("--font-mono")}`;
    ctx.textAlign = "center";
    ctx.fillText(img && img.failed ? "Image not available" : "Loading…", W / 2, H / 2);
    return;
  }
  if (!img.complete || !img.naturalWidth) return;

  const iw = img.naturalWidth, ih = img.naturalHeight;
  // View rectangle in image pixels: the field-of-view crop around the centre.
  const view = viewRect(m, f, iw, ih);
  const s = Math.min(W / view.w, H / view.h);
  const ox = (W - view.w * s) / 2, oy = (H - view.h * s) / 2;
  // Image pixel coordinates (pixel centres at integers) → canvas.
  const toC = (x, y) => [ox + (x + 0.5 - view.x) * s, oy + (y + 0.5 - view.y) * s];

  const diff = state.layers.diff && state.frame > 0 ? differenceCanvas(state.frame) : null;
  ctx.imageSmoothingEnabled = false;
  if (state.layers.diff) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(ox, oy, view.w * s, view.h * s);
  }
  if (!state.layers.diff || diff) {
    ctx.drawImage(diff || img, view.x, view.y, view.w, view.h, ox, oy, view.w * s, view.h * s);
  }
  // Keep overlays inside the image area.
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, view.w * s, view.h * s); ctx.clip();

  const L = state.layers;
  const lw = Math.max(1.5, 1.5 * dpr);
  const ember = cssVar("--accent"), blue = cssVar("--known"), warn = cssVar("--d6");

  // Flagged pixels: small crosses.
  if (L.flagged && typeof f.flagged_fraction === "number" && f.flagged_fraction > 0) {
    ctx.strokeStyle = warn; ctx.lineWidth = Math.max(1, dpr);
    const r = Math.max(2 * dpr, s * 0.3);
    ctx.beginPath();
    for (const [px, py] of flaggedPixels(img)) {
      const [cx, cy] = toC(px, py);
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
    }
    ctx.stroke();
  }

  // Known Gaia stars: blue squares.
  if (L.gaia && Array.isArray(m.gaia)) {
    ctx.strokeStyle = blue; ctx.lineWidth = lw;
    const half = Math.min(14 * dpr, Math.max(7 * dpr, s * 1.2));
    for (const g of m.gaia) {
      const [cx, cy] = toC(g.x, g.y);
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
    }
  }

  if (L.highlights && Array.isArray(m.highlights)) {
    const ringR = Math.min(36 * dpr, Math.max(14 * dpr, s * 3));
    const current = highlightsForFrame(m, state.frame);

    // Slow mode: dashed blue circles where the target was in earlier frames.
    if (state.mode === "slow") {
      const earlier = new Set();
      for (let j = 0; j < state.frame; j++) highlightsForFrame(m, j).forEach(h => earlier.add(h));
      current.forEach(h => earlier.delete(h));
      ctx.strokeStyle = blue; ctx.lineWidth = lw; ctx.setLineDash([5 * dpr, 4 * dpr]);
      for (const h of earlier) {
        const [cx, cy] = toC(h.x, h.y);
        ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();
        label(ctx, h.label, cx, cy, ringR, blue, dpr);
      }
      ctx.setLineDash([]);
    }

    // Highlight: ember ring with a soft glow on the centre dot.
    for (const h of current) {
      const [cx, cy] = toC(h.x, h.y);
      ctx.strokeStyle = ember; ctx.lineWidth = lw * 1.3;
      ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.shadowColor = "rgba(255,138,76,.8)"; ctx.shadowBlur = 10 * dpr;
      ctx.fillStyle = ember;
      ctx.beginPath(); ctx.arc(cx, cy, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      label(ctx, h.label, cx, cy, ringR, ember, dpr);
    }
  }

  ctx.restore();
  drawScaleBar(m, f, s / dpr);
}

function label(ctx, text, cx, cy, r, color, dpr) {
  if (!text) return;
  const W = ctx.canvas.width;
  ctx.font = `500 ${12 * dpr}px ${cssVar("--font-mono")}`;
  const tw = ctx.measureText(text).width, pad = 5 * dpr, h = 20 * dpr;
  let x = cx + r * 0.75, y = cy - r - h / 2;
  if (x + tw + pad * 2 > W - 4 * dpr) x = cx - r * 0.75 - tw - pad * 2;
  if (y < 4 * dpr) y = cy + r + 4 * dpr;
  ctx.fillStyle = "rgba(7,10,18,.85)";
  ctx.fillRect(x, y, tw + pad * 2, h);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillText(text, x + pad, y + h / 2);
}

// Scale bar + "N up": only when the manifest gives a pixel scale.
function drawScaleBar(m, f, cssPerPixel) {
  const el = $("#scale-bar");
  const ps = pixelScale(m, f);
  if (!el) return;
  if (!ps) { el.hidden = true; return; }
  const target = 120 / cssPerPixel * ps;              // arcsec covered by ~120 CSS px
  const nice = [10, 15, 30, 60, 120, 180, 300, 600].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const px = (nice / ps) * cssPerPixel;
  el.hidden = false;
  el.innerHTML = `<span class="scale-line" style="width:${px.toFixed(1)}px"></span>
    <span>${nice >= 60 ? `${nice / 60}′` : `${nice}″`} · N up</span>`;
}

/* ---------- Flipbook ---------- */

function showFrame(i) {
  const m = state.manifest;
  if (!m) return;
  const n = m.frames.length;
  state.frame = ((i % n) + n) % n;
  const f = m.frames[state.frame];

  const canvas = $("#stage-canvas");
  if (!canvas) return;
  canvas.setAttribute("aria-label", `${state.target.name}, frame ${state.frame + 1} of ${n}: ${f.label || "image"}${f.date ? `, ${f.date}` : ""}`);
  $("#stage-chips").innerHTML =
    (f.date ? `<span class="chip chip-mono">${esc(f.date)}</span>` : "") +
    (f.label ? `<span class="chip chip-mono">${esc(f.label)}</span>` : "");
  $("#stage-chips-right").innerHTML =
    (state.layers.diff ? `<span class="chip chip-mono">${state.frame > 0 ? `Difference: frame ${state.frame + 1} − frame 1` : "Difference: step to a later frame"}</span>` : "") +
    (m.fake ? `<span class="chip chip-mono chip-warn">Sample data</span>` : "");
  $("#frame-count").textContent = `Frame ${state.frame + 1} / ${n}`;
  document.querySelectorAll(".strip-bar").forEach((b, j) => {
    if (j === state.frame) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
  drawStage();
  updateSide();
}

function step(d) { showFrame(state.frame + d); }

function togglePlay() {
  if (state.playing) stopPlaying(); else startPlaying();
}

function setPlayButton(playing) {
  const btn = $("#play");
  if (!btn) return;
  btn.textContent = playing ? "Pause" : "Play";
  btn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function startPlaying() {
  if (!state.manifest || state.manifest.frames.length < 2) return;
  state.playing = true;
  setPlayButton(true);
  const tick = () => { step(1); state.timer = setTimeout(tick, 800 / state.speed); };
  state.timer = setTimeout(tick, 800 / state.speed);
}

function stopPlaying() {
  state.playing = false;
  clearTimeout(state.timer);
  state.timer = null;
  setPlayButton(false);
}

// Keyboard: Space plays/pauses, ← → step. Leaves typing and focused controls alone.
document.addEventListener("keydown", e => {
  if (!state.manifest || $("#viewer").hidden || !$("#stage-canvas")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
  if (e.key === " " || e.code === "Space") {
    if (tag === "button" || tag === "a") return;   // let Space activate the focused control
    e.preventDefault();
    togglePlay();
  } else if (e.key === "ArrowRight") {
    e.preventDefault(); stopPlaying(); step(1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault(); stopPlaying(); step(-1);
  }
});

/* ---------- Start ---------- */

route();
