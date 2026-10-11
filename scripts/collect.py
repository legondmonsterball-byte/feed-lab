#!/usr/bin/env python3
"""채널 RSS -> 쇼츠 판별 -> oEmbed 임베드 확인 -> videos.json 새로 생성. 표준 라이브러리만 사용, 키 불필요.
쇼츠 판별(/shorts/ID 가 200이면 쇼츠)은 비공식이라 유튜브가 바꾸면 깨질 수 있음."""
import json, sys, time, re, urllib.request, urllib.error, urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_AGE_DAYS = 180   # 최근 6개월 영상만 유지
DELAY = 0.4
UA = {"User-Agent": "Mozilla/5.0 (feed-lab collector)"}
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
opener_nr = urllib.request.build_opener(NoRedirect)

def get(url, no_redirect=False, timeout=15):
    req = urllib.request.Request(url, headers=UA)
    try:
        op = opener_nr.open if no_redirect else urllib.request.urlopen
        with op(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""

def is_short(vid):
    code, _ = get(f"https://www.youtube.com/shorts/{vid}", no_redirect=True)
    return code == 200

def embeddable(vid):
    u = urllib.parse.quote(f"https://www.youtube.com/watch?v={vid}", safe="")
    code, _ = get(f"https://www.youtube.com/oembed?url={u}&format=json")
    # 401(임베드 금지)/404(삭제·비공개)만 확정 제외. 403/429/5xx는 GitHub 서버 IP 차단 등 '확인 불가'라 통과시킴(앱이 임베드 오류 시 자동 건너뜀)
    return code not in (401, 404), code

def norm(s): return re.sub(r"[\s\-_·]", "", s).lower()

def main():
    channels = json.loads((ROOT / "channels.json").read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)
    fetched = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    out, seen, summary = [], set(), []
    for ch in channels:
        st = dict(name=ch["name"], rss=0, old=0, notshort=0, noembed=0, ok=0, title="", err="")
        summary.append(st)
        try:
            code, body = get(f"https://www.youtube.com/feeds/videos.xml?channel_id={ch['id']}")
            if code != 200: st["err"] = f"RSS {code}"; print(f"[SKIP] {ch['name']}: RSS {code}"); continue
            root = ET.fromstring(body)
            title = (root.findtext("a:title", "", NS) or "").strip()
            st["title"] = title
            # 채널 제목이 이름과 안 맞으면 수집 제외
            a, b = norm(title), norm(ch["name"])
            if not (a in b or b in a or b[:3] in a):
                st["err"] = f"채널 제목 불일치: '{title}'"; print(f"[SKIP] {ch['name']}: 제목 불일치 -> {title}"); continue
            for e in root.findall("a:entry", NS):
                vid = e.findtext("yt:videoId", "", NS)
                vt = (e.findtext("a:title", "", NS) or "").strip()
                pub = e.findtext("a:published", "", NS)
                st["rss"] += 1
                try:
                    pd = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                    if now - pd > timedelta(days=MAX_AGE_DAYS):
                        st["old"] += 1; print(f"  제외(오래됨) {vid}"); continue
                    if vid in seen: continue
                    time.sleep(DELAY)
                    if not is_short(vid):
                        st["notshort"] += 1; print(f"  제외(쇼츠아님) {vid} {vt[:20]}"); continue
                    time.sleep(DELAY)
                    ok, c = embeddable(vid)
                    if not ok:
                        st["noembed"] += 1; print(f"  제외(임베드불가 {c}) {vid} {vt[:20]}"); continue
                    if c != 200: print(f"  (oEmbed {c}: 확인 불가, 통과) {vid}")
                    seen.add(vid); st["ok"] += 1
                    out.append(dict(id=vid, title=vt, channel=ch["name"], field=ch["field"], publishedAt=pub, fetchedAt=fetched))
                except Exception as x:
                    print(f"  [ERR] {vid}: {x}")
        except Exception as x:
            st["err"] = str(x); print(f"[SKIP] {ch['name']}: {x}")
        time.sleep(DELAY)
    print("\n채널 | RSS | 오래됨 | 쇼츠아님 | 임베드불가 | 채택 | 비고")
    for s in summary:
        print(f"{s['name']} | {s['rss']} | {s['old']} | {s['notshort']} | {s['noembed']} | {s['ok']} | {s['err']}")
    by = {}
    for v in out: by[v["field"]] = by.get(v["field"], 0) + 1
    print("분야별:", by, "총", len(out))
    if not out:
        print("수집 0건 -> 기존 videos.json 유지"); sys.exit(0)
    (ROOT / "videos.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

if __name__ == "__main__":
    main()
