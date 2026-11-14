import { CFG } from "./config.js";
import { isNum, fmt } from "./util.js";

/**
 * Plain-English explanation of the engine's automatic checks for one candidate.
 * Returns [{ key, status: "pass"|"fail"|"warn"|"info", title, text }].
 * The engine's verdict is authoritative; these re-derive the reasoning so people can follow it.
 */
export function explainChecks(c, field = {}) {
  const out = [];
  const thr = field.threshold;
  const nExp = field.exposures;

  if (isNum(c.sig) && isNum(thr)) {
    const pass = c.sig >= thr;
    out.push({
      key: "threshold", status: pass ? "pass" : "fail",
      title: `Strength: ${fmt(c.sig)} vs threshold ${fmt(thr)}`,
      text: pass
        ? `After lining up ${nExp ? `all ${nExp}` : "all the"} exposures along the object's path, its signal is ${fmt(c.sig)} times bigger than the random noise. We only trust signals above ${fmt(thr)}, a level that pure noise almost never reaches, so this is not just a lucky noise bump.`
        : `The stacked signal (${fmt(c.sig)}) is below our safety threshold of ${fmt(thr)}. Random noise can reach this level, so we can't trust it on its own.`,
    });
  } else {
    out.push({ key: "threshold", status: "info", title: "Strength", text: "The significance or threshold is missing from the data file." });
  }

  if (Array.isArray(c.halves) && c.halves.length >= 2 && c.halves.every(isNum)) {
    const [a, b] = c.halves;
    const expected = isNum(c.sig) ? c.sig / Math.SQRT2 : null;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const floor = expected ? expected * CFG.halvesMinFraction : 0;
    const pass = expected ? lo >= floor : hi > 0 && lo / hi >= CFG.halvesMinFraction;
    out.push({
      key: "halves", status: pass ? "pass" : "fail",
      title: `Two halves: ${fmt(a)} and ${fmt(b)}${expected ? ` (expected about ${fmt(expected)} each)` : ""}`,
      text: pass
        ? "We split the pictures into two groups by time and searched each group separately. A real moving object shows up in both halves with similar strength, and it does here. Camera glitches and cosmic-ray hits usually appear in only one half."
        : `We split the pictures into two groups by time and searched each separately. A real object should appear in both with similar strength, but here one half is much weaker (${fmt(lo)} vs ${fmt(hi)}). That usually means a glitch or leftover light from a bright star, not a moving object.`,
    });
  }

  if (isNum(c.speed_arcsec_day)) {
    const slow = c.speed_arcsec_day < CFG.minFastSpeedArcsecDay;
    out.push({
      key: "motion", status: slow ? "warn" : "info",
      title: `Motion: ${fmt(c.speed_arcsec_day, 2)} arcsec per day`,
      text: slow
        ? "It barely moves. Real fast movers (asteroids, nearby worlds) drift noticeably over the weeks of observations; something that stays put is usually a leftover from a star."
        : `It drifts about ${fmt(c.speed_arcsec_day, 2)} arcseconds every day, roughly ${fmt(c.speed_arcsec_day / CFG.pixelScaleArcsec, 2)} SPHEREx pixels per day. That is the kind of steady motion a real object in our Solar System would show.`,
    });
  }

  const reasons = Array.isArray(c.reasons) ? c.reasons.filter(Boolean) : [];
  out.push({
    key: "reasons", status: reasons.length ? "fail" : "pass",
    title: reasons.length ? `Engine found ${reasons.length} problem${reasons.length > 1 ? "s" : ""}` : "Engine found no problems",
    text: reasons.length ? reasons.map((r) => `• ${r}`).join("\n") : "None of the engine's automatic warning checks were triggered.",
  });

  const rejected = c.verdict === "rejected";
  out.push({
    key: "verdict", status: rejected ? "fail" : c.verdict === "candidate" ? "pass" : "info",
    title: `Verdict: ${rejected ? "Rejected" : c.verdict === "candidate" ? "Candidate" : c.verdict || "unknown"}`,
    text: (rejected
      ? "The engine decided this is not a real moving object, for the reasons above."
      : c.verdict === "candidate"
        ? "It passed the automatic checks, so it is worth a human look. Use the buttons to say what you think."
        : "The engine did not give a clear verdict.")
      + (c.demo ? " Note: this is an artificial test object that we injected into the real data on purpose to prove the search works." : ""),
  });

  return out;
}
