import { createTransfer, type Core, type OutgoingTransfer } from '../../../core/index.ts'
import { accountSecret, ensureAccount } from '../../../core/account/service.ts'
import { startAccountSync } from '../../core/account.ts'

/** Makes a device link for `siteBase` (this site, or the site's new address), turning the account on first. */
export async function makeDeviceLink(core: Core, siteBase: string, onProgress?: (share: number) => void): Promise<OutgoingTransfer> {
  const secret = (await accountSecret(core.db)) ?? (await ensureAccount(core))
  void startAccountSync(core)
  return createTransfer(core, { siteBase, account: secret, ...(onProgress ? { onProgress } : {}) })
}
