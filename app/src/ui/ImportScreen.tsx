import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ImportController, ImportView } from '../core/importController';
import { formatByteCount, formatBytes, formatIsoDate, formatMinor, monthlyTotalMinor } from '../core/money';
import { presentOperation, type ActionId } from '../core/presentation';
import type { ImportOperation, RecurringCharge } from '../core/types';
import type { Rejection } from '../core/validation';
import { pickStatement } from '../platform/picker';
import { ChargeDetailsSheet, cadenceLabel } from './ChargeDetailsSheet';
import { Body, Button, Card, Chip, FactRow, Heading, PressableScale } from './components';
import { StatusTimeline } from './StatusTimeline';
import { HIT, radius, space, toneColor, type, usePalette } from './theme';

const enter = (index: number) =>
  FadeInDown.duration(320).delay(index * 100).withInitialValues({ transform: [{ translateY: 12 }] }).reduceMotion(ReduceMotion.System);
const exit = FadeOut.duration(150).reduceMotion(ReduceMotion.System);
const layout = LinearTransition.duration(220).reduceMotion(ReduceMotion.System);

/** Large text: stack label/value pairs instead of squeezing them side by side. */
function useStacked(): boolean {
  return useWindowDimensions().fontScale >= 1.35;
}

export function ImportScreen({ controller, onOpenDiagnostics }: { controller: ImportController; onOpenDiagnostics: () => void }) {
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const palette = usePalette();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: palette.canvas }}
        contentContainerStyle={{
          paddingTop: insets.top + space.xs,
          paddingBottom: insets.bottom + space.xxl,
          paddingHorizontal: space.md,
          gap: space.md,
        }}
        contentInsetAdjustmentBehavior="never"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, minHeight: HIT }}>
          <Text style={[type.footnote, { color: palette.inkSecondary, fontWeight: '600', flexShrink: 1 }]}>Выписка · импорт</Text>
          <PressableScale
            onPress={onOpenDiagnostics}
            accessibilityRole="button"
            accessibilityLabel="Тест-панель"
            accessibilityHint="Открывает диагностику тестового сервера. Не часть продукта."
            hitSlop={8}
            style={{
              minHeight: 36,
              paddingHorizontal: 12,
              borderRadius: radius.chip,
              backgroundColor: palette.sunken,
              justifyContent: 'center',
            }}
          >
            <Text style={[type.footnote, { color: palette.inkSecondary, fontWeight: '600' }]}>Тест-панель</Text>
          </PressableScale>
        </View>
        <ViewForState view={view} controller={controller} />
      </ScrollView>
      {/* Keeps scrolled content from showing through the status bar. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: palette.canvas }}
      />
    </View>
  );
}

function ViewForState({ view, controller }: { view: ImportView; controller: ImportController }) {
  switch (view.kind) {
    case 'restoring':
      return <Loading key="restoring" label="Восстанавливаем состояние" />;
    case 'checking':
      return <Loading key="checking" label="Проверяем файл на устройстве" />;
    case 'idle':
      return <Idle key="idle" controller={controller} notice={view.notice} />;
    case 'rejected_locally':
      return <LocalRejection key="rejected" controller={controller} rejection={view.rejection} name={view.name} />;
    case 'confirm':
      return <Confirm key="confirm" controller={controller} draft={view.draft} />;
    case 'operation':
      return <OperationView key={`op-${view.op.idempotencyKey}`} controller={controller} view={view} />;
  }
}

async function pickInto(controller: ImportController) {
  try {
    const picked = await pickStatement();
    if (picked) await controller.selectFile(picked);
  } catch {
    Alert.alert('Не удалось открыть файл', 'Попробуйте выбрать файл ещё раз.');
  }
}

/** The system picker can take a few seconds to appear; show progress and ignore repeat taps. */
function usePicker(controller: ImportController, before?: () => Promise<void>) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      if (before) await before();
      await pickInto(controller);
    } finally {
      setOpening(false);
    }
  };
  return { opening, open: () => void open() };
}

function Loading({ label }: { label: string }) {
  const palette = usePalette();
  return (
    <Animated.View entering={enter(0)} exiting={exit} style={{ paddingVertical: space.xxl, alignItems: 'center', gap: space.sm }}>
      <ActivityIndicator color={palette.inkSecondary} />
      <Body size="callout" accessibilityLiveRegion="polite">
        {label}
      </Body>
    </Animated.View>
  );
}

const NOTICE_TEXT = {
  storage_failed: 'Не удалось сохранить состояние операции на устройстве, поэтому файл не отправлен.',
  pick_failed: 'Файл не удалось прочитать. Ничего не отправлено.',
  cleared: 'Локальные данные удалены: запись операции и все временные копии файлов.',
} as const;

