import { describe, it, expect } from 'vitest'
import { BattleEngine } from './BattleEngine'
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
  id: string; dexId: number; name: string; nameZh: string;
  baseStats: Stats; types: [Type, Type | null]; ability: Ability;
  moves: [Move, Move, Move, Move]; currentHp: number; maxHp: number;
}): RecombinedPokemon {
  return {
    id: opts.id, dexId: opts.dexId, name: opts.name, nameZh: opts.nameZh,
    baseStats: opts.baseStats, types: opts.types, ability: opts.ability,
    moves: opts.moves, currentHp: opts.currentHp, maxHp: opts.maxHp,
    status: null, statStages: { ...neutralStages }, fainted: false, _abilityData: {},
  }
}

describe('变色特性', () => {
  it('被招式命中后属性变为该招式属性', () => {
    const normalMove = makeMove('tackle', '撞击', Type.Normal, 'physical', 40, 100)
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'bulba', nameZh: '妙蛙草',
      baseStats: { hp: 200, attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      types: [Type.Grass, null], ability: makeAbility('overgrow', '茂盛'),
      moves: [normalMove, normalMove, normalMove, normalMove], currentHp: 200, maxHp: 200,
    })
    // 金鱼王：水属性 + 变色，受击后应变一般系
    const enemy = makePokemon({
      id: 'e1', dexId: 350, name: 'goldeen', nameZh: '金鱼王',
      baseStats: { hp: 100, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('color-change', '变色'),
      moves: [normalMove, normalMove, normalMove, normalMove], currentHp: 100, maxHp: 100,
    })

    const engine = new BattleEngine([player], [enemy], 111)
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)

    // 敌方未倒下（伤害可控），属性应变为一般
    expect(enemy.fainted).toBe(false)
    expect(enemy.types[0]).toBe(Type.Normal)
    expect(enemy.types[1]).toBeNull()
    // 日志应出现变色提示
    expect(events.some(e => e.message.includes('变色'))).toBe(true)
  })
})

describe('伤害倍率明细', () => {
  it('属性一致时在伤害事件里写出倍率明细', () => {
    const grassMove = makeMove('grass-knot', '打草结', Type.Grass, 'special', 80, 100)
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'bulba', nameZh: '妙蛙草',
      baseStats: { hp: 200, attack: 100, defense: 100, spAttack: 150, spDefense: 100, speed: 200 },
      types: [Type.Grass, null], ability: makeAbility('overgrow', '茂盛'),
      moves: [grassMove, grassMove, grassMove, grassMove], currentHp: 200, maxHp: 200,
    })
    const enemy = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 200, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: [grassMove, grassMove, grassMove, grassMove], currentHp: 200, maxHp: 200,
    })

    const engine = new BattleEngine([player], [enemy], 222)
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)

    const dmgEvent = events.find(e => e.type === 'damage' && e.message.includes('造成'))
    expect(dmgEvent).toBeDefined()
    // 草打水：属性一致 + 属性克制应出现在明细中
    expect(dmgEvent!.message).toContain('属性一致')
    expect(dmgEvent!.message).toContain('（')
  })
})
