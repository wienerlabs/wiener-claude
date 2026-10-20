import fs from 'node:fs/promises'

const NEWLINE = 0x0a

function isCompleteJson(line: string): boolean {
  try {
    JSON.parse(line)
    return true
  } catch {
    return false
  }
}

/**
 * Calls `onLine` for every complete line from byte `start` on and returns the offset just past
 * the last line it consumed. A trailing line without a newline is left for the next read unless
 * it already parses, since Claude Code may still be writing it.
 */
export async function readLinesFrom(
  file: string,
  start: number,
  onLine: (line: string) => void,
  onChunk?: (bytes: number) => void,
  chunkSize = 4 << 20,
): Promise<number> {
  const fh = await fs.open(file, 'r')
  try {
    const buf = Buffer.allocUnsafe(chunkSize)
    let pos = start
    let consumed = start
    let carry: Buffer | null = null
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, chunkSize, pos)
      if (bytesRead === 0) break
      pos += bytesRead
      const data: Buffer = carry ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
      let lineStart = 0
      for (let nl = data.indexOf(NEWLINE, lineStart); nl !== -1; nl = data.indexOf(NEWLINE, lineStart)) {
        const end = nl > lineStart && data[nl - 1] === 0x0d ? nl - 1 : nl
        if (end > lineStart) onLine(data.toString('utf8', lineStart, end))
        lineStart = nl + 1
      }
      consumed += lineStart
      // `buf` is reused on the next read, so the unfinished tail must be copied out.
      carry = lineStart < data.length ? Buffer.from(data.subarray(lineStart)) : null
      onChunk?.(bytesRead)
    }
    if (carry && carry.length > 0) {
      const line = carry.toString('utf8')
      if (isCompleteJson(line)) {
        onLine(line)
        consumed += carry.length
      }
    }
    return consumed
  } finally {
    await fh.close()
  }
}
