// src/lib/prisma.ts - SINGLETON PRISMA OPTIMISÉ POUR RAILWAY
import { PrismaClient } from '@prisma/client'

// ✅ DÉCLARATION GLOBALE POUR LE SINGLETON
declare global {
  var __prisma: PrismaClient | undefined
}

// ✅ FONCTION POUR CRÉER UNE INSTANCE PRISMA OPTIMISÉE POUR RAILWAY
function createPrismaClient(): PrismaClient {
  const isProduction = process.env.NODE_ENV === 'production'
  
  return new PrismaClient({
    // ✅ LOGS RÉDUITS EN PRODUCTION
    log: isProduction ? ['error'] : ['query', 'info', 'warn', 'error'],
    
    // ✅ CONFIGURATION SPÉCIALE POUR RAILWAY
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

// ✅ FONCTION UTILITAIRE POUR TESTER LA CONNEXION - VERSION RAILWAY
export async function testDatabaseConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    // ✅ SOLUTION RAILWAY: Utiliser une requête simple sans prepared statements
    const result = await prisma.$queryRawUnsafe('SELECT 1 as test')
    
    console.log('✅ Base de données: Connexion OK')
    return { success: true }
  } catch (error: any) {
    console.error('❌ Base de données: Erreur connexion:', error)
    
    // ✅ FALLBACK: Essayer une méthode alternative
    try {
      await prisma.$connect()
      console.log('✅ Connexion alternative réussie')
      return { success: true }
    } catch (fallbackError: any) {
      console.error('❌ Fallback connexion échoué:', fallbackError)
      return { 
        success: false, 
        error: fallbackError.message || 'Erreur de connexion à la base de données'
      }
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

// ✅ FONCTION POUR OBTENIR LE STATUS DE CONNEXION - VERSION RAILWAY
export async function getConnectionStatus(): Promise<{
  connected: boolean
  latency?: number
  error?: string
}> {
  const startTime = Date.now()
  
  try {
    // ✅ Utiliser $queryRawUnsafe pour éviter les prepared statements
    await prisma.$queryRawUnsafe('SELECT 1 as health_check')
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

// ✅ FONCTION UTILITAIRE POUR RAILWAY: Exécuter des requêtes sans prepared statements
export async function queryWithoutPreparedStatements<T = any>(sql: string, values?: any[]): Promise<T> {
  try {
    if (values && values.length > 0) {
      // Remplacer les paramètres manuellement
      let finalSql = sql
      values.forEach((value, index) => {
        const placeholder = `$${index + 1}`
        const safeValue = typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : value
        finalSql = finalSql.replace(placeholder, safeValue)
      })
      return await prisma.$queryRawUnsafe(finalSql)
    } else {
      return await prisma.$queryRawUnsafe(sql)
    }
  } catch (error) {
    console.error('❌ Erreur requête sans prepared statements:', error)
    throw error
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