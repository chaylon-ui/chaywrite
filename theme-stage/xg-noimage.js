/* Our own "no image" card art (owner, 2026-09-23: "instead of loading this
   default image when there isn't an image for the card, can I load this
   instead? NOIMAGE.PNG" - uploaded to Shopify Files that day).

   The grey circle-slash "No image" picture is Shopify's own no-image GIF
   (…/no-image-2048-….gif): Liquid's image filters hand it out for a product
   with no photo, and BinderPOS's advanced-search widget and the Cloud Search
   app pass the same URL along from their product data. So rather than chase
   every template and both apps, this swaps the picture wherever it shows up:
   every <img> (and <picture> <source>) whose address is the no-image GIF (or
   one of BinderPOS's <game>_placeholder pictures, see RE) gets
   NOIMAGE.png instead - on first paint and on anything added later.

   Loaded early and NOT deferred, so the observer is watching while the page
   is still being parsed and the grey GIF mostly never gets a chance to draw.
   The file is 744x1039 (a card's shape) and 800 KB, so it is asked for at
   480px wide through Shopify's CDN resizing. */
(function () {
  if (window.__xgNoImage || !window.MutationObserver) return;
  window.__xgNoImage = 1;

  var SRC = 'https://cdn.shopify.com/s/files/1/0467/3083/8169/files/NOIMAGE.png?v=1790177287&width=480';
  // Shopify's no-image GIF, and BinderPOS's per-game "IMAGE COMING SOON"
  // stand-ins it attaches to products it has no scan for yet (owner's
  // screenshot: Llanowar Elves (7167) [Secret Lair Drop Series] ->
  // files/mtg_placeholder_<uuid>.png; also pkm_placeholder, ygo_placeholder...,
  // 500x700; served as .../mtg_placeholder_<uuid>_370x480.png on the storefront)
  var RE = /\/no-image[-_.]|\/(?:files|products)\/[a-z0-9]{2,12}_placeholder[_.]/i;

  function isNoImage(v) { return !!v && RE.test(v); }

  function fixImg(img) {
    var s = img.getAttribute('src'), ds = img.getAttribute('data-src'),
        ss = img.getAttribute('srcset'), dss = img.getAttribute('data-srcset');
    if (!isNoImage(s) && !isNoImage(ds) && !isNoImage(ss) && !isNoImage(dss)) return;
    if (ss) img.removeAttribute('srcset');
    if (dss) img.removeAttribute('data-srcset');
    if (ds) img.setAttribute('data-src', SRC);      // lazy loaders copy data-src into src later
    if (s !== SRC) img.setAttribute('src', SRC);
    img.classList.add('xg-noimage');
    var pic = img.parentNode;
    if (pic && pic.nodeName === 'PICTURE') {
      [].forEach.call(pic.querySelectorAll('source'), function (so) {
        if (isNoImage(so.getAttribute('srcset')) || isNoImage(so.getAttribute('data-srcset'))) so.remove();
      });
    }
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.nodeName === 'IMG') { fixImg(root); return; }
    var imgs = root.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) fixImg(imgs[i]);
  }

  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'attributes') { if (m.target.nodeName === 'IMG') fixImg(m.target); }
      else for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['src', 'srcset', 'data-src', 'data-srcset']
  });

  scan(document.documentElement);
})();
