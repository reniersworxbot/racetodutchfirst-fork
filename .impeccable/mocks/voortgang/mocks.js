/* Voortgang variants (mockups on live race.json). Served from site/mocks/voortgang/ during review. */
'use strict';
const NS = 'http://www.w3.org/2000/svg';
const DAY = 86400000;
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) k === 'text' ? (el.textContent = v) : el.setAttribute(k, v);
  el.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  return el;
}
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) k === 'text' ? (el.textContent = v) : el.setAttribute(k, v);
  el.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  return el;
}
const fmt = (n, d = 0) => Number(n).toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const dayLbl = t => new Date(t).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
const STAR = 'M0,-7 L2,-2.2 7,-2 3.2,1.3 4.4,6.5 0,3.6 -4.4,6.5 -3.2,1.3 -7,-2 -2,-2.2Z';
function art(name) {
  const a = window.BossArt; if (!a) return null;
  const enc = a.byName[name.toLowerCase()]; const list = (enc && a.byEncounter[enc]) || [];
  const m = list.map(x => /creature-display-(\d+)\.jpg$/.exec(x.img || '')).find(Boolean);
  return m ? `../../img/boss/creature-display-${m[1]}.png` : null;
}

/* ---- model ---- */
function model(d) {
  const total = d.tier.totalBosses;
  const end = Date.parse(d.generatedAt);
  const firsts = new Map();
  for (const r of d.tier.raids) for (const b of r.bosses) if (b.firstKill) firsts.set(`${r.slug}/${b.slug}`, b.firstKill.guild);
  const guilds = d.guilds.map(g => {
    const kills = g.bosses.filter(b => b.defeatedAt).map(b => ({ ...b, at: Date.parse(b.defeatedAt) })).sort((a, b) => a.at - b.at);
    const ev = []; let from = -Infinity;
    kills.forEach((k, n) => {
      for (const p of k.progress || []) { const at = Date.parse(p.at); if (at < k.at) ev.push({ at: Math.max(at, from), pos: n + (100 - p.best) / 100 }); }
      ev.push({ at: k.at, pos: n + 1 }); from = k.at;
    });
    const c = g.current;
    const pulls = c && !g.ceKilledAt && Array.isArray(c.pulls) ? c.pulls.filter(p => typeof p.percent === 'number').map(p => ({ ...p, t: Date.parse(p.at) })).sort((a, b) => a.t - b.t) : [];
    let best = 100;
    for (const p of pulls) if (!p.success && p.percent < best) { best = p.percent; ev.push({ at: Math.max(p.t, from), pos: kills.length + (100 - best) / 100 }); }
    if (c && c.bestPercent != null && !pulls.length && !g.ceKilledAt) ev.push({ at: end, pos: kills.length + (100 - c.bestPercent) / 100 });
    ev.sort((a, b) => a.at - b.at); let mx = 0; for (const e of ev) { mx = Math.max(mx, e.pos); e.pos = mx; }
    return { g, kills, ev, pulls, cur: c && !g.ceKilledAt ? c : null, colour: g.colour, isFirst: k => firsts.get(`${k.raid}/${k.slug}`) === g.name };
  });
  const allKills = guilds.flatMap(x => x.kills.map(k => k.at));
  const start = Math.min(...allKills) - 2 * DAY;
  const tierStart = Date.parse(`${d.tier.start}T00:00:00Z`);
  const posAt = (gm, t) => { let p = 0; for (const e of gm.ev) { if (e.at > t) break; p = e.pos; } return p; };
  return { d, total, start, end, tierStart, guilds, posAt, ce: d.tier.ceBoss.name };
}
function frame(w, H, m) { return { pw: w - m.l - m.r, ph: H - m.t - m.b }; }
function weekTicks(M, x, svg, H, m) {
  for (let t = M.tierStart + Math.ceil((M.start - M.tierStart) / (7 * DAY)) * 7 * DAY; t <= M.end; t += 7 * DAY) {
    svg.append(s('line', { class: 'g', x1: x(t), x2: x(t), y1: m.t, y2: H - m.b }));
    svg.append(s('text', { class: 'ax', x: x(t), y: H - m.b + 16, 'text-anchor': 'middle', text: dayLbl(t) }));
  }
}

