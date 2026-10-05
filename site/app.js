/* Race to Dutch First: loads data/race.json and draws the page.
 *
 * Everything is built with createElement / textContent: no innerHTML, so text
 * from Raider.IO can never become markup. Charts are inline SVG drawn here at
 * the container's real width and redrawn when it changes. No libraries.
 * Guild colours come from race.json (guilds.toml) and are checked to be #rrggbb
 * before they reach an attribute. UI text comes from i18n.js (Dutch by default,
 * English on request); game names are never translated.
 */
'use strict';

const DATA_URL = 'data/race.json';
const SITE_URL = 'https://racetodutchfirst.bmiest.be/';
const SEASON_FILE = /^data\/[a-z0-9-]+\.json$/; // an archived season's file, from race.json's `seasons`
const REFRESH_MS = 5 * 60 * 1000;
const LIVE_MIN = 60;   // a pull or kill this close to the fetch = raiding now
const RECENT_H = 12;   // "raided at 21:57" for this long afterwards
const FEED_SIZE = 8;
const SVGNS = 'http://www.w3.org/2000/svg';
const tr = (key, vars) => i18n.t(key, vars);

let race = null;

/* ---- helpers ---------------------------------------------------------- */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  el.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  return el;
}

function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs);
  el.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  return el;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function svgTitle(text) { return s('title', { text }); }

const HEX = /^#[0-9a-f]{6}$/i;
function colour(c) { return HEX.test(c) ? c : '#818b98'; }
function setGuild(el, g) { el.style.setProperty('--guild', colour(g.colour)); return el; }

