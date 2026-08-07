import { defaultConfig } from '@/config';
import type { ResolvedTheme } from '@/theme/ThemeController';

export function updateFavicon(theme: ResolvedTheme): void {
  const favicon = defaultConfig.favicon;
  if (!favicon) {
    return;
  }

  const { light, dark } = favicon;

  // 根据主题选择图标路径，并在缺失时进行互相兜底
  const targetHref = theme === 'dark'
    ? (dark ?? light)
    : (light ?? dark);

  // 若未配置任何有效路径，不执行 DOM 操作
  if (!targetHref) {
    return;
  }

  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }

  if (link.getAttribute('href') !== targetHref) {
    link.href = targetHref;
  }
}
