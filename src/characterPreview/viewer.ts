import { escapeHtml } from './escape'
import type { PreviewSnapshot } from './snapshot'

/**
 * 预览 viewer：把快照编译成一份完整的 HTML 文档。
 *
 * 为什么是字符串构造器而不是 React 组件：
 * 应用内预览与导出文件必须共用同一份实现，否则两套排版迟早漂移。
 * 两个形态的唯一差异就是 resolveAsset —— 在线直连，导出内联。
 */
export type ResolveAsset = (url: string) => Promise<string> | string

export type PreviewViewerOptions = {
  /** document.title；默认用角色名 */
  title?: string
  /** 页脚文案；导出时用来标明来源 */
  footnote?: string
}

/** 转盘交互：指针拖动 + 方向键；松手立即停住，0–360 循环 */
const VIEWER_SCRIPT = `
(function () {
  var stage = document.querySelector('[data-orbit]');
  if (!stage) return;
  var frames = stage.querySelectorAll('img.frame');
  if (frames.length < 2) return;
  var angles = [];
  for (var i = 0; i < frames.length; i++) angles.push(Number(frames[i].getAttribute('data-angle')) || 0);
  var DEG_PER_PX = 0.6;
  var acc = 0;
  var dragging = false;
  var lastX = 0;
  function norm(a) { return ((a % 360) + 360) % 360; }
  function show(a) {
    var current = norm(a);
    var best = 0;
    var bestD = 1e9;
    for (var i = 0; i < angles.length; i++) {
      var d = Math.abs(((angles[i] - current + 540) % 360) - 180);
      if (d < bestD) { bestD = d; best = i; }
    }
    for (var j = 0; j < frames.length; j++) frames[j].classList.toggle('on', j === best);
    stage.setAttribute('data-orbit-angle', String(Math.round(current)));
    stage.setAttribute('aria-valuenow', String(Math.round(current)));
  }
  stage.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    stage.classList.add('dragging');
    if (e.pointerId != null && stage.setPointerCapture) {
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    }
    e.preventDefault();
  });
  stage.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    acc += (e.clientX - lastX) * DEG_PER_PX;
    lastX = e.clientX;
    show(acc);
  });
  function end() {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('dragging');
  }
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', end);
  stage.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { acc -= 45; show(acc); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { acc += 45; show(acc); e.preventDefault(); }
  });
  show(0);
})();
`

/** 静态卡 CSS：字面值，不依赖宿主 --*token，单文件也要一样好看 */
const VIEWER_CSS = `
:root{
  --bg:#070b11; --panel:#0e1620; --panel-2:#111c28; --line:#1d2b3a;
  --text:#dbe7f3; --text-2:#b6c8da; --muted:#7d93ab; --accent:#38bdf8; --warn:#fbbf24;
  --font-sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --font-mono:"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:radial-gradient(120% 90% at 50% 0%,#0f1a26 0%,var(--bg) 62%);
  color:var(--text);font-family:var(--font-sans);
  display:flex;align-items:center;justify-content:center;padding:16px;
  -webkit-font-smoothing:antialiased;
}
.card{
  width:100%;max-width:520px;background:var(--panel);border:1px solid var(--line);
  border-radius:14px;overflow:hidden;display:flex;flex-direction:column;
}
.head{padding:14px 16px 12px;border-bottom:1px solid var(--line);background:var(--panel-2)}
.name{font-size:19px;font-weight:650;letter-spacing:.01em}
.meta{margin-top:4px;font-size:12px;color:var(--muted)}
.stage{position:relative;margin:0;background:#0a1119;display:flex;align-items:center;justify-content:center;min-height:240px}
.stage img{display:block;width:100%;height:auto;max-height:340px;object-fit:contain}
.stage.orbit{height:clamp(240px,60vh,380px);flex:0 0 auto;min-height:0;touch-action:pan-y;user-select:none;cursor:grab;overflow:hidden}
.stage.orbit.dragging{cursor:grabbing}
.stage.orbit:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.stage.orbit img.frame{position:absolute;inset:0;width:100%;height:100%;max-height:none;object-fit:contain;opacity:0;transition:opacity 90ms linear}
.stage.orbit img.frame.on{opacity:1}
.orbit-hint{position:absolute;right:10px;bottom:8px;font-size:11px;color:var(--muted);background:rgba(7,11,17,.66);padding:2px 8px;border-radius:999px;pointer-events:none}
.placeholder{padding:40px 16px;color:var(--muted);font-size:13px;text-align:center}
.badge{
  position:absolute;top:10px;left:10px;padding:3px 8px;border-radius:999px;
  font-size:11px;background:rgba(251,191,36,.14);color:var(--warn);border:1px solid rgba(251,191,36,.4);
}
.look{padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.desc{margin:0;font-size:13px;line-height:1.65;color:var(--text-2)}
.chips{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}
.chips li{font-size:11px;padding:3px 8px;border-radius:999px;background:rgba(56,189,248,.1);color:var(--accent);border:1px solid rgba(56,189,248,.28)}
.voice{padding:12px 16px;border-top:1px solid var(--line);font-size:12px;color:var(--text-2)}
.voice-line{display:flex;align-items:center;gap:8px}
.voice audio{display:block;width:100%;margin-top:8px;height:32px}
.voice .label{color:var(--muted)}
.voice .time{font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--muted)}
.emotions{padding:12px 16px 14px;border-top:1px solid var(--line)}
.emotions .title{font-size:11px;color:var(--muted);margin-bottom:8px}
.thumbs{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}
.thumbs img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:5px;background:#0a1119}
.foot{padding:10px 16px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);font-family:var(--font-mono)}
@media (max-width:420px){.thumbs{grid-template-columns:repeat(4,1fr)}}
@media (prefers-reduced-motion:no-preference){.card{transition:border-color 200ms ease}}
`

