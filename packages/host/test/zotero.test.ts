/**
 * Zotero 本地只读能力（S16）：本机接口换成替身，判据只看包装层的几件事——开关没打开不代发请求、
 * 库与分类与条目怎么收、四种读法各自的路径、连不上与被拒与超时怎么分开、缓存按什么分键。
 */
import { describe, expect, it } from 'vitest'
import type { InstanceFace } from '@dsh-scholar-board/contracts'
import type { FetchLike } from '../src/http'
import {
  LITERATURE_ZOTERO_CAPABILITY,
  ZOTERO_API_VERSION,
  ZOTERO_BASE,
  ZOTERO_CACHE_MS,
  zoteroLookupCapability,
} from '../src/literature/zotero'

const FACE: InstanceFace = { id: 'card', widget: 'literature-records', props: {} }

function signal(): AbortSignal {
  return new AbortController().signal
}

function itemOf(key: string, data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key,
    version: 7,
    data: {
      itemType: 'journalArticle',
      title: '低轨星座干扰下的多用户检测',
      creators: [
        { firstName: 'Ada', lastName: 'Author' },
        { name: 'The Consortium' },
        null,
      ],
      DOI: 'https://doi.org/10.1109/TWC.2025.0001',
      url: 'https://ieeexplore.ieee.org/document/1',
      date: '2025-03-01',
      publicationTitle: 'IEEE TWC',
      ...data,
    },
  }
}

