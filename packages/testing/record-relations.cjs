#!/usr/bin/env node
'use strict'
/** 统一关联的真实宿主回归，既可由 smoke 调用，也可单独执行。 */
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { openPage, scratchHome, start } = require('./dsh-web.cjs')
const { openBoard } = require('./panel.cjs')
const { addInstance } = require('./board.cjs')
const { frameOf } = require('./frames.cjs')

/** 按实例把卡片滚进视口；卡片离开视口时数据源会退订，列表不会收到新的推送。 */
async function centerInstance(page, id) {
  await page.evaluate((instance) => document.querySelector(`[data-instance="${instance}"]`)?.scrollIntoView({ block: 'center' }), id)
  await page.waitForTimeout(300)
}

/** 走组件已声明的正常能力入口；不直接写 records.json。 */
async function call(page, card, capability, args) {
  return await page.evaluate(async ({ card, capability, args }) => {
    const response = await fetch(`api/widget-board/instance/${encodeURIComponent(card)}/call`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability, args }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(`${response.status} ${body.error ?? 'Capability failed'}`)
    return body.result
  }, { card, capability, args })
}

/** 等真实存储确认，避免拿浏览器里的乐观画面当作保存证据。 */
async function saved(page, card, id, target) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await call(page, card, 'widget-board:records.read', { ids: [id] })
    if (result.records[0]?.related?.some(ref => ref.id === target)) return result.records[0]
    await page.waitForTimeout(100)
  }
  throw new Error('关联未写入宿主')
}

