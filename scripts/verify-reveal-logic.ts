// 验证敌方信息揭示逻辑：克制反推 + STAB 揭示
// 模拟 Battle.svelte 中的 revealTypesFromEffectiveness 逻辑
import { getTypeEffectiveness } from '../src/game/engine/TypeChart'
import { Type } from '../src/game/data/types'

// 敌方真实属性（鬼斯：幽灵 + 毒）
const enemyRealTypes: Type[] = [Type.Ghost, Type.Poison]

// 模拟 revealTypesFromEffectiveness
function revealTypesFromEffectiveness(moveType: Type, expectedMult: number, revealed: Set<Type>): Set<Type> {
  const realTypes = enemyRealTypes
  const matched = realTypes.filter(t => getTypeEffectiveness(moveType, [t, null]) === expectedMult)
  const next = new Set(revealed)
  for (const m of matched) next.add(m)
  return next
}

console.log('=== 敌方真实属性: 幽灵 + 毒 ===')
console.log('')

// 场景1：我方用普通系技能（tackle）→ 对幽灵免疫 (×0)
let revealed = new Set<Type>()
revealed = revealTypesFromEffectiveness(Type.Normal, 0, revealed)
console.log('玩家用普通系 → 免疫(×0) → 揭示:', [...revealed].join(', ') || '(空)')
console.log('预期: ghost（普通系对幽灵免疫）')
console.log('结果:', revealed.has(Type.Ghost) ? 'PASS' : 'FAIL', revealed.has(Type.Poison) ? '(注意: 毒也被揭示了?)' : '')
console.log('')

// 场景2：我方用超能力系 → 对毒 2 倍 (×2)（注意：此 TypeChart 中超能力对幽灵未标 2 倍，只有毒）
revealed = new Set<Type>()
revealed = revealTypesFromEffectiveness(Type.Psychic, 2, revealed)
console.log('玩家用超能力系 → 效果绝佳(×2) → 揭示:', [...revealed].join(', '))
console.log('预期: poison（本 TypeChart 中超能力只对毒 2 倍）')
console.log('结果:', revealed.has(Type.Poison) && !revealed.has(Type.Ghost) ? 'PASS' : 'FAIL')
console.log('')

// 场景3：我方用格斗系 → 对毒 0.5 倍 (×0.5)
revealed = new Set<Type>()
revealed = revealTypesFromEffectiveness(Type.Fighting, 0.5, revealed)
console.log('玩家用格斗系 → 效果不太好(×0.5) → 揭示:', [...revealed].join(', '))
console.log('预期: poison（格斗对毒 0.5 倍）')
console.log('结果:', revealed.has(Type.Poison) ? 'PASS' : 'FAIL')
console.log('')

// 场景4：敌方用 STAB 技能（鬼斯用幽灵系技能 → 揭示幽灵）
const enemyMoveType = Type.Ghost
if (enemyRealTypes.includes(enemyMoveType)) {
  const next = new Set(revealed)
  next.add(enemyMoveType)
  revealed = next
  console.log('敌方使用幽灵系技能（STAB）→ 揭示 ghost')
}
console.log('STAB 后揭示:', [...revealed].join(', '))
console.log('结果:', revealed.has(Type.Ghost) ? 'PASS' : 'FAIL')
console.log('')

// 场景5：双属性逐步揭示到全揭示
revealed = new Set<Type>()
revealed = revealTypesFromEffectiveness(Type.Normal, 0, revealed) // 幽灵
revealed = revealTypesFromEffectiveness(Type.Fighting, 0.5, revealed) // 毒
console.log('逐步揭示: 普通系免疫 → 幽灵, 格斗抵抗 → 毒')
console.log('最终揭示:', [...revealed].join(', '))
console.log('全揭示?', enemyRealTypes.every(t => revealed.has(t)) ? 'PASS' : 'FAIL')
console.log('')

// 场景6：火系打草+毒（妙蛙花）——测试单属性反推
const enemyGrassPoison: Type[] = [Type.Grass, Type.Poison]
function revealFor(moveType: Type, expectedMult: number, realTypes: Type[], revealed: Set<Type>): Set<Type> {
  const matched = realTypes.filter(t => getTypeEffectiveness(moveType, [t, null]) === expectedMult)
  const next = new Set(revealed)
  for (const m of matched) next.add(m)
  return next
}
let r2 = new Set<Type>()
r2 = revealFor(Type.Fire, 2, enemyGrassPoison, r2) // 火对草 2 倍
console.log('=== 敌方: 草+毒 ===')
console.log('玩家用火系 → 效果绝佳 → 揭示:', [...r2].join(', '))
console.log('预期: grass（火对草 2 倍，对毒 1 倍）')
console.log('结果:', r2.has(Type.Grass) ? 'PASS' : 'FAIL')
