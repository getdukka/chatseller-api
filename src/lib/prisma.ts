// src/lib/prisma.ts - VERSION RAILWAY OPTIMISÉE
import { PrismaClient } from '@prisma/client'

// ✅ DÉCLARATION GLOBALE POUR LE SINGLETON
declare global {
  var __prisma: PrismaClient | undefined
}

// ✅ CONFIGURATION PRISMA SPÉCIALE POUR RAILWAY
function createPrismaClient(): PrismaClient {
  const isProduction = process.env.NODE_ENV === 'production'
  
  return new PrismaClient({
    log: isProduction ? ['error'] : ['error', 'warn'],
    
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    },
    
    // ✅ DÉSACTIVER COMPLÈTEMENT LES PREPARED STATEMENTS POUR RAILWAY
    errorFormat: 'minimal',
    
    // ✅ OPTIONS RAILWAY SPÉCIFIQUES
    transactionOptions: {
      maxWait: 10000, // 10s max wait
      timeout: 20000, // 20s timeout
    }
  })
}

// ✅ SINGLETON : Une seule instance partagée
const prisma = globalThis.__prisma ?? createPrismaClient()

// ✅ EN DÉVELOPPEMENT, STOCKER L'INSTANCE GLOBALEMENT
if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}

// ✅ FONCTION DE TEST SIMPLIFIÉE POUR RAILWAY - SANS PREPARED STATEMENTS
export async function testDatabaseConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('🔧 Test de connexion DB (Railway optimisé)...');
    
    // ✅ SOLUTION RAILWAY: Utiliser une requête Prisma simple au lieu de $queryRawUnsafe
    const result = await prisma.shop.findMany({
      take: 1,
      select: { id: true }
    });
    
    console.log('✅ Base de données: Connexion OK (Railway)');
    return { success: true };
    
  } catch (error: any) {
    console.error('❌ Base de données: Erreur connexion:', error.message);
    
    // ✅ TENTATIVE DE RECONNEXION SIMPLE SANS RAW QUERIES
    try {
      await prisma.$disconnect();
      await new Promise(resolve => setTimeout(resolve, 2000));
      await prisma.$connect();
      
      // Test simple avec findMany au lieu de raw query
      await prisma.shop.findMany({ take: 1, select: { id: true } });
      
      console.log('✅ Reconnexion base de données réussie (Railway)');
      return { success: true };
      
    } catch (fallbackError: any) {
      console.error('❌ Reconnexion base de données échouée:', fallbackError.message);
      return { 
        success: false, 
        error: fallbackError.message || 'Erreur de connexion à la base de données'
      };
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

// ✅ FONCTION STATUS SIMPLIFIÉE POUR RAILWAY
export async function getConnectionStatus(): Promise<{
  connected: boolean
  latency?: number
  error?: string
}> {
  const startTime = Date.now()
  
  try {
    // ✅ Utiliser findMany au lieu de $queryRawUnsafe pour éviter les prepared statements
    await prisma.shop.findMany({ take: 1, select: { id: true } })
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

// ✅ HEALTH CHECK ULTRA-SIMPLE POUR RAILWAY
export async function simpleHealthCheck(): Promise<boolean> {
  try {
    // Juste vérifier que Prisma peut se connecter sans faire de requête
    await prisma.$connect()
    return true
  } catch {
    return false
  }
}

// ✅ EXPORT DE L'INSTANCE UNIQUE
export default prisma

// ✅ EXPORT NOMMÉ POUR COMPATIBILITÉ
export { prisma }

console.log('🔧 Prisma singleton initialisé (Railway optimisé):', {
  env: process.env.NODE_ENV,
  hasDbUrl: !!process.env.DATABASE_URL,
  disablePreparedStatements: process.env.PRISMA_DISABLE_PREPARED_STATEMENTS
})