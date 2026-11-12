/**
 * 天气卡的数据层：WMO 映射、Open-Meteo 归一与数据新鲜度判定。
 *
 * `weather-data.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件。
 */
import { describe, expect, it } from 'vitest'
import '../../widgets/weather/weather-data.js'

interface WeatherDataApi {
  describe(code: unknown, night: boolean): { icon: string, sky: string, zh: string, en: string }
  dayOf(iso: unknown): Date
  todayAt(zone?: string): string
  daysFrom(data: unknown, options: { slots: number, tabs: number, daylight: Daylight }): { days: Array<Record<string, unknown>>, clockMinutes: number } | null
  statusOf(input: { hasData: boolean, fetchedAt?: number | null, failed?: boolean, now?: number, refreshMs?: number }): string
}

interface Daylight {
  clockFromIso(iso: unknown): number | null
  parseClock(iso: unknown, fallback: number): number
  phaseFor(minutes: number, sunrise: number, sunset: number): { key: string, night: boolean, label: { zh: string, en: string }, sunAlt: number, minutes: number }
}

const data = (globalThis as unknown as { WeatherData: WeatherDataApi }).WeatherData

/** 一个只够归一的昼夜工具替身。 */
const daylight: Daylight = {
  clockFromIso: (iso) => typeof iso === 'string' ? 12 * 60 : null,
  parseClock: (iso, fallback) => typeof iso === 'string' ? 6 * 60 : fallback,
  phaseFor: (minutes) => ({ key: 'day', night: false, label: { zh: '白天', en: 'Day' }, sunAlt: 10, minutes }),
}

/** 一份最小的五天预报。 */
function sample(): Record<string, unknown> {
  const today = data.todayAt('Asia/Shanghai')
  const dates = [today, addDays(today, 1), addDays(today, 2), addDays(today, 3), addDays(today, 4)]
  return {
    timezone: 'Asia/Shanghai',
    current: { time: `${today}T12:00`, temperature_2m: 15.4, weather_code: 0, is_day: 1 },
    daily: {
      time: dates,
      weather_code: [0, 2, 61, 71, 95],
      temperature_2m_max: [16, 17, 13, 4, 9],
      temperature_2m_min: [10, 7, 7, 0, 3],
      temperature_2m_mean: [13, 12, 10, 2, 6],
      sunrise: dates.map((date) => `${date}T06:35`),
      sunset: dates.map((date) => `${date}T18:35`),
    },
  }
}

function addDays(date: string, days: number): string {
  const stamp = Date.parse(`${date}T00:00:00.000Z`) + days * 86400000
  return new Date(stamp).toISOString().slice(0, 10)
}

describe('WMO 映射', () => {
  it('晴天白天是太阳，夜里换成月亮；不认识的代码按阴天', () => {
    expect(data.describe(0, false)).toMatchObject({ icon: 'sun', sky: 'clear', zh: '晴' })
    expect(data.describe(0, true)).toMatchObject({ icon: 'moon' })
    expect(data.describe(999, false)).toMatchObject({ icon: 'cloud', sky: 'overcast' })
    expect(data.describe(61, false)).toMatchObject({ icon: 'rain', sky: 'rain' })
  })
})

describe('Open-Meteo 归一', () => {
  it('把五天预报读成卡片用的形状，今天的读数用 current', () => {
    const parsed = data.daysFrom(sample(), { slots: 5, tabs: 5, daylight })
    expect(parsed).not.toBeNull()
    expect(parsed?.clockMinutes).toBe(12 * 60)
    expect(parsed?.days).toHaveLength(5)
    expect(parsed?.days[0]).toMatchObject({ temp: 15, high: 16, low: 10, icon: 'sun' })
    expect(parsed?.days[0]?.short).toEqual({ zh: '今天', en: 'Today' })
    expect(parsed?.days[1]?.condition).toEqual({ zh: '多云', en: 'Partly cloudy' })
  })

  it('条数受切换栏格数与卡片槽位限制', () => {
    expect(data.daysFrom(sample(), { slots: 3, tabs: 5, daylight })?.days).toHaveLength(3)
    expect(data.daysFrom(sample(), { slots: 5, tabs: 2, daylight })?.days).toHaveLength(2)
  })

  it('形状不对时返回 null', () => {
    expect(data.daysFrom(null, { slots: 5, tabs: 5, daylight })).toBeNull()
    expect(data.daysFrom({ daily: { time: [] } }, { slots: 5, tabs: 5, daylight })).toBeNull()
    expect(data.daysFrom({ daily: { time: ['2026-01-01'], temperature_2m_max: ['x'], temperature_2m_min: [1] } }, { slots: 5, tabs: 5, daylight })).toBeNull()
  })
})

describe('数据新鲜度', () => {
  const now = Date.parse('2026-11-12T04:00:00.000Z')
  const refresh = 18000000

  it('没有数据时是加载中，等过头且失败是 failed-empty', () => {
    expect(data.statusOf({ hasData: false, now })).toBe('loading')
    expect(data.statusOf({ hasData: false, failed: true, now })).toBe('failed-empty')
  })

  it('有数据且新鲜是 ok，失败是 failed-stale', () => {
    expect(data.statusOf({ hasData: true, fetchedAt: now - 1000, failed: false, now, refreshMs: refresh })).toBe('ok')
    expect(data.statusOf({ hasData: true, fetchedAt: now - 1000, failed: true, now, refreshMs: refresh })).toBe('failed-stale')
  })

  it('超过刷新间隔加半小时余量才算过期', () => {
    expect(data.statusOf({ hasData: true, fetchedAt: now - refresh - 10 * 60000, now, refreshMs: refresh })).toBe('ok')
    expect(data.statusOf({ hasData: true, fetchedAt: now - refresh - 40 * 60000, now, refreshMs: refresh })).toBe('stale')
    expect(data.statusOf({ hasData: true, fetchedAt: null, now, refreshMs: refresh })).toBe('ok')
  })
})
