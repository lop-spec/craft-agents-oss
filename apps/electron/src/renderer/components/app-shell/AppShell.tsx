import * as React from "react"
import { useTranslation, Trans } from "react-i18next"
import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useAtomValue, useStore } from "jotai"
import { Plus } from "lucide-react"
import { TopBar } from "./TopBar"
import { Button } from "@/components/ui/button"
import { HeaderIconButton } from "@/components/ui/HeaderIconButton"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import { SessionList } from "./SessionList"
import { PanelStackContainer } from "./PanelStackContainer"
import type { ChatDisplayHandle } from "./ChatDisplay"
import { ShellResizeHandle } from "./ShellResizeHandle"
import { SessionNavHeader, CapabilityNavHeader, SessionNavFooter, type SessionGrouping, type NavSection } from "./SessionNav"
import { useSession } from "@/hooks/useSession"
import { ensureSessionMessagesLoadedAtom } from "@/atoms/sessions"
import { AppShellProvider, WORKSPACE_SETTINGS_CHANGED_EVENT, type AppShellContextType } from "@/context/AppShellContext"
import { EscapeInterruptProvider, useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useTheme } from "@/context/ThemeContext"
import { useAction, useActionLabel } from "@/actions"
import { useFocusContext } from "@/context/FocusContext"
import { useSetAtom } from "jotai"
import type { LoadedSource, LoadedSkill, PermissionMode, AutomationFilter } from "../../../shared/types"
import { sessionMetaMapAtom, sendToWorkspaceAtom } from "@/atoms/sessions"
import { sourcesAtom } from "@/atoms/sources"
import { DECISION_SETTINGS_CHANGED_EVENT, guardedModeAvailableAtom } from "@/atoms/permission-modes"
import { DEFAULT_PERMISSION_MODES } from "@craft-agent/shared/agent/modes"
import { RtkUpdatePrompt } from "@/components/RtkUpdateDialog"
import { skillsAtom } from "@/atoms/skills"
import { panelStackAtom, panelCountAtom, focusedPanelIdAtom, focusedSessionIdAtom, focusNextPanelAtom, focusPrevPanelAtom, parseSessionIdFromRoute } from "@/atoms/panel-stack"
import { type SessionStatus, statusConfigsToSessionStatuses } from "@/config/session-status-config"
import { useStatuses } from "@/hooks/useStatuses"
import { useLabels } from "@/hooks/useLabels"
import { useContainerWidth } from "@/hooks/useContainerWidth"
import { sortLabelsForDisplay } from "@craft-agent/shared/labels"
import * as storage from "@/lib/local-storage"
import { toast } from "sonner"
import { navigate, routes } from "@/lib/navigate"
import {
  useNavigation,
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
} from "@/contexts/NavigationContext"
import type { SettingsSubpage } from "../../../shared/types"
import { SourcesListPanel } from "./SourcesListPanel"
import { SkillsListPanel } from "./SkillsListPanel"
import { AutomationsListPanel } from "../automations/AutomationsListPanel"
import { AUTOMATION_TYPE_TO_FILTER_KIND } from "../automations/types"
import { useAutomations } from "@/hooks/useAutomations"
import { useProjects } from "@/hooks/useProjects"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { FabNewChat } from "./FabNewChat"
import { SendToWorkspaceDialog } from "./SendToWorkspaceDialog"
import { CreateProjectDialog } from "../projects/CreateProjectDialog"
import { MessagingDialogHost } from "@/components/messaging/MessagingDialogHost"
import { EditPopover, getEditConfig } from "@/components/ui/EditPopover"
import SettingsNavigator from "@/pages/settings/SettingsNavigator"
import {
  PANEL_GAP,
  PANEL_EDGE_INSET,
  PANEL_SASH_HALF_HIT_WIDTH,
} from "./panel-constants"
import { hasOpenOverlay } from "@/lib/overlay-detection"
import { clearSourceIconCaches } from "@/lib/icon-cache"
import { dispatchFocusInputEvent } from "./input/focus-input-events"
import { cn } from "@/lib/utils"

/**
 * AppShellProps - Minimal props interface for AppShell component
 *
 * Data and callbacks come via contextValue (AppShellContextType).
 * Only UI-specific state is passed as separate props.
 */
interface AppShellProps {
  /** All data and callbacks - passed directly to AppShellProvider */
  contextValue: AppShellContextType
  /** UI-specific props */
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  menuNewChatTrigger?: number
  /** Focused mode - hides the session column, shows only the chat content */
  isFocusedMode?: boolean
}

/** The session column never gets narrower than its header (toggle + actions; 新建 drops its text when tight). */
const SESSION_COLUMN_MIN_WIDTH = 240
const SESSION_COLUMN_MAX_WIDTH = 480

/**
 * AppShell - Layout container (lop): ONE left column — sessions grouped by project or by
 * status, switched in its header — then the content panels. MCP, skills, automations and
 * settings open in the same column from its footer.
 */
export function AppShell(props: AppShellProps) {
  // Wrap with EscapeInterruptProvider so AppShellContent can use useEscapeInterrupt
  return (
    <EscapeInterruptProvider>
      <AppShellContent {...props} />
    </EscapeInterruptProvider>
  )
}

