/*
 * 天气卡的纯数据层：WMO 代码映射、Open-Meteo 数据归一、日期辅助与「数据是否新鲜」的判定。
 *
 * 不碰 DOM，也不发请求；挂在全局 WeatherData 上，主脚本与单元测试读同一份实现。
 * 归一结果里每一天已经带好图标、天空、昼夜与阶段，主脚本只负责画。
 */
;(function (root) {
  'use strict'

  /** WMO 天气代码到图标、天空与文字；晴天的夜里在主脚本里换月亮。 */
  var WEATHER = {
    0: ['sun', 'clear', '晴', 'Clear'],
    1: ['sun', 'clear', '大部晴朗', 'Mostly clear'],
    2: ['cloud', 'cloudy', '多云', 'Partly cloudy'],
    3: ['cloud', 'overcast', '阴', 'Overcast'],
    45: ['cloud', 'overcast', '雾', 'Fog'],
    48: ['cloud', 'overcast', '雾凇', 'Rime fog'],
    51: ['rain', 'rain', '毛毛雨', 'Drizzle'],
    53: ['rain', 'rain', '毛毛雨', 'Drizzle'],
    55: ['rain', 'rain', '浓毛毛雨', 'Dense drizzle'],
    56: ['rain', 'rain', '冻毛毛雨', 'Freezing drizzle'],
    57: ['rain', 'rain', '冻毛毛雨', 'Freezing drizzle'],
    61: ['rain', 'rain', '小雨', 'Light rain'],
    63: ['rain', 'rain', '中雨', 'Rain'],
    65: ['rain', 'rain', '大雨', 'Heavy rain'],
    66: ['rain', 'rain', '冻雨', 'Freezing rain'],
    67: ['rain', 'rain', '冻雨', 'Freezing rain'],
    71: ['snow', 'snow', '小雪', 'Light snow'],
    73: ['snow', 'snow', '中雪', 'Snow'],
    75: ['snow', 'snow', '大雪', 'Heavy snow'],
    77: ['snow', 'snow', '雪粒', 'Snow grains'],
    80: ['rain', 'rain', '阵雨', 'Rain showers'],
    81: ['rain', 'rain', '阵雨', 'Rain showers'],
    82: ['rain', 'rain', '强阵雨', 'Violent rain showers'],
    85: ['snow', 'snow', '阵雪', 'Snow showers'],
    86: ['snow', 'snow', '阵雪', 'Snow showers'],
    95: ['bolt', 'storm', '雷暴', 'Thunderstorm'],
    96: ['bolt', 'storm', '雷暴伴冰雹', 'Thunderstorm with hail'],
    99: ['bolt', 'storm', '雷暴伴冰雹', 'Thunderstorm with hail']
  }

  /** 一条天气代码对应的图标、天空与文字；晴天的夜里换成月亮。 */
  function describe(code, night) {
    var entry = WEATHER[code] || WEATHER[3]
    var icon = night && entry[0] === 'sun' ? 'moon' : entry[0]
    return { icon: icon, sky: entry[1], zh: entry[2], en: entry[3] }
  }

  /** 把 `YYYY-MM-DD` 读成本地当天中午，避免时区把日期挪一天。 */
  function dayOf(iso) {
    var parts = String(iso).split('-')
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12)
    return isNaN(date.getTime()) ? new Date() : date
  }

  /** 预报所在地今天的日期；`daily.time` 是地点当地的日期。 */
  function todayAt(zone) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    } catch (error) {
      return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    }
  }

  function longDate(date, locale) {
    return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(date)
  }

  function weekday(date, locale, style) {
    return new Intl.DateTimeFormat(locale, { weekday: style }).format(date)
  }

  /**
   * 把宿主推来的原始 Open-Meteo 数据换成卡片自己的几天预报。
   *
   * @param {unknown} data - 数据源读到的原始响应。
   * @param {{ slots: number, tabs: number, daylight: object }} options - 卡片能放几天、切换栏几格与昼夜工具。
   * @returns {{ days: object[], clockMinutes: number } | null} 归一结果；数据不可用时是 null。
   */
  function daysFrom(data, options) {
    if (!data || !data.daily || !Array.isArray(data.daily.time)) return null
    var daylight = options.daylight
    var daily = data.daily
    var currentReading = data.current || {}
    // 缓存的响应可能已经跨过地点的零点：丢掉过去的日子，从今天起算；全是过去的日子时原样显示。
    var today = todayAt(typeof data.timezone === 'string' ? data.timezone : '')
    var first = 0
    while (first < daily.time.length && String(daily.time[first]) < today) first += 1
    if (first >= daily.time.length) first = 0
    var count = Math.min(daily.time.length - first, options.slots, options.tabs)
    if (count === 0) return null
    var baseClock = daylight.clockFromIso(currentReading.time)
    if (baseClock === null) baseClock = currentReading.is_day === 0 ? 22 * 60 : 12 * 60
    var sunriseList = Array.isArray(daily.sunrise) ? daily.sunrise : []
    var sunsetList = Array.isArray(daily.sunset) ? daily.sunset : []
    var days = []
    for (var n = 0; n < count; n += 1) {
      var i = first + n
      var high = daily.temperature_2m_max[i]
      var low = daily.temperature_2m_min[i]
      if (typeof high !== 'number' || typeof low !== 'number') return null
      var mean = daily.temperature_2m_mean[i]
      var isToday = String(daily.time[i]) === today
      var code = isToday && typeof currentReading.weather_code === 'number' ? currentReading.weather_code : daily.weather_code[i]
      var sunrise = daylight.parseClock(sunriseList[i], 6 * 60 + 20)
      var sunset = daylight.parseClock(sunsetList[i], 18 * 60 + 20)
      var phase = daylight.phaseFor(baseClock, sunrise, sunset)
      var night = phase.night
      var weather = describe(code, night)
      var date = dayOf(daily.time[i])
      var temp = isToday && typeof currentReading.temperature_2m === 'number'
        ? Math.round(currentReading.temperature_2m)
        : Math.round(typeof mean === 'number' ? mean : (high + low) / 2)
      days.push({
        name: { zh: longDate(date, 'zh-CN'), en: longDate(date, 'en-US') },
        short: isToday ? { zh: '今天', en: 'Today' } : { zh: weekday(date, 'zh-CN', 'short'), en: weekday(date, 'en-US', 'short') },
        mean: Math.round(typeof mean === 'number' ? mean : (high + low) / 2),
        code: code,
        icon: weather.icon,
        sky: weather.sky,
        night: night,
        phase: phase,
        sunrise: sunrise,
        sunset: sunset,
        condition: { zh: weather.zh, en: weather.en },
        temp: temp,
        high: Math.round(high),
        low: Math.round(low)
      })
    }
    return { days: days, clockMinutes: baseClock }
  }

  /**
   * 卡片该显示哪一种数据状态。
   *
   * @param {{ hasData: boolean, fetchedAt?: number|null, failed?: boolean, now?: number, refreshMs?: number }} input - 当前事实。
   * @returns {string} `loading`、`ok`、`stale`、`failed-stale` 或 `failed-empty`。
   */
  function statusOf(input) {
    var hasData = input.hasData === true
    var failed = input.failed === true
    if (!hasData) return failed ? 'failed-empty' : 'loading'
    if (failed) return 'failed-stale'
    var fetchedAt = typeof input.fetchedAt === 'number' ? input.fetchedAt : null
    var refreshMs = typeof input.refreshMs === 'number' ? input.refreshMs : 0
    var now = typeof input.now === 'number' ? input.now : Date.now()
    // 刷新间隔之外再留半小时余量：一次定时读取的延迟不该立刻被说成过期。
    if (fetchedAt !== null && refreshMs > 0 && now - fetchedAt > refreshMs + 30 * 60 * 1000) return 'stale'
    return 'ok'
  }

  root.WeatherData = {
    WEATHER: WEATHER,
    describe: describe,
    dayOf: dayOf,
    todayAt: todayAt,
    longDate: longDate,
    weekday: weekday,
    daysFrom: daysFrom,
    statusOf: statusOf
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
