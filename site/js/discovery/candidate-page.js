import { CFG } from "./config.js";
import { h, fill, fmt, isNum, getParam, links, paths, fetchJSON, getTarget, safeImg, message, raToHms, decToDms, onReady } from "./util.js";
import { demoBadge, verdictBadge, colorClassChip, sigMeter, speedText, isRejected } from "./common.js";
import { mountReviewPanel, mountReviewToolbar } from "./review.js";
import { renderSpectrum } from "./spectrum.js";
import { explainChecks } from "./checks.js";
import { mountAladin } from "./aladin.js";

const STATUS_ICON = { pass: "✓", fail: "✗", warn: "!", info: "i" };

function directionText(vx, vy) {
  if (!isNum(vx) || !isNum(vy) || (vx === 0 && vy === 0)) return null;
  // Grid has origin bottom-left; assume +y = north, +x = west→east on the image as delivered by the engine.
  const ang = (Math.atan2(vy, vx) * 180) / Math.PI;
  const dirs = ["right", "up-right", "up", "up-left", "left", "down-left", "down", "down-right"];
  return dirs[Math.round(((ang + 360) % 360) / 45) % 8];
}

function coordsTable(c, field) {
  const rows = [
    ["Right ascension (RA)", isNum(c.ra) ? `${c.ra.toFixed(5)}°` : "–", raToHms(c.ra)],
    ["Declination (Dec)", isNum(c.dec) ? `${c.dec >= 0 ? "+" : ""}${c.dec.toFixed(5)}°` : "–", decToDms(c.dec)],
  ];
  const extra = [];
  if (c.date_ref) extra.push(["Position on date", c.date_ref]);
  if (isNum(c.x) && isNum(c.y)) extra.push(["Grid position (x, y)", `${c.x}, ${c.y} px (of ${CFG.gridSize}×${CFG.gridSize}, origin bottom-left, ${CFG.pixelScaleArcsec}″/px)`]);
  if (isNum(c.vx) && isNum(c.vy)) {
    const dir = directionText(c.vx, c.vy);
    extra.push(["Motion on grid", `${fmt(c.vx, 3)}, ${fmt(c.vy, 3)} px/day${dir ? ` (moving ${dir} in the image)` : ""}`]);
  }
  extra.push(["Speed", speedText(c)]);
  if (field.exposures) extra.push(["Exposures stacked", String(field.exposures)]);
  return h("table", { class: "sbd-table sbd-coords" },
    h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Decimal (ICRS)"), h("th", {}, "Sexagesimal"))),
    h("tbody", {},
      rows.map(([a, b, d]) => h("tr", {}, h("th", {}, a), h("td", {}, b), h("td", {}, d))),
      extra.map(([a, b]) => h("tr", {}, h("th", {}, a), h("td", { colspan: 2 }, b)))));
}

