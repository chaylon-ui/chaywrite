/* Keep the reader's place across a form post that reloads the page (owner,
   2026-11-01, Auto-pricing on a phone: "When u click publish it reloads the
   screen and I lose my place.. anywhere else that clicking causes a refresh
   would suck too"). Every staff page carries this: when a POST form is
   submitted the old way (not intercepted by the page's own script), the
   scroll position is kept in sessionStorage under the page's path for
   twenty seconds, and the page that loads next at that path scrolls back
   to it - once at parse time and again when the images are in. A form the
   page handles in place (defaultPrevented) stores nothing. */
export const KEEP_SCROLL_JS = `(function(){var K='xgScroll:'+location.pathname;document.addEventListener('submit',function(e){var f=e.target;if(e.defaultPrevented||!f||!f.getAttribute||!/^post$/i.test(f.getAttribute('method')||'get'))return;try{sessionStorage.setItem(K,JSON.stringify({y:window.scrollY||0,t:Date.now()}));}catch(x){}});
try{var v=JSON.parse(sessionStorage.getItem(K)||'null');sessionStorage.removeItem(K);if(v&&Date.now()-v.t<20000&&v.y>0){var go=function(){window.scrollTo(0,v.y);};go();window.addEventListener('load',go);}}catch(x){}})();`;
