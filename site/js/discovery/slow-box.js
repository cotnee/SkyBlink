import { CFG } from "./config.js";
import { h, fill, isNum, fmt, fetchJSON, paths } from "./util.js";
import { markedImage } from "./marked-image.js";

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Years between earliest and latest frame date, or null if not computable. */
export function yearsFromFrames(frames) {
  const t = (Array.isArray(frames) ? frames : [])
    .map((f) => Date.parse(f?.date))
    .filter((v) => Number.isFinite(v));
  if (t.length < 2) return null;
  const span = (Math.max(...t) - Math.min(...t)) / YEAR_MS;
  return span >= 0.5 ? span : null;
}

/** Pure computation, handy for tests or for C's own UI. */
export function slowResult(manifest) {
  const m = manifest || {};
  const measured = isNum(m.measured_shift_arcsec) ? m.measured_shift_arcsec : null;
  const expected = isNum(m.expected_shift_arcsec) ? m.expected_shift_arcsec : null;
  let years = null, yearsSource = "default";
  if (isNum(m.years) && m.years > 0) { years = m.years; yearsSource = "years"; }
  else if (isNum(m.epoch_to) && isNum(m.epoch_from) && m.epoch_to > m.epoch_from) { years = m.epoch_to - m.epoch_from; yearsSource = "epochs"; }
  else {
    const fromDates = yearsFromFrames(m.frames);
    if (fromDates != null) { years = fromDates; yearsSource = "dates"; }
  }
  if (years == null) years = CFG.defaultSlowYears;
  const agreement = measured != null && expected
    ? Math.max(0, 100 - (Math.abs(measured - expected) / Math.abs(expected)) * 100)
    : null;
  return { measured, expected, years, yearsSource, agreement, notes: m.notes || "",
    epochFrom: isNum(m.epoch_from) ? m.epoch_from : null, epochTo: isNum(m.epoch_to) ? m.epoch_to : null };
}

function yearsText(y, source) {
  const r = Math.round(y);
  return `${r} year${r === 1 ? "" : "s"}${source === "default" ? " (assumed)" : ""}`;
}

const num = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

/** Renders the "moved X arcsec in N years (expected Y)" box for a target. */
export async function mountSlowBox(container, targetId, { manifestUrl } = {}) {
  container.classList.add("sbd", "sbd-slow-box");
  fill(container, h("p", { class: "sbd-muted" }, "Loading slow-mover result…"));
  if (!targetId && !manifestUrl) {
    fill(container, h("p", { class: "sbd-muted" }, "No target selected."));
    return null;
  }
  const res = await fetchJSON(manifestUrl || paths.slowManifest(targetId));
  if (!res.ok) {
    fill(container, 
      h("h3", { class: "sbd-slow-title" }, "Slow movers"),
      h("p", { class: "sbd-muted" }, "No slow-mover result for this target yet."));
    return null;
  }
  const r = slowResult(res.data);
  if (r.measured == null) {
    fill(container, 
      h("h3", { class: "sbd-slow-title" }, "Slow movers"),
      h("p", { class: "sbd-muted" }, "The images are ready but the shift has not been measured yet."),
      r.notes ? h("p", {}, r.notes) : null);
    return r;
  }

  const rate = r.measured / r.years;
  const max = Math.max(r.measured, r.expected || 0) || 1;
  const bar = (label, v, cls) => h("div", { class: "sbd-slow-bar-row" },
    h("span", { class: "sbd-slow-bar-label" }, label),
    h("span", { class: "sbd-slow-bar-track" }, h("span", { class: `sbd-slow-bar ${cls}`, style: `width:${(v / max) * 100}%` })),
    h("span", { class: "sbd-slow-bar-val" }, `${fmt(v)}″`));

  let verdict = "";
  if (r.agreement != null) {
    verdict = r.agreement >= 90 ? "Matches the prediction: this is the star's real motion across the sky."
      : r.agreement >= 70 ? "Close to the prediction, but not exact. Worth a second look."
        : "Very different from the prediction. Maybe a measurement problem, or something surprising!";
  }

  fill(container, 
    h("h3", { class: "sbd-slow-title" }, "Slow movers result"),
    h("p", { class: "sbd-slow-headline" },
      "Moved ", h("strong", {}, `${num(r.measured)} arcsec`), ` in ${yearsText(r.years, r.yearsSource)}`,
      r.expected != null ? h("span", { class: "sbd-muted" }, ` (expected ${num(r.expected)})`) : null),
    r.epochFrom != null && r.epochTo != null
      ? h("p", { class: "sbd-muted sbd-slow-epochs" }, `Epochs ${r.epochFrom} → ${r.epochTo} (${fmt(r.years, 1)} years)`) : null,
    r.expected != null ? h("div", { class: "sbd-slow-bars" }, bar("Measured", r.measured, "sbd-slow-measured"), bar("Expected", r.expected, "sbd-slow-expected")) : null,
    h("div", { class: "sbd-slow-stats" },
      r.agreement != null ? h("div", { class: "sbd-stat" }, h("span", { class: "sbd-stat-val" }, `${fmt(r.agreement)}%`), h("span", { class: "sbd-stat-label" }, "agreement")) : null,
      h("div", { class: "sbd-stat" }, h("span", { class: "sbd-stat-val" }, `${fmt(rate, 2)}″`), h("span", { class: "sbd-stat-label" }, "per year")),
      h("div", { class: "sbd-stat" }, h("span", { class: "sbd-stat-val" }, fmt(r.measured / 60, 1)), h("span", { class: "sbd-stat-label" }, "arcmin"))),
    verdict ? h("p", { class: "sbd-slow-verdict" }, verdict) : null,
    frameBlinker(res.data, (f) => (manifestUrl ? new URL(f, new URL(manifestUrl, location.href)).href : paths.slowMedia(targetId, f))),
    r.notes ? h("p", { class: "sbd-slow-notes" }, r.notes) : null);
  return r;
}

