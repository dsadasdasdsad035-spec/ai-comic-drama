import { saveSettings, type AppSettings } from '../api'
import { saveSkillOverride } from './api'
import { planLegacySkillOverrides } from './migrationPlan'
import { loadSkills } from './registry'

let migrating: Promise<boolean> | null = null

/** 首次加载设置后执行一次；成功才写 skillsMigrated，失败可下次重试。 */
export async function ensureSkillsMigrated(settings: AppSettings | null): Promise<boolean> {
  if (!settings || settings.skillsMigrated) return false
  if (migrating) return migrating
  migrating = (async () => {
    const { skills } = await loadSkills()
    const overrides = planLegacySkillOverrides(settings.rules, skills)
    for (const ov of overrides) {
      await saveSkillOverride(ov.skillId, ov.body, ov.baseVersion)
    }
    await saveSettings({ skillsMigrated: true })
    return true
  })()
  try {
    return await migrating
  } catch (e) {
    migrating = null
    throw e
  }
}
