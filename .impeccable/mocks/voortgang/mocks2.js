/* Voortgang variants, round 2 (after research): E Klimprofiel, F Tijdsachterstand, G Inspanning,
 * H Pulls per boss. Reuses h, s, fmt, dayLbl, STAR, art, model, frame from mocks.js. */
'use strict';

/* The bosses in the order the race first killed them; unkilled after, the CE boss last. */
function raceOrder(M) {
  const firstAt = slug => { const ts = M.guilds.flatMap(gm => gm.kills.filter(k => k.slug === slug).map(k => k.at)); return ts.length ? Math.min(...ts) : Infinity; };
  const ce = M.d.tier.ceBoss.slug;
  return M.d.tier.raids.flatMap(r => r.bosses.map(b => ({ ...b, raid: r.slug, first: firstAt(b.slug) })))
    .sort((a, b) => (a.slug === ce) - (b.slug === ce) || a.first - b.first);
}
/* How hard a boss was: the median pulls to kill it; a boss nobody killed, the most pulls on it so
 * far (or the hardest kill if nobody pulled it yet). */
function difficulty(M, bosses) {
  const med = a => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const out = new Map();
  for (const b of bosses) {
    const kills = M.guilds.flatMap(gm => gm.kills.filter(k => k.slug === b.slug && k.pullCount).map(k => k.pullCount));
    const trying = M.guilds.filter(gm => gm.cur && gm.cur.slug === b.slug).map(gm => gm.cur.pullCount || 0);
    out.set(b.slug, { pulls: med(kills) ?? (trying.length ? Math.max(...trying) : null), killed: kills.length > 0, trying: trying.length > 0 });
  }
  const known = [...out.values()].map(v => v.pulls).filter(v => v);
  const hardest = Math.max(...known, 20);
  for (const v of out.values()) if (!v.pulls) v.pulls = Math.round(hardest * 1.2);
  return out;
}
const cat = p => p >= 60 ? 'HC' : p >= 40 ? '1' : p >= 22 ? '2' : p >= 10 ? '3' : '4';

/* When a guild first stood at position p (null if never). */
function reachedAt(gm, p) { for (const e of gm.ev) if (e.pos >= p - 1e-9) return e.at; return null; }
function gapNow(M, gm) {
  const p = M.posAt(gm, M.end);
  if (p <= 0) return null;
  const mine = reachedAt(gm, p), first = Math.min(...M.guilds.map(o => reachedAt(o, p)).filter(t => t !== null));
  return (mine - first) / DAY;
}
const gapTxt = g => g === null ? '' : g < 0.05 ? 'leider' : `+${fmt(g, 1)} d`;

