// Shell commands as Claude runs them are long one-liners: "cd /x && FOO=1 npm run test -- --watch".
// These helpers reduce one to what it does ("npm run test") and sort failures by cause.

/** Tools whose first argument says what they do: "git push", not just "git". */
const SUBCOMMANDS = new Set([
  'git', 'gh', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'bunx', 'cargo', 'go', 'docker', 'kubectl', 'make', 'uv', 'pip', 'pip3',
  'brew', 'supabase', 'vercel', 'fly', 'flyctl', 'swift', 'xcrun', 'deno', 'poetry', 'terraform', 'gcloud', 'aws', 'anchor', 'solana', 'forge',
])
const SKIP = /^(cd|pushd|popd|export|set|source|\.|true|false|:|sleep|wait|unset)$/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Drops a leading run of VAR=value words, quoted values included. */
function stripAssignments(segment: string): string {
  let s = segment
  for (;;) {
    const m = s.match(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\$\([^)]*\)|\S*)\s*/)
    if (!m || m[0].length === 0) return s
    s = s.slice(m[0].length)
  }
}

function signatureOf(segment: string): string | null {
  let s = stripAssignments(segment.trim().replace(/^[({]\s*/, ''))
  s = s.replace(/^(sudo|time|nohup|exec|command)\s+/, '')
  if (s.startsWith('env ')) s = stripAssignments(s.slice(4).trim())
  const words = s.split(/\s+/).filter(Boolean)
  const first = words[0]
  if (!first || SKIP.test(first) || ASSIGNMENT.test(first)) return null
  const prog = first.replace(/^.*\//, '')
  if (!prog || /^[^A-Za-z0-9]/.test(prog)) return null
  const args = words.slice(1).filter((w) => !w.startsWith('-'))
  if ((prog === 'python' || prog === 'python3') && words[1] === '-m' && words[2]) return `${prog} -m ${words[2]}`
  if (prog === 'node' && args[0]) return `node ${args[0].replace(/^.*\//, '')}`
  if (!SUBCOMMANDS.has(prog) || !args[0]) return prog
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog) && args[0] === 'run' && args[1]) return `${prog} run ${args[1]}`
  return `${prog} ${args[0].replace(/^.*\//, '')}`
}

/** "cd /repo && FOO=1 npm run test -- --watch | tail" -> "npm run test". Null when nothing is left. */
export function commandSignature(command: string): string | null {
  for (const segment of command.split(/&&|\|\||;|\n|\|/)) {
    const sig = signatureOf(segment)
    if (sig) return sig
  }
  // "X=$(gh api ...)" alone: what runs is inside the substitution.
  const inner = command.match(/\$\(([^)]+)\)/)?.[1]
  return inner ? signatureOf(inner) : null
}

/** Failures that come from the machine, not the work: fixable once with a line in CLAUDE.md. */
export type SetupError = 'missing-tool' | 'shell-syntax' | 'not-git' | 'timeout'

export function classifyError(text: string): { kind: SetupError; key: string; sample: string | null } | null {
  const missing =
    text.match(/command not found: ([\w.+-]+)/) ??
    text.match(/(?:^|\n)(?:[\w./-]+: )?([\w.+-]+): command not found/) ??
    text.match(/(?:^|\n)([\w.+-]+) not found(?:\n|$)/) ??
    text.match(/'([\w.+-]+)' is not recognized/)
  if (missing?.[1]) return { kind: 'missing-tool', key: missing[1], sample: null }
  const glob = text.match(/no matches found: (\S+)/)
  if (glob) return { kind: 'shell-syntax', key: 'glob', sample: glob[1] ?? null }
  if (/bad substitution|parse error near/.test(text)) return { kind: 'shell-syntax', key: 'syntax', sample: null }
  // git prints this in the user's language; Turkish: "bir git deposu (veya üst dizinlerinden birisi) değil".
  if (/not a git repository|bir git deposu/i.test(text)) return { kind: 'not-git', key: 'git', sample: null }
  if (/Command timed out after/.test(text)) return { kind: 'timeout', key: 'timeout', sample: null }
  return null
}
