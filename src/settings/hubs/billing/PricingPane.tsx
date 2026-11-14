import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import { DEFAULT_PRICING, normalizePricing } from '../../../pricing'
import { CAP_META } from '../../settingsMeta'

type Props = { wb: SettingsWorkbench }

export function PricingPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-pane="pricing">
      <header className="st-sec-head">
        <h3>计价</h3>
        <span className="st-hint">默认值是估算；图片按张、视频按秒、配音按次。</span>
      </header>
      <div className="st-grid">
        <label className="st-field">
          <span>图片 · 每张</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={wb.pricing.image}
            onChange={(e) => wb.setPricing({ ...wb.pricing, image: Number(e.target.value) || 0 })}
          />
          <em>Seedream 一次生成 N 张 = N × 单价</em>
        </label>
        <label className="st-field">
          <span>视频 · 480p 每秒</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={wb.pricing.video480}
            onChange={(e) => wb.setPricing({ ...wb.pricing, video480: Number(e.target.value) || 0 })}
          />
          <em>方舟按 tokens 计费，秒单价是近似值</em>
        </label>
        <label className="st-field">
          <span>视频 · 720p 每秒</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={wb.pricing.video720}
            onChange={(e) => wb.setPricing({ ...wb.pricing, video720: Number(e.target.value) || 0 })}
          />
          <em>720p 一般比 480p 贵一倍左右</em>
        </label>
        <label className="st-field">
          <span>配音 · 每次</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={wb.pricing.audio}
            onChange={(e) => wb.setPricing({ ...wb.pricing, audio: Number(e.target.value) || 0 })}
          />
          <em>0 = 不计入</em>
        </label>
      </div>
    </section>
  )
}
