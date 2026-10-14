import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';

/**
 * One still frame per timestamp, as image URLs (revoke them when done). Frames keep the video's own
 * shape; the 9:16 crop is applied when they're shown, so it follows the clip's framing setting.
 */
export async function thumbnails(file: File, times: number[], onFrame: (index: number, url: string) => void, signal?: AbortSignal) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return;
    const sink = new CanvasSink(track, { height: 640 });
    // Decoding in time order is much faster than jumping back and forth.
    const order = times.map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t);
    let n = 0;
    for await (const frame of sink.canvasesAtTimestamps(order.map((o) => o.t))) {
      if (signal?.aborted) return;
      const { i } = order[n++]!;
      if (!frame) continue;
      const canvas = frame.canvas;
      const blob =
        canvas instanceof OffscreenCanvas
          ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
          : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (blob && !signal?.aborted) onFrame(i, URL.createObjectURL(blob));
    }
  } finally {
    input.dispose();
  }
}
