// 홈 화면 앱용 서비스워커: 항상 새 데이터를 먼저 받고, 인터넷이 안 되면 마지막으로 본 화면을 보여준다.
// 11/28: 주소 끝 ?t=시각 마다 따로 쌓여서 저장 공간이 끝없이 늘던 것 고침 (열 때마다 20MB 안팎) — 주소(물음표 앞)마다 하나만 두고, 예전 창고(v1)는 지움.
//   저장 공간이 차면 브라우저가 이 사이트 저장분(✏️ 그은 선·📝 체크 답)을 통째로 비울 수 있음.
const CACHE = "valuation-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin || u.pathname === "/draw-sync" || u.pathname === "/pxq") return;
  const key = u.origin + u.pathname;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key))
  );
});
