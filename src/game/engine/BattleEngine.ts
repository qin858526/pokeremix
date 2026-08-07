import type { RecombinedPokemon, Move, StatusCondition } from '../data/types'
import { calculateDamage, isImmune, formatBreakdown, ignoresDefenderAbility } from '../engine/DamageCalc'
import type { WeatherKind, FieldMods } from '../engine/DamageCalc'
import { getTypeEffectiveness, getEffectivenessText } from '../engine/TypeChart'
import { SeededRandom } from '../../utils/random'
import { getMoveEffect } from '../data/move-effects'
import type { StatName } from '../data/move-effects'
import { isContactMove, hasMoveTag } from '../data/move-tags'
import { getTypeZh } from '../data/type-zh'
import { Type } from '../data/types'

export interface TurnAction {
  type: 'move' | 'switch'
  moveIndex?: number
  targetIndex?: number
}

export interface TurnEvent {
  message: string
  type: 'damage' | 'status' | 'heal' | 'fail' | 'effect'
  damage?: number
  effectiveness?: number
  /** 事件来源（区分特性/天气/道具等） */
  triggerSource?: 'ability' | 'weather' | 'move' | 'item'
  /** 事件归属方（哪一边触发的特性/效果） */
  triggerSide?: 'player' | 'enemy'
  /** 伤害实际承受方（反伤/储液等需与攻击方向相反；动画据此扣血） */
  targetSide?: 'player' | 'enemy'
  /** 行动方（哪个阵营正在执行动作） */
  actionSide?: 'player' | 'enemy'
}

/**
 * 能力变化的上限 +6 / 下限 -6
 */
function clampStage(v: number): number {
  return Math.max(-6, Math.min(6, v))
}

export class BattleEngine {
  playerActive: RecombinedPokemon
  enemyActive: RecombinedPokemon
  playerTeam: RecombinedPokemon[]
  enemyTeam: RecombinedPokemon[]
  turnLog: TurnEvent[][] = []
  private rng: SeededRandom
  private _needsPlayerSwitch = false
  weather: 'none' | 'sun' | 'rain' | 'sandstorm' | 'hail' = 'none'

  /** 场地陷阱（撒钉）：playerHazards 影响 playerActive 上场，enemyHazards 影响 enemyActive 上场 */
  playerHazards: { spikes: number; toxicSpikes: number; stealthRock: boolean } = { spikes: 0, toxicSpikes: 0, stealthRock: false }
  enemyHazards: { spikes: number; toxicSpikes: number; stealthRock: boolean } = { spikes: 0, toxicSpikes: 0, stealthRock: false }
  /** 光墙/反射壁/神秘守护（按边计数，回合末递减） */
  playerScreens: { reflect: number; lightScreen: number; safeguard: number } = { reflect: 0, lightScreen: 0, safeguard: 0 }
  enemyScreens: { reflect: number; lightScreen: number; safeguard: number } = { reflect: 0, lightScreen: 0, safeguard: 0 }
  /** 玩水（water-sport）：全场生效，剩余回合数 > 0 时火系招式伤害减半 */
  waterSportTurns = 0

  /** 创建特性触发事件 */
  private abilityEvent(msg: string, side: 'player' | 'enemy', type: TurnEvent['type'] = 'effect'): TurnEvent {
    return { message: msg, type, triggerSource: 'ability', triggerSide: side } as TurnEvent
  }

  /** 判断宝可梦所属方 */
  private getSide(pkm: RecombinedPokemon): 'player' | 'enemy' {
    return pkm === this.playerActive ? 'player' : 'enemy'
  }

  /**
   * 破格：攻击方是否无视防守方特性。
   * 所有「防守方特性」判定点都必须先过这道短路，保证行为一致。
   */
  private ignoresAbility(attacker: RecombinedPokemon): boolean {
    return ignoresDefenderAbility(attacker)
  }

  /** 魔法镜反弹递归保护 */
  private _bouncing = false

  constructor(
    playerTeam: RecombinedPokemon[],
    enemyTeam: RecombinedPokemon[],
    seed: number,
  ) {
    this.playerTeam = [...playerTeam]
    this.enemyTeam = [...enemyTeam]
    this.playerActive = this.playerTeam[0]
    this.enemyActive = this.enemyTeam[0]
    this.rng = new SeededRandom(seed)
  }

  /** 开局触发双方入场特性，返回特性事件 */
  initAbilities(): TurnEvent[] {
    const events: TurnEvent[] = []
    const pMsg = this.applyOnSwitchAbility(this.playerActive, false)
    if (pMsg) events.push(this.abilityEvent(pMsg, 'player'))
    const eMsg = this.applyOnSwitchAbility(this.enemyActive, true)
    if (eMsg) events.push(this.abilityEvent(eMsg, 'enemy'))
    return events
  }

  /** 玩家是否需要选择替换的宝可梦 */
  get needsPlayerSwitch(): boolean {
    return this._needsPlayerSwitch
  }

  /** 获取队伍中下一只未倒下的宝可梦 */
  getNextAvailable(team: RecombinedPokemon[]): RecombinedPokemon | null {
    return team.find(p => !p.fainted) ?? null
  }

  /** 敌方自动换人 */
  switchEnemy(events?: TurnEvent[]): string | null {
    const old = this.enemyActive
    const next = this.getNextAvailable(this.enemyTeam)
    if (next && next !== this.enemyActive) {
      this.applyOnSwitchOutAbility(old)
      this.enemyActive = next
      const msg = this.applyOnSwitchAbility(this.enemyActive, true)
      if (events) events.push(...this.applyEntryHazards(this.enemyActive, 'enemy'))
      return msg
    }
    this._needsPlayerSwitch = false
    return null
  }

  /**
   * 换人受阻的原因（返回可直接展示的中文消息，可换人时返回 null）
   * 单一事实来源：主动换人 / 接力棒 都走这里，保证行为一致。
   */
  private switchBlockReason(pkm: RecombinedPokemon, side: 'player' | 'enemy'): string | null {
    // 扎根：无法换人逃走
    if (pkm._abilityData?.ingrain) return `${pkm.nameZh} 扎根了，无法替换！`
    // 束缚：被火焰旋涡/绑紧等困住时无法换人
    const trapped = pkm._abilityData?.trapTurns
    if (trapped && trapped > 0) {
      const trapName = pkm._abilityData?.trapMoveZh ?? '束缚'
      return `${pkm.nameZh} 被${trapName}束缚住，无法替换！`
    }
    // 黑眼神：被死死盯住，无法换人（无伤害、不自然消退）
    if (pkm._abilityData?.trappedByMeanLook) {
      return `${pkm.nameZh} 被黑眼神死死盯住，无法替换！`
    }
    // 换人封锁：对方特性阻止我方换人（踩影/沙穴/磁力）
    // 注意：受困判定针对「当前在场、准备撤下」的宝可梦，而非要换上来的那只
    const blocker = this.opponentBlocksSwitch(side, pkm)
    if (blocker) return `${pkm.nameZh} 被对方的 ${blocker} 阻止了替换！`
    return null
  }

  /** 玩家主动换人 */
  switchPlayer(targetIndex: number, events?: TurnEvent[]): boolean {
    const target = this.playerTeam[targetIndex]
    if (target && !target.fainted && target !== this.playerActive) {
      // 倒下后的强制替换不受任何束缚/封锁限制
      const blocked = this.playerActive.fainted ? null : this.switchBlockReason(this.playerActive, 'player')
      if (blocked) {
        if (events) events.push({ message: blocked, type: 'fail' })
        return false
      }
      this.applyOnSwitchOutAbility(this.playerActive)
      this.playerActive = target
      this.applyOnSwitchAbility(this.playerActive, false)
      if (events) events.push(...this.applyEntryHazards(this.playerActive, 'player'))
      this._needsPlayerSwitch = false
      return true
    }
    return false
  }

  /**
   * 判断某一方能否换人离场（被对方特性封锁时返回封锁特性名）
   * 适用：踩影（全场）、沙穴（地面系）、磁力（钢系）；吸盘仅在被强制换人时生效
   */
  private opponentBlocksSwitch(side: 'player' | 'enemy', me?: RecombinedPokemon): string | null {
    const self = me ?? (side === 'player' ? this.playerActive : this.enemyActive)
    const opp = side === 'player' ? this.enemyActive : this.playerActive
    if (!opp || opp.fainted) return null
    const oa = opp.ability.name
    const grounded = this.isGrounded(self)
    if (oa === 'shadow-tag') return '踩影'
    if (oa === 'arena-trap' && grounded) return '沙穴'
    if (oa === 'magnet-pull' && (self.types[0] === 'steel' || self.types[1] === 'steel')) return '磁力'
    return null
  }

  /**
   * 是否踩在地面上（撒菱/毒菱/沙穴/地面系判定共用）
   * 飞行系 / 飘浮特性 / 电磁悬浮 生效期间均视为浮空。
   */
  private isGrounded(pkm: RecombinedPokemon): boolean {
    if (pkm.types[0] === 'flying' || pkm.types[1] === 'flying') return false
    if (pkm.ability.name === 'levitate') return false
    if ((pkm._abilityData?.magnetRiseTurns ?? 0) > 0) return false
    return true
  }

  /**
   * 强制换人（吼叫/吹飞/龙尾）：把目标换成同队随机一只未倒下的替补
   * 被吸盘/扎根挡下或没有替补时返回 false
   */
  private forceSwitchOut(target: RecombinedPokemon, events: TurnEvent[], moveZh: string): boolean {
    // 吸盘：不会被强制拖出
    if (target.ability.name === 'suction-cups') {
      events.push(this.abilityEvent(
        `${target.nameZh} 的吸盘让它稳稳留在了场上！`, this.getSide(target), 'fail',
      ))
      return false
    }
    // 扎根：同样无法被拖走
    if (target._abilityData?.ingrain) {
      events.push({ message: `${target.nameZh} 扎根了，纹丝不动！`, type: 'fail' })
      return false
    }

    const side = this.getSide(target)
    const team = side === 'player' ? this.playerTeam : this.enemyTeam
    const bench = team.filter(m => !m.fainted && m !== target)
    if (bench.length === 0) return false

    const next = bench[Math.floor(this.rng.next() * bench.length)]
    this.applyOnSwitchOutAbility(target)
    if (side === 'player') this.playerActive = next
    else this.enemyActive = next

    events.push({ message: `${target.nameZh} 被${moveZh}吹飞了！`, type: 'effect' })
    const abMsg = this.applyOnSwitchAbility(next, side === 'enemy')
    events.push({ message: `${next.nameZh} 被换上了场！`, type: 'effect' })
    if (abMsg) events.push({ message: abMsg, type: 'effect', triggerSource: 'ability', triggerSide: side })
    events.push(...this.applyEntryHazards(next, side))
    return true
  }

  /**
   * 接力棒：把能力等级（及部分易失状态）交接给替补上场的宝可梦。
   * 受与普通换人相同的束缚/封锁限制；无可换替补时返回 false。
   */
  private batonPassSwitch(user: RecombinedPokemon, events: TurnEvent[]): boolean {
    const side = this.getSide(user)
    const blocked = this.switchBlockReason(user, side)
    if (blocked) {
      events.push({ message: blocked, type: 'fail' })
      return false
    }
    const team = side === 'player' ? this.playerTeam : this.enemyTeam
    const next = team.find(m => !m.fainted && m !== user)
    if (!next) return false

    // 先取快照：applyOnSwitchOutAbility 会清掉易失状态
    const stages = { ...user.statStages }
    const src = user._abilityData ?? {}
    const carried: Record<string, unknown> = {
      batonPassStages: stages,
      leechSeed: src.leechSeed,
      aquaRing: src.aquaRing,
      substituteHp: src.substituteHp,
      perishTurns: src.perishTurns,
      magnetRiseTurns: src.magnetRiseTurns,
    }

    this.applyOnSwitchOutAbility(user)
    if (side === 'player') this.playerActive = next
    else this.enemyActive = next

    next.statStages = { ...stages }
    next._abilityData = { ...next._abilityData, ...carried }

    events.push({ message: `${user.nameZh} 用接力棒交接了状态！`, type: 'effect' })
    const abMsg = this.applyOnSwitchAbility(next, side === 'enemy')
    events.push({ message: `${next.nameZh} 被换上了场！`, type: 'effect' })
    if (abMsg) events.push({ message: abMsg, type: 'effect', triggerSource: 'ability', triggerSide: side })
    events.push(...this.applyEntryHazards(next, side))
    if (side === 'player') this._needsPlayerSwitch = false
    return true
  }

  /**
   * 同命：使用者在本回合内倒下时，把击倒它的对手一并带走。
   * 必须在 victim.fainted 置位之后调用。
   */
  private applyDestinyBond(
    killer: RecombinedPokemon,
    victim: RecombinedPokemon,
    events: TurnEvent[],
  ): void {
    if (!victim.fainted) return
    if (victim._abilityData?.destinyBond !== true) return
    victim._abilityData.destinyBond = false
    if (killer.fainted) return
    killer.currentHp = 0
    killer.fainted = true
    events.push({
      message: `${victim.nameZh} 的同命发动，${killer.nameZh} 也一起倒下了！`,
      type: 'effect',
      targetSide: this.getSide(killer),
    })
  }

