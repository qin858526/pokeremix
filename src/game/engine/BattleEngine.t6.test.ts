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
  move: Move; nameZh?: string; def?: number; spDef?: number; status?: any;
}): RecombinedPokemon {
  const stats: Stats = {
    hp: 200, attack: 100, defense: opts.def ?? 100,
    spAttack: 100, spDefense: opts.spDef ?? 100, speed: 100,
  }
  return {
    id: 'x', dexId: 1, name: 'x', nameZh: opts.nameZh ?? 'x',
    baseStats: stats, types: opts.types, ability: opts.ability,
    moves: [opts.move, opts.move, opts.move, opts.move],
    currentHp: 200, maxHp: 200, status: opts.status ?? null,
    statStages: { ...neutralStages }, fainted: false, _abilityData: {},
  }
}

const phys = makeMove('tackle', '撞击', Type.Normal, 'physical', 60, 100)
const darkMove = makeMove('bite', '咬住', Type.Dark, 'physical', 60, 100)
const bugMove = makeMove('bug-bite', '虫咬', Type.Bug, 'physical', 60, 100)
const none = makeAbility('none', '无')

function engineWith(pAbility: Ability, eAbility: Ability) {
  const p = makePokemon({ ability: pAbility, types: [Type.Normal, null], move: phys, nameZh: '我方' })
  const e = makePokemon({ ability: eAbility, types: [Type.Normal, null], move: phys, nameZh: '敌方' })
  return { engine: new BattleEngine([p], [e], 42) as any, p, e }
}

describe('T6：能力等级变化类', () => {
  it('唱反调：提升变降低、降低变提升', () => {
    const { engine, p } = engineWith(makeAbility('contrary', '唱反调'), none)
    engine.raiseStat(p, 'attack', 2)
    expect(p.statStages.attack).toBe(-2)
    p.statStages.defense = 0
    engine.lowerStat(p, 'defense', 1)
    expect(p.statStages.defense).toBe(1)
  })

  it('单纯：能力变化翻倍', () => {
    const { engine, p } = engineWith(makeAbility('simple', '单纯'), none)
    engine.raiseStat(p, 'attack', 1)
    expect(p.statStages.attack).toBe(2)
    engine.lowerStat(p, 'speed', 1)
    expect(p.statStages.speed).toBe(-2)
  })

  it('健壮胸肌：防御不会被降低（其它能力照常降低）', () => {
    const { engine, p } = engineWith(makeAbility('big-pecks', '健壮胸肌'), none)
    engine.lowerStat(p, 'defense', 2)
    expect(p.statStages.defense).toBe(0)
    engine.lowerStat(p, 'attack', 2)
    expect(p.statStages.attack).toBe(-2)
  })
})

describe('T6：入场特性', () => {
  it('复制：入场复制对方特性', () => {
    const { engine, p } = engineWith(makeAbility('trace', '复制'), makeAbility('levitate', '飘浮'))
    const msg = engine.applyOnSwitchAbility(p, false)
    expect(p.ability.name).toBe('levitate')
    expect(msg).toContain('复制')
  })

  it('下载：对方特防更高则提升特攻', () => {
    const p = makePokemon({ ability: makeAbility('download', '下载'), types: [Type.Normal, null], move: phys })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, def: 50, spDef: 150 })
    const engine = new BattleEngine([p], [e], 42) as any
    engine.applyOnSwitchAbility(p, false)
    expect(p.statStages.spAttack).toBe(1)
    expect(p.statStages.attack).toBe(0)
  })

  it('下载：对方防御更高则提升攻击', () => {
    const p = makePokemon({ ability: makeAbility('download', '下载'), types: [Type.Normal, null], move: phys })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, def: 150, spDef: 50 })
    const engine = new BattleEngine([p], [e], 42) as any
    engine.applyOnSwitchAbility(p, false)
    expect(p.statStages.attack).toBe(1)
    expect(p.statStages.spAttack).toBe(0)
  })

  it('预知梦：提示对方威力最高的招式', () => {
    const p = makePokemon({ ability: makeAbility('forewarn', '预知梦'), types: [Type.Normal, null], move: phys })
    const e = makePokemon({ ability: none, types: [Type.Normal, null], move: phys })
    e.moves = [phys, makeMove('hyper-beam', '破坏光线', Type.Normal, 'special', 150, 90)]
    const engine = new BattleEngine([p], [e], 42) as any
    const msg = engine.applyOnSwitchAbility(p, false)
    expect(msg).toContain('破坏光线')
  })
})

