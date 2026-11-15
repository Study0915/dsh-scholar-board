/**
 * 本机平台能力（S16）：只看两件事——`process.platform` 怎么收成四种平台，以及回给卡片的到底有哪些
 * 字段。设备标签由人在卡片设置里起名，宿主这边不能捎带主机名、用户名或路径。
 */
import { describe, expect, it } from 'vitest'
import os from 'node:os'
import type { InstanceFace } from '@dsh-scholar-board/contracts'
import { MATERIALS_DEVICE_CAPABILITY, devicePlatformOf, materialsDeviceCapability } from '../src/literature/device'

const FACE: InstanceFace = { id: 'card', widget: 'literature-records', props: {} }

describe('平台换算', () => {
  it('三种认识的系统原样留下，其余都算 other', () => {
    expect(devicePlatformOf('win32')).toBe('win32')
    expect(devicePlatformOf('darwin')).toBe('darwin')
    expect(devicePlatformOf('linux')).toBe('linux')
    expect(devicePlatformOf('freebsd')).toBe('other')
    expect(devicePlatformOf('aix')).toBe('other')
    expect(devicePlatformOf('')).toBe('other')
  })
})

describe('本机平台能力', () => {
  it('回的就是宿主平台，只有 status 与 platform 两项', async () => {
    const value = await materialsDeviceCapability('darwin').call(FACE, {}, new AbortController().signal)
    expect(value).toEqual({ status: 'ready', platform: 'darwin' })
    expect(Object.keys(value).sort()).toEqual(['platform', 'status'])
  })

  it('不认识平台时照实说 other，不猜也不回主机名', async () => {
    const value = await materialsDeviceCapability('sunos').call(FACE, {}, new AbortController().signal)
    expect(value).toEqual({ status: 'ready', platform: 'other' })
    // 主机名、用户名、路径都不该出现；这里按内存里能拿到的值粗查一遍。
    const text = JSON.stringify(value)
    expect(text).not.toContain('hostname')
    expect(text.toLowerCase()).not.toContain(os.hostname().toLowerCase())
    expect(text).not.toContain(os.userInfo().username)
    expect(text).not.toContain(os.homedir())
  })

  it('能力名与提供方固定，只读平台不另要授权', () => {
    const capability = materialsDeviceCapability('linux')
    expect(capability.id).toBe(MATERIALS_DEVICE_CAPABILITY)
    expect(capability.provider).toBe('widget-board')
    expect(capability.permission).toBeUndefined()
    expect(capability.credentials).toBeUndefined()
    expect(capability.output).toMatchObject({ required: ['status', 'platform'] })
  })
})