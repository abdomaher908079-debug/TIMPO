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
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
} from 'mediabunny';
import type { BrandKit } from './brandKits';
import { captionFromGroups, cropAt, editedLook, FADE_SECONDS, fadeAt, fixWords, proParts, zoomAt, zoomsFor, type CaptionGroup, type CaptionLook, type Clip } from './clips';
import { breathe } from './device';
import { drawCaption, drawHeadline, drawLogo, drawWatermark } from './draw';
import { createSharpener, sharpenAmount, type Sharpener } from './sharpen';
import { cleanEdges, loudnessGain, processSound } from './sound';

// Vertical 1080p is what TikTok, Reels and Shorts all expect; paid plans can also export 4K.
export const SIZES = {
  '720p': { width: 720, height: 1280 },
  '1080p': { width: 1080, height: 1920 },
  '4k': { width: 2160, height: 3840 },
} as const;
export type ExportSize = keyof typeof SIZES;

export interface RenderedClip {
  blob: Blob;
  // '.mp4' or '.webm'
  extension: string;
}

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
    pro = false,
    size = '1080p',
    sharpen = true,
    onProgress,
    signal,
  }: {
    look: CaptionLook;
    // A brand kit's logo, already decoded.
    logo?: { image: ImageBitmap; corner: BrandKit['logo_corner'] } | null;
    watermark: boolean;
    // The Pro edit: follow the speaker, zoom in on punch-ins, highlighted words, the headline.
    pro?: boolean;
    size?: ExportSize;
    // Restore crispness when the picture is enlarged (see sharpen.ts).
    sharpen?: boolean;
    onProgress?: (p: number) => void;
    signal?: AbortSignal;
  },
): Promise<RenderedClip> {
  const { width: OUT_W, height: OUT_H } = SIZES[size];
  // The person's own touches: caption size, place, color and motion, fixed words, zoom and fades.
  look = editedLook(look, clip.edit);
  captions = fixWords(captions, clip.edit?.fixes);
  const extraZoom = clip.edit?.zoom ?? 1;
  // Captions are drawn on a canvas, which only uses fonts that are already loaded.
  const { ensureFont } = await import('./brandKits');
  await ensureFont(look.font);
  await document.fonts.load(`${look.weight} 80px "${look.font}"`).catch(() => {});

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  // Made on the first frame that needs it; null once it turns out it can't be (no WebGL2).
  const sharpening: { tool: Sharpener | null | undefined } = { tool: sharpen ? undefined : null };
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This video has no picture.');
    // Tidy edges (no dead air, no clipped last word) and the sound's loudness, from the exact word times.
    const { start, end } = cleanEdges(clip.start, clip.end, captions, await input.computeDuration());
    const gain = await loudnessGain(input, start, end).catch((err) => {
      console.warn('Loudness not measured', err);
      return 1;
    });
    const duration = end - start;

    // MP4 (H.264 + AAC) uploads everywhere. Browsers that can't encode H.264 get WebM (VP9 + Opus).
    const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: OUT_W, height: OUT_H });
    if (!videoCodec) throw new Error("This browser can't create video files. Try the latest Chrome or Edge.");
    const format = videoCodec === 'avc' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
    const audioCodec = await getFirstEncodableAudioCodec(
      format.getSupportedAudioCodecs().filter((c) => c === 'aac' || c === 'opus'),
      { numberOfChannels: 2, sampleRate: 48000 },
    );

    // Fill: the largest 9:16 area, placed left-to-right by the clip's framing (which can follow the
    // speaker). Fit: the whole picture across the middle, over a blurred copy of itself.
    const srcW = track.displayWidth;
    const srcH = track.displayHeight;
    const wide = srcW / srcH > 9 / 16;
    const cropW = wide ? Math.min(srcW, (srcH * 9) / 16) : srcW;
    const cropH = wide ? srcH : Math.min(srcH, (srcW * 16) / 9);
    const fit = clip.layout === 'fit' && wide;
    const fitH = Math.round((OUT_W * srcH) / srcW);
    // `pro`: the Pro edit is available; each part can still be off for this clip.
    const parts = proParts(clip, pro);
    const zooms = parts.zoom ? zoomsFor(captions.flatMap((g) => g.words), clip.punchIns) : [];
    const headline = parts.headline ? clip.headline : undefined;
    // The headline sits in the blurred band above the picture (whole picture), or near the top for
    // the first seconds (fill), where the platforms put none of their own buttons.
    const headlineMiddle = fit ? Math.max(0.12, ((OUT_H - fitH) / 2 / OUT_H) * 0.55) : 0.15;

    const canvas = new OffscreenCanvas(OUT_W, OUT_H);
    const ctx = canvas.getContext('2d')!;
    // The crop is usually enlarged (a 1080p episode's 9:16 crop is 608 pixels wide): the best scaling keeps it sharp.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // The blurred background: drawn tiny, then stretched (much cheaper than a blur filter on phones).
    const blur = new OffscreenCanvas(18, 32);
    const blurCtx = blur.getContext('2d')!;
    const output = new Output({ format, target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      trim: { start, end },
      video: {
        codec: videoCodec,
        bitrate: QUALITY_VERY_HIGH,
        forceTranscode: true,
        processedWidth: OUT_W,
        processedHeight: OUT_H,
        process: async (sample) => {
          // One frame at a time with a pause in between, so the page (and the phone) stays responsive.
          await breathe();
          // Sample times start at 0 at the clip's start.
          const t = start + sample.timestamp;
          const left = ((srcW - cropW) * cropAt(clip, t, parts.follow)) / 100;
          const top = (srcH - cropH) / 2;
          const zoom = zoomAt(zooms, t) * extraZoom;
          if (fit) {
            sample.draw(blurCtx, left, top, cropW, cropH, 0, 0, blur.width, blur.height);
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(blur, 0, 0, OUT_W, OUT_H);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fillRect(0, 0, OUT_W, OUT_H);
            const w = OUT_W * zoom;
            const h = fitH * zoom;
            sample.draw(ctx, (OUT_W - w) / 2, (OUT_H - h) / 2, w, h);
          } else {
            // Zooming in crops tighter around the same center.
            const w = cropW / zoom;
            const h = cropH / zoom;
            const x = Math.min(srcW - w, Math.max(0, left + (cropW - w) / 2));
            const y = Math.min(srcH - h, Math.max(0, top + (cropH - h) / 2));
            sample.draw(ctx, x, y, w, h, 0, 0, OUT_W, OUT_H);
          }
          // The picture only (captions, logo and watermark are drawn sharp below).
          const amount = sharpenAmount(fit ? (OUT_W * zoom) / srcW : (OUT_W * zoom) / cropW);
          if (amount > 0 && sharpening.tool !== null) {
            sharpening.tool ??= createSharpener(OUT_W, OUT_H);
            const sharp = sharpening.tool?.apply(canvas, amount);
            if (sharp) ctx.drawImage(sharp, 0, 0);
          }
          if (headline) {
            const since = sample.timestamp;
            const alpha = fit ? 1 : since < 3.6 ? 1 : 1 - (since - 3.6) / 0.4;
            drawHeadline(ctx, headline, look, OUT_W, OUT_H, headlineMiddle, alpha);
          }
          const caption = captionFromGroups(captions, t, parts.highlight ? clip.emphasis : undefined);
          if (logo) drawLogo(ctx, logo.image, logo.corner, OUT_W, OUT_H);
          if (caption) drawCaption(ctx, caption, look, OUT_W, OUT_H);
          if (watermark) drawWatermark(ctx, OUT_W, OUT_H);
          const dark = fadeAt({ start, end, edit: clip.edit }, t);
          if (dark > 0) {
            ctx.fillStyle = `rgba(0, 0, 0, ${dark})`;
            ctx.fillRect(0, 0, OUT_W, OUT_H);
          }
          return canvas;
        },
      },
      audio: audioCodec
        ? {
            codec: audioCodec,
            bitrate: 192_000,
            // Otherwise matching sound is copied as it is, skipping the processing below.
            forceTranscode: true,
            // Platform loudness, no clipping, no clicks at the cuts, and fading with the picture.
            process: (sample) =>
              processSound(sample, gain, duration, clip.edit?.fadeIn ? FADE_SECONDS : 0, clip.edit?.fadeOut ? FADE_SECONDS : 0),
          }
        : { discard: true },
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
    sharpening.tool?.dispose();
    input.dispose();
  }
}
