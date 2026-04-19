import { XStack, Text } from '@hanzo/gui';

export function HanzoLogo({ size = 18 }: { size?: number }) {
  return (
    <XStack alignItems="center" gap="$2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size + 4}
        height={size + 4}
        aria-hidden="true"
      >
        <rect x="1" y="1" width="22" height="22" rx="4" fill="currentColor" />
        <path d="M7 6h2.2v5h5.6V6H17v12h-2.2v-5H9.2v5H7z" fill="var(--background)" />
      </svg>
      <Text fontSize={15} fontWeight="600" letterSpacing={-0.2} color="$color">
        Hanzo
      </Text>
    </XStack>
  );
}
