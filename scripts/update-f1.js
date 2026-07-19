/**
 * Pulls current F1 season data from Jolpica F1 (api.jolpi.ca — free,
 * no API key required, Ergast-compatible) and writes data/f1-data.json.
 *
 * Switched from OpenF1 after OpenF1 began requiring a paid OAuth2
 * subscription for current-season ("real-time") data in mid-2026 — this
 * script's output JSON shape is unchanged, so script.js/style.css/index.html
 * did not need any changes for this switch.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://api.jolpi.ca/ergast/f1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Jolpica's unauthenticated rate limit is a generous 4 req/s / 500 per hour
// — our whole pipeline is only ~4 calls, so this spacing is a defensive
// habit rather than a strict necessity, consistent with how we've handled
// every other API in this project after hitting real rate-limit issues
// with a couple of them.
async function getJSON(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      const waitMs = 1000 * (attempt + 1);
      console.warn(`Rate limited (429) on ${url} — retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`Jolpica request failed: HTTP ${res.status} for ${url}`);
  }
}

// Jolpica doesn't provide team colours — kept as our own fallback map,
// same palette used throughout this project.
const TEAM_COLOUR_FALLBACK = {
  'McLaren': '#FF8000',
  'Ferrari': '#E80020',
  'Red Bull': '#3671C6',
  'Red Bull Racing': '#3671C6',
  'Mercedes': '#00D7B6',
  'Alpine': '#FF87BC',
  'Alpine F1 Team': '#FF87BC',
  'RB F1 Team': '#6C98FF',
  'Racing Bulls': '#6C98FF',
  'Haas F1 Team': '#FFFFFF',
  'Haas': '#FFFFFF',
  'Williams': '#64C4FF',
  'Audi': '#F50537',
  'Sauber': '#F50537',
  'Kick Sauber': '#F50537',
  'Aston Martin': '#229971',
  'Cadillac': '#A9C4D9',
};
function colourForTeam(teamName) {
  return TEAM_COLOUR_FALLBACK[teamName] || '#888888';
}

function formatLapTime(timeStr) {
  // Jolpica already gives lap times pre-formatted as "1:29.708" — no
  // conversion needed, unlike OpenF1 which gave raw seconds.
  return timeStr || '';
}

async function fetchNextGp() {
  const json = await getJSON(`${BASE_URL}/current/next/races/`);
  const race = json?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  const sessions = [];
  if (race.FirstPractice) sessions.push({ name: 'Practice 1', start: `${race.FirstPractice.date}T${race.FirstPractice.time}` });
  if (race.SecondPractice) sessions.push({ name: 'Practice 2', start: `${race.SecondPractice.date}T${race.SecondPractice.time}` });
  if (race.ThirdPractice) sessions.push({ name: 'Practice 3', start: `${race.ThirdPractice.date}T${race.ThirdPractice.time}` });
  if (race.SprintQualifying || race.SprintShootout) {
    const sq = race.SprintQualifying || race.SprintShootout;
    sessions.push({ name: 'Sprint Qualifying', start: `${sq.date}T${sq.time}` });
  }
  if (race.Sprint) sessions.push({ name: 'Sprint', start: `${race.Sprint.date}T${race.Sprint.time}` });
  if (race.Qualifying) sessions.push({ name: 'Qualifying', start: `${race.Qualifying.date}T${race.Qualifying.time}` });
  sessions.push({ name: 'Race', start: `${race.date}T${race.time || '00:00:00Z'}` });

  return {
    meeting_name: race.raceName,
    circuit: race.Circuit?.circuitName || '',
    country: race.Circuit?.Location?.country || '',
    sessions,
  };
}

async function fetchStandings() {
  const [driverJson, teamJson] = await Promise.all([
    (async () => { await sleep(300); return getJSON(`${BASE_URL}/current/driverstandings/`); })(),
    (async () => { await sleep(600); return getJSON(`${BASE_URL}/current/constructorstandings/`); })(),
  ]);

  const driverList = driverJson?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  const driverStandings = driverList.map((d) => {
    const team = d.Constructors?.[d.Constructors.length - 1]?.name || '';
    return {
      position: Number(d.position),
      code: d.Driver?.code || '',
      name: `${d.Driver?.givenName || ''} ${d.Driver?.familyName || ''}`.trim(),
      team,
      teamColour: colourForTeam(team),
      points: Number(d.points),
    };
  });

  const teamList = teamJson?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
  const constructorStandings = teamList.map((c) => ({
    position: Number(c.position),
    team: c.Constructor?.name || '',
    points: Number(c.points),
    teamColour: colourForTeam(c.Constructor?.name || ''),
  }));

  return { driverStandings, constructorStandings };
}

async function fetchLastRace() {
  await sleep(900);
  const json = await getJSON(`${BASE_URL}/current/last/results/`);
  const race = json?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  const results = (race.Results || []).slice(0, 10).map((r) => {
    const team = r.Constructor?.name || '';
    return {
      position: Number(r.position),
      code: r.Driver?.code || '',
      name: `${r.Driver?.givenName || ''} ${r.Driver?.familyName || ''}`.trim(),
      team,
      teamColour: colourForTeam(team),
      dnf: !(r.status === 'Finished' || /^\+\d+ Lap/.test(r.status || '')),
      fastestLap: r.FastestLap?.rank === '1',
    };
  });

  const flResult = (race.Results || []).find((r) => r.FastestLap?.rank === '1');
  const fastestLap = flResult ? {
    code: flResult.Driver?.code || '',
    name: `${flResult.Driver?.givenName || ''} ${flResult.Driver?.familyName || ''}`.trim(),
    team: flResult.Constructor?.name || '',
    lapNumber: Number(flResult.FastestLap.lap),
    durationFormatted: formatLapTime(flResult.FastestLap.Time?.time),
  } : null;

  const winner = (race.Results || []).find((r) => r.position === '1');
  const winningTeam = winner?.Constructor?.name || '';

  return {
    meeting_name: race.raceName,
    date: `${race.date}T${race.time || '00:00:00Z'}`,
    results,
    winning_team: winningTeam,
    winning_team_colour: colourForTeam(winningTeam),
    fastest_lap: fastestLap,
  };
}

async function main() {
  const nextGp = await fetchNextGp();
  const { driverStandings, constructorStandings } = await fetchStandings();
  const lastRace = await fetchLastRace();

  const output = {
    updated_at: new Date().toISOString(),
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
