/* Draws og.html, the share image, from data/race.json. Dutch only: the
 * image is one file for every visitor. Like app.js: textContent only, no innerHTML,
 * guild colours checked before use. scripts/og-image.sh screenshots it.
 * Design language v2, as the hero: the broadcast bug, the question as a poster, the board
 * as ribbons with a raid-frame bar, and the leader's current boss (the CE boss once someone
 * won) standing in the jade/void glow on the right. */
'use strict';

(async () => {
  const HEX = /^#[0-9a-f]{6}$/i;
  const MAX_ROWS = 5;
  const DAY = 86400000;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const nl = (n, d = 0) => Number(n).toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
  // The self-hosted cut-outs of bossart.js's renders, as app.js's bossArtFor().
  const artFor = name => {
    const art = window.BossArt;
    const enc = art && name && art.byName[name.toLowerCase()];
    return ((enc && art.byEncounter[enc]) || []).map(x => /creature-display-(\d+)\.jpg$/.exec(x.img || ''))
      .filter(Boolean).slice(0, 2).map(m => `img/boss/creature-display-${m[1]}.png`);
  };

  const data = await (await fetch('data/race.json', { cache: 'no-cache' })).json();
  const total = data.tier.totalBosses;
  const lead = data.winner ? data.winner.guild : (data.guilds[0] || {}).name;
  const leader = data.guilds.find(g => g.name === lead);

  // Race day: the tier start is day 1; once someone has CE the count stops on the winning day.
  const [y, m, d] = data.tier.start.split('-').map(Number);
  const end = new Date(data.winner ? data.winner.defeatedAt : data.generatedAt);
  const n = Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()) - new Date(y, m - 1, d)) / DAY) + 1;
  if (n >= 1) { const day = document.getElementById('ogDay'); day.textContent = `Dag ${n}`; day.hidden = false; }

  if (data.winner) {
    const title = document.getElementById('ogTitle');
    title.replaceChildren(el('em', '', data.winner.guild), el('span', 'og__title-sub', 'haalt als eerste Cutting Edge'));
    title.classList.add('og__title--won');
  }

  // The hero boss, as on the page.
  const bossName = data.winner ? data.tier.ceBoss.name : leader && leader.current ? leader.current.name : null;
  const srcs = artFor(bossName);
  if (srcs.length) {
    const art = document.getElementById('ogArt');
    art.classList.toggle('og__art--pair', srcs.length > 1);
    art.replaceChildren(...srcs.map(src => {
      const i = el('img');
      // A lone render wider than 1.6:1 (Ula'tek's wings) is centred in the field, not shrunk onto the floor.
      i.addEventListener('load', () => art.classList.toggle('og__art--wide', srcs.length === 1 && i.naturalWidth > 1.6 * i.naturalHeight));
      i.src = src; i.alt = '';
      return i;
    }));
    art.hidden = false;
  }

  const rows = data.guilds.slice(0, MAX_ROWS).map(g => {
    const pos = g.ceKilledAt ? total : Math.min(g.racePosition, total);
    const cur = g.current;
    const where = g.ceKilledAt ? 'Cutting Edge behaald' : !cur ? 'Alles verslagen'
      : cur.bestPercent === null ? `${cur.name} · nog geen pulls`
        : `${cur.name} · beste ${nl(cur.bestPercent, 1)}%`;
    const row = el('li', `og__row${g.name === lead ? ' og__row--lead' : ''}`);
    row.style.setProperty('--guild', HEX.test(g.colour) ? g.colour : '#818b98');
    row.style.setProperty('--pos', `${(pos / total) * 100}%`);
    const rib = el('div', 'og__rib');
    rib.append(el('span', 'og__rank', String(g.rank)), el('span', 'og__guild', g.name));
    const kills = el('div', 'og__kills', String(g.mythicKills));
    kills.append(el('small', '', `/${total}`));
    const bar = el('div', 'og__bar');
    bar.append(el('span', 'og__where', where), el('span', 'og__track'));
    row.append(rib, kills, bar);
    return row;
  });
  document.getElementById('ogRows').replaceChildren(...rows);
  document.getElementById('ogCe').textContent = `Cutting Edge: ${data.tier.ceBoss.name}`;
  document.getElementById('ogUpdated').textContent = `Bijgewerkt ${new Date(data.generatedAt).toLocaleString('nl-NL', {
    timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })}`;
})();
