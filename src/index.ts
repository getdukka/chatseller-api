// src/index.ts (ou votre fichier principal)
import Fastify from 'fastify'
import cors from '@fastify/cors'

// ✅ IMPORTER LES ROUTES AGENTS
import agentsRoutes from './routes/agents'
import billingRoutes from './routes/billing' // Vos routes existantes

// ✅ FONCTION PRINCIPALE ASYNC
const start = async () => {
  const fastify = Fastify({
    logger: true
  })

  try {
    // ✅ CORS
    await fastify.register(cors, {
      origin: [
        'http://localhost:3000',
        'https://dashboard.chatseller.app',
        'https://chatseller.app'
      ],
      credentials: true
    })

    // ✅ ENREGISTRER LES ROUTES
    await fastify.register(billingRoutes, { prefix: '/api' })
    await fastify.register(agentsRoutes, { prefix: '/api/agents' }) // 🆕 NOUVEAU

    // ✅ ROUTE DE SANTÉ
    fastify.get('/health', async (request, reply) => {
      return { status: 'OK', timestamp: new Date().toISOString() }
    })

    // ✅ DÉMARRER LE SERVEUR
    const port = parseInt(process.env.PORT || '3001')
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`🚀 Serveur démarré sur le port ${port}`)
    
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

// ✅ DÉMARRER L'APPLICATION
start()