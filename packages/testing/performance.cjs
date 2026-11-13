#!/usr/bin/env node
'use strict'
/**
 * performance.cjs — S01 的性能测量：在临时宿主里反复打开、离开学术看板，量挂载、请求、长任务与资源释放。
 *
 * 每次跑都起一个独立的临时宿主与浏览器上下文，视口固定，浏览器关掉后台节流。看板上另加一张运行成本卡，
 * 用它同时读页面堆与宿主堆／常驻内存；离开看板后先等接口安静，再量一段没有请求、没有残留 iframe 的空闲窗口。
 * 报告写到 `.debug/s01/perf-<时间戳>.json`；出现宿主本地 4xx/5xx、非中止的请求失败、离开后仍有接口请求、
 * 卡片 iframe 没摘掉或控制台报错，就以非零退出。
 *
 * 用法：node packages/testing/performance.cjs [--cycles 3] [--window 3000] [--settle 10000] [--quiet 1000] [--drain 2000] [--width 1440] [--height 900]
 */
const { execFileSync } = require('node:child_process')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { launchBrowser, newContextOn } = require('./browser.cjs')
const { scratchHome, start } = require('./dsh-web.cjs')
const { addInstance } = require('./board.cjs')
const { dismissOverlays } = require('./panel.cjs')

const ROOT = join(__dirname, '..', '..')
const OUT = join(ROOT, '.debug', 's01')
const PANEL_ICON = 'svg.dsh-scholar-board__icon'
const BOARD_VIEW = '[data-dsh-scholar-board-view]'
const FLOW = '.dsh-scholar-board__flow[data-active="true"]'
const CARD_FRAME = `${FLOW} iframe.dsh-scholar-board__frame`
const PANEL_NAME = { board: '看板', plugins: '插件' }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 读一个整数参数。
 *
 * @param name - 参数名，例如 `--cycles`。
 * @param fallback - 没写时用的值。
 * @returns 命令行里的值或默认值。
 */
function option(name, fallback) {
  const at = process.argv.indexOf(name)
  if (at === -1) return fallback
  const value = Number(process.argv[at + 1])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** 从 git 读出当前提交，报告里能对上代码。 */
function commit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/**
 * 把一个请求分到宿主接口、宿主静态资源、外部站点或内联资源。
 *
 * @param url - 请求地址。
 * @param origin - 宿主页面的 origin。
 * @returns 分类名。
 */
function classify(url, origin) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return 'inline'
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') return 'inline'
  if (parsed.origin !== origin) return 'external'
  return parsed.pathname.startsWith('/api/') ? 'host-api' : 'host-asset'
}

/**
 * 只保留路径，报告里不出现带令牌的启动地址。
 *
 * @param url - 请求地址。
 * @returns 路径；解析不了时退回问号前的部分。
 */
function safePath(url) {
  try {
    return new URL(url).pathname
  } catch {
    return String(url).split('?')[0]
  }
}

/**
 * 数当前看板里已经接上运行时令牌的卡片。
 *
 * @param page - 宿主页面。
 * @returns 接上的卡片数与总卡片数。
 */
async function wiredCards(page) {
  const handles = await page.$$(CARD_FRAME)
  let wired = 0
  for (const handle of handles) {
    const frame = await handle.contentFrame()
    if (frame === null) continue
    const ready = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--w-color-bg').trim() !== '')
      .then((value) => value, () => false)
    if (ready) wired += 1
  }
  return { total: handles.length, wired }
}

/**
 * 等当前看板里的卡片 iframe 全部接上运行时令牌。
 *
 * @param page - 宿主页面。
 * @param timeoutMs - 最长等待时间。
 * @returns 接上的卡片数与总卡片数。
 */
async function waitCardsWired(page, timeoutMs) {
  const started = Date.now()
  let state = { total: 0, wired: 0 }
  while (Date.now() - started < timeoutMs) {
    state = await wiredCards(page)
    if (state.total > 0 && state.wired === state.total) return state
    await sleep(200)
  }
  throw new Error(`卡片在 ${String(timeoutMs)} 毫秒内没有全部接上：${String(state.wired)}/${String(state.total)}`)
}

/** 按侧栏行的可访问名切换宿主自己的视图，不猜关闭按钮。 */
async function switchPanel(page, name) {
  await page.evaluate((label) => {
    const row = Array.from(document.querySelectorAll('button')).find((button) => (button.textContent ?? '').trim() === label)
    row?.click()
  }, name)
}

