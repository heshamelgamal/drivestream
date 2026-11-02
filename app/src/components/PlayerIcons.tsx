// Player icons drawn as SVG so the "10" sits exactly in the middle of its circle arrow.
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

// Circle arrow with the number inside: open at the top, arrowhead pointing back (↺).
// The forward version is the same drawing mirrored.
export function SkipIcon({ dir, size, seconds = 10, color = '#fff' }: { dir: 'back' | 'forward'; size: number; seconds?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G transform={dir === 'forward' ? 'translate(24 0) scale(-1 1)' : undefined}>
        <Path d="M12.6 3.2 A8.8 8.8 0 1 1 5.6 6.1" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
        <Path d="M12.9 0.6 L8.3 3.2 L12.9 5.8 Z" fill={color} />
      </G>
      <SvgText x={12} y={15.1} fontSize={8} fontWeight="bold" fill={color} textAnchor="middle">{seconds}</SvgText>
    </Svg>
  );
}

// Netflix's plain back arrow. `flip` points it right (Arabic, right-to-left).
export function BackIcon({ size, flip, color = '#fff' }: { size: number; flip?: boolean; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
      <Path d="M20.5 12H4.5M11 5.2 4.2 12l6.8 6.8" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
