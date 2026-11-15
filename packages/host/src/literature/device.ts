/**
 * 材料所在的设备（S16）：把宿主自己的平台告诉文献卡，用来发现跨设备失效的本地路径。
 *
 * 本地材料的路径只在某一台机器上成立。卡片记下材料来自哪台设备，换一台机器打开时就能提示「这条
 * 路径不在本机」，并让人先把路径复制走、在新设备上重新定位。宿主只报平台，不报主机名、用户名或
 * 任何路径——设备标签由用户在卡片设置里自己起名。
 */
import type { CapabilityRegistration, InstanceFace } from '@dsh-scholar-board/contracts'
import { WIDGET_BOARD_API_VERSION } from '@dsh-scholar-board/contracts'

/** 能力的名字；组件 manifest 用它声明。 */
export const MATERIALS_DEVICE_CAPABILITY = 'materials.device'

/** 当前宿主的平台；只报这三种与「其它」，不含主机名。 */
export type DevicePlatform = 'win32' | 'darwin' | 'linux' | 'other'

/** 一次读的结果。 */
export interface MaterialsDevice {
  status: 'ready'
  platform: DevicePlatform
}

/** 能力返回值的 schema。 */
const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'platform'],
  properties: {
    status: { const: 'ready' },
    platform: { enum: ['win32', 'darwin', 'linux', 'other'] },
  },
} as const

/**
 * 把 `process.platform` 收成四种平台之一。
 *
 * @param platform - `process.platform` 的值。
 * @returns 宿主认识的平台名。
 */
export function devicePlatformOf(platform: string): DevicePlatform {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : 'other'
}

/**
 * 建出设备能力。
 *
 * @param platform - 宿主平台；测试里换成别的值。
 * @returns 能力注册项。
 */
export function materialsDeviceCapability(platform: string = process.platform): CapabilityRegistration {
  const value: MaterialsDevice = { status: 'ready', platform: devicePlatformOf(platform) }
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: 'widget-board',
    id: MATERIALS_DEVICE_CAPABILITY,
    title: { zh: '本机平台', en: 'This machine' },
    description: {
      zh: '告诉卡片当前宿主在哪一种系统上运行，用来提示本地材料是否属于另一台设备；不含主机名与用户名。',
      en: 'Tells the card which OS this host runs on so local materials from another machine can be flagged; no hostname or user name is sent.',
    },
    output: OUTPUT,
    // 只读宿主平台，不碰个人数据：不另要授权。
    async call(_instance: InstanceFace): Promise<MaterialsDevice> {
      return value
    },
  }
}