/* Voortgang variants, round 3: I De ronde, J Raidkalender, K Inhaalmanoeuvres, L Wedstrijdverslag,
 * M Pull-mozaïek, N Kleine veelvouden. Reuses helpers from mocks.js and raceOrder() from mocks2.js. */
'use strict';
const HOUR = 3600000;
const rankAt = (M, t) => M.guilds.map(gm => ({ gm, p: M.posAt(gm, t) })).sort((a, b) => b.p - a.p || a.gm.g.rank - b.gm.g.rank);
const dayNoOf = (M, t) => Math.floor((t - M.tierStart) / DAY) + 1;
const localDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* Overtakes: hourly, every pair whose order swapped. */
function overtakes(M) {
  const out = []; let prev = null;
  for (let t = M.start; t <= M.end; t += HOUR) {
    const order = rankAt(M, t).map(r => r.gm);
    if (prev) order.forEach((gm, i) => {
      const was = prev.indexOf(gm);
      if (i < was) for (let j = i + 1; j <= was; j++) if (prev.indexOf(order[j]) < was) out.push({ t, gm, over: order[j], rank: i + 1 });
    });
    prev = order;
  }
  return out.filter(o => M.posAt(o.over, o.t) > 0 || M.posAt(o.gm, o.t) >= 1);
}

/* ---- I · De ronde: an athletics track, CE at the top ---- */
function drawI(el, M) {
  const w = el.clientWidth, narrow = w < 560, total = M.total;
  const size = Math.min(w - 24, narrow ? 360 : 560), H = size + 40;
  const cx = w / 2, cy = H / 2 + 6, R = size / 2 - (narrow ? 40 : 64), lane = narrow ? 13 : 18;
  const svg = s('svg', { width: w, height: H });
  const ang = p => -Math.PI / 2 + (p / total) * Math.PI * 2 * 0.94 + Math.PI * 0.03;
  const pt = (p, r) => [cx + r * Math.cos(ang(p)), cy + r * Math.sin(ang(p))];
  const arc = (p0, p1, r) => { const [x0, y0] = pt(p0, r), [x1, y1] = pt(p1, r); const big = (p1 - p0) / total * 0.94 > 0.5 ? 1 : 0; return `M${x0},${y0} A${r},${r} 0 ${big} 1 ${x1},${y1}`; };
  const order = rankAt(M, M.end);
  order.forEach((r, i) => {
    const rr = R - i * lane;
    svg.append(s('path', { d: arc(0, total, rr), class: 'lane' }));
    if (r.p > 0) svg.append(s('path', { d: arc(0, Math.max(0.02, r.p), rr), class: 'lane-fill', stroke: r.gm.colour }));
    const [rx, ry] = pt(Math.max(0, r.p), rr);
    svg.append(s('circle', { cx: rx, cy: ry, r: narrow ? 5 : 7, fill: r.gm.colour, class: 'rider' }));
  });
  // boss ticks and heads round the outside, in race order
  raceOrder(M).forEach((b, i) => {
    const [ax, ay] = pt(i + 1, R + 6), [bx, by] = pt(i + 1, R - (order.length - 1) * lane - 8);
    svg.append(s('line', { class: i + 1 === total ? 'fin' : 'g', x1: ax, y1: ay, x2: bx, y2: by }));
    const src = art(b.name), sz = narrow ? 26 : 40, [hx, hy] = pt(i + 1, R + (narrow ? 22 : 34));
    if (src) svg.append(s('image', { href: src, x: hx - sz / 2, y: hy - sz / 2, width: sz, height: sz, preserveAspectRatio: 'xMidYMin slice' }, s('title', { text: b.name })));
  });
  const [sx, sy] = pt(0, R + 10);
  svg.append(s('text', { class: 'now-lbl', x: sx + 4, y: sy - 4, text: 'START' }));
  // centre: the standings
  const lead = order[0];
  svg.append(s('text', { class: 'ring-day', x: cx, y: cy - (narrow ? 34 : 54), 'text-anchor': 'middle', text: `DAG ${dayNoOf(M, M.end)}` }));
  order.forEach((r, i) => svg.append(s('text', { class: 'ring-row', x: cx, y: cy - (narrow ? 12 : 24) + i * (narrow ? 15 : 21), 'text-anchor': 'middle', fill: r.gm.colour },
    `${i + 1}. ${narrow ? r.gm.g.name.split(' ')[0] : r.gm.g.name} `, s('tspan', { class: 'endn', text: fmt(r.p, 1) }))));
  void lead;
  el.replaceChildren(svg);
}

