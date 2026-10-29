import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Lightbulb } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import { THINKING_LEVELS, getThinkingLevelNameKey, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { COMPOSER_CHIP } from './composer-styles'

/**
 * Reasoning level as its own chip next to the model (pi-web: bulb · level), instead of a
 * submenu inside the model menu.
 */
export function ComposerThinkingChip({
  thinkingLevel,
  disabled,
  onThinkingLevelChange,
}: {
  thinkingLevel: ThinkingLevel
  /** The current model has no reasoning control */
  disabled: boolean
  onThinkingLevelChange?: (level: ThinkingLevel) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const label = t(getThinkingLevelNameKey(thinkingLevel))
  const tooltip = disabled ? t('thinking.notSupported') : t('chat.reasoningLevel', { level: label })

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled || !onThinkingLevelChange}>
            <button
              type="button"
              aria-label={tooltip}
              className={cn(COMPOSER_CHIP, 'shrink-0 gap-1 pl-2 pr-1.5', open && 'bg-fill-hover text-foreground')}
            >
              <Lightbulb className="size-3.5 shrink-0" />
              <span className="whitespace-nowrap">{label}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
      <StyledDropdownMenuContent side="top" align="end" sideOffset={8} className="min-w-[220px]">
        {THINKING_LEVELS.map(({ id, nameKey, descriptionKey }) => (
          <StyledDropdownMenuItem
            key={id}
            onSelect={() => onThinkingLevelChange?.(id)}
            className="flex cursor-pointer items-center justify-between py-1.5"
          >
            <div className="text-left">
              <div className="text-label font-medium">{t(nameKey)}</div>
              <div className="text-label-sm text-tertiary">{t(descriptionKey)}</div>
            </div>
            {thinkingLevel === id && <Check className="ml-3 size-4 shrink-0 text-secondary" />}
          </StyledDropdownMenuItem>
        ))}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
