import { describe, it, expect } from 'vitest'
import { BattleEngine } from './BattleEngine'
import { Type } from '../data/types'
import type { RecombinedPokemon, Move, Ability, Stats, StatStages } from '../data/types'

function makeAbility(name: string, nameZh: string): Ability {
  return { id: 0, name, nameZh, description: '' }
}

function makeMove(
  name: string,
  nameZh: string,
  type: Type,
  category: 'physical' | 'special' | 'status',
  power: number,
  accuracy: number,
): Move {
  return { id: 0, name, nameZh, type, category, power, accuracy, pp: 99, currentPp: 99, priority: 0, description: '' }
}

const neutralStages: StatStages = {
  attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0,
}

function makePokemon(opts: {
  id: string
  dexId: number
  name: string
  nameZh: string
  baseStats: Stats
  types: [Type, Type | null]
  ability: Ability
  moves: [Move, Move, Move, Move]
  currentHp: number
  maxHp: number
}): RecombinedPokemon {
  return {
    id: opts.id,
    dexId: opts.dexId,
    name: opts.name,
    nameZh: opts.nameZh,
    baseStats: opts.baseStats,
    types: opts.types,
    ability: opts.ability,
    moves: opts.moves,
    currentHp: opts.currentHp,
    maxHp: opts.maxHp,
    status: null,
    statStages: { ...neutralStages },
    fainted: false,
    _abilityData: {},
  }
}

describe('回合内倒下顺序：先手击杀后对方当回合不行动', () => {
  it('玩家先手用草系击杀沼跃鱼，沼跃鱼不应再攻击', () => {
    const grassMove = makeMove('grass-knot', '打草结', Type.Grass, 'special', 120, 100)
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'bulba', nameZh: '妙蛙草',
      baseStats: { hp: 200, attack: 100, defense: 100, spAttack: 150, spDefense: 100, speed: 200 },
      types: [Type.Grass, null],
      ability: makeAbility('overgrow', '茂盛'),
      moves: [grassMove, grassMove, grassMove, grassMove],
      currentHp: 200, maxHp: 200,
    })

    const enemyMove = makeMove('tackle', '撞击', Type.Normal, 'physical', 40, 100)
    const mudkip = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 1, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null],
      ability: makeAbility('torrent', '激流'),
      moves: [enemyMove, enemyMove, enemyMove, enemyMove],
      currentHp: 1, maxHp: 1,
    })
    const backup = makePokemon({
      id: 'e2', dexId: 259, name: 'marshtomp', nameZh: '沼帽怪',
      baseStats: { hp: 100, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, Type.Ground],
      ability: makeAbility('torrent', '激流'),
      moves: [enemyMove, enemyMove, enemyMove, enemyMove],
      currentHp: 100, maxHp: 100,
    })

    const engine = new BattleEngine([player], [mudkip, backup], 12345)
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)

    // 沼跃鱼已倒下并且被替换为替补
    expect(mudkip.fainted).toBe(true)
    expect(engine.enemyActive.nameZh).toBe('沼帽怪')

    // 关键断言：已倒下的沼跃鱼没有发动攻击（不应出现“沼跃鱼 使用了 …”）
    const enemyAttacked = events.some(e => e.message.includes('沼跃鱼 使用了'))
    expect(enemyAttacked).toBe(false)

    // 玩家未受到来自沼跃鱼的伤害（玩家 HP 应保持不变）
    expect(player.currentHp).toBe(200)
  })

  it('正常回合双方都未倒下时，后攻方仍正常行动', () => {
    const grassMove = makeMove('grass-knot', '打草结', Type.Grass, 'special', 10, 100)
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'bulba', nameZh: '妙蛙草',
      baseStats: { hp: 200, attack: 100, defense: 100, spAttack: 150, spDefense: 100, speed: 200 },
      types: [Type.Grass, null],
      ability: makeAbility('overgrow', '茂盛'),
      moves: [grassMove, grassMove, grassMove, grassMove],
      currentHp: 200, maxHp: 200,
    })

    const enemyMove = makeMove('tackle', '撞击', Type.Normal, 'physical', 40, 100)
    const enemy = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 200, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null],
      ability: makeAbility('torrent', '激流'),
      moves: [enemyMove, enemyMove, enemyMove, enemyMove],
      currentHp: 200, maxHp: 200,
    })

    const engine = new BattleEngine([player], [enemy], 999)
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)

    // 双方都存活，敌方（后攻）应正常出手
    expect(enemy.fainted).toBe(false)
    const enemyAttacked = events.some(e => e.message.includes('沼跃鱼 使用了'))
    expect(enemyAttacked).toBe(true)

    // 玩家受到了敌方攻击伤害
    expect(player.currentHp).toBeLessThan(200)
  })
})
