// src/routes/products.ts - VERSION OPTIMISÉE SUPABASE
import { FastifyPluginAsync } from 'fastify'
import { supabaseServiceClient } from '../lib/supabase' // ✅ UTILISER CLIENT CENTRALISÉ
import { z } from 'zod'

// ✅ TYPES OPTIMISÉS
interface Product {
  id: string
  shop_id: string
  name: string
  description?: string
  short_description?: string
  price: number
  compare_at_price?: number
  currency: string
  sku?: string
  handle?: string
  category?: string
  tags: string[]
  featured_image?: string
  images: string[]
  features: string[]
  specifications: Record<string, any>
  inventory_quantity: number
  track_inventory: boolean
  weight?: number
  source: 'manual' | 'shopify' | 'woocommerce' | 'api'
  external_id?: string
  external_data: Record<string, any>
  is_active: boolean
  is_visible: boolean
  available_for_sale: boolean
  last_synced_at?: string
  sync_errors?: string
  created_at: string
  updated_at: string
}

interface ProductsQuery {
  search?: string
  category?: string
  source?: string
  isActive?: string
  page?: string
  limit?: string
}

interface CreateProductData {
  name: string
  description?: string
  short_description?: string
  price: number
  compare_at_price?: number
  sku?: string
  category?: string
  tags?: string[]
  featured_image?: string
  images?: string[]
  features?: string[]
  specifications?: Record<string, any>
  inventory_quantity?: number
  track_inventory?: boolean
  weight?: number
  is_active?: boolean
  is_visible?: boolean
  available_for_sale?: boolean
}

// ✅ SCHÉMAS DE VALIDATION ZOD
const CreateProductSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(200, 'Nom trop long'),
  description: z.string().optional(),
  short_description: z.string().optional(),
  price: z.number().min(0, 'Le prix doit être positif'),
  compare_at_price: z.number().min(0).optional(),
  sku: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  featured_image: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),
  features: z.array(z.string()).optional(),
  specifications: z.record(z.any()).optional(),
  inventory_quantity: z.number().min(0).optional(),
  track_inventory: z.boolean().optional(),
  weight: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
  is_visible: z.boolean().optional(),
  available_for_sale: z.boolean().optional()
})

const UpdateProductSchema = CreateProductSchema.partial()

// ✅ HELPER FUNCTIONS
function handleSupabaseError(error: any, operation: string) {
  console.error(`❌ [PRODUCTS] ${operation}:`, error)
  
  switch (error.code) {
    case 'PGRST116':
      return { status: 404, message: 'Produit non trouvé' }
    case '23505':
      return { status: 409, message: 'Un produit avec ce SKU existe déjà' }
    case '23502':
      return { status: 400, message: 'Données requises manquantes' }
    default:
      return { status: 500, message: error.message || 'Erreur serveur' }
  }
}

function validateUserAccess(request: any): string | null {
  const userId = request.user?.id
  if (!userId) {
    return null
  }
  return userId
}

