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

const fireMove = makeMove('ember', '火花', Type.Fire, 'special', 40, 100)
const tackle = makeMove('tackle', '撞击', Type.Normal, 'physical', 35, 100)
const playerFire = makePokemon({
  ability: makeAbility('none', '无'), types: [Type.Fire, null],
  atk: 100, def: 100, move: fireMove,
})

describe('魔法防守', () => {
  it('免疫回合末的中毒伤害', () => {
    const poisoned = makePokemon({
      ability: makeAbility('magic-guard', '魔法防守'), types: [Type.Normal, null],
      atk: 100, def: 100, move: tackle,
    })
    poisoned.status = 'poison'
    const enemy = makePokemon({
      ability: makeAbility('none', '无'), types: [Type.Normal, null],
      atk: 100, def: 100, move: tackle,
    })
    const engine = new BattleEngine([poisoned], [enemy], 777)
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)
    // 中毒 tick 应被魔法防守免疫，日志中不应出现“中毒，受到了”
    expect(events.some(e => e.message.includes('中毒，受到了'))).toBe(false)
    // 满血（仅受敌方直接攻击伤害，但敌方用低威力招式且不被一击，这里只看异常伤害被免疫）
  })
})

describe('神奇守护', () => {
  it('非效果绝佳的招式没有效果', () => {
    const enemy = makePokemon({
      ability: makeAbility('wonder-guard', '神奇守护'), types: [Type.Normal, null],
      atk: 100, def: 100, move: tackle,
    })
    const engine = new BattleEngine([playerFire], [enemy], 778)
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)
    expect(enemy.currentHp).toBe(enemy.maxHp)
    expect(events.some(e => e.message.includes('没有效果（神奇守护）'))).toBe(true)
  })

  it('效果绝佳的招式正常造成伤害', () => {
    const enemy = makePokemon({
      ability: makeAbility('wonder-guard', '神奇守护'), types: [Type.Grass, null],
      atk: 100, def: 100, move: tackle,
    })
    const engine = new BattleEngine([playerFire], [enemy], 779)
    const enemyAction = engine.enemyAction()
    const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, enemyAction)
    expect(enemy.currentHp).toBeLessThan(enemy.maxHp)
  })
})
