import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Alert, Modal, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MOCK_SCENARIOS, type ImportApi, type MockScenario, type MockState } from '../core/importApi';
import type { ImportController } from '../core/importController';
import type { ApiSettings } from '../platform/storage';
import { DEFAULT_API_BASE_URL } from '../platform/storage';
import { Body, Button, Card, FactRow, Heading, PressableScale } from './components';
import { HIT, SCALE, radius, space, type, usePalette } from './theme';

const SCENARIO_LABEL: Record<MockScenario, string> = {
  happy: 'happy',
  lost_ack: 'lost_ack',
  stale_status: 'stale_status',
  delete_failure: 'delete_failure',
};

/**
 * Test tool for the reviewer. It talks to the mock's /__test routes, which do not
 * exist in production. Kept apart from the import flow and labelled as such.
 */
export function DiagnosticsSheet({
  visible,
  onClose,
  api,
  settings,
  controller,
}: {
  visible: boolean;
  onClose: () => void;
  api: ImportApi;
  settings: ApiSettings;
  controller: ImportController;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const stacked = useWindowDimensions().fontScale >= 1.35;
  const baseUrl = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
  const [draftUrl, setDraftUrl] = useState(baseUrl);
  const [state, setState] = useState<MockState | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  const refresh = useCallback(async () => {
    const next = await api.mockState();
    setState(next);
    setReachable(next !== null);
  }, [api]);

  useEffect(() => {
    if (!visible) return;
    setDraftUrl(settings.baseUrl);
    void refresh();
    const id = setInterval(() => void refresh(), 1000);
    return () => clearInterval(id);
  }, [visible, refresh, settings]);

  const run = async (label: string, task: () => Promise<boolean>) => {
    setPending(label);
    const ok = await task();
    setPending(null);
    if (!ok) Alert.alert('Mock не ответил', `Проверьте, что mock запущен и доступен по адресу ${settings.baseUrl}.`);
    await refresh();
  };

  const localOp = view.kind === 'operation' ? view.op : null;
  const serverJob = localOp?.job ? state?.jobs.find((job) => job.jobId === localOp.job?.jobId) : undefined;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: palette.canvas }}
        contentContainerStyle={{ padding: space.md, paddingTop: space.lg, paddingBottom: insets.bottom + space.xl, gap: space.md }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
          <Heading level="title" style={{ flexShrink: 1 }}>
            Тест-панель
          </Heading>
          <Button label="Готово" variant="quiet" onPress={onClose} />
        </View>
        <View style={{ backgroundColor: palette.warningTint, borderRadius: radius.row, padding: space.md, gap: 4 }}>
          <Text maxFontSizeMultiplier={SCALE.content} style={[type.callout, { color: palette.warning, fontWeight: '600' }]}>Только для проверки</Text>
          <Body size="footnote" tone="primary">
            Управляет локальным mock через маршруты /__test. Не часть продукта и не используется в основном сценарии.
          </Body>
        </View>

        <Section title="Адрес API">
          <Card style={{ gap: space.sm }}>
            <TextInput
              value={draftUrl}
              onChangeText={setDraftUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={DEFAULT_API_BASE_URL}
              placeholderTextColor={palette.inkTertiary}
              accessibilityLabel="Адрес API"
              style={[
                type.mono,
                {
                  fontSize: 15,
                  lineHeight: 20,
                  minHeight: HIT,
                  color: palette.ink,
                  backgroundColor: palette.sunken,
                  borderRadius: radius.button,
                  paddingHorizontal: space.sm,
                },
              ]}
            />
            <Body size="footnote" tone="tertiary">
              Симулятор iOS: 127.0.0.1. Эмулятор Android: 127.0.0.1 после adb reverse tcp:8787 tcp:8787. Телефон: LAN-адрес Mac, mock запущен с HOST=0.0.0.0.
            </Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              <View style={{ flexGrow: 1 }}>
                <Button
                  label="Сохранить"
                  variant="secondary"
                  onPress={async () => {
                    const ok = await settings.save(draftUrl);
                    if (!ok) Alert.alert('Неверный адрес', 'Нужен вид http://хост:порт.');
                    else await refresh();
                  }}
                />
              </View>
              <View style={{ flexGrow: 1 }}>
                <Button
                  label="По умолчанию"
                  variant="secondary"
                  onPress={async () => {
                    await settings.save(DEFAULT_API_BASE_URL);
                    setDraftUrl(DEFAULT_API_BASE_URL);
                    await refresh();
                  }}
                />
              </View>
            </View>
            <Body size="footnote" style={{ color: reachable === false ? palette.danger : palette.inkSecondary }}>
              {reachable === null ? 'Проверяем связь…' : reachable ? `Mock доступен: ${baseUrl}` : `Нет связи с ${baseUrl}`}
            </Body>
          </Card>
        </Section>

        <Section title="Сценарий mock">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {MOCK_SCENARIOS.map((mode) => {
              const active = state?.mode === mode;
              return (
                <PressableScale
                  key={mode}
                  onPress={() => void run(mode, () => api.setScenario(mode))}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, busy: pending === mode }}
                  accessibilityLabel={`Сценарий ${mode}`}
                  style={{
                    minHeight: HIT,
                    paddingHorizontal: space.md,
                    borderRadius: radius.button,
                    justifyContent: 'center',
                    backgroundColor: active ? palette.accent : palette.surface,
                    boxShadow: active ? undefined : palette.shadowRing,
                  }}
                >
                  <Text maxFontSizeMultiplier={SCALE.chrome} style={[type.mono, { fontSize: 14, color: active ? palette.accentInk : palette.ink }]}>{SCENARIO_LABEL[mode]}</Text>
                </PressableScale>
              );
            })}
          </View>
        </Section>

        <Section title="Счётчики GET /__test/state">
          <Card style={{ paddingVertical: space.xs }}>
            <FactRow label="mode" value={state?.mode ?? '—'} mono stacked={stacked} />
            <FactRow label="createRequests" value={String(state?.stats.createRequests ?? '—')} mono stacked={stacked} />
            <FactRow label="newJobs" value={String(state?.stats.newJobs ?? '—')} mono stacked={stacked} />
            <FactRow label="duplicateHits" value={String(state?.stats.duplicateHits ?? '—')} mono stacked={stacked} />
            <FactRow label="acceptedBytes" value={String(state?.stats.acceptedBytes ?? '—')} mono stacked={stacked} />
            <FactRow label="deleteRequests" value={String(state?.stats.deleteRequests ?? '—')} mono stacked={stacked} />
          </Card>
          {state && state.jobs.length > 0 ? (
            <Card style={{ paddingVertical: space.xs }}>
              {state.jobs.map((job) => (
                <FactRow
                  key={job.jobId}
                  label={job.jobId}
                  value={`${job.status}/${job.revision} · ${job.bytes} B · ${job.sha256.slice(0, 8)}`}
                  mono
                  stacked={stacked}
                />
              ))}
            </Card>
          ) : (
            <Body size="footnote" tone="tertiary">
              Заданий на mock нет.
            </Body>
          )}
          {localOp ? (
            <Body size="footnote" tone="secondary" style={type.tabular}>
              {serverJob
                ? serverJob.sha256 === localOp.file.sha256
                  ? `SHA-256 на сервере совпадает с локальным (${localOp.file.sha256.slice(0, 8)}): отправлены те же байты.`
                  : 'SHA-256 на сервере отличается от локального.'
                : `Локальная операция: ключ …${localOp.idempotencyKey.slice(-8)}, фаза ${localOp.upload.phase}.`}
            </Body>
          ) : null}
        </Section>

        <Section title="Сброс">
          <Button
            label="Сбросить mock"
            variant="secondary"
            busy={pending === 'reset'}
            onPress={() =>
              Alert.alert('Сбросить mock?', 'Все задания и счётчики на mock будут удалены.', [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Сбросить', style: 'destructive', onPress: () => void run('reset', () => api.resetMock()) },
              ])
            }
          />
          <Button
            label="Очистить данные на устройстве"
            variant="destructive"
            onPress={() =>
              Alert.alert(
                'Очистить данные на устройстве?',
                'Удаляет запись операции и все временные копии файлов. Данные на сервере не трогает.',
                [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Очистить', style: 'destructive', onPress: () => void controller.clearLocalData() },
                ],
              )
            }
          />
        </Section>
      </ScrollView>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Body size="footnote" style={{ fontWeight: '600', paddingHorizontal: space.xxs }} accessibilityRole="header">
        {title}
      </Body>
      {children}
    </View>
  );
}
