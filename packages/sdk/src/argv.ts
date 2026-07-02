/**
 * Split a command string into an argv array, honoring single/double quotes and backslash escapes
 * (inside double quotes). Dependency-free — for command-runner-style widgets where the user types a
 * command and you pass the result to `ctx.spawn(argv)` (which is array-only, no shell). NOT a full
 * shell parser: no pipes, redirects, globbing, or variable expansion.
 *
 *   parseArgv('echo "hello world"')  → ['echo', 'hello world']
 *   parseArgv("git commit -m 'a b'") → ['git', 'commit', '-m', 'a b']
 */
export function parseArgv(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i]
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (c === ' ' || c === '\t' || c === '\n') {
      if (has) {
        out.push(cur)
        cur = ''
        has = false
      }
    } else {
      cur += c
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}
