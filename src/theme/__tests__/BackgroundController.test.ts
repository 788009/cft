import { describe, expect, it } from 'vitest';
import { isSupportedBackgroundImage } from '../BackgroundController';

function file(name: string, type: string): File {
  return { name, type } as File;
}

describe('background image validation', () => {
  it('accepts PNG, JPEG and WebP files by MIME type or extension', () => {
    expect(isSupportedBackgroundImage(file('background.bin', 'image/png'))).toBe(true);
    expect(isSupportedBackgroundImage(file('background.jpg', ''))).toBe(true);
    expect(isSupportedBackgroundImage(file('background.JPEG', ''))).toBe(true);
    expect(isSupportedBackgroundImage(file('background.webp', ''))).toBe(true);
  });

  it('rejects unsupported files', () => {
    expect(isSupportedBackgroundImage(file('background.gif', 'image/gif'))).toBe(false);
    expect(isSupportedBackgroundImage(file('background.html', 'text/html'))).toBe(false);
    expect(isSupportedBackgroundImage(file('background.png', 'text/html'))).toBe(false);
  });
});
