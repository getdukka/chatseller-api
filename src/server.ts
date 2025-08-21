// =====================================
// SERVER.TS - VERSION MINIMALISTE DIAGNOSTIC
// =====================================

import dotenv from 'dotenv'
dotenv.config()

import Fastify from 'fastify'
import cors from '@fastify/cors'

console.log('🚀 === DÉMARRAGE CHATSELLER API (VERSION DIAGNOSTIC) ===')

// ✅ VALIDATION BASIQUE DES VARIABLES
const requiredEnvVars = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
}

console.log('🔍 Vérification variables d\'environnement...')
for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    console.error(`❌ Variable manquante: ${key}`)
  } else {
    console.log(`✅ ${key}: ${value.substring(0, 20)}...`)
  }
}

// ✅ CREATE FASTIFY INSTANCE MINIMAL
const fastify = Fastify({
  logger: true,
  trustProxy: true
})

console.log('📦 Fastify instance créée')

// ✅ GESTION ERREURS BASIQUE
fastify.setErrorHandler(async (error, request, reply) => {
  console.error('❌ Erreur Fastify:', error)
  return reply.status(500).send({
    success: false,
    error: 'Erreur serveur',
    details: error.message
  })
})

console.log('🛡️ Error handler configuré')

// ✅ CORS SIMPLE
async function registerPlugins() {
  try {
    console.log('🔧 Enregistrement CORS...')
    await fastify.register(cors, {
      origin: true,
      credentials: true
    })
    console.log('✅ CORS enregistré')
  } catch (error) {
    console.error('❌ Erreur CORS:', error)
    throw error
  }
}

// ✅ ROUTES MINIMALES
async function registerRoutes() {
  try {
    console.log('🛣️ Enregistrement routes...')
    
    // Health check ultra-simple
    fastify.get('/health', async (request, reply) => {
      console.log('🏥 Health check appelé')
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.4.0-minimal',
        environment: process.env.NODE_ENV || 'unknown',
        uptime: Math.round(process.uptime())
      }
    })
    
    // Route racine
    fastify.get('/', async (request, reply) => {
      console.log('🏠 Route racine appelée')
      return {
        success: true,
        message: 'ChatSeller API - Version diagnostic',
        version: '1.4.0-minimal',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'unknown'
      }
    })
    
    // Test environnement
    fastify.get('/test-env', async (request, reply) => {
      console.log('🧪 Test environnement appelé')
      return {
        success: true,
        environment: {
          NODE_ENV: process.env.NODE_ENV || 'undefined',
          PORT: process.env.PORT || 'undefined',
          SUPABASE_URL: process.env.SUPABASE_URL ? 'défini' : 'manquant',
          SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? 'défini' : 'manquant',
          SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? 'défini' : 'manquant',
          OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'défini' : 'manquant'
        }
      }
    })
    
    console.log('✅ Routes enregistrées')
    
  } catch (error) {
    console.error('❌ Erreur routes:', error)
    throw error
  }
}

// ✅ START FUNCTION SIMPLIFIÉE
async function start() {
  try {
    console.log('🔧 Enregistrement plugins...')
    await registerPlugins()
    
    console.log('🛣️ Enregistrement routes...')
    await registerRoutes()
    
    const port = parseInt(process.env.PORT || '3001', 10)
    const host = '0.0.0.0'
    
    console.log(`🚀 Démarrage serveur sur ${host}:${port}...`)
    
    const address = await fastify.listen({ port, host })
    
    console.log(`✅ SERVEUR DÉMARRÉ AVEC SUCCÈS !`)
    console.log(`📍 Adresse locale: ${address}`)
    console.log(`🌐 URL Railway: https://chatseller-api-production.up.railway.app`)
    console.log(`🏥 Health check: https://chatseller-api-production.up.railway.app/health`)
    console.log(`🧪 Test env: https://chatseller-api-production.up.railway.app/test-env`)
    
  } catch (error) {
    console.error('💥 ERREUR FATALE AU DÉMARRAGE:', error)
    console.error('Stack trace:', (error as Error).stack)
    process.exit(1)
  }
}

// ✅ GESTION SIGNAUX
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM reçu, arrêt gracieux...')
  await fastify.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT reçu, arrêt gracieux...')
  await fastify.close()
  process.exit(0)
})

// ✅ DÉMARRAGE
console.log('🎬 Lancement de l\'application...')
start().catch((error) => {
  console.error('💥 IMPOSSIBLE DE DÉMARRER:', error)
  process.exit(1)
})