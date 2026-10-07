(() => {
  let theme = 'system'
  let locale = 'ko'
  try {
    const cachedTheme = localStorage.getItem('mes-theme')
    const cachedLocale = localStorage.getItem('mes-locale')
    if (['system', 'light', 'dark'].includes(cachedTheme)) theme = cachedTheme
    if (['ko', 'en'].includes(cachedLocale)) locale = cachedLocale
    localStorage.setItem('mes-theme', theme)
    localStorage.setItem('mes-locale', locale)
  } catch {}
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.documentElement.lang = locale
})()
