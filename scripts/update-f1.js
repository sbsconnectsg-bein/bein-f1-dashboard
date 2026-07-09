/**
 * Pulls current F1 season data from OpenF1 (api.openf1.org — free, no API
 * key required) and writes data/f1-data.json with three modules:
 *   - next_gp: upcoming meeting + full session schedule
 *   - standings: driver + constructor championship standings
 *   - last_race: podium + fastest lap from the most recently completed race
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://api.openf1.org/v1';
const SEASON = 2026;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// OpenF1's free tier allows 3 requests/second and 30/minute — tight enough
// that firing several requests in parallel (e.g. via Promise.all) reliably
// triggers HTTP 429. getJSON automatically retries on 429 with backoff, and
// callers are expected to await calls sequentially (with a small gap via
// sleep()) rather than run them concurrently.
async function getJSON(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      const waitMs = 1000 * (attempt + 1); // 1s, 2s, 3s backoff
      console.warn(`Rate limited (429) on ${url} — retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`OpenF1 request failed: HTTP ${res.status} for ${url}`);
  }
}

// Team colours as returned by OpenF1 don't always include the '#' prefix.
function normalizeColour(hex) {
  if (!hex) return '#888888';
  return hex.startsWith('#') ? hex : `#${hex}`;
}

// Fallback palette for the 2026 11-team grid, used only when OpenF1 doesn't
// supply a team_colour for a given driver. Sourced from official liveries;
// chosen for visibility against a dark background (e.g. Haas's real-world
// white/black scheme is represented here as white, not black, since black
// would be invisible on our dark theme).
const TEAM_COLOUR_FALLBACK = {
  'McLaren': '#FF8000',
  'Ferrari': '#E80020',
  'Red Bull Racing': '#3671C6',
  'Mercedes': '#00D7B6',
  'Alpine': '#FF87BC',
  'Racing Bulls': '#6C98FF',
  'Haas F1 Team': '#FFFFFF',
  'Williams': '#64C4FF',
  'Audi': '#F50537',
  'Aston Martin': '#229971',
  'Cadillac': '#A9C4D9',
};

function colourForTeam(hex, teamName) {
  if (hex) return normalizeColour(hex);
  return TEAM_COLOUR_FALLBACK[teamName] || '#888888';
}

// OpenF1 gives lap_duration as raw seconds (e.g. 89.708) — format as the
// conventional m:ss.sss lap time (e.g. "1:29.708").
function formatLapTime(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const mins = Math.floor(seconds / 60);
  const secs = (seconds - mins * 60).toFixed(3).padStart(6, '0');
  return `${mins}:${secs}`;
}

async function main() {
  const now = new Date();

  // 1. All meetings (GP weekends) this season, in date order.
  const meetings = await getJSON(`${BASE_URL}/meetings?year=${SEASON}`);
  meetings.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

  // 2. All sessions this season, in date order (used to find both the next
  //    GP's schedule and the most recently completed Race session).
  await sleep(400);
  const sessions = await getJSON(`${BASE_URL}/sessions?year=${SEASON}`);
  sessions.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

  const pastSessions = sessions.filter((s) => new Date(s.date_end) < now);
  const futureSessions = sessions.filter((s) => new Date(s.date_start) >= now);

  // --- Next GP module ---
  let nextGp = null;
  if (futureSessions.length > 0) {
    const nextMeetingKey = futureSessions[0].meeting_key;
    const nextMeeting = meetings.find((m) => m.meeting_key === nextMeetingKey);
    const meetingSessions = sessions
      .filter((s) => s.meeting_key === nextMeetingKey)
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    nextGp = {
      meeting_name: nextMeeting?.meeting_official_name || nextMeeting?.meeting_name || 'TBC',
      circuit: nextMeeting?.circuit_short_name || '',
      country: nextMeeting?.country_name || '',
      sessions: meetingSessions.map((s) => ({
        name: s.session_name,
        start: s.date_start,
      })),
    };
  }

  // --- Standings module ---
  // Championship standings are queried against a specific completed Race
  // session_key on OpenF1 (there's no separate "current standings" endpoint) —
  // so we use the most recent finished race for the latest cumulative totals.
  const lastRaceSession = [...pastSessions]
    .reverse()
    .find((s) => s.session_type === 'Race');

  let driverStandings = [];
  let constructorStandings = [];
  let lastRace = null;

  if (lastRaceSession) {
    const sk = lastRaceSession.session_key;

    // Sequential, spaced calls rather than Promise.all — firing these 4
    // requests simultaneously reliably triggers OpenF1's rate limit.
    const driversMeta = await getJSON(`${BASE_URL}/drivers?session_key=${sk}`);
    await sleep(400);
    const champDrivers = await getJSON(`${BASE_URL}/championship_drivers?session_key=${sk}`);
    await sleep(400);
    const champTeams = await getJSON(`${BASE_URL}/championship_teams?session_key=${sk}`);
    await sleep(400);
    const results = await getJSON(`${BASE_URL}/session_result?session_key=${sk}`);
    await sleep(400);

    const driverByNumber = {};
    driversMeta.forEach((d) => { driverByNumber[d.driver_number] = d; });

    // Fastest lap of the race — a separate call to the laps endpoint, since
    // it isn't part of session_result. Excludes pit-out laps (artificially
    // slow) and anything without a recorded duration.
    let fastestLap = null;
    try {
      const laps = await getJSON(`${BASE_URL}/laps?session_key=${sk}`);
      const validLaps = laps.filter((l) => l.lap_duration && !l.is_pit_out_lap);
      if (validLaps.length > 0) {
        const best = validLaps.reduce((a, b) => (a.lap_duration < b.lap_duration ? a : b));
        const meta = driverByNumber[best.driver_number] || {};
        fastestLap = {
          code: meta.name_acronym || '',
          name: meta.full_name || `#${best.driver_number}`,
          team: meta.team_name || '',
          lapNumber: best.lap_number,
          durationSeconds: best.lap_duration,
          durationFormatted: formatLapTime(best.lap_duration),
        };
      }
    } catch (err) {
      console.warn('Fastest lap lookup failed, continuing without it.', err.message);
    }

    driverStandings = champDrivers
      .sort((a, b) => a.position_current - b.position_current)
      .slice(0, 11)
      .map((c) => {
        const meta = driverByNumber[c.driver_number] || {};
        return {
          position: c.position_current,
          code: meta.name_acronym || '',
          name: meta.full_name || `#${c.driver_number}`,
          team: meta.team_name || '',
          teamColour: colourForTeam(meta.team_colour, meta.team_name),
          points: c.points_current,
        };
      });

    constructorStandings = champTeams
      .sort((a, b) => a.position_current - b.position_current)
      .slice(0, 11)
      .map((c) => ({
        position: c.position_current,
        team: c.team_name,
        points: c.points_current,
        teamColour: TEAM_COLOUR_FALLBACK[c.team_name] || '#888888',
      }));

    const results10 = results
      .filter((r) => r.position && r.position <= 10)
      .sort((a, b) => a.position - b.position)
      .map((r) => {
        const meta = driverByNumber[r.driver_number] || {};
        return {
          position: r.position,
          code: meta.name_acronym || '',
          name: meta.full_name || `#${r.driver_number}`,
          team: meta.team_name || '',
          teamColour: colourForTeam(meta.team_colour, meta.team_name),
          dnf: r.dnf || false,
          fastestLap: !!(fastestLap && fastestLap.code && fastestLap.code === (meta.name_acronym || '')),
        };
      });

    const meetingForRace = meetings.find((m) => m.meeting_key === lastRaceSession.meeting_key);

    lastRace = {
      meeting_name: meetingForRace?.meeting_official_name || meetingForRace?.meeting_name || '',
      date: lastRaceSession.date_start,
      results: results10,
      winning_team: results10.length > 0 ? results10[0].team : '',
      winning_team_colour: results10.length > 0 ? results10[0].teamColour : '#888888',
      fastest_lap: fastestLap,
    };
  }

  const output = {
    updated_at: new Date().toISOString(),
    season: SEASON,
    next_gp: nextGp,
    driver_standings: driverStandings,
    constructor_standings: constructorStandings,
    last_race: lastRace,
  };

  const outPath = path.join(__dirname, '..', 'data', 'f1-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}.`);
  console.log(`Next GP: ${nextGp ? nextGp.meeting_name : 'none found'}`);
  console.log(`Last race: ${lastRace ? lastRace.meeting_name : 'none found'}, results count: ${lastRace ? lastRace.results.length : 0}`);
  console.log(`Driver standings: ${driverStandings.length}, Constructor standings: ${constructorStandings.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
