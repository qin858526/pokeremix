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

const atk = makeMove('tackle', '撞击', Type.Normal, 'physical', 80, 100)
const spAtk = makeMove('echoed-voice', '回声', Type.Normal, 'special', 80, 100)
const leechSeed = makeMove('leech-seed', '寄生种子', Type.Grass, 'status', 0, 90)
const spikes = makeMove('spikes', '撒菱', Type.Ground, 'status', 0, 100)
const stealthRock = makeMove('stealth-rock', '隐形岩', Type.Rock, 'status', 0, 100)
const reflect = makeMove('reflect', '反射壁', Type.Psychic, 'status', 0, 100)
const lightScreen = makeMove('light-screen', '光墙', Type.Psychic, 'status', 0, 100)
const safeguard = makeMove('safeguard', '神秘守护', Type.Normal, 'status', 0, 100)
const poisonPowder = makeMove('poison-powder', '毒粉', Type.Poison, 'status', 0, 90)

describe('寄生种子', () => {
  it('命中后每回合末吸取对方 HP 并回复自身', () => {
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'bulba', nameZh: '妙蛙草',
      baseStats: { hp: 200, attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      types: [Type.Grass, null], ability: makeAbility('overgrow', '茂盛'),
      moves: [leechSeed, atk, atk, atk], currentHp: 200, maxHp: 200,
    })
    const enemy = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 160, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: [atk, atk, atk, atk], currentHp: 160, maxHp: 160,
    })
    const engine = new BattleEngine([player], [enemy], 314)
    const ev = engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
    expect(enemy._abilityData?.leechSeed).toBe(true)
    const drain = Math.floor(160 / 8)
    expect(enemy.currentHp).toBe(160 - drain)
    expect(ev.some(e => e.message.includes('寄生种子吸取了'))).toBe(true)
  })
})

describe('撒钉：撒菱 / 隐形岩', () => {
  it('敌方宝可梦上场时受到撒菱伤害', () => {
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'bulba', nameZh: '妙蛙草',
      baseStats: { hp: 200, attack: 120, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      types: [Type.Grass, null], ability: makeAbility('overgrow', '茂盛'),
      moves: [atk, atk, atk, atk], currentHp: 200, maxHp: 200,
    })
    const enemyDown = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 10, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: [atk, atk, atk, atk], currentHp: 10, maxHp: 10,
    })
    const enemyUp = makePokemon({
      id: 'e2', dexId: 259, name: 'marsh', nameZh: '沼王',
      baseStats: { hp: 180, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: [atk, atk, atk, atk], currentHp: 180, maxHp: 180,
    })
    const engine = new BattleEngine([player], [enemyDown, enemyUp], 271)
    engine.enemyHazards.spikes = 1
    const ev = engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
    expect(engine.enemyActive).toBe(enemyUp)
    expect(engine.enemyActive.currentHp).toBeLessThan(180)
    expect(ev.some(e => e.message.includes('撒菱'))).toBe(true)
  })

  it('隐形岩影响所有属性上场者', () => {
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'bulba', nameZh: '妙蛙草',
      baseStats: { hp: 200, attack: 120, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      types: [Type.Grass, null], ability: makeAbility('overgrow', '茂盛'),
      moves: [atk, atk, atk, atk], currentHp: 200, maxHp: 200,
    })
    const enemyDown = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 10, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: [atk, atk, atk, atk], currentHp: 10, maxHp: 10,
    })
    const enemyUp = makePokemon({
      id: 'e2', dexId: 6, name: 'char', nameZh: '喷火龙',
      baseStats: { hp: 180, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Fire, Type.Flying], ability: makeAbility('blaze', '猛火'),
      moves: [atk, atk, atk, atk], currentHp: 180, maxHp: 180,
    })
    const engine = new BattleEngine([player], [enemyDown, enemyUp], 271)
    engine.enemyHazards.stealthRock = true
    const ev = engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
    expect(engine.enemyActive.currentHp).toBeLessThan(180)
    expect(ev.some(e => e.message.includes('隐形岩'))).toBe(true)
  })
})

