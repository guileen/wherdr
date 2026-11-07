import antigravityIcon from '~/assets/provider-antigravity.svg?url'
import deepseekIcon from '~/assets/provider-deepseek.svg?url'
import devinIcon from '~/assets/provider-devin.svg?url'
import openrouterIcon from '~/assets/provider-openrouter.svg?url'

export const providerIcons: Record<string, string> = { 'openai-codex': 'i-herdr-codex', codex: 'i-herdr-codex', openai: 'i-herdr-openai', anthropic: 'i-herdr-claude-code', claude: 'i-herdr-claude-code' }
export const providerImages: Record<string, string> = { 'google-antigravity': antigravityIcon, deepseek: deepseekIcon, devin: devinIcon, openrouter: openrouterIcon }
export function hasProviderIcon(provider: string) { return Boolean(providerIcons[provider] || providerImages[provider]) }
