import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { EpisodeInfo } from './format';

// Reads only the file's headers, never the whole file, so a 4 GB episode opens instantly.
export async function probeEpisode(file: File): Promise<EpisodeInfo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const [durationSeconds, canDecodeVideo, canDecodeAudio] = await Promise.all([
      input.computeDuration(),
      video ? video.canDecode() : Promise.resolve(false),
      audio ? audio.canDecode() : Promise.resolve(false),
    ]);
    return {
      durationSeconds,
      width: video?.displayWidth ?? 0,
      height: video?.displayHeight ?? 0,
      videoCodec: video?.codec ?? null,
      audioCodec: audio?.codec ?? null,
      canDecodeVideo,
      canDecodeAudio,
    };
  } finally {
    input.dispose();
  }
}
