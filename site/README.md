## Adding new SPHEREx data (new releases or new targets)

SkyBlink is built so new data can be added without touching the website code.

1. **Open the engine** `pipeline/engine.ipynb` in Google Colab.
2. **New target?** Add one line to `TARGETS` in section 1: field centre (RA, Dec), the star's position and proper motion (use 0 if it doesn't move), and which lenses it should have (`fast`, `slow`, `variable`, `color`).
3. **New data release?** The engine finds every SPHEREx exposure covering the field through NASA/IPAC IRSA (TAP, or the SIA service with collection `spherex_dr1`). When IRSA publishes a new release, change the collection name to the new one (e.g. `spherex_dr2`) and re-run. New exposures are picked up automatically.
4. **Run it** (Runtime → Run all). Results are written as small PNG + JSON files to `spherex_site/data/<target>/<lens>/` on Google Drive.
5. **Publish:** copy that folder into `site/data/<target>/` in this repo and add the target to `site/data/targets.json`. GitHub Pages redeploys in about a minute, and the site shows the new lens buttons on its own.

The full-spectrum cell works the same way: add a target to its list, run it, and upload `spectrum.json` to `site/data/<target>/color/`.
