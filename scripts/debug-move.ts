/* 引擎技能释放调试：node --import tsx scripts/debug-move.ts */
import { BattleEngine } from '../src/game/engine/BattleEngine'
import { generateEnemyTeam } from '../src/game/factory/TeamGenerator'
import { gameStore } from '../src/stores/gameStore'
import { get } from 'svelte/store'

function main() {
  // 模拟 Battle.svelte onMount 流程
  const game = get(gameStore)
  console.log('=== gameStore 状态 ===')
  console.log('seed:', game?.seed)
  console.log('currentFloor:', game?.currentFloor)
  console.log('playerTeam:', game?.playerTeam?.map(p => p.name), '长度:', game?.playerTeam?.length)
  console.log('phase:', game?.phase)

  const seed = game?.seed ?? Date.now()
  const playerTeam = game?.playerTeam ?? []
  const boss = [5, 10, 15, 20].includes(game?.currentFloor ?? 0)
  const enemy = generateEnemyTeam(seed + 1, boss)

  console.log('\n=== 生成的敌方队伍 ===')
  console.log(enemy.map(p => `${p.name} hp=${p.currentHp}/${p.maxHp} moves=${p.moves.map(m=>m.name).join(',')}`))

  if (!playerTeam || playerTeam.length === 0) {
    console.log('\n❌ 玩家队伍为空！这就是「点技能没反应」的根因：playerTeam 为空，引擎初始化为空队')
    console.log('   Battle.svelte:148  const playerTeam = game?.playerTeam ?? []')
    console.log('   gameStore 里没有 playerTeam 数据')
    return
  }

  console.log('\n=== 玩家队伍 ===')
  console.log(playerTeam.map(p => `${p.name} hp=${p.currentHp}/${p.maxHp} moves=${p.moves.map(m=>m.name).join(',')}`))

  const engine = new BattleEngine(playerTeam, enemy, seed + 2)
  engine.initAbilities()

  console.log('\n=== 释放技能测试 ===')
  const moveIdx = 0
  const playerAction = { type: 'move' as const, moveIndex: moveIdx }
  const enemyAction = engine.enemyAction()
  console.log('敌方行动:', JSON.stringify(enemyAction))

  const events = engine.executeTurn(playerAction, enemyAction)
  console.log('返回 events 数量:', events?.length ?? 0)
  events?.forEach((e, i) => console.log(`  [${i}] ${e.type}: ${e.message}`))

  if (!events || events.length === 0) {
    console.log('\n❌ 引擎返回空 events —— useMove 里 return，UI 无反应')
  } else {
    console.log('\n✅ 引擎有返回，UI 应该能响应 —— 问题在别处（动画/渲染层）')
  }
}

main()
