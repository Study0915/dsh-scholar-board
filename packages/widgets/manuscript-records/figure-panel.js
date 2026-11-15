/*
 * 图表的扩展字段：对应运行、数据材料、绘图代码仓库与提交、结论。
 *
 * 运行只是引用，打开走 `records.open`，读不到时标「来源缺失」；数据材料只收 http/https 地址。
 * 这一份只画与增删图表里的扩展块，图表本身的编号标题仍在 editor-deep.js。
 */
;(function (root) {
  'use strict'

  var READ = 'widget-board:records.read'
  var OPEN = 'widget-board:records.open'

  /**
   * 建图表的扩展块。
   *
   * @param {object} ctx - 状态、组件能力、节点工厂与重画回调。
   * @returns {object} 画块、刷新与增删动作。
   */
  root.createManuscriptFigurePanel = function (ctx) {
    var app = ctx.app
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var control = ctx.control
    var trashed = ctx.trashed
    var newId = ctx.newId
    var rerender = ctx.rerender
    var onInput = ctx.onInput
    var setStatus = ctx.setStatus
    /** 图表引用到的运行，按 id 缓存；解析过一次就不再重读。 */
    var runCache = {}
    /** 可选运行，按需读一次。 */
    var runOptions = null
    var runLoading = false
    var runEpoch = 0
    var runSignature = ''

    function messageOf(error) {
      return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
    }

    function tagOf(text, tone) {
      var tag = document.createElement('span')
      tag.className = 'ms__tag'
      tag.dataset.tone = tone
      tag.textContent = text
      return tag
    }

    function optionOf(value, label) {
      var option = document.createElement('option')
      option.value = value
      option.textContent = label
      return option
    }

    function figureOf(id) {
      for (var at = 0; at < app.figures.length; at += 1) {
        var figure = app.figures[at]
        if (figure !== null && typeof figure === 'object' && String(figure.id) === String(id)) return figure
      }
      return null
    }

    /** 所有图表引用到的运行 id；同一个运行只读一次。 */
    function runIdsOf() {
      var ids = []
      var seen = {}
      for (var at = 0; at < app.figures.length; at += 1) {
        var figure = app.figures[at]
        if (figure === null || typeof figure !== 'object') continue
        var runs = pure.figureRunsOf(figure)
        for (var index = 0; index < runs.length; index += 1) {
          if (runs[index] !== null && typeof runs[index] === 'object' && typeof runs[index].id === 'string' && seen[runs[index].id] !== true) {
            seen[runs[index].id] = true
            ids.push(runs[index].id)
          }
        }
      }
      return ids
    }

    /** 按需要在后台读一次引用到的运行；读到后重画图表目录。 */
    function resolveRuns() {
      if (!live || typeof widget.call !== 'function') return
      var ids = runIdsOf()
      var signature = ids.slice().sort().join(',')
      if (signature === runSignature) return
      runSignature = signature
      if (ids.length === 0) return
      var wanted = runEpoch
      widget.call(READ, { ids: ids, includeArchived: true, includeTrashed: true }).then(function (result) {
        if (wanted !== runEpoch) return
        var records = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
        for (var at = 0; at < records.length; at += 1) {
          var record = records[at]
          if (record !== null && typeof record === 'object' && typeof record.id === 'string') runCache[record.id] = record
        }
        rerender()
      }, function () {})
    }

    /** 第一次画图表目录时读一次可选运行，供选择框使用。 */
    function ensureRunOptions() {
      if (!live || runOptions !== null || runLoading || app.figures.length === 0) return
      runLoading = true
      var wanted = runEpoch
      widget.call(READ, { kind: 'run', includeArchived: true }).then(function (result) {
        runLoading = false
        if (wanted !== runEpoch) return
        runOptions = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
        for (var at = 0; at < runOptions.length; at += 1) {
          if (runOptions[at] !== null && typeof runOptions[at] === 'object' && typeof runOptions[at].id === 'string') runCache[runOptions[at].id] = runOptions[at]
        }
        rerender()
      }, function (error) {
        runLoading = false
        if (wanted !== runEpoch) return
        runOptions = []
        setStatus(t('figureRunLoadFailed') + '：' + messageOf(error), 'error')
        rerender()
      })
    }

    function runTitleOf(id) {
      var record = runCache[id]
      return record !== undefined && record !== null && typeof record.title === 'string' && record.title !== '' ? record.title : ''
    }

    function runsBlock(figure) {
      var runs = pure.figureRunsOf(figure)
      var block = document.createElement('div')
      block.className = 'ms__deep-line'
      var label = document.createElement('span')
      label.className = 'ms__label'
      label.textContent = t('figureRuns')
      block.appendChild(label)
      var seen = {}
      for (var at = 0; at < runs.length; at += 1) {
        var ref = runs[at]
        if (ref === null || typeof ref !== 'object' || typeof ref.id !== 'string') continue
        seen[ref.id] = true
        var record = runCache[ref.id]
        var title = runTitleOf(ref.id)
        var open = document.createElement('button')
        open.type = 'button'
        open.className = 'ms__ghost'
        open.dataset.action = 'open-figure-run'
        open.dataset.figure = String(figure.id)
        open.dataset.run = ref.id
        open.textContent = title !== '' ? title : (live && record === undefined ? t('unknown') : t('sourceMissing'))
        if (!live) open.disabled = true
        block.appendChild(open)
        if (record !== undefined && record !== null) {
          if (typeof record.deletedAt === 'string') block.appendChild(tagOf(t('figureRunTrashed'), 'trash'))
          else if (record.archived === true) block.appendChild(tagOf(t('figureRunArchived'), 'neutral'))
        } else if (record === undefined && live) {
          block.appendChild(tagOf(t('sourceMissing'), 'missing'))
        }
        var remove = control('button', 'ms__ghost ms__deep-remove')
        remove.type = 'button'
        remove.dataset.action = 'remove-figure-run'
        remove.dataset.figure = String(figure.id)
        remove.dataset.run = ref.id
        remove.textContent = t('remove')
        block.appendChild(remove)
      }
      if (live && runs.length < pure.MAX_FIGURE_RUNS) {
        var select = control('select', 'ms__select', 'figure-run-add')
        select.setAttribute('aria-label', t('figureRunAdd'))
        select.appendChild(optionOf('', t('figureRunChoose')))
        if (runOptions === null) {
          var loading = optionOf('', t('loading'))
          loading.disabled = true
          select.appendChild(loading)
        } else {
          for (var index = 0; index < runOptions.length; index += 1) {
            var option = runOptions[index]
            if (option === null || typeof option !== 'object' || typeof option.id !== 'string' || seen[option.id] === true) continue
            var titleOfRun = typeof option.title === 'string' && option.title !== '' ? option.title : option.id
            select.appendChild(optionOf(option.id, titleOfRun))
          }
        }
        select.value = ''
        block.appendChild(select)
      }
      return block
    }

    function materialsBlock(figure) {
      var block = document.createElement('div')
      block.className = 'ms__deep-date'
      var label = document.createElement('span')
      label.className = 'ms__label'
      label.textContent = t('figureMaterials')
      block.appendChild(label)
      var list = document.createElement('ul')
      list.className = 'ms__material-list'
      var materials = Array.isArray(figure.materials) ? figure.materials : []
      for (var at = 0; at < materials.length; at += 1) {
        var material = materials[at]
        if (material === null || typeof material !== 'object' || typeof material.id !== 'string') continue
        var row = document.createElement('li')
        row.className = 'ms__material'
        var open = document.createElement('button')
        open.type = 'button'
        open.className = 'ms__material-open'
        open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
        open.title = String(material.url)
        open.dataset.url = String(material.url)
        open.dataset.figure = String(figure.id)
        var remove = control('button', 'ms__ghost ms__material-remove')
        remove.type = 'button'
        remove.dataset.action = 'remove-figure-material'
        remove.dataset.figure = String(figure.id)
        remove.dataset.material = material.id
        remove.textContent = t('removeMaterial')
        row.append(open, remove)
        list.appendChild(row)
      }
      if (materials.length === 0) {
        var empty = document.createElement('li')
        empty.className = 'ms__deep-hint'
        empty.textContent = t('figureMaterialEmpty')
        list.appendChild(empty)
      }
      block.appendChild(list)
      if (!trashed()) {
        var add = document.createElement('div')
        add.className = 'ms__material-add'
        var url = control('input', 'ms__input', 'figure-material-url')
        url.type = 'text'
        url.placeholder = t('materialUrl')
        url.setAttribute('aria-label', t('materialUrl'))
        url.maxLength = 2048
        var title = control('input', 'ms__input', 'figure-material-title')
        title.type = 'text'
        title.placeholder = t('materialTitle')
        title.setAttribute('aria-label', t('materialTitle'))
        title.maxLength = 200
        var button = control('button', 'ms__ghost')
        button.type = 'button'
        button.dataset.action = 'add-figure-material'
        button.dataset.figure = String(figure.id)
        button.textContent = t('addMaterial')
        add.append(url, title, button)
        block.appendChild(add)
      }
      return block
    }

    function plotBlock(figure) {
      var plot = figure.plot !== null && typeof figure.plot === 'object' ? figure.plot : {}
      var wrap = document.createElement('div')
      wrap.className = 'ms__deep-date'
      var label = document.createElement('span')
      label.className = 'ms__label'
      label.textContent = t('figurePlot')
      wrap.appendChild(label)
      var line = document.createElement('div')
      line.className = 'ms__deep-line'
      var repository = control('input', 'ms__input ms__deep-grow', 'figure-plot-repository')
      repository.type = 'text'
      repository.placeholder = t('figurePlotRepository')
      repository.setAttribute('aria-label', t('figurePlotRepository'))
      repository.maxLength = pure.PLOT_REPOSITORY
      repository.value = typeof plot.repository === 'string' ? plot.repository : ''
      var commit = control('input', 'ms__input ms__deep-grow', 'figure-plot-commit')
      commit.type = 'text'
      commit.placeholder = t('figurePlotCommit')
      commit.setAttribute('aria-label', t('figurePlotCommit'))
      commit.maxLength = pure.PLOT_COMMIT
      commit.value = typeof plot.commit === 'string' ? plot.commit : ''
      line.append(repository, commit)
      wrap.appendChild(line)
      var hint = document.createElement('span')
      hint.className = 'ms__deep-hint'
      hint.textContent = t('figurePlotHint')
      wrap.appendChild(hint)
      return wrap
    }

    function conclusionBlock(figure) {
      var wrap = document.createElement('label')
      wrap.className = 'ms__deep-date'
      var label = document.createElement('span')
      label.className = 'ms__label'
      label.textContent = t('figureConclusion')
      var input = control('textarea', 'ms__input ms__textarea', 'figure-conclusion')
      input.rows = 2
      input.maxLength = pure.FIGURE_CONCLUSION
      input.value = typeof figure.conclusion === 'string' ? figure.conclusion : ''
      wrap.append(label, input)
      var hint = document.createElement('span')
      hint.className = 'ms__deep-hint'
      hint.textContent = t('figureConclusionHint')
      wrap.appendChild(hint)
      return wrap
    }

    function setPlot(figure, field, value) {
      var plot = figure.plot !== null && typeof figure.plot === 'object' ? figure.plot : {}
      if (value.trim() === '') delete plot[field]
      else plot[field] = value
      if (plot.repository === undefined && plot.commit === undefined) delete figure.plot
      else figure.plot = plot
    }

    function addRun(figure, runId) {
      if (trashed() || figure === null || typeof runId !== 'string' || runId === '') return
      var runs = pure.figureRunsOf(figure).slice()
      if (runs.length >= pure.MAX_FIGURE_RUNS) {
        setStatus(pure.fill(t('figureRunLimit'), { n: pure.MAX_FIGURE_RUNS }), 'error')
        return
      }
      for (var at = 0; at < runs.length; at += 1) {
        if (runs[at] !== null && typeof runs[at] === 'object' && runs[at].id === runId) {
          rerender()
          return
        }
      }
      runs.push({ kind: 'run', id: runId })
      figure.runs = runs
      rerender()
    }

    function removeRun(id, runId) {
      var figure = figureOf(id)
      if (figure === null) return
      var runs = pure.figureRunsOf(figure).filter(function (ref) {
        return ref === null || typeof ref !== 'object' || String(ref.id) !== String(runId)
      })
      if (runs.length === 0) delete figure.runs
      else figure.runs = runs
      rerender()
      onInput()
    }

    function addMaterial(id, url, title) {
      if (trashed()) return
      var figure = figureOf(id)
      if (figure === null) return
      var cleanUrl = typeof url === 'string' ? url.trim() : ''
      var cleanTitle = typeof title === 'string' ? title.trim() : ''
      if (!pure.materialValid(cleanUrl, cleanTitle)) {
        setStatus(t('materialInvalid'), 'error')
        return
      }
      var materials = Array.isArray(figure.materials) ? figure.materials.slice() : []
      materials.push({ id: newId('fm'), url: cleanUrl, title: cleanTitle })
      figure.materials = materials
      rerender()
      onInput()
    }

    function removeMaterial(id, materialId) {
      var figure = figureOf(id)
      if (figure === null) return
      var materials = (Array.isArray(figure.materials) ? figure.materials : []).filter(function (material) {
        return material === null || typeof material !== 'object' || String(material.id) !== String(materialId)
      })
      if (materials.length === 0) delete figure.materials
      else figure.materials = materials
      rerender()
      onInput()
    }

    function openRun(id) {
      if (!live || typeof widget.call !== 'function') return
      widget.call(OPEN, { kind: 'run', id: id }).catch(function (error) {
        setStatus(t('figureRunLoadFailed') + '：' + messageOf(error), 'error')
      })
    }

    /** 把扩展块接到一行图表下面。 */
    function appendTo(row, figure) {
      row.appendChild(runsBlock(figure))
      row.appendChild(materialsBlock(figure))
      row.appendChild(plotBlock(figure))
      row.appendChild(conclusionBlock(figure))
    }

    /** 处理运行、绘图代码与结论的输入；认出这个字段时返回 true。 */
    function update(figure, id, field, value) {
      if (field === 'figure-run-add') {
        addRun(figure, value)
        return true
      }
      if (field === 'figure-plot-repository' || field === 'figure-plot-commit') {
        setPlot(figure, field === 'figure-plot-repository' ? 'repository' : 'commit', value)
        return true
      }
      if (field === 'figure-conclusion') {
        if (value.trim() === '') delete figure.conclusion
        else figure.conclusion = value
        return true
      }
      return false
    }

    function refresh() {
      ensureRunOptions()
      resolveRuns()
    }

    return {
      appendTo: appendTo,
      update: update,
      refresh: refresh,
      addRun: function (id, runId) { addRun(figureOf(id), runId); onInput() },
      removeRun: removeRun,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial,
      openRun: openRun
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)