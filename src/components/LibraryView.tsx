import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
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
import type { BookRecord, ReadingAnalytics } from '../types'

interface LibraryViewProps {
  books: BookRecord[]
  analytics: ReadingAnalytics
  isImporting: boolean
  importError?: string | null
  onImport: (files: File[]) => void
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

export function LibraryView({
  books,
  analytics,
  isImporting,
  importError,
  onImport,
  onOpen,
  onDelete,
}: LibraryViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null)

  const sortedBooks = [...books].sort((left, right) => {
    const leftScore = left.lastOpenedAt ?? left.addedAt
    const rightScore = right.lastOpenedAt ?? right.addedAt
    return new Date(rightScore).getTime() - new Date(leftScore).getTime()
  })

  const streak = getCurrentStreak(analytics)
  const totalMinutesRead = getTotalMinutesRead(analytics)
  const pagesToday = getPagesToday(analytics)
  const totalHighlights = books.reduce((total, book) => total + book.highlights.length, 0)

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

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) {
      return
    }

    onImport(
      Array.from(fileList).filter((file) => file.name.toLowerCase().endsWith('.epub')),
    )
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
          <h2>Start with EPUBs</h2>
          <div className="import-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting ? 'Importing...' : 'Choose files'}
            </button>
          </div>
          {importError ? <p className="error-text">{importError}</p> : null}
        </div>
      </section>

      <section className="shelf-section">
        <div className="section-heading">
          <div>
            <h2>Shelf</h2>
          </div>
        </div>

        {sortedBooks.length ? (
          <div className="book-grid">
            {sortedBooks.map((book) => {
              const progress = Math.round(book.progress * 100)
              const shouldScrollTitle = book.title.length > 20
              const titleStyle = shouldScrollTitle
                ? ({
                    '--title-scroll-distance': `-${Math.min(
                      Math.max(book.title.length - 18, 4) * 0.42,
                      18,
                    )}ch`,
                    '--title-scroll-duration': `${Math.max(
                      7,
                      book.title.length * 0.28,
                    )}s`,
                  } as CSSProperties)
                : undefined

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
                          style={titleStyle}
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
              <p className="muted-copy">Import an EPUB to get started.</p>
            </div>
            <button
              type="button"
              className="button button-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              Import a book
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
