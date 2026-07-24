import { forwardRef } from 'react';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { YStack, XStack, SizableText, Spinner, ScrollView } from '@hanzo/gui';
import { t } from '@/services/i18n';
import type { PanelTab } from '@/components/Panel';

/**
 * Panel — the ONE React panel chassis, the @hanzo/gui analogue of the vanilla
 * `Panel` base (src/components/Panel.ts). Every ported panel renders into this
 * single chrome so a panel author writes only its body; the frame, the four
 * decomplected placeholder states, the tab bar, the sparkline slot and the header
 * slots live here once.
 *
 * Capability parity with the vanilla base (same behaviours, primitive-native):
 *   vanilla Panel                    →  React Panel
 *   ─────────────────────────────────────────────────────────────────────────────
 *   showLoading(msg)                 →  state="loading"  (loadingText)
 *   showError(msg)                   →  state="error"    (errorText)
 *   showEmpty(msg) / emptyStateHtml  →  state="empty"    (emptyText)
 *   setContent(html)                 →  children (state="ready", the default)
 *   header title                     →  title
 *   info "?" tooltip                 →  infoTooltip
 *   hover-✕ / menu affordances       →  actions slot (header right)
 *   header drag surface              →  dragHandle slot (PanelGrid supplies)
 *   renderTabs(tabs, active, onSel)  →  tabs / activeTab / onTabChange
 *   sparkline(...) util SVG          →  sparkline slot
 *
 * DRY: loading / empty / error copy defaults to the SAME i18n keys the vanilla base
 * uses (common.loading / common.failedToLoad / common.noDataAvailable) via the
 * shared `t`; the `PanelTab` descriptor is imported verbatim from the vanilla base —
 * one tab shape across both surfaces. Style props are LONGHAND-only (see
 * gui.config.ts) and brand-token themed.
 */

export type PanelState = 'ready' | 'loading' | 'empty' | 'error';

export interface PanelProps {
  /** Header title (uppercased, tracked — the vanilla `.panel-title` look). */
  title: string;
  /** Body. Shown when `state` is "ready" (the default). */
  children?: ReactNode;
  /** Which of the four decomplected states to show. Defaults to "ready". */
  state?: PanelState;
  /** Copy for the placeholder states; each defaults to the vanilla i18n string. */
  loadingText?: string;
  emptyText?: string;
  errorText?: string;
  /** Optional tab bar (same descriptor as the vanilla base). */
  tabs?: readonly PanelTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** Optional header-right slot for actions (hide ✕, menu, live dot, …). */
  actions?: ReactNode;
  /** Optional "?" methodology tooltip text (plain text). */
  infoTooltip?: string;
  /** Optional sparkline/visual slot rendered under the header, above the body. */
  sparkline?: ReactNode;
  /** Optional drag affordance, supplied by PanelGrid; rendered in the header. */
  dragHandle?: ReactNode;
  /** Chrome sizing. Defaults match the floating-rail card. */
  width?: number | string;
  maxHeight?: number | string;
  /** Whether the body scrolls when it overflows maxHeight. Default true. */
  scroll?: boolean;
}

const BORDER = 'rgba(255,255,255,0.12)';
const BORDER_SOFT = 'rgba(255,255,255,0.10)';
const CARD_BG = 'rgba(12,12,14,0.82)';

/** The pulsing "live" dot the vanilla header shows when data is live. */
export function PanelLiveDot(): React.JSX.Element {
  return (
    <XStack width={6} height={6} borderRadius={999} backgroundColor="#fff" opacity={0.7} />
  );
}

function PanelHeader({
  title,
  infoTooltip,
  actions,
  dragHandle,
}: Pick<PanelProps, 'title' | 'infoTooltip' | 'actions' | 'dragHandle'>): React.JSX.Element {
  return (
    <XStack
      className="panel-header"
      paddingHorizontal="$3"
      paddingVertical="$2.5"
      alignItems="center"
      justifyContent="space-between"
      borderBottomWidth={1}
      borderColor={BORDER_SOFT}
      cursor={dragHandle ? 'grab' : undefined}
    >
      <XStack alignItems="center" gap="$2" flex={1}>
        {dragHandle}
        <SizableText
          size="$2"
          color="$color11"
          style={{ textTransform: 'uppercase', letterSpacing: 1 }}
          numberOfLines={1}
        >
          {title}
        </SizableText>
        {infoTooltip ? (
          <SizableText size="$1" color="$color9" aria-label={infoTooltip} style={{ cursor: 'help' }}>
            ?
          </SizableText>
        ) : null}
      </XStack>
      <XStack alignItems="center" gap="$2">
        {actions ?? <PanelLiveDot />}
      </XStack>
    </XStack>
  );
}

