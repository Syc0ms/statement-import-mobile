import type { Activity } from './importController';
import { formatMinor, monthlyTotalMinor } from './money';
import type { ErrorCode, ImportOperation, JobStatus } from './types';

/**
 * Maps an operation to what the screen may claim. Pure and unit-tested, so the honesty
 * rules ("202 is not ready", "deleted only after GET deleted") are enforced in one place.
 */

export type Tone = 'progress' | 'success' | 'warning' | 'danger' | 'neutral';
export type StepState = 'done' | 'current' | 'pending' | 'problem';
export type StepId = 'sent' | 'queued' | 'processing' | 'ready' | 'deleting' | 'deleted';

export interface TimelineStep {
  id: StepId;
  label: string;
  state: StepState;
  /** Short factual caption, for example "202 · ревизия 1". */
  detail: string | null;
  /** Severity of a `problem` step. */
  tone: Tone;
}

export type ActionId =
  | 'check_now'
  | 'retry_upload'
  | 'reattach'
  | 'discard'
  | 'refresh'
  | 'delete'
  | 'retry_delete'
  | 'new_import'
  | 'forget';

export interface ActionSpec {
  id: ActionId;
  label: string;
  variant: 'primary' | 'secondary' | 'destructive' | 'quiet';
}

export interface OperationPresentation {
  tone: Tone;
  title: string;
  body: string;
  /** What the server last said, verbatim status and revision. */
  serverLine: string;
  steps: TimelineStep[];
  actions: ActionSpec[];
  /** Show the ready result list (only when the server delivered one). */
  showResult: boolean;
  /** Extra line under the result: deletion is pending or failed, data still on the server. */
  resultNote: string | null;
  connectivityNote: string | null;
}

const STATUS_RANK: Record<JobStatus, number> = { queued: 1, processing: 2, ready: 3, deleting: 4, deleted: 5 };

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'В очереди',
  processing: 'Обрабатывается',
  ready: 'Готово',
  deleting: 'Удаляется',
  deleted: 'Удалено',
};

const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  network: 'соединение оборвалось',
  timeout: 'сервер не ответил вовремя',
  server_unavailable: 'сервер временно недоступен (503)',
  server_error: 'ошибка сервера (5xx)',
  conflict: 'ключ уже использован для другого файла (409)',
  unsupported_content: 'сервер не распознал содержимое как PDF или CSV (415)',
  too_large: 'файл больше 10 МиБ (413)',
  bad_request: 'сервер отклонил запрос (400)',
  bad_response: 'ответ сервера не по контракту',
};

export function errorText(code: ErrorCode | undefined): string {
  return (code && ERROR_TEXT[code]) ?? 'неизвестная ошибка';
}

function lastStale(op: ImportOperation) {
  for (let index = op.history.length - 1; index >= 0; index -= 1) {
    const entry = op.history[index];
    if (entry.kind === 'stale_ignored') return entry;
    if (entry.kind === 'server_status') return null;
  }
  return null;
}

