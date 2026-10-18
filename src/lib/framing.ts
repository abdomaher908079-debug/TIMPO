import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import loaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import type { FaceDetector, FaceLandmarker } from '@mediapipe/tasks-vision';
import { breathe, isPhone } from './device';
import { CUT, difference, plan, type Face, type Framing, type Look } from './framingPlan';

export type { Framing };

// Looks per second: enough for cuts to land on time (planning sees the whole clip first, so no lag).
const LOOKS_PER_SECOND = isPhone ? 2 : 4;
const MAX_LOOKS = 300;
// Frames are read at this height; faces are found in squares of FRAME_HEIGHT (the detector is made for
// faces close up, so wide pictures are looked at in overlapping squares of the frame's full height).
const READ_HEIGHT = isPhone ? 360 : 480;
const FRAME_HEIGHT = 256;
// Faces smaller than this share of the picture's width are in the background.
const MIN_FACE = 0.04;
// Mouths are read on faces at least this many pixels wide (in the frame read); smaller ones are a guess.
const MOUTH_MIN_PIXELS = 36;
// The tiny copy of each frame used to spot camera cuts.
const SIG_W = 16;
const SIG_H = 9;

const vision = { wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmUrl };
let detector: Promise<FaceDetector> | null = null;
let landmarker: Promise<FaceLandmarker | null> | null = null;

function faceDetector(): Promise<FaceDetector> {
  detector ??= (async () => {
    const { FaceDetector } = await import('@mediapipe/tasks-vision');
    return FaceDetector.createFromOptions(vision, {
      // The processor, not the graphics chip: heavy GPU work can hang phones.
      baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.6,
    });
  })();
  detector.catch(() => (detector = null));
  return detector;
}

/** Reads how open a mouth is, to tell who is talking. Loaded only when two people don't fit one crop. */
function mouthReader(): Promise<FaceLandmarker | null> {
  landmarker ??= (async () => {
    try {
      const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
      return await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
    } catch (err) {
      // Without it, the person seen most is framed.
      console.warn('Mouth reading unavailable', err);
      return null;
    }
  })();
  return landmarker;
}

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
    const sink = new CanvasSink(track, { height: READ_HEIGHT, poolSize: 1 });
    const tools = canvases();
    for (let i = 0; i < clips.length; i++) {
      if (signal.aborted) return;
      const { start, end } = clips[i]!;
      const n = Math.max(3, Math.min(MAX_LOOKS, Math.round((end - start) * LOOKS_PER_SECOND)));
      const times = Array.from({ length: n }, (_, k) => start + ((k + 0.5) * (end - start)) / n);
      const looks: Look[] = [];
      let k = 0;
      for await (const frame of sink.canvasesAtTimestamps(times)) {
        const t = times[k++]!;
        if (signal.aborted) return;
        if (!frame) continue;
        looks.push(await look(t, frame.canvas, faces, crop, tools));
        await breathe();
      }
      await findCuts(looks, sink, tools, signal);
      if (signal.aborted) return;
      onClip(i, plan(looks, crop, start, end));
    }
  } finally {
    input.dispose();
  }
}

interface Tools {
  tile: HTMLCanvasElement;
  tileCtx: CanvasRenderingContext2D;
  sig: HTMLCanvasElement;
  sigCtx: CanvasRenderingContext2D;
}

function canvases(): Tools {
  const tile = document.createElement('canvas');
  tile.width = tile.height = FRAME_HEIGHT;
  const sig = document.createElement('canvas');
  sig.width = SIG_W;
  sig.height = SIG_H;
  return {
    tile,
    tileCtx: tile.getContext('2d', { willReadFrequently: true })!,
    sig,
    sigCtx: sig.getContext('2d', { willReadFrequently: true })!,
  };
}

type Box = { left: number; right: number; top: number; bottom: number };

/** One look at a frame: its faces (with mouths when people don't fit one crop) and its tiny copy. */
async function look(t: number, frame: HTMLCanvasElement | OffscreenCanvas, faces: FaceDetector, crop: number, tools: Tools): Promise<Look> {
  const boxes = findFaces(faces, frame, tools);
  // Mouths only matter when there's a choice to make: two or more people too far apart to frame together.
  const spread = boxes.length > 1 ? Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left)) : 0;
  const reader = spread > crop * 0.85 ? await mouthReader() : null;
  const found: Face[] = boxes.map((b) => ({
    left: b.left,
    right: b.right,
    mouth: reader ? readMouth(reader, frame, b, tools) : null,
  }));
  return { t, faces: found, sig: signature(frame, tools) };
}