/* ---- A · Achterstand: bosses behind the leader over time ---- */
function drawA(el, M) {
  const w = el.clientWidth, narrow = w < 560, H = narrow ? 300 : 360;
  const m = { l: narrow ? 34 : 44, r: narrow ? 50 : 200, t: 34, b: 28 };
  const { pw, ph } = frame(w, H, m);
  const steps = []; for (let t = M.start; t <= M.end; t += 3600000) steps.push(t); steps.push(M.end);
  const gaps = M.guilds.map(gm => steps.map(t => { const lead = Math.max(...M.guilds.map(o => M.posAt(o, t))); return lead - M.posAt(gm, t); }));
  const maxGap = Math.max(3, Math.ceil(Math.max(...gaps.flat())));
  const x = t => m.l + (t - M.start) / (M.end - M.start) * pw, y = gp => m.t + gp / maxGap * ph;
  const svg = s('svg', { width: w, height: H });
  svg.append(s('rect', { class: 'lead-band', x: m.l, y: m.t - 22, width: pw, height: 22 }));
  svg.append(s('text', { class: 'lead-lbl', x: m.l + 10, y: m.t - 7, text: 'AAN KOP' }));
  for (let k = 0; k <= maxGap; k++) {
    svg.append(s('line', { class: k ? 'g' : 'g0', x1: m.l, x2: m.l + pw, y1: y(k), y2: y(k) }));
    if (k) svg.append(s('text', { class: 'ax', x: m.l - 8, y: y(k) + 4, 'text-anchor': 'end', text: `−${k}` }));
  }
  weekTicks(M, x, svg, H, m);
  const ends = [];
  [...M.guilds].reverse().forEach((gm, i) => {
    const gp = gaps[M.guilds.indexOf(gm)];
    let d = `M${x(steps[0])},${y(gp[0])}`; steps.forEach((t, j) => { d += ` L${x(t)},${y(gp[j])}`; });
    svg.append(s('path', { d, class: 'ln', stroke: gm.colour, 'stroke-width': i === M.guilds.length - 1 ? 3 : 2.25 }));
    gm.kills.forEach(k => { if (gm.isFirst(k)) svg.append(s('path', { class: 'star', d: STAR, transform: `translate(${x(k.at)},${y(0)})` })); });
    ends.push({ gm, gap: gp[gp.length - 1], y: y(gp[gp.length - 1]) });
  });
  ends.sort((a, b) => a.y - b.y); ends.forEach((e, i) => { if (i && e.y - ends[i - 1].y < 18) e.y = ends[i - 1].y + 18; });
  for (const e of ends) svg.append(s('text', { class: 'end', x: m.l + pw + 8, y: e.y + 5, fill: e.gm.colour },
    narrow ? '' : `${e.gm.g.name} `, s('tspan', { class: 'endn', text: e.gap < 0.005 ? 'leider' : `−${fmt(e.gap, 1)}` })));
  el.replaceChildren(svg);
}