/* ---- E · Klimprofiel ---- */
function drawE(el, M) {
  const w = el.clientWidth, narrow = w < 560;
  const bosses = raceOrder(M), diff = difficulty(M, bosses);
  const rowH = narrow ? 22 : 24, H = (narrow ? 330 : 420) + M.guilds.length * rowH, m = { l: narrow ? 14 : 24, r: narrow ? 14 : 30, t: narrow ? 112 : 128, b: 30 + M.guilds.length * rowH + 14 };
  const { pw, ph } = frame(w, H, m);
  const total = bosses.length, sum = bosses.reduce((a, b) => a + diff.get(b.slug).pulls, 0);
  const elev = [0]; bosses.forEach((b, i) => elev.push(elev[i] + diff.get(b.slug).pulls / sum));
  const x = p => m.l + p / total * pw, y = e => m.t + (1 - e) * ph;
  const ridge = p => { const i = Math.min(Math.floor(p), total - 1), f = p - i; return y(elev[i] + (elev[i + 1] - elev[i]) * f); };
  const svg = s('svg', { width: w, height: H });
  const gid = 'eFill';
  svg.append(s('defs', {}, s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
    s('stop', { offset: '0', 'stop-color': '#3fd9a4', 'stop-opacity': '.28' }), s('stop', { offset: '1', 'stop-color': '#3fd9a4', 'stop-opacity': '.02' }))));
  let d = `M${x(0)},${y(0)}`; for (let i = 1; i <= total; i++) d += ` L${x(i)},${y(elev[i])}`;
  svg.append(s('path', { d: `${d} L${x(total)},${H - m.b} L${x(0)},${H - m.b} Z`, fill: `url(#${gid})` }));
  // the road: each climb in its own tone by category
  bosses.forEach((b, i) => {
    const dv = diff.get(b.slug), c = cat(dv.pulls);
    svg.append(s('line', { class: 'g', x1: x(i + 1), x2: x(i + 1), y1: y(elev[i + 1]), y2: H - m.b }));
    svg.append(s('line', { class: `road road--${c}`, x1: x(i), y1: y(elev[i]), x2: x(i + 1), y2: y(elev[i + 1]) }));
    // category chip mid-climb
    const mx = x(i + 0.5), my = (y(elev[i]) + y(elev[i + 1])) / 2;
    if (!narrow || i % 1 === 0) {
      svg.append(s('rect', { class: `catchip catchip--${c}`, x: mx - 13, y: my + 10, width: 26, height: 18 }));
      svg.append(s('text', { class: 'cattxt', x: mx, y: my + 23, 'text-anchor': 'middle', text: c }));
    }
    // the boss at the top of its climb
    const sz = narrow ? 26 : 38, src = art(b.name), tx = x(i + 1), ty = y(elev[i + 1]);
    svg.append(s('line', { class: 'pole', x1: tx, x2: tx, y1: ty - 4, y2: ty - (narrow ? 40 : 52) }));
    if (src) svg.append(s('image', { href: src, x: tx - sz / 2, y: ty - (narrow ? 40 : 52) - sz, width: sz, height: sz, preserveAspectRatio: 'xMidYMin slice' }));
    if (!narrow) svg.append(s('text', { class: 'col-lbl', x: tx, y: ty - 52 - sz - 6, 'text-anchor': 'middle', text: b.name.length > 14 ? `${b.name.slice(0, 13)}…` : b.name }, s('title', { text: `${b.name} · ${dv.killed ? `mediaan ${dv.pulls} pulls` : 'nog niet verslagen'}` })));
  });
  // the summit
  svg.append(s('line', { class: 'g0', x1: x(0), x2: x(total), y1: H - m.b, y2: H - m.b }));
  svg.append(s('text', { class: 'ce', x: x(total), y: H - m.b + 18, 'text-anchor': 'end', text: `CE · ${M.ce}` }));
  svg.append(s('text', { class: 'ax', x: x(0), y: H - m.b + 18, text: 'start' }));
  // the riders
  const riders = M.guilds.map(gm => ({ gm, p: Math.min(M.posAt(gm, M.end), total) })).sort((a, b) => b.p - a.p);
  riders.forEach((r, i) => {
    const rx = x(r.p), ry = ridge(r.p);
    const flagY = H - m.b + 40 + i * rowH;
    svg.append(s('line', { class: 'pole pole--rider', x1: rx, x2: rx, y1: ry, y2: flagY - 10, stroke: r.gm.colour }));
    svg.append(s('circle', { cx: rx, cy: ry, r: 7, fill: r.gm.colour, class: 'rider' }));
    const right = narrow || rx < m.l + pw * 0.62;
    const t = s('text', { class: 'flag', x: narrow ? m.l + 8 : right ? rx + 6 : rx - 6, y: flagY + 4, 'text-anchor': right ? 'start' : 'end', fill: r.gm.colour },
      narrow ? r.gm.g.name.split(' ')[0] : r.gm.g.name, s('tspan', { class: 'endn', text: `  ${fmt(r.p, 1)} · ${gapTxt(gapNow(M, r.gm))}` }));
    svg.append(s('rect', { x: narrow ? m.l : rx - 1, y: flagY - 10, width: narrow ? 4 : 2, height: 16, fill: r.gm.colour }), t);
  });
  el.replaceChildren(svg);
}

