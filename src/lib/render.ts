import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from 'mediabunny';
import type { BrandKit } from './brandKits';
import { captionFromGroups, type CaptionGroup, type CaptionLook, type Clip } from './clips';
import { drawCaption, drawLogo, drawWatermark } from './draw';

// Vertical 1080p is what TikTok, Reels and Shorts all expect; paid plans can also export 4K.
export const SIZES = { '1080p': { width: 1080, height: 1920 }, '4k': { width: 2160, height: 3840 } } as const;
export type ExportSize = keyof typeof SIZES;

export interface RenderedClip {
  blob: Blob;
  // '.mp4' or '.webm'
  extension: string;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Renders one clip on this device: trims it, crops it to 9:16 with the clip's framing, scales to
 * 1080×1920 (or 4K), and burns in the captions and (on Free) the watermark.
 */
export async function renderClip(
  file: File,
  clip: Clip,
  captions: CaptionGroup[],
  {
    look,
    logo,
    watermark,
    size = '1080p',
    onProgress,
    signal,
  }: {
    look: CaptionLook;
    // A brand kit's logo, already decoded.
    logo?: { image: ImageBitmap; corner: BrandKit['logo_corner'] } | null;
    watermark: boolean;
    size?: ExportSize;
    onProgress?: (p: number) => void;
    signal?: AbortSignal;
  },
): Promise<RenderedClip> {
  const { width: OUT_W, height: OUT_H } = SIZES[size];
  // Captions are drawn on a canvas, which only uses fonts that are already loaded.
  const { ensureFont } = await import('./brandKits');
  await ensureFont(look.font);
  await document.fonts.load(`${look.weight} 80px "${look.font}"`).catch(() => {});

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This video has no picture.');

    // MP4 (H.264 + AAC) uploads everywhere. Browsers that can't encode H.264 get WebM (VP9 + Opus).
    const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: OUT_W, height: OUT_H });
    if (!videoCodec) throw new Error("This browser can't create video files. Try the latest Chrome or Edge.");
    const format = videoCodec === 'avc' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
    const audioCodec = await getFirstEncodableAudioCodec(
      format.getSupportedAudioCodecs().filter((c) => c === 'aac' || c === 'opus'),
      { numberOfChannels: 2, sampleRate: 48000 },
    );

    // Crop the largest 9:16 area, placed left-to-right by the clip's framing.
    const srcW = track.displayWidth;
    const srcH = track.displayHeight;
    let crop;
    if (srcW / srcH > 9 / 16) {
      const width = even(Math.min(srcW, (srcH * 9) / 16));
      crop = { left: Math.round(((srcW - width) * clip.cropX) / 100), top: 0, width, height: srcH };
    } else {
      const height = even(Math.min(srcH, (srcW * 16) / 9));
      crop = { left: 0, top: Math.round((srcH - height) / 2), width: srcW, height };
    }

    const canvas = new OffscreenCanvas(OUT_W, OUT_H);
    const ctx = canvas.getContext('2d')!;
    const output = new Output({ format, target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      trim: { start: clip.start, end: clip.end },
      video: {
        codec: videoCodec,
        bitrate: QUALITY_HIGH,
        crop,
        width: OUT_W,
        height: OUT_H,
        fit: 'cover',
        forceTranscode: true,
        processedWidth: OUT_W,
        processedHeight: OUT_H,
        process: (sample) => {
          sample.draw(ctx, 0, 0, OUT_W, OUT_H);
          // Sample times start at 0 at the clip's start.
          const caption = captionFromGroups(captions, clip.start + sample.timestamp);
          if (logo) drawLogo(ctx, logo.image, logo.corner, OUT_W, OUT_H);
          if (caption) drawCaption(ctx, caption, look, OUT_W, OUT_H);
          if (watermark) drawWatermark(ctx, OUT_W, OUT_H);
          return canvas;
        },
      },
      audio: audioCodec ? { codec: audioCodec, bitrate: 160_000 } : { discard: true },
    });
    if (!conversion.isValid) {
      console.error('Clip export not possible', conversion.discardedTracks);
      throw new Error("This browser can't create this clip. Try the latest Chrome or Edge.");
    }
    if (onProgress) conversion.onProgress = (p) => onProgress(p);
    const cancel = () => void conversion.cancel();
    signal?.addEventListener('abort', cancel);
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    return { blob: new Blob([output.target.buffer!], { type: format.mimeType }), extension: format.fileExtension };
  } finally {
    input.dispose();
  }
}
