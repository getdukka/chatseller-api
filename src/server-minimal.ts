// src/server-minimal.ts - Version ultra-minimaliste pour identifier le problème
import Fastify from 'fastify'

const fastify = Fastify({
  logger: true
})

// ✅ ROUTES MINIMALES (aucun middleware)
fastify.get('/health', async (request, reply) => {
  console.log('🏥 Health check request received')
  return { status: 'ok', time: new Date().toISOString() }
})

fastify.get('/', async (request, reply) => {
  console.log('🏠 Root request received')
  return { message: 'API minimal working', time: new Date().toISOString() }
})

fastify.get('/ping', async (request, reply) => {
  console.log('🏓 Ping request received')
  return { pong: true }
})

// ✅ FONCTION DE DÉMARRAGE SIMPLE
async function start() {
  try {
    const port = parseInt(process.env.PORT || '3001', 10)
    const host = '0.0.0.0'
    
    console.log('🚀 Starting minimal server...')
    console.log(`Port: ${port}, Host: ${host}`)
    console.log(`Environment: ${process.env.NODE_ENV}`)
    
    await fastify.listen({ port, host })
    
    console.log('✅ Minimal server running successfully!')
    
  } catch (error) {
    console.error('❌ Minimal server failed:', error)
    process.exit(1)
  }
}

start()