function Idle({ controller, notice }: { controller: ImportController; notice: keyof typeof NOTICE_TEXT | null }) {
  const palette = usePalette();
  const picker = usePicker(controller);
  const points = [
    'Формат проверяется по содержимому файла, а не по расширению.',
    'Если ответ сервера потеряется, повторная отправка не создаст второй импорт.',
    'Удалённым импорт считается, только когда это подтвердит сервер.',
  ];
  return (
    <>
      <Animated.View entering={enter(0)} exiting={exit} style={{ gap: space.xs, marginTop: space.sm }}>
        <Heading level="largeTitle">Импорт выписки</Heading>
        <Body>PDF или CSV до 10 МиБ. Сервер найдёт регулярные списания.</Body>
      </Animated.View>
      {notice ? (
        <Animated.View entering={enter(1)} exiting={exit}>
          <View style={{ backgroundColor: notice === 'cleared' ? palette.accentTint : palette.warningTint, borderRadius: radius.row, padding: space.md }}>
            <Body tone="primary" size="callout">
              {NOTICE_TEXT[notice]}
            </Body>
          </View>
        </Animated.View>
      ) : null}
      <Animated.View entering={enter(2)} exiting={exit}>
        <Card style={{ gap: space.md }}>
          <Heading level="headline">Файлов пока нет</Heading>
          {points.map((point) => (
            <View key={point} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.accent, marginTop: 8 }} />
              <Body size="callout" style={{ flex: 1 }}>
                {point}
              </Body>
            </View>
          ))}
        </Card>
      </Animated.View>
      <Animated.View entering={enter(3)} exiting={exit}>
        <Button
          label={picker.opening ? 'Открываем выбор файла' : 'Выбрать файл'}
          busy={picker.opening}
          onPress={picker.open}
          accessibilityHint="Открывает системный выбор файла"
        />
      </Animated.View>
    </>
  );
}

function rejectionText(rejection: Rejection): { title: string; body: string } {
  switch (rejection.reason) {
    case 'too_large':
      return {
        title: 'Файл больше 10 МиБ',
        body: `Размер ${formatByteCount(rejection.size)} байт, допустимо до ${formatByteCount(rejection.limit)} байт (10 МиБ). Размер взят из данных файла, содержимое не читалось.`,
      };
    case 'empty':
      return { title: 'Файл пустой', body: 'В файле нет данных.' };
    case 'unsupported_content':
      return {
        title: rejection.claimed === 'pdf' ? 'Это не PDF' : rejection.claimed === 'csv' ? 'Это не выписка в CSV' : 'Формат не поддерживается',
        body:
          rejection.claimed === 'pdf'
            ? 'У файла расширение .pdf, но содержимое не начинается с %PDF-.'
            : 'Нужен PDF или CSV с заголовком date,description,amount. Расширение и тип файла не учитываются.',
      };
  }
}

function LocalRejection({ controller, rejection, name }: { controller: ImportController; rejection: Rejection; name: string }) {
  const palette = usePalette();
  const picker = usePicker(controller, () => controller.cancelDraft());
  const text = rejectionText(rejection);
  return (
    <>
      <Animated.View entering={enter(0)} exiting={exit} style={{ gap: space.xs, marginTop: space.sm }}>
        <Chip label="Отклонено на устройстве" ink={palette.danger} tint={palette.dangerTint} />
        <Heading level="largeTitle" accessibilityLiveRegion="assertive">
          {text.title}
        </Heading>
      </Animated.View>
      <Animated.View entering={enter(1)} exiting={exit}>
        <Card style={{ gap: space.sm }}>
          <Body tone="primary" numberOfLines={2} style={{ fontWeight: '600' }}>
            {name}
          </Body>
          <Body>{text.body}</Body>
          <Body size="footnote" tone="tertiary">
            На сервер ничего не отправлено. Временная копия файла удалена.
          </Body>
        </Card>
      </Animated.View>
      <Animated.View entering={enter(2)} exiting={exit} style={{ gap: space.xs }}>
        <Button label="Выбрать другой файл" busy={picker.opening} onPress={picker.open} />
        <Button label="Закрыть" variant="quiet" onPress={() => void controller.cancelDraft()} />
      </Animated.View>
    </>
  );
}

