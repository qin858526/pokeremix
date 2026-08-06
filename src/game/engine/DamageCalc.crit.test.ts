import { describe, it, expect } from 'vitest'
import { calculateDamage } from './DamageCalc'
import { Type } from '../data/types'
import type { RecombinedPokemon, Move, Ability, Stats, StatStages } from '../data/types'

function makeAbility(name: string, nameZh: string): Ability {
  return { id: 0, name, nameZh, description: '' }
}

function makeMove(
  name: string, nameZh: string, type: Type,
  category: 'physical' | 'special' | 'status', power: number, accuracy: number,
): Move {
  return { id: 0, name, nameZh, type, category, power, accuracy, pp: 99, currentPp: 99, priority: 0, description: '' }
}

const neutralStages: StatStages = {
  attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0,
}

function makePokemon(opts: {
  ability: Ability; types: [Type, Type | null];
  atk: number; def: number; move: Move;
}): RecombinedPokemon {
  const stats: Stats = { hp: 200, attack: opts.atk, defense: opts.def, spAttack: opts.atk, spDefense: opts.def, speed: 100 }
  return {
    id: 'x', dexId: 1, name: 'x', nameZh: 'x',
    baseStats: stats, types: opts.types, ability: opts.ability,
    moves: [opts.move, opts.move, opts.move, opts.move],
    currentHp: 200, maxHp: 200, status: null,
    statStages: { ...neutralStages }, fainted: false, _abilityData: {},
  }
}

const atk = makePokemon({
  ability: makeAbility('none', '无'), types: [Type.Fire, null],
  atk: 100, def: 100, move: makeMove('ember', '火花', Type.Fire, 'special', 60, 100),
})
const def = makePokemon({
  ability: makeAbility('none', '无'), types: [Type.Normal, null],
  atk: 100, def: 100, move: makeMove('tackle', '撞击', Type.Normal, 'physical', 40, 100),
})
const move = makeMove('ember', '火花', Type.Fire, 'special', 60, 100)

// 会心判定为 rng() < 1/16：低值(0)触发，高值(0.999)不触发
// 关闭随机因子对数值断言的干扰：会心下限 1.5*0.85=1.275× 远高于非会心上限 1.0×，区间不重叠
describe('会心一击', () => {
  it('默认（高 rng）不会触发会心', () => {
    const res = calculateDamage(atk, def, move, 'none', () => 0.999)
    expect(res.parts.some(p => p.label === '会心一击')).toBe(false)
  })

  it('低 rng 触发会心 ×1.5 且伤害高于非会心', () => {
    const nonCrit = calculateDamage(atk, def, move, 'none', () => 0.999)
    const crit = calculateDamage(atk, def, move, 'none', () => 0)
    expect(crit.parts.some(p => p.label === '会心一击')).toBe(true)
    expect(crit.parts.find(p => p.label === '会心一击')!.value).toBe(1.5)
    expect(crit.damage).toBeGreaterThan(nonCrit.damage)
  })

  it('硬壳盔甲免疫会心', () => {
    const armored = makePokemon({
      ability: makeAbility('shell-armor', '硬壳盔甲'), types: [Type.Normal, null],
      atk: 100, def: 100, move: makeMove('tackle', '撞击', Type.Normal, 'physical', 40, 100),
    })
    const res = calculateDamage(atk, armored, move, 'none', () => 0)
    expect(res.parts.some(p => p.label === '会心一击')).toBe(false)
  })

  it('战斗盔甲免疫会心', () => {
    const armored = makePokemon({
      ability: makeAbility('battle-armor', '战斗盔甲'), types: [Type.Normal, null],
      atk: 100, def: 100, move: makeMove('tackle', '撞击', Type.Normal, 'physical', 40, 100),
    })
    const res = calculateDamage(atk, armored, move, 'none', () => 0)
    expect(res.parts.some(p => p.label === '会心一击')).toBe(false)
  })
})
