import { createStore, del, get, set } from 'idb-keyval'
import { createEmptyAnalytics } from './stats'
import type { BookRecord, ReaderSettings, ReadingAnalytics } from '../types'

const LIBRARY_KEY = 'margin.library.v1'
const SETTINGS_KEY = 'margin.settings.v1'
const ANALYTICS_KEY = 'margin.analytics.v1'
const DEFAULT_BOOKS_KEY = 'margin.default-books.v1'
const BOOK_FILE_PREFIX = 'book:'
const bookStore = createStore('margin-reader', 'epub-files')

export const defaultReaderSettings: ReaderSettings = {
  theme: 'linen',
  fontScale: 100,
  lineHeight: 1.6,
  fontFamily: 'serif',
  flow: 'paginated',
  spread: 'auto',
}

export function loadLibrary(): BookRecord[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as BookRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveLibrary(books: BookRecord[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(books))
}

export function loadReaderSettings(): ReaderSettings {
  if (typeof window === 'undefined') {
    return defaultReaderSettings
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) {
      return defaultReaderSettings
    }

    const parsed = JSON.parse(raw) as Partial<ReaderSettings>
    return {
      ...defaultReaderSettings,
      ...parsed,
    }
  } catch {
    return defaultReaderSettings
  }
}

export function saveReaderSettings(settings: ReaderSettings) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function hasSeededDefaultBooks() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(DEFAULT_BOOKS_KEY) === 'true'
}

export function markDefaultBooksSeeded() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(DEFAULT_BOOKS_KEY, 'true')
}

export function loadReadingAnalytics(): ReadingAnalytics {
  if (typeof window === 'undefined') {
    return createEmptyAnalytics()
  }

  try {
    const raw = window.localStorage.getItem(ANALYTICS_KEY)
    if (!raw) {
      return createEmptyAnalytics()
    }

    const parsed = JSON.parse(raw) as ReadingAnalytics
    return parsed?.daily ? parsed : createEmptyAnalytics()
  } catch {
    return createEmptyAnalytics()
  }
}

export function saveReadingAnalytics(analytics: ReadingAnalytics) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ANALYTICS_KEY, JSON.stringify(analytics))
}

export async function saveBookFile(bookId: string, file: Blob) {
  await set(`${BOOK_FILE_PREFIX}${bookId}`, file, bookStore)
}

export async function loadBookFile(bookId: string) {
  return get<Blob>(`${BOOK_FILE_PREFIX}${bookId}`, bookStore)
}

export async function deleteBookFile(bookId: string) {
  await del(`${BOOK_FILE_PREFIX}${bookId}`, bookStore)
}
