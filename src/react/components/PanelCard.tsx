import { YStack, XStack, SizableText } from '@hanzo/gui';

/**
 * PanelCard — the shared React panel chrome (floating glass card + title bar) that
 * every ported panel renders into, the @hanzo/gui analogue of the vanilla `Panel`
 * base. One place owns the panel frame so individual panels carry only their body.
 */
export function PanelCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <YStack
      width={340}
      maxHeight="70vh"
      borderRadius="$4"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.12)"
      backgroundColor="rgba(12,12,14,0.82)"
      overflow="hidden"
      style={{ backdropFilter: 'blur(12px)' }}
    >
      <XStack
        px="$3"
        py="$2.5"
        ai="center"
        jc="space-between"
        borderBottomWidth={1}
        borderColor="rgba(255,255,255,0.10)"
      >
        <SizableText size="$2" color="$color11" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          {title}
        </SizableText>
        <XStack width={6} height={6} borderRadius={999} backgroundColor="#fff" opacity={0.7} />
      </XStack>
      <YStack px="$3" py="$2.5" overflow="scroll">
        {children}
      </YStack>
    </YStack>
  );
}
