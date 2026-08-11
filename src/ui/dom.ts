/**
 * Tiny DOM helpers. The UI builds nodes rather than assigning innerHTML — the
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
