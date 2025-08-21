#!/usr/bin/env node

// =====================================
// SCRIPT DE TEST API CHATSELLER
// =====================================

const https = require('https');
const http = require('http');

const API_BASE_URL = 'https://chatseller-api-production.up.railway.app';
const LOCAL_URL = 'http://localhost:3001';

// ✅ FONCTION DE TEST HTTP
function testEndpoint(url, expectedStatus = 200) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const startTime = Date.now();
    
    const req = protocol.get(url, (res) => {
      const responseTime = Date.now() - startTime;
      let data = '';
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          url,
          status: res.statusCode,
          responseTime,
          success: res.statusCode === expectedStatus,
          data: data.slice(0, 200), // Premier 200 caractères
          headers: res.headers
        });
      });
    });
    
    req.on('error', (error) => {
      reject({
        url,
        error: error.message,
        success: false
      });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      reject({
        url,
        error: 'Timeout (10s)',
        success: false
      });
    });
  });
}

// ✅ TESTS À EFFECTUER
const tests = [
  { name: 'Health Check', url: `${API_BASE_URL}/health` },
  { name: 'Health Full', url: `${API_BASE_URL}/health/full` },
  { name: 'API Root', url: `${API_BASE_URL}/` },
  { name: 'Public Config Demo', url: `${API_BASE_URL}/api/v1/public/shops/public/demo-shop/config` },
  { name: 'Public Chat Test', url: `${API_BASE_URL}/api/v1/public/chat`, method: 'POST' }
];

// ✅ EXÉCUTION DES TESTS
async function runTests() {
  console.log('🧪 === TEST CONNECTIVITÉ API CHATSELLER ===\n');
  console.log(`🎯 URL de base: ${API_BASE_URL}\n`);
  
  const results = [];
  
  for (const test of tests) {
    if (test.method === 'POST') {
      console.log(`⏭️  ${test.name}: SKIP (POST request)`);
      continue;
    }
    
    try {
      console.log(`🔄 Test: ${test.name}...`);
      const result = await testEndpoint(test.url);
      
      if (result.success) {
        console.log(`✅ ${test.name}: OK (${result.status}) - ${result.responseTime}ms`);
      } else {
        console.log(`❌ ${test.name}: FAILED (${result.status}) - ${result.responseTime}ms`);
      }
      
      results.push(result);
      
    } catch (error) {
      console.log(`💥 ${test.name}: ERROR - ${error.error || error.message}`);
      results.push(error);
    }
    
    console.log(''); // Ligne vide
  }
  
  // ✅ RÉSUMÉ
  console.log('📊 === RÉSUMÉ ===');
  const successful = results.filter(r => r.success).length;
  const total = results.length;
  
  console.log(`✅ Tests réussis: ${successful}/${total}`);
  console.log(`❌ Tests échoués: ${total - successful}/${total}`);
  
  if (successful === total) {
    console.log('\n🎉 Tous les tests sont PASSED! L\'API est opérationnelle.');
  } else {
    console.log('\n⚠️  Certains tests ont échoué. Vérifiez les logs ci-dessus.');
  }
  
  return results;
}

// ✅ LANCEMENT
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testEndpoint, runTests };