// Drop-in widgets for C's pages. Include once:
//   <link rel="stylesheet" href="css/discovery.css">
//   <script type="module" src="js/discovery/widgets.js"></script>
// then add any of:
//   <div data-sbd-search></div>                                    (coordinate / name search; follows ?ra=&dec= on load)
//   <div data-sbd-aladin data-target="barnard"></div>             (or data-ra / data-dec / data-fov in degrees)
//   <div data-sbd-slow data-target="barnard"></div>
//   <div data-sbd-reviews></div>                                    (export/clear toolbar)
//   <div data-sbd-search-note></div>                               (optional spot for "Showing results for …")
// Elements added later (e.g. by C's router) are mounted on the "skyblink:change" event,
// or call window.SkyBlinkDiscovery.autoInit() / mountSearch() / mountSlowBox() yourself.

import { CFG } from "./config.js";
import { getTarget, getParam, onReady, links } from "./util.js";
import { mountAladin } from "./aladin.js";
import { mountSlowBox, slowResult } from "./slow-box.js";
import { mountReviewToolbar, Reviews, exportJSON, exportCSV } from "./review.js";
import { mountSearch, runSearch, parseQuery, handleCoordinateParams, arrivalNote, distanceArcmin } from "./search.js";
import { updateViewerSlots } from "./viewer-slots.js";

export async function mountTargetSky(el, targetId, extra = {}) {
  const t = await getTarget(targetId);
  if (!t) {
    el.textContent = `Unknown target “${targetId}”.`;
    return null;
  }
  return mountAladin(el, { ra: t.ra, dec: t.dec, markers: [{ ra: t.ra, dec: t.dec, label: t.name, color: "#ffd166" }], ...extra });
}

function targetOf(el) {
  return el.dataset.target || getParam(CFG.params.target);
}

export function autoInit(root = document) {
  root.querySelectorAll("[data-sbd-search]:not([data-sbd-mounted])").forEach((el) => {
    el.dataset.sbdMounted = "1";
    mountSearch(el, { autoRun: el.dataset.auto !== "false", showHelp: el.dataset.help !== "false" });
  });
  root.querySelectorAll("[data-sbd-aladin]:not([data-sbd-mounted])").forEach((el) => {
    el.dataset.sbdMounted = "1";
    const fovDeg = el.dataset.fov ? Number(el.dataset.fov) : undefined;
    if (el.dataset.ra && el.dataset.dec) {
      const ra = Number(el.dataset.ra), dec = Number(el.dataset.dec);
      mountAladin(el, { ra, dec, fovDeg, markers: [{ ra, dec, label: el.dataset.label || "", color: "#ffd166" }] });
    } else {
      const t = targetOf(el);
      if (t) mountTargetSky(el, t, { fovDeg });
    }
  });
  root.querySelectorAll("[data-sbd-slow]:not([data-sbd-mounted])").forEach((el) => {
    el.dataset.sbdMounted = "1";
    mountSlowBox(el, targetOf(el));
  });
  root.querySelectorAll("[data-sbd-reviews]:not([data-sbd-mounted])").forEach((el) => {
    el.dataset.sbdMounted = "1";
    mountReviewToolbar(el);
  });
}

/**
 * Shows "Showing results for <name>, <X> arcmin from your coordinates" on a target page reached from a search
 * (URL has from_ra/from_dec). Uses [data-sbd-search-note] if present, else a slot just above C's #viewer-body.
 */
export async function updateArrivalNote(targetId = getParam(CFG.params.target)) {
  let slot = document.querySelector("[data-sbd-search-note]");
  if (!slot) {
    const body = document.getElementById("viewer-body");
    if (!body) return;
    slot = document.getElementById("sbd-arrival-slot");
    if (!slot) {
      slot = document.createElement("div");
      slot.id = "sbd-arrival-slot";
      body.before(slot);
    }
  }
  const t = targetId && targetId === getParam(CFG.params.target) ? await getTarget(targetId) : null;
  const note = arrivalNote(t);
  slot.replaceChildren(...(note ? [note] : []));
  slot.hidden = !note;
}

window.SkyBlinkDiscovery = {
  config: CFG, autoInit, links,
  mountAladin, mountTargetSky, mountSlowBox, slowResult,
  mountSearch, runSearch, parseQuery, handleCoordinateParams, updateArrivalNote, distanceArcmin,
  updateViewerSlots, Reviews, exportJSON, exportCSV,
};

// C's router re-renders #home / #viewer and then fires this event.
document.addEventListener("skyblink:change", (e) => {
  autoInit();
  updateViewerSlots(e.detail || {});
  if (e.detail && e.detail.target) updateArrivalNote(e.detail.target);
  else if (document.getElementById("sbd-arrival-slot")) updateArrivalNote(null);
});

onReady(() => {
  autoInit();
  // C's first "skyblink:change" can fire before this module loads; if the viewer is already shown, catch up.
  const viewer = document.getElementById("viewer");
  const target = getParam(CFG.params.target);
  if (viewer && !viewer.hidden && target) updateViewerSlots({ target, mode: getParam("mode") });
});
