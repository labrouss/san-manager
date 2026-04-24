// =============================================================================
// services/credentialStore.ts
// In-memory per-switch credential store (IP/user/password for NX-API calls).
// Populated by fabric.routes.ts on switch registration.
// =============================================================================

export interface SwitchCredentials {
  username: string;
  password: string;
  port:     number;
}

export const credentialStore = new Map<string, SwitchCredentials>();
