import { Suspense, lazy, useEffect, useState } from 'react'
import './App.css'
import { LibraryView } from './components/LibraryView'
import { fetchPublicBookDetails } from './lib/standardEbooks'
import { recordReadingAnalytics, recordTimedReadingAnalytics } from './lib/stats'
import {
  deleteBookFile,
  loadBookFile,
  loadLibrary,
  loadReadingAnalytics,
  loadReaderSettings,
  saveBookFile,
  saveReadingAnalytics,
  saveLibrary,
  saveReaderSettings,
} from './lib/storage'
import type {
  BookRecord,
  ImportedBookMetadata,
  PublicCatalogBook,
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

async function isReadableEpubBlob(file: Blob) {
  if (!file.size) {
    return false
  }

  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return (
    signature[0] === 0x50 &&
    signature[1] === 0x4b &&
    signature[2] === 0x03 &&
    signature[3] === 0x04
  )
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
  const [publicImportBookId, setPublicImportBookId] = useState<string | null>(null)
  const [publicImportError, setPublicImportError] = useState<string | null>(null)

  const activeBook = activeBookId
    ? books.find((book) => book.id === activeBookId) ?? null
    : null
  const publicBookIdsByIdentifier = new Map(
    books
      .filter((book) => book.identifier)
      .map((book) => [book.identifier as string, book.id]),
  )

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

  const handleImport = async (files: File[]) => {
    if (!files.length) {
      return
    }

    setIsImporting(true)
    setImportError(null)
    setPublicImportError(null)

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

  const handleImportPublicBook = async (publicBook: PublicCatalogBook) => {
    const existingBookId = publicBookIdsByIdentifier.get(publicBook.pageUrl)
    if (existingBookId) {
      const existingFile = await loadBookFile(existingBookId)

      if (existingFile && (await isReadableEpubBlob(existingFile))) {
        setPublicImportError(null)
        setActiveBookId(existingBookId)
        return
      }
    }

    setPublicImportBookId(publicBook.id)
    setPublicImportError(null)
    setImportError(null)

    try {
      const resolvedPublicBook = publicBook.downloadUrl
        ? publicBook
        : await fetchPublicBookDetails(publicBook.pageUrl)

      if (!resolvedPublicBook.downloadUrl) {
        throw new Error('Missing download URL.')
      }

      const response = await fetch(resolvedPublicBook.downloadUrl)
      if (!response.ok) {
        throw new Error(`Book download failed (${response.status}).`)
      }

      const blob = await response.blob()
      if (!(await isReadableEpubBlob(blob))) {
        throw new Error('Downloaded file was not a valid EPUB.')
      }

      const fileName =
        decodeURIComponent(
          new URL(resolvedPublicBook.downloadUrl).pathname.split('/').pop() ?? '',
        ) || `${resolvedPublicBook.title}.epub`
      const file = new File([blob], fileName, {
        type: 'application/epub+zip',
      })
      const { readEpubMetadata } = await import('./lib/epub')
      const parsedMetadata = await readEpubMetadata(file).catch<ImportedBookMetadata>(
        () => ({
          title: resolvedPublicBook.title,
          author: resolvedPublicBook.author,
          description: resolvedPublicBook.description,
          coverUrl: resolvedPublicBook.coverUrl,
          language: resolvedPublicBook.language,
          identifier: resolvedPublicBook.pageUrl,
        }),
      )
      const metadata: ImportedBookMetadata = {
        title: parsedMetadata.title || resolvedPublicBook.title,
        author: parsedMetadata.author || resolvedPublicBook.author,
        description: parsedMetadata.description || resolvedPublicBook.description,
        coverUrl: parsedMetadata.coverUrl || resolvedPublicBook.coverUrl,
        language: parsedMetadata.language || resolvedPublicBook.language,
        identifier: resolvedPublicBook.pageUrl,
      }
      const existingBook = findExistingBook(books, file, metadata.identifier)
      const mergedBook = mergeBookRecord(existingBook, file, metadata)

      await saveBookFile(mergedBook.id, file)
      setBooks((currentBooks) =>
        existingBook
          ? currentBooks.map((book) => (book.id === mergedBook.id ? mergedBook : book))
          : [mergedBook, ...currentBooks],
      )
      setActiveBookId(mergedBook.id)
    } catch {
      setPublicImportError(`Could not load "${publicBook.title}" from the public shelf.`)
    } finally {
      setPublicImportBookId(null)
    }
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
          isImporting={isImporting}
          importError={importError}
          publicImportBookId={publicImportBookId}
          publicImportError={publicImportError}
          publicBookIdsByIdentifier={publicBookIdsByIdentifier}
          onImport={handleImport}
          onImportPublicBook={(book) => {
            void handleImportPublicBook(book)
          }}
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
