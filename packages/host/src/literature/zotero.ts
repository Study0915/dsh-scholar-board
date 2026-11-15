/**
 * Zotero 本地只读（S16）：连用户本机的 Zotero 本地 API，选库、选分类、看条目，再把选中的条目交给
 * 文献卡预览导入。
 *
 * 只连 `127.0.0.1:23119`，不读 SQLite、不碰 Web API、也不做端口转发：云端宿主连不到用户桌面的
 * Zotero，这时如实回「连不上」，界面据此说明所连设备。连接由用户在卡片设置里手动打开；打开之前
 * 卡片不调用这项能力，传进来的 `enabled` 不是真值时宿主也不代发请求。
 *
 * 返回的每一条都只带文献卡认识的元数据，并附上库、条目 key 与接口版本——外部版本与记录自己的
 * 修订号是两回事。缓存与 Crossref 分开，只在同一次会话里留三十秒，Zotero 里刚改过的东西很快能再读到。
 */
import type { CapabilityRegistration, InstanceFace } from '@dsh-scholar-board/contracts'
import { WIDGET_BOARD_API_VERSION, normalizeDoi } from '@dsh-scholar-board/contracts'
import type { FetchLike } from '../http'
import { HTTP_TIMEOUT_MS, readJsonBody } from '../http'
import { collectAuthors } from './authors'

/** 能力的名字；组件 manifest 用它声明。 */
export const LITERATURE_ZOTERO_CAPABILITY = 'literature.zotero'

/** Zotero 本地 API 的根地址；只连本机回环。 */
export const ZOTERO_BASE = 'http://127.0.0.1:23119/api'

/** 本地 API 跟的 Web API 版本；写进每条外部来源，读回来知道这份元数据按哪版解释。 */
export const ZOTERO_API_VERSION = '3'

/** 一次读的结果留多久；Zotero 里刚改过的条目很快能再读到。 */
export const ZOTERO_CACHE_MS = 30_000

/** 一次列条目最多带回多少条。 */
export const ZOTERO_ITEM_LIMIT = 50

/** 一个库。 */
export interface ZoteroLibrary {
  /** Zotero 的库编号：用户库是 `0`，群组库是群组编号。 */
  library: string
  name: string
}

/** 一个分类。 */
export interface ZoteroCollection {
  key: string
  name: string
}

/** 一条文献条目；字段与文献卡补入时认识的元数据对齐。 */
export interface ZoteroItem {
  key: string
  version: number
  itemType: string
  /** 没有标题时是空串，卡片改用条目 key 顶上。 */
  title: string
  authors: string[]
  doi?: string
  url?: string
  year?: number
  venue?: string
}

/** 四种读法。 */
export type ZoteroOp = 'libraries' | 'collections' | 'items' | 'item'

/** 一次读的结果：读到了、没启用、连不上、被拒、超时、没有这一条、还是读失败。 */
export type ZoteroLookup =
  | {
    status: 'ready'
    op: ZoteroOp
    apiVersion: typeof ZOTERO_API_VERSION
    fetchedAt: string
    library: string
    libraries?: ZoteroLibrary[]
    collections?: ZoteroCollection[]
    items?: ZoteroItem[]
    item?: ZoteroItem
  }
  | { status: 'disabled' }
  | { status: 'offline', reason: string }
  | { status: 'forbidden' }
  | { status: 'timeout' }
  | { status: 'not-found' }
  | { status: 'failed', reason: string }

/** 库、分类与条目 key 的形状：只允许编号与字母数字，不拼出别的路径。 */
const KEY = /^[A-Za-z0-9]{1,64}$/

/** 作者与标题的上限；再长的署名与题目卡片也放不下。 */
const AUTHOR_LIMIT = 20
const TITLE_LIMIT = 500
const VENUE_LIMIT = 300

/** 库的 schema。 */
const LIBRARY = {
  type: 'object',
  additionalProperties: false,
  required: ['library', 'name'],
  properties: { library: { type: 'string' }, name: { type: 'string' } },
} as const

/** 分类的 schema。 */
const COLLECTION = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'name'],
  properties: { key: { type: 'string' }, name: { type: 'string' } },
} as const

/** 条目的 schema。 */
const ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'version', 'itemType', 'title', 'authors'],
  properties: {
    key: { type: 'string' },
    version: { type: 'integer', minimum: 0 },
    itemType: { type: 'string' },
    title: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    doi: { type: 'string' },
    url: { type: 'string' },
    year: { type: 'integer', minimum: 0 },
    venue: { type: 'string' },
  },
} as const

