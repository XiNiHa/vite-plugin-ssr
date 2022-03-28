export { getPageAssets }

import { assert, higherFirst, normalizePath, prependBaseUrl, assertPosixPath, toPosixPath } from '../utils'
import { retrieveStyleAssets, retrieveProdAssets, ClientDependency } from '../retrievePageAssets'
import type { ViteManifest } from '../viteManifest'
import path from 'path'
import { inferMediaType } from '../html/inferMediaType'
import { PageAsset } from '../html/injectAssets'
import { getManifestEntry } from '../getManifestEntry'
import type { ViteDevServer } from 'vite'

async function getPageAssets(
  pageContext: {
    _baseUrl: string
    _baseAssets: string | null
    _isProduction: boolean
    _viteDevServer: null | ViteDevServer
    _manifestClient: null | ViteManifest
  },
  clientDependencies: ClientDependency[],
  clientEntries: string[],
  isPreRendering: boolean,
): Promise<PageAsset[]> {
  const isDev = !isPreRendering && !pageContext._isProduction

  let assetUrls: string[]
  let clientEntriesSrc: string[]
  if (isDev) {
    const viteDevServer = pageContext._viteDevServer
    assert(viteDevServer)
    clientEntriesSrc = clientEntries && resolveClientEntriesDev(clientEntries, viteDevServer)
    assetUrls = await retrieveStyleAssets(clientDependencies, viteDevServer)
  } else {
    const clientManifest = pageContext._manifestClient
    assert(clientManifest)
    clientEntriesSrc = clientEntries && resolveClientEntriesProd(clientEntries, clientManifest!)
    assetUrls = await retrieveProdAssets(clientDependencies, clientManifest)
  }

  let pageAssets: PageAsset[] = []
  clientEntriesSrc.forEach((clientEntrySrc) => {
    pageAssets.push({
      src: clientEntrySrc,
      assetType: 'script',
      mediaType: 'text/javascript',
      preloadType: null,
    })
  })
  assetUrls.forEach((src) => {
    const { mediaType = null, preloadType = null } = inferMediaType(src) || {}
    const assetType = mediaType === 'text/css' ? 'style' : 'preload'
    if (isDev && mediaType === 'text/css') {
      src = src + '?direct'
    }
    pageAssets.push({
      src,
      assetType,
      mediaType,
      preloadType,
    })
  })

  pageAssets = pageAssets.map((pageAsset) => {
    const baseUrlAssets = pageContext._baseAssets || pageContext._baseUrl
    pageAsset.src = prependBaseUrl(normalizePath(pageAsset.src), baseUrlAssets)
    return pageAsset
  })

  sortPageAssetsForHttpPush(pageAssets)

  return pageAssets
}

function sortPageAssetsForHttpPush(pageAssets: PageAsset[]) {
  pageAssets.sort(
    higherFirst(({ assetType, preloadType }) => {
      let priority = 0

      // CSS has highest priority
      if (assetType === 'style') return priority
      priority--
      if (preloadType === 'style') return priority
      priority--

      // Visual assets have high priority
      if (preloadType === 'font') return priority
      priority--
      if (preloadType === 'image') return priority
      priority--

      // JavaScript has lowest priority
      if (assetType === 'script') return priority - 1
      if (preloadType === 'script') return priority - 2

      return priority
    }),
  )
}

function resolveClientEntriesDev(clientEntries: string[], viteDevServer: ViteDevServer): string[] {
  let root = viteDevServer.config.root
  assert(root)
  root = toPosixPath(root)
  return clientEntries.map((clientEntry) => {
    assertPosixPath(clientEntry)
    let filePath: string
    if (!clientEntry.startsWith('@@vite-plugin-ssr/')) {
      assert(path.posix.isAbsolute(clientEntry))
      filePath = path.posix.join(root, clientEntry)
    } else {
      const req = require // Prevent webpack from bundling client code
      const res = req.resolve
      // Current file: node_modules/vite-plugin-ssr/dist/cjs/node/html/injectAssets.js
      filePath = toPosixPath(res(clientEntry.replace('@@vite-plugin-ssr/', '../../../../')))
    }
    if (!filePath.startsWith('/')) {
      assert(process.platform === 'win32')
      filePath = '/' + filePath
    }
    filePath = '/@fs' + filePath
    return filePath
  })
}
function resolveClientEntriesProd(clientEntries: string[], clientManifest: ViteManifest): string[] {
  return clientEntries.map((clientEntry) => {
    const entry = getManifestEntry(clientEntry, clientManifest)
    assert(entry)
    const { manifestEntry } = entry
    assert(manifestEntry.isEntry || manifestEntry.isDynamicEntry)
    let { file } = manifestEntry
    assert(!file.startsWith('/'))
    return '/' + file
  })
}
