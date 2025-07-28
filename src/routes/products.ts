// src/routes/products.ts - ENDPOINT PRODUITS COMPLET
import { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { createClient } from '@supabase/supabase-js'

// ✅ TYPES
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

interface SyncConnectionData {
  platform: 'shopify' | 'woocommerce'
  credentials: Record<string, any>
  config?: Record<string, any>
}

// ✅ INTERFACE POUR L'UTILISATEUR AUTHENTIFIÉ
interface AuthenticatedUser {
  id: string
  email: string
  [key: string]: any
}

// ✅ EXTENSION DE FASTIFY REQUEST
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser
  }
}

// ✅ PLUGIN PRINCIPAL
const productsRoutes: FastifyPluginAsync = async (fastify) => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY! // Clé service pour accès admin
  )

  // ✅ GET /api/v1/products - RÉCUPÉRER TOUS LES PRODUITS
  fastify.get<{
    Querystring: ProductsQuery
  }>('/', async (request, reply) => {
    try {
      const { search, category, source, isActive, page = '1', limit = '20' } = request.query
      const userId = request.user?.id

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Non autorisé'
        })
      }

      let query = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .eq('shop_id', userId)

      // ✅ FILTRES
      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`)
      }
      if (category) {
        query = query.eq('category', category)
      }
      if (source) {
        query = query.eq('source', source)
      }
      if (isActive !== undefined) {
        query = query.eq('is_active', isActive === 'true')
      }

      // ✅ PAGINATION
      const pageNum = parseInt(page)
      const limitNum = parseInt(limit)
      const offset = (pageNum - 1) * limitNum
      
      query = query.range(offset, offset + limitNum - 1)
      query = query.order('updated_at', { ascending: false })

      const { data, error, count } = await query

      if (error) {
        fastify.log.error('Erreur fetch products:', error)
        throw error
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
      fastify.log.error('Erreur GET /products:', error)
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur serveur'
      })
    }
  })

  // ✅ GET /api/v1/products/:id - RÉCUPÉRER UN PRODUIT
  fastify.get<{
    Params: { id: string }
  }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params
      const userId = request.user?.id

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Non autorisé'
        })
      }

      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('shop_id', userId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Produit non trouvé'
          })
        }
        throw error
      }

      return reply.send({
        success: true,
        data
      })
    } catch (error: any) {
      fastify.log.error('Erreur GET /products/:id:', error)
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur serveur'
      })
    }
  })

  // ✅ POST /api/v1/products - CRÉER UN PRODUIT
  fastify.post<{
    Body: CreateProductData
  }>('/', async (request, reply) => {
    try {
      const userId = request.user?.id

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Non autorisé'
        })
      }

      // ✅ VALIDATION BASIQUE
      if (!request.body.name || request.body.price < 0) {
        return reply.status(400).send({
          success: false,
          error: 'Nom et prix valide requis'
        })
      }

      // ✅ PRÉPARER LES DONNÉES
      const productData = {
        ...request.body,
        shop_id: userId,
        source: 'manual' as const,
        tags: request.body.tags || [],
        images: request.body.images || [],
        features: request.body.features || [],
        specifications: request.body.specifications || {},
        external_data: {},
        inventory_quantity: request.body.inventory_quantity || 0,
        track_inventory: request.body.track_inventory || false,
        is_active: request.body.is_active !== false,
        is_visible: request.body.is_visible !== false,
        available_for_sale: request.body.available_for_sale !== false,
        currency: 'EUR'
      }

      const { data, error } = await supabase
        .from('products')
        .insert(productData)
        .select()
        .single()

      if (error) {
        // ✅ GESTION ERREURS SPÉCIFIQUES
        if (error.code === '23505') { // Contrainte unique
          return reply.status(409).send({
            success: false,
            error: 'Un produit avec ce SKU existe déjà'
          })
        }
        throw error
      }

      return reply.status(201).send({
        success: true,
        data
      })
    } catch (error: any) {
      fastify.log.error('Erreur POST /products:', error)
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur lors de la création'
      })
    }
  })

  // ✅ PUT /api/v1/products/:id - MODIFIER UN PRODUIT
  fastify.put<{
    Params: { id: string }
    Body: Partial<CreateProductData>
  }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params
      const userId = request.user?.id

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Non autorisé'
        })
      }

      const updateData = {
        ...request.body,
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('products')
        .update(updateData)
        .eq('id', id)
        .eq('shop_id', userId)
        .select()
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Produit non trouvé'
          })
        }
        if (error.code === '23505') {
          return reply.status(409).send({
            success: false,
            error: 'Un produit avec ce SKU existe déjà'
          })
        }
        throw error
      }

      return reply.send({
        success: true,
        data
      })
    } catch (error: any) {
      fastify.log.error('Erreur PUT /products/:id:', error)
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur lors de la modification'
      })
    }
  })

  // ✅ DELETE /api/v1/products/:id - SUPPRIMER UN PRODUIT
  fastify.delete<{
    Params: { id: string }
  }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params
      const userId = request.user?.id

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Non autorisé'
        })
      }

      // ✅ VÉRIFIER QUE C'EST UN PRODUIT MANUEL
      const { data: product, error: fetchError } = await supabase
        .from('products')
        .select('source')
        .eq('id', id)
        .eq('shop_id', userId)
        .single()

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Produit non trouvé'
          })
        }
        throw fetchError
      }

      if (product.source !== 'manual') {
        return reply.status(403).send({
          success: false,
          error: 'Seuls les produits manuels peuvent être supprimés'
        })
      }

      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id)
        .eq('shop_id', userId)

      if (error) {
        throw error
      }

      return reply.send({
        success: true,
        message: 'Produit supprimé avec succès'
      })
    } catch (error: any) {
      fastify.log.error('Erreur DELETE /products/:id:', error)
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur lors de la suppression'
      })
    }
  })

  // ✅ GET /api/v1/products/stats - STATISTIQUES
  fastify.get('/stats', async (request, reply) => {
    try {
      const userId = request.user?.id

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Non autorisé'
        })
      }

      // ✅ STATS GLOBALES
      const { count: total } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', userId)

      const { count: active } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', userId)
        .eq('is_active', true)

      // ✅ STATS PAR SOURCE
      const { data: products } = await supabase
        .from('products')
        .select('source, category')
        .eq('shop_id', userId)

      const sourceStats = (products || []).reduce((acc: Record<string, number>, product) => {
        acc[product.source] = (acc[product.source] || 0) + 1
        return acc
      }, { manual: 0, shopify: 0, woocommerce: 0 })

      // ✅ STATS PAR CATÉGORIE
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

      return reply.send({
        success: true,
        data: {
          total: total || 0,
          active: active || 0,
          inactive: (total || 0) - (active || 0),
          bySource: sourceStats,
          categories: categoryStats
        }
      })
    } catch (error: any) {
      fastify.log.error('Erreur GET /products/stats:', error)
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur serveur'
      })
    }
  })

  // ✅ POST /api/v1/products/sync - SYNCHRONISER AVEC PLATEFORME E-COMMERCE
  fastify.post<{
    Body: {
      source: 'shopify' | 'woocommerce'
      credentials: Record<string, any>
    }
  }>('/sync', async (request, reply) => {
    try {
      const userId = request.user?.id
      const { source, credentials } = request.body

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Non autorisé'
        })
      }

      if (!source || !credentials) {
        return reply.status(400).send({
          success: false,
          error: 'Source et credentials requis'
        })
      }

      // ✅ SAUVEGARDER/METTRE À JOUR LA CONNEXION
      const connectionData = {
        shop_id: userId,
        platform: source,
        credentials: credentials, // ⚠️ En production, chiffrer ces données
        is_active: true,
        is_connected: true,
        connection_status: 'connected',
        updated_at: new Date().toISOString()
      }

      const { error: connectionError } = await supabase
        .from('sync_connections')
        .upsert(connectionData, {
          onConflict: 'shop_id,platform'
        })

      if (connectionError) {
        throw connectionError
      }

      // ✅ TODO: DÉCLENCHER JOB DE SYNCHRONISATION ASYNCHRONE
      // Pour l'instant, on simule un job ID
      const jobId = `sync_${source}_${Date.now()}`

      // ✅ TODO: Implémenter la vraie logique de sync
      // - Shopify: utiliser Admin API
      // - WooCommerce: utiliser REST API
      // - Traiter par batches pour éviter les timeouts
      // - Gérer les erreurs et retry logic

      return reply.send({
        success: true,
        message: `Synchronisation ${source} démarrée`,
        jobId
      })
    } catch (error: any) {
      fastify.log.error('Erreur POST /products/sync:', error)
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur lors de la synchronisation'
      })
    }
  })

  // ✅ GET /api/v1/products/sync/status/:jobId - STATUT DE SYNCHRONISATION
  fastify.get<{
    Params: { jobId: string }
  }>('/sync/status/:jobId', async (request, reply) => {
    try {
      const { jobId } = request.params
      const userId = request.user?.id

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Non autorisé'
        })
      }

      // ✅ TODO: Récupérer le statut réel du job
      // Pour l'instant, simulation
      return reply.send({
        success: true,
        data: {
          jobId,
          status: 'completed',
          progress: 100,
          productsProcessed: 15,
          errors: []
        }
      })
    } catch (error: any) {
      fastify.log.error('Erreur GET /products/sync/status:', error)
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur serveur'
      })
    }
  })

  // ✅ POST /api/v1/products/:id/duplicate - DUPLIQUER UN PRODUIT
  fastify.post<{
    Params: { id: string }
  }>('/:id/duplicate', async (request, reply) => {
    try {
      const { id } = request.params
      const userId = request.user?.id

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Non autorisé'
        })
      }

      // ✅ RÉCUPÉRER LE PRODUIT SOURCE
      const { data: sourceProduct, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('shop_id', userId)
        .single()

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Produit source non trouvé'
          })
        }
        throw fetchError
      }

      // ✅ CRÉER LA COPIE
      const duplicateData = {
        ...sourceProduct,
        id: undefined, // Générer nouveau ID
        name: `${sourceProduct.name} (Copie)`,
        sku: sourceProduct.sku ? `${sourceProduct.sku}-COPY` : undefined,
        source: 'manual' as const,
        external_id: undefined,
        external_data: {},
        is_active: false, // Créer en mode inactif
        created_at: undefined,
        updated_at: undefined
      }

      const { data, error } = await supabase
        .from('products')
        .insert(duplicateData)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          return reply.status(409).send({
            success: false,
            error: 'Un produit avec ce SKU existe déjà'
          })
        }
        throw error
      }

      return reply.status(201).send({
        success: true,
        data
      })
    } catch (error: any) {
      fastify.log.error('Erreur POST /products/:id/duplicate:', error)
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erreur lors de la duplication'
      })
    }
  })
}

export default productsRoutes