/**
 * 打开看板，等到卡片接上令牌。
 *
 * @param page - 宿主页面。
 * @param timeoutMs - 等卡片的上限。
 * @returns 挂载耗时、卡片数与标题。
 */
async function openBoard(page, timeoutMs) {
  const started = Date.now()
  await switchPanel(page, PANEL_NAME.board)
  await page.waitForSelector(BOARD_VIEW, { timeout: timeoutMs })
  const wired = await waitCardsWired(page, timeoutMs)
  await sleep(500)
  const titles = await page.evaluate((selector) => Array.from(document.querySelectorAll(selector)).map((frame) => frame.title), CARD_FRAME)
  return { ms: Date.now() - started, cards: wired.total, titles }
}

/**
 * 离开看板，等到视图卸载。
 *
 * @param page - 宿主页面。
 * @param timeoutMs - 等卸载的上限。
 * @returns 视图是否卸载、剩下的 iframe 数。
 */
async function leaveBoard(page, timeoutMs) {
  await switchPanel(page, PANEL_NAME.plugins)
  const detached = await page.waitForSelector(BOARD_VIEW, { state: 'detached', timeout: timeoutMs }).then(() => true, () => false)
  return { detached, frames: await page.evaluate(() => document.querySelectorAll('iframe').length) }
}

/**
 * 等宿主接口安静下来：连续一段时间没有新的接口请求才算沉降完成。
 *
 * 离开看板会带来一次可见性上报，固定等待容易把这段一次性请求算进空闲窗口，也容易漏掉真正的轮询。
 *
 * @param requests - 已经收到的请求，元素带 phase 与 kind。
 * @param timeoutMs - 最长等待时间。
 * @param quietMs - 连续多久没有新的接口请求算安静。
 * @returns 从开始等到安静花的时间。
 */
async function waitForQuiet(requests, timeoutMs, quietMs) {
  const started = Date.now()
  let last = requests.filter((entry) => entry.kind === 'host-api').length
  let quietSince = Date.now()
  while (Date.now() - started < timeoutMs) {
    await sleep(100)
    const current = requests.filter((entry) => entry.kind === 'host-api').length
    if (current !== last) {
      last = current
      quietSince = Date.now()
      continue
    }
    if (Date.now() - quietSince >= quietMs) return Date.now() - started
  }
  throw new Error(`宿主接口在 ${String(timeoutMs)} 毫秒内没有安静下来；最后一次请求之后仍在轮询`)
}

/**
 * 读页面堆；先收一次垃圾，避免把还没回收的对象算成增长。
 *
 * @param cdp - 页面的 CDP 会话。
 * @returns 页面堆的已用字节与总量。
 */
async function pageHeap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {})
  const usage = await cdp.send('Runtime.getHeapUsage')
  return { usedBytes: Math.round(usage.usedSize), totalBytes: Math.round(usage.totalSize) }
}

/**
 * 从运行成本卡读宿主一侧的读数；卡还没采到时返回 null。
 *
 * @param page - 宿主页面。
 * @returns 宿主读数或 null。
 */
async function hostStats(page) {
  return page.evaluate(async () => {
    const workspace = await (await fetch('api/widget-board/boards')).json()
    const board = workspace.boards.find((entry) => entry.id === workspace.active) ?? workspace.boards[0]
    const instance = board?.instances.find((entry) => entry.widget === 'system-metrics')
    return instance?.data?.host ?? null
  })
}

/**
 * 把文本里的启动令牌掩掉：控制台报错可能带回页面地址。
 *
 * @param text - 原始文本。
 * @returns 令牌已替换的文本。
 */