describe('T6：伤害与受击反应', () => {
  it('强行：非变化招式威力 ×1.3', () => {
    const orig = Math.random; Math.random = () => 0.5
    try {
      const plain = makePokemon({ ability: none, types: [Type.Normal, null], move: phys })
      const sf = makePokemon({ ability: makeAbility('sheer-force', '强行'), types: [Type.Normal, null], move: phys })
      const def = makePokemon({ ability: none, types: [Type.Normal, null], move: phys })
      const rng = () => 0.5
      const a = calculateDamage(plain, def, phys, 'none', rng).damage
      const b = calculateDamage(sf, def, phys, 'none', rng).damage
      expect(b).toBeGreaterThan(a)
      expect(b).toBeLessThanOrEqual(Math.floor(a * 1.3) + 1)
    } finally { Math.random = orig }
  })

  it('愤怒穴位：被会心一击后攻击拉满到 +6', () => {
    const { engine, e } = engineWith(none, makeAbility('anger-point', '愤怒穴位'))
    const events: any[] = []
    engine.applyDefenderHitAbilities(e, phys, events, true, true)
    expect(e.statStages.attack).toBe(6)
  })

  it('正义之心：被恶系招式命中攻击 +1', () => {
    const { engine, e } = engineWith(none, makeAbility('justified', '正义之心'))
    const events: any[] = []
    engine.applyDefenderHitAbilities(e, darkMove, events, true, false)
    expect(e.statStages.attack).toBe(1)
    // 非恶系不触发
    engine.applyDefenderHitAbilities(e, phys, events, true, false)
    expect(e.statStages.attack).toBe(1)
  })

  it('碎裂铠甲：受物理攻击防御 -1、速度 +1', () => {
    const { engine, e } = engineWith(none, makeAbility('weak-armor', '碎裂铠甲'))
    const events: any[] = []
    engine.applyDefenderHitAbilities(e, phys, events, true, false)
    expect(e.statStages.defense).toBe(-1)
    expect(e.statStages.speed).toBe(1)
  })

  it('胆怯：被虫/恶/幽灵系命中速度 +1', () => {
    const { engine, e } = engineWith(none, makeAbility('rattled', '胆怯'))
    const events: any[] = []
    engine.applyDefenderHitAbilities(e, bugMove, events, true, false)
    expect(e.statStages.speed).toBe(1)
  })
})

describe('T6：天气联动与状态免疫', () => {
  it('太阳之力：晴天回合末损失 1/8 最大 HP', () => {
    const { engine, p } = engineWith(makeAbility('solar-power', '太阳之力'), none)
    engine.weather = 'sun'
    const events: any[] = []
    engine.applyEndOfTurnField(events)
    expect(p.currentHp).toBe(200 - 25)
  })

  it('湿润之躯：雨天回合末治愈异常状态', () => {
    const { engine, p } = engineWith(makeAbility('hydration', '湿润之躯'), none)
    p.status = 'burn'
    engine.weather = 'rain'
    const events: any[] = []
    engine.applyEndOfTurnField(events)
    expect(p.status).toBeNull()
  })

  it('叶子防守：晴天免疫异常状态', () => {
    const { engine, p } = engineWith(makeAbility('leaf-guard', '叶子防守'), none)
    engine.weather = 'sun'
    const events: any[] = []
    expect(engine.inflictStatus(p, 'burn', events)).toBe(false)
    expect(p.status).toBeNull()
    // 非晴天正常中招
    engine.weather = 'none'
    expect(engine.inflictStatus(p, 'burn', events)).toBe(true)
  })
})

describe('T6：换人封锁与命中判定', () => {
  it('踩影：对方无法换人', () => {
    const p1 = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'A' })
    const p2 = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'B' })
    const e = makePokemon({ ability: makeAbility('shadow-tag', '踩影'), types: [Type.Normal, null], move: phys })
    const engine = new BattleEngine([p1, p2], [e], 42) as any
    const events: any[] = []
    expect(engine.switchPlayer(1, events)).toBe(false)
    expect(events[0].message).toContain('踩影')
  })

  it('沙穴：地面系（非飞行/飘浮）无法换人，飞行系可换', () => {
    const ground = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'A' })
    const bench = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'B' })
    const e = makePokemon({ ability: makeAbility('arena-trap', '沙穴'), types: [Type.Normal, null], move: phys })
    const engine = new BattleEngine([ground, bench], [e], 42) as any
    expect(engine.switchPlayer(1, [])).toBe(false)

    const flyer = makePokemon({ ability: none, types: [Type.Flying, null], move: phys, nameZh: 'F' })
    const engine2 = new BattleEngine([flyer, bench], [e], 42) as any
    expect(engine2.switchPlayer(1, [])).toBe(true)
  })

  it('磁力：钢系无法换人', () => {
    const steel = makePokemon({ ability: none, types: [Type.Steel, null], move: phys, nameZh: 'S' })
    const bench = makePokemon({ ability: none, types: [Type.Normal, null], move: phys, nameZh: 'B' })
    const e = makePokemon({ ability: makeAbility('magnet-pull', '磁力'), types: [Type.Normal, null], move: phys })
    const engine = new BattleEngine([steel, bench], [e], 42) as any
    expect(engine.switchPlayer(1, [])).toBe(false)
  })

  it('胆量：普通系招式可命中幽灵系', () => {
    const scrappy = makePokemon({ ability: makeAbility('scrappy', '胆量'), types: [Type.Normal, null], move: phys })
    const plain = makePokemon({ ability: none, types: [Type.Normal, null], move: phys })
    const ghost = makePokemon({ ability: none, types: [Type.Ghost, null], move: phys })
    const engine = new BattleEngine([scrappy], [ghost], 42) as any
    expect(engine.isImmuneToMove(phys, ghost, plain)).toBe(true)
    expect(engine.isImmuneToMove(phys, ghost, scrappy)).toBe(false)
  })
})
