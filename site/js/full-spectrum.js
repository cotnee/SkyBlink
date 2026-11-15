/* SkyBlink: full SPHEREx spectrum (~100 wavelengths) in the Colour lens.
   Self-contained: loads data/<target>/color/spectrum.json if it exists and adds a
   "Full spectrum" section to the right column. Nothing happens if the file is missing.
   Include after app.js:  <script src="js/full-spectrum.js"></script>            */
(function () {
  const cache = {};
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  };
  const passColor = ["#7CC4FF", "#F2A25C", "#7CE0A8", "#A994FF"];

  function params() {
    const p = new URLSearchParams(location.search);
    return { target: p.get("target"), mode: p.get("mode") };
  }

  function load(target) {
    if (!cache[target]) {
      cache[target] = fetch(`data/${encodeURIComponent(target)}/color/spectrum.json`, { cache: "no-cache" })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    return cache[target];
  }

  function chart(d) {
    const pts = (d.points || []).filter(p => typeof p.um === "number" && typeof p.flux === "number");
    const W = 560, H = 300, m = { l: 58, r: 14, t: 18, b: 44 };
    const good = pts.filter(p => !p.outlier);
    const ys = good.map(p => p.flux);
    let yMin = Math.min(0, ...ys), yMax = Math.max(...ys);
    if (!(yMax > yMin)) yMax = yMin + 1;
    yMax += (yMax - yMin) * 0.1;
    const xMin = 0.7, xMax = 5.0;
    const X = um => m.l + (um - xMin) / (xMax - xMin) * (W - m.l - m.r);
    const Y = f => H - m.b - (Math.min(Math.max(f, yMin), yMax) - yMin) / (yMax - yMin) * (H - m.t - m.b);

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Spectrum of ${d.object}: ${good.length} SPHEREx measurements from ${xMin} to ${xMax} micrometres` });
    // Methane band
    svg.append(el("rect", { x: X(3.2), y: m.t, width: X(3.4) - X(3.2), height: H - m.t - m.b, fill: "rgba(242,162,92,.14)" }));
    svg.append(el("text", { x: X(3.3), y: m.t - 5, "text-anchor": "middle", class: "tick" }, "methane"));
    // Grid and ticks
    const raw = (yMax - yMin) / 5, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
    const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
      svg.append(el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "grid" }));
      svg.append(el("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", class: "tick" },
        Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : +v.toFixed(2)));
    }
    for (let um = 1; um <= 5; um++) {
      svg.append(el("text", { x: X(um), y: H - m.b + 18, "text-anchor": "middle", class: "tick" }, `${um} µm`));
    }
    svg.append(el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axis" }));
    svg.append(el("text", { x: 14, y: (H - m.b + m.t) / 2, transform: `rotate(-90 14 ${(H - m.b + m.t) / 2})`,
      "text-anchor": "middle", class: "tick" }, "flux, µJy"));
    // Points: outliers grey, others coloured by survey pass
    for (const p of pts) {
      const cx = X(p.um), cy = Y(p.flux);
      const g = el("g");
      if (!p.outlier && typeof p.err === "number" && p.err > 0) {
        g.append(el("line", { x1: cx, x2: cx, y1: Y(p.flux - p.err), y2: Y(p.flux + p.err),
          stroke: passColor[((p.pass || 1) - 1) % 4], "stroke-opacity": .35 }));
      }
      const c = el("circle", { cx, cy, r: p.outlier ? 2 : 2.6,
        fill: p.outlier ? "#39425C" : passColor[((p.pass || 1) - 1) % 4] });
      c.append(el("title", {}, `${p.um} µm · ${p.flux} µJy · ${p.det || ""} · ${p.date || ""}${p.outlier ? " · outlier" : ""}`));
      g.append(c);
      svg.append(g);
    }
    return svg;
  }

  function section(d) {
    const sec = document.createElement("section");
    sec.className = "side-sec";
    sec.id = "full-spectrum";
    const passes = [...new Set((d.points || []).filter(p => !p.outlier).map(p => p.pass || 1))].sort();
    const legend = passes.map(p => `<span class="key" style="background:${passColor[(p - 1) % 4]}"></span>survey pass ${p}`).join(" ");
    const dip = typeof d.methane_ratio === "number"
      ? ` Brightness at 3.2–3.4 µm is <b>${d.methane_ratio}×</b> the nearby continuum${d.methane_ratio < 0.8 ? ": a methane dip, the fingerprint of a cold brown dwarf" : ""}.`
      : "";
    sec.innerHTML = `
      <h2 class="kicker">Full spectrum · ${d.n_points} wavelengths</h2>
      <div class="chart" id="full-spectrum-chart"></div>
      <p class="legend">${legend} <span class="key" style="background:#39425C"></span>outlier</p>
      <p class="frame-sentence">Each point is one SPHEREx exposure. SPHEREx's filter changes colour across the detector,
        so every photo catches the star at a slightly different wavelength. Together they make a real spectrum,
        not just six colours.${dip}</p>
      <details class="table-view"><summary>Show as table</summary>
        <table><thead><tr><th scope="col">µm</th><th scope="col">Flux, µJy</th><th scope="col">Error</th><th scope="col">Detector</th><th scope="col">Date</th></tr></thead>
        <tbody>${(d.points || []).map(p => `<tr${p.outlier ? ' class="is-off"' : ""}><td>${p.um}</td><td>${p.flux}</td><td>${p.err ?? "–"}</td><td>${p.det ?? "–"}</td><td>${p.date ?? "–"}${p.outlier ? " (outlier)" : ""}</td></tr>`).join("")}</tbody></table>
      </details>`;
    sec.querySelector("#full-spectrum-chart").append(chart(d));
    return sec;
  }

  let busy = false;
  async function check() {
    if (busy) return;
    const { target, mode } = params();
    const side = document.getElementById("side");
    if (!target || mode !== "color" || !side || document.getElementById("full-spectrum")) return;
    busy = true;
    const d = await load(target);
    busy = false;
    const s2 = document.getElementById("side");
    const now = params();
    if (!d || !s2 || now.target !== target || now.mode !== "color" || document.getElementById("full-spectrum")) return;
    const after = s2.querySelector("#tf-title")?.closest(".side-sec");
    const sec = section(d);
    if (after && after.nextSibling) s2.insertBefore(sec, after.nextSibling); else s2.append(sec);
  }

  new MutationObserver(() => check()).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", check);
  document.addEventListener("DOMContentLoaded", check);
})();
