#!/usr/bin/env node
/**
 * weather-online.cjs — 天气卡的真实网络核查（不接入 npm run verify）。
 *
 * 起一个隔离临时宿主，等天气卡从 Open-Meteo 读到并画出温度；随后读这张卡的请求日志，
 * 断言最后一次请求是 200。结果写 .debug/weather-online.json。
 * 本地回归用夹具数据，不依赖这个脚本；这里只记录外部服务此刻是否可达。
 *
 * 用法：node packages/testing/weather-online.cjs
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { join } = require('node:path')
const { openPage, scratchHome, start } = require('./dsh-web.cjs')
const { openBoard } = require('./panel.cjs')
const { settled } = require('./geometry.cjs')
const { frameOf } = require('./frames.cjs')
const { weatherPainted, weatherDiagnostic } = require('./weather.cjs')

async function main() {
  const home = scratchHome('weather-online-')
  const host = await start({ home })
  let opened
  const report = { kind: 'weather-online', at: new Date().toISOString(), home, ok: false }
  try {
    opened = await openPage(host.url, { headless: true, width: 1440, height: 900 })
    const { page } = opened
    await page.waitForSelector('svg.dsh-scholar-board__icon', { timeout: 180000 })
    await openBoard(page)
    await settled(page)
    const weather = await frameOf(page, 'iframe.dsh-scholar-board__frame[title="天气"]')
    const painted = await weatherPainted(weather, 30000)
    const diagnostic = await weatherDiagnostic(page)
    const entries = Array.isArray(diagnostic.log?.entries) ? diagnostic.log.entries : []
    const last = entries.length === 0 ? null : entries[entries.length - 1]
    report.painted = painted
    report.hasData = diagnostic.hasData === true
    report.source = diagnostic.source ?? ''
    report.last = last
    report.ok = painted && last !== null && last.status === 200
  } finally {
    if (opened !== undefined) await opened.close()
    host.stop()
  }
  fs.mkdirSync(join(__dirname, '..', '.debug'), { recursive: true })
  fs.writeFileSync(join(__dirname, '..', '.debug', 'weather-online.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
