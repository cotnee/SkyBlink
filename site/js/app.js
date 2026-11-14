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

/* ---------- Home ---------- */

function fmtCoord(v, digits = 3) {
  return typeof v === "number" ? v.toFixed(digits) : "–";
}

function showHome() {
  state.target = null;
  state.mode = null;
  state.manifest = null;
  state.candidates = null;
  document.title = "SkyBlink · Watch the sky change";
  $("#viewer").hidden = true;
  const home = $("#home");
  home.hidden = false;

  const { hunt } = params();
  const list = hunt && MODES[hunt]
    ? state.targets.filter(t => (t.modes || []).includes(hunt))
    : state.targets;

  let log;
  if (state.targetsMissing) {
    log = `<div class="notice"><p>The target list (<code>data/targets.json</code>) hasn't been published yet.</p></div>`;
  } else if (!list.length) {
    log = `<p>No targets for this mode yet.</p>`;
  } else {
    log = `<ol class="log-list">${list.map((t, i) => `
      <li class="card log-row">
        <span class="log-num">${String(i + 1).padStart(2, "0")}</span>
        <div>
          <h3 class="log-name"><a href="${viewerURL(t.id, (t.modes || [])[0] || "slow")}" data-nav>${esc(t.name)}</a></h3>
          ${t.mission ? `<p class="log-mission">${esc(t.mission)}</p>` : ""}
          <div class="pills">${(t.modes || []).filter(m => MODES[m]).map(m =>
            `<a class="pill" href="${viewerURL(t.id, m)}" data-nav>${MODES[m].name}</a>`).join("")}</div>
        </div>
        <span class="log-coords">RA ${fmtCoord(t.ra)}°<br>Dec ${fmtCoord(t.dec)}°</span>
      </li>`).join("")}</ol>`;
  }

  home.innerHTML = `
    <div class="wrap">
      <section class="section">
        <p class="eyebrow">SPHEREx · 102 infrared colours · the whole sky every 6 months</p>
        <h1 class="section-title" style="font-size:clamp(36px,7vw,64px)">Watch the sky change.</h1>
      </section>
      <section class="section" id="log" aria-labelledby="log-title">
        <h2 class="section-title" id="log-title">Observing log${hunt && MODES[hunt] ? ` · ${MODES[hunt].name}` : ""}</h2>
        ${log}
      </section>
      <section class="section" id="how" aria-labelledby="how-title">
        <h2 class="section-title" id="how-title">How it works, in 30 seconds</h2>
      </section>
    </div>`;

  // Honour #log / #how after re-render.
  if (location.hash) {
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
  announce();
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

  body.innerHTML = `
    <div class="wrap">
      <div class="viewer-grid">
        <div>
          <div class="stage" id="stage">
            <img id="frame-img" alt="">
            <div class="stage-chips" id="stage-chips"></div>
          </div>
          <div class="controls">
            <button class="btn btn-icon" type="button" id="prev" aria-label="Previous frame">◀</button>
            <button class="btn btn-primary" type="button" id="play">Play</button>
            <button class="btn btn-icon" type="button" id="next" aria-label="Next frame">▶</button>
            <span class="frame-count" id="frame-count" aria-live="polite"></span>
          </div>
        </div>
        <div class="side">
          ${m.notes ? `<section class="card"><h2>Notes</h2><p>${esc(m.notes)}</p></section>` : ""}
        </div>
      </div>
    </div>`;

  $("#prev").addEventListener("click", () => { stopPlaying(); step(-1); });
  $("#next").addEventListener("click", () => { stopPlaying(); step(1); });
  $("#play").addEventListener("click", togglePlay);
  showFrame(0);
}

/* ---------- Flipbook ---------- */

function showFrame(i) {
  const m = state.manifest;
  if (!m) return;
  const n = m.frames.length;
  state.frame = ((i % n) + n) % n;
  const f = m.frames[state.frame];
  const img = $("#frame-img");
  if (!img) return;
  img.src = `${modeDir(state.target.id, state.mode)}/${encodeURIComponent(f.file)}`;
  img.alt = `${state.target.name}, ${f.label || "frame"}${f.date ? `, ${f.date}` : ""}`;
  $("#stage-chips").innerHTML =
    (f.date ? `<span class="chip chip-mono">${esc(f.date)}</span>` : "") +
    (f.label ? `<span class="chip chip-mono">${esc(f.label)}</span>` : "") +
    (m.fake ? `<span class="chip chip-mono chip-warn">Sample data</span>` : "");
  $("#frame-count").textContent = `Frame ${state.frame + 1} / ${n}`;
}

function step(d) { showFrame(state.frame + d); }

function togglePlay() {
  if (state.playing) stopPlaying(); else startPlaying();
}

function startPlaying() {
  if (!state.manifest) return;
  state.playing = true;
  const btn = $("#play");
  if (btn) btn.textContent = "Pause";
  const tick = () => { step(1); state.timer = setTimeout(tick, 800 / state.speed); };
  state.timer = setTimeout(tick, 800 / state.speed);
}

function stopPlaying() {
  state.playing = false;
  clearTimeout(state.timer);
  state.timer = null;
  const btn = $("#play");
  if (btn) btn.textContent = "Play";
}

/* ---------- Start ---------- */

route();
