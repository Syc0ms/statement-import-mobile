import AsyncStorage from '@react-native-async-storage/async-storage';

import type { KeyValueStore } from '../core/ports';

export const asyncStorage: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8787';
const API_BASE_URL_KEY = 'statement-import/api-base-url/v1';

/** Accepts http(s)://host[:port] only; anything else is refused. */
export function normaliseBaseUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const match = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(:(\d{1,5}))?$/i.exec(withScheme);
  if (!match) return null;
  if (match[4] !== undefined && Number(match[4]) > 65535) return null;
  return withScheme.toLowerCase();
}

/** API base URL setting, configurable on the diagnostics screen. */
export class ApiSettings {
  private value = DEFAULT_API_BASE_URL;
  private readonly listeners = new Set<() => void>();

  get baseUrl(): string {
    return this.value;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.value;

  async load(): Promise<void> {
    const stored = await AsyncStorage.getItem(API_BASE_URL_KEY).catch(() => null);
    if (stored) this.set(stored);
  }

  async save(input: string): Promise<boolean> {
    const url = normaliseBaseUrl(input);
    if (!url) return false;
    this.set(url);
    if (url === DEFAULT_API_BASE_URL) await AsyncStorage.removeItem(API_BASE_URL_KEY);
    else await AsyncStorage.setItem(API_BASE_URL_KEY, url);
    return true;
  }

  private set(url: string) {
    this.value = url;
    for (const listener of this.listeners) listener();
  }
}