/** 能力返回值的 schema：结果各一支。 */
const OUTPUT = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'op', 'apiVersion', 'fetchedAt', 'library'],
      properties: {
        status: { const: 'ready' },
        op: { enum: ['libraries', 'collections', 'items', 'item'] },
        apiVersion: { const: ZOTERO_API_VERSION },
        fetchedAt: { type: 'string' },
        library: { type: 'string' },
        libraries: { type: 'array', items: LIBRARY },
        collections: { type: 'array', items: COLLECTION },
        items: { type: 'array', items: ITEM },
        item: ITEM,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { enum: ['disabled', 'forbidden', 'timeout', 'not-found'] } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'reason'],
      properties: { status: { enum: ['offline', 'failed'] }, reason: { type: 'string' } },
    },
  ],
} as const

/** 能力的入参：读哪一种、连同库与条目的坐标。 */
const INPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['op'],
  properties: {
    op: { enum: ['libraries', 'collections', 'items', 'item'] },
    /** 用户手动打开连接后由卡片传真；不是真值时宿主不代发请求。 */
    enabled: { type: 'boolean' },
    library: { type: 'string', maxLength: 64 },
    collection: { type: 'string', maxLength: 64 },
    itemKey: { type: 'string', maxLength: 64 },
    /** 条目列表的搜索词。 */
    q: { type: 'string', maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: ZOTERO_ITEM_LIMIT },
    /** 由人按下的刷新传真：跳过缓存重新问 Zotero。 */
    refresh: { type: 'boolean' },
  },
} as const

/** 一次失败的种类；`failed` 之外都对应给人看的一句固定说明。 */
type FailureKind = 'offline' | 'forbidden' | 'timeout' | 'not-found' | 'failed'

/** 请求 Zotero 时已经分好类的失败。 */
class ZoteroFailure extends Error {
  constructor(readonly kind: FailureKind, message: string) {
    super(message)
    this.name = 'ZoteroFailure'
  }
}

/**
 * 从 fetch 抛出的错误里认出连接被拒这类本机服务不在的情况。
 *
 * @param error - 请求抛出的错误。
 * @returns 是不是连不上本机服务。
 */
function isOffline(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') return true
    current = (current as { cause?: unknown }).cause
  }
  const message = error instanceof Error ? error.message : String(error)
  return /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND/.test(message)
}

/**
 * 请求 Zotero 本地 API 的一份 JSON。
 *
 * @param path - 以 `/` 开头的路径与查询串。
 * @param signal - 中止信号：调用被取消或超时时停在这里。
 * @param fetchImpl - 请求函数；测试里换成替身。
 * @returns 解析出来的 JSON。
 * @throws {ZoteroFailure} 已按种类分好的失败。
 */
async function zoteroJson(path: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<unknown> {
  if (signal.aborted) throw new ZoteroFailure('timeout', '读 Zotero 的调用已被取消')
  const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchImpl(`${ZOTERO_BASE}${path}`, {
      headers: { accept: 'application/json', 'zotero-api-version': ZOTERO_API_VERSION },
      redirect: 'error',
      signal: AbortSignal.any([signal, timeout]),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ZoteroFailure('timeout', '连 Zotero 超时或被取消')
    }
    if (isOffline(error)) throw new ZoteroFailure('offline', error instanceof Error ? error.message : String(error))
    throw new ZoteroFailure('failed', error instanceof Error ? error.message : String(error))
  }
  // 本地 API 没打开时 Zotero 回 403；没读过这个条目时回 404。
  if (response.status === 403) throw new ZoteroFailure('forbidden', 'Zotero 没有打开本地 API')
  if (response.status === 404) throw new ZoteroFailure('not-found', 'Zotero 里没有这一条')
  if (!response.ok) throw new ZoteroFailure('failed', `Zotero 返回 ${String(response.status)}`)
  try {
    return await readJsonBody(response, 'Zotero 本地 API')
  } catch (error) {
    throw new ZoteroFailure('failed', error instanceof Error ? error.message : String(error))
  }
}

/**
 * 库对应的路径前缀：用户库是 `users/0`，群组库是 `groups/<编号>`。
 *
 * @param library - 库编号。
 * @returns 路径前缀。
 */
function prefixOf(library: string): string {
  return library === '0' ? 'users/0' : `groups/${library}`
}

/**
 * 取一段文本并截断；Zotero 的字段可能很长。
 *
 * @param value - 外来值。
 * @param limit - 最多留几个字符。
 * @returns 去空白后的文本；没有时是空串。
 */
function textOf(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length > limit ? text.slice(0, limit) : text
}

/**
 * 作者列表：分开的姓名连写，整体姓名直接用。
 *
 * @param value - 条目数据里的 `creators`。
 * @returns 去空白后的署名；最多保留前二十个。
 */
function authorsOf(value: unknown): string[] {
  return collectAuthors(value, (record) => {
    const full = textOf(record.firstName, 200)
    const last = textOf(record.lastName, 200)
    const name = [full, last].filter(part => part !== '').join(' ')
    return name === '' ? textOf(record.name, 200) : name
  }, AUTHOR_LIMIT)
}

/**
 * 从 Zotero 的日期文本里取四位年份。
 *
 * @param value - `date` 字段。
 * @returns 年份；读不出来时是 `undefined`。
 */
function yearOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /(\d{4})/.exec(value)
  if (match === null) return undefined
  const year = Number(match[1])
  return Number.isInteger(year) && year > 0 ? year : undefined
}

