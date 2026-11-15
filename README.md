# SkyBlink: watch the infrared sky change
 
**NASA Space Apps Challenge 2026 · Challenge: Planet X and SPHEREx**
 
> Existing tools ask people to find what is visible. Our software finds what no single photo can show, checks it, and says what it is.
 
SkyBlink turns NASA's SPHEREx infrared all-sky survey into a website where anyone can see what in the sky **moves, flickers or has a strange colour**. A Python engine does the heavy analysis on real archive data, and people review its candidates in the browser.
 
**Software finds candidates. You decide what's real.**
 
| | |
|---|---|
| 🌐 Website | https://cotnee.github.io/SkyBlink/ |
| 🪞 Mirror | https://skyblink-7gua.onrender.com |
| 📓 Engine | [`pipeline/engine.ipynb`](pipeline/engine.ipynb) (Google Colab) |
 
No login, no install: it works in any modern browser, on a phone too.
 
---
 
## The problem
 
SPHEREx maps the whole sky in **102 infrared colours** (0.75–5 µm) with 6 detectors every six months. It takes about **3,600 images a day**, and new data reach NASA's archive every week. Far more images arrive than anyone can inspect by eye.
 
- **The most interesting objects are too faint** to show up in any single image: cold brown dwarfs, distant slow movers.
- **Each detector sees a shifting colour.** SPHEREx uses linear variable filters, so every exposure of a star is taken at a slightly different wavelength. Naive blinks can fake brightness changes.
- **Today's citizen-science tools** (Backyard Worlds, WiseView) ask people to spot what is already visible by eye. They don't stack hundreds of exposures, check artifacts or measure spectra.
SkyBlink flips the workflow: the software searches, checks and explains first, so people judge a short list of real possibilities.
 
---
 
## The four lenses and what they found
 
All results come from real NASA/IPAC IRSA data. Each one is checked against known values.
 
### 1 · Fast movers: hidden movers
Finds objects too faint to see in any single exposure.
1. Subtract a static-sky template per detector, mask bright stars, normalise noise, clip cosmic rays.
2. **Shift-and-stack:** for every trial velocity on a grid (−0.5 to +0.5 px/day), shift all ~119 exposures along that motion and add them up. Noise grows as √N, a real mover as N.
3. Keep peaks above an empirical threshold (the brightest pure-noise peak).
4. Reject automatically: next to a masked star, at the image edge, missing from either half of the observations, or barely above the threshold.
5. Measure brightness along the track in all 6 detectors and classify the colour (sunlit asteroid vs cold brown dwarf). Check against SkyBoT's known solar-system objects.
**Injection–recovery tests:** finds about **3 in 4** artificial objects about **3× fainter** than the single-image limit. It covers slow, distant movers (up to ~3″/day), not ordinary asteroids. Objects planted for demos are labelled **"artificial test object"** on the site.
 
### 2 · Slow movers: time machine
Blinks AllWISE 2010 images against SPHEREx 2026 in matching bands (W1 ↔ D4, W2 ↔ D6).
 
| Target | Measured motion | Catalogue |
|---|---|---|
| Barnard's Star | 167.4″ | 167.7″ |
| WISE 0855 | 132.8″ | 129.5″ |
| Epsilon Indi B | 75.2″ | 74.4″ |
 
All three agree with catalogue motions within 3%.
 
### 3 · Blinking stars: real brightness changes
Compares whole survey-pass averages per detector with steady comparison stars on the same detector, so SPHEREx's colour-changing filter can't fake variability. **RW Aurigae** varies about **21×** more than steady stars.
 
### 4 · Strange colours: six detectors, blue to red
Stacks every exposure per detector (D1 0.93 µm → D6 4.71 µm) for signal-to-noise, then ranks every source by how much redder it is than a typical star in the field.
- **Epsilon Indi B** is 6× redder than a typical star and the only source with a deep D4 dip (methane, 3.3 µm).
- **RW Aurigae** is red because of warm dust in its disk, not because it is cold. The site explains the difference.
- This lens is marked **Experimental** and shown only where it validated.
### + Full spectrum (~100+ wavelengths)
Every SPHEREx exposure catches a star at a slightly different wavelength, read from the image's spectral WCS (`WCS-WAVE`). Measuring the star in every exposure gives a real spectrum instead of 6 colours.
 
| Target | Points | Methane index (3.2–3.4 µm vs continuum) |
|---|---|---|
| Epsilon Indi B | 326 (+9 outliers) | **0.33**: deep methane dip, a cold brown dwarf |
| RW Aurigae | 222 | 0.9: no methane, red from warm dust |
 
The methane index is our own simple index: the in-band median divided by the mean of the 2.8–3.0 and 3.7–3.9 µm medians. Fluxes are aperture measurements, not PSF-corrected.
 
---
 
## Website features
 