function num(n, digits = 0) { return i18n.num(n, digits); }
function pct(n) { return `${num(n, 2)}%`; }
function day(iso) { return new Date(iso).toLocaleDateString(i18n.locale, { day: 'numeric', month: 'short' }); }
function dayTime(iso) {
  return new Date(iso).toLocaleString(i18n.locale, {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}
function clock(iso) { return new Date(iso).toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit' }); }
function pulls(n) { return i18n.tn('pulls', n); }
function raiderioUrl(u) { return typeof u === 'string' && u.startsWith('https://raider.io/') ? u : null; }
function wclUrl(u) { return typeof u === 'string' && u.startsWith('https://www.warcraftlogs.com/') ? u : null; }

function leaderName(data) { return data.winner ? data.winner.guild : (data.guilds[0] || {}).name; }

/* What the track shows: a guild that killed the CE boss stands on the finish. */
function trackPosition(g, total) { return g.ceKilledAt ? total : Math.min(g.racePosition, total); }
/* The board's race track: the winner stands on the finish. */
function barPos(data, g) {
  return data.winner && data.winner.guild === g.name ? data.tier.totalBosses : trackPosition(g, data.tier.totalBosses);
}

/* Every Mythic kill of a guild, oldest first. */
function killsOf(g) {
  return g.bosses.filter(b => b.defeatedAt)
    .map(b => ({ at: Date.parse(b.defeatedAt), iso: b.defeatedAt, name: b.name, raid: b.raid, slug: b.slug, pullCount: b.pullCount,
      progress: Array.isArray(b.progress) ? b.progress : [] }))
    .sort((a, b) => a.at - b.at);
}

/* Charts redraw at their container's width, and at its height too while it fills the screen
   (a full-screen chart's box has a fixed height, so redrawing never changes it). */
const charts = new Map();
const resizer = typeof ResizeObserver === 'function'
  ? new ResizeObserver(entries => {
    for (const e of entries) {
      const c = charts.get(e.target);
      const w = Math.floor(e.contentRect.width), hh = Math.floor(e.contentRect.height);
      const full = !!e.target.closest('.is-full');
      if (c && w > 0 && (w !== c.width || (full && hh !== c.height))) { c.width = w; c.height = hh; c.draw(w); }
    }
  })
  : null;

function chart(el, draw) {
  const c = { width: Math.floor(el.clientWidth) || 320, draw };
  charts.set(el, c);
  draw(c.width);
  if (resizer) resizer.observe(el);
}

function resetCharts() {
  if (resizer) resizer.disconnect();
  charts.clear();
}

/* ---- raiding now ------------------------------------------------------ */

/* A guild's latest sign of life: its last pull on the current boss or its
 * latest kill. Only the current boss has pulls in race.json, and a kill
 * ends a boss's pulls, so together they cover the evening. */
function lastActivity(g) {
  const pullsNow = g.current && Array.isArray(g.current.pulls) ? g.current.pulls : [];
  const times = [g.latestKillAt, pullsNow.length ? pullsNow[pullsNow.length - 1].at : null]
    .filter(Boolean).map(Date.parse).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/* 'live' only while the data is fresh too, so a stale race.json never claims
 * a raid that ended hours ago; then it fades to 'recent' ("raided at 21:57"). */
function liveState(g, data, now = Date.now()) {
  if (isArchive(data)) return null; // a finished season never raids "now"
  const last = lastActivity(g);
  if (last === null) return null;
  const fetched = Date.parse(data.generatedAt);
  if ((fetched - last) / 60000 <= LIVE_MIN && (now - fetched) / 60000 <= LIVE_MIN) return 'live';
  if ((now - last) / 3600000 <= RECENT_H) return 'recent';
  return null;
}

/* Badges are repainted every 30 s, without new data, so they fade on time. */
const liveBadges = [];

function liveBadge(g, cls) {
  const el = h('span', { class: cls, hidden: true });
  liveBadges.push({ el, g });
  paintLive({ el, g });
  return el;
}

function paintLive({ el, g }) {
  if (!race) return;
  const state = liveState(g, race);
  el.hidden = !state;
  el.classList.toggle('is-live', state === 'live');
  if (!state) { el.replaceChildren(); return; }
  const last = new Date(lastActivity(g)).toISOString();
  el.title = tr('live.title', { when: dayTime(last) });
  if (state === 'live') el.replaceChildren(h('span', { class: 'live-dot', 'aria-hidden': 'true' }), tr('live.now'));
  else el.replaceChildren(tr('live.recent', { time: clock(last) }));
}

/* ---- header + winner -------------------------------------------------- */

function renderHeader(data) {
  if (!$('#tierPills')) return;
  const tier = data.tier;
  const raids = tier.raids.map(r => `${r.name} ${r.bosses.length}`).join(' + ');
  $('#tierPills').replaceChildren(
    h('span', { class: 'pill', text: tr('pill.bosses', { n: tier.totalBosses }), title: raids }),
    h('span', { class: 'pill pill--jade', text: tr('pill.ce', { boss: tier.ceBoss.name }) }),
    h('span', { class: 'pill', text: isArchive(data) && data.season.end
      ? tr('pill.period', { from: day(tier.start), to: day(data.season.end) })
      : tr('pill.since', { date: day(tier.start) }) }),
  );
}

function trophy(cls) {
  return s('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    s('path', {
      d: 'M7 3h10v4a5 5 0 0 1-10 0V3ZM7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4M12 12v4M8 21h8M9 21l1-5h4l1 5',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
}

function renderWinner(data) {
  const box = $('#winnerBanner');
  if (!data.winner) { box.hidden = true; box.replaceChildren(); return; }
  const g = data.guilds.find(x => x.name === data.winner.guild);
  box.replaceChildren(
    trophy('winner__icon'),
    h('div', {},
      h('p', { class: 'winner__label', text: tr('winner.label') }),
      h('p', { class: 'winner__name', text: data.winner.guild }),
      h('p', {
        class: 'winner__text',
        text: tr('winner.text', { boss: data.tier.ceBoss.name, when: dayTime(data.winner.defeatedAt) }),
      }),
      seasonClose(data) ? h('p', { class: 'winner__before', text: i18n.tn('season.before', daysBetween(Date.parse(data.winner.defeatedAt), seasonClose(data))) }) : null));
  if (g) setGuild(box, g);
  box.hidden = false;
}

/* ---- 1. Broadcast hero ------------------------------------------------------------- */

/* The splash: the leader's current boss as the backdrop (a cut-out of its full-body render,
 * via bossart.js from the overlay), the question as the title, and the board of overlay
 * ribbons. Nothing is drawn on the boss itself. */
function bossArtFor(name) {
  const art = window.BossArt;
  if (!art || !name) return [];
  const enc = art.byName[name.toLowerCase()];
  const list = (enc && art.byEncounter[enc]) || [];
  // Self-hosted cut-outs (scripts/boss-cutouts.py) of Blizzard's renders, keyed by display id.
  // A council fight (The Twin Fangs) has several bodies: show up to two.
  return list.map(x => /creature-display-(\d+)\.jpg$/.exec(x.img || ''))
    .filter(Boolean).slice(0, 2).map(m => `img/boss/creature-display-${m[1]}.png`);
}

/* Blizzard's renders are uneven: in a council one body can be a tiny figure in its frame
 * (Zul'jan on The Coiled Altar: 78x107 of 600x600) next to a full-frame one, and some are cut
 * off at the top (Hex Lord Malacrass's crown). Once loaded: a body under 40% of its partner's
 * height is dropped (the pair class goes with it), and a render whose top row is opaque fades
 * in from the top instead of ending in a hard edge (.is-cut-top). */
function cutAtTop(img) {
  try {
    const w = img.naturalWidth, c = document.createElement('canvas');
    c.width = w; c.height = 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, 1).data;
    let solid = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 200) solid++;
    return solid > w * 0.04;
  } catch (_) { return false; }
}
function tidyBossArt(box, pairClass) {
  const imgs = [...box.querySelectorAll('img')];
  if (!imgs.length) return;
  const check = () => {
    if (!imgs.every(i => i.complete && i.naturalHeight)) return;
    if (imgs.length === 2) {
      const [a, b] = imgs;
      const small = a.naturalHeight < b.naturalHeight * 0.4 ? a : b.naturalHeight < a.naturalHeight * 0.4 ? b : null;
      if (small) { small.remove(); box.classList.remove(pairClass); }
    }
    for (const i of box.querySelectorAll('img')) i.classList.toggle('is-cut-top', cutAtTop(i));
  };
  for (const i of imgs) if (!i.complete) i.addEventListener('load', check, { once: true });
  check();
}

// A boss head: a slanted tile with the top of the render (the face reads, a long body doesn't);
// a boss without art gets the same tile with its initial, so every head lines up.
function bossThumb(name, cls = 'boss-thumb') {
  const src = bossArtFor(name)[0];
  return h('span', { class: `boss-thumb ${cls}`, 'aria-hidden': 'true' },
    src ? h('img', { src, alt: '', loading: 'lazy' }) : h('span', { class: 'boss-thumb__mono', text: name.trim()[0] }));
}

// Race day: the tier start is day 1; once someone has CE the count stops on the winning day.
function renderRaceDay(data) {
  const el = $('#bugDay');
  const [y, m, d] = data.tier.start.split('-').map(Number);
  const end = data.winner ? new Date(data.winner.defeatedAt)
    : isArchive(data) && data.season.end ? new Date(data.season.end) : new Date();
  const n = Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()) - new Date(y, m - 1, d)) / 86400000) + 1; // round: DST days are 23 or 25 h
  el.hidden = !(n >= 1);
  if (el.hidden) return;
  el.textContent = tr('hero.day', { n });
  el.title = tr('hero.dayTitle', { n, date: day(data.tier.start) });
}

