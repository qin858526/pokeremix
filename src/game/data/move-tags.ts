/**
 * 技能标签系统：按特征对技能进行分类，供特性/道具/场地等系统查询
 *
 * 使用示例：
 *   getMoveTags('thunder-punch') // → ['punch', 'contact']
 *   getMoveTags('earthquake')    // → [] (无特殊标签)
 */

export type MoveTag =
  | 'punch'      // 拳类（铁拳）
  | 'bite'       // 咬类（强壮之颚）
  | 'recoil'     // 反伤类（舍身）
  | 'sound'      // 声音类（隔音）
  | 'contact'    // 接触类（静电/毒刺/孢子/火焰之躯/毒手/粗糙皮肤）
  | 'powder'     // 粉尘类（防尘/草系免疫）
  | 'wind'       // 风类（乘风/风之翼）

/** 技能标签映射表 (move.name → tags[]) */
const MOVE_TAGS: Record<string, MoveTag[]> = {
  // ======== 拳类 ========
  'comet-punch': ['punch', 'contact'],
  'mega-punch': ['punch', 'contact'],
  'thunder-punch': ['punch', 'contact'],
  'fire-punch': ['punch', 'contact'],
  'ice-punch': ['punch', 'contact'],
  'dizzy-punch': ['punch', 'contact'],
  'dynamic-punch': ['punch', 'contact'],
  'focus-punch': ['punch', 'contact'],
  'bullet-punch': ['punch', 'contact'],
  'power-up-punch': ['punch', 'contact'],
  'double-slap': ['punch', 'contact'],
  'arm-thrust': ['punch', 'contact'],
  'mach-punch': ['punch', 'contact'],
  'drain-punch': ['punch', 'contact'],
  'close-combat': ['punch', 'contact'],
  'sky-uppercut': ['punch', 'contact'],
  'hammer-arm': ['punch', 'contact'],

  // ======== 咬类 ========
  'bite': ['bite', 'contact'],
  'crunch': ['bite', 'contact'],
  'ice-fang': ['bite', 'contact'],
  'fire-fang': ['bite', 'contact'],
  'thunder-fang': ['bite', 'contact'],
  'hyper-fang': ['bite', 'contact'],
  'super-fang': ['bite', 'contact'],

  // ======== 反伤类 ========
  'take-down': ['recoil', 'contact'],
  'double-edge': ['recoil', 'contact'],
  'submission': ['recoil', 'contact'],
  'wild-charge': ['recoil', 'contact'],
  'flare-blitz': ['recoil', 'contact'],
  'head-smash': ['recoil', 'contact'],
  'brave-bird': ['recoil', 'contact'],
  'volt-tackle': ['recoil', 'contact'],
  'head-charge': ['recoil', 'contact'],

  // ======== 声音类 ========
  'growl': ['sound'],
  'roar': ['sound'],
  'sing': ['sound'],
  'supersonic': ['sound'],
  'screech': ['sound'],
  'snore': ['sound'],
  'uproar': ['sound'],
  'hyper-voice': ['sound'],
  'confide': ['sound'],
  'round': ['sound'],
  'echoed-voice': ['sound'],
  'grass-whistle': ['sound'],
  'howl': ['sound'],
  'perish-song': ['sound'],
  'heal-bell': ['sound'],
  'buzz': ['sound'],
  'bug-buzz': ['sound'],
  'snarl': ['sound'],
  'metal-sound': ['sound'],
  'disarming-voice': ['sound'],
  'chatter': ['sound'],
  'relic-song': ['sound'],
  'noble-roar': ['sound'],
  'parting-shot': ['sound'],
  'boomburst': ['sound'],
  'clanging-scales': ['sound'],
  'clangorous-soul': ['sound'],
  'sparkling-aria': ['sound'],
  'psychic-noise': ['sound'],
  'alluring-voice': ['sound'],
  'baby-doll-eyes': ['sound'],

  // ======== 粉尘类 ========
  'poison-powder': ['powder'],
  'stun-spore': ['powder'],
  'sleep-powder': ['powder'],

  // ======== 风类 ========
  'gust': ['wind'],
  'icy-wind': ['wind'],
  'twister': ['wind'],
  'heat-wave': ['wind'],
  'air-cutter': ['wind'],
  'air-slash': ['wind'],
  'ominous-wind': ['wind'],
  'tailwind': ['wind'],
  'blizzard': ['wind'],
  'hurricane': ['wind'],
  'sandstorm': ['wind'],
  'leaf-storm': ['wind'],
  // T11：吹飞是风属性招式（第 9 代规则），乘风据此免疫强制换人
  'whirlwind': ['wind'],
}

/**
 * 获取技能的标签列表
 */
export function getMoveTags(name: string): MoveTag[] {
  return MOVE_TAGS[name] ?? []
}

/**
 * 检查技能是否有指定标签
 */
export function hasMoveTag(name: string, tag: MoveTag): boolean {
  return getMoveTags(name).includes(tag)
}

/**
 * 检查技能是否为接触类（供特性触发判断）
 */
export function isContactMove(name: string): boolean {
  return hasMoveTag(name, 'contact')
}

/**
 * 检查技能是否为拳类（供铁拳特性判断）
 */
export function isPunchMove(name: string): boolean {
  return hasMoveTag(name, 'punch')
}
