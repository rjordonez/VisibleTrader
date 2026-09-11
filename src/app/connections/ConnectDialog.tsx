import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, Eye, EyeOff, Globe2, KeyRound, LockKeyhole, ShieldCheck, Wallet, X } from 'lucide-react'
import { connectionRequest, shortAddress } from './api'
import type { Connection, Profile, USConnection } from './api'
import { signConnection, useBrowserWallets, walletAddress, walletError } from './wallet'
import type { BrowserWallet } from './wallet'

export default function ConnectDialog({ venue, onClose, onConnected, onConnectedUS }: {
  venue: 'international' | 'us'
  onClose: () => void
  onConnected: (connection: Connection) => void
  onConnectedUS: (connection: USConnection) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const wallets = useBrowserWallets()
  const [mode, setMode] = useState<'wallet' | 'profile'>('wallet')
  const [input, setInput] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [keyId, setKeyId] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [revealSecret, setRevealSecret] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(false)
  const lifetime = useRef(0)
  const releaseWallet = useRef<(() => void) | null>(null)
  const busy = Boolean(stage)
  const canClose = !stage.includes('saving') && !stage.startsWith('Saving')

  useEffect(() => {
    dialog.current?.showModal()
    const node = dialog.current
    return () => {
      // This counter invalidates async wallet requests, not a DOM reference.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      lifetime.current++
      releaseWallet.current?.()
      node?.close()
    }
  }, [])

  async function connectWallet(wallet: BrowserWallet) {
    if (pending.current) return
    pending.current = true
    const run = lifetime.current
    setError('')
    setStage('Choose your account in your wallet…')
    let invalidated = false
    const changed = () => { invalidated = true }
    wallet.provider.on?.('accountsChanged', changed)
    wallet.provider.on?.('disconnect', changed)
    releaseWallet.current = () => {
      wallet.provider.removeListener?.('accountsChanged', changed)
      wallet.provider.removeListener?.('disconnect', changed)
    }
    const ensureCurrent = () => {
      if (run !== lifetime.current || invalidated) throw new Error('The wallet changed. Please reconnect with your Polymarket wallet.')
    }
    try {
      const signer = await walletAddress(wallet.provider, true)
      // eth_requestAccounts can itself emit accountsChanged; subsequent changes invalidate this attempt.
      invalidated = false
      ensureCurrent()
      setStage('Finding your Polymarket account…')
      await connectionRequest<{ profile: Profile }>({ action: 'lookup', input: signer })
      ensureCurrent()
      const challenge = await connectionRequest<{ message: string; nonce: string }>({ action: 'challenge', signer })
      ensureCurrent()
      setStage('Sign the tracking-only message in your wallet…')
      const signature = await signConnection(wallet.provider, signer, challenge.message)
      ensureCurrent()
      if (await walletAddress(wallet.provider) !== signer) throw new Error('The wallet changed. Please connect again.')
      ensureCurrent()
      setStage('Verifying and saving your connection…')
      const result = await connectionRequest<{ connection: Connection }>({ action: 'verify', nonce: challenge.nonce, signature })
      if (run === lifetime.current) onConnected(result.connection)
    } catch (e) { if (run === lifetime.current) setError(walletError(e)) }
    finally {
      releaseWallet.current?.()
      releaseWallet.current = null
      pending.current = false
      if (run === lifetime.current) setStage('')
    }
  }

  async function submitUSCredentials() {
    if (pending.current) return
    pending.current = true
    const run = lifetime.current
    setError('')
    setStage('Verifying your credentials with Polymarket US…')
    try {
      const result = await connectionRequest<{ connection: USConnection }>(
        { action: 'connect', keyId: keyId.trim(), secretKey: secretKey.trim() }, undefined, 'polymarket-us-connect')
      if (run === lifetime.current) onConnectedUS(result.connection)
    } catch (e) { if (run === lifetime.current) setError(walletError(e)) }
    finally { pending.current = false; if (run === lifetime.current) setStage('') }
  }

  async function submitProfile() {
    if (pending.current) return
    pending.current = true
    const run = lifetime.current
    setError('')
    setStage(profile ? 'Saving your tracked account…' : 'Finding your Polymarket profile…')
    try {
      if (profile) {
        const result = await connectionRequest<{ connection: Connection }>({ action: 'track', input: profile.wallet_address })
        if (run === lifetime.current) onConnected(result.connection)
      } else {
        const result = await connectionRequest<{ profile: Profile }>({ action: 'lookup', input })
        if (run === lifetime.current) setProfile(result.profile)
      }
    } catch (e) { if (run === lifetime.current) setError(walletError(e)) }
    finally { pending.current = false; if (run === lifetime.current) setStage('') }
  }

  return <dialog ref={dialog} className="connection-dialog ph-no-capture ph-mask" aria-labelledby="connection-dialog-title"
    onCancel={event => { event.preventDefault(); if (canClose) onClose() }}
    onClick={event => { if (event.target === event.currentTarget && canClose) onClose() }}>
    <div className="connection-dialog-top">
      <span className="connection-venue-icon">{venue === 'us' ? <span aria-hidden="true">US</span> : <Globe2 size={24} />}</span>
      <button type="button" className="connection-icon-button" disabled={!canClose} aria-label="Close connection dialog" onClick={onClose}><X size={20} /></button>
    </div>
    <h2 id="connection-dialog-title">{venue === 'us' ? 'Polymarket US' : 'Connect Polymarket'}</h2>
    {venue === 'us' ? <>
      <p>Use the API key from your Polymarket US account to bring in your positions and trade history.</p>
      <div className="connection-note"><LockKeyhole size={18} /><span>Trading is disabled in VisibleTrader — this connection only reads your positions and activity.</span></div>
      <a className="connection-text-link" href="https://polymarket.us/developer" target="_blank" rel="noopener noreferrer">Open Polymarket US’s developer portal <ArrowUpRight size={15} /></a>
      <form onSubmit={event => { event.preventDefault(); void submitUSCredentials() }}>
        <label htmlFor="pm-us-key-id">Key ID</label>
        <input id="pm-us-key-id" className="connection-input ph-no-capture ph-mask" value={keyId} onChange={event => setKeyId(event.target.value)}
          disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="00000000-0000-0000-0000-000000000000" required />
        <label htmlFor="pm-us-secret-key">Secret Key</label>
        <div className="connection-secret-field">
          <input id="pm-us-secret-key" className="connection-input ph-no-capture ph-mask" type={revealSecret ? 'text' : 'password'}
            value={secretKey} onChange={event => setSecretKey(event.target.value)} disabled={busy}
            autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Paste your Secret Key" required />
          <button type="button" className="connection-icon-button" disabled={busy} aria-label={revealSecret ? 'Hide secret key' : 'Show secret key'} onClick={() => setRevealSecret(v => !v)}>
            {revealSecret ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p className="connection-small">Create a dedicated key for VisibleTrader from the developer portal above. We never see your Polymarket US password.</p>
        <button type="submit" className="connection-button connection-button-primary" disabled={busy || !keyId.trim() || !secretKey.trim()}>{busy ? 'Please wait…' : 'Connect Polymarket US'}</button>
      </form>
      {stage && <p className="connection-progress" role="status"><span className="connection-spinner" />{stage}</p>}
      {error && <p className="connection-error" role="alert">{error}</p>}
      <div className="connection-dialog-footer"><KeyRound size={14} /> Your Secret Key is encrypted before it's ever stored.</div>
    </> : <>
      <p>Use your existing account to see your positions and recent trades in one place.</p>
      <div className="connection-tabs" aria-label="Connection method">
        <button type="button" aria-pressed={mode === 'wallet'} disabled={busy} onClick={() => { setMode('wallet'); setError('') }}><Wallet size={16} /> Connect wallet</button>
        <button type="button" aria-pressed={mode === 'profile'} disabled={busy} onClick={() => { setMode('profile'); setError('') }}><Globe2 size={16} /> Track profile</button>
      </div>
      {mode === 'wallet' ? <>
        <div className="connection-note"><ShieldCheck size={19} /><span>A message signature verifies your wallet. It does not authorize trades or move funds.</span></div>
        <p className="connection-small">Choose the wallet you use to sign in to Polymarket.</p>
        <div className="connection-wallet-list">{wallets.map(wallet => <button type="button" className="connection-wallet-option" key={wallet.id} disabled={busy} onClick={() => void connectWallet(wallet)}><Wallet size={19} /><span>{wallet.name}</span><ArrowUpRight size={17} /></button>)}</div>
        {!wallets.length && <div className="connection-empty-wallet"><Wallet size={26} /><strong>No browser wallet detected</strong><p>Open this page in your wallet’s browser, or track your public profile below.</p></div>}
        <button type="button" className="connection-text-link" disabled={busy} onClick={() => { setMode('profile'); setError('') }}>Use email or Google on Polymarket? Track your profile</button>
      </> : <form onSubmit={event => { event.preventDefault(); void submitProfile() }}>
        {!profile ? <>
          <label htmlFor="connection-profile-input">Polymarket profile or wallet address</label>
          <input id="connection-profile-input" className="connection-input ph-no-capture ph-mask" value={input} onChange={event => setInput(event.target.value)} disabled={busy} maxLength={250} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="polymarket.com/@yourname or 0x…" required />
          <p className="connection-small">Copy your profile link or account wallet address from Polymarket. No password or private key needed.</p>
        </> : <div className="connection-profile-preview"><Globe2 size={25} /><div><strong>{profile.display_name}</strong><code>{shortAddress(profile.wallet_address)}</code><p>Tracking only · ownership not verified</p></div><Check size={19} /></div>}
        <button type="submit" className="connection-button connection-button-primary" disabled={busy || !input.trim()}>{busy ? 'Please wait…' : profile ? 'Track this account' : 'Find my account'}</button>
        {profile && <button type="button" className="connection-text-link" disabled={busy} onClick={() => { setProfile(null); setError('') }}><ArrowLeft size={15} /> Use a different profile</button>}
      </form>}
      {stage && <p className="connection-progress" role="status"><span className="connection-spinner" />{stage}</p>}
      {error && <p className="connection-error" role="alert">{error}</p>}
      <div className="connection-dialog-footer"><KeyRound size={14} /> Your wallet’s private key stays in your wallet.</div>
    </>}
  </dialog>
}