/* The boss the hero shows: the leader's current boss, or the CE boss once someone won. */
function heroBossName(data) {
  const g = data.guilds.find(x => x.name === leaderName(data));
  return data.winner ? data.tier.ceBoss.name : g && g.current ? g.current.name : null;
}

function renderHero(data) {
  const total = data.tier.totalBosses;
  const lead = leaderName(data);
  const g = data.guilds.find(x => x.name === lead);
  // LIVE only while a guild is really raiding (same rule as the per-guild badges).
  $('#bugLive').hidden = !data.guilds.some(x => liveState(x, data) === 'live');
  renderRaceDay(data);
  const bossName = heroBossName(data);

  // The hero boss.
  const art = $('#heroArt');
  const srcs = bossArtFor(bossName);
  art.hidden = !srcs.length;
  art.classList.toggle('sp__art--pair', srcs.length > 1);
  art.classList.remove('sp__art--wide');
  // Once a render is in: --nat-h caps it at 2x its own size (some of Blizzard's renders are
  // tiny and turn to mush past that), and a lone wide boss gets the wide box.
  const imgs = srcs.map(src => h('img', { src, alt: '' }));
  for (const img of imgs) {
    img.addEventListener('load', () => {
      img.style.setProperty('--nat-h', `${img.naturalHeight}px`);
      if (imgs.length === 1 && img.naturalWidth > 2 * img.naturalHeight) art.classList.add('sp__art--wide');
    });
  }
  art.replaceChildren(...imgs);
  tidyBossArt(art, 'sp__art--pair');

  if (!g) { $('#lowerThirds').replaceChildren(); return; }

  // The board: each guild as an overlay ribbon, its kills, and a race track of one segment per
  // boss: killed bosses full, the current one as far as its best pull. Bar length = race place.
  $('#lowerThirds').replaceChildren(...data.guilds.map(x => {
    const isLead = x.name === lead;
    const c = x.current;
    const won = data.winner && data.winner.guild === x.name;
    const label = won ? tr('tile.ce')
      : !c ? tr('tile.done')
      : c.bestPercent === null ? `${c.name} · ${noPullsText(data)}`
      : `${c.name} · ${tr('tile.best', { pct: pct(c.bestPercent), pulls: pulls(c.pullCount) })}`;
    const url = raiderioUrl(x.profileUrl);
    const rib = h('div', { class: 'rib' },
      h('div', { class: 'rib__bar' }, h('div', { class: 'rib__in' },
        h('span', { class: 'rib__acc mono', text: String(x.rank), 'aria-label': tr('tile.place', { n: x.rank }) }),
        // The name, with Raider.IO's world rank for the CE raid under it in the ribbon.
        h('span', { class: 'rib__txt' },
          url ? h('a', { class: 'rib__val', href: url, rel: 'noopener', text: x.name }) : h('span', { class: 'rib__val', text: x.name }),
          worldRank(data, x)))));
    rib.style.setProperty('--acc', colour(x.colour));
    return setGuild(h('li', { class: `row${isLead ? ' row--lead' : ''}`, 'data-guild': x.name },
      rib,
      h('span', { class: 'row__kills mono' }, h('span', { class: 'row__n', text: String(x.mythicKills) }), h('small', { text: `/${total}` })),
      h('div', { class: 'row__fight' },
        // The raiding badge sits on the label line, so it never squeezes the guild name.
        h('div', { class: 'row__top' }, h('span', { class: 'row__label', text: label }), liveBadge(x, 'row__live')),
        raceTrack(data, x, label))), x);
  }));
}

/* One segment per boss of the tier; each fills from --p (the race position, animatable) minus
 * its own index --i, so 7.27 fills seven segments and a quarter of the eighth. The last one is
 * the finish (CE). */
function raceTrack(data, g, label) {
  const total = data.tier.totalBosses;
  const track = h('span', { class: 'row__hp', role: 'img', 'aria-label': `${label} · ${tr('tile.track', { pos: num(barPos(data, g), 1), total })}` },
    ...Array.from({ length: total }, (_, i) => {
      const seg = h('i', {});
      seg.style.setProperty('--i', String(i));
      return seg;
    }));
  track.style.setProperty('--p', String(barPos(data, g)));
  return track;
}

/* An archived season (race.json `season.archived`, see the season switch) ends on its
 * `season.end`; the live season runs up to the fetch. */
function isArchive(data) { return !!(data.season && data.season.archived); }
/* The season's last day: the archive's end, or the live season's announced end (guilds.toml
 * planned_end), or null while unknown. Midnight UTC of that day. */
function seasonClose(data) {
  const day0 = data.season && (data.season.archived ? data.season.end : data.season.plannedEnd);
  const t = day0 ? Date.parse(`${day0}T00:00:00Z`) : NaN;
  return Number.isFinite(t) ? t : null;
}
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
function seasonEnd(data) {
  const end = isArchive(data) && data.season.end ? Date.parse(data.season.end) : NaN;
  return Number.isFinite(end) ? end : Date.parse(data.generatedAt);
}
// "No pulls seen yet" is wrong for an old raid: Raider.IO keeps no pulls on bosses that were
// never killed there.
function noPullsText(data) { return tr(isArchive(data) ? 'tile.noPullsKept' : 'tile.noPulls'); }

/* ---- 3. Laatste kills ---------------------------------------------------------- */

function isFirstKill(data, k, g) {
  const raid = data.tier.raids.find(r => r.slug === k.raid);
  const boss = raid && raid.bosses.find(b => b.slug === k.slug);
  return !!(boss && boss.firstKill && boss.firstKill.guild === g.name);
}

