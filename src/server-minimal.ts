// =====================================
// SERVER MINIMAL POUR RAILWAY - DEBUGGING
// =====================================

import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'

dotenv.config()

console.log('🚀 === DÉMARRAGE SERVEUR MINIMAL ===')
console.log('📊 Environment:', process.env.NODE_ENV)
console.log('🔌 PORT:', process.env.PORT)

// Create Fastify instance minimal
const fastify = Fastify({
  logger: true
})

async function start() {
  try {
    // ✅ CORS minimal
    await fastify.register(cors, {
      origin: true,
      credentials: true
    })

    // ✅ HEALTH CHECK ULTRA-SIMPLE
    fastify.get('/health', async (request, reply) => {
      console.log('🏥 Health check appelé')
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0-minimal',
        environment: process.env.NODE_ENV,
        port: process.env.PORT,
        uptime: process.uptime()
      }
    })

    // ✅ ROUTE RACINE
    fastify.get('/', async (request, reply) => {
      console.log('🏠 Route racine appelée')
      return {
        message: 'ChatSeller API Minimal - DEBUGGING MODE',
        timestamp: new Date().toISOString(),
        version: '1.0.0-minimal'
      }
    })

    // ✅ ROUTES DE TEST
    fastify.get('/test', async (request, reply) => {
      return {
        test: 'success',
        timestamp: new Date().toISOString(),
        headers: request.headers,
        query: request.query
      }
    })

    // ✅ DÉTECTION PORT
    const port = parseInt(process.env.PORT || '3001', 10)
    const host = '0.0.0.0'

    console.log(`🔌 Tentative de démarrage sur ${host}:${port}`)

    // ✅ DÉMARRAGE ULTRA-SIMPLE
    const address = await fastify.listen({
      port,
      host
    })

    console.log(`✅ SERVEUR MINIMAL DÉMARRÉ AVEC SUCCÈS !`)
    console.log(`📍 Adresse: ${address}`)
    console.log(`🌐 Railway URL: https://chatseller-api-production.up.railway.app`)
    console.log(`🏥 Health: https://chatseller-api-production.up.railway.app/health`)
    
  } catch (error) {
    console.error('💥 ERREUR FATALE SERVEUR MINIMAL:', error)
    console.error('📋 Stack trace:', (error as Error).stack)
    process.exit(1)
  }
}

// ✅ GESTION SIGNAUX
process.on('SIGTERM', async () => {
  console.log('📡 SIGTERM reçu')
  await fastify.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('⚡ SIGINT reçu')
  await fastify.close()
  process.exit(0)
})

// ✅ DÉMARRAGE
start().catch((error) => {
  console.error('💥 Impossible de démarrer le serveur minimal:', error)
  process.exit(1)
})