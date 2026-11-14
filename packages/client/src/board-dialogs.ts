/** 看板页弹窗的互斥、内容编辑返回与关闭后的焦点恢复（D27）。 */
import { useCallback, useRef, useState } from 'react'
import type { EditorTarget } from './editor'

/**
 * 管理看板页自己的编辑表面，状态保持在同一次页面挂载中。
 *
 * @returns 弹窗状态、打开/关闭操作与焦点来源。
 */
export function useBoardDialogs() {
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [contentId, setContentId] = useState<string | null>(null)
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)

  /** 打开一张卡或一组的设置；记下按钮，关掉弹窗之后把焦点还回去（D27）。 */
  const openEditor = useCallback((kind: 'instance' | 'group', id: string, button: HTMLButtonElement | null): void => {
    returnFocusRef.current = button
    setLibraryOpen(false)
    setComposerOpen(false)
    setEditor({ kind, id })
  }, [])

  /** 打开创建卡片：组件库先收起来，两个浮层不同时开着。 */
  const openComposer = useCallback((): void => {
    setLibraryOpen(false)
    setEditor(null)
    setContentId(null)
    setComposerOpen(true)
  }, [])

  /** 打开一张卡的内容编辑：设置弹窗让位，回来之后重新打开它。 */
  const openContent = useCallback((id: string): void => {
    setContentId(id)
    setEditor(null)
  }, [])

  /** 关掉内容编辑：回到设置弹窗，让人接着看配置与日志。 */
  const closeContent = useCallback((): void => {
    const id = contentId
    setContentId(null)
    if (id !== null) setEditor({ kind: 'instance', id })
  }, [contentId])

  /** 内容另存成了新卡片：两个弹窗一起收起来。 */
  const finishContent = useCallback((): void => {
    setContentId(null)
    setEditor(null)
  }, [])

  /** 关掉创建器并把焦点还给打开它的按钮。 */
  const closeComposer = useCallback((): void => {
    setComposerOpen(false)
    const button = returnFocusRef.current
    returnFocusRef.current = null
    window.setTimeout(() => { button?.focus() }, 0)
  }, [])

  /** 关掉设置弹窗并把焦点还给打开它的按钮。 */
  const closeEditor = useCallback((): void => {
    setEditor(null)
    const button = returnFocusRef.current
    returnFocusRef.current = null
    window.setTimeout(() => { button?.focus() }, 0)
  }, [])

  return {
    libraryOpen, setLibraryOpen, editor, setEditor, composerOpen, contentId, returnFocusRef,
    openEditor, openComposer, openContent, closeContent, finishContent, closeComposer, closeEditor,
  }
}