/**
 * 一条条目的出处：期刊、会议、书名或站点名，按条目类型依次取。
 *
 * @param data - 条目数据。
 * @returns 去空白后的出处；没有时是空串。
 */
function venueOf(data: Record<string, unknown>): string {
  for (const field of ['publicationTitle', 'proceedingsTitle', 'bookTitle', 'websiteTitle', 'repository']) {
    const text = textOf(data[field], VENUE_LIMIT)
    if (text !== '') return text
  }
  return ''
}

/**
 * 把一条 Zotero 条目收成卡片认识的样子；读不出 key 的跳过。
 *
 * @param raw - `data` 与 `key` 都在的条目。
 * @returns 卡片要的那一条；读不出来时是 `undefined`。
 */
function itemOf(raw: unknown): ZoteroItem | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const entry = raw as { key?: unknown, version?: unknown, data?: unknown }
  const key = typeof entry.key === 'string' ? entry.key : ''
  if (!KEY.test(key)) return undefined
  const data = entry.data !== null && typeof entry.data === 'object' ? entry.data as Record<string, unknown> : {}
  const rawDoi = typeof data.DOI === 'string' ? normalizeDoi(data.DOI) : null
  const url = textOf(data.url, 2048)
  const year = yearOf(data.date)
  const venue = venueOf(data)
  return {
    key,
    version: typeof entry.version === 'number' && entry.version >= 0 ? Math.floor(entry.version) : 0,
    itemType: textOf(data.itemType, 64),
    title: textOf(data.title, TITLE_LIMIT),
    authors: authorsOf(data.creators),
    ...(rawDoi === null ? {} : { doi: rawDoi }),
    ...(/^https?:\/\//.test(url) ? { url } : {}),
    ...(year === undefined ? {} : { year }),
    ...(venue === '' ? {} : { venue }),
  }
}

/**
 * 分类列表：只留 key 与名字。
 *
 * @param body - `/collections` 的响应。
 * @returns 分类；读不出来的跳过。
 */
function collectionsOf(body: unknown): ZoteroCollection[] {
  if (!Array.isArray(body)) return []
  const out: ZoteroCollection[] = []
  for (const entry of body) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as { key?: unknown, data?: unknown }
    const key = typeof record.key === 'string' ? record.key : ''
    if (!KEY.test(key)) continue
    const data = record.data !== null && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
    out.push({ key, name: textOf(data.name, 200) })
  }
  return out
}

/**
 * 一次读的全过程：检查开关与坐标、查缓存、拼路径、收结果。
 *
 * @param args - 已经按 input schema 校验过的参数。
 * @param signal - 中止信号。
 * @param deps - 请求替身、缓存与时钟。
 * @returns 各种结果之一。
 */