/* ---- F · Tijdsachterstand: days behind the first guild to reach the same point ---- */
function drawF(el, M) {
  const w = el.clientWidth, narrow = w < 560, total = M.total;
  const H = narrow ? 300 : 360, m = { l: narrow ? 40 : 52, r: narrow ? 56 : 210, t: 34, b: 34 };
  const { pw, ph } = frame(w, H, m);
  const series = M.guilds.map(gm => {
    const top = Math.min(M.posAt(gm, M.end), total), pts = [];
    for (let p = 0.05; p <= top + 1e-9; p += 0.02) {
      const mine = reachedAt(gm, p); if (mine === null) break;
      const first = Math.min(...M.guilds.map(o => reachedAt(o, p)).filter(t => t !== null));
      pts.push({ p, gap: (mine - first) / DAY });
    }
    return { gm, pts, top };
  });
  const maxGap = Math.max(7, Math.ceil(Math.max(...series.flatMap(sr => sr.pts.map(q => q.gap))) / 7) * 7);
  const x = p => m.l + p / total * pw, y = g => m.t + g / maxGap * ph;
  const svg = s('svg', { width: w, height: H });
  svg.append(s('rect', { class: 'lead-band', x: m.l, y: m.t - 22, width: pw, height: 22 }));
  svg.append(s('text', { class: 'lead-lbl', x: m.l + 10, y: m.t - 7, text: 'EERSTE OP DIT PUNT' }));
  for (let g = 0; g <= maxGap; g += 7) {
    svg.append(s('line', { class: g ? 'g' : 'g0', x1: m.l, x2: m.l + pw, y1: y(g), y2: y(g) }));
    if (g) svg.append(s('text', { class: 'ax', x: m.l - 8, y: y(g) + 4, 'text-anchor': 'end', text: `+${g} d` }));
  }
  for (let k = 1; k <= total; k++) {
    svg.append(s('line', { class: 'g', x1: x(k), x2: x(k), y1: m.t, y2: H - m.b }));
    svg.append(s('text', { class: k === total ? 'ce' : 'ax', x: x(k), y: H - m.b + 18, 'text-anchor': 'middle', text: k === total ? 'CE' : `${k}` }));
  }
  svg.append(s('text', { class: 'ax', x: m.l, y: H - 4, text: 'bosses verslagen →' }));
  const ends = [];
  series.forEach(sr => {
    if (!sr.pts.length) return;
    const d = sr.pts.map((q, j) => `${j ? 'L' : 'M'}${x(q.p)},${y(q.gap)}`).join(' ');
    svg.append(s('path', { d, class: 'ln', stroke: sr.gm.colour, 'stroke-width': 2.5 }));
    const last = sr.pts[sr.pts.length - 1];
    svg.append(s('circle', { cx: x(last.p), cy: y(last.gap), r: 5, fill: sr.gm.colour, class: 'dot' }));
    ends.push({ sr, last, y: y(last.gap) });
  });
  ends.sort((a, b) => a.y - b.y); ends.forEach((e, i) => { if (i && e.y - ends[i - 1].y < 18) e.y = ends[i - 1].y + 18; });
  for (const e of ends) svg.append(s('text', { class: 'end', x: m.l + pw + 10, y: e.y + 5, fill: e.sr.gm.colour },
    narrow ? '' : `${e.sr.gm.g.name} `, s('tspan', { class: 'endn', text: gapTxt(e.last.gap) })));
  el.replaceChildren(svg);
}

/* ---- G · Inspanning: progress per pull instead of per day ---- */
function drawG(el, M) {
  const w = el.clientWidth, narrow = w < 560, total = M.total;
  const series = M.guilds.map(gm => {
    const pts = [{ c: 0, p: 0 }]; let c = 0;
    gm.kills.forEach((k, n) => { c += k.pullCount || 1; pts.push({ c, p: n + 1 }); });
    let best = 100;
    gm.pulls.forEach(pl => { c += 1; if (!pl.success && pl.percent < best) best = pl.percent; pts.push({ c, p: gm.kills.length + (100 - best) / 100 }); });
    return { gm, pts, c };
  });
  const maxC = Math.ceil(Math.max(...series.map(sr => sr.c)) / 50) * 50;
  const H = narrow ? 300 : 380, m = { l: narrow ? 30 : 44, r: narrow ? 56 : 230, t: 40, b: 34 };
  const { pw, ph } = frame(w, H, m);
  const x = c => m.l + c / maxC * pw, y = p => m.t + (1 - p / total) * ph;
  const svg = s('svg', { width: w, height: H });
  svg.append(s('rect', { class: 'fin-band', x: m.l, y: y(total) - 24, width: pw, height: 24 }));
  svg.append(s('line', { class: 'fin', x1: m.l, x2: m.l + pw, y1: y(total), y2: y(total) }));
  svg.append(s('text', { class: 'ce', x: m.l + 10, y: y(total) - 8, text: `CUTTING EDGE · ${M.ce.toUpperCase()}` }));
  for (let k = 1; k < total; k++) {
    svg.append(s('line', { class: 'g', x1: m.l, x2: m.l + pw, y1: y(k), y2: y(k) }));
    if (!narrow || k % 3 === 0) svg.append(s('text', { class: 'ax', x: m.l - 8, y: y(k) + 4, 'text-anchor': 'end', text: `${k}` }));
  }
  for (let c = 0; c <= maxC; c += 50) svg.append(s('text', { class: 'ax', x: x(c), y: H - m.b + 18, 'text-anchor': 'middle', text: `${c}` }));
  svg.append(s('text', { class: 'ax', x: m.l + pw, y: H - 4, 'text-anchor': 'end', text: 'pulls in totaal →' }));
  const ends = [];
  [...series].reverse().forEach((sr, i) => {
    const d = sr.pts.map((q, j) => `${j ? 'L' : 'M'}${x(q.c)},${y(q.p)}`).join(' ');
    svg.append(s('path', { d, class: 'ln', stroke: sr.gm.colour, 'stroke-width': i === series.length - 1 ? 3 : 2.25 }));
    sr.gm.kills.forEach((k, n) => {
      const q = sr.pts[n + 1];
      if (sr.gm.isFirst(k)) svg.append(s('path', { class: 'star', d: STAR, transform: `translate(${x(q.c)},${y(q.p)})` }));
    });
    const last = sr.pts[sr.pts.length - 1];
    ends.push({ sr, last, y: y(last.p) });
  });
  ends.sort((a, b) => a.y - b.y); ends.forEach((e, i) => { if (i && e.y - ends[i - 1].y < 18) e.y = ends[i - 1].y + 18; });
  for (const e of ends) svg.append(s('text', { class: 'end', x: m.l + pw + 10, y: e.y + 5, fill: e.sr.gm.colour },
    narrow ? '' : `${e.sr.gm.g.name} `, s('tspan', { class: 'endn', text: `${fmt(e.last.p, 1)} · ${e.sr.c} pulls` })));
  el.replaceChildren(svg);
}