async function render(root) {
  const targetId = getParam(CFG.params.target);
  const id = getParam(CFG.params.id);
  if (!targetId || !id) {
    fill(root, message(`This page needs ?${CFG.params.target}=…&${CFG.params.id}=… in the address.`, "warn"),
      h("p", {}, h("a", { href: CFG.pages.fast }, "← Choose a target on the Fast movers page")));
    return;
  }

  const [target, res] = await Promise.all([getTarget(targetId), fetchJSON(paths.candidates(targetId))]);
  const name = target?.name || targetId;
  const back = h("nav", { class: "sbd-crumbs" },
    h("a", { href: links.target(target || targetId) }, name), " / ", h("a", { href: links.fast(targetId) }, "Fast movers"), " / ", h("span", {}, id));

  if (!res.ok) {
    fill(root, back, message(`Couldn't read fast-mover results for “${name}” (${res.error}).`, "error"));
    return;
  }
  const field = res.data.field || {};
  const list = Array.isArray(res.data.candidates) ? res.data.candidates.filter((c) => c && c.id) : [];
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) {
    fill(root, back, message(`No object called “${id}” in ${name}'s results.`, "warn"),
      h("p", {}, h("a", { href: links.fast(targetId) }, "← See all candidates")));
    return;
  }
  const c = list[idx];
  document.title = `${c.id} · ${name} · SkyBlink`;
  const prev = list[idx - 1], next = list[idx + 1];

  const reviewEl = h("div", { class: "sbd-review" });
  const spectrumEl = h("div", { class: "sbd-spectrum" });
  const skyEl = h("div", { class: "sbd-sky" });
  const exportEl = h("div");

  const checks = explainChecks(c, field);

  fill(root, 
    back,
    c.demo ? h("div", { class: "sbd-demo-banner" }, demoBadge(true),
      h("p", {}, "This object was added to the real SPHEREx images on purpose by our team, to test that the search can find faint moving things. It is not a real discovery.")) : null,
    h("header", { class: "sbd-hero sbd-hero-cand" },
      h("p", { class: "sbd-eyebrow" }, `Fast movers · ${name}`),
      h("h1", {}, c.id),
      h("div", { class: "sbd-badges" }, verdictBadge(c.verdict), colorClassChip(c.color_class)),
      h("div", { class: "sbd-hero-grid" },
        sigMeter(c.sig, field.threshold),
        h("div", { class: "sbd-stat" }, h("span", { class: "sbd-stat-val" }, speedText(c)), h("span", { class: "sbd-stat-label" }, "speed")))),

    h("section", { class: "sbd-section sbd-review-section" },
      h("h2", {}, "What do you think?"),
      h("p", { class: "sbd-muted" }, "Look at the pictures and the checks below, then tell us."),
      reviewEl),

    h("section", { class: "sbd-section" },
      h("h2", {}, "Pictures"),
      h("div", { class: "sbd-media-grid" },
        h("figure", { class: "sbd-figure sbd-figure-wide" },
          safeImg(c.image ? paths.fastMedia(targetId, c.image) : null, `Three-panel image of ${c.id}`, "sbd-panel-img"),
          h("figcaption", {}, "Three-panel view from the engine: the object in each half of the observations and in the full shift-and-stack image.")),
        h("figure", { class: "sbd-figure" },
          safeImg(c.animation ? paths.fastMedia(targetId, c.animation) : null, `Animation of ${c.id}`, "sbd-gif-img"),
          h("figcaption", {}, "Animation across the observing dates: watch the circled dot move.")))),

    h("section", { class: "sbd-section" },
      h("h2", {}, "Its colours (6 SPHEREx detectors)"),
      h("p", { class: "sbd-muted" }, "SPHEREx sees each spot through six detectors, each tuned to a different infrared colour. Plotting brightness against wavelength gives a mini spectrum: sunlight reflected off an asteroid fades towards long wavelengths, while a cold brown dwarf gets brighter and shows a methane dip near 3.3 µm."),
      c.color_class ? h("p", {}, h("strong", {}, "Colour class: "), c.color_class) : null,
      spectrumEl),

    h("section", { class: "sbd-section" },
      h("h2", {}, "Automatic checks"),
      h("ol", { class: "sbd-checks" }, checks.map((k) => h("li", { class: `sbd-check sbd-check-${k.status}` },
        h("span", { class: "sbd-check-icon", "aria-label": k.status }, STATUS_ICON[k.status]),
        h("div", {}, h("h3", {}, k.title), h("p", { class: "sbd-check-text" }, k.text)))))),

    h("section", { class: "sbd-section" },
      h("h2", {}, "Where it is in the sky"),
      coordsTable(c, field),
      h("p", { class: "sbd-muted" }, "The pink circle marks this object. Turn on the WISE overlay to compare with the 2010 infrared sky, and Gaia DR3 to see catalogued stars."),
      skyEl),

    h("nav", { class: "sbd-pager" },
      prev ? h("a", { href: links.candidate(targetId, prev.id), class: "sbd-btn" }, `← ${prev.id}`) : h("span"),
      h("a", { href: links.fast(targetId), class: "sbd-btn sbd-btn-ghost" }, "All candidates"),
      next ? h("a", { href: links.candidate(targetId, next.id), class: "sbd-btn" }, `${next.id} →`) : h("span")),

    h("section", { class: "sbd-section" }, h("h2", {}, "Your saved reviews"), exportEl));

  mountReviewPanel(reviewEl, { candidate: c, target: targetId });
  mountReviewToolbar(exportEl);
  renderSpectrum(spectrumEl, c.sed, c.sed_wave_um);
  mountAladin(skyEl, {
    ra: c.ra, dec: c.dec, fovDeg: 10 / 60,
    markers: [{ ra: c.ra, dec: c.dec, label: c.id, color: isRejected(c) ? "#9aa3b5" : "#ff4f86", desc: `${c.verdict || ""} · ${fmt(c.sig)}σ · ${speedText(c)}` }],
  });
}

onReady(() => {
  const root = document.getElementById("sbd-candidate");
  if (root) render(root).catch((e) => { console.error(e); fill(root, message(`Something went wrong: ${e.message}`, "error")); });
});
