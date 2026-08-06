import type { RecombinedPokemon, Move } from '../data/types'
import { getTypeEffectiveness } from './TypeChart'
import { isPunchMove, hasMoveTag } from '../data/move-tags'

/** 固定等级 */
const LEVEL = 50

/** 属性一致加成 */
const STAB = 1.5

/** 天气类型（与 BattleEngine 保持一致） */
export type WeatherKind = 'none' | 'sun' | 'rain' | 'sandstorm' | 'hail'

/** 随机因子 [0.85, 1.0] */
function randomFactor(): number {
  return 0.85 + Math.random() * 0.15
}

/** 倍率明细中的一项（仅用于日志展示非 1 的因子） */
export interface DamagePart {
  label: string
  value: number
}

/** 伤害计算结果（含倍率明细，供日志展示） */
export interface DamageResult {
  base: number
  /** 非 1 的修正因子列表（属性一致 / 属性克制 / 特性 / 天气等） */
  parts: DamagePart[]
  damage: number
}

/**
 * 获取特性加成倍率（同时返回展示标签）
 */
function getAbilityDamageMod(
  attacker: RecombinedPokemon,
  defender: RecombinedPokemon,
  move: Move,
): { mod: number; label: string | null } {
  const aAbility = attacker.ability.name
  const dAbility = defender.ability.name
  const hpRatio = attacker.currentHp / attacker.maxHp

  // 茂盛/猛火/激流：HP ≤ 1/3 时对应属性 1.5 倍
  if (aAbility === 'overgrow' && move.type === 'grass' && hpRatio <= 1 / 3) return { mod: 1.5, label: '茂盛' }
  if (aAbility === 'blaze' && move.type === 'fire' && hpRatio <= 1 / 3) return { mod: 1.5, label: '猛火' }
  if (aAbility === 'torrent' && move.type === 'water' && hpRatio <= 1 / 3) return { mod: 1.5, label: '激流' }

  // 虫之预感：HP ≤ 1/3 时虫系 1.5 倍
  if (aAbility === 'swarm' && move.type === 'bug' && hpRatio <= 1 / 3) return { mod: 1.5, label: '虫之预感' }

  // 毅力：异常状态时物理攻击 1.5 倍
  if (aAbility === 'guts' && attacker.status && move.category === 'physical') return { mod: 1.5, label: '毅力' }

  // 引火：吸收过火系攻击后火系 1.5 倍
  if (aAbility === 'flash-fire' && move.type === 'fire' && attacker._abilityData?.flashFireActivated) return { mod: 1.5, label: '引火' }

  // 大力士/瑜珈之力：物理攻击 2 倍
  if ((aAbility === 'huge-power' || aAbility === 'pure-power') && move.category === 'physical') return { mod: 2, label: '大力士' }

  // 活力：物理攻击 1.5 倍（代价是命中降低，在 calcFinalAccuracy 处理）
  if (aAbility === 'hustle' && move.category === 'physical') return { mod: 1.5, label: '活力' }

  // 厚脂肪：火/冰伤害减半
  if (dAbility === 'thick-fat' && (move.type === 'fire' || move.type === 'ice')) return { mod: 0.5, label: '厚脂肪' }

  // 奇异鳞片：异常状态时物理防御 1.5 倍
  if (dAbility === 'marvel-scale' && defender.status && move.category === 'physical') return { mod: 0.67, label: '奇异鳞片' }

  // 适应力：属性一致加成从 1.5 变为 2（此处返回叠加在 STAB 之上的系数）
  if (aAbility === 'adaptability' && (move.type === attacker.types[0] || move.type === attacker.types[1])) return { mod: 1.33, label: '适应力' }

  // 铁拳：拳类招式 1.2 倍
  if (aAbility === 'iron-fist' && isPunchMove(move.name)) return { mod: 1.2, label: '铁拳' }

  // 舍身：反伤招式 1.2 倍
  if (aAbility === 'reckless' && hasMoveTag(move.name, 'recoil')) return { mod: 1.2, label: '舍身' }

  // 技术高手：威力 ≤ 60 的招式 1.5 倍
  if (aAbility === 'technician' && (move.power ?? 0) <= 60) return { mod: 1.5, label: '技术高手' }

  // 有色眼镜：效果不好的招式威力翻倍
  if (aAbility === 'tinted-lens') {
    const eff = getTypeEffectiveness(move.type, defender.types)
    if (eff > 0 && eff < 1) return { mod: 2, label: '有色眼镜' }
  }

  // 沙之力：沙暴时岩石/地面/钢 1.3 倍
  if (aAbility === 'sand-force' && (move.type === 'rock' || move.type === 'ground' || move.type === 'steel')) return { mod: 1.3, label: '沙之力' }

  // 多重鳞片：满血时伤害减半
  if (dAbility === 'multiscale' && defender.currentHp === defender.maxHp) return { mod: 0.5, label: '多重鳞片' }

  // 坚岩/过滤：效果绝佳伤害 ×0.75
  if ((dAbility === 'solid-rock' || dAbility === 'filter') && getTypeEffectiveness(move.type, defender.types) > 1) return { mod: 0.75, label: '坚岩/过滤' }

  // 友情防守：所有伤害 ×0.75
  if (dAbility === 'friend-guard') return { mod: 0.75, label: '友情防守' }

  return { mod: 1, label: null }
}