/* ---- J · Raidkalender: a row per guild, a cell per day ---- */
function drawJ(el, M) {
  const days = []; for (let t = localDay(M.start); t <= M.end; t += DAY) days.push(t);
  const w = el.clientWidth, narrow = w < 560, lw = narrow ? 0 : 170;
  const cell = Math.max(10, Math.min(30, Math.floor((w - lw - 24) / days.length) - 2)), gap = 2;
  const rowH = cell + (narrow ? 22 : 10), top = 30;
  const H = top + M.guilds.length * rowH + 8;
  const svg = s('svg', { width: Math.max(w, lw + days.length * (cell + gap) + 16), height: H });
  const x = i => lw + 8 + i * (cell + gap);
  days.forEach((t, i) => {
    const dd = new Date(t);
    if (dd.getDay() === 3) svg.append(s('text', { class: 'ax', x: x(i), y: 16, text: dayLbl(t) }));
    if (dd.getDay() === 3) svg.append(s('line', { class: 'g0', x1: x(i) - 1, x2: x(i) - 1, y1: 22, y2: H - 4 }));
  });
  M.guilds.forEach((gm, gi) => {
    const y0 = top + gi * rowH + (narrow ? 16 : 0);
    if (narrow) svg.append(s('text', { class: 'lane-name', x: 8, y: y0 - 4, fill: gm.colour, text: gm.g.name }));
    else svg.append(s('text', { class: 'lane-name', x: 0, y: y0 + cell / 2 + 5, text: gm.g.name }));
    const active = new Set([...gm.ev.map(e => localDay(e.at)), ...gm.pulls.map(p => localDay(p.t))]);
    const killsByDay = new Map(); gm.kills.forEach(k => { const d0 = localDay(k.at); killsByDay.set(d0, [...(killsByDay.get(d0) || []), k]); });
    days.forEach((t, i) => {
      const ks = killsByDay.get(t);
      const cls = ks ? (ks.some(k => gm.isFirst(k)) ? 'cal cal--first' : 'cal cal--kill') : active.has(t) ? 'cal cal--on' : 'cal';
      const r = s('rect', { class: cls, x: x(i), y: y0, width: cell, height: cell, fill: gm.colour },
        s('title', { text: `${gm.g.name} · ${dayLbl(t)}${ks ? ` · ${ks.map(k => k.name).join(', ')}` : active.has(t) ? ' · geraid' : ''}` }));
      svg.append(r);
      if (ks && cell >= 16) svg.append(s('text', { class: 'cal-n', x: x(i) + cell / 2, y: y0 + cell / 2 + 4, 'text-anchor': 'middle', text: String(ks.length) }));
    });
  });
  el.replaceChildren(svg);
}

