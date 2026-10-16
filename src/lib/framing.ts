import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import loaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import type { FaceDetector } from '@mediapipe/tasks-vision';
import type { FramingTrack, Layout } from './clips';
import { breathe } from './device';

export interface Framing {
  layout: Layout;
  cropX: number;
  track?: FramingTrack;
}

// One look per this many seconds: enough to follow camera cuts between speakers.
const SAMPLE_SECONDS = 1;
const MAX_SAMPLES = 90;
// Faces smaller than this share of the picture's width are in the background.
const MIN_FACE = 0.04;
// The detector works on small squares (it's made for faces close up), so wide pictures are
// looked at in overlapping squares of the frame's full height.
const FRAME_HEIGHT = 256;

let detector: Promise<FaceDetector> | null = null;

function faceDetector(): Promise<FaceDetector> {
  detector ??= (async () => {
    const { FaceDetector } = await import('@mediapipe/tasks-vision');
    return FaceDetector.createFromOptions(
      { wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmUrl },
      // The processor, not the graphics chip: heavy GPU work can hang phones.
      { baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.6 },
    );
  })();
  detector.catch(() => (detector = null));
  return detector;
}

/** The crop position (0..100) that centers `center` (0..1 of the width) in a crop `crop` wide. */
const cropFor = (center: number, crop: number) => (crop >= 1 ? 50 : (Math.max(0, Math.min(1 - crop, center - crop / 2)) / (1 - crop)) * 100);

/**
 * Picks each clip's framing from the faces in it, one clip at a time (calls `onClip` as each is
 * done). Runs on the processor in small steps, so the page stays responsive.
 */
export async function autoFrame(
  file: File,
  clips: { start: number; end: number }[],
  onClip: (index: number, framing: Framing) => void,
  signal: AbortSignal,
) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return;
    const aspect = track.displayWidth / track.displayHeight;
    // Already vertical: nothing to frame.
    if (aspect <= 9 / 16 + 0.01) {
      clips.forEach((_, i) => onClip(i, { layout: 'fill', cropX: 50 }));
      return;
    }
    const crop = 9 / 16 / aspect;
    const faces = await faceDetector();
    const sink = new CanvasSink(track, { height: FRAME_HEIGHT, poolSize: 1 });
    const tile = document.createElement('canvas');
    tile.width = tile.height = FRAME_HEIGHT;
    const tileCtx = tile.getContext('2d')!;
    for (let i = 0; i < clips.length; i++) {
      if (signal.aborted) return;
      const { start, end } = clips[i]!;
      const n = Math.max(3, Math.min(MAX_SAMPLES, Math.round((end - start) / SAMPLE_SECONDS)));
      const times = Array.from({ length: n }, (_, k) => start + ((k + 0.5) * (end - start)) / n);
      const looks: { t: number; boxes: { left: number; right: number }[] }[] = [];
      let k = 0;
      for await (const frame of sink.canvasesAtTimestamps(times)) {
        const t = times[k++]!;
        if (signal.aborted) return;
        if (!frame) continue;
        looks.push({ t, boxes: findFaces(faces, frame.canvas, tile, tileCtx) });
        await breathe();
      }
      onClip(i, decide(looks, crop, start));
    }
  } finally {
    input.dispose();
  }
}

type Box = { left: number; right: number };

function findFaces(
  faces: FaceDetector,
  frame: HTMLCanvasElement | OffscreenCanvas,
  tile: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Box[] {
  const { width, height } = frame;
  const count = Math.max(1, Math.ceil(width / height) + (width > height ? 1 : 0));
  const step = count > 1 ? (width - height) / (count - 1) : 0;
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.round(i * step);
    ctx.drawImage(frame, x, 0, height, height, 0, 0, tile.width, tile.height);
    for (const d of faces.detect(tile).detections) {
      const b = d.boundingBox;
      if (!b) continue;
      const scale = height / tile.width;
      const left = (x + b.originX * scale) / width;
      const right = (x + (b.originX + b.width) * scale) / width;
      if (right - left < MIN_FACE) continue;
      // The same face seen in two overlapping squares counts once.
      const same = boxes.find((o) => Math.min(o.right, right) - Math.max(o.left, left) > 0.5 * Math.min(o.right - o.left, right - left));
      if (same) {
        same.left = Math.min(same.left, left);
        same.right = Math.max(same.right, right);
      } else boxes.push({ left, right });
    }
  }
  return boxes;
}

/** Fill and follow the speaker when every look's faces fit one crop; otherwise show the whole picture. */
export function decide(looks: { t: number; boxes: { left: number; right: number }[] }[], crop: number, start: number): Framing {
  const withFaces = looks.filter((l) => l.boxes.length);
  // Mostly no faces (slides, screens, B-roll): a crop would likely cut off what matters.
  if (withFaces.length < looks.length * 0.5) return { layout: 'fit', cropX: 50 };
  const centers: { t: number; c: number }[] = [];
  let spread = 0;
  for (const l of withFaces) {
    const left = Math.min(...l.boxes.map((b) => b.left));
    const right = Math.max(...l.boxes.map((b) => b.right));
    // Faces a bit inside the crop's edges, so heads and shoulders fit too.
    if (right - left > crop * 0.85) spread++;
    centers.push({ t: l.t, c: (left + right) / 2 });
  }
  // People too far apart for one crop in many looks: show everyone.
  if (spread > withFaces.length * 0.3) return { layout: 'fit', cropX: 50 };

  // Follow the faces, but hold still for small moves so the picture doesn't wobble.
  const keys: FramingTrack = [];
  let current = centers[0]!.c;
  keys.push({ t: start, x: cropFor(current, crop) });
  for (let i = 1; i < centers.length; i++) {
    const c = centers[i]!.c;
    // Ignore a single odd look (a hand, a reflection): the next look must agree.
    const confirmed = i + 1 >= centers.length || Math.abs(centers[i + 1]!.c - c) < crop * 0.25;
    if (Math.abs(c - current) > crop * 0.2 && confirmed) {
      current = c;
      // Switch halfway between the two looks: closest to when the camera actually cut.
      keys.push({ t: (centers[i - 1]!.t + centers[i]!.t) / 2, x: cropFor(current, crop) });
    }
  }
  return { layout: 'fill', cropX: keys[0]!.x, track: keys.length > 1 ? keys : undefined };
}
