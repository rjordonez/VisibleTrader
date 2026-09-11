import { useEffect, useState } from 'react'

export interface WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}
export interface BrowserWallet { id: string; name: string; provider: WalletProvider }
interface Announcement { info: { uuid: string; name: string }; provider: WalletProvider }

export function useBrowserWallets() {
  const [wallets, setWallets] = useState<BrowserWallet[]>([])
  useEffect(() => {
    const add = (event: Event) => {
      const detail = (event as CustomEvent<Announcement>).detail
      if (!detail?.info?.uuid || typeof detail.info.name !== 'string' || typeof detail.provider?.request !== 'function') return
      const wallet = { id: detail.info.uuid, name: detail.info.name.slice(0, 60), provider: detail.provider }
      setWallets(current => [...current.filter(w => w.provider !== wallet.provider && w.id !== wallet.id), wallet])
    }
    window.addEventListener('eip6963:announceProvider', add)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    const timer = window.setTimeout(() => {
      const provider = (window as Window & { ethereum?: WalletProvider }).ethereum
      if (typeof provider?.request === 'function') {
        setWallets(current => current.length ? current : [{ id: 'injected', name: 'Browser wallet', provider }])
      }
    }, 300)
    return () => { clearTimeout(timer); window.removeEventListener('eip6963:announceProvider', add) }
  }, [])
  return wallets
}

export async function walletAddress(provider: WalletProvider, requestAccess = false) {
  const accounts = await provider.request({ method: requestAccess ? 'eth_requestAccounts' : 'eth_accounts' })
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])) {
    throw new Error('No wallet account selected. Unlock your wallet and try again.')
  }
  return accounts[0].toLowerCase()
}

export async function signConnection(provider: WalletProvider, address: string, message: string) {
  const hex = `0x${Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, '0')).join('')}`
  const signature = await provider.request({ method: 'personal_sign', params: [hex, address] })
  if (typeof signature !== 'string') throw new Error('Your wallet did not return a signature.')
  return signature
}

export function walletError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  if (code === 4001) return 'Connection canceled in your wallet. You can try again whenever you’re ready.'
  if (code === -32002) return 'A wallet request is already open. Check your wallet to continue.'
  if (code === 4200 || code === -32601) return 'This wallet does not support message signing. You can track your public profile instead.'
  return error instanceof Error ? error.message : 'Could not connect your wallet. Please try again.'
}
