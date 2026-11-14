import { h, isNum } from "./util.js";

/**
 * Image with markers placed in the image's own pixel coordinates (origin top-left).
 * Scale = displayed width / naturalWidth, so it works for any frame size or display size.
 * markers: [{ x, y, label, kind: "highlight" | "gaia" }]
 */
export function markedImage(src, alt, markers = []) {
  const wrap = h("div", { class: "sbd-marked" });
  const img = h("img", { src, alt, class: "sbd-data-img" });
  const layer = h("div", { class: "sbd-marked-layer", "aria-hidden": "true" });
  const pts = markers.filter((m) => m && isNum(m.x) && isNum(m.y));
  const dots = pts.map((m) => h("span", { class: `sbd-marker sbd-marker-${m.kind || "highlight"}`, title: m.label || m.id || "" },
    m.kind === "gaia" ? null : h("span", { class: "sbd-marker-label" }, m.label || "")));
  layer.append(...dots);

  const place = () => {
    if (!img.naturalWidth || !img.clientWidth) return;
    const sx = img.clientWidth / img.naturalWidth;
    const sy = img.clientHeight / img.naturalHeight;
    pts.forEach((m, i) => {
      dots[i].style.left = `${m.x * sx}px`;
      dots[i].style.top = `${m.y * sy}px`;
    });
  };
  img.addEventListener("load", place);
  img.addEventListener("error", () => wrap.replaceChildren(h("div", { class: "sbd-img-missing" }, h("span", {}, `Image not available yet (${String(src).split("/").pop()})`))), { once: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(place).observe(img);
  else window.addEventListener("resize", place);

  wrap.append(img, layer);
  return wrap;
}
