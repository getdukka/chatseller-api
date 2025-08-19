// src/lib/prisma.ts - SINGLETON PRISMA POUR ÉVITER LES CONFLITS
import { PrismaClient } from '@prisma/client'

// ✅ DÉCLARATION GLOBALE POUR LE SINGLETON
declare global {
  var __prisma: PrismaClient | undefined
}

// ✅ FONCTION POUR CRÉER UNE INSTANCE PRISMA OPTIMISÉE
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    // ✅ LOGS RÉDUITS EN PRODUCTION
    log: process.env.NODE_ENV === 'production' 
      ? ['error'] 
      : ['query', 'info', 'warn', 'error'],
    
    // ✅ CONFIGURATION DE CONNEXION OPTIMISÉE POUR RAILWAY
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    }
  })
}

// ✅ SINGLETON : Une seule instance partagée
const prisma = globalThis.__prisma ?? createPrismaClient()

// ✅ EN DÉVELOPPEMENT, STOCKER L'INSTANCE GLOBALEMENT
if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}

// ✅ GESTION PROPRE DE LA FERMETURE
process.on('beforeExit', async () => {
  console.log('🔌 Fermeture des connexions Prisma...')
  await prisma.$disconnect()
})

process.on('SIGTERM', async () => {
  console.log('📡 SIGTERM reçu, fermeture Prisma...')
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('⚡ SIGINT reçu, fermeture Prisma...')
  await prisma.$disconnect()
  process.exit(0)
})

// ✅ FONCTION UTILITAIRE POUR TESTER LA CONNEXION SANS PREPARED STATEMENTS
export async function testDatabaseConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    // ✅ Utiliser $executeRaw au lieu de $queryRaw pour éviter les prepared statements
    await prisma.$executeRaw`SELECT 1 as test`
    
    console.log('✅ Base de données: Connexion OK')
    return { success: true }
  } catch (error: any) {
    console.error('❌ Base de données: Erreur connexion:', error)
    return { 
      success: false, 
      error: error.message || 'Erreur de connexion à la base de données'
    }
  }
}

// ✅ FONCTION POUR FORCER LA RECONNEXION SI NÉCESSAIRE
export async function reconnectIfNeeded(): Promise<void> {
  try {
    await prisma.$disconnect()
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

// ✅ EXPORT DE L'INSTANCE UNIQUE
export default prisma

// ✅ EXPORT NOMMÉ POUR COMPATIBILITÉ
export { prisma }

console.log('🔧 Prisma singleton initialisé:', {
  env: process.env.NODE_ENV,
  hasDbUrl: !!process.env.DATABASE_URL
})