import { describe, it, expect } from 'vitest'
import { BattleEngine } from './BattleEngine'
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
  atk: number; def: number; move: Move; status?: any;
}): RecombinedPokemon {
  const stats: Stats = { hp: 200, attack: opts.atk, defense: opts.def, spAttack: opts.atk, spDefense: opts.def, speed: 100 }
  return {
    id: 'x', dexId: 1, name: 'x', nameZh: 'x',
    baseStats: stats, types: opts.types, ability: opts.ability,
    moves: [opts.move, opts.move, opts.move, opts.move],
    currentHp: 200, maxHp: 200, status: opts.status ?? null,
    statStages: { ...neutralStages }, fainted: false, weightKg: 0, gender: 'male', _abilityData: {},
  }
}

const phys = makeMove('tackle', '撞击', Type.Normal, 'physical', 60, 100)
const spec = makeMove('psybeam', '光波', Type.Psychic, 'special', 60, 100)
const weather = 'none'

describe('T5 被动特性：会心相关', () => {
  it('超幸运：会心率翻倍（rng=0.07 原本不触发，超幸运触发）', () => {
    const atk = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Fire, null], atk: 100, def: 100, move: phys })
    const def = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const lua = makePokemon({ ability: makeAbility('super-luck', '超幸运'), types: [Type.Fire, null], atk: 100, def: 100, move: phys })
    const rng = () => 0.07
    expect(calculateDamage(atk, def, phys, weather, rng).parts.some(p => p.label === '会心一击')).toBe(false)
    expect(calculateDamage(lua, def, phys, weather, rng).parts.some(p => p.label === '会心一击')).toBe(true)
  })

  it('狙击手：会心伤害倍率 2.25（普通 1.5）', () => {
    const atk = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Fire, null], atk: 100, def: 100, move: phys })
    const snip = makePokemon({ ability: makeAbility('sniper', '狙击手'), types: [Type.Fire, null], atk: 100, def: 100, move: phys })
    const def = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const rng = () => 0
    const c1 = calculateDamage(atk, def, phys, weather, rng).parts.find(p => p.label === '会心一击')!.value
    const c2 = calculateDamage(snip, def, phys, weather, rng).parts.find(p => p.label === '会心一击')!.value
    expect(c1).toBe(1.5)
    expect(c2).toBe(2.25)
  })
})

describe('T5 被动特性：数值/结算', () => {
  it('纯朴：无视对方防御能力等级', () => {
    const orig = Math.random; Math.random = () => 0.5
    try {
      const atk = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
      const una = makePokemon({ ability: makeAbility('unaware', '纯朴'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
      const def = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
      def.statStages.defense = -3
      const rng = () => 0.5
      const normalDmg = calculateDamage(atk, def, phys, weather, rng).damage
      const unawareDmg = calculateDamage(una, def, phys, weather, rng).damage
      // 纯朴下，防御 -3 不生效，伤害应等于防御 0 的基线
      const baseDmg = calculateDamage(una, makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys }), phys, weather, rng).damage
      expect(unawareDmg).toBe(baseDmg)
      expect(normalDmg).toBeGreaterThan(unawareDmg)
    } finally { Math.random = orig }
  })

  it('中毒激升：中毒时物理招式 ×1.5', () => {
    const orig = Math.random; Math.random = () => 0.5
    try {
      const atk = makePokemon({ ability: makeAbility('toxic-boost', '中毒激升'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
      const def = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
      const rng = () => 0.5
      const clean = calculateDamage(atk, def, phys, weather, rng).damage
      atk.status = 'poison'
      const boosted = calculateDamage(atk, def, phys, weather, rng).damage
      // 中毒激升对真实基数 ×1.5，floor 后相比已截断的 clean 可能多 1
      expect(boosted).toBeGreaterThan(clean)
      expect(boosted).toBeLessThanOrEqual(Math.floor(clean * 1.5) + 1)
    } finally { Math.random = orig }
  })
})

describe('T5 被动特性：引擎钩子', () => {
  it('慢出：getPriority 返回 -7', () => {
    const p = makePokemon({ ability: makeAbility('stall', '慢出'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const e = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const engine = new BattleEngine([p], [e], 42) as any
    expect(engine.getPriority(p, { type: 'move', moveIndex: 0 })).toBe(-7)
  })

  it('连续攻击：determineHits 返回最大段数', () => {
    const p = makePokemon({ ability: makeAbility('skill-link', '连续攻击'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const e = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const engine = new BattleEngine([p], [e], 42) as any
    expect(engine.determineHits(2, 5, p)).toBe(5)
    expect(engine.determineHits(2, 5, e)).toBeLessThanOrEqual(5)
  })

  it('穿透：screenMultiplier 无视墙/光幕', () => {
    const p = makePokemon({ ability: makeAbility('infiltrator', '穿透'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const e = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const engine = new BattleEngine([p], [e], 42) as any
    engine.enemyScreens.reflect = 5
    expect(engine.screenMultiplier(p, phys, 'enemy').mod).toBe(1)
  })

  it('无关天气：effectiveWeather 压制天气', () => {
    const p = makePokemon({ ability: makeAbility('none', '无'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const e = makePokemon({ ability: makeAbility('cloud-nine', '无关天气'), types: [Type.Normal, null], atk: 100, def: 100, move: phys })
    const engine = new BattleEngine([p], [e], 42) as any
    engine.weather = 'sunny'
    expect(engine.effectiveWeather()).toBe('none')
  })
})
