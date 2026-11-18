import { Modal, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatIsoDate, formatMinor } from '../core/money';
import type { RecurringCharge } from '../core/types';
import { Body, Button, Card, FactRow, Heading } from './components';
import { space, type, usePalette } from './theme';

const CADENCE: Record<string, string> = {
  monthly: 'Ежемесячно',
  weekly: 'Еженедельно',
  yearly: 'Ежегодно',
  annual: 'Ежегодно',
};

export function cadenceLabel(cadence: string): string {
  return CADENCE[cadence] ?? cadence;
}

/**
 * Card for one recurring charge. Read-only by design: this fragment has no
 * subscription-cancel action anywhere.
 */
export function ChargeDetailsSheet({
  charge,
  currency,
  jobId,
  onClose,
}: {
  charge: RecurringCharge | null;
  currency: string;
  jobId: string;
  onClose: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const stacked = useWindowDimensions().fontScale >= 1.35;
  return (
    <Modal visible={charge !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {charge ? (
        <ScrollView
          style={{ flex: 1, backgroundColor: palette.canvas }}
          contentContainerStyle={{ padding: space.md, paddingTop: space.xl, paddingBottom: insets.bottom + space.xl, gap: space.md }}
        >
          <View style={{ gap: space.xxs }}>
            <Body size="footnote">Регулярное списание</Body>
            <Heading level="largeTitle">{charge.merchant}</Heading>
            <Text style={[type.amountLarge, { color: palette.ink }]}>{formatMinor(charge.amountMinor, currency)}</Text>
          </View>
          <Card style={{ paddingVertical: space.xs }}>
            <FactRow label="Периодичность" value={cadenceLabel(charge.cadence)} stacked={stacked} />
            <FactRow label="Последнее списание" value={formatIsoDate(charge.lastSeen)} stacked={stacked} />
            <FactRow label="Сумма в минорных единицах" value={`${charge.amountMinor} (${currency})`} stacked={stacked} />
            <FactRow label="Идентификатор" value={charge.id} mono stacked={stacked} />
            <FactRow label="Задание" value={jobId} mono stacked={stacked} />
          </Card>
          <Body size="footnote" tone="tertiary">
            Данные из ответа сервера. Приложение не разбирает выписку само.
          </Body>
          <Button label="Закрыть" variant="secondary" onPress={onClose} />
        </ScrollView>
      ) : null}
    </Modal>
  );
}
