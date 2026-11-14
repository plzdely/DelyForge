import type { DelyForgeBridge, IpcResult } from '@delyforge/shared';

declare global {
  interface Window {
    /** Injected by the preload script. Undefined when the UI is opened outside the desktop app. */
    delyforge?: DelyForgeBridge;
  }
}

export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export function isBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && window.delyforge !== undefined;
}

/** Calls the desktop bridge and unwraps the result envelope, throwing a `BridgeError` on failure. */
export async function call<T>(fn: (bridge: DelyForgeBridge) => Promise<IpcResult<T>>): Promise<T> {
  const bridge = window.delyforge;
  if (!bridge) {
    throw new BridgeError('BRIDGE_UNAVAILABLE', 'The DelyForge desktop runtime is not available.');
  }
  const result = await fn(bridge);
  if (!result.ok) throw new BridgeError(result.error.code, result.error.message);
  return result.data;
}
