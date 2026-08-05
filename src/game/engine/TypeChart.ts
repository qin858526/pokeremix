import { Type, ALL_TYPES } from '../data/types'

/**
 * 属性克制表（第 6 代+，含妖精属性）
 * key: 攻击方属性, value: { 防守方属性: 倍率 }
 * 倍率: 2 = 效果绝佳, 0.5 = 效果不好, 0 = 无效
 */
const TYPE_CHART: Record<Type, Partial<Record<Type, number>>> = {
  [Type.Normal]: { [Type.Rock]: 0.5, [Type.Ghost]: 0, [Type.Steel]: 0.5 },
  [Type.Fire]: {
    [Type.Fire]: 0.5, [Type.Water]: 0.5, [Type.Grass]: 2, [Type.Ice]: 2,
    [Type.Bug]: 2, [Type.Rock]: 0.5, [Type.Dragon]: 0.5, [Type.Steel]: 2,
    [Type.Fairy]: 0.5,
  },
  [Type.Water]: {
    [Type.Fire]: 2, [Type.Water]: 0.5, [Type.Grass]: 0.5, [Type.Ground]: 2,
    [Type.Rock]: 2, [Type.Dragon]: 0.5,
  },
  [Type.Electric]: {
    [Type.Water]: 2, [Type.Electric]: 0.5, [Type.Grass]: 0.5, [Type.Ground]: 0,
    [Type.Flying]: 2, [Type.Dragon]: 0.5,
  },
  [Type.Grass]: {
    [Type.Fire]: 0.5, [Type.Water]: 2, [Type.Grass]: 0.5, [Type.Poison]: 0.5,
    [Type.Ground]: 2, [Type.Flying]: 0.5, [Type.Bug]: 0.5, [Type.Rock]: 2,
    [Type.Dragon]: 0.5, [Type.Steel]: 0.5,
  },
  [Type.Ice]: {
    [Type.Fire]: 0.5, [Type.Water]: 0.5, [Type.Grass]: 2, [Type.Ice]: 0.5,
    [Type.Ground]: 2, [Type.Flying]: 2, [Type.Dragon]: 2, [Type.Steel]: 0.5,
  },
  [Type.Fighting]: {
    [Type.Normal]: 2, [Type.Ice]: 2, [Type.Poison]: 0.5, [Type.Flying]: 0.5,
    [Type.Psychic]: 0.5, [Type.Bug]: 0.5, [Type.Rock]: 2, [Type.Ghost]: 0,
    [Type.Dark]: 2, [Type.Steel]: 2, [Type.Fairy]: 0.5,
  },
  [Type.Poison]: {
    [Type.Grass]: 2, [Type.Poison]: 0.5, [Type.Ground]: 0.5, [Type.Rock]: 0.5,
    [Type.Ghost]: 0.5, [Type.Steel]: 0, [Type.Fairy]: 2,
  },
  [Type.Ground]: {
    [Type.Fire]: 2, [Type.Grass]: 0.5, [Type.Electric]: 2, [Type.Poison]: 2,
    [Type.Flying]: 0, [Type.Bug]: 0.5, [Type.Rock]: 2, [Type.Steel]: 2,
  },
  [Type.Flying]: {
    [Type.Grass]: 2, [Type.Electric]: 0.5, [Type.Fighting]: 2, [Type.Bug]: 2,
    [Type.Rock]: 0.5, [Type.Steel]: 0.5,
  },
  [Type.Psychic]: {
    [Type.Fighting]: 2, [Type.Poison]: 2, [Type.Psychic]: 0.5, [Type.Dark]: 0,
    [Type.Steel]: 0.5,
  },
  [Type.Bug]: {
    [Type.Fire]: 0.5, [Type.Grass]: 2, [Type.Fighting]: 0.5, [Type.Poison]: 0.5,
    [Type.Flying]: 0.5, [Type.Psychic]: 2, [Type.Ghost]: 0.5, [Type.Dark]: 2,
    [Type.Steel]: 0.5, [Type.Fairy]: 0.5,
  },
  [Type.Rock]: {
    [Type.Fire]: 2, [Type.Ice]: 2, [Type.Fighting]: 0.5, [Type.Ground]: 0.5,
    [Type.Flying]: 2, [Type.Bug]: 2, [Type.Steel]: 0.5,
  },
  [Type.Ghost]: {
    [Type.Normal]: 0, [Type.Psychic]: 2, [Type.Ghost]: 2, [Type.Dark]: 0.5,
  },
  [Type.Dragon]: {
    [Type.Dragon]: 2, [Type.Steel]: 0.5, [Type.Fairy]: 0,
  },
  [Type.Dark]: {
    [Type.Fighting]: 0.5, [Type.Psychic]: 2, [Type.Ghost]: 2, [Type.Dark]: 0.5,
    [Type.Fairy]: 0.5,
  },
  [Type.Steel]: {
    [Type.Fire]: 0.5, [Type.Water]: 0.5, [Type.Electric]: 0.5, [Type.Ice]: 2,
    [Type.Rock]: 2, [Type.Steel]: 0.5, [Type.Fairy]: 2,
  },
  [Type.Fairy]: {
    [Type.Fire]: 0.5, [Type.Fighting]: 2, [Type.Poison]: 0.5, [Type.Dragon]: 2,
    [Type.Dark]: 2, [Type.Steel]: 0.5,
  },
}

/**
 * 计算攻击方属性对防守方的克制倍率
 */
export function getTypeEffectiveness(
  attackType: Type,
  defenderTypes: [Type, Type | null],
): number {
  let multiplier = 1
  const chart = TYPE_CHART[attackType]
  for (const t of [defenderTypes[0], defenderTypes[1]].filter(Boolean)) {
    multiplier *= chart[t as Type] ?? 1
  }
  return multiplier
}

/**
 * 获取克制倍率的中文描述
 */
export function getEffectivenessText(multiplier: number): string {
  if (multiplier === 0) return '没有效果…'
  if (multiplier >= 2) return '效果绝佳！'
  if (multiplier < 1 && multiplier > 0) return '效果不太好…'
  return ''
}
