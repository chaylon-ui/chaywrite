/* Exor Games, 2026-09-29: the white page loader never outlives the page.
   shop.js fades #siteloader / #spin-wrapper out in a jQuery ready handler;
   a single exception in an earlier ready handler (theme.js's
   $(window.location.hash) on a "#brand=Warhammer" paint link) left both
   covering a fully loaded page - customers saw a white screen. Once the page
   has loaded, whatever is still showing is faded away. */
(function () {
  function off() {
    ["siteloader", "spin-wrapper"].forEach(function (id) {
      var e = document.getElementById(id);
      if (!e || window.getComputedStyle(e).display === "none") return;
      e.style.transition = "opacity .3s";
      e.style.opacity = "0";
      e.style.pointerEvents = "none";
      setTimeout(function () { e.style.display = "none"; }, 320);
    });
  }
  if (document.readyState === "complete") setTimeout(off, 1200);
  else window.addEventListener("load", function () { setTimeout(off, 1200); });
})();
