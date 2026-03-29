// src/routes/products.ts
import { FastifyPluginAsync } from 'fastify'
import { supabaseServiceClient } from '../lib/supabase'
import { z } from 'zod'
import { scrapeProducts } from '../services/product-scraper'
import { batchEnrichProducts } from '../services/product-enrichment'

// ✅ TYPES BEAUTÉ COMPLETS
interface BeautyProductData {
  beauty_category?: 'skincare' | 'makeup' | 'fragrance' | 'haircare' | 'bodycare'
  skin_types?: string[]
  hair_types?: string[]
  key_ingredients?: string[]
  benefits?: string[]
  application_tips?: string[]
  contraindications?: string[]
  age_range?: string[]
  season_preference?: string[]
  occasion_tags?: string[]
  expert_notes?: string
  routine_step?: string
  compatibility?: string[]
}

interface AIProductStats {
  recommendations: number
  conversions: number
  conversion_rate: number
  revenue_generated: number
  customer_feedback_avg: number
  engagement_score: number
  last_recommended?: string
  performance_trend?: 'up' | 'down' | 'stable'
}

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
  
  // Données beauté
  beauty_data?: BeautyProductData
  is_enriched: boolean
  needs_enrichment: boolean
  enrichment_score: number
  
  // Analytics IA
  ai_stats?: AIProductStats
  ai_recommend: boolean
  personalization_enabled: boolean
  
  last_synced_at?: string
  sync_errors?: string
  created_at: string
  updated_at: string
}

// ✅ SCHÉMAS VALIDATION ZOD
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

const BeautyDataSchema = z.object({
  beauty_category: z.enum(['skincare', 'makeup', 'fragrance', 'haircare', 'bodycare']).optional(),
  skin_types: z.array(z.string()).optional(),
  hair_types: z.array(z.string()).optional(),
  key_ingredients: z.array(z.string()).optional(),
  benefits: z.array(z.string()).optional(),
  application_tips: z.array(z.string()).optional(),
  contraindications: z.array(z.string()).optional(),
  age_range: z.array(z.string()).optional(),
  season_preference: z.array(z.string()).optional(),
  occasion_tags: z.array(z.string()).optional(),
  expert_notes: z.string().optional(),
  routine_step: z.string().optional(),
  compatibility: z.array(z.string()).optional()
})

const SyncCredentialsSchema = z.object({
  platform: z.enum(['shopify', 'woocommerce']),
  shop_url: z.string().url(),
  access_token: z.string().optional(), // ✅ Optionnel pour scraping public Shopify
  api_key: z.string().optional(),
  api_secret: z.string().optional(),
  auto_enrich: z.boolean().optional() // ✅ Auto-enrichissement IA après import
})

