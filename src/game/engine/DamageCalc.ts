import type { RecombinedPokemon, Move } from '../data/types'
import { getTypeEffectiveness } from './TypeChart'
import { isPunchMove, hasMoveTag } from '../data/move-tags'

/** 固定等级 */
const LEVEL = 50

/** 属性一致加成 */
const STAB = 1.5

/** 随机因子 [0.85, 1.0] */
function randomFactor(): number {
  return 0.85 + Math.random() * 0.15
}

/**
 * 获取特性加成倍率
 */
function getAbilityDamageMod(attacker: RecombinedPokemon, defender: RecombinedPokemon, move: Move): number {
  const aAbility = attacker.ability.name
  const dAbility = defender.ability.name
  const hpRatio = attacker.currentHp / attacker.maxHp

  // 茂盛/猛火/激流：HP ≤ 1/3 时对应属性 1.5 倍
  if (aAbility === 'overgrow' && move.type === 'grass' && hpRatio <= 1 / 3) return 1.5
  if (aAbility === 'blaze' && move.type === 'fire' && hpRatio <= 1 / 3) return 1.5
  if (aAbility === 'torrent' && move.type === 'water' && hpRatio <= 1 / 3) return 1.5

  // 虫之预感：HP ≤ 1/3 时虫系 1.5 倍
  if (aAbility === 'swarm' && move.type === 'bug' && hpRatio <= 1 / 3) return 1.5

  // 毅力：异常状态时物理攻击 1.5 倍
  if (aAbility === 'guts' && attacker.status && move.category === 'physical') return 1.5

  // 引火：吸收过火系攻击后火系 1.5 倍
  if (aAbility === 'flash-fire' && move.type === 'fire' && attacker._abilityData?.flashFireActivated) return 1.5

  // 大力士/瑜珈之力：物理攻击 2 倍
  if ((aAbility === 'huge-power' || aAbility === 'pure-power') && move.category === 'physical') return 2

  // 活力：物理攻击 1.5 倍（代价是命中降低，在 calcFinalAccuracy 处理）
  if (aAbility === 'hustle' && move.category === 'physical') return 1.5

  // 厚脂肪：火/冰伤害减半
  if (dAbility === 'thick-fat' && (move.type === 'fire' || move.type === 'ice')) return 0.5

  // 奇异鳞片：异常状态时防御 1.5 倍
  if (dAbility === 'marvel-scale' && defender.status && move.category === 'physical') return 0.67

  // 适应力：属性一致加成从 1.5 变为 2
  if (aAbility === 'adaptability' && (move.type === attacker.types[0] || move.type === attacker.types[1])) return 1.33

  // 铁拳：拳类招式 1.2 倍
  if (aAbility === 'iron-fist' && isPunchMove(move.name)) return 1.2

  // 舍身：反伤招式 1.2 倍
  if (aAbility === 'reckless' && hasMoveTag(move.name, 'recoil')) return 1.2

  // 技术高手：威力 ≤ 60 的招式 1.5 倍
  if (aAbility === 'technician' && (move.power ?? 0) <= 60) return 1.5

  // 有色眼镜：效果不好的招式威力翻倍
  if (aAbility === 'tinted-lens') {
    const eff = getTypeEffectiveness(move.type, defender.types)
    if (eff > 0 && eff < 1) return 2
  }

  // 太阳之力：大晴天时特攻 1.5 倍
  if (aAbility === 'solar-power' && move.category === 'special') {
    // weather check done in the engine via _abilityData or we pass it
    // for DamageCalc simplicity, we don't check weather here
  }

  // 沙之力：沙暴时岩石/地面/钢 1.3 倍
  if (aAbility === 'sand-force' && (move.type === 'rock' || move.type === 'ground' || move.type === 'steel')) return 1.3

  // 多重鳞片：满血时伤害减半
  if (dAbility === 'multiscale' && defender.currentHp === defender.maxHp) return 0.5

  // 坚岩/过滤：效果绝佳伤害 ×0.75
  if ((dAbility === 'solid-rock' || dAbility === 'filter') && getTypeEffectiveness(move.type, defender.types) > 1) return 0.75

  // 友情防守：所有伤害 ×0.75
  if (dAbility === 'friend-guard') return 0.75

  return 1
}

/**
 * 计算伤害（参照第 5 代+ 公式）
 * 固定：等级 50, IV 全 31, EV 全 0
 */
export function calculateDamage(
  attacker: RecombinedPokemon,
  defender: RecombinedPokemon,
  move: Move,
): number {
  if (move.category === 'status') return 0

  // 攻击 / 特攻（考虑能力变化）
  const atkStage = attacker.statStages[
    move.category === 'physical' ? 'attack' : 'spAttack'
  ]
  const defStage = defender.statStages[
    move.category === 'physical' ? 'defense' : 'spDefense'
  ]

  // 能力变化倍率（Gen 5+）
  const atkMultiplier = atkStage >= 0 ? (2 + atkStage) / 2 : 2 / (2 - atkStage)
  const defMultiplier = defStage >= 0 ? (2 + defStage) / 2 : 2 / (2 - defStage)

  const baseStat = move.category === 'physical'
    ? attacker.baseStats.attack
    : attacker.baseStats.spAttack
  const defStat = move.category === 'physical'
    ? defender.baseStats.defense
    : defender.baseStats.spDefense

  const effectiveAtk = Math.floor(baseStat * atkMultiplier)
  const effectiveDef = Math.floor(defStat * defMultiplier)

  // 伤害公式
  const base = Math.floor(
    (Math.floor((2 * LEVEL) / 5 + 2) * (move.power || 1) * effectiveAtk) / effectiveDef / 50 + 2,
  )

  // 修正系数
  let modifier = 1

  // 烧伤：物理伤害减半
  if (attacker.status === 'burn' && move.category === 'physical') {
    modifier *= 0.5
  }

  // 属性一致加成（技能属性与攻击方任一属性相同）
  if (move.type === attacker.types[0] || move.type === attacker.types[1]) {
    modifier *= STAB
  }
  modifier *= getTypeEffectiveness(move.type, defender.types) // 属性克制
  modifier *= getAbilityDamageMod(attacker, defender, move) // 特性加成
  modifier *= randomFactor() // 随机因子

  return Math.max(1, Math.floor(base * modifier))
}

/**
 * 检查是否有属性免疫
 */
export function isImmune(
  move: Move,
  defender: RecombinedPokemon,
): boolean {
  return getTypeEffectiveness(move.type, defender.types) === 0
}
