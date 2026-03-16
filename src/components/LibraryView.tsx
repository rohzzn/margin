import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  getFeedbooksPublicDomainMatchCount,
  searchFeedbooksPublicDomainBooks,
} from '../lib/feedbooks'
import { fetchPublicCatalogPage } from '../lib/standardEbooks'
import { WeatherIcon } from './WeatherIcon'
import {
  formatMinutesCompact,
  getCurrentStreak,
  getPagesToday,
  getTotalMinutesRead,
} from '../lib/stats'
import {
  WEATHER_CACHE_TTL_MS,
  cacheWeather,
  fetchCurrentWeather,
  getCurrentPosition,
  readCachedWeather,
  type WeatherSnapshot,
} from '../lib/weather'
import type {
  BookRecord,
  PublicCatalogBook,
  PublicCatalogSort,
  ReadingAnalytics,
} from '../types'

interface LibraryViewProps {
  books: BookRecord[]
  analytics: ReadingAnalytics
  isImporting: boolean
  importError?: string | null
  publicImportBookId: string | null
  publicImportError?: string | null
  publicBookIdsByIdentifier: Map<string, string>
  onImport: (files: File[]) => void
  onImportPublicBook: (book: PublicCatalogBook) => void
  onOpen: (bookId: string) => void
  onDelete: (bookId: string) => void
}

interface BookCoverParallaxState {
  currentRotateX: number
  currentRotateY: number
  currentShiftX: number
  currentShiftY: number
  targetRotateX: number
  targetRotateY: number
  targetShiftX: number
  targetShiftY: number
  frameId: number | null
}

const bookCoverParallaxStates = new WeakMap<
  HTMLButtonElement,
  BookCoverParallaxState
>()

function formatLibraryTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)
}

function formatLibraryDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(value)
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function syncBookCoverParallax(
  button: HTMLButtonElement,
  state: BookCoverParallaxState,
) {
  button.style.setProperty('--cover-rotate-x', `${state.currentRotateX.toFixed(2)}deg`)
  button.style.setProperty('--cover-rotate-y', `${state.currentRotateY.toFixed(2)}deg`)
  button.style.setProperty('--cover-shift-x', `${state.currentShiftX.toFixed(2)}px`)
  button.style.setProperty('--cover-shift-y', `${state.currentShiftY.toFixed(2)}px`)
}

function getBookCoverParallaxState(button: HTMLButtonElement) {
  const existingState = bookCoverParallaxStates.get(button)

  if (existingState) {
    return existingState
  }

  const nextState: BookCoverParallaxState = {
    currentRotateX: 0,
    currentRotateY: 0,
    currentShiftX: 0,
    currentShiftY: 0,
    targetRotateX: 0,
    targetRotateY: 0,
    targetShiftX: 0,
    targetShiftY: 0,
    frameId: null,
  }

  bookCoverParallaxStates.set(button, nextState)
  return nextState
}

function animateBookCoverParallax(button: HTMLButtonElement) {
  const state = bookCoverParallaxStates.get(button)

  if (!state) {
    return
  }

  const easing = 0.16

  state.currentRotateX += (state.targetRotateX - state.currentRotateX) * easing
  state.currentRotateY += (state.targetRotateY - state.currentRotateY) * easing
  state.currentShiftX += (state.targetShiftX - state.currentShiftX) * easing
  state.currentShiftY += (state.targetShiftY - state.currentShiftY) * easing

  syncBookCoverParallax(button, state)

  const isSettled =
    Math.abs(state.targetRotateX - state.currentRotateX) < 0.08 &&
    Math.abs(state.targetRotateY - state.currentRotateY) < 0.08 &&
    Math.abs(state.targetShiftX - state.currentShiftX) < 0.08 &&
    Math.abs(state.targetShiftY - state.currentShiftY) < 0.08

  if (isSettled) {
    state.currentRotateX = state.targetRotateX
    state.currentRotateY = state.targetRotateY
    state.currentShiftX = state.targetShiftX
    state.currentShiftY = state.targetShiftY
    syncBookCoverParallax(button, state)
    state.frameId = null
    return
  }

  state.frameId = window.requestAnimationFrame(() => {
    animateBookCoverParallax(button)
  })
}

