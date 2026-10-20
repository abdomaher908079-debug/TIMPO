import { BRAND_NAME, ORB } from './brand';
import type { BrandKit } from './brandKits';
import { captionMotion, type Caption, type CaptionLook } from './clips';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const CAPTION_FONT = 'Inter, system-ui, sans-serif';

// Pro edit: the color of highlighted words when the style's own accent already marks the spoken word.
export const EMPHASIS_COLOR = '#ffd23f';
const EMPHASIS_SCALE = 1.12;
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;

/**
 * Draws a caption onto a W×H video frame, matching the editor preview: centered, with its top at the
 * look's position, wrapped to two lines when it doesn't fit. Words highlighted by the Pro edit are
 * a little bigger and in the accent color.
 */
export function drawCaption(ctx: Ctx, caption: Caption, look: CaptionLook, W: number, H: number) {
  const style = look.style;
  if (style === 'none' || !caption.words.length) return;
  const upper = style !== 'boxed';
  const size = Math.round(W * 0.075 * (look.size ?? 1));
  // Arabic, Hebrew and other right-to-left words are laid out from the right.
  const rtl = caption.words.some((w) => RTL.test(w));
  const { alpha, scale } = captionMotion(look, caption.since);
  if (alpha <= 0) return;
  const words = caption.words.map((w) => (upper ? w.toUpperCase() : w));
  const em = (i: number) => !!caption.emphasis?.[i];
  const font = (i: number) => `${look.weight} ${Math.round(size * (em(i) ? EMPHASIS_SCALE : 1))}px "${look.font}", ${CAPTION_FONT}`;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = font(-1);
  const space = ctx.measureText(' ').width;
  const widths = words.map((w, i) => {
    ctx.font = font(i);
    return ctx.measureText(w).width;
  });

  // Greedy wrap into lines no wider than 88% of the frame.
  const maxWidth = W * 0.88;
  const lines: number[][] = [[]];
  let lineWidth = 0;
  words.forEach((_, i) => {
    const line = lines[lines.length - 1]!;
    const add = (line.length ? space : 0) + widths[i]!;
    if (line.length && lineWidth + add > maxWidth) {
      lines.push([i]);
      lineWidth = widths[i]!;
    } else {
      line.push(i);
      lineWidth += add;
    }
  });

  const lineHeight = size * 1.15 * (caption.emphasis?.some(Boolean) ? 1.05 : 1);
  const top = H * look.position;
  // Fade and pop: drawn with the caption's opacity, scaled around its middle.
  ctx.globalAlpha = alpha;
  if (scale !== 1) {
    const cy = top + (lineHeight * lines.length) / 2;
    ctx.translate(W / 2, cy);
    ctx.scale(scale, scale);
    ctx.translate(-W / 2, -cy);
  }
  lines.forEach((line, li) => {
    const total = line.reduce((n, i, k) => n + widths[i]! + (k ? space : 0), 0);
    let x = (W - total) / 2;
    const y = top + lineHeight * (li + 0.5);
    for (const i of rtl ? [...line].reverse() : line) {
      const on = i === caption.active;
      ctx.font = font(i);
      if (style === 'boxed') {
        const pad = size * 0.12;
        ctx.fillStyle = em(i) ? look.accentColor : look.boxColor;
        ctx.fillRect(x - pad, y - lineHeight / 2, widths[i]! + pad * 2, lineHeight);
        ctx.fillStyle = em(i) ? '#111' : look.textColor;
        ctx.fillText(words[i]!, x, y);
      } else {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = size * 0.12;
        ctx.shadowOffsetY = size * 0.04;
        if (style === 'bold') {
          ctx.lineJoin = 'round';
          ctx.lineWidth = size * 0.14;
          ctx.strokeStyle = '#000';
          ctx.strokeText(words[i]!, x, y);
          ctx.shadowColor = 'transparent';
        }
        ctx.fillStyle =
          style === 'highlight' && on ? look.accentColor : em(i) ? (style === 'highlight' ? EMPHASIS_COLOR : look.accentColor) : look.textColor;
        ctx.fillText(words[i]!, x, y);
        ctx.shadowColor = 'transparent';
      }
      x += widths[i]! + space;
    }
  });
  ctx.restore();
}

/**
 * Pro edit: the AI's headline, in a white box centered at `top` (a fraction of the height is
 * the box's vertical middle). `alpha` fades it.
 */