/* ---- B · De reis: per guild a block per boss, from starting on it to the kill ---- */
function drawB(el, M) {
  const w = el.clientWidth, narrow = w < 560;
  const lane = narrow ? 64 : 58, top = 26, lw = narrow ? 0 : 170;
  const H = top + M.guilds.length * lane + 24;
  const m = { l: lw + (narrow ? 8 : 16), r: 16 };
  const pw = w - m.l - m.r;
  const x = t => m.l + (t - M.start) / (M.end - M.start) * pw;
  const svg = s('svg', { width: w, height: H });
  for (let t = M.tierStart + Math.ceil((M.start - M.tierStart) / (7 * DAY)) * 7 * DAY; t <= M.end; t += 7 * DAY) {
    svg.append(s('line', { class: 'g', x1: x(t), x2: x(t), y1: top - 6, y2: H - 22 }));
    svg.append(s('text', { class: 'ax', x: x(t), y: H - 6, 'text-anchor': 'middle', text: dayLbl(t) }));
  }
  svg.append(s('line', { class: 'now', x1: x(M.end), x2: x(M.end), y1: top - 10, y2: H - 22 }));
  svg.append(s('text', { class: 'now-lbl', x: x(M.end), y: top - 14, 'text-anchor': 'end', text: 'NU' }));
  M.guilds.forEach((gm, i) => {
    const y0 = top + i * lane + (narrow ? 22 : 8), bh = narrow ? 30 : 34;
    if (narrow) svg.append(s('text', { class: 'lane-name', x: m.l, y: y0 - 6, fill: gm.colour, text: gm.g.name }));
    else {
      svg.append(s('rect', { x: 0, y: y0, width: 6, height: bh, fill: gm.colour }));
      svg.append(s('text', { class: 'lane-name', x: 14, y: y0 + 15, text: gm.g.name }));
      svg.append(s('text', { class: 'lane-sub', x: 14, y: y0 + 30, text: `${gm.kills.length}/${M.total} · ${gm.g.mythicKills ? `laatste ${dayLbl(gm.kills[gm.kills.length - 1].at)}` : 'nog geen kill'}` }));
    }
    let from = M.start;
    const blocks = gm.kills.map(k => ({ from, to: k.at, k })); gm.kills.forEach((k, j) => { if (blocks[j + 1]) blocks[j + 1].from = k.at; });
    blocks.forEach((b, j) => { if (j === 0) { const f = (b.k.progress || [])[0]; b.from = f ? Math.min(Date.parse(f.at), b.to) : b.to - 1.5 * DAY; } b.from = Math.max(b.from, M.start); });
    for (const b of blocks) {
      const a = x(b.from), z = Math.max(x(b.to), a + 3);
      svg.append(s('rect', { class: 'blk', x: a, y: y0, width: z - a, height: bh, fill: gm.colour }));
      svg.append(s('rect', { x: z - 3, y: y0, width: 3, height: bh, fill: gm.colour }));
      if (gm.isFirst(b.k)) svg.append(s('path', { class: 'star', d: STAR, transform: `translate(${z},${y0 - 1})` }));
      if (z - a > b.k.name.length * 6.6 + 14) {
        const t = s('text', { class: 'blk-lbl', x: a + 6, y: y0 + bh / 2 - 2 }, b.k.name, s('title', { text: `${b.k.name} · ${dayLbl(b.to)} · ${b.k.pullCount || '?'} pulls` }));
        svg.append(t, s('text', { class: 'blk-sub', x: a + 6, y: y0 + bh / 2 + 11, text: `${b.k.pullCount || '?'} pulls` }));
      }
    }
    if (gm.cur) {
      const a = x(gm.kills.length ? gm.kills[gm.kills.length - 1].at : M.start), z = x(M.end);
      svg.append(s('rect', { class: 'blk-open', x: a, y: y0, width: Math.max(z - a, 2), height: bh, stroke: gm.colour }));
      const frac = gm.cur.bestPercent != null ? (100 - gm.cur.bestPercent) / 100 : 0;
      svg.append(s('rect', { x: a, y: y0 + bh - 4, width: Math.max(0, (z - a) * frac), height: 4, fill: gm.colour }));
      if (z - a > 70) svg.append(s('text', { class: 'blk-lbl', x: a + 6, y: y0 + bh / 2 - 2, text: gm.cur.name }),
        s('text', { class: 'blk-sub', x: a + 6, y: y0 + bh / 2 + 11, text: gm.cur.bestPercent != null ? `nog ${fmt(gm.cur.bestPercent, 1)}% · ${gm.cur.pullCount} pulls` : 'nog geen pull' }));
    }
  });
  el.replaceChildren(svg);
}

