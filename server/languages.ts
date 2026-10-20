import type { LanguageShare } from '../shared/types.ts'

const BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', pyi: 'Python', ipynb: 'Jupyter',
  rs: 'Rust', go: 'Go', swift: 'Swift', kt: 'Kotlin', kts: 'Kotlin', java: 'Java', scala: 'Scala',
  rb: 'Ruby', php: 'PHP', cs: 'C#', fs: 'F#', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++',
  m: 'Objective-C', mm: 'Objective-C', dart: 'Dart', ex: 'Elixir', exs: 'Elixir', erl: 'Erlang',
  hs: 'Haskell', ml: 'OCaml', clj: 'Clojure', lua: 'Lua', zig: 'Zig', nim: 'Nim', r: 'R', jl: 'Julia',
  sol: 'Solidity', circom: 'Circom', move: 'Move', cairo: 'Cairo', vy: 'Vyper',
  sql: 'SQL', prisma: 'Prisma', graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protobuf',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell', ps1: 'PowerShell',
  tf: 'Terraform', nix: 'Nix',
  md: 'Markdown', mdx: 'Markdown', rst: 'Markdown', txt: 'Metin',
  json: 'JSON', jsonc: 'JSON', json5: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML', xml: 'XML', svg: 'SVG', csv: 'CSV',
}

const BY_NAME: Record<string, string> = { Dockerfile: 'Dockerfile', Makefile: 'Makefile', Gemfile: 'Ruby', Rakefile: 'Ruby' }

/** Docs, data and config: shown in the breakdown, but they don't make a project a "Markdown project". */
const NOT_CODE = new Set(['Markdown', 'Metin', 'JSON', 'YAML', 'TOML', 'XML', 'SVG', 'CSV', 'Diğer'])

export const OTHER = 'Diğer'

export function languageOf(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1)
  if (BY_NAME[base]) return BY_NAME[base]
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return OTHER
  return BY_EXT[base.slice(dot + 1).toLowerCase()] ?? OTHER
}

/** Changed lines per language, largest first; "Diğer" goes last whatever its size. */
export function languageShares(rows: { path: string; lines: number; edits: number }[]): LanguageShare[] {
  const by = new Map<string, LanguageShare>()
  for (const r of rows) {
    const name = languageOf(r.path)
    const e = by.get(name) ?? { name, lines: 0, edits: 0, files: 0 }
    e.lines += r.lines
    e.edits += r.edits
    e.files += 1
    by.set(name, e)
  }
  return [...by.values()].sort((a, b) => (a.name === OTHER ? 1 : 0) - (b.name === OTHER ? 1 : 0) || b.lines - a.lines || b.edits - a.edits)
}

/** The language a project is mostly written in, or null when only docs and config changed. */
export function mainLanguage(shares: LanguageShare[]): string | null {
  return shares.find((s) => !NOT_CODE.has(s.name) && s.lines > 0)?.name ?? null
}
