import { BRAND_NAME, LOGO_BARS, LOGO_ORANGE, LOGO_PEAK } from './brand';
import type { BrandKit } from './brandKits';
import type { Caption, CaptionLook } from './clips';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const CAPTION_FONT = 'Inter, system-ui, sans-serif';

/**
 * Draws a caption onto a W×H video frame, matching the editor preview: centered, with its top at the
 * look's position, wrapped to two lines when it doesn't fit.
 */
export function drawCaption(ctx: Ctx, caption: Caption, look: CaptionLook, W: number, H: number) {
  const style = look.style;
  if (style === 'none' || !caption.words.length) return;
  const upper = style !== 'boxed';
  const size = Math.round(W * 0.075);
  const words = caption.words.map((w) => (upper ? w.toUpperCase() : w));
  ctx.save();
  ctx.font = `${look.weight} ${size}px "${look.font}", ${CAPTION_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const space = ctx.measureText(' ').width;
  const widths = words.map((w) => ctx.measureText(w).width);

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

  const lineHeight = size * 1.15;
  const top = H * look.position;
  lines.forEach((line, li) => {
    const total = line.reduce((n, i, k) => n + widths[i]! + (k ? space : 0), 0);
    let x = (W - total) / 2;
    const y = top + lineHeight * (li + 0.5);
    for (const i of line) {
      const on = i === caption.active;
      if (style === 'boxed') {
        const pad = size * 0.12;
        ctx.fillStyle = look.boxColor;
        ctx.fillRect(x - pad, y - lineHeight / 2, widths[i]! + pad * 2, lineHeight);
        ctx.fillStyle = look.textColor;
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
        ctx.fillStyle = style === 'highlight' && on ? look.accentColor : look.textColor;
        ctx.fillText(words[i]!, x, y);
        ctx.shadowColor = 'transparent';
      }
      x += widths[i]! + space;
    }
  });
  ctx.restore();
}

/**
 * The Free plan's watermark: the logo mark and "Made with Hookcut", top-left, where TikTok, Reels
 * and Shorts put none of their buttons or text, and clear of the captions in the lower third.
 */
export function drawWatermark(ctx: Ctx, W: number, H: number) {
  const markH = Math.round(W * 0.042);
  const bar = markH / 8;
  const gap = (markH * 23) / 24 / 5 - bar;
  const x0 = Math.round(W * 0.055);
  const y0 = Math.round(H * 0.075);
  const text = `Made with ${BRAND_NAME}`;
  const textX = x0 + 5 * (bar + gap) + markH * 0.3;
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
  LOGO_BARS.forEach((h, i) => {
    ctx.fillStyle = i === LOGO_PEAK ? LOGO_ORANGE : '#fff';
    const bh = h * markH;
    roundRect(ctx, x0 + i * (bar + gap), y0 + markH - bh, bar, bh, bar / 2);
  });
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, textX, y0 + markH / 2);
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