function scrub(text) {
  return text.replace(/([?&]token=)[^\s&"']+/g, '$1<redacted>')
}

/**
 * 把字节数折成 MiB，缺数据时留 null。
 *
 * @param bytes - 字节数或 null。
 * @returns 取整后的 MiB。
 */
function mib(bytes) {
  return bytes === null || bytes === undefined ? null : Math.round(bytes / 1048576)
}

/**
 * 判定这一轮测量有没有问题：它是探针退出码的唯一来源，单独拆出来便于回归。
 *
 * @param input - 各轮读数、宿主响应、失败的请求与控制台报错。
 * @param input.cycles - 每轮的 {@link measure} 读数。
 * @param input.hostResponses - 宿主接口返回 4xx/5xx 的响应。
 * @param input.failedRequests - 非中止的宿主接口请求失败。
 * @param input.consoleProblems - 控制台错误、警告与未捕获异常。
 * @returns 问题清单；为空表示通过。
 */
function judge(input) {
  const problems = []
  if (input.hostResponses.length > 0) problems.push(`宿主接口返回 ${input.hostResponses.map((entry) => `${String(entry.status)} ${safePath(entry.url)}`).join('、')}`)
  if (input.failedRequests.length > 0) problems.push(`宿主接口请求失败 ${input.failedRequests.map((entry) => safePath(entry.url)).join('、')}`)
  for (const cycle of input.cycles) {
    if (!cycle.left.detached) problems.push(`第 ${String(cycle.cycle)} 轮离开后看板视图还在`)
    if (cycle.left.frames > 0) problems.push(`第 ${String(cycle.cycle)} 轮离开后还有 ${String(cycle.left.frames)} 个 iframe 没摘掉`)
    if (cycle.idle.hostRequests > 0) problems.push(`第 ${String(cycle.cycle)} 轮离开后的空闲 ${String(cycle.idle.ms)} 毫秒里还有 ${String(cycle.idle.hostRequests)} 个接口请求：${cycle.idle.paths.join('、')}`)
  }
  if (input.consoleProblems.length > 0) problems.push(`控制台报错 ${String(input.consoleProblems.length)} 条：${input.consoleProblems.slice(0, 3).map((entry) => `${entry.source} ${entry.text}`).join('；')}`)
  return problems
}

/**
 * 跑一轮测量。
 *
 * @param options - 视口与各段窗口的时长。
 * @returns 这一轮的报告。
 */
async function measure(options) {
  const host = await start({ home: scratchHome('perf-') })
  const browser = await launchBrowser({ headless: true })
  try {
    const context = await newContextOn(browser, { width: options.width, height: options.height })
    const page = await context.newPage()
    const origin = new URL(host.url).origin
    const requests = []
    const failures = []
    const responses = []
    const problems = []
    let phase = 'startup'
    page.on('request', (request) => {
      requests.push({ phase, at: Date.now(), url: request.url(), kind: classify(request.url(), origin), type: request.resourceType() })
    })
    page.on('response', (response) => {
      if (response.status() >= 400) responses.push({ phase, at: Date.now(), url: response.url(), kind: classify(response.url(), origin), status: response.status() })
    })
    page.on('requestfailed', (request) => {
      failures.push({ phase, at: Date.now(), url: request.url(), kind: classify(request.url(), origin), error: request.failure()?.errorText ?? 'unknown' })
    })
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') problems.push({ source: 'console', text: scrub(message.text()) })
    })
    page.on('pageerror', (error) => problems.push({ source: 'pageerror', text: scrub(error.message) }))
    await page.addInitScript(() => {
      window.__perfLongTasks = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__perfLongTasks.push(entry.duration)
      }).observe({ entryTypes: ['longtask'] })
    })

    const cdp = await context.newCDPSession(page)
    await page.goto(host.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector(PANEL_ICON, { timeout: 120000 })
    await dismissOverlays(page)

    // 运行成本卡只在组件画廊里：加一张，用它同时读页面与宿主两侧的读数。
    const metricsCard = await addInstance(page, 'system-metrics')
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await hostStats(page)) !== null) break
      await sleep(1000)
    }
    const before = { heap: await pageHeap(cdp), host: await hostStats(page) }

    const cycles = []
    let boardRequests = []
    for (let cycle = 1; cycle <= options.cycles; cycle += 1) {
      const requestsAtStart = requests.length
      await page.evaluate(() => {
        window.__perfLongTasks = []
      })
      phase = `cycle-${String(cycle)}`
      const mount = await openBoard(page, 40000)
      const opened = { heap: await pageHeap(cdp), host: await hostStats(page) }
      const tasks = await page.evaluate(() => window.__perfLongTasks.slice())
      const left = await leaveBoard(page, 10000)
      const settledMs = await waitForQuiet(requests, options.settleMs, options.quietMs)
      const drainStart = requests.length
      await sleep(options.drainMs)
      const drain = requests.slice(drainStart)
      const idleStart = requests.length
      await sleep(options.idleMs)
      const idle = requests.slice(idleStart)
      const closed = { heap: await pageHeap(cdp), host: await hostStats(page) }
      if (cycle === 1) boardRequests = requests.slice(requestsAtStart)
      cycles.push({
        cycle,
        mountMs: mount.ms,
        cards: mount.cards,
        titles: mount.titles,
        longTasks: {
          count: tasks.length,
          totalMs: Math.round(tasks.reduce((sum, value) => sum + value, 0)),
          maxMs: tasks.length === 0 ? 0 : Math.round(Math.max(...tasks)),
        },
        opened: {
          pageHeapMiB: mib(opened.heap.usedBytes),
          hostRssMiB: mib(opened.host?.rss),
          hostHeapMiB: mib(opened.host?.heapUsed),
        },
        left: {
          detached: left.detached,
          frames: left.frames,
          pageHeapMiB: mib(closed.heap.usedBytes),
          hostRssMiB: mib(closed.host?.rss),
          hostHeapMiB: mib(closed.host?.heapUsed),
        },
        settle: { settledMs, drainMs: options.drainMs, drainHostRequests: drain.filter((entry) => entry.kind === 'host-api').length },
        idle: {
          ms: options.idleMs,
          hostRequests: idle.filter((entry) => entry.kind === 'host-api').length,
          otherRequests: idle.filter((entry) => entry.kind !== 'host-api').length,
          paths: idle.filter((entry) => entry.kind === 'host-api').map((entry) => safePath(entry.url)),
        },
      })
    }

    const hostFailures = responses.filter((entry) => entry.kind === 'host-api')
    // 切视图时旧卡片会主动中止还在加载的 document，这类中止不是缺陷。
    const hostFailedRequests = failures.filter((entry) => entry.kind === 'host-api' && !entry.error.includes('ERR_ABORTED'))
    const boardApi = boardRequests.filter((entry) => entry.kind === 'host-api')
    const problemsFound = judge({ cycles, hostResponses: hostFailures, failedRequests: hostFailedRequests, consoleProblems: problems })

    return {
      at: new Date().toISOString(),
      commit: commit(),
      environment: {
        node: process.version,
        chrome: browser.version(),
        viewport: `${String(options.width)}x${String(options.height)}`,
        host: host.url.replace(/([?&]token=)[^\s&]+/g, '$1<redacted>'),
      },
      metricsCard,
      before: { pageHeapMiB: mib(before.heap.usedBytes), pageHeapTotalMiB: mib(before.heap.totalBytes), hostRssMiB: mib(before.host?.rss), hostHeapMiB: mib(before.host?.heapUsed) },
      cycles,
      requests: {
        total: requests.length,
        byKind: ['host-api', 'host-asset', 'external', 'inline'].map((kind) => ({ kind, count: requests.filter((entry) => entry.kind === kind).length })),
        boardApi: boardApi.length,
        boardApiPaths: [...new Set(boardApi.map((entry) => safePath(entry.url)))],
      },
      samples: {
        hostFailures: hostFailures.map((entry) => ({ phase: entry.phase, path: safePath(entry.url), status: entry.status })),
        hostAbortedDocuments: failures.filter((entry) => entry.kind === 'host-api' && entry.error.includes('ERR_ABORTED')).length,
        externalFailures: failures.filter((entry) => entry.kind === 'external').length,
        console: problems,
      },
      verdict: { ok: problemsFound.length === 0, problems: problemsFound },
    }
  } finally {
    await browser.close().catch(() => {})
    host.stop()
  }
}

