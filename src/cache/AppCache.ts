import type { SettingsStateStore, AppSettingsState } from '@/settings/SettingsState';
import { createSettingsEnvelope, migrateCachedSettings } from './SettingsSchema';
import {
  clearResourceCache,
  initializeResourceCache,
  registerResourceServiceWorker,
  unregisterResourceServiceWorkers,
} from './ResourceCache';
import { defaultConfig } from '@/config';

const CACHE_ENABLED_KEY = 'cft.cache.enabled';
const DATABASE_NAME = 'cft-cache';
const DATABASE_VERSION = 1;
const SETTINGS_STORE = 'settings';
const BLOBS_STORE = 'blobs';
const META_STORE = 'meta';
const SETTINGS_KEY = 'app-settings';
const BACKGROUND_KEY = 'uploaded-background';
const CHANNEL_NAME = 'cft-cache';

interface CachedBackground {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
}

type CacheMessage =
  | { type: 'settings-changed'; sender: string }
  | { type: 'cleared'; sender: string }
  | { type: 'enabled'; sender: string }
  | { type: 'disabled'; sender: string };

export interface AppCacheInitialization {
  cache: AppCache;
  settings: AppSettingsState;
}

export class AppCache {
  private readonly defaults: AppSettingsState;
  private readonly senderId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  private readonly channel: BroadcastChannel | null;
  private database: IDBDatabase | null;
  private enabled: boolean;
  private unsubscribeSettings: (() => void) | null = null;
  private applyExternalSettings: ((settings: AppSettingsState) => void) | null = null;
  private applyingExternal = false;
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    defaults: AppSettingsState,
    database: IDBDatabase | null,
    enabled: boolean,
  ) {
    this.defaults = cloneSettings(defaults);
    this.database = database;
    this.enabled = enabled;
    this.channel = typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(CHANNEL_NAME);
    this.channel?.addEventListener('message', this.handleChannelMessage);
  }

  public static async initialize(
    defaults: AppSettingsState,
  ): Promise<AppCacheInitialization> {
    const enabled = readCacheEnabled();
    const database = await openDatabase();
    const cache = new AppCache(defaults, database, enabled);
    let settings = cloneSettings(defaults);
    if (enabled) {
      try {
        settings = await cache.readSettings();
      } catch (error) {
        console.warn('设置缓存读取失败，将使用默认设置:', error);
      }
    }

    if (enabled) {
      await Promise.all([
        initializeResourceCache(true, cache),
        registerResourceServiceWorker(),
      ]);
    } else {
      await Promise.all([
        cache.clearStoredData(),
        unregisterResourceServiceWorkers(),
      ]).catch((error: unknown) => console.warn('停用缓存时清理残留失败:', error));
    }
    return { cache, settings };
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public bindSettings(
    store: SettingsStateStore,
    applyExternalSettings: (settings: AppSettingsState) => void,
  ): void {
    this.unsubscribeSettings?.();
    this.applyExternalSettings = applyExternalSettings;
    this.unsubscribeSettings = store.subscribe((settings) => {
      if (!this.enabled || this.applyingExternal) return;
      this.enqueueWrite(async () => {
        await this.writeSettings(settings);
        this.postMessage({ type: 'settings-changed', sender: this.senderId });
      });
    });
  }

  public async setEnabled(
    enabled: boolean,
    currentSettings: Readonly<AppSettingsState>,
  ): Promise<boolean> {
    if (enabled === this.enabled) return false;
    this.enabled = enabled;
    writeCacheEnabled(enabled);

    if (enabled) {
      await Promise.all([
        this.writeSettings(currentSettings),
        initializeResourceCache(true, this),
        registerResourceServiceWorker(),
      ]);
      this.postMessage({ type: 'enabled', sender: this.senderId });
      return false;
    }

    await this.clearStoredData();
    await unregisterResourceServiceWorkers();
    this.postMessage({ type: 'disabled', sender: this.senderId });
    return true;
  }

  public async clear(): Promise<void> {
    await this.clearStoredData();
    this.applySettingsFromOutside(this.defaults);
    this.postMessage({ type: 'cleared', sender: this.senderId });
  }

  public destroy(): void {
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.applyExternalSettings = null;
    this.channel?.removeEventListener('message', this.handleChannelMessage);
    this.channel?.close();
    this.database?.close();
    this.database = null;
  }

  public async getMeta(key: string): Promise<unknown> {
    return this.getRecord(META_STORE, key);
  }

  public async putMeta(key: string, value: unknown): Promise<void> {
    await this.putRecord(META_STORE, key, value);
  }

  public async deleteMeta(key: string): Promise<void> {
    await this.deleteRecord(META_STORE, key);
  }

  private async readSettings(): Promise<AppSettingsState> {
    const raw = await this.getRecord(SETTINGS_STORE, SETTINGS_KEY);
    if (raw === undefined) return cloneSettings(this.defaults);
    const migrated = migrateCachedSettings(raw, this.defaults);
    if (!migrated) {
      await this.deleteRecord(SETTINGS_STORE, SETTINGS_KEY);
      return cloneSettings(this.defaults);
    }

    const background = parseCachedBackground(
      await this.getRecord(BLOBS_STORE, BACKGROUND_KEY),
    );
    const settings: AppSettingsState = {
      ...migrated.values,
      infoRectanglePlacement: { ...migrated.values.infoRectanglePlacement },
      backgroundFile: background
        ? new File([background.blob], background.name, {
          type: background.type,
          lastModified: background.lastModified,
        })
        : null,
    };
    await this.putRecord(SETTINGS_STORE, SETTINGS_KEY, createSettingsEnvelope(settings));
    return settings;
  }

  private async writeSettings(settings: Readonly<AppSettingsState>): Promise<void> {
    if (!this.database) return;
    const transaction = this.database.transaction(
      [SETTINGS_STORE, BLOBS_STORE],
      'readwrite',
    );
    transaction.objectStore(SETTINGS_STORE).put(createSettingsEnvelope(settings), SETTINGS_KEY);
    const blobs = transaction.objectStore(BLOBS_STORE);
    if (settings.backgroundFile) {
      const file = settings.backgroundFile;
      const background: CachedBackground = {
        blob: file,
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
      };
      blobs.put(background, BACKGROUND_KEY);
    } else {
      blobs.delete(BACKGROUND_KEY);
    }
    await transactionDone(transaction);
  }

  private async clearStoredData(): Promise<void> {
    await this.writeQueue.catch(() => undefined);
    await Promise.all([
      this.clearSettingsRecords(),
      clearResourceCache(this),
    ]);
  }

  private async clearSettingsRecords(): Promise<void> {
    if (!this.database) return;
    const transaction = this.database.transaction(
      [SETTINGS_STORE, BLOBS_STORE],
      'readwrite',
    );
    transaction.objectStore(SETTINGS_STORE).delete(SETTINGS_KEY);
    transaction.objectStore(BLOBS_STORE).delete(BACKGROUND_KEY);
    await transactionDone(transaction);
  }

  private enqueueWrite(operation: () => Promise<void>): void {
    this.writeQueue = this.writeQueue
      .then(operation)
      .catch((error: unknown) => console.warn('设置缓存写入失败:', error));
  }

  private readonly handleChannelMessage = (event: MessageEvent<CacheMessage>): void => {
    const message = event.data;
    if (!message || message.sender === this.senderId) return;
    if (message.type === 'enabled') {
      if (!this.enabled) window.location.reload();
      return;
    }
    if (message.type === 'disabled') {
      window.location.reload();
      return;
    }
    if (message.type === 'cleared') {
      void clearResourceCache(this).catch((error: unknown) => (
        console.warn('同步清除资源缓存失败:', error)
      ));
      this.applySettingsFromOutside(this.defaults);
      return;
    }
    if (message.type === 'settings-changed' && this.enabled) {
      void this.readSettings().then((settings) => this.applySettingsFromOutside(settings));
    }
  };

  private applySettingsFromOutside(settings: Readonly<AppSettingsState>): void {
    if (!this.applyExternalSettings) return;
    this.applyingExternal = true;
    try {
      this.applyExternalSettings(cloneSettings(settings));
    } finally {
      this.applyingExternal = false;
    }
  }

  private postMessage(message: CacheMessage): void {
    this.channel?.postMessage(message);
  }

  private async getRecord(storeName: string, key: string): Promise<unknown> {
    if (!this.database) return undefined;
    const transaction = this.database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    const value = await requestResult(request);
    await transactionDone(transaction);
    return value;
  }

  private async putRecord(storeName: string, key: string, value: unknown): Promise<void> {
    if (!this.database) return;
    const transaction = this.database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value, key);
    await transactionDone(transaction);
  }

  private async deleteRecord(storeName: string, key: string): Promise<void> {
    if (!this.database) return;
    const transaction = this.database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return null;
  try {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      for (const storeName of [SETTINGS_STORE, BLOBS_STORE, META_STORE]) {
        if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
      }
    });
    return await requestResult(request);
  } catch (error) {
    console.warn('IndexedDB 不可用，设置将不会缓存:', error);
    return null;
  }
}

function readCacheEnabled(): boolean {
  try {
    const stored = localStorage.getItem(CACHE_ENABLED_KEY);
    return stored === null ? defaultConfig.cacheEnabledByDefault : stored !== 'false';
  } catch {
    return defaultConfig.cacheEnabledByDefault;
  }
}

function writeCacheEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CACHE_ENABLED_KEY, String(enabled));
  } catch {
    // localStorage 不可用时，本次页面会话中的开关仍然生效。
  }
}

function cloneSettings(settings: Readonly<AppSettingsState>): AppSettingsState {
  return {
    ...settings,
    infoRectanglePlacement: { ...settings.infoRectanglePlacement },
  };
}

function parseCachedBackground(value: unknown): CachedBackground | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<CachedBackground>;
  if (
    !(candidate.blob instanceof Blob) ||
    typeof candidate.name !== 'string' ||
    typeof candidate.type !== 'string' ||
    typeof candidate.lastModified !== 'number'
  ) return null;
  return candidate as CachedBackground;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}
