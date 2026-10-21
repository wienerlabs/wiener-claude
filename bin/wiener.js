#!/usr/bin/env node
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  const locale = process.env.WIENER_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''
  console.error(locale.toLowerCase().startsWith('tr')
    ? `Wiener Tools Node.js 22.13 veya üstünü istiyor (yerleşik SQLite için). Şu anki sürüm: ${process.versions.node}`
    : `Wiener Tools needs Node.js 22.13 or later (for built-in SQLite). You have ${process.versions.node}.`)
  process.exit(1)
}
// node:sqlite prints an experimental warning on some Node versions; it is noise for this tool.
const emit = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === 'string' ? warning : warning?.message
  if (text?.includes('SQLite')) return
  return emit.call(process, warning, ...rest)
}
await import('../dist/server/main.js')
