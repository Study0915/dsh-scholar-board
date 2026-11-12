/*
 * 天气卡的脚本：窗外是一幅画，卡片是它前面的一层玻璃。
 *
 * 数据来自 manifest 的 `request.url`：宿主请求 Open-Meteo，把原始响应推来，这里映射成五天预报。
 * 画面由两份同目录的脚本画：`world.js` 画窗外的景，`glass.js` 画玻璃上的雨雪与水珠。这一份只管
 * 卡片的文字、预报栏、选中哪一天，以及什么时候重画、什么时候停下。
 *
 * 组件与外界只有 `window.widget` 这条路（D7）。动效跟随宿主的动画档位与暂停状态（D10、D16）：
 * 减弱动效时只留一帧静止的雨窗，卡片离开视口就停下，不再逐帧重画。
 */
;(function () {
  var card = document.querySelector('.wx')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  var canvas = card.querySelector('[data-role="scene"]')

  /** 默认地点；与 widget.json 里 props schema 的默认值一致。 */
  var DEFAULT_PLACE = { zh: '北京', en: 'Beijing' }

  /** 卡片能放下的预报天数。 */
  var SLOTS = 5

  /** 画布最大像素比：1.5 已经够细，卡片小、同时开的卡多时省下近一半像素。 */
  var MAX_DPR = 1.5

  /** 手动刷新用的宿主能力；manifest 声明了它，宿主解析得到时才有重试按钮。 */
  var REFRESH_CAPABILITY = 'widget-board:data.refresh'

  /** 数据层：WMO 映射、归一与状态判定在 weather-data.js 里，挂在全局 WeatherData 上。 */
  var dataLayer = window.WeatherData

  /** 画面原语：图标、逐位数字、文字切换与药丸落位在 weather-view.js 里。 */
  var viewLayer = window.WeatherView

  var el = {
    big: card.querySelector('.wx-big'),
    place: card.querySelector('#wx-place'),
    day: card.querySelector('#wx-day'),
    temp: card.querySelector('#wx-temp'),
    cond: card.querySelector('#wx-cond'),
    hi: card.querySelector('#wx-hi'),
    lo: card.querySelector('#wx-lo'),
    panel: card.querySelector('#wx-panel'),
    bar: card.querySelector('.t-tabs'),
    pill: card.querySelector('.t-tabs-pill'),
    phase: card.querySelector('#wx-phase'),
    tabs: Array.prototype.slice.call(card.querySelectorAll('.t-tab')),
    icons: Array.prototype.slice.call(card.querySelectorAll('.wx-big .t-icon')),
    status: card.querySelector('[data-role="status"]'),
    statusText: card.querySelector('[data-role="status-text"]'),
    retry: card.querySelector('[data-role="retry"]')
  }

  var days = []
  var place = DEFAULT_PLACE
  var current = 0
  /** 宿主存下来的那一天；数据还没到时先记着。 */
  var wanted = -1
  var loadTimer = 0
  /** 上次成功拿到数据的本机时刻；宿主存一份，重启后据此判过期。 */
  var fetchedAt = null
  /** 最近一次手动刷新的失败原因；成功后清掉。 */
  var lastFailure = null
  /** 重试在途：按钮不可再按，状态条写「正在重试」。 */
  var refreshing = false
  /** 从没拿到过数据、且已经等过头。 */
  var unavailable = false
  /** 这一帧的天空、昼夜与天光阶段，来自当前选中的那天。 */
  var sky = { scene: 'cloudy', night: false, phase: window.WxDaylight.localPhase() }
  /** 世界那层画布：每换一次天重画一次。 */
  var world = null
  var worldCanvas = null
  var skyLayer = null
  var groundLayer = null
  var clouds = []
  var hidden = false
  var frameHandle = 0
  var lastStamp = 0
  var clock = 0
  var flashAt = -1e9
  var metrics = { w: 0, h: 0, dpr: 1 }
  /** 数据里那一刻的当地钟点，以及读到它时的本机时间。 */
  var clockBase = { minutes: sky.phase.minutes, at: Date.now() }

  var rand = function (a, b) { return a + Math.random() * (b - a) }

  function zh() { return String(widget ? widget.lang : root.lang || 'en').indexOf('zh') === 0 }
  function pick(pair) { return pair ? (zh() ? pair.zh : pair.en) : '' }
  function reduced() { return root.getAttribute('data-motion') === 'reduced' }
  /** 宿主的配色是不是深的；只认 `data-scheme`，不认卡片自己写上去的文字色。 */
  function dark() { return card.dataset.scheme === 'dark' }

  /** 从宿主递进来的 `--w-color-bg` 判断深浅；系统配色只作兜底。 */
  function hostIsDark() {
    var value = getComputedStyle(root).getPropertyValue('--w-color-bg').trim()
    var red
    var green
    var blue
    var hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    var rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
    if (hex) {
      var digits = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1]
      red = parseInt(digits.slice(0, 2), 16) / 255
      green = parseInt(digits.slice(2, 4), 16) / 255
      blue = parseInt(digits.slice(4, 6), 16) / 255
    } else if (rgb) {
      red = Number(rgb[1]) / 255
      green = Number(rgb[2]) / 255
      blue = Number(rgb[3]) / 255
    }
    if (red !== undefined) return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 0.42
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  function t(key, fallback) { return widget ? widget.t(key) : fallback }

  /** 卡片所在地此刻的钟点：数据里那一刻加上卡片已经开了多久。 */
  function currentClock() {
    return (clockBase.minutes + Math.floor((Date.now() - clockBase.at) / 60000)) % 1440
  }

  // ── 画布 ───────────────────────────────────────────────

  /** 一块按像素比放大、坐标仍按 CSS 像素算的画布。 */
  function surface(node, w, h, dpr) {
    node.width = Math.max(1, Math.round(w * dpr))
    node.height = Math.max(1, Math.round(h * dpr))
    var ctx = node.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }

  /** 造一块离屏画布，交给 `world.js` 与 `glass.js` 用。 */
  function make(w, h, dpr) {
    var node = document.createElement('canvas')
    return { canvas: node, ctx: surface(node, w, h, dpr === undefined ? 1 : dpr) }
  }

  var glass = window.WxGlass.createGlass({ make: make, rand: rand })

  /** 按当前盒子与天空重建世界与玻璃。 */
  function rebuild() {
    var box = canvas.getBoundingClientRect()
    var w = Math.max(1, Math.round(box.width || card.clientWidth || 320))
    var h = Math.max(1, Math.round(box.height || card.clientHeight || 220))
    var dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    metrics = { w: w, h: h, dpr: dpr }
    surface(canvas, w, h, dpr)

    // 天与地面分两层：云要飘在城市后面，城市就得叠在云之上。
    skyLayer = make(w, h, dpr)
    window.WxWorld.paintSky(skyLayer.ctx, w, h, sky.scene, sky.night, dark(), sky.phase.key)
    groundLayer = make(w, h, dpr)
    window.WxWorld.paintGround(groundLayer.ctx, w, h, sky.night)
    world = make(w, h, dpr)
    world.ctx.drawImage(skyLayer.canvas, 0, 0, w, h)
    world.ctx.drawImage(groundLayer.canvas, 0, 0, w, h)
    worldCanvas = world.canvas
    glass.rebuild(w, h, dpr, sky.scene, sky.night, skyLayer.canvas, groundLayer.canvas, worldCanvas)

    // 云：晴天与多云是几朵会飘的积云，阴雨雪天是一层柔云。
    var tone = window.WxWorld.cloudTone(sky.scene, sky.night, dark(), sky.phase.key)
    var warm = !sky.night && (sky.phase.key === 'dawn' || sky.phase.key === 'golden' || sky.phase.key === 'dusk')
    var dry = sky.scene === 'clear' || sky.scene === 'cloudy'
    var counts = dry
      ? (sky.scene === 'clear' ? 3 : 4)
      : ({ overcast: 7, rain: 6, storm: 7, snow: 5 }[sky.scene] || 4)
    var speeds = dry
      ? (sky.scene === 'clear' ? [2, 5] : [3, 7])
      : ({ overcast: [3, 7], rain: [3, 6], storm: [4, 9], snow: [1.5, 4] }[sky.scene] || [2, 5])
    clouds = []
    // 日月的位置：飘动的云也按它的方向受光，云和日月的明暗才是一套
    var bodySpots = { dawn: [0.3, 0.35], day: [0.74, 0.22], golden: [0.64, 0.3], dusk: [0.66, 0.4] }
    var bodySpot = sky.night ? [0.76, 0.24] : (bodySpots[sky.phase.key] || bodySpots.day)
    var bodyX = w * bodySpot[0]
    var bodyY = h * bodySpot[1]
    for (var c = 0; c < counts; c += 1) {
      var size = h * (dry ? rand(0.2, 0.34) : rand(0.26, 0.48))
      var cloudX = rand(-w * 0.3, w * 1.1)
      var cloudY = h * rand(dry ? 0.03 : 0.03, dry ? 0.2 : 0.34)
      var vx = bodyX - cloudX
      var vy = bodyY - cloudY
      var len = Math.max(1, Math.sqrt(vx * vx + vy * vy))
      clouds.push({
        sprite: dry
          ? window.WxWorld.cumulusSprite(function (cw, ch) { return make(cw, ch, 1) }, size, tone, 200 + c * 13, { x: vx / len, y: vy / len })
          : window.WxWorld.cloudSprite(function (s) { return make(s, s, 1) }, h * rand(0.13, 0.24), sky.night ? 'rgba(150,175,205,A)' : warm ? 'rgba(255,220,190,A)' : 'rgba(255,255,255,A)'),
        x: cloudX,
        y: cloudY,
        speed: rand(speeds[0], speeds[1]),
        scale: dry ? rand(0.85, 1.15) : rand(0.7, 1.3),
        alpha: dry ? rand(0.7, 0.9) : rand(0.3, 0.5)
      })
    }
  }

  /** 画一帧：窗外的景、飘过的云、远处的雨丝、玻璃上的水珠与雪，最后压一层颗粒。 */
  function paint() {
    if (worldCanvas === null) return
    var ctx = canvas.getContext('2d')
    var w = metrics.w
    var h = metrics.h
    var scene = sky.scene
    ctx.clearRect(0, 0, w, h)
    // 顺序就是它们的远近：天在最里，星与云在它前面，城市挡住云，水珠与雪落在玻璃上最外。
    var dry = scene === 'clear' || scene === 'cloudy'
    glass.paintBackdrop(ctx, dry)

    // 夜里才有的星：逐帧画，慢慢闪。
    if (sky.night) {
      var starAlpha = scene === 'clear' ? 1 : scene === 'cloudy' ? 0.45 : scene === 'snow' ? 0.3 : 0.15
      window.WxWorld.paintStars(ctx, w, h, clock, starAlpha)
    }

    for (var c = 0; c < clouds.length; c += 1) {
      var cloud = clouds[c]
      var span = cloud.sprite.width * cloud.scale
      var x = ((cloud.x + clock * cloud.speed + span) % (w + span * 2)) - span
      ctx.globalAlpha = cloud.alpha
      ctx.drawImage(cloud.sprite, x, cloud.y, span, cloud.sprite.height * cloud.scale)
    }
    ctx.globalAlpha = 1

    glass.paintGround(ctx, dry)

    // 远处落下的雨丝：玻璃上看不清细节，只留一层斜线
    if (scene === 'rain' || scene === 'storm') {
      var count = scene === 'storm' ? 46 : 30
      var seed = window.WxWorld.seeded(919)
      ctx.strokeStyle = scene === 'storm' ? 'rgba(206,226,246,0.3)' : 'rgba(214,232,248,0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (var s = 0; s < count; s += 1) {
        var sx = seed() * w
        var speed = 220 + seed() * 260
        var sy = (seed() * h + clock * speed) % (h + 40) - 20
        var length = 10 + seed() * 16
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx - length * 0.14, sy + length)
      }
      ctx.stroke()
    }

    glass.paint(ctx, scene, reduced() ? 40 : 18)

    // 雷：一亮一暗再补一下，像真的落雷
    if (scene === 'storm') {
      var since = clock - flashAt
      if (since >= 0 && since < 0.34) {
        var power = since < 0.05 ? 0.62 : since < 0.1 ? 0.1 : since < 0.18 ? 0.48 : since < 0.24 ? 0.08 : 0.22
        ctx.fillStyle = 'rgba(226,240,255,' + power.toFixed(3) + ')'
        ctx.fillRect(0, 0, w, h)
      }
    }
  }

  /** 逐帧推进；暂停、减弱动效或不可见时停下。 */
  function loop(stamp) {
    frameHandle = 0
    if (hidden) return
    var dt = lastStamp === 0 ? 1 / 60 : Math.min(0.05, (stamp - lastStamp) / 1000)
    lastStamp = stamp
    clock += dt
    // 落雷隔两三秒一次，比之前密得多
    if (sky.scene === 'storm' && clock >= flashAt + 0.34) flashAt = clock + 2.2 + rand(0, 2.6)
    glass.advance(dt, sky.scene)
    paint()
    frameHandle = window.requestAnimationFrame(loop)
  }

  function start() {
    if (frameHandle !== 0 || hidden) return
    lastStamp = 0
    frameHandle = window.requestAnimationFrame(loop)
  }

  function stop() {
    if (frameHandle === 0) return
    window.cancelAnimationFrame(frameHandle)
    frameHandle = 0
  }

  /** 换一片天空：重画世界、重建贴图，再决定要不要继续动。 */
  function adoptSky(scene, night, phase) {
    var nextPhase = phase || window.WxDaylight.localPhase()
    var changed = scene !== sky.scene || night !== sky.night || nextPhase.key !== sky.phase.key || worldCanvas === null
    sky = { scene: scene, night: night, phase: nextPhase }
    card.dataset.scene = scene
    card.dataset.phase = nextPhase.key
    applyTextTheme()
    if (changed) {
      clock = 0
      // 切到雷暴天时，第一声雷在将近一秒后落下
      flashAt = 0.8
      rebuild()
    }
    paint()
    if (reduced()) stop()
    else start()
  }

  // ── 卡片的结构与交互 ───────────────────────────────────

  /** 卡片上的地点：props 给了双语名字就用它，否则用默认地点。 */
  function placeOf(props) {
    var value = props && props.place
    if (value && typeof value.zh === 'string' && typeof value.en === 'string') return value
    return DEFAULT_PLACE
  }

  /** 药丸对到选中的那一格；动画与逐位数字在 weather-view.js 里。 */
  function moveTo(tab, animate) {
    viewLayer.moveTo(el.pill, tab, animate)
  }

  /** 数据还没到时的卡片：地点与结构在，读数留白，切换栏不能按。 */
  function paintEmpty() {
    el.place.textContent = pick(place)
    el.day.textContent = '—'
    el.phase.textContent = ''
    delete el.day.dataset.text
    el.cond.textContent = t('loading', 'Fetching weather')
    el.temp.textContent = '--'
    el.hi.textContent = '--'
    el.lo.textContent = '--'
    el.tabs.forEach(function (tab, index) {
      viewLayer.tabIcon(tab, 'cloud')
      tab.querySelector('.wx-tab-day').textContent = '—'
      tab.querySelector('.wx-tab-temp').textContent = '--'
      tab.disabled = true
      tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false')
      tab.setAttribute('tabindex', index === 0 ? '0' : '-1')
    })
    el.panel.setAttribute('aria-labelledby', el.tabs[0].id)
    moveTo(el.tabs[0], false)
    adoptSky('cloudy', false, window.WxDaylight.localPhase())
  }

  /** 数据还没到、请求也没回来：把等待换成一句可见的原因，状态条给出重试。 */
  function showUnavailable() {
    if (days.length > 0) return
    unavailable = true
    el.cond.textContent = t('unavailable', 'Weather unavailable')
    updateStatus()
  }

  /** 把第 i 天画到卡上；`instant` 用于首帧与语言切换。 */
  function paintDay(i, instant) {
    var day = days[i]
    if (day === undefined) {
      paintEmpty()
      return
    }
    el.big.setAttribute('data-state', day.icon)
    el.icons.forEach(function (icon) {
      icon.toggleAttribute('data-active', icon.dataset.key === day.icon)
    })
    el.place.textContent = pick(place)
    viewLayer.morphText(el.day, pick(day.name), instant, reduced())
    el.phase.textContent = pick(day.phase.label)
    viewLayer.swapText(el.cond, pick(day.condition), instant, reduced())
    viewLayer.setDigits(el.temp, day.temp, instant, reduced())
    viewLayer.setDigits(el.hi, day.high, instant, reduced())
    viewLayer.setDigits(el.lo, day.low, instant, reduced())
    el.tabs.forEach(function (tab, index) {
      var entry = days[index]
      if (entry !== undefined) viewLayer.tabIcon(tab, entry.icon)
      tab.disabled = entry === undefined
      tab.querySelector('.wx-tab-day').textContent = entry === undefined ? '—' : pick(entry.short)
      tab.querySelector('.wx-tab-temp').textContent = entry === undefined ? '--' : entry.mean + '°'
      tab.setAttribute('aria-selected', index === i ? 'true' : 'false')
      tab.setAttribute('tabindex', index === i ? '0' : '-1')
    })
    el.panel.setAttribute('aria-labelledby', el.tabs[i].id)
    moveTo(el.tabs[i], instant !== true)
    adoptSky(day.sky, day.night, day.phase)
  }

  /** 选中第 i 天；`quiet` 用于从宿主存下的状态恢复，不再回头写一次。 */
  function select(i, focus, quiet) {
    if (days.length === 0 || i === current || i < 0 || i >= days.length || i >= el.tabs.length) return
    current = i
    paintDay(i, false)
    if (focus) el.tabs[i].focus()
    if (quiet !== true && widget) widget.setState({ day: i })
  }

  el.tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { select(index, false) })
  })
  el.bar.addEventListener('keydown', function (event) {
    if (days.length === 0) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      select((current + 1) % days.length, true)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      select((current - 1 + days.length) % days.length, true)
    }
  })

  /** 宿主推来的原始 Open-Meteo 数据换成卡片自己的五天预报。 */
  function adoptData(data) {
    var parsed = dataLayer.daysFrom(data, { slots: SLOTS, tabs: el.tabs.length, daylight: window.WxDaylight })
    if (parsed === null) return false
    days = parsed.days
    clockBase = { minutes: parsed.clockMinutes, at: Date.now() }
    fetchedAt = Date.now()
    lastFailure = null
    unavailable = false
    if (widget) widget.setState({ fetchedAt: fetchedAt })
    place = placeOf(widget ? widget.props : {})
    clearTimeout(loadTimer)
    if (current >= days.length) current = 0
    paintDay(current, true)
    // 数据先到、状态后到：状态里选中的那一天盖回来。
    if (wanted >= 0) select(wanted, false, true)
    updateStatus()
    return true
  }

  /** 刷新间隔：与 widget.json 的 ``refresh.everyMs`` 一致，另留半小时余量判过期。 */
  var REFRESH_MS = 18000000

  /** 一个时刻读成卡片语言的时分。 */
  function timeText(stamp) {
    if (typeof stamp !== 'number') return ''
    try {
      return new Intl.DateTimeFormat(zh() ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(stamp))
    } catch (error) {
      return ''
    }
  }

  /** 刷新能力在不在：manifest 声明了、宿主也解析得到时才有重试按钮（D11）。 */
  function canRetry() {
    return widget !== undefined && typeof widget.call === 'function' && Array.isArray(widget.capabilities) &&
      widget.capabilities.indexOf(REFRESH_CAPABILITY) !== -1
  }

  /** 状态条：正常写更新时刻，过期与失败写原因，加载中留空。 */
  function updateStatus() {
    if (el.status === null || el.statusText === null || el.retry === null) return
    var state = dataLayer.statusOf({
      hasData: days.length > 0,
      fetchedAt: fetchedAt,
      failed: lastFailure !== null || unavailable,
      now: Date.now(),
      refreshMs: REFRESH_MS
    })
    var text = ''
    var tone = 'ok'
    if (state === 'ok') {
      var stamp = timeText(fetchedAt)
      text = stamp === '' ? t('updated', 'Updated') : t('updatedAt', 'Updated') + ' ' + stamp
    } else if (state === 'stale') {
      text = t('stale', 'Weather data may be out of date')
      tone = 'warn'
    } else if (state === 'failed-stale') {
      text = t('refreshFailed', 'Update failed') + (lastFailure ? '：' + lastFailure : '') + ' · ' + t('showingLast', 'Showing the last data')
      tone = 'warn'
    } else if (state === 'failed-empty') {
      text = t('unavailable', 'Weather unavailable') + (lastFailure ? '：' + lastFailure : '')
      tone = 'error'
    }
    el.status.hidden = text === ''
    el.status.dataset.tone = tone
    el.statusText.textContent = text
    el.retry.hidden = !(canRetry() && state !== 'loading')
    el.retry.disabled = refreshing
    el.retry.textContent = refreshing ? t('retrying', 'Retrying…') : t('retry', 'Retry')
  }

  /** 手动刷新：读一次卡片自己的源并写回；失败把原因留在状态条，旧数据不动。 */
  function retry() {
    if (!canRetry() || refreshing) return
    refreshing = true
    updateStatus()
    widget.call(REFRESH_CAPABILITY).then(function (data) {
      refreshing = false
      lastFailure = null
      if (!adoptData(data)) updateStatus()
    }, function (error) {
      refreshing = false
      lastFailure = error !== null && error !== undefined && typeof error.message === 'string' && error.message !== ''
        ? error.message
        : String(error)
      updateStatus()
    })
  }

  /**
   * 文字用深色还是浅色。
   *
   * 看两件事：宿主的配色，与这一帧的天。深色主题或画里的夜晚都用浅色字；浅色主题的白天用深色字。
   * 夜里即使是浅色主题，窗外也是暗的，白字才读得清。
   *
   * 写到 `data-theme` 上，`dark()` 读的是 `data-scheme`：两者分开，否则这里写下去的值会被当成
   * 宿主的配色读回来，画过的天就换不回来了。
   */
  function applyTextTheme() {
    // 黎明/暮色即使已过地平线，画面上仍有暖光，按宿主配色选字色；真到夜深才强制浅色字。
    var twilight = (sky.phase.key === 'dawn' || sky.phase.key === 'dusk') && sky.phase.sunAlt > -4
    card.dataset.theme = dark() || (sky.night && !twilight) ? 'dark' : 'light'
  }

  /** 宿主的配色变了：窗外那幅画与文字色都要重画。 */
  function watchScheme() {
    var previous = card.dataset.scheme
    card.dataset.scheme = hostIsDark() ? 'dark' : 'light'
    applyTextTheme()
    if (card.dataset.scheme === previous || worldCanvas === null) return
    rebuild()
    paint()
  }

  /** 每两分钟看一次：太阳走过阶段线，或又走了半度，就把天色推过去。 */
  function refreshPhase() {
    if (days.length === 0 || hidden) return
    var day = days[current]
    if (!day || typeof day.sunrise !== 'number') return
    var next = window.WxDaylight.phaseFor(currentClock(), day.sunrise, day.sunset)
    if (day.phase && next.key === day.phase.key && Math.abs(next.sunAlt - day.phase.sunAlt) < 0.6) return
    day.phase = next
    day.night = next.night
    paintDay(current, true)
  }
  window.setInterval(refreshPhase, 120000)

  if (widget) {
    widget.onSize(function () {
      rebuild()
      paint()
      if (days.length === 0) paintEmpty()
    })
    widget.onProps(function (props) {
      place = placeOf(props)
      if (days.length === 0) el.place.textContent = pick(place)
      else paintDay(current, true)
    })
    widget.onData(function (data) { adoptData(data) })
    widget.onState(function (value) {
      if (value && typeof value.fetchedAt === 'number') {
        fetchedAt = value.fetchedAt
        updateStatus()
      }
      if (!value || typeof value.day !== 'number') return
      wanted = value.day
      select(wanted, false, true)
    })
    widget.onPause(function (paused) {
      hidden = paused
      if (paused) stop()
      else if (!reduced()) start()
    })
  }

  watchScheme()
  var scheme = window.matchMedia('(prefers-color-scheme: dark)')
  if (typeof scheme.addEventListener === 'function') scheme.addEventListener('change', watchScheme)
  // 宿主换主题时只重写根节点上的 --w-*；观察它，比等系统配色变化准。
  if (typeof MutationObserver === 'function') {
    new MutationObserver(watchScheme).observe(root, { attributes: true, attributeFilter: ['style'] })
  }

  // 盒子由看板拖动改变，画布跟着换尺寸。
  if (typeof ResizeObserver === 'function') {
    var watching = false
    new ResizeObserver(function () {
      if (watching || hidden) return
      watching = true
      window.requestAnimationFrame(function () {
        watching = false
        if (hidden) return
        rebuild()
        paint()
      })
    }).observe(canvas)
  }

  place = placeOf(widget ? widget.props : {})
  if (widget && widget.state && typeof widget.state.fetchedAt === 'number') fetchedAt = widget.state.fetchedAt
  if (el.retry !== null) el.retry.addEventListener('click', retry)
  // 数据可能在本脚本注册监听之前就到了；先读一次当前值。
  if (widget && widget.data) adoptData(widget.data)
  else paintEmpty()
  loadTimer = window.setTimeout(showUnavailable, 15000)
  updateStatus()
  window.requestAnimationFrame(function () { moveTo(el.tabs[current], false) })
  window.addEventListener('resize', function () {
    moveTo(el.tabs[current], false)
    rebuild()
    paint()
  })
})()