function buildSteps(op: ImportOperation): TimelineStep[] {
  const job = op.job;
  const rank = job ? STATUS_RANK[job.status] : 0;
  const phase = op.upload.phase;
  const sent: TimelineStep = {
    id: 'sent',
    label: 'Отправка',
    tone: 'neutral',
    state: 'pending',
    detail: null,
  };
  if (phase === 'sending') Object.assign(sent, { state: 'current', detail: `попытка ${op.upload.attempts}` });
  if (phase === 'unknown') Object.assign(sent, { state: 'problem', tone: 'warning', detail: 'исход неизвестен' });
  if (phase === 'not_found') Object.assign(sent, { state: 'problem', tone: 'warning', detail: 'по ключу не найдено (404)' });
  if (phase === 'rejected') Object.assign(sent, { state: 'problem', tone: 'danger', detail: errorText(op.upload.lastError) });
  if (phase === 'accepted') {
    const recoveredByKey = op.history.some((entry) => entry.kind === 'upload_unknown');
    let detail = 'принято (202)';
    if (recoveredByKey) detail = 'найдено по ключу после потери ответа';
    else if (op.upload.attempts > 1) detail = `принято · попыток ${op.upload.attempts}`;
    Object.assign(sent, { state: 'done', detail });
  }

  const serverStep = (id: 'queued' | 'processing' | 'ready'): TimelineStep => {
    const stepRank = STATUS_RANK[id];
    let state: StepState = 'pending';
    if (rank > stepRank) state = 'done';
    if (rank === stepRank) state = id === 'ready' ? 'done' : 'current';
    const detail = rank === stepRank && job ? `ревизия ${job.revision}` : null;
    return { id, label: STATUS_LABEL[id], state, detail, tone: 'neutral' };
  };
  const steps = [sent, serverStep('queued'), serverStep('processing'), serverStep('ready')];

  const stale = lastStale(op);
  if (stale && stale.status && job?.status === 'ready') {
    steps[3] = { ...steps[3], detail: `ревизия ${job.revision} · устаревший ${stale.status}/${stale.revision} проигнорирован` };
  }

  if (op.deletion) {
    const deleting: TimelineStep = { id: 'deleting', label: 'Удаление', state: 'current', detail: null, tone: 'neutral' };
    const deleted: TimelineStep = { id: 'deleted', label: 'Удалено с сервера', state: 'pending', detail: null, tone: 'neutral' };
    if (job?.status === 'deleted') {
      deleting.state = 'done';
      deleted.state = 'done';
      deleted.detail = `подтверждено GET · ревизия ${job.revision}`;
    } else if (op.deletion.phase === 'failed') {
      Object.assign(deleting, { state: 'problem', tone: 'danger', detail: `не удалено: ${errorText(op.deletion.lastError)}` });
    } else if (op.deletion.phase === 'unknown') {
      Object.assign(deleting, { state: 'problem', tone: 'warning', detail: 'исход неизвестен' });
    } else if (op.deletion.phase === 'accepted') {
      deleting.detail = job?.status === 'deleting' ? `ревизия ${job.revision}` : 'принято (202)';
    } else {
      deleting.detail = `попытка ${op.deletion.attempts}`;
    }
    steps.push(deleting, deleted);
  }
  return steps;
}

const action = (id: ActionId, label: string, variant: ActionSpec['variant']): ActionSpec => ({ id, label, variant });

