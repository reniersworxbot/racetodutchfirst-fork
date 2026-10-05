/* Race to Dutch First: Voortgang, the race over time, in two views on one moment.
 *
 * - Grafiek: a step line per guild (a tread per kill, part steps for new best pulls) under the
 *   finish: a jade band with the CE boss's head. Right of the lines a bar per guild shows the
 *   distance still to go. Drag across the chart (mouse) to zoom in on a stretch; Alles / 2 weken /
 *   1 week pick one. Hover, tap or the arrow keys pick a moment: a crosshair and the standings at
 *   that moment.
 * - Plaatsen: the place in the race over time (a bump chart), every overtake ringed.
 * - Replay: a lane per guild on the board's race track (a segment per boss, the finish at the
 *   end), at the chosen moment; a slider and a play button run the race again.
 * - Ronde: the race as an athletics track, CE at the top, a lane per guild; same slider and play.
 * And on other parts of the page: the Wedstrijdverslag (#raceLog), the race day by day as a live
 * blog, and on the Guilds view a small chart per guild (#guildSmall), its own line in colour and
 * the others faint behind it.
 *
 * app.js's renderTimeline() calls Voortgang.render(data). Uses app.js's globals: h, s, svgTitle,
 * chart, tr, num, day, colour, setGuild, killsOf, stepPoints, currentProgress, timelineStart,
 * seasonEnd, raidDays, leaderName, isFirstKill, bossArtFor, motionNow, drawLineFrom, STAR,
 * reducedMotion, isArchive. textContent only; styles only through custom properties. */
'use strict';