function renderFeed(data) {
  const kills = data.guilds.flatMap(g => killsOf(g).map(k => ({ ...k, g })))
    .sort((a, b) => b.at - a.at)
    .slice(0, FEED_SIZE);
  const list = $('#killFeed');
  if (!kills.length) {
    list.replaceChildren(h('li', { class: 'tk tk--empty', text: tr('feed.empty') }));
    return;
  }
  // Ticker items: "Guild · boss · date", plus "first kill" for the race's first.
  const fresh = motionNow ? motionNow.newKills : null;
  const item = (k, copy) => h('li', { class: `tk${fresh && fresh.has(`${k.g.name}|${k.raid}/${k.slug}`) ? ` tk--new${isFirstKill(data, k, k.g) ? ' tk--first' : ''}` : ''}`, 'aria-hidden': copy ? 'true' : null },
    h('b', { text: k.g.name }),
    ` · ${k.name} · `,
    h('time', { datetime: k.iso, title: dayTime(k.iso), text: day(k.iso) }),
    isFirstKill(data, k, k.g) ? ` · ${tr('tk.first')}` : '');
  // The band scrolls like a broadcast ticker: the list twice, moving by one list width.
  list.replaceChildren(...kills.map(k => item(k, false)), ...kills.map(k => item(k, true)));
}

/* ---- 4. Voortgang ------------------------------------------------------------ */

/* The chart starts in the week of the first Mythic kill, not at the tier start:
 * Mythic opens later, and those empty weeks squeezed the race into a corner.
 * Weeks run from the tier start, so ticks stay on the weekly reset. */
function timelineStart(data) {
  const tierStart = Date.parse(`${data.tier.start}T00:00:00Z`);
  const firsts = data.guilds.flatMap(g => killsOf(g).map(k => k.at));
  if (!firsts.length) return tierStart;
  const week = 7 * 86400000;
  const lead = Math.min(...firsts) - 2 * 86400000;
  return tierStart + Math.max(0, Math.floor((lead - tierStart) / week)) * week;
}

/* Raid nights: the local days on which any guild pulled or killed, from race.json itself
 * (guilds raid on different evenings), shaded as columns. */
function raidDays(data) {
  const key = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const days = new Set(data.guilds.flatMap(g => [
    ...killsOf(g).map(k => k.at),
    ...(g.current && Array.isArray(g.current.pulls) ? g.current.pulls.map(p => Date.parse(p.at)) : []),
  ]).filter(Number.isFinite).map(key));
  return t => days.has(key(t));
}
const STAR = 'M0,-7 L2,-2.2 7,-2 3.2,1.3 4.4,6.5 0,3.6 -4.4,6.5 -3.2,1.3 -7,-2 -2,-2.2Z';

/* A boss's way down, as points { at, frac } with frac = (100 - best %) / 100: the share of a
 * tread the guild had climbed on it. Killed bosses carry them as `progress` (race.py's best
 * steps, up to the kill); the current boss gets them from its pulls here. */
const stepPoints = steps => steps
  .map(s => ({ at: Date.parse(s.at), frac: (100 - s.best) / 100 }))
  .filter(p => Number.isFinite(p.at) && p.frac >= 0 && p.frac <= 1)
  .sort((a, b) => a.at - b.at);

/* How far a guild is through its current boss: every new best pull on it, and the share of a
 * tread its best pull stands for. Without pull times (an archive, WCL-only) only the best % is
 * known: one rise at the end. */
function currentProgress(g) {
  const cur = g.current;
  if (!cur || g.ceKilledAt || cur.bestPercent === null || cur.bestPercent === undefined) return { points: [], frac: 0, cur };
  const pulls = (Array.isArray(cur.pulls) ? cur.pulls : [])
    .filter(p => typeof p.percent === 'number' && !p.success)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const steps = [];
  let best = 100;
  for (const p of pulls) if (p.percent < best) { best = p.percent; steps.push({ at: p.at, best }); }
  return { points: stepPoints(steps), frac: (100 - cur.bestPercent) / 100, cur };
}

const progressPct = frac => `${Math.round(frac * 100)}%`;

/* "Volledig scherm": the chart (with its standings) over the whole screen. The Fullscreen API where
   the browser has it for elements; otherwise (iPhone) the box covers the window. Esc, the button
   or leaving full screen closes it. On a phone it asks for landscape where that's allowed. */
let timelineNative = false;
function setTimelineFull(on) {
  const box = $('#timelineBox'), btn = $('#timelineFull');
  if (!box || on === box.classList.contains('is-full')) return;
  box.classList.toggle('is-full', on);
  document.body.classList.toggle('has-full', on);
  btn.setAttribute('aria-pressed', String(on));
  paintTimelineButton();
  if (on && box.requestFullscreen && document.fullscreenEnabled) {
    box.requestFullscreen().then(() => {
      timelineNative = true;
      if (screen.orientation && screen.orientation.lock && innerWidth < 600) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => { timelineNative = false; });
  } else if (!on && timelineNative && document.fullscreenElement) {
    timelineNative = false;
    document.exitFullscreen().catch(() => {});
  }
  btn.focus();
  redrawTimeline();
}
function paintTimelineButton() {
  const on = $('#timelineBox').classList.contains('is-full');
  $('#timelineFullLabel').textContent = tr(on ? 'timeline.close' : 'timeline.full');
  const icon = s('svg', { class: 'tl-full__icon', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
    s('path', { d: on ? 'M3 3l10 10M13 3L3 13' : 'M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5' }));
  const btn = $('#timelineFull');
  const old = btn.querySelector('.tl-full__icon');
  if (old) old.replaceWith(icon); else btn.prepend(icon);
}
function redrawTimeline() {
  const el = $('#timeline'), c = charts.get(el);
  // Not while the chart has no width (its view or mode is hidden): it would draw at 0 and give
  // negative sizes. The ResizeObserver draws it once it is shown.
  if (c) requestAnimationFrame(() => {
    const w = Math.floor(el.clientWidth);
    if (w > 0) { c.width = w; c.height = Math.floor(el.clientHeight); c.draw(w); }
  });
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && timelineNative) { timelineNative = false; setTimelineFull(false); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#timelineBox') && $('#timelineBox').classList.contains('is-full')) setTimelineFull(false);
});

function renderTimeline(data) {
  const btn = $('#timelineFull');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => setTimelineFull(!$('#timelineBox').classList.contains('is-full')));
  }
  if (btn) paintTimelineButton();
  // The chart, its moment and the replay live in voortgang.js (it draws from `race` itself when
  // race.json arrives before it has loaded).
  if (typeof Voortgang === 'object') Voortgang.render(data);

}

