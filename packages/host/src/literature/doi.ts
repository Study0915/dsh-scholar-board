/**
 * DOI 元数据补全（S16）：按 DOI 读 Crossref，把候选元数据交给文献卡，由人选择补入。
 *
 * 组件拿不到网络，查询必须在宿主完成。这里只做三件事：规范化 DOI、请求 Crossref 并把工作条目收成
 * 卡片认识的样子、把「没有这一条」「问得太勤」「网络不通」分开回报。候选里不掺个人笔记——补入哪些
 * 字段由卡片上的人逐项决定，宿主不替人覆盖。
 *
 * Crossref 的联系邮箱（`mailto`）只在用户自己填了卡片设置时才带进查询串；不从 Git 身份、登录名或
 * 任何本机配置里取。缓存按规范化后的 DOI 分键，十分钟内重复查同一个 DOI 不再发出请求；人按下的
 * 刷新传 `refresh` 跳过缓存。
 */
import type { CapabilityRegistration, InstanceFace } from '@dsh-scholar-board/contracts'
import { WIDGET_BOARD_API_VERSION, normalizeDoi } from '@dsh-scholar-board/contracts'
import type { FetchLike } from '../http'
import { HTTP_TIMEOUT_MS, readJsonBody } from '../http'
import { collectAuthors } from './authors'

/** 能力的名字；组件 manifest 用它声明。 */
export const LITERATURE_DOI_CAPABILITY = 'literature.doi'

/** 提供方名；设置弹窗与授权记录用它标注归属。 */
export const LITERATURE_PROVIDER = 'literature'

/** 同一个 DOI 的查询结果留多久。 */
export const DOI_CACHE_MS = 10 * 60_000

/** Crossref 的工作条目接口；DOI 接在它后面。 */
const API = 'https://api.crossref.org/works/'

/** 一条候选元数据；字段是文献卡补入时认识的那些。 */
export interface DoiCandidate {
  doi: string
  /** Crossref 没有标题时是空串，卡片改用 DOI 顶上。 */
  title: string
  authors: string[]
  year?: number
  venue?: string
  publisher?: string
  type?: string
  url: string
}

/** 一次查询的结果：查到了、没有这一条、问得太勤、还是这次没查成。 */
export type DoiLookup =
  | { status: 'ready', doi: string, source: 'crossref', queriedAt: string, candidates: DoiCandidate[] }
  | { status: 'invalid', reason: string }
  | { status: 'not-found' }
  | { status: 'limited', retryAfter?: string }
  | { status: 'failed', reason: string }

/** 候选项的 schema；与 `DoiCandidate` 一一对应。 */
const CANDIDATE = {
  type: 'object',
  additionalProperties: false,
  required: ['doi', 'title', 'authors', 'url'],
  properties: {
    doi: { type: 'string' },
    title: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    year: { type: 'integer', minimum: 0 },
    venue: { type: 'string' },
    publisher: { type: 'string' },
    type: { type: 'string' },
    url: { type: 'string' },
  },
} as const

/** 能力返回值的 schema：四种结果各一支。 */
const OUTPUT = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'doi', 'source', 'queriedAt', 'candidates'],
      properties: {
        status: { const: 'ready' },
        doi: { type: 'string' },
        source: { const: 'crossref' },
        queriedAt: { type: 'string' },
        candidates: { type: 'array', items: CANDIDATE },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { enum: ['not-found'] } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { enum: ['limited'] }, retryAfter: { type: 'string' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'reason'],
      properties: { status: { enum: ['invalid', 'failed'] }, reason: { type: 'string' } },
    },
  ],
} as const

/** 能力的入参：要查的 DOI、可选的联系邮箱与是否跳过后台缓存。 */
const INPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['doi'],
  properties: {
    doi: { type: 'string', minLength: 1, maxLength: 250 },
    /** 用户自己填的联系邮箱；不填就不出现在查询串里。 */
    mailto: { type: 'string', maxLength: 200 },
    /** 由人按下的刷新传真：跳过缓存重新问 Crossref。 */
    refresh: { type: 'boolean' },
  },
} as const

/** 作者最多带几个；再多的署名卡片也放不下。 */
const AUTHOR_LIMIT = 20

