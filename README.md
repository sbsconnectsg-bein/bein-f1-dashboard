# beIN SPORTS — F1 2026 Dashboard for Yodeck

Same proven pattern as the World Cup bracket: a free GitHub Actions job pulls
live F1 data from Jolpica F1 (no API key needed), writes a small JSON file, and
GitHub Pages serves a self-updating dashboard that Yodeck displays.

## 1. Create the GitHub repository

1. https://github.com/new → name it (e.g. `bein-f1-dashboard`) → **Public**
2. Upload every file in this folder, keeping the structure:
   ```
   index.html
   style.css
   script.js
   data/f1-data.json
   scripts/update-f1.js
   .github/workflows/update-f1.yml
   README.md
   ```

## 2. No API key needed

Jolpica F1 is fully open — no signup, no token, no secret to configure. This is
simpler than the World Cup project in that one respect.

## 3. Turn on GitHub Pages

**Settings → Pages** → Source: "Deploy from a branch" → Branch: `main`,
folder `/ (root)` → Save. You'll get a URL like
`https://YOUR-USERNAME.github.io/bein-f1-dashboard/`.

## 4. Test the workflow

**Actions tab → Update F1 Dashboard → Run workflow.** Check the log —
it should print the next GP name, last race name, and standings counts. If
anything comes back empty, the log message will say which part failed.

**Important:** I could not test `scripts/update-f1.js` against the live
Jolpica F1 API myself (it's outside my sandbox's network access), so this first
real run is genuinely the first live test. Watch the log closely — if
something's off, send me the log output the same way we debugged the World
Cup project and I'll fix it.

## 5. Add to Yodeck

Same as before: **Media → Add Media → Web Pages**, paste your Pages URL,
enable "Refresh web page" with a 15–60 min interval (F1 data barely changes
between sessions, so this doesn't need to be as frequent as the World Cup's
5-minute cycle), keep Chromium enabled, set Screen Orientation to match your
panel's physical mounting if portrait.

## Update frequency

The workflow runs every 4 hours by default (`0 */4 * * *` in
`.github/workflows/update-f1.yml`) — deliberately relaxed, since standings
and schedules don't change between race weekends. During an actual race
weekend, either:
- Manually click **Run workflow** whenever you want a fresh pull, or
- Temporarily edit the cron to `*/15 * * * *` for the weekend, then change
  it back afterward

## Data modules

- **Next Grand Prix** — meeting name, circuit, and full session schedule
  (practice/quali/race) in SGT
- **Championship** — top 8 drivers and constructors by points
- **Last Race** — podium (top 3) from the most recently completed race

## Known limitations / things not yet built

- (Resolved) Fastest lap is now included — Jolpica includes `FastestLap.rank`
  directly on each race result, simpler than the original OpenF1 approach
- No sprint race handling beyond showing it as a regular session row
- Team colours are always our own hardcoded palette — Jolpica (unlike OpenF1)
  doesn't provide team colours at all


## Data source history

This project originally used OpenF1. In mid-2026, OpenF1 began requiring a
paid OAuth2 subscription for current-season data (their docs now distinguish
free "historical" data from paid "real-time" data, and apparently classify
an in-progress season as the latter). Switched to Jolpica F1
(api.jolpi.ca) instead — free, no auth, Ergast-compatible. The output JSON
shape in `data/f1-data.json` is unchanged, so `index.html`/`script.js`/
`style.css` didn't need any changes for this switch — only
`scripts/update-f1.js` was rebuilt.