/* ---- 5. Per guild ----------------------------------------------------------------- */

/* One row per guild: per boss its kill date (a gold star for the race's first kill) or
 * its best pull, then the pulls on its current boss. It replaces the per-boss table and
 * the current-boss cards; on phones the table scrolls with the guild column pinned. */
const PULL_BARS = 60;

function guildCell(g, raid, boss, archived = false) {
  const b = g.bosses.find(x => x.raid === raid.slug && x.slug === boss.slug);
  const isCurrent = g.current && g.current.raid === raid.slug && g.current.slug === boss.slug;
  if (b && b.state === 'killed') {
    const isFirst = boss.firstKill && boss.firstKill.guild === g.name;
    return h('td', { class: `gs-cell gs-cell--kill${isFirst ? ' gs-cell--first' : ''}`, title: `${boss.name}: ${dayTime(b.defeatedAt)}` },
      h('span', { class: 'gs-cell__main', text: day(b.defeatedAt) }),
      h('span', { class: 'gs-cell__sub', text: b.pullCount ? pulls(b.pullCount) : tr('boss.unknownPulls') }),
      isFirst ? h('span', { class: 'visually-hidden', text: tr('boss.first') }) : null);
  }
  if (b && b.state === 'progress' && b.bestPercent !== null) {
    const fill = h('i', {});
    fill.style.setProperty('--w', `${100 - b.bestPercent}%`);
    return setGuild(h('td', { class: `gs-cell gs-cell--prog${isCurrent ? ' gs-cell--current' : ''}`, title: boss.name },
      h('span', { class: 'gs-cell__main', text: pct(b.bestPercent) }),
      h('span', { class: 'gs-meter', role: 'img', 'aria-label': tr('boss.bestAria', { pct: pct(b.bestPercent) }) }, fill),
      h('span', { class: 'gs-cell__sub', text: pulls(b.pullCount) })), g);
  }
  return setGuild(h('td', { class: `gs-cell gs-cell--none${isCurrent ? ' gs-cell--current' : ''}`, title: boss.name },
    isCurrent ? h('span', { class: 'gs-cell__sub', text: tr(archived ? 'boss.stopped' : 'boss.next') }) : h('span', { class: 'visually-hidden', text: tr('boss.untried') })), g);
}

/* The pulls on a guild's current boss as bars (higher = more of the boss down), the
 * best one in the guild colour, with a link to where the pulls come from. */
function pullStrip(data, g) {
  const cur = g.current;
  if (!cur) {
    return h('td', { class: 'gs-pulls' }, h('span', { class: 'gs-pulls__cap', text: data.winner && data.winner.guild === g.name ? tr('tile.ce') : tr('tile.done') }));
  }
  const fromLogs = cur.pullSource === 'warcraftlogs';
  const url = fromLogs ? wclUrl(g.wclUrl) : raiderioUrl(g.profileUrl);
  const src = url ? h('a', { class: 'gs-pulls__src', href: url, rel: 'noopener', text: fromLogs ? 'warcraftlogs' : 'raider.io' }) : null;
  const all = (cur.pulls || []).filter(p => p.percent !== null);
  if (cur.bestPercent === null || !all.length) {
    return h('td', { class: 'gs-pulls' }, h('span', { class: 'gs-pulls__cap' }, `${cur.name} · ${noPullsText(data)}`, srcTag(src)));
  }
  const skip = Math.max(0, all.length - PULL_BARS);
  const best = Math.min(...all.map(p => p.percent));
  const bars = all.slice(skip).map((p, i) => {
    const bar = h('i', { class: p.percent === best ? 'is-best' : null, title: tr('curve.pullTitle', { n: skip + i + 1, date: day(p.at), pct: pct(p.percent) }) });
    bar.style.setProperty('--h', `${Math.max(4, 100 - p.percent)}%`);
    return bar;
  });
  return setGuild(h('td', { class: 'gs-pulls' },
    h('span', { class: 'gs-bars', role: 'img', 'aria-label': tr('curve.title', { guild: g.name, boss: cur.name, n: cur.pullCount, pct: pct(cur.bestPercent) }) }, ...bars),
    h('span', { class: 'gs-pulls__cap' }, `${cur.name} · ${pulls(cur.pullCount)} · `,
      h('span', { class: 'gs-pulls__best', text: tr('guild.best', { pct: pct(cur.bestPercent) }) }), srcTag(src))), g);
}

/* " · raider.io" kept in one piece, so the link never wraps onto a line of its own. */
function srcTag(src) { return src ? h('span', { class: 'gs-pulls__src-wrap' }, ' · ', src) : null; }

/* Raider.IO's Mythic progress ranks for the raid with the CE boss: world, region, realm.
 * Context from outside the race; `rank` stays the place in the race itself. */
function mainRanks(data, g) {
  const r = (g.raids || {})[data.tier.ceBoss.raid] || {};
  const raid = data.tier.raids.find(x => x.slug === data.tier.ceBoss.raid);
  return { world: r.worldRank, region: r.regionRank, realm: r.realmRank, raidName: raid ? raid.name : '' };
}
/* Raider.IO's ranks for the CE raid in the board's ribbon: world, region and realm, each its own
 * part, so on a narrow ribbon the realm drops out whole instead of losing half its number. */
