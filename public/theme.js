// Applies the per-phone theme before first paint: dark unless this phone chose
// light, or chose "system" and the phone itself is in light mode.
(function () {
  var choice = "dark";
  try { choice = localStorage.getItem("pf.theme") || "dark"; } catch (e) { /* storage blocked */ }
  var light = choice === "light" || (choice === "system" && matchMedia("(prefers-color-scheme: light)").matches);
  if (light) document.documentElement.setAttribute("data-theme", "light");
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", light ? "#f0f4f2" : "#0b0e0c");
})();
