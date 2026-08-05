import { SeededRandom } from '../../utils/random'
import { SPECIES_DB, getRandomSpecies, createPokemonInstance } from '../data/pokemon'
import { getRandomMoves } from '../data/moves'
import { getRandomAbility } from '../data/abilities'
import { Type } from '../data/types'
import type { RecombinedPokemon } from '../data/types'

const ALL_TYPES = Object.values(Type)

/**
 * 重组工厂：保留种族值底座，随机打乱属性/特性/技能
 */
export class RecombineFactory {
  private rng: SeededRandom

  constructor(seed: number) {
    this.rng = new SeededRandom(seed)
  }

  /** 从全图鉴中随机抽 N 只不重复的宝可梦，全部完全重组 */
  generateInitialTeam(count: number): RecombinedPokemon[] {
    const pool = this.rng.shuffle([...SPECIES_DB])
    return pool.slice(0, count).map(s => this.recombine(s))
  }

  /** 随机抽取一只宝可梦并完全重组 */
  generateRandomPokemon(): RecombinedPokemon {
    const species = getRandomSpecies()
    return this.recombine(species)
  }

  /** 对一只宝可梦执行完全随机重组 */
  recombine(species: typeof SPECIES_DB[0]): RecombinedPokemon {
    const type1 = this.rng.pick(ALL_TYPES)
    const type2 = this.rng.next() < 0.5 ? this.rng.pick(ALL_TYPES.filter(t => t !== type1)) : null
    const types: [Type, Type | null] = [type1, type2]

    const moves = getRandomMoves(4) as [RecombinedPokemon['moves'][0], RecombinedPokemon['moves'][1], RecombinedPokemon['moves'][2], RecombinedPokemon['moves'][3]]
    const ability = getRandomAbility()

    return createPokemonInstance(species, moves, ability)
  }
}
