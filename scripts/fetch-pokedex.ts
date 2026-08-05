/**
 * 从 PokeAPI 抓取真实宝可梦数据（含中文名），生成 TypeScript 数据文件
 * 运行: npx tsx scripts/fetch-pokedex.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../src/game/data')

const POKEAPI = 'https://pokeapi.co/api/v2'
const DELAY_MS = 100
const BATCH_SIZE = 5 // 并行批次大小
const BATCH_DELAY = 200 // 批次间延迟 ms

const TARGET_SPECIES = 386
const TARGET_MOVES = 400
const TARGET_ABILITIES = 150

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchJSON(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (i === retries - 1) throw e
      await delay(1000 * (i + 1))
    }
  }
}

/** 从 PokeAPI 的 names 数组中提取简体中文名 */
function getNameZh(names: { name: string; language: { name: string } }[]): string {
  const zh = names.find(n => n.language.name === 'zh-hans')
  if (zh) return zh.name
  const zhHant = names.find(n => n.language.name === 'zh-hant')
  return zhHant?.name ?? ''
}

// ========== 1. 拉取宝可梦 ==========

interface PokemonRaw {
  id: number
  name: string
  nameZh: string
  types: { type: { name: string } }[]
  stats: { base_stat: number; stat: { name: string } }[]
  abilities: { ability: { name: string; url: string }; is_hidden: boolean }[]
  moves: { move: { name: string; url: string } }[]
}

async function fetchPokemonList(limit: number): Promise<PokemonRaw[]> {
  console.log(`Fetching ${limit} Pokemon...`)
  const list = await fetchJSON(`${POKEAPI}/pokemon?limit=${limit}&offset=0`)
  const results: PokemonRaw[] = []
  for (let i = 0; i < list.results.length; i += BATCH_SIZE) {
    const batch = list.results.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (item: { url: string }) => {
        const detail = await fetchJSON(item.url) as any
        let nameZh = ''
        try {
          const species = await fetchJSON(detail.species.url)
          nameZh = getNameZh(species.names)
        } catch {}
        return { ...detail, nameZh }
      })
    )
    for (const r of batchResults) {
      results.push(r)
      process.stdout.write(`  [${results.length}/${limit}] ${r.name} → ${r.nameZh || '-'}\n`)
    }
    await delay(BATCH_DELAY)
  }
  return results
}

// ========== 2. 拉取技能 ==========

interface MoveRaw {
  id: number
  name: string
  nameZh: string
  names: { name: string; language: { name: string } }[]
  type: { name: string }
  damage_class: { name: string }
  power: number | null
  accuracy: number | null
  pp: number | null
  priority: number
  effect_entries: { effect: string; language: { name: string } }[]
  flavor_text_entries: { flavor_text: string; language: { name: string } }[]
}

function collectMoveUrls(pokemon: PokemonRaw[]): string[] {
  const moveCount = new Map<string, number>()
  for (const p of pokemon) {
    for (const m of p.moves) {
      moveCount.set(m.move.url, (moveCount.get(m.move.url) || 0) + 1)
    }
  }
  return [...moveCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TARGET_MOVES)
    .map(([url]) => url)
}

async function fetchMoves(urls: string[]): Promise<MoveRaw[]> {
  console.log(`\nFetching ${urls.length} moves...`)
  const results: MoveRaw[] = []
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const detail = await fetchJSON(url) as any
        const nameZh = getNameZh(detail.names ?? [])
        return { ...detail, nameZh }
      })
    )
    for (const r of batchResults) results.push(r)
    if ((i + BATCH_SIZE) % 40 === 0 || i + BATCH_SIZE >= urls.length)
      process.stdout.write(`  [${Math.min(i + BATCH_SIZE, urls.length)}/${urls.length}]\n`)
    await delay(BATCH_DELAY)
  }
  return results
}

// ========== 3. 拉取特性 ==========

interface AbilityRaw {
  id: number
  name: string
  nameZh: string
  names: { name: string; language: { name: string } }[]
  flavor_text_entries: { flavor_text: string; language: { name: string } }[]
  effect_entries: { effect: string; language: { name: string } }[]
}

function collectAbilityUrls(pokemon: PokemonRaw[]): string[] {
  const urls = new Set<string>()
  for (const p of pokemon) {
    for (const a of p.abilities) {
      urls.add(a.ability.url)
    }
  }
  return [...urls].slice(0, TARGET_ABILITIES)
}

async function fetchAbilities(urls: string[]): Promise<AbilityRaw[]> {
  console.log(`\nFetching ${urls.length} abilities...`)
  const results: AbilityRaw[] = []
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const detail = await fetchJSON(url) as any
        const nameZh = getNameZh(detail.names ?? [])
        return { ...detail, nameZh }
      })
    )
    for (const r of batchResults) results.push(r)
    if ((i + BATCH_SIZE) % 40 === 0 || i + BATCH_SIZE >= urls.length)
      process.stdout.write(`  [${Math.min(i + BATCH_SIZE, urls.length)}/${urls.length}]\n`)
    await delay(BATCH_DELAY)
  }
  return results
}

