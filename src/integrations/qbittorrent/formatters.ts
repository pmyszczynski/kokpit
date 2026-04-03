export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000) {
    return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1_000).toFixed(1)} KB/s`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
