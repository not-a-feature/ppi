const activeAccounts = new Set<string>();

export function tryAcquireUpload(userId: string): (() => void) | null {
  if (activeAccounts.size >= 4 || activeAccounts.has(userId)) return null;
  activeAccounts.add(userId);
  let released = false;
  return () => {
    if (!released) {
      activeAccounts.delete(userId);
      released = true;
    }
  };
}