/** Loading state — Spinner + text, the primitive-native analogue of the radar sweep. */
function PanelLoading({ text }: { text: string }): React.JSX.Element {
  return (
    <XStack alignItems="center" gap="$2.5" paddingVertical="$2">
      <Spinner size="small" color="$color9" />
      <SizableText size="$2" color="$color9">
        {text}
      </SizableText>
    </XStack>
  );
}

/** The one empty state — the `.panel-empty` analogue. */
function PanelEmpty({ text }: { text: string }): React.JSX.Element {
  return (
    <SizableText size="$2" color="$color9" paddingVertical="$2">
      {text}
    </SizableText>
  );
}

/** The one error state — the `.error-message` analogue. */
function PanelError({ text }: { text: string }): React.JSX.Element {
  return (
    <SizableText size="$2" color="#ef4444" paddingVertical="$2">
      {text}
    </SizableText>
  );
}

/** The one tab bar — `.panel-tabs` analogue, same PanelTab descriptor + onSelect. */
function PanelTabs({
  tabs,
  activeTab,
  onTabChange,
}: Required<Pick<PanelProps, 'tabs'>> & Pick<PanelProps, 'activeTab' | 'onTabChange'>): React.JSX.Element {
  return (
    <XStack
      gap="$1"
      paddingHorizontal="$3"
      paddingTop="$2"
      role="tablist"
      flexWrap="wrap"
    >
      {tabs.map((tab) => {
        const on = tab.key === activeTab;
        return (
          <XStack
            key={tab.key}
            role="tab"
            aria-selected={on}
            tabIndex={0}
            cursor="pointer"
            alignItems="center"
            gap="$1"
            paddingHorizontal="$2"
            paddingVertical="$1"
            borderRadius="$3"
            backgroundColor={on ? 'rgba(255,255,255,0.14)' : 'transparent'}
            hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
            pressStyle={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
            onPress={() => onTabChange?.(tab.key)}
          >
            <SizableText size="$2" color={on ? '$color12' : '$color10'}>
              {tab.label}
            </SizableText>
            {tab.count != null ? (
              <SizableText size="$1" color="$color9">
                {tab.count}
              </SizableText>
            ) : null}
          </XStack>
        );
      })}
    </XStack>
  );
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  {
    title,
    children,
    state = 'ready',
    loadingText,
    emptyText,
    errorText,
    tabs,
    activeTab,
    onTabChange,
    actions,
    infoTooltip,
    sparkline,
    dragHandle,
    width = 340,
    maxHeight = '70vh',
    scroll = true,
  },
  ref,
): React.JSX.Element {
  const Body = (
    <YStack paddingHorizontal="$3" paddingVertical="$2.5" gap="$2">
      {state === 'loading' ? (
        <PanelLoading text={loadingText ?? t('common.loading')} />
      ) : state === 'error' ? (
        <PanelError text={errorText ?? t('common.failedToLoad')} />
      ) : state === 'empty' ? (
        <PanelEmpty text={emptyText ?? t('common.noDataAvailable')} />
      ) : (
        children
      )}
    </YStack>
  );

  return (
    <YStack
      // On web the YStack host IS the HTMLDivElement PanelGrid needs for the drag
      // engine; bridge the ref types at this one boundary (runtime-guaranteed).
      ref={ref as Ref<ComponentRef<typeof YStack>>}
      className="panel"
      width={width}
      maxHeight={maxHeight}
      borderRadius="$4"
      borderWidth={1}
      borderColor={BORDER}
      backgroundColor={CARD_BG}
      overflow="hidden"
      style={{ backdropFilter: 'blur(12px)' }}
    >
      <PanelHeader title={title} infoTooltip={infoTooltip} actions={actions} dragHandle={dragHandle} />
      {tabs && tabs.length > 0 ? (
        <PanelTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
      ) : null}
      {sparkline ? (
        <YStack paddingHorizontal="$3" paddingTop="$2">
          {sparkline}
        </YStack>
      ) : null}
      {scroll ? <ScrollView flex={1}>{Body}</ScrollView> : Body}
    </YStack>
  );
});
