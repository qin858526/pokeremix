import { SPECIES_DB, createPokemonInstance } from '../data/pokemon'
import { ABILITY_DB } from '../data/abilities'
import { MOVE_DB } from '../data/moves'
import type { RecombinedPokemon, Move } from '../data/types'
import { SeededRandom } from '../../utils/random'

/**
 * 计算种族值总和
 */
function totalBST(species: typeof SPECIES_DB[0]): number {
  const s = species.baseStats
  return s.hp + s.attack + s.defense + s.spAttack + s.spDefense + s.speed
}

/** 按种族值排序的物种列表（从弱到强） */
const SORTED_SPECIES = [...SPECIES_DB].sort((a, b) => totalBST(a) - totalBST(b))

/**
 * 根据楼层数生成敌方队伍
 * @param boss true = Boss 战，使用更强宝可梦
 */
export function generateEnemyTeam(seed: number, boss: boolean = false): RecombinedPokemon[] {
  const rng = new SeededRandom(seed)

  // Boss 战的从种值最高的 50% 中选取；普通战从全部中平均选取
  const poolStart = boss ? Math.floor(SORTED_SPECIES.length / 2) : 2
  const pool = SORTED_SPECIES.slice(poolStart)
  const shuffled = rng.shuffle([...pool])

  // Boss 战给 4 只（第 20 层给 4 只），普通战给 3 只
  const count = boss ? 4 : 3
  const species = shuffled.slice(0, count)

  return species.map(s => {
    const ability = rng.pick(ABILITY_DB)
    // Boss 战优先选攻击类技能
    let moves: Move[]
    if (boss) {
      const attackMoves = rng.shuffle([...MOVE_DB].filter(m => m.category !== 'status'))
      moves = attackMoves.slice(0, 4)
      // 如果攻击技能不够 4 个，补 status 技能
      if (moves.length < 4) {
        const statusMoves = rng.shuffle([...MOVE_DB].filter(m => m.category === 'status'))
        moves = [...moves, ...statusMoves.slice(0, 4 - moves.length)]
      }
    } else {
      moves = rng.shuffle([...MOVE_DB]).slice(0, 4)
    }

    // 补齐到 4 个
    while (moves.length < 4) {
      moves.push(rng.pick(MOVE_DB))
    }

    return createPokemonInstance(s, moves.slice(0, 4) as [Move, Move, Move, Move], ability)
  })
}

/** 兼容旧函数名 */
export const generateDemoEnemyTeam = generateEnemyTeam