async function read(
  args: unknown,
  signal: AbortSignal,
  deps: {
    fetch: FetchLike
    cache: Map<string, { at: number, value: ZoteroLookup }>
    now: () => number
  },
): Promise<ZoteroLookup> {
  const asked = args as {
    op?: unknown
    enabled?: unknown
    library?: unknown
    collection?: unknown
    itemKey?: unknown
    q?: unknown
    limit?: unknown
    refresh?: unknown
  } | null
  // 没手动打开连接就不代发请求：界面上的开关关着时卡片也不会传真值。
  if (asked?.enabled !== true) return { status: 'disabled' }
  const op = asked.op
  if (op !== 'libraries' && op !== 'collections' && op !== 'items' && op !== 'item') {
    return { status: 'failed', reason: '不认识这种读法' }
  }
  const library = typeof asked.library === 'string' && asked.library !== '' ? asked.library : '0'
  if (!/^\d{1,20}$/.test(library)) return { status: 'failed', reason: '库的编号不合法' }
  const collection = typeof asked.collection === 'string' ? asked.collection : ''
  const itemKey = typeof asked.itemKey === 'string' ? asked.itemKey : ''
  if (collection !== '' && !KEY.test(collection)) return { status: 'failed', reason: '分类的编号不合法' }
  if (op === 'item' && !KEY.test(itemKey)) return { status: 'failed', reason: '条目的编号不合法' }
  // 没传按 25；传了但越界（含 0）就夹到最近的边界，别悄悄退回默认值。
  const askedLimit = typeof asked.limit === 'number' && Number.isFinite(asked.limit) ? asked.limit : 25
  const limit = Math.min(Math.max(Math.floor(askedLimit), 1), ZOTERO_ITEM_LIMIT)
  const q = typeof asked.q === 'string' ? asked.q.trim().slice(0, 200) : ''
  const refresh = asked.refresh === true
  const key = `${op}|${library}|${collection}|${itemKey}|${q}|${String(limit)}`
  const hit = deps.cache.get(key)
  if (!refresh && hit !== undefined && deps.now() - hit.at < ZOTERO_CACHE_MS) return hit.value

  const prefix = prefixOf(library)
  const query = new URLSearchParams({ limit: String(limit), start: '0' })
  if (q !== '') query.set('q', q)
  const pathOf = (): string => {
    if (op === 'libraries') return `/${prefix}/items/top?limit=1`
    if (op === 'collections') return `/${prefix}/collections?limit=100`
    if (op === 'item') return `/${prefix}/items/${itemKey}`
    return collection === ''
      ? `/${prefix}/items/top?${query.toString()}`
      : `/${prefix}/collections/${collection}/items/top?${query.toString()}`
  }

  try {
    const body = await zoteroJson(pathOf(), signal, deps.fetch)
    const fetchedAt = new Date(deps.now()).toISOString()
    let value: ZoteroLookup
    if (op === 'libraries') {
      value = {
        status: 'ready',
        op,
        apiVersion: ZOTERO_API_VERSION,
        fetchedAt,
        library,
        // 首批只连用户自己的库；群组库留给后续批次，不猜编号。
        libraries: [{ library: '0', name: '我的文库 / My Library' }],
      }
    } else if (op === 'collections') {
      value = { status: 'ready', op, apiVersion: ZOTERO_API_VERSION, fetchedAt, library, collections: collectionsOf(body) }
    } else if (op === 'items') {
      const items = Array.isArray(body)
        ? body.map(itemOf).filter((item): item is ZoteroItem => item !== undefined)
        : []
      value = { status: 'ready', op, apiVersion: ZOTERO_API_VERSION, fetchedAt, library, items }
    } else {
      const single = Array.isArray(body) ? itemOf(body[0]) : itemOf(body)
      if (single === undefined) return { status: 'not-found' }
      value = { status: 'ready', op, apiVersion: ZOTERO_API_VERSION, fetchedAt, library, item: single }
    }
    deps.cache.set(key, { at: deps.now(), value })
    return value
  } catch (error) {
    if (!(error instanceof ZoteroFailure)) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
    if (error.kind === 'offline') return { status: 'offline', reason: error.message }
    if (error.kind === 'failed') return { status: 'failed', reason: error.message }
    return { status: error.kind }
  }
}

/**
 * 建出 Zotero 本地只读能力。
 *
 * @param options - 请求与时钟的替身。
 * @returns 能力注册项。
 */
export function zoteroLookupCapability(options: { fetch?: FetchLike, now?: () => number } = {}): CapabilityRegistration {
  const deps = {
    fetch: options.fetch ?? fetch,
    cache: new Map<string, { at: number, value: ZoteroLookup }>(),
    now: options.now ?? Date.now,
  }
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: 'literature',
    id: LITERATURE_ZOTERO_CAPABILITY,
    title: { zh: 'Zotero 本地文库', en: 'Zotero local library' },
    description: {
      zh: '连本机的 Zotero 本地 API，列出文库、分类与条目；只读，不上传，也不读写你本机的数据库。',
      en: 'Reads libraries, collections and items from the Zotero local API on this machine; read-only and never touches the database file.',
    },
    input: INPUT,
    output: OUTPUT,
    async call(_instance: InstanceFace, args: unknown, signal: AbortSignal): Promise<ZoteroLookup> {
      return await read(args, signal, deps)
    },
  }
}

/**
 * 把 Zotero 能力注册进看板的注册表。
 *
 * @param sources - 看板的注册表。
 * @param fetchImpl - 请求函数；测试里换成替身。
 * @returns 撤下这次注册的函数。
 */
export function registerLiteratureZotero(
  sources: { registerCapability(capability: CapabilityRegistration): () => void },
  fetchImpl?: FetchLike,
): () => void {
  return sources.registerCapability(zoteroLookupCapability(fetchImpl === undefined ? {} : { fetch: fetchImpl }))
}