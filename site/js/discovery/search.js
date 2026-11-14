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

const degText = (v) => String(Number(v.toFixed(6)));

/* Galactic (l, b) to equatorial J2000 (RA, Dec), degrees. Rotation matrix from the IAU definition (Hipparcos). */
export function galToEq(l, b) {
  const r = Math.PI / 180;
  const x = Math.cos(b * r) * Math.cos(l * r), y = Math.cos(b * r) * Math.sin(l * r), z = Math.sin(b * r);
  const T = [[-0.0548755604, -0.8734370902, -0.4838350155],
             [0.4941094279, -0.4448296300, 0.7469822445],
             [-0.8676661490, -0.1980763734, 0.4559837762]];
  // equatorial = T transposed times galactic
  const ex = T[0][0] * x + T[1][0] * y + T[2][0] * z;
  const ey = T[0][1] * x + T[1][1] * y + T[2][1] * z;
  const ez = T[0][2] * x + T[1][2] * y + T[2][2] * z;
  let ra = Math.atan2(ey, ex) / r;
  if (ra < 0) ra += 360;
  return { ra, dec: Math.asin(Math.max(-1, Math.min(1, ez))) / r };
}

const GAL_RE = new RegExp(String.raw`^(?:gal(?:actic)?\s*:?\s*)?l\s*=?\s*(${NUM})\s*°?\s*[,;\s]\s*b\s*=?\s*(${NUM})\s*°?$`, "i");
const GAL_PREFIX_RE = new RegExp(String.raw`^gal(?:actic)?\s*:?\s*(${NUM})\s*°?\s*[,;\s]\s*(${NUM})\s*°?$`, "i");
const SEXA_CHARS_RE = /^[\d\s+\-.,:;hmsd°º′″'"]+$/i;

/**
 * Coordinates IRSA-style: sexagesimal ("17 57 48.5 +04 41 36", "17h57m48.5s +04d41m36s", "17:57:48.5 4:41:36"),
 * RA in decimal hours ("17.963h 4.69"), or galactic ("l=31.0 b=14.1", "gal 31.0 14.1").
 * Returns { ok, ra, dec, raText, decText, format, gal? } | { ok: false, message } | null (not coordinates).
 * Plain decimal degrees are handled by COORDS_RE in parseQuery.
 */
export function parseCoordText(raw) {
  const text = String(raw ?? "").replace(/[\u2212\u2013\u2014]/g, "-").trim();
  const g = text.match(GAL_RE) || text.match(GAL_PREFIX_RE);
  if (g) {
    const l = Number(g[1]), b = Number(g[2]);
    if (!(l >= 0 && l <= 360)) return { ok: false, message: `Galactic longitude (l) must be between 0 and 360 degrees. You typed ${cleanNum(g[1])}.` };
    if (!(b >= -90 && b <= 90)) return { ok: false, message: `Galactic latitude (b) must be between −90 and +90 degrees. You typed ${cleanNum(g[2])}.` };
    const e = galToEq(l, b);
    return { ok: true, ra: e.ra, dec: e.dec, raText: degText(e.ra), decText: degText(e.dec), format: "galactic", gal: { l, b } };
  }
  if (!SEXA_CHARS_RE.test(text) || !/\d/.test(text)) return null;

  const hoursMarked = /^\s*[+]?\d+(?:\.\d*)?\s*h/i.test(text);
  const tokens = text.replace(/[hmsd°º′″'":,;]/gi, " ").trim().split(/\s+/).filter(Boolean);
  if (!tokens.every((t) => new RegExp(`^${NUM}$`).test(t))) return null;

  let raParts, decParts;
  if (tokens.length === 6) { raParts = tokens.slice(0, 3); decParts = tokens.slice(3); }
  else if (tokens.length === 4) { raParts = tokens.slice(0, 2); decParts = tokens.slice(2); }
  else if (tokens.length === 2 && hoursMarked) { raParts = [tokens[0]]; decParts = [tokens[1]]; }
  else return null;

  const bad = "Those look like hours, minutes and seconds, but something is out of range. Try 17 57 48.5 +04 41 36.";
  const [rh, rm = "0", rs = "0"] = raParts;
  const [dd, dm = "0", ds = "0"] = decParts;
  if (/^[+-]/.test(rh) || [rm, rs, dm, ds].some((v) => /^[+-]/.test(v))) return { ok: false, message: bad };
  const H = Number(rh), M = Number(rm), Sx = Number(rs);
  const D = Math.abs(Number(dd)), DM = Number(dm), DS = Number(ds);
  if (!(H >= 0 && H < 24 && M >= 0 && M < 60 && Sx >= 0 && Sx < 60 && D <= 90 && DM >= 0 && DM < 60 && DS >= 0 && DS < 60)) return { ok: false, message: bad };
  const ra = (H + M / 60 + Sx / 3600) * 15;
  const dec = (/^-/.test(dd) ? -1 : 1) * (D + DM / 60 + DS / 3600);
  if (dec < -90 || dec > 90) return { ok: false, message: bad };
  return { ok: true, ra, dec, raText: degText(ra), decText: degText(dec), format: "sexagesimal" };
}

/**
 * Looks up an object name with CDS Sesame (SIMBAD, NED, VizieR), as IRSA does.
 * Returns { ra, dec, name } or null if no catalogue knows it. Throws if no resolver could be reached.
 */
export async function resolveName(name) {
  let reached = false;
  // Defaults here too, so a visitor with an older cached config.js still gets name lookup.
  const resolvers = Array.isArray(S.resolvers) && S.resolvers.length ? S.resolvers : [
    "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?",
    "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/SNV?",
  ];
  for (const base of resolvers) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), S.resolveTimeoutMs || 8000);
    try {
      const res = await fetch(base + encodeURIComponent(name), { signal: ctl.signal });
      if (!res.ok) continue;
      reached = true;
      const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
      const ra = Number(xml.querySelector("jradeg")?.textContent);
      const dec = Number(xml.querySelector("jdedeg")?.textContent);
      if (Number.isFinite(ra) && Number.isFinite(dec)) {
        const oname = (xml.querySelector("oname")?.textContent || name).replace(/^NAME\s+/, "").trim();
        return { ra, dec, name: oname };
      }
      return null;
    } catch { /* timeout or network: try the next mirror */ }
    finally { clearTimeout(timer); }
  }
  if (!reached) throw new Error("resolver unreachable");
  return null;
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
  const other = parseCoordText(raw);
  if (other) return other.ok ? { kind: "coords", ...other } : { kind: "error", message: other.message };
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
  if (/^[\d\s+\-.,:;]+$/.test(raw)) return { kind: "error", message: `We couldn't read those coordinates. Try degrees like ${S.example}, or hours like 17 57 48.5 +04 41 36.` };
  // Not one of ours: look it up in the big catalogues (runSearch does the network call).
  return { kind: "name", text: raw };
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

export function searchPageUrl(raText, decText, name) {
  return pageUrl(CFG.pages.search, { [P.ra]: raText, [P.dec]: decText, [P.name || "name"]: name });
}

/** Where a coordinate search should go: the matching target page or the not-processed page. */
export function resultUrl(c, targets) {
  const match = findMatch(c.ra, c.dec, targets);
  return match
    ? { url: targetUrl(match.target, { [P.fromRa]: c.raText, [P.fromDec]: c.decText }), match }
    : { url: searchPageUrl(c.raText, c.decText, c.name), match: null };
}

/* ---------- URL + navigation ---------- */

/** Keeps ra/dec in the current page's URL (history.replaceState), leaving other params alone. */
export function keepCoordsInUrl(raText, decText, name) {
  try {
    const u = new URL(location.href);
    u.searchParams.set(P.ra, raText);
    u.searchParams.set(P.dec, decText);
    if (name) u.searchParams.set(P.name || "name", name); else u.searchParams.delete(P.name || "name");
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
  let q = parseQuery(text, targets);
  if (q.kind === "name") {
    const status = opts.onStatus || (() => {});
    status(`Looking up “${q.text}” in SIMBAD, NED and VizieR…`);
    let found;
    try { found = await resolveName(q.text); }
    catch {
      status("");
      return { kind: "error", message: `We couldn't reach the catalogue lookup service right now. Try typing coordinates instead, like ${S.example}.` };
    }
    status("");
    if (!found) {
      return { kind: "error", message: `No catalogue (SIMBAD, NED or VizieR) knows “${q.text}”. Check the spelling, type coordinates like ${S.example}, or pick one of our targets:`,
        suggestions: targets.filter((t) => t && t.id) };
    }
    const c = checkCoords(degText(found.ra), degText(found.dec));
    if (!c.ok) return { kind: "error", message: c.message };
    // Show the name the visitor typed ("Vega"), not the catalogue label ("* alf Lyr").
    q = { kind: "coords", ...c, name: q.text, catalogName: found.name, format: "name" };
  }
  if (q.kind === "error") return q;
  if (q.kind === "target") {
    const t = q.target;
    if (isNum(t.ra) && isNum(t.dec)) keepCoordsInUrl(String(t.ra), String(t.dec));
    go(targetUrl(t), opts.replace);
    return q;
  }
  keepCoordsInUrl(q.raText, q.decText, q.name);
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
    enterkeyhint: "search", placeholder: `Vega, M31, or ${S.example}`, "aria-describedby": `${id}-help ${id}-err`, list: `${id}-list` });
  const datalist = h("datalist", { id: `${id}-list` });
  const button = h("button", { type: "submit", class: "sbd-btn sbd-btn-primary sbd-search-btn" }, "Search");
  const err = h("div", { id: `${id}-err`, class: "sbd-search-error", role: "alert", hidden: true });
  const status = h("p", { class: "sbd-search-status sbd-muted", role: "status" });
  const help = opts.showHelp === false ? null : h("p", { id: `${id}-help`, class: "sbd-search-help" },
    "Type an object name (Barnard's Star, Vega, M31) and we look it up in the SIMBAD, NED and VizieR catalogues, like NASA's IRSA archive does. Or type coordinates: degrees (269.448 4.770), hours-minutes-seconds (17 57 48.5 +04 41 36 or 17h57m48.5s +04d41m36s), or galactic (l=31.0 b=14.1). RA goes around the sky like longitude; Dec goes from −90° to +90° like latitude.");

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
      const q = await runSearch(input.value, { onNotProcessed: opts.onNotProcessed, onStatus: (t) => { status.textContent = t; } });
      if (q.kind === "error") showError(q);
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  const form = h("form", { class: "sbd-search-form", role: "search", novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
    h("label", { for: id, class: "sbd-search-label" }, "Object name or coordinates"),
    h("div", { class: "sbd-search-row" }, input, button),
    datalist, status, err, help);
  fill(el, form);
  input.addEventListener("input", clearError);

  const ra = getParam(P.ra), dec = getParam(P.dec), nm = getParam(P.name);
  if (nm) input.value = nm;
  else if (ra != null && dec != null) input.value = `${ra} ${dec}`;

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
  const gal = c.gal ? `  ·  galactic l ${c.gal.l}°, b ${c.gal.b}°` : "";
  return `RA ${c.raText}°, Dec ${c.dec >= 0 && !c.decText.startsWith("-") ? "+" : ""}${c.decText}°  (${raToHms(c.ra)}, ${decToDms(c.dec)})${gal}`;
}
