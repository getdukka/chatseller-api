// =====================================
// SERVER.TS - VERSION DEBUG VERBOSE
// =====================================

import dotenv from 'dotenv'
dotenv.config()

import Fastify from 'fastify'
import cors from '@fastify/cors'

console.log('🚀 === DÉMARRAGE CHATSELLER API DEBUG ===')
console.log('🐛 Version Node:', process.version)
console.log('🐛 Platform:', process.platform)
console.log('🐛 Architecture:', process.arch)

// ✅ VALIDATION VARIABLES MINIMALE
const hasSupabaseUrl = !!process.env.SUPABASE_URL
const hasSupabaseServiceKey = !!process.env.SUPABASE_SERVICE_KEY
const hasSupabaseAnonKey = !!process.env.SUPABASE_ANON_KEY

console.log('🐛 SUPABASE_URL:', hasSupabaseUrl ? 'PRÉSENT' : 'MANQUANT')
console.log('🐛 SUPABASE_SERVICE_KEY:', hasSupabaseServiceKey ? 'PRÉSENT' : 'MANQUANT')
console.log('🐛 SUPABASE_ANON_KEY:', hasSupabaseAnonKey ? 'PRÉSENT' : 'MANQUANT')

// ✅ CREATE FASTIFY INSTANCE ULTRA-SIMPLE
const fastify = Fastify({
  logger: true,
  trustProxy: true,
  requestTimeout: 60000
})

console.log('✅ Instance Fastify créée')

// ✅ HEALTH CHECK ULTRA-PRIORITAIRE ET VERBEUX
fastify.get('/health', async (request, reply) => {
  console.log('🏥 === HEALTH CHECK APPELÉ ===')
  console.log('🐛 Request IP:', request.ip)
  console.log('🐛 Request headers:', JSON.stringify(request.headers, null, 2))
  
  const healthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: 'debug-1.0',
    environment: process.env.NODE_ENV || 'undefined',
    uptime: Math.round(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform
  }
  
  console.log('🏥 Health response:', JSON.stringify(healthResponse, null, 2))
  
  return reply.code(200).send(healthResponse)
})

console.log('✅ Route /health définie')

// ✅ ROUTE RACINE SIMPLE
fastify.get('/', async (request, reply) => {
  console.log('🏠 === ROOT APPELÉE ===')
  
  const rootResponse = {
    success: true,
    message: 'ChatSeller API Debug',
    timestamp: new Date().toISOString(),
    requestInfo: {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      method: request.method,
      url: request.url
    }
  }
  
  console.log('🏠 Root response:', JSON.stringify(rootResponse, null, 2))
  
  return reply.code(200).send(rootResponse)
})

console.log('✅ Route / définie')

// ✅ ROUTE DEBUG SPÉCIALE
fastify.get('/debug', async (request, reply) => {
  console.log('🐛 === DEBUG APPELÉE ===')
  
  const debugInfo = {
    success: true,
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid
    },
    request: {
      method: request.method,
      url: request.url,
      ip: request.ip,
      headers: request.headers
    },
    timestamp: new Date().toISOString()
  }
  
  console.log('🐛 Debug info complet:', JSON.stringify(debugInfo, null, 2))
  
  return reply.code(200).send(debugInfo)
})

console.log('✅ Route /debug définie')

// ✅ CORS MINIMAL
async function registerPlugins() {
  try {
    console.log('🔧 Début enregistrement CORS...')
    
    await fastify.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
    })
    
    console.log('✅ CORS enregistré avec succès')
  } catch (error) {
    console.error('❌ Erreur CORS:', error)
    throw error
  }
}

// ✅ GESTION ERREURS VERBOSE
fastify.setErrorHandler(async (error, request, reply) => {
  console.error('💥 === ERREUR FASTIFY ===')
  console.error('💥 Error:', error)
  console.error('💥 Request:', request.method, request.url)
  console.error('💥 Stack:', error.stack)
  
  return reply.status(error.statusCode || 500).send({
    success: false,
    error: 'Erreur serveur debug',
    details: error.message,
    timestamp: new Date().toISOString()
  })
})

// ✅ HANDLERS PROCESS VERBEUX
process.on('uncaughtException', (error) => {
  console.error('💥 === UNCAUGHT EXCEPTION ===')
  console.error('💥 Error:', error)
  console.error('💥 Stack:', error.stack)
  // NE PAS EXITER EN DEBUG
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 === UNHANDLED REJECTION ===')
  console.error('💥 Reason:', reason)
  console.error('💥 Promise:', promise)
  // NE PAS EXITER EN DEBUG
})

// ✅ START FUNCTION ULTRA-VERBOSE
async function start() {
  try {
    console.log('🚀 === DÉBUT PROCESSUS DÉMARRAGE ===')
    
    console.log('📋 Étape 1: Enregistrement plugins...')
    await registerPlugins()
    console.log('✅ Plugins enregistrés')
    
    const port = parseInt(process.env.PORT || '3001', 10)
    const host = '0.0.0.0'
    
    console.log(`📋 Étape 2: Configuration serveur ${host}:${port}`)
    
    console.log('📋 Étape 3: Lancement écoute...')
    const address = await fastify.listen({ port, host })
    
    console.log('🎉 === SERVEUR DÉMARRÉ AVEC SUCCÈS ===')
    console.log(`📍 Adresse complète: ${address}`)
    console.log(`🌐 URL Railway: https://chatseller-api-production.up.railway.app`)
    console.log(`🏥 Health URL: https://chatseller-api-production.up.railway.app/health`)
    console.log(`🐛 Debug URL: https://chatseller-api-production.up.railway.app/debug`)
    console.log(`✅ Serveur prêt à recevoir le trafic`)
    
    // Test immédiat
    console.log('🧪 Test immédiat des routes locales...')
    
    setTimeout(() => {
      console.log('⏰ Serveur actif depuis 5 secondes')
    }, 5000)
    
    setTimeout(() => {
      console.log('⏰ Serveur actif depuis 30 secondes')
    }, 30000)
    
  } catch (error) {
    console.error('💥 === ERREUR FATALE DÉMARRAGE ===')
    console.error('💥 Error:', error)
    console.error('💥 Stack:', error instanceof Error ? error.stack : 'No stack trace available')
    process.exit(1)
  }
}

// ✅ SIGNAL HANDLERS VERBEUX
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM reçu - Arrêt gracieux...')
  fastify.close().then(() => {
    console.log('✅ Serveur fermé proprement')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('🛑 SIGINT reçu - Arrêt gracieux...')
  fastify.close().then(() => {
    console.log('✅ Serveur fermé proprement')
    process.exit(0)
  })
})

// ✅ DÉMARRAGE
console.log('🎬 === LANCEMENT APPLICATION DEBUG ===')
start().catch((error) => {
  console.error('💥 Impossible de démarrer:', error)
  process.exit(1)
})