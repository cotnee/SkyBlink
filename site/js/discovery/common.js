import { CFG } from "./config.js";
import { h, isNum, fmt } from "./util.js";

export function demoBadge(big = false) {
  return h("span", { class: `sbd-badge sbd-badge-demo${big ? " sbd-badge-big" : ""}`, title: "Injected on purpose into real data to test that the search works" },
    "Artificial test object");
}

export function verdictBadge(v) {
  const cls = v === "candidate" ? "sbd-badge-candidate" : v === "rejected" ? "sbd-badge-rejected" : "sbd-badge-unknown";
  const label = v === "candidate" ? "Candidate" : v === "rejected" ? "Rejected" : v || "No verdict";
  return h("span", { class: `sbd-badge ${cls}` }, label);
}

export function colorClassChip(text) {
  if (!text) return h("span", { class: "sbd-chip sbd-color-unknown" }, "Colour: not measured");
  const t = text.toLowerCase();
  const cls = /red|methane|brown dwarf|cold/.test(t) ? "sbd-color-red" : /blue|hot/.test(t) ? "sbd-color-blue" : /unknown/.test(t) ? "sbd-color-unknown" : "sbd-color-normal";
  return h("span", { class: `sbd-chip ${cls}`, title: text }, text);
}

/** Significance vs threshold as a small bar with a threshold tick. */
export function sigMeter(sig, threshold) {
  if (!isNum(sig)) return h("div", { class: "sbd-sig sbd-muted" }, "Significance: not given");
  const scaleMax = Math.max(sig, isNum(threshold) ? threshold : 0) * 1.25 || 1;
  const pass = isNum(threshold) ? sig >= threshold : null;
  return h("div", { class: "sbd-sig" },
    h("div", { class: "sbd-sig-text" },
      h("strong", {}, `${fmt(sig)}σ`),
      isNum(threshold) ? h("span", { class: "sbd-muted" }, ` vs threshold ${fmt(threshold)}σ`) : null,
      pass == null ? null : h("span", { class: pass ? "sbd-ok" : "sbd-bad" }, pass ? " ✓ above" : " ✗ below")),
    h("div", { class: "sbd-sig-track", role: "img", "aria-label": `Significance ${fmt(sig)}, threshold ${fmt(threshold)}` },
      h("span", { class: `sbd-sig-fill ${pass === false ? "sbd-sig-low" : ""}`, style: `width:${(sig / scaleMax) * 100}%` }),
      isNum(threshold) ? h("span", { class: "sbd-sig-thr", style: `left:${(threshold / scaleMax) * 100}%` }) : null));
}

export function speedText(c) {
  if (isNum(c.speed_arcsec_day)) return `${fmt(c.speed_arcsec_day, 2)}″/day`;
  if (isNum(c.vx) && isNum(c.vy)) return `${fmt(Math.hypot(c.vx, c.vy) * CFG.pixelScaleArcsec, 2)}″/day`;
  return "–";
}

export function isRejected(c) {
  return c.verdict === "rejected";
}
