#!/usr/bin/env node
'use strict'
/**
 * weather.cjs — 天气卡的测试辅助：等温度画上、出事时读请求日志。
 *
 * 两条路都用同一份判定：夹具数据与真实网络都只看卡片有没有画出数字；失败时把宿主的请求日志
 * 原样交给调用方，不在测试里猜原因。
 */

/**
 * 等天气卡把温度画成一个数字。
 *
 * @param frame - 天气卡的 frame。
 * @param timeout - 上限，毫秒。
 * @returns 等到了没有。
 */
async function weatherPainted(frame, timeout = 20000) {
  return await frame.waitForFunction(
    () => /^-?\d+$/.test(document.querySelector('#wx-temp')?.textContent ?? ''),
    undefined,
    { timeout },
  ).then(() => true, () => false)
}

/**
 * 读天气卡当前的请求日志与数据。
 *
 * @param page - 宿主页面。
 * @returns 卡片的数据状态与请求日志；找不到卡片时是 `{ missing: true }`。
 */
async function weatherDiagnostic(page) {
  return await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    const board = snapshot.boards.find((entry) => entry.id === snapshot.active)
    const card = board?.instances.find((entry) => entry.widget === 'weather')
    if (!card) return { missing: true }
    const log = await (await fetch('api/widget-board/instance/' + encodeURIComponent(card.id) + '/log')).json()
    return { source: card.source, hasData: card.data != null, log }
  })
}

module.exports = { weatherPainted, weatherDiagnostic }
