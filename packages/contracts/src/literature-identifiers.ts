/**
 * 文献标识的规范化：DOI 与 arXiv id/版本。
 *
 * 引用比较、导入去重与检索共用同一套规则：先小写、去前缀，再按各自格式判定；
 * 判不出来时返回 `null`，调用方决定是拒绝写入还是只当作文字。
 */

/** 文献形态：预印本、正式出版物或其他。 */
export const LITERATURE_FORMATS = ['preprint', 'published', 'other'] as const

export type LiteratureFormat = (typeof LITERATURE_FORMATS)[number]

/** DOI 常见写法：整段地址或 `doi:` 前缀。 */
const DOI_PREFIX = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i

/** arXiv 常见写法：abs/pdf 地址、`arXiv:` 前缀与 `.pdf` 后缀。 */
const ARXIV_PREFIX = /^(?:https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)/i

/** 新式 arXiv id：2401.12345；旧式：hep-th/9901001 或 math.GT/0309136。 */
const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[a-z]{2})?\/\d{7})$/i

/**
 * 规范化 DOI：去掉地址前缀与空白，按小写保存。
 *
 * @param value - 外来值。
 * @returns 形如 `10.1234/abc` 的 DOI；不是合法 DOI 时是 `null`。
 */
export function normalizeDoi(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(DOI_PREFIX, '').trim().toLowerCase()
  if (text === '' || /\s/.test(text)) return null
  if (!/^10\.\d{4,9}\/\S+$/.test(text)) return null
  return text
}

/**
 * 拆 arXiv id 与版本：地址、前缀与 `.pdf` 都去掉，版本单独留下。
 *
 * @param value - 外来值。
 * @returns `{ id, version }`；版本没写时是 `null`，不是合法 id 时整体为 `null`。
 */
export function arxivParts(value: unknown): { id: string; version: string | null } | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(ARXIV_PREFIX, '').replace(/\.pdf$/i, '').trim()
  if (text === '' || /\s/.test(text)) return null
  const match = /^(.+?)(?:v(\d+))?$/i.exec(text)
  if (match === null) return null
  const id = match[1].toLowerCase()
  if (!ARXIV_ID.test(id)) return null
  return { id, version: match[2] === undefined ? null : `v${String(Number(match[2]))}` }
}

/**
 * 规范化 arXiv id，主 id 不带版本。
 *
 * @param value - 外来值。
 * @returns 小写主 id；不是合法 id 时是 `null`。
 */
export function normalizeArxivId(value: unknown): string | null {
  const parts = arxivParts(value)
  return parts === null ? null : parts.id
}

/**
 * 规范化 arXiv 版本：`2`、`v2`、`V2` 都写成 `v2`。
 *
 * @param value - 外来值。
 * @returns 形如 `v2` 的版本；没写或不是版本时是 `null`。
 */
export function normalizeArxivVersion(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim().replace(/^v/i, '')
  if (text === '' || !/^\d+$/.test(text)) return null
  const number = Number(text)
  return number >= 1 ? `v${String(number)}` : null
}

/**
 * DOI 里的 arXiv id：`10.48550/arXiv.2401.12345` 与正式 arXiv DOI 同义。
 *
 * @param doi - 已规范化或未规范化的 DOI。
 * @returns arXiv 主 id；不是 arXiv DOI 时是 `null`。
 */
export function arxivIdOfDoi(doi: unknown): string | null {
  const normalized = normalizeDoi(doi)
  if (normalized === null) return null
  const match = /^10\.48550\/arxiv\.(.+)$/.exec(normalized)
  if (match === null) return null
  return normalizeArxivId(match[1])
}

/**
 * 地址里的 DOI：doi.org 链接与 `doi:` 前缀。
 *
 * @param url - 来源地址。
 * @returns 规范化 DOI；地址里没有 DOI 时是 `null`。
 */
export function doiOfUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const text = url.trim()
  if (!/doi\.org\/|^doi:/i.test(text)) return null
  return normalizeDoi(text)
}

/**
 * 地址里的 arXiv 主 id：abs/pdf 页。
 *
 * @param url - 来源地址。
 * @returns arXiv 主 id；地址不属于 arXiv 时是 `null`。
 */
export function arxivIdOfUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !/arxiv\.org\/(?:abs|pdf)\//i.test(url)) return null
  return normalizeArxivId(url)
}
