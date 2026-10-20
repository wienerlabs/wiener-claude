// Saves an on-page SVG as a PNG. Everything happens in the browser; nothing leaves the machine.

/** Theme colors are CSS variables; an SVG drawn as an image can't see them, so they are written in. */
function resolveVars(svg: string): string {
  const style = getComputedStyle(document.documentElement)
  return svg.replace(/var\(--([a-z0-9-]+)\)/gi, (m, name: string) => style.getPropertyValue(`--${name}`).trim() || m)
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

/**
 * The page's own @font-face rules for these families, with the font files inlined. An SVG drawn
 * as an image can't load anything, so without this the PNG would fall back to a system font.
 * Only Latin and Latin Extended (Turkish) subsets are needed.
 */
async function inlineFonts(families: string[]): Promise<string> {
  const rules: CSSFontFaceRule[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList
    try {
      list = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(list)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim()
      if (!families.includes(family)) continue
      const src = rule.style.getPropertyValue('src')
      if (!/-latin-/.test(src)) continue
      rules.push(rule)
    }
  }
  const css = await Promise.all(
    rules.map(async (rule) => {
      const url = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)/)?.[1]
      if (!url) return ''
      try {
        const data = await toDataUrl(await (await fetch(url)).blob())
        const s = rule.style
        return `@font-face{font-family:'${s.getPropertyValue('font-family').replace(/["']/g, '')}';font-style:${s.getPropertyValue('font-style') || 'normal'};font-weight:${s.getPropertyValue('font-weight') || '400'};src:url(${data}) format('woff2');unicode-range:${s.getPropertyValue('unicode-range') || 'U+0-10FFFF'}}`
      } catch {
        return ''
      }
    }),
  )
  return css.join('')
}

export interface PngOptions {
  width: number
  height: number
  /** Pixels per SVG unit; 2 keeps text sharp on high-density screens. */
  scale?: number
  /** Font families to embed. */
  fonts?: string[]
}

export async function svgToPng(svg: SVGSVGElement, opts: PngOptions): Promise<Blob> {
  const scale = opts.scale ?? 2
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(opts.width))
  clone.setAttribute('height', String(opts.height))
  clone.removeAttribute('class')
  clone.removeAttribute('style')
  const fonts = opts.fonts?.length ? await inlineFonts(opts.fonts) : ''
  let text = resolveVars(new XMLSerializer().serializeToString(clone))
  if (fonts) text = text.replace(/^<svg([^>]*)>/, `<svg$1><defs><style>${fonts}</style></defs>`)

  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
  await img.decode()
  // Embedded fonts can still be decoding after the image is; give them a moment.
  await new Promise((r) => setTimeout(r, 250))

  const canvas = document.createElement('canvas')
  canvas.width = opts.width * scale
  canvas.height = opts.height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Tarayıcı resmi oluşturamadı')
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0, opts.width, opts.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Tarayıcı resmi oluşturamadı')
  return blob
}

export async function downloadSvgAsPng(svg: SVGSVGElement, fileName: string, opts: PngOptions): Promise<void> {
  const url = URL.createObjectURL(await svgToPng(svg, opts))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