/* ---- C · Splits per boss: a column per boss (in race order), a dot per guild on its kill day ---- */
function drawC(el, M) {
  const w = el.clientWidth, narrow = w < 560;
  const bosses = M.d.tier.raids.flatMap(r => r.bosses.map(b => ({ ...b, raid: r.slug })));
  const firstAt = b => { const ts = M.guilds.flatMap(gm => gm.kills.filter(k => k.slug === b.slug).map(k => k.at)); return ts.length ? Math.min(...ts) : Infinity; };
  bosses.sort((a, b) => firstAt(a) - firstAt(b));
  const H = narrow ? 380 : 420, m = { l: narrow ? 40 : 54, r: 16, t: narrow ? 62 : 74, b: 18 };
  const { pw, ph } = frame(w, H, m);
  const dayOf = t => (t - M.tierStart) / DAY + 1;
  const maxDay = Math.ceil(dayOf(M.end));
  const minDay = Math.max(1, Math.floor(dayOf(M.start)));
  const colW = pw / bosses.length;
  const x = i => m.l + colW * (i + 0.5), y = dd => m.t + (dd - minDay) / (maxDay - minDay) * ph;
  const svg = s('svg', { width: w, height: H });
  for (let dd = Math.ceil(minDay / 7) * 7; dd <= maxDay; dd += 7) {
    svg.append(s('line', { class: 'g', x1: m.l, x2: m.l + pw, y1: y(dd), y2: y(dd) }));
    svg.append(s('text', { class: 'ax', x: m.l - 8, y: y(dd) + 4, 'text-anchor': 'end', text: `dag ${dd}` }));
  }
  svg.append(s('line', { class: 'now', x1: m.l, x2: m.l + pw, y1: y(dayOf(M.end)), y2: y(dayOf(M.end)) }));
  svg.append(s('text', { class: 'now-lbl', x: m.l + pw, y: y(dayOf(M.end)) - 6, 'text-anchor': 'end', text: 'NU' }));
  bosses.forEach((b, i) => {
    const sz = Math.min(colW - 8, narrow ? 30 : 44), src = art(b.name);
    if (i % 2 === 0) svg.append(s('rect', { class: 'col', x: m.l + colW * i, y: m.t - 8, width: colW, height: ph + 8 }));
    if (src) svg.append(s('image', { href: src, x: x(i) - sz / 2, y: 4, width: sz, height: sz, preserveAspectRatio: 'xMidYMin slice' }));
    if (!narrow) svg.append(s('text', { class: 'col-lbl', x: x(i), y: sz + 18, 'text-anchor': 'middle', text: b.name.length > 13 ? `${b.name.slice(0, 12)}…` : b.name },
      s('title', { text: b.name })));
    if (b.slug === M.d.tier.ceBoss.slug) svg.append(s('text', { class: 'ce', x: x(i), y: narrow ? sz + 16 : sz + 32, 'text-anchor': 'middle', text: 'CE' }));
  });
  M.guilds.forEach((gm, gi) => {
    const pts = []; const off = (gi - (M.guilds.length - 1) / 2) * Math.min(6, colW / 8);
    bosses.forEach((b, i) => { const k = gm.kills.find(kk => kk.slug === b.slug); if (k) pts.push({ x: x(i) + off, y: y(dayOf(k.at)), k }); });
    if (pts.length > 1) svg.append(s('path', { class: 'ln thin', stroke: gm.colour, d: pts.map((p, j) => `${j ? 'L' : 'M'}${p.x},${p.y}`).join(' ') }));
    for (const p of pts) {
      if (gm.isFirst(p.k)) svg.append(s('path', { class: 'star big', d: STAR, transform: `translate(${p.x},${p.y}) scale(1.25)` }, s('title', { text: `${gm.g.name} · ${p.k.name} · ${dayLbl(p.k.at)} · eerste kill` })));
      else svg.append(s('circle', { cx: p.x, cy: p.y, r: 5.5, fill: gm.colour, class: 'dot' }, s('title', { text: `${gm.g.name} · ${p.k.name} · ${dayLbl(p.k.at)}` })));
    }
  });
  el.replaceChildren(svg);
}

