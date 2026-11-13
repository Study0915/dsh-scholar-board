#!/usr/bin/env node
/**
 * privacy-check.mjs — 推送公共仓库前的隐私与身份检查。
 *
 * 扫描待推送提交的整棵树、提交说明和提交身份；通用模式之外，私有词表只从
 * `PRIVACY_FORBIDDEN` 或 `.debug/privacy.local.json` 读取，绝不写进仓库。
 *
 * 用法：
 *   node scripts/privacy-check.mjs --self-test
 *   node scripts/privacy-check.mjs --tree [ref]
 *   node scripts/privacy-check.mjs --staged
 *   node scripts/privacy-check.mjs --pre-push [--require-private] <remote-url>
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEBUG = path.join(ROOT, '.debug')
const ZEROS = /^0+$/
const ALLOWED_IDENTITY = 'Study0915'
const NOREPLY = /@users\.noreply\.github\.com$/i
const ALLOWED_REPOS = new Set([
  'https://github.com/Study0915/dsh-scholar-board',
  'git@github.com:Study0915/dsh-scholar-board',
  'ssh://git@github.com/Study0915/dsh-scholar-board',
  'https://github.com/Study0915/dsh-widget-board',
  'git@github.com:Study0915/dsh-widget-board',
  'ssh://git@github.com/Study0915/dsh-widget-board',
])
const ALLOWED_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'localhost', 'invalid'])
const ALLOWED_HOMES = new Set(['widgets', 'market-widgets', 'runner', 'ubuntu', 'node', 'user', 'vscode', 'codespace', 'cloud'])
const ALLOWED_PHONES = new Set(['13800138000', '13900139000'])
const SYNTHETIC_VALUES = new Set([['C:', 'escape.js'].join('/')])
const SKIP_SEGMENTS = new Set(['.git', '.debug', 'node_modules', 'lib', 'vendor'])
const IMAGE = /\.(?:png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|woff2?|ttf|otf|mp4|mov|wasm)$/i
const SENSITIVE_FILE = /(?:^|\/)(?:\.env(?:\..*)?|\.credentials[^/]*|id_rsa|id_ed25519)$|\.(?:pem|p12|pfx|key)$/i
const RULES = {
  windowsUserPath: /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`<>]+/i,
  windowsLocalPath: /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]+(?!Windows(?:[\\/]|$)|Program Files(?: \(x86\))?(?:[\\/]|$)|ProgramData(?:[\\/]|$)|Users(?:[\\/]|$))[A-Za-z0-9_.-]+/i,
  macHome: /(?:^|[^A-Za-z0-9])\/Users\/[A-Za-z0-9._-]+\//,
  linuxHome: /(?:^|[^A-Za-z0-9])\/home\/([A-Za-z0-9._-]+)\//g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  mobile: /(^|[^0-9A-Za-z])(1[3-9][0-9]{9})(?=[^0-9A-Za-z]|$)/g,
  credential: /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/,
}
const USAGE = `用法：
  node scripts/privacy-check.mjs --self-test
  node scripts/privacy-check.mjs --tree [ref]
  node scripts/privacy-check.mjs --staged
  node scripts/privacy-check.mjs --pre-push [--require-private] <remote-url>`

const normalize = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase()

function runGit(root, args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  return result
}

function gitText(root, args) {
  const result = runGit(root, args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(result.stderr ?? '').trim()}`)
  return result.stdout
}

function normalizeRemote(url) {
  return url.trim().replace(/\/+$/, '').replace(/\.git$/i, '')
}

function targetAllowed(url) {
  return ALLOWED_REPOS.has(normalizeRemote(url))
}

function allowedEmail(email) {
  const value = email.toLowerCase()
  if (value === 'git@github.com') return true
  if (NOREPLY.test(value)) return true
  const domain = value.split('@').pop()
  return ALLOWED_EMAIL_DOMAINS.has(domain) || /\.(?:example|test|invalid)$/i.test(domain)
}

function loadPrivateTerms({ requirePrivate }) {
  const terms = []
  const allow = []
  if (process.env.PRIVACY_FORBIDDEN) terms.push(...process.env.PRIVACY_FORBIDDEN.split(/\r?\n|[,，]/))
  const file = process.env.PRIVACY_CONFIG || path.join(ROOT, '.debug', 'privacy.local.json')
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed.forbidden)) throw new Error(`${file} 的 forbidden 必须是数组`)
    terms.push(...parsed.forbidden)
    if (Array.isArray(parsed.allow)) allow.push(...parsed.allow)
  }
  const cleaned = (values) => [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
  if (requirePrivate && cleaned(terms).length === 0) {
    throw new Error('未配置隐私词表：请设置 PRIVACY_FORBIDDEN，或写入 .debug/privacy.local.json')
  }
  return { terms: cleaned(terms), allow: cleaned(allow) }
}

function checkPath(file, terms) {
  const findings = []
  if (SENSITIVE_FILE.test(file) && !/\.env\.(?:example|sample|template)$/i.test(file)) {
    findings.push({ file, line: 0, rule: 'sensitive-file' })
  }
  const normalized = normalize(file)
  for (const term of terms) {
    if (normalized.includes(normalize(term))) findings.push({ file, line: 0, rule: 'private-term' })
  }
  return findings
}

function scanText(text, file, terms, allow) {
  const findings = []
  const allowSet = new Set([...allow, ...SYNTHETIC_VALUES].map(normalize))
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '')
    const add = (rule) => findings.push({ file, line: index + 1, rule })
    const userPath = line.match(RULES.windowsUserPath)
    if (userPath !== null && !allowSet.has(normalize(userPath[0]))) add('windows-user-path')
    const localPath = line.match(RULES.windowsLocalPath)
    if (localPath !== null && !allowSet.has(normalize(localPath[0]))) add('windows-local-path')
    const macHome = line.match(RULES.macHome)
    if (macHome !== null && !allowSet.has(normalize(macHome[0]))) add('mac-home')
    for (const match of line.matchAll(RULES.linuxHome)) {
      if (!ALLOWED_HOMES.has(match[1]) && !allowSet.has(normalize(match[0]))) add('linux-home')
    }
    for (const match of line.matchAll(RULES.email)) {
      if (!allowedEmail(match[0]) && !allowSet.has(normalize(match[0]))) add('email')
    }
    for (const match of line.matchAll(RULES.mobile)) {
      if (!ALLOWED_PHONES.has(match[2]) && !allowSet.has(normalize(match[0])) && !allowSet.has(normalize(match[2]))) add('cn-mobile')
    }
    if (RULES.credential.test(line)) add('credential')
    const normalized = normalize(line)
    for (const term of terms) {
      if (normalized.includes(normalize(term))) add('private-term')
    }
  }
  return findings
}

function skipContent(file) {
  if (file.split('/').some((part) => SKIP_SEGMENTS.has(part))) return true
  if (/(?:^|\/)(?:package-lock\.json|[^/]*\.lock)$/.test(file)) return true
  return IMAGE.test(file)
}

function scanTree(root, ref, terms, allow) {
  const files = gitText(root, ['ls-tree', '-r', '-z', '--name-only', ref]).split('\0').filter(Boolean)
  const findings = []
  for (const file of files) {
    findings.push(...checkPath(file, terms))
    if (skipContent(file)) continue
    const result = runGit(root, ['show', `${ref}:${file}`])
    if (result.status !== 0) throw new Error(`读不到 ${ref}:${file}`)
    const bytes = result.stdout
    if (bytes.includes(0)) continue
    findings.push(...scanText(bytes.toString('utf8'), file, terms, allow))
  }
  return dedupe(findings)
}

function scanCommit(root, commit, terms, allow) {
  const label = `<commit ${commit.slice(0, 12)}>`
  const meta = gitText(root, ['log', '-1', '--format=%an%n%ae%n%cn%n%ce%n%B', commit])
  const [authorName, authorEmail, committerName, committerEmail, ...message] = meta.split('\n')
  const findings = []
  if (authorName !== ALLOWED_IDENTITY || !NOREPLY.test(authorEmail)) findings.push({ file: label, line: 0, rule: 'commit-author' })
  if (committerName !== ALLOWED_IDENTITY || !NOREPLY.test(committerEmail)) findings.push({ file: label, line: 0, rule: 'commit-committer' })
  findings.push(...scanText(message.join('\n'), label, terms, allow))
  return findings
}

function scanStaged(root, terms, allow) {
  const files = gitText(root, ['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean)
  const findings = []
  const images = []
  for (const file of files) {
    findings.push(...checkPath(file, terms))
    if (skipContent(file)) {
      if (IMAGE.test(file)) images.push(file)
      continue
    }
    const result = runGit(root, ['show', `:${file}`])
    if (result.status !== 0) throw new Error(`读不到暂存区里的 ${file}`)
    const bytes = result.stdout
    if (bytes.includes(0)) continue
    findings.push(...scanText(bytes.toString('utf8'), file, terms, allow))
  }
  const author = /^Study0915 <([^>]+)>/.exec(gitText(root, ['var', 'GIT_AUTHOR_IDENT']))
  const committer = /^Study0915 <([^>]+)>/.exec(gitText(root, ['var', 'GIT_COMMITTER_IDENT']))
  if (author === null || !NOREPLY.test(author[1])) findings.push({ file: '<staged>', line: 0, rule: 'commit-author' })
  if (committer === null || !NOREPLY.test(committer[1])) findings.push({ file: '<staged>', line: 0, rule: 'commit-committer' })
  return { findings: dedupe(findings), images: [...new Set(images)].sort() }
}

function parentOfOldest(root, commits) {
  if (commits.length === 0) return null
  const oldest = commits[commits.length - 1]
  const result = runGit(root, ['rev-parse', '--verify', `${oldest}^`], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function checkPush(root, url, rows, terms, allow) {
  if (!targetAllowed(url)) return { findings: [{ file: '<remote>', line: 0, rule: 'target-repo' }], images: [] }
  const findings = []
  const images = []
  const scanned = new Set()
  for (const row of rows) {
    const parts = row.trim().split(/\s+/)
    if (parts.length !== 4) {
      findings.push({ file: '<ref>', line: 0, rule: 'ref-format' })
      continue
    }
    const [localRef, localSha, , remoteSha] = parts
    if (!/^refs\/heads\//.test(localRef) || ZEROS.test(localSha)) {
      findings.push({ file: '<ref>', line: 0, rule: 'ref-delete' })
      continue
    }
    if (!/^[a-f0-9]{40,64}$/.test(localSha) || !/^[a-f0-9]{40,64}$/.test(remoteSha)) {
      findings.push({ file: '<ref>', line: 0, rule: 'ref-format' })
      continue
    }
    if (!ZEROS.test(remoteSha)) {
      const ancestor = runGit(root, ['merge-base', '--is-ancestor', remoteSha, localSha])
      if (ancestor.status === 1) findings.push({ file: '<ref>', line: 0, rule: 'non-fast-forward' })
      else if (ancestor.status !== 0) findings.push({ file: '<ref>', line: 0, rule: 'unknown-remote-history' })
    }
    if (scanned.has(localSha)) continue
    scanned.add(localSha)
    const commits = gitText(root, ['rev-list', localSha, '--not', '--remotes']).split('\n').filter(Boolean)
    for (const commit of commits) findings.push(...scanCommit(root, commit, terms, allow))
    findings.push(...scanTree(root, localSha, terms, allow))
    const base = ZEROS.test(remoteSha) ? parentOfOldest(root, commits) : remoteSha
    if (base !== null) {
      const changed = gitText(root, ['diff', '--name-only', base, localSha]).split('\n').filter(Boolean)
      for (const file of changed) if (IMAGE.test(file)) images.push(file)
    }
  }
  return { findings: dedupe(findings), images: [...new Set(images)].sort() }
}

function dedupe(findings) {
  const seen = new Set()
  return findings.filter((finding) => {
    const key = `${finding.file}\0${finding.line}\0${finding.rule}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function report(findings, images = []) {
  if (images.length > 0) {
    console.log('警告：本次推送包含图片变更，请人工核对是否含个人信息：')
    for (const image of images) console.log(`  ${image}`)
  }
  if (findings.length === 0) {
    console.log('隐私检查通过。')
    return 0
  }
  console.error(`隐私检查未通过：${findings.length} 处`)
  for (const finding of findings) console.error(`  ${finding.file}:${finding.line} [${finding.rule}]`)
  console.error('修正后重试；不要用 --no-verify 绕过。')
  return 1
}

function selfTest() {
  fs.mkdirSync(DEBUG, { recursive: true })
  const dir = fs.mkdtempSync(path.join(DEBUG, 'privacy-selftest-'))
  if (!dir.startsWith(`${DEBUG}${path.sep}`) || !path.basename(dir).startsWith('privacy-selftest-')) {
    throw new Error(`自测试目录异常：${dir}`)
  }
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(result.stderr ?? '').trim()}`)
    return result.stdout.trim()
  }
  const ancestor = (older, newer) => spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd: dir }).status
  const synthetic = {
    userPath: ['C:', 'Users', 'example-person'].join(String.fromCharCode(92)),
    localPath: ['D:', 'example-data'].join(String.fromCharCode(92)),
    email: ['example-person', 'company.cn'].join('@'),
    phone: ['139', '1234', '5678'].join(''),
    privateTerm: ['Test', 'Person'].join(' '),
  }
  try {
    fs.mkdirSync(path.join(dir, 'empty-hooks'), { recursive: true })
    git(['init', '-q'])
    git(['config', 'user.name', ALLOWED_IDENTITY])
    git(['config', 'user.email', 'Study0915@users.noreply.github.com'])
    git(['config', 'core.hooksPath', 'empty-hooks'])
    fs.writeFileSync(path.join(dir, 'clean.md'), '# clean\n')
    git(['add', '.'])
    git(['commit', '-qm', 'clean'])
    const cleanSha = git(['rev-parse', 'HEAD'])
    fs.writeFileSync(path.join(dir, 'bad.md'), [synthetic.userPath, synthetic.localPath, synthetic.email, synthetic.phone, synthetic.privateTerm].join('\n') + '\n')
    git(['add', '.'])
    git(['commit', '-qm', 'bad'])
    const badSha = git(['rev-parse', 'HEAD'])

    const cleanFindings = scanTree(dir, cleanSha, [], [])
    assert.equal(cleanFindings.length, 0, '干净树不应有命中')
    const badFindings = scanTree(dir, badSha, [synthetic.privateTerm], [])
    for (const rule of ['windows-user-path', 'windows-local-path', 'email', 'cn-mobile', 'private-term']) {
      assert.ok(badFindings.some((finding) => finding.rule === rule), `应命中 ${rule}`)
    }
    assert.ok(!JSON.stringify(badFindings).includes(synthetic.email), '输出不应包含命中的邮箱')
    assert.ok(!JSON.stringify(badFindings).includes(synthetic.phone), '输出不应包含命中的手机号')

    git(['-c', 'user.name=Example', '-c', `user.email=${synthetic.email}`, 'commit', '--allow-empty', '-qm', 'identity'])
    const identityFindings = scanCommit(dir, 'HEAD', [], [])
    assert.ok(identityFindings.some((finding) => finding.rule === 'commit-author'), '应拒绝非 Study0915 作者')
    assert.ok(identityFindings.some((finding) => finding.rule === 'commit-committer'), '应拒绝非 noreply 提交者')

    assert.equal(targetAllowed('https://github.com/Study0915/dsh-scholar-board.git'), true)
    assert.equal(targetAllowed('git@github.com:Study0915/dsh-scholar-board.git'), true)
    assert.equal(targetAllowed('https://github.com/Nwflower/dsh-widget-board.git'), false)
    assert.equal(allowedEmail('git@github.com'), true)
    assert.equal(allowedEmail('Study0915@users.noreply.github.com'), true)
    assert.equal(allowedEmail(synthetic.email), false)
    assert.equal(scanText(SYNTHETIC_VALUES.values().next().value, 'fixture', [], []).length, 0, '合成测试路径应放行')
    const numericHandle = ['lxjs', '153', '3084', '9733', '-max'].join('')
    assert.equal(scanText(numericHandle, 'fixture', [], []).some((finding) => finding.rule === 'cn-mobile'), false, 'GitHub 用户名中的长数字不应当作手机号')
    assert.equal(ancestor(cleanSha, badSha), 0)
    assert.equal(ancestor(badSha, cleanSha), 1)

    const badPush = checkPush(dir, 'https://github.com/Study0915/dsh-scholar-board.git', [`refs/heads/test ${badSha} refs/heads/test ${'0'.repeat(40)}`], [synthetic.privateTerm], [])
    assert.ok(badPush.findings.some((finding) => finding.rule === 'private-term'), 'pre-push 应命中私有词')
    assert.ok(badPush.findings.some((finding) => finding.rule === 'windows-user-path'), 'pre-push 应命中个人路径')
    const cleanPush = checkPush(dir, 'https://github.com/Study0915/dsh-scholar-board.git', [`refs/heads/test ${cleanSha} refs/heads/test ${'0'.repeat(40)}`], [], [])
    assert.equal(cleanPush.findings.length, 0, '干净推送不应有命中')
    const targetPush = checkPush(dir, 'https://github.com/Nwflower/dsh-widget-board.git', [`refs/heads/test ${cleanSha} refs/heads/test ${'0'.repeat(40)}`], [], [])
    assert.ok(targetPush.findings.some((finding) => finding.rule === 'target-repo'), '应拒绝上游仓库')
    const forcePush = checkPush(dir, 'https://github.com/Study0915/dsh-scholar-board.git', [`refs/heads/test ${cleanSha} refs/heads/test ${badSha}`], [], [])
    assert.ok(forcePush.findings.some((finding) => finding.rule === 'non-fast-forward'), '应拒绝强推')
    console.log('隐私检查自测试通过。')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function parseArgs(args) {
  let mode = null
  let ref = 'HEAD'
  let requirePrivate = false
  let remoteUrl = ''
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--self-test') mode = 'self-test'
    else if (arg === '--staged') mode = 'staged'
    else if (arg === '--tree') {
      mode = 'tree'
      if (args[index + 1] !== undefined && !args[index + 1].startsWith('--')) ref = args[++index]
    } else if (arg === '--pre-push') mode = 'pre-push'
    else if (arg === '--require-private') requirePrivate = true
    else if (arg === '--help' || arg === '-h') return { help: true }
    else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`)
    else if (mode === 'pre-push') remoteUrl = arg
    else throw new Error(`多余参数：${arg}`)
  }
  return { mode, ref, requirePrivate, remoteUrl }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  if (options.mode === 'self-test') {
    selfTest()
    return
  }
  if (options.mode === null) {
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  const { terms, allow } = loadPrivateTerms({ requirePrivate: options.requirePrivate })
  let result
  if (options.mode === 'tree') result = { findings: scanTree(ROOT, options.ref, terms, allow), images: [] }
  else if (options.mode === 'staged') result = scanStaged(ROOT, terms, allow)
  else {
    const rows = fs.readFileSync(0, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    if (rows.length === 0) throw new Error('pre-push 没有收到引用')
    result = checkPush(ROOT, options.remoteUrl, rows, terms, allow)
  }
  process.exitCode = report(result.findings, result.images)
}

main()
