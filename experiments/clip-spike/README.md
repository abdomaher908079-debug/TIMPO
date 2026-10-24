# Clip spike: can the browser do the heavy video work?

A single page that tests, on the user's own device, the two risky steps of the podcast clipping idea:

1. **Extract speech audio** from a long episode (mono, 16 kHz, low bitrate) to send for transcription.
2. **Render one vertical clip**: trim 45 s from the middle, center-crop to 9:16, burn in captions, encode.

Uses [Mediabunny](https://mediabunny.dev) 1.60.0 (WebCodecs) from jsDelivr. Nothing is uploaded.
Open `index.html` from any local web server (WebCodecs needs `localhost` or HTTPS).

## Results on the build server (4 vCPU, no GPU, software codecs, 1 h 1080p30 VP9 file, 1.5 GB)

| Step | Time | Speed | Output |
|---|---|---|---|
| Open file | 0.1–0.2 s | – | file is read lazily, never loaded into memory |
| Extract audio (1 h) | 52–56 s | ~65× real time | 16.3 MB (from 1.5 GB) |
| Render 45 s 1080×1920 clip with captions | 48–53 s | ~0.9× real time | 16.9 MB VP9 |
| Peak JS memory | ~20 MB | | |

The server's Chromium has no H.264/AAC (licensing), so these numbers use VP9/Opus and software encoding.
Real Chrome on a user's machine can use H.264 and hardware encoders, which should be faster;
that is what the on-device test is for.

Bug found and fixed: in Mediabunny's `process` callback, sample timestamps are relative to the
trim start (0 at the start of the clip), not to the source file.
