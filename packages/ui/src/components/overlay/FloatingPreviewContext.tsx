/**
 * FloatingPreviewContext - opt-in centered floating layout and prev/next paging
 * for overlays built on FullscreenOverlayBase.
 *
 * The floating card and paging design is adapted from Cetus
 * (src/components/chat/artifact-view.tsx), MIT License,
 * Copyright (c) 2026 Cetus authors. See THIRD_PARTY_NOTICES.md.
 */

import { createContext, useContext, type ReactNode } from 'react'

export interface FloatingPreviewNavigation {
  /** Zero-based position of the current file */
  index: number
  /** Number of files that can be paged through */
  count: number
  onPrev: () => void
  onNext: () => void
}

export interface FloatingPreviewValue {
  /** Render as a centered card over a dimmed backdrop instead of edge-to-edge */
  floating: boolean
  /** Paging between sibling files; omitted when there is nothing to page */
  navigation?: FloatingPreviewNavigation
}

const FloatingPreviewContext = createContext<FloatingPreviewValue>({ floating: false })

export function FloatingPreviewProvider({ value, children }: { value: FloatingPreviewValue; children: ReactNode }) {
  return <FloatingPreviewContext.Provider value={value}>{children}</FloatingPreviewContext.Provider>
}

export function useFloatingPreview(): FloatingPreviewValue {
  return useContext(FloatingPreviewContext)
}
