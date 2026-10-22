/*
 * 凝聚 LIFF 預約流程｜行銷追蹤
 * ------------------------------------------------------------------
 * 一對一介紹頁（start_landing）開啟 LIFF 時會帶上：
 *   utm_* / fbclid / gclid / lp（來源頁）/ cta（按鈕位置）/ vid（訪客 ID）/ gcid（GA4 client id）
 *
 * 這支檔案負責：
 *   1. 在 liff.init() 之後讀取這些參數，存在 localStorage（7 天），
 *      讓「LIFF → Fillout 表單 → 導回 LIFF」整段流程都不會掉。
 *   2. 裝好 GA4、Meta Pixel、LINE Tag，GA4 沿用介紹頁的 client id（同一位訪客）。
 *   3. 表單送出導回時（action=completed）回報預約轉換，同一筆只算一次。
 * 不會把姓名、電話等個資送給任何追蹤平台。
 */
(function () {
  var CFG = {
    ga4: 'G-55G78H5BPG',
    pixel: '800186701890749',
    lineTag: 'da896487-a669-425e-be02-3dc3afbd3638'
  };
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
              'fbclid', 'gclid', 'ttclid', 'lp', 'cta', 'vid', 'gcid'];
  var STORE = 'nj_attr', TTL = 7 * 864e5;
  var PII = ['name', 'phone', 'location', 'trainer', 'datetime', 'referer', 'promocamp'];
  var attr = {}, ready = false;

  function readStore() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s && Date.now() - s.t < TTL) return s.p || {};
    } catch (e) {}
    return {};
  }
  function writeStore() {
    try { localStorage.setItem(STORE, JSON.stringify({ t: Date.now(), p: attr })); } catch (e) {}
  }
  function loadScript(src) {
    var s = document.createElement('script'); s.async = true; s.src = src;
    document.head.appendChild(s);
  }

  // 在 liff.init() 之後呼叫（之前參數還包在 liff.state 裡）
  function init() {
    if (ready) return attr;
    ready = true;
    attr = readStore();
    var q = new URLSearchParams(location.search);
    var isCallback = !!q.get('action');   // Fillout 送出後導回
    var fresh = !isCallback && KEYS.some(function (k) { return q.get(k); });
    if (fresh) attr = {};   // 新的一次點擊：以這次帶來的參數為準
    KEYS.forEach(function (k) { if (q.get(k)) attr[k] = q.get(k); });
    if (attr.fbclid && !attr.fbc) attr.fbc = 'fb.1.' + Date.now() + '.' + attr.fbclid;
    writeStore();

    // GA4（UTM 由 page_location 自動判讀；client_id 沿用介紹頁）
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { dataLayer.push(arguments); };
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + CFG.ga4);
    gtag('js', new Date());
    // 只在送給 GA4 的頁面網址裡拿掉表單個資；瀏覽器網址列本身完全不動
    var clean = new URL(location.href);
    PII.forEach(function (k) { clean.searchParams.delete(k); });
    var gaCfg = { page_location: clean.toString(), page_type: 'liff-booking' };
    if (attr.gcid) gaCfg.client_id = attr.gcid;
    if (!fresh && attr.utm_source) {   // 從表單導回時網址已沒有 UTM，補上原始來源
      gaCfg.campaign_source = attr.utm_source;
      if (attr.utm_medium) gaCfg.campaign_medium = attr.utm_medium;
      if (attr.utm_campaign) gaCfg.campaign_name = attr.utm_campaign;
      if (attr.utm_content) gaCfg.campaign_content = attr.utm_content;
      if (attr.utm_term) gaCfg.campaign_term = attr.utm_term;
    }
    gtag('config', CFG.ga4, gaCfg);

    // Meta Pixel 與 LINE Tag 會自動帶上完整網址；表單導回頁的網址含姓名電話，
    // 所以這一頁暫不載入（待決定做法），其他頁面照常。
    var hasPII = PII.some(function (k) { return q.get(k); });
    if (hasPII) return attr;

    // Meta Pixel
    if (!window.fbq) {
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    }
    try { getFbp(); } catch (e) {}
    fbq('init', CFG.pixel, attr.vid ? { external_id: attr.vid } : {});
    fbq('track', 'PageView');

    // LINE Tag
    (function(g,d){g._ltq=g._ltq||[];g._lt=g._lt||function(){g._ltq.push(arguments)};var s=d.createElement('script');s.async=1;s.src='https://d.line-scdn.net/n/line_tag/public/release/v1/lt.js';var t=d.getElementsByTagName('script')[0];t.parentNode.insertBefore(s,t);})(window,document);
    _lt('init', { customerType: 'lap', tagId: CFG.lineTag });
    _lt('send', 'pv', [CFG.lineTag]);
    return attr;
  }

  function event(name, params) {
    params = params || {};
    params.lp = attr.lp; params.cta_location = attr.cta;
    try { gtag('event', name, Object.assign({ transport_type: 'beacon' }, params)); } catch (e) {}
  }

  // 要接力轉給 Fillout / QR Code 的參數（全部有值的追蹤參數）
  // Meta 瀏覽器編號（_fbp cookie）。Pixel 還沒載入完成時先自己產生同格式的值，
  // Pixel 載入後會沿用同一個 cookie，兩邊一致。
  function getFbp() {
    var m = document.cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    var v = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10);
    document.cookie = '_fbp=' + v + '; path=/; max-age=' + 90 * 86400 + '; SameSite=Lax';
    return v;
  }

  function params() {
    var p = new URLSearchParams();
    KEYS.forEach(function (k) { if (attr[k]) p.set(k, attr[k]); });
    // 給伺服器端轉換 API（Meta CAPI）比對用
    p.set('ua', navigator.userAgent);
    try { p.set('fbp', getFbp()); } catch (e) {}
    return p;
  }

  // 表單送出（action=completed）時呼叫。dedupeKey 相同的預約只回報一次（避免重新整理重複計算）。
  // done() 在追蹤送出後才執行（最多等 900ms），因為下一步會離開頁面。
  // 簡單雜湊：讓 dedupeKey（含電話）不會以明文出現在事件 ID 或儲存空間裡
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function bookingComplete(info, done) {
    info = info || {};
    var hk = hash(String(info.dedupeKey || Date.now()));
    var key = 'nj_booked_' + hk;
    var already = false;
    try { already = !!localStorage.getItem(key); localStorage.setItem(key, String(Date.now())); } catch (e) {}
    if (!already) {
      var value = info.value || 1999;
      var eventId = 'booking_' + hk;
      event('booking_complete', { store: info.store, value: value, currency: 'TWD' });
      if (window.fbq) try { fbq('track', 'Schedule', { value: value, currency: 'TWD', content_name: '一對一首次體驗' }, { eventID: eventId }); } catch (e) {}
      if (window._lt) try { _lt('send', 'cv', { type: 'Conversion' }, [CFG.lineTag]); } catch (e) {}
    }
    if (done) setTimeout(done, already ? 0 : 900);
  }

  window.NJTrack = { init: init, event: event, params: params, bookingComplete: bookingComplete,
                     attr: function () { return attr; } };
})();