/* ---- K · Inhaalmanoeuvres: positions over time, every overtake marked ---- */
function drawK(el, M) {
  const w = el.clientWidth, narrow = w < 560, n = M.guilds.length;
  const H = narrow ? 300 : 340, m = { l: narrow ? 26 : 36, r: narrow ? 90 : 190, t: 20, b: 30 };
  const { pw, ph } = frame(w, H, m);
  const t0 = Math.min(...M.guilds.flatMap(gm => gm.kills.map(k => k.at))) - DAY / 2;
  const x = t => m.l + (t - t0) / (M.end - t0) * pw, y = r => m.t + (r - 1) / (n - 1) * ph;
  const svg = s('svg', { width: w, height: H });
  for (let r = 1; r <= n; r++) {
    svg.append(s('line', { class: 'g', x1: m.l, x2: m.l + pw, y1: y(r), y2: y(r) }));
    svg.append(s('text', { class: 'ax', x: m.l - 10, y: y(r) + 4, 'text-anchor': 'end', text: `${r}` }));
  }
  for (let t = M.tierStart + Math.ceil((t0 - M.tierStart) / (7 * DAY)) * 7 * DAY; t <= M.end; t += 7 * DAY) svg.append(s('text', { class: 'ax', x: x(t), y: H - 8, 'text-anchor': 'middle', text: dayLbl(t) }));
  const samples = []; for (let t = t0; t <= M.end; t += HOUR * 3) samples.push(t); samples.push(M.end);
  const ranks = samples.map(t => rankAt(M, t).map(r => r.gm));
  M.guilds.forEach(gm => {
    let d = '';
    samples.forEach((t, i) => { const r = ranks[i].indexOf(gm) + 1; d += `${i ? ' L' : 'M'}${x(t)},${y(r)}`; });
    svg.append(s('path', { d, class: 'ln bump', stroke: gm.colour }));
    const r = ranks[ranks.length - 1].indexOf(gm) + 1;
    svg.append(s('text', { class: 'end', x: m.l + pw + 10, y: y(r) + 5, fill: gm.colour }, narrow ? gm.g.name.split(' ')[0] : gm.g.name));
  });
  const ov = overtakes(M).filter(o => o.t > t0 + DAY);
  const placed = [];
  ov.forEach(o => {
    svg.append(s('circle', { cx: x(o.t), cy: y(o.rank), r: 6, class: 'ov', stroke: o.gm.colour }, s('title', { text: `${o.gm.g.name} passeert ${o.over.g.name} · ${dayLbl(o.t)}` })));
    if (narrow) return;
    // a label only where it has room; the ring keeps its tooltip either way
    const above = !placed.some(p => p.up && Math.abs(p.x - x(o.t)) < 150 && p.r === o.rank);
    const below = !placed.some(p => !p.up && Math.abs(p.x - x(o.t)) < 150 && p.r === o.rank);
    if (!above && !below) return;
    placed.push({ x: x(o.t), r: o.rank, up: above });
    svg.append(s('text', { class: 'ov-lbl', x: x(o.t), y: y(o.rank) + (above ? -12 : 22), 'text-anchor': 'middle', text: `${o.gm.g.name.split(' ')[0]} › ${o.over.g.name.split(' ')[0]}` }));
  });
  el.replaceChildren(svg);
}

/* ---- L · Wedstrijdverslag: the race as a live blog, newest day first ---- */
function drawL(el, M) {
  const ev = [];
  M.guilds.forEach(gm => gm.kills.forEach((k, n) => ev.push({ t: k.at, kind: gm.isFirst(k) ? 'first' : 'kill', gm, k, n: n + 1 })));
  overtakes(M).forEach(o => ev.push({ t: o.t, kind: 'pass', gm: o.gm, over: o.over, rank: o.rank }));
  const byDay = new Map(); ev.sort((a, b) => b.t - a.t).forEach(e => { const d0 = localDay(e.t); byDay.set(d0, [...(byDay.get(d0) || []), e]); });
  const list = h('ol', { class: 'blog' });
  for (const [d0, es] of byDay) {
    const stand = rankAt(M, d0 + DAY - 1);
    list.append(h('li', { class: 'blog-day' },
      h('div', { class: 'blog-when' }, h('b', { text: `Dag ${dayNoOf(M, d0)}` }), h('span', { text: new Date(d0).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }) })),
      h('div', { class: 'blog-body' },
        h('ul', { class: 'blog-ev' }, ...es.map(e => {
          const li = h('li', { class: `blog-e blog-e--${e.kind}` },
            h('span', { class: 'blog-t', text: new Date(e.t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) }),
            e.kind === 'pass'
              ? h('span', {}, h('b', { text: e.gm.g.name }), ` passeert ${e.over.g.name} en staat ${e.rank}e.`)
              : h('span', {}, h('b', { text: e.gm.g.name }), e.kind === 'first' ? ' is de eerste die ' : ' verslaat ', h('b', { text: e.k.name }),
                e.kind === 'first' ? ' verslaat' : '', ` (${e.n}e kill, ${e.k.pullCount === 1 ? '1 pull' : `${e.k.pullCount || '?'} pulls`}).`));
          li.style.setProperty('--guild', e.gm.colour);
          return li;
        })),
        h('div', { class: 'blog-stand' }, ...stand.map((r, i) => { const c = h('span', { text: `${i + 1} ${r.gm.g.name.split(' ')[0]} ${fmt(r.p, 1)}` }); c.style.setProperty('--guild', r.gm.colour); return c; })))));
  }
  el.replaceChildren(list);
}