/** 联系邮箱的形状：只接受简单的一行地址，别的当没填。 */
const MAILTO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 把 DOI 拼进接口路径：保留 `/`，其余分量各自转义。
 *
 * @param doi - 规范化后的 DOI。
 * @returns 接口路径。
 */
function pathOf(doi: string): string {
  return doi.split('/').map(encodeURIComponent).join('/')
}

/**
 * 从 Crossref 的日期结构里取年份。
 *
 * @param value - `published`、`issued` 这类字段。
 * @returns 四位年份；读不出来时是 `undefined`。
 */
function yearOf(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const parts = (value as { 'date-parts'?: unknown })['date-parts']
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return undefined
  const first = parts[0][0]
  return typeof first === 'number' && Number.isInteger(first) && first > 0 ? first : undefined
}

/**
 * 一份 `date-parts` 里第一段的年份：先看纸质版，再看在线版，最后退回录入时间。
 *
 * @param message - 工作条目。
 * @returns 年份；都没有时是 `undefined`。
 */
function publishedYearOf(message: Record<string, unknown>): number | undefined {
  for (const field of ['published-print', 'published-online', 'published', 'issued', 'created']) {
    const year = yearOf(message[field])
    if (year !== undefined) return year
  }
  return undefined
}

/**
 * 作者列表：`given family` 连写，没有分开的姓名时用 `name`。
 *
 * @param value - 工作条目里的 `author`。
 * @returns 去空白后的署名；最多保留前二十个。
 */
function authorsOf(value: unknown): string[] {
  return collectAuthors(value, (record) => {
    const given = typeof record.given === 'string' ? record.given.trim() : ''
    const family = typeof record.family === 'string' ? record.family.trim() : ''
    const literal = typeof record.name === 'string' ? record.name.trim() : ''
    const name = [given, family].filter(part => part !== '').join(' ')
    return name === '' ? literal : name
  }, AUTHOR_LIMIT)
}

/**
 * 取数组里的第一段非空文本；Crossref 的标题、期刊名都是数组。
 *
 * @param value - 外来值。
 * @returns 去空白后的文本；没有时是空串。
 */
function firstText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim() !== '') return entry.trim()
  }
  return ''
}

/**
 * 一条候选：能读出来的字段填上，读不出来就不出现。
 *
 * @param message - 工作条目。
 * @param requested - 这次查询用的 DOI。
 * @returns 卡片认识的候选。
 */
function candidateOf(message: Record<string, unknown>, requested: string): DoiCandidate {
  const raw = typeof message.DOI === 'string' ? normalizeDoi(message.DOI) : null
  const doi = raw ?? requested
  const title = firstText(message.title)
  const venue = firstText(message['container-title'])
  const publisher = typeof message.publisher === 'string' ? message.publisher.trim() : ''
  const type = typeof message.type === 'string' ? message.type.trim() : ''
  const url = typeof message.URL === 'string' && /^https?:\/\//.test(message.URL.trim())
    ? message.URL.trim()
    : `https://doi.org/${doi}`
  const year = publishedYearOf(message)
  return {
    doi,
    title,
    authors: authorsOf(message.author),
    ...(year === undefined ? {} : { year }),
    ...(venue === '' ? {} : { venue }),
    ...(publisher === '' ? {} : { publisher }),
    ...(type === '' ? {} : { type }),
    url,
  }
}

/**
 * 请求 Crossref 的工作条目。
 *
 * @param doi - 规范化后的 DOI。
 * @param mailto - 用户自己填的联系邮箱；没填时是空串。
 * @param signal - 中止信号：调用被取消或超时时停在这里。
 * @param fetchImpl - 请求函数；测试里换成替身。
 * @returns 响应；非 2xx 由调用方按状态处理。
 */
async function crossref(doi: string, mailto: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<Response> {
  // 调用在建请求之前就被取消时，信号已经错过：不必再发出去。
  if (signal.aborted) throw new Error('查 DOI 的调用已被取消')
  const query = new URLSearchParams()
  if (MAILTO.test(mailto)) query.set('mailto', mailto)
  const suffix = query.size === 0 ? '' : `?${query.toString()}`
  const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS)
  return await fetchImpl(`${API}${pathOf(doi)}${suffix}`, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-scholar-board' },
    redirect: 'error',
    signal: AbortSignal.any([signal, timeout]),
  })
}

