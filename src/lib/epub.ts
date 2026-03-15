import type Book from 'epubjs/types/book'
import type Section from 'epubjs/types/section'
import ePub, { type NavItem } from 'epubjs'
import type { ImportedBookMetadata, SearchResult, TocEntry } from '../types'

type SearchMatch = {
  cfi: string
  excerpt: string
}

type SearchableSection = Section & {
  search?: (query: string, maxSeqEle?: number) => SearchMatch[]
}

function stripFragment(href?: string) {
  return href?.split('#')[0] ?? ''
}

function toDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function extractCoverAsDataUrl(book: Book) {
  try {
    const coverUrl = await book.coverUrl()
    if (!coverUrl) {
      return undefined
    }

    const response = await fetch(coverUrl)
    if (!response.ok) {
      return undefined
    }

    const blob = await response.blob()
    return await toDataUrl(blob)
  } catch {
    return undefined
  }
}

export async function readEpubMetadata(file: File): Promise<ImportedBookMetadata> {
  const book = ePub()

  try {
    await book.open(await file.arrayBuffer())
    await book.ready

    const metadata = await book.loaded.metadata
    const coverUrl = await extractCoverAsDataUrl(book)

    return {
      title: metadata.title || file.name.replace(/\.epub$/i, ''),
      author: metadata.creator || 'Unknown author',
      description: metadata.description || undefined,
      language: metadata.language || undefined,
      identifier: metadata.identifier || undefined,
      coverUrl,
    }
  } finally {
    book.destroy()
  }
}

export function flattenToc(items: NavItem[], depth = 0, acc: TocEntry[] = []) {
  for (const item of items) {
    acc.push({
      id: item.id || `${item.href}-${depth}`,
      href: item.href,
      label: item.label,
      depth,
      parent: item.parent,
    })

    if (item.subitems?.length) {
      flattenToc(item.subitems, depth + 1, acc)
    }
  }

  return acc
}

export function chapterLabelForHref(entries: TocEntry[], href?: string) {
  if (!href) {
    return ''
  }

  const normalizedHref = stripFragment(href)
  const exactMatch = entries.find((entry) => stripFragment(entry.href) === normalizedHref)
  if (exactMatch) {
    return exactMatch.label
  }

  const prefixMatch = entries.find((entry) => href.startsWith(entry.href))
  return prefixMatch?.label ?? ''
}

export async function searchBook(book: Book, query: string, tocEntries: TocEntry[]) {
  const cleanQuery = query.trim()
  if (!cleanQuery) {
    return []
  }

  const results: SearchResult[] = []
  const sections: Section[] = []
  book.spine.each((section: Section) => {
    sections.push(section)
  })

  for (const section of sections) {
    await Promise.resolve(section.load(book.load.bind(book)))

    const searchableSection = section as SearchableSection
    const matches = (
      typeof searchableSection.search === 'function'
        ? searchableSection.search(cleanQuery)
        : searchableSection.find(cleanQuery)
    ) as SearchMatch[]

    for (const match of matches) {
      results.push({
        id: `${section.href}-${match.cfi}`,
        cfi: match.cfi,
        excerpt: match.excerpt.replace(/\s+/g, ' ').trim(),
        href: section.href,
        label: chapterLabelForHref(tocEntries, section.href) || section.href,
      })
    }

    section.unload()
  }

  return results
}
