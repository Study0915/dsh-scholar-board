/**
 * DOI 元数据能力（S16）：Crossref 换成替身，判据只看包装层的几件事——DOI 怎么规范化、候选里的字段
 * 怎么从 Crossref 的工作条目读出来、四种结果各自回什么、缓存按什么分键、联系邮箱什么时候才带上。
 */
import { describe, expect, it } from 'vitest'
import type { InstanceFace } from '@dsh-scholar-board/contracts'
import type { FetchLike } from '../src/http'
import { DOI_CACHE_MS, LITERATURE_DOI_CAPABILITY, LITERATURE_PROVIDER, doiLookupCapability } from '../src/literature/doi'

const FACE: InstanceFace = { id: 'card', widget: 'literature-records', props: {} }

/** Crossref 的一份工作条目；字段名按接口原文。 */
function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DOI: '10.1109/TWC.2025.0001',
    title: ['低轨星座干扰下的多用户检测', 'A second title'],
    author: [
      { given: 'Ada', family: 'Author' },
      { given: ' ', family: 'Second' },
      { name: 'The Consortium' },
      null,
    ],
    'container-title': ['IEEE Transactions on Wireless Communications'],
    publisher: 'IEEE',
    type: 'journal-article',
    URL: 'https://ieeexplore.ieee.org/document/1',
    'published-print': { 'date-parts': [[2025, 3, 1]] },
    'published-online': { 'date-parts': [[2024, 12, 1]] },
    ...overrides,
  }
}

/** 按响应描述造一个请求替身，并记下每一次请求。 */
function fakeFetch(options: {
  body?: unknown
  status?: number
  headers?: Record<string, string>
  fail?: Error
} = {}): FetchLike & { calls: { url: string, init: RequestInit }[] } {
  const calls: { url: string, init: RequestInit }[] = []
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    if (options.fail !== undefined) throw options.fail
    const status = options.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(options.body ?? { message: message() }), {
      status,
      headers: options.headers ?? { 'content-type': 'application/json' },
    })
  }
  return Object.assign(impl, { calls })
}

function signal(): AbortSignal {
  return new AbortController().signal
}