function queueBookCoverParallax(button: HTMLButtonElement) {
  const state = getBookCoverParallaxState(button)

  if (state.frameId !== null) {
    return
  }

  state.frameId = window.requestAnimationFrame(() => {
    animateBookCoverParallax(button)
  })
}

function updateBookCoverParallax(event: ReactPointerEvent<HTMLButtonElement>) {
  if (event.pointerType === 'touch' || prefersReducedMotion()) {
    return
  }

  const button = event.currentTarget
  const bounds = button.getBoundingClientRect()

  if (!bounds.width || !bounds.height) {
    return
  }

  const horizontalRatio = (event.clientX - bounds.left) / bounds.width - 0.5
  const verticalRatio = (event.clientY - bounds.top) / bounds.height - 0.5
  const state = getBookCoverParallaxState(button)

  state.targetRotateX = -verticalRatio * 5.5
  state.targetRotateY = horizontalRatio * 7
  state.targetShiftX = horizontalRatio * 4
  state.targetShiftY = verticalRatio * 4

  queueBookCoverParallax(button)
}

function resetBookCoverParallax(event: ReactPointerEvent<HTMLButtonElement>) {
  const button = event.currentTarget
  const state = getBookCoverParallaxState(button)

  state.targetRotateX = 0
  state.targetRotateY = 0
  state.targetShiftX = 0
  state.targetShiftY = 0

  if (prefersReducedMotion()) {
    state.currentRotateX = 0
    state.currentRotateY = 0
    state.currentShiftX = 0
    state.currentShiftY = 0
    syncBookCoverParallax(button, state)
    return
  }

  queueBookCoverParallax(button)
}

