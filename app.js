// 한 번에 플레이어 1개만 마운트하는 쇼츠형 피드. 영상 목록은 videos.json(실패 시 videos.js 샘플).
(function () {
  var FIELDS = ['경제', '과학', '역사', 'IT', '심리'];
  var feed = document.getElementById('feed');
  var dbg = document.getElementById('debug');
  var errEl = document.getElementById('errs');
  var screenEl = document.getElementById('screen');
  var MUTE = /[?&]mute=1/.test(location.search);
  var st = { sound: false, cur: -1, errors: 0, apOk: 0, apFail: 0, mounted: 0, player: null, pending: -1, apiReady: false, timer: 0, counted: false, paused: false };
  var ALL = [];          // 전체 영상 풀
  var items = [];        // 피드 항목 {type:'video'|'review'|'end', v}
  var slides = [];
  var sessionSeen = {};  // 이번에 연 뒤로 본 영상
  var reviewShown = false;
  var started = false;

  // ---------- localStorage 헬퍼 ----------
  function jget(k, d) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function hearts() { return jget('feedlab-hearts', {}); }
  function memos() { return jget('feedlab-memos', {}); }
  function saveMemo(id, t) { var m = memos(); if (t) m[id] = t; else delete m[id]; jset('feedlab-memos', m); }
  function seenMap() { return jget('feedlab-seen', {}); }          // id -> 'YYYY-MM-DD'
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function interests() { return jget('feedlab-interests', []); }
  function mixMode() { return jget('feedlab-mix', 'focus'); }      // 'focus' | 'random'
  function logEvent(type, data) {
    var l = jget('feedlab-events', []);
    l.push({ t: new Date().toISOString(), type: type, data: data });
    if (l.length > 300) l = l.slice(-300);
    jset('feedlab-events', l);
  }
  function markSeen(id) {
    var s = seenMap();
    if (!s[id]) { s[id] = today(); jset('feedlab-seen', s); }
    sessionSeen[id] = 1;
  }

  // ---------- 영상 목록 로드 ----------
  function loadVideos(cb) {
    fetch('videos.json?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status); return r.json();
    }).then(function (j) {
      if (!j || !j.length) throw new Error('empty'); cb(j, 'json');
    }).catch(function () {
      var s = document.createElement('script');
      s.src = 'videos.js?v=5';
      s.onload = function () {
        cb((window.VIDEOS || []).map(function (v) { v.field = v.field || '샘플'; return v; }), 'sample');
      };
      s.onerror = function () { cb([], 'none'); };
      document.head.appendChild(s);
    });
  }

  // ---------- 믹싱 ----------
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // pool: 아직 안 본 영상. recent: 이미 피드에 놓인 영상(앞쪽 맥락). 규칙: 같은 분야 3연속 금지, 같은 채널 최근 10개 중복 금지.
  function mix(pool, recent) {
    var left = shuffle(pool.slice()), out = [], hist = recent.slice(), mine = interests(), focus = mixMode() === 'focus';
    function okField(v) { var n = hist.length; return !(n >= 2 && hist[n - 1].field === v.field && hist[n - 2].field === v.field); }
    function okChan(v) { return hist.slice(-10).every(function (h) { return h.channel !== v.channel; }); }
    function first(list) { return list.length ? list[0] : null; }
    while (left.length) {
      var cand = left;
      if (focus && mine.length) {
        var wantMine = Math.random() < 0.7;
        var sub = left.filter(function (v) { return (mine.indexOf(v.field) >= 0) === wantMine; });
        if (sub.length) cand = sub;
      }
      var pick = first(cand.filter(function (v) { return okField(v) && okChan(v); })) ||
        first(left.filter(function (v) { return okField(v) && okChan(v); })) ||
        first(left.filter(okField)) || left[0];
      left.splice(left.indexOf(pick), 1);
      out.push(pick); hist.push(pick);
    }
    return out;
  }

  function unseenPool(exclude) {
    var s = seenMap(), ex = {};
    (exclude || []).forEach(function (v) { ex[v.id] = 1; });
    return ALL.filter(function (v) { return !s[v.id] && !ex[v.id]; });
  }

  // ---------- 칸 만들기 ----------
  function makeSlide(it) {
    var s = document.createElement('section');
    s.className = 'slide';
    if (it.type === 'review') {
      s.classList.add('card');
      var sm = seenMap(), t = today(), n = 0, m = 0, h = hearts();
      Object.keys(sm).forEach(function (id) { if (sm[id] === t) { n++; if (h[id]) m++; } });
      s.innerHTML = '<div class="big"></div><div class="sub">잠깐 쉬어가는 칸이에요. 아래로 넘기면 계속돼요.</div><button class="btn">닫기</button>';
      s.querySelector('.big').textContent = '오늘 ' + n + '개 봤고 ' + m + '개 저장했어요';
      s.querySelector('.btn').onclick = function () { go(slides.indexOf(s) + 1); };
      return s;
    }
    if (it.type === 'end') {
      s.classList.add('card');
      s.innerHTML = '<div class="big">지금 있는 영상은 다 봤어요</div><div class="sub">새 영상은 하루 두 번 채워져요. 나중에 다시 와주세요.</div>';
      return s;
    }
    var v = it.v;
    s.innerHTML =
      '<div class="player-box"></div>' +
      '<div class="info"><div class="title"></div><div class="channel"></div><div class="hint">탭해서 재생</div>' +
      '<textarea class="memo" rows="1" placeholder="한 줄 메모 (자동 저장)"></textarea>' +
      '<div class="row"><button class="btn heart" aria-label="좋아요">♡</button>' +
      '<button class="btn snd" aria-label="소리">🔇</button>' +
      '<a class="btn ghost" target="_blank" rel="noopener">YouTube에서 보기</a>' +
      '<button class="btn next">다음 ↓</button></div></div>';
    s.querySelector('.title').textContent = v.title;
    s.querySelector('.channel').textContent = (v.channel || '') + (v.field ? ' · ' + v.field : '');
    if (v.channel === '정신과의사 정우열') {
      var med = document.createElement('div');
      med.className = 'med'; med.textContent = '의료 정보는 진단·치료를 대신하지 않습니다';
      s.querySelector('.channel').after(med);
    }
    s.querySelector('a').href = 'https://www.youtube.com/watch?v=' + v.id;
    var mm = s.querySelector('.memo');
    mm.value = memos()[v.id] || '';
    mm.oninput = function () { saveMemo(v.id, mm.value.trim()); };
    s.querySelector('.snd').onclick = function () {
      st.sound = !st.sound;
      if (st.player) { try { st.sound ? st.player.unMute() : st.player.mute(); } catch (e) {} }
      syncSnd();
    };
    var hb = s.querySelector('.heart');
    if (hearts()[v.id]) { hb.classList.add('on'); hb.textContent = '♥'; }
    hb.onclick = function () {
      var hh = hearts(); hh[v.id] = !hh[v.id]; if (!hh[v.id]) delete hh[v.id]; jset('feedlab-hearts', hh);
      hb.classList.toggle('on', !!hh[v.id]); hb.textContent = hh[v.id] ? '♥' : '♡';
    };
    s.querySelector('.next').onclick = function () { go(slides.indexOf(s) + 1); };
    return s;
  }

  function addSlide(it, before) {
    var s = makeSlide(it);
    if (before == null) { items.push(it); slides.push(s); feed.appendChild(s); }
    else { items.splice(before, 0, it); slides.splice(before, 0, s); feed.insertBefore(s, slides[before + 1] || null); }
    io.observe(s);
    if (it.type === 'video') showThumb(slides.indexOf(s));
    return s;
  }

  // 현재 칸 뒤쪽을 지우고 새로 섞어서 채운다(처음 구성 / 설정 변경 시)
  function rebuild(keepUpTo) {
    for (var j = slides.length - 1; j > keepUpTo; j--) { io.unobserve(slides[j]); feed.removeChild(slides[j]); }
    slides.length = keepUpTo + 1; items.length = keepUpTo + 1;
    var kept = items.filter(function (x) { return x.type === 'video'; }).map(function (x) { return x.v; });
    var queue = mix(unseenPool(kept), kept);
    queue.forEach(function (v) { addSlide({ type: 'video', v: v }); });
    addSlide({ type: 'end' });
  }

  function syncSnd() {
    slides.forEach(function (sl) { var b = sl.querySelector('.snd'); if (b) b.textContent = st.sound ? '🔊' : '🔇'; });
  }

  function box(i) { return slides[i].querySelector('.player-box'); }
  function hint(i, t) { var h = slides[i] && slides[i].querySelector('.hint'); if (h) h.textContent = t; }
  function isVideo(i) { return items[i] && items[i].type === 'video'; }

  function showThumb(i) {
    var b = box(i); if (!b) return; b.innerHTML = '';
    var img = new Image();
    img.className = 'thumb'; img.alt = '';
    img.src = 'https://i.ytimg.com/vi/' + items[i].v.id + '/hqdefault.jpg';
    img.onclick = function () { mount(slides.indexOf(img.closest('.slide')), true); };
    b.appendChild(img);
  }

  function destroyCur() {
    if (st.player) {
      try { st.player.destroy(); } catch (e) {}
      st.player = null; st.mounted = Math.max(0, st.mounted - 1);
    }
    clearTimeout(st.timer);
    if (st.cur >= 0 && isVideo(st.cur)) { showThumb(st.cur); hint(st.cur, '탭해서 재생'); }
  }

  function mount(i, byTap) {
    if (i < 0 || i >= items.length) return;
    if (!isVideo(i)) { destroyCur(); st.cur = i; upd(); return; }   // 카드 칸에는 플레이어 없음
    if (!st.apiReady) { st.pending = i; return; }
    if (st.cur === i && st.player) { try { st.player.playVideo(); } catch (e) {} return; }
    destroyCur();
    st.cur = i; st.counted = false;
    var b = box(i); b.innerHTML = '';
    var target = document.createElement('div'); b.appendChild(target);
    hint(i, byTap ? '재생 중…' : '자동재생 시도 중…');
    var vid = items[i].v.id;
    try {
      var vars = { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 1, origin: location.origin };
      if (MUTE || !st.sound) vars.mute = 1;
      st.mounted++;
      st.player = new YT.Player(target, {
        videoId: vid, width: '100%', height: '100%', playerVars: vars,
        events: {
          onReady: function (e) {
            var t = e.target;
            [0, 700, 1600].forEach(function (d) { setTimeout(function () { if (st.cur === i && st.player === t && !st.paused) { try { var s = t.getPlayerState(); if (s !== 1 && s !== 3) t.playVideo(); } catch (x) {} } }, d); });
          },
          onStateChange: function (e) {
            if (st.cur !== i) return;
            if (e.data === 1) { settle(true, i); hint(i, '재생 중'); onWatched(vid); }
            if (e.data === 0) go(i + 1);
          },
          onError: function (e) { if (st.cur === i) onErr(i, e.data); }
        }
      });
    } catch (x) { st.mounted = Math.max(0, st.mounted - 1); onErr(i, 'ctor'); }
    clearTimeout(st.timer);
    st.timer = setTimeout(function () { if (st.cur === i) settle(false, i); }, 3800);
    upd();
  }

  // 본 영상 기록 + 10개 이상 보면 1회 돌아보기 카드 삽입
  function onWatched(id) {
    markSeen(id);
    if (!reviewShown && Object.keys(sessionSeen).length >= 10) {
      reviewShown = true;
      try { addSlide({ type: 'review' }, st.cur + 1); } catch (e) {}
    }
  }

  function settle(ok, i) {
    if (st.counted) return;
    st.counted = true; clearTimeout(st.timer);
    if (ok) st.apOk++; else { st.apFail++; hint(i, '자동재생 막힘 - 영상을 탭해서 재생'); }
    upd();
  }

  function onErr(i, code) {
    st.errors++; errEl.textContent = '오류 ' + st.errors + ' (' + code + ')';
    hint(i, '임베드 오류 ' + code + ' - 다음으로 이동');
    clearTimeout(st.timer); st.counted = true;
    upd();
    setTimeout(function () { if (st.cur === i) go(i + 1); }, 700);
  }

  function go(i) {
    if (i < 0 || i >= slides.length) return;
    slides[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function upd() {
    var n = document.querySelectorAll('#feed iframe').length;
    var f = isVideo(st.cur) ? items[st.cur].v.field : '-';
    dbg.textContent = '칸 ' + (st.cur + 1) + '/' + items.length + ' | 분야 ' + f + ' | 마운트 ' + st.mounted + ' (iframe ' + n + ')' +
      ' | 오류 ' + st.errors + ' | 자동재생 성공 ' + st.apOk + ' / 실패 ' + st.apFail + (MUTE ? ' | mute' : '');
  }

  // 50% 이상 보이는 칸만 활성화. 스냅이 끝나 잠잠해지면(180ms) 마운트.
  var want = -1, wt = 0;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting && e.intersectionRatio >= 0.5) {
        want = slides.indexOf(e.target);
        clearTimeout(wt);
        wt = setTimeout(function () { if (want >= 0 && want !== st.cur) mount(want, false); }, 180);
      }
    });
  }, { root: feed, threshold: [0.5] });

  // ---------- 첫 화면 / 설정 화면 (영상 위가 아닌 별도 화면) ----------
  function chipsHtml(sel) {
    return FIELDS.map(function (f) { return '<button class="chip' + (sel.indexOf(f) >= 0 ? ' on' : '') + '" data-f="' + f + '">' + f + '</button>'; }).join('');
  }
  function bindChips(root, sel, onChange) {
    root.querySelectorAll('.chip').forEach(function (c) {
      c.onclick = function () {
        var f = c.dataset.f, k = sel.indexOf(f);
        if (k >= 0) sel.splice(k, 1); else { if (sel.length >= 2) { var old = sel.shift(); root.querySelector('.chip[data-f="' + old + '"]').classList.remove('on'); } sel.push(f); }
        c.classList.toggle('on', sel.indexOf(f) >= 0);
        onChange();
      };
    });
  }

  function pausePlayer() { st.paused = true; if (st.player) { try { st.player.pauseVideo(); } catch (e) {} } }
  function resumePlayer() { st.paused = false; }

  function showIntro() {
    var sel = [];
    screenEl.hidden = false;
    screenEl.innerHTML = '<h1>짧은 영상으로 지식 한 입씩</h1><p>경제·과학·역사·IT·심리 쇼츠를 섞어서 보여드려요. 관심 분야를 1~2개 골라주세요. 나머지 분야도 30% 정도 섞어서 나와요.</p>' +
      '<div class="chips">' + chipsHtml(sel) + '</div><button class="btn wide" id="go" disabled>시작하기</button>';
    var go1 = screenEl.querySelector('#go');
    bindChips(screenEl, sel, function () { go1.disabled = sel.length < 1; });
    go1.onclick = function () {
      jset('feedlab-interests', sel);
      logEvent('interests_set', { interests: sel, mix: mixMode() });
      screenEl.hidden = true; startFeed();
    };
  }

  function showSettings() {
    pausePlayer();
    var sel = interests().slice(), mode = mixMode();
    screenEl.hidden = false;
    screenEl.innerHTML = '<h1>설정</h1><h2>섞기 강도</h2>' +
      '<div class="chips"><button class="chip" data-m="focus">내 관심 위주 (70/30)</button><button class="chip" data-m="random">완전 랜덤</button></div>' +
      '<h2>관심 분야 (1~2개)</h2><div class="chips" id="fc">' + chipsHtml(sel) + '</div>' +
      '<p>바꾸면 지금 보는 영상 다음부터 새로 섞여요.</p><button class="btn wide" id="close">닫기</button>';
    function syncM() { screenEl.querySelectorAll('[data-m]').forEach(function (c) { c.classList.toggle('on', c.dataset.m === mode); }); }
    syncM();
    screenEl.querySelectorAll('[data-m]').forEach(function (c) {
      c.onclick = function () {
        if (mode === c.dataset.m) return;
        mode = c.dataset.m; jset('feedlab-mix', mode); logEvent('mix_mode_change', { mode: mode }); syncM();
      };
    });
    var changed = false;
    bindChips(screenEl.querySelector('#fc'), sel, function () { changed = true; });
    screenEl.querySelector('#close').onclick = function () {
      if (sel.length >= 1 && changed) { jset('feedlab-interests', sel); logEvent('interests_set', { interests: sel, mix: mode }); }
      screenEl.hidden = true; resumePlayer();
      try { rebuild(Math.max(st.cur, 0)); } catch (e) {}
      upd();
    };
  }

  // ---------- 시작 ----------
  function startFeed() {
    if (started) return; started = true;
    loadVideos(function (list, src) {
      ALL = list;
      st.src = src;
      if (!ALL.length) { dbg.textContent = '영상 목록을 못 불러옴'; }
      rebuild(-1);
      upd();
      var sc = document.createElement('script');
      sc.src = 'https://www.youtube.com/iframe_api';
      sc.onerror = function () { dbg.textContent = 'YouTube API를 못 불러옴 (인터넷 확인)'; };
      document.head.appendChild(sc);
    });
  }

  window.onYouTubeIframeAPIReady = function () {
    st.apiReady = true;
    mount(st.pending >= 0 ? st.pending : 0, false);
  };
  document.getElementById('gear').onclick = function () { if (started) showSettings(); };
  setInterval(upd, 1000);

  if (interests().length) startFeed(); else showIntro();
})();
