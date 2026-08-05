import type { RecombinedPokemon } from '../game/data/types'

const SAVE_KEY = 'pokeremix_save'
const SAVE_VERSION = 1

export interface SaveData {
  version: number
  timestamp: number
  seed: number
  currentFloor: number
  playerTeam: RecombinedPokemon[]
}

/** 保存游戏 */
export function saveGame(seed: number, floor: number, team: RecombinedPokemon[]): void {
  try {
    const data: SaveData = {
      version: SAVE_VERSION,
      timestamp: Date.now(),
      seed,
      currentFloor: floor,
      playerTeam: team,
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    // 存储空间不足时静默失败
  }
}

/** 读取存档，不存在返回 null */
export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SaveData
    if (data.version !== SAVE_VERSION) {
      clearSave()
      return null
    }
    return data
  } catch {
    clearSave()
    return null
  }
}

/** 清除存档 */
export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY)
}

/** 检查是否存在有效存档 */
export function hasSave(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw) as SaveData
    return data.version === SAVE_VERSION
  } catch {
    return false
  }
}
