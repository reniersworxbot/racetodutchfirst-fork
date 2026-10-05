/* Race to Dutch First: Dutch and English UI text.
 *
 * Dutch is the site's language; English is a translation. The language comes from
 * ?lang=nl|en, else the visitor's earlier choice (localStorage 'lang'), else Dutch.
 * The browser's language is deliberately ignored: the race is a Dutch thing.
 *
 * Contract for other scripts (the hall of fame registers its own strings this way):
 *   i18n.lang                 'nl' | 'en'
 *   i18n.t(key, vars)         text for key, {name} placeholders filled from vars
 *   i18n.tn(key, n, vars)     plural: key_one / key_other, with {n} formatted
 *   i18n.add({ nl: {}, en: {} })  register more strings
 *   i18n.num(n, digits) / i18n.locale   numbers and dates in the active locale
 * Switching language re-runs render() in app.js and dispatches 'race:lang'
 * on document with { detail: { lang } }.
 * Static text in index.html carries data-i18n="key" (textContent) or
 * data-i18n-aria-label="key". Game names (guilds, bosses, raids) are never translated.
 */
'use strict';

const i18n = (() => {
  const LANGS = ['nl', 'en'];
  const LOCALES = { nl: 'nl-NL', en: 'en-GB' };
  const strings = { nl: {}, en: {} };

  function stored() {
    try { return localStorage.getItem('lang'); } catch { return null; }
  }

  function pick() {
    let q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch { /* no URL */ }
    if (LANGS.includes(q)) return q;
    const s = stored();
    return LANGS.includes(s) ? s : 'nl';
  }

  const api = {
    lang: pick(),
    get locale() { return LOCALES[api.lang]; },

    add(dict) {
      for (const l of LANGS) Object.assign(strings[l], (dict && dict[l]) || {});
    },

    t(key, vars) {
      const raw = strings[api.lang][key] ?? strings.nl[key] ?? key;
      return raw.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? String(vars[k]) : m));
    },

    tn(key, n, vars) {
      return api.t(`${key}_${n === 1 ? 'one' : 'other'}`, { ...vars, n: api.num(n) });
    },

    num(n, digits = 0) {
      return Number(n).toLocaleString(api.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    },

    /* Remember the choice, keep ?lang in the address bar in step, redraw static text. */
    set(lang) {
      if (!LANGS.includes(lang) || lang === api.lang) return false;
      api.lang = lang;
      try { localStorage.setItem('lang', lang); } catch { /* private mode: this visit only */ }
      try {
        const url = new URL(location.href);
        if (url.searchParams.has('lang')) {
          url.searchParams.set('lang', lang);
          history.replaceState(null, '', url);
        }
      } catch { /* no history API */ }
      api.applyStatic();
      document.dispatchEvent(new CustomEvent('race:lang', { detail: { lang } }));
      return true;
    },

    applyStatic(root = document) {
      document.documentElement.lang = api.lang;
      for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = api.t(el.dataset.i18n);
      for (const el of root.querySelectorAll('[data-i18n-aria-label]')) {
        el.setAttribute('aria-label', api.t(el.dataset.i18nAriaLabel));
      }
      for (const b of root.querySelectorAll('.lang-switch [data-lang]')) {
        b.setAttribute('aria-pressed', String(b.dataset.lang === api.lang));
      }
    },
  };
  return api;
})();

