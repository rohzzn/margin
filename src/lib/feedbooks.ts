import type { PublicCatalogBook, PublicCatalogSort } from '../types'
import {
  FEEDBOOKS_PUBLIC_DOMAIN_CATALOG,
  type FeedbooksCatalogEntry,
} from './feedbooksCatalog'

interface IndexedFeedbooksCatalogEntry extends FeedbooksCatalogEntry {
  popularityRank: number
  searchIndex: string
}

const INDEXED_FEEDBOOKS_PUBLIC_DOMAIN_CATALOG: IndexedFeedbooksCatalogEntry[] =
  FEEDBOOKS_PUBLIC_DOMAIN_CATALOG.map((book, index) => ({
    ...book,
    popularityRank: index,
    searchIndex: normalizeCatalogText(
      [book.title, book.author, book.subjects.join(' ')].join(' '),
    ),
  }))

function normalizeCatalogText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function scoreFeedbooksEntry(
  book: IndexedFeedbooksCatalogEntry,
  normalizedQuery: string,
) {
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

function comparePublishedAt(
  left: IndexedFeedbooksCatalogEntry,
  right: IndexedFeedbooksCatalogEntry,
) {
  return (
    new Date(right.publishedAt ?? 0).getTime() -
    new Date(left.publishedAt ?? 0).getTime()
  )
}

function compareAuthor(
  left: IndexedFeedbooksCatalogEntry,
  right: IndexedFeedbooksCatalogEntry,
) {
  return (
    left.author.localeCompare(right.author, undefined, { sensitivity: 'base' }) ||
    left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
  )
}

function sortFeedbooksEntries(
  books: IndexedFeedbooksCatalogEntry[],
  sort: PublicCatalogSort,
  normalizedQuery: string,
) {
  const queryAwarePopularitySort = (
    left: IndexedFeedbooksCatalogEntry,
    right: IndexedFeedbooksCatalogEntry,
  ) =>
    scoreFeedbooksEntry(right, normalizedQuery) -
      scoreFeedbooksEntry(left, normalizedQuery) ||
    left.popularityRank - right.popularityRank

  const queryAwareNewestSort = (
    left: IndexedFeedbooksCatalogEntry,
    right: IndexedFeedbooksCatalogEntry,
  ) =>
    comparePublishedAt(left, right) ||
    queryAwarePopularitySort(left, right)

  switch (sort) {
    case 'author-alpha':
      return books.sort((left, right) =>
        compareAuthor(left, right) || queryAwarePopularitySort(left, right),
      )
    case 'newest':
      return books.sort(queryAwareNewestSort)
    case 'relevance':
    case 'popularity':
    case 'length':
    case 'reading-ease':
    default:
      return books.sort(queryAwarePopularitySort)
  }
}

export function searchFeedbooksPublicDomainBooks(options?: {
  query?: string
  sort?: PublicCatalogSort
  limit?: number
}): PublicCatalogBook[] {
  const normalizedQuery = normalizeCatalogText(options?.query ?? '')
  const sort = options?.sort ?? 'popularity'
  const limit = options?.limit ?? (normalizedQuery ? 120 : 36)

  const filteredBooks = normalizedQuery
    ? INDEXED_FEEDBOOKS_PUBLIC_DOMAIN_CATALOG.filter(
        (book) => scoreFeedbooksEntry(book, normalizedQuery) > 0,
      )
    : [...INDEXED_FEEDBOOKS_PUBLIC_DOMAIN_CATALOG]

  return sortFeedbooksEntries(filteredBooks, sort, normalizedQuery)
    .slice(0, limit)
    .map(({ popularityRank, searchIndex, ...book }) => book)
}

export function getFeedbooksPublicDomainMatchCount(options?: { query?: string }) {
  const normalizedQuery = normalizeCatalogText(options?.query ?? '')

  if (!normalizedQuery) {
    return INDEXED_FEEDBOOKS_PUBLIC_DOMAIN_CATALOG.length
  }

  return INDEXED_FEEDBOOKS_PUBLIC_DOMAIN_CATALOG.filter(
    (book) => scoreFeedbooksEntry(book, normalizedQuery) > 0,
  ).length
}

export function getFeedbooksPublicDomainCatalogCount() {
  return FEEDBOOKS_PUBLIC_DOMAIN_CATALOG.length
}