export async function buildPreviewHtml(
  snapshot: PreviewSnapshot,
  resolveAsset: ResolveAsset = (url) => url,
  options: PreviewViewerOptions = {},
): Promise<string> {
  const title = options.title ?? (snapshot.character.name || '角色卡')
  const portrait = await resolveOptional(
    resolveAsset,
    snapshot.look.turnaroundUrl ?? snapshot.emotions[0]?.url,
  )
  const thumbs = await Promise.all(
    snapshot.emotions.map(async (item) => ({
      emotion: item.emotion,
      url: await resolveOptional(resolveAsset, item.url),
    })),
  )
  const voiceUrl = await resolveOptional(resolveAsset, snapshot.voice?.url)

  // 八帧齐全才转；缺一帧就整张降级——半张转盘比静态卡更让人困惑
  const orbitFrames = (
    await Promise.all(
      (snapshot.orbit?.frames ?? []).map(async (frame) => ({
        angle: frame.angle,
        url: await resolveOptional(resolveAsset, frame.url),
      })),
    )
  ).filter((frame): frame is { angle: number; url: string } => Boolean(frame.url))

  const name = snapshot.character.name
  const staleBadge = snapshot.orbitStale
    ? `<span class="badge" data-preview-stale="orbit">转盘需重新生成</span>`
    : ''

  const figure = (inner: string, cls: string, attrs = '') =>
    `<figure class="stage ${cls}" data-preview-stage ${attrs}>\n    ${inner}\n    ${staleBadge}\n  </figure>`

  const stage =
    orbitFrames.length >= 2
      ? figure(
          `${orbitFrames
            .map(
              (frame, i) =>
                `<img class="frame${i === 0 ? ' on' : ''}" data-angle="${escapeHtml(
                  frame.angle,
                )}" src="${escapeHtml(frame.url)}" alt="${escapeHtml(name)} ${escapeHtml(
                  frame.angle,
                )}°">`,
            )
            .join('')}
    <span class="orbit-hint">拖动旋转</span>`,
          'orbit',
          `data-orbit data-frames="${orbitFrames.length}" role="slider" tabindex="0" aria-label="角色旋转角度" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0"`,
        )
      : figure(
          portrait
            ? `<img src="${escapeHtml(portrait)}" alt="${escapeHtml(name)} 造型">`
            : `<div class="placeholder">这个角色还没有造型图</div>`,
          'static',
        )

  const chips = snapshot.look.keywords.length
    ? `<ul class="chips">${snapshot.look.keywords
        .map((keyword) => `<li>${escapeHtml(keyword)}</li>`)
        .join('')}</ul>`
    : ''

  const meta = [snapshot.character.role, snapshot.character.age].filter(Boolean).join(' · ')

  const voiceRow = snapshot.voice
    ? `<section class="voice" data-preview-voice>
        <div class="voice-line">
          <span class="label">试音</span>
          <span class="time">${escapeHtml(snapshot.voice.seconds.toFixed(1))}s</span>
        </div>
        ${voiceUrl ? `<audio controls preload="none" src="${escapeHtml(voiceUrl)}"></audio>` : ''}
      </section>`
    : snapshot.voiceStale
      ? `<section class="voice" data-preview-voice data-preview-voice-stale>
        <span class="label">试音已失效，需重新生成后才能播放</span>
      </section>`
      : ''

  const emotionBlock = thumbs.length
    ? `<section class="emotions" data-preview-emotions>
        <div class="title">表情</div>
        <div class="thumbs">${thumbs
          .map((item) =>
            item.url
              ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.emotion)}">`
              : '',
          )
          .join('')}</div>
      </section>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<main class="card" data-preview-root data-preview-schema="${escapeHtml(snapshot.schemaVersion)}" data-preview-identity="${escapeHtml(snapshot.identityFingerprint)}" data-preview-generated="${escapeHtml(snapshot.generatedAt)}">
  <header class="head">
    <div class="name" data-preview-name>${escapeHtml(snapshot.character.name)}</div>
    ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}
  </header>
  ${stage}
  <section class="look">
    ${snapshot.character.desc ? `<p class="desc" data-preview-desc>${escapeHtml(snapshot.character.desc)}</p>` : ''}
    ${chips}
  </section>
  ${voiceRow}
  ${emotionBlock}
  <footer class="foot">${escapeHtml(
    options.footnote ?? `生成于 ${formatTime(snapshot.generatedAt)}`,
  )}</footer>
</main>
${orbitFrames.length >= 2 ? `<script>${VIEWER_SCRIPT}</script>` : ''}
</body>
</html>`
}

/** 资源解析失败不该炸掉整张卡：拿不到就退化成没有该图 */
async function resolveOptional(
  resolveAsset: ResolveAsset,
  url: string | undefined,
): Promise<string | undefined> {
  if (!url) return undefined
  try {
    const out = await resolveAsset(url)
    return out || undefined
  } catch {
    return undefined
  }
}

/** 生成时间用本地可读格式，导出文件里不需要时区换算的心智负担 */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
