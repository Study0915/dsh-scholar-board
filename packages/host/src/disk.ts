/**
 * 宿主自己的磁盘写入（D5、D21）：看板与领域记录共用同一份落盘方式。
 *
 * JSON 先写临时文件再改名，读到一半的内容不会留在磁盘上；写入排队串行，后一次看得到前一次的结果。
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 写一份 JSON：先写临时文件再改名。
 *
 * @param file - 目标路径。
 * @param value - 要写的内容。
 */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/** 串行写入队列：排进去的任务按顺序执行，前一次失败不挡住后一次。 */
export interface WriteQueue {
  /**
   * 排一次写入。
   *
   * @param run - 轮到它时执行的那件事。
   * @returns 那件事的结果。
   */
  <T>(run: () => Promise<T>): Promise<T>
  /** 等当前全部排队的任务落定。 */
  settled(): Promise<void>
}

/**
 * 建一个写入队列。
 *
 * @returns 队列。
 */
export function createWriteQueue(): WriteQueue {
  let writing: Promise<void> = Promise.resolve()
  const queue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = writing.then(run)
    writing = next.then(() => undefined, () => undefined)
    return next
  }
  return Object.assign(queue, {
    settled: async (): Promise<void> => { await writing },
  })
}