/**
 * 一次查询的全过程。
 *
 * @param args - 已经按 input schema 校验过的参数。
 * @param signal - 中止信号。
 * @param deps - 请求替身、缓存与时钟。
 * @returns 四种结果之一。
 */
async function lookup(
  args: unknown,
  signal: AbortSignal,
  deps: {
    fetch: FetchLike
    cache: Map<string, { at: number, value: DoiLookup }>
    now: () => number
  },
): Promise<DoiLookup> {
  const asked = args as { doi?: unknown, mailto?: unknown, refresh?: unknown } | null
  const raw = typeof asked?.doi === 'string' ? asked.doi : ''
  const doi = normalizeDoi(raw)
  if (doi === null) return { status: 'invalid', reason: 'DOI 要写成 10.xxxx/… 的形式' }
  const refresh = asked?.refresh === true
  const hit = deps.cache.get(doi)
  if (!refresh && hit !== undefined && deps.now() - hit.at < DOI_CACHE_MS) return hit.value
  const mailto = typeof asked?.mailto === 'string' ? asked.mailto.trim() : ''

  try {
    const response = await crossref(doi, mailto, signal, deps.fetch)
    // 问得太勤：把 Crossref 给的等待时间原样带回去，卡片据此说「过一会儿再试」。
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')?.trim()
      return retryAfter === undefined || retryAfter === '' ? { status: 'limited' } : { status: 'limited', retryAfter }
    }
    if (response.status === 404) return { status: 'not-found' }
    if (!response.ok) return { status: 'failed', reason: `请求 api.crossref.org 返回 ${String(response.status)}` }
    const body = await readJsonBody(response, 'api.crossref.org')
    if (body === null || typeof body !== 'object') return { status: 'failed', reason: 'Crossref 没有回工作条目' }
    const message = (body as { message?: unknown }).message
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      return { status: 'failed', reason: 'Crossref 没有回工作条目' }
    }
    const value: DoiLookup = {
      status: 'ready',
      doi,
      source: 'crossref',
      queriedAt: new Date(deps.now()).toISOString(),
      candidates: [candidateOf(message as Record<string, unknown>, doi)],
    }
    deps.cache.set(doi, { at: deps.now(), value })
    return value
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 建出 DOI 元数据能力。
 *
 * @param options - 请求与时钟的替身。
 * @returns 能力注册项。
 */
export function doiLookupCapability(options: { fetch?: FetchLike, now?: () => number } = {}): CapabilityRegistration {
  const deps = {
    fetch: options.fetch ?? fetch,
    cache: new Map<string, { at: number, value: DoiLookup }>(),
    now: options.now ?? Date.now,
  }
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: LITERATURE_PROVIDER,
    id: LITERATURE_DOI_CAPABILITY,
    title: { zh: 'DOI 元数据', en: 'DOI metadata' },
    description: {
      zh: '按 DOI 查 Crossref，带回候选的标题、作者、年份与出处；补入哪些字段由你逐项决定。',
      en: 'Looks up a DOI on Crossref and returns candidate title, authors, year and venue; you decide which fields to fill in.',
    },
    input: INPUT,
    output: OUTPUT,
    // 只读公开元数据，不碰个人资料：不另要授权、也不要凭据。
    async call(_instance: InstanceFace, args: unknown, signal: AbortSignal): Promise<DoiLookup> {
      return await lookup(args, signal, deps)
    },
  }
}

/**
 * 把 DOI 能力注册进看板的注册表。
 *
 * @param sources - 看板的注册表。
 * @param fetchImpl - 请求函数；测试里换成替身。
 * @returns 撤下这次注册的函数。
 */
export function registerLiteratureDoi(
  sources: { registerCapability(capability: CapabilityRegistration): () => void },
  fetchImpl?: FetchLike,
): () => void {
  return sources.registerCapability(doiLookupCapability(fetchImpl === undefined ? {} : { fetch: fetchImpl }))
}