- **Viewer** per target and lens: play, pause and step through frames; speed control; keyboard shortcuts.
- **Layers:** highlights, **difference view** (each frame minus the first), Gaia stars and flagged pixels where data exist.
- **Field of view:** 3′ / 6′ / full crops, plus free zoom in the sky map.
- **Per-frame metadata:** date, telescope, wavelength, detector, and the share of pixels SPHEREx flagged as bad (**contamination flags** from the `FLAGS` layer).
- **Live sky map (Aladin Lite):** WISE, 2MASS or DSS backgrounds, with a **Gaia DR3** overlay.
- **Candidate pages:** significance vs threshold, speed, 6-colour spectrum, picture strips (single exposure / plain stack / stack along the motion).
- **Review panel:** *Real object* / *Artifact* / *I found something*, with notes, saved in the browser and exported as **JSON or CSV**.
- **Search** by star name (CDS Sesame) or coordinates, and **coordinates in the URL** (`search.html?ra=…&dec=…`), so other sites can link to it. Every view has a shareable link (`index.html?target=…&mode=…`).
- Charts have table views for accessibility.
---
 
## How it works
 
```
NASA/IPAC IRSA archive ──► Python engine (Colab) ──► small JSON + PNG files ──► static website ──► people review
 SPHEREx L2 images,          stack, blink, measure,      site/data/<target>/<lens>/   GitHub Pages     real / artifact
 AllWISE, FLAGS, WCS-WAVE    check, reject, explain                                                   export JSON/CSV
```
 
The website reads only precomputed files, so it is fast, free to host and needs no server.
 
## Repository layout
 
```
pipeline/
  engine.ipynb      the analysis engine (Google Colab): all lenses
  extras.py         contamination flags for the Colour lens manifests
site/               the static website (served by GitHub Pages and Render)
  index.html        viewer: home, targets, lenses
  candidate.html    Fast-mover candidate pages
  search.html       search by name or coordinates
  js/app.js         viewer logic
  js/full-spectrum.js   full-spectrum chart in the Colour lens
  js/discovery/     candidate pages, Aladin sky map, reviews
  data/targets.json list of targets and their lenses
  data/<target>/<lens>/  manifest.json + frame PNGs (+ spectrum.json)
tools/              helper scripts
render.yaml         Render static-site config
```
 
## Run it
 
**Website locally:**
```bash
cd site
python3 -m http.server 8000
# open http://localhost:8000
```
 
**Engine:** open `pipeline/engine.ipynb` in Google Colab, set `NAME` in section 1 to a target, and run the cells. Data are cached on Google Drive.
 
## Adding new SPHEREx data
 
SkyBlink is built so new data can be added without touching the website code.
 
1. **New target?** Add one line to `TARGETS` in section 1 of the engine: field centre (RA, Dec), the star's position and proper motion (0 if it doesn't move), and its lenses (`fast`, `slow`, `variable`, `color`).
2. **New data release?** The engine finds every SPHEREx exposure of a field through IRSA (TAP, or SIA with collection `spherex_dr1`). When a new release appears, change the collection name (e.g. `spherex_dr2`) and re-run.
3. **Run** the engine. Results are written to `spherex_site/data/<target>/<lens>/` on Google Drive.
4. **Publish:** copy that folder into `site/data/<target>/` and add the target to `site/data/targets.json`. GitHub Pages redeploys in about a minute, and the site shows the new lens buttons on its own.
## Honesty and limitations
 
- **Nothing is called a discovery.** Planted demo objects are labelled "artificial test object". The real candidate `wise0855_cand_3` (significance 7.9) is marginal and is shown only as a candidate.
- Results are **precomputed** by the engine; the browser does not query the archive live, and spectra come from the engine, not the browser.
- 4 targets are published: Barnard's Star, WISE 0855, Epsilon Indi B, RW Aurigae. The Colour lens is Experimental.
- Spectra are aperture fluxes: their shape is reliable, absolute brightness is approximate.
- During the hackathon IRSA's TAP service was often down (HTTP 502/503). The engine retries and can fall back to IRSA's SIA service.
## Data and tools
 
**NASA data**
- [SPHEREx spectral images: NASA/IPAC IRSA](https://irsa.ipac.caltech.edu/Missions/spherex.html) ([data products and cutouts](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products))
- [AllWISE images: NASA/IPAC IRSA](https://irsa.ipac.caltech.edu/Missions/wise.html)
- Site background: JWST "Cosmic Cliffs" (NASA, ESA, CSA, STScI)
**Other data and tools**
- [ESA Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3) · [CDS Aladin Lite](https://aladin.cds.unistra.fr/AladinLite/) · [CDS Sesame](https://cds.unistra.fr/cgi-bin/Sesame) · [IMCCE SkyBoT](https://ssp.imcce.fr/webservices/skybot/)
- [Astropy](https://www.astropy.org) · [astroquery](https://astroquery.readthedocs.io) · [reproject](https://reproject.readthedocs.io) · NumPy · SciPy · Matplotlib · Google Colab
## AI use
 
Code written with help from Claude (Anthropic). The analysis and website code and drafts of the project text were written with AI assistance. All data are real NASA observations; no images or results were generated by AI. The team designed the approach, ran the pipeline, checked results against catalogue values and edited all text.
 
## Team
 
High-school team from Tbilisi, Georgia: Elene Kurdadze · Tsotne Mandaria · Aleksandre Peikrishvili · Anastasia Kupatadze · Natia Kitiashvili · Guja Tvalabeishvili.
 
## Credits
 
NASA/IPAC IRSA (SPHEREx, WISE) · ESA Gaia DR3 · CDS Aladin Lite
 
