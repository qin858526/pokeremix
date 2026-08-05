// Simple unique ID generator
let counter = 0

export function v4(): string {
  return 'pkm-' + Date.now().toString(36) + '-' + (++counter).toString(36)
}