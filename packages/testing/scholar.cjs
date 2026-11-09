#!/usr/bin/env node
'use strict'
/**
 * scholar.cjs — 「学术看板」第一次铺出来的内容（D17）。
 *
 * 种子卡画的是清单里写的那份内容：组会汇报组卡两面各是一份 Markdown、学术入口是五条公开导航、项目
 * 里程碑与文献阅读清单是空的骨架。这五张卡的数据源显式解绑，所以它们既不读也不订阅默认源；其余卡片
 * 照旧接上组件声明的默认源。
 *
 * 判据分两层：宿主快照里每个实例的 source，与组件文档里真正画出来的东西。后者才是这条场景要防的——
 * 绑定漏写的时候，卡片照样画得出来，只是画的是别处来的数据。
 *
 * 与看板的打开方式一起使用：页面已经停在看板上时调用，工作区里还有「学术看板」。
 */
const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { frameOf } = require('./frames.cjs')
const { openBoard } = require('./panel.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 学术看板上的五条导航，与种子清单里写的一致。 */
const SCHOLAR_LINKS = [
  'https://arxiv.org',
  'https://arxiv.org/list/eess.SP/recent',
  'https://arxiv.org/list/physics.optics/recent',
  'https://opg.optica.org',
  'https://ieeexplore.ieee.org',
]

/**
 * 切到「学术看板」。
 *
 * @param page - 宿主页面，看板已经打开。
 * @returns 学术看板的快照。
 */
async function openScholar(page) {
  const snapshot = await page.evaluate(async () => (await fetch('api/widget-board/boards')).json())
  const scholar = snapshot.boards.find((board) => board.title === '学术看板')
  if (scholar === undefined) throw new Error(`工作区里没有「学术看板」：${snapshot.boards.map((board) => board.title).join('、')}`)
  await page.evaluate((id) => {
    document.querySelector(`[data-dsh-scholar-board-tab="${id}"]`)?.click()
  }, scholar.id)
  await page.waitForFunction((id) => {
    return document.querySelector(`[data-dsh-scholar-board-tab="${id}"]`)?.getAttribute('aria-selected') === 'true'
  }, scholar.id, { timeout: 10000 })
  await page.waitForSelector('.dsh-scholar-board__flow[data-active="true"] iframe.dsh-scholar-board__frame', { timeout: 30000 })
  // 卡片是各自挂载的：等四类种子卡都完成握手，再去看它们画了什么。
  for (const title of ['Markdown', '链接', '时间线', '列表']) {
    await page.waitForSelector(`.dsh-scholar-board__flow[data-active="true"] iframe.dsh-scholar-board__frame[title="${title}"]`, { timeout: 30000 })
  }
  await sleep(1200)
  return { scholar, snapshot }
}

/**
 * 快照里五张种子卡的数据源：组卡两面、导航、里程碑、清单。
 *
 * @param board - 学术看板的快照。
 * @returns 每一项是 `[组件 id, source]`。
 */
function seedSources(board) {
  return board.instances
    .filter((instance) => instance.widget === 'markdown' || ['links', 'timeline', 'list'].includes(instance.widget))
    .map((instance) => [instance.widget, instance.source])
}

/**
 * 组件 manifest 里声明的默认数据源。
 *
 * @returns 组件 id 到默认源名的表；没声明的组件不在表里。
 */
function declaredSources() {
  const dir = join(__dirname, '..', 'widgets')
  const table = {}
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'widget.json')
    if (!existsSync(file)) continue
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof manifest.source === 'string') table[manifest.id] = manifest.source
  }
  return table
}

/**
 * 核对学术看板的种子内容在真实宿主里画得出来、且没有被默认数据源换掉。
 *
 * @param page - 宿主页面，看板页还没有打开。
 * @param check - 记一条判据的函数。
 */