export function presentOperation(op: ImportOperation, activity: Activity): OperationPresentation {
  const job = op.job;
  const steps = buildSteps(op);
  const serverLine = job ? `Сервер: ${job.status} · ревизия ${job.revision}` : 'Сервер ещё не подтвердил задание';
  const connectivityNote = activity.unreachable ? 'Сервер недоступен. Повторим проверку автоматически.' : null;
  const base = { serverLine, steps, connectivityNote, showResult: false, resultNote: null };

  if (op.jobMissing) {
    return {
      ...base,
      tone: 'danger',
      title: 'Сервер не знает этот импорт',
      body: `Задание ${job?.jobId ?? ''} не найдено на сервере, например после сброса mock. Локальную запись можно убрать.`,
      actions: [action('forget', 'Убрать с устройства', 'primary')],
    };
  }

  switch (op.upload.phase) {
    case 'rejected':
      return {
        ...base,
        tone: 'danger',
        title: 'Сервер отклонил файл',
        body: `Причина: ${errorText(op.upload.lastError)}. Задание не создано, копия файла удалена.`,
        actions: [action('new_import', 'Выбрать другой файл', 'primary')],
      };
    case 'sending':
      return {
        ...base,
        tone: 'progress',
        title: 'Отправляем файл',
        body: 'Ключ операции сохранён до отправки. Если связь оборвётся, повтор не создаст второй импорт.',
        actions: [],
      };
    case 'unknown':
    case 'not_found': {
      const copyMissing = op.upload.lastError === 'copy_missing' || op.file.uri === null;
      const copyChanged = op.upload.lastError === 'copy_changed';
      const unknown = op.upload.phase === 'unknown';
      const title = unknown ? 'Исход отправки неизвестен' : 'Сервер пока не нашёл этот импорт';
      let body = unknown
        ? `Ответ не дошёл (${errorText(op.upload.lastError)}). Файл мог быть принят. Проверяем по ключу операции, сам файл повторно не отправляется.`
        : 'Проверка по ключу ответила 404. Можно отправить тот же файл ещё раз с тем же ключом: второго импорта не будет.';
      const actions: ActionSpec[] = [];
      if (copyChanged) {
        body = 'Локальная копия файла изменилась. Отправить другие байты с этим ключом нельзя.';
        actions.push(action('check_now', 'Проверить по ключу', 'primary'), action('discard', 'Отказаться от импорта', 'quiet'));
      } else if (copyMissing) {
        body += ' Локальная копия файла пропала: чтобы повторить, выберите тот же файл ещё раз.';
        const check = action('check_now', 'Проверить по ключу', unknown ? 'primary' : 'secondary');
        const reattach = action('reattach', 'Выбрать тот же файл', unknown ? 'secondary' : 'primary');
        actions.push(...(unknown ? [check, reattach] : [reattach, check]), action('discard', 'Отказаться от импорта', 'quiet'));
      } else if (unknown) {
        actions.push(
          action('check_now', 'Проверить сейчас', 'primary'),
          action('retry_upload', 'Отправить ещё раз с тем же ключом', 'secondary'),
        );
      } else {
        actions.push(
          action('retry_upload', 'Отправить повторно', 'primary'),
          action('check_now', 'Проверить ещё раз', 'secondary'),
          action('discard', 'Отказаться от импорта', 'quiet'),
        );
      }
      return { ...base, tone: 'warning', title, body, actions };
    }
    case 'accepted':
      break;
  }

  if (!job) {
    return { ...base, tone: 'progress', title: 'Ждём ответа сервера', body: 'Задание создано, статус ещё не получен.', actions: [] };
  }

  const hasResult = job.result !== undefined;
  const deletion = op.deletion;

  if (job.status === 'deleted') {
    return {
      ...base,
      tone: 'success',
      title: 'Удалено с сервера',
      body: `Сервер подтвердил удаление: GET вернул deleted, ревизия ${job.revision}. Локальная копия файла была удалена раньше.`,
      actions: [action('new_import', 'Новый импорт', 'primary')],
    };
  }

  if (deletion) {
    const result = { showResult: hasResult };
    if (deletion.phase === 'failed') {
      return {
        ...base,
        ...result,
        tone: 'danger',
        title: 'Не удалено',
        body: `Сервер не удалил импорт: ${errorText(deletion.lastError)}. Данные остаются на сервере. Повтор использует тот же ключ удаления.`,
        resultNote: 'Эти данные всё ещё на сервере.',
        actions: [action('retry_delete', 'Повторить удаление', 'primary'), action('refresh', 'Обновить статус', 'quiet')],
      };
    }
    if (deletion.phase === 'unknown') {
      return {
        ...base,
        ...result,
        tone: 'warning',
        title: 'Исход удаления неизвестен',
        body: 'Ответ на запрос удаления не дошёл. Пока сервер не вернёт deleted, данные считаются не удалёнными.',
        resultNote: 'Удаление не подтверждено.',
        actions: [action('retry_delete', 'Повторить с тем же ключом', 'primary'), action('refresh', 'Обновить статус', 'secondary')],
      };
    }
    return {
      ...base,
      ...result,
      tone: 'progress',
      title: deletion.phase === 'sending' ? 'Отправляем запрос на удаление' : 'Удаляется',
      body:
        deletion.phase === 'sending'
          ? 'Ключ удаления сохранён до запроса.'
          : 'Сервер принял запрос (202). Удалённым импорт станет, только когда сервер вернёт deleted.',
      resultNote: 'Удаление ещё не подтверждено.',
      actions: [],
    };
  }

  switch (job.status) {
    case 'queued':
      return {
        ...base,
        tone: 'progress',
        title: 'В очереди',
        body: 'Сервер принял файл и поставил задание в очередь. Отчёта ещё нет.',
        actions: [],
      };
    case 'processing':
      return { ...base, tone: 'progress', title: 'Обрабатывается', body: 'Сервер разбирает выписку. Отчёта ещё нет.', actions: [] };
    case 'deleting':
      return {
        ...base,
        tone: 'progress',
        title: 'Удаляется',
        body: 'Сервер удаляет импорт. Удалённым он станет, только когда сервер вернёт deleted.',
        showResult: hasResult,
        resultNote: 'Удаление ещё не подтверждено.',
        actions: [],
      };
    case 'ready':
    default: {
      const count = job.result?.items.length ?? 0;
      const total = job.result ? formatMinor(monthlyTotalMinor(job.result.items), job.result.currency) : '';
      return {
        ...base,
        tone: 'success',
        title: 'Отчёт готов',
        body: `Сервер нашёл регулярных списаний: ${count}. Итого ${total} в месяц.`,
        showResult: hasResult,
        actions: [
          action('delete', 'Удалить с сервера', 'destructive'),
          action('refresh', 'Обновить статус', 'quiet'),
          action('new_import', 'Новый импорт', 'quiet'),
        ],
      };
    }
  }
}
