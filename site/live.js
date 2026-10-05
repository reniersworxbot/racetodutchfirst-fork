/* Race to Dutch First: "Nu live", the listed raiders streaming right now, in the hero.
 *
 * race.json's `streams` comes from DecAPI on every fetch run (twitch.py), so it is
 * as old as the data, and GitHub starts scheduled runs late or skips them. So the page
 * asks DecAPI itself too (check()): every POLL_MS while the tab is visible, the same
 * questions as twitch.py for race.json's channel list. A newer page check overrides
 * race.json per channel; if every page check fails, race.json's answer stands.
 * Older than STALE_MIN and the block hides: better nothing than "live" for someone
 * who stopped an hour ago. Same rules as app.js: textContent only, no innerHTML;
 * links only to https://www.twitch.tv/<login>; DecAPI's answers are plain text.
 *
 * The player is a click-to-load facade: until a visitor presses play, the page asks
 * Twitch for nothing but the preview still (static-cdn.jtvnw.net). Pressing play swaps
 * in Twitch's own embed (player.twitch.tv, `parent` = this host); the CSP allows exactly
 * those two hosts. The loaded player survives data refreshes and NL | EN redraws, so a
 * stream never restarts under the viewer.
 */
'use strict';

(() => {
  const STALE_MIN = 75;
  const POLL_MS = 2 * 60 * 1000;
  const DECAPI = 'https://decapi.me/twitch';
  const TWITCH = /^https:\/\/www\.twitch\.tv\/([a-z0-9_]{3,25})$/;
  const tn = (key, n, vars) => i18n.tn(key, n, vars);
  let data = null;
  let featured = null;   // login shown in the player
  let playing = null;    // login whose embed is loaded, or null for the facade
  let frame = null;      // the persistent player box
  let page = null;       // this page's own DecAPI check: { checkedAt, byLogin: { login: entry } }
  let checking = false;

  function clock(iso) {
    return new Date(iso).toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit' });
  }
  const login = ch => (TWITCH.exec(ch.url) || [])[1];

  function icon(kind) {
    const paths = {
      play: 'M8 5.5v13l10.5-6.5z',
      cast: 'M4 12a8 8 0 0 1 16 0M7.5 12a4.5 4.5 0 0 1 9 0M12 12v8',
      out: 'M14 5h5v5M19 5l-8 8M17 14v5H5V7h5',
    };
    const fill = kind === 'play';
    return s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
      s('path', { d: paths[kind], fill: fill ? 'currentColor' : 'none', stroke: fill ? 'none' : 'currentColor',
        'stroke-width': 2.2, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' }));
  }

  /* ---- The page's own DecAPI check (same answers as twitch.py) ---- */
  const UNIT = { day: 86400, hour: 3600, minute: 60, second: 1 };

  // Seconds live from "1 hour, 59 minutes, 58 seconds"; null when offline; throws when unclear.
  function parseUptime(text) {
    if (/offline/i.test(text)) return null;
    const parts = [...text.matchAll(/(\d+)\s+(day|hour|minute|second)s?/g)];
    if (!parts.length) throw new Error(`unexpected uptime answer: ${text.slice(0, 80)}`);
    return parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNIT[unit], 0);
  }

  async function ask(what, name) {
    const resp = await fetch(`${DECAPI}/${what}/${name}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`DecAPI ${what} ${name}: HTTP ${resp.status}`);
    return (await resp.text()).trim();
  }

  async function checkChannel(ch, game, now) {
    const name = login(ch);
    const entry = { ...ch, live: null, game: null, title: null, viewers: null, startedAt: null };
    try {
      const up = parseUptime(await ask('uptime', name));
      entry.live = up !== null;
      if (up !== null) {
        entry.startedAt = new Date(now - up * 1000).toISOString();
        const [g, title, viewers] = await Promise.all(['game', 'title', 'viewercount'].map(w => ask(w, name)));
        Object.assign(entry, { game: g, title, viewers: /^\d+$/.test(viewers) ? Number(viewers) : null });
      }
    } catch (err) {
      console.warn(err);
    }
    entry.shown = !!entry.live && (!game || entry.game === game);
    return entry;
  }

  async function check() {
    const st = data && data.streams;
    if (checking || !st || document.hidden) return;
    checking = true;
    try {
      const now = Date.now();
      const entries = await Promise.all(st.channels.filter(c => login(c)).map(c => checkChannel(c, st.game, now)));
      const answered = entries.filter(e => e.live !== null);
      if (!answered.length) return; // DecAPI down or blocked: race.json's check stands
      page = { checkedAt: new Date(now).toISOString(), byLogin: Object.fromEntries(answered.map(e => [login(e), e])) };
      render(); renderStreamers();
    } finally {
      checking = false;
    }
  }

  /* race.json's streams, with each channel the page checked more recently replaced by that answer. */
  function streams() {
    const st = data && data.streams;
    if (!st || !page || Date.parse(page.checkedAt) <= Date.parse(st.checkedAt)) return st;
    const channels = st.channels.map(c => {
      const mine = page.byLogin[login(c)];
      return mine ? { ...mine, twitch: c.twitch, guild: c.guild, url: c.url } : c;
    });
    return { ...st, checkedAt: page.checkedAt, channels };
  }

  /* The leader's guild first, then the most viewers: the stream most visitors came for. */
  function liveChannels() {
    const st = streams();
    const fresh = st && (Date.now() - Date.parse(st.checkedAt)) / 60000 <= STALE_MIN;
    if (!fresh) return [];
    const rank = name => (data.guilds.find(g => g.name === name) || { rank: 99 }).rank;
    return st.channels.filter(c => c.shown && login(c))
      .sort((a, b) => rank(a.guild) - rank(b.guild) || (b.viewers || 0) - (a.viewers || 0));
  }

  function meta(ch) {
    return [ch.startedAt ? tr('live.since', { time: clock(ch.startedAt) }) : null,
      Number.isInteger(ch.viewers) ? tn('live.viewers', ch.viewers) : null].filter(Boolean).join(' · ');
  }

  function facade(ch) {
    const name = login(ch);
    const still = h('img', { class: 'onair__still', alt: '', loading: 'lazy', decoding: 'async',
      src: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${name}-640x360.jpg?t=${Date.parse(streams().checkedAt)}` });
    still.addEventListener('error', () => still.remove());
    const btn = h('button', { type: 'button', class: 'onair__play', 'aria-label': tr('live.play', { name }) },
      still,
      h('span', { class: 'onair__btn' }, icon('play')),
      h('span', { class: 'onair__hint' }, h('b', { text: tr('live.play', { name }) }), h('span', { text: tr('live.play_note') })));
    btn.addEventListener('click', () => { playing = name; drawPlayer(ch, true); });
    return btn;
  }

  function embed(name) {
    const host = location.hostname;
    return h('iframe', {
      class: 'onair__frame', title: tr('live.frame', { name }),
      src: `https://player.twitch.tv/?channel=${name}&parent=${encodeURIComponent(host)}&autoplay=true&muted=false`,
      allow: 'autoplay; fullscreen; picture-in-picture', allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin',
    });
  }

  function drawPlayer(ch, focus) {
    const name = login(ch);
    // A file:// page has no host Twitch can check, so it gets the link only.
    if (playing === name && location.hostname) {
      if (!frame.querySelector(`iframe[data-ch="${name}"]`)) {
        const f = embed(name);
        f.dataset.ch = name;
        frame.replaceChildren(f);
        if (focus) f.focus();
      }
    } else {
      playing = null;
      frame.replaceChildren(facade(ch));
    }
  }

  function ribbon(ch) {
    const name = login(ch);
    const g = data.guilds.find(x => x.name === ch.guild);
    const on = name === featured;
    const btn = h('button', { type: 'button', class: 'onair__rib rib', 'aria-pressed': String(on),
      'aria-label': tr('live.pick', { name }) },
      h('span', { class: 'rib__bar' }, h('span', { class: 'rib__in' },
        h('span', { class: 'rib__acc' }, icon('cast')),
        h('span', { class: 'rib__val onair__name', text: name }),
        g ? h('span', { class: 'onair__guild', text: g.name }) : null,
        Number.isInteger(ch.viewers) ? h('span', { class: 'onair__viewers', text: num(ch.viewers) }) : null)));
    if (g) btn.style.setProperty('--acc', colour(g.colour));
    btn.addEventListener('click', () => {
      if (featured === name) return;
      featured = name;
      if (playing) playing = name; // already watching: switch the stream, stay in the player
      render();
    });
    return btn;
  }

  function render() {
    const box = $('#onAir');
    const live = liveChannels();
    if (!live.length) {
      box.hidden = true; box.replaceChildren(); frame = null; featured = playing = null;
      document.body.classList.remove('is-onair');
      return;
    }
    if (!live.some(c => login(c) === featured)) { featured = login(live[0]); playing = null; }
    const ch = live.find(c => login(c) === featured);
    if (!frame) frame = h('div', { class: 'onair__player' });
    drawPlayer(ch, false);

    // replaceChildren turns a null into the text "null", so the absent ribbon list is filtered out.
    box.replaceChildren(...[
      h('div', { class: 'onair__head' },
        h('span', { class: 'onair__tag' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), tr('hero.live')),
        h('h2', { id: 'onAirHeading', class: 'onair__h', text: tr('live.h') }),
        h('span', { class: 'onair__count', text: tn('live.count', live.length) })),
      frame,
      h('div', { class: 'onair__meta' },
        ch.title ? h('p', { class: 'onair__title', text: ch.title }) : null,
        h('p', { class: 'onair__sub' },
          h('span', { class: 'onair__since', text: meta(ch) }),
          h('a', { class: 'onair__out', href: ch.url, rel: 'noopener' }, tr('live.open'), icon('out')))),
      live.length > 1 ? h('div', { class: 'onair__list' }, live.map(ribbon)) : null,
    ].filter(Boolean));
    box.hidden = false;
    document.body.classList.add('is-onair');
  }

  /* ---- "Streamers" in the top bar: every listed channel, grouped by guild in race order ----
   * A button in the bug's flush blocks (a red "● n live" block in front while someone is live and
   * the check is fresh) opens a panel: per guild its channels as links to Twitch, each with its
   * status. A stale check never says "live": every status then reads "unknown". Esc, a click
   * outside or the close button shut it, and focus goes back to the button. */
  const fresh = st => !!st && (Date.now() - Date.parse(st.checkedAt)) / 60000 <= STALE_MIN;

  function status(ch, isFresh) {
    if (!isFresh || ch.live === null || ch.live === undefined) return h('span', { class: 'streamers__st', text: tr('streams.unknown') });
    if (!ch.live) return h('span', { class: 'streamers__st', text: tr('streams.offline') });
    return h('span', { class: 'streamers__st' },
      h('span', { class: 'streamers__tag' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), tr('streams.live')));
  }

  // A live channel's game, viewers and start, on a line of its own under the name.
  function liveMeta(ch, isFresh) {
    if (!isFresh || ch.live !== true) return null;
    const bits = [ch.game, Number.isInteger(ch.viewers) ? tn('live.viewers', ch.viewers) : null,
      ch.startedAt ? tr('live.since', { time: clock(ch.startedAt) }) : null].filter(Boolean);
    return bits.length ? h('span', { class: 'streamers__meta', text: bits.join(' · ') }) : null;
  }

  function channelRow(ch, isFresh) {
    const name = login(ch);
    return h('li', { class: 'streamers__row' },
      h('a', { class: 'streamers__ch', href: ch.url, rel: 'noopener', target: '_blank', 'aria-label': tr('streams.open', { name: ch.twitch }) },
        h('span', { class: 'streamers__name', text: name }), icon('out')),
      status(ch, isFresh),
      liveMeta(ch, isFresh));
  }

  function renderStreamers() {
    const wrap = $('#streamers');
    if (!wrap) return;
    const st = streams();
    const channels = st ? st.channels.filter(c => login(c)) : [];
    wrap.hidden = !channels.length;
    if (!channels.length) { closeStreamers(false); return; }
    const isFresh = fresh(st);
    const live = isFresh ? channels.filter(c => c.live === true) : [];
    $('#streamersLive').hidden = !live.length;
    $('#streamersLiveN').textContent = tr('streams.liveN', { n: live.length });

    // Guilds in race order, then channels without a guild.
    const groups = [];
    for (const g of data.guilds) {
      const own = channels.filter(c => c.guild === g.name);
      if (own.length) groups.push({ g, own });
    }
    const loose = channels.filter(c => !c.guild || !data.guilds.some(g => g.name === c.guild));
    const checked = new Date(st.checkedAt);
    const sameDay = checked.toDateString() === new Date().toDateString();
    const close = h('button', { type: 'button', class: 'streamers__close', 'aria-label': tr('streams.close') },
      s('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, s('path', { d: 'M3 3l10 10M13 3L3 13' })));
    close.addEventListener('click', () => closeStreamers(true));
    // replaceChildren is the DOM's own and, unlike h(), turns a null into the text "null".
    $('#streamersPanel').replaceChildren(...[
      h('div', { class: 'streamers__head' },
        h('h2', { id: 'streamersTitle', class: 'streamers__h', tabindex: '-1', text: tr('streams.h') }), close),
      h('p', { class: 'streamers__cap', text: tr('streams.cap') }),
      ...groups.map(({ g, own }) => setGuild(h('section', { class: 'streamers__grp' },
        h('h3', { class: 'streamers__guild' }, h('i', { 'aria-hidden': 'true' }), h('span', { text: g.name })),
        h('ul', {}, own.map(c => channelRow(c, isFresh)))), g)),
      loose.length ? h('section', { class: 'streamers__grp streamers__grp--loose' },
        h('h3', { class: 'streamers__guild' }, h('span', { text: tr('streams.noGuild') })),
        h('ul', {}, loose.map(c => channelRow(c, isFresh)))) : null,
      h('p', { class: 'streamers__foot' },
        sameDay ? tr('streams.checked', { time: clock(st.checkedAt) }) : tr('streams.checkedDay', { day: day(st.checkedAt), time: clock(st.checkedAt) }),
        isFresh ? null : h('span', { class: 'streamers__stale', text: ` ${tr('streams.stale')}` })),
    ].filter(Boolean));
  }

  function openStreamers() {
    $('#streamersPanel').hidden = false;
    $('#streamersBtn').setAttribute('aria-expanded', 'true');
    $('#streamersTitle').focus();
  }
  function closeStreamers(refocus) {
    const panel = $('#streamersPanel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    $('#streamersBtn').setAttribute('aria-expanded', 'false');
    if (refocus) $('#streamersBtn').focus();
  }
  if ($('#streamersBtn')) {
    $('#streamersBtn').addEventListener('click', () => ($('#streamersPanel').hidden ? openStreamers() : closeStreamers(true)));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#streamersPanel').hidden) closeStreamers(true); });
    document.addEventListener('click', e => { if (!e.target.closest('#streamers')) closeStreamers(false); });
  }

  document.addEventListener('race:data', e => {
    const first = !page;
    data = e.detail; render(); renderStreamers();
    if (first) check();
  });
  if (typeof race !== 'undefined' && race) { data = race; render(); renderStreamers(); check(); }
  setInterval(() => { if (data) { render(); renderStreamers(); } }, 60 * 1000);
  setInterval(check, POLL_MS);
  // Back on a hidden tab: check now if the last check is older than a poll.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!page || Date.now() - Date.parse(page.checkedAt) >= POLL_MS)) check();
  });
})();
