import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { HIT, SCALE, radius, space, type, usePalette } from './theme';

const PRESS_EASE = { duration: 140, reduceMotion: ReduceMotion.System };

/**
 * Pressable that scales to 0.96 while pressed. withTiming retargets from the current
 * value, so a quick release mid-press reverses smoothly (interruptible).
 */
export function PressableScale({
  children,
  style,
  static: isStatic = false,
  disabled,
  ...rest
}: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle>; static?: boolean }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        if (!isStatic) scale.set(withTiming(0.96, PRESS_EASE));
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withTiming(1, PRESS_EASE));
        rest.onPressOut?.(event);
      }}
    >
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'quiet';

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  busy?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const palette = usePalette();
  const [pressed, setPressed] = useState(false);
  const inactive = disabled || busy;
  const base: ViewStyle = {
    minHeight: 52,
    borderRadius: radius.button,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.xs,
    opacity: inactive ? 0.55 : 1,
  };
  let variantStyle: ViewStyle;
  let textColor: string;
  if (variant === 'primary') {
    variantStyle = { backgroundColor: palette.accent };
    textColor = palette.accentInk;
  } else if (variant === 'secondary' || variant === 'destructive') {
    variantStyle = { backgroundColor: palette.surface, boxShadow: pressed ? palette.shadowRingPressed : palette.shadowRing };
    textColor = variant === 'destructive' ? palette.danger : palette.ink;
  } else {
    variantStyle = { minHeight: HIT };
    textColor = palette.accent;
  }
  const container: ViewStyle = { ...base, ...variantStyle };
  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      style={container}
    >
      {busy ? <ActivityIndicator size="small" color={textColor} /> : null}
      <Text
        style={[type.headline, { color: textColor, textAlign: 'center', fontWeight: variant === 'quiet' ? '500' : '600' }]}
        maxFontSizeMultiplier={SCALE.content}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const palette = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: palette.surface,
          borderRadius: radius.card,
          boxShadow: palette.shadowRing,
          padding: padded ? space.lg : 6,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Heading text: balanced line breaks where the platform supports it. */
export function Heading({ children, style, level = 'title', ...rest }: TextProps & { level?: 'largeTitle' | 'title' | 'headline' }) {
  const palette = usePalette();
  return (
    <Text
      accessibilityRole="header"
      textBreakStrategy="balanced"
      lineBreakStrategyIOS="standard"
      maxFontSizeMultiplier={level === 'largeTitle' ? SCALE.display : SCALE.content}
      {...rest}
      style={[type[level], { color: palette.ink }, style]}
    >
      {children}
    </Text>
  );
}

/** Body copy: "pretty" wrapping to avoid orphans where supported. */
export function Body({
  children,
  style,
  tone = 'secondary',
  size = 'body',
  ...rest
}: TextProps & { tone?: 'primary' | 'secondary' | 'tertiary'; size?: 'body' | 'callout' | 'footnote' | 'caption' }) {
  const palette = usePalette();
  const color = tone === 'primary' ? palette.ink : tone === 'secondary' ? palette.inkSecondary : palette.inkTertiary;
  return (
    <Text lineBreakStrategyIOS="standard" textBreakStrategy="highQuality" maxFontSizeMultiplier={SCALE.content} {...rest} style={[type[size], { color }, style]}>
      {children}
    </Text>
  );
}

export function Chip({ label, ink, tint, busy = false }: { label: string; ink: string; tint: string; busy?: boolean }) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: tint,
        borderRadius: radius.chip,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={ink} style={{ transform: [{ scale: 0.7 }], marginLeft: -4, marginRight: -4 }} /> : null}
      <Text style={[type.footnote, { color: ink, fontWeight: '600' }]} maxFontSizeMultiplier={SCALE.chrome}>
        {label}
      </Text>
    </View>
  );
}

/** Label/value line. Stacks vertically when the text is large. */
export function FactRow({ label, value, mono = false, stacked }: { label: string; value: string; mono?: boolean; stacked: boolean }) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.factRow,
        stacked ? { flexDirection: 'column', alignItems: 'flex-start', gap: 2 } : null,
        { borderBottomColor: palette.hairline },
      ]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text maxFontSizeMultiplier={SCALE.content} style={[type.callout, { color: palette.inkSecondary, flexShrink: 0 }]}>{label}</Text>
      <Text
        maxFontSizeMultiplier={SCALE.content}
        style={[mono ? type.mono : type.callout, type.tabular, { color: palette.ink, flexShrink: 1, textAlign: stacked ? 'left' : 'right' }]}
        selectable={mono}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

/** Simple drawn glyphs, so no icon font or SVG dependency is needed. */
export function CheckGlyph({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size * 0.55,
        height: size,
        borderRightWidth: 2,
        borderBottomWidth: 2,
        borderColor: color,
        transform: [{ rotate: '45deg' }, { translateY: -size * 0.12 }],
      }}
    />
  );
}

export function BarGlyph({ color, width = 8 }: { color: string; width?: number }) {
  return <View style={{ width, height: 2, borderRadius: 1, backgroundColor: color }} />;
}
