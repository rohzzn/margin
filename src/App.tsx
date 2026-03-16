import { Suspense, lazy, useEffect, useState } from 'react'
import './App.css'
import { LibraryView } from './components/LibraryView'
import { recordReadingAnalytics, recordTimedReadingAnalytics } from './lib/stats'
import {
  deleteBookFile,
  hasSeededDefaultBooks,
  loadBookFile,
  loadLibrary,
  loadReadingAnalytics,
  loadReaderSettings,
  markDefaultBooksSeeded,
  saveBookFile,
  saveReadingAnalytics,
  saveLibrary,
  saveReaderSettings,
} from './lib/storage'
import type {
  BookRecord,
  ImportedBookMetadata,
  ReaderSettings,
  ReadingAnalytics,
} from './types'

const ReaderView = lazy(async () => {
  const module = await import('./components/ReaderView')
  return { default: module.ReaderView }
})

const MOBILE_MEDIA_QUERIES = [
  '(max-width: 720px)',
  '((pointer: coarse) and (max-width: 1100px))',
]

const DEFAULT_BOOK_SOURCES = [
  {
    id: 'default-pride-and-prejudice',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    identifier: 'https://www.gutenberg.org/ebooks/1342',
    fileName: 'pride-and-prejudice.epub',
    url: '/default-books/pride-and-prejudice.epub',
  },
  {
    id: 'default-dracula',
    title: 'Dracula',
    author: 'Bram Stoker',
    identifier: 'https://www.gutenberg.org/ebooks/345',
    fileName: 'dracula.epub',
    url: '/default-books/dracula.epub',
  },
  {
    id: 'default-alice-in-wonderland',
    title: "Alice's Adventures in Wonderland",
    author: 'Lewis Carroll',
    identifier: 'https://www.gutenberg.org/ebooks/11',
    fileName: 'alice-in-wonderland.epub',
    url: '/default-books/alice-in-wonderland.epub',
  },
] as const

function isMobileOnlyViewport() {
  if (typeof window === 'undefined') {
    return false
  }

  return MOBILE_MEDIA_QUERIES.some((query) => window.matchMedia(query).matches)
}

function findExistingBook(books: BookRecord[], file: File, identifier?: string) {
  return books.find((book) => {
    if (identifier && book.identifier === identifier) {
      return true
    }

    return book.fileName === file.name && book.fileSize === file.size
  })
}

function mergeBookRecord(
  existingBook: BookRecord | undefined,
  file: File,
  metadata: ImportedBookMetadata,
) {
  const now = new Date().toISOString()

  if (existingBook) {
    return {
      ...existingBook,
      ...metadata,
      fileName: file.name,
      fileSize: file.size,
    }
  }

  return {
    id: crypto.randomUUID(),
    title: metadata.title,
    author: metadata.author,
    description: metadata.description,
    coverUrl: metadata.coverUrl,
    language: metadata.language,
    identifier: metadata.identifier,
    fileName: file.name,
    fileSize: file.size,
    addedAt: now,
    lastOpenedAt: now,
    progress: 0,
    bookmarks: [],
    highlights: [],
  }
}

