import { Platform, useColorScheme, type TextStyle } from 'react-native';

/**
 * One warm-neutral ramp, one accent (spruce), and two semantic inks used only for
 * state text and icons. No gradients, no glows.
 */
export interface Palette {
  canvas: string;
  surface: string;
  sunken: string;
  ink: string;
  inkSecondary: string;
  inkTertiary: string;
  hairline: string;
  accent: string;
  accentInk: string; // text on accent
  accentTint: string;
  warning: string;
  warningTint: string;
  danger: string;
  dangerTint: string;
  /** Layered shadow used instead of borders on cards and secondary buttons. */
  shadowRing: string;
  shadowRingPressed: string;
  scheme: 'light' | 'dark';
}

const light: Palette = {
  canvas: '#F5F4F0',
  surface: '#FFFFFF',
  sunken: '#EDEBE6',
  ink: '#1C1B18',
  inkSecondary: '#5C5A54',
  inkTertiary: '#7C7A73',
  hairline: 'rgba(0, 0, 0, 0.08)',
  accent: '#2D5C4C',
  accentInk: '#FFFFFF',
  accentTint: 'rgba(45, 92, 76, 0.10)',
  warning: '#8F5B0E',
  warningTint: 'rgba(143, 91, 14, 0.10)',
  danger: '#A2392B',
  dangerTint: 'rgba(162, 57, 43, 0.09)',
  shadowRing:
    '0px 0px 0px 1px rgba(0, 0, 0, 0.06), 0px 1px 2px -1px rgba(0, 0, 0, 0.06), 0px 2px 4px 0px rgba(0, 0, 0, 0.04)',
  shadowRingPressed:
    '0px 0px 0px 1px rgba(0, 0, 0, 0.08), 0px 1px 2px -1px rgba(0, 0, 0, 0.08), 0px 2px 4px 0px rgba(0, 0, 0, 0.06)',
  scheme: 'light',
};

const dark: Palette = {
  canvas: '#121211',
  surface: '#1D1D1B',
  sunken: '#262624',
  ink: '#F1F0EC',
  inkSecondary: '#AEACA5',
  inkTertiary: '#8A8881',
  hairline: 'rgba(255, 255, 255, 0.10)',
  accent: '#7FC2A8',
  accentInk: '#0F1F19',
  accentTint: 'rgba(127, 194, 168, 0.14)',
  warning: '#E2B467',
  warningTint: 'rgba(226, 180, 103, 0.13)',
  danger: '#EF8B7B',
  dangerTint: 'rgba(239, 139, 123, 0.13)',
  shadowRing: '0px 0px 0px 1px rgba(255, 255, 255, 0.08)',
  shadowRingPressed: '0px 0px 0px 1px rgba(255, 255, 255, 0.13)',
  scheme: 'dark',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 28, xxl: 40 } as const;

/**
 * Radii. Group cards use 22 with 6 px inner padding around 16 px rows (16 + 6 = 22).
 * Content cards pad more than 24 px apart from their children, so they are independent.
 */
export const radius = { card: 22, row: 16, button: 14, chip: 999 } as const;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  largeTitle: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.4 } as TextStyle,
  title: { fontSize: 21, lineHeight: 27, fontWeight: '600', letterSpacing: -0.2 } as TextStyle,
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' } as TextStyle,
  body: { fontSize: 16, lineHeight: 22 } as TextStyle,
  callout: { fontSize: 15, lineHeight: 20 } as TextStyle,
  footnote: { fontSize: 13, lineHeight: 18 } as TextStyle,
  caption: { fontSize: 12, lineHeight: 16 } as TextStyle,
  amountLarge: { fontSize: 34, lineHeight: 40, fontWeight: '600', letterSpacing: -0.6, ...tabular } as TextStyle,
  tabular,
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, lineHeight: 16, ...tabular } as TextStyle,
};

/** Minimum touch target. */
export const HIT = 44;

export function toneColor(palette: Palette, tone: 'progress' | 'success' | 'warning' | 'danger' | 'neutral') {
  switch (tone) {
    case 'success':
      return { ink: palette.accent, tint: palette.accentTint };
    case 'warning':
      return { ink: palette.warning, tint: palette.warningTint };
    case 'danger':
      return { ink: palette.danger, tint: palette.dangerTint };
    case 'progress':
      return { ink: palette.ink, tint: palette.sunken };
    default:
      return { ink: palette.inkSecondary, tint: palette.sunken };
  }
}
