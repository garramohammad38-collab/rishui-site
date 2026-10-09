// Counts a website visit (no cookies, no account details, no IP stored). Fails silently.
(function () {
  try {
    if (navigator.webdriver || /localhost|127\.0\.0\.1/.test(location.hostname)) return;
    var vid; try { vid = localStorage.getItem("mm:vid"); if (!vid) { vid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); localStorage.setItem("mm:vid", vid); } } catch (e) { vid = "x" + String(Math.random()).slice(2); }
    var path = location.pathname.replace(/^\/rishui-site/, "").replace(/index\.html$/, "") || "/";
    var ref = ""; try { var r = document.referrer && new URL(document.referrer).hostname; if (r && r !== location.hostname) ref = r.replace(/^www\./, ""); } catch (e) {}
    var ua = navigator.userAgent, device = /iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "desktop";
    var tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    var K = "sb_publishable_-PUr33K468fu-ywZehsbZQ_QBQnHeQX";
    fetch("https://bbslhbcmfjfjbvqqcebg.supabase.co/rest/v1/rpc/log_visit", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json", apikey: K },
      body: JSON.stringify({ p_vid: vid, p_path: path, p_ref: ref, p_device: device, p_lang: (navigator.language || "").slice(0, 10), p_tz: tz })
    }).catch(function () {});
  } catch (e) {}
})();
