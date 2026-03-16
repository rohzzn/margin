import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import ePub, {
  type Book,
  type Contents,
  type Location as RenditionLocation,
  type Rendition,
} from 'epubjs'
import {
  chapterLabelForHref,
  flattenToc,
  searchBook,
} from '../lib/epub'
import type {
  BookRecord,
  HighlightEntry,
  ReaderSettings,
  ReaderTheme,
  SearchResult,
  TocEntry,
} from '../types'

interface ReaderViewProps {
  book: BookRecord
  file: Blob | null
  settings: ReaderSettings
  onClose: () => void
  onRecordActivity: (activity: {
    minutes?: number
    pages?: number
    date?: Date
    startedAt?: Date
    endedAt?: Date
  }) => void
  onUpdateBook: (
    bookId: string,
    updater: (currentBook: BookRecord) => BookRecord,
  ) => void
  onSettingsChange: (
    nextSettings:
      | ReaderSettings
      | ((currentSettings: ReaderSettings) => ReaderSettings),
  ) => void
}

type PanelTab = 'toc' | 'search' | 'lookup' | 'notes' | 'display'

type SelectionState = {
  cfiRange: string
  text: string
}

type DictionaryResult = {
  word: string
  phonetic?: string
  meanings: Array<{
    partOfSpeech: string
    definitions: string[]
  }>
}

const PANEL_LABELS: Record<PanelTab, string> = {
  toc: 'TOC',
  search: 'Search',
  lookup: 'Lookup',
  notes: 'Saved',
  display: 'View',
}

const THEME_STYLES: Record<
  ReaderTheme,
  {
    canvas: string
    surface: string
    text: string
    accent: string
    selection: string
    highlight: string
  }
> = {
  linen: {
    canvas: '#f7f2e8',
    surface: '#fffdf8',
    text: '#1d1b18',
    accent: '#b56b2f',
    selection: 'rgba(181, 107, 47, 0.22)',
    highlight: 'rgba(242, 193, 68, 0.45)',
  },
  mist: {
    canvas: '#edf2f2',
    surface: '#fbfcfc',
    text: '#132124',
    accent: '#2f7d7b',
    selection: 'rgba(47, 125, 123, 0.22)',
    highlight: 'rgba(111, 199, 191, 0.4)',
  },
  sepia: {
    canvas: '#ede0c7',
    surface: '#f9f1dd',
    text: '#34251a',
    accent: '#9a5928',
    selection: 'rgba(154, 89, 40, 0.22)',
    highlight: 'rgba(235, 176, 85, 0.42)',
  },
  midnight: {
    canvas: '#07111f',
    surface: '#0d1728',
    text: '#e7edf7',
    accent: '#8ec5ff',
    selection: 'rgba(142, 197, 255, 0.22)',
    highlight: 'rgba(96, 154, 255, 0.34)',
  },
}

const FONT_STACKS = {
  serif: '"Palatino Linotype", "Book Antiqua", Georgia, serif',
  sans: '"Trebuchet MS", "Avenir Next", Arial, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
  poppins: '"Poppins", "Avenir Next", Arial, sans-serif',
  sf: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif',
  literata: '"Literata", Georgia, serif',
} as const

const FONT_LABELS = {
  serif: 'Book',
  sans: 'Grotesk',
  mono: 'Mono',
  poppins: 'Poppins',
  sf: 'SF',
  literata: 'Literata',
} as const

const READER_FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Literata:opsz,wght@7..72,400;7..72,500;7..72,600&display=swap'

const POMODORO_DURATION = 25 * 60
const POMODORO_CLICK_DELAY_MS = 220

function highlightSelectionColor(theme: ReaderTheme) {
  return THEME_STYLES[theme].highlight
}

function normalizeLookupTerm(value: string) {
  const trimmed = value.trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')

  if (!trimmed || /\s/.test(trimmed)) {
    return ''
  }

  return trimmed.toLowerCase()
}