/** 按路径分派的请求替身，并记下每一次请求。 */
function fakeFetch(handler: (url: string) => { body?: unknown, status?: number } | Error): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const impl = async (url: string): Promise<Response> => {
    calls.push(url)
    const answer = handler(url)
    if (answer instanceof Error) throw answer
    const status = answer.status ?? 200
    return new Response(JSON.stringify(answer.body ?? []), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return Object.assign(impl, { calls })
}

describe('Zotero 开关与坐标', () => {
  it('没有 enabled=true 时不发请求', async () => {
    const fetchImpl = fakeFetch(() => ({ body: [] }))
    const capability = zoteroLookupCapability({ fetch: fetchImpl })
    expect(await capability.call(FACE, { op: 'items' }, signal())).toEqual({ status: 'disabled' })
    expect(await capability.call(FACE, { op: 'items', enabled: false }, signal())).toEqual({ status: 'disabled' })
    expect(await capability.call(FACE, { op: 'items', enabled: 'true' }, signal())).toEqual({ status: 'disabled' })
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it('只认四种读法，库与分类与条目 key 的形状不对时不发请求', async () => {
    const fetchImpl = fakeFetch(() => ({ body: [] }))
    const capability = zoteroLookupCapability({ fetch: fetchImpl })
    expect(await capability.call(FACE, { op: 'search', enabled: true }, signal())).toMatchObject({ status: 'failed' })
    expect(await capability.call(FACE, { op: 'items', enabled: true, library: '../../etc' }, signal())).toMatchObject({ status: 'failed' })
    expect(await capability.call(FACE, { op: 'items', enabled: true, collection: 'bad key' }, signal())).toMatchObject({ status: 'failed' })
    expect(await capability.call(FACE, { op: 'item', enabled: true, itemKey: 'bad key' }, signal())).toMatchObject({ status: 'failed' })
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it('只连本机回环，库编号决定 users 或 groups 前缀', async () => {
    const fetchImpl = fakeFetch(() => ({ body: [] }))
    const capability = zoteroLookupCapability({ fetch: fetchImpl })
    await capability.call(FACE, { op: 'items', enabled: true }, signal())
    await capability.call(FACE, { op: 'items', enabled: true, library: '123' }, signal())
    expect(fetchImpl.calls[0]).toBe(`${ZOTERO_BASE}/users/0/items/top?limit=25&start=0`)
    expect(fetchImpl.calls[1]).toBe(`${ZOTERO_BASE}/groups/123/items/top?limit=25&start=0`)
    expect(fetchImpl.calls.every(url => url.startsWith('http://127.0.0.1:23119/api/'))).toBe(true)
  })
})

describe('Zotero 四种读法', () => {
  it('库只报用户库，接口版本与读取时间一起回', async () => {
    const capability = zoteroLookupCapability({
      fetch: fakeFetch(() => ({ body: [{ key: 'X', version: 1, data: {} }] })),
      now: () => Date.parse('2026-11-10T08:00:00.000Z'),
    })
    const result = await capability.call(FACE, { op: 'libraries', enabled: true }, signal())
    expect(result).toEqual({
      status: 'ready',
      op: 'libraries',
      apiVersion: ZOTERO_API_VERSION,
      fetchedAt: '2026-11-10T08:00:00.000Z',
      library: '0',
      libraries: [{ library: '0', name: '我的文库 / My Library' }],
    })
  })

  it('分类只留 key 与名字，坏条目跳过', async () => {
    const capability = zoteroLookupCapability({
      fetch: fakeFetch(() => ({
        body: [
          { key: 'ABCD1234', data: { name: '博士论文' } },
          { key: 'bad key', data: { name: '坏的' } },
          { key: 'EFGH5678', data: {} },
          null,
        ],
      })),
    })
    const result = await capability.call(FACE, { op: 'collections', enabled: true }, signal())
    expect(result).toMatchObject({
      status: 'ready',
      collections: [
        { key: 'ABCD1234', name: '博士论文' },
        { key: 'EFGH5678', name: '' },
      ],
    })
  })

  it('条目收成卡片认识的字段，地址只要 http(s)，年份从日期里取', async () => {
    const capability = zoteroLookupCapability({
      fetch: fakeFetch(() => ({
        body: [
          itemOf('ABCD1234'),
          itemOf('EFGH5678', { title: '', url: 'file:///etc/passwd', date: '没有年份', publicationTitle: '', DOI: 'bad' }),
          { key: 'bad key', version: 1, data: {} },
          null,
        ],
      })),
    })
    const result = await capability.call(FACE, { op: 'items', enabled: true, q: '  干扰  ', limit: 500 }, signal())
    if (result.status !== 'ready') throw new Error('should be ready')
    expect(result.items).toEqual([
      {
        key: 'ABCD1234',
        version: 7,
        itemType: 'journalArticle',
        title: '低轨星座干扰下的多用户检测',
        authors: ['Ada Author', 'The Consortium'],
        doi: '10.1109/twc.2025.0001',
        url: 'https://ieeexplore.ieee.org/document/1',
        year: 2025,
        venue: 'IEEE TWC',
      },
      { key: 'EFGH5678', version: 7, itemType: 'journalArticle', title: '', authors: ['Ada Author', 'The Consortium'] },
    ])
  })

  it('搜索词与条数上限带进查询串，分类限定路径', async () => {
    const fetchImpl = fakeFetch(() => ({ body: [] }))
    const capability = zoteroLookupCapability({ fetch: fetchImpl })
    await capability.call(FACE, { op: 'items', enabled: true, q: ' 干扰 ', limit: 500 }, signal())
    await capability.call(FACE, { op: 'items', enabled: true, collection: 'ABCD1234', limit: 0 }, signal())
    expect(fetchImpl.calls[0]).toBe(`${ZOTERO_BASE}/users/0/items/top?limit=50&start=0&q=%E5%B9%B2%E6%89%B0`)
    expect(fetchImpl.calls[1]).toBe(`${ZOTERO_BASE}/users/0/collections/ABCD1234/items/top?limit=1&start=0`)
  })

  it('单条读法接受对象与单元素数组，读不出条目时算没有', async () => {
    const single = zoteroLookupCapability({ fetch: fakeFetch(() => ({ body: itemOf('ABCD1234') })) })
    const array = zoteroLookupCapability({ fetch: fakeFetch(() => ({ body: [itemOf('ABCD1234')] })) })
    const missing = zoteroLookupCapability({ fetch: fakeFetch(() => ({ body: [{ key: 'bad key', data: {} }] })) })
    expect(await single.call(FACE, { op: 'item', enabled: true, itemKey: 'ABCD1234' }, signal()))
      .toMatchObject({ status: 'ready', item: { key: 'ABCD1234' } })
    expect(await array.call(FACE, { op: 'item', enabled: true, itemKey: 'ABCD1234' }, signal()))
      .toMatchObject({ status: 'ready', item: { key: 'ABCD1234' } })
    expect(await missing.call(FACE, { op: 'item', enabled: true, itemKey: 'ZZZZ9999' }, signal()))
      .toEqual({ status: 'not-found' })
  })
})

describe('Zotero 失败与缓存', () => {
  it('连不上、被拒、超时、没有这一条、别的失败分开回报', async () => {
    const offline = zoteroLookupCapability({ fetch: fakeFetch(() => new Error('connect ECONNREFUSED 127.0.0.1:23119')) })
    expect(await offline.call(FACE, { op: 'items', enabled: true }, signal())).toMatchObject({ status: 'offline' })

    const timeoutError = new Error('The operation was aborted')
    timeoutError.name = 'TimeoutError'
    const timeout = zoteroLookupCapability({ fetch: fakeFetch(() => timeoutError) })
    expect(await timeout.call(FACE, { op: 'items', enabled: true }, signal())).toEqual({ status: 'timeout' })

    const forbidden = zoteroLookupCapability({ fetch: fakeFetch(() => ({ status: 403 })) })
    expect(await forbidden.call(FACE, { op: 'items', enabled: true }, signal())).toEqual({ status: 'forbidden' })

    const missing = zoteroLookupCapability({ fetch: fakeFetch(() => ({ status: 404 })) })
    expect(await missing.call(FACE, { op: 'items', enabled: true }, signal())).toEqual({ status: 'not-found' })

    const broken = zoteroLookupCapability({ fetch: fakeFetch(() => ({ status: 500 })) })
    expect(await broken.call(FACE, { op: 'items', enabled: true }, signal())).toMatchObject({ status: 'failed' })

    const network = zoteroLookupCapability({ fetch: fakeFetch(() => new Error('socket hang up')) })
    expect(await network.call(FACE, { op: 'items', enabled: true }, signal())).toMatchObject({ status: 'failed' })
  })

  it('三十秒内重复读同一份结果不重发，refresh 跳过缓存', async () => {
    let now = Date.parse('2026-11-10T08:00:00.000Z')
    const fetchImpl = fakeFetch(() => ({ body: [] }))
    const capability = zoteroLookupCapability({ fetch: fetchImpl, now: () => now })
    await capability.call(FACE, { op: 'items', enabled: true }, signal())
    now += ZOTERO_CACHE_MS - 1
    await capability.call(FACE, { op: 'items', enabled: true }, signal())
    expect(fetchImpl.calls).toHaveLength(1)
    await capability.call(FACE, { op: 'items', enabled: true, refresh: true }, signal())
    expect(fetchImpl.calls).toHaveLength(2)
    now += ZOTERO_CACHE_MS
    await capability.call(FACE, { op: 'items', enabled: true }, signal())
    expect(fetchImpl.calls).toHaveLength(3)
  })

  it('缓存按读法、库、分类、条目、搜索词与条数分键', async () => {
    const fetchImpl = fakeFetch(() => ({ body: [] }))
    const capability = zoteroLookupCapability({ fetch: fetchImpl })
    await capability.call(FACE, { op: 'items', enabled: true }, signal())
    await capability.call(FACE, { op: 'items', enabled: true, q: '干扰' }, signal())
    await capability.call(FACE, { op: 'items', enabled: true, limit: 10 }, signal())
    await capability.call(FACE, { op: 'collections', enabled: true }, signal())
    expect(fetchImpl.calls).toHaveLength(4)
  })

  it('能力名固定，不需要凭据', async () => {
    const capability = zoteroLookupCapability()
    expect(capability.id).toBe(LITERATURE_ZOTERO_CAPABILITY)
    expect(capability.provider).toBe('literature')
    expect(capability.permission).toBeUndefined()
    expect(capability.credentials).toBeUndefined()
  })
})