/* ---- D · De muur: every pull on the current boss, boss HP per pull ---- */
function drawD(el, M) {
  const wrap = h('div', { class: 'walls' });
  for (const gm of M.guilds) {
    if (!gm.cur) continue;
    const panel = h('div', { class: 'wall' });
    panel.style.setProperty('--guild', gm.colour);
    panel.append(h('div', { class: 'wall-head' },
      h('span', { class: 'wall-chip' }), h('b', { text: gm.g.name }),
      h('span', { class: 'wall-boss', text: gm.cur.name }),
      h('span', { class: 'wall-best', text: gm.cur.bestPercent != null ? `beste ${fmt(gm.cur.bestPercent, 2)}%` : 'geen pull' })));
    const box = h('div', { class: 'wall-svg' }); panel.append(box); wrap.append(panel);
    gm._box = box;
  }
  el.replaceChildren(wrap);
  for (const gm of M.guilds) {
    if (!gm._box) continue;
    const w = gm._box.clientWidth, H = 170, m = { l: 30, r: 10, t: 10, b: 22 };
    const { pw, ph } = frame(w, H, m);
    const n = Math.max(gm.pulls.length, 1);
    const x = i => m.l + (n === 1 ? pw / 2 : i / (n - 1) * pw), y = p => m.t + (1 - p / 100) * ph;
    const svg = s('svg', { width: w, height: H });
    for (const p of [100, 50, 0]) {
      svg.append(s('line', { class: p ? 'g' : 'g0 kill', x1: m.l, x2: m.l + pw, y1: y(p), y2: y(p) }));
      svg.append(s('text', { class: 'ax', x: m.l - 6, y: y(p) + 4, 'text-anchor': 'end', text: p ? `${p}%` : 'kill' }));
    }
    // raid nights: a gap between pulls more than 6 h apart starts a new night
    let night = 0;
    gm.pulls.forEach((p, i) => { if (i && p.t - gm.pulls[i - 1].t > 6 * 3600000) { night++; svg.append(s('line', { class: 'night', x1: (x(i) + x(i - 1)) / 2, x2: (x(i) + x(i - 1)) / 2, y1: m.t, y2: H - m.b })); } });
    let best = 100, d = '';
    gm.pulls.forEach((p, i) => {
      svg.append(s('circle', { cx: x(i), cy: y(p.percent), r: 2.6, class: 'pull' }, s('title', { text: `pull ${i + 1} · ${fmt(p.percent, 2)}%` })));
      if (p.percent < best) { best = p.percent; d += `${d ? ' H' + x(i) + ' V' : 'M' + x(i) + ','}${y(best)}`; }
    });
    if (d) { d += ` H${x(n - 1)}`; svg.append(s('path', { d, class: 'ln', stroke: gm.colour, 'stroke-width': 2.5 })); }
    svg.append(s('text', { class: 'ax', x: m.l, y: H - 6, text: 'pull 1' }), s('text', { class: 'ax', x: m.l + pw, y: H - 6, 'text-anchor': 'end', text: `pull ${gm.pulls.length} · ${night + 1} avonden` }));
    gm._box.replaceChildren(svg);
  }
}

if (document.getElementById('vA')) fetch('../../data/race.json').then(r => r.json()).then(d => {
  const M = model(d);
  const draw = () => { drawA(document.getElementById('vA'), M); drawB(document.getElementById('vB'), M); drawC(document.getElementById('vC'), M); drawD(document.getElementById('vD'), M); };
  draw(); let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 120); });
});
