/* Mock: three ways to show the standings line under each day of the Wedstrijdverslag.
 * Loaded after the real site scripts. It reads every rendered .log-stand (rank, full name from the
 * tag's title, guild colour, kills/total, "nog X%", current boss) and draws the chosen variant next
 * to it; the original stays in the DOM, hidden, so the site's own re-renders keep working.
 * ?v=A|B|C picks a variant; the bar at the bottom switches live. */
'use strict';

(() => {
  const VARIANTS = {
    now: 'Huidig',
    A: 'A · Uitklapstand',
    B: 'B · Wat veranderde',
    C: 'C · Het veld',
  };
  let v = new URLSearchParams(location.search).get('v') || 'A';
  if (!VARIANTS[v]) v = 'A';

  const svg = (tag, attrs, ...kids) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, val] of Object.entries(attrs || {})) el.setAttribute(k, val);
    el.append(...kids);
    return el;
  };
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, val] of Object.entries(attrs || {})) {
      if (k === 'text') e.textContent = val; else if (k === 'class') e.className = val; else e.setAttribute(k, val);
    }
    e.append(...kids.flat().filter(x => x !== null && x !== undefined && x !== false));
    return e;
  };
  // Drawn arrows (no glyphs): up = climbed, down = dropped.
  const arrow = dir => svg('svg', { class: `ms-arrow ms-arrow--${dir}`, viewBox: '0 0 10 10', 'aria-hidden': 'true' },
    svg('path', { d: dir === 'up' ? 'M5 1.5 9 8.5H1z' : 'M5 8.5 1 1.5h8z' }));
  const chevron = () => svg('svg', { class: 'ms-chev', viewBox: '0 0 12 12', 'aria-hidden': 'true' },
    svg('path', { d: 'M3 4.5 6 7.5 9 4.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'square' }));

  /* One rendered .log-stand → rows. */
  function read(ol) {
    return [...ol.children].map((li, i) => {
      const tag = li.querySelector('.log-stand__tag');
      const val = li.querySelector('span.mono:not(.log-stand__rank)');
      const text = val ? val.textContent : '';
      const m = /^(\d+)\/(\d+)(?:\s*·\s*nog\s*([\d,]+)%)?/.exec(text) || [];
      const kills = Number(m[1] || 0), total = Number(m[2] || 8);
      const left = m[3] ? Number(m[3].replace(',', '.')) : null;
      return {
        rank: i + 1, name: tag ? tag.title : '', tag: tag ? tag.textContent : '',
        guild: li.style.getPropertyValue('--guild'), kills, total, left,
        boss: val ? val.title : '', text,
        pos: kills + (left === null ? 0 : (100 - left) / 100),
      };
    });
  }
  // The day below in the list is the day before: its standings give the change.
  function previous(ol) {
    const day = ol.closest('.log-day');
    let next = day && day.nextElementSibling;
    while (next && !next.querySelector('.log-stand')) next = next.nextElementSibling;
    return next ? read(next.querySelector('.log-stand')) : null;
  }
  const delta = (row, prev) => {
    if (!prev) return null;
    const p = prev.find(x => x.name === row.name);
    return p ? p.rank - row.rank : null;
  };
  const deltaMark = d => d === null ? el('span', { class: 'ms-delta ms-delta--none', 'aria-label': 'geen vergelijking' })
    : d > 0 ? el('span', { class: 'ms-delta ms-delta--up', title: `${d} plaats${d > 1 ? 'en' : ''} gestegen` }, arrow('up'), String(d))
      : d < 0 ? el('span', { class: 'ms-delta ms-delta--down', title: `${-d} plaats${d < -1 ? 'en' : ''} gezakt` }, arrow('down'), String(-d))
        : el('span', { class: 'ms-delta ms-delta--same', title: 'zelfde plaats' }, '–');
  const chip = r => { const c = el('span', { class: 'ms-chip' }); c.style.setProperty('--guild', r.guild); return c; };
  const progress = r => r.left === null ? (r.kills >= r.total ? 'Cutting Edge' : '') : `${r.boss ? `${r.boss} · ` : ''}nog ${String(r.left).replace('.', ',')}%`;

  /* A · Uitklapstand: one line (leader + how many places changed); open = the full table. */
  function variantA(rows, prev, dayLabel) {
    const moved = prev ? rows.filter(r => delta(r, prev)).length : 0;
    const lead = rows[0];
    const det = el('details', { class: 'msA' },
      el('summary', { class: 'msA__sum' },
        el('span', { class: 'msA__label', text: `Stand na ${dayLabel}` }),
        el('span', { class: 'msA__lead' }, chip(lead), el('b', { text: lead.name }), el('span', { class: 'mono', text: `${lead.kills}/${lead.total}` })),
        moved ? el('span', { class: 'msA__moved', text: `${moved} van plaats gewisseld` }) : el('span', { class: 'msA__moved msA__moved--quiet', text: prev ? 'geen wissels' : '' }),
        chevron()),
      el('table', { class: 'msA__table' },
        el('tbody', {}, rows.map(r => {
          const tr = el('tr', {},
            el('td', { class: 'msA__rank mono', text: `${r.rank}` }),
            el('td', { class: 'msA__name' }, chip(r), el('span', { text: r.name })),
            el('td', { class: 'msA__kills mono' }, el('b', { text: String(r.kills) }), `/${r.total}`),
            el('td', { class: 'msA__prog', text: progress(r) }),
            el('td', { class: 'msA__d' }, deltaMark(delta(r, prev))));
          return tr;
        }))));
    return det;
  }

  /* B · Wat veranderde: inline only the movers; the full order behind a quiet toggle. */
  function variantB(rows, prev) {
    const movers = prev ? rows.filter(r => delta(r, prev)) : [];
    const line = el('div', { class: 'msB__line' },
      movers.length
        ? movers.map(r => {
          const d = delta(r, prev);
          return el('span', { class: `msB__mv msB__mv--${d > 0 ? 'up' : 'down'}` }, chip(r), el('b', { text: r.name }),
            arrow(d > 0 ? 'up' : 'down'), el('span', { text: `naar ${r.rank}e` }));
        })
        : el('span', { class: 'msB__calm', text: prev ? 'Stand ongewijzigd' : 'Stand' }));
    const all = el('ol', { class: 'msB__all' }, rows.map(r => el('li', {},
      el('span', { class: 'msB__rk mono', text: String(r.rank) }), chip(r), el('span', { class: 'msB__nm', text: r.name }),
      el('span', { class: 'mono msB__k', text: r.text }))));
    const det = el('details', { class: 'msB' }, el('summary', { class: 'msB__sum' }, line, el('span', { class: 'msB__open' }, 'Volledige stand', chevron())), all);
    return det;
  }

  /* C · Het veld: all guilds as notches on one shared race track (finish = the CE boss), so the gaps
   * read at a glance; open = a lane per guild with the board's segmented track. */
  function variantC(rows) {
    const total = rows[0] ? rows[0].total : 8;
    const track = el('div', { class: 'msC__track', role: 'img', 'aria-label': rows.map(r => `${r.rank}. ${r.name} ${r.text}`).join(', ') },
      ...Array.from({ length: total }, (_, i) => el('i', { class: 'msC__seg' })),
      ...rows.map(r => {
        const n = el('span', { class: 'msC__notch', title: `${r.rank}. ${r.name}: ${r.text}` }, el('span', { class: 'msC__nt', text: r.tag }));
        n.style.setProperty('--guild', r.guild);
        n.style.setProperty('--x', String(Math.min(r.pos / total, 1)));
        n.style.setProperty('--row', String(r.rank % 2));
        return n;
      }));
    const lanes = el('ol', { class: 'msC__lanes' }, rows.map(r => {
      const li = el('li', {},
        el('span', { class: 'msC__rk mono', text: String(r.rank) }),
        el('span', { class: 'msC__nm', text: r.name }),
        el('span', { class: 'msC__bar' }, ...Array.from({ length: r.total }, (_, i) => {
          const s = el('i', {});
          s.style.setProperty('--f', String(Math.max(0, Math.min(1, r.pos - i))));
          return s;
        })),
        el('span', { class: 'msC__k mono', text: r.text }));
      li.style.setProperty('--guild', r.guild);
      return li;
    }));
    return el('details', { class: 'msC' }, el('summary', { class: 'msC__sum' }, track, el('span', { class: 'msC__open' }, chevron())), lanes);
  }

  let busy = false;
  function apply() {
    if (busy) return;
    busy = true;
    for (const old of document.querySelectorAll('.ms-out')) old.remove();
    document.body.dataset.ms = v;
    if (v !== 'now') {
      for (const ol of document.querySelectorAll('#logList .log-stand')) {
        const rows = read(ol);
        if (!rows.length) continue;
        const prev = previous(ol);
        const dayLabel = (ol.closest('.log-day').querySelector('.log-when b') || {}).textContent || 'deze dag';
        const out = v === 'A' ? variantA(rows, prev, dayLabel.toLowerCase()) : v === 'B' ? variantB(rows, prev) : variantC(rows);
        out.classList.add('ms-out');
        ol.after(out);
      }
    }
    busy = false;
  }

  // The bar: switch live, without a reload.
  const bar = el('nav', { class: 'ms-bar', 'aria-label': 'Varianten' },
    el('span', { class: 'ms-bar__t', text: 'Stand onder elke dag' }),
    ...Object.entries(VARIANTS).map(([k, label]) => {
      const b = el('button', { type: 'button', 'data-v': k, 'aria-pressed': String(k === v), text: label });
      b.addEventListener('click', () => {
        v = k;
        for (const x of bar.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.dataset.v === v));
        const u = new URL(location.href); u.searchParams.set('v', v); history.replaceState(null, '', u);
        apply();
      });
      return b;
    }));
  document.body.append(bar);

  const list = document.getElementById('logList');
  if (list) new MutationObserver(() => { if (!busy) queueMicrotask(apply); }).observe(list, { childList: true });
  apply();
})();
