// 验证免疫/克制事件的实际事件流，用于设计揭示逻辑
import { BattleEngine } from '../src/game/engine/BattleEngine'
import { SPECIES_DB, createPokemonInstance } from '../src/game/data/pokemon'
import { MOVE_DB, getMoveByName } from '../src/game/data/moves'
import { ABILITY_DB, getAbilityByName } from '../src/game/data/abilities'

// 我方：普通系技能（撞击）打幽灵系（免疫）
// 敌方：鬼斯通（幽灵）
function makePlayer(indices: number): any[] {
  return indices.map(i => {
    const spec = SPECIES_DB[i]
    const moves = [
      getMoveByName('tackle') ?? MOVE_DB[0],      // 普通系
      getMoveByName('ember') ?? MOVE_DB[2],        // 火系
      getMoveByName('water-gun') ?? MOVE_DB[3],    // 水系
      getMoveByName('thunder-shock') ?? MOVE_DB[4],// 电系
    ]
    const ability = getAbilityByName('overgrow') ?? ABILITY_DB[0]
    return createPokemonInstance(spec, moves, ability)
  })
}
function makeEnemy(indices: number): any[] {
  return indices.map(i => {
    const spec = SPECIES_DB[i]
    const moves = [
      getMoveByName('tackle') ?? MOVE_DB[0],
      getMoveByName('ember') ?? MOVE_DB[2],
      getMoveByName('water-gun') ?? MOVE_DB[3],
      getMoveByName('thunder-shock') ?? MOVE_DB[4],
    ]
    const ability = getAbilityByName('levitate') ?? ABILITY_DB[0]
    return createPokemonInstance(spec, moves, ability)
  })
}

// 找幽灵系宝可梦
const ghostIdx = SPECIES_DB.findIndex(s => s.types[0] === 'ghost' || s.types[1] === 'ghost')
console.log('幽灵系宝可梦索引:', ghostIdx, ghostIdx >= 0 ? SPECIES_DB[ghostIdx].nameZh : '')

const playerTeam = makePlayer([0])   // 妙蛙种子
const enemyTeam = makeEnemy([ghostIdx >= 0 ? ghostIdx : 92]) // 幽灵系

const engine = new BattleEngine(playerTeam, enemyTeam, 999)
engine.initAbilities()

console.log('\n敌方:', engine.enemyActive.nameZh, engine.enemyActive.types)

// 玩家用技能 0（撞击，普通系）→ 对幽灵免疫
console.log('\n=== 玩家使用 撞击（普通系）打幽灵 ===')
const events = engine.executeTurn({ type: 'move', moveIndex: 0 }, engine.enemyAction())
for (const e of events) {
  console.log(`  [${e.type}] actionSide=${e.actionSide ?? '-'} ${e.message}`)
}

// 玩家用技能 1（火花，火系）→ 正常伤害
console.log('\n=== 玩家使用 火花（火系）打幽灵 ===')
const events2 = engine.executeTurn({ type: 'move', moveIndex: 1 }, engine.enemyAction())
for (const e of events2) {
  console.log(`  [${e.type}] actionSide=${e.actionSide ?? '-'} ${e.message}`)
}
