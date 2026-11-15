/**
 * 外部元数据里的作者列表：Crossref 与 Zotero 的条目形状不同，收名字的骨架一样。
 *
 * 两边都只留读得出名字的条目、跳过空项，超过上限就停；名字怎么拼由各自的取名字函数决定。
 */

/**
 * 把外来作者数组收成署名列表。
 *
 * @param value - 条目里的作者字段。
 * @param nameOf - 从一条记录取名字；取不到时返回空串。
 * @param limit - 最多保留几个。
 * @returns 去空白后的署名。
 */
export function collectAuthors(
  value: unknown,
  nameOf: (entry: Record<string, unknown>) => string,
  limit: number,
): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const name = nameOf(entry as Record<string, unknown>)
    if (name !== '') names.push(name)
    if (names.length >= limit) break
  }
  return names
}