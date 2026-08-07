import { writable, get } from 'svelte/store'
import type { RecombinedPokemon, BattleLogEntry } from '../game/data/types'
import { BattleEngine } from '../game/engine/BattleEngine'
import type { TurnEvent } from '../game/engine/BattleEngine'

interface BattleStore {
  playerTeam: RecombinedPokemon[]
  enemyTeam: RecombinedPokemon[]
  playerActive: RecombinedPokemon
  enemyActive: RecombinedPokemon
  turnLog: BattleLogEntry[]
  isAnimating: boolean
  result: 'playing' | 'player_win' | 'enemy_win'
  needsPlayerSwitch: boolean
  engine: BattleEngine | null
}

function createBattleStore() {
  const { subscribe, set, update } = writable<BattleStore>({
    playerTeam: [],
    enemyTeam: [],
    playerActive: null as unknown as RecombinedPokemon,
    enemyActive: null as unknown as RecombinedPokemon,
    turnLog: [],
    isAnimating: false,
    result: 'playing',
    needsPlayerSwitch: false,
    engine: null,
  })

  return {
    subscribe,
    update,
    initBattle: (playerTeam: RecombinedPokemon[], enemyTeam: RecombinedPokemon[], seed: number) => {
      const engine = new BattleEngine(playerTeam, enemyTeam, seed)
      const initEvents = engine.initAbilities()
      update(s => ({
        ...s,
        playerTeam,
        enemyTeam,
        playerActive: engine.playerActive,
        enemyActive: engine.enemyActive,
        turnLog: initEvents.map((e, i) => ({
          turn: i + 1,
          message: e.message,
          type: e.type,
          triggerSource: e.triggerSource,
          triggerSide: e.triggerSide,
        } as BattleLogEntry)),
        isAnimating: false,
        result: 'playing',
        needsPlayerSwitch: false,
        engine,
      }))
    },
    executeTurn: (moveIndex: number) => {
      const state = get({ subscribe })
      if (!state.engine) return
      const engine = state.engine

      const playerAction = { type: 'move' as const, moveIndex }
      const enemyAction = engine.enemyAction()
      const events = engine.executeTurn(playerAction, enemyAction)

      // 执行完回合后由前端 animateEvents 控制时序，不再自动切 isAnimating
      const result = engine.checkBattleEnd()
      update(s => ({
        ...s,
        playerActive: { ...engine.playerActive },
        enemyActive: { ...engine.enemyActive },
        turnLog: [...s.turnLog, ...events.map(e => ({
          turn: s.turnLog.length + 1,
          message: e.message,
          type: e.type,
          triggerSource: e.triggerSource,
          triggerSide: e.triggerSide,
          actionSide: e.actionSide,
        } as BattleLogEntry))],
        isAnimating: true,
        needsPlayerSwitch: engine.needsPlayerSwitch,
        result: result ?? 'playing',
      }))

      return events
    },
    /**
     * 玩家当前可选的招式下标（被挑衅/无理取闹/再来一次/定身法/封锁挡下的招式会被剔除）
     * 引擎无法工作时（未初始化）返回 null 表示「不做限制」。
     */
    legalPlayerMoves: (): number[] | null => {
      const state = get({ subscribe })
      if (!state.engine) return null
      return state.engine.selectableMoveIndices('player')
    },
    /** 某个招式被封锁的原因（可用时返回 null），用于 UI 提示 */
    playerMoveBlockReason: (moveIndex: number): string | null => {
      const state = get({ subscribe })
      if (!state.engine || !state.engine.playerActive) return null
      return state.engine.moveBlockReason(state.engine.playerActive, moveIndex)
    },
    /**
     * 玩家选择替换上场的宝可梦（倒下后的强制换人）
     * 返回换人过程产生的事件（入场陷阱伤害/倒下等），供 UI 播放动画；换人失败返回 undefined。
     */
    switchPokemon: (index: number) => {
      const state = get({ subscribe })
      if (!state.engine) return
      const engine = state.engine
      const ev: TurnEvent[] = []
      const ok = engine.switchPlayer(index, ev)
      if (!ok) return

      // 换上的宝可梦可能被入场陷阱当场击倒，甚至导致整队覆灭：
      // 必须以引擎为准重新读取换人需求 + 重算胜负，否则 UI 会卡在「无面板可用」的死局。
      const result = engine.checkBattleEnd()
      update(s => ({
        ...s,
        playerActive: { ...engine.playerActive },
        turnLog: ev.length ? [...s.turnLog, ...ev.map(e => ({
          turn: s.turnLog.length + 1,
          message: e.message,
          type: e.type,
          triggerSource: e.triggerSource,
          triggerSide: e.triggerSide,
          actionSide: e.actionSide,
        } as BattleLogEntry))] : s.turnLog,
        needsPlayerSwitch: engine.needsPlayerSwitch,
        result: result ?? 'playing',
      }))

      return ev
    },
    /** 战斗中主动换人（消耗当回合行动，敌方照常行动） */
    executeSwitch: (targetIndex: number) => {
      const state = get({ subscribe })
      if (!state.engine) return
      const engine = state.engine

      // 玩家主动换人：换人动作优先执行，敌方正常行动
      const playerAction = { type: 'switch' as const, targetIndex }
      const enemyAction = engine.enemyAction()
      const events = engine.executeTurn(playerAction, enemyAction)

      const result = engine.checkBattleEnd()
      update(s => ({
        ...s,
        playerActive: { ...engine.playerActive },
        enemyActive: { ...engine.enemyActive },
        turnLog: [...s.turnLog, ...events.map(e => ({
          turn: s.turnLog.length + 1,
          message: e.message,
          type: e.type,
          triggerSource: e.triggerSource,
          triggerSide: e.triggerSide,
          actionSide: e.actionSide,
        } as BattleLogEntry))],
        isAnimating: true,
        needsPlayerSwitch: engine.needsPlayerSwitch,
        result: result ?? 'playing',
      }))

      return events
    },
    reset: () => set({
      playerTeam: [],
      enemyTeam: [],
      playerActive: null as unknown as RecombinedPokemon,
      enemyActive: null as unknown as RecombinedPokemon,
      turnLog: [],
      isAnimating: false,
      result: 'playing',
      needsPlayerSwitch: false,
      engine: null,
    }),
  }
}

export const battleStore = createBattleStore()