  /**
   * 入场特性效果（返回事件消息）
   */
  private applyOnSwitchAbility(pkm: RecombinedPokemon, isEnemy: boolean): string | null {
    // 变身者：登场时变身为对手（复制种族值/属性/招式/特性/能力等级，HP 与最大 HP 除外）
    if (pkm.ability.name === 'imposter' && !pkm._abilityData?.transformed) {
      const opp = isEnemy ? this.playerActive : this.enemyActive
      if (opp && !opp.fainted && opp.ability.name !== 'imposter') {
        const oppName = opp.nameZh
        // HP 种族值保留自身，其余全部复制
        pkm.baseStats = { ...opp.baseStats, hp: pkm.baseStats.hp }
        pkm.types = [opp.types[0], opp.types[1]]
        // 招式深拷贝，变身后 PP 统一为 5（主系列规则）
        const copied = opp.moves.map(m => ({ ...m, pp: 5, currentPp: 5 }))
        pkm.moves = [copied[0], copied[1], copied[2], copied[3]]
        pkm.statStages = { ...opp.statStages }
        pkm._abilityData = { ...pkm._abilityData, transformed: true }
        // 特性最后复制：复制完 pkm.ability 就不再是 imposter，避免重复触发
        pkm.ability = { ...opp.ability }
        return `${pkm.nameZh} 的变身者特性变身成了 ${oppName}！`
      }
    }

    // 威吓：降低对方攻击 1 级
    if (pkm.ability.name === 'intimidate') {
      const target = isEnemy ? this.playerActive : this.enemyActive
      if (target && !target.fainted && target.statStages.attack > -6) {
        // 迟钝：不受威吓影响（Gen 8+ 规则）
        if (target.ability.name === 'oblivious') {
          return `${target.nameZh} 的迟钝特性让威吓失效了！`
        }
        // 洁净身躯阻挡威吓
        if (target.ability.name === 'clear-body') {
          return `${target.nameZh} 的洁净身躯防止了攻击降低！`
        }
        target.statStages.attack = Math.max(-6, target.statStages.attack - 1)
        return `${pkm.nameZh} 的威吓降低了 ${target.nameZh} 的攻击！`
      }
    }

    // 日照：出场时放晴
    if (pkm.ability.name === 'drought') {
      this.weather = 'sun'
      return `${pkm.nameZh} 的日照特性让阳光变得强烈了！`
    }

    // 降雨：出场时下雨
    if (pkm.ability.name === 'drizzle') {
      this.weather = 'rain'
      return `${pkm.nameZh} 的降雨特性开始下雨了！`
    }

    // 扬沙：出场时沙暴
    if (pkm.ability.name === 'sand-stream') {
      this.weather = 'sandstorm'
      return `${pkm.nameZh} 的扬沙特性刮起了沙暴！`
    }

    // 复制：复制对方特性
    if (pkm.ability.name === 'trace') {
      const opp = isEnemy ? this.playerActive : this.enemyActive
      if (opp && !opp.fainted && opp.ability.name !== 'trace') {
        pkm.ability = { ...opp.ability }
        return `${pkm.nameZh} 的复制特性复制了对方 ${opp.nameZh} 的 ${opp.ability.nameZh}！`
      }
    }

    // 下载：根据对方防御选择提升攻击或特攻
    if (pkm.ability.name === 'download') {
      const opp = isEnemy ? this.playerActive : this.enemyActive
      if (opp && !opp.fainted) {
        if (opp.baseStats.spDefense >= opp.baseStats.defense) {
          pkm.statStages.spAttack = Math.min(6, pkm.statStages.spAttack + 1)
          return `${pkm.nameZh} 的下载特性提升了特攻！`
        }
        pkm.statStages.attack = Math.min(6, pkm.statStages.attack + 1)
        return `${pkm.nameZh} 的下载特性提升了攻击！`
      }
    }

    // 预知梦：提示对方最强招式（仅日志）
    if (pkm.ability.name === 'forewarn') {
      const opp = isEnemy ? this.playerActive : this.enemyActive
      if (opp && !opp.fainted && opp.moves.length > 0) {
        const strongest = opp.moves.reduce((a, b) => ((b.power ?? 0) > (a.power ?? 0) ? b : a), opp.moves[0])
        return `${pkm.nameZh} 的预知梦察觉到对方可能使用 ${strongest.nameZh}！`
      }
    }

    return null
  }

  /**
   * 离场特性效果（如自然回复：交换时治愈异常状态）
   */
  private applyOnSwitchOutAbility(pkm: RecombinedPokemon): void {
    if (pkm.ability.name === 'regenerator') {
      const heal = Math.floor(pkm.maxHp / 3)
      pkm.currentHp = Math.min(pkm.maxHp, pkm.currentHp + heal)
    }
    if (pkm.ability.name === 'natural-cure' && pkm.status) {
      pkm.status = null
    }
    // 离场时清除自身束缚状态；同时解除对方身上由自己施加的束缚
    if (pkm._abilityData) {
      pkm._abilityData.trapTurns = 0
      pkm._abilityData.trapMoveZh = undefined
      // T10：所有易失（volatile）封锁/计时状态在离场时一并清除
      this.clearVolatileT10(pkm)
    }
    const opp = this.getSide(pkm) === 'player' ? this.enemyActive : this.playerActive
    if (opp?._abilityData?.trapTurns) {
      opp._abilityData.trapTurns = 0
      opp._abilityData.trapMoveZh = undefined
    }
    // 施加者离场 → 对方身上的黑眼神束缚解除（imprison 存在使用者身上，已由上面清除）
    if (opp?._abilityData) opp._abilityData.trappedByMeanLook = false
  }

  /** 清除 T10 引入的易失状态（换人/退场时重置） */
  private clearVolatileT10(pkm: RecombinedPokemon): void {
    if (!pkm._abilityData) return
    pkm._abilityData.tauntTurns = 0
    pkm._abilityData.torment = false
    pkm._abilityData.encoreTurns = 0
    pkm._abilityData.encoreMoveId = undefined
    pkm._abilityData.disableTurns = 0
    pkm._abilityData.disabledMoveId = undefined
    pkm._abilityData.imprison = false
    pkm._abilityData.trappedByMeanLook = false
    pkm._abilityData.perishTurns = 0
    pkm._abilityData.magnetRiseTurns = 0
    pkm._abilityData.destinyBond = false
    pkm._abilityData.lastMoveId = undefined
  }

  /**
   * 宝可梦上场时触发场地陷阱（撒钉）
   */
  private applyEntryHazards(pkm: RecombinedPokemon, side: 'player' | 'enemy'): TurnEvent[] {
    const events: TurnEvent[] = []
    if (pkm.fainted) return events
    const haz = side === 'player' ? this.playerHazards : this.enemyHazards
    const isGrounded = this.isGrounded(pkm)

    if (haz.spikes > 0 && isGrounded) {
      const ratios = [1 / 8, 1 / 6, 1 / 4]
      const dmg = Math.max(1, Math.floor(pkm.maxHp * ratios[Math.min(haz.spikes, 3) - 1]))
      pkm.currentHp = Math.max(0, pkm.currentHp - dmg)
      events.push({ message: `${pkm.nameZh} 被撒菱刺伤，受到了 ${dmg} 点伤害！`, type: 'damage', damage: dmg, targetSide: side })
      if (pkm.currentHp === 0) { pkm.fainted = true; events.push({ message: `${pkm.nameZh} 倒下了！`, type: 'effect' }) }
    }

    if (haz.toxicSpikes > 0 && isGrounded
      && pkm.types[0] !== 'poison' && pkm.types[1] !== 'poison'
      && pkm.types[0] !== 'steel' && pkm.types[1] !== 'steel') {
      if (!pkm.status) {
        const bad = haz.toxicSpikes >= 2
        pkm.status = bad ? 'bad_poison' : 'poison'
        pkm.statusTurns = 0
        events.push({ message: `${pkm.nameZh} 踩到了毒菱，中了${bad ? '剧毒' : '毒'}！`, type: 'status' })
      }
    }

    if (haz.stealthRock && pkm.currentHp > 0) {
      const eff = getTypeEffectiveness(Type.Rock, pkm.types)
      const dmg = Math.max(1, Math.floor(pkm.maxHp / 8 * eff))
      pkm.currentHp = Math.max(0, pkm.currentHp - dmg)
      events.push({ message: `${pkm.nameZh} 被隐形岩击中，受到了 ${dmg} 点伤害！`, type: 'damage', damage: dmg, targetSide: side })
      if (pkm.currentHp === 0) { pkm.fainted = true; events.push({ message: `${pkm.nameZh} 倒下了！`, type: 'effect' }) }
    }
    return events
  }

  /** 反射壁/光墙：计算防御方减伤倍率（穿透特性无视） */
  private screenMultiplier(attacker: RecombinedPokemon, move: Move, defSide: 'player' | 'enemy'): { mod: number; label: string } {
    if (attacker.ability.name === 'infiltrator') return { mod: 1, label: '' }
    const screens = defSide === 'player' ? this.playerScreens : this.enemyScreens
    if (move.category === 'physical' && screens.reflect > 0) return { mod: 0.5, label: '反射壁' }
    if (move.category === 'special' && screens.lightScreen > 0) return { mod: 0.5, label: '光墙' }
    return { mod: 1, label: '' }
  }

  /** 当前生效的场地类伤害修正（玩水等，不依附于任何一方） */
  private fieldMods(): FieldMods {
    return { waterSport: this.waterSportTurns > 0 }
  }

  /** 有效天气：无关天气/气压/空中台特性在场时天气效果失效 */
  private effectiveWeather(): WeatherKind {
    const a = this.playerActive.ability.name
    const b = this.enemyActive.ability.name
    if (a === 'cloud-nine' || b === 'cloud-nine' || a === 'air-lock' || b === 'air-lock') return 'none'
    return this.weather
  }

  /** 属性免疫判定（胆量特性下普通/格斗系可命中幽灵系） */
  private isImmuneToMove(move: Move, defender: RecombinedPokemon, attacker: RecombinedPokemon): boolean {
    if (!isImmune(move, defender)) return false
    if (attacker.ability.name === 'scrappy'
      && (move.type === 'normal' || move.type === 'fighting')
      && (defender.types[0] === 'ghost' || defender.types[1] === 'ghost')) {
      return false
    }
    return true
  }

  /** 回合末：寄生种子吸取、扎根回复、光墙/反射壁/神秘守护倒数 */
  private applyEndOfTurnField(events: TurnEvent[]): void {
    const sides: [RecombinedPokemon, 'player' | 'enemy'][] = [
      [this.playerActive, 'player'],
      [this.enemyActive, 'enemy'],
    ]
    for (const [pkm, side] of sides) {
      if (pkm.fainted) continue
      if (pkm._abilityData?.leechSeed) {
        const drain = Math.max(1, Math.floor(pkm.maxHp / 8))
        pkm.currentHp = Math.max(0, pkm.currentHp - drain)
        const seeder = side === 'player' ? this.enemyActive : this.playerActive
        if (!seeder.fainted) seeder.currentHp = Math.min(seeder.maxHp, seeder.currentHp + drain)
        events.push({ message: `寄生种子吸取了 ${pkm.nameZh} 的 ${drain} 点ＨＰ！`, type: 'damage', damage: drain, targetSide: side })
        if (pkm.currentHp === 0) { pkm.fainted = true; events.push({ message: `${pkm.nameZh} 倒下了！`, type: 'effect' }) }
      }
      if (pkm._abilityData?.ingrain && pkm.currentHp < pkm.maxHp) {
        const heal = Math.max(1, Math.floor(pkm.maxHp / 16))
        pkm.currentHp = Math.min(pkm.maxHp, pkm.currentHp + heal)
        events.push({ message: `${pkm.nameZh} 的根系回复了 ${heal} 点ＨＰ！`, type: 'heal' })
      }
      // 太阳之力：晴天每回合损失 1/8 HP
      if (pkm.ability.name === 'solar-power' && this.effectiveWeather() === 'sun') {
        const dmg = Math.max(1, Math.floor(pkm.maxHp / 8))
        pkm.currentHp = Math.max(0, pkm.currentHp - dmg)
        events.push({ message: `${pkm.nameZh} 的太阳之力在烈日下受到了 ${dmg} 点伤害！`, type: 'damage', damage: dmg, targetSide: side })
        if (pkm.currentHp === 0) { pkm.fainted = true; events.push({ message: `${pkm.nameZh} 倒下了！`, type: 'effect' }) }
      }
      // 水流环：每回合末回复 1/16 最大 HP
      if (pkm._abilityData?.aquaRing && pkm.currentHp < pkm.maxHp && !pkm.fainted) {
        const heal = Math.max(1, Math.floor(pkm.maxHp / 16))
        pkm.currentHp = Math.min(pkm.maxHp, pkm.currentHp + heal)
        events.push({ message: `${pkm.nameZh} 的水流帷幕回复了 ${heal} 点ＨＰ！`, type: 'heal' })
      }
      // 祈愿：许愿后第二个回合末生效
      if (pkm._abilityData?.wishTurns && pkm._abilityData.wishTurns > 0) {
        pkm._abilityData.wishTurns--
        if (pkm._abilityData.wishTurns === 0) {
          const heal = pkm._abilityData.wishHeal ?? Math.max(1, Math.floor(pkm.maxHp / 2))
          pkm._abilityData.wishHeal = undefined
          if (!pkm.fainted && pkm.currentHp < pkm.maxHp) {
            pkm.currentHp = Math.min(pkm.maxHp, pkm.currentHp + heal)
            events.push({ message: `${pkm.nameZh} 的愿望实现了，回复了 ${heal} 点ＨＰ！`, type: 'heal' })
          }
        }
      }
      // 束缚：每回合末扣 1/8 最大 HP，回合数耗尽后解除
      if (pkm._abilityData?.trapTurns && pkm._abilityData.trapTurns > 0 && !pkm.fainted) {
        const trapName = pkm._abilityData.trapMoveZh ?? '束缚'
        const dmg = Math.max(1, Math.floor(pkm.maxHp / 8))
        pkm.currentHp = Math.max(0, pkm.currentHp - dmg)
        events.push({
          message: `${pkm.nameZh} 受到${trapName}的束缚，损失了 ${dmg} 点ＨＰ！`,
          type: 'damage', damage: dmg, targetSide: side,
        })
        if (pkm.currentHp === 0) {
          pkm.fainted = true
          events.push({ message: `${pkm.nameZh} 倒下了！`, type: 'effect' })
        }
        pkm._abilityData.trapTurns--
        if (pkm._abilityData.trapTurns <= 0) {
          pkm._abilityData.trapTurns = 0
          pkm._abilityData.trapMoveZh = undefined
          if (!pkm.fainted) {
            events.push({ message: `${pkm.nameZh} 摆脱了${trapName}的束缚！`, type: 'effect' })
          }
        }
      }
      // 心情不定：回合末随机一项能力 +2、另一项（不同项）-1
      if (pkm.ability.name === 'moody' && !pkm.fainted) {
        const pool: (keyof RecombinedPokemon['statStages'])[] = [
          'attack', 'defense', 'spAttack', 'spDefense', 'speed', 'accuracy', 'evasion',
        ]
        const up = pool[Math.floor(this.rng.next() * pool.length)]
        const rest = pool.filter(s => s !== up)
        const down = rest[Math.floor(this.rng.next() * rest.length)]
        events.push(this.abilityEvent(`${pkm.nameZh} 的心情不定发动了！`, side, 'status'))
        const upMsg = this.raiseStat(pkm, up, 2)
        if (upMsg) events.push({ message: upMsg, type: 'status' })
        const downMsg = this.lowerStat(pkm, down, 1)
        if (downMsg) events.push({ message: downMsg, type: 'status' })
      }
      // 湿润之躯：雨天治愈异常状态
      if (pkm.ability.name === 'hydration' && this.effectiveWeather() === 'rain' && pkm.status) {
        const healed = pkm.status
        pkm.status = null
        const zh: Record<string, string> = { paralysis: '麻痹', poison: '中毒', bad_poison: '中毒', burn: '烧伤', freeze: '冰冻', sleep: '睡眠' }
        events.push({ message: `${pkm.nameZh} 的湿润之躯在雨中治愈了${zh[healed] ?? '异常状态'}！`, type: 'heal' })
      }
    }
    for (const screens of [this.playerScreens, this.enemyScreens]) {
      if (screens.reflect > 0) screens.reflect--
      if (screens.lightScreen > 0) screens.lightScreen--
      if (screens.safeguard > 0) screens.safeguard--
    }

    // ---- T10：封锁/计时类易失状态回合末结算 ----
    this.applyEndOfTurnT10(events)
  }