async function scholarPass(page, check) {
  // 这是第一次启动的原始工作区：别的场景会删掉看板、改布局，所以这条排在它们前面。
  await openBoard(page)
  const { scholar, snapshot } = await openScholar(page)

  // 第一层：五张卡的数据源是空串，全工作区再没有别的卡被解绑。
  check('学术看板的五张种子卡显式解绑数据源', JSON.stringify(seedSources(scholar)) === JSON.stringify([['markdown', ''], ['markdown', ''], ['links', ''], ['timeline', ''], ['list', '']]), JSON.stringify(seedSources(scholar)))
  const unbound = snapshot.boards.flatMap((board) => board.instances.filter((instance) => instance.source === '').map((instance) => `${board.title}/${instance.widget}`))
  check('解绑只落在这五张种子卡上', unbound.length === 5 && unbound.every((label) => ['markdown', 'links', 'timeline', 'list'].includes(label.split('/')[1])), `${unbound.length} 张：${unbound.join(' · ')}`)
  // 种子卡之外，卡片要么不写 source，要么写的正是组件声明的那个默认源。
  const declared = declaredSources()
  const drifted = snapshot.boards.flatMap((board) => board.instances
    .filter((instance) => instance.source !== '')
    .filter((instance) => instance.source !== undefined && instance.source !== declared[instance.widget])
    .map((instance) => `${board.title}/${instance.widget}=${String(instance.source)}`))
  check('没有卡片被改绑到别的数据源', drifted.length === 0, drifted.join(' / ') || '全部照旧')

  // 第二层：组卡两面画的是清单里的那一份 Markdown。
  const group = '[data-dsh-scholar-board-flip-group]'
  await page.waitForSelector(group, { timeout: 10000 })
  const faces = await page.evaluate((selector) => {
    const node = document.querySelector(`.dsh-scholar-board__flow[data-active="true"] [data-instance] ${selector}`)
    const front = node?.querySelector('.dsh-scholar-board__flip-face--front iframe')
    const back = node?.querySelector('.dsh-scholar-board__flip-face--back iframe')
    return { front: front?.getAttribute('title') ?? '', back: back?.getAttribute('title') ?? '' }
  }, group)
  check('组会汇报组卡两面都挂上了 Markdown', faces.front === 'Markdown' && faces.back === 'Markdown', `${faces.front} / ${faces.back}`)

  const frontFrame = await frameOf(page, '.dsh-scholar-board__flow[data-active="true"] .dsh-scholar-board__flip-face--front iframe')
  const frontText = await frontFrame.evaluate(() => ({
    title: document.querySelector('[data-field="title"]')?.textContent ?? '',
    kicker: document.querySelector('[data-field="kicker"]')?.textContent ?? '',
    heading: Array.from(document.querySelectorAll('[data-role="content"] h2')).map((node) => node.textContent ?? ''),
    sample: document.querySelector('[data-role="content"]')?.textContent?.includes('发布前检查') === true,
  }))
  check('组会汇报正面是自己的标题与要点', frontText.title === '组会汇报 · 要点' && frontText.kicker === '本周', `${frontText.title} / ${frontText.kicker}`)
  check('组会汇报正面画的是种子写的三条要点', JSON.stringify(frontText.heading) === JSON.stringify(['本周进展', '下周计划', '需要讨论']), frontText.heading.join(' · '))
  // 组件自带样例里的「发布前检查」是数据源覆盖之后才会出现的那份内容。
  check('组会汇报正面没有换成组件的自带样例', frontText.sample === false)

  await page.locator('.dsh-scholar-board__flow[data-active="true"] [data-dsh-scholar-board-handle="flip"]').first().click()
  await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('data-flipped') === 'true', `.dsh-scholar-board__flow[data-active="true"] [data-instance] ${group}`, { timeout: 10000 })
  await sleep(600)
  const backFrame = await frameOf(page, '.dsh-scholar-board__flow[data-active="true"] .dsh-scholar-board__flip-face--back iframe')
  const backText = await backFrame.evaluate(() => ({
    title: document.querySelector('[data-field="title"]')?.textContent ?? '',
    heading: Array.from(document.querySelectorAll('[data-role="content"] h2')).map((node) => node.textContent ?? ''),
  }))
  check('组会汇报背面是自己那份笔记', backText.title === '组会汇报 · 笔记' && JSON.stringify(backText.heading) === JSON.stringify(['讨论记录', '文献与链接']), `${backText.title} / ${backText.heading.join(' · ')}`)

  // 第三层：学术入口是五条公开导航，不是仓库自身的数据源。
  const linksFrame = await frameOf(page, '.dsh-scholar-board__flow[data-active="true"] iframe[title="链接"]')
  const links = await linksFrame.evaluate(() => ({
    title: document.querySelector('[data-field="title"]')?.textContent ?? '',
    rows: Array.from(document.querySelectorAll('[data-role="rows"] [data-url]')).map((node) => node.dataset.url ?? ''),
    empty: document.querySelector('[data-role="empty"]')?.hidden === false,
  }))
  check('学术入口画的是五条导航', links.title === '学术入口' && links.rows.length === 5, `${links.title} / ${links.rows.length} 条`)
  check('学术入口的地址都是公开站点', JSON.stringify(links.rows) === JSON.stringify(SCHOLAR_LINKS), links.rows.join(' · '))
  check('学术入口没有退回空态或仓库链接', links.empty === false && links.rows.every((url) => !url.includes('127.0.0.1') && !url.includes('github.com/Nwflower')), links.rows.join(' · '))

  // 第四层：里程碑与阅读清单是空骨架，画的不是提交历史与会话列表。
  for (const [title, label] of [['时间线', '项目里程碑'], ['列表', '文献阅读清单']]) {
    const frame = await frameOf(page, `.dsh-scholar-board__flow[data-active="true"] iframe[title="${title}"]`)
    const drawn = await frame.evaluate(() => ({
      title: document.querySelector('[data-field="title"]')?.textContent ?? '',
      empty: document.querySelector('[data-role="empty"]')?.hidden === false,
      label: document.querySelector('[data-role="empty"]')?.textContent ?? '',
      rows: document.querySelectorAll('[data-role="list"] > *').length,
    }))
    check(`${label}是空的骨架`, drawn.title === label && drawn.empty === true && drawn.rows === 0, `${drawn.title} / ${drawn.label} / ${drawn.rows} 行`)
  }

  // 第五层：解绑的卡片不能被按需读拿到数据。宿主按同一份绑定拒绝，说明它没有悄悄接上一个源。
  // 这几发故意被拒：走 Node 侧的请求，不经过页面的 fetch，控制台不会因为这一次检查留下 400。
  const refusals = []
  for (const id of scholar.instances.filter((instance) => instance.source === '').map((instance) => instance.id)) {
    const answer = await page.request.post(new URL(`api/widget-board/instance/${encodeURIComponent(id)}/read`, page.url()).toString(), {
      data: {},
      headers: { 'content-type': 'application/json' },
    })
    refusals.push({ id, status: answer.status(), body: await answer.json() })
  }
  check('解绑的卡片按需读被宿主拒绝', refusals.length === 5 && refusals.every((answer) => answer.status === 400 && String(answer.body.error).includes('没有数据源')), refusals.map((answer) => `${answer.status} ${String(answer.body.error).slice(0, 16)}`).join(' / '))

  // 让读者看的时刻：同一台宿主上有一份会自己变的数据，解绑的卡片不该跟着变。
  const before = await linksFrame.evaluate(() => Array.from(document.querySelectorAll('[data-role="rows"] [data-url]')).map((node) => node.dataset.url ?? ''))
  const refreshed = await page.request.post(new URL('api/widget-board/refresh', page.url()).toString(), {
    data: {},
    headers: { 'content-type': 'application/json' },
  })
  await sleep(1500)
  const after = await linksFrame.evaluate(() => Array.from(document.querySelectorAll('[data-role="rows"] [data-url]')).map((node) => node.dataset.url ?? ''))
  check('宿主刷新工作区之后五个导航原样不动', refreshed.status() === 200 && JSON.stringify(after) === JSON.stringify(before) && after.length === 5, `${refreshed.status()} ${before.length} → ${after.length}`)

  // 同一块看板上还画着别的卡片：刷新没有把它们弄丢，说明这次刷新真的走完了。组卡的两面共用一个盒子，
  // 所以七张卡盒子对应八个实例。
  const alive = await page.evaluate(() => document.querySelectorAll('.dsh-scholar-board__flow[data-active="true"] [data-instance]').length)
  check('刷新之后学术看板的卡片都还在', alive === 7 && scholar.instances.length === 8, `${alive} 个盒子 / ${scholar.instances.length} 个实例`)
}

module.exports = { scholarPass, SCHOLAR_LINKS }
