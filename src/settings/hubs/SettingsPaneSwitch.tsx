import type { SettingsPane } from '../settingsNav'
import type { SettingsWorkbench } from '../useSettingsWorkbench'
import { ProvidersPane } from './connections/ProvidersPane'
import { ModelsPane } from './connections/ModelsPane'
import { RoutingPane } from './pipeline/RoutingPane'
import { LipSyncPane } from './pipeline/LipSyncPane'
import { VoicesPane } from './pipeline/VoicesPane'
import { AgentPane } from './extensions/AgentPane'
import { StockPane } from './extensions/StockPane'
import { CreativePane } from './extensions/CreativePane'
import { SkillsPane } from './extensions/SkillsPane'
import { ExpertsPane } from './extensions/ExpertsPane'
import { McpPane } from './extensions/McpPane'
import { PricingPane } from './billing/PricingPane'
import { DataPane } from './data/DataPane'

type Props = {
  pane: SettingsPane
  wb: SettingsWorkbench
}

export function SettingsPaneSwitch({ pane, wb }: Props) {
  switch (pane) {
    case 'providers':
      return <ProvidersPane wb={wb} />
    case 'models':
      return <ModelsPane wb={wb} />
    case 'routing':
      return <RoutingPane wb={wb} />
    case 'lipsync':
      return <LipSyncPane wb={wb} />
    case 'voices':
      return <VoicesPane wb={wb} />
    case 'agent':
      return <AgentPane wb={wb} />
    case 'stock':
      return <StockPane wb={wb} />
    case 'creative':
      return <CreativePane wb={wb} />
    case 'skills':
      return <SkillsPane wb={wb} />
    case 'experts':
      return <ExpertsPane wb={wb} />
    case 'mcp':
      return <McpPane wb={wb} />
    case 'pricing':
      return <PricingPane wb={wb} />
    case 'data':
      return <DataPane wb={wb} />
    default:
      return null
  }
}