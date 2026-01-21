import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useState, useEffect, useMemo, useCallback } from 'react'

export interface ProductRender {
  id: string
  name: string
  colorway: string | null
  angle: string | null
  renderType: string | null
  imageUrl: string
  source: 'local' | 'frontify'
}

interface ProductRendersResponse {
  renders: ProductRender[]
  productNames: string[]
  renderTypes: string[]
  frontifyConfigured: boolean
}

interface UseProductRendersOptions {
  search?: string
  name?: string
  type?: string
  enabled?: boolean
}

/**
 * Fetch product renders from the API
 */
async function fetchProductRenders(options: UseProductRendersOptions): Promise<ProductRendersResponse> {
  const params = new URLSearchParams()
  if (options.search) params.set('search', options.search)
  if (options.name) params.set('name', options.name)
  if (options.type && options.type !== 'all') params.set('type', options.type)
  
  const response = await fetch(`/api/product-renders?${params.toString()}`)
  if (!response.ok) {
    throw new Error('Failed to fetch product renders')
  }
  
  return response.json()
}

/**
 * Custom debounce hook for search input
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

/**
 * Hook to fetch product renders with React Query caching.
 * 
 * Features:
 * - Per-filter caching: each unique filter combination is cached separately
 * - Keep previous data: grid stays visible while new data loads
 * - Long staleTime: renders rarely change, so cache is valid for a while
 * - Automatic deduplication: React Query dedupes concurrent requests
 */
export function useProductRenders(options: UseProductRendersOptions = {}) {
  const { search, name, type, enabled = true } = options
  
  // Debounce search to avoid excessive API calls while typing
  const debouncedSearch = useDebouncedValue(search || '', 300)
  
  return useQuery({
    queryKey: ['product-renders', { search: debouncedSearch, name, type }],
    queryFn: () => fetchProductRenders({ search: debouncedSearch, name, type }),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes - renders rarely change
    gcTime: 30 * 60 * 1000, // 30 minutes - keep in cache for quick revisits
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    // Keep previous data visible while fetching new data (no blanking)
    placeholderData: keepPreviousData,
  })
}

/**
 * Hook to get all product names from the unfiltered query.
 * This ensures the product chip list stays stable even when filtering.
 */
export function useProductNames(enabled: boolean = true) {
  const { data } = useQuery({
    queryKey: ['product-renders', { search: '', name: undefined, type: undefined }],
    queryFn: () => fetchProductRenders({}),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
  
  return data?.productNames || []
}

/**
 * Hook to prefetch product renders for a specific filter combination.
 * Use this on hover/focus to make clicks feel instant.
 */
export function usePrefetchProductRenders() {
  const queryClient = useQueryClient()
  
  return useCallback((options: UseProductRendersOptions) => {
    queryClient.prefetchQuery({
      queryKey: ['product-renders', { 
        search: options.search || '', 
        name: options.name, 
        type: options.type 
      }],
      queryFn: () => fetchProductRenders(options),
      staleTime: 5 * 60 * 1000,
    })
  }, [queryClient])
}

// Deprecated product models to filter out
const DEPRECATED_PRODUCTS = [
  'Engage', 'Experience', 'Quiet', 'Switch',
  'Dream Carry', 'Dream Lilac Carry', 'Dream Peach Carry'
]

// Product categories for organized display
const SENSEWEAR_PRODUCTS = ['Hebe', 'Aphrodite', 'Boreas', 'Eclipse']
const EARPLUG_PRODUCTS = [
  'Dream', 'Dream Lilac', 'Dream Peach',
  'Engage 2', 'Experience 2', 'Quiet 2', 'Switch 2'
]

/**
 * Check if a product is deprecated
 */
export const isDeprecatedProduct = (name: string): boolean => {
  return DEPRECATED_PRODUCTS.includes(name)
}

/**
 * Memoized hook to group renders by product and colorway.
 * This avoids recomputing the expensive reduce/sort on every render.
 */
export function useGroupedRenders(renders: ProductRender[] | undefined) {
  return useMemo(() => {
    if (!renders) return { grouped: {}, sortedProducts: [] }
    
    // Filter out deprecated products and group by product, then by colorway
    const grouped = renders
      .filter(render => !isDeprecatedProduct(render.name))
      .reduce((acc, render) => {
        const productName = render.name
        const colorway = render.colorway || 'Default'
        
        if (!acc[productName]) {
          acc[productName] = {}
        }
        if (!acc[productName][colorway]) {
          acc[productName][colorway] = []
        }
        acc[productName][colorway].push(render)
        return acc
      }, {} as Record<string, Record<string, ProductRender[]>>)

    // Sort products: Earplugs first, then Sensewear, then alphabetically
    const allProductNames = Object.keys(grouped)
    const sortedProducts = [
      ...allProductNames.filter(name => EARPLUG_PRODUCTS.includes(name))
        .sort((a, b) => EARPLUG_PRODUCTS.indexOf(a) - EARPLUG_PRODUCTS.indexOf(b)),
      ...allProductNames.filter(name => SENSEWEAR_PRODUCTS.includes(name))
        .sort((a, b) => SENSEWEAR_PRODUCTS.indexOf(a) - SENSEWEAR_PRODUCTS.indexOf(b)),
      ...allProductNames.filter(name => !EARPLUG_PRODUCTS.includes(name) && !SENSEWEAR_PRODUCTS.includes(name))
        .sort(),
    ]

    return { grouped, sortedProducts }
  }, [renders])
}

/**
 * Memoized hook to organize product names into categories.
 */
export function useOrganizedProductNames(productNames: string[]) {
  return useMemo(() => {
    // Filter out deprecated products
    const validProducts = productNames.filter(name => !isDeprecatedProduct(name))
    
    const sensewear = validProducts.filter(name => SENSEWEAR_PRODUCTS.includes(name))
    const earplugs = validProducts.filter(name => EARPLUG_PRODUCTS.includes(name))
    const other = validProducts.filter(
      name => !SENSEWEAR_PRODUCTS.includes(name) && !EARPLUG_PRODUCTS.includes(name)
    )
    
    // Sort within each group
    const sortByPredefinedOrder = (list: string[], order: string[]) => 
      list.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    
    return {
      sensewearProducts: sortByPredefinedOrder(sensewear, SENSEWEAR_PRODUCTS),
      earplugProductsList: sortByPredefinedOrder(earplugs, EARPLUG_PRODUCTS),
      otherProducts: other.sort(),
    }
  }, [productNames])
}

export { SENSEWEAR_PRODUCTS, EARPLUG_PRODUCTS, DEPRECATED_PRODUCTS }