describe('反射壁 / 光墙', () => {
  function buildPair(special = false) {
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'bulba', nameZh: '妙蛙草',
      baseStats: { hp: 300, attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      types: [Type.Grass, null], ability: makeAbility('overgrow', '茂盛'),
      moves: [atk, atk, atk, atk], currentHp: 300, maxHp: 300,
    })
    const enemy = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 300, attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: special ? [spAtk, spAtk, spAtk, spAtk] : [atk, atk, atk, atk], currentHp: 300, maxHp: 300,
    })
    return { player, enemy }
  }
  it('反射壁使物理伤害减半', () => {
    const orig = Math.random; Math.random = () => 1 // 锁定随机因子为最大值，确保可复现
    try {
      const a = buildPair(); const b = buildPair()
      const engineA = new BattleEngine([a.player], [a.enemy], 555)
      const engineB = new BattleEngine([b.player], [b.enemy], 555)
      engineB.playerScreens.reflect = 5
      const evA = engineA.executeTurn({ type: 'move', moveIndex: 0 }, engineA.enemyAction())
      const evB = engineB.executeTurn({ type: 'move', moveIndex: 0 }, engineB.enemyAction())
      const dmgA = evA.find(e => e.type === 'damage' && e.targetSide === 'player' && e.message.includes('造成'))!
      const dmgB = evB.find(e => e.type === 'damage' && e.targetSide === 'player' && e.message.includes('造成'))!
      expect(dmgB.message).toContain('反射壁')
      // BattleEvent.damage 是可选字段，伤害事件必定带值，故断言非空
      expect(dmgB.damage).toBeLessThan(dmgA.damage!)
      expect(dmgB.damage).toBeLessThanOrEqual(Math.floor(dmgA.damage! * 0.5) + 1)
    } finally { Math.random = orig }
  })
  it('光墙使特殊伤害减半', () => {
    const orig = Math.random; Math.random = () => 1
    try {
      const a = buildPair(true); const b = buildPair(true)
      const engineA = new BattleEngine([a.player], [a.enemy], 556)
      const engineB = new BattleEngine([b.player], [b.enemy], 556)
      engineB.playerScreens.lightScreen = 5
      const evA = engineA.executeTurn({ type: 'move', moveIndex: 0 }, engineA.enemyAction())
      const evB = engineB.executeTurn({ type: 'move', moveIndex: 0 }, engineB.enemyAction())
      const dmgA = evA.find(e => e.type === 'damage' && e.targetSide === 'player' && e.message.includes('造成'))!
      const dmgB = evB.find(e => e.type === 'damage' && e.targetSide === 'player' && e.message.includes('造成'))!
      expect(dmgB.message).toContain('光墙')
      // BattleEvent.damage 是可选字段，伤害事件必定带值，故断言非空
      expect(dmgB.damage).toBeLessThan(dmgA.damage!)
      expect(dmgB.damage).toBeLessThanOrEqual(Math.floor(dmgA.damage! * 0.5) + 1)
    } finally { Math.random = orig }
  })
})

describe('神秘守护', () => {
  it('阻止对方赋予的异常状态', () => {
    const player = makePokemon({
      id: 'p1', dexId: 1, name: 'bulba', nameZh: '妙蛙草',
      baseStats: { hp: 200, attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 200 },
      types: [Type.Grass, null], ability: makeAbility('overgrow', '茂盛'),
      moves: [safeguard, atk, atk, atk], currentHp: 200, maxHp: 200,
    })
    const enemy = makePokemon({
      id: 'e1', dexId: 258, name: 'mudkip', nameZh: '沼跃鱼',
      baseStats: { hp: 200, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      types: [Type.Water, null], ability: makeAbility('torrent', '激流'),
      moves: [poisonPowder, poisonPowder, poisonPowder, poisonPowder], currentHp: 200, maxHp: 200,
    })
    const engine = new BattleEngine([player], [enemy], 777)
    const ev = engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
    expect(player.status).toBeNull()
    expect(ev.some(e => e.message.includes('神秘守护'))).toBe(true)
  })
})
