import {
  ALL_FORMATS,
  AudioSample,
  BlobSource,
  BufferTarget,
  Conversion,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_VERY_HIGH,
  VideoSample,
  VideoSampleSink,
  WebMOutputFormat,
} from 'mediabunny';
import type { BrandKit } from './brandKits';
import { captionFromGroups, cropAt, editedLook, FADE_SECONDS, fadeAt, fixWords, proParts, splitCrops, withoutFillers, zoomAt, zoomsFor, type CaptionGroup, type CaptionLook, type Clip } from './clips';
import { keptRanges, outputTime, playedSeconds, rangeAtOrAfter, soundPieces, type TimeRange } from './cuts';
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

/** How a clip is drawn: shared by the export and its cover image. */
interface Drawing {
  look: CaptionLook;
  // A brand kit's logo, already decoded.
  logo?: { image: ImageBitmap; corner: BrandKit['logo_corner'] } | null;
  watermark: boolean;
  // The Pro edit: follow the speaker, zoom in on punch-ins, highlighted words, the headline.
  pro?: boolean;
  size?: ExportSize;
  // Restore crispness when the picture is enlarged (see sharpen.ts).
  sharpen?: boolean;
}

/** The clip's look with its own touches, its captions as shown, and the font loaded for the canvas. */
async function prepare(clip: Clip, captions: CaptionGroup[], look: CaptionLook) {
  // The person's own touches: caption size, place, color and motion, fixed words, zoom and fades.
  look = editedLook(look, clip.edit, clip.layout);
  const tighten = !clip.edit?.keepPauses;
  const timedWords = captions.flatMap((g) => g.words);
  captions = fixWords(tighten ? withoutFillers(captions) : captions, clip.edit?.fixes);
  // Captions are drawn on a canvas, which only uses fonts that are already loaded.
  const { ensureFont } = await import('./brandKits');
  await ensureFont(look.font);
  await document.fonts.load(`${look.weight} 80px "${look.font}"`).catch(() => {});
  return { look, captions, tighten, timedWords };
}

/**
 * Draws frames of the clip at the output size: the framing (crop, whole picture or split screen) with zoom-ins,
 * sharpening, then the headline, logo, captions, watermark and fades on top. `paint` takes a frame of the
 * episode, its time `t` in the episode and `at` in the clip; `cover` draws a still for the cover (headline kept,
 * no captions or fade).
 */
