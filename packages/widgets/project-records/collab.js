/*
 * 横向项目卡的分工与交接：负责事项的负责人 / 协作人 / 待确认人，项目评审与交接记录。
 *
 * 成员控件由运行时共用的成员目录造：负责人单选，协作人与待确认人多选，评审人与接手人单选。
 * 成员停用后 id 仍留在记录里，选择框会按目录显示当时的称呼；这里不判断身份或权限。
 * 评审对象、意见与结论必填；交接的确认状态由用户手动勾选，未确认时不写确认时间。
 */
;(function (root) {
  'use strict'

  var REVIEW_TARGETS = ['project', 'deliverable', 'requirement']

  /**
   * 建分工与交接面板。
   *
   * @param {object} ctx - 状态、节点、文案、判定与行刷新回调。
   * @returns {object} 分工与交接的渲染和归一。
   */
  root.createProjectCollab = function (ctx) {
    var app = ctx.app
    var nodes = ctx.nodes
    var widget = ctx.widget
    var t = ctx.t
    var pure = ctx.pure
    var directory = widget !== undefined && typeof widget.createMemberDirectory === 'function' ? widget.createMemberDirectory() : null
    var membersReady = null
    var membersLoaded = false
    var attempted = false
    var locked = false

    /** 成员目录读一次；读失败时下次重画再试，已选的 id 不丢。 */
    function loadMembers() {
      if (directory === null) return Promise.resolve(false)
      if (membersReady === null) {
        membersReady = directory.load().then(function () {
          membersLoaded = true
          return true
        }, function () {
          membersReady = null
          return false
        })
      }
      return membersReady
    }

    function el(tag, className, text) {
      var node = document.createElement(tag)
      if (className !== undefined && className !== '') node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }

    function field(text, control) {
      var label = el('label', 'pj__collab-field')
      label.append(el('span', 'pj__collab-label', text), control)
      return label
    }

    function inputOf(value, onChange, options) {
      var settings = options !== undefined ? options : {}
      var input = document.createElement('input')
      input.className = 'pj__input'
      input.type = settings.type !== undefined ? settings.type : 'text'
      if (settings.maxLength !== undefined) input.maxLength = settings.maxLength
      if (settings.placeholder !== undefined) input.placeholder = settings.placeholder
      input.value = typeof value === 'string' ? value : ''
      input.disabled = locked || settings.disabled === true
      input.addEventListener('input', function () { onChange(input.value) })
      return input
    }

    function areaOf(value, onChange, maxLength) {
      var area = document.createElement('textarea')
      area.className = 'pj__input pj__textarea'
      area.rows = 2
      area.maxLength = maxLength
      area.value = typeof value === 'string' ? value : ''
      area.disabled = locked
      area.addEventListener('input', function () { onChange(area.value) })
      return area
    }

    function memberSelect(value, onChange) {
      if (directory === null) return inputOf(value, onChange, { placeholder: t('memberPlaceholder') })
      var select = document.createElement('select')
      select.className = 'pj__input'
      directory.fill(select, value === undefined ? [] : [value], t('memberNone'))
      select.disabled = locked
      select.addEventListener('change', function () {
        onChange(select.value === '' ? undefined : select.value)
      })
      return select
    }

    function checkboxOf(checked, onChange) {
      var label = el('label', 'pj__collab-check')
      var box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = checked === true
      box.disabled = locked
      box.addEventListener('change', function () { onChange(box.checked) })
      label.append(box, el('span', '', t('confirmed')))
      return label
    }

    function removeButton(kind, index) {
      var button = el('button', 'pj__ghost pj__line-remove', t('removeRow'))
      button.type = 'button'
      button.disabled = locked
      button.addEventListener('click', function () {
        app[kind].splice(index, 1)
        renderAll()
        ctx.onInput()
      })
      return button
    }

    function newId(prefix) {
      return prefix + '-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000))
    }

    function targetSelect(entry) {
      var labels = {
        project: t('reviewTargetProject'),
        deliverable: t('reviewTargetDeliverable'),
        requirement: t('reviewTargetRequirement')
      }
      var select = el('select', 'pj__input pj__line-status')
      for (var at = 0; at < REVIEW_TARGETS.length; at += 1) {
        var option = document.createElement('option')
        option.value = REVIEW_TARGETS[at]
        option.textContent = labels[REVIEW_TARGETS[at]]
        select.append(option)
      }
      select.value = REVIEW_TARGETS.indexOf(entry.target) >= 0 ? entry.target : 'project'
      select.disabled = locked
      select.addEventListener('change', function () {
        entry.target = select.value
        if (entry.target === 'project') {
          delete entry.targetId
          delete entry.targetVersion
        }
        renderAll()
        ctx.onInput()
      })
      return select
    }

    function reviewRow(entry, index) {
      var row = el('li', 'pj__collab')
      row.dataset.kind = 'reviews'
      row.dataset.index = String(index)
      var head = el('div', 'pj__collab-head')
      head.append(targetSelect(entry))
      if (entry.target !== 'project') {
        head.append(field(t('reviewTargetId'), inputOf(entry.targetId, function (value) {
          entry.targetId = value
        }, { placeholder: t('reviewTargetId') })))
        head.append(field(t('reviewTargetVersion'), inputOf(entry.targetVersion, function (value) {
          entry.targetVersion = value
        }, { maxLength: pure.VERSION_LENGTH })))
      }
      head.append(field(t('reviewer'), memberSelect(entry.reviewer, function (value) {
        entry.reviewer = value
      })))
      head.append(field(t('reviewAt'), inputOf(pure.dateInputOf(entry.at), function (value) {
        entry.at = value === '' ? undefined : pure.dateValue(value, pure.zone())
      }, { type: 'date' })))
      head.append(removeButton('reviews', index))
      row.append(head)
      var body = el('div', 'pj__collab-body')
      body.append(field(t('reviewOpinion'), areaOf(entry.opinion, function (value) {
        entry.opinion = value
      }, pure.REVIEW_OPINION_LENGTH)))
      body.append(field(t('reviewDecision'), inputOf(entry.decision, function (value) {
        entry.decision = value
      }, { maxLength: pure.REVIEW_DECISION_LENGTH })))
      body.append(field(t('reviewFollowUp'), areaOf(entry.followUp, function (value) {
        entry.followUp = value
      }, pure.REVIEW_OPINION_LENGTH)))
      row.append(body)
      return row
    }

    function handoverRow(entry, index) {
      var row = el('li', 'pj__collab')
      row.dataset.kind = 'handovers'
      row.dataset.index = String(index)
      var head = el('div', 'pj__collab-head')
      head.append(field(t('receiver'), memberSelect(entry.receiver, function (value) {
        entry.receiver = value
      })))
      head.append(field(t('handoverAt'), inputOf(pure.dateInputOf(entry.at), function (value) {
        entry.at = value === '' ? undefined : pure.dateValue(value, pure.zone())
      }, { type: 'date' })))
      head.append(checkboxOf(entry.confirmed, function (checked) {
        entry.confirmed = checked
        if (!checked) delete entry.confirmedAt
        renderAll()
        ctx.onInput()
      }))
      head.append(field(t('confirmedAt'), inputOf(pure.dateInputOf(entry.confirmedAt), function (value) {
        entry.confirmedAt = value === '' ? undefined : pure.dateValue(value, pure.zone())
      }, { type: 'date', disabled: entry.confirmed !== true })))
      head.append(removeButton('handovers', index))
      row.append(head)
      var body = el('div', 'pj__collab-body')
      var fields = [
        ['progress', t('progress')],
        ['materials', t('handoverMaterials')],
        ['instructions', t('instructions')],
        ['issues', t('handoverIssues')],
        ['todos', t('handoverTodos')]
      ]
      for (var at = 0; at < fields.length; at += 1) {
        body.append(field(fields[at][1], areaOf(entry[fields[at][0]], function (key, value) {
          entry[key] = value
        }.bind(null, fields[at][0]), pure.TEXT_LENGTH)))
      }
      row.append(body)
      return row
    }

    function renderReviews() {
      if (nodes.reviews === null) return
      var list = Array.isArray(app.reviews) ? app.reviews : []
      var items = []
      for (var at = 0; at < list.length; at += 1) items.push(reviewRow(list[at], at))
      nodes.reviews.replaceChildren.apply(nodes.reviews, items)
    }

    function renderHandovers() {
      if (nodes.handovers === null) return
      var list = Array.isArray(app.handovers) ? app.handovers : []
      var items = []
      for (var at = 0; at < list.length; at += 1) items.push(handoverRow(list[at], at))
      nodes.handovers.replaceChildren.apply(nodes.handovers, items)
    }

    /** 成员目录到了以后重画一次事项行与两个选择框，让停用成员也显示称呼。 */
    function refreshMembers() {
      if (directory === null || membersLoaded || attempted) return
      attempted = true
      loadMembers().then(function (loaded) {
        if (!loaded) return
        ctx.rows.renderAll()
        renderReviews()
        renderHandovers()
      })
    }

    function renderAll() {
      if (!membersLoaded) attempted = false
      renderReviews()
      renderHandovers()
      refreshMembers()
    }

    function addReview() {
      if (locked) return
      if (!Array.isArray(app.reviews)) app.reviews = []
      if (app.reviews.length >= pure.MAX_REVIEWS) return
      app.reviews.push({ id: newId('rv'), target: 'project', opinion: '', decision: '' })
      renderAll()
      ctx.onInput()
    }

    function addHandover() {
      if (locked) return
      if (!Array.isArray(app.handovers)) app.handovers = []
      if (app.handovers.length >= pure.MAX_HANDOVERS) return
      app.handovers.push({ id: newId('ho'), confirmed: false })
      renderAll()
      ctx.onInput()
    }

    /**
     * 负责事项行上的分工控件；其他行没有。
     *
     * @param {string} kind - 行所属的字段。
     * @param {object} entry - 这一行的可变对象。
     * @returns {HTMLElement|null} 分工控件。
     */
    function extraOf(kind, entry) {
      if (kind !== 'tasks' || directory === null) return null
      var host = el('div', 'pj__assign')
      host.replaceChildren(directory.assign(entry, ctx.onInput))
      if (locked) {
        var selects = host.querySelectorAll('select')
        for (var at = 0; at < selects.length; at += 1) selects[at].disabled = true
      }
      refreshMembers()
      return host
    }

    function cleanedReviews() {
      return pure.cleanReviews(app.reviews)
    }

    function cleanedHandovers() {
      return pure.cleanHandovers(app.handovers)
    }

    function setLocked(value) {
      locked = value === true
      renderAll()
    }

    if (nodes.addReview !== null) nodes.addReview.addEventListener('click', addReview)
    if (nodes.addHandover !== null) nodes.addHandover.addEventListener('click', addHandover)

    return {
      renderAll: renderAll,
      extraOf: extraOf,
      cleanedReviews: cleanedReviews,
      cleanedHandovers: cleanedHandovers,
      setLocked: setLocked
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
