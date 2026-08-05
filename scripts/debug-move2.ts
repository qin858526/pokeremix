/* 完整流程技能释放测试 v2：node --import tsx scripts/debug-move2.ts */
import { BattleEngine } from '../src/game/engine/BattleEngine'
import { generateEnemyTeam } from '../src/game/factory/TeamGenerator'
import { RecombineFactory } from '../src/game/factory/RecombineFactory'
import { gameStore } from '../src/stores/gameStore'
import { get } from 'svelte/store'

function main() {
  // ===== 1. 模拟 TeamSelect：生成初始队伍并 setTeam =====
  const factory = new RecombineFactory(12345)
  const candidates = factory.generateInitialTeam(6)
  const playerTeam = candidates.slice(0, 3) // 选 3 只
  console.log('=== 玩家队伍（选 3） ===')
  playerTeam.forEach(p => console.log(`  ${p.name} hp=${p.currentHp}/${p.maxHp} 招式=[${p.moves.map(m=>m.name).join(', ')}]`))

  gameStore.setTeam(playerTeam)
  console.log('\n=== setTeam 后 gameStore ===')
  console.log('phase:', get(gameStore).phase)
  console.log('playerTeam 长度:', get(gameStore).playerTeam.length)

  // ===== 2. 模拟 Battle onMount：initBattle =====
  const seed = get(gameStore).seed
  const enemy = generateEnemyTeam(seed + 1, false)
  const engine = new BattleEngine(playerTeam, enemy, seed + 2)
  engine.initAbilities()

  console.log('\n=== 引擎初始化 ===')
  console.log('playerActive:', engine.playerActive.name, 'hp', engine.playerActive.currentHp)
  console.log('enemyActive:', engine.enemyActive.name, 'hp', engine.enemyActive.currentHp)
  console.log('playerActive.moves:', engine.playerActive.moves.map(m => `${m.name}(PP ${m.currentPp})`).join(', '))

  // ===== 3. 释放技能 =====
  console.log('\n=== 释放技能（第 1 招） ===')
  const moveIdx = 0
  const playerAction = { type: 'move' as const, moveIndex: moveIdx }
  const enemyAction = engine.enemyAction()
  console.log('敌方行动:', JSON.stringify(enemyAction))

  const events = engine.executeTurn(playerAction, enemyAction)
  console.log('返回 events 数量:', events?.length ?? 0)
  events?.forEach((e, i) => console.log(`  [${i}] type=${e.type} msg=${e.message}`))

  // ===== 4. 释放技能（第 2 招） =====
  console.log('\n=== 释放技能（第 2 招） ===')
  const playerAction2 = { type: 'move' as const, moveIndex: 1 }
  const enemyAction2 = engine.enemyAction()
  const events2 = engine.executeTurn(playerAction2, enemyAction2)
  console.log('返回 events2 数量:', events2?.length ?? 0)
  events2?.forEach((e, i) => console.log(`  [${i}] type=${e.type} msg=${e.message}`))

  if (!events || events.length === 0 || !events2 || events2.length === 0) {
    console.log('\n❌ 引擎在正常流程下返回空 events！这是真 bug')
  } else {
    console.log('\n✅ 完整流程（选队→开战→放技能×2）引擎全部有返回 —— 引擎层正常，问题在前端渲染/动画层')
  }
}

main()
