/**
 * Tiny DOM helpers. The UI builds nodes rather than assigning innerHTML - the
 * content is ours, but card names and stat labels flow in from JSON, and
 * building nodes means no string ever gets parsed as markup.
 */

export interface ElOptions {
  class?: string
  text?: string
  title?: string
  data?: Record<string, string>
  style?: Partial<CSSStyleDeclaration>
  onClick?: (e: MouseEvent) => void
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  children: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (opts.class) node.className = opts.class
  if (opts.text !== undefined) node.textContent = opts.text
  if (opts.title) node.title = opts.title
  if (opts.data) for (const [k, v] of Object.entries(opts.data)) node.dataset[k] = v
  if (opts.style) Object.assign(node.style, opts.style)
  if (opts.onClick) node.addEventListener('click', opts.onClick as EventListener)
  for (const c of children) if (c) node.appendChild(c)
  return node
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

/** Format a stat value for display: percentages keep a sign, flats round. */
export function fmtStat(key: string, value: number): string {
  const pct = key.endsWith('Pct')
  const rounded = Math.round(value * 10) / 10
  return pct ? `${rounded > 0 ? '+' : ''}${rounded}%` : String(rounded)
}

/**
 * Green or red for a stat row's value. "before → after" compares the two
 * numbers, so "-20% → -4%" is a gain: the old test (any minus sign is a cost)
 * painted that improvement red (critic round 20). A lone value is a cost when
 * it is negative.
 */
export function deltaTone(raw: string): 'gain' | 'cost' {
  const parts = raw.split(/\s*(?:→|->)\s*/)
  if (parts.length === 2) {
    const a = parseFloat(parts[0].replace(/[^\d.+-]/g, ''))
    const b = parseFloat(parts[1].replace(/[^\d.+-]/g, ''))
    if (Number.isFinite(a) && Number.isFinite(b)) return b >= a ? 'gain' : 'cost'
  }
  return raw.trim().startsWith('-') ? 'cost' : 'gain'
}
