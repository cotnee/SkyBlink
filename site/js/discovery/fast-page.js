import { CFG } from "./config.js";
import { h, fill, fmt, isNum, getParam, links, paths, fetchJSON, loadTargets, getTarget, safeImg, message, onReady } from "./util.js";
import { demoBadge, verdictBadge, colorClassChip, sigMeter, speedText, isRejected } from "./common.js";
import { reviewChip, mountReviewToolbar } from "./review.js";
import { mountAladin } from "./aladin.js";

async function renderPicker(root, note) {
  const targets = await loadTargets();
  const withFast = targets.filter((t) => !Array.isArray(t.modes) || t.modes.includes("fast"));
  fill(root, 
    h("h1", {}, "Fast movers"),
    note ? message(note, "warn") : null,
    h("p", {}, "Pick a target to see what the shift-and-stack search found."),
    withFast.length
      ? h("ul", { class: "sbd-target-list" }, withFast.map((t) => h("li", {}, h("a", { href: links.fast(t.id) }, t.name || t.id), t.mission ? h("span", { class: "sbd-muted" }, ` · ${t.mission}`) : null)))
      : message("No targets found (data/targets.json is missing or empty).", "warn"));
}

export function candidateCard(c, target, field) {
  const href = links.candidate(target, c.id);
  const media = c.animation || c.image;
  return h("article", { class: `sbd-card${c.demo ? " sbd-card-demo" : ""}` },
    h("a", { href, class: "sbd-card-media", "aria-label": `Open ${c.id}` },
      safeImg(media ? paths.fastMedia(target, media) : null, `Animation of ${c.id}`, "sbd-card-img")),
    h("div", { class: "sbd-card-body" },
      h("div", { class: "sbd-badges" }, verdictBadge(c.verdict), c.demo ? demoBadge() : null, reviewChip(c.id)),
      h("h3", { class: "sbd-card-title" }, h("a", { href }, c.id)),
      h("dl", { class: "sbd-facts" },
        h("dt", {}, "Speed"), h("dd", {}, speedText(c)),
        h("dt", {}, "Position"), h("dd", {}, isNum(c.ra) && isNum(c.dec) ? `${c.ra.toFixed(4)}°, ${c.dec >= 0 ? "+" : ""}${c.dec.toFixed(4)}°` : "–")),
      sigMeter(c.sig, field.threshold),
      colorClassChip(c.color_class),
      h("a", { href, class: "sbd-btn sbd-btn-primary sbd-card-cta" }, "Open candidate page →")));
}

export function rejectedItem(c, target) {
  const href = links.candidate(target, c.id);
  const reasons = Array.isArray(c.reasons) && c.reasons.length ? c.reasons : ["(no reason given by the engine)"];
  return h("li", { class: "sbd-rejected-item" },
    h("a", { href, class: "sbd-rejected-thumb" }, safeImg(c.image ? paths.fastMedia(target, c.image) : null, `Image of ${c.id}`)),
    h("div", {},
      h("div", { class: "sbd-badges" }, verdictBadge(c.verdict), c.demo ? demoBadge() : null, reviewChip(c.id)),
      h("h4", {}, h("a", { href }, c.id), h("span", { class: "sbd-muted" }, ` · ${fmt(c.sig)}σ · ${speedText(c)}`)),
      h("ul", { class: "sbd-reasons" }, reasons.map((r) => h("li", {}, r)))));
}

async function render(root) {
  const targetId = getParam(CFG.params.target);
  if (!targetId) return renderPicker(root);

  const [target, res] = await Promise.all([getTarget(targetId), fetchJSON(paths.candidates(targetId))]);
  const name = target?.name || res.data?.field?.name || targetId;
  document.title = `Fast movers · ${name} · SkyBlink`;

  if (!res.ok) {
    return renderPicker(root, res.status === 404
      ? `No fast-mover results for “${name}” yet.`
      : `Couldn't read the fast-mover results for “${name}” (${res.error}).`);
  }

  const field = res.data.field || {};
  const all = Array.isArray(res.data.candidates) ? res.data.candidates.filter((c) => c && c.id) : [];
  const good = all.filter((c) => !isRejected(c)).sort((a, b) => (b.sig || 0) - (a.sig || 0));
  const bad = all.filter(isRejected);
  const dates = Array.isArray(field.dates) && field.dates.length ? `${field.dates[0]} → ${field.dates[field.dates.length - 1]}` : null;

  const skyEl = h("div", { class: "sbd-sky" });
  const toolbar = h("div");

  fill(root, 
    h("nav", { class: "sbd-crumbs" }, h("a", { href: links.target(target || targetId) }, `← ${name}`)),
    h("header", { class: "sbd-hero" },
      h("p", { class: "sbd-eyebrow" }, "Fast movers · shift-and-stack search"),
      h("h1", {}, name),
      h("p", { class: "sbd-lede" },
        `We lined up ${field.exposures ? `${field.exposures} SPHEREx exposures` : "every SPHEREx exposure"} along thousands of possible paths. `,
        "Anything that moves too fast to see in a single picture adds up into a bright dot. Here is what came out."),
      h("div", { class: "sbd-field-stats" },
        stat(field.exposures ?? "–", "exposures"),
        stat(isNum(field.threshold) ? `${fmt(field.threshold)}σ` : "–", "trust threshold"),
        stat(good.length, good.length === 1 ? "candidate" : "candidates"),
        stat(bad.length, "rejected"),
        dates ? stat(dates, "observing dates") : null)),
    h("section", { class: "sbd-section" },
      h("h2", {}, "Candidates"),
      good.some((c) => c.demo) ? h("p", { class: "sbd-note-demo" }, demoBadge(), " objects were injected into the real images on purpose, to prove the search can find faint movers. They are not discoveries.") : null,
      good.length ? h("div", { class: "sbd-cards" }, good.map((c) => candidateCard(c, targetId, field))) : message("No candidates passed the checks in this field. That is a normal result too!")),
    h("section", { class: "sbd-section" },
      h("h2", {}, "Rejected by the automatic checks"),
      h("p", { class: "sbd-muted" }, "These looked like signals at first but failed a check. Each one says why."),
      bad.length ? h("ul", { class: "sbd-rejected" }, bad.map((c) => rejectedItem(c, targetId))) : message("Nothing was rejected.")),
    h("section", { class: "sbd-section" },
      h("h2", {}, "Where they are in the sky"),
      skyEl),
    h("section", { class: "sbd-section" },
      h("h2", {}, "Your reviews"),
      h("p", { class: "sbd-muted" }, "Open a candidate to mark it as a real object, an artifact, or something new. Download your reviews to send them to the team."),
      toolbar));

  mountReviewToolbar(toolbar);
  const ra = isNum(field.ra) ? field.ra : target?.ra;
  const dec = isNum(field.dec) ? field.dec : target?.dec;
  mountAladin(skyEl, {
    ra, dec,
    fovDeg: (CFG.gridSize * CFG.pixelScaleArcsec * 1.4) / 3600,
    markers: all.map((c) => ({ ra: c.ra, dec: c.dec, label: c.id, color: isRejected(c) ? "#9aa3b5" : "#ff4f86", desc: `${c.verdict || ""} · ${fmt(c.sig)}σ` })),
  });
}

function stat(v, label) {
  return h("div", { class: "sbd-stat" }, h("span", { class: "sbd-stat-val" }, String(v)), h("span", { class: "sbd-stat-label" }, label));
}

onReady(() => {
  const root = document.getElementById("sbd-fast");
  if (root) render(root).catch((e) => { console.error(e); fill(root, message(`Something went wrong: ${e.message}`, "error")); });
});