// ========== 属性中文名 ==========

const TYPE_ZH: Record<string, string> = {
  normal: '一般', fire: '火', water: '水', electric: '电', grass: '草',
  ice: '冰', fighting: '格斗', poison: '毒', ground: '地面', flying: '飞行',
  psychic: '超能力', bug: '虫', rock: '岩石', ghost: '幽灵', dragon: '龙',
  dark: '恶', steel: '钢', fairy: '妖精',
}

// ========== 4. 生成 TS 文件 ==========

/** 从 flavor_text_entries 获取中文短描述 */
function getMoveZhDesc(m: MoveRaw): string {
  const zh = m.flavor_text_entries?.find(e => e.language.name === 'zh-hans')
  return zh?.flavor_text ?? m.effect_entries?.find(e => e.language.name === 'en')?.effect ?? ''
}

/** 从 flavor_text_entries 获取中文特性描述 */
function getAbilityZhDesc(a: AbilityRaw): string {
  const zh = a.flavor_text_entries?.find(e => e.language.name === 'zh-hans')
  return zh?.flavor_text ?? a.effect_entries?.find(e => e.language.name === 'en')?.effect ?? ''
}

function escapeStr(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\n\r\t\f\v]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toMoveCategory(str: string): string {
  if (str === 'physical') return 'physical'
  if (str === 'special') return 'special'
  return 'status'
}

function toPascalCase(str: string): string {
  return str.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
}

function typeEnumRef(name: string): string {
  return 'Type.' + toPascalCase(name)
}

function generatePokemonFile(pokemon: PokemonRaw[]) {
  const lines: string[] = [
    '// Auto-generated from PokeAPI',
    '',
    "import { Type } from './types'",
    "import type { Stats, Move, Ability, RecombinedPokemon } from './types'",
    "import { createStats, maxHpFromStats, defaultStatStages } from './types'",
    "import { v4 as uuid } from './uid'",
    '',
    'export interface SpeciesEntry {',
    '  dexId: number',
    '  name: string',
    '  nameZh: string',
    '  types: [Type, Type | null]',
    '  baseStats: Stats',
    '  abilityIds: string[]',
    '}',
    '',
    'export const SPECIES_DB: SpeciesEntry[] = [',
  ]

  for (const p of pokemon) {
    const types = p.types.map(t => typeEnumRef(t.type.name))
    const typeStr = types.length === 1
      ? `[${types[0]}, null]`
      : `[${types[0]}, ${types[1]}]`

    const statObj = `createStats(${p.stats.map(s => s.base_stat).join(', ')})`

    const abilityIds = p.abilities
      .filter(a => !a.is_hidden)
      .map(a => `'${a.ability.name}'`)
    const abilityStr = abilityIds.length > 0
      ? `[${abilityIds.join(', ')}]`
      : '[]'

    lines.push(`  { dexId: ${p.id}, name: '${p.name}', nameZh: '${p.nameZh || p.name}', types: ${typeStr}, baseStats: ${statObj}, abilityIds: ${abilityStr} },`)
  }

  lines.push(']', '')

  lines.push(
    'export function getSpeciesByDexId(dexId: number): SpeciesEntry | undefined {',
    '  return SPECIES_DB.find(s => s.dexId === dexId)',
    '}',
    '',
    'export function getRandomSpecies(): SpeciesEntry {',
    '  return SPECIES_DB[Math.floor(Math.random() * SPECIES_DB.length)]',
    '}',
    '',
    'export function createPokemonInstance(',
    '  species: SpeciesEntry, moves: Move[], ability: Ability',
    '): RecombinedPokemon {',
    '  const maxHp = maxHpFromStats(species.baseStats)',
    '  return {',
    '    id: uuid(),',
    '    dexId: species.dexId,',
    '    name: species.name,',
    '    nameZh: species.nameZh,',
    '    baseStats: species.baseStats,',
    '    types: [...species.types] as [Type, Type | null],',
    '    ability,',
    '    moves: moves as [Move, Move, Move, Move],',
    '    currentHp: maxHp,',
    '    maxHp,',
    '    status: null,',
    '    statStages: defaultStatStages(),',
    '    fainted: false,',
    '  }',
    '}',
  )

  writeFileSync(resolve(OUT, 'pokemon.ts'), lines.join('\n'), 'utf-8')
  console.log(`\nGenerated pokemon.ts (${pokemon.length} species)`)
}