describe('DOI 查询', () => {
  it('把工作条目收成候选：标题取第一段、年份先看纸质版、地址只收 http(s)', async () => {
    const capability = doiLookupCapability({
      fetch: fakeFetch(),
      now: () => Date.parse('2026-11-10T08:00:00.000Z'),
    })
    const result = await capability.call(FACE, { doi: 'https://doi.org/10.1109/TWC.2025.0001' }, signal())
    expect(result).toEqual({
      status: 'ready',
      doi: '10.1109/twc.2025.0001',
      source: 'crossref',
      queriedAt: '2026-11-10T08:00:00.000Z',
      candidates: [{
        doi: '10.1109/twc.2025.0001',
        title: '低轨星座干扰下的多用户检测',
        authors: ['Ada Author', 'Second', 'The Consortium'],
        year: 2025,
        venue: 'IEEE Transactions on Wireless Communications',
        publisher: 'IEEE',
        type: 'journal-article',
        url: 'https://ieeexplore.ieee.org/document/1',
      }],
    })
  })

  it('没有可用地址时退回 doi.org，缺的字段不出现', async () => {
    const capability = doiLookupCapability({
      fetch: fakeFetch({ body: { message: { DOI: '10.1000/xyz', title: [], URL: 'file:///etc/passwd' } } }),
    })
    const result = await capability.call(FACE, { doi: '10.1000/xyz' }, signal())
    expect(result).toMatchObject({
      status: 'ready',
      candidates: [{ doi: '10.1000/xyz', title: '', authors: [], url: 'https://doi.org/10.1000/xyz' }],
    })
    if (result.status !== 'ready') throw new Error('should be ready')
    expect(result.candidates[0]).not.toHaveProperty('year')
    expect(result.candidates[0]).not.toHaveProperty('venue')
  })

  it('DOI 先规范化，路径保留斜杠', async () => {
    const fetchImpl = fakeFetch()
    const capability = doiLookupCapability({ fetch: fetchImpl })
    await capability.call(FACE, { doi: ' https://doi.org/10.1109/TWC.2025.0001 ' }, signal())
    expect(fetchImpl.calls).toHaveLength(1)
    expect(fetchImpl.calls[0].url).toBe('https://api.crossref.org/works/10.1109/twc.2025.0001')
    expect(fetchImpl.calls[0].init.redirect).toBe('error')
  })

  it('联系邮箱只在形状合法时带上', async () => {
    const fetchImpl = fakeFetch()
    const capability = doiLookupCapability({ fetch: fetchImpl })
    await capability.call(FACE, { doi: '10.1000/a', mailto: 'reader@example.com' }, signal())
    await capability.call(FACE, { doi: '10.1000/b', mailto: 'not an email' }, signal())
    await capability.call(FACE, { doi: '10.1000/c' }, signal())
    expect(fetchImpl.calls[0].url).toBe('https://api.crossref.org/works/10.1000/a?mailto=reader%40example.com')
    expect(fetchImpl.calls[1].url).toBe('https://api.crossref.org/works/10.1000/b')
    expect(fetchImpl.calls[2].url).toBe('https://api.crossref.org/works/10.1000/c')
  })

  it('十分钟内重复查同一个 DOI 不再发请求，refresh 跳过缓存', async () => {
    let now = Date.parse('2026-11-10T08:00:00.000Z')
    const fetchImpl = fakeFetch()
    const capability = doiLookupCapability({ fetch: fetchImpl, now: () => now })
    await capability.call(FACE, { doi: '10.1000/a' }, signal())
    now += DOI_CACHE_MS - 1
    await capability.call(FACE, { doi: '10.1000/a' }, signal())
    expect(fetchImpl.calls).toHaveLength(1)
    await capability.call(FACE, { doi: '10.1000/a', refresh: true }, signal())
    expect(fetchImpl.calls).toHaveLength(2)
    now += DOI_CACHE_MS
    await capability.call(FACE, { doi: '10.1000/a' }, signal())
    expect(fetchImpl.calls).toHaveLength(3)
  })

  it('格式不对、查不到、问得太勤、请求失败分开回报', async () => {
    const invalid = await doiLookupCapability({ fetch: fakeFetch() }).call(FACE, { doi: 'not-a-doi' }, signal())
    expect(invalid.status).toBe('invalid')

    const missing = await doiLookupCapability({ fetch: fakeFetch({ status: 404 }) }).call(FACE, { doi: '10.1000/a' }, signal())
    expect(missing).toEqual({ status: 'not-found' })

    const limited = await doiLookupCapability({ fetch: fakeFetch({ status: 429, headers: { 'retry-after': '30' } }) })
      .call(FACE, { doi: '10.1000/a' }, signal())
    expect(limited).toEqual({ status: 'limited', retryAfter: '30' })

    const plainLimited = await doiLookupCapability({ fetch: fakeFetch({ status: 429 }) }).call(FACE, { doi: '10.1000/a' }, signal())
    expect(plainLimited).toEqual({ status: 'limited' })

    const broken = await doiLookupCapability({ fetch: fakeFetch({ status: 500 }) }).call(FACE, { doi: '10.1000/a' }, signal())
    expect(broken).toMatchObject({ status: 'failed', reason: expect.stringContaining('500') })

    const offline = await doiLookupCapability({ fetch: fakeFetch({ fail: new Error('ECONNREFUSED') }) })
      .call(FACE, { doi: '10.1000/a' }, signal())
    expect(offline).toMatchObject({ status: 'failed', reason: 'ECONNREFUSED' })
  })

  it('响应里没有工作条目时算失败', async () => {
    const capability = doiLookupCapability({ fetch: fakeFetch({ body: { message: [] } }) })
    expect(await capability.call(FACE, { doi: '10.1000/a' }, signal())).toMatchObject({ status: 'failed' })
  })

  it('调用已经取消时不再发请求', async () => {
    const fetchImpl = fakeFetch()
    const capability = doiLookupCapability({ fetch: fetchImpl })
    const controller = new AbortController()
    controller.abort()
    expect(await capability.call(FACE, { doi: '10.1000/a' }, controller.signal)).toMatchObject({ status: 'failed' })
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it('能力名与提供方固定，只读公开元数据', async () => {
    const capability = doiLookupCapability()
    expect(capability.id).toBe(LITERATURE_DOI_CAPABILITY)
    expect(capability.provider).toBe(LITERATURE_PROVIDER)
    expect(capability.permission).toBeUndefined()
    expect(capability.credentials).toBeUndefined()
  })
})