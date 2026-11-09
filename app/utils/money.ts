const cny = new Intl.NumberFormat('zh-CN', {
  style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const cnyNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

export function formatCny(amount: number | null): string {
  return amount == null || !Number.isFinite(amount) ? '—' : cny.format(amount)
}

// Prices stay separate and labelled: "¥2/8" reads as a fraction of 2 of 8.
export function formatCnyTokenPrices(price: { input: number, output: number } | null): { input: string, output: string } | null {
  return price
    ? { input: `¥${cnyNumber.format(price.input)}`, output: `¥${cnyNumber.format(price.output)}` }
    : null
}
