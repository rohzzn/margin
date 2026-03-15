import { Suspense, lazy, useEffect, useState } from 'react'
import './App.css'
import { LibraryView } from './components/LibraryView'
import {
  deleteBookFile,
  loadBookFile,
  loadLibrary,
  loadReaderSettings,
  saveBookFile,
  saveLibrary,
  saveReaderSettings,
} from './lib/storage'
import type { BookRecord, ImportedBookMetadata, ReaderSettings } from './types'

const ReaderView = lazy(async () => {
  const module = await import('./components/ReaderView')
  return { default: module.ReaderView }
})

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
  const [activeBookId, setActiveBookId] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<Blob | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

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

  return (
    <div className="app-shell">
      {activeBook ? (
        <Suspense fallback={<div className="reader-loading-screen">Loading reader...</div>}>
          <ReaderView
            book={activeBook}
            file={activeFile}
            settings={settings}
            onClose={() => setActiveBookId(null)}
            onUpdateBook={updateBook}
            onSettingsChange={updateSettings}
          />
        </Suspense>
      ) : (
        <LibraryView
          books={books}
          isImporting={isImporting}
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