  /**
   * T10 回合末结算：挑衅/再来一次/定身法/电磁悬浮倒数、灭亡之歌倒数、同命清除、玩水倒数
   */
  private applyEndOfTurnT10(events: TurnEvent[]): void {
    const sides: [RecombinedPokemon, 'player' | 'enemy'][] = [
      [this.playerActive, 'player'],
      [this.enemyActive, 'enemy'],
    ]

    for (const [pkm, side] of sides) {
      const d = pkm._abilityData
      if (!d) continue

      // 同命：只在使用的当回合有效
      d.destinyBond = false

      if (pkm.fainted) continue

      // 挑衅倒数
      if ((d.tauntTurns ?? 0) > 0) {
        d.tauntTurns--
        if (d.tauntTurns <= 0) {
          d.tauntTurns = 0
          events.push({ message: `${pkm.nameZh} 的挑衅效果消失了！`, type: 'effect' })
        }
      }

      // 再来一次倒数（招式 PP 耗尽时提前失效）
      if ((d.encoreTurns ?? 0) > 0) {
        const forced = pkm.moves.find(m => m && m.name === d.encoreMoveId)
        if (!forced || forced.currentPp <= 0) {
          d.encoreTurns = 0
          d.encoreMoveId = undefined
          events.push({ message: `${pkm.nameZh} 的再来一次效果消失了！`, type: 'effect' })
        } else {
          d.encoreTurns--
          if (d.encoreTurns <= 0) {
            d.encoreTurns = 0
            d.encoreMoveId = undefined
            events.push({ message: `${pkm.nameZh} 的再来一次效果消失了！`, type: 'effect' })
          }
        }
      }

      // 定身法倒数
      if ((d.disableTurns ?? 0) > 0) {
        d.disableTurns--
        if (d.disableTurns <= 0) {
          d.disableTurns = 0
          d.disabledMoveId = undefined
          events.push({ message: `${pkm.nameZh} 的定身法解除了！`, type: 'effect' })
        }
      }

      // 电磁悬浮倒数
      if ((d.magnetRiseTurns ?? 0) > 0) {
        d.magnetRiseTurns--
        if (d.magnetRiseTurns <= 0) {
          d.magnetRiseTurns = 0
          events.push({ message: `${pkm.nameZh} 的电磁悬浮效果结束了！`, type: 'effect' })
        }
      }

      // 灭亡之歌倒数：归零时倒下
      if ((d.perishTurns ?? 0) > 0) {
        d.perishTurns--
        if (d.perishTurns <= 0) {
          d.perishTurns = 0
          pkm.currentHp = 0
          pkm.fainted = true
          events.push({ message: `${pkm.nameZh} 因灭亡之歌倒下了！`, type: 'effect', targetSide: side })
        } else {
          events.push({ message: `${pkm.nameZh} 的灭亡之歌倒数 ${d.perishTurns}！`, type: 'effect' })
        }
      }
    }

    // 玩水倒数（全场效果）
    if (this.waterSportTurns > 0) {
      this.waterSportTurns--
      if (this.waterSportTurns === 0) {
        events.push({ message: '玩水的效果结束了！', type: 'effect' })
      }
    }
  }

  // ==================== T10：招式可用性（封锁类招式） ====================

  /**
   * 某个招式当前为何不可使用（返回中文原因），可用时返回 null。
   * 只判定「封锁类」限制，不判 PP（PP 由调用方单独处理）。
   * 挑衅 / 无理取闹 / 定身法 / 再来一次 / 封锁 共用此单一事实来源。
   */
  moveBlockReason(pkm: RecombinedPokemon, moveIndex: number): string | null {
    const move = pkm.moves[moveIndex]
    if (!move) return null

    // ---- 挂在自己身上的封锁状态（_abilityData 未初始化时整段跳过）----
    const d = pkm._abilityData
    if (d) {
      // 定身法：指定招式 4 回合内无法使用
      if ((d.disableTurns ?? 0) > 0 && d.disabledMoveId === move.name) return '定身法'
      // 挑衅：3 回合内只能使用攻击招式
      if ((d.tauntTurns ?? 0) > 0 && move.category === 'status') return '挑衅'
      // 无理取闹：不能连续两次使用同一招
      if (d.torment === true && d.lastMoveId === move.name) return '无理取闹'
      // 再来一次：被迫重复指定招式
      if ((d.encoreTurns ?? 0) > 0 && d.encoreMoveId && d.encoreMoveId !== move.name) return '再来一次'
    }

    // ---- 挂在对手身上的封锁状态：与自己是否有 _abilityData 无关，必须独立判定 ----
    // （新生成的宝可梦 _abilityData 为 undefined，此处若提前返回会让封锁整体失效）
    // 封锁：对手使用了封锁且它也会这招 → 双方都不能用
    const opp = this.getSide(pkm) === 'player' ? this.enemyActive : this.playerActive
    if (opp && !opp.fainted && opp._abilityData?.imprison === true
      && opp.moves.some(m => m && m.name === move.name)) {
      return '封锁'
    }
    return null
  }

  /** 某一方当前「严格合法」的招式下标（PP > 0 且未被封锁） */
  legalMoveIndices(side: 'player' | 'enemy'): number[] {
    const pkm = side === 'player' ? this.playerActive : this.enemyActive
    if (!pkm) return []
    const out: number[] = []
    for (let i = 0; i < pkm.moves.length; i++) {
      const m = pkm.moves[i]
      if (!m || m.currentPp <= 0) continue
      if (this.moveBlockReason(pkm, i)) continue
      out.push(i)
    }
    return out
  }

  /**
   * 供 AI / UI 使用的可选招式下标。
   * 与 executeSingleAction 的兜底保持一致：完全无合法招式时（全被封锁）
   * 放行所有还有 PP 的招式，避免死锁（等价于主系列的「挣扎」兜底）。
   */
  selectableMoveIndices(side: 'player' | 'enemy'): number[] {
    const legal = this.legalMoveIndices(side)
    if (legal.length > 0) return legal
    const pkm = side === 'player' ? this.playerActive : this.enemyActive
    if (!pkm) return []
    const withPp: number[] = []
    for (let i = 0; i < pkm.moves.length; i++) {
      if (pkm.moves[i] && pkm.moves[i].currentPp > 0) withPp.push(i)
    }
    return withPp.length > 0 ? withPp : [0]
  }

  /** AI 选择行动（优先攻击招式；被封锁的招式不会被选中） */
  enemyAction(): TurnAction {
    const selectable = this.selectableMoveIndices('enemy')
    if (selectable.length === 0) return { type: 'move', moveIndex: 0 }
    // 优先攻击招式；若全被挑衅/封锁挡住则退回全部可选招式
    const attacking = selectable.filter(i => this.enemyActive.moves[i]?.category !== 'status')
    const pool = attacking.length > 0 ? attacking : selectable
    const idx = this.rng.nextInt(pool.length)
    return { type: 'move', moveIndex: pool[idx] }
  }

  /**
   * 获取有效速度（麻痹时减半）
   */
  private effectiveSpeed(pkm: RecombinedPokemon): number {
    const base = pkm.baseStats.speed
    const stage = pkm.statStages.speed
    const stageMult = stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage)
    let speed = Math.floor(base * stageMult)
    if (pkm.status === 'paralysis' && pkm.ability.name !== 'quick-feet') speed = Math.floor(speed * 0.5)

    // 天气加速特性
    if (this.weather === 'rain' && pkm.ability.name === 'swift-swim') speed = Math.floor(speed * 2)
    if (this.weather === 'sun' && pkm.ability.name === 'chlorophyll') speed = Math.floor(speed * 2)
    if (this.weather === 'sandstorm' && pkm.ability.name === 'sand-rush') speed = Math.floor(speed * 2)