/** 打一行摘要。 */
function summarize(report) {
  const mounts = report.cycles.map((cycle) => `${String(cycle.mountMs)} 毫秒`)
  const idle = report.cycles.map((cycle) => `${String(cycle.idle.hostRequests)} 请求/${String(cycle.left.frames)} 卡片`)
  const rss = report.cycles.map((cycle) => `${String(cycle.opened.hostRssMiB)}→${String(cycle.left.hostRssMiB)} MiB`)
  console.log(`挂载：${mounts.join('、')}（${String(report.cycles[0]?.cards ?? 0)} 张卡）；`
    + `首轮打开→离开期间的接口 ${String(report.requests.boardApi)} 次；`
    + `离开空闲：${idle.join('、')}；宿主内存：${rss.join('、')}；`
    + `${report.verdict.ok ? '通过' : `问题：${report.verdict.problems.join('；')}`}`)
}

/** 命令行入口。 */
async function main() {
  const options = {
    cycles: option('--cycles', 3),
    settleMs: option('--settle', 10000),
    quietMs: option('--quiet', 1000),
    drainMs: option('--drain', 2000),
    idleMs: option('--window', 3000),
    width: option('--width', 1440),
    height: option('--height', 900),
  }
  await mkdir(OUT, { recursive: true })
  const report = await measure(options)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(OUT, `perf-${stamp}.json`)
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`)
  summarize(report)
  if (!report.verdict.ok) process.exitCode = 1
}

module.exports = { classify, judge, mib, safePath, scrub }

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