function Confirm({ controller, draft }: { controller: ImportController; draft: { name: string; size: number; format: 'pdf' | 'csv' } }) {
  const stacked = useStacked();
  const [sending, setSending] = useState(false);
  return (
    <>
      <Animated.View entering={enter(0)} exiting={exit} style={{ gap: space.xs, marginTop: space.sm }}>
        <Heading level="largeTitle">Отправить этот файл?</Heading>
        <Body>Проверка на устройстве пройдена.</Body>
      </Animated.View>
      <Animated.View entering={enter(1)} exiting={exit}>
        <Card style={{ paddingVertical: space.xs }}>
          <FactRow label="Имя" value={draft.name} stacked={stacked} />
          <FactRow label="Размер" value={formatBytes(draft.size)} stacked={stacked} />
          <FactRow label="Формат" value={`${draft.format.toUpperCase()}, определён по содержимому`} stacked={stacked} />
        </Card>
      </Animated.View>
      <Animated.View entering={enter(2)} exiting={exit}>
        <Body size="footnote" tone="tertiary">
          Файл уйдёт на локальный тестовый сервер. Перед отправкой приложение сохранит ключ операции, чтобы повтор не создал дубль.
        </Body>
      </Animated.View>
      <Animated.View entering={enter(3)} exiting={exit} style={{ gap: space.xs }}>
        <Button
          label="Отправить"
          busy={sending}
          onPress={() => {
            setSending(true);
            void controller.confirm();
          }}
        />
        <Button label="Отмена" variant="secondary" disabled={sending} onPress={() => void controller.cancelDraft()} />
      </Animated.View>
    </>
  );
}

function useCountdown(target: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (target === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [target]);
  if (target === null) return null;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

function OperationView({ controller, view }: { controller: ImportController; view: Extract<ImportView, { kind: 'operation' }> }) {
  const { op, activity } = view;
  const palette = usePalette();
  const presentation = presentOperation(op, activity);
  const tone = toneColor(palette, presentation.tone);
  const [details, setDetails] = useState<RecurringCharge | null>(null);
  const countdown = useCountdown(activity.nextCheckAt);
  const busy = activity.busy;

  const onAction = (id: ActionId) => {
    switch (id) {
      case 'check_now':
        return void controller.lookupNow();
      case 'retry_upload':
        return void controller.retryUpload();
      case 'refresh':
        return void controller.pollOnce(true);
      case 'retry_delete':
        return void controller.requestDelete();
      case 'delete':
        return Alert.alert('Удалить импорт с сервера?', 'Удалённым он станет, только когда сервер это подтвердит.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Удалить', style: 'destructive', onPress: () => void controller.requestDelete() },
        ]);
      case 'reattach':
        return void (async () => {
          const picked = await pickStatement();
          if (!picked) return;
          const result = await controller.reattachFile(picked);
          if (result === 'different_file') {
            Alert.alert('Это другой файл', 'Содержимое не совпадает с тем, что отправлялось с этим ключом. Выберите исходный файл.');
          } else if (result === 'failed') {
            Alert.alert('Не удалось прочитать файл', 'Попробуйте ещё раз.');
          }
        })();
      case 'discard':
        return Alert.alert(
          'Отказаться от импорта?',
          'Сервер пока не подтвердил этот файл. Если исходная отправка всё же дойдёт, импорт останется на сервере, и удалить его отсюда будет нельзя.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Отказаться', style: 'destructive', onPress: () => void controller.forget() },
          ],
        );
      case 'new_import':
        if (op.job && op.job.status !== 'deleted' && !op.jobMissing && op.upload.phase === 'accepted') {
          return Alert.alert('Начать новый импорт?', 'Этот импорт останется на сервере, и удалить его с устройства будет уже нельзя.', [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Начать новый', onPress: () => void controller.forget() },
          ]);
        }
        return void controller.forget();
      case 'forget':
        return void controller.forget();
    }
  };

  const busyFor: Partial<Record<ActionId, boolean>> = {
    check_now: busy === 'looking_up',
    retry_upload: busy === 'sending',
    refresh: busy === 'refreshing',
    delete: busy === 'deleting',
    retry_delete: busy === 'deleting',
    reattach: busy === 'reattaching',
  };

  const result = op.job?.result;
  let index = 0;
  const next = () => index++;

  return (
    <>
      <Animated.View entering={enter(next())} layout={layout} style={{ gap: space.xs, marginTop: space.sm }}>
        <Chip
          label={presentation.serverLine}
          ink={tone.ink}
          tint={tone.tint}
          busy={presentation.tone === 'progress' || busy === 'looking_up' || busy === 'sending'}
        />
        <Heading level="largeTitle" accessibilityLiveRegion="polite">
          {presentation.title}
        </Heading>
        <Body>{presentation.body}</Body>
        {presentation.connectivityNote ? (
          <Body size="footnote" style={{ color: palette.warning }}>
            {presentation.connectivityNote}
          </Body>
        ) : null}
        {countdown !== null && countdown > 1 && op.upload.phase === 'unknown' ? (
          <Body size="footnote" tone="tertiary" style={type.tabular}>
            Следующая проверка по ключу через {countdown} с
          </Body>
        ) : null}
      </Animated.View>

      <Animated.View entering={enter(next())} layout={layout}>
        <Card>
          <StatusTimeline steps={presentation.steps} />
        </Card>
      </Animated.View>

      {presentation.actions.length > 0 ? (
        <Animated.View entering={enter(next())} exiting={exit} layout={layout} style={{ gap: space.xs }}>
          {presentation.actions.map((action) => (
            <Button
              key={action.id}
              label={action.label}
              variant={action.variant}
              busy={busyFor[action.id] ?? false}
              disabled={busy !== null && !busyFor[action.id]}
              onPress={() => onAction(action.id)}
            />
          ))}
        </Animated.View>
      ) : null}

      {presentation.showResult && result ? (
        <Animated.View entering={enter(next())} exiting={exit} layout={layout} style={{ gap: space.sm }}>
          <ResultSection items={result.items} currency={result.currency} note={presentation.resultNote} onDetails={setDetails} />
        </Animated.View>
      ) : null}

      <Animated.View entering={enter(next())} layout={layout}>
        <TechnicalFacts op={op} lastCheckedAt={activity.lastCheckedAt} />
      </Animated.View>

      <ChargeDetailsSheet
        charge={details}
        currency={result?.currency ?? 'AUD'}
        jobId={op.job?.jobId ?? ''}
        onClose={() => setDetails(null)}
      />
    </>
  );
}

