export type ProviderErrorKind = 'rate_limited' | 'refused' | 'bad_output' | 'empty' | 'upstream';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && DATA_URL.test(value);
}

export function splitDataUrl(dataUrl: string): { mediaType: ImageMediaType; data: string } {
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new Error('Not an image data URL');
  return { mediaType: match[1] as ImageMediaType, data: match[2]! };
}