function App() {
  const [books, setBooks] = useState<BookRecord[]>(() => loadLibrary())
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings())
  const [analytics, setAnalytics] = useState<ReadingAnalytics>(() =>
    loadReadingAnalytics(),
  )
  const [activeBookId, setActiveBookId] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<Blob | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [isMobileLocked, setIsMobileLocked] = useState(() => isMobileOnlyViewport())
  const [isSeedingDefaults, setIsSeedingDefaults] = useState(false)

  const activeBook = activeBookId
    ? books.find((book) => book.id === activeBookId) ?? null
    : null

  useEffect(() => {
    saveLibrary(books)
  }, [books])

  useEffect(() => {
    saveReaderSettings(settings)
  }, [settings])

  useEffect(() => {
    saveReadingAnalytics(analytics)
  }, [analytics])

  useEffect(() => {
    if (!activeBookId) {
      setActiveFile(null)
      return
    }

    let cancelled = false

    void loadBookFile(activeBookId).then((file) => {
      if (!cancelled) {
        setActiveFile(file ?? null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeBookId])

  useEffect(() => {
    if (activeBookId && !books.some((book) => book.id === activeBookId)) {
      setActiveBookId(null)
      setActiveFile(null)
    }
  }, [activeBookId, books])

  useEffect(() => {
    const mediaQueries = MOBILE_MEDIA_QUERIES.map((query) => window.matchMedia(query))

    const syncViewportState = () => {
      setIsMobileLocked(mediaQueries.some((query) => query.matches))
    }

    syncViewportState()
    mediaQueries.forEach((query) => query.addEventListener('change', syncViewportState))

    return () => {
      mediaQueries.forEach((query) =>
        query.removeEventListener('change', syncViewportState),
      )
    }
  }, [])

  useEffect(() => {
    if (books.length || hasSeededDefaultBooks()) {
      return
    }

    let cancelled = false

    const seedDefaultBooks = async () => {
      setIsSeedingDefaults(true)

      try {
        const { readEpubMetadata } = await import('./lib/epub')
        const seededBooks: BookRecord[] = []
        const seededAt = Date.now()

        for (const [index, source] of DEFAULT_BOOK_SOURCES.entries()) {
          const response = await fetch(source.url)

          if (!response.ok) {
            continue
          }

          const blob = await response.blob()
          const file = new File([blob], source.fileName, {
            type: 'application/epub+zip',
          })

          const metadata = await readEpubMetadata(file).catch<ImportedBookMetadata>(() => ({
            title: source.title,
            author: source.author,
            identifier: source.identifier,
          }))

          if (cancelled) {
            return
          }

          await saveBookFile(source.id, file)

          seededBooks.push({
            id: source.id,
            title: metadata.title || source.title,
            author: metadata.author || source.author,
            description: metadata.description,
            coverUrl: metadata.coverUrl,
            language: metadata.language,
            identifier: metadata.identifier || source.identifier,
            fileName: source.fileName,
            fileSize: file.size,
            addedAt: new Date(seededAt - index * 60_000).toISOString(),
            lastOpenedAt: new Date(seededAt - index * 60_000).toISOString(),
            progress: 0,
            bookmarks: [],
            highlights: [],
          })
        }

        if (cancelled || !seededBooks.length) {
          return
        }

        setBooks((currentBooks) => (currentBooks.length ? currentBooks : seededBooks))
        markDefaultBooksSeeded()
      } finally {
        if (!cancelled) {
          setIsSeedingDefaults(false)
        }
      }
    }

    void seedDefaultBooks()

    return () => {
      cancelled = true
    }
  }, [books.length])

  const handleImport = async (files: File[]) => {
    if (!files.length) {
      return
    }

    setIsImporting(true)
    setImportError(null)

    const { readEpubMetadata } = await import('./lib/epub')
    const failures: string[] = []
    let nextActiveBookId: string | null = null
    let nextBooks = [...books]

    for (const file of files) {
      try {
        const metadata = await readEpubMetadata(file)
        const existingBook = findExistingBook(nextBooks, file, metadata.identifier)
        const mergedBook = mergeBookRecord(existingBook, file, metadata)

        await saveBookFile(mergedBook.id, file)

        if (existingBook) {
          nextBooks = nextBooks.map((book) =>
            book.id === mergedBook.id ? mergedBook : book,
          )
        } else {
          nextBooks = [mergedBook, ...nextBooks]
        }

        nextActiveBookId ??= mergedBook.id
      } catch {
        failures.push(file.name)
      }
    }

    setBooks(nextBooks)
    if (nextActiveBookId) {
      setActiveBookId(nextActiveBookId)
    }

    if (failures.length) {
      setImportError(`Could not import: ${failures.join(', ')}`)
    }

    setIsImporting(false)
  }

  const handleDeleteBook = async (bookId: string) => {
    const targetBook = books.find((book) => book.id === bookId)
    if (!targetBook) {
      return
    }

    const confirmed = window.confirm(`Remove "${targetBook.title}" from your browser library?`)
    if (!confirmed) {
      return
    }

    await deleteBookFile(bookId)
    setBooks((currentBooks) => currentBooks.filter((book) => book.id !== bookId))
    if (activeBookId === bookId) {
      setActiveBookId(null)
    }
  }

  const updateBook = (
    bookId: string,
    updater: (currentBook: BookRecord) => BookRecord,
  ) => {
    setBooks((currentBooks) =>
      currentBooks.map((book) => (book.id === bookId ? updater(book) : book)),
    )
  }

  const updateSettings = (
    nextSettings:
      | ReaderSettings
      | ((currentSettings: ReaderSettings) => ReaderSettings),
  ) => {
    setSettings((currentSettings) =>
      typeof nextSettings === 'function'
        ? nextSettings(currentSettings)
        : nextSettings,
    )
  }

  const recordReadingActivity = (activity: {
    minutes?: number
    pages?: number
    date?: Date
    startedAt?: Date
    endedAt?: Date
  }) => {
    setAnalytics((currentAnalytics) => {
      if (activity.startedAt && activity.endedAt) {
        return recordTimedReadingAnalytics(
          currentAnalytics,
          activity.startedAt,
          activity.endedAt,
        )
      }

      return recordReadingAnalytics(currentAnalytics, activity)
    })
  }

  return (
    <div className="app-shell">
      {isMobileLocked ? (
        <main className="desktop-only-screen">
          <section className="desktop-only-card">
            <p className="eyebrow">Desktop Only</p>
            <h1>Margin Reader is made for desktop reading.</h1>
            <p className="desktop-only-copy">
              Open this on a laptop or desktop for the full reading experience.
            </p>
          </section>
        </main>
      ) : isSeedingDefaults && !books.length ? (
        <div className="reader-loading-screen">Preparing your starter shelf...</div>
      ) : activeBook ? (
        <Suspense fallback={<div className="reader-loading-screen">Loading reader...</div>}>
          <ReaderView
            book={activeBook}
            file={activeFile}
            settings={settings}
            onClose={() => setActiveBookId(null)}
            onRecordActivity={recordReadingActivity}
            onUpdateBook={updateBook}
            onSettingsChange={updateSettings}
          />
        </Suspense>
      ) : (
        <LibraryView
          books={books}
          analytics={analytics}
          isImporting={isImporting || isSeedingDefaults}
          importError={importError}
          onImport={handleImport}
          onOpen={setActiveBookId}
          onDelete={(bookId) => {
            void handleDeleteBook(bookId)
          }}
        />
      )}
    </div>
  )
}

export default App