export function drawHeadline(ctx: Ctx, text: string, look: Pick<CaptionLook, 'font'>, W: number, H: number, middle: number, alpha = 1) {
  if (!text || alpha <= 0) return;
  const size = Math.round(W * 0.056);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 ${size}px "${look.font}", ${CAPTION_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // Wrap to at most two lines of 80% of the width.
  const maxWidth = W * 0.8;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > 2) lines.splice(1, lines.length - 1, lines.slice(1).join(' '));
  const lineHeight = size * 1.22;
  const padX = size * 0.6;
  const padY = size * 0.4;
  const width = Math.min(W * 0.92, Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2);
  const height = lines.length * lineHeight + padY * 2;
  const y0 = H * middle - height / 2;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = size * 0.4;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, (W - width) / 2, y0, width, height, size * 0.35);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#111111';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + padY + lineHeight * (i + 0.5), W * 0.88));
  ctx.restore();
}

/**
 * The Free plan's watermark: the logo mark and "Made with Isla", top-left, where TikTok, Reels
 * and Shorts put none of their buttons or text, and clear of the captions in the lower third.
 */
export function drawWatermark(ctx: Ctx, W: number, H: number) {
  const markH = Math.round(W * 0.042);
  const x0 = Math.round(W * 0.055);
  const y0 = Math.round(H * 0.075);
  const text = `Made with ${BRAND_NAME}`;
  const textX = x0 + markH * 1.3;
  ctx.save();
  ctx.font = `600 ${Math.round(markH * 0.72)}px ${CAPTION_FONT}`;
  // A faint dark pill keeps it readable on bright footage.
  const padX = markH * 0.4;
  const padY = markH * 0.3;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  roundRect(ctx, x0 - padX, y0 - padY, textX + ctx.measureText(text).width - x0 + padX * 2, markH + padY * 2, (markH + padY * 2) / 2);
  ctx.globalAlpha = 0.9;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = markH * 0.25;
  drawOrb(ctx, x0, y0, markH);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, textX, y0 + markH / 2);
  ctx.restore();
}

/** Isla as in the logo (design/logo/isla-agent.svg): looking to the right, `size` across, top-left at x, y. */
function drawOrb(ctx: Ctx, x: number, y: number, size: number) {
  ctx.save();
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  // The logo's body is 112 units across; k turns its units into pixels here.
  const k = size / 112;
  const body = ctx.createLinearGradient(x + size * 0.1, y + size * 0.05, x + size * 0.9, y + size * 0.95);
  body.addColorStop(0, '#b4ff5a');
  body.addColorStop(0.45, '#e6bd22');
  body.addColorStop(1, ORB.orange);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Shade towards the lower right.
  const shade = ctx.createRadialGradient(cx - r * 0.24, cy - r * 0.4, 0, cx - r * 0.24, cy - r * 0.4, r * 1.56);
  shade.addColorStop(0.5, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(58,18,0,0.42)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Shine.
  ctx.save();
  ctx.translate(cx - 21 * k, cy - 35 * k);
  ctx.rotate((-28 * Math.PI) / 180);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 15 * k, 6.5 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Visor and eyes, turned to the right and wrapped by the body.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = ORB.visor;
  roundRect(ctx, cx - 14 * k, cy - 20 * k, 66 * k, 32 * k, 16 * k);
  ctx.fillStyle = '#a8ff4a';
  roundRect(ctx, cx + 15 * k, cy - 15 * k, 11 * k, 20 * k, 5.5 * k);
  roundRect(ctx, cx + 35 * k, cy - 15 * k, 12 * k, 20 * k, 6 * k);
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

// Logo position for each corner, clear of the platforms' own buttons and text: the bottom corners sit
// above the caption/username area at the bottom of TikTok, Reels and Shorts.
export function logoBox(corner: BrandKit['logo_corner'], imgW: number, imgH: number, W: number, H: number) {
  const scale = Math.min((W * 0.2) / imgW, (H * 0.08) / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const x = corner.endsWith('left') ? W * 0.055 : W * 0.945 - w;
  const y = corner.startsWith('top') ? H * 0.075 : H * 0.78 - h;
  return { x, y, w, h };
}

/** A brand kit's logo, drawn in its corner. */
export function drawLogo(ctx: Ctx, image: ImageBitmap, corner: BrandKit['logo_corner'], W: number, H: number) {
  const { x, y, w, h } = logoBox(corner, image.width, image.height, W, H);
  ctx.drawImage(image, x, y, w, h);
}
