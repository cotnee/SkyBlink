import { CFG } from "./config.js";
import { h, isNum, raToHms, decToDms } from "./util.js";

let loader = null;

// Always decimal with a sign: VizieR/SIMBAD read "10 20" as sexagesimal (10h = 150°).
const degStr = (ra, dec) => `${ra.toFixed(6)} ${dec < 0 ? "-" : "+"}${Math.abs(dec).toFixed(6)}`;

function loadScript(src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.charset = "utf-8";
    el.async = true;
    const timer = setTimeout(() => { el.remove(); reject(new Error(`timeout loading ${src}`)); }, timeoutMs);
    el.onload = () => { clearTimeout(timer); window.A ? resolve() : reject(new Error(`no Aladin in ${src}`)); };
    el.onerror = () => { clearTimeout(timer); el.remove(); reject(new Error(`failed to load ${src}`)); };
    document.head.append(el);
  });
}

async function loadModule(src, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout loading ${src}`)), timeoutMs); });
  try {
    const mod = await Promise.race([import(src), timeout]);
    if (!mod?.default) throw new Error(`no Aladin in ${src}`);
    window.A = mod.default;
  } finally {
    clearTimeout(timer);
  }
}

/** Loads Aladin Lite v3 once (trying each configured CDN), resolves to the global `A`. */
export function loadAladin() {
  if (!loader) {
    loader = (async () => {
      if (!window.A) {
        let lastErr;
        for (const entry of CFG.aladin.scripts) {
          const { src, module } = typeof entry === "string" ? { src: entry } : entry;
          try {
            await (module ? loadModule : loadScript)(src, CFG.aladin.timeoutMs);
            lastErr = null;
            break;
          } catch (e) { lastErr = e; console.warn("[SkyBlink discovery]", e.message || e); }
        }
        if (lastErr || !window.A) throw lastErr || new Error("Aladin Lite unavailable");
      }
      if (window.A.init) await window.A.init;
      return window.A;
    })();
    loader.catch(() => { loader = null; });
  }
  return loader;
}

function externalLinks(ra, dec, fovDeg) {
  const target = encodeURIComponent(degStr(ra, dec));
  return h("p", { class: "sbd-aladin-ext" },
    "Open this spot in: ",
    h("a", { href: `https://aladin.cds.unistra.fr/AladinLite/?target=${target}&fov=${fovDeg}&survey=CDS%2FP%2FallWISE%2Fcolor`, target: "_blank", rel: "noopener" }, "Aladin Lite"),
    " · ",
    h("a", { href: `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${target}&Radius=2&Radius.unit=arcmin`, target: "_blank", rel: "noopener" }, "SIMBAD"),
    " · ",
    h("a", { href: `https://vizier.cds.unistra.fr/viz-bin/VizieR-4?-source=${CFG.aladin.gaiaCatalog}&-c=${target}&-c.rm=2`, target: "_blank", rel: "noopener" }, "Gaia DR3 in VizieR"),
    " · ",
    h("a", { href: `https://sky.esa.int/esasky/?target=${target}&fov=${fovDeg}&hips=AllWISE+color`, target: "_blank", rel: "noopener" }, "ESASky"));
}

function fovLabel(arcmin) {
  return arcmin >= 60 ? `${arcmin / 60}°` : `${arcmin}′`;
}

const hipsCache = new Map();

