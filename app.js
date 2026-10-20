(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };

  /* ---------- возврат по ссылке из письма (читаем адрес до того, как его обработает клиент) ---------- */
  var linkNote = null, linkWelcome = false;
  (function () {
    var raw = (location.hash || '').replace(/^#/, '') || (location.search || '').replace(/^\?/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    var code = (p.get('error_code') || '').toLowerCase();
    if (code || p.get('error')) {
      if (code === 'otp_expired' || /expired|invalid/i.test(p.get('error_description') || '')) {
        linkNote = { kind: 'ok', resend: true, text: 'Эта ссылка уже использована или устарела. Часто письма «открывают» сами почтовые сервисы, и тогда почта уже подтверждена: просто войди. Если вход не получается, отправь письмо ещё раз.' };
      } else {
        linkNote = { kind: 'err', resend: true, text: 'Не удалось подтвердить почту по ссылке. Попробуй войти или отправь письмо ещё раз.' };
      }
    } else if (p.get('type') === 'signup' && p.get('access_token')) {
      linkWelcome = true;
    }
  })();

  /* ---------- настройка ---------- */
  var cfg = window.QUESTLOG_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    /^https:\/\//.test(cfg.SUPABASE_URL) && cfg.SUPABASE_URL.indexOf('YOUR-') < 0 && cfg.SUPABASE_ANON_KEY.indexOf('YOUR-') < 0);
  var sb = (configured && window.supabase) ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  var BUCKET = 'covers';

  var STATUS = {
    playing: { label: 'Играю', color: 'var(--play)' },
    queue: { label: 'В очереди', color: 'var(--queue)' },
    beaten: { label: 'Пройдено', color: 'var(--done)' },
    wish: { label: 'Хочу', color: 'var(--wish)' },
    dropped: { label: 'Брошено', color: 'var(--drop)' }
  };
  var ORDER = ['playing', 'queue', 'beaten', 'wish', 'dropped'];
  var RANKS = ['Новичок', 'Искатель', 'Следопыт', 'Ветеран', 'Герой', 'Легенда', 'Хранитель карт'];

  var HEART = ['.XX..XX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '...XX...'];
  var CART = [
    '..XXXXXXXX..', '.X........X.', '.X.XXXXXX.X.', '.X.X....X.X.', '.X.X....X.X.', '.X.XXXXXX.X.',
    '.X........X.', '.X..XXXX..X.', '.XXXXXXXXXXX', '.XX.XXXX.XX.', '.XX.XXXX.XX.', '.XXXXXXXXXXX'
  ];
  var STAR = ['..X..', '.XXX.', 'XXXXX', '.XXX.', '.X.X.'];
  var SUN = ['....X....', '.X..X..X.', '..X...X..', '...XXX...', 'XX.XXX.XX', '...XXX...', '..X...X..', '.X..X..X.', '....X....'];
  var MOON = ['...XXXX..', '..XXXX...', '.XXXX....', '.XXXX....', '.XXXX....', '.XXXX....', '..XXXX..X', '...XXXXXX', '.....XXX.'];

  /* ---------- состояние ---------- */
  var games = [];
  var user = null;
  var booted = false;
  var loaded = false;
  var recovering = false;
  var chains = {};
  var view = { tab: 'all', q: '', sort: 'updated', mode: 'cards' };
  try { if (localStorage.getItem('gamelog.view') === 'shelf') view.mode = 'shelf'; } catch (e) {}
  var draft = null;
  var opener = null;
  var toastTimer = null;
  var authMode = 'in';
  var armedDelete = false;

  /* ---------- утилиты ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function pix(map, size, fill) {
    var r = '';
    for (var y = 0; y < map.length; y++) for (var x = 0; x < map[y].length; x++)
      if (map[y][x] === 'X') r += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    return '<svg viewBox="0 0 ' + map[0].length + ' ' + map.length + '" width="' + size + '" height="' + Math.round(size * map.length / map[0].length) + '" fill="' + (fill || 'currentColor') + '" aria-hidden="true">' + r + '</svg>';
  }
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function sprite(title) {
    var h = hash((title || '?').toLowerCase());
    var r = h || 1;
    function rnd() { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r; }
    var hue = h % 360, hue2 = (hue + 150) % 360;
    var body = 'hsl(' + hue + ' 70% 56%)', eye = 'hsl(' + hue2 + ' 85% 70%)';
    var out = '';
    for (var y = 0; y < 7; y++) {
      for (var x = 0; x < 4; x++) {
        var on = (rnd() % 100) < (x === 3 ? 70 : 52);
        if (!on) continue;
        var c = (y === 2 && x === 1) ? eye : body;
        out += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + c + '"/>';
        if (x !== 3) out += '<rect x="' + (6 - x) + '" y="' + y + '" width="1" height="1" fill="' + c + '"/>';
      }
    }
    return '<svg viewBox="0 0 7 7" width="100%" height="100%" aria-hidden="true">' + out + '</svg>';
  }
  function stars(n, size) {
    var out = '<span class="stars" role="img" aria-label="Оценка ' + n + ' из 5">';
    for (var i = 1; i <= 5; i++) out += '<span class="' + (i <= n ? '' : 'off') + '">' + pix(STAR, size) + '</span>';
    return out + '</span>';
  }
  function seg(n, total) {
    var out = '';
    for (var i = 0; i < total; i++) out += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return out;
  }
  function fmtK(h) {
    h = Number(h) || 0;
    if (h < 10000) return fmt(h);
    var u = h >= 1e6 ? 'м' : 'к', v = h >= 1e6 ? h / 1e6 : h / 1e3;
    return (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')) + u;
  }
  function fmt(h) { h = Number(h) || 0; return Number.isInteger(h) ? String(h) : h.toFixed(1); }
  function toast(msg, kind) {
    var t = $('#toast'); t.className = 'toast' + (kind ? ' ' + kind : ''); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function errText(e) {
    var m = String((e && e.message) || '').toLowerCase();
    if (m.indexOf('games_limit_reached') >= 0) return 'Достигнут лимит: 500 игр на аккаунт.';
    if (m.indexOf('jwt') >= 0 || m.indexOf('not authenticated') >= 0) return 'Сессия истекла. Войди заново.';
    return 'Не удалось сохранить. Проверь соединение и попробуй ещё раз.';
  }

  /* ---------- данные ---------- */
  function coverUrl(path, stamp) {
    if (!path) return '';
    var u = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    return u + '?v=' + (Date.parse(stamp) || Date.now());
  }
  function fromRow(r) {
    return {
      id: r.id, title: r.title, platform: r.platform || '', genre: r.genre || '', status: r.status,
      progress: r.progress || 0, hours: Number(r.hours) || 0, rating: r.rating || 0, notes: r.notes || '',
      cover_path: r.cover_path || null, cover: coverUrl(r.cover_path, r.updated_at),
      updated: Date.parse(r.updated_at) || 0, added: Date.parse(r.created_at) || 0, coop: r.coop_with || null
    };
  }
  function toRow(g, path) {
    return {
      id: g.id, user_id: user.id, title: g.title, platform: g.platform || '', genre: g.genre || '',
      status: g.status, progress: Math.max(0, Math.min(100, Math.round(g.progress || 0))),
      hours: Math.max(0, Math.min(99999, Math.round((Number(g.hours) || 0) * 10) / 10)),
      rating: Math.max(0, Math.min(5, Math.round(g.rating || 0))), notes: g.notes || '', cover_path: path || null, coop_with: g.coop || null
    };
  }
  function queue(id, fn) {
    var p = (chains[id] || Promise.resolve()).then(fn);
    chains[id] = p.catch(function () {});
    return p;
  }
  async function loadGames() {
    var r = await sb.from('games').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(500);
    if (r.error) { toast('Не удалось загрузить игры. Обнови страницу.'); return; }
    if (viewing) { mine = r.data.map(fromRow); return; }
    games = r.data.map(fromRow); loaded = true; render();
  }
  function saveGame(g, blob, removeCover) {
    g.updated = Date.now(); if (!g.added) g.added = g.updated;
    var i = games.findIndex(function (x) { return x.id === g.id; });
    if (i >= 0) { if (g.status === 'beaten' && games[i].status !== 'beaten') sfx('win'); games[i] = g; } else { games.push(g); animIn = g.id; sfx(g.status === 'beaten' ? 'win' : 'coin'); }
    render();
    var snap = Object.assign({}, g);
    return queue(snap.id, async function () {
      var path = snap.cover_path || null;
      if (blob) {
        path = user.id + '/' + snap.id + '.jpg';
        var up = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
        if (up.error) throw up.error;
      } else if (removeCover && path) {
        await sb.storage.from(BUCKET).remove([path]);
        path = null;
      }
      var r = await sb.from('games').upsert(toRow(snap, path)).select('id,updated_at').single();
      if (r.error) throw r.error;
      var cur = games.find(function (x) { return x.id === snap.id; });
      if (cur) {
        cur.cover_path = path;
        if (blob || removeCover) cur.cover = path ? coverUrl(path, r.data.updated_at) : '';
        render();
      }
    }).catch(function (e) { toast(errText(e)); loadGames(); });
  }
  function removeGame(id) {
    var g = games.find(function (x) { return x.id === id; });
    sfx('eject');
    var ce = fxOn() ? cardEl(id) : null;
    if (ce) {
      ce.classList.add('eject');
      setTimeout(function () { games = games.filter(function (x) { return x.id !== id; }); render(); }, 440);
    } else { games = games.filter(function (x) { return x.id !== id; }); render(); }
    return queue(id, async function () {
      if (g && g.cover_path) await sb.storage.from(BUCKET).remove([g.cover_path]);
      var r = await sb.from('games').delete().eq('id', id);
      if (r.error) throw r.error;
    }).catch(function (e) { toast(errText(e)); loadGames(); });
  }

  /* ---------- производные ---------- */
  function profile() {
    var beaten = 0, playing = 0, hours = 0, rs = 0, rn = 0;
    games.forEach(function (g) {
      if (g.status === 'beaten') beaten++;
      if (g.status === 'playing') playing++;
      hours += Number(g.hours) || 0;
      if (g.rating > 0) { rs += g.rating; rn++; }
    });
    var xp = beaten * 120 + Math.round(hours) * 3 + playing * 15 + (viewing ? 0 : bonusXp());
    var lvl = 1 + Math.floor(Math.sqrt(xp / 60));
    var lo = (lvl - 1) * (lvl - 1) * 60, hi = lvl * lvl * 60;
    return { n: games.length, hours: hours, beaten: beaten, avg: rn ? rs / rn : null, xp: xp, lvl: lvl, lo: lo, hi: hi };
  }
  function visible() {
    var q = view.q.trim().toLowerCase();
    var list = games.filter(function (g) {
      if (view.tab !== 'all' && g.status !== view.tab) return false;
      if (!q) return true;
      return [g.title, g.genre, g.platform, g.notes].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var s = view.sort;
    list.sort(function (a, b) {
      if (s === 'rating') return (b.rating || 0) - (a.rating || 0) || (b.updated || 0) - (a.updated || 0);
      if (s === 'hours') return (b.hours || 0) - (a.hours || 0);
      if (s === 'title') return String(a.title).localeCompare(String(b.title), 'ru');
      return (b.updated || 0) - (a.updated || 0);
    });
    return list;
  }

  /* ---------- отрисовка ---------- */
  var reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function fxOn() {
    var d = document.documentElement;
    return !reduceMotion && d.getAttribute('data-fx') !== 'off';
  }
  function fitNum(el) {
    el.style.fontSize = '';
    if (!el.clientWidth) return;
    var fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    while (el.scrollWidth > el.clientWidth + 1 && fs > 8) { fs -= 1; el.style.fontSize = fs + 'px'; }
  }
  function fitAll() { var l = document.querySelectorAll('.stat dd'); for (var i = 0; i < l.length; i++) fitNum(l[i]); }
  window.addEventListener('resize', fitAll);
  function setNum(el, text, delay) {
    if (el._t === text) return;
    var first = el._t === undefined; el._t = text;
    clearInterval(el._i);
    if (first || !fxOn() || !/^\d+$/.test(text)) { el.textContent = text; fitNum(el); return; }
    var n = 0, len = text.length;
    el._i = setInterval(function () {
      n++;
      if (n < 9 + delay) el.textContent = String(Math.floor(Math.random() * Math.pow(10, len))).padStart(len, '0');
      else { clearInterval(el._i); el.textContent = text; fitNum(el); }
    }, 55);
  }
  var luTimer = null;
  function showLevelUp(n) {
    var el = $('#lvlup'); $('#lu-n').textContent = 'LVL ' + n; el.hidden = false;
    sfx('lvl');
    clearTimeout(luTimer); luTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }
  function renderHud() {
    var p = profile();
    $('#lvl').textContent = 'LVL ' + String(p.lvl).padStart(2, '0');
    $('#rank').textContent = RANKS[Math.min(p.lvl - 1, RANKS.length - 1)];
    $('#xp').textContent = 'XP ' + p.xp;
    $('#xp-next').textContent = 'до LVL ' + (p.lvl + 1) + ': ' + (p.hi - p.xp);
    $('#xpbar').innerHTML = seg(Math.round(20 * (p.xp - p.lo) / (p.hi - p.lo)), 20);
    setNum($('#s-games'), String(p.n), 0);
    setNum($('#s-hours'), fmtK(Math.round(p.hours * 10) / 10), 3);
    setNum($('#s-done'), String(p.beaten), 6);
    $('#s-avg').textContent = p.avg == null ? '—' : p.avg.toFixed(1);
  }
  function renderTabs() {
    var counts = { all: games.length };
    ORDER.forEach(function (k) { counts[k] = 0; });
    games.forEach(function (g) { if (counts[g.status] != null) counts[g.status]++; });
    var html = '';
    ['all'].concat(ORDER).forEach(function (k) {
      var label = k === 'all' ? 'Все' : STATUS[k].label;
      html += '<button class="tab" type="button" data-tab="' + k + '" aria-pressed="' + (view.tab === k) + '">' + label + '<span class="n">' + counts[k] + '</span></button>';
    });
    $('#tabs').innerHTML = html;
  }
  function cardExtra(g, ro) {
    var K = [['fire', 'Огонь'], ['want', 'Тоже хочу'], ['hurry', 'Пройди!']];
    var c = rx.cnt[g.id] || {}, h = '<div class="cact' + (ro ? ' ro' : '') + '">';
    if (ro) {
      K.forEach(function (k) {
        h += '<button class="rxb" type="button" data-act="rx" data-id="' + esc(g.id) + '" data-k="' + k[0] + '" aria-pressed="' + !!rx.mine[g.id + ':' + k[0]] + '">' + k[1] + '</button>';
      });
      h += '<button class="rxb add" type="button" data-act="wishadd" data-id="' + esc(g.id) + '">В «Хочу»</button>';
    } else {
      var tot = 0, tt = [];
      K.forEach(function (k) { if (c[k[0]]) { tot += c[k[0]]; tt.push(k[1] + ' ' + c[k[0]]); } });
      if (tot) h += '<span class="rxc" title="' + esc(tt.join(', ')) + '">Реакции ' + tot + '</span>';
      h += '<button class="rxb" type="button" data-act="rec" data-id="' + esc(g.id) + '">Посоветовать</button>';
    }
    return h + '</div>';
  }
  function card(g) {
    var st = STATUS[g.status] || STATUS.queue;
    var segs = Math.round((g.status === 'beaten' ? 100 : (g.progress || 0)) / 10);
    var ro = !!viewing, ed = ro ? '' : ' data-act="edit" data-id="' + esc(g.id) + '"';
    var h = '<article class="panel card' + (g.status === 'beaten' ? ' beaten' : '') + '" data-gid="' + esc(g.id) + '" style="--c:' + st.color + '"><i class="grip" aria-hidden="true"></i>';
    h += '<div class="cover"' + ed + ' aria-hidden="true">' + (g.cover ? '<img src="' + esc(g.cover) + '" alt="">' : sprite(g.title)) + '</div><div class="cbody">';
    h += '<button class="head" type="button"' + ed + (ro ? ' disabled' : '') + ' aria-label="' + (ro ? '' : 'Изменить: ') + esc(g.title) + '">';
    h += '<span class="ht"><span class="title">' + esc(g.title) + '</span>';
    h += '<span class="meta">' + esc(g.platform || 'Платформа не указана') + '</span></span></button>';
    var cf = g.coop ? rel.friends.filter(function (f) { return f.uid === g.coop; })[0] : null;
    h += '<div class="badges"><span class="badge"><i></i>' + st.label + '</span>' + (cf ? '<span class="badge coop">2P · ' + esc(cf.nick) + '</span>' : '') + (g.genre ? '<span class="badge plain">' + esc(g.genre) + '</span>' : '') + '</div>';
    if (g.status !== 'wish') {
      var cp = cf ? coopMap[cf.uid + '|' + g.title.trim().toLowerCase()] : null;
      h += '<div class="prog"><div class="prog-l"><span>Прогресс</span><span>' + (g.status === 'beaten' ? 100 : (g.progress || 0)) + '%' + (cp ? ' · ' + esc(cf.nick) + ' ' + cp + '%' : '') + '</span></div><div class="segbar" style="--c:' + st.color + '">' + seg(segs, 10) + '</div></div>';
    } else {
      h += '<div class="prog ph" aria-hidden="true"><div class="prog-l"><span>&nbsp;</span></div><div class="segbar"></div></div>';
    }
    h += '<p class="note' + (g.notes ? '' : ' nn') + '">' + (g.notes ? esc(g.notes) : '&nbsp;') + '</p>';
    h += '<div class="foot">' + (g.rating > 0 ? stars(g.rating, 14) : '<span class="meta">Без оценки</span>');
    h += '<span class="hours">' + (g.status === 'playing' && !ro ? '<button class="plus" type="button" data-act="plus" data-id="' + esc(g.id) + '" aria-label="Добавить час к «' + esc(g.title) + '»">+1 Ч</button>' : '') + fmtK(g.hours) + ' Ч</span></div>';
    h += cardExtra(g, ro);
    return h + '</div><i class="pins" aria-hidden="true"></i></article>';
  }
  var animIn = null, animAt = {};
  function cardEl(id) {
    var l = document.querySelectorAll('#grid [data-gid]');
    for (var i = 0; i < l.length; i++) if (l[i].getAttribute('data-gid') === id) return l[i];
    return null;
  }
  function renderGrid() {
    var el = $('#grid');
    if (!loaded) {
      el.innerHTML = '<div class="panel empty" style="grid-column:1/-1"><h2>Загрузка<span class="blink">_</span></h2></div>';
      return;
    }
    if (!games.length && viewing) {
      el.innerHTML = '<div class="panel empty" style="grid-column:1/-1"><h2>Пока пусто</h2><p>У этого игрока ещё нет игр.</p></div>';
      return;
    }
    if (!games.length) {
      el.innerHTML = '<div class="panel empty" style="grid-column:1/-1"><div style="color:var(--accent)">' + pix(CART, 72) + '</div>' +
        '<div class="coin blink">INSERT COIN</div><h2>Картридж пуст<span class="blink">_</span></h2><p>Здесь будет твоя коллекция: во что играешь, что ждёт в очереди, что уже пройдено. Добавь первую игру или загрузи несколько примеров, чтобы посмотреть, как всё выглядит.</p>' +
        '<div class="row"><button class="btn primary" type="button" data-act="new">+ Новая игра</button><button class="btn" type="button" data-act="demo">Загрузить примеры</button></div></div>';
      return;
    }
    var list = visible();
    if (!list.length) {
      el.innerHTML = '<div class="panel empty" style="grid-column:1/-1"><h2>Ничего не найдено</h2><p>В этом разделе нет игр по такому запросу. Смени вкладку или очисти поиск.</p></div>';
      return;
    }
    el.className = view.mode === 'shelf' ? 'shelf' : 'grid';
    var shelfMode = view.mode === 'shelf';
    var pf = profile();
    var cab = '<div class="sign"><b>GameLOG</b><span>ИГР ' + pf.n + ' · ПРОЙДЕНО ' + pf.beaten + '</span><div class="marq" aria-hidden="true"><span>★ GAMELOG ★ ВСТАВЬ МОНЕТУ ★ PRESS START ★ ВЫБЕРИ ИГРУ ★ GAMELOG ★ ВСТАВЬ МОНЕТУ ★ PRESS START ★ ВЫБЕРИ ИГРУ </span></div></div>' +
      '<div class="scr"><div class="scr-in" id="scr"></div></div>' +
      '<div class="deck"><div class="stick"><i></i></div><div class="btns"><b class="r"></b><b class="y"></b></div>' +
      '<button class="coinb" id="coin" type="button" aria-label="Вставить монету"><i></i><span>МОНЕТА</span></button>' +
      '<div class="btns"><b class="g"></b><b class="b"></b></div><div class="stick"><i></i></div></div>';
    el.innerHTML = shelfMode ? cab + '<div class="bay">' + list.map(function (g, i) { return spine(g, i); }).join('') + '</div><div class="kick" aria-hidden="true"><span>★ ARCADE ★ GAMELOG ★ ARCADE ★</span></div>' : list.map(card).join('');
    if (shelfMode) scrAttract();
    if (shelfMode && shelfBoot && fxOn()) {
      shelfBoot = false; el.classList.add('boot');
      setTimeout(function () { el.classList.remove('boot'); }, 700 + list.length * 70);
    } else if (!shelfMode) shelfBoot = false;
    if (animIn) { animAt[animIn] = Date.now(); animIn = null; }
    for (var k in animAt) {
      var el2 = Date.now() - animAt[k];
      if (el2 > 700) { delete animAt[k]; continue; }
      var ne = cardEl(k);
      if (ne && fxOn()) { ne.classList.add('ins'); (ne.classList.contains('spine') ? ne.querySelector('.cart') : ne).style.animationDelay = (-el2) + 'ms'; if (ne.classList.contains('spine') && el2 < 60) setTimeout(function () { sfx('click'); }, 420); }
    }
  }
  function render() { renderHud(); renderTabs(); renderGrid(); drawAvatar(); drawStreak(); checkAch(); }

  /* ---------- окно игры ---------- */
  function drawSeg() {
    $('#f-status').innerHTML = ORDER.map(function (k) {
      return '<button class="opt" type="button" data-st="' + k + '" style="--c:' + STATUS[k].color + '" aria-pressed="' + (draft.status === k) + '"><i></i>' + STATUS[k].label + '</button>';
    }).join('');
  }
  function drawRate() {
    var h = '';
    for (var i = 1; i <= 5; i++) h += '<button class="rs' + (i <= draft.rating ? ' on' : '') + '" type="button" data-r="' + i + '" aria-label="Оценка ' + i + '">' + pix(STAR, 26) + '</button>';
    h += '<small>' + (draft.rating ? draft.rating + ' из 5' : 'без оценки') + '</small>';
    $('#f-rate').innerHTML = h;
  }
  function drawCover() {
    $('#f-cerr').hidden = true;
    $('#f-prev').innerHTML = draft.cover ? '<img src="' + esc(draft.cover) + '" alt="Предпросмотр обложки">' : '<span class="hint">Нет<br>обложки</span>';
    $('#f-cdel').hidden = !draft.cover;
    $('#f-pick').textContent = draft.cover ? 'Заменить' : 'Выбрать файл';
  }
  function readCover(file) {
    return new Promise(function (res, rej) {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('type'));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var W = 300, H = 400, c = document.createElement('canvas');
        c.width = W; c.height = H;
        var x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
        var s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
        var w = img.naturalWidth * s, h = img.naturalHeight * s;
        x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('load')); };
      img.src = url;
    });
  }
  function setCover(file) {
    readCover(file).then(function (b) {
      if (!draft) return;
      if (draft.coverBlobUrl) URL.revokeObjectURL(draft.coverBlobUrl);
      draft.coverBlob = b; draft.coverBlobUrl = URL.createObjectURL(b);
      draft.cover = draft.coverBlobUrl; draft.coverRemove = false;
      drawCover();
    }).catch(function () { $('#f-cerr').hidden = false; });
  }
  function resetDelete() { armedDelete = false; var b = $('#f-del'); b.classList.remove('armed'); b.textContent = 'Удалить'; }
  function openModal(id) {
    opener = document.activeElement;
    var g = id ? games.find(function (x) { return x.id === id; }) : null;
    draft = g ? Object.assign({}, g) : { id: uuid(), title: '', platform: '', genre: '', status: 'queue', progress: 0, hours: 0, rating: 0, notes: '', cover: '', cover_path: null };
    $('#m-title').textContent = g ? 'Изменить игру' : 'Новая игра';
    $('#f-title').value = draft.title;
    $('#f-platform').value = draft.platform || '';
    $('#f-genre').value = draft.genre || '';
    $('#f-hours').value = draft.hours || 0;
    $('#f-progress').value = draft.progress || 0;
    $('#f-pv').textContent = (draft.progress || 0) + '%';
    $('#f-notes').value = draft.notes || '';
    fillCoop();
    $('#f-err').hidden = true;
    $('#f-del').hidden = !g;
    $('#f-save').disabled = false;
    resetDelete(); drawSeg(); drawRate(); drawCover();
    $('#ov').hidden = false;
    setTimeout(function () { $('#f-title').focus(); }, 0);
  }
  function closeModal() {
    $('#ov').hidden = true;
    if (draft && draft.coverBlobUrl && draft.cover !== draft.coverBlobUrl) URL.revokeObjectURL(draft.coverBlobUrl);
    draft = null;
    if (opener && opener.focus && document.contains(opener)) opener.focus();
  }

  /* ---------- вход и аккаунт ---------- */
  var MODES = {
    'in': { title: 'Вход', submit: 'Войти', toggle: 'Нет аккаунта? Зарегистрироваться', email: true, pass: true, forgot: true, google: true, auto: 'current-password' },
    'up': { title: 'Регистрация', submit: 'Создать аккаунт', toggle: 'Уже есть аккаунт? Войти', email: true, pass: true, forgot: false, google: true, auto: 'new-password' },
    'forgot': { title: 'Сброс пароля', submit: 'Отправить ссылку', toggle: 'Вернуться ко входу', email: true, pass: false, forgot: false, google: false },
    'reset': { title: 'Новый пароль', submit: 'Сохранить пароль', toggle: '', email: false, pass: true, forgot: false, google: false, auto: 'new-password' }
  };
  function authMsg(kind, text) {
    $('#a-err').hidden = kind !== 'err'; $('#a-ok').hidden = kind !== 'ok';
    if (kind === 'err') $('#a-err').textContent = text;
    if (kind === 'ok') $('#a-ok').textContent = text;
  }
  function showAuth(mode) {
    authMode = mode;
    var m = MODES[mode];
    $('#boot').hidden = true;
    $('#a-title').textContent = m.title;
    $('#a-submit').textContent = m.submit;
    $('#a-toggle').textContent = m.toggle; $('#a-toggle').hidden = !m.toggle;
    $('#a-forgot').hidden = !m.forgot;
    $('#a-email-l').hidden = !m.email;
    $('#a-pass-l').hidden = !m.pass;
    if (m.auto) $('#a-pass').setAttribute('autocomplete', m.auto);
    var g = !!cfg.GOOGLE_LOGIN && m.google;
    $('#a-google').hidden = !g; $('#a-or').hidden = !g;
    $('#a-sub').hidden = mode !== 'in' && mode !== 'up';
    authMsg('none');
    $('#a-resend').hidden = true;
    $('#auth').hidden = false;
    setTimeout(function () { var f = m.email ? $('#a-email') : $('#a-pass'); if (f) f.focus(); }, 0);
  }
  function hideAuth() { $('#auth').hidden = true; $('#a-pass').value = ''; }
  function authMessage(e) {
    var m = String((e && e.message) || '').toLowerCase(), c = String((e && e.code) || '').toLowerCase();
    if (m.indexOf('invalid login') >= 0) return 'Неверная почта или пароль.';
    if (m.indexOf('not confirmed') >= 0 || c === 'email_not_confirmed') return 'Почта не подтверждена. Открой письмо со ссылкой и попробуй снова.';
    if (m.indexOf('already registered') >= 0 || c === 'user_already_exists') return 'Такая почта уже зарегистрирована. Попробуй войти.';
    if (m.indexOf('at least') >= 0 || c === 'weak_password') return 'Пароль слишком простой. Используй не меньше 8 символов.';
    if (m.indexOf('rate limit') >= 0 || c.indexOf('rate_limit') >= 0 || (e && e.status === 429)) {
      var w = /after (\d+) seconds?/.exec(m);
      return w ? 'Слишком часто. Подожди ' + w[1] + ' с и повтори.' : 'Слишком много попыток. Подожди немного и повтори. Письма отправляются не чаще нескольких раз в час.';
    }
    if (m.indexOf('same password') >= 0 || c === 'same_password') return 'Новый пароль должен отличаться от старого.';
    if (m.indexOf('failed to fetch') >= 0 || m.indexOf('network') >= 0) return 'Нет соединения. Проверь интернет.';
    return 'Что-то пошло не так. Попробуй ещё раз.';
  }
  function busy(on) { $('#a-submit').disabled = on; $('#a-google').disabled = on; $('#a-resend').disabled = on; }
  function back() { return location.origin + location.pathname; }
  function isUnconfirmed(e) {
    return String((e && e.code) || '').toLowerCase() === 'email_not_confirmed' || String((e && e.message) || '').toLowerCase().indexOf('not confirmed') >= 0;
  }

  /* ---------- тема ---------- */
  function applyTheme(t, persist) {
    document.documentElement.setAttribute('data-theme', t);
    if (persist) { try { localStorage.setItem('gamelog.skin', t); } catch (e) {} }
    var b = $('#theme');
    if (b) {
      b.innerHTML = pix(t === 'dark' ? MOON : SUN, 20);
      var label = 'Тема: ' + (t === 'dark' ? 'тёмная' : 'светлая') + '. Переключить';
      b.setAttribute('aria-label', label); b.title = label;
    }
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#14050c' : '#ffe9b0');
  }

  async function submitAuth(e) {
    e.preventDefault();
    authMsg('none');
    var email = $('#a-email').value.trim(), pass = $('#a-pass').value;
    if (authMode !== 'reset' && !/^\S+@\S+\.\S+$/.test(email)) return authMsg('err', 'Введи почту в формате name@example.com.');
    if (authMode === 'in' && !pass) return authMsg('err', 'Введи пароль.');
    if ((authMode === 'up' || authMode === 'reset') && pass.length < 8) return authMsg('err', 'Пароль должен быть не короче 8 символов.');
    busy(true);
    try {
      if (authMode === 'in') {
        var r1 = await sb.auth.signInWithPassword({ email: email, password: pass });
        if (r1.error) throw r1.error;
      } else if (authMode === 'up') {
        var r2 = await sb.auth.signUp({ email: email, password: pass, options: { emailRedirectTo: back() } });
        if (r2.error) throw r2.error;
        if (!r2.data.session) {
          var ids = r2.data.user && r2.data.user.identities;
          if (Array.isArray(ids) && ids.length === 0) {
            authMsg('err', 'Такая почта уже зарегистрирована. Войди или сбрось пароль.');
          } else {
            authMsg('ok', 'Письмо отправлено на ' + email + '. Открой его и нажми на ссылку. Если ссылка пишет, что устарела, почта уже подтверждена (почтовые сервисы иногда открывают ссылки сами): просто войди.');
            $('#a-resend').hidden = false;
          }
          $('#a-pass').value = '';
        }
      } else if (authMode === 'forgot') {
        var r3 = await sb.auth.resetPasswordForEmail(email, { redirectTo: back() });
        if (r3.error) throw r3.error;
        authMsg('ok', 'Если такая почта есть, мы отправили на неё ссылку для сброса пароля.');
      } else if (authMode === 'reset') {
        var r4 = await sb.auth.updateUser({ password: pass });
        if (r4.error) throw r4.error;
        recovering = false; booted = false; user = null;
        var s = await sb.auth.getSession();
        handleSession(s.data.session);
        toast('Пароль обновлён');
      }
    } catch (err) {
      authMsg('err', authMessage(err));
      if (authMode === 'in' && isUnconfirmed(err)) $('#a-resend').hidden = false;
    } finally { busy(false); }
  }

  function openAccount() {
    $('#acc-mail').textContent = user ? (user.email || '') : '';
    $('#acc-nick').value = me.nick; $('#acc-nick-err').hidden = true; $('#acc-share').checked = me.share;
    $('#acc-bio').value = me.bio; $('#acc-fav').value = me.fav; $('#acc-prof-err').hidden = true; drawAvPicker();
    $('#acc-ver').textContent = 'GameLOG ' + VERSION;
    $('#acc-snd').checked = sndOn();
    $('#acc-fx').checked = document.documentElement.getAttribute('data-fx') !== 'off';
    $('#acc').hidden = false;
    var d = $('#acc-del'); d.classList.remove('armed'); d.textContent = 'Удалить аккаунт';
  }
  function exportData() {
    var payload = {
      exported_at: new Date().toISOString(),
      games: games.map(function (g) {
        return { title: g.title, platform: g.platform, genre: g.genre, status: g.status, progress: g.progress, hours: g.hours, rating: g.rating, notes: g.notes, cover_url: g.cover ? g.cover.split('?')[0] : null };
      })
    };
    var url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = 'gamelog.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  async function deleteAccount() {
    try {
      var l = await sb.storage.from(BUCKET).list(user.id, { limit: 1000 });
      if (l.data && l.data.length) await sb.storage.from(BUCKET).remove(l.data.map(function (f) { return user.id + '/' + f.name; }));
      var r = await sb.rpc('delete_my_account');
      if (r.error) throw r.error;
      await sb.auth.signOut({ scope: 'local' });
      $('#acc').hidden = true;
      toast('Аккаунт удалён');
    } catch (e) { toast('Не удалось удалить аккаунт. Попробуй ещё раз.'); }
  }

  function handleSession(session) {
    var u = session && session.user ? session.user : null;
    if (recovering) return;
    var prev = user ? user.id : null, next = u ? u.id : null;
    user = u;
    if (booted && prev === next) return;
    booted = true;
    $('#boot').hidden = true;
    if (!u) {
      games = []; loaded = false;
      dailyDone = false; streakCache = null; coopMap = {}; viewing = null; mine = null; socialLoaded = false; rel = { friends: [], incoming: [], outgoing: [] }; me = { nick: '', share: true, avatar: 0, bio: '', fav: '' };
      recs = []; board = null; rx = { cnt: {}, mine: {} };
      setViewing(); $('#fr').hidden = true; $('#aw').hidden = true; $('#rec').hidden = true; $('#cmp').hidden = true;
      $('#app').hidden = true; $('#acc').hidden = true; $('#ov').hidden = true;
      showAuth('in');
      if (linkNote) { authMsg(linkNote.kind, linkNote.text); $('#a-resend').hidden = !linkNote.resend; linkNote = null; }
      return;
    }
    hideAuth();
    $('#app').hidden = false;
    if (linkWelcome) { linkWelcome = false; toast('Почта подтверждена. Добро пожаловать!'); }
    $('#acct-t').textContent = u.email || 'Аккаунт';
    loaded = false; render();
    loadGames(); loadProfile(); loadSocial(); loadReactions();
  }

  /* ---------- примеры ---------- */
  function addExamples() {
    var now = Date.now();
    var ex = [
      ['Hades', 'PC', 'Рогалик', 'beaten', 100, 64, 5, 'Финал с десятой попытки.'],
      ['Hollow Knight', 'Switch', 'Метроидвания', 'playing', 60, 28, 5, 'Застрял в Городе слёз, надо найти карту.'],
      ['Stardew Valley', 'PC', 'Симулятор фермы', 'playing', 40, 47, 4, 'Второй год, строю курятник.'],
      ['Celeste', 'Switch', 'Платформер', 'beaten', 100, 11, 5, ''],
      ['Disco Elysium', 'PC', 'RPG', 'queue', 0, 0, 0, 'Начать на выходных.'],
      ['Hyper Light Drifter', 'PC', 'Экшен', 'dropped', 30, 6, 3, 'Слишком сложно, вернусь позже.'],
      ['Tunic', 'PS5', 'Приключение', 'wish', 0, 0, 0, '']
    ];
    var local = ex.map(function (r, i) {
      return { id: uuid(), title: r[0], platform: r[1], genre: r[2], status: r[3], progress: r[4], hours: r[5], rating: r[6], notes: r[7], cover: '', cover_path: null, added: now - i * 1000, updated: now - i * 1000 };
    });
    games = games.concat(local); render();
    sb.from('games').insert(local.map(function (g) { return toRow(g, null); })).then(function (r) {
      if (r.error) { toast(errText(r.error)); loadGames(); } else { toast('Добавлено 7 примеров'); loadGames(); }
    });
  }

  /* ---------- события ---------- */
  function bind() {
    $('#tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]'); if (!b) return;
      view.tab = b.getAttribute('data-tab'); renderTabs(); renderGrid();
    });
    $('#q').addEventListener('input', function (e) { view.q = e.target.value; renderGrid(); });
    $('#sort').addEventListener('change', function (e) { view.sort = e.target.value; renderGrid(); });
    $('#add').addEventListener('click', function () { openModal(null); });
    $('#acct').addEventListener('click', openAccount);
    $('#a-resend').addEventListener('click', async function () {
      var email = $('#a-email').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('err', 'Введи почту, на которую отправить письмо.');
      busy(true);
      try {
        var r = await sb.auth.resend({ type: 'signup', email: email, options: { emailRedirectTo: back() } });
        if (r.error) throw r.error;
        authMsg('ok', 'Письмо отправлено ещё раз на ' + email + '. Следующее можно запросить через минуту.');
      } catch (err) { authMsg('err', authMessage(err)); }
      finally { busy(false); }
    });
    $('#grid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
      if (act === 'edit') openModal(id);
      if (act === 'new') openModal(null);
      if (act === 'demo') addExamples();
      if (act === 'rx') toggleRx(id, b.getAttribute('data-k'));
      if (act === 'rec') openRec(id);
      if (act === 'wishadd') wishAdd(id);
      if (act === 'plus') {
        var g = games.find(function (x) { return x.id === id; });
        if (g) { var n = Object.assign({}, g); n.hours = Math.round(((Number(g.hours) || 0) + 1) * 10) / 10; saveGame(n, null, false); }
      }
    });

    $('#m-close').addEventListener('click', closeModal);
    $('#f-cancel').addEventListener('click', closeModal);
    $('#ov').addEventListener('mousedown', function (e) { if (e.target === $('#ov')) closeModal(); });
    $('#acc').addEventListener('mousedown', function (e) { if (e.target === $('#acc')) $('#acc').hidden = true; });
    $('#acc-close').addEventListener('click', function () { $('#acc').hidden = true; });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#ov').hidden) closeModal(); else if (!$('#acc').hidden) $('#acc').hidden = true;
      else if (!$('#rec').hidden) $('#rec').hidden = true; else if (!$('#cmp').hidden) $('#cmp').hidden = true;
      else if (!$('#fr').hidden) $('#fr').hidden = true; else if (!$('#aw').hidden) $('#aw').hidden = true;
      else if (!$('#cl').hidden) $('#cl').hidden = true; else if (!$('#yr').hidden) $('#yr').hidden = true;
    });
    $('#f-status').addEventListener('click', function (e) {
      var b = e.target.closest('[data-st]'); if (!b) return;
      draft.status = b.getAttribute('data-st');
      if (draft.status === 'beaten') { draft.progress = 100; $('#f-progress').value = 100; $('#f-pv').textContent = '100%'; }
      drawSeg();
    });
    $('#f-rate').addEventListener('click', function (e) {
      var b = e.target.closest('[data-r]'); if (!b) return;
      var v = Number(b.getAttribute('data-r'));
      draft.rating = draft.rating === v ? 0 : v; drawRate();
    });
    $('#f-pick').addEventListener('click', function () { $('#f-file').click(); });
    $('#f-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) setCover(f);
      e.target.value = '';
    });
    $('#f-cdel').addEventListener('click', function () {
      if (draft.coverBlobUrl) URL.revokeObjectURL(draft.coverBlobUrl);
      draft.coverRemove = !!draft.cover_path; draft.coverBlob = null; draft.coverBlobUrl = null; draft.cover = '';
      drawCover();
    });
    var pv = $('#f-prev');
    ['dragenter', 'dragover'].forEach(function (t) { pv.addEventListener(t, function (e) { e.preventDefault(); pv.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (t) { pv.addEventListener(t, function (e) { e.preventDefault(); pv.classList.remove('drag'); }); });
    pv.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setCover(f);
    });
    document.addEventListener('paste', function (e) {
      if ($('#ov').hidden || !draft) return;
      var f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
      if (f && /^image\//.test(f.type)) { e.preventDefault(); setCover(f); }
    });
    $('#f-progress').addEventListener('input', function (e) { $('#f-pv').textContent = e.target.value + '%'; });
    $('#f-del').addEventListener('click', function () {
      var b = $('#f-del');
      if (!armedDelete) { armedDelete = true; b.classList.add('armed'); b.textContent = 'Точно удалить?'; return; }
      var id = draft.id; closeModal(); removeGame(id); toast('Игра удалена');
    });
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = $('#f-title').value.trim();
      if (!title) { $('#f-err').hidden = false; $('#f-title').focus(); return; }
      var hrs = parseFloat($('#f-hours').value);
      draft.title = title;
      draft.platform = $('#f-platform').value.trim();
      draft.genre = $('#f-genre').value.trim();
      draft.hours = isFinite(hrs) && hrs > 0 ? Math.min(hrs, 99999) : 0;
      draft.progress = Number($('#f-progress').value) || 0;
      draft.notes = $('#f-notes').value.trim();
      draft.coop = $('#f-coop').value || null;
      var blob = draft.coverBlob || null, rem = !!draft.coverRemove;
      var g = draft;
      delete g.coverBlob; delete g.coverBlobUrl; delete g.coverRemove;
      draft = null; $('#ov').hidden = true;
      saveGame(g, blob, rem); toast('Сохранено');
    });

    /* вход */
    $('#a-form').addEventListener('submit', submitAuth);
    $('#a-toggle').addEventListener('click', function () { showAuth(authMode === 'in' ? 'up' : 'in'); });
    $('#a-forgot').addEventListener('click', function () { showAuth('forgot'); });
    $('#a-google').addEventListener('click', async function () {
      authMsg('none'); busy(true);
      var r = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back() } });
      if (r.error) { authMsg('err', 'Вход через Google сейчас недоступен.'); busy(false); }
    });

    /* аккаунт */
    $('#acc-export').addEventListener('click', exportData);
    $('#acc-out').addEventListener('click', async function () { $('#acc').hidden = true; await sb.auth.signOut(); });
    $('#acc-del').addEventListener('click', function () {
      var b = $('#acc-del');
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Точно удалить всё?'; return; }
      b.disabled = true; deleteAccount().then(function () { b.disabled = false; });
    });
  }


  /* ---------- Beta v3.0: звуки, серия, полка, итоги года, 2P, что нового ---------- */
  var LEAF = ['XXXXXX.', 'X....XX', 'X.XXX.X', 'X.....X', 'X.XXX.X', 'X.....X', 'X.XX..X', 'XXXXXXX'];
  var coopMap = {};
  var RELEASES = [
    ['Beta v3.2', ['Полка стала полноценным автоматом: вывеска, CRT-экран с данными игры, пульт с джойстиками и кнопкой «Монета», отсек картриджей, цоколь', 'Экран показывает игру под курсором, в покое «ВСТАВЬ МОНЕТУ» и лидера по часам', 'Надписи автомата не выделяются']],
    ['Beta v3.1', ['Полка: корпус автомата с бегущей строкой и неоновыми боками', 'Глянец на картриджах, подсветка слотов цветом статуса', 'Вставка картриджа с отскоком и «кликом», выброс на пружине', 'Включение автомата: слоты загораются волной', 'Управление стрелками и курсор ▼, табло с данными при наведении']],
    ['Beta v3.0', ['Звуки 8-бит (включаются в аккаунте)', 'Ежедневный бонус и серия дней подряд', 'Режим «Полка»: отсек автомата, картриджи в слотах', 'Итоги года: картинка со статистикой, можно скачать', 'Совместные игры 2P: отметь друга и сравнивай прогресс', 'Листочек «Что нового» у версии']],
    ['Beta v2.9', ['Лимит часов на игру до 99999', 'Большие числа сокращаются: 10.3к, 1.2м']],
    ['Beta v2.8', ['Окошки статистики подстраиваются под длинные числа']],
    ['Beta v2.7', ['Карточки-картриджи', 'Анимации вставки и извлечения игры']],
    ['Beta v2.6', ['Починено редактирование профиля', 'Новая иконка друзей', 'Карточки одинакового размера']],
    ['Beta v2.5', ['Единый дизайн «Аркада», без переключателя тем']],
    ['Beta v2.4', ['Аркадный стиль: неон, лампочки, барабаны, LEVEL UP']],
    ['Beta v2.2', ['Сравнение коллекций, рекомендации игр, реакции, рейтинг друзей']],
    ['Beta v2.1', ['Аватары и профиль: «О себе», «Любимая игра»']],
    ['Beta v2.0', ['Достижения', 'Уникальные ники', 'Друзья и общий просмотр коллекций']]
  ];
  function openChangelog() {
    $('#cl-body').innerHTML = RELEASES.map(function (r, i) {
      return '<section class="fsec"><h3>' + esc(r[0]) + (i === 0 ? ' · сейчас' : '') + '</h3><ul class="cl-l">' + r[1].map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></section>';
    }).join('');
    $('#cl').hidden = false;
  }

  /* звуки */
  var audioCtx = null;
  function sndOn() { try { return localStorage.getItem('gamelog.snd') === 'on'; } catch (e) { return false; } }
  var SFX = {
    coin: [[988, 0.07, 'square', 0], [1319, 0.28, 'square', 0.07]],
    eject: [[420, 0.08, 'square', 0], [280, 0.1, 'square', 0.08], [160, 0.2, 'sawtooth', 0.17]],
    win: [[523, 0.1, 'square', 0], [659, 0.1, 'square', 0.1], [784, 0.1, 'square', 0.2], [1047, 0.4, 'square', 0.3]],
    lvl: [[392, 0.1, 'square', 0], [523, 0.1, 'square', 0.1], [659, 0.1, 'square', 0.2], [784, 0.1, 'square', 0.3], [1047, 0.2, 'square', 0.4], [1319, 0.45, 'square', 0.6]],
    tick: [[880, 0.04, 'square', 0]],
    click: [[200, 0.04, 'square', 0], [100, 0.07, 'sawtooth', 0.04]],
    ach: [[784, 0.08, 'square', 0], [988, 0.08, 'square', 0.08], [1319, 0.3, 'square', 0.16]]
  };
  function sfx(name, force) {
    if (!force && !sndOn()) return;
    try {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      audioCtx = audioCtx || new C();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t = audioCtx.currentTime;
      (SFX[name] || []).forEach(function (n) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain(), at = t + n[3];
        o.type = n[2]; o.frequency.setValueAtTime(n[0], at);
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.07, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + n[1]);
        o.connect(g); g.connect(audioCtx.destination); o.start(at); o.stop(at + n[1] + 0.03);
      });
    } catch (e) {}
  }

  /* ежедневный бонус и серия */
  var streakCache = null;
  function dayStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function streakGet() {
    if (!user) return { last: '', n: 0, bonus: 0 };
    if (streakCache && streakCache.uid === user.id) return streakCache;
    var v = { last: '', n: 0, bonus: 0 };
    try { var p = JSON.parse(localStorage.getItem('gamelog.streak.' + user.id) || 'null'); if (p) v = { last: String(p.last || ''), n: Number(p.n) || 0, bonus: Number(p.bonus) || 0 }; } catch (e) {}
    v.uid = user.id; streakCache = v; return v;
  }
  function bonusXp() { return streakGet().bonus; }
  var dailyDone = false;
  function dailyCheck() {
    if (dailyDone || viewing || !user || !loaded) return;
    dailyDone = true;
    var s = streakGet(), now = new Date(), today = dayStr(now);
    if (s.last === today) return;
    var y = new Date(now.getTime() - 86400000);
    s.n = s.last === dayStr(y) ? s.n + 1 : 1;
    var gain = 10 * Math.min(s.n, 7);
    s.bonus += gain; s.last = today;
    try { localStorage.setItem('gamelog.streak.' + user.id, JSON.stringify({ last: s.last, n: s.n, bonus: s.bonus })); } catch (e) {}
    sfx('coin');
    toast('День ' + s.n + ' подряд: +' + gain + ' XP', 'ach');
    renderHud(); drawStreak();
  }
  function drawStreak() {
    var el = $('#streak'); if (!el) return;
    var s = streakGet();
    el.hidden = !!viewing || s.n < 1;
    el.innerHTML = pix(FLAME, 12) + '<b>' + s.n + '</b>';
    el.title = 'Серия: ' + s.n + ' дн. подряд. Заходи каждый день за бонусом XP';
  }

  /* полка */
  function spine(g, i) {
    var st = STATUS[g.status] || STATUS.queue, ro = !!viewing;
    var cf = g.coop ? rel.friends.filter(function (f) { return f.uid === g.coop; })[0] : null;
    var cp = cf ? coopMap[cf.uid + '|' + g.title.trim().toLowerCase()] : null;
    var pr = g.status === 'wish' ? '' : ' · ' + (g.status === 'beaten' ? 100 : (g.progress || 0)) + '%';
    var h = '<button class="spine' + (g.status === 'beaten' ? ' beaten' : '') + '" type="button" data-gid="' + esc(g.id) + '"' + (ro ? '' : ' data-act="edit" data-id="' + esc(g.id) + '"') + ' style="--c:' + st.color + ';--i:' + (i || 0) + '" aria-label="' + esc(g.title) + ', ' + st.label + '">';
    h += '<span class="cart"><span class="c-in"><i class="c-grip"></i>';
    h += '<span class="c-label"><span class="c-cover">' + (g.cover ? '<img src="' + esc(g.cover) + '" alt="">' : sprite(g.title)) + '</span></span>';
    h += '<span class="c-t">' + esc(g.title) + '</span><span class="c-m"><b>' + fmtK(g.hours) + ' Ч</b><em>' + (g.rating > 0 ? '★' + g.rating : '') + '</em></span></span>';
    h += '<i class="c-shine"></i>' + (g.coop ? '<span class="sp-2p">2P</span>' : '') + '</span>';
    h += '<span class="mouth"><i class="led"></i><span>' + esc(st.label) + '</span></span></button>';
    return h;
  }
  var credits = 0, scrId = null;
  function scrAttract() {
    var el = $('#scr'); if (!el) return;
    scrId = null;
    var top = games.slice().sort(function (a, b) { return (b.hours || 0) - (a.hours || 0); })[0];
    el.innerHTML = '<div class="scr-att"><b class="blink">ВСТАВЬ МОНЕТУ</b><span>КРЕДИТЫ: ' + String(credits).padStart(2, '0') + '</span>' +
      (top && top.hours ? '<em>ЛИДЕР ПО ЧАСАМ: ' + esc(top.title) + ' · ' + fmtK(top.hours) + ' Ч</em>' : '<em>НАВЕДИ НА КАРТРИДЖ</em>') + '</div>';
  }
  function scrShow(id) {
    var el = $('#scr'), g = games.filter(function (x) { return x.id === id; })[0];
    if (!el || !g || scrId === id) return;
    scrId = id;
    var st = STATUS[g.status] || STATUS.queue, p = g.status === 'beaten' ? 100 : (g.progress || 0);
    var cf = g.coop ? rel.friends.filter(function (f) { return f.uid === g.coop; })[0] : null;
    var cp = cf ? coopMap[cf.uid + '|' + g.title.trim().toLowerCase()] : null;
    el.innerHTML = '<div class="scr-game" style="--c:' + st.color + '"><div class="scr-art">' + (g.cover ? '<img src="' + esc(g.cover) + '" alt="">' : sprite(g.title)) + '</div>' +
      '<div class="scr-txt"><b class="scr-t">' + esc(g.title) + '</b><span class="scr-st"><i></i>' + st.label + (g.platform ? ' · ' + esc(g.platform) : '') + '</span>' +
      '<span class="scr-r"><u>ЧАСОВ</u>' + fmtK(g.hours) + '</span>' +
      (g.status !== 'wish' ? '<span class="scr-r"><u>ПРОГРЕСС</u>' + p + '%</span><div class="segbar" style="--c:' + st.color + '">' + seg(Math.round(p / 10), 10) + '</div>' : '') +
      (g.rating > 0 ? '<span class="scr-r"><u>ОЦЕНКА</u>' + '★'.repeat(g.rating) + '</span>' : '') +
      (cf ? '<span class="scr-r"><u>2P · ' + esc(cf.nick) + '</u>' + (cp != null ? cp + '%' : '—') + '</span>' : '') + '</div></div>';
  }
  function shelfOver(e) {
    if (view.mode !== 'shelf') return;
    var sp = e.target.closest && e.target.closest('.spine');
    if (sp) scrShow(sp.getAttribute('data-gid'));
    else if (e.type === 'mouseout' && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.spine'))) scrAttract();
  }
  var shelfBoot = view.mode === 'shelf';
  function shelfNav(e) {
    if (view.mode !== 'shelf') return;
    var k = e.key; if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(k) < 0) return;
    var cur = e.target.closest && e.target.closest('.spine'); if (!cur) return;
    var list = Array.prototype.slice.call(document.querySelectorAll('#grid .spine')), i = list.indexOf(cur);
    var cols = 0; list.forEach(function (x) { if (x.offsetTop === list[0].offsetTop) cols++; });
    var d = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : k === 'ArrowUp' ? -cols : cols;
    var n = list[i + d]; if (!n) return;
    e.preventDefault(); n.focus(); sfx('tick');
  }

  /* 2P */
  function fillCoop() {
    var sel = $('#f-coop'), cur = draft && draft.coop || '';
    var opts = '<option value="">Один</option>';
    var seen = false;
    rel.friends.forEach(function (f) { if (f.uid === cur) seen = true; opts += '<option value="' + esc(f.uid) + '">' + esc(f.nick) + '</option>'; });
    if (cur && !seen) opts += '<option value="' + esc(cur) + '">Бывший друг</option>';
    sel.innerHTML = opts; sel.value = cur;
    $('#f-coop-l').hidden = !rel.friends.length && !cur;
  }
  async function loadCoop() {
    if (!user || viewing) return;
    var ids = [];
    games.forEach(function (g) { if (g.coop && ids.indexOf(g.coop) < 0) ids.push(g.coop); });
    if (!ids.length) { coopMap = {}; return; }
    var r = await sb.from('games').select('title,progress,status,user_id').in('user_id', ids).limit(1000);
    if (r.error || viewing) return;
    var m = {};
    r.data.forEach(function (x) { m[x.user_id + '|' + String(x.title).trim().toLowerCase()] = x.status === 'beaten' ? 100 : (x.progress || 0); });
    coopMap = m; renderGrid();
  }

  /* итоги года */
  function wrapTop(list, key) {
    var c = {}; list.forEach(function (g) { var k = (g[key] || '').trim(); if (k) c[k] = (c[k] || 0) + 1; });
    var best = '', n = 0; Object.keys(c).forEach(function (k) { if (c[k] > n) { n = c[k]; best = k; } });
    return best || '—';
  }
  async function openYear() {
    if (!games.length) return toast('Добавь хотя бы одну игру');
    var yr = new Date().getFullYear(), p = profile();
    var beatY = games.filter(function (g) { return g.status === 'beaten' && new Date(g.updated).getFullYear() === yr; }).length;
    var addY = games.filter(function (g) { return g.added && new Date(g.added).getFullYear() === yr; }).length;
    var best = games.slice().sort(function (a, b) { return (b.rating || 0) - (a.rating || 0) || (b.hours || 0) - (a.hours || 0); })[0];
    try { await document.fonts.ready; } catch (e) {}
    var cv = $('#yr-cv'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
    var fd = getComputedStyle(document.body).getPropertyValue('--f-display').trim() || 'monospace';
    var fb = getComputedStyle(document.body).getPropertyValue('--f-body').trim() || 'monospace';
    var gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#14050c'); gr.addColorStop(1, '#3d0f22');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(0,0,0,0.18)'; for (var y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
    c.strokeStyle = '#ffd23f'; c.lineWidth = 8; c.strokeRect(40, 40, W - 80, H - 80);
    c.fillStyle = '#ffb000'; for (var x = 56; x < W - 50; x += 28) { c.beginPath(); c.arc(x, 56, 4, 0, 7); c.arc(x, H - 56, 4, 0, 7); c.fill(); }
    function px(map, x0, y0, sz, col) { c.fillStyle = col; map.forEach(function (row, j) { for (var i = 0; i < row.length; i++) if (row[i] === 'X') c.fillRect(x0 + i * sz, y0 + j * sz, sz, sz); }); }
    px(HEART, 90, 100, 10, '#ff3b5c');
    c.textBaseline = 'alphabetic'; c.fillStyle = '#ffd23f'; c.shadowColor = '#ff9d00'; c.shadowBlur = 24;
    c.font = '64px ' + fd; c.fillText('GameLOG', 200, 160);
    c.font = '110px ' + fd; c.fillText('ИТОГИ ' + yr, 90, 330);
    c.shadowBlur = 0;
    c.font = '38px ' + fb; c.fillStyle = '#ffe9b0'; c.fillText(me.nick || 'Игрок', 90, 400);
    c.fillStyle = '#9b7b6a'; c.font = '30px ' + fb; c.fillText('LVL ' + p.lvl + ' · ' + RANKS[Math.min(p.lvl - 1, RANKS.length - 1)], 90, 448);
    var cells = [['ИГР', String(p.n)], ['ЧАСОВ', fmtK(Math.round(p.hours * 10) / 10)], ['ПРОЙДЕНО В ' + yr, String(beatY)], ['СР. ОЦЕНКА', p.avg == null ? '—' : p.avg.toFixed(1)]];
    cells.forEach(function (it, i) {
      var cx = 90 + (i % 2) * 460, cy = 500 + Math.floor(i / 2) * 230;
      c.fillStyle = '#000'; c.fillRect(cx, cy, 420, 190); c.strokeStyle = '#6b4a2a'; c.lineWidth = 4; c.strokeRect(cx, cy, 420, 190);
      c.fillStyle = '#ffd23f'; c.shadowColor = '#ffb000'; c.shadowBlur = 16;
      var f = 84; c.font = f + 'px ' + fd; while (c.measureText(it[1]).width > 380 && f > 24) { f -= 4; c.font = f + 'px ' + fd; }
      c.fillText(it[1], cx + 20, cy + 100); c.shadowBlur = 0;
      c.fillStyle = '#ffe9b0'; c.font = '28px ' + fb; c.fillText(it[0], cx + 20, cy + 160);
    });
    var lines = [['Любимый жанр', wrapTop(games, 'genre')], ['Любимая платформа', wrapTop(games, 'platform')], ['Лучшая игра', best ? best.title : '—'], ['Добавлено в ' + yr, String(addY)]];
    lines.forEach(function (l, i) {
      var ly = 1010 + i * 62;
      c.fillStyle = '#9b7b6a'; c.font = '28px ' + fb; c.fillText(l[0], 90, ly);
      c.fillStyle = '#ffe9b0'; c.font = '34px ' + fb; var t = l[1]; while (c.measureText(t).width > 460 && t.length > 4) t = t.slice(0, -2); if (t !== l[1]) t += '…';
      c.textAlign = 'right'; c.fillText(t, W - 90, ly); c.textAlign = 'left';
    });
    c.fillStyle = '#ff3b5c'; c.font = '26px ' + fd; c.textAlign = 'center'; c.fillText('gamelog-orcin.vercel.app', W / 2, H - 80); c.textAlign = 'left';
    $('#yr').hidden = false;
  }
  function saveYear() {
    $('#yr-cv').toBlob(function (b) {
      if (!b) return;
      var u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = 'gamelog-' + new Date().getFullYear() + '.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
    }, 'image/png');
  }
  function setMode(m) {
    view.mode = m; shelfBoot = m === 'shelf'; try { localStorage.setItem('gamelog.view', m); } catch (e) {}
    $('#vmode').textContent = m === 'shelf' ? 'Карточки' : 'Полка';
    renderGrid();
  }

  /* ---------- Beta v2.0: ники, друзья, достижения ---------- */
  var VERSION = 'Beta v3.2';
  var NICK_RE = /^[A-Za-z0-9_А-Яа-яЁё]{3,20}$/;
  var me = { nick: '', share: true, avatar: 0, bio: '', fav: '' };
  var rel = { friends: [], incoming: [], outgoing: [] };
  var socialLoaded = false;
  var found = null;
  var viewing = null, mine = null;
  var armedFriend = null;
  var recs = [], board = null, rx = { cnt: {}, mine: {} }, recGame = null;

  var TROPHY = ['XXXXXXXXX', 'X.XXXXX.X', 'X.XXXXX.X', '.XXXXXXX.', '..XXXXX..', '...XXX...', '...XXX...', '..XXXXX..', '.XXXXXXX.'];
  var CROWN = ['X...X...X', 'XX..X..XX', 'XXX.X.XXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX'];
  var CLOCK = ['..XXXXX..', '.XX...XX.', 'X...X...X', 'X...X...X', 'X...XXX.X', 'X.......X', '.XX...XX.', '..XXXXX..'];
  var BOOK = ['XXXXXXXX.', 'X......XX', 'X.XXXX.X.', 'X......X.', 'X.XXXX.X.', 'X......X.', 'XXXXXXXX.'];
  var FLAME = ['...X...', '..XX...', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXX.XXX', 'XXX.XXX', '.XXXXX.'];
  var PAD = ['..XXXXXXX..', '.XXXXXXXXX.', 'XX.XXXXX.XX', 'X...XXX.X.X', 'XX.XXXXX.XX', '.XXXXXXXXX.'];
  var SKULL = ['.XXXXX.', 'XXXXXXX', 'X..X..X', 'XXXXXXX', '.XXXXX.', '.X.X.X.'];
  var PAD = ['..XXXXXXXXX..', '.XXXXXXXXXXX.', 'XXX.XXXXX.XXX', 'XX...XXXXXX.X', 'XXX.XXXXX.XXX', 'XXXXXXXXXXXXX', '.XXX.....XXX.'];
  var FRIENDS = ['.XX...XX.', '.XX...XX.', 'XXXX.XXXX', 'XXXX.XXXX', 'X..X.X..X'];

  var SLIME = ['........', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '........'];
  var GHOST = ['..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XX.XX.XX', 'X..XX..X'];
  var ROBOT = ['...XX...', '..XXXX..', 'XXXXXXXX', 'X.XXXX.X', 'XXXXXXXX', 'XXXXXXXX', '.XX..XX.', '.XX..XX.'];
  var CAT = ['X......X', 'XX....XX', 'XXXXXXXX', 'X.XXXX.X', 'XXXXXXXX', 'XXX..XXX', '.XXXXXX.', '........'];
  var MUSH = ['..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..XXXX..', '..XXXX..', '..XXXX..', '.XXXXXX.'];
  var ALIEN = ['..X..X..', '...XX...', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '.X.XX.X.', '.X....X.', '........'];
  var SWORD = ['.....XXX', '....XXXX', '...XXXX.', 'X.XXXX..', 'XXXXX...', '.XXX....', 'XXXX....', 'XX.XX...'];
  var AVATARS = [HEART, SLIME, GHOST, ROBOT, CAT, MUSH, ALIEN, SWORD, SKULL, PAD, CROWN, STAR];
  var AV_COL = ['var(--accent)', 'var(--play)', 'var(--done)', 'var(--queue)', 'var(--star)', 'var(--drop)'];
  function avHtml(i, size) {
    i = Number(i) || 0; if (i < 0 || i >= AVATARS.length) i = 0;
    return '<span class="avs" style="color:' + AV_COL[i % AV_COL.length] + '">' + pix(AVATARS[i], size) + '</span>';
  }
  function drawAvatar() {
    var a = $('#avatar'); if (!a) return;
    a.innerHTML = avHtml(viewing ? viewing.avatar : me.avatar, 40);
  }
  function drawAvPicker() {
    var h = '';
    for (var i = 0; i < AVATARS.length; i++) h += '<button class="av-b" type="button" data-av="' + i + '" aria-pressed="' + (me.avatar === i) + '" aria-label="Аватар ' + (i + 1) + '">' + avHtml(i, 28) + '</button>';
    $('#acc-av').innerHTML = h;
  }

  var ACH = [
    { id: 'first', name: 'Первый картридж', desc: 'Добавь первую игру', icon: CART, goal: 1, cur: function (s) { return s.n; } },
    { id: 'ten', name: 'Полка заполняется', desc: 'Собери 10 игр', icon: CART, goal: 10, cur: function (s) { return s.n; } },
    { id: 'fifty', name: 'Библиотекарь', desc: 'Собери 50 игр', icon: BOOK, goal: 50, cur: function (s) { return s.n; } },
    { id: 'beat1', name: 'Титры пошли', desc: 'Пройди первую игру', icon: TROPHY, goal: 1, cur: function (s) { return s.beaten; } },
    { id: 'beat5', name: 'Ветеран', desc: 'Пройди 5 игр', icon: TROPHY, goal: 5, cur: function (s) { return s.beaten; } },
    { id: 'beat25', name: 'Легенда', desc: 'Пройди 25 игр', icon: CROWN, goal: 25, cur: function (s) { return s.beaten; } },
    { id: 'h50', name: '50 часов', desc: 'Наиграй 50 часов', icon: CLOCK, goal: 50, cur: function (s) { return s.hours; } },
    { id: 'h200', name: 'Марафонец', desc: 'Наиграй 200 часов', icon: CLOCK, goal: 200, cur: function (s) { return s.hours; } },
    { id: 'h1000', name: 'Без выходных', desc: 'Наиграй 1000 часов', icon: FLAME, goal: 1000, cur: function (s) { return s.hours; } },
    { id: 'rated5', name: 'Критик', desc: 'Оцени 5 игр', icon: STAR, goal: 5, cur: function (s) { return s.rated; } },
    { id: 'five1', name: 'Шедевр', desc: 'Поставь оценку 5 из 5', icon: STAR, goal: 1, cur: function (s) { return s.five; } },
    { id: 'plat3', name: 'Мультиплатформа', desc: 'Игры на 3 платформах', icon: PAD, goal: 3, cur: function (s) { return s.platforms; } },
    { id: 'genre5', name: 'Знаток жанров', desc: 'Игры в 5 разных жанрах', icon: BOOK, goal: 5, cur: function (s) { return s.genres; } },
    { id: 'drop1', name: 'Не моё', desc: 'Брось игру', icon: SKULL, goal: 1, cur: function (s) { return s.dropped; } },
    { id: 'wish5', name: 'Мечтатель', desc: 'Добавь 5 игр в «Хочу»', icon: STAR, goal: 5, cur: function (s) { return s.wish; } },
    { id: 'friend1', name: 'Не один', desc: 'Найди первого друга', icon: FRIENDS, goal: 1, social: true, cur: function (s) { return s.friends; } },
    { id: 'friend5', name: 'Душа компании', desc: 'Заведи 5 друзей', icon: FRIENDS, goal: 5, social: true, cur: function (s) { return s.friends; } }
  ];

  function achCalc(list, withSocial) {
    var s = { n: list.length, beaten: 0, hours: 0, rated: 0, five: 0, dropped: 0, wish: 0, friends: rel.friends.length };
    var pl = {}, ge = {};
    list.forEach(function (g) {
      if (g.status === 'beaten') s.beaten++;
      if (g.status === 'dropped') s.dropped++;
      if (g.status === 'wish') s.wish++;
      s.hours += Number(g.hours) || 0;
      if (g.rating > 0) s.rated++;
      if (g.rating === 5) s.five++;
      if (g.platform) pl[g.platform.toLowerCase()] = 1;
      if (g.genre) ge[g.genre.toLowerCase()] = 1;
    });
    s.platforms = Object.keys(pl).length; s.genres = Object.keys(ge).length;
    return ACH.filter(function (a) { return withSocial || !a.social; }).map(function (a) {
      var c = a.cur(s); return { a: a, cur: c, done: c >= a.goal };
    });
  }
  function checkAch() {
    if (viewing || !loaded || !user || !socialLoaded) return;
    dailyCheck();
    var pr = profile(), lk = 'gamelog.lvl.' + user.id, pl = NaN;
    try { pl = parseInt(localStorage.getItem(lk), 10); } catch (e) {}
    if (!isNaN(pl) && pr.lvl > pl) showLevelUp(pr.lvl);
    try { localStorage.setItem(lk, String(pr.lvl)); } catch (e) {}
    var done = achCalc(games, true).filter(function (x) { return x.done; }).map(function (x) { return x.a.id; });
    var key = 'gamelog.ach.' + user.id, prev = null;
    try { prev = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
    if (Array.isArray(prev)) {
      var fresh = ACH.filter(function (a) { return done.indexOf(a.id) >= 0 && prev.indexOf(a.id) < 0; });
      if (fresh.length) sfx('ach'), toast('Достижение: ' + fresh.map(function (a) { return a.name; }).join(', '), 'ach');
    }
    try { localStorage.setItem(key, JSON.stringify(done)); } catch (e) {}
  }
  function openAch() {
    var own = !viewing;
    var items = achCalc(games, own);
    var n = items.filter(function (x) { return x.done; }).length;
    $('#aw-t').textContent = own ? 'Достижения' : 'Достижения: ' + viewing.nick;
    $('#aw-sub').textContent = 'Открыто ' + n + ' из ' + items.length;
    $('#aw-grid').innerHTML = items.map(function (x) {
      var cur = Math.min(Math.floor(x.cur), x.a.goal);
      return '<div class="ach' + (x.done ? '' : ' lock') + '"><span class="ai">' + pix(x.a.icon, 28) + '</span>' +
        '<span class="an">' + esc(x.a.name) + '</span><span class="ad">' + esc(x.a.desc) + '</span>' +
        '<div class="segbar" style="--c:var(--star)">' + seg(Math.round(10 * cur / x.a.goal), 10) + '</div>' +
        '<span class="ad">' + cur + ' / ' + x.a.goal + '</span></div>';
    }).join('');
    $('#aw').hidden = false;
  }

  async function loadProfile() {
    var r = await sb.from('profiles').select('nick,share_collection,avatar,bio,fav_game').eq('user_id', user.id).maybeSingle();
    if (r.error || !r.data) return;
    me.nick = r.data.nick; me.share = r.data.share_collection !== false;
    me.avatar = Number(r.data.avatar) || 0; me.bio = r.data.bio || ''; me.fav = r.data.fav_game || '';
    $('#acct-t').textContent = me.nick; drawAvatar();
  }
  async function loadSocial() {
    if (!user) return;
    var r = await sb.from('friendships').select('id,requester,addressee,status');
    if (r.error) return;
    var ids = {};
    r.data.forEach(function (f) { ids[f.requester === user.id ? f.addressee : f.requester] = 1; });
    var list = Object.keys(ids), pr = {};
    if (list.length) {
      var p = await sb.from('profiles').select('user_id,nick,share_collection,avatar,bio,fav_game').in('user_id', list);
      if (p.error) return;
      p.data.forEach(function (x) { pr[x.user_id] = x; });
    }
    var next = { friends: [], incoming: [], outgoing: [] };
    r.data.forEach(function (f) {
      var out = f.requester === user.id, uid = out ? f.addressee : f.requester, x = pr[uid] || {};
      var it = { id: f.id, uid: uid, nick: x.nick || '?', share: x.share_collection !== false, avatar: Number(x.avatar) || 0, bio: x.bio || '', fav: x.fav_game || '' };
      if (f.status === 'accepted') next.friends.push(it); else if (out) next.outgoing.push(it); else next.incoming.push(it);
    });
    next.friends.sort(function (a, b) { return a.nick.localeCompare(b.nick, 'ru'); });
    var rr = await sb.from('recommendations').select('id,from_user,title,platform,genre,msg').eq('to_user', user.id).eq('status', 'new').order('created_at', { ascending: false }).limit(20);
    recs = rr.error ? [] : rr.data.map(function (x) {
      var f = pr[x.from_user] || {};
      return { id: x.id, title: x.title, platform: x.platform, genre: x.genre, msg: x.msg, nick: f.nick || '?', avatar: Number(f.avatar) || 0 };
    });
    rel = next; socialLoaded = true;
    updateBadge(); checkAch();
    if (!$('#fr').hidden) renderFriends();
    loadCoop();
  }
  function updateBadge() {
    var b = $('#fr-badge'); if (!b) return;
    var n = rel.incoming.length + recs.length; b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n);
  }
  function relOf(uid) {
    if (rel.friends.some(function (x) { return x.uid === uid; })) return 'friend';
    if (rel.outgoing.some(function (x) { return x.uid === uid; })) return 'out';
    if (rel.incoming.some(function (x) { return x.uid === uid; })) return 'in';
    return '';
  }
  function incomingId(uid) {
    var f = rel.incoming.filter(function (x) { return x.uid === uid; })[0]; return f ? f.id : '';
  }
  function fbtn(act, attrs, label, cls) {
    return '<button class="btn s' + (cls ? ' ' + cls : '') + '" type="button" data-fa="' + act + '" ' + attrs + '>' + label + '</button>';
  }
  function frow(it, btns) {
    var sub = it.fav ? '<span class="fsub">Любимая: ' + esc(it.fav) + '</span>' : (it.bio ? '<span class="fsub">' + esc(it.bio) + '</span>' : '');
    return '<div class="frow"><span class="fwho"><span class="fav">' + avHtml(it.avatar, 24) + '</span><span class="fname"><span class="fnick">' + esc(it.nick) + '</span>' + sub + '</span></span><span class="fbtns">' + btns + '</span></div>';
  }
  function renderFriends() {
    var h = '';
    if (found) {
      h += '<section class="fsec"><h3>Результаты поиска</h3>';
      if (!found.length) h += '<p class="hint">Игрок с таким ником не найден.</p>';
      found.forEach(function (p) {
        var st = relOf(p.user_id), b;
        if (st === 'friend') b = '<span class="hint">в друзьях</span>';
        else if (st === 'out') b = '<span class="hint">заявка отправлена</span>';
        else if (st === 'in') b = fbtn('accept', 'data-id="' + esc(incomingId(p.user_id)) + '"', 'Принять', 'primary');
        else b = fbtn('add', 'data-nick="' + esc(p.nick) + '"', 'Добавить', 'primary');
        h += frow(p, b);
      });
      h += '</section>';
    }
    if (rel.incoming.length) {
      h += '<section class="fsec"><h3>Входящие заявки</h3>';
      rel.incoming.forEach(function (f) {
        h += frow(f, fbtn('accept', 'data-id="' + esc(f.id) + '"', 'Принять', 'primary') + fbtn('decline', 'data-id="' + esc(f.id) + '"', 'Отклонить'));
      });
      h += '</section>';
    }
    if (recs.length) {
      h += '<section class="fsec"><h3>Советы от друзей</h3>';
      recs.forEach(function (x) {
        h += '<div class="frow"><span class="fwho"><span class="fav">' + avHtml(x.avatar, 24) + '</span><span class="fname"><span class="fnick">' + esc(x.title) + '</span><span class="fsub">' + esc(x.nick) + (x.msg ? ': ' + esc(x.msg) : '') + '</span></span></span><span class="fbtns">' +
          fbtn('recadd', 'data-id="' + esc(x.id) + '"', 'В «Хочу»', 'primary') + fbtn('rechide', 'data-id="' + esc(x.id) + '"', 'Скрыть') + '</span></div>';
      });
      h += '</section>';
    }
    h += '<section class="fsec"><h3>Мои друзья' + (rel.friends.length ? ' · ' + rel.friends.length : '') + '</h3>';
    if (!rel.friends.length) h += '<p class="hint">Пока никого. Найди игрока по нику и отправь заявку.</p>';
    rel.friends.forEach(function (f) {
      h += frow(f,
        fbtn('view', 'data-uid="' + esc(f.uid) + '" data-nick="' + esc(f.nick) + '"', f.share ? 'Коллекция' : 'Закрыто', f.share ? '' : 'off') +
        fbtn('remove', 'data-id="' + esc(f.id) + '"', armedFriend === f.id ? 'Точно?' : 'Убрать', armedFriend === f.id ? 'danger armed' : 'danger'));
    });
    h += '</section>';
    if (rel.outgoing.length) {
      h += '<section class="fsec"><h3>Отправленные заявки</h3>';
      rel.outgoing.forEach(function (f) { h += frow(f, fbtn('cancel', 'data-id="' + esc(f.id) + '"', 'Отменить')); });
      h += '</section>';
    }
    if (board && board.length > 1) {
      h += '<section class="fsec"><h3>Лидеры среди друзей</h3>';
      board.forEach(function (x, i) {
        var sub = x.share || x.me ? 'LVL ' + x.lvl + ' · ' + fmtK(x.hours) + ' ч · пройдено ' + x.beaten : 'Коллекция закрыта';
        h += '<div class="frow' + (x.me ? ' me' : '') + (i === 0 && x.xp > 0 ? ' top' : '') + '"><span class="fwho"><span class="rk">' + (i === 0 && x.xp > 0 ? '<span class="crown">' + pix(CROWN, 18) + '</span>' : '#' + (i + 1)) + '</span><span class="fav">' + avHtml(x.avatar, 24) + '</span><span class="fname"><span class="fnick">' + esc(x.nick) + (x.me ? ' (ты)' : '') + '</span><span class="fsub">' + esc(sub) + '</span></span></span><span class="hint">' + (x.share || x.me ? x.xp + ' XP' : '—') + '</span></div>';
      });
      h += '</section>';
    }
    $('#fr-body').innerHTML = h;
  }
  function showFrErr(t) { var e = $('#fr-err'); e.textContent = t; e.hidden = false; }
  function friendErr(e) {
    var m = String((e && e.message) || '');
    if (m.indexOf('no_such_nick') >= 0) return 'Игрока с таким ником нет.';
    if (/\bself\b/.test(m)) return 'Это твой собственный ник.';
    if (m.indexOf('already_friends') >= 0) return 'Вы уже друзья.';
    if (m.indexOf('already_sent') >= 0) return 'Заявка уже отправлена.';
    if (m.indexOf('friends_limit') >= 0) return 'Достигнут лимит: 200 друзей.';
    if (m.indexOf('no_such_request') >= 0) return 'Заявка уже недоступна. Список обновлён.';
    return 'Не получилось. Проверь соединение и попробуй ещё раз.';
  }
  function openFriends() {
    found = null; armedFriend = null;
    $('#fr-q').value = ''; $('#fr-err').hidden = true;
    renderFriends();
    $('#fr').hidden = false;
    loadSocial(); loadBoard();
  }
  async function searchFriends(e) {
    e.preventDefault(); $('#fr-err').hidden = true;
    var q = $('#fr-q').value.trim();
    if (q.length < 2) return showFrErr('Введи хотя бы 2 символа ника.');
    var pat = q.replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%';
    var r = await sb.from('profiles').select('user_id,nick,avatar,bio,fav_game').ilike('nick', pat).neq('user_id', user.id).order('nick').limit(8);
    if (r.error) return showFrErr('Поиск не удался. Попробуй ещё раз.');
    found = r.data.map(function (p) { p.fav = p.fav_game || ''; return p; }); renderFriends();
  }
  async function friendAction(b) {
    var act = b.getAttribute('data-fa'), id = b.getAttribute('data-id');
    if (act === 'view') return viewFriend(b.getAttribute('data-uid'), b.getAttribute('data-nick'));
    if (act === 'remove' && armedFriend !== id) { armedFriend = id; return renderFriends(); }
    armedFriend = null; $('#fr-err').hidden = true;
    b.disabled = true;
    try {
      if (act === 'add') {
        var r = await sb.rpc('friend_request', { p_nick: b.getAttribute('data-nick') });
        if (r.error) throw r.error;
        toast(r.data === 'accepted' ? 'Вы теперь друзья' : 'Заявка отправлена');
      } else if (act === 'recadd' || act === 'rechide') {
        var rc = recs.filter(function (q) { return q.id === id; })[0];
        if (act === 'recadd' && rc) {
          if (viewing) leaveView();
          saveGame({ id: uuid(), title: rc.title, platform: rc.platform, genre: rc.genre, status: 'wish', progress: 0, hours: 0, rating: 0, notes: '', cover: '', cover_path: null }, null, false);
          toast('Добавлено в «Хочу»');
        }
        var r4 = await sb.from('recommendations').update({ status: act === 'recadd' ? 'added' : 'hidden' }).eq('id', id);
        if (r4.error) throw r4.error;
      } else if (act === 'accept' || act === 'decline') {
        var r2 = await sb.rpc('friend_respond', { p_id: id, p_accept: act === 'accept' });
        if (r2.error) throw r2.error;
        toast(act === 'accept' ? 'Заявка принята' : 'Заявка отклонена');
      } else {
        var r3 = await sb.from('friendships').delete().eq('id', id);
        if (r3.error) throw r3.error;
      }
    } catch (err) { showFrErr(friendErr(err)); }
    await loadSocial();
  }

  async function loadReactions() {
    var r = await sb.from('reactions').select('game_id,kind,user_id').limit(5000);
    if (r.error) return;
    var cnt = {}, m = {};
    r.data.forEach(function (x) {
      if (x.user_id === user.id) m[x.game_id + ':' + x.kind] = 1;
      else { var o = cnt[x.game_id] = cnt[x.game_id] || {}; o[x.kind] = (o[x.kind] || 0) + 1; }
    });
    rx = { cnt: cnt, mine: m };
    renderGrid();
  }
  async function toggleRx(id, k) {
    var key = id + ':' + k, on = !!rx.mine[key];
    if (on) delete rx.mine[key]; else rx.mine[key] = 1;
    renderGrid();
    var r = on ? await sb.from('reactions').delete().eq('game_id', id).eq('user_id', user.id).eq('kind', k)
               : await sb.from('reactions').insert({ game_id: id, user_id: user.id, kind: k });
    if (r.error) { if (on) rx.mine[key] = 1; else delete rx.mine[key]; renderGrid(); toast('Не удалось. Попробуй ещё раз.'); }
  }
  async function wishAdd(id) {
    var g = games.filter(function (x) { return x.id === id; })[0]; if (!g) return;
    var t = g.title.trim().toLowerCase();
    if ((mine || []).some(function (x) { return x.title.trim().toLowerCase() === t; })) return toast('Эта игра уже есть у тебя');
    var n = { id: uuid(), title: g.title, platform: g.platform, genre: g.genre, status: 'wish', progress: 0, hours: 0, rating: 0, notes: '', cover: '', cover_path: null };
    var r = await sb.from('games').insert(toRow(n, null));
    if (r.error) return toast(errText(r.error));
    n.updated = n.added = Date.now(); (mine = mine || []).push(n);
    toast('Добавлено в «Хочу»');
  }
  function openRec(id) {
    var g = games.filter(function (x) { return x.id === id; })[0]; if (!g) return;
    if (!rel.friends.length) return toast('Сначала добавь друзей');
    recGame = g;
    $('#rec-game').textContent = g.title;
    $('#rec-to').innerHTML = rel.friends.map(function (f) { return '<option value="' + esc(f.uid) + '">' + esc(f.nick) + '</option>'; }).join('');
    $('#rec-msg').value = ''; $('#rec-err').hidden = true; $('#rec').hidden = false;
  }
  async function sendRec(e) {
    e.preventDefault();
    var er = $('#rec-err'), b = $('#rec-send'); er.hidden = true;
    if (!recGame) return;
    b.disabled = true;
    var r = await sb.rpc('recommend_game', { p_to: $('#rec-to').value, p_title: recGame.title, p_platform: recGame.platform || '', p_genre: recGame.genre || '', p_msg: $('#rec-msg').value.trim().slice(0, 80) });
    b.disabled = false;
    if (r.error) { er.textContent = /rec_limit/.test(r.error.message || '') ? 'Сегодня уже много советов этому другу. Попробуй завтра.' : 'Не удалось отправить. Попробуй ещё раз.'; er.hidden = false; return; }
    $('#rec').hidden = true; toast('Совет отправлен');
  }
  async function loadBoard() {
    var r = await sb.rpc('friends_board');
    if (r.error || !user) return;
    board = r.data.map(function (x) {
      var hrs = Number(x.hours) || 0, xp = x.beaten * 120 + Math.round(hrs) * 3 + x.playing * 15 + (x.user_id === user.id ? bonusXp() : 0);
      return { uid: x.user_id, nick: x.nick, avatar: Number(x.avatar) || 0, share: x.share, hours: Math.round(hrs * 10) / 10, beaten: x.beaten, xp: xp, lvl: 1 + Math.floor(Math.sqrt(xp / 60)), me: x.user_id === user.id };
    }).sort(function (a, b) { return b.xp - a.xp; });
    if (!$('#fr').hidden) renderFriends();
  }
  function cmpRow(label, a, b) {
    return '<tr><td>' + label + '</td><td' + (a > b ? ' class="w"' : '') + '>' + a + '</td><td' + (b > a ? ' class="w"' : '') + '>' + b + '</td></tr>';
  }
  function cmpList(title, items) {
    if (!items.length) return '';
    return '<section class="fsec"><h3>' + title + ' · ' + items.length + '</h3><p class="cmp-l">' + items.slice(0, 15).map(esc).join(', ') + (items.length > 15 ? ' и ещё ' + (items.length - 15) : '') + '</p></section>';
  }
  function openCmp() {
    if (!viewing || !mine) return;
    var key = function (g) { return g.title.trim().toLowerCase(); };
    var a = {}, b = {};
    mine.forEach(function (g) { a[key(g)] = g; });
    games.forEach(function (g) { b[key(g)] = g; });
    var both = [], onlyF = [], onlyM = [];
    Object.keys(b).forEach(function (k) { if (a[k]) both.push(k); else onlyF.push(b[k].title); });
    Object.keys(a).forEach(function (k) { if (!b[k]) onlyM.push(a[k].title); });
    function sum(list) {
      var h = 0, d = 0; list.forEach(function (g) { h += Number(g.hours) || 0; if (g.status === 'beaten') d++; });
      return { n: list.length, h: Math.round(h * 10) / 10, d: d };
    }
    var m = sum(mine), f = sum(games);
    var html = '<table class="cmp-t"><tr><th></th><th>Ты</th><th>' + esc(viewing.nick) + '</th></tr>' + cmpRow('Игр', m.n, f.n) + cmpRow('Часов', m.h, f.h) + cmpRow('Пройдено', m.d, f.d) + '</table>';
    if (both.length) {
      html += '<section class="fsec"><h3>Общие игры · ' + both.length + '</h3>';
      both.slice(0, 15).forEach(function (k) {
        var x = a[k], y = b[k], rt = function (g) { return g.rating > 0 ? g.rating : '—'; };
        html += '<div class="frow"><span class="fnick">' + esc(y.title) + '</span><span class="hint">оценка: ты ' + rt(x) + ' · друг ' + rt(y) + '</span></div>';
      });
      html += '</section>';
    } else html += '<p class="hint">Общих игр пока нет.</p>';
    html += cmpList('Есть у друга, нет у тебя', onlyF) + cmpList('Есть у тебя, нет у друга', onlyM);
    $('#cmp-t').textContent = 'Ты и ' + viewing.nick;
    $('#cmp-body').innerHTML = html;
    $('#cmp').hidden = false;
  }

  function setViewing() {
    $('#viewing').hidden = !viewing;
    if (viewing) {
      $('#v-nick').textContent = viewing.nick;
      var vb = [viewing.bio, viewing.fav ? 'Любимая игра: ' + viewing.fav : ''].filter(Boolean).join(' · ');
      $('#v-bio').textContent = vb; $('#v-bio').hidden = !vb;
    }
    $('#add').hidden = !!viewing;
    $('#app').classList.toggle('ro', !!viewing);
    view = { tab: 'all', q: '', sort: 'updated' };
    $('#q').value = ''; $('#sort').value = 'updated';
  }
  async function viewFriend(uid, nick) {
    var f = rel.friends.filter(function (x) { return x.uid === uid; })[0];
    if (f && !f.share) { toast('Игрок закрыл свою коллекцию'); return; }
    var r = await sb.from('games').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(500);
    if (r.error) { toast('Не удалось загрузить коллекцию'); return; }
    if (!viewing) mine = games;
    viewing = { id: uid, nick: nick, avatar: f ? f.avatar : 0, bio: f ? f.bio : '', fav: f ? f.fav : '' };
    games = r.data.map(fromRow); loaded = true;
    $('#fr').hidden = true;
    setViewing(); render(); loadReactions();
    window.scrollTo(0, 0);
  }
  function leaveView() {
    if (!viewing) return;
    games = mine || []; mine = null; viewing = null;
    setViewing(); render(); loadReactions();
  }

  function bindSocial() {
    $('#ver').textContent = VERSION; $('#leaf').innerHTML = pix(LEAF, 14); $('#vmode').textContent = view.mode === 'shelf' ? 'Карточки' : 'Полка';
    $('#awards').innerHTML = pix(TROPHY, 20);
    $('#friends').innerHTML = pix(PAD, 22) + '<span class="nb" id="fr-badge" hidden></span>';
    $('#awards').addEventListener('click', openAch);
    $('#friends').addEventListener('click', openFriends);
    $('#v-back').addEventListener('click', leaveView);
    $('#v-cmp').addEventListener('click', openCmp);
    $('#cmp-close').addEventListener('click', function () { $('#cmp').hidden = true; });
    $('#rec-close').addEventListener('click', function () { $('#rec').hidden = true; });
    $('#cmp').addEventListener('mousedown', function (e) { if (e.target === $('#cmp')) $('#cmp').hidden = true; });
    $('#rec').addEventListener('mousedown', function (e) { if (e.target === $('#rec')) $('#rec').hidden = true; });
    $('#rec-form').addEventListener('submit', sendRec);
    $('#fr-close').addEventListener('click', function () { $('#fr').hidden = true; });
    $('#aw-close').addEventListener('click', function () { $('#aw').hidden = true; });
    $('#fr').addEventListener('mousedown', function (e) { if (e.target === $('#fr')) $('#fr').hidden = true; });
    $('#aw').addEventListener('mousedown', function (e) { if (e.target === $('#aw')) $('#aw').hidden = true; });
    $('#fr-form').addEventListener('submit', searchFriends);
    $('#fr-body').addEventListener('click', function (e) {
      var b = e.target.closest('[data-fa]'); if (b && !b.disabled) friendAction(b);
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && user) loadSocial();
    });
    $('#nick-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var n = $('#acc-nick').value.trim(), er = $('#acc-nick-err');
      er.hidden = true;
      if (!NICK_RE.test(n)) { er.textContent = 'Ник: 3–20 символов, только буквы, цифры и _.'; er.hidden = false; return; }
      if (n === me.nick) return;
      var b = $('#acc-nick-save'); b.disabled = true;
      var r = await sb.from('profiles').update({ nick: n }).eq('user_id', user.id).select('nick').single();
      b.disabled = false;
      if (r.error) {
        var dup = r.error.code === '23505' || /duplicate|nick_lower/i.test(r.error.message || '');
        er.textContent = dup ? 'Этот ник уже занят. Выбери другой.' : 'Не удалось сменить ник. Попробуй ещё раз.';
        er.hidden = false; return;
      }
      me.nick = r.data.nick; $('#acct-t').textContent = me.nick; toast('Ник изменён');
    });
    $('#acc-av').addEventListener('click', async function (e) {
      var b = e.target.closest('[data-av]'); if (!b) return;
      var v = Number(b.getAttribute('data-av')), old = me.avatar;
      if (v === old) return;
      me.avatar = v; drawAvPicker(); drawAvatar();
      var r = await sb.from('profiles').update({ avatar: v }).eq('user_id', user.id);
      if (r.error) { me.avatar = old; drawAvPicker(); drawAvatar(); toast('Не удалось сменить аватар'); } else toast('Аватар обновлён');
    });
    $('#prof-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var bio = $('#acc-bio').value.trim().slice(0, 80), fav = $('#acc-fav').value.trim().slice(0, 40), er = $('#acc-prof-err');
      er.hidden = true;
      var b = $('#acc-prof-save'); b.disabled = true;
      var r = await sb.from('profiles').update({ bio: bio, fav_game: fav }).eq('user_id', user.id);
      b.disabled = false;
      if (r.error) { er.textContent = 'Не удалось сохранить. Попробуй ещё раз.'; er.hidden = false; return; }
      me.bio = bio; me.fav = fav; toast('Профиль сохранён');
    });
    $('#grid').addEventListener('keydown', shelfNav);
    $('#grid').addEventListener('mouseover', shelfOver);
    $('#grid').addEventListener('mouseout', shelfOver);
    $('#grid').addEventListener('focusin', shelfOver);
    $('#grid').addEventListener('click', function (e) {
      var d = e.target.closest && e.target.closest('.deck'); if (!d) return;
      var cb = e.target.closest('#coin');
      if (cb) { credits = Math.min(99, credits + 1); sfx('coin'); cb.classList.add('hit'); setTimeout(function () { cb.classList.remove('hit'); }, 300); if (!scrId) scrAttract(); }
      else if (e.target.closest('.btns b, .stick')) sfx('tick');
    });
    $('#leaf').addEventListener('click', openChangelog);
    $('#cl-close').addEventListener('click', function () { $('#cl').hidden = true; });
    $('#cl').addEventListener('mousedown', function (e) { if (e.target === $('#cl')) $('#cl').hidden = true; });
    $('#yr-close').addEventListener('click', function () { $('#yr').hidden = true; });
    $('#yr').addEventListener('mousedown', function (e) { if (e.target === $('#yr')) $('#yr').hidden = true; });
    $('#yr-save').addEventListener('click', saveYear);
    $('#acc-year').addEventListener('click', function () { $('#acc').hidden = true; openYear(); });
    $('#vmode').addEventListener('click', function () { setMode(view.mode === 'shelf' ? 'cards' : 'shelf'); });
    $('#acc-snd').addEventListener('change', function (e) {
      try { localStorage.setItem('gamelog.snd', e.target.checked ? 'on' : 'off'); } catch (er) {}
      if (e.target.checked) sfx('coin', true);
    });
    $('#acc-fx').addEventListener('change', function (e) {
      var v = e.target.checked ? 'on' : 'off';
      document.documentElement.setAttribute('data-fx', v);
      try { localStorage.setItem('gamelog.fx', v); } catch (er) {}
    });
    $('#lvlup').addEventListener('click', function () { $('#lvlup').hidden = true; });
    $('#acc-share').addEventListener('change', async function (e) {
      var v = e.target.checked;
      var r = await sb.from('profiles').update({ share_collection: v }).eq('user_id', user.id);
      if (r.error) { e.target.checked = !v; toast('Не удалось сохранить настройку'); } else me.share = v;
    });
  }

  /* ---------- запуск ---------- */
  function fatal(text) {
    $('#boot').innerHTML = '<p>' + esc(text) + '</p>';
  }
  function start() {
    $('#logo').innerHTML = '<div style="color:var(--accent)">' + pix(HEART, 40) + '</div>';
    $('#a-logo').innerHTML = '<span style="color:var(--accent)">' + pix(HEART, 28) + '</span>';
    $('#avatar').innerHTML = '<div style="color:var(--accent)">' + pix(HEART, 40) + '</div>';
    applyTheme('dark', false);
    if (cfg.APP_ENV && cfg.APP_ENV !== 'production') {
      $('#env').hidden = false;
      document.title = '[ТЕСТ] ' + document.title;
    }
    if (!configured) { fatal('НУЖНА НАСТРОЙКА. Впиши адрес проекта и ключ Supabase в файл config.js (см. README).'); return; }
    if (!sb) { fatal('Не загрузилась библиотека Supabase. Проверь интернет и обнови страницу.'); return; }
    bind(); bindSocial();
    sb.auth.onAuthStateChange(function (event, session) {
      // вызываем позже, чтобы не блокировать внутренние запросы клиента
      setTimeout(function () {
        if (event === 'PASSWORD_RECOVERY') { recovering = true; user = session && session.user; $('#app').hidden = true; showAuth('reset'); return; }
        handleSession(session);
      }, 0);
    });
    sb.auth.getSession().then(function (r) {
      if (!booted && !recovering) handleSession(r.data.session);
      // клиент уже прочитал параметры из адреса, их можно убрать
      if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
    });
  }
  start();
})();
