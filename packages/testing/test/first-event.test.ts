import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const { firstEventOf } = createRequire(import.meta.url)('../first-event.cjs') as { firstEventOf: (response: Response) => Promise<string> }

describe('变更通知首帧', () => {
  const first = 'data: {"revision":1,"event":{"type":"board"}}'
  it('同一读取里有多帧时只判第一帧', async () => {
    expect(await firstEventOf(new Response(`${first}\n\ndata: {"revision":2}\n\n`))).toBe(first)
  })
  it('跨多次读取的首帧要完整拼接并释放流', async () => {
    let cancelled = false
    const bytes = new TextEncoder().encode(`${first}\n\n`)
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10))
        controller.enqueue(bytes.slice(10, -1))
        controller.enqueue(bytes.slice(-1))
      },
      cancel() { cancelled = true },
    }))
    expect(await firstEventOf(response)).toBe(first)
    expect(cancelled).toBe(true)
  })
  it('不完整的帧不能算首帧成功', async () => {
    await expect(firstEventOf(new Response(first))).rejects.toThrow('第一帧完成前结束')
  })
})