// ✅ PLUGIN PRINCIPAL
const productsRoutes: FastifyPluginAsync = async (fastify) => {

  // ✅ GET /api/v1/products - RÉCUPÉRER TOUS LES PRODUITS
  fastify.get<{
    Querystring: ProductsQuery
  }>('/', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { search, category, source, isActive, page = '1', limit = '20' } = request.query

      // ✅ VALIDATION PAGINATION
      const pageNum = Math.max(1, parseInt(page) || 1)
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20))

      let query = supabaseServiceClient
        .from('products')
        .select('*', { count: 'exact' })
        .eq('shop_id', userId)

      // ✅ FILTRES OPTIMISÉS
      if (search && search.trim()) {
        const searchTerm = search.trim()
        query = query.or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%`)
      }
      
      if (category && category.trim()) {
        query = query.eq('category', category.trim())
      }
      
      if (source) {
        query = query.eq('source', source)
      }
      
      if (isActive !== undefined) {
        query = query.eq('is_active', isActive === 'true')
      }

      // ✅ PAGINATION ET TRI
      const offset = (pageNum - 1) * limitNum
      query = query.range(offset, offset + limitNum - 1)
      query = query.order('updated_at', { ascending: false })

      const { data, error, count } = await query

      if (error) {
        const errorInfo = handleSupabaseError(error, 'GET products')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      return reply.send({
        success: true,
        data: data || [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          pages: Math.ceil((count || 0) / limitNum)
        }
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] GET /: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur interne du serveur'
      })
    }
  })

  // ✅ GET /api/v1/products/:id - RÉCUPÉRER UN PRODUIT
  fastify.get<{
    Params: { id: string }
  }>('/:id', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params

      // ✅ VALIDATION UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(id)) {
        return reply.status(400).send({
          success: false,
          error: 'ID produit invalide'
        })
      }

      const { data, error } = await supabaseServiceClient
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('shop_id', userId)
        .single()

      if (error) {
        const errorInfo = handleSupabaseError(error, 'GET product by ID')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      return reply.send({
        success: true,
        data
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] GET /:id: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur interne du serveur'
      })
    }
  })

  // ✅ POST /api/v1/products - CRÉER UN PRODUIT
  fastify.post<{
    Body: CreateProductData
  }>('/', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      // ✅ VALIDATION AVEC ZOD
      const validationResult = CreateProductSchema.safeParse(request.body)
      if (!validationResult.success) {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: validationResult.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        })
      }

      const validData = validationResult.data

      // ✅ PRÉPARER LES DONNÉES AVEC DEFAULTS
      const productData = {
        ...validData,
        shop_id: userId,
        source: 'manual' as const,
        tags: validData.tags || [],
        images: validData.images || [],
        features: validData.features || [],
        specifications: validData.specifications || {},
        external_data: {},
        inventory_quantity: validData.inventory_quantity || 0,
        track_inventory: validData.track_inventory ?? false,
        is_active: validData.is_active ?? true,
        is_visible: validData.is_visible ?? true,
        available_for_sale: validData.available_for_sale ?? true,
        currency: 'XOF' // ✅ DEVISE LOCALE SÉNÉGAL
      }

      const { data, error } = await supabaseServiceClient
        .from('products')
        .insert(productData)
        .select()
        .single()

      if (error) {
        const errorInfo = handleSupabaseError(error, 'CREATE product')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      return reply.status(201).send({
        success: true,
        data,
        message: 'Produit créé avec succès'
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] POST /: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la création'
      })
    }
  })

  // ✅ PUT /api/v1/products/:id - MODIFIER UN PRODUIT
  fastify.put<{
    Params: { id: string }
    Body: Partial<CreateProductData>
  }>('/:id', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params

      // ✅ VALIDATION ZOD
      const validationResult = UpdateProductSchema.safeParse(request.body)
      if (!validationResult.success) {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: validationResult.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        })
      }

      const updateData = {
        ...validationResult.data,
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabaseServiceClient
        .from('products')
        .update(updateData)
        .eq('id', id)
        .eq('shop_id', userId)
        .select()
        .single()

      if (error) {
        const errorInfo = handleSupabaseError(error, 'UPDATE product')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      return reply.send({
        success: true,
        data,
        message: 'Produit modifié avec succès'
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] PUT /:id: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la modification'
      })
    }
  })

  // ✅ DELETE /api/v1/products/:id - SUPPRIMER UN PRODUIT
  fastify.delete<{
    Params: { id: string }
  }>('/:id', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params

      // ✅ VÉRIFIER QUE C'EST UN PRODUIT MANUEL ET EXISTE
      const { data: product, error: fetchError } = await supabaseServiceClient
        .from('products')
        .select('source, name')
        .eq('id', id)
        .eq('shop_id', userId)
        .single()

      if (fetchError) {
        const errorInfo = handleSupabaseError(fetchError, 'FETCH product for delete')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      if (product.source !== 'manual') {
        return reply.status(403).send({
          success: false,
          error: 'Seuls les produits manuels peuvent être supprimés'
        })
      }

      const { error } = await supabaseServiceClient
        .from('products')
        .delete()
        .eq('id', id)
        .eq('shop_id', userId)

      if (error) {
        const errorInfo = handleSupabaseError(error, 'DELETE product')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      return reply.send({
        success: true,
        message: `Produit "${product.name}" supprimé avec succès`
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] DELETE /:id: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la suppression'
      })
    }
  })

  // ✅ GET /api/v1/products/stats - STATISTIQUES AMÉLIORÉES
  fastify.get('/stats', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      // ✅ STATS EN PARALLÈLE POUR PERFORMANCE
      const [
        { count: total },
        { count: active },
        { count: visible },
        { count: available },
        { data: products }
      ] = await Promise.all([
        supabaseServiceClient
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', userId),
        
        supabaseServiceClient
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', userId)
          .eq('is_active', true),
        
        supabaseServiceClient
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', userId)
          .eq('is_visible', true),
        
        supabaseServiceClient
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', userId)
          .eq('available_for_sale', true),
        
        supabaseServiceClient
          .from('products')
          .select('source, category, price, inventory_quantity, track_inventory')
          .eq('shop_id', userId)
      ])

      // ✅ CALCULS STATISTIQUES
      const sourceStats = (products || []).reduce((acc: Record<string, number>, product) => {
        acc[product.source] = (acc[product.source] || 0) + 1
        return acc
      }, { manual: 0, shopify: 0, woocommerce: 0, api: 0 })

      const categoryStats = (products || [])
        .filter(p => p.category)
        .reduce((acc: Array<{name: string, count: number}>, product) => {
          const existing = acc.find(c => c.name === product.category)
          if (existing) {
            existing.count++
          } else {
            acc.push({ name: product.category, count: 1 })
          }
          return acc
        }, [])
        .sort((a, b) => b.count - a.count)

      // ✅ STATS PRIX
      const prices = (products || []).map(p => p.price).filter(p => p > 0)
      const priceStats = prices.length > 0 ? {
        min: Math.min(...prices),
        max: Math.max(...prices),
        average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      } : { min: 0, max: 0, average: 0 }

      // ✅ STOCK TOTAL
      const totalStock = (products || [])
        .filter(p => p.track_inventory)
        .reduce((sum, p) => sum + (p.inventory_quantity || 0), 0)

      return reply.send({
        success: true,
        data: {
          overview: {
            total: total || 0,
            active: active || 0,
            inactive: (total || 0) - (active || 0),
            visible: visible || 0,
            available: available || 0
          },
          bySource: sourceStats,
          categories: categoryStats.slice(0, 10), // Top 10 catégories
          pricing: priceStats,
          inventory: {
            totalStock,
            lowStockCount: (products || []).filter(p => 
              p.track_inventory && (p.inventory_quantity || 0) < 5
            ).length
          }
        }
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] GET /stats: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du calcul des statistiques'
      })
    }
  })

  // ✅ POST /api/v1/products/:id/duplicate - DUPLIQUER UN PRODUIT
  fastify.post<{
    Params: { id: string }
  }>('/:id/duplicate', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params

      // ✅ RÉCUPÉRER LE PRODUIT SOURCE
      const { data: sourceProduct, error: fetchError } = await supabaseServiceClient
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('shop_id', userId)
        .single()

      if (fetchError) {
        const errorInfo = handleSupabaseError(fetchError, 'FETCH source product')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      // ✅ CRÉER LA COPIE AVEC TIMESTAMP
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const duplicateData = {
        ...sourceProduct,
        id: undefined, // Générer nouveau ID
        name: `${sourceProduct.name} (Copie ${timestamp})`,
        sku: sourceProduct.sku ? `${sourceProduct.sku}-COPY-${Date.now()}` : undefined,
        source: 'manual' as const,
        external_id: undefined,
        external_data: {},
        is_active: false, // Créer en mode inactif
        created_at: undefined,
        updated_at: undefined
      }

      const { data, error } = await supabaseServiceClient
        .from('products')
        .insert(duplicateData)
        .select()
        .single()

      if (error) {
        const errorInfo = handleSupabaseError(error, 'DUPLICATE product')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      return reply.status(201).send({
        success: true,
        data,
        message: `Produit "${sourceProduct.name}" dupliqué avec succès`
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] POST /:id/duplicate: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la duplication'
      })
    }
  })

  // ✅ PATCH /api/v1/products/:id/toggle - ACTIVER/DÉSACTIVER UN PRODUIT
  fastify.patch<{
    Params: { id: string }
    Body: { field: 'is_active' | 'is_visible' | 'available_for_sale' }
  }>('/:id/toggle', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params
      const { field } = request.body

      if (!['is_active', 'is_visible', 'available_for_sale'].includes(field)) {
        return reply.status(400).send({
          success: false,
          error: 'Champ non autorisé pour toggle'
        })
      }

      // ✅ RÉCUPÉRER ÉTAT ACTUEL
      const { data: product, error: fetchError } = await supabaseServiceClient
        .from('products')
        .select('is_active, is_visible, available_for_sale')
        .eq('id', id)
        .eq('shop_id', userId)
        .single()

      if (fetchError) {
        const errorInfo = handleSupabaseError(fetchError, 'FETCH product for toggle')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      // ✅ TOGGLE LA VALEUR (avec assertion de type sécurisée)
      const currentValue = product[field as keyof typeof product] as boolean
      const newValue = !currentValue
      const { data, error } = await supabaseServiceClient
        .from('products')
        .update({ 
          [field]: newValue,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('shop_id', userId)
        .select()
        .single()

      if (error) {
        const errorInfo = handleSupabaseError(error, 'TOGGLE product field')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      const fieldLabels = {
        is_active: 'actif',
        is_visible: 'visible',
        available_for_sale: 'disponible à la vente'
      }

      return reply.send({
        success: true,
        data,
        message: `Produit ${newValue ? 'activé' : 'désactivé'} comme ${fieldLabels[field]}`
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] PATCH /:id/toggle: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du changement d\'état'
      })
    }
  })
}

export default productsRoutes