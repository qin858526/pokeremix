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
    status: null, statStages: { ...neutralStages }, fainted: false, weightKg: 0, gender: 'male', _abilityData: {},
  }
}

describe('反伤类技能归因', () => {
  it('疯狂伏特反伤应扣使用者（玩家）的血，而非敌方', () => {
    const wildCharge = makeMove('wild-charge', '疯狂伏特', Type.Electric, 'physical', 90, 100)
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'pika', nameZh: '皮卡丘',
      baseStats: { hp: 200, attack: 180, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      types: [Type.Electric, null], ability: makeAbility('static', '静电'),
      moves: [wildCharge, wildCharge, wildCharge, wildCharge], currentHp: 200, maxHp: 200,
    })
    // 敌方高血量，确保不会被一击打倒，便于单独验证反伤
    const enemy = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 300, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: [wildCharge, wildCharge, wildCharge, wildCharge], currentHp: 300, maxHp: 300,
    })

    const engine = new BattleEngine([player], [enemy], 777)
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)

    // 1) 逻辑上：玩家受到反伤，HP 下降
    expect(player.currentHp).toBeLessThan(200)
    // 2) 反伤事件的承受方必须是使用者（玩家），不能算到敌方
    const recoil = events.find(e => e.message.includes('反伤'))
    expect(recoil).toBeDefined()
    expect(recoil!.targetSide).toBe('player')
    // 3) 主伤害事件承受方是敌方
    const mainDmg = events.find(e => e.type === 'damage' && e.message.includes('造成'))
    expect(mainDmg).toBeDefined()
    expect(mainDmg!.targetSide).toBe('enemy')
    // 4) 敌方掉血（主伤害），玩家掉血（反伤），互不相等
    expect(enemy.currentHp).toBeLessThan(300)
  })

  it('敌方使用反伤技能时，反伤归因到敌方', () => {
    const wildCharge = makeMove('wild-charge', '疯狂伏特', Type.Electric, 'physical', 90, 100)
    const player = makePokemon({
      id: 'p1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 300, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: [wildCharge, wildCharge, wildCharge, wildCharge], currentHp: 300, maxHp: 300,
    })
    const enemy = makePokemon({
      id: 'e1', dexId: 1, name: 'pika', nameZh: '皮卡丘',
      baseStats: { hp: 200, attack: 180, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      types: [Type.Electric, null], ability: makeAbility('static', '静电'),
      moves: [wildCharge, wildCharge, wildCharge, wildCharge], currentHp: 200, maxHp: 200,
    })

    const engine = new BattleEngine([player], [enemy], 778)
    // 玩家用普通招式，敌方（isPlayer=false）用疯狂伏特
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })

    const recoil = events.find(e => e.message.includes('反伤'))
    expect(recoil).toBeDefined()
    expect(recoil!.targetSide).toBe('enemy')
    expect(enemy.currentHp).toBeLessThan(200)
  })
})

describe('天气：雪景', () => {
  it('使用雪景后天气应变为冰雹', () => {
    const snowscape = makeMove('snowscape', '雪景', Type.Ice, 'status', 0, 100)
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'abuli', nameZh: '阿勃梭鲁',
      baseStats: { hp: 200, attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      types: [Type.Dark, null], ability: makeAbility('pressure', '压迫感'),
      moves: [snowscape, snowscape, snowscape, snowscape], currentHp: 200, maxHp: 200,
    })
    const enemy = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 200, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: [snowscape, snowscape, snowscape, snowscape], currentHp: 200, maxHp: 200,
    })

    const engine = new BattleEngine([player], [enemy], 779)
    const enemyAction = engine.enemyAction()
    engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)

    expect(engine.weather).toBe('hail')
  })
})
