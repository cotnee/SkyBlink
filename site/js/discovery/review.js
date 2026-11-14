import { CFG } from "./config.js";
import { h, download } from "./util.js";

export const VERDICTS = {
  real: { label: "Real object", icon: "✓" },
  artifact: { label: "Artifact", icon: "✗" },
  found: { label: "I found something", icon: "★" },
};

const CHANGED = "sbd-reviews-changed";

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(CFG.storageKey) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function write(all) {
  try {
    localStorage.setItem(CFG.storageKey, JSON.stringify(all));
  } catch (e) {
    console.warn("[SkyBlink discovery] could not save review", e);
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export const Reviews = {
  all: read,
  get: (id) => read()[id] || null,
  set(id, record) {
    const all = read();
    all[id] = { ...all[id], ...record, id, updated: new Date().toISOString() };
    write(all);
  },
  remove(id) {
    const all = read();
    delete all[id];
    write(all);
  },
  clear() {
    write({});
  },
  list() {
    return Object.values(read()).sort((a, b) => String(a.updated).localeCompare(String(b.updated)));
  },
  onChange(fn) {
    window.addEventListener(CHANGED, fn);
    window.addEventListener("storage", (e) => e.key === CFG.storageKey && fn());
  },
};

const CSV_COLUMNS = ["id", "target", "verdict", "note", "ra", "dec", "demo", "engine_verdict", "updated"];

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportJSON() {
  const payload = { app: "SkyBlink", kind: "candidate-reviews", exported: new Date().toISOString(), reviews: Reviews.list() };
  download(`skyblink-reviews-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
}

export function exportCSV() {
  const rows = [CSV_COLUMNS.join(",")].concat(Reviews.list().map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(",")));
  download(`skyblink-reviews-${new Date().toISOString().slice(0, 10)}.csv`, rows.join("\r\n") + "\r\n", "text/csv");
}

/** Small "your review" chip for cards. Updates live. */
export function reviewChip(id) {
  const chip = h("span", { class: "sbd-chip sbd-review-chip" });
  const render = () => {
    const r = Reviews.get(id);
    chip.hidden = !r;
    if (r) {
      const v = VERDICTS[r.verdict];
      chip.className = `sbd-chip sbd-review-chip sbd-review-${r.verdict}`;
      chip.textContent = `Your review: ${v ? v.label : r.verdict}`;
    }
  };
  render();
  Reviews.onChange(render);
  return chip;
}

/** Review buttons + optional note for one candidate. */
export function mountReviewPanel(container, { candidate, target }) {
  const id = candidate.id;
  const note = h("textarea", { class: "sbd-note", rows: 2, maxlength: 1000, placeholder: "Optional note: what did you see?" });
  const status = h("p", { class: "sbd-review-status", "aria-live": "polite" });
  const buttons = {};

  const save = (verdict) => {
    Reviews.set(id, {
      verdict,
      note: note.value.trim(),
      target,
      ra: candidate.ra,
      dec: candidate.dec,
      demo: !!candidate.demo,
      engine_verdict: candidate.verdict || "",
    });
  };

  for (const [key, v] of Object.entries(VERDICTS)) {
    buttons[key] = h("button", { type: "button", class: `sbd-btn sbd-review-btn sbd-review-btn-${key}`, "aria-pressed": "false", onclick: () => save(key) },
      h("span", { "aria-hidden": "true" }, v.icon), " ", v.label);
  }

  const saveNote = h("button", { type: "button", class: "sbd-btn sbd-btn-ghost", onclick: () => {
    const r = Reviews.get(id);
    if (r) save(r.verdict);
    else status.textContent = "Pick one of the buttons first, then your note is saved with it.";
  } }, "Save note");
  const undo = h("button", { type: "button", class: "sbd-btn sbd-btn-ghost", onclick: () => { Reviews.remove(id); note.value = ""; } }, "Remove my review");

  const render = () => {
    const r = Reviews.get(id);
    for (const [key, b] of Object.entries(buttons)) b.setAttribute("aria-pressed", String(!!r && r.verdict === key));
    undo.hidden = !r;
    if (r) {
      if (document.activeElement !== note) note.value = r.note || "";
      status.textContent = `Saved in this browser: “${VERDICTS[r.verdict]?.label || r.verdict}”${r.note ? " with a note" : ""} (${new Date(r.updated).toLocaleString()}).`;
    } else {
      status.textContent = "Not reviewed yet. Your choice is saved only in this browser.";
    }
  };

  container.replaceChildren(
    h("div", { class: "sbd-review-buttons" }, Object.values(buttons)),
    note,
    h("div", { class: "sbd-review-actions" }, saveNote, undo),
    status,
  );
  render();
  Reviews.onChange(render);
}

/** Count + export JSON/CSV + clear all. */
export function mountReviewToolbar(container) {
  const count = h("span", { class: "sbd-review-count" });
  const jsonBtn = h("button", { type: "button", class: "sbd-btn", onclick: exportJSON }, "Download JSON");
  const csvBtn = h("button", { type: "button", class: "sbd-btn", onclick: exportCSV }, "Download CSV");
  const clearBtn = h("button", { type: "button", class: "sbd-btn sbd-btn-danger", onclick: () => {
    if (confirm("Delete all your candidate reviews saved in this browser?")) Reviews.clear();
  } }, "Clear all");
  const render = () => {
    const n = Reviews.list().length;
    count.textContent = n === 0 ? "No reviews saved yet." : `${n} review${n === 1 ? "" : "s"} saved in this browser.`;
    jsonBtn.disabled = csvBtn.disabled = clearBtn.disabled = n === 0;
  };
  container.replaceChildren(h("div", { class: "sbd-review-toolbar" }, count, jsonBtn, csvBtn, clearBtn));
  render();
  Reviews.onChange(render);
}