/* ---- H · Pulls per boss (Method.gg's comparison): per boss a bar per guild ---- */
function drawH(el, M) {
  const bosses = raceOrder(M);
  const rows = bosses.map(b => {
    const bars = M.guilds.map(gm => {
      const k = gm.kills.find(kk => kk.slug === b.slug);
      if (k) return { gm, pulls: k.pullCount || 0, kill: true, first: gm.isFirst(k), at: k.at };
      if (gm.cur && gm.cur.slug === b.slug) return { gm, pulls: gm.cur.pullCount || 0, kill: false, best: gm.cur.bestPercent };
      return null;
    }).filter(Boolean).sort((a, c) => (c.kill - a.kill) || (a.kill ? a.at - c.at : c.pulls - a.pulls));
    return { b, bars };
  });
  const max = Math.max(...rows.flatMap(r => r.bars.map(x2 => x2.pulls)), 10);
  const grid = h('div', { class: 'hgrid' });
  for (const r of rows) {
    const src = art(r.b.name);
    const block = h('div', { class: 'hrow' },
      h('div', { class: 'hboss' },
        src ? h('span', { class: 'boss-thumb' }, h('img', { src, alt: '' })) : h('span', { class: 'boss-thumb' }),
        h('span', {}, h('b', { text: r.b.name }), h('small', { text: r.bars.length ? `${r.bars.filter(x2 => x2.kill).length} van ${M.guilds.length} verslagen` : 'nog door niemand geprobeerd' }),
          r.b.slug === M.d.tier.ceBoss.slug ? h('em', { text: 'CE' }) : null)),
      h('div', { class: 'hbars' }, ...r.bars.map(x2 => {
        const bar = h('div', { class: `hbar${x2.kill ? '' : ' is-open'}` },
          h('span', { class: 'hbar-name', text: x2.gm.g.name }),
          h('span', { class: 'hbar-track' }, h('i', {})),
          h('span', { class: 'hbar-n' }, x2.first ? h('b', { class: 'hstar', text: '' }) : null,
            x2.kill ? `${x2.pulls}` : `${x2.pulls} · nog ${fmt(x2.best ?? 100, 1)}%`));
        bar.style.setProperty('--guild', x2.gm.colour);
        bar.style.setProperty('--w', `${Math.max(1.5, x2.pulls / max * 100)}%`);
        return bar;
      })));
    grid.append(block);
  }
  el.replaceChildren(grid);
}

if (document.getElementById('vE')) fetch('../../data/race.json').then(r => r.json()).then(d => {
  const M = model(d);
  const draw = () => { drawE(document.getElementById('vE'), M); drawF(document.getElementById('vF'), M); drawG(document.getElementById('vG'), M); drawH(document.getElementById('vH'), M); };
  draw(); let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 120); });
});