// ✅ HELPERS
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

  // ✅ GET /api/v1/products - LISTE PRODUITS AVEC FILTRES BEAUTÉ
  fastify.get('/', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { 
        search, 
        category, 
        beauty_category,
        source, 
        is_active, 
        is_enriched,
        ai_recommend,
        page = '1', 
        limit = '20' 
      } = request.query as any

      const pageNum = Math.max(1, parseInt(page) || 1)
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20))

      let query = supabaseServiceClient
        .from('products')
        .select('*', { count: 'exact' })
        .eq('shop_id', userId)

      // Filtres
      if (search?.trim()) {
        // ✅ Limite la longueur pour éviter les abus (DoS)
        const searchTerm = search.trim().substring(0, 100)
        query = query.or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%`)
      }
      
      if (category?.trim()) {
        query = query.eq('category', category.trim())
      }

      if (beauty_category?.trim()) {
        query = query.eq('beauty_data->>beauty_category', beauty_category.trim())
      }
      
      if (source) {
        query = query.eq('source', source)
      }
      
      if (is_active !== undefined) {
        query = query.eq('is_active', is_active === 'true')
      }

      if (is_enriched !== undefined) {
        query = query.eq('is_enriched', is_enriched === 'true')
      }

      if (ai_recommend !== undefined) {
        query = query.eq('ai_recommend', ai_recommend === 'true')
      }

      // Pagination et tri
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
  fastify.get('/:id', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params as any

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
  fastify.post('/', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const validation = CreateProductSchema.safeParse(request.body)
      if (!validation.success) {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: validation.error.errors
        })
      }

      const validData = validation.data

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
        currency: 'EUR',
        is_enriched: false,
        needs_enrichment: true,
        enrichment_score: 0,
        ai_recommend: false,
        personalization_enabled: false
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
  fastify.put('/:id', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params as any

      const validation = CreateProductSchema.partial().safeParse(request.body)
      if (!validation.success) {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: validation.error.errors
        })
      }

      const updateData = {
        ...validation.data,
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
  fastify.delete('/:id', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params as any

      // Vérifier que le produit existe et appartient à l'utilisateur
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

  // ✅ POST /api/v1/products/:id/duplicate - DUPLIQUER UN PRODUIT
  fastify.post('/:id/duplicate', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params as any

      // Récupérer le produit source
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

      // Créer la copie
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const duplicateData = {
        ...sourceProduct,
        id: undefined,
        name: `${sourceProduct.name} (Copie ${timestamp})`,
        sku: sourceProduct.sku ? `${sourceProduct.sku}-COPY-${Date.now()}` : undefined,
        source: 'manual' as const,
        external_id: undefined,
        external_data: {},
        is_active: false,
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

  // ✅ POST /api/v1/products/sync - SYNCHRONISATION BOUTIQUE (AMÉLIORÉ)
  fastify.post('/sync', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const validation = SyncCredentialsSchema.safeParse(request.body)
      if (!validation.success) {
        return reply.status(400).send({
          success: false,
          error: 'Identifiants de synchronisation invalides',
          details: validation.error.errors
        })
      }

      const { platform, shop_url, access_token, api_key, auto_enrich } = validation.data

      // ✅ Traiter les chaînes vides comme undefined (le formulaire envoie "" au lieu de undefined)
      const cleanAccessToken = access_token && access_token.trim() !== '' ? access_token : undefined
      const cleanApiKey = api_key && api_key.trim() !== '' ? api_key : undefined

      fastify.log.info(`🛒 [SYNC] Début synchronisation ${platform} depuis ${shop_url} (token: ${!!cleanAccessToken}, auto_enrich: ${auto_enrich})`)

      // 🎯 SCRAPING DES PRODUITS
      let scrapedProducts;
      try {
        scrapedProducts = await scrapeProducts(platform, {
          shop_url,
          access_token: cleanAccessToken,
          consumer_key: cleanApiKey,
          consumer_secret: cleanAccessToken // Pour WooCommerce
        });

        fastify.log.info(`✅ [SYNC] ${scrapedProducts.length} produits scrapés depuis ${platform}`)
      } catch (scrapeError: any) {
        fastify.log.error(`❌ [SYNC] Erreur scraping: ${scrapeError.message}`)
        return reply.status(400).send({
          success: false,
          error: `Impossible de se connecter à ${platform}`,
          details: scrapeError.message,
          help: platform === 'shopify'
            ? 'Vérifiez que votre URL Shopify est correcte et que votre access token a les permissions "read_products"'
            : 'Vérifiez vos clés API WooCommerce et que votre site est accessible'
        });
      }

      // ✅ AUCUN PRODUIT = MESSAGE CLAIR (pas de mock)
      if (!scrapedProducts || scrapedProducts.length === 0) {
        fastify.log.warn(`⚠️ [SYNC] Aucun produit trouvé sur ${shop_url}`)
        return reply.send({
          success: true,
          data: [],
          summary: {
            total_found: 0,
            inserted: 0,
            updated: 0,
            errors: 0
          },
          message: `Aucun produit trouvé sur ${shop_url}. Vérifiez que votre boutique contient des produits publiés.`
        })
      }

      // 🔄 Convertir en format Supabase products (aligné avec le schéma de la table)
      console.log(`🔄 [SYNC] Préparation de ${scrapedProducts.length} produits pour insertion DB...`);

      const productsToUpsert = scrapedProducts.map((product, index) => {
        const productData = {
          // Champs obligatoires
          name: product.name,
          description: product.description || '',
          price: product.price || 0,
          currency: product.currency || 'EUR',
          shop_id: userId,

          // Champs optionnels
          category: product.category || null,
          source: platform,
          external_id: product.external_id,
          url: product.url || null,

          // ✅ Image principale (utiliser seulement featured_image)
          featured_image: product.images?.[0] || null,

          // Arrays et objets
          tags: product.tags || [],
          images: product.images || [],
          features: [],
          specifications: {},
          external_data: {
            platform,
            shop_url,
            variants: product.variants || [],
            scraped_at: new Date().toISOString()
          },

          // Statuts
          is_active: true,
          is_visible: true,
          available_for_sale: true,

          // Inventaire
          inventory_quantity: product.inventory_quantity || 0,
          track_inventory: false,

          // Enrichissement IA
          is_enriched: false,
          needs_enrichment: true,
          enrichment_score: 0,
          ai_recommend: true,
          personalization_enabled: false,

          // ✅ Fournir updated_at explicitement (pas de DEFAULT en DB)
          updated_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString()
        };

        if (index === 0) {
          // Log le premier produit en détail pour debug
          fastify.log.info(`📦 [SYNC DEBUG] Premier produit préparé: ${JSON.stringify(productData, null, 2).substring(0, 800)}`);
        }

        return productData;
      });

      fastify.log.info(`📊 [SYNC] ${productsToUpsert.length} produits préparés pour insertion`);

      // ✅ UPSERT : Met à jour si existe, insère si nouveau (évite doublons)
      let inserted = 0;
      let updated = 0;
      let errors = 0;
      const insertedProducts: any[] = [];
      const errorDetails: any[] = [];

      fastify.log.info(`🔄 [SYNC] Début du processus d'insertion pour ${productsToUpsert.length} produits...`);

      for (let i = 0; i < productsToUpsert.length; i++) {
        const product = productsToUpsert[i];

        try {
          fastify.log.info(`📍 [SYNC ${i+1}/${productsToUpsert.length}] Traitement: ${product.name} (external_id: ${product.external_id})`);

          // Vérifier si le produit existe déjà (même external_id + shop_id)
          const { data: existing, error: checkError } = await supabaseServiceClient
            .from('products')
            .select('id, name, updated_at')
            .eq('shop_id', userId)
            .eq('external_id', product.external_id)
            .maybeSingle(); // ✅ Utiliser maybeSingle() au lieu de single() pour éviter erreur si non trouvé

          if (checkError) {
            fastify.log.error(`❌ [SYNC] Erreur lors de la vérification d'existence: ${product.name} - ${checkError.message} (code: ${checkError.code})`);
            errors++;
            errorDetails.push({ product: product.name, step: 'check', error: checkError.message });
            continue;
          }

          if (existing) {
            // ✅ UPDATE : Produit existant
            fastify.log.info(`🔄 [SYNC] Produit existant trouvé - Mise à jour: ${product.name} (DB id: ${existing.id})`);

            const { data: updatedProduct, error: updateError } = await supabaseServiceClient
              .from('products')
              .update({
                ...product,
                updated_at: new Date().toISOString()
              })
              .eq('id', existing.id)
              .select()
              .single();

            if (updateError) {
              errors++;
              fastify.log.error(`❌ [SYNC] Erreur UPDATE pour ${product.name}: ${updateError.message} (code: ${updateError.code}, details: ${updateError.details}, hint: ${updateError.hint})`);
              errorDetails.push({ product: product.name, step: 'update', error: updateError.message, code: updateError.code });
            } else {
              updated++;
              insertedProducts.push(updatedProduct);
              fastify.log.info(`✅ [SYNC] Produit mis à jour avec succès: ${product.name}`);
            }
          } else {
            // ✅ INSERT : Nouveau produit
            fastify.log.info(`➕ [SYNC] Nouveau produit - Insertion: ${product.name}`);

            // Log détaillé du premier produit pour debug
            if (i === 0) {
              fastify.log.info(`🔍 [SYNC DEBUG] Premier produit - name: ${product.name}, price: ${product.price}, shop_id: ${product.shop_id}, external_id: ${product.external_id}, source: ${product.source}, images: ${product.images?.length || 0}, tags: ${product.tags?.length || 0}`);
            }

            const { data: newProduct, error: insertError } = await supabaseServiceClient
              .from('products')
              .insert(product)
              .select()
              .single();

            if (insertError) {
              errors++;
              fastify.log.error(`❌ [SYNC] Erreur INSERT pour ${product.name}: ${insertError.message} (code: ${insertError.code}, details: ${JSON.stringify(insertError.details)}, hint: ${insertError.hint})`);
              fastify.log.error(`❌ [SYNC] Données produit échouées: name=${product.name}, shop_id=${product.shop_id}, external_id=${product.external_id}, source=${product.source}, price=${product.price}`);
              errorDetails.push({
                product: product.name,
                step: 'insert',
                error: insertError.message,
                code: insertError.code,
                details: insertError.details,
                hint: insertError.hint
              });
            } else {
              inserted++;
              insertedProducts.push(newProduct);
              fastify.log.info(`✅ [SYNC] Produit inséré avec succès: ${product.name} (nouveau DB id: ${newProduct?.id})`);
            }
          }
        } catch (unexpectedError: any) {
          errors++;
          fastify.log.error(`❌ [SYNC] Erreur inattendue pour ${product.name}:`, unexpectedError);
          errorDetails.push({ product: product.name, step: 'unexpected', error: unexpectedError.message });
        }
      }

      fastify.log.info(`📊 [SYNC] Résumé final: ${inserted} insérés, ${updated} mis à jour, ${errors} erreurs`);
      if (errors > 0) {
        fastify.log.error(`📋 [SYNC] Détail des ${errorDetails.length} erreurs: ${JSON.stringify(errorDetails, null, 2)}`);
      }

      fastify.log.info(`✅ [SYNC] Terminé: ${inserted} insérés, ${updated} mis à jour, ${errors} erreurs`)

      // 🤖 AUTO-ENRICHISSEMENT en arrière-plan (si activé)
      if (auto_enrich && insertedProducts.length > 0) {
        fastify.log.info(`🎨 [SYNC] Lancement auto-enrichissement de ${insertedProducts.length} produits...`)

        // Lance l'enrichissement en arrière-plan (ne bloque pas la réponse)
        batchEnrichProducts(insertedProducts)
          .then(async (enrichedProducts) => {
            // Mettre à jour les produits enrichis en DB
            for (const enriched of enrichedProducts) {
              if (enriched.is_enriched) {
                await supabaseServiceClient
                  .from('products')
                  .update({
                    beauty_data: enriched.beauty_data,
                    is_enriched: true,
                    enrichment_score: enriched.enrichment_score,
                    needs_enrichment: false
                  })
                  .eq('id', enriched.id);
              }
            }
            fastify.log.info(`✅ [ENRICHMENT] ${enrichedProducts.filter(p => p.is_enriched).length} produits enrichis avec succès`);
          })
          .catch(error => {
            fastify.log.error(`❌ [ENRICHMENT] Erreur auto-enrichissement: ${error.message}`);
          });
      }

      return reply.send({
        success: true,
        data: insertedProducts,
        summary: {
          total_found: scrapedProducts.length,
          inserted,
          updated,
          errors
        },
        errorDetails: errors > 0 ? errorDetails : undefined,
        message: `Synchronisation terminée : ${inserted} nouveaux produits, ${updated} mis à jour${auto_enrich ? ' (enrichissement en cours...)' : ''}`
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] POST /sync: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la synchronisation',
        details: error.message
      })
    }
  })

  // ✅ POST /api/v1/products/:id/enrich - ENRICHISSEMENT BEAUTÉ
  fastify.post('/:id/enrich', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params as any
      const validation = BeautyDataSchema.safeParse(request.body)
      
      if (!validation.success) {
        return reply.status(400).send({
          success: false,
          error: 'Données d\'enrichissement invalides',
          details: validation.error.errors
        })
      }

      const beautyData = validation.data

      // Vérifier que le produit existe et appartient à l'utilisateur
      const { data: existingProduct, error: fetchError } = await supabaseServiceClient
        .from('products')
        .select('id, name')
        .eq('id', id)
        .eq('shop_id', userId)
        .single()

      if (fetchError) {
        const errorInfo = handleSupabaseError(fetchError, 'FETCH product for enrichment')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      // Calculer le score d'enrichissement
      let score = 0
      if (beautyData.skin_types?.length) score += 20
      if (beautyData.key_ingredients?.length) score += 25
      if (beautyData.benefits?.length) score += 20
      if (beautyData.application_tips?.length) score += 15
      if (beautyData.age_range?.length) score += 10
      if (beautyData.expert_notes) score += 10

      // Mettre à jour avec les données beauté
      const { data, error } = await supabaseServiceClient
        .from('products')
        .update({
          beauty_data: beautyData,
          is_enriched: true,
          needs_enrichment: false,
          enrichment_score: Math.min(score, 100),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('shop_id', userId)
        .select()
        .single()

      if (error) {
        const errorInfo = handleSupabaseError(error, 'ENRICH product')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      return reply.send({
        success: true,
        data,
        message: `Produit "${existingProduct.name}" enrichi avec succès`
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] POST /:id/enrich: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'enrichissement'
      })
    }
  })

  // ✅ PATCH /api/v1/products/:id/ai-recommend - TOGGLE RECOMMANDATION IA
  fastify.patch('/:id/ai-recommend', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params as { id: string }

      // ✅ Validation Zod stricte (remplace le cast `as any`)
      const aiRecommendSchema = z.object({
        recommend: z.boolean({ required_error: 'Le paramètre "recommend" doit être un booléen' })
      })
      const parsed = aiRecommendSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0]?.message || 'Paramètre invalide'
        })
      }
      const { recommend } = parsed.data

      const { data, error } = await supabaseServiceClient
        .from('products')
        .update({
          ai_recommend: recommend,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('shop_id', userId)
        .select()
        .single()

      if (error) {
        const errorInfo = handleSupabaseError(error, 'TOGGLE AI recommendation')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      return reply.send({
        success: true,
        data,
        message: recommend 
          ? 'Produit ajouté aux recommandations IA' 
          : 'Produit retiré des recommandations IA'
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] PATCH /:id/ai-recommend: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du changement de recommandation'
      })
    }
  })

  // ✅ GET /api/v1/products/beauty-insights - INSIGHTS BEAUTÉ
  fastify.get('/beauty-insights', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      // Récupérer tous les produits pour calculer les insights
      const { data: products, error } = await supabaseServiceClient
        .from('products')
        .select('*')
        .eq('shop_id', userId)

      if (error) {
        const errorInfo = handleSupabaseError(error, 'GET products for insights')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      const total = products?.length || 0
      const enriched = products?.filter(p => p.is_enriched).length || 0
      const aiRecommended = products?.filter(p => p.ai_recommend).length || 0

      // Calculer les catégories beauté
      const categoryStats = products?.reduce((acc: Record<string, number>, product) => {
        const category = product.beauty_data?.beauty_category || 'uncategorized'
        acc[category] = (acc[category] || 0) + 1
        return acc
      }, {}) || {}

      const insights = {
        total_products: total,
        enriched_products: enriched,
        ai_recommended: aiRecommended,
        avg_enrichment_score: enriched > 0 
          ? Math.round(products!.filter(p => p.is_enriched).reduce((sum, p) => sum + (p.enrichment_score || 0), 0) / enriched)
          : 0,
        skincare_count: categoryStats.skincare || 0,
        makeup_count: categoryStats.makeup || 0,
        fragrance_count: categoryStats.fragrance || 0,
        haircare_count: categoryStats.haircare || 0,
        bodycare_count: categoryStats.bodycare || 0
      }

      return reply.send({
        success: true,
        data: {
          overview: {
            totalProducts: insights.total_products,
            enrichedProducts: insights.enriched_products,
            aiRecommended: insights.ai_recommended,
            enrichmentProgress: total > 0 
              ? Math.round((enriched / total) * 100)
              : 0
          },
          categories: {
            skincare: insights.skincare_count,
            makeup: insights.makeup_count,
            fragrance: insights.fragrance_count,
            haircare: insights.haircare_count,
            bodycare: insights.bodycare_count
          },
          performance: {
            averageEnrichmentScore: insights.avg_enrichment_score
          }
        }
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] GET /beauty-insights: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des insights'
      })
    }
  })

  // ✅ POST /api/v1/products/ai-analyze - ANALYSE IA PRODUIT
  fastify.post('/ai-analyze', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      // ✅ ACCEPTER LES DEUX FORMATS : { productData } OU { name, description, ... }
      // Validation stricte pour éviter les données non typées
      const aiAnalyzeBodySchema = z.object({
        productData: z.record(z.unknown()).optional(),
        name: z.string().max(500).optional(),
        description: z.string().max(5000).optional(),
        price: z.number().optional(),
        category: z.string().max(100).optional(),
        sku: z.string().max(100).optional()
      }).passthrough() // Autorise champs supplémentaires
      const body = aiAnalyzeBodySchema.parse(request.body)
      const productData = (body.productData as Record<string, unknown>) || body

      fastify.log.info(`🤖 [AI-ANALYZE] Analyse IA demandée pour produit: ${productData.name}`)
      fastify.log.info(`🤖 [AI-ANALYZE] Données reçues: ${JSON.stringify(productData).substring(0, 200)}`)

      if (!productData?.name) {
        fastify.log.error('❌ [AI-ANALYZE] Nom du produit manquant')
        return reply.status(400).send({
          success: false,
          error: 'Le nom du produit est requis pour l\'analyse'
        })
      }

      // ✅ ANALYSE IA AVEC DÉTECTION INTELLIGENTE
      const analysis = analyzeProductWithAI(productData)

      fastify.log.info(`✅ [AI-ANALYZE] Analyse terminée: ${analysis.suggestions.key_ingredients?.length || 0} ingrédients, ${analysis.suggestions.benefits?.length || 0} bienfaits`)

      return reply.send({
        success: true,
        data: analysis,
        message: 'Analyse IA terminée avec succès'
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] POST /ai-analyze: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'analyse IA',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    }
  })

  // ✅ GET /api/v1/products/:id/metrics - MÉTRIQUES PRODUIT
  fastify.get('/:id/metrics', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      const { id } = request.params as any

      // Récupérer le produit
      const { data: product, error } = await supabaseServiceClient
        .from('products')
        .select('*, ai_stats')
        .eq('id', id)
        .eq('shop_id', userId)
        .single()

      if (error) {
        const errorInfo = handleSupabaseError(error, 'GET product metrics')
        return reply.status(errorInfo.status).send({
          success: false,
          error: errorInfo.message
        })
      }

      // Métriques simulées
      const metrics = {
        views: 245,
        interactions: 89,
        conversionRate: product.ai_stats?.conversion_rate || 12.5,
        recommendations: product.ai_stats?.recommendations || 34,
        conversions: product.ai_stats?.conversions || 8,
        revenue: product.ai_stats?.revenue_generated || 280,
        performance: {
          trend: product.ai_stats?.performance_trend || 'stable',
          score: product.enrichment_score || 0
        }
      }

      return reply.send({
        success: true,
        data: metrics
      })
    } catch (error: any) {
      fastify.log.error(`❌ [PRODUCTS] GET /:id/metrics: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des métriques'
      })
    }
  })

  // ✅ GET /api/v1/products/stats - STATISTIQUES GLOBALES
  fastify.get('/stats', async (request, reply) => {
    try {
      const userId = validateUserAccess(request)
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: 'Authentification requise'
        })
      }

      // Stats en parallèle pour performance
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
          .select('source, category, price, inventory_quantity, track_inventory, is_enriched, ai_recommend')
          .eq('shop_id', userId)
      ])

      // Calculs statistiques
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

      // Stats prix
      const prices = (products || []).map(p => p.price).filter(p => p > 0)
      const priceStats = prices.length > 0 ? {
        min: Math.min(...prices),
        max: Math.max(...prices),
        average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      } : { min: 0, max: 0, average: 0 }

      // Stock total
      const totalStock = (products || [])
        .filter(p => p.track_inventory)
        .reduce((sum, p) => sum + (p.inventory_quantity || 0), 0)

      // Stats beauté
      const enriched = (products || []).filter(p => p.is_enriched).length
      const aiRecommended = (products || []).filter(p => p.ai_recommend).length

      return reply.send({
        success: true,
        data: {
          overview: {
            total: total || 0,
            active: active || 0,
            inactive: (total || 0) - (active || 0),
            visible: visible || 0,
            available: available || 0,
            enriched,
            aiRecommended
          },
          bySource: sourceStats,
          categories: categoryStats.slice(0, 10),
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
}

// ✅ FONCTIONS HELPERS POUR IA
function analyzeProductWithAI(productData: any) {
  const name = productData.name.toLowerCase()
  const desc = (productData.description || '').toLowerCase()
  const text = (name + ' ' + desc)

  // Détection catégorie beauté
  let beautyCategory = 'skincare'
  if (text.includes('mascara') || text.includes('rouge') || text.includes('fond')) beautyCategory = 'makeup'
  else if (text.includes('parfum') || text.includes('eau de')) beautyCategory = 'fragrance'
  else if (text.includes('shampooing') || text.includes('cheveux')) beautyCategory = 'haircare'
  else if (text.includes('corps') || text.includes('body')) beautyCategory = 'bodycare'

  // Extraction ingrédients
  const commonIngredients = [
    'acide hyaluronique', 'vitamine c', 'rétinol', 'niacinamide',
    'acide salicylique', 'acide glycolique', 'peptides', 'collagène',
    'aloe vera', 'beurre de karité'
  ]
  const detectedIngredients = commonIngredients.filter(ing => text.includes(ing))

  // Suggestion types de peau
  const skinTypes = []
  if (text.includes('tous') || text.includes('universal')) {
    skinTypes.push('Normale', 'Sèche', 'Grasse', 'Mixte', 'Sensible')
  } else {
    if (text.includes('hydratant') || text.includes('sec')) skinTypes.push('Sèche')
    if (text.includes('matifiant') || text.includes('gras')) skinTypes.push('Grasse')
    if (text.includes('mixte')) skinTypes.push('Mixte')
    if (text.includes('sensible')) skinTypes.push('Sensible')
    if (skinTypes.length === 0) skinTypes.push('Normale')
  }

  return {
    confidence: 0.85,
    suggestions: {
      beauty_category: beautyCategory,
      skin_types: skinTypes,
      key_ingredients: detectedIngredients,
      benefits: extractBenefits(text),
      application_tips: generateApplicationTips(beautyCategory),
      expert_notes: `Produit ${beautyCategory} adapté pour ${skinTypes.join(', ')}`
    }
  }
}

function extractBenefits(text: string): string[] {
  const benefits = []
  if (text.includes('hydrat')) benefits.push('Hydratation')
  if (text.includes('anti-âge') || text.includes('rides')) benefits.push('Anti-âge')
  if (text.includes('éclat')) benefits.push('Éclat')
  if (text.includes('nettoy')) benefits.push('Nettoyage')
  if (text.includes('protec')) benefits.push('Protection')
  return benefits
}

function generateApplicationTips(category: string): string[] {
  const tips: Record<string, string[]> = {
    skincare: ['Appliquer sur peau propre', 'Utiliser matin et/ou soir', 'Toujours terminer par une crème solaire le matin'],
    makeup: ['Utiliser un primer avant application', 'Estomper délicatement', 'Fixer avec une poudre'],
    fragrance: ['Vaporiser sur points de pulsation', 'Ne pas frotter après application'],
    haircare: ['Appliquer sur cheveux mouillés', 'Masser délicatement', 'Rincer abondamment'],
    bodycare: ['Appliquer sur peau humide', 'Masser en mouvements circulaires']
  }
  return tips[category] || tips.skincare
}

export default productsRoutes