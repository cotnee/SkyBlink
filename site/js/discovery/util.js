import { CFG } from "./config.js";

export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const fmt = (v, digits = 1, fallback = "–") => (isNum(v) ? v.toFixed(digits) : fallback);

export function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

export function pageUrl(page, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") qs.set(k, v);
  const s = qs.toString();
  return s ? `${page}?${s}` : page;
}

/** URL of a target's page from pages.targetTemplate. `t` is a target object or id; `extra` adds query params. */
export function targetUrl(t, extra = {}) {
  const id = typeof t === "string" ? t : t?.id;
  const mode = (typeof t === "object" && Array.isArray(t?.modes) && t.modes[0]) || "slow";
  const base = CFG.pages.targetTemplate.replace(/\{id\}/g, encodeURIComponent(id)).replace(/\{mode\}/g, encodeURIComponent(mode));
  const [path, query = ""] = base.split("?");
  const qs = new URLSearchParams(query);
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export const links = {
  home: () => CFG.pages.home,
  target: (t, extra) => targetUrl(t, extra),
  fast: (t) => pageUrl(CFG.pages.fast, { [CFG.params.target]: t }),
  candidate: (t, id) => pageUrl(CFG.pages.candidate, { [CFG.params.target]: t, [CFG.params.id]: id }),
};

const seg = (s) => encodeURIComponent(String(s));

export const paths = {
  targets: () => `${CFG.dataBase}${CFG.targetsFile}`,
  candidates: (t) => `${CFG.dataBase}${seg(t)}/${CFG.fastDir}${CFG.candidatesFile}`,
  fastMedia: (t, file) => `${CFG.dataBase}${seg(t)}/${CFG.fastMediaDir ?? CFG.fastDir}${file}`,
  slowManifest: (t) => `${CFG.dataBase}${seg(t)}/${CFG.slowDir}${CFG.manifestFile}`,
  slowMedia: (t, file) => `${CFG.dataBase}${seg(t)}/${CFG.slowDir}${file}`,
};

const jsonCache = new Map();

/** Resolves to { ok: true, data } or { ok: false, error } — never throws. */
export function fetchJSON(url) {
  if (!jsonCache.has(url)) {
    jsonCache.set(url, (async () => {
      try {
        const r = await fetch(url, { cache: "no-cache" });
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, status: r.status };
        return { ok: true, data: await r.json() };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    })());
  }
  return jsonCache.get(url);
}

export async function loadTargets() {
  const res = await fetchJSON(paths.targets());
  return res.ok && Array.isArray(res.data) ? res.data : [];
}

export async function getTarget(id) {
  if (!id) return null;
  return (await loadTargets()).find((t) => t.id === id) || null;
}

/** Tiny DOM builder: h("div", { class: "x", onclick: fn }, "text", childNode). Text is never parsed as HTML. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** <img> that swaps itself for a friendly placeholder if the file is missing. */
export function safeImg(src, alt, cls = "") {
  const missing = (why) => h("div", { class: `sbd-img-missing ${cls}` }, h("span", {}, why));
  if (!src) return missing("No image provided");
  const img = h("img", { src, alt, class: `sbd-data-img ${cls}`.trim(), loading: "lazy" });
  img.addEventListener("error", () => img.replaceWith(missing(`Image not available yet (${src.split("/").pop()})`)), { once: true });
  return img;
}

/** replaceChildren that skips null/false entries (for conditional sections). */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export function message(text, kind = "info") {
  return h("div", { class: `sbd-msg sbd-msg-${kind}` }, text);
}

function pad(n, width, digits = 0) {
  const s = n.toFixed(digits);
  const [i, f] = s.split(".");
  return i.padStart(width, "0") + (f != null ? `.${f}` : "");
}

export function raToHms(deg) {
  if (!isNum(deg)) return "–";
  let totalSec = (((deg % 360) + 360) % 360) / 15 * 3600;
  totalSec = Math.round(totalSec * 100) / 100;
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec - hh * 3600) / 60);
  const ss = totalSec - hh * 3600 - mm * 60;
  return `${pad(hh % 24, 2)}h ${pad(mm, 2)}m ${pad(ss, 2, 2)}s`;
}

export function decToDms(deg) {
  if (!isNum(deg)) return "–";
  const sign = deg < 0 ? "−" : "+";
  let totalSec = Math.round(Math.abs(deg) * 3600 * 10) / 10;
  const dd = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec - dd * 3600) / 60);
  const ss = totalSec - dd * 3600 - mm * 60;
  return `${sign}${pad(dd, 2)}° ${pad(mm, 2)}′ ${pad(ss, 2, 1)}″`;
}

export function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function onReady(fn) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
  else fn();
}