    return speed
  }

  /**
   * 计算招式最终优先度（含特性修正）
   */
  private getPriority(pokemon: RecombinedPokemon, action: TurnAction): number {
    if (action.type === 'switch') return 6 // 主动换人优先于几乎所有技能
    if (pokemon.ability.name === 'stall') return -7 // 慢出：本回合最后行动
    if (action.type !== 'move') return 0
    const move = pokemon.moves[action.moveIndex ?? 0]
    if (!move) return 0
    let priority = move.priority ?? 0
    // 恶作剧之心：变化招式优先度 +1
    if (move.category === 'status' && pokemon.ability.name === 'prankster') {
      priority += 1
    }
    return priority
  }

  /**
   * 检查宝可梦本回合是否能行动（睡眠/麻痹/冰冻/畏缩）
   * 返回 { canAct: boolean, message?: string }
   */
  private canAct(pkm: RecombinedPokemon): { canAct: boolean; message?: string } {
    // 懒惰：每隔一回合无法行动（首个回合正常行动，之后交替偷懒）
    if (pkm.ability.name === 'truant') {
      const loafing = pkm._abilityData?.truantIdle === true
      pkm._abilityData = { ...pkm._abilityData, truantIdle: !loafing }
      if (loafing) {
        return { canAct: false, message: `${pkm.nameZh} 因懒惰而正在偷懒！` }
      }
    }

    // 畏缩检查
    if (pkm._abilityData?.flinched) {
      pkm._abilityData.flinched = false
      return { canAct: false, message: `${pkm.nameZh} 因畏缩而无法行动！` }
    }

    // 充能检查：上一回合使用了破坏光线等
    if (pkm._abilityData?.mustRecharge) {
      pkm._abilityData.mustRecharge = false
      return { canAct: false, message: `${pkm.nameZh} 因充能而无法行动！` }
    }

    if (pkm.status === 'sleep') {
      if (pkm.statusTurns == null) pkm.statusTurns = 2
      pkm.statusTurns--
      if (pkm.statusTurns <= 0) {
        pkm.status = null
        return { canAct: true, message: `${pkm.nameZh} 醒来了！` }
      }
      return { canAct: false, message: `${pkm.nameZh} 正在睡觉…` }
    }
    if (pkm.status === 'freeze') {
      if (this.rng.next() < 0.25) {
        pkm.status = null
        return { canAct: true, message: `${pkm.nameZh} 解冻了！` }
      }
      return { canAct: false, message: `${pkm.nameZh} 因冰冻无法行动！` }
    }
    if (pkm.status === 'paralysis') {
      if (this.rng.next() < 0.25) {
        return { canAct: false, message: `${pkm.nameZh} 因麻痹无法行动！` }
      }
    }
    // 混乱检查
    if (pkm.confuseTurns && pkm.confuseTurns > 0) {
      pkm.confuseTurns--
      if (pkm.confuseTurns <= 0) {
        pkm.confuseTurns = 0
        return { canAct: true, message: `${pkm.nameZh} 的混乱解除了！` }
      }
      // 33% 概率攻击自己
      if (this.rng.next() < 1 / 3) {
        const selfDamage = Math.max(1, Math.floor(
          ((2 * 50 / 5 + 2) * 40 * pkm.baseStats.attack) / pkm.baseStats.defense / 50 + 2
        ))
        pkm.currentHp = Math.max(0, pkm.currentHp - selfDamage)
        if (pkm.currentHp === 0) pkm.fainted = true
        return { canAct: false, message: `${pkm.nameZh} 因混乱攻击了自己！(${selfDamage} 伤害)` }
      }
    }
    return { canAct: true }
  }

  /**
   * 回合末异常状态伤害
   */
  private applyEndOfTurnStatus(pkm: RecombinedPokemon, events: TurnEvent[], owner: string): void {
    if (pkm.fainted) return

    const side = owner as 'player' | 'enemy'

    // 雨盘：下雨时回复 HP
    if (pkm.ability.name === 'poison-heal' && (pkm.status === 'poison' || pkm.status === 'bad_poison') && pkm.currentHp < pkm.maxHp) {
      const heal = Math.max(1, Math.floor(pkm.maxHp / 8))
      pkm.currentHp = Math.min(pkm.maxHp, pkm.currentHp + heal)
      events.push(this.abilityEvent(`${pkm.nameZh} 的毒疗特性回复了 ${heal} 点ＨＰ！`, side, 'heal'))
      pkm.status = null
      return
    }

    // 冰体：冰雹时回复 HP
    if (pkm.ability.name === 'ice-body' && this.weather === 'hail' && pkm.currentHp < pkm.maxHp) {
      const heal = Math.max(1, Math.floor(pkm.maxHp / 16))
      pkm.currentHp = Math.min(pkm.maxHp, pkm.currentHp + heal)
      events.push(this.abilityEvent(`${pkm.nameZh} 的冰体特性回复了 ${heal} 点ＨＰ！`, side, 'heal'))
    }

    //  hydration/drying-up: not implemented here
    if (pkm.ability.name === 'rain-dish' && this.weather === 'rain' && pkm.currentHp < pkm.maxHp) {
      const heal = Math.max(1, Math.floor(pkm.maxHp / 16))
      pkm.currentHp = Math.min(pkm.maxHp, pkm.currentHp + heal)
      events.push(this.abilityEvent(`${pkm.nameZh} 的雨盘特性回复了 ${heal} 点ＨＰ！`, side, 'heal'))
    }

    // 加速：每回合末速度提升 1 级
    if (pkm.ability.name === 'speed-boost' && pkm.statStages.speed < 6) {
      pkm.statStages.speed = clampStage(pkm.statStages.speed + 1)
      events.push(this.abilityEvent(`${pkm.nameZh} 的加速特性提升了速度！`, side, 'status'))
    }

    // 蜕皮：33% 几率治愈异常状态
    if (pkm.ability.name === 'shed-skin' && pkm.status && this.rng.next() < 1 / 3) {
      pkm.status = null
      events.push(this.abilityEvent(`${pkm.nameZh} 的蜕皮特性治愈了异常状态！`, side, 'status'))
      return
    }

    let damage = 0
    let msg = ''
    if (pkm.status === 'burn') {
      damage = Math.max(1, Math.floor(pkm.maxHp / 16))
      msg = `${pkm.nameZh} 被烧伤，受到了 ${damage} 点伤害！`
    } else if (pkm.status === 'poison') {
      damage = Math.max(1, Math.floor(pkm.maxHp / 8))
      msg = `${pkm.nameZh} 中毒，受到了 ${damage} 点伤害！`
    } else if (pkm.status === 'bad_poison') {
      pkm.statusTurns = (pkm.statusTurns ?? 0) + 1
      damage = Math.max(1, Math.floor(pkm.maxHp / 16 * pkm.statusTurns))
      msg = `${pkm.nameZh} 中剧毒，受到了 ${damage} 点伤害！`
    }

    // 魔法防守：免疫中毒/灼伤等非直接伤害
    if (damage > 0 && msg && pkm.ability.name === 'magic-guard') {
      events.push(this.abilityEvent(`${pkm.nameZh} 的魔法防守抵挡了异常伤害！`, side, 'status'))
    } else if (damage > 0 && msg) {
      pkm.currentHp = Math.max(0, pkm.currentHp - damage)
      events.push({ message: msg, type: 'damage', damage, targetSide: side })
      if (pkm.currentHp === 0) {
        pkm.fainted = true
        events.push({ message: `${pkm.nameZh} 倒下了！`, type: 'effect' })
      }
    }

    // 沙暴/冰雹回合末伤害（魔法防守免疫非直接伤害）
    if (!pkm.fainted && pkm.ability.name !== 'magic-guard') {
      if (this.weather === 'sandstorm') {
        const immune = ['rock', 'ground', 'steel'].includes(pkm.types[0]!) || ['rock', 'ground', 'steel'].includes(pkm.types[1] ?? '')
          || ['sand-force', 'sand-rush', 'sand-veil'].includes(pkm.ability.name)
        if (!immune) {
          const wd = Math.max(1, Math.floor(pkm.maxHp / 16))
          pkm.currentHp = Math.max(0, pkm.currentHp - wd)
          events.push({ message: `${pkm.nameZh} 被沙暴击中，受到了 ${wd} 点伤害！`, type: 'damage', damage: wd, targetSide: side })
          if (pkm.currentHp === 0) {
            pkm.fainted = true
            events.push({ message: `${pkm.nameZh} 倒下了！`, type: 'effect' })
          }
        }
      } else if (this.weather === 'hail') {
        const immune = pkm.types[0] === 'ice' || pkm.types[1] === 'ice'
          || ['ice-body', 'snow-cloak'].includes(pkm.ability.name)
        if (!immune) {
          const wd = Math.max(1, Math.floor(pkm.maxHp / 16))
          pkm.currentHp = Math.max(0, pkm.currentHp - wd)
          events.push({ message: `${pkm.nameZh} 被冰雹击中，受到了 ${wd} 点伤害！`, type: 'damage', damage: wd, targetSide: side })
          if (pkm.currentHp === 0) {
            pkm.fainted = true
            events.push({ message: `${pkm.nameZh} 倒下了！`, type: 'effect' })
          }
        }
      }
    }
  }

  /** 执行一回合 */
  executeTurn(playerAction: TurnAction, enemyAction: TurnAction): TurnEvent[] {
    const events: TurnEvent[] = []

    // 防御：玩家精灵倒下但尚未换人时，禁止继续行动（否则用倒下精灵行动导致异常/空事件）
    if (this._needsPlayerSwitch) {
      if (this.playerActive.fainted) {
        events.push({ message: `${this.playerActive.nameZh} 倒下了，请选择要替换的宝可梦！`, type: 'fail' })
        return events
      }
      // 状态残留但精灵未倒下：直接清除，继续正常行动
      this._needsPlayerSwitch = false
    }

    // 清除上一回合的临时状态（守住/挺住/畏缩）
    if (this.playerActive._abilityData) {
      this.playerActive._abilityData.protected = false
      this.playerActive._abilityData.enduring = false
      this.playerActive._abilityData.flinched = false
    }
    if (this.enemyActive._abilityData) {
      this.enemyActive._abilityData.protected = false
      this.enemyActive._abilityData.enduring = false
      this.enemyActive._abilityData.flinched = false
    }

    // 检查是否能行动（睡眠/麻痹/冰冻/混乱/充能）
    // 主动换人不受异常状态影响（主系列规则：异常状态的宝可梦仍可换人）
    const playerCanActInfo = this.canAct(this.playerActive)
    const enemyCanActInfo = this.canAct(this.enemyActive)
    const playerCanAct = playerCanActInfo.canAct || playerAction.type === 'switch'
    const enemyCanAct = enemyCanActInfo.canAct || enemyAction.type === 'switch'

    if (!playerCanAct && playerCanActInfo.message) {
      events.push({ message: playerCanActInfo.message, type: 'fail' })
    }
    if (!enemyCanAct && enemyCanActInfo.message) {
      events.push({ message: enemyCanActInfo.message, type: 'fail' })
    }

    // 解除信息（混乱解除/醒来/解冻）
    if (playerCanAct && playerCanActInfo.message) {
      events.push({ message: playerCanActInfo.message, type: 'effect' })
    }
    if (enemyCanAct && enemyCanActInfo.message) {
      events.push({ message: enemyCanActInfo.message, type: 'effect' })
    }

    // 如果任意一方因混乱自伤倒下，检查战斗结束
    if (this.playerActive.fainted || this.enemyActive.fainted) {
      const endCheck = this.checkBattleEnd()
      if (endCheck) { this.turnLog.push(events); return events }
      if (this.enemyActive.fainted) { const abMsg = this.switchEnemy(); events.push({ message: `对方派出 ${this.enemyActive.nameZh}！`, type: 'effect' }); if (abMsg) events.push({ message: abMsg, type: 'effect', triggerSource: 'ability', triggerSide: 'enemy' }) }
      if (this.playerActive.fainted) { this._needsPlayerSwitch = true; this.turnLog.push(events); return events }
    }

    // 先攻判定：优先度优先，同优先度比有效速度（含麻痹影响）
    const playerPriority = this.getPriority(this.playerActive, playerAction)
    const enemyPriority = this.getPriority(this.enemyActive, enemyAction)

    let playerFirst: boolean
    if (playerPriority > enemyPriority) playerFirst = true
    else if (enemyPriority > playerPriority) playerFirst = false
    else playerFirst = this.effectiveSpeed(this.playerActive) >= this.effectiveSpeed(this.enemyActive)

    const first = playerFirst
      ? { action: playerAction, pokemon: this.playerActive, isPlayer: true, canAct: playerCanAct }
      : { action: enemyAction, pokemon: this.enemyActive, isPlayer: false, canAct: enemyCanAct }
    const second = playerFirst
      ? { action: enemyAction, pokemon: this.enemyActive, isPlayer: false, canAct: enemyCanAct }
      : { action: playerAction, pokemon: this.playerActive, isPlayer: true, canAct: playerCanAct }

    // 分析：标记本回合的行动顺序（后手方 movedLast=true，DamageCalc 据此 ×1.3）
    first.pokemon._abilityData = { ...first.pokemon._abilityData, movedLast: false }
    second.pokemon._abilityData = { ...second.pokemon._abilityData, movedLast: true }

    // 先攻方执行
    if (first.canAct) {
      events.push(...this.executeSingleAction(first.action, first.pokemon, first.isPlayer))
    }

    // 检查是否战斗结束
    const endResult = this.checkBattleEnd()
    if (endResult) {
      this.turnLog.push(events)
      return events
    }

    // 检查是否有宝可梦倒下
    if (this.enemyActive.fainted) {
      const abMsg = this.switchEnemy(events)
            events.push({ message: `对方派出 ${this.enemyActive.nameZh}！`, type: 'effect' })
      if (abMsg) events.push({ message: abMsg, type: 'effect', triggerSource: 'ability', triggerSide: 'enemy' })
    }
    if (this.playerActive.fainted) {
      this._needsPlayerSwitch = true
      if (!this.enemyActive.fainted) this.applyEndOfTurnStatus(this.enemyActive, events, 'enemy')
      this.turnLog.push(events)
      return events
    }

    // 后攻方执行（若后攻方在先攻方行动后已倒下，则本回合取消其行动；替补上场的宝可梦当回合不行动，符合主系列规则）
    if (second.canAct && !second.pokemon.fainted) {
      events.push(...this.executeSingleAction(second.action, second.pokemon, second.isPlayer))
    }

    // 再次检查战斗结束
    const endResult2 = this.checkBattleEnd()
    if (endResult2) {
      this.turnLog.push(events)
      return events
    }

    // 后攻后检查退场
    if (this.enemyActive.fainted) {
      const abMsg = this.switchEnemy(events)
      events.push({ message: `对方派出 ${this.enemyActive.nameZh}！`, type: 'effect' })
      if (abMsg) events.push({ message: abMsg, type: 'effect', triggerSource: 'ability', triggerSide: 'enemy' })
    }
    if (this.playerActive.fainted) {
      this._needsPlayerSwitch = true
      if (!this.enemyActive.fainted) this.applyEndOfTurnStatus(this.enemyActive, events, 'enemy')
      this.turnLog.push(events)
      return events
    }

    // 回合末异常状态伤害
    this.applyEndOfTurnStatus(this.playerActive, events, 'player')
    this.applyEndOfTurnStatus(this.enemyActive, events, 'enemy')

    // 回合末场地机制（寄生种子/扎根/光墙倒数）
    this.applyEndOfTurnField(events)

    // 检查异常状态导致的倒下
    if (this.checkBattleEnd()) {
      this.turnLog.push(events)
      return events
    }
    if (this.enemyActive.fainted) {
      const abMsg = this.switchEnemy(events)
      events.push({ message: `对方派出 ${this.enemyActive.nameZh}！`, type: 'effect' })
      if (abMsg) events.push({ message: abMsg, type: 'effect', triggerSource: 'ability', triggerSide: 'enemy' })
    }
    if (this.playerActive.fainted) {
      this._needsPlayerSwitch = true
    }

    this.turnLog.push(events)
    return events
  }

  /**
   * 计算最终命中率（Gen 5+ 公式）
   */
  private calcFinalAccuracy(move: Move, attacker: RecombinedPokemon, defender: RecombinedPokemon): number {
    // 神奇皮肤：受到变化招式时命中率降为 50（必须先于「必中招式」提前返回）
    let baseAcc = move.accuracy
    if (move.category === 'status'
      && defender.ability.name === 'wonder-skin'
      && !this.ignoresAbility(attacker)) {
      baseAcc = Math.min(baseAcc, 50)
    }

    if (baseAcc >= 100) return 100

    const accStage = attacker.statStages.accuracy
    const evaStage = defender.statStages.evasion
    const accMult = accStage >= 0 ? (3 + accStage) / 3 : 3 / (3 - accStage)
    const evaMult = evaStage >= 0 ? 3 / (3 + evaStage) : (3 - evaStage) / 3

    let acc = baseAcc * accMult * evaMult

    // 复眼：命中率 x1.3
    if (attacker.ability.name === 'compound-eyes') acc *= 1.3

    // 破格：无视防守方的闪避类特性
    const seesDefAbility = !this.ignoresAbility(attacker)

    // 沙隐/雪隐：沙暴/冰雹时闪避提升
    if (seesDefAbility && ((defender.ability.name === 'sand-veil' && this.weather === 'sandstorm') ||
        (defender.ability.name === 'snow-cloak' && this.weather === 'hail'))) {
      acc *= 0.8
    }

    // 无防守：双方攻击必定命中
    if (attacker.ability.name === 'no-guard' || (seesDefAbility && defender.ability.name === 'no-guard')) return 100

    // 蹒跚：混乱时闪避提升
    if (seesDefAbility && defender.ability.name === 'tangled-feet' && defender.confuseTurns && defender.confuseTurns > 0) {
      acc *= 0.5
    }

    // 活力：物理技能命中 x0.8
    if (attacker.ability.name === 'hustle' && move.category === 'physical') acc *= 0.8

    return acc
  }

  private executeSingleAction(
    action: TurnAction,
    attacker: RecombinedPokemon,
    isPlayer: boolean,
  ): TurnEvent[] {
    // 倒下的宝可梦无法行动（防御：防止已退场的宝可梦仍打出攻击事件）
    if (attacker.fainted) return []

    const events: TurnEvent[] = []

    if (action.type === 'switch') {
      // 主动换人：消耗当回合行动，执行真正的换人（离场/入场特性）
      if (isPlayer) {
        const ok = this.switchPlayer(action.targetIndex ?? 0, events)
        if (!ok) {
          events.push({ message: `${attacker.nameZh} 无法替换！`, type: 'fail' })
          return events
        }
      } else {
        const abMsg = this.switchEnemy(events)
        events.push({ message: `对方派出 ${this.enemyActive.nameZh}！`, type: 'effect', actionSide: 'enemy' })
        if (abMsg) events.push(this.abilityEvent(abMsg, 'enemy'))
        return events
      }
      events.push({ message: `${attacker.nameZh} 收回了！`, type: 'effect', actionSide: isPlayer ? 'player' : 'enemy' })
      events.push({ message: `上吧！${this.playerActive.nameZh}！`, type: 'effect', actionSide: 'player' })
      return events
    }

    const moveIdx = action.moveIndex ?? 0
    const move = attacker.moves[moveIdx]
    if (!move || move.currentPp <= 0) {
      events.push({ message: `${attacker.nameZh} 的 PP 用完了！`, type: 'fail' })
      return events
    }

    // T10 兜底：招式被挑衅/无理取闹/再来一次/定身法/封锁挡下（UI 与 AI 已过滤，此处防直传）
    // 若已经没有任何合法招式可用，则放行（等价于主系列「挣扎」兜底，避免死锁）
    const blockReason = this.moveBlockReason(attacker, moveIdx)
    if (blockReason && this.legalMoveIndices(this.getSide(attacker)).length > 0) {
      events.push({
        message: `${attacker.nameZh} 因${blockReason}无法使用 ${move.nameZh}！`,
        type: 'fail',
        actionSide: isPlayer ? 'player' : 'enemy',
      })
      return events
    }

    // 记录最后使用的招式（无理取闹 / 再来一次 / 定身法 依赖此字段）
    attacker._abilityData = { ...attacker._abilityData, lastMoveId: move.name }

    // 消耗 PP（压力特性消耗 2 点）
    const defender = isPlayer ? this.enemyActive : this.playerActive
    const ppCost = defender.ability.name === 'pressure' ? 2 : 1
    move.currentPp = Math.max(0, move.currentPp - ppCost)
    if (ppCost > 1) {
      events.push(this.abilityEvent(`由于 ${defender.nameZh} 的压力特性，${move.nameZh} 消耗了双倍 PP！`, isPlayer ? 'enemy' : 'player'))
    }

    const effect = getMoveEffect(move.name)

    // 必中检查
    const alwaysHit = effect?.kind === 'always-hit'

    // ----- 变化类技能 -----
    if (move.category === 'status') {
      // 恶作剧之心：变化招式对恶系目标无效（Gen 7+）
      if (attacker.ability.name === 'prankster' &&
          (defender.types[0] === Type.Dark || defender.types[1] === Type.Dark)) {
        events.push(this.abilityEvent(`对 ${defender.nameZh} 没有效果…（恶作剧之心对恶系无效）`, isPlayer ? 'player' : 'enemy', 'fail'))
        return events
      }

      // 粉尘免疫：草系宝可梦免疫粉尘类招式
      if (hasMoveTag(move.name, 'powder')) {
        if (defender.types[0] === Type.Grass || defender.types[1] === Type.Grass) {
          events.push(this.abilityEvent(`对 ${defender.nameZh} 没有效果…（草系免疫粉尘）`, isPlayer ? 'enemy' : 'player', 'fail'))
          return events
        }
        // 防尘特性：免疫粉尘类招式（破格可无视）
        if (defender.ability.name === 'overcoat' && !this.ignoresAbility(attacker)) {
          events.push(this.abilityEvent(`${defender.nameZh} 的防尘特性抵挡了粉尘！`, isPlayer ? 'enemy' : 'player'))
          return events
        }
      }

      if (this.isImmuneToMove(move, defender, attacker)) {
        events.push({ message: `对 ${defender.nameZh} 没有效果…`, type: 'fail' })
        return events
      }

      // 命中判定 (除非必中)
      if (!alwaysHit) {
        const acc = this.calcFinalAccuracy(move, attacker, defender)
        if (this.rng.next() * 100 >= acc) {
          events.push({ message: `${attacker.nameZh} 使用了 ${move.nameZh}`, type: 'effect', actionSide: isPlayer ? 'player' : 'enemy' })
          events.push({ message: '但是没有命中…', type: 'fail' })
          return events
        }
      }

      events.push({ message: `${attacker.nameZh} 使用了 ${move.nameZh}`, type: 'effect', actionSide: isPlayer ? 'player' : 'enemy' })

      // 处理变化技能效果
      this.applyStatusEffect(attacker, defender, move, effect, events)

      return events
    }

    // ----- 攻击类技能 -----
    // 电磁悬浮：浮空期间免疫地面系（非特性，破格无法无视）
    if (move.type === 'ground' && (defender._abilityData?.magnetRiseTurns ?? 0) > 0) {
      events.push({ message: `${defender.nameZh} 因电磁悬浮浮在空中，没有受到效果！`, type: 'fail' })
      return events
    }

    // 破格：无视防守方特性，直接跳过下面整段特性免疫/吸收判定
    const respectDefAbility = !this.ignoresAbility(attacker)
    if (respectDefAbility) {
    // 特性免疫检查（引火/飘浮/储水/蓄电）
    if (move.type === 'fire' && defender.ability.name === 'flash-fire') {
      defender._abilityData = { ...defender._abilityData, flashFireActivated: true }
      events.push(this.abilityEvent(`${defender.nameZh} 的引火特性吸收了火焰！`, isPlayer ? 'enemy' : 'player'))
      return events
    }
    if (move.type === 'ground' && defender.ability.name === 'levitate') {
      events.push(this.abilityEvent(`${defender.nameZh} 因飘浮特性浮在空中，没有受到效果！`, isPlayer ? 'enemy' : 'player', 'fail'))
      return events
    }
    if (move.type === 'water' && (defender.ability.name === 'water-absorb' || defender.ability.name === 'dry-skin')) {
      const heal = Math.floor(defender.maxHp * 0.25)
      defender.currentHp = Math.min(defender.maxHp, defender.currentHp + heal)
      events.push(this.abilityEvent(`${defender.nameZh} 吸收了水，回复了 ${heal} 点ＨＰ！`, isPlayer ? 'enemy' : 'player', 'heal'))
      return events
    }
    if (move.type === 'water' && defender.ability.name === 'storm-drain') {
      defender._abilityData = { ...defender._abilityData, stormDrainActivated: true }
      const heal = Math.floor(defender.maxHp * 0.25)
      defender.currentHp = Math.min(defender.maxHp, defender.currentHp + heal)
      events.push(this.abilityEvent(`${defender.nameZh} 的引水特性吸收了水，回复了 ${heal} 点ＨＰ！`, isPlayer ? 'enemy' : 'player', 'heal'))
      return events
    }
    if (move.type === 'grass' && defender.ability.name === 'sap-sipper') {
      defender._abilityData = { ...defender._abilityData, sapSipperActivated: true }
      events.push(this.abilityEvent(`${defender.nameZh} 的食草特性提升了攻击！`, isPlayer ? 'enemy' : 'player'))
      return events
    }
    if (move.type === 'electric' && defender.ability.name === 'motor-drive') {
      defender.statStages.speed = Math.min(6, (defender.statStages.speed || 0) + 1)
      events.push(this.abilityEvent(`${defender.nameZh} 的电动机特性提升了速度！`, isPlayer ? 'enemy' : 'player'))
      return events
    }
    if (move.type === 'electric' && (defender.ability.name === 'volt-absorb' || defender.ability.name === 'lightning-rod')) {
      defender._abilityData = { ...defender._abilityData, lightningRodActivated: true }
      const heal = Math.floor(defender.maxHp * 0.25)
      defender.currentHp = Math.min(defender.maxHp, defender.currentHp + heal)
      events.push(this.abilityEvent(`${defender.nameZh} 吸收了电，回复了 ${heal} 点ＨＰ！`, isPlayer ? 'enemy' : 'player', 'heal'))
      return events
    }
    } // end respectDefAbility

    if (this.isImmuneToMove(move, defender, attacker)) {
      events.push({ message: `对 ${defender.nameZh} 没有效果…`, type: 'fail' })
      return events
    }

    // 命中判定 (除非必中)
    if (!alwaysHit) {
      const acc = this.calcFinalAccuracy(move, attacker, defender)
      if (this.rng.next() * 100 >= acc) {
        events.push({ message: `${attacker.nameZh} 使用了 ${move.nameZh}`, type: 'effect', actionSide: isPlayer ? 'player' : 'enemy' })
        events.push({ message: '但是没有命中…', type: 'fail' })
        return events
      }
    }

    // ----- 守住/替身检查 -----
    if (defender._abilityData?.protected && (move.category as string) !== 'status') {
      events.push({ message: `${attacker.nameZh} 使用了 ${move.nameZh}`, type: 'effect', actionSide: isPlayer ? 'player' : 'enemy' })
      events.push({ message: `${defender.nameZh} 通过守住保护了自己！`, type: 'fail' })
      return events
    }

    // ----- 多段攻击（连续 2~5 次伤害判定）-----
    if (effect?.kind === 'multi-hit') {
      const hits = this.determineHits(effect.data.min, effect.data.max, attacker)
      let totalDamage = 0

      events.push({ message: `${attacker.nameZh} 使用了 ${move.nameZh}`, type: 'effect', actionSide: isPlayer ? 'player' : 'enemy' })

      const defSide = isPlayer ? 'enemy' : 'player'
      const scr = this.screenMultiplier(attacker, move, defSide)

      for (let i = 0; i < hits; i++) {
        if (defender.fainted) break

        // 每次命中有独立的随机因子
        const hitResult = calculateDamage(attacker, defender, move, this.effectiveWeather(), Math.random, this.fieldMods())
        const hitDamage = Math.max(1, Math.floor(hitResult.damage * scr.mod))
        const hasSub = !!defender._abilityData?.substituteHp && (move.category as string) !== 'status'

        // 替身吸收伤害
        let actualDamage = hitDamage
        if (hasSub) {
          const subHp = defender._abilityData!.substituteHp!
          if (actualDamage >= subHp) {
            defender._abilityData!.substituteHp = 0
            actualDamage = 0
          } else {
            defender._abilityData!.substituteHp = subHp - actualDamage
            actualDamage = 0
          }
        }

        defender.currentHp = Math.max(0, defender.currentHp - actualDamage)
        totalDamage += actualDamage

        // 防御方受击特性（每击独立触发）
        const hitCrit = hitResult.parts.some(p => p.label === '会心一击')
        if (actualDamage > 0) this.applyDefenderHitAbilities(defender, move, events, isPlayer, hitCrit, attacker)

        const hitSuffix = formatBreakdown(hitResult.parts) + (scr.mod !== 1 ? `（${scr.label}×0.5）` : '')
        events.push({ message: `第 ${i + 1} 击！造成 ${hitDamage} 点伤害${hitSuffix}`, type: 'damage', damage: hitDamage, targetSide: isPlayer ? 'enemy' : 'player' })

        // 替身消失提示
        if (hasSub && defender._abilityData!.substituteHp === 0) {
          events.push({ message: `${defender.nameZh} 的替身消失了！`, type: 'effect' })
        }

        // 每次命中可独立触发接触类特性（静电/毒刺/粗糙皮肤等）
        if (!attacker.fainted && !attacker.status) {
          this.applyContactAbility(attacker, defender, move, events, isPlayer)
        }

        // 每次命中可独立触发附加效果
        if (!defender.fainted) {
          this.applyAttackSecondaryEffect(attacker, defender, move, effect, events)
        }

        // 恶臭：10% 追加畏缩
        this.applyStenchFlinch(attacker, defender, events)

        if (defender.currentHp === 0) {
          // 挺住检查
          if (defender._abilityData?.enduring) {
            defender.currentHp = 1
            defender.fainted = false
            defender._abilityData.enduring = false
            events.push({ message: `${defender.nameZh} 挺住了攻击！`, type: 'effect' })
          } else {
            defender.fainted = true
            events.push({ message: `第 ${i + 1} 击！${defender.nameZh} 倒下了！`, type: 'effect', actionSide: isPlayer ? 'enemy' : 'player' })
            // 倒下结算：引爆（对攻击方反伤）→ 自信过剩（攻击方 +1）→ 同命
            this.applyFaintedDefenderAbilities(attacker, defender, move, events, isPlayer)
            this.applyKnockoutAbilities(attacker, defender, events, isPlayer)
            this.applyDestinyBond(attacker, defender, events)
            break
          }
        }
      }

      // 属性相性反馈
      const effMult = getTypeEffectiveness(move.type, defender.types)
      const effMsg = getEffectivenessText(effMult)
      if (effMsg) events.push({ message: effMsg, type: 'effect' })

      // 同步特性检查
      if (defender.ability.name === 'synchronize' && defender.status && !attacker.status && !attacker.fainted) {
        const syncable = ['burn', 'paralysis', 'poison'] as const
        if (syncable.includes(defender.status as any)) {
          attacker.status = defender.status
          const names: Record<string, string> = { burn: '烧伤', paralysis: '麻痹', poison: '中毒' }
          events.push(this.abilityEvent(`${attacker.nameZh} 因同步特性也被${names[defender.status] ?? defender.status}了！`, isPlayer ? 'enemy' : 'player', 'status'))
        }
      }

      // 充能类招式（多段攻击版，虽然游戏中不存在多段充能招式，但保留安全处理）
      if ((effect as { kind?: string } | undefined)?.kind === 'recharge') {
        attacker._abilityData = { ...attacker._abilityData, mustRecharge: true }
      }

      return events
    }

    // 计算伤害（含特性/天气/属性克制等加成，返回倍率明细）
    const wasAtFullHp = defender.currentHp === defender.maxHp
    const dmgResult = calculateDamage(attacker, defender, move, this.effectiveWeather(), Math.random, this.fieldMods())
    const rawDamage = dmgResult.damage
    let dmgSuffix = formatBreakdown(dmgResult.parts)
    const hasSub = !!defender._abilityData?.substituteHp && (move.category as string) !== 'status'

    // 反射壁/光墙减伤
    const defSide = isPlayer ? 'enemy' : 'player'
    const scr = this.screenMultiplier(attacker, move, defSide)
    let damage = rawDamage * scr.mod
    if (scr.mod !== 1) dmgSuffix += `（${scr.label}×0.5）`

    // 神奇守护：仅效果绝佳（×2）的招式能造成伤害，其余相性伤害归零（破格可无视）
    if (defender.ability.name === 'wonder-guard' && respectDefAbility) {
      const wgEff = getTypeEffectiveness(move.type, defender.types)
      if (wgEff < 2) {
        damage = 0
      }
    }

    if (hasSub) {
      const subHp = defender._abilityData!.substituteHp!
      if (damage >= subHp) {
        defender._abilityData!.substituteHp = 0
        damage = 0 // 剩余伤害不穿透替身（简化处理）
      } else {
        defender._abilityData!.substituteHp = subHp - damage
        damage = 0
      }
    }

    defender.currentHp = Math.max(0, defender.currentHp - damage)

    // 防御方受击特性（愤怒穴位/正义之心/碎裂铠甲/胆怯）
    const isCritical = dmgResult.parts.some(p => p.label === '会心一击')
    this.applyDefenderHitAbilities(defender, move, events, isPlayer, isCritical, attacker)

    // 结实：满血时抵挡一击必杀（保留 1 HP，破格可无视）
    if (defender.currentHp === 0 && defender.ability.name === 'sturdy' && wasAtFullHp && respectDefAbility) {
      defender.currentHp = 1
      defender.fainted = false
      events.push(this.abilityEvent(`${defender.nameZh} 的结实特性抵挡住了攻击！`, isPlayer ? 'enemy' : 'player'))
    }

    // 挺住：本回合必定保留 1 HP
    if (defender.currentHp === 0 && defender._abilityData?.enduring) {
      defender.currentHp = 1
      defender.fainted = false
      defender._abilityData.enduring = false
      events.push({ message: `${defender.nameZh} 挺住了攻击！`, type: 'effect' })
    }

    if (defender.currentHp === 0) {
      defender.fainted = true
    }

    events.push({ message: `${attacker.nameZh} 使用了 ${move.nameZh}`, type: 'effect', actionSide: isPlayer ? 'player' : 'enemy' })
    if (hasSub) {
      // 替身相关消息
      if (defender._abilityData!.substituteHp === 0) {
        events.push({ message: `${defender.nameZh} 的替身抵挡了攻击并消失了！`, type: 'effect' })
      } else {
        events.push({ message: `${defender.nameZh} 的替身承受了 ${rawDamage} 点伤害！${dmgSuffix}`, type: 'damage', damage: rawDamage, targetSide: isPlayer ? 'enemy' : 'player' })
      }
    } else {
      if (defender.ability.name === 'wonder-guard' && respectDefAbility && damage === 0) {
        events.push({ message: `对 ${defender.nameZh} 没有效果（神奇守护）！`, type: 'damage', damage: 0, targetSide: isPlayer ? 'enemy' : 'player' })
      } else {
        events.push({ message: `造成 ${damage} 点伤害${dmgSuffix}`, type: 'damage', damage, targetSide: isPlayer ? 'enemy' : 'player' })
      }
    }

    // 属性相性反馈
    const effMult = getTypeEffectiveness(move.type, defender.types)
    const effMsg = getEffectivenessText(effMult)
    if (effMsg) {
      events.push({ message: effMsg, type: 'effect' })
    }

    // 变色：被招式命中后属性变为该招式属性（破格可无视）
    // 注：此处 move.category 已收窄为 physical|special，无需再排除 status
    if (defender.ability.name === 'color-change' && respectDefAbility && !this.isImmuneToMove(move, defender, attacker)) {
      defender.types = [move.type, null]
      events.push(this.abilityEvent(
        `${defender.nameZh} 的变色特性发动，属性变成了 ${getTypeZh(move.type)}！`,
        isPlayer ? 'enemy' : 'player',
      ))
    }

    // ----- 吸取效果 -----
    if (effect?.kind === 'drain' && damage > 0 && !attacker.fainted) {
      const healAmount = Math.max(1, Math.floor(damage * effect.data.ratio))
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healAmount)
      // 储液：吸取招式会伤害攻击者（破格可无视）
    if (defender.ability.name === 'liquid-ooze' && respectDefAbility && attacker.ability.name !== 'magic-guard') {
      attacker.currentHp = Math.max(0, attacker.currentHp - healAmount)
      events.push({ ...this.abilityEvent(`${defender.nameZh} 的储液特性让 ${attacker.nameZh} 受到了 ${healAmount} 点反伤！`, isPlayer ? 'enemy' : 'player', 'damage'), targetSide: isPlayer ? 'player' : 'enemy' })
      if (attacker.currentHp === 0) attacker.fainted = true
    } else {
      events.push({ message: `${attacker.nameZh} 吸收了 ${healAmount} 点ＨＰ！`, type: 'heal' })
    }
    }

    // ----- 反伤效果 -----
    if (effect?.kind === 'recoil' && damage > 0 && !attacker.fainted) {
      // 石头脑袋：不受反伤
      if (attacker.ability.name !== 'rock-head') {
        const recoilDamage = Math.max(1, Math.floor(damage * effect.data.ratio))
        attacker.currentHp = Math.max(0, attacker.currentHp - recoilDamage)
        events.push({ message: `${attacker.nameZh} 受到了 ${recoilDamage} 点反伤！`, type: 'damage', damage: recoilDamage, targetSide: isPlayer ? 'player' : 'enemy' })
        if (attacker.currentHp === 0) {
          attacker.fainted = true
          events.push({ message: `${attacker.nameZh} 倒下了！`, type: 'effect', actionSide: isPlayer ? 'player' : 'enemy' })
        }
      }
    }

    // ----- 接触类特性效果（防守方特性触发）-----
    if (!attacker.fainted && !attacker.status) {
      this.applyContactAbility(attacker, defender, move, events, isPlayer)
    }

    // ----- 技能附加效果（攻击方技能触发）-----
    if (!defender.fainted) {
      this.applyAttackSecondaryEffect(attacker, defender, move, effect, events)
    }

    // ----- 恶臭：10% 追加畏缩 -----
    this.applyStenchFlinch(attacker, defender, events)

    // ----- 同步特性：对方将异常状态传递给我方（破格可无视）-----
    if (defender.ability.name === 'synchronize' && respectDefAbility && defender.status && !attacker.status && !attacker.fainted) {
      const syncable = ['burn', 'paralysis', 'poison'] as const
      if (syncable.includes(defender.status as any)) {
        attacker.status = defender.status
        const names: Record<string, string> = { burn: '烧伤', paralysis: '麻痹', poison: '中毒' }
        events.push(this.abilityEvent(`${attacker.nameZh} 因同步特性也被${names[defender.status] ?? defender.status}了！`, isPlayer ? 'enemy' : 'player', 'status'))
      }
    }

    if (defender.fainted) {
      events.push({ message: `${defender.nameZh} 倒下了！`, type: 'effect', actionSide: isPlayer ? 'enemy' : 'player' })
      // 倒下结算：引爆（对攻击方反伤）→ 自信过剩（攻击方 +1）→ 同命
      this.applyFaintedDefenderAbilities(attacker, defender, move, events, isPlayer)
      this.applyKnockoutAbilities(attacker, defender, events, isPlayer)
      this.applyDestinyBond(attacker, defender, events)
    }

    // 充能类招式（破坏光线等）：使用后需要充能一回合
    if (effect?.kind === 'recharge') {
      attacker._abilityData = { ...attacker._abilityData, mustRecharge: true }
    }

    return events
  }

  /**
   * 应用攻击技能的附加效果（数据驱动）
   */
  private applyAttackSecondaryEffect(
    _attacker: RecombinedPokemon,
    defender: RecombinedPokemon,
    move: Move,
    effect: ReturnType<typeof getMoveEffect>,
    events: TurnEvent[],
  ): void {
    if (defender.fainted || effect?.kind !== 'attack-secondary') return

    const { data } = effect
    let chance = data.chance

    // 龙尾：造成伤害后把对手吹飞换人（不受鳞粉/强行影响）
    if (move.name === 'dragon-tail') {
      this.forceSwitchOut(defender, events, move.nameZh)
      return
    }

    // 破格：无视防守方的附加效果防护特性
    const respectDefAbility = !this.ignoresAbility(_attacker)
    // 鳞粉：不受附加效果影响
    if (respectDefAbility && defender.ability.name === 'shield-dust') return
    // 精神力：不会畏缩
    if (respectDefAbility && defender.ability.name === 'inner-focus' && data.status === 'flinch') return
    // 强行：附加效果被抑制（威力已在伤害计算中提升）
    if (_attacker.ability.name === 'sheer-force') return

    // 天恩：附加效果概率翻倍
    if (_attacker.ability.name === 'serene-grace') chance *= 2

    const roll = this.rng.next() * 100

    // 畏缩特殊处理（非持久异常状态，用独立标记）
    if (data.status === 'flinch' && roll < chance) {
      this.inflictFlinch(defender, events)
      return
    }

    // 束缚特殊处理（火焰旋涡/绑紧/紧束等）：4~5 回合无法换人且每回合末扣 1/8
    if (data.status === 'trap' && roll < chance) {
      if (!defender._abilityData?.trapTurns) {
        const turns = 4 + Math.floor(this.rng.next() * 2)
        defender._abilityData = {
          ...defender._abilityData,
          trapTurns: turns,
          trapMoveZh: move.nameZh,
        }
        events.push({ message: `${defender.nameZh} 被${move.nameZh}束缚住了！`, type: 'status' })
      }
      return
    }

    // 异常状态
    if (data.status && roll < chance) {
      // 三攻击特殊处理：随机一种
      if (data.status === 'tri-status') {
        if (!defender.status) {
          const effects = ['burn', 'freeze', 'paralysis'] as const
          const chosen = effects[Math.floor(this.rng.next() * 3)]
          this.inflictStatus(defender, chosen, events, !respectDefAbility)
        }
        return
      }
      // 混乱特殊处理
      if (data.status === 'confuse' && !defender.confuseTurns) {
        // 自我中心/迟钝：不会混乱（破格可无视）
        if (respectDefAbility
          && (defender.ability.name === 'own-tempo' || defender.ability.name === 'oblivious')) {
          const abZh = defender.ability.name === 'oblivious' ? '迟钝' : '自我中心'
          events.push(this.abilityEvent(`${defender.nameZh} 的${abZh}特性防止了混乱！`, this.getSide(defender), 'fail'))
          return
        }
        defender.confuseTurns = 2 + Math.floor(this.rng.next() * 3)
        events.push({ message: `${defender.nameZh} 混乱了！`, type: 'status' })
        return
      }
      if (!defender.status) {
        if (data.status === 'flinch' || data.status === 'confuse') return
        this.inflictStatus(defender, data.status as StatusCondition, events, !respectDefAbility)
        return // 一次附加效果只触发一种
      }
    }

    // 能力变化（多段变化同时触发，如 ancient-power）
    if (data.statChanges) {
      for (const change of data.statChanges) {
        if (roll < chance && change.chance >= 100) {
          const target = change.target === 'self' ? _attacker : defender
          const targetName = change.target === 'self' ? target.nameZh : defender.nameZh
          if (change.stages > 0) {
            const msg = this.raiseStat(target, change.stat as any, change.stages)
            if (msg) events.push({ message: msg, type: 'status' })
          } else {
            const msg = this.lowerStat(target, change.stat as any, -change.stages)
            if (msg) events.push({ message: msg, type: 'status' })
          }
        }
      }
    }
  }

  /**
   * 应用变化类技能效果（数据驱动）
   */
  private applyStatusEffect(
    attacker: RecombinedPokemon,
    defender: RecombinedPokemon,
    move: Move,
    effect: ReturnType<typeof getMoveEffect>,
    events: TurnEvent[],
  ): void {
    // 魔法镜：把对手打过来的「针对对方」的变化招式原样反弹回去
    if (!this._bouncing
      && move.category === 'status'
      && defender.ability.name === 'magic-bounce'
      && !this.ignoresAbility(attacker)
      && this.targetsOpponent(move, effect)) {
      events.push(this.abilityEvent(
        `${defender.nameZh} 的魔法镜反弹了 ${move.nameZh}！`, this.getSide(defender),
      ))
      this._bouncing = true
      try {
        // 攻守互换：由原防守方对原使用者施放同一招式
        this.applyStatusEffect(defender, attacker, move, effect, events)
      } finally {
        this._bouncing = false
      }
      return
    }

    // 特殊处理：睡觉（全回复 + 睡眠）
    if (move.name === 'rest') {
      attacker.currentHp = attacker.maxHp
      attacker.status = 'sleep'
      attacker.statusTurns = 2
      events.push({ message: `${attacker.nameZh} 回复了全部ＨＰ并睡着了！`, type: 'heal' })
      return
    }

    // 特殊处理：天气变化招式
    const weatherMap: Record<string, 'sun' | 'rain' | 'sandstorm' | 'hail'> = {
      'sunny-day': 'sun',
      'rain-dance': 'rain',
      'sandstorm': 'sandstorm',
      'hail': 'hail',
      'snowscape': 'hail',
    }
    if (move.name in weatherMap) {
      this.weather = weatherMap[move.name]
      const weatherNames: Record<string, string> = {
        sun: '阳光变得强烈了',
        rain: '下起了大雨',
        sandstorm: '刮起了沙暴',
        hail: '下起了冰雹',
      }
      events.push({ message: `天气变成了${weatherNames[this.weather]}！`, type: 'effect' })
      return
    }

    // 特殊处理：守住/见切（本回合免疫攻击）
    if (move.name === 'protect' || move.name === 'detect') {
      attacker._abilityData = { ...attacker._abilityData, protected: true }
      events.push({ message: `${attacker.nameZh} 使用了${move.nameZh}，保护了自己！`, type: 'effect' })
      return
    }

    // 特殊处理：挺住（本回合不会倒下）
    if (move.name === 'endure') {
      attacker._abilityData = { ...attacker._abilityData, enduring: true }
      events.push({ message: `${attacker.nameZh} 使用了挺住！`, type: 'effect' })
      return
    }

    // 特殊处理：替身（消耗 1/4 HP 制造分身）
    if (move.name === 'substitute') {
      const cost = Math.max(1, Math.floor(attacker.maxHp / 4))
      if (attacker.currentHp > cost) {
        attacker.currentHp -= cost
        attacker._abilityData = { ...attacker._abilityData, substituteHp: Math.floor(attacker.maxHp / 4) }
        events.push({ message: `${attacker.nameZh} 消耗了 ${cost} 点ＨＰ制造了替身！`, type: 'effect' })
      } else {
        events.push({ message: '但是ＨＰ不足，无法制造替身…', type: 'fail' })
      }
      return
    }

    // ---- 撒钉 / 寄生 / 场地类（特殊分发，先于通用处理）----
    const isMine = this.getSide(attacker) === 'player'
    if (move.name === 'leech-seed') {
      defender._abilityData = { ...defender._abilityData, leechSeed: true }
      events.push({ message: `${defender.nameZh} 被寄生种子缠住了！`, type: 'effect' })
      return
    }
    if (move.name === 'ingrain') {
      attacker._abilityData = { ...attacker._abilityData, ingrain: true }
      events.push({ message: `${attacker.nameZh} 扎根了！`, type: 'effect' })
      return
    }
    if (move.name === 'spikes') {
      const haz = isMine ? this.enemyHazards : this.playerHazards
      haz.spikes = Math.min(3, haz.spikes + 1)
      events.push({ message: `场上布下了撒菱！`, type: 'effect' })
      return
    }
    if (move.name === 'toxic-spikes') {
      const haz = isMine ? this.enemyHazards : this.playerHazards
      haz.toxicSpikes = Math.min(2, haz.toxicSpikes + 1)
      events.push({ message: `场上布下了毒菱！`, type: 'effect' })
      return
    }
    if (move.name === 'stealth-rock') {
      const haz = isMine ? this.enemyHazards : this.playerHazards
      haz.stealthRock = true
      events.push({ message: `场上布下了隐形岩！`, type: 'effect' })
      return
    }
    if (move.name === 'reflect') {
      const scr = isMine ? this.playerScreens : this.enemyScreens
      scr.reflect = 5
      events.push({ message: `${attacker.nameZh} 建起了反射壁！`, type: 'effect' })
      return
    }
    if (move.name === 'light-screen') {
      const scr = isMine ? this.playerScreens : this.enemyScreens
      scr.lightScreen = 5
      events.push({ message: `${attacker.nameZh} 建起了光墙！`, type: 'effect' })
      return
    }
    if (move.name === 'safeguard') {
      const scr = isMine ? this.playerScreens : this.enemyScreens
      scr.safeguard = 5
      events.push({ message: `${attacker.nameZh} 被神秘守护守护着！`, type: 'effect' })
      return
    }

    // ---- 回复类 ----
    // 精神觉醒：治愈自身中毒/烧伤/麻痹
    if (move.name === 'refresh') {
      if (attacker.status === 'poison' || attacker.status === 'bad_poison'
        || attacker.status === 'burn' || attacker.status === 'paralysis') {
        attacker.status = null
        attacker.statusTurns = undefined
        events.push({ message: `${attacker.nameZh} 变得精神了，异常状态被治愈了！`, type: 'heal' })
      } else {
        events.push({ message: '但是没有效果…', type: 'fail' })
      }
      return
    }
    // 治愈铃声：治愈己方全队异常状态
    if (move.name === 'heal-bell') {
      const team = isMine ? this.playerTeam : this.enemyTeam
      let cured = 0
      for (const m of team) {
        if (!m.fainted && m.status) { m.status = null; m.statusTurns = undefined; cured++ }
      }
      events.push(cured > 0
        ? { message: `铃声回响，我方 ${cured} 只宝可梦的异常状态被治愈了！`, type: 'heal' }
        : { message: '但是没有效果…', type: 'fail' })
      return
    }
    // 治愈波动：回复目标 1/2 最大 HP（此处目标为对手，符合数据定义）
    if (move.name === 'heal-pulse') {
      if (defender.currentHp >= defender.maxHp) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      const heal = Math.max(1, Math.floor(defender.maxHp / 2))
      defender.currentHp = Math.min(defender.maxHp, defender.currentHp + heal)
      events.push({ message: `${defender.nameZh} 回复了 ${heal} 点ＨＰ！`, type: 'heal' })
      return
    }
    // 祈愿：下回合末回复 1/2 最大 HP
    if (move.name === 'wish') {
      if (attacker._abilityData?.wishTurns) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      attacker._abilityData = {
        ...attacker._abilityData,
        wishTurns: 2,
        wishHeal: Math.max(1, Math.floor(attacker.maxHp / 2)),
      }
      events.push({ message: `${attacker.nameZh} 许下了愿望！`, type: 'effect' })
      return
    }
    // 水流环：每回合末回复 1/16 最大 HP
    if (move.name === 'aqua-ring') {
      if (attacker._abilityData?.aquaRing) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      attacker._abilityData = { ...attacker._abilityData, aquaRing: true }
      events.push({ message: `${attacker.nameZh} 在身体周围张开了水流形成的帷幕！`, type: 'effect' })
      return
    }

    // ---- 强制换人：吼叫 / 吹飞 ----
    if (move.name === 'roar' || move.name === 'whirlwind') {
      const forced = this.forceSwitchOut(defender, events, move.nameZh)
      if (!forced) events.push({ message: '但是没有效果…', type: 'fail' })
      return
    }

    // ==================== T10：封锁 / 场地 / 计时类招式 ====================

    // 挑衅：3 回合内对手只能使用攻击招式
    if (move.name === 'taunt') {
      if ((defender._abilityData?.tauntTurns ?? 0) > 0) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      defender._abilityData = { ...defender._abilityData, tauntTurns: 3 }
      events.push({ message: `${defender.nameZh} 被挑衅了，无法使用变化招式！`, type: 'status' })
      return
    }

    // 无理取闹：对手不能连续两次使用同一招
    if (move.name === 'torment') {
      if (defender._abilityData?.torment === true) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      defender._abilityData = { ...defender._abilityData, torment: true }
      events.push({ message: `${defender.nameZh} 开始无理取闹，无法连续使用同一招式！`, type: 'status' })
      return
    }

    // 再来一次：对手 3 回合内被迫重复上一招
    if (move.name === 'encore') {
      const lastId = defender._abilityData?.lastMoveId
      const forced = lastId ? defender.moves.find(m => m && m.name === lastId) : undefined
      if ((defender._abilityData?.encoreTurns ?? 0) > 0 || !lastId || !forced || forced.currentPp <= 0) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      defender._abilityData = { ...defender._abilityData, encoreTurns: 3, encoreMoveId: lastId }
      events.push({ message: `${defender.nameZh} 被迫连续使用 ${forced.nameZh}！`, type: 'status' })
      return
    }

    // 定身法：对手上一招 4 回合内无法使用
    if (move.name === 'disable') {
      const lastId = defender._abilityData?.lastMoveId
      const target = lastId ? defender.moves.find(m => m && m.name === lastId) : undefined
      if ((defender._abilityData?.disableTurns ?? 0) > 0 || !lastId || !target) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      defender._abilityData = { ...defender._abilityData, disableTurns: 4, disabledMoveId: lastId }
      events.push({ message: `${defender.nameZh} 的 ${target.nameZh} 被定身法封住了！`, type: 'status' })
      return
    }

    // 封锁：双方都不能使用「彼此都会」的招式
    if (move.name === 'imprison') {
      if (attacker._abilityData?.imprison === true) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      attacker._abilityData = { ...attacker._abilityData, imprison: true }
      events.push({ message: `${attacker.nameZh} 封印了双方共通的招式！`, type: 'status' })
      return
    }

    // 白雾：清除双方全部能力等级变化
    if (move.name === 'haze') {
      for (const p of [this.playerActive, this.enemyActive]) {
        p.statStages = {
          attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0,
        }
      }
      events.push({ message: '白雾消除了双方所有的能力变化！', type: 'effect' })
      return
    }

    // 清雾：目标命中 -1，并清除目标侧的场地危险与屏障
    if (move.name === 'defog') {
      const msg = this.lowerStat(defender, 'accuracy', 1)
      if (msg) events.push({ message: msg, type: 'status' })
      const haz = isMine ? this.enemyHazards : this.playerHazards
      const scr = isMine ? this.enemyScreens : this.playerScreens
      haz.spikes = 0
      haz.toxicSpikes = 0
      haz.stealthRock = false
      scr.reflect = 0
      scr.lightScreen = 0
      scr.safeguard = 0
      events.push({ message: '场上的障碍物被吹飞了！', type: 'effect' })
      return
    }

    // 接力棒：换人并把能力等级（与部分易失状态）交给替补
    if (move.name === 'baton-pass') {
      if (!this.batonPassSwitch(attacker, events)) {
        events.push({ message: '但是没有效果…', type: 'fail' })
      }
      return
    }

    // 黑眼神：对手无法换人（不自然消退）
    if (move.name === 'mean-look') {
      if (defender._abilityData?.trappedByMeanLook === true) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      defender._abilityData = { ...defender._abilityData, trappedByMeanLook: true }
      events.push({ message: `${defender.nameZh} 被黑眼神死死盯住，无法逃走了！`, type: 'status' })
      return
    }

    // 灭亡之歌：双方 3 回合后同时倒下
    if (move.name === 'perish-song') {
      let applied = false
      for (const p of [this.playerActive, this.enemyActive]) {
        if (p.fainted) continue
        if ((p._abilityData?.perishTurns ?? 0) > 0) continue
        p._abilityData = { ...p._abilityData, perishTurns: 3 }
        applied = true
      }
      events.push(applied
        ? { message: '所有听到灭亡之歌的宝可梦将在 3 回合后倒下！', type: 'status' }
        : { message: '但是没有效果…', type: 'fail' })
      return
    }

    // 电磁悬浮：5 回合内浮空（免疫地面系）
    if (move.name === 'magnet-rise') {
      if ((attacker._abilityData?.magnetRiseTurns ?? 0) > 0) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      attacker._abilityData = { ...attacker._abilityData, magnetRiseTurns: 5 }
      events.push({ message: `${attacker.nameZh} 借助电磁力浮了起来！`, type: 'effect' })
      return
    }

    // 同命：本回合内使用者若倒下，对手一同倒下
    if (move.name === 'destiny-bond') {
      attacker._abilityData = { ...attacker._abilityData, destinyBond: true }
      events.push({ message: `${attacker.nameZh} 准备与对手同归于尽！`, type: 'effect' })
      return
    }

    // 玩水：5 回合内火系招式伤害减半
    if (move.name === 'water-sport') {
      if (this.waterSportTurns > 0) {
        events.push({ message: '但是没有效果…', type: 'fail' })
        return
      }
      this.waterSportTurns = 5
      events.push({ message: '水滴洒满了战场，火系招式威力被削弱了！', type: 'effect' })
      return
    }

    if (!effect || effect.kind !== 'status') {
      // 未定义效果的变化技能：只显示使用成功
      return
    }

    const data = effect.data

    // 异常状态
    if (data.inflictStatus && !defender.status) {
      this.inflictStatus(defender, data.inflictStatus, events, this.ignoresAbility(attacker))
    }

    // 混乱
    if (data.confuse && !defender.confuseTurns) {
      const respectDefAbility = !this.ignoresAbility(attacker)
      if (respectDefAbility && (defender.ability.name === 'own-tempo' || defender.ability.name === 'oblivious')) {
        const abZh = defender.ability.name === 'oblivious' ? '迟钝' : '自我中心'
        events.push(this.abilityEvent(`${defender.nameZh} 的${abZh}特性防止了混乱！`, this.getSide(defender), 'fail'))
        return
      }
      defender.confuseTurns = 2 + Math.floor(this.rng.next() * 3) // 2-4 回合
      events.push({ message: `${defender.nameZh} 混乱了！`, type: 'status' })
    }

    // 对敌能力变化
    if (data.enemyStatChanges) {
      for (const change of data.enemyStatChanges) {
        if (change.stages < 0) {
          const msg = this.lowerStat(defender, change.stat as any, -change.stages)
          if (msg) events.push({ message: msg, type: 'status' })
        } else {
          const msg = this.raiseStat(defender, change.stat as any, change.stages)
          if (msg) events.push({ message: msg, type: 'status' })
        }
      }
    }

    // 己身能力变化
    if (data.selfStatChanges) {
      for (const change of data.selfStatChanges) {
        if (change.stages < 0) {
          const msg = this.lowerStat(attacker, change.stat as any, -change.stages)
          if (msg) events.push({ message: msg, type: 'status' })
        } else if (change.stages > 0) {
          const msg = this.raiseStat(attacker, change.stat as any, change.stages)
          if (msg) events.push({ message: msg, type: 'status' })
        }
      }
    }

    // 回复效果
    if (data.healRatio && attacker.currentHp < attacker.maxHp) {
      const healAmount = Math.floor(attacker.maxHp * data.healRatio)
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healAmount)
      events.push({ message: `${attacker.nameZh} 回复了 ${healAmount} 点ＨＰ！`, type: 'heal' })
    }
  }

  /** 作用于自己/己方的变化招式：魔法镜不反弹这些 */
  private static readonly SELF_TARGET_STATUS_MOVES = new Set([
    'rest', 'protect', 'detect', 'endure', 'substitute', 'ingrain', 'aqua-ring',
    'wish', 'refresh', 'heal-bell', 'heal-pulse',
    'sunny-day', 'rain-dance', 'sandstorm', 'hail', 'snowscape',
    'reflect', 'light-screen', 'safeguard',
    // T10：作用于自身/全场的招式，魔法镜不反弹
    'haze', 'baton-pass', 'perish-song', 'magnet-rise', 'destiny-bond',
    'imprison', 'water-sport',
  ])

  /** 显式作用于对手、但效果数据里体现不出来的变化招式 */
  private static readonly OPPONENT_TARGET_STATUS_MOVES = new Set([
    'leech-seed', 'spikes', 'toxic-spikes', 'stealth-rock',
    'roar', 'whirlwind', 'taunt', 'torment', 'encore', 'disable', 'mean-look',
    'defog',
  ])

  /** 判断变化招式是否作用于对手（魔法镜只反弹这类） */
  private targetsOpponent(move: Move, effect: ReturnType<typeof getMoveEffect>): boolean {
    if (BattleEngine.SELF_TARGET_STATUS_MOVES.has(move.name)) return false
    if (BattleEngine.OPPONENT_TARGET_STATUS_MOVES.has(move.name)) return true
    if (effect?.kind === 'status') {
      const d = effect.data
      if (d.inflictStatus || d.confuse || (d.enemyStatChanges && d.enemyStatChanges.length > 0)) return true
    }
    return false
  }

  /**
   * 赋予异常状态（带提示和特性免疫检查）
   * @param bypassAbility 破格：无视目标的特性免疫
   */
  private inflictStatus(
    pkm: RecombinedPokemon,
    status: StatusCondition,
    events: TurnEvent[],
    bypassAbility = false,
  ): boolean {
    // 特性免疫检查
    const immunityMap: Partial<Record<StatusCondition, string[]>> = {
      sleep: ['insomnia', 'vital-spirit'],
      poison: ['immunity'],
      burn: ['water-veil'],
      freeze: ['magma-armor'],
      paralysis: ['limber', 'static'], // static doesn't prevent, but limber does
    }
    const blockers = bypassAbility ? undefined : immunityMap[status]
    if (blockers?.some(a => pkm.ability.name === a)) {
      const msgMap: Record<string, string> = {
        insomnia: '因不眠特性无法入睡！', 'vital-spirit': '因干劲特性无法入睡！',
        immunity: '因免疫特性不会中毒！', 'water-veil': '因水幕特性不会烧伤！',
        'magma-armor': '因熔岩铠甲特性不会冰冻！', limber: '因柔软特性不会麻痹！',
      }
      const found = blockers.find(a => pkm.ability.name === a)
      if (found) events.push(this.abilityEvent(msgMap[found] ?? '特性阻止了异常状态！', this.getSide(pkm), 'fail'))
      return false
    }

    // 叶子防守：晴天时免疫所有异常状态
    if (!bypassAbility && pkm.ability.name === 'leaf-guard' && this.effectiveWeather() === 'sun') {
      events.push(this.abilityEvent(`${pkm.nameZh} 的叶子防守在阳光下挡下了异常状态！`, this.getSide(pkm), 'fail'))
      return false
    }

    // 神秘守护（safeguard）：本边处于守护状态时免疫异常状态
    const gside = this.getSide(pkm)
    const gscr = gside === 'player' ? this.playerScreens : this.enemyScreens
    if (gscr.safeguard > 0) {
      events.push({ message: `${pkm.nameZh} 被神秘守护保护，没有陷入异常！`, type: 'fail' })
      return false
    }

    // 同步：当被赋予异常状态时，攻击方也获得相同状态
    // 此检查在 inflictStatus 中实现被动触发，但同步是攻击方对防御方施加时才触发
    // 同步逻辑在 executeSingleAction 中对方特性效果后处理

    pkm.status = status
    // 早起：睡眠回合减半
    if (status === 'sleep') {
      pkm.statusTurns = pkm.ability.name === 'early-bird' ? 1 : 2
    }
    const names: Record<string, string> = {
      burn: '烧伤', freeze: '冰冻', paralysis: '麻痹', poison: '中毒',
      bad_poison: '剧毒', sleep: '睡着了',
    }
    events.push({ message: `${pkm.nameZh} ${names[status] ?? status}了！`, type: 'status' })
    return true
  }

  /**
   * 接触类特性触发
   */
  private applyContactAbility(
    attacker: RecombinedPokemon,
    defender: RecombinedPokemon,
    move: Move,
    events: TurnEvent[],
    isPlayer: boolean,
  ): void {
    if (!isContactMove(move.name)) return
    // 破格：无视防守方接触类特性
    if (this.ignoresAbility(attacker)) return

    const ability = defender.ability.name
    const side = isPlayer ? 'enemy' : 'player'
    const roll = this.rng.next()
    const statusZh: Record<string, string> = {
      paralysis: '麻痹', poison: '中毒', sleep: '睡眠',
    }

    if (ability === 'static' && roll < 0.3 && !attacker.status) {
      attacker.status = 'paralysis'
      events.push(this.abilityEvent(`${attacker.nameZh} 被 ${defender.nameZh} 的静电麻痹了！`, side, 'status'))
    } else if (ability === 'poison-point' && roll < 0.3 && !attacker.status) {
      attacker.status = 'poison'
      events.push(this.abilityEvent(`${attacker.nameZh} 被 ${defender.nameZh} 的毒刺中毒了！`, side, 'status'))
    } else if (ability === 'flame-body' && roll < 0.3 && !attacker.status) {
      attacker.status = 'burn'
      events.push(this.abilityEvent(`${attacker.nameZh} 被 ${defender.nameZh} 的火焰之躯烧伤了！`, side, 'status'))
    } else if (ability === 'poison-touch' && roll < 0.3 && !attacker.status) {
      attacker.status = 'poison'
      events.push(this.abilityEvent(`${attacker.nameZh} 被 ${defender.nameZh} 的毒手中毒了！`, side, 'status'))
    } else if (ability === 'effect-spore' && roll < 0.3 && !attacker.status) {
      const effects: StatusCondition[] = ['paralysis', 'poison', 'sleep']
      const effect = effects[Math.floor(this.rng.next() * 3)]
      attacker.status = effect
      events.push(this.abilityEvent(`${attacker.nameZh} 被 ${defender.nameZh} 的孢子${statusZh[effect] ?? ''}了！`, side, 'status'))
    } else if (ability === 'cute-charm' && roll < 0.3) {
      events.push(this.abilityEvent(`${attacker.nameZh} 被 ${defender.nameZh} 的迷人之躯迷惑了！`, side, 'status'))
    }

    // 粗糙皮肤：接触即受伤（不依赖概率）
    if (ability === 'rough-skin') {
      const dmg = Math.max(1, Math.floor(attacker.maxHp / 8))
      attacker.currentHp = Math.max(0, attacker.currentHp - dmg)
      events.push({ ...this.abilityEvent(`${attacker.nameZh} 被 ${defender.nameZh} 的粗糙皮肤划伤，受到了 ${dmg} 点伤害！`, side, 'damage'), targetSide: isPlayer ? 'player' : 'enemy' })
      if (attacker.currentHp === 0) attacker.fainted = true
    }
  }

  /**
   * 施加畏缩（统一入口）：设置标记 + 触发不屈之心
   * 所有产生畏缩的来源（招式追加效果 / 恶臭）都必须走这里，保证不屈之心一定生效。
   */
  private inflictFlinch(defender: RecombinedPokemon, events: TurnEvent[]): void {
    defender._abilityData = { ...defender._abilityData, flinched: true }
    events.push({ message: `${defender.nameZh} 畏缩了！`, type: 'status' })
    // 不屈之心：每次畏缩时速度 +1
    if (defender.ability.name === 'steadfast') {
      const msg = this.raiseStat(defender, 'speed', 1)
      events.push(this.abilityEvent(
        `${defender.nameZh} 的不屈之心发动了！${msg}`, this.getSide(defender), 'status',
      ))
    }
  }

  /**
   * 恶臭：攻击招式有 10% 概率追加畏缩（与招式自身的追加效果独立）
   */
  private applyStenchFlinch(
    attacker: RecombinedPokemon,
    defender: RecombinedPokemon,
    events: TurnEvent[],
  ): void {
    if (attacker.ability.name !== 'stench') return
    if (defender.fainted || attacker.fainted) return
    if (defender._abilityData?.flinched) return
    const respect = !this.ignoresAbility(attacker)
    // 鳞粉/精神力可挡下（破格无视）
    if (respect && (defender.ability.name === 'shield-dust' || defender.ability.name === 'inner-focus')) return
    if (this.rng.next() < 0.1) {
      this.inflictFlinch(defender, events)
    }
  }

  /**
   * 攻击方击倒对手后的结算：自信过剩（攻击 +1）
   * 必须在 defender.fainted 被置位之后调用。
   */
  private applyKnockoutAbilities(
    attacker: RecombinedPokemon,
    defender: RecombinedPokemon,
    events: TurnEvent[],
    isPlayer: boolean,
  ): void {
    if (!defender.fainted || attacker.fainted) return
    if (attacker.ability.name === 'moxie') {
      const msg = this.raiseStat(attacker, 'attack', 1)
      events.push(this.abilityEvent(
        `${attacker.nameZh} 的自信过剩发动了！${msg}`, isPlayer ? 'player' : 'enemy', 'status',
      ))
    }
  }

  /**
   * 防守方倒下时的反击特性：引爆（因接触招式倒下 → 攻击方损失最大 HP 的 1/4）
   */
  private applyFaintedDefenderAbilities(
    attacker: RecombinedPokemon,
    defender: RecombinedPokemon,
    move: Move,
    events: TurnEvent[],
    isPlayer: boolean,
  ): void {
    if (!defender.fainted) return
    if (defender.ability.name !== 'aftermath') return
    if (this.ignoresAbility(attacker)) return
    if (!isContactMove(move.name)) return
    if (attacker.fainted || attacker.ability.name === 'magic-guard') return

    const dmg = Math.max(1, Math.floor(attacker.maxHp / 4))
    attacker.currentHp = Math.max(0, attacker.currentHp - dmg)
    events.push({
      ...this.abilityEvent(
        `${defender.nameZh} 的引爆特性让 ${attacker.nameZh} 受到了 ${dmg} 点伤害！`,
        isPlayer ? 'enemy' : 'player', 'damage',
      ),
      damage: dmg,
      targetSide: isPlayer ? 'player' : 'enemy',
    })
    if (attacker.currentHp === 0) {
      attacker.fainted = true
      events.push({ message: `${attacker.nameZh} 倒下了！`, type: 'effect' })
    }
  }

  /**
   * 防御方受到招式命中后的特性反应（愤怒穴位/正义之心/碎裂铠甲/胆怯）
   */
  private applyDefenderHitAbilities(
    defender: RecombinedPokemon,
    move: Move,
    events: TurnEvent[],
    isPlayer: boolean,
    isCritical: boolean,
    attacker?: RecombinedPokemon,
  ): void {
    // 破格：完全无视防守方的受击反应特性
    if (attacker && this.ignoresAbility(attacker)) return
    const side = isPlayer ? 'enemy' : 'player'
    // 愤怒穴位：被会心一击命中后攻击拉满
    if (defender.ability.name === 'anger-point' && isCritical) {
      defender.statStages.attack = 6
      events.push(this.abilityEvent(`${defender.nameZh} 的愤怒穴位让攻击达到了极限！`, side, 'status'))
    }
    if (defender.fainted) return
    // 正义之心：被恶系招式命中 → 攻击 +1
    if (defender.ability.name === 'justified' && move.type === 'dark') {
      defender.statStages.attack = Math.min(6, defender.statStages.attack + 1)
      events.push(this.abilityEvent(`${defender.nameZh} 的正义之心提升了攻击！`, side, 'status'))
    }
    // 碎裂铠甲：受到物理招式 → 防御 -1、速度 +1
    if (defender.ability.name === 'weak-armor' && move.category === 'physical') {
      defender.statStages.defense = Math.max(-6, defender.statStages.defense - 1)
      defender.statStages.speed = Math.min(6, defender.statStages.speed + 1)
      events.push(this.abilityEvent(`${defender.nameZh} 的碎裂铠甲让防御降低、速度提升！`, side, 'status'))
    }
    // 胆怯：被虫/恶/幽灵系招式命中 → 速度 +1
    if (defender.ability.name === 'rattled' && (move.type === 'bug' || move.type === 'dark' || move.type === 'ghost')) {
      defender.statStages.speed = Math.min(6, defender.statStages.speed + 1)
      events.push(this.abilityEvent(`${defender.nameZh} 的胆怯提升了速度！`, side, 'status'))
    }
  }

  private lowerStat(pkm: RecombinedPokemon, stat: keyof typeof pkm.statStages, stages: number, viaContrary = false): string {
    // 唱反调：降低变为提升
    if (pkm.ability.name === 'contrary' && !viaContrary) {
      return this.raiseStat(pkm, stat, stages, true)
    }
    // 洁净身躯：能力不会被降低（命中/闪避除外）
    // 不服输/好胜：能力降低反而提升
    if ((pkm.ability.name === 'defiant' || pkm.ability.name === 'competitive') && stat !== 'accuracy' && stat !== 'evasion') {
      const boostStat = pkm.ability.name === 'defiant' ? 'attack' : 'spAttack'
      pkm.statStages[boostStat] = Math.min(6, (pkm.statStages[boostStat] || 0) + 2)
      const name = pkm.ability.name === 'defiant' ? '不服输' : '好胜'
      return `${pkm.nameZh} 的${name}特性提升了 ${boostStat === 'attack' ? '攻击' : '特攻'}！`
    }
    if ((pkm.ability.name === 'clear-body' || pkm.ability.name === 'white-smoke') && stat !== 'accuracy' && stat !== 'evasion') {
      return `${pkm.nameZh} 的洁净身躯防止了能力降低！`
    }
    // 超强攻击：攻击不会降低
    if (stat === 'attack' && pkm.ability.name === 'hyper-cutter') {
      return `${pkm.nameZh} 的超强攻击防止了攻击降低！`
    }
    // 锐利目光：命中不会降低
    if (stat === 'accuracy' && pkm.ability.name === 'keen-eye') {
      return `${pkm.nameZh} 的锐利目光防止了命中降低！`
    }
    // 健壮胸肌：防御不会降低
    if (stat === 'defense' && pkm.ability.name === 'big-pecks') {
      return `${pkm.nameZh} 的健壮胸肌防止了防御降低！`
    }
    // 单纯：能力变化翻倍
    const mult = pkm.ability.name === 'simple' ? 2 : 1
    const statZh: Record<string, string> = {
      attack: '攻击', defense: '防御', spAttack: '特攻', spDefense: '特防', speed: '速度',
    }
    const old = pkm.statStages[stat]
    pkm.statStages[stat] = clampStage(old - stages * mult)
    const actual = old - pkm.statStages[stat]
    if (actual === 0) return `${pkm.nameZh} 的 ${statZh[stat]} 已经降低到极限了！`
    return `${pkm.nameZh} 的 ${statZh[stat]} 降低了${actual > 1 ? actual : ''}！`
  }

  private raiseStat(pkm: RecombinedPokemon, stat: keyof typeof pkm.statStages, stages: number, viaContrary = false): string {
    // 唱反调：提升变为降低
    if (pkm.ability.name === 'contrary' && !viaContrary) {
      return this.lowerStat(pkm, stat, stages, true)
    }
    // 单纯：能力变化翻倍
    const mult = pkm.ability.name === 'simple' ? 2 : 1
    const statZh: Record<string, string> = {
      attack: '攻击', defense: '防御', spAttack: '特攻', spDefense: '特防', speed: '速度',
    }
    const old = pkm.statStages[stat]
    pkm.statStages[stat] = clampStage(old + stages * mult)
    const actual = pkm.statStages[stat] - old
    if (actual === 0) return `${pkm.nameZh} 的 ${statZh[stat]} 已经提升到极限了！`
    return `${pkm.nameZh} 的 ${statZh[stat]} 提升了${actual > 1 ? actual : ''}！`
  }

  /**
   * 检查战斗结果
   */
  checkBattleEnd(): 'player_win' | 'enemy_win' | null {
    if (this.enemyTeam.every(p => p.fainted)) return 'player_win'
    if (this.playerTeam.every(p => p.fainted)) return 'enemy_win'
    return null
  }

  /**
   * 确定多段攻击的命中次数（2~5 下，带权重分布）
   * 真实分布：2 下 35%，3 下 35%，4 下 15%，5 下 15%
   */
  private determineHits(min: number, max: number, attacker?: RecombinedPokemon): number {
    if (min === max) return min
    if (attacker?.ability.name === 'skill-link') return max // 连续攻击：必定打满段数
    const roll = this.rng.next()
    // 针对 2~5 的标准分布
    if (roll < 0.35) return 2
    if (roll < 0.70) return 3
    if (roll < 0.85) return 4
    return 5
  }
}