function parseDictionaryResult(payload: unknown): DictionaryResult | null {
  if (!Array.isArray(payload) || !payload.length) {
    return null
  }

  const entry = payload[0] as {
    word?: string
    phonetic?: string
    meanings?: Array<{
      partOfSpeech?: string
      definitions?: Array<{ definition?: string }>
    }>
  }

  const meanings =
    entry.meanings
      ?.map((meaning) => ({
        partOfSpeech: meaning.partOfSpeech ?? 'Meaning',
        definitions:
          meaning.definitions
            ?.map((definition) => definition.definition?.trim())
            .filter((definition): definition is string => Boolean(definition))
            .slice(0, 3) ?? [],
      }))
      .filter((meaning) => meaning.definitions.length) ?? []

  if (!entry.word || !meanings.length) {
    return null
  }

  return {
    word: entry.word,
    phonetic: entry.phonetic,
    meanings: meanings.slice(0, 3),
  }
}

function formatPomodoroTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds)
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function applyReaderStyle(rendition: Rendition, settings: ReaderSettings) {
  const theme = THEME_STYLES[settings.theme]

  rendition.themes.register('margin-theme', {
    body: {
      color: `${theme.text} !important`,
      'background-color': `${theme.surface} !important`,
      'font-family': `${FONT_STACKS[settings.fontFamily]} !important`,
      'line-height': `${settings.lineHeight} !important`,
      'font-size': `${settings.fontScale}% !important`,
      margin: '0 auto !important',
      padding: '0 0 3rem !important',
    },
    a: {
      color: `${theme.accent} !important`,
    },
    img: {
      'max-width': '100% !important',
      height: 'auto !important',
    },
    '::selection': {
      background: `${theme.selection} !important`,
    },
    p: {
      orphans: '3',
      widows: '3',
    },
  })
  rendition.themes.select('margin-theme')
  rendition.themes.fontSize(`${settings.fontScale}%`)
  rendition.themes.override('font-family', FONT_STACKS[settings.fontFamily], true)
  rendition.themes.override('line-height', String(settings.lineHeight), true)
  rendition.themes.override('color', theme.text, true)
  rendition.themes.override('background-color', theme.surface, true)
}

function addHighlightAnnotation(rendition: Rendition, highlight: HighlightEntry) {
  rendition.annotations.highlight(
    highlight.cfiRange,
    { id: highlight.id },
    undefined,
    'reader-highlight',
    {
      fill: highlight.color,
      'fill-opacity': '0.9',
      'mix-blend-mode': 'multiply',
    },
  )
}

function markExcerpt(excerpt: string, query: string) {
  if (!query.trim()) {
    return excerpt
  }

  const pattern = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig')
  const parts = excerpt.split(pattern)

  return parts.map((part, index) =>
    pattern.test(part) ? <mark key={`${part}-${index}`}>{part}</mark> : part,
  )
}