/**
 * 天气对伤害的影响（标准 Gen 5+ 规则）
 */
function getWeatherDamageMod(move: Move, weather: WeatherKind): { mod: number; label: string | null } {
  if (weather === 'sun') {
    if (move.type === 'fire') return { mod: 1.5, label: '晴天·火' }
    if (move.type === 'water') return { mod: 0.5, label: '晴天·水减' }
  } else if (weather === 'rain') {
    if (move.type === 'water') return { mod: 1.5, label: '下雨·水' }
    if (move.type === 'fire') return { mod: 0.5, label: '下雨·火减' }
  } else if (weather === 'sandstorm') {
    if (move.type === 'rock') return { mod: 1.5, label: '沙暴·岩' }
  } else if (weather === 'hail') {
    if (move.type === 'ice') return { mod: 1.5, label: '冰雹·冰' }
  }
  return { mod: 1, label: null }
}

/** 把倍率格式化为可读字符串（1.5 / 0.5 / 2 / 1.33） */
function fmtMult(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 100) / 100)
}

/** 把倍率明细拼成日志后缀，如 （属性一致×1.5｜猛火×1.5｜晴天·火×1.5） */
export function formatBreakdown(parts: DamagePart[]): string {
  if (!parts.length) return ''
  return '（' + parts.map(p => `${p.label}×${fmtMult(p.value)}`).join('｜') + '）'
}

/**
 * 计算伤害（参照第 5 代+ 公式）
 * 固定：等级 50, IV 全 31, EV 全 0
 * 返回伤害与倍率明细，供日志展示。
 */
export function calculateDamage(
  attacker: RecombinedPokemon,
  defender: RecombinedPokemon,
  move: Move,
  weather: WeatherKind = 'none',
): DamageResult {
  if (move.category === 'status') return { base: 0, parts: [], damage: 0 }

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

  // 基础伤害
  const base = Math.floor(
    (Math.floor((2 * LEVEL) / 5 + 2) * (move.power || 1) * effectiveAtk) / effectiveDef / 50 + 2,
  )

  // 修正系数
  const parts: DamagePart[] = []
  let modifier = 1

  // 烧伤：物理伤害减半
  if (attacker.status === 'burn' && move.category === 'physical') {
    modifier *= 0.5
    parts.push({ label: '灼伤', value: 0.5 })
  }

  // 属性一致加成（技能属性与攻击方任一属性相同）
  const isStab = move.type === attacker.types[0] || move.type === attacker.types[1]
  if (isStab) {
    modifier *= STAB
    parts.push({ label: '属性一致', value: STAB })
  }

  // 属性克制
  const effMult = getTypeEffectiveness(move.type, defender.types)
  if (effMult !== 1) {
    modifier *= effMult
    parts.push({ label: '属性克制', value: effMult })
  }

  // 特性加成
  const ab = getAbilityDamageMod(attacker, defender, move)
  if (ab.mod !== 1) {
    modifier *= ab.mod
    if (ab.label) parts.push({ label: ab.label, value: ab.mod })
  }

  // 天气加成
  const w = getWeatherDamageMod(move, weather)
  if (w.mod !== 1) {
    modifier *= w.mod
    if (w.label) parts.push({ label: w.label, value: w.mod })
  }

  modifier *= randomFactor() // 随机因子（不计入展示明细）

  return { base, parts, damage: Math.max(1, Math.floor(base * modifier)) }
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
