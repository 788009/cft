import { getDataAssetUrl } from '@/data/fetcher';
import type { ResolvedTheme } from './ThemeController';

const SUPPORTED_BACKGROUND_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function isSupportedBackgroundImage(file: File): boolean {
  if (SUPPORTED_BACKGROUND_IMAGE_TYPES.has(file.type)) return true;
  if (file.type) return false;
  return /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

export interface BackgroundSnapshot {
  imageUrl: string | null;
}

export class BackgroundController {
  private readonly target: HTMLElement;
  private readonly configuredImages: Record<ResolvedTheme, string | null>;
  private uploadedImageUrl: string | null = null;
  private currentTheme: ResolvedTheme = 'light';

  constructor(
    target: HTMLElement,
    configuredImages: Record<ResolvedTheme, string | null>,
  ) {
    this.target = target;
    this.configuredImages = { ...configuredImages };
    this.apply();
  }

  public setTheme(theme: ResolvedTheme): void {
    this.currentTheme = theme;
    this.apply();
  }

  public setUploadedFile(file: File | null): void {
    if (this.uploadedImageUrl) URL.revokeObjectURL(this.uploadedImageUrl);
    this.uploadedImageUrl = file ? URL.createObjectURL(file) : null;
    this.apply();
  }

  public getSnapshot(): BackgroundSnapshot {
    const configuredPath = this.configuredImages[this.currentTheme];
    return {
      imageUrl: this.uploadedImageUrl ?? (
        configuredPath ? getDataAssetUrl(configuredPath) : null
      ),
    };
  }

  public destroy(): void {
    if (this.uploadedImageUrl) URL.revokeObjectURL(this.uploadedImageUrl);
    this.uploadedImageUrl = null;
    this.target.style.backgroundImage = '';
    this.target.style.backgroundSize = '';
    this.target.style.backgroundPosition = '';
    this.target.style.backgroundRepeat = '';
  }

  private apply(): void {
    const { imageUrl } = this.getSnapshot();
    this.target.style.backgroundImage = imageUrl ? `url("${imageUrl}")` : '';
    this.target.style.backgroundSize = imageUrl ? 'cover' : '';
    this.target.style.backgroundPosition = imageUrl ? 'center center' : '';
    this.target.style.backgroundRepeat = imageUrl ? 'no-repeat' : '';
  }
}
