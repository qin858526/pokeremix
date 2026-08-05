// Auto-generated type Chinese name mapping

export const TYPE_ZH: Record<string, string> = {
  'normal': '一般',
  'fire': '火',
  'water': '水',
  'electric': '电',
  'grass': '草',
  'ice': '冰',
  'fighting': '格斗',
  'poison': '毒',
  'ground': '地面',
  'flying': '飞行',
  'psychic': '超能力',
  'bug': '虫',
  'rock': '岩石',
  'ghost': '幽灵',
  'dragon': '龙',
  'dark': '恶',
  'steel': '钢',
  'fairy': '妖精',
}

export function getTypeZh(type: string | null | undefined): string {
  return TYPE_ZH[type ?? ''] ?? type ?? ''
}