import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const { classify, judge, mib, safePath, scrub } = createRequire(import.meta.url)('../performance.cjs') as {
  classify: (url: string, origin: string) => string
  judge: (input: {
    cycles: { cycle: number, left: { detached: boolean, frames: number }, idle: { ms: number, hostRequests: number, paths: string[] } }[]
    hostResponses: { status: number, url: string }[]
    failedRequests: { url: string }[]
    consoleProblems: { source: string, text: string }[]
  }) => string[]
  mib: (bytes: number | null | undefined) => number | null
  safePath: (url: string) => string
  scrub: (text: string) => string
}

const cleanCycle = (cycle: number) => ({
  cycle,
  left: { detached: true, frames: 0 },
  idle: { ms: 3000, hostRequests: 0, paths: [] },
})

const quiet = { cycles: [cleanCycle(1)], hostResponses: [], failedRequests: [], consoleProblems: [] }

describe('性能探针的判定', () => {
  it('三轮都干净时没有问题', () => {
    expect(judge({ ...quiet, cycles: [cleanCycle(1), cleanCycle(2), cleanCycle(3)] })).toEqual([])
  })

  it('离开后还有接口请求算问题，带上是哪一轮与哪条路径', () => {
    const cycle = { ...cleanCycle(2), idle: { ms: 3000, hostRequests: 1, paths: ['/api/widget-board/boards'] } }
    expect(judge({ ...quiet, cycles: [cleanCycle(1), cycle] })[0]).toContain('第 2 轮')
    expect(judge({ ...quiet, cycles: [cleanCycle(1), cycle] })[0]).toContain('/api/widget-board/boards')
  })

  it('视图还在或 iframe 没摘掉分开报告', () => {
    const cycle = { ...cleanCycle(1), left: { detached: false, frames: 2 } }
    expect(judge({ ...quiet, cycles: [cycle] })).toEqual(['第 1 轮离开后看板视图还在', '第 1 轮离开后还有 2 个 iframe 没摘掉'])
  })

  it('宿主接口 4xx、非中止的请求失败与控制台报错都不放过', () => {
    const problems = judge({
      ...quiet,
      hostResponses: [{ status: 400, url: 'http://127.0.0.1/api/widget-board/boards?token=secret' }],
      failedRequests: [{ url: 'http://127.0.0.1/api/widget-board/events' }],
      consoleProblems: [{ source: 'console', text: 'boom' }],
    })
    expect(problems[0]).toBe('宿主接口返回 400 /api/widget-board/boards')
    expect(problems[1]).toBe('宿主接口请求失败 /api/widget-board/events')
    expect(problems[2]).toContain('控制台报错 1 条')
  })
})

describe('性能探针的请求分类', () => {
  const origin = 'http://127.0.0.1:4100'
  it('宿主接口、宿主静态资源、外部站点与内联资源分开数', () => {
    expect(classify(`${origin}/api/widget-board/boards`, origin)).toBe('host-api')
    expect(classify(`${origin}/app.js`, origin)).toBe('host-asset')
    expect(classify('https://example.com/track', origin)).toBe('external')
    expect(classify('data:text/plain,hi', origin)).toBe('inline')
    expect(classify('not a url', origin)).toBe('inline')
  })

  it('报告里只留路径，不带启动地址的令牌', () => {
    expect(safePath(`${origin}/api/boards?token=secret`)).toBe('/api/boards')
    expect(safePath('broken?token=secret')).toBe('broken')
  })

  it('控制台文本里的令牌先掩掉再写进报告', () => {
    expect(scrub(`请求 ${origin}/?token=secret 失败`)).toBe(`请求 ${origin}/?token=<redacted> 失败`)
    expect(scrub('没有令牌的报错原样保留')).toBe('没有令牌的报错原样保留')
  })

  it('字节折 MiB 时缺数据留空，不把未知写成 0', () => {
    expect(mib(1048576)).toBe(1)
    expect(mib(0)).toBe(0)
    expect(mib(null)).toBeNull()
    expect(mib(undefined)).toBeNull()
  })
})
