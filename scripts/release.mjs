#!/usr/bin/env node
/**
 * release.mjs — 把当前源码打成可发布的插件包：写版本、收 CHANGELOG、构建、封装 tarball 与发布说明。
 *
 * 版本按用户定的节奏走：minor（1.1、1.2……）是小改进，major（1.0、2.0……）是巨大更新；patch 留给
 * 修缺陷。脚本只准备产物，不推送、不打标签、不创建发布；工作流把产物挂进**草稿** Release，发布
 * 这一步必须由用户手工确认。
 *
 * 用法：node scripts/release.mjs [--version <x.y.z> | --bump minor|major|patch]
 *                               [--date <YYYY-MM-DD>] [--note-zh <一句>] [--note-en <一句>]
 *                               [--out <目录>] [--no-build | --print-version]
 *       默认版本：package.json 的版本还没打标签时发布它，已经打过则升一个 minor。
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import semver from 'semver'

const ROOT = path.resolve(import.meta.dirname, '..')
const PACKAGE = path.join(ROOT, 'package.json')
const LOCK = path.join(ROOT, 'package-lock.json')
const COMPATIBILITY = path.join(ROOT, 'packages', 'contracts', 'src', 'compatibility.ts')
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md')
const CHANGES = path.join(ROOT, 'docs', 'changes')

const argument = (name) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** 跑一条命令，输出照原样打出来；非零退出就是这一步没过。 */
function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options })
}

/**
 * 标签是否已经存在。
 *
 * @param tag - 形如 `v0.5.0`。
 * @returns 存在时为 true。
 */
function tagExists(tag) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * 这次发布用哪个版本。显式给了 `--version` 就用它；否则按当前版本与标签决定是否升一位。
 *
 * @param current - package.json 里的版本。
 * @param wanted - `--version` 的值。
 * @param bump - `--bump` 的值。
 * @returns 合法且尚未打标签的版本。
 */
function releaseVersion(current, wanted, bump) {
  let version
  if (wanted !== undefined) {
    version = wanted
  } else if (bump !== undefined) {
    if (!['minor', 'major', 'patch'].includes(bump)) throw new Error(`release: --bump 只接受 minor、major 或 patch，收到 "${bump}"`)
    version = semver.inc(current, bump)
  } else {
    version = tagExists(`v${current}`) ? semver.inc(current, 'minor') : current
  }
  if (version === null || !semver.valid(version)) throw new Error(`release: 版本号 "${String(version)}" 不合法`)
  if (tagExists(`v${version}`)) throw new Error(`release: 标签 v${version} 已经存在；换一个版本或先确认那次发布`)
  return version
}

/** 把版本写进 package.json 与 package-lock.json（根包的两处），格式与仓库一致。 */
function writePackageVersion(version) {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'))
  pkg.version = version
  fs.writeFileSync(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`)
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
  lock.version = version
  if (lock.packages?.[''] !== undefined) lock.packages[''].version = version
  fs.writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`)
}

