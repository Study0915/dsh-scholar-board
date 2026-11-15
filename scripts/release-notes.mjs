/**
 * 发布说明与 CHANGELOG 的取舍。
 *
 * 打包的版本可能已经作为待发布改动写进 CHANGELOG（发布 PR 先写段、标签在发布时才建），这时再让
 * `changelog.mjs --release` 插一段，会多出一个只有占位说明的空段，发布说明也取到那个空段。这里
 * 把判断独立出来：CHANGELOG 已有这一版就沿用原文，没有才按正常发布收条目。
 */

/**
 * CHANGELOG 里某个版本的段。
 *
 * @param changelog - `CHANGELOG.md` 的内容。
 * @param version - 版本号，例如 `0.5.0`。
 * @returns 段正文（去掉末尾空行）；没有这一段时为 undefined。
 */
export function findSection(changelog, version) {
  const start = changelog.indexOf(`## [${version}] - `)
  if (start === -1) return undefined
  const next = changelog.indexOf('\n## [', start + 1)
  return changelog.slice(start, next === -1 ? undefined : next).trim()
}

/**
 * 这次打包怎么处理 CHANGELOG。
 *
 * @param changelog - `CHANGELOG.md` 的内容。
 * @param version - 这次要打的版本。
 * @param pending - `docs/changes/` 里待发布条目的数量。
 * @returns `reuse` 为 true 时沿用 `section`，不要再改 CHANGELOG；为 false 时按正常发布收条目。
 */
export function releaseNotesPlan(changelog, version, pending) {
  const section = findSection(changelog, version)
  if (section === undefined) return { reuse: false, section: undefined }
  if (pending > 0) {
    throw new Error(`release: CHANGELOG.md 里已经有 ${version} 的段，docs/changes/ 里还有 ${String(pending)} 条待发布条目；先把条目并进那一段，或换一个版本号`)
  }
  return { reuse: true, section }
}