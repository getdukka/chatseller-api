// src/server-isolated.ts - AUCUN IMPORT de votre code existant
import Fastify from 'fastify'

console.log('🚀 [ISOLATED] Starting completely isolated server...')
console.log('🚀 [ISOLATED] No Prisma, no custom libs, nothing!')

const fastify = Fastify({ logger: false })

// ✅ ROUTES 100% ISOLÉES
fastify.get('/health', async () => {
  console.log('🏥 [ISOLATED] Health check received!')
  return { 
    status: 'ok', 
    message: 'Isolated server working!',
    timestamp: new Date().toISOString()
  }
})

fastify.get('/', async () => {
  console.log('🏠 [ISOLATED] Root request received!')
  return { 
    success: true,
    message: 'Isolated ChatSeller API',
    no_prisma: true,
    timestamp: new Date().toISOString()
  }
})

fastify.get('/ping', async () => {
  console.log('🏓 [ISOLATED] Ping received!')
  return { pong: true, isolated: true }
})

// ✅ DÉMARRAGE ISOLÉ
async function start() {
  try {
    const PORT = parseInt(process.env.PORT || '3001', 10)
    const HOST = '0.0.0.0'
    
    console.log(`🚀 [ISOLATED] PORT: ${PORT}`)
    console.log(`🚀 [ISOLATED] HOST: ${HOST}`)
    console.log(`🚀 [ISOLATED] ENV: ${process.env.NODE_ENV}`)
    
    await fastify.listen({ port: PORT, host: HOST })
    
    console.log('✅ [ISOLATED] Server listening and ready!')
    console.log('✅ [ISOLATED] No Prisma event listeners!')
    console.log('✅ [ISOLATED] Waiting for requests...')
    
  } catch (error) {
    console.error('❌ [ISOLATED] Failed to start:', error)
    process.exit(1)
  }
}

start().catch(error => {
  console.error('💥 [ISOLATED] Fatal error:', error)
  process.exit(1)
})