/** 兼容表的看板版本跟根 package.json 一起改；市场索引与单元层都对着这两处核对。 */
function writeCompatibility(version) {
  const text = fs.readFileSync(COMPATIBILITY, 'utf8')
  if (!/boardVersion: '[^']*'/.test(text)) throw new Error('release: 没在兼容表里找到 boardVersion')
  fs.writeFileSync(COMPATIBILITY, text.replace(/boardVersion: '[^']*'/, `boardVersion: '${version}'`))
}

/**
 * 待发布条目为空时，用这次发布的一句话补一条，CHANGELOG 与发布说明都不留空段。
 *
 * @param date - 发布日期。
 * @param zh - 中文一句。
 * @param en - 英文一句。
 */
function addNoteFragment(date, zh, en) {
  // 上一次发布把待发布条目清空后，git 里不会留下空目录，全新克隆里 docs/changes/ 并不存在。
  fs.mkdirSync(CHANGES, { recursive: true })
  fs.writeFileSync(path.join(CHANGES, 'release-note.json'), `${JSON.stringify({ at: date, group: 'chores', order: 0, external: false, zh, en }, null, 2)}\n`)
}

/** 文档目录里待发布的条目数。 */
function pendingChanges() {
  if (!fs.existsSync(CHANGES)) return 0
  return fs.readdirSync(CHANGES).filter((name) => /^[a-z0-9][a-z0-9-]*\.json$/.test(name)).length
}

/**
 * CHANGELOG 里这个版本的段，作为发布说明。
 *
 * @param version - 刚发布的版本。
 * @returns Markdown 正文。
 */
function notesOf(version) {
  const text = fs.readFileSync(CHANGELOG, 'utf8')
  const start = text.indexOf(`## [${version}] - `)
  if (start === -1) throw new Error(`release: CHANGELOG.md 里没有 ${version} 的段`)
  const next = text.indexOf('\n## [', start + 1)
  return text.slice(start, next === -1 ? undefined : next).trim()
}

/** 包在 GitHub 上的地址，用来写安装命令。 */
function repositorySlug() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'))
  const match = String(pkg.repository?.url ?? '').match(/github\.com[/:]([^/]+)\/([^/.]+)/)
  if (match === null) throw new Error('release: package.json 的 repository.url 不是 GitHub 地址')
  return `${match[1]}/${match[2]}`
}

const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'))
const version = releaseVersion(pkg.version, argument('--version'), argument('--bump'))
const tag = `v${version}`

if (process.argv.includes('--print-version')) {
  console.log(version)
  process.exit(0)
}

const date = argument('--date') ?? new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('release: --date 要写成 YYYY-MM-DD')
const out = path.resolve(ROOT, argument('--out') ?? '.debug/release')
fs.mkdirSync(out, { recursive: true })

const noteZh = argument('--note-zh')
const noteEn = argument('--note-en')
if (pendingChanges() === 0) {
  if (noteZh === undefined || noteEn === undefined) throw new Error('release: docs/changes/ 里没有待发布条目；用 --note-zh 与 --note-en 说明这次发布')
  addNoteFragment(date, noteZh, noteEn)
}

writePackageVersion(version)
writeCompatibility(version)
run(process.execPath, [path.join(ROOT, 'scripts', 'changelog.mjs'), '--release', version, '--date', date])

if (!process.argv.includes('--no-build')) run(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')])
run('npm', ['pack', '--pack-destination', out])

const tarball = path.join(out, `dsh-scholar-board-${version}.tgz`)
if (!fs.existsSync(tarball)) throw new Error(`release: 没有找到 npm pack 写出的 ${path.basename(tarball)}`)
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n')
for (const required of ['package/package.json', 'package/lib/host/index.js', 'package/cordis.patch.yml']) {
  if (!entries.includes(required)) throw new Error(`release: ${path.basename(tarball)} 里缺 ${required}`)
}

const bytes = fs.readFileSync(tarball)
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
const url = `https://github.com/${repositorySlug()}/releases/download/${tag}/${path.basename(tarball)}`
const notes = `${notesOf(version)}\n\n## 安装 / Install\n\n\`\`\`sh\ndsh plugin --profile web add ${url}\n\`\`\`\n`
fs.writeFileSync(path.join(out, 'notes.md'), notes)
fs.writeFileSync(path.join(out, 'release.json'), `${JSON.stringify({ version, tag, tarball: path.basename(tarball), sha256, bytes: bytes.byteLength, notes: 'notes.md', url }, null, 2)}\n`)

console.log(`release: ${version} 已准备好 ${path.relative(ROOT, tarball)}（${String(bytes.byteLength)} 字节，sha256 ${sha256}）`)
console.log(`release: 发布说明在 ${path.relative(ROOT, path.join(out, 'notes.md'))}；没有推送、打标签或创建 Release`)
