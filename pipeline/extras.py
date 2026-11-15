import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "-q", "install", "astroquery", "reproject"])
import os, io, csv, json, time, warnings, logging
import numpy as np, requests
import astropy.units as u
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
from reproject import reproject_interp
logging.getLogger("astropy").setLevel(logging.ERROR)
warnings.simplefilter("ignore")

EX = "/content/extras"
N, PIX = 60, 6.15
FIELDS = {"epsindib": (331.096, -56.801), "rwaur": (76.956, 30.401)}
RAW = "https://raw.githubusercontent.com/cotnee/SkyBlink/main/site/data"

def grid(ra, dec):
    w = WCS(naxis=2); s = PIX / 3600
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]; w.wcs.crval = [ra, dec]
    w.wcs.crpix = [N / 2 + 0.5, N / 2 + 0.5]; w.wcs.cdelt = [-s, s]
    return w

def get(url, tries=5, **kw):
    for a in range(tries):
        try:
            r = requests.get(url, timeout=120, **kw); r.raise_for_status(); return r
        except Exception as e:
            print("  busy:", str(e)[:60]); time.sleep(10 * (a + 1))
    return None

def sia(ra, dec):
    r = get("https://irsa.ipac.caltech.edu/SIA", params=dict(COLLECTION="spherex_dr1",
            POS=f"circle {ra} {dec} 0.0005", RESPONSEFORMAT="CSV"))
    if r is None: return []
    return [x for x in csv.DictReader(io.StringIO(r.text))
            if x.get("dataproduct_subtype") == "science" and "spx_l2b" in str(x.get("access_url"))]

for name, (ra, dec) in FIELDS.items():
    print(f"===== {name}")
    man = json.loads(get(f"{RAW}/{name}/color/manifest.json").text)
    w = grid(ra, dec)

    # ---- 1. Gaia DR3 stars, moved to the SPHEREx epoch, in PNG pixels (y from the top)
    def gaia_query():
        q = (f"SELECT ra, dec, pmra, pmdec, phot_g_mean_mag FROM gaiadr3.gaia_source WHERE 1=CONTAINS("
             f"POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, 0.08)) AND phot_g_mean_mag < 19")
        r = get("https://gea.esac.esa.int/tap-server/tap/sync", params=dict(REQUEST="doQuery", LANG="ADQL", FORMAT="csv", QUERY=q))
        if r is not None and r.text.startswith("ra"):
            return [(float(x["ra"]), float(x["dec"]), float(x["pmra"] or 0), float(x["pmdec"] or 0), float(x["phot_g_mean_mag"]))
                    for x in csv.DictReader(io.StringIO(r.text))]
        q = (f'SELECT RA_ICRS, DE_ICRS, pmRA, pmDE, Gmag FROM "I/355/gaiadr3" WHERE 1=CONTAINS('
             f"POINT('ICRS', RA_ICRS, DE_ICRS), CIRCLE('ICRS', {ra}, {dec}, 0.08)) AND Gmag < 19")
        r = get("https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync", params=dict(REQUEST="doQuery", LANG="ADQL", FORMAT="csv", QUERY=q))
        return [(float(x["RA_ICRS"]), float(x["DE_ICRS"]), float(x["pmRA"] or 0), float(x["pmDE"] or 0), float(x["Gmag"]))
                for x in csv.DictReader(io.StringIO(r.text))]
    try:
        g = np.array(gaia_query(), float)
        dt = 2026.0 - 2016.0
        de2 = g[:, 1] + g[:, 3] * dt / 3.6e6
        ra2 = g[:, 0] + g[:, 2] * dt / 3.6e6 / np.cos(np.radians(de2))
        x, y = w.world_to_pixel_values(ra2, de2)
        ok = (x > -0.5) & (x < N - 0.5) & (y > -0.5) & (y < N - 0.5)
        man["gaia"] = [dict(x=round(float(a), 2), y=round(float(N - 1 - b), 2), g=round(float(m), 2))
                       for a, b, m in zip(x[ok], y[ok], g[ok, 4])]
        print(f"  Gaia DR3 stars in the image: {len(man['gaia'])}")
    except Exception as e:
        print("  Gaia failed:", str(e)[:100])

    # ---- 2. SPHEREx contamination flags per detector stack
    rows = sia(ra, dec)
    print(f"  SPHEREx exposures: {len(rows)}")
    bits_shown = False
    for fr in man["frames"]:
        det = "SPHEREx-D" + str(fr["label"]).split("detector D")[1][0]
        sel = [r for r in rows if r["energy_bandpassname"] == det]
        sel = sel[:: max(1, len(sel) // 6)][:6]          # sample 6 exposures spread over time
        masks = []
        for r in sel:
            rr = get(r["access_url"].split("?")[0] + f"?center={ra},{dec}d&size=0.12")
            if rr is None: continue
            with fits.open(io.BytesIO(rr.content)) as h:
                fl = h["FLAGS"].data.astype(np.int64); hd = h["FLAGS"].header
                ww = WCS(h["IMAGE"].header)
            names = {hd[k]: int(hd["MSKM" + k[4:]]) for k in hd if k.startswith("MSKN")}
            if not bits_shown:
                print("  flag names:", list(names)); bits_shown = True
            BAD = ["TRANSIENT", "OVERFLOW", "SUR_ERROR", "NONFUNC", "MISSING_DATA", "HOT", "COLD",
                   "NONLINEAR", "PERSIST", "OUTLIER"]          # detector problems, not sky features
            bad_value = sum(names[n] for n in BAD if n in names)
            badmask = (fl & bad_value) != 0
            m, _ = reproject_interp((badmask.astype(float), ww.celestial), w, shape_out=(N, N), order="nearest-neighbor")
            masks.append(np.nan_to_num(m, nan=0) > 0.5)
        if masks:
            flagged = np.mean(masks, axis=0) > 0.5
            fr["flagged_fraction"] = round(float(flagged.mean()), 4)
        print(f"  {det}: sampled {len(masks)} exposures, flagged_fraction = {fr.get('flagged_fraction')}")

    d = f"{EX}/data/{name}/color"; os.makedirs(d, exist_ok=True)
    json.dump(man, open(f"{d}/manifest.json", "w"), indent=1, ensure_ascii=False)
    print("  saved", f"{d}/manifest.json")
print("DONE EXTRAS")
