import type {
  PublicCatalogBook,
  PublicCatalogPage,
  PublicCatalogSort,
} from '../types'

const STANDARD_EBOOKS_BASE_URL = 'https://standardebooks.org'
const DEFAULT_PUBLIC_PAGE_SIZE = '24'

function getParser() {
  if (typeof DOMParser === 'undefined') {
    throw new Error('Public catalog parsing is only available in the browser.')
  }

  return new DOMParser()
}

function toAbsoluteUrl(value?: string | null) {
  if (!value) {
    return ''
  }

  return new URL(value, STANDARD_EBOOKS_BASE_URL).toString()
}

function toFeedDownloadUrl(value?: string | null) {
  const absoluteUrl = toAbsoluteUrl(value)
  if (!absoluteUrl) {
    return ''
  }

  const url = new URL(absoluteUrl)
  url.searchParams.set('source', 'feed')
  return url.toString()
}

function textContent(element: Element | null | undefined) {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function parseHtmlDocument(html: string) {
  return getParser().parseFromString(html, 'text/html')
}

function getBrowseSort(sort: PublicCatalogSort, hasQuery: boolean) {
  if (!hasQuery && sort === 'relevance') {
    return 'popularity'
  }

  if (!hasQuery && sort === 'newest') {
    return 'default'
  }

  return sort
}

async function fetchCatalogHtml(url: string) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Public catalog request failed (${response.status}).`)
  }

  return response.text()
}

function parseBrowsePage(html: string): PublicCatalogPage {
  const document = parseHtmlDocument(html)
  const books = Array.from(
    document.querySelectorAll('ol.ebooks-list > li[typeof="schema:Book"]'),
  ).map<PublicCatalogBook>((item) => {
    const pageUrl =
      toAbsoluteUrl(item.getAttribute('about')) ||
      toAbsoluteUrl(item.querySelector('a[property="schema:url"]')?.getAttribute('href'))

    const title = textContent(
      item.querySelector('a[property="schema:url"] span[property="schema:name"]'),
    )
    const author = textContent(item.querySelector('p.author span[property="schema:name"]'))
    const coverUrl = toAbsoluteUrl(item.querySelector('img')?.getAttribute('src'))

    return {
      id: pageUrl,
      title,
      author,
      coverUrl,
      pageUrl,
      subjects: [],
    }
  })

  const nextPageUrl =
    toAbsoluteUrl(
      document.querySelector('nav.pagination > a[rel="next"]')?.getAttribute('href'),
    ) ||
    toAbsoluteUrl(
      document
        .querySelector('nav.pagination a[aria-current="page"]')
        ?.closest('li')
        ?.nextElementSibling
        ?.querySelector('a')
        ?.getAttribute('href'),
    ) ||
    null

  return {
    books,
    nextPageUrl,
  }
}

function firstMatchingText(document: Document, selectors: string[]) {
  for (const selector of selectors) {
    const value = textContent(document.querySelector(selector))
    if (value) {
      return value
    }
  }

  return ''
}

function parseDetailsPage(html: string, pageUrl: string): PublicCatalogBook {
  const document = parseHtmlDocument(html)
  const resolvedPageUrl =
    toAbsoluteUrl(
      document.querySelector('meta[property="schema:url"]')?.getAttribute('content'),
    ) || pageUrl

  const title =
    textContent(document.querySelector('h1[property="schema:name"]')) ||
    firstMatchingText(document, ['header h1'])
  const author =
    textContent(document.querySelector('a[property="schema:author"] span[property="schema:name"]')) ||
    firstMatchingText(document, ['hgroup p a'])
  const description =
    document
      .querySelector('meta[property="schema:description"]')
      ?.getAttribute('content')
      ?.trim() ||
    firstMatchingText(document, ['section#description p'])
  const language =
    document
      .querySelector('meta[property="schema:inLanguage"]')
      ?.getAttribute('content')
      ?.trim() || undefined
  const coverUrl =
    toAbsoluteUrl(
      document.querySelector('meta[property="schema:image"]')?.getAttribute('content'),
    ) ||
    toAbsoluteUrl(document.querySelector('figure img')?.getAttribute('src'))
  const downloadUrl = toFeedDownloadUrl(
    document
      .querySelector('section#download a.epub[property="schema:contentUrl"]')
      ?.getAttribute('href') ||
      document.querySelector('section#download a.epub')?.getAttribute('href'),
  )
  const subjects = Array.from(document.querySelectorAll('#reading-ease .tags a'))
    .map((subject) => textContent(subject))
    .filter(Boolean)

  if (!title || !author || !downloadUrl) {
    throw new Error('Could not read this public book entry.')
  }

  return {
    id: resolvedPageUrl,
    title,
    author,
    description,
    language,
    coverUrl,
    pageUrl: resolvedPageUrl,
    downloadUrl,
    subjects,
  }
}

export async function fetchPublicCatalogPage(options?: {
  query?: string
  sort?: PublicCatalogSort
  pageUrl?: string | null
}) {
  const pageUrl = options?.pageUrl
  const query = options?.query?.trim() ?? ''
  const sort = options?.sort ?? 'popularity'
  const hasQuery = query.length > 0

  const url = pageUrl ? new URL(pageUrl) : new URL('/ebooks', STANDARD_EBOOKS_BASE_URL)

  if (!pageUrl) {
    url.searchParams.set('view', 'grid')
    url.searchParams.set('per-page', DEFAULT_PUBLIC_PAGE_SIZE)
    url.searchParams.set('sort', getBrowseSort(sort, hasQuery))

    if (hasQuery) {
      url.searchParams.set('query', query)
    }
  }

  const html = await fetchCatalogHtml(url.toString())
  return parseBrowsePage(html)
}

export async function fetchPublicBookDetails(pageUrl: string) {
  const html = await fetchCatalogHtml(pageUrl)
  return parseDetailsPage(html, pageUrl)
}
