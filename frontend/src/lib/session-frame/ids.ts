export function sessionFrameStoreKey(streamId: string, frameId: string): string {
  return `${streamId}:${frameId}`;
}
