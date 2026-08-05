/**
 * 种子随机数生成器（Mulberry32 算法）
 * 保证同一局游戏内所有随机结果可复现
 */
export class SeededRandom {
  private state: number

  constructor(seed: number) {
    this.state = seed | 0
  }

  /** 返回 [0, max) 的整数 */
  nextInt(max: number): number {
    this.state |= 0
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) % max
  }

  /** 返回 [0, 1) 的浮点数 */
  next(): number {
    return this.nextInt(0x100000000) / 0x100000000
  }

  /** 从数组中随机选一个 */
  pick<T>(arr: T[]): T {
    return arr[this.nextInt(arr.length)]
  }

  /** Fisher-Yates 洗牌 */
  shuffle<T>(arr: T[]): T[] {
    const result = [...arr]
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }
}
