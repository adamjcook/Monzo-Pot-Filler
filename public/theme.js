// Applies the per-phone theme before first paint (dark unless this phone chose light).
(function () {
  var light = false;
  try { light = localStorage.getItem("pf.theme") === "light"; } catch (e) { /* storage blocked */ }
  if (light) document.documentElement.setAttribute("data-theme", "light");
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", light ? "#f0f4f2" : "#0b0e0c");
})();
