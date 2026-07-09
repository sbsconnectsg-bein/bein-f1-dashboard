const DATA_URL = 'data/f1-data.json';

function formatSGT(iso, opts = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    weekday: opts.weekday ? 'long' : undefined,
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d) + ' SGT';
}

function updateClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  el.textContent = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()) + ' SGT';
}

// Results lead the page — the race/circuit name is the section's own
// headline (not just a caption), since that's the "what just happened"
// hook viewers land on first.
function renderLastRaceResults(lastRace) {
  const el = document.getElementById('last-race-section');
  if (!el) return;
  if (!lastRace) {
    el.innerHTML = `<div class="panel-title">Latest Race Results</div><div class="empty-note">No completed race yet.</div>`;
    return;
  }
  const results = lastRace.results || [];
  const half = Math.ceil(results.length / 2);
  const colA = results.slice(0, half);
  const colB = results.slice(half);

  const row = (r) => `
    <div class="result-row ${r.position === 1 ? 'p1' : ''}">
      <span class="rpos">${r.position}</span>
      <span class="rswatch" style="background:${r.teamColour}"></span>
      <span class="rname">${r.name}</span>
      <span class="rteam">${r.team}</span>
      ${r.fastestLap ? '<span class="rfl">FL</span>' : ''}
      ${r.dnf ? '<span class="rdnf">DNF</span>' : ''}
    </div>`;

  const fl = lastRace.fastest_lap;
  const flBanner = fl ? `
    <div class="fastest-lap-banner">
      ⚡ Fastest Lap: <span class="fl-name">${fl.name}</span> <span class="fl-time">${fl.durationFormatted}</span>
    </div>` : '';

  el.innerHTML = `
    <div class="race-headline">
      <div class="panel-title">Latest Race Results</div>
      <div class="race-name">${lastRace.meeting_name}</div>
      <div class="race-date">${formatSGT(lastRace.date)}</div>
    </div>
    <div class="result-banners">
      <div class="winner-banner" style="border-color:${lastRace.winning_team_colour}">
        🏆 <span class="wb-team">${lastRace.winning_team}</span> wins
      </div>
      ${flBanner}
    </div>
    <div class="results-grid">
      <div class="results-col">${colA.map(row).join('')}</div>
      <div class="results-col">${colB.map(row).join('')}</div>
    </div>
  `;
}

// The next race is still promoted (bold banner, big date), just positioned
// below the results now rather than above them.
function renderNextGpHero(gp) {
  const el = document.getElementById('next-gp-hero');
  if (!el) return;
  if (!gp) {
    el.innerHTML = `<div class="hero-empty">No upcoming race found.</div>`;
    return;
  }
  const raceSession = (gp.sessions || []).find((s) => /^race$/i.test(s.name));
  const otherSessions = (gp.sessions || []).filter((s) => !/^race$/i.test(s.name));

  const chips = otherSessions.map((s) => `
    <div class="session-chip">
      <span class="sc-name">${s.name}</span>
      <span class="sc-time">${formatSGT(s.start)}</span>
    </div>`).join('');

  el.innerHTML = `
    <div class="hero-label">Next Grand Prix</div>
    <div class="hero-main">
      <div class="hero-gp-info">
        <div class="hero-gp-name">${gp.meeting_name}</div>
        <div class="hero-gp-location">${gp.circuit}${gp.country ? ', ' + gp.country : ''}</div>
      </div>
      <div class="hero-race-time">
        <div class="hrt-label">Race</div>
        <div class="hrt-date">${raceSession ? formatSGT(raceSession.start, { weekday: true }) : 'TBC'}</div>
      </div>
    </div>
    <div class="session-chips">${chips}</div>
  `;
}

function renderStandings(drivers, teams, asOfRace) {
  const el = document.getElementById('standings-section');
  if (!el) return;
  const driverRows = (drivers || []).slice(0, 11).map((d) => `
    <div class="standing-row">
      <span class="pos">${d.position}</span>
      <span class="swatch" style="background:${d.teamColour}"></span>
      <span class="sname">${d.code || d.name} <span class="steam">${d.team}</span></span>
      <span class="spts">${d.points}</span>
    </div>`).join('');
  const teamRows = (teams || []).slice(0, 11).map((t) => `
    <div class="standing-row">
      <span class="pos">${t.position}</span>
      <span class="swatch" style="background:${t.teamColour || '#888888'}"></span>
      <span class="sname">${t.team}</span>
      <span class="spts">${t.points}</span>
    </div>`).join('');
  const asOfLine = asOfRace
    ? `<div class="standings-as-of">As of ${asOfRace.meeting_name} &middot; ${formatSGT(asOfRace.date)}</div>`
    : '';
  el.innerHTML = `
    <div class="panel-title">Championship Standings</div>
    ${asOfLine}
    <div class="standings-columns">
      <div class="standings-block">
        <div class="standings-subtitle">Drivers</div>
        ${driverRows || '<div class="empty-note">No standings yet.</div>'}
      </div>
      <div class="standings-block">
        <div class="standings-subtitle">Constructors</div>
        ${teamRows}
      </div>
    </div>
  `;
}

async function loadDashboard() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderLastRaceResults(data.last_race);
    renderStandings(data.driver_standings, data.constructor_standings, data.last_race);
    renderNextGpHero(data.next_gp);

    const updatedEl = document.getElementById('updated-at');
    if (updatedEl && data.updated_at) {
      updatedEl.innerHTML = `<span class="dot"></span>Updated ${formatSGT(data.updated_at)}`;
    }
  } catch (err) {
    console.error('Failed to load F1 data:', err);
  }
}

updateClock();
setInterval(updateClock, 30 * 1000);
loadDashboard();
setInterval(loadDashboard, 5 * 60 * 1000);