/* ---- M · Pull-mozaïek: every pull a square, per boss a block ---- */
function drawM(el, M) {
  const wrap = h('div', { class: 'mosaic' });
  for (const gm of M.guilds) {
    const blocks = gm.kills.map(k => ({ name: k.name, n: Math.max(1, k.pullCount || 1), kill: true, first: gm.isFirst(k), pulls: null }));
    if (gm.cur) blocks.push({ name: gm.cur.name, n: gm.pulls.length || gm.cur.pullCount || 0, kill: false, pulls: gm.pulls });
    const total = blocks.reduce((a, b) => a + b.n, 0);
    const row = h('div', { class: 'mo-row' },
      h('div', { class: 'mo-who' }, h('b', { text: gm.g.name }), h('span', { text: `${total} pulls · ${gm.kills.length}/${M.total}` })),
      h('div', { class: 'mo-blocks' }, ...blocks.map(b => {
        const sq = Array.from({ length: b.n }, (_, i) => {
          const last = b.kill && i === b.n - 1;
          const q = h('i', { class: last ? (b.first ? 'q q--first' : 'q q--kill') : 'q', title: b.pulls && b.pulls[i] ? `${b.name} · pull ${i + 1} · ${fmt(b.pulls[i].percent, 1)}%` : `${b.name} · pull ${i + 1}` });
          if (b.pulls && b.pulls[i]) q.style.setProperty('--hp', String(b.pulls[i].percent / 100));
          return q;
        });
        return h('div', { class: `mo-block${b.kill ? '' : ' is-open'}` }, h('div', { class: 'mo-grid' }, ...sq),
          h('small', { text: b.name.length > 14 ? `${b.name.slice(0, 13)}…` : b.name }));
      })));
    row.style.setProperty('--guild', gm.colour);
    wrap.append(row);
  }
  el.replaceChildren(wrap);
}

/* ---- N · Kleine veelvouden: a chart per guild, the others faint behind ---- */
function drawN(el, M) {
  const grid = h('div', { class: 'smalls' });
  el.replaceChildren(grid);
  for (const gm of M.guilds) {
    const p = M.posAt(gm, M.end);
    const panel = h('div', { class: 'small' },
      h('div', { class: 'small-head' }, h('b', { text: gm.g.name }), h('span', { class: 'small-n', text: `${fmt(p, 1)} / ${M.total}` })),
      h('div', { class: 'small-svg' }));
    panel.style.setProperty('--guild', gm.colour);
    grid.append(panel);
    const box = panel.querySelector('.small-svg');
    const w = box.clientWidth, H = 150, m = { l: 6, r: 6, t: 14, b: 16 };
    const { pw, ph } = frame(w, H, m);
    const x = t => m.l + (t - M.start) / (M.end - M.start) * pw, y = k => m.t + (1 - k / M.total) * ph;
    const svg = s('svg', { width: w, height: H });
    svg.append(s('rect', { class: 'fin-band', x: m.l, y: y(M.total) - 10, width: pw, height: 10 }));
    svg.append(s('line', { class: 'fin', x1: m.l, x2: m.l + pw, y1: y(M.total), y2: y(M.total) }));
    const path = o => { let d = `M${x(M.start)},${y(0)}`; for (const e of o.ev) d += ` H${x(e.at)} V${y(e.pos)}`; return `${d} H${x(M.end)}`; };
    for (const o of M.guilds) if (o !== gm) svg.append(s('path', { d: path(o), class: 'ln ghost' }));
    svg.append(s('path', { d: `${path(gm)} V${y(0)} H${x(M.start)} Z`, class: 'area', fill: gm.colour }));
    svg.append(s('path', { d: path(gm), class: 'ln', stroke: gm.colour, 'stroke-width': 2.5 }));
    gm.kills.forEach((k, n) => { if (gm.isFirst(k)) svg.append(s('path', { class: 'star', d: STAR, transform: `translate(${x(k.at)},${y(n + 1)}) scale(.8)` })); });
    svg.append(s('text', { class: 'ax', x: m.l, y: H - 2, text: dayLbl(M.start) }), s('text', { class: 'ax', x: m.l + pw, y: H - 2, 'text-anchor': 'end', text: 'nu' }));
    box.append(svg);
  }
}

fetch('../../data/race.json').then(r => r.json()).then(d => {
  const M = model(d);
  const ids = { vI: drawI, vJ: drawJ, vK: drawK, vL: drawL, vM: drawM, vN: drawN };
  const draw = () => { for (const [id, f] of Object.entries(ids)) f(document.getElementById(id), M); };
  draw(); let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 120); });
});
