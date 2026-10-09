// Pull down to refresh, for when the page is opened from the home screen (no browser bar = no built-in refresh).
(function () {
  var standalone = navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  if (!("ontouchstart" in window)) return;
  var LIMIT = 80, y0 = null, dy = 0, el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;top:calc(env(safe-area-inset-top) + 6px);left:50%;width:36px;height:36px;margin-left:-18px;border-radius:50%;background:#fff;color:#1554A8;box-shadow:0 2px 10px rgba(0,0,0,.2);display:grid;place-items:center;font:20px system-ui;z-index:99999;opacity:0;transform:translateY(-50px);transition:opacity .15s";
  el.textContent = "↻";
  document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(el); });
  var top = function () { return (document.scrollingElement || document.documentElement).scrollTop <= 0; };
  var busy = function () { return document.querySelector(".opt:not([disabled]), input:focus, textarea:focus, .sheet, dialog[open]"); };
  addEventListener("touchstart", function (e) { y0 = top() && !busy() && e.touches.length === 1 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  addEventListener("touchmove", function (e) {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || !top()) { el.style.opacity = 0; return; }
    var p = Math.min(dy, LIMIT * 1.5);
    el.style.opacity = Math.min(1, p / LIMIT);
    el.style.transform = "translateY(" + (p / 1.5 - 20) + "px) rotate(" + p * 3 + "deg)";
  }, { passive: true });
  addEventListener("touchend", function () {
    if (y0 != null && dy > LIMIT && top()) { el.style.transform = "translateY(40px)"; el.style.animation = "ptrspin .7s linear infinite"; setTimeout(function () { location.reload(); }, 150); }
    else { el.style.opacity = 0; el.style.transform = "translateY(-50px)"; }
    y0 = null;
  });
  var st = document.createElement("style"); st.textContent = "@keyframes ptrspin{to{transform:translateY(40px) rotate(360deg)}}"; document.head.appendChild(st);
})();