const Voortgang = (() => {
  const DAY = 86400000, WEEK = 7 * DAY, HOUR = 3600000;
  const PLAY_MS = 14000;

  // What the visitor chose; survives refreshes and NL | EN, resets with the season.
  const st = { mode: 'chart', zoom: null, t: null, pinned: false, season: null, focus: null, logAll: false };
  const MODES = ['chart', 'bump', 'replay', 'ring'];
  const PLAYER = new Set(['replay', 'ring']);
  let data = null, model = null, geo = null, scrubLayer = null, play = null;

  /* ---- the model: every guild's race position over time --------------------------------- */

  /* A guild's position as steps { at, pos }: a kill lifts it to the next whole number, a new best
   * pull on the boss it was working on to n + (100 - best %) / 100. Pulls before a tread began
   * count from its start; the running max keeps it monotonic. */
  function seriesOf(g, end) {
    const kills = killsOf(g);
    const ev = [];
    let from = -Infinity;
    kills.forEach((k, n) => {
      for (const p of stepPoints(k.progress)) if (p.at < k.at) ev.push({ at: Math.max(p.at, from), pos: n + p.frac });
      ev.push({ at: k.at, pos: n + 1 });
      from = k.at;
    });
    const prog = currentProgress(g);
    for (const p of prog.points) ev.push({ at: Math.max(p.at, from), pos: kills.length + p.frac });
    if (prog.frac && !prog.points.length) ev.push({ at: end, pos: kills.length + prog.frac });
    ev.sort((a, b) => a.at - b.at);
    let max = 0;
    for (const e of ev) { max = Math.max(max, e.pos); e.pos = max; }
    return { g, kills, ev, prog };
  }
  function posAt(sr, t) {
    let pos = 0;
    for (const e of sr.ev) { if (e.at > t) break; pos = e.pos; }
    return Math.min(pos, model.total);
  }
  // At moment t: kills so far, the boss being worked on and how much of it was left.
  function stateAt(sr, t) {
    const pos = posAt(sr, t);
    const k = sr.kills.filter(x => x.at <= t).length;
    const next = sr.kills[k] ? sr.kills[k].name : sr.g.current && !sr.g.ceKilledAt ? sr.g.current.name : null;
    return { pos, k, frac: pos - k, boss: k >= model.total ? null : next };
  }
  function standingsAt(t) {
    return model.series.map(sr => ({ sr, ...stateAt(sr, t) }))
      .sort((a, b) => b.pos - a.pos || a.sr.g.rank - b.sr.g.rank);
  }

  function buildModel(d) {
    const start = timelineStart(d);
    const end = Math.max(seasonEnd(d), start + DAY);
    return {
      start, end, total: d.tier.totalBosses, lead: leaderName(d),
      tierStart: Date.parse(`${d.tier.start}T00:00:00Z`),
      series: d.guilds.map(g => seriesOf(g, end)),
      ceHead: bossArtFor(d.tier.ceBoss.name)[0] || null,
      ceName: d.tier.ceBoss.name,
      isRaidDay: raidDays(d),
    };
  }
  /* Overtakes: every three hours from the first kill, each pair whose order swapped. */
  function passesOf() {
    const out = [];
    const firstKill = Math.min(...model.series.flatMap(sr => sr.kills.map(k => k.at)));
    if (!Number.isFinite(firstKill)) return out;
    let prev = null;
    for (let t = firstKill; ; t = Math.min(t + 3 * HOUR, model.end)) {
      const order = standingsAt(t).map(r => r.sr);
      if (prev) order.forEach((sr, i) => {
        const was = prev.indexOf(sr);
        for (let j = i + 1; j <= was; j++) if (prev.indexOf(order[j]) < was) out.push({ t, sr, over: order[j], rank: i + 1 });
      });
      prev = order;
      if (t >= model.end) break;
    }
    return out;
  }

  const clampT = t => Math.min(Math.max(t, model.start), model.end);
  const dayNo = t => Math.floor((t - model.tierStart) / DAY) + 1;
  const go = pos => num(Math.max(0, model.total - pos), 1);
  function when(t, withTime) {
    return new Date(t).toLocaleString(i18n.locale, withTime
      ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const domain = () => st.zoom || [model.start, model.end];

  /* ---- the chart ------------------------------------------------------------------------ */

  function drawChart(el) {
    chart(el, w => {
      const narrow = w < 560;
      const full = el.closest('.is-full');
      const total = model.total;
      const H = full ? Math.max(260, Math.floor(el.clientHeight) - 18) : narrow ? 320 : 420;
      // Right: the guild names (wide) or only the counts (narrow).
      const gut = narrow ? 6 : 12;
      const m = { l: narrow ? 30 : 44, r: (narrow ? 40 : 262) + gut, t: narrow ? 42 : 48, b: 30 };
      const [d0, d1] = domain();
      const pw = w - m.l - m.r, ph = H - m.t - m.b;
      const x = t => m.l + ((t - d0) / (d1 - d0)) * pw;
      const y = k => m.t + (1 - k / total) * ph;
      geo = { m, pw, ph, H, w, x, y, d0, d1, inv: px => d0 + ((px - m.l) / pw) * (d1 - d0), narrow };

      const svg = s('svg', { width: w, height: H, viewBox: `0 0 ${w} ${H}`, role: 'img' });
      svg.append(svgTitle(data.guilds.map(g => tr('timeline.kills', { guild: g.name, n: g.mythicKills })).join(', ')));
      const clip = s('clipPath', { id: 'vgClip' }, s('rect', { x: m.l, y: 0, width: pw + 2, height: H }));
      svg.append(s('defs', {}, clip));
      const plot = s('g', { 'clip-path': 'url(#vgClip)' });

      // Raid nights as shaded day columns.
      const night = new Date(d0);
      night.setHours(0, 0, 0, 0);
      for (; night.getTime() < d1; night.setDate(night.getDate() + 1)) {
        if (!model.isRaidDay(night.getTime() + 12 * HOUR)) continue;
        const next = new Date(night);
        next.setDate(next.getDate() + 1);
        const a = x(Math.max(night.getTime(), d0)), b = x(Math.min(next.getTime(), d1));
        if (b > a) plot.append(s('rect', { class: 'svg-night', x: a, y: y(total), width: b - a, height: ph }));
      }
      svg.append(plot);

      // Levels: a rule per kill count, labelled; the top one is the finish.
      for (let k = 0; k < total; k++) {
        svg.append(s('line', { class: 'svg-grid', x1: m.l, x2: m.l + pw, y1: y(k), y2: y(k) }));
        if (k && (!narrow || k % 3 === 0)) {
          svg.append(s('text', { class: 'svg-axis', x: m.l - 8, y: y(k) + 4, 'text-anchor': 'end', text: `${k}/${total}` }));
        }
      }

      // The finish: a jade band over the top level with the CE boss's head and name.
      const bandH = narrow ? 28 : 32;
      svg.append(s('rect', { class: 'svg-finish', x: m.l, y: y(total) - bandH, width: pw + gut, height: bandH }));
      svg.append(s('line', { class: 'svg-finish__line', x1: m.l, x2: m.l + pw + gut, y1: y(total), y2: y(total) }));
      let lx = m.l + 10;
      if (model.ceHead) {
        const sz = bandH - 4;
        svg.append(s('image', { href: model.ceHead, x: m.l + 4, y: y(total) - bandH + 2, width: sz, height: sz, preserveAspectRatio: 'xMidYMin slice' }));
        lx = m.l + sz + 12;
      }
      svg.append(s('text', { class: 'svg-finish__label', x: lx, y: y(total) - bandH / 2 + 4.5, text: tr('vg.finish', { boss: model.ceName }) }));
      // The key: the chart's own marks, named once, at the right of the band (no caption needed).
      // Laid out right to left once the svg is in the page (text widths need a rendered svg).
      let key = null;
      if (!narrow) {
        key = { y: y(total) - bandH / 2, x: m.l + pw - 8,
          kill: s('text', { class: 'svg-key', 'text-anchor': 'end', text: tr('vg.keyKill') }),
          node: s('circle', { class: 'svg-node svg-node--key', r: 4 }),
          first: s('text', { class: 'svg-key', 'text-anchor': 'end', text: tr('vg.keyFirst') }),
          star: s('path', { class: 'svg-star', d: STAR }) };
        svg.append(key.kill, key.node, key.first, key.star);
      }

      // Time ticks: weekly resets when zoomed out, days when zoomed in; labelled where there's room.
      const span = d1 - d0;
      const step = [DAY, 2 * DAY, WEEK].find(st2 => (st2 / span) * pw >= 58) || WEEK;
      const ticks = [];
      if (step >= WEEK) {
        for (let t = model.start + Math.ceil((d0 - model.start) / WEEK) * WEEK; t <= d1; t += WEEK) ticks.push(t);
      } else {
        const dd = new Date(d0);
        dd.setHours(0, 0, 0, 0);
        if (dd.getTime() < d0) dd.setDate(dd.getDate() + 1);
        for (let i = 0; dd.getTime() <= d1; dd.setDate(dd.getDate() + 1), i++) if (i % (step / DAY) === 0) ticks.push(dd.getTime());
      }
      for (const t of ticks) {
        svg.append(s('line', { class: 'svg-grid', x1: x(t), x2: x(t), y1: H - m.b, y2: H - m.b + 4 }));
        svg.append(s('text', { class: 'svg-axis', x: x(t), y: H - 9, 'text-anchor': 'middle', text: day(new Date(t).toISOString()) }));
      }

      // The lines: the leader last, so it sits on top where lines overlap.
      const order = [...model.series].reverse();
      const drawFrom = [];
      order.forEach((sr, i) => {
        const g = sr.g;
        const off = (i - (order.length - 1) / 2) * 2; // keep equal lines apart
        let d = `M${x(model.start)},${y(0) + off}`;
        for (const e of sr.ev) d += ` H${x(e.at)} V${y(e.pos) + off}`;
        d += ` H${x(model.end)}`;
        const line = s('path', { d, class: 'svg-step', 'data-guild': g.name, 'stroke-width': g.name === model.lead ? 3 : 2.25 });
        line.style.setProperty('--guild', colour(g.colour));
        plot.append(line);
        const since = motionNow && motionNow.guilds.get(g.name);
        if (since && since.lastAt) drawFrom.push({ line, fromX: x(Math.max(since.lastAt, d0)) });
        sr.kills.forEach((k, n) => {
          const title = svgTitle(tr('timeline.point', { guild: g.name, boss: k.name, date: day(k.iso), n: n + 1 }));
          if (isFirstKill(data, k, g)) {
            plot.append(s('path', { class: 'svg-star', 'data-guild': g.name, d: STAR, transform: `translate(${x(k.at)},${y(n + 1) + off})` }, title));
          } else {
            const dot = s('circle', { class: 'svg-node', 'data-guild': g.name, cx: x(k.at), cy: y(n + 1) + off, r: 4 }, title);
            dot.style.setProperty('--guild', colour(g.colour));
            plot.append(dot);
          }
        });
      });

      // Line ends: name, count and the way still to go, at the right edge of the view.
      const tEnd = Math.min(d1, model.end);
      const ends = model.series.map((sr, i) => ({ sr, i, pos: posAt(sr, tEnd), k: sr.kills.filter(x2 => x2.at <= tEnd).length }));
      const gap = narrow ? 15 : 19;
      const labels = ends.map(e => ({ ...e, ly: y(e.pos) })).sort((a, b) => a.ly - b.ly);
      labels.forEach((e, i) => { if (i && e.ly - labels[i - 1].ly < gap) e.ly = labels[i - 1].ly + gap; });
      const shift = Math.max(0, (labels.length ? labels[labels.length - 1].ly : 0) - (H - m.b));
      for (const e of labels) {
        const g = e.sr.g;
        const done = e.pos >= total;
        const label = s('text', { class: 'svg-end', 'data-guild': g.name, x: m.l + pw + gut + 6, y: e.ly - shift + 5 },
          narrow ? '' : `${g.name} `,
          s('tspan', { class: 'svg-end__n', text: `${e.k}/${total}` }),
          !narrow && !done ? s('tspan', { class: 'svg-end__go', text: ` · ${tr('vg.go', { n: go(e.pos) })}` }) : null,
          svgTitle(done ? tr('vg.done', { guild: g.name }) : tr('vg.goTitle', { guild: g.name, k: e.k, total, n: go(e.pos) })));
        label.style.setProperty('--guild', colour(g.colour));
        label.addEventListener('click', () => setFocus(g.name));
        svg.append(label);
      }

      scrubLayer = s('g', { class: 'svg-scrub', 'aria-hidden': 'true' });
      svg.append(scrubLayer);
      el.replaceChildren(svg);
      if (key) {
        let x2 = key.x;
        const ty = key.y + 4;
        key.kill.setAttribute('x', x2); key.kill.setAttribute('y', ty);
        x2 -= key.kill.getComputedTextLength() + 10;
        key.node.setAttribute('cx', x2); key.node.setAttribute('cy', key.y);
        x2 -= 16;
        key.first.setAttribute('x', x2); key.first.setAttribute('y', ty);
        x2 -= key.first.getComputedTextLength() + 12;
        key.star.setAttribute('transform', `translate(${x2},${key.y})`);
      }
      for (const f of drawFrom) drawLineFrom(f.line, f.fromX);
      paintFocus();
      paintScrub();
    });
  }

  /* The chosen moment: a crosshair with a dot on every line, and the standings at that moment in
   * the strip under the chart (the standings now while none is chosen). */
  function paintScrub() {
    const box = $('#tlReadout');
    if (!geo || !scrubLayer || !box) return;
    const picked = st.t !== null;
    const t = picked ? st.t : model.end;
    scrubLayer.replaceChildren();
    const { x, y, m, H } = geo;
    const rows = standingsAt(t);
    if (picked && t >= geo.d0 && t <= geo.d1) {
      const cx = x(t);
      scrubLayer.append(s('line', { class: 'svg-cross', x1: cx, x2: cx, y1: y(model.total), y2: H - m.b }));
      for (const r of rows) {
        const dot = s('circle', { class: 'svg-cross-dot', cx, cy: y(r.pos), r: 4.5 });
        dot.style.setProperty('--guild', colour(r.sr.g.colour));
        scrubLayer.append(dot);
      }
    }
    const close = h('button', { type: 'button', class: 'tl-readout__x', text: tr('vg.clear') });
    close.addEventListener('click', () => { st.t = null; st.pinned = false; paintScrub(); });
    box.replaceChildren(
      h('div', { class: 'tl-readout__head' },
        h('span', { class: 'tl-readout__when', text: picked ? when(t, geo.d1 - geo.d0 <= 4 * DAY) : tr(isArchive(data) ? 'vg.end' : 'vg.now') }),
        h('span', { class: 'tl-readout__day', text: tr('vg.day', { n: dayNo(t) }) }),
        st.pinned ? close : null),
      h('ol', { class: 'tl-readout__list' }, ...rows.map((r, i) => setGuild(h('li', { 'data-guild': r.sr.g.name, class: st.focus && st.focus !== r.sr.g.name ? 'is-dim' : null },
        h('span', { class: 'tl-readout__rank', text: String(i + 1) }),
        h('span', { class: 'tl-readout__name', text: r.sr.g.name }),
        h('span', { class: 'tl-readout__k', text: `${r.k}/${model.total}` }),
        h('span', { class: 'tl-readout__boss', text: r.boss ? (r.frac ? tr('vg.left', { boss: r.boss, pct: `${num((1 - r.frac) * 100, 1)}%` }) : `${r.boss} · ${tr('vg.notYet')}`) : r.k >= model.total ? 'Cutting Edge' : tr('vg.allDown') })), r.sr.g))));
    box.classList.toggle('is-picked', picked);
    for (const li of box.querySelectorAll('li[data-guild]')) li.addEventListener('click', () => setFocus(li.dataset.guild));
  }

  /* One guild in focus (a click on its name at a line end, in the strip, or on the Plaatsen
   * chart): its marks stay, the others fade. A second click clears it. */
  function setFocus(name) {
    st.focus = st.focus === name ? null : name;
    paintFocus();
  }
  function paintFocus() {
    for (const el of document.querySelectorAll('#timelineBox [data-guild]')) {
      el.classList.toggle('is-dim', !!st.focus && el.dataset.guild !== st.focus);
    }
  }

  /* ---- pointer, keys -------------------------------------------------------------------- */

  let drag = null;
  function localX(el, e) { return e.clientX - el.getBoundingClientRect().left; }
  function inPlot(px) { return geo && px >= geo.m.l && px <= geo.m.l + geo.pw; }
  function scrubTo(px, pinned) {
    st.t = clampT(Math.min(Math.max(geo.inv(px), geo.d0), geo.d1));
    st.pinned = pinned;
    paintScrub();
  }
  function setBrush(a, b) {
    const br = $('#tlBrush');
    if (a === null) { br.hidden = true; return; }
    br.hidden = false;
    br.style.setProperty('--bx', `${Math.min(a, b)}px`);
    br.style.setProperty('--bw', `${Math.abs(b - a)}px`);
    br.style.setProperty('--by', `${geo.y(model.total)}px`);
    br.style.setProperty('--bh', `${geo.H - geo.m.b - geo.y(model.total)}px`);
  }
  function zoomTo(range) {
    if (range) {
      let [a, b] = range;
      if (b - a < 12 * HOUR) { const c = (a + b) / 2; a = c - 6 * HOUR; b = c + 6 * HOUR; }
      a = Math.max(a, model.start); b = Math.min(b, model.end);
      range = b - a >= model.end - model.start - HOUR ? null : [a, b];
    }
    st.zoom = range;
    paintZoom();
    redrawTimeline();
  }

  function wireChart(el) {
    if (el.dataset.vg) return;
    el.dataset.vg = '1';
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !inPlot(localX(el, e))) return;
      drag = { x0: localX(el, e), type: e.pointerType, moved: false };
      el.setPointerCapture(e.pointerId);
      if (e.pointerType !== 'mouse') scrubTo(drag.x0, true);
    });
    el.addEventListener('pointermove', e => {
      if (!geo) return;
      const px = Math.min(Math.max(localX(el, e), geo.m.l), geo.m.l + geo.pw);
      if (drag && drag.type === 'mouse') {
        if (Math.abs(px - drag.x0) > 6) { drag.moved = true; setBrush(drag.x0, px); }
        return;
      }
      if (drag) { scrubTo(px, true); return; }
      if (e.pointerType === 'mouse' && !st.pinned && inPlot(localX(el, e))) scrubTo(px, false);
    });
    el.addEventListener('pointerup', e => {
      if (!drag) return;
      const px = Math.min(Math.max(localX(el, e), geo.m.l), geo.m.l + geo.pw);
      const d = drag;
      drag = null;
      setBrush(null);
      if (d.type === 'mouse' && d.moved && Math.abs(px - d.x0) > 12) zoomTo([geo.inv(Math.min(px, d.x0)), geo.inv(Math.max(px, d.x0))]);
      else if (d.type === 'mouse') scrubTo(px, true);
    });
    el.addEventListener('pointercancel', () => { drag = null; setBrush(null); });
    el.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse' && !st.pinned && !drag) { st.t = null; paintScrub(); }
    });
    el.addEventListener('dblclick', () => zoomTo(null));
    el.addEventListener('keydown', e => {
      const stepT = e.shiftKey ? WEEK : DAY;
      const base = st.t === null ? model.end : st.t;
      let t = null;
      if (e.key === 'ArrowLeft') t = base - stepT;
      else if (e.key === 'ArrowRight') t = base + stepT;
      else if (e.key === 'Home') t = domain()[0];
      else if (e.key === 'End') t = Math.min(domain()[1], model.end);
      else if (e.key === 'Escape' && st.t !== null) { st.t = null; st.pinned = false; paintScrub(); e.stopPropagation(); e.preventDefault(); return; }
      else if (e.key === '0') { zoomTo(null); return; }
      if (t === null) return;
      e.preventDefault();
      st.t = clampT(t);
      st.pinned = true;
      // Keep the moment in view: move the zoom window along with it.
      if (st.zoom && (st.t < st.zoom[0] || st.t > st.zoom[1])) {
        const w = st.zoom[1] - st.zoom[0];
        const a = Math.min(Math.max(st.t - w / 2, model.start), model.end - w);
        zoomTo([a, a + w]);
      } else paintScrub();
    });
  }

  /* ---- the bar: Grafiek | Replay, the period, the hint ------------------------------------ */

  const RANGES = [['all', null], ['2w', 14 * DAY], ['1w', 7 * DAY]];
  function paintZoom() {
    const span = st.zoom ? st.zoom[1] - st.zoom[0] : null;
    for (const b of document.querySelectorAll('#vgRange button')) {
      const r = RANGES.find(x => x[0] === b.dataset.range);
      const on = r[1] === null ? !st.zoom : !!st.zoom && Math.abs(span - r[1]) < HOUR && st.zoom[1] >= model.end - HOUR;
      b.setAttribute('aria-pressed', String(on));
    }
  }
  function buildBar() {
    const modeBox = $('#vgMode'), range = $('#vgRange');
    modeBox.replaceChildren(...MODES.map(mode => {
      const b = h('button', { type: 'button', 'data-mode': mode, 'aria-pressed': String(st.mode === mode), text: tr(`vg.${mode}`) });
      b.addEventListener('click', () => setMode(mode));
      return b;
    }));
    range.replaceChildren(...RANGES.map(([key, span]) => {
      const b = h('button', { type: 'button', 'data-range': key, text: tr(`vg.${key}`) });
      b.addEventListener('click', () => zoomTo(span ? [model.end - span, model.end] : null));
      return b;
    }));
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    $('#vgHint').textContent = tr(coarse ? 'vg.hintTouch' : 'vg.hint');
    $('#timeline').setAttribute('aria-label', tr('vg.chartLabel'));
    paintZoom();
  }
  function setMode(mode) {
    if (st.mode === mode) return;
    stopPlay();
    st.mode = mode;
    for (const b of document.querySelectorAll('#vgMode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    applyMode();
    // Opening the replay or the lap plays it: from the first day to now.
    if (PLAYER.has(mode)) { st.t = model.start; startPlay(); }
  }
  function applyMode() {
    const mode = st.mode;
    $('#timelineBox').dataset.mode = mode;
    $('#timeline').hidden = mode !== 'chart';
    $('#tlBump').hidden = mode !== 'bump';
    $('#tlPlayer').hidden = !PLAYER.has(mode);
    $('#tlReplay').hidden = mode !== 'replay';
    $('#tlRing').hidden = mode !== 'ring';
    if (PLAYER.has(mode)) { redrawTimeline(); paintReplay(true); }
    else { redrawTimeline(); paintScrub(); }
    for (const id of ['#tlBump', '#tlRing']) {
      const c = charts.get($(id));
      if (c && !$(id).hidden) requestAnimationFrame(() => { c.width = Math.floor($(id).clientWidth); c.draw(c.width); });
    }
  }

  /* ---- replay --------------------------------------------------------------------------- */

  let lanes = null;
  function buildReplay() {
    const box = $('#tlReplay');
    const playBtn = h('button', { type: 'button', class: 'rp-play', id: 'rpPlay' });
    playBtn.addEventListener('click', () => (play ? stopPlay() : startPlay()));
    const slider = h('input', { type: 'range', class: 'rp-slider', id: 'rpSlider', min: String(model.start), max: String(model.end), step: String(HOUR), 'aria-label': tr('vg.slider') });
    slider.addEventListener('input', () => { stopPlay(); st.t = Number(slider.value); st.pinned = true; paintReplay(); });
    const head = h('div', { class: 'rp-lane rp-lane--head', 'aria-hidden': 'true' },
      h('span', {}), h('span', {}),
      h('span', { class: 'rp-finish rp-finish--head' },
        model.ceHead ? h('span', { class: 'boss-thumb rp-ce' }, h('img', { src: model.ceHead, alt: '' })) : null,
        h('b', { text: 'CE' })),
      h('span', {}));
    lanes = new Map(model.series.map(sr => {
      const track = h('span', { class: 'row__hp rp-track', 'aria-hidden': 'true' },
        ...Array.from({ length: model.total }, (_, i) => { const seg = h('i', {}); seg.style.setProperty('--i', String(i)); return seg; }));
      const li = setGuild(h('li', { class: 'rp-lane' },
        h('span', { class: 'rp-who' },
          h('span', { class: 'rp-rank mono' }),
          h('span', { class: 'rp-name' }, h('b', { text: sr.g.name }), h('span', { class: 'rp-boss' }))),
        track,
        h('span', { class: 'rp-finish' }),
        h('span', { class: 'rp-k mono' })), sr.g);
      return [sr.g.name, { li, track, sr }];
    }));
    $('#tlPlayer').replaceChildren(playBtn, slider, h('output', { class: 'rp-when', id: 'rpWhen', for: 'rpSlider' }));
    box.replaceChildren(head, h('ol', { class: 'rp-lanes', id: 'rpLanes' }, ...[...lanes.values()].map(l => l.li)));
  }
  function paintReplay(noMotion) {
    if (!lanes) return;
    const t = st.t === null ? model.end : st.t;
    const playBtn = $('#rpPlay');
    playBtn.replaceChildren(
      s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: play ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5v13l10.5-6.5z' })),
      h('span', { text: tr(play ? 'vg.pause' : 'vg.play') }));
    playBtn.setAttribute('aria-pressed', String(!!play));
    const slider = $('#rpSlider');
    slider.value = String(t);
    slider.style.setProperty('--fill', `${((t - model.start) / (model.end - model.start)) * 100}%`);
    $('#rpWhen').textContent = `${when(t, false)} · ${tr('vg.day', { n: dayNo(t) })}`;
    if (st.mode === 'ring') { paintRing(t); return; }
    const rows = standingsAt(t);
    const list = $('#rpLanes');
    // A guild that moves up or down slides to its new lane (not while scrubbing by hand fast).
    const tops = noMotion || reducedMotion() ? null : new Map([...lanes.values()].map(l => [l.sr.g.name, l.li.getBoundingClientRect().top]));
    rows.forEach((r, i) => {
      const l = lanes.get(r.sr.g.name);
      l.track.style.setProperty('--p', String(r.pos));
      l.li.querySelector('.rp-rank').textContent = String(i + 1);
      l.li.querySelector('.rp-k').replaceChildren(String(r.k), h('small', { text: `/${model.total}` }));
      l.li.querySelector('.rp-boss').textContent = r.boss
        ? (r.frac ? tr('vg.left', { boss: r.boss, pct: `${num((1 - r.frac) * 100, 1)}%` }) : `${r.boss} · ${tr('vg.notYet')}`)
        : r.k >= model.total ? 'Cutting Edge' : tr('vg.allDown');
      l.li.classList.toggle('is-lead', i === 0 && r.pos > 0);
      l.li.classList.toggle('is-done', r.k >= model.total);
      if (list.children[i] !== l.li) list.insertBefore(l.li, list.children[i] || null);
    });
    if (tops) {
      for (const l of lanes.values()) {
        const dy = tops.get(l.sr.g.name) - l.li.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) l.li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      }
    }
  }
  function startPlay() {
    if (st.t === null || st.t >= model.end - HOUR) st.t = model.start;
    const from = st.t, t0 = performance.now();
    const dur = PLAY_MS * (model.end - from) / (model.end - model.start);
    const reduced = reducedMotion();
    play = { id: 0 };
    const tick = now => {
      if (!play) return;
      const p = Math.min(1, (now - t0) / dur);
      let t = from + (model.end - from) * p;
      if (reduced) t = Math.min(model.end, from + Math.floor((t - from) / DAY) * DAY); // day by day, no glide
      st.t = t;
      st.pinned = true;
      paintReplay();
      if (p < 1) play.id = requestAnimationFrame(tick);
      else if (reduced) { play = null; paintReplay(true); }
      // At the end it holds on today for a moment, then runs again from the start, until paused.
      else play.hold = setTimeout(() => { if (play && PLAYER.has(st.mode)) { play = null; st.t = model.start; startPlay(); } }, 2500);
    };
    play.id = requestAnimationFrame(tick);
    paintReplay(true);
  }
  function stopPlay() {
    if (!play) return;
    cancelAnimationFrame(play.id);
    clearTimeout(play.hold);
    play = null;
    paintReplay(true);
  }

  /* ---- Plaatsen: the place in the race over time, every overtake ringed --------------------- */

  function drawBump(el) {
    chart(el, w => {
      const narrow = w < 560, n = model.series.length;
      const full = el.closest('.is-full');
      const H = full ? Math.max(260, Math.floor(el.clientHeight) - 18) : narrow ? 280 : 340;
      const m = { l: narrow ? 22 : 40, r: narrow ? 104 : 200, t: 26, b: 30 };
      const pw = w - m.l - m.r, ph = H - m.t - m.b;
      const firstKill = Math.min(...model.series.flatMap(sr => sr.kills.map(k => k.at)));
      const t0 = Number.isFinite(firstKill) ? firstKill - DAY / 2 : model.start;
      const x = t => m.l + (t - t0) / (model.end - t0) * pw, y = r => m.t + (r - 1) / Math.max(1, n - 1) * ph;
      const svg = s('svg', { width: w, height: H, viewBox: `0 0 ${w} ${H}`, role: 'img' });
      svg.append(svgTitle(tr('vg.bumpLabel')));
      for (let r = 1; r <= n; r++) {
        svg.append(s('line', { class: 'svg-grid', x1: m.l, x2: m.l + pw, y1: y(r), y2: y(r) }));
        svg.append(s('text', { class: 'svg-axis', x: m.l - 12, y: y(r) + 4, 'text-anchor': 'end', text: String(r) }));
      }
      const step = (WEEK / (model.end - t0)) * pw >= 58 ? WEEK : 2 * WEEK;
      for (let t = model.start + Math.ceil((t0 - model.start) / WEEK) * WEEK; t <= model.end; t += step) {
        svg.append(s('text', { class: 'svg-axis', x: x(t), y: H - 9, 'text-anchor': 'middle', text: day(new Date(t).toISOString()) }));
      }
      const samples = [];
      for (let t = t0; t < model.end; t += 3 * HOUR) samples.push(t);
      samples.push(model.end);
      const ranks = samples.map(t => standingsAt(t).map(r => r.sr));
      const last = ranks[ranks.length - 1];
      [...model.series].reverse().forEach(sr => {
        let d = '';
        samples.forEach((t, i) => { d += `${i ? ' L' : 'M'}${x(t)},${y(ranks[i].indexOf(sr) + 1)}`; });
        const line = s('path', { d, class: 'svg-bump', 'data-guild': sr.g.name });
        line.style.setProperty('--guild', colour(sr.g.colour));
        svg.append(line);
        const r = last.indexOf(sr) + 1;
        const label = s('text', { class: 'svg-end', 'data-guild': sr.g.name, x: m.l + pw + 12, y: y(r) + 5 },
          narrow ? sr.g.name.split(' ')[0].slice(0, 12) : `${r}. ${sr.g.name}`);
        label.style.setProperty('--guild', colour(sr.g.colour));
        label.addEventListener('click', () => setFocus(sr.g.name));
        svg.append(label);
      });
      // Each overtake: a ring in the colour of the guild that moved up; a label where there's room.
      const placed = [];
      for (const o of model.passes) {
        const cx = x(o.t), cy = y(o.rank);
        const ring = s('circle', { class: 'svg-pass', 'data-guild': o.sr.g.name, cx, cy, r: 6 },
          svgTitle(`${day(new Date(o.t).toISOString())} ${clock(new Date(o.t).toISOString())}: ${tr('log.pass', { guild: o.sr.g.name, other: o.over.g.name, rank: o.rank })}`));
        ring.style.setProperty('--guild', colour(o.sr.g.colour));
        svg.append(ring);
        if (narrow) continue;
        const free = up => !placed.some(p => p.up === up && p.r === o.rank && Math.abs(p.x - cx) < 150);
        const up = free(true) ? true : free(false) ? false : null;
        if (up === null) continue;
        placed.push({ x: cx, r: o.rank, up });
        svg.append(s('text', { class: 'svg-pass__lbl', x: cx, y: cy + (up ? -12 : 22), 'text-anchor': 'middle',
          text: tr('vg.passShort', { a: o.sr.g.name.split(' ')[0], b: o.over.g.name.split(' ')[0] }) }));
      }
      el.replaceChildren(svg);
      paintFocus();
    });
  }

  /* ---- Per guild: a small chart per guild, the others faint behind it ----------------------- */

  function drawSmall(el) {
    chart(el, w => {
      // Phones: one card per guild in a row that swipes sideways, the next one peeking in.
      const swipe = w < 600;
      const cols = swipe ? 1 : Math.max(1, Math.min(model.series.length, Math.floor((w + 10) / 250)));
      const pw0 = swipe ? Math.floor(w * 0.84) : Math.floor((w - (cols - 1) * 10) / cols);
      const H = 170, m = { l: 8, r: 8, t: 16, b: 20 };
      const pw = pw0 - m.l - m.r, ph = H - m.t - m.b, total = model.total;
      const x = t => m.l + (t - model.start) / (model.end - model.start) * pw, y = k => m.t + (1 - k / total) * ph;
      const path = sr => { let d = `M${x(model.start)},${y(0)}`; for (const e of sr.ev) d += ` H${x(e.at)} V${y(e.pos)}`; return `${d} H${x(model.end)}`; };
      const panels = standingsAt(model.end).map((r, i) => {
        const sr = r.sr;
        const svg = s('svg', { width: pw0, height: H, viewBox: `0 0 ${pw0} ${H}`, role: 'img' },
          svgTitle(tr('vg.goTitle', { guild: sr.g.name, k: r.k, total, n: go(r.pos) })));
        svg.append(s('rect', { class: 'svg-finish', x: m.l, y: y(total) - 10, width: pw, height: 10 }));
        svg.append(s('line', { class: 'svg-finish__line', x1: m.l, x2: m.l + pw, y1: y(total), y2: y(total) }));
        for (const o of model.series) if (o !== sr) svg.append(s('path', { d: path(o), class: 'svg-ghost' }));
        const area = s('path', { d: `${path(sr)} V${y(0)} H${x(model.start)} Z`, class: 'svg-area' });
        const line = s('path', { d: path(sr), class: 'svg-step', 'stroke-width': 2.5 });
        for (const el2 of [area, line]) el2.style.setProperty('--guild', colour(sr.g.colour));
        svg.append(area, line);
        sr.kills.forEach((k, n) => {
          if (isFirstKill(data, k, sr.g)) svg.append(s('path', { class: 'svg-star', d: STAR, transform: `translate(${x(k.at)},${y(n + 1)}) scale(.8)` }));
        });
        svg.append(s('text', { class: 'svg-axis', x: m.l, y: H - 4, text: day(new Date(model.start).toISOString()) }),
          s('text', { class: 'svg-axis', x: m.l + pw, y: H - 4, 'text-anchor': 'end', text: tr(isArchive(data) ? 'vg.endShort' : 'vg.nowShort') }));
        return setGuild(h('div', { class: 'sm' },
          h('div', { class: 'sm__head' },
            h('span', { class: 'sm__rank mono', text: String(i + 1) }),
            h('b', { class: 'sm__name', text: sr.g.name }),
            h('span', { class: 'sm__k mono', text: `${r.k}/${total}` }),
            r.pos < total ? h('span', { class: 'sm__go mono', text: tr('vg.go', { n: go(r.pos) }) }) : null),
          svg), sr.g);
      });
      el.replaceChildren(h('div', { class: 'sm-grid' }, ...panels));
      el.style.setProperty('--sm-cols', String(cols));
    });
  }

  /* ---- Ronde: the race as an athletics track, CE at the top ---------------------------------- */

  let ring = null;
  function drawRing(el) {
    chart(el, w => {
      const narrow = w < 560, total = model.total;
      const full = el.closest('.is-full');
      const size = Math.min(w - 24, full ? Math.max(320, Math.floor(el.clientHeight) - 24) : narrow ? 360 : 560);
      const H = size + 24, cx = w / 2, cy = H / 2;
      const R = size / 2 - (narrow ? 38 : 60), lane = narrow ? 12 : 17, wd = narrow ? 8 : 11;
      const ang = p => -Math.PI / 2 + (p / total) * Math.PI * 2 * 0.94 + Math.PI * 0.03;
      const pt = (p, r) => [cx + r * Math.cos(ang(p)), cy + r * Math.sin(ang(p))];
      const arc = (p0, p1, r) => {
        const [x0, y0] = pt(p0, r), [x1, y1] = pt(Math.max(p1, p0 + 0.001), r);
        return `M${x0},${y0} A${r},${r} 0 ${(p1 - p0) / total * 0.94 > 0.5 ? 1 : 0} 1 ${x1},${y1}`;
      };
      const svg = s('svg', { width: w, height: H, viewBox: `0 0 ${w} ${H}`, role: 'img' }, svgTitle(tr('vg.ringLabel')));
      // Lanes in today's order, the leader outside; each with its fill and its runner.
      const lanesNow = standingsAt(model.end).map(r => r.sr);
      const refs = lanesNow.map((sr, i) => {
        const rr = R - i * lane;
        svg.append(s('path', { d: arc(0, total, rr), class: 'svg-lane', 'stroke-width': wd }));
        const fill = s('path', { class: 'svg-lane__fill', 'stroke-width': wd });
        const dot = s('circle', { class: 'svg-runner', r: narrow ? 5 : 7 });
        for (const el2 of [fill, dot]) el2.style.setProperty('--guild', colour(sr.g.colour));
        svg.append(fill, dot);
        return { sr, rr, fill, dot };
      });
      // A tick per kill count, the bosses round the outside in the order the race killed them.
      const order = model.series.flatMap(sr => sr.kills).sort((a, b) => a.at - b.at)
        .filter((k, i, a) => a.findIndex(o => o.slug === k.slug) === i).map(k => k.name);
      const rest = data.tier.raids.flatMap(r => r.bosses.map(b => b.name)).filter(nm => !order.includes(nm) && nm !== model.ceName);
      [...order.filter(nm => nm !== model.ceName), ...rest, model.ceName].slice(0, total).forEach((nm, i) => {
        const [ax, ay] = pt(i + 1, R + wd / 2 + 4), [bx, by] = pt(i + 1, R - (refs.length - 1) * lane - wd / 2 - 4);
        svg.append(s('line', { class: i + 1 === total ? 'svg-finish__line' : 'svg-grid', x1: ax, y1: ay, x2: bx, y2: by }));
        const src = bossArtFor(nm)[0], sz = narrow ? 26 : 40, [hx, hy] = pt(i + 1, R + (narrow ? 22 : 34));
        if (src) svg.append(s('image', { href: src, x: hx - sz / 2, y: hy - sz / 2, width: sz, height: sz, preserveAspectRatio: 'xMidYMin slice' }, svgTitle(nm)));
      });
      const [sx, sy] = pt(0, R + 12);
      svg.append(s('text', { class: 'svg-ring__start', x: sx + 4, y: sy - 4, text: tr('vg.start') }));
      const dayT = s('text', { class: 'svg-ring__day', x: cx, y: cy - (narrow ? 40 : 58), 'text-anchor': 'middle' });
      svg.append(dayT);
      const rows = refs.map((_, i) => {
        const t = s('text', { class: 'svg-ring__row', x: cx, y: cy - (narrow ? 16 : 28) + i * (narrow ? 16 : 22), 'text-anchor': 'middle' });
        svg.append(t);
        return t;
      });
      ring = { refs, arc, pt, dayT, rows, narrow };
      el.replaceChildren(svg);
      paintRing(st.t === null ? model.end : st.t);
    });
  }
  function paintRing(t) {
    if (!ring) return;
    for (const r of ring.refs) {
      const p = Math.min(posAt(r.sr, t), model.total);
      r.fill.setAttribute('d', p > 0 ? ring.arc(0, p, r.rr) : '');
      const [x, y] = ring.pt(p, r.rr);
      r.dot.setAttribute('cx', x);
      r.dot.setAttribute('cy', y);
    }
    ring.dayT.textContent = tr('vg.day', { n: dayNo(t) }).toUpperCase();
    standingsAt(t).forEach((r, i) => {
      const row = ring.rows[i];
      row.style.setProperty('--guild', colour(r.sr.g.colour));
      row.replaceChildren(`${i + 1}. ${ring.narrow ? r.sr.g.name.split(' ')[0] : r.sr.g.name} `, s('tspan', { class: 'svg-end__n', text: num(r.pos, 1) }));
    });
  }

  /* ---- Wedstrijdverslag: the race day by day ------------------------------------------------ */

  // A sentence from a template whose {placeholders} become nodes (names in bold, in their colour).
  function sentence(key, parts) {
    return tr(key).split(/(\{\w+\})/).filter(Boolean).map(bit => {
      const m = /^\{(\w+)\}$/.exec(bit);
      return m && parts[m[1]] !== undefined ? parts[m[1]] : bit;
    });
  }
  const guildName = sr => setGuild(h('b', { class: 'log-guild', text: sr.g.name }), sr.g);
  function renderLog() {
    const list = $('#logList'), more = $('#logMore');
    if (!list) return;
    const ev = [];
    for (const sr of model.series) sr.kills.forEach((k, n) => ev.push({ t: k.at, kind: isFirstKill(data, k, sr.g) ? 'first' : 'kill', sr, k, n: n + 1 }));
    for (const o of model.passes) ev.push({ t: o.t, kind: 'pass', sr: o.sr, over: o.over, rank: o.rank });
    ev.sort((a, b) => b.t - a.t);
    const days = new Map();
    for (const e of ev) {
      const d0 = new Date(e.t); d0.setHours(0, 0, 0, 0);
      const key = d0.getTime();
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(e);
    }
    const all = [...days.entries()];
    const shown = st.logAll ? all : all.slice(0, 3);
    list.replaceChildren(...(all.length ? shown.map(([d0, es]) => {
      const endOfDay = Math.min(d0 + DAY - 1, model.end);
      return h('li', { class: 'log-day' },
        h('div', { class: 'log-when' },
          h('b', { text: tr('vg.day', { n: dayNo(d0 + 12 * HOUR) }) }),
          h('span', { text: new Date(d0).toLocaleDateString(i18n.locale, { weekday: 'long', day: 'numeric', month: 'long' }) })),
        h('div', { class: 'log-body' },
          h('ul', { class: 'log-ev' }, ...es.map(e => h('li', { class: `log-e log-e--${e.kind}` },
            h('span', { class: 'log-t mono', text: clock(new Date(e.t).toISOString()) }),
            h('span', { class: 'log-txt' },
              ...(e.kind === 'pass'
                ? sentence('log.pass', { guild: guildName(e.sr), other: h('b', { text: e.over.g.name }), rank: String(e.rank) })
                : sentence(e.kind === 'first' ? 'log.first' : 'log.kill', { guild: guildName(e.sr), boss: h('b', { text: e.k.name }) })),
              e.kind === 'pass' ? '.' : ` (${tr('log.detail', { n: e.n })}${e.k.pullCount ? `, ${pulls(e.k.pullCount)}` : ''}).`)))),
          h('ol', { class: 'log-stand', 'aria-label': tr('log.stand') }, ...standingsAt(endOfDay).map((r, i) => setGuild(h('li', {},
            h('span', { class: 'log-stand__rank mono', text: String(i + 1) }),
            h('span', { text: r.sr.g.name }),
            h('span', { class: 'mono', text: num(r.pos, 1) })), r.sr.g)))));
    }) : [h('li', { class: 'muted-note', text: tr('log.empty') })]));
    if (all.length > 3) {
      const b = h('button', { type: 'button', class: 'pill pill--action', text: st.logAll ? tr('log.less') : tr('log.more', { n: all.length }) });
      b.addEventListener('click', () => { st.logAll = !st.logAll; renderLog(); });
      more.replaceChildren(b);
    } else more.replaceChildren();
  }

  /* ---- entry ---------------------------------------------------------------------------- */

  function render(d) {
    const season = d.season ? d.season.id : null;
    if (season !== st.season) { stopPlay(); Object.assign(st, { zoom: null, t: null, pinned: false, season }); }
    data = d;
    model = buildModel(d);
    model.passes = passesOf();
    if (st.zoom) st.zoom = [Math.max(st.zoom[0], model.start), Math.min(st.zoom[1], model.end)];
    if (st.t !== null) st.t = clampT(st.t);
    buildBar();
    wireChart($('#timeline'));
    drawChart($('#timeline'));
    drawBump($('#tlBump'));
    drawSmall($('#guildSmall'));
    buildReplay();
    drawRing($('#tlRing'));
    applyMode();
    renderLog();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && st.pinned && st.mode === 'chart' && !$('#timelineBox').classList.contains('is-full')) {
      st.t = null; st.pinned = false; paintScrub();
    }
  });

  return { render };
})();
if (race) Voortgang.render(race);