function worldRank(data, g) {
  const r = mainRanks(data, g);
  if (!r.world) return null;
  const parts = [tr('rank.world', { n: num(r.world) }),
    r.region ? `${String(g.region || '').toUpperCase()} ${num(r.region)}` : null,
    r.realm ? `${g.realm} ${num(r.realm)}` : null].filter(Boolean);
  return h('span', { class: 'rib__wr', title: tr('rank.title', { raid: r.raidName }) },
    ...parts.map(p => h('span', { text: p })));
}
function rankLine(data, g) {
  const r = mainRanks(data, g);
  if (!r.world) return null;
  // No-break spaces: a rank never splits from its label ("EU 1.405") when the line wraps.
  const more = [r.region ? `${String(g.region || '').toUpperCase()}\u00a0${num(r.region)}` : null,
    r.realm ? `${g.realm}\u00a0${num(r.realm)}` : null].filter(Boolean);
  return h('span', { class: 'gs-who__wr', title: tr('rank.title', { raid: r.raidName }) },
    tr('rank.world', { n: num(r.world) }),
    more.length ? h('span', { class: 'gs-who__wr-more', text: ` · ${more.join(' · ')}` }) : null);
}

function renderGuildSheets(data) {
  const lead = leaderName(data);
  const cols = data.tier.raids.flatMap((raid, ri) => raid.bosses.map((boss, bi) => ({ raid, boss, sep: ri > 0 && bi === 0 })));
  const head = h('tr', {},
    h('th', { scope: 'col', class: 'gs-corner' }, h('span', { class: 'visually-hidden', text: tr('guild.th') })),
    ...cols.map(({ raid, boss, sep }) => {
      const isCe = raid.slug === data.tier.ceBoss.raid && boss.slug === data.tier.ceBoss.slug;
      return h('th', { scope: 'col', class: `gs-boss${sep ? ' gs-sep' : ''}`, title: `${boss.name} · ${raid.name}` },
        bossThumb(boss.name), h('span', { class: 'gs-boss__label' }, h('span', { class: 'gs-boss__name', text: boss.name }), isCe ? h('span', { class: 'ce-tag', text: 'CE' }) : null));
    }),
    h('th', { scope: 'col', class: 'gs-pulls-h', text: tr(isArchive(data) ? 'guild.thPullsPast' : 'guild.thPulls') }));
  const rows = data.guilds.map(g => {
    const url = raiderioUrl(g.profileUrl);
    const row = h('tr', { class: g.name === lead ? 'gs-row gs-row--lead' : 'gs-row' },
      h('th', { scope: 'row', class: 'gs-who' }, h('div', { class: 'gs-who__in' },
        h('span', { class: 'gs-who__rank', text: String(g.rank), 'aria-label': tr('tile.place', { n: g.rank }) }),
        h('span', { class: 'gs-who__name' }, url ? h('a', { href: url, rel: 'noopener', text: g.name }) : g.name, rankLine(data, g), liveBadge(g, 'row__live')),
        h('span', { class: 'gs-who__k' }, String(g.mythicKills), h('small', { text: `/${data.tier.totalBosses}` })))),
      ...cols.map(({ raid, boss, sep }) => {
        const td = guildCell(g, raid, boss, isArchive(data));
        if (sep) td.classList.add('gs-sep');
        return td;
      }),
      pullStrip(data, g));
    return setGuild(row, g);
  });
  $('#guildSheets').replaceChildren(h('thead', {}, head), h('tbody', {}, rows));
}

/* ---- footer ------------------------------------------------------------------------------ */

function renderUpdated() {
  if (!race) return;
  const el = $('#updated');
  if (isArchive(race)) {
    el.textContent = race.season.end ? tr('upd.archived', { date: day(race.season.end) }) : tr('upd.archivedNoDate');
    el.title = '';
    liveBadges.forEach(paintLive);
    return;
  }
  // When the data was fetched; the exact moment in the tooltip.
  const at = race.generatedAt;
  const today = new Date(at).toDateString() === new Date().toDateString();
  el.textContent = today ? tr('upd.at', { time: clock(at) }) : tr('upd.atDay', { day: day(at), time: clock(at) });
  el.title = dayTime(at);
  liveBadges.forEach(paintLive);
}

/* ---- motion: news arriving while the page is open ---------------------------------------
 * Nothing moves on load. When a refresh (every 5 min) brings news for the season already on
 * screen, the change plays once: a guild's raid-frame bar runs to its new best (on a kill: to
 * full, then down to the next boss) and its kill count rises in; guilds that swap places slide
 * there (FLIP); the new kills light up in the ticker (the race's first kill in gold); only the
 * new stretch of a Voortgang line draws; and a new hero boss crossfades in (View Transition).
 * Reduced motion keeps the colour cues and drops the movement. A hidden tab plays nothing. */
let motionNow = null;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
if (window.CSS && CSS.registerProperty) {
  // --p inherits, so the board's segments follow an animation on their track.
  try { CSS.registerProperty({ name: '--p', syntax: '<number>', inherits: true, initialValue: '0' }); } catch (_) { /* already */ }
}
// The latest moment a guild's line already showed: its last kill or its last new best.
function lastShownAt(g) {
  const pullsAt = g.current && Array.isArray(g.current.pulls) ? g.current.pulls.map(p => Date.parse(p.at)) : [];
  return Math.max(0, ...killsOf(g).map(k => k.at), ...pullsAt.filter(Number.isFinite));
}