/** 在当前隔离页面完成跨卡片、草稿与所有记录类型的真实操作。 */
async function recordRelationsPass(page, check, options = {}) {
  const before = (await page.evaluate(async () => (await fetch('api/widget-board/boards')).json())).active
  const created = await page.evaluate(async () => {
    const response = await fetch('api/widget-board/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Synthetic relation verification' }) })
    if (!response.ok) throw new Error('创建验证看板失败')
    return await response.json()
  })
  const card = await addInstance(page, 'research-records')
  assert.ok(card)
  await centerInstance(page, card)
  const frame = await frameOf(page, `[data-instance="${card}"] iframe`)
  const create = async record => (await call(page, card, 'widget-board:records.write', { op: 'create', record })).record
  const reference = await create({ kind: 'literature', title: 'Synthetic reference', stage: 'queued' })
  const second = await create({ kind: 'literature', title: 'Synthetic second reference', stage: 'queued' })
  const research = await create({ kind: 'research', title: 'Synthetic analysis', method: 'simulation', metrics: [{ name: 'SNR', value: '10', unit: 'dB' }] })
  await frame.locator(`[data-id="${research.id}"]`).first().click()
  const detail = frame.locator('[data-role="detail"]')
  const picker = detail.locator('.w-record-relations')
  await picker.locator('select').selectOption('literature')
  await picker.getByRole('button', { name: '查找', exact: true }).click()
  await picker.getByLabel('Synthetic reference', { exact: true }).check()
  await detail.locator('[data-field="question"]').fill('Unsaved synthetic question')
  await picker.locator('li').filter({ hasText: 'Synthetic reference' }).getByRole('button', { name: '查看', exact: true }).click()
  const navigator = page.getByRole('dialog', { name: '记录来源详情' })
  try {
    await navigator.getByRole('heading', { name: 'Synthetic reference', exact: true }).waitFor()
  } catch (error) {
    const diagnostics = { navigator: await page.locator('.dsh-scholar-board__record-layer').allTextContents(), picker: await picker.innerText() }
    if (options.screenshots) {
      mkdirSync(options.screenshots, { recursive: true })
      await page.screenshot({ path: join(options.screenshots, 'navigation-failure.png') })
      writeFileSync(join(options.screenshots, 'navigation-failure.json'), JSON.stringify(diagnostics, null, 2))
    }
    console.error(JSON.stringify(diagnostics))
    throw error
  }
  check('没有文献卡片也可打开来源详情', true)
  await navigator.getByRole('button', { name: '关闭', exact: true }).click()
  assert.equal(await detail.locator('[data-field="question"]').inputValue(), 'Unsaved synthetic question')
  check('查看来源和返回保留当前表单输入', true)
  await detail.locator('[data-action="save"]').click()
  await saved(page, card, research.id, reference.id)
  await picker.getByRole('button', { name: 'Synthetic reference', exact: true }).click()
  await navigator.getByRole('button', { name: 'Synthetic analysis', exact: true }).waitFor()
  check('反向引用查到已保存研究记录', true)
  await navigator.getByRole('button', { name: 'Synthetic analysis', exact: true }).click()
  await navigator.getByRole('heading', { name: 'Synthetic analysis', exact: true }).waitFor()
  await navigator.getByRole('button', { name: '返回', exact: true }).click()
  await navigator.getByRole('heading', { name: 'Synthetic reference', exact: true }).waitFor()
  await navigator.press('Escape')
  check('跨来源导航可返回并用键盘关闭', true)
  const archived = await call(page, card, 'widget-board:records.write', { op: 'archive', id: reference.id, expectedRevision: reference.revision })
  await picker.getByRole('button', { name: '查找', exact: true }).click()
  await picker.getByRole('button', { name: 'Synthetic reference · 已归档', exact: true }).waitFor()
  await call(page, card, 'widget-board:records.write', { op: 'trash', id: reference.id, expectedRevision: archived.revision })
  await picker.getByRole('button', { name: '查找', exact: true }).click()
  await picker.getByRole('button', { name: 'Synthetic reference · 回收站', exact: true }).waitFor()
  check('来源归档和回收站分别显示且不移除关联', true)
  const block = async route => {
    const body = route.request().postDataJSON()
    if (body.capability === 'widget-board:records.read' && body.args.ids?.includes(reference.id)) await route.abort()
    else await route.continue()
  }
  await page.route('**/instance/*/call', block)
  await picker.getByRole('button', { name: '查找', exact: true }).click()
  await picker.getByText('来源读取失败，关联仍保留', { exact: true }).waitFor()
  await page.unroute('**/instance/*/call', block)
  await picker.getByRole('button', { name: '查找', exact: true }).click()
  await picker.getByRole('button', { name: 'Synthetic reference · 回收站', exact: true }).waitFor()
  check('读取失败不会伪装来源删除，重试恢复', true)
  if (options.screenshots) {
    mkdirSync(options.screenshots, { recursive: true })
    await page.screenshot({ path: join(options.screenshots, 'relations-light.png') })
  }
  await detail.locator('[data-action="close"]').click()
  const cases = [
    ['meeting-records', { kind: 'meeting', title: 'Synthetic meeting' }],
    ['action-items', { kind: 'action', title: 'Synthetic action', status: 'todo' }],
    ['manuscript-records', { kind: 'manuscript', title: 'Synthetic manuscript', stage: 'idea' }],
    ['literature-records', { kind: 'literature', title: 'Synthetic reading', stage: 'queued' }],
    ['thesis-records', { kind: 'thesis', title: 'Synthetic thesis' }],
    ['project-records', { kind: 'project', title: 'Synthetic project' }],
    ['course-records', { kind: 'course', title: 'Synthetic course', term: { label: 'Synthetic term' } }],
    ['chore-records', { kind: 'chore', title: 'Synthetic chore', category: 'Research', status: 'todo' }],
    ['research-records', { kind: 'research', title: 'Synthetic second analysis', method: 'derivation' }],
  ]
  for (const [widget, data] of cases) {
    const record = await create(data)
    const id = widget === 'research-records' ? card : await addInstance(page, widget)
    await centerInstance(page, id)
    const surface = await frameOf(page, `[data-instance="${id}"] iframe`)
    await surface.locator(`[data-id="${record.id}"]`).first().click()
    const editor = surface.locator('[data-role="detail"]')
    const relations = editor.locator('.w-record-relations')
    await relations.locator('input[type="search"]').fill('Synthetic second reference')
    await relations.getByLabel('Synthetic second reference', { exact: true }).check()
    await editor.locator('[data-action="save"]').click()
    await saved(page, card, record.id, second.id)
    check(`${data.kind} 使用统一选择器并持久保存关联`, true)
    await editor.locator('[data-action="close"]').click()
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await openBoard(page)
  await centerInstance(page, card)
  const restored = await frameOf(page, `[data-instance="${card}"] iframe`)
  await restored.locator(`[data-id="${research.id}"]`).first().click()
  await restored.getByRole('button', { name: 'Synthetic reference · 回收站', exact: true }).waitFor()
  check('刷新后跨类型引用和生命周期标记仍保留', true)
  if (before) await page.evaluate(async id => {
    const response = await fetch(`api/widget-board/boards/${encodeURIComponent(id)}/activate`, { method: 'POST' })
    if (!response.ok) throw new Error('恢复原看板失败')
    await response.text()
  }, before)
  if (before) await page.evaluate(async id => {
    const response = await fetch(`api/widget-board/boards/${encodeURIComponent(id)}/remove`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    })
    if (!response.ok) throw new Error('清理验证看板失败')
    await response.text()
  }, created.id)
  return { research: research.id }
}

module.exports = { recordRelationsPass }

if (require.main === module) {
  const out = join(__dirname, '../../.debug/s10-relations')
  mkdirSync(out, { recursive: true })
  const checks = []
  const check = (name, pass) => { assert.ok(pass, name); checks.push(name); console.log(`PASS ${name}`) }
  ;(async () => {
    const host = await start({ home: scratchHome('relations-') })
    let opened
    try {
      opened = await openPage(host.url, { width: 1440, height: 1000 })
      await openBoard(opened.page)
      await recordRelationsPass(opened.page, check, { screenshots: out })
      writeFileSync(join(out, 'report.json'), JSON.stringify({ checks, passed: true }, null, 2))
    } finally { if (opened) await opened.close(); host.stop() }
  })().catch(error => { console.error(error); process.exitCode = 1 })
}
