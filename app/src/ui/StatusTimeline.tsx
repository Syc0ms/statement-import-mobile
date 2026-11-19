import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { TimelineStep } from '../core/presentation';
import { BarGlyph, CheckGlyph } from './components';
import { SCALE, space, toneColor, type, usePalette, type Palette } from './theme';

const DOT = 22;
const EASE = { duration: 260, reduceMotion: ReduceMotion.System };

function dotColors(step: TimelineStep, palette: Palette) {
  switch (step.state) {
    case 'done':
      return { fill: palette.accent, ring: palette.accent };
    case 'current':
      return { fill: palette.surface, ring: palette.accent };
    case 'problem': {
      const tone = toneColor(palette, step.tone === 'danger' ? 'danger' : 'warning');
      return { fill: tone.ink, ring: tone.ink };
    }
    default:
      return { fill: palette.surface, ring: palette.hairline };
  }
}

/** The dot animates colour and scale toward its new state; changes mid-flight retarget smoothly. */
function StepDot({ step }: { step: TimelineStep }) {
  const palette = usePalette();
  const { fill, ring } = dotColors(step, palette);
  const fillValue = useSharedValue(fill);
  const ringValue = useSharedValue(ring);
  const scale = useSharedValue(step.state === 'pending' ? 0.82 : 1);

  useEffect(() => {
    fillValue.set(withTiming(fill, EASE));
    ringValue.set(withTiming(ring, EASE));
    scale.set(withTiming(step.state === 'pending' ? 0.82 : 1, EASE));
  }, [fill, ring, step.state, fillValue, ringValue, scale]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor: fillValue.value,
    borderColor: ringValue.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: DOT,
          height: DOT,
          borderRadius: DOT / 2,
          borderWidth: 2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        animated,
      ]}
    >
      {step.state === 'done' ? (
        <Animated.View key="check" entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <CheckGlyph color={palette.accentInk} size={10} />
        </Animated.View>
      ) : null}
      {step.state === 'current' ? (
        <Animated.View
          key="current"
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(120)}
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.accent }}
        />
      ) : null}
      {step.state === 'problem' ? (
        <Animated.View key="problem" entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <BarGlyph color={palette.surface} width={9} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const STATE_SPOKEN: Record<TimelineStep['state'], string> = {
  done: 'выполнено',
  current: 'сейчас',
  pending: 'ещё не наступило',
  problem: 'требует внимания',
};

/**
 * The hero: every step the operation can pass through, each marked only as far as the
 * server (or the client's own request) actually got.
 */
export function StatusTimeline({ steps }: { steps: TimelineStep[] }) {
  const palette = usePalette();
  return (
    <View accessibilityRole="list" accessibilityLabel="Ход импорта">
      {steps.map((step, index) => {
        const next = steps[index + 1];
        const lineReached = next !== undefined && (next.state === 'done' || next.state === 'current' || next.state === 'problem');
        const labelColor = step.state === 'pending' ? palette.inkTertiary : palette.ink;
        const detailColor =
          step.state === 'problem' ? toneColor(palette, step.tone === 'danger' ? 'danger' : 'warning').ink : palette.inkSecondary;
        return (
          <Animated.View
            key={step.id}
            entering={FadeIn.duration(260).delay(index * 60).reduceMotion(ReduceMotion.System)}
            style={{ flexDirection: 'row', gap: space.sm }}
            accessible
            accessibilityLabel={`${step.label}: ${STATE_SPOKEN[step.state]}${step.detail ? `, ${step.detail}` : ''}`}
          >
            <View style={{ alignItems: 'center', width: DOT }}>
              <StepDot step={step} />
              {next ? (
                <View
                  style={{
                    width: 2,
                    flexGrow: 1,
                    minHeight: 14,
                    marginVertical: 3,
                    borderRadius: 1,
                    backgroundColor: lineReached ? palette.accent : palette.hairline,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: next ? space.md : 0, paddingTop: 1 }}>
              <Text maxFontSizeMultiplier={SCALE.content} style={[type.callout, { color: labelColor, fontWeight: step.state === 'pending' ? '400' : '600' }]}>
                {step.label}
              </Text>
              {step.detail ? (
                <Text maxFontSizeMultiplier={SCALE.content} style={[type.footnote, type.tabular, { color: detailColor, marginTop: 2 }]}>{step.detail}</Text>
              ) : null}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}
