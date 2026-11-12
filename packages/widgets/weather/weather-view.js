/*
 * 天气卡的画面原语：切换栏图标、数字逐位、文字切换与变形、药丸落位。
 *
 * 只碰传进来的节点；动画档位由调用方算好传进来（主脚本读根节点的 data-motion）。
 * 挂在全局 WeatherView 上，与主脚本同处一个文档。
 */
;(function (root) {
  'use strict'

  /** 切换栏那一格的小图标路径。 */
  var TAB_PATHS = {
    sun: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
    moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z',
    cloud: 'M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z',
    rain: 'M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z',
    snow: 'M12 2.5v19M2.8 7.25l18.4 10.5M21.2 7.25 2.8 17.75M12 6.4l2.6-2.1M12 6.4 9.4 4.3M12 17.6l2.6 2.1M12 17.6l-2.6 2.1',
    bolt: 'm3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z'
  }

  function ms(name, fallback) {
    var value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
    return isFinite(value) ? value : fallback
  }

  /** 把切换栏里那一格的图标换成这一天自己的天气图标。 */
  function tabIcon(tab, icon) {
    if (tab.dataset.icon === icon) return
    tab.dataset.icon = icon
    var previous = tab.querySelector('svg')
    if (previous === null) return
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('stroke-width', '2.25')
    svg.setAttribute('aria-hidden', 'true')
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', TAB_PATHS[icon] || TAB_PATHS.cloud)
    svg.appendChild(path)
    previous.replaceWith(svg)
  }

  /** 数字：逐位换成新值，后两位错开出现，没变的位不动。 */
  function setDigits(group, next, instant, reduced) {
    var text = String(next)
    var previous = group.textContent.replace(/\s+/g, '')
    if (previous === text) return
    if (instant || reduced) {
      group.textContent = text
      return
    }
    var same = 0
    while (same < previous.length && same < text.length && previous[same] === text[same]) same += 1
    group.classList.remove('is-animating')
    group.replaceChildren()
    text.split('').forEach(function (character, index) {
      var span = document.createElement('span')
      span.className = 't-digit'
      span.textContent = character
      if (index < same) span.dataset.same = ''
      if (index === text.length - 2) span.dataset.stagger = '1'
      else if (index === text.length - 1) span.dataset.stagger = '2'
      group.appendChild(span)
    })
    void group.offsetHeight
    group.classList.add('is-animating')
  }

  /** 文字切换：旧值上移淡出，新值从下方淡入。 */
  function swapText(node, next, instant, reduced) {
    var target = node.dataset.next || node.textContent
    if (target === next) return
    node.dataset.next = next
    clearTimeout(node._swapTimer)
    if (instant || reduced) {
      node.textContent = next
      return
    }
    node.classList.remove('is-enter-start')
    node.classList.add('is-exit')
    node._swapTimer = setTimeout(function () {
      node.textContent = next
      node.classList.remove('is-exit')
      node.classList.add('is-enter-start')
      void node.offsetHeight
      node.classList.remove('is-enter-start')
    }, ms('--w-motion-fast', 150))
  }

  /** 文字变形：只替换前后不同的那一段，容器宽度跟着过渡。 */
  function morphText(node, next, instant, reduced) {
    var previous = node.dataset.text != null ? node.dataset.text : node.textContent
    if (previous === next) return
    node.dataset.text = next
    clearTimeout(node._morphTimer)
    if (instant || reduced) {
      node.textContent = next
      return
    }
    var head = 0
    while (head < previous.length && head < next.length && previous[head] === next[head]) head += 1
    var tail = 0
    while (
      tail < previous.length - head && tail < next.length - head &&
      previous[previous.length - 1 - tail] === next[next.length - 1 - tail]
    ) tail += 1
    var swap = document.createElement('span')
    swap.className = 't-morph-swap'
    var out = document.createElement('span')
    out.className = 't-morph-old'
    out.setAttribute('aria-hidden', 'true')
    out.textContent = previous.slice(head, previous.length - tail)
    var inn = document.createElement('span')
    inn.className = 't-morph-new'
    inn.textContent = next.slice(head, next.length - tail)
    swap.append(out, inn)
    node.textContent = ''
    node.append(next.slice(0, head), swap, next.slice(next.length - tail))
    swap.style.width = out.getBoundingClientRect().width + 'px'
    void swap.offsetWidth
    swap.classList.add('is-morphing')
    swap.style.width = inn.getBoundingClientRect().width + 'px'
    node._morphTimer = setTimeout(function () { node.textContent = next }, Math.max(ms('--w-motion-morph', 180), ms('--w-motion-morph-resize', 240)) + 40)
  }

  /** 药丸对到选中的那一格；`animate` 为假时直接落位。 */
  function moveTo(pill, tab, animate) {
    if (!animate) {
      var previous = pill.style.transition
      pill.style.transition = 'none'
      pill.style.transform = 'translateX(' + tab.offsetLeft + 'px)'
      pill.style.width = tab.offsetWidth + 'px'
      void pill.offsetWidth
      pill.style.transition = previous
      return
    }
    pill.style.transform = 'translateX(' + tab.offsetLeft + 'px)'
    pill.style.width = tab.offsetWidth + 'px'
  }

  root.WeatherView = {
    tabIcon: tabIcon,
    setDigits: setDigits,
    swapText: swapText,
    morphText: morphText,
    moveTo: moveTo
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
