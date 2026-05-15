export function clearInteractiveSessionIdAfterProcessExit(setInteractiveSessionId: (id: string | null) => void): void {
  setInteractiveSessionId(null);
}
