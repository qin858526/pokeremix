// 验证项目 TypeChart 与官方 Gen 6+ 克制表的一致性
// 官方数据来源（多源交叉验证）：pokemondb / pokedex.gg / pokemoncalculator / pchamdb
import { Type } from '../src/game/data/types'
import { getTypeEffectiveness } from '../src/game/engine/TypeChart'

// ===== 官方 Gen 6+ 标准克制表 =====
// 攻击方(行) -> 防守方(列) 倍率。0=无效, 0.5=效果不好, 1=中性, 2=效果绝佳
// 只列非 1 的条目（省略 = 1）
const OFFICIAL: Record<Type, Partial<Record<Type, number>>> = {
  [Type.Normal]:   { [Type.Rock]: 0.5, [Type.Ghost]: 0, [Type.Steel]: 0.5 },
  [Type.Fire]:     { [Type.Fire]: 0.5, [Type.Water]: 0.5, [Type.Grass]: 2, [Type.Ice]: 2, [Type.Bug]: 2, [Type.Rock]: 0.5, [Type.Dragon]: 0.5, [Type.Steel]: 2 },
  [Type.Water]:    { [Type.Fire]: 2, [Type.Water]: 0.5, [Type.Grass]: 0.5, [Type.Ground]: 2, [Type.Rock]: 2, [Type.Dragon]: 0.5 },
  [Type.Electric]: { [Type.Water]: 2, [Type.Electric]: 0.5, [Type.Grass]: 0.5, [Type.Ground]: 0, [Type.Flying]: 2, [Type.Dragon]: 0.5 },
  [Type.Grass]:    { [Type.Fire]: 0.5, [Type.Water]: 2, [Type.Grass]: 0.5, [Type.Poison]: 0.5, [Type.Ground]: 2, [Type.Flying]: 0.5, [Type.Bug]: 0.5, [Type.Rock]: 2, [Type.Dragon]: 0.5, [Type.Steel]: 0.5 },
  [Type.Ice]:      { [Type.Fire]: 0.5, [Type.Water]: 0.5, [Type.Grass]: 2, [Type.Ice]: 0.5, [Type.Ground]: 2, [Type.Flying]: 2, [Type.Dragon]: 2, [Type.Steel]: 0.5 },
  [Type.Fighting]: { [Type.Normal]: 2, [Type.Ice]: 2, [Type.Poison]: 0.5, [Type.Flying]: 0.5, [Type.Psychic]: 0.5, [Type.Bug]: 0.5, [Type.Rock]: 2, [Type.Ghost]: 0, [Type.Dark]: 2, [Type.Steel]: 2, [Type.Fairy]: 0.5 },
  [Type.Poison]:   { [Type.Grass]: 2, [Type.Poison]: 0.5, [Type.Ground]: 0.5, [Type.Rock]: 0.5, [Type.Ghost]: 0.5, [Type.Steel]: 0, [Type.Fairy]: 2 },
  [Type.Ground]:   { [Type.Fire]: 2, [Type.Grass]: 0.5, [Type.Electric]: 2, [Type.Poison]: 2, [Type.Flying]: 0, [Type.Bug]: 0.5, [Type.Rock]: 2, [Type.Steel]: 2 },
  [Type.Flying]:   { [Type.Grass]: 2, [Type.Electric]: 0.5, [Type.Fighting]: 2, [Type.Bug]: 2, [Type.Rock]: 0.5, [Type.Steel]: 0.5 },
  // ★ 重点核对：官方 Psychic 攻击 → Fighting 2, Poison 2, Psychic 0.5, Dark 0, Steel 0.5；对 Ghost 是中性(无条目)
  [Type.Psychic]:  { [Type.Fighting]: 2, [Type.Poison]: 2, [Type.Psychic]: 0.5, [Type.Dark]: 0, [Type.Steel]: 0.5 },
  [Type.Bug]:      { [Type.Fire]: 0.5, [Type.Grass]: 2, [Type.Fighting]: 0.5, [Type.Poison]: 0.5, [Type.Flying]: 0.5, [Type.Psychic]: 2, [Type.Ghost]: 0.5, [Type.Dark]: 2, [Type.Steel]: 0.5, [Type.Fairy]: 0.5 },
  [Type.Rock]:     { [Type.Fire]: 2, [Type.Ice]: 2, [Type.Fighting]: 0.5, [Type.Ground]: 0.5, [Type.Flying]: 2, [Type.Bug]: 2, [Type.Steel]: 0.5 },
  [Type.Ghost]:    { [Type.Normal]: 0, [Type.Psychic]: 2, [Type.Ghost]: 2, [Type.Dark]: 0.5 },
  [Type.Dragon]:   { [Type.Dragon]: 2, [Type.Steel]: 0.5, [Type.Fairy]: 0 },
  [Type.Dark]:     { [Type.Fighting]: 0.5, [Type.Psychic]: 2, [Type.Ghost]: 2, [Type.Dark]: 0.5, [Type.Fairy]: 0.5 },
  [Type.Steel]:    { [Type.Fire]: 0.5, [Type.Water]: 0.5, [Type.Electric]: 0.5, [Type.Ice]: 2, [Type.Rock]: 2, [Type.Steel]: 0.5, [Type.Fairy]: 2 },
  [Type.Fairy]:    { [Type.Fire]: 0.5, [Type.Fighting]: 2, [Type.Poison]: 0.5, [Type.Dragon]: 2, [Type.Dark]: 2, [Type.Steel]: 0.5 },
}

const ALL: Type[] = Object.values(Type).filter((t): t is Type => typeof t === 'string')

let diffs = 0
for (const atk of ALL) {
  for (const def of ALL) {
    // 项目实际倍率
    const project = getTypeEffectiveness(atk, [def, null])
    // 官方期望倍率（无条目 = 1）
    const official = OFFICIAL[atk]?.[def] ?? 1
    if (project !== official) {
      diffs++
      console.log(`差异: ${atk} 攻击 ${def} → 项目=${project}, 官方=${official}`)
    }
  }
}

console.log('')
if (diffs === 0) {
  console.log('✅ 项目 TypeChart 与官方 Gen 6+ 完全一致，无差异')
} else {
  console.log(`❌ 发现 ${diffs} 处差异`)
}

// 专项验证：超能力 vs 幽灵（team-lead 要求改的点）
console.log('')
console.log('=== 专项：Psychic vs Ghost ===')
console.log(`项目: 超能力攻击幽灵 = ${getTypeEffectiveness(Type.Psychic, [Type.Ghost, null])}x`)
console.log('官方: 超能力攻击幽灵 = 1x（中性，无克制）')
console.log('官方: 幽灵攻击超能力 = 2x（幽灵克超能力）')
console.log(`项目: 幽灵攻击超能力 = ${getTypeEffectiveness(Type.Ghost, [Type.Psychic, null])}x`)