function ResultSection({
  items,
  currency,
  note,
  onDetails,
}: {
  items: RecurringCharge[];
  currency: string;
  note: string | null;
  onDetails: (charge: RecurringCharge) => void;
}) {
  const palette = usePalette();
  const total = monthlyTotalMinor(items);
  return (
    <>
      <Card style={{ gap: 2 }}>
        <Body size="footnote" tone="secondary">
          Регулярные списания в месяц
        </Body>
        <Text style={[type.amountLarge, { color: palette.ink }]} accessibilityLabel={`Итого ${formatMinor(total, currency)} в месяц`}>
          {formatMinor(total, currency)}
        </Text>
        <Body size="footnote" tone="tertiary">
          По ответу сервера · позиций: {items.length}
        </Body>
        {note ? (
          <Body size="footnote" style={{ color: palette.warning, marginTop: space.xs }}>
            {note}
          </Body>
        ) : null}
      </Card>
      <Card padded={false} style={{ gap: 6 }}>
        {items.map((item) => (
          <View
            key={item.id}
            style={{
              borderRadius: radius.row,
              backgroundColor: palette.sunken,
              paddingTop: space.md,
              paddingBottom: space.xxs,
              paddingHorizontal: space.md,
              gap: space.xxs,
            }}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: space.xs }}>
              <Text style={[type.headline, { color: palette.ink }]}>{item.merchant}</Text>
              <Text style={[type.headline, type.tabular, { color: palette.ink }]}>{formatMinor(item.amountMinor, currency)}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: space.xs }}>
              <Body size="footnote" style={[type.tabular, { flexShrink: 1 }]}>
                {cadenceLabel(item.cadence)} · последнее {formatIsoDate(item.lastSeen)}
              </Body>
              <View style={{ marginRight: -space.md }}>
                <Button
                  label="Подробнее"
                  variant="quiet"
                  onPress={() => onDetails(item)}
                  accessibilityHint={`Открывает карточку списания ${item.merchant}`}
                />
              </View>
            </View>
          </View>
        ))}
      </Card>
    </>
  );
}

function shortKey(key: string): string {
  return `…${key.slice(-8)}`;
}

function TechnicalFacts({ op, lastCheckedAt }: { op: ImportOperation; lastCheckedAt: number | null }) {
  const stacked = useStacked();
  const facts: [string, string, boolean][] = [
    ['Файл', op.file.name, false],
    ['Размер и формат', `${formatBytes(op.file.size)} · ${op.file.format.toUpperCase()}`, false],
    ['Ключ операции', `${shortKey(op.idempotencyKey)} · сохранён до отправки`, true],
    ['Попыток отправки', String(op.upload.attempts), false],
    ['SHA-256', `${op.file.sha256.slice(0, 16)}…`, true],
    ['Локальная копия', op.file.uri ? 'хранится до подтверждения сервером' : 'удалена', false],
  ];
  if (op.job) facts.push(['Задание', op.job.jobId, true]);
  if (op.deletion) facts.push(['Ключ удаления', `${shortKey(op.deletion.key)} · попыток ${op.deletion.attempts}`, true]);
  if (lastCheckedAt) facts.push(['Последний ответ', new Date(lastCheckedAt).toLocaleTimeString('ru-RU'), false]);
  return (
    <Section title="Технические детали">
      <Card style={{ paddingVertical: space.xs }}>
        {facts.map(([label, value, mono]) => (
          <FactRow key={label} label={label} value={value} mono={mono} stacked={stacked} />
        ))}
      </Card>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Body size="footnote" tone="secondary" style={{ fontWeight: '600', paddingHorizontal: space.xxs }} accessibilityRole="header">
        {title}
      </Body>
      {children}
    </View>
  );
}