function AppShellContent({
  contextValue,
  defaultCollapsed = false,
  menuNewChatTrigger,
  isFocusedMode = false,
}: AppShellProps) {
  // Note: sessions is NOT destructured here - we use sessionMetaMapAtom instead
  // to prevent closures from retaining the full messages array
  const {
    workspaces,
    activeWorkspaceId,
    sessionOptions,
    onSelectWorkspace,
    onRefreshWorkspaces,
    onDeleteSession,
    onFlagSession,
    onUnflagSession,
    onArchiveSession,
    onUnarchiveSession,
    onMarkSessionUnread,
    onSessionStatusChange,
    onRenameSession,
    onOpenSettings,
    onOpenKeyboardShortcuts,
    onOpenStoredUserPreferences,
    pendingPermissions,
  } = contextValue

  const { t } = useTranslation()

  // The session column: shown/hidden with ⌘B, resizable.
  const [isSidebarVisible, setIsSidebarVisible] = React.useState(() => {
    return storage.get(storage.KEYS.sessionColumnVisible, !defaultCollapsed)
  })
  const [sessionListWidth, setSessionListWidth] = React.useState(() => {
    return Math.max(SESSION_COLUMN_MIN_WIDTH, storage.get(storage.KEYS.sessionListWidth, 280))
  })

  // Focus mode hides the session column (CMD+. toggle).
  // Seed from either focused window param or persisted preference, then keep it toggleable.
  const [isSidebarAndNavigatorHidden, setIsSidebarAndNavigatorHidden] = React.useState(() => {
    return isFocusedMode || storage.get(storage.KEYS.focusModeEnabled, false)
  })

  // Auto-compact mode: shell width below mobile threshold switches to single-panel mode.
  const shellRef = useRef<HTMLDivElement>(null)
  const shellWidth = useContainerWidth(shellRef)
  const MOBILE_THRESHOLD = 768
  const isAutoCompact = shellWidth > 0 && shellWidth < MOBILE_THRESHOLD

  const isColumnHidden = isSidebarAndNavigatorHidden || !isSidebarVisible
  const effectiveColumnHidden = isAutoCompact ? false : isColumnHidden

  const [isResizing, setIsResizing] = React.useState(false)
  const [sessionListHandleY, setSessionListHandleY] = React.useState<number | null>(null)
  const sessionListHandleRef = React.useRef<HTMLDivElement>(null)
  const [session, setSession] = useSession()
  const { resolvedMode, setMode } = useTheme()
  const { isDark } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward, navigateToSource, navigateToSession } = useNavigation()

  // Double-Esc interrupt feature: first Esc shows warning, second Esc interrupts
  const { handleEscapePress } = useEscapeInterrupt()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  const navState = useNavigationState()

  const store = useStore()
  const panelCount = useAtomValue(panelCountAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)

  // Navigate the focused panel to a session.
  // If the session is already open in another panel, focus that panel instead.
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const navigateToSessionInPanel = useCallback((sessionId: string) => {
    const stack = store.get(panelStackAtom)
    for (const entry of stack) {
      if (parseSessionIdFromRoute(entry.route) === sessionId) {
        setFocusedPanel(entry.id)
        return
      }
    }
    navigateToSession(sessionId)
  }, [store, setFocusedPanel, navigateToSession])

  const showingArchived = isSessionsNavigation(navState) && navState.filter.kind === 'archived'

  // Which body the left column shows. Projects (a project's info page) keep the session list.
  const navSection: NavSection = isSourcesNavigation(navState)
    ? 'sources'
    : isSkillsNavigation(navState)
      ? 'skills'
      : isAutomationsNavigation(navState)
        ? 'automations'
        : isSettingsNavigation(navState)
          ? 'settings'
          : 'sessions'

  // Derive automation filter from navigation state (only when in automations navigator)
  const automationFilter: AutomationFilter | null = isAutomationsNavigation(navState) ? navState.filter ?? null : null

  // Project / status grouping of the session column (persisted per workspace)
  const [grouping, setGrouping] = React.useState<SessionGrouping>(() =>
    storage.get<SessionGrouping>(storage.KEYS.sessionGrouping, 'project', activeWorkspaceId ?? undefined)
  )
  const handleGroupingChange = useCallback((value: SessionGrouping) => {
    setGrouping(value)
    if (activeWorkspaceId) storage.set(storage.KEYS.sessionGrouping, value, activeWorkspaceId)
  }, [activeWorkspaceId])

  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  // Ref for ChatDisplay navigation (exposed via forwardRef)
  const chatDisplayRef = React.useRef<ChatDisplayHandle>(null)
  // Track match count and index from ChatDisplay (for SessionList navigation UI)
  const [chatMatchInfo, setChatMatchInfo] = React.useState<{ sessionId: string | null; count: number; index: number; isHighlighting?: boolean }>({ sessionId: null, count: 0, index: 0 })

  // Memo guard prevents render feedback loops from identical updates
  const handleChatMatchInfoChange = React.useCallback((info: { sessionId: string | null; count: number; index: number; isHighlighting: boolean }) => {
    setChatMatchInfo(prev => {
      if (prev.sessionId === info.sessionId && prev.count === info.count && prev.index === info.index && prev.isHighlighting === info.isHighlighting) {
        return prev
      }
      return info
    })
  }, [])

  // Reset match info when search is deactivated
  React.useEffect(() => {
    if (!searchActive || !searchQuery) {
      setChatMatchInfo({ sessionId: null, count: 0, index: 0 })
    }
  }, [searchActive, searchQuery])

  // Reset search when the column switches body or between active/archived (not when selecting sessions)
  const navFilterKey = isSessionsNavigation(navState) ? `sessions:${navState.filter.kind}` : navState.navigator
  React.useEffect(() => {
    setSearchActive(false)
    setSearchQuery('')
  }, [navFilterKey])

  // Cmd+F to activate search
  useAction('app.search', () => setSearchActive(true))

  // Sources state (workspace-scoped)
  const [sources, setSources] = React.useState<LoadedSource[]>([])
  const [chatStarters, setChatStarters] = React.useState<Array<{ label: string; prompt: string }> | undefined>(undefined)
  // Sync sources to atom for NavigationContext auto-selection
  const setSourcesAtom = useSetAtom(sourcesAtom)
  React.useEffect(() => {
    setSourcesAtom(sources)
  }, [sources, setSourcesAtom])

  // Skills state (workspace-scoped)
  const [skills, setSkills] = React.useState<LoadedSkill[]>([])
  const setSkillsAtom = useSetAtom(skillsAtom)
  React.useEffect(() => {
    setSkillsAtom(skills)
  }, [skills, setSkillsAtom])

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Send to Workspace dialog state (driven by sendToWorkspaceAtom set from SessionMenu/BatchSessionMenu)
  const sendToWorkspaceIds = useAtomValue(sendToWorkspaceAtom)
  const setSendToWorkspaceIds = useSetAtom(sendToWorkspaceAtom)
  const handleTransferComplete = useCallback((targetWorkspaceId: string, _newSessionIds: string[]) => {
    onSelectWorkspace(targetWorkspaceId)
  }, [onSelectWorkspace])
  const {
    automations, automationTestResults,
    automationPendingDelete, pendingDeleteAutomation, setAutomationPendingDelete,
    handleTestAutomation, handleToggleAutomation, handleDuplicateAutomation, handleDeleteAutomation, confirmDeleteAutomation,
    getAutomationHistory, handleReplayAutomation,
  } = useAutomations(activeWorkspaceId)

  const { projects } = useProjects(activeWorkspaceId)
  const projectMenuOptions = useMemo(
    () => projects.map(p => ({ id: p.config.id, slug: p.config.slug, name: p.config.name, color: p.config.color })),
    [projects],
  )
  const handleSessionProjectChange = useCallback(async (sessionId: string, projectId: string | null) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setProjectId', projectId })
    } catch (err) {
      console.error('[AppShell] Failed to update session project:', err)
      toast.error(t('toast.failedToUpdateProject'))
    }
  }, [t])

  // Whether local MCP servers are enabled (affects stdio source status)
  const [localMcpEnabled, setLocalMcpEnabled] = React.useState(true)

  // Enabled permission modes for Shift+Tab cycling (min 2 modes)
  const [enabledModes, setEnabledModes] = React.useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])

  // Load workspace settings (localMcpEnabled, cyclablePermissionModes, chatStarters) on workspace
  // change, and again when a settings page reports a change to the active workspace
  const loadWorkspaceSettings = React.useCallback(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then((settings) => {
      if (settings) {
        setLocalMcpEnabled(settings.localMcpEnabled ?? true)
        if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
          setEnabledModes(settings.cyclablePermissionModes)
        }
        setChatStarters(settings.chatStarters && settings.chatStarters.length > 0 ? settings.chatStarters : undefined)
      }
    }).catch((err) => {
      console.error('[Chat] Failed to load workspace settings:', err)
    })
  }, [activeWorkspaceId])

  React.useEffect(() => {
    loadWorkspaceSettings()
  }, [loadWorkspaceSettings])

  React.useEffect(() => {
    const handleChanged = (event: Event) => {
      const changedId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      if (!changedId || changedId === activeWorkspaceId) loadWorkspaceSettings()
    }
    window.addEventListener(WORKSPACE_SETTINGS_CHANGED_EVENT, handleChanged)
    return () => window.removeEventListener(WORKSPACE_SETTINGS_CHANGED_EVENT, handleChanged)
  }, [activeWorkspaceId, loadWorkspaceSettings])

  // Guarded permission mode is offered while the decision layer and its `guardedMode` feature
  // are on, on the server this workspace talks to. Refreshed on workspace switch and when the AI
  // settings page saves decision model settings.
  const guardedModeAvailable = useAtomValue(guardedModeAvailableAtom)
  const setGuardedModeAvailable = useSetAtom(guardedModeAvailableAtom)
  React.useEffect(() => {
    if (!activeWorkspaceId || typeof window.electronAPI?.getDecisionLayerStatus !== 'function') return
    let cancelled = false
    const refresh = () => {
      window.electronAPI.getDecisionLayerStatus().then((status) => {
        // Offered only when the check can actually run: switched on and a key (or keyless provider) to call it with.
        const { settings } = status
        const preset = status.presets.find(p => p.id === settings.provider)
        const hasKey = !!settings.connectionSlug || status.providersWithKey.includes(settings.provider) || preset?.requiresKey === false
        if (!cancelled) setGuardedModeAvailable(settings.enabled && settings.features.guardedMode === true && hasKey)
      }).catch((err) => {
        console.error('[AppShell] Failed to load decision model status:', err)
        if (!cancelled) setGuardedModeAvailable(false)
      })
    }
    refresh()
    window.addEventListener(DECISION_SETTINGS_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(DECISION_SETTINGS_CHANGED_EVENT, refresh)
    }
  }, [activeWorkspaceId, setGuardedModeAvailable])

  // Reset transient UI state on workspace SWITCH (not initial mount) and load the workspace's grouping
  const previousWorkspaceRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    const previousWorkspaceId = previousWorkspaceRef.current
    if (previousWorkspaceId !== null && previousWorkspaceId !== activeWorkspaceId) {
      setSearchActive(false)
      setSearchQuery('')
    }
    if (previousWorkspaceId !== activeWorkspaceId) {
      setGrouping(storage.get<SessionGrouping>(storage.KEYS.sessionGrouping, 'project', activeWorkspaceId))
    }
    previousWorkspaceRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  // Load sources from backend on mount
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSources(activeWorkspaceId).then((loaded) => {
      setSources(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load sources:', err)
    })
  }, [activeWorkspaceId])

  // Subscribe to live source updates (when sources are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSourcesChanged((workspaceId, updatedSources) => {
      if (workspaceId !== activeWorkspaceId) return
      // Clear icon cache so updated source icons are re-fetched on render
      clearSourceIconCaches()
      setSources(updatedSources || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  // Subscribe to live skill updates (when skills are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSkillsChanged((workspaceId, updatedSkills) => {
      if (workspaceId !== activeWorkspaceId) return
      setSkills(updatedSkills || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  // Handle session source selection changes
  const handleSessionSourcesChange = React.useCallback(async (sessionId: string, sourceSlugs: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setSources', sourceSlugs })
    } catch (err) {
      console.error('[Chat] Failed to set session sources:', err)
    }
  }, [])

  // Handle session label changes (add/remove via # menu or badge X)
  const handleSessionLabelsChange = React.useCallback(async (sessionId: string, labels: string[]) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setLabels', labels })
    } catch (err) {
      console.error('[Chat] Failed to set session labels:', err)
    }
  }, [])

  // Load dynamic statuses from workspace config
  const { statuses: statusConfigs } = useStatuses(activeWorkspace?.id || null)
  const [sessionStatuses, setSessionStatuses] = React.useState<SessionStatus[]>([])

  // Convert StatusConfig to SessionStatus with resolved icons
  React.useEffect(() => {
    if (!activeWorkspace?.id || statusConfigs.length === 0) {
      setSessionStatuses([])
      return
    }
    setSessionStatuses(statusConfigsToSessionStatuses(statusConfigs, activeWorkspace.id, isDark))
  }, [statusConfigs, activeWorkspace?.id, isDark])

  // Load labels from workspace config (assigned from the session menu, shown as row badges)
  const { labels: labelConfigs } = useLabels(activeWorkspace?.id || null)
  const displayLabelConfigs = useMemo(() => sortLabelsForDisplay(labelConfigs), [labelConfigs])

  // Ensure session messages are loaded when selected
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)

  // Handle selecting a source from the list
  const handleSourceSelect = React.useCallback((source: LoadedSource) => {
    if (!activeWorkspaceId) return
    navigateToSource(source.config.slug)
  }, [activeWorkspaceId, navigateToSource])

  // Handle selecting a skill from the list
  const handleSkillSelect = React.useCallback((skill: LoadedSkill) => {
    if (!activeWorkspaceId) return
    navigate(routes.view.skills(skill.slug))
  }, [activeWorkspaceId])

  // Handle selecting an automation from the list (keeps the current type filter)
  const handleAutomationSelect = React.useCallback((automationId: string) => {
    navigate(routes.view.automations({ automationId, type: automationFilter?.automationType }))
  }, [automationFilter?.automationType])

  // Focus zone management
  const { focusZone, focusNextZone } = useFocusContext()

  // Zone navigation - explicit keyboard intent, always move DOM focus
  useAction('nav.focusSidebar', () => focusZone('navigator', { intent: 'keyboard' }))
  useAction('nav.focusNavigator', () => focusZone('navigator', { intent: 'keyboard' }))
  useAction('nav.focusChat', () => focusZone('chat', { intent: 'keyboard' }))

  // Tab navigation between zones
  useAction('nav.nextZone', () => {
    focusNextZone()
  }, { enabled: () => !document.querySelector('[role="dialog"]') })

  // In multi-panel, actions target the focused panel's session
  const effectiveSessionId = focusedSessionId ?? session.selected

  // Focus chat input for the target session only (multi-panel safe).
  const focusChatInputForSession = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) return
    dispatchFocusInputEvent({ sessionId: targetSessionId })
  }, [])

  // Shift+Tab cycles permission mode through enabled modes (textarea handles its own, this handles when focus is elsewhere)
  useAction('chat.cyclePermissionMode', () => {
    if (effectiveSessionId) {
      const currentOptions = contextValue.sessionOptions.get(effectiveSessionId)
      const currentMode = currentOptions?.permissionMode ?? 'ask'
      // An unavailable Guarded behaves as Ask, so it stands in as Ask (never re-adding Execute
      // the user left out of the cycle).
      const base = enabledModes.length >= 2 ? enabledModes : DEFAULT_PERMISSION_MODES
      const listed = base
        .map(mode => (mode === 'guarded' && !guardedModeAvailable ? 'ask' : mode))
        .filter((mode, index, all) => all.indexOf(mode) === index)
      const modes = listed.length >= 2 ? listed : (['safe', 'ask'] as PermissionMode[])
      const currentIndex = modes.indexOf(currentMode)
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length
      contextValue.onSessionOptionsChange(effectiveSessionId, { permissionMode: modes[nextIndex] })
    }
  })

  // Whether the next column show-hide animates: pointer toggles glide (FLIP), keyboard toggles
  // (⌘B, ⌘., menu accelerators) are instant — spec §6.1. Set in the same batch as the toggle.
  const [animateShellLayout, setAnimateShellLayout] = React.useState(true)

  const handleToggleSidebar = useCallback(() => {
    if (isSidebarAndNavigatorHidden) {
      setIsSidebarAndNavigatorHidden(false)
      setIsSidebarVisible(true)
      return
    }
    setIsSidebarVisible(v => !v)
  }, [isSidebarAndNavigatorHidden])

  const handleToggleSidebarFromPointer = useCallback(() => {
    setAnimateShellLayout(true)
    handleToggleSidebar()
  }, [handleToggleSidebar])

  const handleToggleFocusModeFromPointer = useCallback(() => {
    setAnimateShellLayout(true)
    setIsSidebarAndNavigatorHidden(v => !v)
  }, [])

  // Sidebar toggle (CMD+B)
  useAction('view.toggleSidebar', () => {
    setAnimateShellLayout(false)
    handleToggleSidebar()
  })

  // Focus mode toggle (CMD+.)
  useAction('view.toggleFocusMode', () => {
    setAnimateShellLayout(false)
    setIsSidebarAndNavigatorHidden(v => !v)
  })

  // Panel focus navigation (CMD+SHIFT+[ / ])
  const focusNextPanel = useSetAtom(focusNextPanelAtom)
  const focusPrevPanel = useSetAtom(focusPrevPanelAtom)
  useAction('panel.focusNext', focusNextPanel, { enabled: () => panelCount > 1 })
  useAction('panel.focusPrev', focusPrevPanel, { enabled: () => panelCount > 1 })

  // New chat
  useAction('app.newChat', () => handleNewChat())
  useAction('app.newChatInPanel', () => handleNewChat(true))

  // Settings
  useAction('app.settings', onOpenSettings)

  // Keyboard shortcuts
  useAction('app.keyboardShortcuts', onOpenKeyboardShortcuts)

  // New window
  useAction('app.newWindow', () => window.electronAPI.menuNewWindow())

  // Quit (note: also handled by native menu on macOS)
  useAction('app.quit', () => window.electronAPI.menuQuit())

  // History navigation (and arrow key alternatives)
  useAction('nav.goBack', goBack)
  useAction('nav.goForward', goForward)
  useAction('nav.goBackAlt', goBack)
  useAction('nav.goForwardAlt', goForward)

  // Search match navigation (CMD+G next, CMD+SHIFT+G prev)
  useAction('chat.nextSearchMatch', () => chatDisplayRef.current?.goToNextMatch(), {
    enabled: () => searchActive && (chatMatchInfo.count ?? 0) > 0
  })
  useAction('chat.prevSearchMatch', () => chatDisplayRef.current?.goToPrevMatch(), {
    enabled: () => searchActive && (chatMatchInfo.count ?? 0) > 0
  })

  // Use session metadata from Jotai atom (lightweight, no messages)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  // ESC to stop processing - requires double-press within 1 second
  // First press shows warning overlay, second press interrupts
  useAction('chat.stopProcessing', () => {
    if (effectiveSessionId) {
      const meta = sessionMetaMap.get(effectiveSessionId)
      if (meta?.isProcessing) {
        const shouldInterrupt = handleEscapePress()
        if (shouldInterrupt) {
          window.electronAPI.cancelProcessing(effectiveSessionId, false).catch(err => {
            console.error('[AppShell] Failed to cancel processing:', err)
          })
        }
      }
    }
  }, {
    // Overlays (dialogs, menus, popovers, etc.) handle their own Escape
    enabled: () => {
      if (hasOpenOverlay()) return false
      if (!effectiveSessionId) return false
      const meta = sessionMetaMap.get(effectiveSessionId)
      return meta?.isProcessing ?? false
    }
  }, [effectiveSessionId, handleEscapePress])

  // Theme toggle (CMD+SHIFT+A)
  useAction('app.toggleTheme', () => setMode(resolvedMode === 'dark' ? 'light' : 'dark'))

  // Global paste listener for file attachments
  // Fires when Cmd+V is pressed anywhere in the app (not just textarea)
  React.useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return
      // Let inputs/textareas/contenteditables handle their own paste
      const activeElement = document.activeElement as HTMLElement | null
      if (
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'INPUT' ||
        activeElement?.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      // Dispatch custom event for FreeFormInput to handle (target focused session only)
      const targetSessionId = focusedSessionId ?? session.selected
      if (!targetSessionId) return
      window.dispatchEvent(new CustomEvent('craft:paste-files', {
        detail: { files: Array.from(files), sessionId: targetSessionId }
      }))
    }

    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [focusedSessionId, session.selected])

  // Resize the session column
  React.useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX - PANEL_EDGE_INSET, SESSION_COLUMN_MIN_WIDTH), SESSION_COLUMN_MAX_WIDTH)
      setSessionListWidth(newWidth)
      if (sessionListHandleRef.current) {
        const rect = sessionListHandleRef.current.getBoundingClientRect()
        setSessionListHandleY(e.clientY - rect.top)
      }
    }

    const handleMouseUp = () => {
      storage.set(storage.KEYS.sessionListWidth, sessionListWidth)
      setSessionListHandleY(null)
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, sessionListWidth])

  const hasPendingPrompt = React.useCallback((sessionId: string) => {
    return (pendingPermissions.get(sessionId)?.length ?? 0) > 0
  }, [pendingPermissions])

  // Workspace-level unread indicators (needed for workspace selectors across all workspaces)
  const [workspaceUnreadMap, setWorkspaceUnreadMap] = useState<Record<string, boolean>>({})

  // Reload skills when active session's workingDirectory changes (for project-level skills)
  // Skills are loaded from: global (~/.agents/skills/), workspace, and project ({workingDirectory}/.agents/skills/)
  const activeSessionWorkingDirectory = session.selected
    ? sessionMetaMap.get(session.selected)?.workingDirectory
    : undefined
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSkills(activeWorkspaceId, activeSessionWorkingDirectory).then((loaded) => {
      setSkills(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load skills:', err)
    })
  }, [activeWorkspaceId, activeSessionWorkingDirectory])

  // Filter session metadata by active workspace, excluding hidden (mini-agent) sessions.
  // For remote workspaces, sessions have the remote workspace ID (not the local one),
  // so we match against both the local and remote workspace IDs.
  const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId
  const workspaceSessionMetas = useMemo(() => {
    const metas = Array.from(sessionMetaMap.values())
    if (!activeWorkspaceId) return metas.filter(s => !s.hidden)
    return metas.filter(s =>
      !s.hidden && (s.workspaceId === activeWorkspaceId || (remoteWorkspaceId && s.workspaceId === remoteWorkspaceId))
    )
  }, [sessionMetaMap, activeWorkspaceId, remoteWorkspaceId])

  // Active sessions exclude archived
  const activeSessionMetas = useMemo(() => workspaceSessionMetas.filter(s => !s.isArchived), [workspaceSessionMetas])
  const archivedCount = workspaceSessionMetas.length - activeSessionMetas.length

  const refreshWorkspaceUnreadMap = useCallback(async () => {
    try {
      const summary = await window.electronAPI.getUnreadSummary()
      const next: Record<string, boolean> = {}
      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }
      setWorkspaceUnreadMap(next)
    } catch (error) {
      console.error('[AppShell] Failed to refresh workspace unread indicators:', error)
    }
  }, [workspaces])

  // Initial + workspace-list refresh
  useEffect(() => {
    void refreshWorkspaceUnreadMap()
  }, [refreshWorkspaceUnreadMap])

  // Keep active workspace unread indicator in sync with live metadata updates
  useEffect(() => {
    if (!activeWorkspaceId) return
    const activeHasUnread = activeSessionMetas.some((s) => !!s.hasUnread)
    setWorkspaceUnreadMap((prev) => ({ ...prev, [activeWorkspaceId]: activeHasUnread }))
  }, [activeWorkspaceId, activeSessionMetas])

  // Keep cross-workspace indicators in sync with global unread updates from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onUnreadSummaryChanged((summary) => {
      const next: Record<string, boolean> = {}
      for (const workspace of workspaces) {
        next[workspace.id] = !!summary.hasUnreadByWorkspace[workspace.id]
      }
      setWorkspaceUnreadMap(next)
    })
    return cleanup
  }, [workspaces])

  // Ensure session messages are loaded when selected
  React.useEffect(() => {
    if (session.selected) {
      ensureMessagesLoaded(session.selected)
    }
  }, [session.selected, ensureMessagesLoaded])

  // Wrap delete handler to clear selection when deleting the currently selected session
  // This prevents stale state during re-renders that could cause crashes
  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation?: boolean): Promise<boolean> => {
    if (session.selected === sessionId) {
      setSession({ selected: null })
    }
    return onDeleteSession(sessionId, skipConfirmation)
  }, [session.selected, setSession, onDeleteSession])

  // Extend context value with local overrides
  const appShellContextValue = React.useMemo<AppShellContextType>(() => ({
    ...contextValue,
    onDeleteSession: handleDeleteSession,
    enabledSources: sources,
    skills,
    chatStarters,
    activeSessionWorkingDirectory,
    labels: displayLabelConfigs,
    onSessionLabelsChange: handleSessionLabelsChange,
    enabledModes,
    sessionStatuses,
    onSessionSourcesChange: handleSessionSourcesChange,
    rightSidebarButton: null,
    isCompactMode: isAutoCompact,
    // Search state for ChatDisplay highlighting
    sessionListSearchQuery: searchActive ? searchQuery : undefined,
    isSearchModeActive: searchActive,
    chatDisplayRef,
    onChatMatchInfoChange: handleChatMatchInfoChange,
    onTestAutomation: handleTestAutomation,
    onToggleAutomation: handleToggleAutomation,
    onDuplicateAutomation: handleDuplicateAutomation,
    onDeleteAutomation: handleDeleteAutomation,
    automationTestResults,
    getAutomationHistory,
    onReplayAutomation: handleReplayAutomation,
  }), [contextValue, handleDeleteSession, sources, skills, chatStarters, activeSessionWorkingDirectory, displayLabelConfigs, handleSessionLabelsChange, enabledModes, sessionStatuses, handleSessionSourcesChange, isAutoCompact, searchActive, searchQuery, handleChatMatchInfoChange, handleTestAutomation, handleToggleAutomation, handleDuplicateAutomation, handleDeleteAutomation, automationTestResults, getAutomationHistory, handleReplayAutomation])

  // Persist column visibility and focus mode
  React.useEffect(() => {
    storage.set(storage.KEYS.sessionColumnVisible, isSidebarVisible)
  }, [isSidebarVisible])
  React.useEffect(() => {
    storage.set(storage.KEYS.focusModeEnabled, isSidebarAndNavigatorHidden)
  }, [isSidebarAndNavigatorHidden])

  // Listen for focus mode toggle from menu (View → Focus Mode)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleFocusMode?.(() => {
      setAnimateShellLayout(false)
      setIsSidebarAndNavigatorHidden(v => !v)
    })
    return cleanup
  }, [])

  // Listen for sidebar toggle from menu (View → Toggle Sidebar)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleSidebar?.(() => {
      setAnimateShellLayout(false)
      handleToggleSidebar()
    })
    return cleanup
  }, [handleToggleSidebar])

  // Back to the session list, keeping the last open session
  const handleBackToSessions = useCallback(() => {
    navigate(routes.view.allSessions(session.selected ?? undefined))
  }, [session.selected])

  const handleToggleArchived = useCallback(() => {
    navigate(showingArchived ? routes.view.allSessions() : routes.view.archived())
  }, [showingArchived])

  // Footer: open a capability panel in the column; clicking the open one returns to the sessions
  const handleNavSectionSelect = useCallback((section: Exclude<NavSection, 'sessions'>) => {
    if (section === navSection) {
      handleBackToSessions()
      return
    }
    switch (section) {
      case 'sources': navigate(routes.view.sources()); break
      case 'skills': navigate(routes.view.skills()); break
      case 'automations': navigate(routes.view.automationsScheduled()); break
      case 'settings': navigate(routes.view.settings()); break
    }
  }, [navSection, handleBackToSessions])

  // Handler for settings view. With no arg → bare `settings` route (navigator-only
  // in compact mode, App fallback on desktop). With an arg → `settings/<subpage>`.
  const handleSettingsClick = useCallback((subpage?: SettingsSubpage) => {
    navigate(routes.view.settings(subpage))
  }, [])

  // "New project" opens a name dialog so slugs stay meaningful
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false)
  const openAddProject = useCallback(() => {
    if (!activeWorkspace?.id) return
    setCreateProjectDialogOpen(true)
  }, [activeWorkspace?.id])
  const handleCreateProjectSubmit = useCallback(async (name: string) => {
    if (!activeWorkspace?.id) return
    setCreateProjectDialogOpen(false)
    try {
      const project = await window.electronAPI.createProject(activeWorkspace.id, { name })
      navigate(routes.view.projects(project.slug))
    } catch (err) {
      console.error('[AppShell] Failed to create project:', err)
      toast.error(t('projectsList.createFailed'))
    }
  }, [activeWorkspace?.id, t])

  // Create a new chat and select it; `project` binds it (and its working folder) to a project
  const handleNewChat = useCallback((newPanel: boolean = false, project?: string) => {
    if (!activeWorkspace) return
    setSearchActive(false)
    setSearchQuery('')
    navigate(
      routes.action.newSession(project ? { project } : undefined),
      newPanel ? { newPanel: true, targetLaneId: 'main' } : undefined
    )
    // Focus the chat input after navigation completes
    setTimeout(() => focusZone('chat', { intent: 'programmatic' }), 50)
  }, [activeWorkspace, focusZone])

  const handleOpenProject = useCallback((projectSlug: string) => {
    navigate(routes.view.projects(projectSlug))
  }, [])

  // Create a brand new dedicated browser window and focus it.
  const handleNewBrowserWindow = useCallback(async () => {
    try {
      const instanceId = await window.electronAPI.browserPane.create({ show: true })
      await window.electronAPI.browserPane.focus(instanceId)
    } catch (error) {
      console.error('[Chat] Failed to create browser window:', error)
      toast.error(t('toast.failedToCreateBrowser'))
    }
  }, [t])

  const handleDeleteSource = useCallback(async (sourceSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSource(activeWorkspace.id, sourceSlug)
      toast.success(t('toast.deletedSource'))
    } catch (error) {
      console.error('[Chat] Failed to delete source:', error)
      toast.error(t('toast.failedToDeleteSource'))
    }
  }, [activeWorkspace, t])

  const handleDeleteSkill = useCallback(async (skillSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSkill(activeWorkspace.id, skillSlug)
      toast.success(t('toast.deletedSkill', { slug: skillSlug }))
    } catch (error) {
      console.error('[Chat] Failed to delete skill:', error)
      toast.error(t('toast.failedToDeleteSkill'))
    }
  }, [activeWorkspace, t])

  // Respond to menu bar "New Chat" trigger
  const menuTriggerRef = useRef(menuNewChatTrigger)
  useEffect(() => {
    if (menuTriggerRef.current === menuNewChatTrigger) return
    menuTriggerRef.current = menuNewChatTrigger
    handleNewChat()
  }, [menuNewChatTrigger, handleNewChat])

  const newChatHotkey = useActionLabel('app.newChat').hotkey

  // Header of the column for the open capability panel
  const capabilityTitle = navSection === 'sources'
    ? t('sidebar.mcps')
    : navSection === 'skills'
      ? t('sidebar.skills')
      : navSection === 'automations'
        ? t('sidebar.automations')
        : t('sidebar.settings')

  const capabilityActions = activeWorkspace && (
    navSection === 'sources' ? (
      <EditPopover
        trigger={<HeaderIconButton icon={<Plus className="h-4 w-4" />} tooltip={t("sidebarMenu.addSource")} data-tutorial="add-source-button" />}
        {...getEditConfig('add-source-mcp', activeWorkspace.rootPath)}
      />
    ) : navSection === 'skills' ? (
      <EditPopover
        trigger={<HeaderIconButton icon={<Plus className="h-4 w-4" />} tooltip={t("sidebarMenu.addSkill")} data-tutorial="add-skill-button" />}
        {...getEditConfig('add-skill', activeWorkspace.rootPath)}
      />
    ) : navSection === 'automations' ? (
      <>
        <AutomationTypeToggle
          value={automationFilter?.automationType ?? 'scheduled'}
          onChange={(type) => navigate(type === 'scheduled' ? routes.view.automationsScheduled() : routes.view.automationsEvent())}
        />
        <EditPopover
          trigger={<HeaderIconButton icon={<Plus className="h-4 w-4" />} tooltip={t("sidebarMenu.addAutomation")} />}
          {...getEditConfig('automation-config', activeWorkspace.rootPath)}
        />
      </>
    ) : null
  )

  return (
    <AppShellProvider value={appShellContextValue}>
        {/* === TOP BAR === */}
        <TopBar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          workspaceUnreadMap={workspaceUnreadMap}
          onWorkspaceCreated={() => onRefreshWorkspaces?.()}
          onWorkspaceRemoved={() => onRefreshWorkspaces?.()}
          activeSessionId={effectiveSessionId}
          onNewChat={() => handleNewChat()}
          onNewWindow={() => window.electronAPI.menuNewWindow()}
          onOpenSettings={onOpenSettings}
          onOpenSettingsSubpage={handleSettingsClick}
          onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
          onOpenStoredUserPreferences={onOpenStoredUserPreferences}
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onToggleSidebar={handleToggleSidebarFromPointer}
          onToggleFocusMode={handleToggleFocusModeFromPointer}
          onAddSessionPanel={() => handleNewChat(true)}
          onAddBrowserPanel={() => { void handleNewBrowserWindow() }}
          isCompact={isAutoCompact}
        />

      {/* === OUTER LAYOUT: session column | content panels === */}
      <div
        ref={shellRef}
        className="flex items-stretch relative"
        style={{
          height: '100%',
          paddingRight: isAutoCompact ? 0 : PANEL_EDGE_INSET,
          paddingBottom: isAutoCompact ? 0 : PANEL_EDGE_INSET,
          paddingLeft: 0,
          gap: PANEL_GAP,
        }}
      >
        <PanelStackContainer
          navigatorSlot={
            <div
              style={{ width: isAutoCompact ? '100%' : sessionListWidth }}
              className="h-full flex flex-col min-w-0 relative z-panel @container/sessioncol"
              data-session-column
            >
              {navSection === 'sessions' ? (
                <SessionNavHeader
                  grouping={grouping}
                  onGroupingChange={handleGroupingChange}
                  showingArchived={showingArchived}
                  archivedCount={archivedCount}
                  onToggleArchived={handleToggleArchived}
                  searchActive={searchActive}
                  onSearch={() => setSearchActive(v => !v)}
                  onNewSession={(openInNewWindow) => handleNewChat(openInNewWindow)}
                  onNewProject={grouping === 'project' ? openAddProject : undefined}
                  newSessionHotkey={newChatHotkey}
                />
              ) : (
                <CapabilityNavHeader title={capabilityTitle} onBack={handleBackToSessions} actions={capabilityActions} />
              )}

              {navSection === 'sources' && (
                <SourcesListPanel
                  sources={sources}
                  sourceFilter={null}
                  workspaceRootPath={activeWorkspace?.rootPath}
                  onDeleteSource={handleDeleteSource}
                  onSourceClick={handleSourceSelect}
                  selectedSourceSlug={isSourcesNavigation(navState) && navState.details ? navState.details.sourceSlug : null}
                  localMcpEnabled={localMcpEnabled}
                />
              )}
              {navSection === 'skills' && activeWorkspaceId && (
                <SkillsListPanel
                  skills={skills}
                  workspaceId={activeWorkspaceId}
                  workspaceRootPath={activeWorkspace?.rootPath}
                  onSkillClick={handleSkillSelect}
                  onDeleteSkill={handleDeleteSkill}
                  selectedSkillSlug={isSkillsNavigation(navState) && navState.details?.type === 'skill' ? navState.details.skillSlug : null}
                />
              )}
              {navSection === 'automations' && (
                <AutomationsListPanel
                  automations={automations}
                  automationFilter={{ kind: AUTOMATION_TYPE_TO_FILTER_KIND[automationFilter?.automationType ?? 'scheduled'] ?? 'all' }}
                  onAutomationClick={handleAutomationSelect}
                  onTestAutomation={handleTestAutomation}
                  onToggleAutomation={handleToggleAutomation}
                  onDuplicateAutomation={handleDuplicateAutomation}
                  onDeleteAutomation={handleDeleteAutomation}
                  selectedAutomationId={isAutomationsNavigation(navState) && navState.details ? navState.details.automationId : null}
                  workspaceRootPath={activeWorkspace?.rootPath}
                />
              )}
              {navSection === 'settings' && isSettingsNavigation(navState) && (
                <SettingsNavigator
                  selectedSubpage={navState.subpage}
                  onSelectSubpage={(subpage) => handleSettingsClick(subpage)}
                />
              )}
              {navSection === 'sessions' && (
                <SessionList
                  key={showingArchived ? 'archived' : grouping}
                  items={searchActive ? workspaceSessionMetas : (showingArchived ? workspaceSessionMetas.filter(s => s.isArchived) : activeSessionMetas)}
                  onDelete={handleDeleteSession}
                  onFlag={onFlagSession}
                  onUnflag={onUnflagSession}
                  onArchive={onArchiveSession}
                  onUnarchive={onUnarchiveSession}
                  onMarkUnread={onMarkSessionUnread}
                  onSessionStatusChange={onSessionStatusChange}
                  onRename={onRenameSession}
                  onFocusChatInput={(targetSessionId) => {
                    focusChatInputForSession(targetSessionId ?? focusedSessionId ?? session.selected)
                  }}
                  onSessionSelect={(selectedMeta) => {
                    navigateToSession(selectedMeta.id)
                  }}
                  onOpenInNewWindow={(selectedMeta) => {
                    if (activeWorkspaceId) {
                      window.electronAPI.openSessionInNewWindow(activeWorkspaceId, selectedMeta.id)
                    }
                  }}
                  sessionOptions={sessionOptions}
                  searchActive={searchActive}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onSearchClose={() => {
                    setSearchActive(false)
                    setSearchQuery('')
                  }}
                  sessionStatuses={sessionStatuses}
                  labels={displayLabelConfigs}
                  onLabelsChange={handleSessionLabelsChange}
                  projects={projectMenuOptions}
                  onSetProjectId={handleSessionProjectChange}
                  groupingMode={showingArchived ? 'date' : grouping}
                  onNewSessionInProject={(projectId) => handleNewChat(false, projectId)}
                  onOpenProject={handleOpenProject}
                  workspaceId={activeWorkspaceId ?? undefined}
                  focusedSessionId={panelCount === 0 ? null : panelCount > 1 ? focusedSessionId : undefined}
                  onNavigateToSession={panelCount > 1 ? navigateToSessionInPanel : undefined}
                  hasPendingPrompt={hasPendingPrompt}
                  activeChatMatchInfo={chatMatchInfo}
                />
              )}

              <SessionNavFooter active={navSection} onSelect={handleNavSectionSelect} />

              {/* Mobile/compact-only FAB for starting a new chat — only on the session list */}
              {isAutoCompact && navSection === 'sessions' && !(isSessionsNavigation(navState) && navState.details) && (
                <FabNewChat onClick={() => handleNewChat()} />
              )}
            </div>
          }
          navigatorWidth={isAutoCompact ? sessionListWidth : (effectiveColumnHidden ? 0 : sessionListWidth)}
          isSidebarAndNavigatorHidden={effectiveColumnHidden}
          isRightSidebarVisible={false}
          isCompact={isAutoCompact}
          isResizing={isResizing}
          animateLayout={animateShellLayout}
        />

        {/* The list and the content share one card, so the column seam is the card's inner hairline */}
        {!effectiveColumnHidden && !isAutoCompact && (
          <ShellResizeHandle
            handleRef={sessionListHandleRef}
            left={PANEL_EDGE_INSET + sessionListWidth - PANEL_SASH_HALF_HIT_WIDTH}
            hoverY={sessionListHandleY}
            onHoverYChange={setSessionListHandleY}
            keepHoverOnLeave={isResizing}
            onDragStart={() => setIsResizing(true)}
          />
        )}
      </div>

      {/* Delete automation confirmation dialog */}
      <Dialog open={!!automationPendingDelete} onOpenChange={(open) => { if (!open) setAutomationPendingDelete(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("dialog.deleteAutomation.title")}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="dialog.deleteAutomation.description"
                values={{ name: pendingDeleteAutomation?.name }}
                components={{ strong: <strong /> }}
              />
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAutomationPendingDelete(null)}>{t("common.cancel")}</Button>
            <Button variant="danger-solid" onClick={confirmDeleteAutomation}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send to Workspace dialog (driven by sendToWorkspaceAtom) */}
      <SendToWorkspaceDialog
        open={sendToWorkspaceIds.length > 0}
        onOpenChange={(open) => { if (!open) setSendToWorkspaceIds([]) }}
        sessionIds={sendToWorkspaceIds}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onTransferComplete={handleTransferComplete}
      />

      {/* Create Project dialog — prompts for a name so slugs stay meaningful */}
      <CreateProjectDialog
        open={createProjectDialogOpen}
        onCancel={() => setCreateProjectDialogOpen(false)}
        onSubmit={handleCreateProjectSubmit}
      />

      {/* Messaging dialogs (pairing-code + WA connect) — driven by messagingDialogAtom.
          Mounted here so they survive context-menu / dropdown close. */}
      <MessagingDialogHost />

      {/* Asks to update rtk when Token Optimization is on but the installed rtk corrupts output */}
      <RtkUpdatePrompt workspaceId={activeWorkspaceId} />
    </AppShellProvider>
  )
}

/** Scheduled ⇄ event-triggered automations (agent events count as events). */
function AutomationTypeToggle({
  value,
  onChange,
}: {
  value: 'scheduled' | 'event'
  onChange: (value: 'scheduled' | 'event') => void
}) {
  const { t } = useTranslation()
  const options: Array<{ id: 'scheduled' | 'event'; label: string }> = [
    { id: 'scheduled', label: t('sidebar.scheduled') },
    { id: 'event', label: t('sidebar.eventBased') },
  ]
  return (
    <div role="radiogroup" className="titlebar-no-drag inline-flex items-center gap-0.5 rounded-md bg-fill-hover p-0.5">
      {options.map(option => (
        <Tooltip key={option.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={value === option.id}
              onClick={() => onChange(option.id)}
              className={cn(
                'h-control-sm rounded-sm px-2 text-label-sm whitespace-nowrap',
                'transition-[background-color,color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                value === option.id ? 'bg-floating text-foreground shadow-elev-1' : 'text-secondary hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{option.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
