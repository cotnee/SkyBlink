// Single place to change URL parameter names, data paths and page names.
// Any page can also override values before loading the modules with:
//   <script>window.SKYBLINK_DISCOVERY_CONFIG = { dataBase: "data/", params: { target: "t" } };</script>

const DEFAULTS = {
  // All paths are relative to the HTML page, so the site works under a GitHub Pages subpath.
  dataBase: "data/",
  targetsFile: "targets.json",
  fastDir: "fast/",
  slowDir: "slow/",
  candidatesFile: "candidates.json",
  manifestFile: "manifest.json",
  // candidates.json "image"/"animation" are bare file names in the folder holding candidates.json.
  // Set a different folder (e.g. "fast/media/") only if that ever changes; null = same as fastDir.
  fastMediaDir: null,

  params: { target: "target", id: "id", ra: "ra", dec: "dec", fromRa: "from_ra", fromDec: "from_dec", name: "name" },

  pages: {
    home: "index.html",
    // "Open target page" URL. {id} = target id, {mode} = its first mode (or "slow").
    // On C's site use "index.html?target={id}&mode={mode}" (keep &mode so C's router doesn't rewrite the URL).
    targetTemplate: "index.html?target={id}&mode={mode}",
    fast: "fast.html",
    candidate: "candidate.html",
    // Shown when the coordinates aren't near any processed field.
    search: "search.html",
  },

  search: {
    matchRadiusArcmin: 3,
    notProcessedFovDeg: 0.2,
    nearestCount: 5,
    colabUrl: "https://colab.research.google.com/github/cotnee/SkyBlink/blob/main/pipeline/engine.ipynb",
    example: "269.448 4.770",
    // Object names (M31, Vega, Proxima Centauri...) are looked up like IRSA does: CDS Sesame,
    // which asks SIMBAD, NED and VizieR. Tried in order; mirrors answer when the main site is down.
    resolvers: [
      "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?",
      "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/SNV?",
    ],
    resolveTimeoutMs: 8000,
  },

  defaultSlowYears: 16,
  pixelScaleArcsec: 6.15,
  gridSize: 60,
  // Fast movers slower than this get a "barely moves" warning in the checks.
  minFastSpeedArcsecDay: 0.2,
  // Halves check: the weaker half should hold at least this fraction of sig/sqrt(2).
  halvesMinFraction: 0.5,

  storageKey: "skyblink.discovery.reviews.v1",

  aladin: {
    // Tried in order; the first that loads wins. "module: true" = ES module whose default export is A.
    scripts: [
      { src: "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js" },
      { src: "https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js", module: true },
    ],
    timeoutMs: 15000,
    defaultFovDeg: 0.25,
    fovChoicesArcmin: [2, 5, 10, 15, 30, 60, 120],
    // Each survey lists HiPS mirrors; the first one that answers is used, else Aladin resolves `id` itself.
    baseSurveys: [
      { key: "wise", id: "CDS/P/allWISE/color", label: "WISE (AllWISE colour)", mirrors: [
        "https://alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1",
        "https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1",
        "https://skies.esac.esa.int/AllWISEColor"] },
      { key: "2mass", id: "CDS/P/2MASS/color", label: "2MASS colour", mirrors: [
        "https://alasky.cds.unistra.fr/2MASS/Color",
        "https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color"] },
      { key: "dss", id: "CDS/P/DSS2/color", label: "DSS2 colour (visible light)", mirrors: [
        "https://alasky.cds.unistra.fr/DSS/DSSColor",
        "https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color",
        "https://skies.esac.esa.int/DSSColor"] },
    ],
    wiseOverlay: "wise",
    hipsProbeTimeoutMs: 6000,
    gaiaCatalog: "I/355/gaiadr3",
    // "aladin" = A.catalogFromVizieR (Aladin's own VizieR host); URLs = VizieR mirrors queried via A.catalogFromURL.
    vizierMirrors: ["aladin", "https://vizier.cfa.harvard.edu"],
    gaiaMaxRadiusDeg: 0.5,
    // Brightest N stars (sorted by G magnitude) so dense fields stay readable.
    gaiaLimit: 800,
    // Give up on a VizieR source after this long and try the next one.
    gaiaTimeoutMs: 15000,
  },
};

function merge(base, extra) {
  if (!extra || typeof extra !== "object") return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object"
      ? merge(base[k], v)
      : v;
  }
  return out;
}

export const CFG = merge(DEFAULTS, typeof window !== "undefined" ? window.SKYBLINK_DISCOVERY_CONFIG : null);