function generateMovesFile(moves: MoveRaw[]) {
  const lines: string[] = [
    '// Auto-generated from PokeAPI',
    '',
    "import type { Move } from './types'",
    "import type { Type } from './types'",
    '',
    'const MOVE_DB: Move[] = [',
  ]

  for (const m of moves) {
    const power = m.power ?? 0
    const acc = m.accuracy ?? 100
    const pp = m.pp ?? 10
    const cat = toMoveCategory(m.damage_class?.name ?? 'status')
    const desc = escapeStr(getMoveZhDesc(m))
    const nameZh = m.nameZh || m.name
    lines.push(
      `  { id: ${m.id}, name: '${m.name}', nameZh: '${nameZh}', type: '${m.type.name}' as Type, category: '${cat}', power: ${power}, accuracy: ${acc}, pp: ${pp}, currentPp: ${pp}, priority: ${m.priority ?? 0}, description: '${desc}' },`,
    )
  }

  lines.push(']', '')

  lines.push(
    'export function getMoveById(id: number): Move | undefined {',
    '  return MOVE_DB.find(m => m.id === id)',
    '}',
    '',
    'export function getMoveByName(name: string): Move | undefined {',
    '  return MOVE_DB.find(m => m.name === name)',
    '}',
    '',
    'export function getRandomMove(): Move {',
    '  return MOVE_DB[Math.floor(Math.random() * MOVE_DB.length)]',
    '}',
    '',
    'export function getRandomMoves(count: number): Move[] {',
    '  const shuffled = [...MOVE_DB].sort(() => Math.random() - 0.5)',
    '  return shuffled.slice(0, Math.min(count, MOVE_DB.length))',
    '}',
    '',
    'export { MOVE_DB }',
  )

  writeFileSync(resolve(OUT, 'moves.ts'), lines.join('\n'), 'utf-8')
  console.log(`Generated moves.ts (${moves.length} moves)`)
}

function generateAbilitiesFile(abilities: AbilityRaw[]) {
  const lines: string[] = [
    '// Auto-generated from PokeAPI',
    '',
    "import type { Ability } from './types'",
    '',
    'const ABILITY_DB: Ability[] = [',
  ]

  for (const a of abilities) {
    const desc = escapeStr(getAbilityZhDesc(a))
    const nameZh = a.nameZh || a.name
    lines.push(
      `  { id: ${a.id}, name: '${a.name}', nameZh: '${nameZh}', description: '${desc}' },`,
    )
  }

  lines.push(']', '')

  lines.push(
    'export function getAbilityById(id: number): Ability | undefined {',
    '  return ABILITY_DB.find(a => a.id === id)',
    '}',
    '',
    'export function getAbilityByName(name: string): Ability | undefined {',
    '  return ABILITY_DB.find(a => a.name === name)',
    '}',
    '',
    'export function getRandomAbility(): Ability {',
    '  return ABILITY_DB[Math.floor(Math.random() * ABILITY_DB.length)]',
    '}',
    '',
    'export { ABILITY_DB }',
  )

  writeFileSync(resolve(OUT, 'abilities.ts'), lines.join('\n'), 'utf-8')
  console.log(`Generated abilities.ts (${abilities.length} abilities)`)
}

function generateUidFile() {
  const content = [
    '// Simple unique ID generator',
    'let counter = 0',
    '',
    'export function v4(): string {',
    "  return 'pkm-' + Date.now().toString(36) + '-' + (++counter).toString(36)",
    '}',
  ].join('\n')
  writeFileSync(resolve(OUT, 'uid.ts'), content, 'utf-8')
}

function generateTypeZhFile() {
  const entries = Object.entries(TYPE_ZH).map(([k, v]) => `  '${k}': '${v}',`)
  const content = [
    '// Auto-generated type Chinese name mapping',
    '',
    'export const TYPE_ZH: Record<string, string> = {',
    ...entries,
    '}',
    '',
    'export function getTypeZh(type: string): string {',
    "  return TYPE_ZH[type] ?? type",
    '}',
  ].join('\n')
  writeFileSync(resolve(OUT, 'type-zh.ts'), content, 'utf-8')
  console.log('Generated type-zh.ts')
}

async function main() {
  console.log('=== PokeAPI Data Fetcher (with Chinese names) ===\n')

  const pokemon = await fetchPokemonList(TARGET_SPECIES)
  const moveUrls = collectMoveUrls(pokemon)
  const moves = await fetchMoves(moveUrls)
  const abilityUrls = collectAbilityUrls(pokemon)
  const abilities = await fetchAbilities(abilityUrls)

  console.log('\n=== Generating files ===')
  generatePokemonFile(pokemon)
  generateMovesFile(moves)
  generateAbilitiesFile(abilities)
  generateUidFile()
  generateTypeZhFile()

  console.log('\nDone!')
}

main().catch(console.error)
