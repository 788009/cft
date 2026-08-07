import { AppController, createDefaultAppSettings } from '@/AppController';
import { defaultConfig } from '@/config';
import { AppCache } from '@/cache/AppCache';

document.title = defaultConfig.pageTitle;
void startApp();

async function startApp(): Promise<void> {
  const defaults = createDefaultAppSettings(window.innerWidth, window.innerHeight);
  const { cache, settings } = await AppCache.initialize(defaults);
  const app = new AppController(cache, settings);
  app.start();
}
