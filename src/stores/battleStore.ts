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
    /** 玩家选择替换上场的宝可梦 */
    switchPokemon: (index: number) => {
      const state = get({ subscribe })
      if (!state.engine) return
      const ev: TurnEvent[] = []
      const ok = state.engine.switchPlayer(index, ev)
      if (ok) {
        update(s => ({
          ...s,
          playerActive: { ...state.engine!.playerActive },
          turnLog: ev.length ? [...s.turnLog, ...ev.map(e => ({
            turn: s.turnLog.length + 1,
            message: e.message,
            type: e.type,
            triggerSource: e.triggerSource,
            triggerSide: e.triggerSide,
            actionSide: e.actionSide,
          } as BattleLogEntry))] : s.turnLog,
          needsPlayerSwitch: false,
        }))
      }
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
