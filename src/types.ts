export type ReaderTheme = 'linen' | 'mist' | 'sepia' | 'midnight'
export type ReaderFlow = 'paginated' | 'scrolled-doc'
export type ReaderSpread = 'auto' | 'none'
export type ReaderFont =
  | 'serif'
  | 'sans'
  | 'mono'
  | 'poppins'
  | 'sf'
  | 'literata'

export interface ReaderSettings {
  theme: ReaderTheme
  fontScale: number
  lineHeight: number
  fontFamily: ReaderFont
  flow: ReaderFlow
  spread: ReaderSpread
}

export interface BookmarkEntry {
  id: string
  cfi: string
  label: string
  progress: number
  createdAt: string
  chapterHref?: string
}

export interface HighlightEntry {
  id: string
  cfiRange: string
  text: string
  color: string
  createdAt: string
  chapterHref?: string
}

export interface BookRecord {
  id: string
  title: string
  author: string
  description?: string
  coverUrl?: string
  language?: string
  identifier?: string
  fileName: string
  fileSize: number
  addedAt: string
  lastOpenedAt?: string
  progress: number
  currentCfi?: string
  locations?: string
  bookmarks: BookmarkEntry[]
  highlights: HighlightEntry[]
}

export interface TocEntry {
  id: string
  href: string
  label: string
  depth: number
  parent?: string
}

export interface SearchResult {
  id: string
  cfi: string
  excerpt: string
  href: string
  label: string
}

export interface ImportedBookMetadata {
  title: string
  author: string
  description?: string
  coverUrl?: string
  language?: string
  identifier?: string
}