async function probe(url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/properties`, { signal: ctl.signal, cache: "force-cache" });
    if (!r.ok) return false;
    return /hips_|obs_title|dataproduct_type/i.test(await r.text());
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** First reachable HiPS mirror URL for a survey (in configured order), else its CDS ID. */
export function resolveHiPS(survey) {
  if (!survey) return Promise.resolve(null);
  if (!hipsCache.has(survey.key)) {
    hipsCache.set(survey.key, (async () => {
      const mirrors = survey.mirrors || [];
      const checks = mirrors.map((m) => probe(m, CFG.aladin.hipsProbeTimeoutMs));
      for (let i = 0; i < mirrors.length; i++) if (await checks[i]) return mirrors[i];
      return survey.id;
    })());
  }
  return hipsCache.get(survey.key);
}

const surveyByKey = (key) => CFG.aladin.baseSurveys.find((s) => s.key === key);

/**
 * Mounts an Aladin Lite sky viewer with SkyBlink controls.
 * opts: { ra, dec, fovDeg, markers: [{ ra, dec, label, color, desc }], gaia: true, wiseOverlay: false }
 * Returns a promise resolving to { aladin, setFov, recenter } or null if Aladin could not load.
 */
export async function mountAladin(container, opts = {}) {
  const { ra, dec } = opts;
  container.classList.add("sbd", "sbd-aladin");
  if (!isNum(ra) || !isNum(dec)) {
    container.replaceChildren(h("div", { class: "sbd-msg sbd-msg-warn" }, "No sky coordinates for this object, so the sky map can't be shown."));
    return null;
  }
  const cfg = CFG.aladin;
  let fovDeg = isNum(opts.fovDeg) ? opts.fovDeg : cfg.defaultFovDeg;

  const view = h("div", { class: "sbd-aladin-view" });
  const status = h("div", { class: "sbd-aladin-status", "aria-live": "polite" }, "Loading sky map (Aladin Lite)…");

  const baseSel = h("select", { "aria-label": "Background survey" },
    cfg.baseSurveys.map((s, i) => h("option", { value: s.key, selected: i === 0 }, s.label)));
  const wiseChk = h("input", { type: "checkbox", checked: !!opts.wiseOverlay });
  const wiseAlpha = h("input", { type: "range", min: 0, max: 100, value: 50, "aria-label": "WISE overlay opacity" });
  const gaiaChk = h("input", { type: "checkbox", checked: opts.gaia !== false });
  const fovSel = h("select", { "aria-label": "Field of view" });
  const fovChoices = [...new Set([...cfg.fovChoicesArcmin, Math.round(fovDeg * 60)])].sort((a, b) => a - b);
  for (const a of fovChoices) fovSel.append(h("option", { value: a, selected: a === Math.round(fovDeg * 60) }, fovLabel(a)));
  const recenterBtn = h("button", { type: "button", class: "sbd-btn sbd-btn-small" }, "Re-centre");

  const controls = h("div", { class: "sbd-aladin-controls" },
    h("label", {}, "Background ", baseSel),
    h("label", { class: "sbd-aladin-wise" }, wiseChk, " WISE overlay ", wiseAlpha),
    h("label", {}, gaiaChk, " Gaia DR3 stars"),
    h("label", {}, "Field of view ", fovSel),
    recenterBtn);

  const coordLine = h("div", { class: "sbd-aladin-coords" },
    `Centre: RA ${ra.toFixed(5)}°, Dec ${dec.toFixed(5)}°  (${raToHms(ra)}, ${decToDms(dec)})`);

  container.replaceChildren(controls, view, status, coordLine);

  let A, firstHips;
  try {
    [A, firstHips] = await Promise.all([loadAladin(), resolveHiPS(cfg.baseSurveys[0])]);
  } catch (e) {
    controls.remove();
    view.replaceWith(h("div", { class: "sbd-aladin-offline" },
      h("strong", {}, "The interactive sky map could not load."),
      h("p", {}, "Aladin Lite comes from the internet (CDS, Strasbourg). If you are offline or the service is down, everything else on this page still works."),
      externalLinks(ra, dec, fovDeg)));
    status.remove();
    return null;
  }

  const aladin = A.aladin(view, {
    survey: firstHips,
    fov: fovDeg,
    target: degStr(ra, dec),
    cooFrame: "ICRSd",
    showReticle: true,
    showLayersControl: true,
    showFullscreenControl: true,
    showZoomControl: true,
    showGotoControl: false,
    showSimbadPointerControl: true,
    showCooGridControl: true,
    showProjectionControl: false,
    showShareControl: false,
    showSettingsControl: false,
    showContextMenu: true,
    showFrame: false,
    showCooLocation: true,
    log: false,
  });

  let wiseLayer = null;
  const applyWise = async () => {
    const baseIsWise = baseSel.value === cfg.wiseOverlay;
    wiseChk.disabled = baseIsWise;
    wiseAlpha.disabled = baseIsWise || !wiseChk.checked;
    const alpha = !baseIsWise && wiseChk.checked ? Number(wiseAlpha.value) / 100 : 0;
    try {
      if (!wiseLayer && alpha > 0) {
        const url = await resolveHiPS(surveyByKey(cfg.wiseOverlay));
        wiseLayer = A.imageHiPS(url, { name: "WISE overlay" });
        aladin.setOverlayImageLayer(wiseLayer, "sbd-wise");
      }
      wiseLayer?.setOpacity?.(alpha);
    } catch (e) {
      console.warn("[SkyBlink discovery] WISE overlay", e);
    }
  };

  let gaiaCat = null, gaiaRadius = 0, gaiaToken = 0;
  const gaiaUrl = (base, radius) => `${base}/viz-bin/votable?-source=${encodeURIComponent(cfg.gaiaCatalog)}&-c=${encodeURIComponent(degStr(ra, dec))}&-c.rd=${radius.toFixed(4)}&-out.max=${cfg.gaiaLimit}&-sort=Gmag`;
  const loadGaia = () => {
    const radius = Math.min(cfg.gaiaMaxRadiusDeg, Math.max(fovDeg * 0.75, 2 / 60));
    if (gaiaCat && radius <= gaiaRadius) { gaiaCat.show(); return; }
    if (gaiaCat) { try { aladin.removeLayer(gaiaCat); } catch { gaiaCat.hide(); } gaiaCat = null; }
    gaiaRadius = radius;
    const token = ++gaiaToken;
    const tryMirror = (i) => {
      if (token !== gaiaToken) return;
      if (i >= cfg.vizierMirrors.length) {
        status.textContent = "Gaia DR3 catalogue could not be loaded (VizieR unreachable). The images still work.";
        gaiaRadius = 0;
        return;
      }
      status.textContent = "Loading Gaia DR3 stars from VizieR…";
      const catOpts = { name: "Gaia DR3", onClick: "showTable", sourceSize: 8, color: "#3fd0ff", shape: "circle" };
      const mirror = cfg.vizierMirrors[i];
      let cat, settled = false;
      const timer = setTimeout(() => onErr(), cfg.gaiaTimeoutMs);
      const settle = () => {
        if (settled || token !== gaiaToken) return false;
        settled = true;
        clearTimeout(timer);
        return true;
      };
      const onOk = () => {
          if (!settle()) return;
          const n = cat.getSources?.().length;
          // A mirror's error page can parse as an empty table; try the next mirror before believing "0 stars".
          if (!n && i + 1 < cfg.vizierMirrors.length) {
            try { aladin.removeLayer(cat); } catch { cat.hide(); }
            tryMirror(i + 1);
            return;
          }
          status.textContent = `Gaia DR3: ${n === cfg.gaiaLimit ? `${mirror === "aladin" ? "first" : "brightest"} ${n}` : n ?? "?"} stars within ${(radius * 60).toFixed(1)}′ (positions at epoch 2016; fast stars like Barnard's have moved since).`;
          if (!gaiaChk.checked) cat.hide();
      };
      const onErr = () => {
        if (!settle()) return;
        try { aladin.removeLayer(cat); } catch { cat?.hide(); }
        tryMirror(i + 1);
      };
      try {
        cat = mirror === "aladin"
          ? A.catalogFromVizieR(cfg.gaiaCatalog, degStr(ra, dec), radius, { ...catOpts, limit: cfg.gaiaLimit }, onOk, onErr)
          : A.catalogFromURL(gaiaUrl(mirror, radius), catOpts, onOk, onErr, false);
      } catch (e) {
        console.warn("[SkyBlink discovery] Gaia", e);
        if (settle()) tryMirror(i + 1);
        return;
      }
      gaiaCat = cat;
      aladin.addCatalog(cat);
    };
    tryMirror(0);
  };
  const applyGaia = () => {
    if (gaiaChk.checked) loadGaia();
    else { gaiaCat?.hide(); status.textContent = "Gaia DR3 overlay hidden."; }
  };

  const markers = (opts.markers || []).filter((m) => isNum(m.ra) && isNum(m.dec));
  if (markers.length) {
    const byColor = new Map();
    for (const m of markers) {
      const color = m.color || "#ff4f86";
      if (!byColor.has(color)) {
        const cat = A.catalog({ name: opts.markerLayerName || "SkyBlink", sourceSize: 26, color, shape: "circle", displayLabel: true, labelColumn: "name", labelColor: color, labelFont: "13px sans-serif" });
        aladin.addCatalog(cat);
        byColor.set(color, cat);
      }
      byColor.get(color).addSources([A.marker(m.ra, m.dec, { popupTitle: m.label || "SkyBlink", popupDesc: m.desc || "" }, { name: m.label || "" })]);
    }
  }

  baseSel.addEventListener("change", async () => {
    const url = await resolveHiPS(surveyByKey(baseSel.value));
    try { aladin.setBaseImageLayer(A.imageHiPS(url)); } catch (e) { console.warn("[SkyBlink discovery] survey", e); }
    applyWise();
  });
  wiseChk.addEventListener("change", applyWise);
  wiseAlpha.addEventListener("input", applyWise);
  gaiaChk.addEventListener("change", applyGaia);
  const setFov = (deg) => {
    fovDeg = deg;
    aladin.setFoV(deg);
    if (gaiaChk.checked) loadGaia();
  };
  fovSel.addEventListener("change", () => setFov(Number(fovSel.value) / 60));
  const recenter = () => aladin.gotoRaDec(ra, dec);
  recenterBtn.addEventListener("click", recenter);

  applyWise();
  if (gaiaChk.checked) loadGaia(); else status.textContent = "Sky map ready.";

  return { aladin, setFov, recenter };
}

