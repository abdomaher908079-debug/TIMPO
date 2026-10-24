// Puts the speech models in <build folder>/ai/ (and their list in ai.json) so the site serves them itself (see src/lib/aiFiles.ts).
// Cloudflare Pages takes files up to 25 MB, so bigger ones are stored in numbered 20 MB parts.
// Downloads are kept in node_modules/.cache/isla-ai, so later deploys don't download them again.
//   node scripts/ai-models.mjs dist
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const out = join(process.argv[2] ?? 'dist', 'ai');
const cache = 'node_modules/.cache/isla-ai';
const PART = 20 * 1024 * 1024;

// The model files speech.engine.ts loads, by how it loads them: q8 ("quantized") on the processor;
// fp32 or fp16 encoder and q4 decoder on a graphics chip.
const ON_PROCESSOR = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const ON_GRAPHICS = ['onnx/encoder_model.onnx', 'onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_q4.onnx'];
const MODELS = {
  'onnx-community/whisper-tiny.en_timestamped': ON_PROCESSOR,
  'onnx-community/whisper-base.en_timestamped': [...ON_PROCESSOR, ...ON_GRAPHICS],
  'onnx-community/whisper-small.en_timestamped': ON_GRAPHICS,
};

async function exists(path, size) {
  try {
    return (await stat(path)).size === size;
  } catch {
    return false;
  }
}

async function download(url, path, size) {
  if (await exists(path, size)) return;
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(`${path}.tmp`));
      if ((await stat(`${path}.tmp`)).size !== size) throw new Error(`Incomplete download of ${url}`);
      return rename(`${path}.tmp`, path);
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`  retrying (${err.message})`);
    }
  }
}

async function split(from, to, size) {
  const parts = Math.ceil(size / PART);
  const file = await open(from);
  try {
    for (let i = 0; i < parts; i++) {
      const length = Math.min(PART, size - i * PART);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, i * PART);
      await writeFile(`${to}.${String(i).padStart(3, '0')}`, buffer);
    }
  } finally {
    await file.close();
  }
  return parts;
}

const files = {};
for (const [model, onnx] of Object.entries(MODELS)) {
  const res = await fetch(`https://huggingface.co/api/models/${model}/tree/main?recursive=true`);
  if (!res.ok) throw new Error(`Can't list ${model}: HTTP ${res.status}`);
  const tree = await res.json();
  // The small settings files at the top, and the model files above.
  const wanted = tree.filter((f) => f.type === 'file' && ((!f.path.includes('/') && !/\.(md|gitattributes)$/.test(f.path)) || onnx.includes(f.path)));
  for (const f of wanted) {
    const key = `${model}/${f.path}`;
    const local = join(cache, key);
    process.stdout.write(`${key} (${(f.size / 1e6).toFixed(1)} MB)\n`);
    await download(`https://huggingface.co/${model}/resolve/main/${f.path}`, local, f.size);
    const target = join(out, key);
    await mkdir(dirname(target), { recursive: true });
    const parts = f.size > PART ? await split(local, target, f.size) : (await copyFile(local, target), 0);
    files[key] = { size: f.size, parts };
  }
}
await writeFile(join(out, '..', 'ai.json'), JSON.stringify({ files }));
console.log(`${Object.keys(files).length} model files in ${out}`);
