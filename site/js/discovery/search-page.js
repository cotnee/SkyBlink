// search.html: the sky at any coordinates, for fields our engine hasn't processed yet.
import { CFG } from "./config.js";
import { h, fill, getParam, loadTargets, targetUrl, message, onReady } from "./util.js";
import { mountSearch, checkCoords, rankTargets, findMatch, isProcessed, fmtDistance, searchPageUrl, coordsText } from "./search.js";
import { mountAladin } from "./aladin.js";

const P = CFG.params;
const S = CFG.search;

async function copyText(text, btn, label) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = h("textarea", { class: "sbd-offscreen", readonly: true });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }
  btn.textContent = ok ? "Copied!" : "Select and copy it by hand";
  setTimeout(() => { btn.textContent = label; }, 2000);
}

function fieldName(c) {
  return `field_${c.raText}_${c.decText}`;
}

function processSection(c) {
  const snippet = `FIELD_NAME = "${fieldName(c)}"\nra, dec = ${c.raText}, ${c.decText}`;
  const copyBtn = h("button", { type: "button", class: "sbd-btn sbd-btn-small" }, "Copy values");
  copyBtn.addEventListener("click", () => copyText(snippet, copyBtn, "Copy values"));
  return h("section", { class: "sbd-section sbd-process" },
    h("h2", {}, "Process this field yourself"),
    h("div", { class: "sbd-process-grid" },
      h("div", {},
        h("a", { href: S.colabUrl, target: "_blank", rel: "noopener", class: "sbd-btn sbd-btn-primary sbd-btn-big" }, "Process this field yourself ↗"),
        h("p", { class: "sbd-muted sbd-small" }, "Opens our engine notebook in Google Colab in a new tab. It's free; you need a Google account.")),
      h("div", { class: "sbd-snippet" },
        h("div", { class: "sbd-snippet-head" }, h("span", {}, "Your values"), copyBtn),
        h("pre", { class: "sbd-snippet-code", tabindex: "0", "aria-label": "Values to paste into the notebook" }, snippet))),
    h("p", {}, "Paste these values into section 1 of the notebook, then choose ", h("strong", {}, "Runtime > Run all"), ". NASA's archive can be slow; the notebook retries automatically."));
}

function nearestList(c, targets) {
  const ranked = rankTargets(c.ra, c.dec, targets.filter(isProcessed)).slice(0, S.nearestCount);
  return h("section", { class: "sbd-section" },
    h("h2", {}, "Nearest fields we have processed"),
    ranked.length
      ? h("ol", { class: "sbd-nearest" }, ranked.map(({ target: t, arcmin }) =>
        h("li", {},
          h("a", { href: targetUrl(t, { [P.fromRa]: c.raText, [P.fromDec]: c.decText }), class: "sbd-nearest-name" }, t.name || t.id),
          t.kind ? h("span", { class: "sbd-chip sbd-chip-kind" }, t.kind) : null,
          h("span", { class: "sbd-nearest-dist" }, fmtDistance(arcmin)),
          t.about ? h("p", { class: "sbd-muted sbd-small" }, t.about) : null)))
      : message("We haven't processed any fields yet."));
}

function renderResult(out, c, targets) {
  document.title = c.name ? `${c.name} · SkyBlink` : `Sky at ${c.raText}, ${c.decText} · SkyBlink`;
  const match = findMatch(c.ra, c.dec, targets);
  const sky = h("div", { class: "sbd-sky" });
  const linkBtn = h("button", { type: "button", class: "sbd-btn" }, "Copy link to this view");
  const viewUrl = new URL(searchPageUrl(c.raText, c.decText, c.name), location.href).href;
  linkBtn.addEventListener("click", () => copyText(viewUrl, linkBtn, "Copy link to this view"));

  const intro = match
    ? h("div", { class: "sbd-match-banner" },
      h("p", {}, `${c.name || "These coordinates"} ${c.name ? "is" : "are"} ${match.arcmin.toFixed(1)} arcmin from ${match.target.name || match.target.id}, which we have results for.`),
      h("a", { href: targetUrl(match.target, { [P.fromRa]: c.raText, [P.fromDec]: c.decText }), class: "sbd-btn sbd-btn-primary" }, `Open ${match.target.name || match.target.id} results →`))
    : h("p", { class: "sbd-honest" }, "Our engine hasn't processed this part of the sky yet. Here is what other telescopes see there. You can run our engine on it yourself in about 15 minutes.");

  fill(out,
    h("header", { class: "sbd-hero" },
      h("p", { class: "sbd-eyebrow" }, match ? "Near a processed field" : "Not processed yet"),
      h("h1", {}, c.name ? `The sky around ${c.name}` : "The sky at your coordinates"),
      h("p", { class: "sbd-coords-line" }, coordsText(c)),
      c.name ? h("p", { class: "sbd-muted sbd-small" }, "Position from the CDS Sesame name lookup (SIMBAD, NED, VizieR), the same kind of lookup NASA's IRSA archive uses.") : null,
      intro,
      h("div", { class: "sbd-share-row" }, linkBtn)),
    h("section", { class: "sbd-section" },
      h("h2", {}, "What other telescopes see here"),
      h("p", { class: "sbd-muted" }, "Infrared picture from NASA's WISE telescope (2010). Blue circles are stars measured by ESA's Gaia satellite. The yellow circle marks your coordinates. Drag to look around; use the field-of-view menu to zoom."),
      sky),
    match ? null : processSection(c),
    nearestList(c, targets));

  mountAladin(sky, { ra: c.ra, dec: c.dec, fovDeg: S.notProcessedFovDeg, markers: [{ ra: c.ra, dec: c.dec, label: c.name || "Your coordinates", color: "#ffd166" }] });
  window.scrollTo(0, 0);
}

async function render(root) {
  const searchEl = h("div", { class: "sbd-search-top" });
  const out = h("div");
  fill(root, searchEl, out);
  const targets = await loadTargets();
  mountSearch(searchEl, { onNotProcessed: (c, ts) => renderResult(out, c, ts) });

  const ra = getParam(P.ra), dec = getParam(P.dec);
  if (ra == null || dec == null) {
    fill(out, h("header", { class: "sbd-hero" },
      h("h1", {}, "Search any part of the sky"),
      h("p", { class: "sbd-lede" }, "Type an object name or sky coordinates above. If we've already processed that part of the sky, you'll go straight to the results. If not, you'll see what other telescopes see there, and how to run our engine on it yourself.")));
    return;
  }
  const c = checkCoords(ra, dec);
  if (!c.ok) {
    fill(out, message(`${c.message} Fix the coordinates in the box above and press Search.`, "warn"));
    return;
  }
  const name = getParam(P.name);
  renderResult(out, name ? { ...c, name } : c, targets);
}

onReady(() => {
  const root = document.getElementById("sbd-search-page");
  if (root) render(root);
});
