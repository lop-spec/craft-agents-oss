import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench } from 'lucide-react'
import { SourceSelectorPopover } from '@/components/ui/SourceSelectorPopover'
import { CompactSourceSelector } from '@/components/ui/CompactSourceSelector'
import type { LoadedSource } from '../../../../shared/types'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'

interface ComposerSourcesChipProps {
  /** Compact/touch layout: bottom-sheet selector instead of the anchored popover */
  compact: boolean
  sources: LoadedSource[]
  /** Optimistic enabled source slugs (owned by FreeFormInput) */
  selectedSlugs: string[]
  onToggleSlug: (slug: string) => void
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  disabled: boolean
  buttonRef: React.RefObject<HTMLButtonElement>
}

/**
 * Tools chip in the composer toolbar (pi-web "wrench · tools"): the session's enabled sources (MCP).
 * Desktop anchors SourceSelectorPopover, compact opens CompactSourceSelector.
 */
export function ComposerSourcesChip({
  compact,
  sources,
  selectedSlugs,
  onToggleSlug,
  open,
  setOpen,
  disabled,
  buttonRef,
}: ComposerSourcesChipProps) {
  const { t } = useTranslation()
  const enabledSources = sources.filter(s => selectedSlugs.includes(s.config.slug))

  const icon = <Wrench className="h-3.5 w-3.5" />
  // No tools: "工具"; one: its name; more: "N 个工具"
  const label = enabledSources.length === 0
    ? t('chat.toolsChip')
    : enabledSources.length === 1
      ? enabledSources[0].config.name
      : t('chat.toolsChipCount', { count: enabledSources.length })

  if (compact) {
    return (
      <div className="relative min-w-0 shrink">
        <FreeFormInputContextBadge
          buttonRef={buttonRef}
          icon={icon}
          label={label}
          isExpanded={false}
          hasSelection={selectedSlugs.length > 0}
          showChevron={false}
          isOpen={open}
          disabled={disabled}
          onClick={() => setOpen(prev => !prev)}
          tooltip={t("chat.toolsTooltip")}
        />
        <CompactSourceSelector
          open={open}
          onOpenChange={setOpen}
          sources={sources}
          selectedSlugs={selectedSlugs}
          onToggleSlug={onToggleSlug}
        />
      </div>
    )
  }

  return (
    <div className="relative min-w-0 shrink overflow-hidden">
      <FreeFormInputContextBadge
        buttonRef={buttonRef}
        icon={icon}
        label={label}
        isExpanded={true}
        hasSelection={selectedSlugs.length > 0}
        showChevron={true}
        isOpen={open}
        disabled={disabled}
        data-tutorial="source-selector-button"
        onClick={() => setOpen(prev => !prev)}
        tooltip={t("chat.toolsTooltip")}
      />

      <SourceSelectorPopover
        open={open}
        onOpenChange={setOpen}
        anchorRef={buttonRef}
        sources={sources}
        selectedSlugs={selectedSlugs}
        onToggleSlug={onToggleSlug}
      />
    </div>
  )
}
