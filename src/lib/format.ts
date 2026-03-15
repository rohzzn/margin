export function formatRelativeTime(value?: string) {
  if (!value) {
    return 'Just added'
  }

  const timestamp = new Date(value).getTime()
  const diff = Date.now() - timestamp

  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < hour) {
    const minutes = Math.max(1, Math.round(diff / minute))
    return `${minutes}m ago`
  }

  if (diff < day) {
    return `${Math.round(diff / hour)}h ago`
  }

  return `${Math.round(diff / day)}d ago`
}

export function formatFileSize(size: number) {
  if (size >= 1_000_000) {
    return `${(size / 1_000_000).toFixed(1)} MB`
  }

  return `${Math.max(1, Math.round(size / 1_000))} KB`
}
