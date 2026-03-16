import type { ReadingAnalytics } from '../types'

export function createEmptyAnalytics(): ReadingAnalytics {
  return { daily: {} }
}

export function getDateKey(value = new Date()) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function recordReadingAnalytics(
  analytics: ReadingAnalytics,
  activity: {
    minutes?: number
    pages?: number
    date?: Date
  },
) {
  const dateKey = getDateKey(activity.date)
  const currentDay = analytics.daily[dateKey] ?? { minutes: 0, pages: 0 }

  return {
    daily: {
      ...analytics.daily,
      [dateKey]: {
        minutes: currentDay.minutes + (activity.minutes ?? 0),
        pages: currentDay.pages + (activity.pages ?? 0),
      },
    },
  }
}

export function recordTimedReadingAnalytics(
  analytics: ReadingAnalytics,
  startedAt: Date,
  endedAt: Date,
) {
  if (endedAt <= startedAt) {
    return analytics
  }

  let currentAnalytics = analytics
  let cursor = new Date(startedAt)

  while (cursor < endedAt) {
    const nextBoundary = new Date(cursor)
    nextBoundary.setHours(24, 0, 0, 0)

    const segmentEnd = nextBoundary < endedAt ? nextBoundary : endedAt
    const minutes = (segmentEnd.getTime() - cursor.getTime()) / 60_000

    currentAnalytics = recordReadingAnalytics(currentAnalytics, {
      minutes,
      date: cursor,
    })

    cursor = segmentEnd
  }

  return currentAnalytics
}

export function getCurrentStreak(analytics: ReadingAnalytics) {
  let streak = 0
  const current = new Date()

  while (true) {
    const dateKey = getDateKey(current)
    const day = analytics.daily[dateKey]

    if (!day || day.minutes <= 0) {
      break
    }

    streak += 1
    current.setDate(current.getDate() - 1)
  }

  return streak
}

export function getPagesToday(analytics: ReadingAnalytics) {
  return analytics.daily[getDateKey()]?.pages ?? 0
}

export function getTotalMinutesRead(analytics: ReadingAnalytics) {
  return Object.values(analytics.daily).reduce(
    (total, day) => total + day.minutes,
    0,
  )
}

export function formatMinutesCompact(minutes: number) {
  const roundedMinutes = Math.max(0, Math.round(minutes))

  if (roundedMinutes < 60) {
    return `${roundedMinutes}m`
  }

  const hours = Math.floor(roundedMinutes / 60)
  const remainingMinutes = roundedMinutes % 60

  if (!remainingMinutes) {
    return `${hours}h`
  }

  return `${hours}h ${remainingMinutes}m`
}
