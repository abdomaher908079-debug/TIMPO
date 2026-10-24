// Sharpening for enlarged video. A 1080p episode's 9:16 crop is 608 pixels wide, so a vertical clip
// enlarges it about 1.8× (3.6× for 4K) and it looks soft. This restores some crispness on the graphics
// card (WebGL2): each pixel is pushed away from its neighbours' average, then kept within its neighbours'
// range, so edges get steeper without the bright halos plain sharpening leaves. Without WebGL2 the export
// simply isn't sharpened.

const VERTEX = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  // The canvas is uploaded top row first; flip so the picture isn't upside down.
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D img;
uniform vec2 px;
uniform float amount;
in vec2 uv;
out vec4 color;
void main() {
  vec3 c = texture(img, uv).rgb;
  vec3 n = texture(img, uv + vec2(0.0, -px.y)).rgb;
  vec3 s = texture(img, uv + vec2(0.0, px.y)).rgb;
  vec3 e = texture(img, uv + vec2(px.x, 0.0)).rgb;
  vec3 w = texture(img, uv + vec2(-px.x, 0.0)).rgb;
  vec3 low = min(c, min(min(n, s), min(e, w)));
  vec3 high = max(c, max(max(n, s), max(e, w)));
  vec3 sharp = c + amount * (c - (n + s + e + w) * 0.25) * 4.0;
  color = vec4(clamp(sharp, low, high), 1.0);
}`;

/** How strongly to sharpen a picture enlarged `scale` times: none up to 1.1×, then more, up to a limit. */
export function sharpenAmount(scale: number): number {
  return scale < 1.1 ? 0 : Math.min(0.6, (scale - 1) * 0.5);
}

export interface Sharpener {
  /** Sharpens `source` (the size given at creation); returns the sharpened picture, or null if it can't. */
  apply(source: OffscreenCanvas, amount: number): OffscreenCanvas | null;
  dispose(): void;
}

export function createSharpener(width: number, height: number): Sharpener | null {
  try {
    const canvas = new OffscreenCanvas(width, height);
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program');
    gl.useProgram(program);

    // One triangle that covers the whole picture.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform2f(gl.getUniformLocation(program, 'px'), 1 / width, 1 / height);
    const amountAt = gl.getUniformLocation(program, 'amount');
    gl.viewport(0, 0, width, height);

    let broken = false;
    return {
      apply(source, amount) {
        if (broken || gl.isContextLost()) return null;
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          gl.uniform1f(amountAt, amount);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          return canvas;
        } catch (err) {
          // A clip without sharpening beats no clip.
          console.warn('Sharpening off', err);
          broken = true;
          return null;
        }
      },
      dispose() {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
  } catch (err) {
    console.warn('Sharpening unavailable', err);
    return null;
  }
}
