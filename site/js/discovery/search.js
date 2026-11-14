import { CFG } from "./config.js";
import { h, fill, isNum, getParam, pageUrl, targetUrl, loadTargets, decToDms, raToHms } from "./util.js";

const P = CFG.params;
const S = CFG.search;
const NUM = String.raw`[+\-]?(?:\d+(?:\.\d*)?|\.\d+)`;
const COORDS_RE = new RegExp(String.raw`^\s*(${NUM})\s*(?:°|deg)?\s*(?:[,;\s]\s*)(${NUM})\s*(?:°|deg)?\s*$`, "i");
const ONE_NUM_RE = new RegExp(String.raw`^\s*${NUM}\s*(?:°|deg)?\s*$`, "i");

/* ---------- Pure helpers ---------- */

/** Great-circle (haversine) distance in arcminutes. */
export function distanceArcmin(ra1, dec1, ra2, dec2) {
  const r = Math.PI / 180;
  const dDec = (dec2 - dec1) * r, dRa = (ra2 - ra1) * r;
  const a = Math.sin(dDec / 2) ** 2 + Math.cos(dec1 * r) * Math.cos(dec2 * r) * Math.sin(dRa / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * (180 / Math.PI) * 60;
}

export function fmtDistance(arcmin) {
  if (arcmin < 10) return `${arcmin.toFixed(1)} arcmin`;
  if (arcmin < 60) return `${Math.round(arcmin)} arcmin`;
  const deg = arcmin / 60;
  return `${deg < 10 ? deg.toFixed(1) : Math.round(deg)}°`;
}

const cleanNum = (s) => {
  let t = String(s).trim().replace(/^\+/, "");
  if (t.startsWith(".")) t = `0${t}`;
  if (t.startsWith("-.")) t = `-0${t.slice(1)}`;
  return t.replace(/\.$/, "");
};
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Validates RA/Dec text. Returns { ok, ra, dec, raText, decText } or { ok: false, message }. */
export function checkCoords(raText, decText) {
  const ra = Number(raText), dec = Number(decText);
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return { ok: false, message: "Those don't look like numbers. Try something like 269.448 4.770." };
  if (ra < 0 || ra > 360) return { ok: false, message: `The first number (RA) must be between 0 and 360 degrees. You typed ${cleanNum(raText)}.` };
  if (dec < -90 || dec > 90) return { ok: false, message: `The second number (Dec) must be between −90 and +90 degrees, like latitude on Earth. You typed ${cleanNum(decText)}.` };
  return { ok: true, ra, dec, raText: cleanNum(raText), decText: cleanNum(decText) };
}

/**
 * Turns what the visitor typed into coordinates or a known target.
 * Returns { kind: "coords", ra, dec, raText, decText } | { kind: "target", target } | { kind: "error", message, suggestions }.
 */
export function parseQuery(text, targets = []) {
  const raw = String(text ?? "").replace(/[\u2212\u2013\u2014]/g, "-").trim();
  if (!raw) return { kind: "error", message: "Type sky coordinates (two numbers) or a target name first." };

  const m = raw.match(COORDS_RE);
  if (m) {
    const c = checkCoords(m[1], m[2]);
    return c.ok ? { kind: "coords", ...c } : { kind: "error", message: c.message };
  }
  if (ONE_NUM_RE.test(raw)) {
    return { kind: "error", message: `We need two numbers: first RA (0 to 360), then Dec (−90 to +90). For example: ${S.example}` };
  }

  const q = norm(raw);
  const named = targets.filter((t) => t && t.id);
  const exact = named.filter((t) => norm(t.id) === q || norm(t.name) === q);
  if (exact.length === 1) return { kind: "target", target: exact[0] };
  const partial = q.length >= 3 ? named.filter((t) => norm(t.id).startsWith(q) || norm(t.name).startsWith(q) || (q.length >= 4 && norm(t.name).includes(q))) : [];
  if (partial.length === 1) return { kind: "target", target: partial[0] };
  if (partial.length > 1) return { kind: "error", message: `More than one target matches “${raw}”. Did you mean:`, suggestions: partial };
  return {
    kind: "error",
    message: `We don't know a target called “${raw}”. Try sky coordinates like ${S.example}, or one of our targets:`,
    suggestions: named,
  };
}

/** Targets with coordinates, nearest first: [{ target, arcmin }]. */
export function rankTargets(ra, dec, targets = []) {
  return targets
    .filter((t) => t && isNum(t.ra) && isNum(t.dec))
    .map((t) => ({ target: t, arcmin: distanceArcmin(ra, dec, t.ra, t.dec) }))
    .sort((a, b) => a.arcmin - b.arcmin);
}

export function findMatch(ra, dec, targets = []) {
  const best = rankTargets(ra, dec, targets)[0];
  return best && best.arcmin <= S.matchRadiusArcmin ? best : null;
}

export const isProcessed = (t) => (t.ready != null ? t.ready === true : Array.isArray(t.modes) && t.modes.length > 0);

export function searchPageUrl(raText, decText) {
  return pageUrl(CFG.pages.search, { [P.ra]: raText, [P.dec]: decText });
}

/** Where a coordinate search should go: the matching target page or the not-processed page. */
export function resultUrl(c, targets) {
  const match = findMatch(c.ra, c.dec, targets);
  return match
    ? { url: targetUrl(match.target, { [P.fromRa]: c.raText, [P.fromDec]: c.decText }), match }
    : { url: searchPageUrl(c.raText, c.decText), match: null };
}

/* ---------- URL + navigation ---------- */

/** Keeps ra/dec in the current page's URL (history.replaceState), leaving other params alone. */
export function keepCoordsInUrl(raText, decText) {
  try {
    const u = new URL(location.href);
    u.searchParams.set(P.ra, raText);
    u.searchParams.set(P.dec, decText);
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
  } catch { /* file:// or sandboxed iframe */ }
}

function go(url, replace) {
  if (replace) location.replace(url);
  else location.assign(url);
}

/**
 * Runs a search for `text`. Returns the parsed query (with .error for the UI) — navigation happens as a side effect.
 * opts.replace: replace the history entry (used when following a ?ra=&dec= link).
 * opts.onNotProcessed(c, targets): handle "no match" in place instead of opening the search page.
 */
export async function runSearch(text, opts = {}) {
  const targets = await loadTargets();
  const q = parseQuery(text, targets);
  if (q.kind === "error") return q;
  if (q.kind === "target") {
    const t = q.target;
    if (isNum(t.ra) && isNum(t.dec)) keepCoordsInUrl(String(t.ra), String(t.dec));
    go(targetUrl(t), opts.replace);
    return q;
  }
  keepCoordsInUrl(q.raText, q.decText);
  const { url, match } = resultUrl(q, targets);
  if (!match && opts.onNotProcessed) opts.onNotProcessed(q, targets);
  else go(url, opts.replace);
  return q;
}

function isBackForward() {
  try { return performance.getEntriesByType("navigation")[0]?.type === "back_forward"; } catch { return false; }
}

let autoRan = false;
/** If this page was opened with ?ra=&dec= (and no target), run that search once. Returns true if it did. */
export function handleCoordinateParams(opts = {}) {
  const ra = getParam(P.ra), dec = getParam(P.dec);
  if (autoRan || ra == null || dec == null || getParam(P.target) || isBackForward()) return false;
  autoRan = true;
  runSearch(`${ra} ${dec}`, { replace: true, ...opts }).then((q) => {
    if (q.kind === "error") window.dispatchEvent(new CustomEvent("sbd-search-error", { detail: q }));
  });
  return true;
}

/* ---------- UI ---------- */

let uid = 0;

/**
 * Search box. opts: { autoRun = true, onNotProcessed, compact = false, showHelp = true }
 * autoRun: follow ?ra=&dec= in the page URL on load.
 */
export function mountSearch(el, opts = {}) {
  const id = `sbd-search-${++uid}`;
  el.classList.add("sbd", "sbd-search");
  const input = h("input", { id, type: "text", class: "sbd-search-input", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    enterkeyhint: "search", placeholder: S.example, "aria-describedby": `${id}-help ${id}-err`, list: `${id}-list` });
  const datalist = h("datalist", { id: `${id}-list` });
  const button = h("button", { type: "submit", class: "sbd-btn sbd-btn-primary sbd-search-btn" }, "Search");
  const err = h("div", { id: `${id}-err`, class: "sbd-search-error", role: "alert", hidden: true });
  const help = opts.showHelp === false ? null : h("p", { id: `${id}-help`, class: "sbd-search-help" },
    "Sky coordinates work like longitude and latitude, but on the sky: RA (right ascension) goes around the sky from 0 to 360°, and Dec (declination) goes from −90° at the south pole of the sky to +90° at the north pole. You can also type a target name, like Barnard's Star.");

  const showError = (q) => {
    const sugg = (q.suggestions || []).slice(0, 8);
    fill(err, h("span", {}, q.message),
      sugg.length ? h("span", { class: "sbd-search-sugg" }, sugg.map((t) =>
        h("button", { type: "button", class: "sbd-btn sbd-btn-small", onclick: () => { input.value = t.name || t.id; submit(); } }, t.name || t.id))) : null);
    err.hidden = false;
    input.setAttribute("aria-invalid", "true");
  };
  const clearError = () => { err.hidden = true; input.removeAttribute("aria-invalid"); };

  let busy = false;
  async function submit() {
    if (busy) return;
    clearError();
    busy = true;
    button.disabled = true;
    try {
      const q = await runSearch(input.value, { onNotProcessed: opts.onNotProcessed });
      if (q.kind === "error") showError(q);
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  const form = h("form", { class: "sbd-search-form", role: "search", novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
    h("label", { for: id, class: "sbd-search-label" }, `Enter sky coordinates (RA, Dec in degrees), e.g. ${S.example}`),
    h("div", { class: "sbd-search-row" }, input, button),
    datalist, err, help);
  fill(el, form);
  input.addEventListener("input", clearError);

  const ra = getParam(P.ra), dec = getParam(P.dec);
  if (ra != null && dec != null) input.value = `${ra} ${dec}`;

  loadTargets().then((ts) => datalist.append(...ts.filter((t) => t.name).map((t) => h("option", { value: t.name }))));
  window.addEventListener("sbd-search-error", (e) => showError(e.detail));
  if (opts.autoRun !== false && !opts.onNotProcessed) handleCoordinateParams();

  return { input, submit, showError };
}

/** "Showing results for <name>, <X> arcmin from your coordinates" when the URL has from_ra/from_dec. */
export function arrivalNote(target) {
  const fr = getParam(P.fromRa), fd = getParam(P.fromDec);
  if (!target || fr == null || fd == null) return null;
  const c = checkCoords(fr, fd);
  if (!c.ok || !isNum(target.ra) || !isNum(target.dec)) return null;
  const d = distanceArcmin(c.ra, c.dec, target.ra, target.dec);
  return h("div", { class: "sbd sbd-arrival-note", role: "status" },
    h("p", {}, `Showing results for ${target.name || target.id}, ${d < 60 ? `${d.toFixed(1)} arcmin` : fmtDistance(d)} from your coordinates`,
      h("span", { class: "sbd-muted" }, ` (${c.raText}, ${c.decText})`), "."),
    h("a", { href: searchPageUrl(c.raText, c.decText), class: "sbd-arrival-link" }, "See the sky exactly at your coordinates instead"));
}

/** Coordinates as plain text, e.g. "RA 10°, Dec +20° (00h 40m 00.00s, +20° 00′ 00.0″)". */
export function coordsText(c) {
  return `RA ${c.raText}°, Dec ${c.dec >= 0 && !c.decText.startsWith("-") ? "+" : ""}${c.decText}°  (${raToHms(c.ra)}, ${decToDms(c.dec)})`;
}
