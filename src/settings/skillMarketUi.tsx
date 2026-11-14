import { useState } from 'react'

export function skillInitial(name: string): string {
  const ch = Array.from(String(name || '?').trim())[0] || '?'
  return ch.toUpperCase()
}

export function SkillMarketIcon({
  name,
  iconUrl,
  large,
  alt,
}: {
  name: string
  iconUrl?: string
  large?: boolean
  /** 有值时作为 img alt，并参与读屏 */
  alt?: string
}) {
  const [broken, setBroken] = useState(false)
  const src = String(iconUrl || '').trim()
  const showImg = Boolean(src) && !broken
  const altText = String(alt || '').trim()
  const decorative = showImg && !altText
  return (
    <div
      className={`skill-market-icon${large ? ' skill-market-icon-lg' : ''}`}
      aria-hidden={decorative ? true : undefined}
    >
      {showImg ? (
        <img
          src={src}
          alt={altText}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="skill-market-icon-fallback" aria-hidden={altText ? undefined : true}>
          {skillInitial(name)}
        </span>
      )}
    </div>
  )
}