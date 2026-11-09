const cny = new Intl.NumberFormat('zh-CN', {
  style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const cnyNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

export function formatCny(amount: number | null): string {
  return amount == null || !Number.isFinite(amount) ? '—' : cny.format(amount)
}

export function formatCnyTokenPrice(price: { input: number, output: number } | null): string | null {
  return price ? `¥${cnyNumber.format(price.input)}/${cnyNumber.format(price.output)}` : null
}