i18n.add({
  nl: {
    'doc.title': 'Race to Dutch First · Nederlandstalige WoW-guilds naar Cutting Edge',
    'doc.titlePast': 'Race to Dutch First · {season}: wie haalde als eerste Cutting Edge?',
    'lang.label': 'Taal',
    'title': 'Wie haalt als eerste Cutting Edge?',
    'lead': 'De race tussen Nederlandstalige guilds naar de laatste Mythic-boss van de huidige raid tier, live gevolgd via Raider.IO en Warcraft Logs.',

    'feed.h': 'Laatste kills',
    'timeline.h': 'Voortgang',
    'timeline.cap': 'Trede = kill · tussenstap = nieuwe beste pull · ster = eerste kill van de race',
    'timeline.asTable': 'Toon als tabel',
    'timeline.full': 'Volledig scherm',
    'timeline.close': 'Sluiten',
    'guild.h': 'Per guild',
    'guild.cap': 'Per boss de killdatum of de beste pull; rechts elke pull op de huidige boss.',
    'guild.capPast': 'Per boss de killdatum of de beste pull; rechts waar elke guild eindigde.',
    'guild.th': 'Guild',
    'guild.thPulls': 'Huidige boss',
    'guild.thPullsPast': 'Eindstand',
    'guild.best': 'beste {pct}',

    'footer.loading': 'Data laden…',
    'footer.src1': 'Bronnen',
    'footer.src2': 'guildprofielen, kills en live tracking',
    'footer.src3': 'gelogde fights',
    'footer.howH': 'Zo tellen we',
    'footer.top': 'Naar boven',
    'footer.src4': 'Een pull die nergens gevolgd of gelogd werd, ontbreekt hier ook.',
    'footer.src4Past': 'Een pull die Raider.IO niet zag, ontbreekt hier ook.',
    'footer.srcLive': 'wie er live is op Twitch',
    'footer.srcArt': 'de boss-renders',
    'footer.code': 'Broncode op GitHub',

    'pill.bosses': '{n} bosses',
    'pill.ce': 'Cutting Edge: {boss}',
    'pill.since': 'Sinds {date}',
    'winner.label': 'Winnaar',
    'winner.text': 'De eerste Nederlandstalige guild met Cutting Edge: {boss} Mythic verslagen op {when}.',
    'live.now': 'Nu aan het raiden',
    'live.recent': 'Raidde om {time}',
    'live.title': 'Laatste pull of kill: {when}',

    'tile.place': 'Plaats {n}',
    'tile.ce': 'Cutting Edge behaald',
    'tile.done': 'Alles verslagen',
    'tile.noPulls': 'Nog geen pulls gezien',
    'tile.noPullsKept': 'Geen pulls bewaard',
    'tile.best': 'nog {pct} · {pulls}',
    'tile.track': 'racepositie {pos} van {total}',
    'rank.world': 'Wereld {n}',
    'rank.title': 'Raider.IO-rang in {raid} Mythic: wereld, regio en realm',

    'feed.empty': 'Nog geen Mythic-kills.',

    'timeline.kills': '{guild}: {n} kills',
    'timeline.point': '{guild}: {boss}, {date} ({n}e kill)',
    'timeline.end': '{guild}: {n} Mythic-kills',
    'timeline.endPct': '{guild}: {n} Mythic-kills, en {pct} door {boss} (beste pull {best})',
    'timeline.nowAt': 'nu {pct} door {boss}',
    'timeline.thGuild': 'Guild',
    'timeline.thKills': 'Mythic-kills, op volgorde',
    'timeline.none': 'Nog geen Mythic-kill',
    'vg.mode': 'Weergave van de voortgang',
    'vg.bump': 'Plaatsen',
    'vg.small': 'Per guild',
    'vg.ring': 'Ronde',
    'vg.passShort': '{a} › {b}',
    'vg.bumpLabel': 'De plaats van elke guild in de race door de tijd; een ring is een inhaalbeweging.',
    'vg.ringLabel': 'De race als atletiekbaan: start en Cutting Edge bovenaan, een baan per guild, de leider buiten.',
    'vg.start': 'START',
    'vg.nowShort': 'nu',
    'vg.endShort': 'einde',
    'log.h': 'Wedstrijdverslag',
    'log.cap': 'De race dag na dag: kills, eerste kills en inhaalbewegingen, met de stand aan het eind van de dag.',
    'log.first': '{guild} is de eerste die {boss} verslaat',
    'log.kill': '{guild} verslaat {boss}',
    'log.pass': '{guild} passeert {other} en staat nu {rank}e',
    'log.detail': '{n}e kill',
    'log.stand': 'Stand aan het eind van de dag',
    'log.more': 'Toon het hele verslag ({n} dagen)',
    'log.less': 'Toon minder',
    'log.empty': 'Nog geen kills.',
    'vg.chart': 'Grafiek',
    'vg.replay': 'Replay',
    'vg.range': 'Periode',
    'vg.all': 'Alles',
    'vg.2w': '2 weken',
    'vg.1w': '1 week',
    'vg.hint': 'Sleep over de grafiek om in te zoomen · klik voor de stand op dat moment',
    'vg.hintTouch': 'Tik of veeg over de grafiek voor de stand op dat moment',
    'vg.finish': 'Cutting Edge · {boss}',
    'vg.go': 'nog {n}',
    'vg.goTitle': '{guild}: {k}/{total}, nog {n} bosses tot Cutting Edge',
    'vg.done': '{guild}: Cutting Edge',
    'vg.day': 'dag {n}',
    'vg.clear': 'Terug naar nu',
    'vg.now': 'Stand nu',
    'vg.end': 'Eindstand',
    'vg.chartLabel': 'Voortgang per guild. Pijltjes links en rechts kiezen een moment (Shift: een week), Esc wist het, 0 toont alles.',
    'vg.play': 'Afspelen',
    'vg.pause': 'Pauze',
    'vg.slider': 'Moment in de race',
    'vg.notYet': 'nog geen pull',
    'vg.left': '{boss} · nog {pct}',
    'vg.allDown': 'alles verslagen',
    'boss.unknownPulls': 'pulls onbekend',
    'boss.first': 'eerste kill',
    'boss.bestAria': 'Beste pull {pct} health over',
    'boss.next': 'volgende',
    'boss.stopped': 'gestopt',
    'boss.untried': 'nog niet geprobeerd',

    'curve.title': '{guild} op {boss}: {n} pulls, beste {pct} health over',
    'curve.pullTitle': 'Pull {n}, {date}: {pct} health over',

    'pulls_one': '{n} pull',
    'pulls_other': '{n} pulls',
    'upd.at': 'Bijgewerkt om {time}',
    'upd.atDay': 'Bijgewerkt op {day} om {time}',
    'upd.next': 'volgende normaal om {time}',
    'title.a': 'Wie haalt als eerste',
    'title.b': 'Cutting Edge?',
    'tk.first': 'eerste kill',
    'hero.live': 'Live',
    'hero.standings': 'Klassement',
    'hero.day': 'Dag {n}',
    'hero.dayTitle': 'Dag {n} van de race, gestart op {date}',
    'upd.none': 'Geen data',
    'upd.archived': 'Afgesloten op {date}',
    'upd.archivedNoDate': 'Afgesloten seizoen',
    'title.aPast': 'Wie haalde als eerste',
    'lead.archived': 'Terugblik op {season}: zo liep de race tussen Nederlandstalige guilds naar Cutting Edge in {raids}.',
    'pill.period': '{from} – {to}',
    'season.label': 'Seizoen',
    'nav.label': 'Weergave',
    'nav.race': 'Race',
    'nav.guilds': 'Guilds',
    'nav.hof': 'Hall of fame',
    'side.h': '{raid} telt niet mee voor de race.',
    'side.kills': 'Mythic {boss}: {list}.',
    'side.none': 'Niemand versloeg {boss} op Mythic.',
    'wcl.on': 'Waar Raider.IO en Warcraft Logs dezelfde boss kennen, telt de vroegste kill, het hoogste aantal pulls en de laagste beste %.',
    'wcl.off': 'Warcraft Logs was bij deze verversing niet beschikbaar.',
    'wcl.archive': 'Dit seizoen komt alleen van Raider.IO.',
    'err.load': 'De racedata kon niet geladen worden ({msg}). Probeer het straks opnieuw.',
    'err.content': 'onverwachte inhoud',
    'streams.btn': 'Streamers',
    'streams.h': 'Streamers',
    'streams.cap': 'De Twitch-kanalen van raiders in de race.',
    'streams.close': 'Sluiten',
    'streams.noGuild': 'Zonder guild',
    'streams.live': 'Live',
    'streams.liveN': '{n} live',
    'streams.offline': 'Offline',
    'streams.unknown': 'Status onbekend',
    'streams.checked': 'Gecheckt om {time}',
    'streams.checkedDay': 'Gecheckt op {day} om {time}',
    'streams.stale': 'Te lang geleden om te zeggen wie nu live is.',
    'streams.open': 'Open {name} op Twitch',
    'live.h': 'Nu live',
    'live.since': 'live sinds {time}',
    'live.viewers_one': '{n} kijker',
    'live.viewers_other': '{n} kijkers',
    'live.count_one': '{n} stream',
    'live.count_other': '{n} streams',
    'live.play': 'Kijk {name} hier',
    'live.play_note': 'Laadt de speler van Twitch',
    'live.frame': 'Twitch-stream van {name}',
    'live.pick': 'Toon {name} in de speler',
    'live.open': 'Open op Twitch',

    'hof.role.tank': 'Tanks',
    'hof.role.healer': 'Healers',
    'hof.role.dps': 'DPS',
    'hof.h': 'Hall of fame',
    'hof.cap': 'Kies een boss: wie hem als eerste versloeg, met welk team, en wie volgde.',
    'hof.side': 'Eerste kill · telt niet mee',
    'hof.unknown': 'Team onbekend: deze kill kennen we alleen uit Warcraft Logs.',
    'hof.raiders.h': 'Raiders',
    'hof.raiders.cap': 'Eerst wie het vaakst bij de eerste kill van de race was, dan wie de meeste bosses mee versloeg met zijn guild. Het zijn characters, geen spelers: een alt telt apart.',
    'hof.col.rank': '#',
    'hof.col.raider': 'Raider',
    'hof.col.guild': 'Guild',
    'hof.col.firsts': 'Eerste kills',
    'hof.col.kills': 'Kills',
    'hof.more': 'Toon alle {n} raiders',
    'hof.less': 'Toon minder',
    'hof.empty': 'Nog geen Mythic-kills.',
    'hof.tabs': 'Bosses',
    'hof.firstDay': 'Eerste kill · dag {n}',
    'hof.day': 'dag {n}',
    'hof.sideShort': 'telt niet mee',
    'hof.mythic': '{boss} Mythic',
    'hof.after': 'Daarna',
    'hof.daysAfter': '+{n} d',
    'hof.sameDay': 'zelfde dag',
    'hof.notYet': 'Nog door niemand verslagen op Mythic.',
    'hof.lastTrophy': 'De laatste trofee',
    'hof.toEarn': 'Nog te verdienen',
    'hof.present.h': 'Altijd paraat',
    'hof.present.cap': 'Per guild de raiders die bij elke Mythic-kill van hun guild waren. Een alt telt apart.',
    'hof.present.all_one': 'bij de enige kill',
    'hof.present.all_other': 'bij alle {n} kills',
    'hof.present.none': 'niemand bij alle {n} kills',
  },

  en: {
    'doc.title': 'Race to Dutch First · Dutch-speaking WoW guilds racing to Cutting Edge',
    'doc.titlePast': 'Race to Dutch First · {season}: who got Cutting Edge first?',
    'lang.label': 'Language',
    'title': 'Who gets Cutting Edge first?',
    'lead': 'The race between Dutch-speaking guilds to the last Mythic boss of the current raid tier, followed live via Raider.IO and Warcraft Logs.',

    'feed.h': 'Latest kills',
    'timeline.h': 'Progress',
    'timeline.cap': 'Step = kill · part step = a new best pull · star = the race\'s first kill',
    'timeline.asTable': 'Show as table',
    'timeline.full': 'Full screen',
    'timeline.close': 'Close',
    'guild.h': 'By guild',
    'guild.cap': 'Per boss the kill date or the best pull; on the right every pull on the current boss.',
    'guild.capPast': 'Per boss the kill date or the best pull; on the right where each guild ended.',
    'guild.th': 'Guild',
    'guild.thPulls': 'Current boss',
    'guild.thPullsPast': 'Final standing',
    'guild.best': 'best {pct}',

    'footer.loading': 'Loading data…',
    'footer.src1': 'Sources',
    'footer.src2': 'guild profiles, kills and live tracking',
    'footer.src3': 'logged fights',
    'footer.howH': 'How we count',
    'footer.top': 'Back to top',
    'footer.src4': 'A pull that nobody tracked or logged is missing here too.',
    'footer.src4Past': 'A pull Raider.IO did not see is missing here too.',
    'footer.srcLive': 'who is live on Twitch',
    'footer.srcArt': 'the boss renders',
    'footer.code': 'Source code on GitHub',

    'pill.bosses': '{n} bosses',
    'pill.ce': 'Cutting Edge: {boss}',
    'pill.since': 'Since {date}',
    'winner.label': 'Winner',
    'winner.text': 'The first Dutch-speaking guild with Cutting Edge: {boss} Mythic defeated on {when}.',
    'live.now': 'Raiding now',
    'live.recent': 'Raided at {time}',
    'live.title': 'Latest pull or kill: {when}',

    'tile.place': 'Place {n}',
    'tile.ce': 'Cutting Edge achieved',
    'tile.done': 'Everything defeated',
    'tile.noPulls': 'No pulls seen yet',
    'tile.noPullsKept': 'No pulls kept',
    'tile.best': '{pct} left · {pulls}',
    'tile.track': 'race position {pos} of {total}',
    'rank.world': 'World {n}',
    'rank.title': 'Raider.IO rank in {raid} Mythic: world, region and realm',

    'feed.empty': 'No Mythic kills yet.',

    'timeline.kills': '{guild}: {n} kills',
    'timeline.point': '{guild}: {boss}, {date} (kill {n})',
    'timeline.end': '{guild}: {n} Mythic kills',
    'timeline.endPct': '{guild}: {n} Mythic kills, and {pct} through {boss} (best pull {best})',
    'timeline.nowAt': 'now {pct} through {boss}',
    'timeline.thGuild': 'Guild',
    'timeline.thKills': 'Mythic kills, in order',
    'timeline.none': 'No Mythic kill yet',
    'vg.mode': 'Progress view',
    'vg.bump': 'Places',
    'vg.small': 'Per guild',
    'vg.ring': 'Lap',
    'vg.passShort': '{a} › {b}',
    'vg.bumpLabel': "Each guild's place in the race over time; a ring marks an overtake.",
    'vg.ringLabel': 'The race as a running track: start and Cutting Edge at the top, a lane per guild, the leader outside.',
    'vg.start': 'START',
    'vg.nowShort': 'now',
    'vg.endShort': 'end',
    'log.h': 'Race log',
    'log.cap': 'The race day by day: kills, first kills and overtakes, with the standings at the end of the day.',
    'log.first': '{guild} is the first to defeat {boss}',
    'log.kill': '{guild} defeats {boss}',
    'log.pass': '{guild} passes {other}, now in place {rank}',
    'log.detail': 'kill {n}',
    'log.stand': 'Standings at the end of the day',
    'log.more': 'Show the whole log ({n} days)',
    'log.less': 'Show less',
    'log.empty': 'No kills yet.',
    'vg.chart': 'Chart',
    'vg.replay': 'Replay',
    'vg.range': 'Period',
    'vg.all': 'All',
    'vg.2w': '2 weeks',
    'vg.1w': '1 week',
    'vg.hint': 'Drag across the chart to zoom in · click for the standings at that moment',
    'vg.hintTouch': 'Tap or swipe across the chart for the standings at that moment',
    'vg.finish': 'Cutting Edge · {boss}',
    'vg.go': '{n} to go',
    'vg.goTitle': '{guild}: {k}/{total}, {n} bosses to Cutting Edge',
    'vg.done': '{guild}: Cutting Edge',
    'vg.day': 'day {n}',
    'vg.clear': 'Back to now',
    'vg.now': 'Standings now',
    'vg.end': 'Final standings',
    'vg.chartLabel': 'Progress per guild. Left and right arrows pick a moment (Shift: a week), Esc clears it, 0 shows everything.',
    'vg.play': 'Play',
    'vg.pause': 'Pause',
    'vg.slider': 'Moment in the race',
    'vg.notYet': 'no pull yet',
    'vg.left': '{boss} · {pct} left',
    'vg.allDown': 'everything defeated',
    'boss.unknownPulls': 'pulls unknown',
    'boss.first': 'first kill',
    'boss.bestAria': 'Best pull {pct} health left',
    'boss.next': 'next',
    'boss.stopped': 'stopped',
    'boss.untried': 'not tried yet',

    'curve.title': '{guild} on {boss}: {n} pulls, best {pct} health left',
    'curve.pullTitle': 'Pull {n}, {date}: {pct} health left',

    'pulls_one': '{n} pull',
    'pulls_other': '{n} pulls',
    'upd.at': 'Updated at {time}',
    'upd.atDay': 'Updated on {day} at {time}',
    'upd.next': 'next one normally at {time}',
    'title.a': 'Who gets',
    'title.b': 'Cutting Edge first?',
    'tk.first': 'first kill',
    'hero.live': 'Live',
    'hero.standings': 'Standings',
    'hero.day': 'Day {n}',
    'hero.dayTitle': 'Day {n} of the race, started on {date}',
    'upd.none': 'No data',
    'upd.archived': 'Closed on {date}',
    'upd.archivedNoDate': 'Finished season',
    'title.aPast': 'Who got',
    'lead.archived': 'Looking back at {season}: how the race between Dutch-speaking guilds to Cutting Edge went in {raids}.',
    'pill.period': '{from} – {to}',
    'season.label': 'Season',
    'nav.label': 'View',
    'nav.race': 'Race',
    'nav.guilds': 'Guilds',
    'nav.hof': 'Hall of fame',
    'side.h': "{raid} doesn't count for the race.",
    'side.kills': 'Mythic {boss}: {list}.',
    'side.none': 'Nobody killed {boss} on Mythic.',
    'wcl.on': 'Where Raider.IO and Warcraft Logs know the same boss, the earliest kill, the most pulls and the lowest best % count.',
    'wcl.off': 'Warcraft Logs was not available for this refresh.',
    'wcl.archive': 'This season comes from Raider.IO alone.',
    'err.load': "The race data couldn't be loaded ({msg}). Please try again later.",
    'err.content': 'unexpected content',
    'streams.btn': 'Streamers',
    'streams.h': 'Streamers',
    'streams.cap': 'The Twitch channels of raiders in the race.',
    'streams.close': 'Close',
    'streams.noGuild': 'No guild',
    'streams.live': 'Live',
    'streams.liveN': '{n} live',
    'streams.offline': 'Offline',
    'streams.unknown': 'Status unknown',
    'streams.checked': 'Checked at {time}',
    'streams.checkedDay': 'Checked on {day} at {time}',
    'streams.stale': 'Too long ago to say who is live now.',
    'streams.open': 'Open {name} on Twitch',
    'live.h': 'Live now',
    'live.since': 'live since {time}',
    'live.viewers_one': '{n} viewer',
    'live.viewers_other': '{n} viewers',
    'live.count_one': '{n} stream',
    'live.count_other': '{n} streams',
    'live.play': 'Watch {name} here',
    'live.play_note': 'Loads the Twitch player',
    'live.frame': 'Twitch stream of {name}',
    'live.pick': 'Show {name} in the player',
    'live.open': 'Open on Twitch',
    'hof.role.tank': 'Tanks',
    'hof.role.healer': 'Healers',
    'hof.role.dps': 'DPS',
    'hof.h': 'Hall of fame',
    'hof.cap': 'Pick a boss: who beat it first, with which team, and who followed.',
    'hof.side': "First kill · doesn't count",
    'hof.unknown': 'Team unknown: this kill is only known from Warcraft Logs.',
    'hof.raiders.h': 'Raiders',
    'hof.raiders.cap': 'First who was in the race\'s first kill most often, then who defeated the most bosses with their guild. These are characters, not players: an alt counts separately.',
    'hof.col.rank': '#',
    'hof.col.raider': 'Raider',
    'hof.col.guild': 'Guild',
    'hof.col.firsts': 'First kills',
    'hof.col.kills': 'Kills',
    'hof.more': 'Show all {n} raiders',
    'hof.less': 'Show fewer',
    'hof.empty': 'No Mythic kills yet.',
    'hof.tabs': 'Bosses',
    'hof.firstDay': 'First kill · day {n}',
    'hof.day': 'day {n}',
    'hof.sideShort': "doesn't count",
    'hof.mythic': '{boss} Mythic',
    'hof.after': 'Then',
    'hof.daysAfter': '+{n} d',
    'hof.sameDay': 'same day',
    'hof.notYet': 'Nobody has defeated it on Mythic yet.',
    'hof.lastTrophy': 'The last trophy',
    'hof.toEarn': 'Still to win',
    'hof.present.h': 'Always there',
    'hof.present.cap': 'For each guild, the raiders who were in every one of its Mythic kills. An alt counts separately.',
    'hof.present.all_one': 'in its only kill',
    'hof.present.all_other': 'in all {n} kills',
    'hof.present.none': 'nobody in all {n} kills',
  },
});