function painter(
  clip: Clip,
  captions: CaptionGroup[],
  { look, logo, watermark, pro = false, size = '1080p', sharpen = true }: Drawing,
  srcW: number,
  srcH: number,
  duration: number,
) {
  const { width: OUT_W, height: OUT_H } = SIZES[size];
  const extraZoom = clip.edit?.zoom ?? 1;
  // Fill: the largest 9:16 area, placed left-to-right by the clip's framing (which can follow the
  // speaker). Fit: the whole picture across the middle, over a blurred copy of itself.
  const wide = srcW / srcH > 9 / 16;
  const cropW = wide ? Math.min(srcW, (srcH * 9) / 16) : srcW;
  const cropH = wide ? srcH : Math.min(srcH, (srcW * 16) / 9);
  const fit = clip.layout === 'fit' && wide;
  // Two people one above the other, each in a half of the frame.
  const split = clip.layout === 'split' && clip.split && wide ? clip.split : null;
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
  // Made on the first frame that needs it; null once it turns out it can't be (no WebGL2).
  const sharpening: { tool: Sharpener | null | undefined } = { tool: sharpen ? undefined : null };

  function paint(sample: VideoSample, t: number, at: number, cover = false): OffscreenCanvas {
    const left = ((srcW - cropW) * cropAt(clip, t, parts.follow)) / 100;
    const top = (srcH - cropH) / 2;
    const zoom = zoomAt(zooms, t) * extraZoom;
    const crops = split ? splitCrops(srcW, srcH, split, zoom) : null;
    if (crops) {
      const { top, bottom } = crops;
      sample.draw(ctx, top[0]!, top[1]!, top[2]!, top[3]!, 0, 0, OUT_W, OUT_H / 2);
      sample.draw(ctx, bottom[0]!, bottom[1]!, bottom[2]!, bottom[3]!, 0, OUT_H / 2, OUT_W, OUT_H / 2);
    } else if (fit) {
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
    const amount = sharpenAmount(crops ? OUT_W / crops.top[2]! : fit ? (OUT_W * zoom) / srcW : (OUT_W * zoom) / cropW);
    if (amount > 0 && sharpening.tool !== null) {
      sharpening.tool ??= createSharpener(OUT_W, OUT_H);
      const sharp = sharpening.tool?.apply(canvas, amount);
      if (sharp) ctx.drawImage(sharp, 0, 0);
    }
    if (headline) {
      const alpha = fit || cover ? 1 : at < 3.6 ? 1 : 1 - (at - 3.6) / 0.4;
      drawHeadline(ctx, headline, look, OUT_W, OUT_H, headlineMiddle, alpha);
    }
    const caption = cover ? null : captionFromGroups(captions, t, parts.highlight ? clip.emphasis : undefined);
    if (logo) drawLogo(ctx, logo.image, logo.corner, OUT_W, OUT_H);
    if (caption) drawCaption(ctx, caption, look, OUT_W, OUT_H);
    if (watermark) drawWatermark(ctx, OUT_W, OUT_H);
    const dark = cover ? 0 : fadeAt({ start: 0, end: duration, edit: clip.edit }, at);
    if (dark > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${dark})`;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }
    return canvas;
  }

  return { paint, zooms, OUT_W, OUT_H, dispose: () => sharpening.tool?.dispose() };
}

/**
 * Renders one clip on this device: trims it, leaves out what it skips (and, unless kept, long pauses and "um"s),
 * crops it to 9:16 with the clip's framing, scales to 1080×1920 (or 4K), and burns in the captions and (on Free)
 * the watermark.
 */
export async function renderClip(
  file: File,
  clip: Clip,
  rawCaptions: CaptionGroup[],
  { onProgress, signal, ...drawing }: Drawing & { onProgress?: (p: number) => void; signal?: AbortSignal },
): Promise<RenderedClip> {
  const { look, captions, tighten, timedWords } = await prepare(clip, rawCaptions, drawing.look);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let dispose = () => {};
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This video has no picture.');
    // Tidy edges (no dead air, no clipped last word) and the sound's loudness, from the exact word times.
    const { start, end } = cleanEdges(clip.start, clip.end, captions, await input.computeDuration());
    // What plays: start..end without the skipped parts, pauses and "um"s; times in the file are mapped onto it.
    const ranges = keptRanges(start, end, clip.skips, timedWords, tighten);
    const gain = await loudnessGain(input, start, end).catch((err) => {
      console.warn('Loudness not measured', err);
      return 1;
    });
    const duration = playedSeconds(ranges);
    const draw = painter(clip, captions, { ...drawing, look }, track.displayWidth, track.displayHeight, duration);
    dispose = draw.dispose;

    // MP4 (H.264 + AAC) uploads everywhere. Browsers that can't encode H.264 get WebM (VP9 + Opus).
    const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: draw.OUT_W, height: draw.OUT_H });
    if (!videoCodec) throw new Error("This browser can't create video files. Try the latest Chrome or Edge.");
    const format = videoCodec === 'avc' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
    const audioCodec = await getFirstEncodableAudioCodec(
      format.getSupportedAudioCodecs().filter((c) => c === 'aac' || c === 'opus'),
      { numberOfChannels: 2, sampleRate: 48000 },
    );

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
        processedWidth: draw.OUT_W,
        processedHeight: draw.OUT_H,
        process: async (sample) => {
          // One frame at a time with a pause in between, so the page (and the phone) stays responsive.
          await breathe();
          // Sample times start at 0 at the clip's start. Frames in a cut are dropped; the rest move up.
          const t = start + sample.timestamp;
          const at = outputTime(ranges, t);
          if (at === null) return null;
          const canvas = draw.paint(sample, t, at);
          return ranges.length === 1 && ranges[0]!.start === start ? canvas : new VideoSample(canvas, { timestamp: at, duration: sample.duration });
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
              cutSound(sample, start, ranges).map((piece) =>
                processSound(piece, gain, duration, clip.edit?.fadeIn ? FADE_SECONDS : 0, clip.edit?.fadeOut ? FADE_SECONDS : 0),
              ),
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
    dispose();
    input.dispose();
  }
}

/**
 * When the cover shows: the clip's strongest moment as the AI marked it (its first zoom-in, else its first
 * highlighted word), a little in so the line is under way; otherwise a third of the way in. Always a moment
 * the clip plays.
 */
export function coverTime(clip: Clip, captions: CaptionGroup[], ranges: TimeRange[]): number {
  const words = captions.flatMap((g) => g.words);
  const zoom = zoomsFor(words, clip.punchIns)[0];
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  const marked = new Set((clip.emphasis ?? []).map(norm));
  const word = words.find((w) => w.start >= clip.start && marked.has(norm(w.text)));
  const total = playedSeconds(ranges);
  let wanted = zoom ? zoom.start + 0.3 : word ? word.start + 0.2 : null;
  if (wanted === null || outputTime(ranges, wanted) === null) {
    // A third of the way through what plays.
    let left = total / 3;
    wanted = ranges[0]!.start;
    for (const r of ranges) {
      if (left <= r.end - r.start) {
        wanted = r.start + left;
        break;
      }
      left -= r.end - r.start;
    }
  }
  return outputTime(ranges, wanted) === null ? (rangeAtOrAfter(ranges, wanted)?.start ?? clip.start) : wanted;
}

/** A cover image for posting the clip (JPEG, the export's size): its strongest moment, framed like the clip, with the headline. */
export async function renderCover(file: File, clip: Clip, rawCaptions: CaptionGroup[], drawing: Drawing): Promise<Blob> {
  const { look, captions, tighten, timedWords } = await prepare(clip, rawCaptions, drawing.look);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let dispose = () => {};
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This video has no picture.');
    const ranges = keptRanges(clip.start, clip.end, clip.skips, timedWords, tighten);
    const draw = painter(clip, captions, { ...drawing, look }, track.displayWidth, track.displayHeight, playedSeconds(ranges));
    dispose = draw.dispose;
    const t = coverTime(clip, captions, ranges);
    const sample = await new VideoSampleSink(track).getSample(t);
    if (!sample) throw new Error("Couldn't read this moment of the video.");
    try {
      const canvas = draw.paint(sample, t, outputTime(ranges, t) ?? 0, true);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    } finally {
      sample.close();
    }
  } finally {
    dispose();
    input.dispose();
  }
}

// At each cut the sound fades out and back in over this long, so the jump doesn't click.
const CUT_FADE_SECONDS = 0.008;

/**
 * The kept parts of one block of the clip's sound (its times start at 0 at `start`), each moved to where it
 * plays in the clip. A block without cuts is passed through as it is.
 */
function cutSound(sample: AudioSample, start: number, ranges: { start: number; end: number }[]): AudioSample[] {
  const n = sample.numberOfFrames;
  const rate = sample.sampleRate;
  const channels = sample.numberOfChannels;
  const pieces = soundPieces(ranges, start + sample.timestamp, n, rate);
  if (pieces.length === 1 && pieces[0]!.from === 0 && pieces[0]!.to === n && !pieces[0]!.cutBefore && !pieces[0]!.cutAfter) {
    sample.setTimestamp(pieces[0]!.at);
    return [sample];
  }
  const plane = new Float32Array(n);
  const planes: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    planes.push(plane.slice());
  }
  sample.close();
  const fade = Math.max(1, Math.round(CUT_FADE_SECONDS * rate));
  return pieces.map((p) => {
    const len = p.to - p.from;
    const data = new Float32Array(len * channels);
    for (let c = 0; c < channels; c++) {
      const out = data.subarray(c * len, (c + 1) * len);
      out.set(planes[c]!.subarray(p.from, p.to));
      for (let i = 0; i < Math.min(fade, len); i++) {
        if (p.cutBefore) out[i]! *= i / fade;
        if (p.cutAfter) out[len - 1 - i]! *= i / fade;
      }
    }
    return new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp: p.at });
  });
}
