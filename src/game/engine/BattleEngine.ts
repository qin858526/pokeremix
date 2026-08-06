import type { RecombinedPokemon, Move, StatusCondition } from '../data/types'
import { calculateDamage, isImmune, formatBreakdown } from '../engine/DamageCalc'
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

  /** 创建特性触发事件 */
  private abilityEvent(msg: string, side: 'player' | 'enemy', type: TurnEvent['type'] = 'effect'): TurnEvent {
    return { message: msg, type, triggerSource: 'ability', triggerSide: side } as TurnEvent
  }

  /** 判断宝可梦所属方 */
  private getSide(pkm: RecombinedPokemon): 'player' | 'enemy' {
    return pkm === this.playerActive ? 'player' : 'enemy'
  }

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

  /** 玩家主动换人 */
  switchPlayer(targetIndex: number, events?: TurnEvent[]): boolean {
    const target = this.playerTeam[targetIndex]
    if (target && !target.fainted && target !== this.playerActive) {
      // 扎根：无法换人逃走
      if (this.playerActive._abilityData?.ingrain) {
        if (events) events.push({ message: `${this.playerActive.nameZh} 扎根了，无法替换！`, type: 'fail' })
        return false
      }
      // 束缚：被火焰旋涡/绑紧等困住时无法换人
      const trapped = this.playerActive._abilityData?.trapTurns
      if (trapped && trapped > 0) {
        const trapName = this.playerActive._abilityData?.trapMoveZh ?? '束缚'
        if (events) events.push({ message: `${this.playerActive.nameZh} 被${trapName}束缚住，无法替换！`, type: 'fail' })
        return false
      }
      // 换人封锁：对方特性阻止我方换人（踩影/沙穴/磁力）
      // 注意：受困判定针对「当前在场、准备撤下」的宝可梦，而非要换上来的那只
      const blocker = this.opponentBlocksSwitch('player', this.playerActive)
      if (blocker) {
        if (events) events.push({ message: `${this.playerActive.nameZh} 被对方的 ${blocker} 阻止了替换！`, type: 'fail' })
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
    const grounded = self.types[0] !== 'flying' && self.types[1] !== 'flying' && self.ability.name !== 'levitate'
    if (oa === 'shadow-tag') return '踩影'
    if (oa === 'arena-trap' && grounded) return '沙穴'
    if (oa === 'magnet-pull' && (self.types[0] === 'steel' || self.types[1] === 'steel')) return '磁力'
    return null
  }

  /**
   * 入场特性效果（返回事件消息）
   */
  private applyOnSwitchAbility(pkm: RecombinedPokemon, isEnemy: boolean): string | null {
    // 威吓：降低对方攻击 1 级
    if (pkm.ability.name === 'intimidate') {
      const target = isEnemy ? this.playerActive : this.enemyActive
      if (target && !target.fainted && target.statStages.attack > -6) {
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
    }
    const opp = this.getSide(pkm) === 'player' ? this.enemyActive : this.playerActive
    if (opp?._abilityData?.trapTurns) {
      opp._abilityData.trapTurns = 0
      opp._abilityData.trapMoveZh = undefined
    }
  }

  /**
   * 宝可梦上场时触发场地陷阱（撒钉）
   */
  private applyEntryHazards(pkm: RecombinedPokemon, side: 'player' | 'enemy'): TurnEvent[] {
    const events: TurnEvent[] = []
    if (pkm.fainted) return events
    const haz = side === 'player' ? this.playerHazards : this.enemyHazards
    const isGrounded = pkm.types[0] !== 'flying' && pkm.types[1] !== 'flying' && pkm.ability.name !== 'levitate'

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
      const eff = getTypeEffectiveness('rock', pkm.types)
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
  }

  /** AI 选择行动 */
  enemyAction(): TurnAction {
    const available = this.enemyActive.moves
      .filter(m => m.currentPp > 0 && m.category !== 'status')
    if (available.length === 0) {
      const anyMove = this.enemyActive.moves.find(m => m.currentPp > 0)
      if (anyMove) return { type: 'move', moveIndex: this.enemyActive.moves.indexOf(anyMove) }
      // 所有 PP 用完，使用 Struggles（用第一招代替）
      return { type: 'move', moveIndex: 0 }
    }
    const idx = this.rng.nextInt(available.length)
    const picked = available[idx]
    return { type: 'move', moveIndex: this.enemyActive.moves.indexOf(picked) }
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
    if (move.accuracy >= 100) return 100

    const accStage = attacker.statStages.accuracy
    const evaStage = defender.statStages.evasion
    const accMult = accStage >= 0 ? (3 + accStage) / 3 : 3 / (3 - accStage)
    const evaMult = evaStage >= 0 ? 3 / (3 + evaStage) : (3 - evaStage) / 3

    let acc = move.accuracy * accMult * evaMult

    // 复眼：命中率 x1.3
    if (attacker.ability.name === 'compound-eyes') acc *= 1.3

    // 沙隐/雪隐：沙暴/冰雹时闪避提升
    if ((defender.ability.name === 'sand-veil' && this.weather === 'sandstorm') ||
        (defender.ability.name === 'snow-cloak' && this.weather === 'hail')) {
      acc *= 0.8
    }

    // 无防守：双方攻击必定命中
    if (attacker.ability.name === 'no-guard' || defender.ability.name === 'no-guard') return 100

    // 蹒跚：混乱时闪避提升
    if (defender.ability.name === 'tangled-feet' && defender.confuseTurns && defender.confuseTurns > 0) {
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
        // 防尘特性：免疫粉尘类招式
        if (defender.ability.name === 'overcoat') {
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
        const hitResult = calculateDamage(attacker, defender, move, this.effectiveWeather())
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
        if (actualDamage > 0) this.applyDefenderHitAbilities(defender, move, events, isPlayer, hitCrit)

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
    const dmgResult = calculateDamage(attacker, defender, move, this.effectiveWeather())
    const rawDamage = dmgResult.damage
    let dmgSuffix = formatBreakdown(dmgResult.parts)
    const hasSub = !!defender._abilityData?.substituteHp && (move.category as string) !== 'status'

    // 反射壁/光墙减伤
    const defSide = isPlayer ? 'enemy' : 'player'
    const scr = this.screenMultiplier(attacker, move, defSide)
    let damage = rawDamage * scr.mod
    if (scr.mod !== 1) dmgSuffix += `（${scr.label}×0.5）`

    // 神奇守护：仅效果绝佳（×2）的招式能造成伤害，其余相性伤害归零
    if (defender.ability.name === 'wonder-guard') {
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
    this.applyDefenderHitAbilities(defender, move, events, isPlayer, isCritical)

    // 结实：满血时抵挡一击必杀（保留 1 HP）
    if (defender.currentHp === 0 && defender.ability.name === 'sturdy' && wasAtFullHp) {
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
      if (defender.ability.name === 'wonder-guard' && damage === 0) {
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

    // 变色：被招式命中后属性变为该招式属性
    if (defender.ability.name === 'color-change' && move.category !== 'status' && !this.isImmuneToMove(move, defender, attacker)) {
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
      // 储液：吸取招式会伤害攻击者
    if (defender.ability.name === 'liquid-ooze' && attacker.ability.name !== 'magic-guard') {
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

    // ----- 同步特性：对方将异常状态传递给我方 -----
    if (defender.ability.name === 'synchronize' && defender.status && !attacker.status && !attacker.fainted) {
      const syncable = ['burn', 'paralysis', 'poison'] as const
      if (syncable.includes(defender.status as any)) {
        attacker.status = defender.status
        const names: Record<string, string> = { burn: '烧伤', paralysis: '麻痹', poison: '中毒' }
        events.push(this.abilityEvent(`${attacker.nameZh} 因同步特性也被${names[defender.status] ?? defender.status}了！`, isPlayer ? 'enemy' : 'player', 'status'))
      }
    }

    if (defender.fainted) {
      events.push({ message: `${defender.nameZh} 倒下了！`, type: 'effect', actionSide: isPlayer ? 'enemy' : 'player' })
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

    // 鳞粉：不受附加效果影响
    if (defender.ability.name === 'shield-dust') return
    // 精神力：不会畏缩
    if (defender.ability.name === 'inner-focus' && data.status === 'flinch') return
    // 强行：附加效果被抑制（威力已在伤害计算中提升）
    if (_attacker.ability.name === 'sheer-force') return

    // 天恩：附加效果概率翻倍
    if (_attacker.ability.name === 'serene-grace') chance *= 2

    const roll = this.rng.next() * 100

    // 畏缩特殊处理（非持久异常状态，用独立标记）
    if (data.status === 'flinch' && roll < chance) {
      defender._abilityData = { ...defender._abilityData, flinched: true }
      events.push({ message: `${defender.nameZh} 畏缩了！`, type: 'status' })
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
          this.inflictStatus(defender, chosen, events)
        }
        return
      }
      // 混乱特殊处理
      if (data.status === 'confuse' && !defender.confuseTurns) {
        defender.confuseTurns = 2 + Math.floor(this.rng.next() * 3)
        events.push({ message: `${defender.nameZh} 混乱了！`, type: 'status' })
        return
      }
      if (!defender.status) {
        if (data.status === 'flinch' || data.status === 'confuse') return
        this.inflictStatus(defender, data.status as StatusCondition, events)
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

    if (!effect || effect.kind !== 'status') {
      // 未定义效果的变化技能：只显示使用成功
      return
    }

    const data = effect.data

    // 异常状态
    if (data.inflictStatus && !defender.status) {
      this.inflictStatus(defender, data.inflictStatus, events)
    }

    // 混乱
    if (data.confuse && !defender.confuseTurns) {
      if (defender.ability.name === 'own-tempo') {
        events.push(this.abilityEvent(defender.nameZh + ' 的自我中心特性防止了混乱！', this.getSide(defender), 'fail'))
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

  /**
   * 赋予异常状态（带提示和特性免疫检查）
   */
  private inflictStatus(pkm: RecombinedPokemon, status: StatusCondition, events: TurnEvent[]): boolean {
    // 特性免疫检查
    const immunityMap: Partial<Record<StatusCondition, string[]>> = {
      sleep: ['insomnia', 'vital-spirit'],
      poison: ['immunity'],
      burn: ['water-veil'],
      freeze: ['magma-armor'],
      paralysis: ['limber', 'static'], // static doesn't prevent, but limber does
    }
    const blockers = immunityMap[status]
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
    if (pkm.ability.name === 'leaf-guard' && this.effectiveWeather() === 'sun') {
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
   * 防御方受到招式命中后的特性反应（愤怒穴位/正义之心/碎裂铠甲/胆怯）
   */
  private applyDefenderHitAbilities(
    defender: RecombinedPokemon,
    move: Move,
    events: TurnEvent[],
    isPlayer: boolean,
    isCritical: boolean,
  ): void {
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