const PUBLIC_SHELF_SORT_OPTIONS: Array<{
  value: PublicCatalogSort
  label: string
}> = [
  { value: 'popularity', label: 'Popular' },
  { value: 'relevance', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
  { value: 'author-alpha', label: 'Author A-Z' },
  { value: 'length', label: 'Shortest first' },
  { value: 'reading-ease', label: 'Easy reads' },
]

const PUBLIC_SHELF_PAGE_SIZE = 24
const INITIAL_PUBLIC_SHELF_VISIBLE_COUNT = 48

interface MergedPublicBookEntry {
  book: PublicCatalogBook
  standardRank: number | null
  feedbooksRank: number | null
  searchScore: number
}

function normalizeCatalogText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getPublicBookMergeKey(book: PublicCatalogBook) {
  return `${normalizeCatalogText(book.title)}::${normalizeCatalogText(book.author)}`
}

function mergePublicBookData(
  preferredBook: PublicCatalogBook,
  fallbackBook: PublicCatalogBook,
) {
  return {
    ...preferredBook,
    description: preferredBook.description || fallbackBook.description,
    coverUrl: preferredBook.coverUrl || fallbackBook.coverUrl,
    language: preferredBook.language || fallbackBook.language,
    subjects: preferredBook.subjects.length
      ? preferredBook.subjects
      : fallbackBook.subjects,
    downloadUrl: preferredBook.downloadUrl || fallbackBook.downloadUrl,
  }
}

function scorePublicBook(book: PublicCatalogBook, normalizedQuery: string) {
  if (!normalizedQuery) {
    return 0
  }

  const title = normalizeCatalogText(book.title)
  const author = normalizeCatalogText(book.author)
  const subjects = normalizeCatalogText(book.subjects.join(' '))
  const tokens = normalizedQuery.split(' ').filter(Boolean)

  let score = 0

  if (title === normalizedQuery) {
    score += 1200
  }

  if (author === normalizedQuery) {
    score += 900
  }

  if (title.startsWith(normalizedQuery)) {
    score += 600
  }

  if (author.startsWith(normalizedQuery)) {
    score += 450
  }

  if (title.includes(normalizedQuery)) {
    score += 320
  }

  if (author.includes(normalizedQuery)) {
    score += 220
  }

  for (const token of tokens) {
    if (title.includes(token)) {
      score += 75
    }

    if (author.includes(token)) {
      score += 55
    }

    if (subjects.includes(token)) {
      score += 20
    }
  }

  return score
}

function compareCatalogText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function getMergedPublicBookRank(entry: MergedPublicBookEntry) {
  return Math.min(
    entry.standardRank ?? Number.MAX_SAFE_INTEGER,
    entry.feedbooksRank ?? Number.MAX_SAFE_INTEGER,
  )
}

function compareMergedPublicBooksBySourceRank(
  left: MergedPublicBookEntry,
  right: MergedPublicBookEntry,
) {
  return (
    getMergedPublicBookRank(left) - getMergedPublicBookRank(right) ||
    Number(left.standardRank === null) - Number(right.standardRank === null) ||
    compareCatalogText(left.book.title, right.book.title) ||
    compareCatalogText(left.book.author, right.book.author)
  )
}

function buildPublicBooks(options: {
  standardBooks: PublicCatalogBook[]
  feedbooksBooks: PublicCatalogBook[]
  normalizedQuery: string
  sort: PublicCatalogSort
}) {
  const mergedEntries = new Map<string, MergedPublicBookEntry>()

  const upsertEntry = (
    book: PublicCatalogBook,
    source: 'standard' | 'feedbooks',
    rank: number,
  ) => {
    const key = getPublicBookMergeKey(book)
    const existingEntry = mergedEntries.get(key)
    const nextSearchScore = Math.max(
      existingEntry?.searchScore ?? 0,
      scorePublicBook(book, options.normalizedQuery),
    )

    if (!existingEntry) {
      mergedEntries.set(key, {
        book,
        standardRank: source === 'standard' ? rank : null,
        feedbooksRank: source === 'feedbooks' ? rank : null,
        searchScore: nextSearchScore,
      })
      return
    }

    mergedEntries.set(key, {
      book:
        source === 'standard'
          ? mergePublicBookData(book, existingEntry.book)
          : mergePublicBookData(existingEntry.book, book),
      standardRank:
        source === 'standard' ? rank : existingEntry.standardRank,
      feedbooksRank:
        source === 'feedbooks' ? rank : existingEntry.feedbooksRank,
      searchScore: nextSearchScore,
    })
  }

  options.standardBooks.forEach((book, index) => {
    upsertEntry(book, 'standard', index)
  })

  options.feedbooksBooks.forEach((book, index) => {
    upsertEntry(book, 'feedbooks', index)
  })

  const mergedBooks = [...mergedEntries.values()]

  switch (options.sort) {
    case 'author-alpha':
      return mergedBooks
        .sort(
          (left, right) =>
            compareCatalogText(left.book.author, right.book.author) ||
            compareCatalogText(left.book.title, right.book.title) ||
            compareMergedPublicBooksBySourceRank(left, right),
        )
        .map((entry) => entry.book)
    case 'relevance':
      if (options.normalizedQuery) {
        return mergedBooks
          .sort(
            (left, right) =>
              right.searchScore - left.searchScore ||
              compareMergedPublicBooksBySourceRank(left, right),
          )
          .map((entry) => entry.book)
      }

      return mergedBooks
        .sort(compareMergedPublicBooksBySourceRank)
        .map((entry) => entry.book)
    case 'newest':
    case 'popularity':
    case 'length':
    case 'reading-ease':
    default:
      return mergedBooks
        .sort(compareMergedPublicBooksBySourceRank)
        .map((entry) => entry.book)
  }
}

export function LibraryView({
  books,
  analytics,
  isImporting,
  importError,
  publicImportBookId,
  publicImportError,
  publicBookIdsByIdentifier,
  onImport,
  onImportPublicBook,
  onOpen,
  onDelete,
}: LibraryViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null)
  const [activeShelf, setActiveShelf] = useState<'mine' | 'public'>(() =>
    books.length ? 'mine' : 'public',
  )
  const [publicQuery, setPublicQuery] = useState('')
  const deferredPublicQuery = useDeferredValue(publicQuery.trim())
  const [publicSort, setPublicSort] = useState<PublicCatalogSort>('popularity')
  const [publicStandardBooks, setPublicStandardBooks] = useState<PublicCatalogBook[]>([])
  const [publicNextPageUrl, setPublicNextPageUrl] = useState<string | null>(null)
  const [publicVisibleCount, setPublicVisibleCount] = useState(
    INITIAL_PUBLIC_SHELF_VISIBLE_COUNT,
  )
  const [isLoadingMorePublicShelf, setIsLoadingMorePublicShelf] = useState(false)
  const [publicShelfError, setPublicShelfError] = useState<string | null>(null)
  const [resolvedPublicRequestKey, setResolvedPublicRequestKey] = useState<
    string | null
  >(null)

  const sortedBooks = [...books].sort((left, right) => {
    const leftScore = left.lastOpenedAt ?? left.addedAt
    const rightScore = right.lastOpenedAt ?? right.addedAt
    return new Date(rightScore).getTime() - new Date(leftScore).getTime()
  })

  const streak = getCurrentStreak(analytics)
  const totalMinutesRead = getTotalMinutesRead(analytics)
  const pagesToday = getPagesToday(analytics)
  const totalHighlights = books.reduce((total, book) => total + book.highlights.length, 0)
  const combinedPublicError = publicImportError ?? publicShelfError
  const normalizedPublicQuery = normalizeCatalogText(deferredPublicQuery)
  const publicRequestKey = `${publicSort}::${normalizedPublicQuery}`
  const publicRequestKeyRef = useRef(publicRequestKey)
  publicRequestKeyRef.current = publicRequestKey
  const publicFeedbooksLimit = Math.max(
    publicVisibleCount + PUBLIC_SHELF_PAGE_SIZE,
    normalizedPublicQuery ? 120 : 72,
  )
  const publicFeedbooksTotalCount = getFeedbooksPublicDomainMatchCount({
    query: deferredPublicQuery,
  })
  const feedbooksPublicBooks = searchFeedbooksPublicDomainBooks({
    query: deferredPublicQuery,
    sort: publicSort,
    limit: publicFeedbooksLimit,
  })
  const publicBooks = buildPublicBooks({
    standardBooks: publicStandardBooks,
    feedbooksBooks: feedbooksPublicBooks,
    normalizedQuery: normalizedPublicQuery,
    sort: publicSort,
  })
  const visiblePublicBooks = publicBooks.slice(0, publicVisibleCount)
  const canLoadMorePublicBooks =
    publicVisibleCount < publicBooks.length ||
    publicFeedbooksLimit < publicFeedbooksTotalCount ||
    Boolean(publicNextPageUrl)
  const isPublicShelfReady =
    activeShelf !== 'public' || resolvedPublicRequestKey === publicRequestKey

  const getTitleStyle = (title: string) => {
    if (title.length <= 20) {
      return undefined
    }

    return {
      '--title-scroll-distance': `-${Math.min(
        Math.max(title.length - 18, 4) * 0.42,
        18,
      )}ch`,
      '--title-scroll-duration': `${Math.max(7, title.length * 0.28)}s`,
    } as CSSProperties
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) {
      return
    }

    let cancelled = false
    let intervalId = 0

    const refreshWeather = async () => {
      try {
        const position = await getCurrentPosition()

        if (cancelled) {
          return
        }

        const { latitude, longitude } = position.coords
        const cachedWeather = readCachedWeather(latitude, longitude)

        if (cachedWeather) {
          setWeather(cachedWeather)
          return
        }

        const nextWeather = await fetchCurrentWeather(latitude, longitude)

        if (cancelled) {
          return
        }

        cacheWeather(nextWeather, latitude, longitude)
        setWeather(nextWeather)
      } catch (error) {
        const errorCode =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'number'
            ? error.code
            : null

        if (errorCode === 1) {
          window.clearInterval(intervalId)
        }

        // Keep the header clean when location or weather is unavailable.
      }
    }

    void refreshWeather()

    intervalId = window.setInterval(() => {
      void refreshWeather()
    }, WEATHER_CACHE_TTL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    setPublicVisibleCount(INITIAL_PUBLIC_SHELF_VISIBLE_COUNT)
  }, [deferredPublicQuery, publicSort])

  useEffect(() => {
    if (activeShelf !== 'public') {
      return
    }

    let cancelled = false
    setResolvedPublicRequestKey(null)
    setIsLoadingMorePublicShelf(false)
    setPublicShelfError(null)
    setPublicStandardBooks([])
    setPublicNextPageUrl(null)

    const timeoutId = window.setTimeout(() => {
      void fetchPublicCatalogPage({
        query: deferredPublicQuery,
        sort: publicSort,
      })
        .then((page) => {
          if (cancelled) {
            return
          }

          setPublicStandardBooks(page.books)
          setPublicNextPageUrl(page.nextPageUrl)
        })
        .catch(() => {
          if (cancelled) {
            return
          }

          setPublicStandardBooks([])
          setPublicNextPageUrl(null)
          setPublicShelfError('Could not reach the public shelf right now.')
        })
        .finally(() => {
          if (!cancelled) {
            setResolvedPublicRequestKey(publicRequestKey)
          }
        })
    }, normalizedPublicQuery ? 220 : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [activeShelf, deferredPublicQuery, normalizedPublicQuery, publicRequestKey, publicSort])

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) {
      return
    }

    onImport(
      Array.from(fileList).filter((file) => file.name.toLowerCase().endsWith('.epub')),
    )
  }

  const handlePublicBookAction = (book: PublicCatalogBook) => {
    const existingBookId = publicBookIdsByIdentifier.get(book.pageUrl)

    if (existingBookId) {
      onOpen(existingBookId)
      return
    }

    onImportPublicBook(book)
  }

  const handleLoadMorePublicBooks = async () => {
    if (!canLoadMorePublicBooks || isLoadingMorePublicShelf) {
      return
    }

    const nextVisibleCount = publicVisibleCount + PUBLIC_SHELF_PAGE_SIZE
    const shouldFetchNextStandardPage =
      publicBooks.length < nextVisibleCount &&
      publicFeedbooksLimit >= publicFeedbooksTotalCount &&
      Boolean(publicNextPageUrl)

    setPublicVisibleCount(nextVisibleCount)

    if (!shouldFetchNextStandardPage || !publicNextPageUrl) {
      return
    }

    const requestKey = publicRequestKey
    setIsLoadingMorePublicShelf(true)
    setPublicShelfError(null)

    try {
      const nextPage = await fetchPublicCatalogPage({
        pageUrl: publicNextPageUrl,
      })

      if (publicRequestKeyRef.current !== requestKey) {
        return
      }

      setPublicStandardBooks((currentBooks) => {
        const existingIds = new Set(currentBooks.map((book) => book.id))
        return [
          ...currentBooks,
          ...nextPage.books.filter((book) => !existingIds.has(book.id)),
        ]
      })
      setPublicNextPageUrl(nextPage.nextPageUrl)
    } catch {
      if (publicRequestKeyRef.current === requestKey) {
        setPublicShelfError('Could not load more public books right now.')
      }
    } finally {
      if (publicRequestKeyRef.current === requestKey) {
        setIsLoadingMorePublicShelf(false)
      }
    }
  }

  return (
    <div className="library-shell">
      <header className="library-header">
        <h1>Margin Reader</h1>
        <div className="library-clock" aria-live="polite">
          <span className="library-clock-label">{formatLibraryDate(now)}</span>
          <div className="library-clock-main">
            <span className="library-clock-time">{formatLibraryTime(now)}</span>
            {weather ? (
              <span
                className="library-weather"
                data-condition={weather.condition}
                data-day={weather.isDay ? 'day' : 'night'}
                role="img"
                aria-label={weather.label}
                title={weather.label}
              >
                <WeatherIcon
                  condition={weather.condition}
                  isDay={weather.isDay}
                />
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {activeShelf === 'mine' ? (
        <>
          <section className="hero-panel">
            <div className="hero-panel-copy">
              <div className="metric-grid">
                <article className="metric-card">
                  <span className="metric-value">{streak}</span>
                  <span className="metric-label">Streak</span>
                </article>
                <article className="metric-card">
                  <span className="metric-value">
                    {formatMinutesCompact(totalMinutesRead)}
                  </span>
                  <span className="metric-label">Time read</span>
                </article>
                <article className="metric-card">
                  <span className="metric-value">{pagesToday}</span>
                  <span className="metric-label">Pages today</span>
                </article>
                <article className="metric-card">
                  <span className="metric-value">{totalHighlights}</span>
                  <span className="metric-label">Highlights</span>
                </article>
              </div>
            </div>

            <div
              className={`import-card${isDragging ? ' import-card-active' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                if (event.currentTarget === event.target) {
                  setIsDragging(false)
                }
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDrop={(event) => {
                event.preventDefault()
                setIsDragging(false)
                handleFiles(event.dataTransfer.files)
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".epub,application/epub+zip"
                multiple
                className="sr-only"
                onChange={(event) => handleFiles(event.target.files)}
              />
              <p className="eyebrow">Import</p>
              <h2>Import your EPUBs</h2>
              <div className="import-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                >
                  {isImporting ? 'Importing...' : 'Choose files'}
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => setActiveShelf('public')}
                >
                  Browse public shelf
                </button>
              </div>
              {importError ? <p className="error-text">{importError}</p> : null}
            </div>
          </section>

          <section className="shelf-section">
            <div className="section-heading">
              <div>
                <h2>My Shelf</h2>
              </div>
            </div>

            {sortedBooks.length ? (
              <div className="book-grid">
                {sortedBooks.map((book) => {
                  const progress = Math.round(book.progress * 100)
                  const shouldScrollTitle = book.title.length > 20

                  return (
                    <article key={book.id} className="book-card">
                      <button
                        type="button"
                        className="book-card-open"
                        onClick={() => onOpen(book.id)}
                        onPointerMove={updateBookCoverParallax}
                        onPointerLeave={resetBookCoverParallax}
                        onPointerCancel={resetBookCoverParallax}
                      >
                        <span className="book-cover-frame">
                          {book.coverUrl ? (
                            <img
                              src={book.coverUrl}
                              alt={`Cover for ${book.title}`}
                              className="book-cover"
                            />
                          ) : (
                            <div className="book-cover book-cover-fallback">
                              <span>{book.title.slice(0, 1).toUpperCase()}</span>
                            </div>
                          )}
                        </span>
                      </button>

                      <div className="book-card-body">
                        <div className="book-meta">
                          <div className="book-title-wrap" title={book.title}>
                            <p
                              className={`book-title${
                                shouldScrollTitle ? ' book-title-marquee' : ''
                              }`}
                              style={getTitleStyle(book.title)}
                            >
                              {book.title}
                            </p>
                          </div>
                          <p className="book-author">{book.author}</p>
                        </div>

                        <div className="book-progress">
                          <div className="progress-track">
                            <span
                              className="progress-fill"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <div className="book-progress-meta">
                            <span>{progress}% read</span>
                          </div>
                        </div>

                        <div className="book-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            onClick={() => onOpen(book.id)}
                          >
                            {progress > 0 ? 'Continue' : 'Open'}
                          </button>
                          <button
                            type="button"
                            className="button button-ghost"
                            onClick={() => onDelete(book.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-copy">
                  <h2>Your shelf is empty.</h2>
                  <p className="muted-copy">Import your own EPUBs to get started.</p>
                </div>
                <div className="import-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                  >
                    Import a book
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => setActiveShelf('public')}
                  >
                    Browse public shelf
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="shelf-section public-shelf-section">
          <div className="section-heading">
            <div>
              <h2>Public Shelf</h2>
            </div>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => setActiveShelf('mine')}
            >
              Back to my shelf
            </button>
          </div>

          <div className="public-shelf-toolbar">
            <label className="public-shelf-field">
              <span>Search</span>
              <input
                type="search"
                className="public-shelf-input"
                placeholder="Search by title or author"
                value={publicQuery}
                onChange={(event) => setPublicQuery(event.target.value)}
              />
            </label>

            <label className="public-shelf-field public-shelf-sort">
              <span>Sort</span>
              <select
                value={publicSort}
                onChange={(event) => setPublicSort(event.target.value as PublicCatalogSort)}
              >
                {PUBLIC_SHELF_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {combinedPublicError ? <p className="error-text">{combinedPublicError}</p> : null}

          {!isPublicShelfReady ? (
            <div className="empty-state">
              <div className="empty-state-copy">
                <h2>Searching public shelf...</h2>
              </div>
            </div>
          ) : publicBooks.length ? (
            <>
              <div className="book-grid">
                {visiblePublicBooks.map((book) => {
                  const ownedBookId = publicBookIdsByIdentifier.get(book.pageUrl)
                  const shouldScrollTitle = book.title.length > 20
                  const isLoadingThisBook = publicImportBookId === book.id

                  return (
                    <article key={book.id} className="book-card">
                      <button
                        type="button"
                        className="book-card-open"
                        onClick={() => handlePublicBookAction(book)}
                        onPointerMove={updateBookCoverParallax}
                        onPointerLeave={resetBookCoverParallax}
                        onPointerCancel={resetBookCoverParallax}
                      >
                        <span className="book-cover-frame">
                          {book.coverUrl ? (
                            <img
                              src={book.coverUrl}
                              alt={`Cover for ${book.title}`}
                              className="book-cover"
                            />
                          ) : (
                            <div className="book-cover book-cover-fallback">
                              <span>{book.title.slice(0, 1).toUpperCase()}</span>
                            </div>
                          )}
                        </span>
                      </button>

                      <div className="book-card-body">
                        <div className="book-meta">
                          <div className="book-title-wrap" title={book.title}>
                            <p
                              className={`book-title${
                                shouldScrollTitle ? ' book-title-marquee' : ''
                              }`}
                              style={getTitleStyle(book.title)}
                            >
                              {book.title}
                            </p>
                          </div>
                          <p className="book-author">{book.author}</p>
                        </div>

                        {book.description ? (
                          <p className="public-book-copy">{book.description}</p>
                        ) : null}

                        <div className="book-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            onClick={() => handlePublicBookAction(book)}
                            disabled={isLoadingThisBook}
                          >
                            {ownedBookId
                              ? 'Open'
                              : isLoadingThisBook
                                ? 'Loading...'
                                : 'Read'}
                          </button>
                          <a
                            href={book.pageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="button button-ghost"
                          >
                            Source
                          </a>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>

              {canLoadMorePublicBooks ? (
                <div className="public-shelf-footer">
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => {
                      void handleLoadMorePublicBooks()
                    }}
                    disabled={isLoadingMorePublicShelf}
                  >
                    {isLoadingMorePublicShelf ? 'Loading more...' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-copy">
                <h2>No public books found.</h2>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