function diffRace(prev, data) {
  const out = { guilds: new Map(), newKills: new Set(), heroSwap: heroBossName(prev) !== heroBossName(data) };
  for (const g of data.guilds) {
    const o = prev.guilds.find(x => x.name === g.name);
    if (!o) continue;
    const had = new Set(killsOf(o).map(k => `${k.raid}/${k.slug}`));
    const fresh = killsOf(g).filter(k => !had.has(`${k.raid}/${k.slug}`));
    fresh.forEach(k => out.newKills.add(`${g.name}|${k.raid}/${k.slug}`));
    const moved = g.racePosition !== o.racePosition || fresh.length > 0;
    if (moved) out.guilds.set(g.name, { oldP: barPos(prev, o), newP: barPos(data, g), killed: fresh.length > 0, lastAt: lastShownAt(o) });
  }
  return out;
}

function renderWithMotion(prev, data) {
  const same = prev && !isArchive(data) && prev.season?.id === data.season?.id && !document.hidden;
  const motion = same ? diffRace(prev, data) : null;
  if (!motion || (!motion.guilds.size && !motion.newKills.size && !motion.heroSwap)) { render(data); return; }
  const tops = new Map([...document.querySelectorAll('#lowerThirds .row')].map(li => [li.dataset.guild, li.getBoundingClientRect().top]));
  const go = () => {
    motionNow = motion;
    try { render(data); } finally { motionNow = null; }
    playBoard(motion, tops);
  };
  if (motion.heroSwap && document.startViewTransition && !reducedMotion()) document.startViewTransition(go);
  else go();
}

function playBoard(motion, tops) {
  const reduced = reducedMotion();
  for (const li of document.querySelectorAll('#lowerThirds .row')) {
    const name = li.dataset.guild;
    const m = motion.guilds.get(name);
    // Places swapped: slide from the old row to the new one.
    const top = tops.get(name);
    const dy = top === undefined ? 0 : top - li.getBoundingClientRect().top;
    if (dy && !reduced) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 650, easing: EASE_OUT });
    if (!m) continue;
    const track = li.querySelector('.row__hp');
    const n = li.querySelector('.row__n');
    if (reduced) {
      if (m.killed && n) n.animate([{ color: 'var(--jade)' }, {}], { duration: 1600, easing: 'ease-out' });
      continue;
    }
    // The track runs from the old place to the new one (through a whole segment on a kill).
    if (track) track.animate([{ '--p': m.oldP }, { '--p': m.newP }], { duration: m.killed ? 1400 : 900, easing: EASE_OUT });
    if (m.killed && n) {
      n.animate([{ transform: 'translateY(45%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 500, delay: 700, easing: EASE_OUT, fill: 'backwards' });
    }
  }
}

// Draw a Voortgang line from horizontal position fromX to its end (the part new since the last view).
function drawLineFrom(line, fromX) {
  if (reducedMotion() || typeof line.getTotalLength !== 'function') return;
  const L = line.getTotalLength();
  let lo = 0, hi = L;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (line.getPointAtLength(mid).x < fromX) lo = mid; else hi = mid; }
  const rest = L - lo;
  if (rest < 2) return;
  line.style.strokeDasharray = `${L}`;
  const a = line.animate([{ strokeDashoffset: rest }, { strokeDashoffset: 0 }], { duration: 1100, easing: EASE_OUT });
  a.onfinish = a.oncancel = () => { line.style.strokeDasharray = ''; };
}

/* ---- load ------------------------------------------------------------------------------------- */

function $(sel) { return document.querySelector(sel); }

function showError(msg) {
  const box = $('#globalError');
  box.textContent = msg;
  box.hidden = !msg;
}

function render(data) {
  resetCharts();
  liveBadges.length = 0;
  renderSeason(data);
  renderHeader(data);
  renderWinner(data);
  renderHero(data);
  renderFeed(data);
  renderTimeline(data);
  renderGuildSheets(data);
  $('#wclNote').textContent = isArchive(data) && !(data.sources && data.sources.warcraftlogs) ? tr('wcl.archive')
    : data.sources && data.sources.warcraftlogs ? tr('wcl.on') : tr('wcl.off');
  // Footer sources: DecAPI only where streams are checked (never in an archive); the last line
  // names Raider.IO alone when the season has no Warcraft Logs.
  $('#srcLive').hidden = isArchive(data) || !data.streams;
  $('#pullNote').textContent = tr(isArchive(data) && !(data.sources && data.sources.warcraftlogs) ? 'footer.src4Past' : 'footer.src4');
  renderUpdated();
  $('#ftMeta').textContent = [data.season && data.season.label, $('#bugDay').hidden ? null : $('#bugDay').textContent].filter(Boolean).join(' · ');
  // Other scripts draw their own sections from the same data (halloffame.js).
  document.dispatchEvent(new CustomEvent('race:data', { detail: data }));
}

let loadError = null;

/* ---- seasons ---------------------------------------------------------------------------------
 * race.json lists the seasons (`seasons`, current first). ?season=s1 shows an archived one: a
 * finished race.json-shaped file, fetched once and never refreshed. Without the parameter, or
 * with an id that isn't archived, the page is the live race. */
let seasons = [];
let wanted = new URLSearchParams(location.search).get('season');

function archiveEntry() {
  return seasons.find(s => s.id === wanted && !s.current && SEASON_FILE.test(s.file || '')) || null;
}

/* A raid with counts: false (Sporefall in Season 1, The Tidebound Grotto in Season 2) doesn't
 * count for the race: it leaves tier.raids and the guilds' bosses here, so every chart and table
 * counts only the race. Its kills stay in the Hall of fame ("telt niet mee"). */
function splitSideRaids(data) {
  const side = data.tier.raids.filter(r => r.counts === false);
  if (side.length) {
    const keep = new Set(data.tier.raids.filter(r => r.counts !== false).map(r => r.slug));
    data.tier.raids = data.tier.raids.filter(r => keep.has(r.slug));
    for (const g of data.guilds) g.bosses = g.bosses.filter(b => keep.has(b.raid));
  }
  return data;
}

