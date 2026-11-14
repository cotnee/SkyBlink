import { h, isNum } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, text) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
};

// Rough "false colour" for each wavelength so short = blue, long = red.
function waveColor(um) {
  const t = Math.min(1, Math.max(0, (um - 0.75) / (5 - 0.75)));
  return `hsl(${Math.round(230 - 230 * t)}, 85%, 62%)`;
}

function niceStep(range) {
  const raw = range / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

/** 6-colour spectrum: sed = { D1: flux, ... }, waves = { D1: µm, ... }. */
export function renderSpectrum(container, sed, waves, { unit = "relative brightness" } = {}) {
  const pts = Object.keys(sed || {})
    .map((k) => ({ det: k, flux: sed[k], um: waves?.[k] }))
    .filter((p) => isNum(p.flux) && isNum(p.um))
    .sort((a, b) => a.um - b.um);

  if (pts.length === 0) {
    container.replaceChildren(h("div", { class: "sbd-msg sbd-msg-info" }, "No colour measurements (sed) for this object yet."));
    return;
  }

  const W = 560, H = 300, m = { l: 62, r: 18, t: 16, b: 48 };
  const xMin = 0.7, xMax = 5.0;
  let yMin = Math.min(0, ...pts.map((p) => p.flux));
  let yMax = Math.max(0, ...pts.map((p) => p.flux));
  if (yMax === yMin) yMax = yMin + 1;
  const pad = (yMax - yMin) * 0.12;
  yMax += pad;
  if (yMin < 0) yMin -= pad;
  const X = (um) => m.l + ((um - xMin) / (xMax - xMin)) * (W - m.l - m.r);
  const Y = (f) => H - m.b - ((f - yMin) / (yMax - yMin)) * (H - m.t - m.b);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "sbd-spectrum-svg", role: "img",
    "aria-label": `Brightness in ${pts.length} SPHEREx colours from ${pts[0].um} to ${pts[pts.length - 1].um} micrometres` });

  // Methane band hint (around 3.3 µm)
  svg.append(s("rect", { x: X(3.15), y: m.t, width: X(3.45) - X(3.15), height: H - m.t - m.b, class: "sbd-sp-band" }));
  svg.append(s("text", { x: X(3.3), y: m.t + 12, class: "sbd-sp-band-label", "text-anchor": "middle" }, "methane"));

  const step = niceStep(yMax - yMin);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-12; v += step) {
    svg.append(s("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "sbd-sp-grid" }));
    svg.append(s("text", { x: m.l - 8, y: Y(v) + 4, class: "sbd-sp-tick", "text-anchor": "end" }, v.toFixed(decimals)));
  }
  for (let um = 1; um <= 5; um++) {
    svg.append(s("line", { x1: X(um), x2: X(um), y1: H - m.b, y2: H - m.b + 5, class: "sbd-sp-axis" }));
    svg.append(s("text", { x: X(um), y: H - m.b + 19, class: "sbd-sp-tick", "text-anchor": "middle" }, String(um)));
  }
  svg.append(s("line", { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), class: "sbd-sp-zero" }));
  svg.append(s("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: "sbd-sp-axis" }));
  svg.append(s("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "sbd-sp-axis" }));
  svg.append(s("text", { x: (m.l + W - m.r) / 2, y: H - 8, class: "sbd-sp-label", "text-anchor": "middle" }, "Wavelength (µm)"));
  svg.append(s("text", { x: 14, y: (m.t + H - m.b) / 2, class: "sbd-sp-label", "text-anchor": "middle",
    transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` }, `Brightness (${unit})`));

  svg.append(s("polyline", { points: pts.map((p) => `${X(p.um)},${Y(p.flux)}`).join(" "), class: "sbd-sp-line" }));
  for (const p of pts) {
    const g = s("g", { class: "sbd-sp-pt" });
    g.append(s("title", {}, `${p.det}: ${p.um} µm, brightness ${p.flux}`));
    g.append(s("circle", { cx: X(p.um), cy: Y(p.flux), r: 6.5, fill: waveColor(p.um) }));
    g.append(s("text", { x: X(p.um), y: Y(p.flux) - 11, class: "sbd-sp-det", "text-anchor": "middle" }, p.det));
    svg.append(g);
  }

  const table = h("table", { class: "sbd-table sbd-spectrum-table" },
    h("thead", {}, h("tr", {}, h("th", {}, "Detector"), pts.map((p) => h("th", {}, p.det)))),
    h("tbody", {},
      h("tr", {}, h("th", {}, "Wavelength (µm)"), pts.map((p) => h("td", {}, p.um.toFixed(2)))),
      h("tr", {}, h("th", {}, "Brightness"), pts.map((p) => h("td", {}, p.flux.toFixed(3))))));

  container.replaceChildren(svg, h("details", { class: "sbd-details" }, h("summary", {}, "Show the numbers"), table));
}