/** Blink between the first and last manifest frames, with highlight/Gaia markers. */
function frameBlinker(m, resolve) {
  const frames = (Array.isArray(m.frames) ? m.frames : []).filter((f) => f && f.file);
  if (!frames.length) return null;
  const shown = frames.length > 2 ? [frames[0], frames[frames.length - 1]] : frames;
  const markers = [
    ...(Array.isArray(m.highlights) ? m.highlights.map((p) => ({ ...p, kind: "highlight" })) : []),
    ...(Array.isArray(m.gaia) ? m.gaia.map((p) => ({ ...p, kind: "gaia", label: p.id })) : []),
  ];
  const stage = h("div", { class: "sbd-blink-stage" });
  const caption = h("p", { class: "sbd-blink-caption" });
  const views = shown.map((f) => markedImage(resolve(f.file), f.label || f.file, markers));
  let idx = 0, timer = null;
  const tabs = shown.map((f, i) => h("button", { type: "button", class: "sbd-btn sbd-btn-small", onclick: () => { stop(); show(i); } },
    f.date ? f.date.slice(0, 4) : `Frame ${i + 1}`));
  const playBtn = h("button", { type: "button", class: "sbd-btn sbd-btn-small sbd-btn-primary", onclick: () => (timer ? stop() : play()) });

  function show(i) {
    idx = i;
    views.forEach((v, j) => { v.hidden = j !== i; });
    tabs.forEach((t, j) => t.setAttribute("aria-pressed", String(j === i)));
    const f = shown[i];
    caption.textContent = [f.label, f.date, typeof f.flagged_fraction === "number" ? `${(f.flagged_fraction * 100).toFixed(0)}% pixels flagged` : null].filter(Boolean).join(" · ");
  }
  function play() {
    if (shown.length < 2) return;
    timer = setInterval(() => show((idx + 1) % shown.length), 800);
    playBtn.textContent = "Pause";
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    playBtn.textContent = "Blink ▶";
  }
  stage.append(...views);
  show(0);
  stop();
  if (shown.length > 1) play();
  return h("div", { class: "sbd-blink" }, stage, caption,
    h("div", { class: "sbd-blink-controls" }, shown.length > 1 ? playBtn : null, tabs));
}
