import { useRef, useState, type CSSProperties } from 'react'
import type { BookRecord } from '../types'

interface LibraryViewProps {
  books: BookRecord[]
  isImporting: boolean
  importError?: string | null
  onImport: (files: File[]) => void
  onOpen: (bookId: string) => void
  onDelete: (bookId: string) => void
}

export function LibraryView({
  books,
  isImporting,
  importError,
  onImport,
  onOpen,
  onDelete,
}: LibraryViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const sortedBooks = [...books].sort((left, right) => {
    const leftScore = left.lastOpenedAt ?? left.addedAt
    const rightScore = right.lastOpenedAt ?? right.addedAt
    return new Date(rightScore).getTime() - new Date(leftScore).getTime()
  })

  const activeReaders = books.filter((book) => book.progress > 0.01).length
  const totalBookmarks = books.reduce((total, book) => total + book.bookmarks.length, 0)
  const totalHighlights = books.reduce((total, book) => total + book.highlights.length, 0)

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
      </header>

      <section className="hero-panel">
        <div className="hero-panel-copy">
          <div className="metric-grid">
            <article className="metric-card">
              <span className="metric-value">{books.length}</span>
              <span className="metric-label">Books</span>
            </article>
            <article className="metric-card">
              <span className="metric-value">{activeReaders}</span>
              <span className="metric-label">Reading</span>
            </article>
            <article className="metric-card">
              <span className="metric-value">{totalBookmarks}</span>
              <span className="metric-label">Bookmarks</span>
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
                  >
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
