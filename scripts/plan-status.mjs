#!/usr/bin/env node
/**
 * plan-status.mjs — 读 PLAN-scholar 的任务表，给出每项是否完成，以及相对某个提交新完成了哪些。
 *
 * 发布管线的触发点是「完成一项计划任务」：工作流把上一个发布标签与最新提交里的任务表比一遍，
 * 只在有任务从「未实施」变成完成时进入打包。任务完成的唯一依据是任务表的状态列，不从提交标题、
 * 时间或文件改动推断；表里没写的任务一律算未完成。
 *
 * 用法：node scripts/plan-status.mjs [--ref <提交或标签>] [--new-since <提交或标签>]
 *       默认输出 `{ tasks, completed }`；`--new-since` 另外给出基线里未完成、当前已完成的编号。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PLAN = 'docs/PLAN-scholar.md'

/**
 * 任务表的文字：工作区里的那份，或某个提交里的那份。
 *
 * @param ref - 提交、标签或分支；省略时读工作区。
 * @returns PLAN-scholar.md 的内容。
 */
function planText(ref) {
  if (ref === undefined) return fs.readFileSync(path.join(ROOT, PLAN), 'utf8')
  return execFileSync('git', ['show', `${ref}:${PLAN}`], { cwd: ROOT, encoding: 'utf8' })
}

/**
 * 一项任务是否完成：状态列写着已实现、已交付或完成，且没有写未实施、未完成。
 *
 * @param status - 状态列的文字。
 * @returns 完成时为 true。
 */
function isComplete(status) {
  return /已实现|已交付|已完成|完成/.test(status) && !/未实施|未完成/.test(status)
}

/**
 * 任务表里的每一行。只读「任务与批次」一节；表头、当前状态表与规格列里的 `Sxx` 都不算任务。
 *
 * @param text - PLAN-scholar.md 的内容。
 * @returns `{ id, status, complete }` 的数组，按表里的次序。
 */
function tasksOf(text) {
  const tasks = []
  let inside = false
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      inside = line.startsWith('## 任务与批次')
      continue
    }
    if (!inside || !line.startsWith('|')) continue
    const cells = line.split('|').map((cell) => cell.trim())
    const id = cells[1]?.match(/^[A-E]?\s*·?\s*(S\d{2})$/)?.[1]
    if (id === undefined) continue
    const status = cells[4] ?? ''
    tasks.push({ id, status, complete: isComplete(status) })
  }
  return tasks
}

const refAt = process.argv.indexOf('--ref')
const sinceAt = process.argv.indexOf('--new-since')
const ref = refAt === -1 ? undefined : process.argv[refAt + 1]
const since = sinceAt === -1 ? undefined : process.argv[sinceAt + 1]
if (refAt !== -1 && ref === undefined) throw new Error('plan-status: --ref 需要一个提交或标签')
if (sinceAt !== -1 && since === undefined) throw new Error('plan-status: --new-since 需要一个提交或标签')

const tasks = tasksOf(planText(ref))
const completed = tasks.filter((task) => task.complete).map((task) => task.id)

if (since === undefined) {
  console.log(JSON.stringify({ tasks, completed }, null, 2))
} else {
  let baseline = []
  try {
    baseline = tasksOf(planText(since)).filter((task) => task.complete).map((task) => task.id)
  } catch (error) {
    // 基线标签还不存在时按「一项都没完成」比较；这是第一次发布，不是读取失败。
    if (!/unknown revision|unknown commit|bad revision|Not a valid object name/i.test(String(error.stderr ?? error.message))) throw error
  }
  const newlyCompleted = completed.filter((id) => !baseline.includes(id))
  console.log(JSON.stringify({ newlyCompleted, completed, baseline }, null, 2))
}
