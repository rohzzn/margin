import type { ReadingAnalytics } from '../types'

export function createEmptyAnalytics(): ReadingAnalytics {
  return { daily: {} }
}

export function getDateKey(value = new Date()) {
  return value.toISOString().slice(0, 10)
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
  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (!remainingMinutes) {
    return `${hours}h`
  }

  return `${hours}h ${remainingMinutes}m`
}
