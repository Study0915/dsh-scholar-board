'use strict'
/** 客户端写入要读完真实响应，避免长时间交互耗尽浏览器请求资源（D13）。 */
const { buildSync } = require('esbuild')
const path = require('node:path')

async function responsePass(page, check) {
  const root = path.resolve(__dirname, '../..')
  const script = buildSync({
    stdin: { contents: 'export { saveInstanceState } from "./packages/client/src/snapshot"', resolveDir: root },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: '__dshResponseProbe',
  }).outputFiles[0].text
  await page.addScriptTag({ content: script })
  const result = await page.evaluate(async () => {
    const snapshot = await (await fetch('api/widget-board/boards')).json()
    const instance = snapshot.boards[0].instances[0]
    const original = window.fetch
    let saved
    // 观察真实 fetch 的响应，不替换网络或宿主行为。
    window.fetch = async (...args) => {
      const response = await original(...args)
      if (String(args[0]).endsWith(`/${instance.id}/state`)) saved = response
      return response
    }
    try {
      await window.__dshResponseProbe.saveInstanceState(instance.id, {})
      const result = { status: saved.status, bodyUsed: saved.bodyUsed }
      if (!saved.bodyUsed) await saved.arrayBuffer()
      return result
    } finally {
      window.fetch = original
      window.__dshResponseProbe = undefined
    }
  })
  check('客户端状态写入读完真实响应体', result.status === 200 && result.bodyUsed, JSON.stringify(result))
}

module.exports = { responsePass }