/** A tiny grayscale copy of a frame, to compare pictures (camera cuts). */
function signature(frame: HTMLCanvasElement | OffscreenCanvas, { sigCtx }: Tools): Uint8Array {
  sigCtx.drawImage(frame, 0, 0, SIG_W, SIG_H);
  const rgba = sigCtx.getImageData(0, 0, SIG_W, SIG_H).data;
  const sig = new Uint8Array(SIG_W * SIG_H);
  for (let i = 0; i < sig.length; i++) sig[i] = (rgba[i * 4]! * 3 + rgba[i * 4 + 1]! * 6 + rgba[i * 4 + 2]!) / 10;
  return sig;
}

/**
 * For each camera cut between two looks, finds when it happens to within a frame or two (by halving the
 * gap and comparing pictures), so the new framing starts on the cut's first frame.
 */
async function findCuts(looks: Look[], sink: CanvasSink, tools: Tools, signal: AbortSignal) {
  for (let i = 1; i < looks.length; i++) {
    const before = looks[i - 1]!;
    const after = looks[i]!;
    if (!before.sig || !after.sig || difference(before.sig, after.sig) <= CUT) continue;
    let lo = before.t;
    let hi = after.t;
    for (let step = 0; step < 4 && !signal.aborted; step++) {
      const mid = (lo + hi) / 2;
      const frame = await sink.getCanvas(mid);
      if (!frame) break;
      const sig = signature(frame.canvas, tools);
      if (difference(sig, before.sig) < difference(sig, after.sig)) lo = mid;
      else hi = mid;
    }
    looks[i] = { ...after, cutAt: (lo + hi) / 2 };
  }
}

function findFaces(faces: FaceDetector, frame: HTMLCanvasElement | OffscreenCanvas, { tile, tileCtx }: Tools): Box[] {
  const { width, height } = frame;
  const count = Math.max(1, Math.ceil(width / height) + (width > height ? 1 : 0));
  const step = count > 1 ? (width - height) / (count - 1) : 0;
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.round(i * step);
    tileCtx.drawImage(frame, x, 0, height, height, 0, 0, tile.width, tile.height);
    for (const d of faces.detect(tile).detections) {
      const b = d.boundingBox;
      if (!b) continue;
      const scale = height / tile.width;
      const left = (x + b.originX * scale) / width;
      const right = (x + (b.originX + b.width) * scale) / width;
      const top = (b.originY * scale) / height;
      const bottom = ((b.originY + b.height) * scale) / height;
      if (right - left < MIN_FACE) continue;
      // The same face seen in two overlapping squares counts once.
      const same = boxes.find((o) => Math.min(o.right, right) - Math.max(o.left, left) > 0.5 * Math.min(o.right - o.left, right - left));
      if (same) {
        same.left = Math.min(same.left, left);
        same.right = Math.max(same.right, right);
        same.top = Math.min(same.top, top);
        same.bottom = Math.max(same.bottom, bottom);
      } else boxes.push({ left, right, top, bottom });
    }
  }
  return boxes;
}

/** How open the mouth of the face in `box` is (0..1), or null if the face is too small to tell. */
function readMouth(reader: FaceLandmarker, frame: HTMLCanvasElement | OffscreenCanvas, box: Box, { tile, tileCtx }: Tools): number | null {
  const { width, height } = frame;
  const faceW = (box.right - box.left) * width;
  if (faceW < MOUTH_MIN_PIXELS) return null;
  // A square around the face with room for the chin, as the reader expects a face close up.
  const size = Math.min(height, faceW * 1.8);
  const cx = ((box.left + box.right) / 2) * width;
  const cy = ((box.top + box.bottom) / 2) * height;
  const x = Math.max(0, Math.min(width - size, cx - size / 2));
  const y = Math.max(0, Math.min(height - size, cy - size / 2));
  tileCtx.drawImage(frame, x, y, size, size, 0, 0, tile.width, tile.height);
  try {
    const shapes = reader.detect(tile).faceBlendshapes[0]?.categories;
    const jaw = shapes?.find((c) => c.categoryName === 'jawOpen')?.score;
    return jaw ?? null;
  } catch {
    return null;
  }
}