export function ReaderView({
  book,
  file,
  settings,
  onClose,
  onRecordActivity,
  onUpdateBook,
  onSettingsChange,
}: ReaderViewProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const appliedHighlightsRef = useRef<HighlightEntry[]>([])
  const selectedContentsRef = useRef<Contents | null>(null)
  const lastLocationRef = useRef<number | null>(null)
  const readingSessionStartedAtRef = useRef<number | null>(null)
  const pomodoroEndAtRef = useRef<number | null>(null)
  const pomodoroClickTimeoutRef = useRef<number | null>(null)
  const bookSnapshotRef = useRef({
    currentCfi: book.currentCfi,
    locations: book.locations,
    highlights: book.highlights,
    spread: settings.spread,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isIndexing, setIsIndexing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([])
  const [location, setLocation] = useState<RenditionLocation | null>(null)
  const [chapterLabel, setChapterLabel] = useState('')
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<PanelTab>('toc')
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [lookupQuery, setLookupQuery] = useState('')
  const [lookupResult, setLookupResult] = useState<DictionaryResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [pomodoroSecondsLeft, setPomodoroSecondsLeft] = useState(POMODORO_DURATION)
  const [isPomodoroRunning, setIsPomodoroRunning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const themeStyle = THEME_STYLES[settings.theme]
  bookSnapshotRef.current = {
    currentCfi: book.currentCfi,
    locations: book.locations,
    highlights: book.highlights,
    spread: settings.spread,
  }
  const currentProgress = Math.round(
    ((location?.start.percentage ?? book.progress) || 0) * 100,
  )
  const readerSubtitle = [
    `${currentProgress}%`,
    chapterLabel || book.author,
    isIndexing ? 'Indexing...' : null,
  ]
    .filter(Boolean)
    .join(' • ')
  const selectedLookupTerm = normalizeLookupTerm(selection?.text ?? '')
  const currentBookmark = useMemo(
    () => book.bookmarks.find((entry) => entry.cfi === location?.start.cfi),
    [book.bookmarks, location?.start.cfi],
  )

  const navigateTo = async (target?: string) => {
    if (!renditionRef.current) {
      return
    }

    await renditionRef.current.display(target)
    setSelection(null)
  }

  const updateLocation = useEffectEvent((nextLocation: RenditionLocation) => {
    const nextPageLocation =
      typeof nextLocation.start.location === 'number'
        ? nextLocation.start.location
        : null
    const previousPageLocation = lastLocationRef.current

    if (previousPageLocation !== null && nextPageLocation !== null) {
      const delta = nextPageLocation - previousPageLocation

      if (delta > 0 && delta <= 12) {
        recordActivity({ pages: delta })
      }
    }

    lastLocationRef.current = nextPageLocation
    setLocation(nextLocation)
    setChapterLabel(chapterLabelForHref(tocEntries, nextLocation.start.href))

    onUpdateBook(book.id, (currentBook) => ({
      ...currentBook,
      currentCfi: nextLocation.start.cfi,
      progress: Number.isFinite(nextLocation.start.percentage)
        ? nextLocation.start.percentage
        : currentBook.progress,
      lastOpenedAt: new Date().toISOString(),
    }))
  })

  const applyCurrentStyle = useEffectEvent((rendition: Rendition) => {
    applyReaderStyle(rendition, settings)
  })

  const recordActivity = useEffectEvent((activity: { minutes?: number; pages?: number }) => {
    onRecordActivity(activity)
  })

  const syncPomodoro = useEffectEvent(() => {
    const endAt = pomodoroEndAtRef.current

    if (!endAt) {
      return
    }

    const nextSecondsLeft = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))

    if (nextSecondsLeft > 0) {
      setPomodoroSecondsLeft(nextSecondsLeft)
      return
    }

    pomodoroEndAtRef.current = null
    setIsPomodoroRunning(false)
    setPomodoroSecondsLeft(POMODORO_DURATION)
  })

  const flushReadingTime = useEffectEvent((endedAt = Date.now()) => {
    const startedAt = readingSessionStartedAtRef.current

    if (startedAt === null || endedAt <= startedAt) {
      readingSessionStartedAtRef.current = endedAt
      return
    }

    onRecordActivity({
      startedAt: new Date(startedAt),
      endedAt: new Date(endedAt),
    })
    readingSessionStartedAtRef.current = endedAt
  })

  const togglePomodoro = () => {
    if (isPomodoroRunning) {
      const endAt = pomodoroEndAtRef.current

      if (endAt) {
        const nextSecondsLeft = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
        setPomodoroSecondsLeft(nextSecondsLeft || POMODORO_DURATION)
      }

      pomodoroEndAtRef.current = null
      setIsPomodoroRunning(false)
      return
    }

    const nextDuration = pomodoroSecondsLeft > 0 ? pomodoroSecondsLeft : POMODORO_DURATION
    setPomodoroSecondsLeft(nextDuration)
    pomodoroEndAtRef.current = Date.now() + nextDuration * 1000
    setIsPomodoroRunning(true)
  }

  const resetPomodoro = () => {
    pomodoroEndAtRef.current = null
    setIsPomodoroRunning(false)
    setPomodoroSecondsLeft(POMODORO_DURATION)
  }

  const handlePomodoroClick = () => {
    if (pomodoroClickTimeoutRef.current !== null) {
      window.clearTimeout(pomodoroClickTimeoutRef.current)
    }

    pomodoroClickTimeoutRef.current = window.setTimeout(() => {
      pomodoroClickTimeoutRef.current = null
      togglePomodoro()
    }, POMODORO_CLICK_DELAY_MS)
  }

  const handlePomodoroDoubleClick = () => {
    if (pomodoroClickTimeoutRef.current !== null) {
      window.clearTimeout(pomodoroClickTimeoutRef.current)
      pomodoroClickTimeoutRef.current = null
    }

    resetPomodoro()
  }

  const persistBookUpdate = useEffectEvent(
    (updater: (currentBook: BookRecord) => BookRecord) => {
      onUpdateBook(book.id, updater)
    },
  )

  const runLookup = async (rawTerm: string) => {
    const term = normalizeLookupTerm(rawTerm)
    setPanelOpen(true)
    setPanelTab('lookup')
    setLookupQuery(term || rawTerm.trim())

    if (!term) {
      setLookupResult(null)
      setLookupError('Select a single word to look it up.')
      return
    }

    setIsLookingUp(true)
    setLookupError(null)

    try {
      const response = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`,
      )

      if (!response.ok) {
        throw new Error('No definition found.')
      }

      const payload = (await response.json()) as unknown
      const parsed = parseDictionaryResult(payload)

      if (!parsed) {
        throw new Error('No definition found.')
      }

      setLookupResult(parsed)
    } catch (error) {
      setLookupResult(null)
      setLookupError(error instanceof Error ? error.message : 'Lookup failed.')
    } finally {
      setIsLookingUp(false)
    }
  }

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
    }
  }, [])

  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) {
      return
    }

    rendition.spread(settings.spread)
    applyReaderStyle(rendition, settings)
  }, [settings])

  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) {
      return
    }

    for (const highlight of appliedHighlightsRef.current) {
      rendition.annotations.remove(highlight.cfiRange, 'highlight')
    }

    for (const highlight of book.highlights) {
      addHighlightAnnotation(rendition, highlight)
    }

    appliedHighlightsRef.current = book.highlights
  }, [book.highlights, book.id])

  useEffect(() => {
    const viewportElement = viewportRef.current
    const snapshot = bookSnapshotRef.current
    const initialCfi = snapshot.currentCfi
    const savedLocations = snapshot.locations
    const initialHighlights = snapshot.highlights
    const initialSpread = snapshot.spread

    if (!file || !viewportElement) {
      return
    }

    let cancelled = false

    const initialize = async () => {
      setIsLoading(true)
      setLoadError(null)
      setSearchResults([])

      const nextBook = ePub()
      bookRef.current = nextBook

      try {
        await nextBook.open(await file.arrayBuffer())
        await nextBook.ready

        if (cancelled) {
          return
        }

        const navigation = await nextBook.loaded.navigation
        const nextToc = flattenToc(navigation.toc)
        setTocEntries(nextToc)
        setChapterLabel(chapterLabelForHref(nextToc, initialCfi))

        const rendition = nextBook.renderTo(viewportElement, {
          width: '100%',
          height: '100%',
          flow: settings.flow,
          spread: initialSpread,
          manager: settings.flow === 'scrolled-doc' ? 'continuous' : 'default',
          allowScriptedContent: false,
        })

        renditionRef.current = rendition
        rendition.hooks.content.register((contents: Contents) =>
          contents.addStylesheet(READER_FONT_STYLESHEET),
        )
        applyCurrentStyle(rendition)

        rendition.on('relocated', (nextLocation: RenditionLocation) => {
          updateLocation(nextLocation)
        })

        rendition.on('selected', (cfiRange: string, contents: Contents) => {
          const text = contents.window.getSelection?.()?.toString().trim() ?? ''
          selectedContentsRef.current = contents

          if (!text) {
            setSelection(null)
            return
          }

          setSelection({ cfiRange, text })
        })

        if (savedLocations) {
          nextBook.locations.load(savedLocations)
        }

        await rendition.display(initialCfi)

        if (cancelled) {
          return
        }

        for (const highlight of initialHighlights) {
          addHighlightAnnotation(rendition, highlight)
        }

        lastLocationRef.current =
          typeof rendition.location?.start?.location === 'number'
            ? rendition.location.start.location
            : null
        appliedHighlightsRef.current = initialHighlights
        setIsLoading(false)

        if (!savedLocations) {
          setIsIndexing(true)
          await nextBook.locations.generate(1200)

          if (!cancelled) {
            persistBookUpdate((currentBook) => ({
              ...currentBook,
              locations: nextBook.locations.save(),
            }))
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : 'The book could not be loaded.',
          )
          setIsLoading(false)
        }
      } finally {
        if (!cancelled) {
          setIsIndexing(false)
        }
      }
    }

    void initialize()

    return () => {
      cancelled = true
      setSelection(null)
      appliedHighlightsRef.current = []
      selectedContentsRef.current = null
      lastLocationRef.current = null
      renditionRef.current?.destroy()
      bookRef.current?.destroy()
      renditionRef.current = null
      bookRef.current = null
      viewportElement.innerHTML = ''
    }
  }, [book.id, file, settings.flow])

  const handleKeyboardShortcuts = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    const tagName = target?.tagName ?? ''
    const isTypingTarget =
      target?.isContentEditable ||
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT'

    if (isTypingTarget) {
      return
    }

    if (event.key === '/') {
      event.preventDefault()
      setPanelOpen(true)
      setPanelTab('search')
      window.requestAnimationFrame(() => searchInputRef.current?.focus())
      return
    }

    if (event.key === 'Escape') {
      if (selection) {
        selectedContentsRef.current?.window.getSelection?.()?.removeAllRanges()
        setSelection(null)
        return
      }

      if (panelOpen) {
        setPanelOpen(false)
      }
      return
    }

    if (
      event.key === 'ArrowRight' ||
      event.key === 'PageDown' ||
      event.key.toLowerCase() === 'd'
    ) {
      event.preventDefault()
      void renditionRef.current?.next()
      return
    }

    if (
      event.key === 'ArrowLeft' ||
      event.key === 'PageUp' ||
      event.key.toLowerCase() === 'a'
    ) {
      event.preventDefault()
      void renditionRef.current?.prev()
      return
    }

    if (event.key === ' ') {
      event.preventDefault()
      void renditionRef.current?.next()
      return
    }

    if (event.key.toLowerCase() === 'b') {
      event.preventDefault()
      const currentCfi = location?.start.cfi
      if (!currentCfi) {
        return
      }

      onUpdateBook(book.id, (currentBook) => {
        if (currentBook.bookmarks.some((entry) => entry.cfi === currentCfi)) {
          return currentBook
        }

        return {
          ...currentBook,
          bookmarks: [
            {
              id: crypto.randomUUID(),
              cfi: currentCfi,
              label: chapterLabel || currentBook.title,
              progress: location?.start.percentage ?? currentBook.progress,
              createdAt: new Date().toISOString(),
              chapterHref: location?.start.href,
            },
            ...currentBook.bookmarks,
          ],
        }
      })
      return
    }

    if (event.key.toLowerCase() === 'f') {
      event.preventDefault()
      if (document.fullscreenElement) {
        void document.exitFullscreen()
      } else {
        void shellRef.current?.requestFullscreen()
      }
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardShortcuts)
    return () => {
      window.removeEventListener('keydown', handleKeyboardShortcuts)
    }
  }, [])

  useEffect(() => {
    if (isLoading || loadError) {
      readingSessionStartedAtRef.current = null
      return
    }

    if (document.visibilityState === 'visible') {
      readingSessionStartedAtRef.current = Date.now()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushReadingTime()
        readingSessionStartedAtRef.current = null
        return
      }

      readingSessionStartedAtRef.current = Date.now()
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return
      }

      flushReadingTime()
    }, 30_000)

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (document.visibilityState === 'visible') {
        flushReadingTime()
      }

      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
      readingSessionStartedAtRef.current = null
    }
  }, [book.id, isLoading, loadError])

  useEffect(() => {
    if (!isPomodoroRunning) {
      return
    }

    syncPomodoro()

    const intervalId = window.setInterval(() => {
      syncPomodoro()
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isPomodoroRunning])

  useEffect(() => {
    return () => {
      if (pomodoroClickTimeoutRef.current !== null) {
        window.clearTimeout(pomodoroClickTimeoutRef.current)
      }
    }
  }, [])

  const submitSearch = async () => {
    if (!bookRef.current) {
      return
    }

    const query = searchQuery.trim()
    if (!query) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    setPanelOpen(true)
    setPanelTab('search')

    try {
      const results = await searchBook(bookRef.current, query, tocEntries)
      setSearchResults(results)
    } finally {
      setIsSearching(false)
    }
  }

  const submitLookup = async () => {
    await runLookup(lookupQuery)
  }

  const toggleBookmark = () => {
    const currentCfi = location?.start.cfi
    if (!currentCfi) {
      return
    }

    if (currentBookmark) {
      onUpdateBook(book.id, (currentBook) => ({
        ...currentBook,
        bookmarks: currentBook.bookmarks.filter(
          (entry) => entry.id !== currentBookmark.id,
        ),
      }))
      return
    }

    onUpdateBook(book.id, (currentBook) => ({
      ...currentBook,
      bookmarks: [
        {
          id: crypto.randomUUID(),
          cfi: currentCfi,
          label: chapterLabel || currentBook.title,
          progress: location?.start.percentage ?? currentBook.progress,
          createdAt: new Date().toISOString(),
          chapterHref: location?.start.href,
        },
        ...currentBook.bookmarks,
      ],
    }))
  }

  const createHighlight = () => {
    if (!selection) {
      return
    }

    const nextHighlight: HighlightEntry = {
      id: crypto.randomUUID(),
      cfiRange: selection.cfiRange,
      text: selection.text,
      color: highlightSelectionColor(settings.theme),
      createdAt: new Date().toISOString(),
      chapterHref: location?.start.href,
    }

    onUpdateBook(book.id, (currentBook) => ({
      ...currentBook,
      highlights: [nextHighlight, ...currentBook.highlights],
    }))

    selectedContentsRef.current?.window.getSelection?.()?.removeAllRanges()
    setSelection(null)
    setPanelOpen(true)
    setPanelTab('notes')
  }

  const deleteHighlight = (highlightId: string) => {
    onUpdateBook(book.id, (currentBook) => ({
      ...currentBook,
      highlights: currentBook.highlights.filter(
        (highlight) => highlight.id !== highlightId,
      ),
    }))
  }

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await shellRef.current?.requestFullscreen()
  }

  return (
    <div
      ref={shellRef}
      className={`reader-shell reader-theme-${settings.theme}`}
      style={
        {
          '--reader-canvas': themeStyle.canvas,
          '--reader-surface': themeStyle.surface,
          '--reader-text': themeStyle.text,
          '--reader-accent': themeStyle.accent,
        } as React.CSSProperties
      }
    >
      <header className="reader-topbar">
        <div className="reader-topbar-group">
          <button type="button" className="button button-ghost" onClick={onClose}>
            Back
          </button>
          <div className="reader-book-headline">
            <p className="reader-book-title">{book.title}</p>
            <p className="reader-book-subtitle">{readerSubtitle}</p>
          </div>
        </div>

        <div className="reader-topbar-group reader-topbar-actions">
          <button
            type="button"
            className={`pomodoro-inline${isPomodoroRunning ? ' pomodoro-inline-running' : ''}`}
            onClick={handlePomodoroClick}
            onDoubleClick={handlePomodoroDoubleClick}
            title={
              isPomodoroRunning
                ? 'Click to pause. Double-click to reset to 25:00.'
                : 'Click to start. Double-click to reset to 25:00.'
            }
            aria-label={`Pomodoro ${formatPomodoroTime(
              pomodoroSecondsLeft,
            )}. ${
              isPomodoroRunning ? 'Running, click to pause.' : 'Paused, click to start.'
            } Double-click to reset to 25 minutes.`}
          >
            {formatPomodoroTime(pomodoroSecondsLeft)}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              setPanelOpen((current) => !current)
              setPanelTab('toc')
            }}
          >
            Menu
          </button>
          <button type="button" className="button button-ghost" onClick={toggleBookmark}>
            {currentBookmark ? 'Saved' : 'Save'}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? 'Exit' : 'Full'}
          </button>
        </div>
      </header>

      <div className="reader-main">
        <aside className={`reader-panel${panelOpen ? ' reader-panel-open' : ''}`}>
          <div className="panel-tabs">
            {(['toc', 'search', 'lookup', 'notes', 'display'] as PanelTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`panel-tab${panelTab === tab ? ' panel-tab-active' : ''}`}
                onClick={() => {
                  setPanelOpen(true)
                  setPanelTab(tab)
                }}
              >
                {PANEL_LABELS[tab]}
              </button>
            ))}
          </div>

          <div className="panel-body">
            {panelTab === 'toc' ? (
              <div className="panel-section">
                <div className="panel-heading">
                  <h2>Contents</h2>
                </div>
                <div className="toc-list">
                  {tocEntries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="toc-item"
                      style={{ paddingInlineStart: `${entry.depth * 18 + 16}px` }}
                      onClick={() => void navigateTo(entry.href)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {panelTab === 'search' ? (
              <div className="panel-section">
                <div className="panel-heading">
                  <h2>Search</h2>
                </div>
                <form
                  className="search-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submitSearch()
                  }}
                >
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="search-input"
                    placeholder="Search this book"
                  />
                  <button type="submit" className="button button-primary">
                    {isSearching ? 'Searching...' : 'Go'}
                  </button>
                </form>
                <div className="search-results">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      className="search-result"
                      onClick={() => void navigateTo(result.cfi)}
                    >
                      <span className="search-result-label">{result.label}</span>
                      <span className="search-result-excerpt">
                        {markExcerpt(result.excerpt, searchQuery)}
                      </span>
                    </button>
                  ))}
                  {!isSearching && searchQuery && !searchResults.length ? (
                    <p className="empty-copy">No matches.</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {panelTab === 'lookup' ? (
              <div className="panel-section">
                <div className="panel-heading">
                  <h2>Lookup</h2>
                </div>
                <form
                  className="search-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submitLookup()
                  }}
                >
                  <input
                    value={lookupQuery}
                    onChange={(event) => {
                      setLookupQuery(event.target.value)
                      if (lookupError) {
                        setLookupError(null)
                      }
                    }}
                    className="search-input"
                    placeholder="Look up a word"
                  />
                  <button type="submit" className="button button-primary">
                    {isLookingUp ? 'Loading...' : 'Go'}
                  </button>
                </form>

                {lookupResult ? (
                  <div className="lookup-card">
                    <div className="lookup-head">
                      <h3>{lookupResult.word}</h3>
                      {lookupResult.phonetic ? (
                        <span>{lookupResult.phonetic}</span>
                      ) : null}
                    </div>
                    <div className="lookup-list">
                      {lookupResult.meanings.map((meaning) => (
                        <article
                          key={`${lookupResult.word}-${meaning.partOfSpeech}`}
                          className="lookup-meaning"
                        >
                          <p className="lookup-part">{meaning.partOfSpeech}</p>
                          <ul className="lookup-definitions">
                            {meaning.definitions.map((definition) => (
                              <li key={definition}>{definition}</li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}

                {!lookupResult && lookupError ? (
                  <p className="empty-copy">{lookupError}</p>
                ) : null}

                {!lookupResult && !lookupError && !isLookingUp ? (
                  <p className="empty-copy">
                    Select a single word, then tap Lookup.
                  </p>
                ) : null}
              </div>
            ) : null}

            {panelTab === 'notes' ? (
              <div className="panel-section">
                <div className="panel-heading">
                  <h2>Saved</h2>
                </div>

                <div className="notes-group">
                  <div className="notes-heading-row">
                    <h3>Bookmarks</h3>
                  </div>
                  {book.bookmarks.length ? (
                    <div className="notes-list">
                      {book.bookmarks.map((entry) => (
                        <div key={entry.id} className="note-card">
                          <button
                            type="button"
                            className="note-main"
                            onClick={() => void navigateTo(entry.cfi)}
                          >
                            <span className="note-title">{entry.label}</span>
                            <span className="note-meta">
                              {Math.round(entry.progress * 100)}%
                            </span>
                          </button>
                          <button
                            type="button"
                            className="button button-ghost button-small"
                            onClick={() =>
                              onUpdateBook(book.id, (currentBook) => ({
                                ...currentBook,
                                bookmarks: currentBook.bookmarks.filter(
                                  (bookmark) => bookmark.id !== entry.id,
                                ),
                              }))
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-copy">No bookmarks.</p>
                  )}
                </div>

                <div className="notes-group">
                  <div className="notes-heading-row">
                    <h3>Highlights</h3>
                  </div>
                  {book.highlights.length ? (
                    <div className="notes-list">
                      {book.highlights.map((highlight) => (
                        <div key={highlight.id} className="note-card">
                          <button
                            type="button"
                            className="note-main"
                            onClick={() => void navigateTo(highlight.cfiRange)}
                          >
                            <span className="note-title note-quote">
                              {highlight.text}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="button button-ghost button-small"
                            onClick={() => deleteHighlight(highlight.id)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-copy">Select text to save a highlight.</p>
                  )}
                </div>
              </div>
            ) : null}

            {panelTab === 'display' ? (
              <div className="panel-section">
                <div className="panel-heading">
                  <h2>View</h2>
                </div>

                <div className="settings-group">
                  <label className="settings-label">Theme</label>
                  <div className="choice-row">
                    {(Object.keys(THEME_STYLES) as ReaderTheme[]).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        className={`choice-chip${
                          settings.theme === theme ? ' choice-chip-active' : ''
                        }`}
                        onClick={() =>
                          onSettingsChange((current) => ({
                            ...current,
                            theme,
                          }))
                        }
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-group">
                  <label className="settings-label">Typeface</label>
                  <div className="choice-row">
                    {(
                      Object.keys(FONT_LABELS) as Array<keyof typeof FONT_LABELS>
                    ).map((fontFamily) => (
                      <button
                        key={fontFamily}
                        type="button"
                        className={`choice-chip${
                          settings.fontFamily === fontFamily
                            ? ' choice-chip-active'
                            : ''
                        }`}
                        onClick={() =>
                          onSettingsChange((current) => ({
                            ...current,
                            fontFamily,
                          }))
                        }
                      >
                        {FONT_LABELS[fontFamily]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="slider-group">
                  <label className="settings-label">
                    Font size
                    <span>{settings.fontScale}%</span>
                  </label>
                  <input
                    type="range"
                    min={85}
                    max={180}
                    step={5}
                    value={settings.fontScale}
                    onChange={(event) =>
                      onSettingsChange((current) => ({
                        ...current,
                        fontScale: Number(event.target.value),
                      }))
                    }
                  />
                </div>

                <div className="slider-group">
                  <label className="settings-label">
                    Line height
                    <span>{settings.lineHeight.toFixed(1)}</span>
                  </label>
                  <input
                    type="range"
                    min={1.3}
                    max={2}
                    step={0.1}
                    value={settings.lineHeight}
                    onChange={(event) =>
                      onSettingsChange((current) => ({
                        ...current,
                        lineHeight: Number(event.target.value),
                      }))
                    }
                  />
                </div>

                <div className="settings-group">
                  <label className="settings-label">Layout</label>
                  <div className="choice-row">
                    {[
                      { label: 'Paged', value: 'paginated' },
                      { label: 'Scroll', value: 'scrolled-doc' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`choice-chip${
                          settings.flow === option.value ? ' choice-chip-active' : ''
                        }`}
                        onClick={() =>
                          onSettingsChange((current) => ({
                            ...current,
                            flow: option.value as ReaderSettings['flow'],
                          }))
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-group">
                  <label className="settings-label">Spread</label>
                  <div className="choice-row">
                    {[
                      { label: 'Auto', value: 'auto' },
                      { label: 'Single', value: 'none' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`choice-chip${
                          settings.spread === option.value
                            ? ' choice-chip-active'
                            : ''
                        }`}
                        onClick={() =>
                          onSettingsChange((current) => ({
                            ...current,
                            spread: option.value as ReaderSettings['spread'],
                          }))
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="reader-stage">
          {selection ? (
            <div className="selection-bar">
              <p>{selection.text}</p>
              <div className="selection-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={createHighlight}
                >
                  Save
                </button>
                {selectedLookupTerm ? (
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => {
                      void runLookup(selectedLookupTerm)
                      selectedContentsRef.current?.window.getSelection?.()?.removeAllRanges()
                      setSelection(null)
                    }}
                  >
                    Lookup
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    selectedContentsRef.current?.window.getSelection?.()?.removeAllRanges()
                    setSelection(null)
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}

          <div className="viewport-shell">
            <button
              type="button"
              className="nav-hitbox nav-hitbox-left"
              aria-label="Previous page"
              onClick={() => void renditionRef.current?.prev()}
            >
              <span className="sr-only">Previous page</span>
              <span aria-hidden="true" className="nav-chip">
                {'<'}
              </span>
            </button>
            <div
              ref={viewportRef}
              className={`reader-viewport${isLoading ? ' reader-viewport-loading' : ''}`}
            />
            <button
              type="button"
              className="nav-hitbox nav-hitbox-right"
              aria-label="Next page"
              onClick={() => void renditionRef.current?.next()}
            >
              <span className="sr-only">Next page</span>
              <span aria-hidden="true" className="nav-chip">
                {'>'}
              </span>
            </button>

            {isLoading ? (
              <div className="reader-overlay">
                <p>Opening...</p>
              </div>
            ) : null}

            {loadError ? (
              <div className="reader-overlay reader-overlay-error">
                <p>{loadError}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
