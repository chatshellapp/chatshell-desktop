// Applies the saved theme before the first paint, so a dark-mode launch never
// flashes the light canvas. Runs as a classic blocking script from index.html
// (the CSP forbids inline scripts). Keep the storage key and resolution logic
// in step with src/lib/theme.ts, which takes over once React mounts.
;(function () {
  var preference = 'system'
  try {
    var saved = localStorage.getItem('chatshell_theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') preference = saved
  } catch (e) {
    // Storage unavailable: follow the system appearance.
  }
  var dark =
    preference === 'dark' ||
    (preference === 'system' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
})()
