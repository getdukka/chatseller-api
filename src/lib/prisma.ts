// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

// ✅ DÉCLARATION GLOBALE POUR LE SINGLETON
declare global {
  var __prisma: PrismaClient | undefined
}

// ✅ CONFIGURATION PRISMA OPTIMISÉE POUR RAILWAY
function createPrismaClient(): PrismaClient {
  const isProduction = process.env.NODE_ENV === 'production'
  
  return new PrismaClient({
    // ✅ LOGS ADAPTÉS À L'ENVIRONNEMENT
    log: isProduction ? ['error', 'warn'] : ['query', 'info', 'warn', 'error'],
    
    // ✅ CONFIGURATION DATABASE
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    },
    
    // ✅ OPTIONS SPÉCIALES POUR RAILWAY
    errorFormat: 'minimal'
  })
}

// ✅ SINGLETON : Une seule instance partagée
const prisma = globalThis.__prisma ?? createPrismaClient()

// ✅ EN DÉVELOPPEMENT, STOCKER L'INSTANCE GLOBALEMENT
if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}

// ✅ FONCTION UTILITAIRE POUR TESTER LA CONNEXION - OPTIMISÉE RAILWAY
export async function testDatabaseConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    // ✅ Test simple d'abord
    await prisma.$connect()
    
    // ✅ Test avec une requête basique
    const result = await prisma.$executeRaw`SELECT 1 as test`
    
    console.log('✅ Base de données: Connexion et requête OK')
    return { success: true }
    
  } catch (error: any) {
    console.error('❌ Base de données: Erreur connexion:', error.message)
    
    // ✅ TENTATIVE DE RECONNEXION
    try {
      await prisma.$disconnect()
      await new Promise(resolve => setTimeout(resolve, 2000)) // Attendre 2s
      await prisma.$connect()
      
      console.log('✅ Reconnexion base de données réussie')
      return { success: true }
      
    } catch (fallbackError: any) {
      console.error('❌ Reconnexion base de données échouée:', fallbackError.message)
      return { 
        success: false, 
        error: fallbackError.message || 'Erreur de connexion à la base de données'
      }
    }
  }
}

// ✅ FONCTION POUR FORCER LA RECONNEXION
export async function reconnectIfNeeded(): Promise<void> {
  try {
    await prisma.$disconnect()
    await new Promise(resolve => setTimeout(resolve, 1000))
    await prisma.$connect()
    console.log('🔄 Prisma reconnecté avec succès')
  } catch (error) {
    console.error('❌ Erreur lors de la reconnexion Prisma:', error)
    throw error
  }
}

// ✅ FONCTION POUR OBTENIR LE STATUS DE CONNEXION
export async function getConnectionStatus(): Promise<{
  connected: boolean
  latency?: number
  error?: string
}> {
  const startTime = Date.now()
  
  try {
    await prisma.$executeRaw`SELECT 1 as health_check`
    const latency = Date.now() - startTime
    
    return {
      connected: true,
      latency
    }
  } catch (error: any) {
    return {
      connected: false,
      error: error.message
    }
  }
}

// ✅ GESTION PROPRE DE LA FERMETURE POUR RAILWAY
async function gracefulDisconnect() {
  try {
    console.log('🔌 Fermeture des connexions Prisma...')
    await prisma.$disconnect()
    console.log('✅ Prisma déconnecté proprement')
  } catch (error) {
    console.error('❌ Erreur fermeture Prisma:', error)
  }
}

// ✅ SIGNAL HANDLERS POUR RAILWAY
process.on('beforeExit', gracefulDisconnect)
process.on('SIGTERM', async () => {
  console.log('📡 SIGTERM reçu, fermeture Prisma...')
  await gracefulDisconnect()
})
process.on('SIGINT', async () => {
  console.log('⚡ SIGINT reçu, fermeture Prisma...')
  await gracefulDisconnect()
})

// ✅ EXPORT DE L'INSTANCE UNIQUE
export default prisma

// ✅ EXPORT NOMMÉ POUR COMPATIBILITÉ
export { prisma }

console.log('🔧 Prisma singleton initialisé:', {
  env: process.env.NODE_ENV,
  hasDbUrl: !!process.env.DATABASE_URL
})