async function fetchRace(url) {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data || !Array.isArray(data.guilds) || !data.tier) throw new Error(tr('err.content'));
  return splitSideRaids(data);
}

async function load() {
  try {
    let data;
    if (!seasons.length || !archiveEntry()) {
      data = await fetchRace(DATA_URL);
      seasons = Array.isArray(data.seasons) ? data.seasons : [];
    }
    const entry = archiveEntry();
    if (entry) {
      if (race && isArchive(race) && race.season.id === entry.id) return; // an archive never changes
      data = await fetchRace(entry.file);
    }
    const fresh = !race || race.generatedAt !== data.generatedAt || race.season?.id !== data.season?.id;
    const prev = race;
    race = data;
    loadError = null;
    showError('');
    if (fresh) renderWithMotion(prev, data);
  } catch (err) {
    if (!race) {
      loadError = err.message;
      showLoadError();
    }
  }
}

/* The switch: flush blocks like NL | EN, shown only when there is an archive to switch to. */
function renderSeason(data) {
  const box = $('#seasonSwitch');
  const archived = isArchive(data);
  document.body.classList.toggle('is-archive', archived);
  $('.sp__title [data-i18n="title.a"]').textContent = tr(archived ? 'title.aPast' : 'title.a');
  const lead = $('.sp__lead');
  lead.textContent = archived
    ? tr('lead.archived', { season: data.season.label || data.season.id, raids: data.tier.raids.map(r => r.name).join(' + ') })
    : tr('lead');
  document.title = archived ? tr('doc.titlePast', { season: data.season.label || data.season.id }) : tr('doc.title');
  setPageLinks(archived ? data.season.id : null);
  $('#srcWcl').hidden = archived && !(data.sources && data.sources.warcraftlogs);
  if (!box) return;
  box.hidden = seasons.length < 2;
  const active = archived ? data.season.id : (seasons.find(s => s.current) || {}).id;
  box.replaceChildren(...seasons.map(s => {
    const b = h('button', { type: 'button', 'aria-pressed': String(s.id === active), title: s.label || s.id },
      h('span', { class: 'season-switch__long', text: s.label || s.id }),
      h('span', { class: 'season-switch__short', 'aria-hidden': 'true', text: s.id.toUpperCase() }));
    b.addEventListener('click', () => {
      if (s.id === active) return;
      wanted = s.current ? null : s.id;
      const url = new URL(location.href);
      if (wanted) url.searchParams.set('season', wanted); else url.searchParams.delete('season');
      history.replaceState(null, '', url);
      race = null;
      load();
    });
    return b;
  }));
}

/* The canonical URL is the page in the language in its own URL (?lang=en, else Dutch), so
 * Dutch, English and each archive are separate pages to a search engine, tied by hreflang. */
function setPageLinks(season) {
  const url = lang => {
    const u = new URL(SITE_URL);
    if (season) u.searchParams.set('season', season);
    if (lang === 'en') u.searchParams.set('lang', 'en');
    return u.href;
  };
  const en = new URLSearchParams(location.search).get('lang') === 'en';
  const canon = document.querySelector('link[rel="canonical"]');
  if (canon) canon.href = url(en ? 'en' : 'nl');
  for (const l of document.querySelectorAll('link[rel="alternate"][hreflang]')) {
    l.href = url(l.hreflang === 'en' ? 'en' : 'nl');
  }
}

function showLoadError() {
  showError(tr('err.load', { msg: loadError }));
  $('#updated').textContent = tr('upd.none');
}

/* NL | EN: redraw everything in the other language, no reload. */
function setupLangSwitch() {
  for (const b of document.querySelectorAll('.lang-switch [data-lang]')) {
    b.addEventListener('click', () => {
      if (!i18n.set(b.dataset.lang)) return;
      if (race) render(race);
      else if (loadError) showLoadError();
    });
  }
}

/* ---- views --------------------------------------------------------------------------------
 * The page is three views behind the nav under the top bar: Race (hero, ticker, Voortgang),
 * Guilds (Per guild) and Hall of fame. The hash picks one (#guilds, #halloffame), so a view can
 * be linked and the back button works; ?season and ?lang are untouched. */
const VIEWS = { race: 'race', guilds: 'guilds', halloffame: 'hof', hof: 'hof' };

function currentView() {
  const v = VIEWS[location.hash.slice(1).toLowerCase()] || 'race';
  return v === 'hof' && $('#navHof').hidden ? 'race' : v;
}

function showView(scroll) {
  const v = currentView();
  if (document.body.dataset.view === v) return;
  document.body.dataset.view = v;
  for (const a of document.querySelectorAll('a[data-view]')) {
    if (a.dataset.view === v) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (scroll) window.scrollTo(0, 0);
}

function setupViews() {
  showView(false);
  window.addEventListener('hashchange', () => showView(true));
  // A button, not a #top link: the hash picks the view.
  $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }));
  // The Hall of fame links exist only while the season has one: they follow the section, which
  // halloffame.js shows or hides (whenever it gets the data, before or after app.js renders).
  const hof = $('#hallOfFame');
  const syncHof = () => {
    for (const a of document.querySelectorAll('.js-nav-hof')) a.hidden = hof.hidden;
    document.body.dataset.view = '';
    showView(false);
  };
  if (typeof MutationObserver === 'function') new MutationObserver(syncHof).observe(hof, { attributes: true, attributeFilter: ['hidden'] });
  syncHof();
}

i18n.applyStatic();
setupLangSwitch();
setupViews();
load();
setInterval(() => { if (!archiveEntry()) load(); }, REFRESH_MS);
setInterval(renderUpdated, 30 * 1000);
