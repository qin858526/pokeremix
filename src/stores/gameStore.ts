import { writable, derived, get } from 'svelte/store'
import type { GamePhase, RecombinedPokemon } from '../game/data/types'
import { saveGame, clearSave } from './saveManager'

/** 回满一队宝可梦所有技能的 PP */
function restorePP(team: RecombinedPokemon[]) {
  for (const pkm of team) {
    for (const move of pkm.moves) {
      move.currentPp = move.pp
    }
  }
}

interface GameStore {
  phase: GamePhase
  currentFloor: number
  maxFloors: number
  playerTeam: RecombinedPokemon[]
  seed: number
}

function createGameStore() {
  const store = writable<GameStore>({
    phase: 'title',
    currentFloor: 0,
    maxFloors: 20,
    playerTeam: [],
    seed: Date.now(),
  })

  return {
    subscribe: store.subscribe,
    update: store.update,
    startNewRun: () => {
      clearSave()
      store.update(s => ({
        ...s,
        phase: 'team_select',
        currentFloor: 1,
        seed: Date.now(),
      }))
    },
    loadRun: (seed: number, floor: number, team: RecombinedPokemon[]) => {
      store.set({
        phase: 'battle',
        currentFloor: floor,
        maxFloors: 20,
        playerTeam: team,
        seed,
      })
    },
    setTeam: (team: RecombinedPokemon[]) => {
      restorePP(team)
      store.update(s => {
        saveGame(s.seed, s.currentFloor, team)
        return { ...s, playerTeam: team, phase: 'battle' }
      })
    },
    advanceFloor: () => store.update(s => {
      restorePP(s.playerTeam)
      const nextFloor = s.currentFloor + 1
      if (nextFloor <= s.maxFloors) {
        saveGame(s.seed, nextFloor, s.playerTeam)
      }
      return { ...s, currentFloor: nextFloor, phase: 'battle' }
    }),
    setPhase: (phase: GamePhase) => store.update(s => ({ ...s, phase })),
    endRun: (won: boolean) => {
      clearSave()
      store.update(s => ({
        ...s,
        phase: won ? 'victory' : 'game_over',
      }))
    },
    reset: () => {
      clearSave()
      store.set({
        phase: 'title',
        currentFloor: 0,
        maxFloors: 20,
        playerTeam: [],
        seed: Date.now(),
      })
    },
  }
}

export const gameStore = createGameStore()

export const isBossFloor = derived(gameStore, $game =>
  [5, 10, 15, 20].includes($game.currentFloor),
)
