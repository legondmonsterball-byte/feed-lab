// 한 번에 플레이어 1개만 마운트하는 쇼츠형 피드 실험.
(function () {
  var V = window.VIDEOS || [];
  var feed = document.getElementById('feed');
  var dbg = document.getElementById('debug');
  var errEl = document.getElementById('errs');
  var MUTE = /[?&]mute=1/.test(location.search);
  var st = { sound: false, cur: -1, errors: 0, apOk: 0, apFail: 0, mounted: 0, player: null, pending: -1, apiReady: false, timer: 0, counted: false };
  var slides = [];

  function hearts() { try { return JSON.parse(localStorage.getItem('feedlab-hearts') || '{}'); } catch (e) { return {}; } }
  function saveHearts(h) { try { localStorage.setItem('feedlab-hearts', JSON.stringify(h)); } catch (e) {} }

  function memos() { try { return JSON.parse(localStorage.getItem('feedlab-memos') || '{}'); } catch (e) { return {}; } }
  function saveMemo(id, t) {
    var m = memos(); if (t) m[id] = t; else delete m[id];
    try { localStorage.setItem('feedlab-memos', JSON.stringify(m)); } catch (e) {}
  }

  function render() {
    var h = hearts();
    V.forEach(function (v, i) {
      var s = document.createElement('section');
      s.className = 'slide'; s.dataset.i = i;
      s.innerHTML =
        '<div class="player-box"></div>' +
        '<div class="info"><div class="title"></div><div class="channel"></div><div class="hint">탭해서 재생</div>' +
        '<textarea class="memo" rows="2" placeholder="한 줄 메모 (자동 저장)"></textarea>' +
        '<div class="row"><button class="btn heart" aria-label="좋아요">♡</button>' +
        '<button class="btn snd" aria-label="소리">🔇</button>' +
        '<a class="btn ghost" target="_blank" rel="noopener">YouTube에서 보기</a>' +
        '<button class="btn next">다음 ↓</button></div></div>';
      s.querySelector('.title').textContent = v.title;
      s.querySelector('.channel').textContent = v.channel || '';
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
      if (h[v.id]) { hb.classList.add('on'); hb.textContent = '♥'; }
      hb.onclick = function () {
        var hh = hearts(); hh[v.id] = !hh[v.id]; if (!hh[v.id]) delete hh[v.id]; saveHearts(hh);
        hb.classList.toggle('on', !!hh[v.id]); hb.textContent = hh[v.id] ? '♥' : '♡';
      };
      s.querySelector('.next').onclick = function () { go(i + 1); };
      feed.appendChild(s);
      slides.push(s);
      showThumb(i);
    });
  }

  function syncSnd() {
    slides.forEach(function (sl) { sl.querySelector('.snd').textContent = st.sound ? '🔊' : '🔇'; });
  }

  function box(i) { return slides[i].querySelector('.player-box'); }
  function hint(i, t) { slides[i].querySelector('.hint').textContent = t; }

  function showThumb(i) {
    var b = box(i); b.innerHTML = '';
    var img = new Image();
    img.className = 'thumb'; img.alt = '';
    img.src = 'https://i.ytimg.com/vi/' + V[i].id + '/hqdefault.jpg';
    img.onclick = function () { mount(i, true); };
    b.appendChild(img);
  }

  function destroyCur() {
    if (st.player) {
      try { st.player.destroy(); } catch (e) {}
      st.player = null; st.mounted = Math.max(0, st.mounted - 1);
    }
    clearTimeout(st.timer);
    if (st.cur >= 0) { showThumb(st.cur); hint(st.cur, '탭해서 재생'); }
  }

  function mount(i, byTap) {
    if (!st.apiReady) { st.pending = i; return; }
    if (st.cur === i && st.player) { try { st.player.playVideo(); } catch (e) {} return; }
    destroyCur();
    st.cur = i; st.counted = false;
    var b = box(i); b.innerHTML = '';
    var target = document.createElement('div'); b.appendChild(target);
    hint(i, byTap ? '재생 중…' : '자동재생 시도 중…');
    try {
      var vars = { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 1, origin: location.origin };
      if (MUTE || !st.sound) vars.mute = 1;
      st.mounted++;
      st.player = new YT.Player(target, {
        videoId: V[i].id, width: '100%', height: '100%', playerVars: vars,
        events: {
          onReady: function (e) { try { e.target.playVideo(); } catch (x) {} },
          onStateChange: function (e) {
            if (st.cur !== i) return;
            if (e.data === 1) { settle(true, i); hint(i, '재생 중'); }
            if (e.data === 0) go(i + 1);
          },
          onError: function (e) { if (st.cur === i) onErr(i, e.data); }
        }
      });
    } catch (x) { st.mounted = Math.max(0, st.mounted - 1); onErr(i, 'ctor'); }
    clearTimeout(st.timer);
    st.timer = setTimeout(function () { if (st.cur === i) settle(false, i); }, 2500);
    upd();
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
    dbg.textContent = '칸 ' + (st.cur + 1) + '/' + V.length + ' | 마운트 ' + st.mounted + ' (iframe ' + n + ')' +
      ' | 오류 ' + st.errors + ' | 자동재생 성공 ' + st.apOk + ' / 실패 ' + st.apFail + (MUTE ? ' | mute' : '');
  }

  // 50% 이상 보이는 칸만 활성화. 스냅이 끝나 잠잠해지면(180ms) 마운트.
  var want = -1, wt = 0;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting && e.intersectionRatio >= 0.5) {
        want = +e.target.dataset.i;
        clearTimeout(wt);
        wt = setTimeout(function () { if (want !== st.cur) mount(want, false); }, 180);
      }
    });
  }, { root: feed, threshold: [0.5] });

  render();
  slides.forEach(function (s) { io.observe(s); });
  upd();

  window.onYouTubeIframeAPIReady = function () {
    st.apiReady = true;
    mount(st.pending >= 0 ? st.pending : 0, false);
  };
  var sc = document.createElement('script');
  sc.src = 'https://www.youtube.com/iframe_api';
  sc.onerror = function () { dbg.textContent = 'YouTube API를 못 불러옴 (인터넷 확인)'; };
  document.head.appendChild(sc);
  setInterval(upd, 1000);
})();
