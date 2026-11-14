// Demo/reference page showing D's widgets for one target, the way C's target page can embed them.
import { CFG } from "./config.js";
import { h, fill, getParam, loadTargets, links, pageUrl, message, onReady, raToHms, decToDms } from "./util.js";
import { mountSlowBox } from "./slow-box.js";
import { mountTargetSky } from "./widgets.js";
import { arrivalNote } from "./search.js";

async function render(root) {
  const targets = await loadTargets();
  const id = getParam(CFG.params.target) || targets[0]?.id;
  const t = targets.find((x) => x.id === id);
  const here = location.pathname.split("/").pop() || "discovery-target.html";

  const picker = h("nav", { class: "sbd-target-tabs" }, targets.map((x) =>
    h("a", { href: pageUrl(here, { [CFG.params.target]: x.id }), class: `sbd-btn sbd-btn-small${x.id === id ? " sbd-btn-primary" : ""}` }, x.name || x.id)));

  if (!t) {
    fill(root, picker, message(targets.length ? `Unknown target “${id}”.` : "No targets found (data/targets.json).", "warn"));
    return;
  }
  document.title = `${t.name} · SkyBlink discovery tools`;
  const sky = h("div", { class: "sbd-sky" });
  const slow = h("div");
  const modes = Array.isArray(t.modes) ? t.modes : [];

  fill(root,
    picker,
    arrivalNote(t),
    h("header", { class: "sbd-hero" },
      h("p", { class: "sbd-eyebrow" }, t.kind || "Target"),
      h("h1", {}, t.name || t.id),
      t.mission ? h("p", { class: "sbd-lede" }, t.mission) : null,
      t.about ? h("p", {}, t.about) : null,
      t.ready === false ? h("p", { class: "sbd-msg sbd-msg-warn" }, "Results for this target are still being prepared.") : null,
      h("p", { class: "sbd-muted" }, `RA ${t.ra}°, Dec ${t.dec}°  ·  ${raToHms(t.ra)}  ${decToDms(t.dec)}`),
      modes.includes("fast") ? h("a", { href: links.fast(t.id), class: "sbd-btn sbd-btn-primary" }, "Fast movers results →") : null),
    h("section", { class: "sbd-section" }, h("h2", {}, "Sky map"), sky),
    h("section", { class: "sbd-section" }, h("h2", {}, "Slow movers"), slow));

  mountTargetSky(sky, t.id);
  mountSlowBox(slow, t.id);
}

onReady(() => {
  const root = document.getElementById("sbd-target");
  if (root) render(root);
});
