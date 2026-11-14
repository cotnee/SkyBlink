// Fills C's per-mode containers on index.html (#sb-fast-candidates, #sb-fast-rejected,
// #sb-slow-result, #sb-target-aladin) for the target in C's router. C shows/hides the
// containers per mode and fires "skyblink:change" with { target, mode, ra, dec } after each render.

import { CFG } from "./config.js";
import { h, fill, fmt, isNum, links, paths, fetchJSON, getTarget, message } from "./util.js";
import { demoBadge, isRejected } from "./common.js";
import { candidateCard, rejectedItem } from "./fast-page.js";
import { mountSlowBox } from "./slow-box.js";
import { mountAladin } from "./aladin.js";

const SLOT_IDS = {
  candidates: "sb-fast-candidates",
  rejected: "sb-fast-rejected",
  slow: "sb-slow-result",
  aladin: "sb-target-aladin",
};

let generation = 0;

const slot = (key) => document.getElementById(SLOT_IDS[key]);

// C's .sb-d-slot container sets the page width and padding.
function section(el, ...children) {
  el.classList.add("sbd", "sbd-viewer-slot");
  return fill(el, h("section", { class: "sbd-section" }, ...children));
}

function clear(el) {
  if (!el) return;
  el.replaceChildren();
  delete el.dataset.sbdKey;
}

// targets.json first, then the field centre in candidates.json (same fallback as C's router).
async function coordsFor(targetId) {
  const t = await getTarget(targetId);
  if (isNum(t?.ra) && isNum(t?.dec)) return { ra: t.ra, dec: t.dec };
  const res = await fetchJSON(paths.candidates(targetId));
  const f = res.ok ? res.data?.field : null;
  return isNum(f?.ra) && isNum(f?.dec) ? { ra: f.ra, dec: f.dec } : {};
}

async function fillFast(targetId, isCurrent) {
  const candEl = slot("candidates"), rejEl = slot("rejected");
  if (!candEl && !rejEl) return null;
  const res = await fetchJSON(paths.candidates(targetId));
  if (!isCurrent()) return null;

  if (!res.ok) {
    if (candEl) section(candEl, h("h2", {}, "Candidates"), message(res.status === 404
      ? "No fast-mover results for this target yet."
      : `Couldn't read the fast-mover results (${res.error}).`));
    clear(rejEl);
    return null;
  }

  const field = res.data.field || {};
  const all = Array.isArray(res.data.candidates) ? res.data.candidates.filter((c) => c && c.id) : [];
  const good = all.filter((c) => !isRejected(c)).sort((a, b) => (b.sig || 0) - (a.sig || 0));
  const bad = all.filter(isRejected);

  if (candEl) {
    section(candEl,
      h("h2", {}, "Candidates"),
      good.some((c) => c.demo) ? h("p", { class: "sbd-note-demo" }, demoBadge(), " objects were injected into the real images on purpose, to prove the search can find faint movers. They are not discoveries.") : null,
      good.length ? h("div", { class: "sbd-cards" }, good.map((c) => candidateCard(c, targetId, field)))
        : message("No candidates passed the checks in this field. That is a normal result too!"),
      h("p", { class: "sbd-muted" }, h("a", { href: links.fast(targetId) }, "Open the full fast movers page →")));
  }
  if (rejEl) {
    section(rejEl,
      h("h2", {}, "Rejected by the automatic checks"),
      h("p", { class: "sbd-muted" }, "These looked like signals at first but failed a check. Each one says why."),
      bad.length ? h("ul", { class: "sbd-rejected" }, bad.map((c) => rejectedItem(c, targetId))) : message("Nothing was rejected."));
  }
  return all;
}

async function fillSlow(targetId, isCurrent) {
  const el = slot("slow");
  if (!el) return;
  const box = h("div");
  section(el, box);
  await mountSlowBox(box, targetId, { blink: false });
  if (!isCurrent()) clear(el);
}

async function fillAladin(detail, candidates, isCurrent) {
  const el = slot("aladin");
  if (!el) return;
  const withCands = Array.isArray(candidates) && candidates.length > 0;
  const key = `${detail.target}|${withCands ? "fast" : "target"}`;
  // Switching between C's non-fast modes keeps the same map instead of reloading Aladin.
  if (el.dataset.sbdKey === key) return;

  let { ra, dec } = detail;
  if (!isNum(ra) || !isNum(dec)) ({ ra, dec } = await coordsFor(detail.target));
  if (!isCurrent()) return;
  const view = h("div");
  section(el, h("h2", {}, "Where it is in the sky"), view);
  if (isNum(ra) && isNum(dec)) el.dataset.sbdKey = key;
  else delete el.dataset.sbdKey;
  const markers = [{ ra, dec, label: detail.name || detail.target, color: "#ffd166" }];
  if (withCands) {
    for (const c of candidates) {
      markers.push({ ra: c.ra, dec: c.dec, label: c.id, color: isRejected(c) ? "#9aa3b5" : "#ff4f86", desc: `${c.verdict || ""} · ${fmt(c.sig)}σ` });
    }
  }
  mountAladin(view, {
    ra, dec, markers,
    fovDeg: withCands ? (CFG.gridSize * CFG.pixelScaleArcsec * 1.4) / 3600 : undefined,
  });
}

export async function updateViewerSlots(detail = {}) {
  const gen = ++generation;
  const isCurrent = () => gen === generation;
  const { target, mode } = detail;

  // No target, or C hid every slot (e.g. unknown target): nothing to show.
  const anyShown = Object.keys(SLOT_IDS).some((k) => slot(k) && !slot(k).hidden);
  if (!target || !anyShown) {
    Object.keys(SLOT_IDS).forEach((k) => clear(slot(k)));
    return;
  }

  if (mode === "fast") {
    clear(slot("slow"));
    const candidates = await fillFast(target, isCurrent);
    if (isCurrent()) await fillAladin(detail, candidates, isCurrent);
  } else {
    clear(slot("candidates"));
    clear(slot("rejected"));
    if (mode === "slow") fillSlow(target, isCurrent);
    else clear(slot("slow"));
    await fillAladin(detail, null, isCurrent);
  }
}
