// Pure parsing shared with the edge tests. Never accept arbitrary fetch URLs.
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function accountInput(input: unknown): { address: string } | { username: string } {
  if (typeof input !== 'string' || input.length > 250) throw new Error('Enter a Polymarket profile link or wallet address.');
  let value = input.trim();
  if (ADDRESS.test(value)) return { address: value.toLowerCase() };
  if (/^(https?:\/\/|www\.|polymarket\.com\/)/i.test(value)) {
    let url: URL;
    try { url = new URL(value.startsWith('http') ? value : `https://${value}`); }
    catch { throw new Error('Enter a valid Polymarket profile link.'); }
    if (url.protocol !== 'https:' || !['polymarket.com', 'www.polymarket.com'].includes(url.hostname) || url.username || url.password || url.port) {
      throw new Error('Use a profile link from polymarket.com. Polymarket US is coming soon.');
    }
    const match = url.pathname.match(/^\/(?:profile\/|@)([^/]+)\/?$/);
    if (!match) throw new Error('Use your profile link, not a market link.');
    value = decodeURIComponent(match[1]);
  }
  if (ADDRESS.test(value)) return { address: value.toLowerCase() };
  value = value.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(value) || /^0x[0-9a-fA-F]*$/.test(value)) throw new Error('Enter a valid profile name or 0x wallet address.');
  return { username: value };
}

export function connectionMessage(userId: string, signer: string, nonce: string, expires: string) {
  return [
    'Connect your Polymarket account to VisibleTrader',
    '',
    `Wallet: ${signer}`,
    `VisibleTrader user: ${userId}`,
    `Nonce: ${nonce}`,
    `Expires: ${expires}`,
    '',
    'This signature verifies your wallet for portfolio tracking only.',
    'It does not authorize orders, token approvals, or transfers.',
  ].join('\n');
}

export function finiteNumber(value: unknown) {
  if (typeof value === 'string' && !value.trim()) return null;
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
